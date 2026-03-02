// cover/CoverLockRegistry.ts
// TTL-based cover point reservation system.

import type { ICoverLockConfig, ICoverLockRegistry } from './ICoverLockConfig';
import { createDefaultCoverLockConfig } from './ICoverLockConfig';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface CoverLock {
  readonly npcId: string;
  /** Absolute time (ms from timeFn) at which this lock expires. */
  expiresAt: number;
}

/**
 * Per-point container.
 * `capacity` is the highest value ever passed via `options.capacity` for this
 * point; `isAvailable` uses it so multi-capacity points remain accessible to
 * additional NPCs after the first lock is acquired.
 */
interface PointEntry {
  capacity: number;
  locks: CoverLock[];
}

// ---------------------------------------------------------------------------
// CoverLockRegistry
// ---------------------------------------------------------------------------

/**
 * TTL-based reservation system for cover points.
 *
 * Locks are stored per point-ID in `Map<string, PointEntry>`.
 * Expired entries are pruned lazily (inline on tryLock/isAvailable) and
 * periodically via auto-purge at `autoPurgeInterval` cadence.
 *
 * Memory at scale: 200 NPCs × 1 lock each ≈ 200 Map entries, ~20KB.
 *
 * @example
 * ```ts
 * const locks = new CoverLockRegistry(() => Date.now());
 *
 * // In TakeCoverState.enter():
 * const ok = locks.tryLock('cover_0012', npcId);
 *
 * // In TakeCoverState.exit():
 * locks.unlockAll(npcId);
 * ```
 */
export class CoverLockRegistry implements ICoverLockRegistry {
  private readonly _points = new Map<string, PointEntry>();
  private readonly config: ICoverLockConfig;
  private readonly timeFn: () => number;
  private _checkCounter = 0;

  /**
   * @param timeFn - Monotonically non-decreasing time source (returns ms).
   *                 Must not return negative or wildly non-monotonic values.
   * @param config - Optional config overrides (TTL, capacity, auto-purge rate).
   */
  constructor(timeFn: () => number, config?: Partial<ICoverLockConfig>) {
    this.timeFn = timeFn;
    this.config = createDefaultCoverLockConfig(config);
  }

  // -------------------------------------------------------------------------
  // ICoverLockRegistry
  // -------------------------------------------------------------------------

  tryLock(
    pointId: string,
    npcId: string,
    options?: { ttlMs?: number; capacity?: number },
  ): boolean {
    this._maybeAutoPurge();

    const now = this.timeFn();
    const ttl = options?.ttlMs ?? this.config.defaultTtlMs;
    const capacity = options?.capacity ?? this.config.defaultCapacity;
    const expiresAt = now + ttl;

    const entry = this._points.get(pointId);

    if (entry === undefined) {
      this._points.set(pointId, { capacity, locks: [{ npcId, expiresAt }] });
      return true;
    }

    // Promote capacity if this call requests higher capacity for this point.
    if (capacity > entry.capacity) {
      entry.capacity = capacity;
    }

    // Prune expired entries inline (arrays are typically size 1-3).
    let activeCount = 0;
    let ownIdx = -1;

    for (let i = 0; i < entry.locks.length; i++) {
      const lock = entry.locks[i];
      if (lock.expiresAt <= now) continue;  // expired
      if (lock.npcId === npcId) { ownIdx = i; }
      else { activeCount++; }
    }

    if (ownIdx !== -1) {
      // Refresh TTL for the NPC's existing lock.
      entry.locks[ownIdx].expiresAt = expiresAt;
      // Compact out expired entries.
      entry.locks = entry.locks.filter((l) => l.expiresAt > now);
      return true;
    }

    if (activeCount >= entry.capacity) {
      entry.locks = entry.locks.filter((l) => l.expiresAt > now);
      return false;
    }

    // Compact + add new lock.
    entry.locks = entry.locks.filter((l) => l.expiresAt > now);
    entry.locks.push({ npcId, expiresAt });
    return true;
  }

  unlock(pointId: string, npcId: string): void {
    const entry = this._points.get(pointId);
    if (entry === undefined) return;

    entry.locks = entry.locks.filter((l) => l.npcId !== npcId);
    if (entry.locks.length === 0) {
      this._points.delete(pointId);
    }
  }

  unlockAll(npcId: string): void {
    // Collect points to delete after iteration to avoid mutation-during-iteration.
    const toDelete: string[] = [];

    for (const [pointId, entry] of this._points) {
      entry.locks = entry.locks.filter((l) => l.npcId !== npcId);
      if (entry.locks.length === 0) {
        toDelete.push(pointId);
      }
    }

    for (const id of toDelete) this._points.delete(id);
  }

  isAvailable(pointId: string, npcId: string): boolean {
    this._maybeAutoPurge();

    const entry = this._points.get(pointId);
    if (entry === undefined) return true;

    const now = this.timeFn();
    let activeCount = 0;

    for (const lock of entry.locks) {
      if (lock.expiresAt <= now) continue;
      if (lock.npcId === npcId) return true;   // own lock — always available
      activeCount++;
    }

    return activeCount < entry.capacity;
  }

  purgeExpired(): number {
    const now = this.timeFn();
    let purged = 0;
    const toDelete: string[] = [];

    for (const [pointId, entry] of this._points) {
      const before = entry.locks.length;
      entry.locks = entry.locks.filter((l) => l.expiresAt > now);
      purged += before - entry.locks.length;

      if (entry.locks.length === 0) {
        toDelete.push(pointId);
      }
    }

    for (const id of toDelete) this._points.delete(id);

    return purged;
  }

  clear(): void {
    this._points.clear();
    this._checkCounter = 0;
  }

  /**
   * Approximate count of points with at least one lock entry.
   * May include points whose locks have all expired but not yet been purged.
   * Call `purgeExpired()` first for an exact count.
   */
  get lockedPointCount(): number {
    return this._points.size;
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  private _maybeAutoPurge(): void {
    if (this.config.autoPurgeInterval <= 0) return;
    if (++this._checkCounter >= this.config.autoPurgeInterval) {
      this._checkCounter = 0;
      this.purgeExpired();
    }
  }
}
