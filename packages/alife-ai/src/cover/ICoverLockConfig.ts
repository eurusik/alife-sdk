// cover/ICoverLockConfig.ts
// Configuration and public interface for the TTL-based cover lock subsystem.

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Configuration for the CoverLockRegistry.
 *
 * All durations are in milliseconds. Capacity values are positive integers.
 */
export interface ICoverLockConfig {
  /**
   * Default time-to-live for a lock in milliseconds.
   * After this duration the lock expires and the point becomes available again.
   * @default 10_000
   */
  readonly defaultTtlMs: number;

  /**
   * Default maximum number of NPCs that can lock a single cover point.
   * Individual `tryLock` calls can override this per-point via `options.capacity`.
   * @default 1
   */
  readonly defaultCapacity: number;

  /**
   * Auto-purge cadence: run `purgeExpired()` automatically every N `tryLock` /
   * `isAvailable` calls. Set to 0 to disable auto-purge.
   * @default 32
   */
  readonly autoPurgeInterval: number;
}

export function createDefaultCoverLockConfig(
  overrides?: Partial<ICoverLockConfig>,
): ICoverLockConfig {
  const cfg: ICoverLockConfig = {
    defaultTtlMs: 10_000,
    defaultCapacity: 1,
    autoPurgeInterval: 32,
    ...overrides,
  };
  if (cfg.defaultTtlMs <= 0) {
    throw new RangeError(`ICoverLockConfig.defaultTtlMs must be > 0, got ${cfg.defaultTtlMs}`);
  }
  if (!Number.isInteger(cfg.defaultCapacity) || cfg.defaultCapacity < 1) {
    throw new RangeError(
      `ICoverLockConfig.defaultCapacity must be a positive integer, got ${cfg.defaultCapacity}`,
    );
  }
  if (!Number.isInteger(cfg.autoPurgeInterval) || cfg.autoPurgeInterval < 0) {
    throw new RangeError(
      `ICoverLockConfig.autoPurgeInterval must be a non-negative integer, got ${cfg.autoPurgeInterval}`,
    );
  }
  return cfg;
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/**
 * TTL-based reservation system for cover points.
 *
 * Prevents multiple NPCs from occupying the same cover point simultaneously.
 * Locks expire automatically — no manual cleanup on NPC death is required,
 * though `unlockAll(npcId)` is preferred for immediate availability.
 *
 * Cover points are identified by their string ID (`ICoverPoint.id`).
 * Time is provided by an injected `timeFn` for determinism.
 */
export interface ICoverLockRegistry {
  /**
   * Attempt to lock a cover point for an NPC.
   *
   * - If the NPC already holds a lock on this point, the TTL is refreshed (idempotent).
   * - Fails (returns false) when the point is at capacity with other NPCs.
   *
   * @param pointId  - Cover point ID.
   * @param npcId    - NPC claiming the lock.
   * @param options  - Per-call overrides for TTL and capacity.
   */
  tryLock(
    pointId: string,
    npcId: string,
    options?: { ttlMs?: number; capacity?: number },
  ): boolean;

  /**
   * Release a specific NPC's lock on a point.
   * No-op if the NPC does not hold a lock on this point.
   */
  unlock(pointId: string, npcId: string): void;

  /**
   * Release all locks held by an NPC. Call on NPC death or despawn.
   * O(n) where n = total active locks across all points.
   */
  unlockAll(npcId: string): void;

  /**
   * Check whether a point can be locked by the given NPC.
   *
   * Returns true when:
   *   - The NPC already holds a lock on this point, or
   *   - The point has fewer active locks than its tracked capacity
   *     (the highest capacity ever passed via `options.capacity` for this
   *     point, falling back to `defaultCapacity` for unseen points).
   */
  isAvailable(pointId: string, npcId: string): boolean;

  /**
   * Expire and remove stale lock entries.
   * Called automatically at `autoPurgeInterval` cadence.
   * @returns number of lock entries removed.
   */
  purgeExpired(): number;

  /** Remove all lock entries. Call on scene teardown. */
  clear(): void;

  /** Number of points that currently have at least one active lock. */
  readonly lockedPointCount: number;
}
