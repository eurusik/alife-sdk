// trade/OfflineTradeScheduler.ts
// Orchestrates periodic NPC-NPC trading across all terrains.
//
// Not a plugin — a standalone class that the user wires into their update loop.
// Zero cost when co-location map is empty (one deltaMs comparison per frame).
//
// Usage:
//   const scheduler = new OfflineTradeScheduler(deps, { tradeIntervalMs: 30_000 });
//   // In update loop:
//   scheduler.update(deltaMs, currentGameTimeMs);

import type { IRandom } from '@alife-sdk/core';
import { DefaultRandom } from '@alife-sdk/core';
import type { TraderInventory } from './TraderInventory';
import type {
  ICoLocationSource,
  IItemCatalogue,
  ITradePreference,
  IOfflineTradeConfig,
  IOfflineTradeResult,
} from './OfflineTradeTypes';
import { createDefaultOfflineTradeConfig } from './OfflineTradeTypes';
import { resolveNPCTrade, selectTradePair } from './OfflineTradeResolver';

/**
 * Dependencies for `OfflineTradeScheduler`.
 *
 * Wire these up once at initialization; the scheduler holds references
 * for its lifetime.
 */
export interface IOfflineTradeSchedulerDeps {
  /** Shared trader inventory — read for snapshots, mutated on success. */
  readonly traders: TraderInventory;
  /** Port implementation that provides terrain co-location data. */
  readonly coLocation: ICoLocationSource;
  /** Base price lookup for items in traders' stock. */
  readonly catalogue: IItemCatalogue;
  /** Buyer item preference scoring function. */
  readonly preference: ITradePreference;
  /**
   * PRNG for pair selection.
   * Defaults to `DefaultRandom` (Math.random). Pass a `SeededRandom` for
   * deterministic replays or tests.
   */
  readonly random?: IRandom;
  /**
   * Optional callback fired for every trade attempt within a tick.
   *
   * Receives both successful and failed results. Use this instead of
   * polling `getLastResults()` to react to trades immediately.
   *
   * @example
   * ```ts
   * onTradeResult: (r) => {
   *   if (r.success) eventBus.emit('TRADE_COMPLETED', r);
   * }
   * ```
   */
  readonly onTradeResult?: (result: IOfflineTradeResult) => void;
}

/**
 * Orchestrates periodic NPC-NPC trading across all terrains.
 *
 * ## Tick model
 *
 * `update(deltaMs, currentTimeMs)` accumulates real time. Once the
 * accumulator crosses `tradeIntervalMs`, one trade tick fires.
 * During a tick, at most `maxTradesPerTick` trades are resolved across all
 * terrains. A round-robin cursor ensures fair distribution.
 *
 * ## Cooldowns
 *
 * After an NPC participates in a trade (buyer or seller), they enter a
 * per-NPC cooldown of `tradeIntervalMs`. This prevents an NPC from
 * trading every tick in a busy terrain.
 *
 * ## Memory
 *
 * - Cooldown map: O(T) where T = distinct traders who have traded.
 *   Pruned when size exceeds `cooldownMapPruneThreshold` (default 200).
 * - Co-location map: transient (built by the port, not owned here).
 *
 * ## Serialization
 *
 * `serialize()` / `restore()` persist cooldowns, the round-robin cursor,
 * and the accumulator. Include the scheduler in your save/load pipeline.
 *
 * @example
 * ```ts
 * const scheduler = new OfflineTradeScheduler(
 *   { traders, coLocation, catalogue, preference, random },
 *   { tradeIntervalMs: 30_000, maxTradesPerTick: 5 },
 * );
 *
 * // In your update loop:
 * scheduler.update(deltaMs, kernel.clock.totalGameSeconds * 1000);
 * ```
 */
export class OfflineTradeScheduler {
  private readonly deps: IOfflineTradeSchedulerDeps;
  private readonly config: IOfflineTradeConfig;
  private readonly random: IRandom;

  /** npcId → earliest next trade time (game ms). */
  private readonly cooldowns = new Map<string, number>();

  /** Accumulated deltaMs since last tick. */
  private accumulatorMs = 0;

  /**
   * Round-robin terrain cursor — ensures no single terrain monopolizes
   * the per-tick trade budget.
   */
  private terrainCursor = 0;

  /** Results from the most recent tick — readable via getLastResults(). */
  private readonly _lastResults: IOfflineTradeResult[] = [];

