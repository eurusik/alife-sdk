// cover/CoverAccessAdapter.ts
// SDK-provided implementation of ICoverAccess that bridges CoverRegistry
// with an optional CoverLockRegistry.

import type { ICoverAccess } from '../states/INPCContext';
import type { CoverType } from '../types/ICoverPoint';
import { CoverType as CoverTypeConst } from '../types/ICoverPoint';
import { CoverRegistry } from './CoverRegistry';
import type { ICoverLockRegistry } from './ICoverLockConfig';

/**
 * Per-NPC cover access adapter.
 *
 * Bridges the generic `ICoverAccess` contract used by state handlers with
 * the concrete `CoverRegistry` + `CoverLockRegistry` SDK classes.
 *
 * Responsibilities:
 *  - Translates the flat `(x, y, enemyX, enemyY)` API to the typed
 *    `CoverRegistry.findCover(type, pos, enemies, npcId)` call.
 *  - Stores the `ICoverPoint.id` of the last successful `findCover` result
 *    so that `lockLastFound()` can acquire the TTL lock without requiring
 *    the caller to manage point IDs.
 *
 * **Create one adapter per NPC** via `AIPlugin.createCoverAccess(npcId)`.
 * The adapter is stateful (tracks `_lastFoundId`) and must not be shared
 * across different NPC entities.
 *
 * @example
 * ```ts
 * // Phaser bridge setup (PhaserNPCContext):
 * const coverAccess = aiPlugin.createCoverAccess(npcId);
 * // Then expose via INPCContext.cover = coverAccess
 * ```
 */
export class CoverAccessAdapter implements ICoverAccess {
  private _lastFoundId: string | null = null;

  /**
   * @param _registry   - Shared cover registry (scene-level singleton).
   * @param _lockRegistry - Optional TTL lock registry. When null, locking
   *                        is skipped and `lockLastFound` returns true.
   * @param _npcId      - The NPC this adapter serves. Used as the requester
   *                      ID in `findCover` occupancy filtering.
   */
  constructor(
    private readonly _registry: CoverRegistry,
    private readonly _lockRegistry: ICoverLockRegistry | null,
    private readonly _npcId: string,
  ) {}

  // -------------------------------------------------------------------------
  // ICoverAccess
  // -------------------------------------------------------------------------

  findCover(
    x: number,
    y: number,
    enemyX: number,
    enemyY: number,
    type?: string,
  ): { x: number; y: number } | null {
    const coverType: CoverType = (type as CoverType) ?? CoverTypeConst.BALANCED;

    const point = this._registry.findCover(
      coverType,
      { x, y },
      [{ x: enemyX, y: enemyY }],
      this._npcId,
    );

    this._lastFoundId = point?.id ?? null;

    return point !== null ? { x: point.x, y: point.y } : null;
  }

  /**
   * Acquire a TTL lock on the most recently returned cover point.
   *
   * Returns `true` (vacuous success) if:
   *  - No cover point has been found yet (`findCover` was not called or returned null).
   *  - No lock registry was provided at construction time.
   *
   * Returns `false` if the point is already locked at capacity by other NPCs.
   */
  lockLastFound(npcId: string, ttlMs?: number): boolean {
    if (this._lockRegistry === null || this._lastFoundId === null) return true;
    return this._lockRegistry.tryLock(
      this._lastFoundId,
      npcId,
      ttlMs !== undefined ? { ttlMs } : undefined,
    );
  }

  /**
   * Release all TTL locks held by the given NPC in the lock registry.
   * No-op if no lock registry was provided at construction time.
   */
  unlockAll(npcId: string): void {
    this._lockRegistry?.unlockAll(npcId);
  }
}
