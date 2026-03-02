// squad/SquadSharedTarget.ts
// TTL-based squad enemy intel table.
//
// Design goals:
//   • Zero SDK dependency — no Phaser, no alife-core imports needed.
//   • npcToSquad callback injection — no circular dep to SquadManager.
//   • nowFn injectable — deterministic test control.
//   • Opt-in at the ISquadAccess level via optional getSharedTarget?().
//     State handlers that don't call it incur zero overhead.

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Shared enemy sighting propagated to all squad members.
 *
 * Produced by {@link SquadSharedTargetTable.shareTarget} and returned by
 * {@link SquadSharedTargetTable.getSharedTarget}.
 */
export interface ISharedTargetInfo {
  /** Stable entity ID of the spotted enemy. */
  readonly targetId: string;
  /** Enemy world X at the time of the sighting (px). */
  readonly x: number;
  /** Enemy world Y at the time of the sighting (px). */
  readonly y: number;
  /**
   * Confidence of this indirect intel.
   * Lower than a direct observation (1.0) — set by
   * {@link ISquadSharedTargetConfig.sharedConfidence}.
   */
  readonly confidence: number;
  /** Epoch ms when the intel was recorded (for TTL checks). */
  readonly sharedAtMs: number;
}

/**
 * Tuning parameters for the squad shared target table.
 * All fields have defaults via {@link createDefaultSquadSharedTargetConfig}.
 */
export interface ISquadSharedTargetConfig {
  /**
   * How long (ms) before shared intel expires and is treated as stale.
   * @default 10_000
   */
  readonly ttlMs: number;

  /**
   * Confidence value assigned to shared (indirect) sightings.
   * Should be < 1.0 to reflect that the NPC has not seen the target directly.
   * @default 0.8
   */
  readonly sharedConfidence: number;
}

/**
 * Create an {@link ISquadSharedTargetConfig} with production defaults.
 * Pass a partial override object to tune individual values.
 *
 * @example
 * const cfg = createDefaultSquadSharedTargetConfig({ ttlMs: 5_000 });
 */
export function createDefaultSquadSharedTargetConfig(
  overrides?: Partial<ISquadSharedTargetConfig>,
): ISquadSharedTargetConfig {
  return {
    ttlMs: 10_000,
    sharedConfidence: 0.8,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// SquadSharedTargetTable
// ---------------------------------------------------------------------------

/**
 * Shared enemy intel store keyed by squad ID.
 *
 * One instance should be created per game session and shared across all NPCs.
 * Each NPC's {@link ISquadAccess} implementation calls into this table via its
 * own `npcId`.
 *
 * ### Wiring example (host layer)
 * ```ts
 * const sharedTargets = new SquadSharedTargetTable(
 *   npcId => squadManager.getSquadForNPC(npcId)?.id ?? null,
 * );
 *
 * class MySquadAccess implements ISquadAccess {
 *   constructor(private readonly npcId: string) {}
 *   shareTarget(targetId, x, y) {
 *     sharedTargets.shareTarget(this.npcId, targetId, x, y);
 *   }
 *   getSharedTarget() {
 *     return sharedTargets.getSharedTarget(this.npcId);
 *   }
 *   // ...
 * }
 * ```
 *
 * ### Opt-in / opt-out
 * - **Full feature**: implement `getSharedTarget()` on `ISquadAccess` above.
 * - **Write only**: implement `shareTarget()` but not `getSharedTarget()`.
 * - **Fully disabled**: don't implement either — PatrolState check is a no-op
 *   via `ctx.squad?.getSharedTarget?.()`.
 */
export class SquadSharedTargetTable {
  private readonly npcToSquad: (npcId: string) => string | null;
  private readonly config: ISquadSharedTargetConfig;
  private readonly nowFn: () => number;

  /** Inner store: squadId → latest ISharedTargetInfo. */
  private readonly store = new Map<string, ISharedTargetInfo>();

  /**
   * @param npcToSquad - Returns the squad ID for an NPC, or null if not in a
   *                     squad. Wrap your SquadManager:
   *                     `npcId => mgr.getSquadForNPC(npcId)?.id ?? null`
   * @param config     - TTL and confidence overrides.
   *                     @default createDefaultSquadSharedTargetConfig()
   * @param nowFn      - Time source.
   *                     @default () => Date.now()  (injectable for tests)
   */
  constructor(
    npcToSquad: (npcId: string) => string | null,
    config?: Partial<ISquadSharedTargetConfig>,
    nowFn?: () => number,
  ) {
    this.npcToSquad = npcToSquad;
    this.config = createDefaultSquadSharedTargetConfig(config);
    this.nowFn = nowFn ?? (() => Date.now());
  }

  /**
   * Record a target sighting for the sender's squad.
   *
   * All squad members can retrieve this via {@link getSharedTarget} until
   * the TTL expires or {@link invalidate} is called.
   *
   * No-op if the sender is not in any squad.
   *
   * @param senderNpcId - NPC ID of the entity that spotted the target.
   * @param targetId    - Stable entity ID of the enemy.
   * @param x           - Enemy world X (px).
   * @param y           - Enemy world Y (px).
   */
  shareTarget(senderNpcId: string, targetId: string, x: number, y: number): void {
    const squadId = this.npcToSquad(senderNpcId);
    if (squadId === null) return;

    const info: ISharedTargetInfo = {
      targetId,
      x,
      y,
      confidence: this.config.sharedConfidence,
      sharedAtMs: this.nowFn(),
    };
    this.store.set(squadId, info);
  }

  /**
   * Return the current shared target for the given NPC's squad.
   *
   * Returns `null` when:
   * - The NPC is not in any squad.
   * - No target has been shared yet.
   * - The intel has expired (age > ttlMs).
   *
   * @param npcId - NPC querying for squad intel.
   */
  getSharedTarget(npcId: string): ISharedTargetInfo | null {
    const squadId = this.npcToSquad(npcId);
    if (squadId === null) return null;

    const info = this.store.get(squadId);
    if (info === undefined) return null;

    if (this.nowFn() - info.sharedAtMs > this.config.ttlMs) {
      this.store.delete(squadId);
      return null;
    }

    return info;
  }

  /**
   * Explicitly clear shared intel for a squad.
   *
   * Call this when the target is confirmed destroyed or the engagement ends
   * to avoid squad members chasing stale positions.
   *
   * @param squadId - Direct squad ID to invalidate.
   */
  invalidate(squadId: string): void {
    this.store.delete(squadId);
  }

  /**
   * Clear all shared intel for all squads.
   *
   * Call on save/load or scene restart to avoid stale intel from a previous
   * session persisting into the restored game state.
   */
  clear(): void {
    this.store.clear();
  }
}
