// remark/RemarkDispatcher.ts
// Ambient idle remark system with terrain locks and random cooldowns.

import type { IRandom } from '@alife-sdk/core';
import type { ISocialNPC, IBubbleRequest } from '../types/ISocialTypes';
import { SocialCategory, BUBBLE_MIN_DURATION_MS, BUBBLE_MS_PER_CHAR } from '../types/ISocialTypes';
import type { IRemarkConfig } from '../types/ISocialConfig';
import { DEFAULT_REMARK_ELIGIBLE_STATES, DEFAULT_REMARK_TERRAIN_LOCK_MS } from '../types/ISocialConfig';
import { ContentPool } from '../content/ContentPool';

// Re-export so existing imports (e.g. `from './RemarkDispatcher'`) continue to resolve.
// The canonical source is ISocialConfig.ts — use that path for new imports.
export { DEFAULT_REMARK_ELIGIBLE_STATES, DEFAULT_REMARK_TERRAIN_LOCK_MS };

function bubbleDuration(text: string): number {
  return Math.max(BUBBLE_MIN_DURATION_MS, text.length * BUBBLE_MS_PER_CHAR);
}

/**
 * RemarkDispatcher — emits ambient idle/patrol remarks.
 *
 * Runs on a timer (remarkCheckIntervalMs). For each eligible NPC:
 * - State must be IDLE, PATROL, or CAMP
 * - Per-NPC cooldown must have expired (randomised 30–60s)
 * - Only one NPC per terrain may speak at a time (terrain lock)
 * - 30% chance per eligible NPC per check
 *
 * @example
 * ```ts
 * const dispatcher = new RemarkDispatcher(pool, random, config);
 * const bubbles = dispatcher.update(deltaMs, npcs, getTerrainId);
 * ```
 */
export class RemarkDispatcher {
  private readonly cooldowns = new Map<string, number>();
  private readonly terrainLocks = new Map<string, string>();
  private readonly terrainLockTimes = new Map<string, number>();
  private readonly eligibleStates: ReadonlySet<string>;
  private readonly terrainLockDurationMs: number;
  private checkTimer = 0;
  private time = 0;

  constructor(
    private readonly contentPool: ContentPool,
    private readonly random: IRandom,
    private readonly config: IRemarkConfig,
  ) {
    this.eligibleStates = new Set(config.eligibleStates ?? DEFAULT_REMARK_ELIGIBLE_STATES);
    this.terrainLockDurationMs = config.terrainLockDurationMs ?? DEFAULT_REMARK_TERRAIN_LOCK_MS;
  }

  /**
   * Update the dispatcher. Returns remark bubbles to display.
   *
   * @param deltaMs - Time since last update (ms)
   * @param npcs - Online NPCs to check
   * @param getTerrainId - Resolve NPC → terrain ID (null if unassigned)
   */
  update(
    deltaMs: number,
    npcs: readonly ISocialNPC[],
    getTerrainId: (npcId: string) => string | null,
  ): IBubbleRequest[] {
    this.time += deltaMs;
    this.checkTimer += deltaMs;
    if (this.checkTimer < this.config.remarkCheckIntervalMs) return [];
    this.checkTimer -= this.config.remarkCheckIntervalMs;

    // Prune expired cooldowns to prevent unbounded Map growth
    this.pruneExpiredCooldowns();

    const bubbles: IBubbleRequest[] = [];

    for (const npc of npcs) {
      if (!this.eligibleStates.has(npc.state)) continue;

      // Per-NPC cooldown — compare against stored expiry timestamp
      const expiry = this.cooldowns.get(npc.id);
      if (expiry !== undefined && this.time < expiry) continue;

      // Terrain lock (with expiration)
      const terrainId = getTerrainId(npc.id) ?? 'unassigned';
      const lockHolder = this.terrainLocks.get(terrainId);
      if (lockHolder && lockHolder !== npc.id) {
        const lockTime = this.terrainLockTimes.get(terrainId) ?? 0;
        if (this.time - lockTime < this.terrainLockDurationMs) continue;
        // Lock expired — clear it
        this.terrainLocks.delete(terrainId);
        this.terrainLockTimes.delete(terrainId);
      }

      // Random chance
      if (this.random.next() >= this.config.remarkChance) continue;

      // Select category
      const category = this.selectCategory(npc.factionId);
      if (category === null) continue;
      const text = this.contentPool.getRandomLine(category);
      if (!text) continue;

      this.cooldowns.set(npc.id, this.time + this.nextCooldown());
      this.terrainLocks.set(terrainId, npc.id);
      this.terrainLockTimes.set(terrainId, this.time);

      bubbles.push({
        npcId: npc.id,
        text,
        durationMs: bubbleDuration(text),
        category: category as SocialCategory,
      });

      // Only one NPC per check pass
      break;
    }

    return bubbles;
  }

  /**
   * Clear all state.
   */
  clear(): void {
    this.cooldowns.clear();
    this.terrainLocks.clear();
    this.terrainLockTimes.clear();
    this.checkTimer = 0;
    this.time = 0;
  }

  /**
   * Serialize cooldown state for save/load.
   *
   * Terrain locks are intentionally excluded — they are short-lived (seconds)
   * and will be reacquired naturally on the next remark check after loading.
   *
   * @returns Cooldown entries as `[npcId, remainingMs]` pairs (time-independent).
   */
  serialize(): Array<[string, number]> {
    return Array.from(this.cooldowns.entries()).map(
      ([npcId, expiry]) => [npcId, expiry - this.time],
    );
  }

  /**
   * Restore cooldown state from a serialized snapshot.
   *
   * Terrain locks are cleared — they are short-lived and will be naturally
   * reacquired. The internal time accumulator resets to 0; each entry's
   * remaining duration is stored as an absolute expiry relative to that zero.
   *
   * @param entries - `[npcId, remainingMs]` pairs from {@link serialize}.
   */
  restore(entries: Array<[string, number]>): void {
    this.cooldowns.clear();
    this.terrainLocks.clear();
    this.terrainLockTimes.clear();
    this.checkTimer = 0;
    this.time = 0;
    for (const [npcId, remainingMs] of entries) {
      this.cooldowns.set(npcId, remainingMs);
    }
  }

  /** Remove cooldown entries whose expiry has passed. */
  private pruneExpiredCooldowns(): void {
    const toDelete: string[] = [];
    for (const [npcId, expiry] of this.cooldowns) {
      if (this.time >= expiry) {
        toDelete.push(npcId);
      }
    }
    for (const npcId of toDelete) {
      this.cooldowns.delete(npcId);
    }
  }

  private selectCategory(factionId: string): string | null {
    const r = this.random.next();

    if (r < this.config.weightZone) {
      return SocialCategory.REMARK_ZONE;
    }

    if (r < this.config.weightWeatherCumulative) {
      return SocialCategory.REMARK_WEATHER;
    }

    // Gossip — skip if no content for this faction
    const gossipKey = ContentPool.gossipKey(factionId);
    if (this.contentPool.hasLines(gossipKey)) {
      return gossipKey;
    }
    return null;
  }

  private nextCooldown(): number {
    const { remarkCooldownMinMs, remarkCooldownMaxMs } = this.config;
    return remarkCooldownMinMs + this.random.next() * (remarkCooldownMaxMs - remarkCooldownMinMs);
  }
}