  constructor(
    deps: IOfflineTradeSchedulerDeps,
    config?: Partial<IOfflineTradeConfig>,
  ) {
    this.deps = deps;
    this.config = createDefaultOfflineTradeConfig(config);
    this.random = deps.random ?? new DefaultRandom();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Advance the scheduler by `deltaMs` milliseconds.
   *
   * Fires a trade tick when the internal accumulator exceeds `tradeIntervalMs`.
   * Call this once per game-loop frame.
   *
   * @param deltaMs        Real time elapsed since last call (milliseconds).
   * @param currentTimeMs  Monotonically increasing game time (for cooldowns).
   */
  update(deltaMs: number, currentTimeMs: number): void {
    // Cap delta to one interval — prevents a burst of catch-up ticks after a
    // long pause or large deltaMs spike (e.g. initial frame, tab unfocus).
    this.accumulatorMs += Math.min(deltaMs, this.config.tradeIntervalMs);
    if (this.accumulatorMs < this.config.tradeIntervalMs) return;
    this.accumulatorMs -= this.config.tradeIntervalMs;
    this.tick(currentTimeMs);
  }

  /**
   * Execute one trade tick immediately.
   *
   * Resolves up to `maxTradesPerTick` NPC-NPC trades distributed across
   * all terrains in the co-location map.
   *
   * Exposed as a public method for testing and for hosts that drive
   * their own tick scheduling.
   *
   * @param currentTimeMs  Current game time (ms) for cooldown tracking.
   */
  tick(currentTimeMs: number): void {
    this._lastResults.length = 0;

    const coLocationMap = this.deps.coLocation.getCoLocatedTraders();
    if (coLocationMap.size === 0) return;

    // Collect terrain IDs for round-robin iteration.
    const terrainIds: string[] = [];
    for (const key of coLocationMap.keys()) terrainIds.push(key);

    const numTerrains = terrainIds.length;
    if (this.terrainCursor >= numTerrains) this.terrainCursor = 0;

    let tradesRemaining = this.config.maxTradesPerTick;

    for (let i = 0; i < numTerrains && tradesRemaining > 0; i++) {
      const terrainIdx = (this.terrainCursor + i) % numTerrains;
      const terrainId  = terrainIds[terrainIdx];
      const npcs       = coLocationMap.get(terrainId);
      if (!npcs || npcs.length < 2) continue;

      const pair = selectTradePair(npcs, this.cooldowns, currentTimeMs, this.random);
      if (!pair) continue;

      const [buyer, seller] = pair;

      const factionRel  = this.deps.coLocation.getFactionRelation(buyer.factionId, seller.factionId);
      const personalGW  = this.deps.coLocation.getPersonalGoodwill(buyer.npcId, seller.npcId);
      const attitude    = Math.max(-100, Math.min(100, factionRel + personalGW));

      const result = resolveNPCTrade(
        buyer,
        seller,
        this.deps.traders,
        this.deps.catalogue,
        this.deps.preference,
        this.config,
        attitude,
      );

      this._lastResults.push(result);
      this.deps.onTradeResult?.(result);

      if (result.success) {
        // Apply cooldowns to both participants.
        const nextTime = currentTimeMs + this.config.tradeIntervalMs;
        this.cooldowns.set(buyer.npcId, nextTime);
        this.cooldowns.set(seller.npcId, nextTime);
        tradesRemaining--;
      }
    }

    // Advance round-robin cursor.
    this.terrainCursor = (this.terrainCursor + 1) % Math.max(1, numTerrains);

    // Prune expired cooldowns periodically to keep memory bounded.
    const pruneThreshold = this.config.cooldownMapPruneThreshold ?? 200;
    if (this.cooldowns.size > pruneThreshold) {
      const toDelete: string[] = [];
      for (const [npcId, expiry] of this.cooldowns) {
        if (currentTimeMs >= expiry) toDelete.push(npcId);
      }
      for (const npcId of toDelete) this.cooldowns.delete(npcId);
    }
  }

  /**
   * Returns results from the most recent tick (successful and failed trades).
   * Useful for emitting events or diagnostics without requiring the scheduler
   * to own an EventBus.
   */
  getLastResults(): readonly IOfflineTradeResult[] {
    return this._lastResults;
  }

  /**
   * Clear all per-NPC cooldowns.
   *
   * Use after a surge or major world event to let NPCs immediately
   * participate in trading again.
   */
  resetCooldowns(): void {
    this.cooldowns.clear();
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------

  /**
   * Serialize cooldowns, cursor, and accumulator for save/load.
   */
  serialize(): Record<string, unknown> {
    return {
      cooldowns: [...this.cooldowns.entries()],
      terrainCursor: this.terrainCursor,
      accumulatorMs: this.accumulatorMs,
    };
  }

  /**
   * Restore from a previously serialized state.
   */
  restore(state: Record<string, unknown>): void {
    this.cooldowns.clear();
    const entries = state['cooldowns'] as Array<[string, number]> | undefined;
    if (Array.isArray(entries)) {
      for (const [k, v] of entries) {
        if (typeof k === 'string' && typeof v === 'number') {
          this.cooldowns.set(k, v);
        }
      }
    }
    this.terrainCursor = typeof state['terrainCursor'] === 'number' ? state['terrainCursor'] : 0;
    this.accumulatorMs = typeof state['accumulatorMs'] === 'number' ? state['accumulatorMs'] : 0;
  }
}
