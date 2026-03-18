// cover/CoverRegistry.ts
// Instance-based cover point registry with occupancy tracking.
// Replaces the singleton CoverSystem from the game layer.

import { distanceSq } from '@alife-sdk/core';
import type { Vec2, IRandom } from '@alife-sdk/core';
import type { ICoverPoint, ICoverEvalContext, ILoophole } from '../types/ICoverPoint';
import { CoverType } from '../types/ICoverPoint';
import type { ICoverConfig } from '../types/IOnlineAIConfig';
import type { ICoverEvaluator } from './ICoverEvaluator';
import { createCoverEvaluators } from './CoverEvaluators';
import { recommendCoverType, type ICoverSituation } from './CoverRecommender';
import { LoopholeGenerator, findBestLoophole } from './LoopholeGenerator';
import type { ICoverLockRegistry } from './ICoverLockConfig';

/**
 * Manages a collection of cover points in world space.
 *
 * Responsibilities:
 *   - Point registration and removal.
 *   - Occupancy tracking (one NPC per point).
 *   - Cover search using pluggable evaluator strategies.
 *   - Loophole generation and best-loophole queries.
 *
 * This is an instance-based class (not a singleton). Create one per
 * simulation or per scene. Inject via the AI plugin system.
 *
 * @example
 * ```ts
 * const registry = new CoverRegistry(config.cover, random);
 * registry.addPoints([{ x: 100, y: 200 }, { x: 300, y: 400 }]);
 *
 * const cover = registry.findCover(CoverType.BALANCED, npcPos, enemies, npcId);
 * if (cover) registry.occupy(cover.id, npcId);
 * ```
 */
export class CoverRegistry {
  private readonly points = new Map<string, ICoverPoint>();
  private readonly evaluators: ReadonlyMap<CoverType, ICoverEvaluator>;
  private readonly loopholeGen: LoopholeGenerator;
  private readonly config: ICoverConfig;
  private readonly lockRegistry: ICoverLockRegistry | null;
  private idCounter = 0;
  private _allPointsCache: ICoverPoint[] = [];
  private _allPointsDirty = true;

  /**
   * @param config       - Cover evaluator configuration.
   * @param random       - Deterministic random source.
   * @param lockRegistry - Optional TTL-based lock registry.
   *                       When provided, `findCover` filters out points locked
   *                       by other NPCs instead of relying on the mutable
   *                       `occupiedBy` field. The legacy `occupy`/`release`
   *                       methods remain operational for backward compatibility.
   */
  constructor(config: ICoverConfig, random: IRandom, lockRegistry?: ICoverLockRegistry) {
    this.config = config;
    this.evaluators = createCoverEvaluators(config);
    this.loopholeGen = new LoopholeGenerator(config, random);
    this.lockRegistry = lockRegistry ?? null;
  }

  // -----------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------

  /**
   * Add a single cover point. Returns the created point with a generated ID.
   */
  addPoint(x: number, y: number, radius?: number, facingAngle?: number): ICoverPoint {
    const id = `cover_${String(this.idCounter++).padStart(4, '0')}`;
    const point: ICoverPoint = {
      id,
      x,
      y,
      radius: radius ?? this.config.pointRadius,
      facingAngle,
      occupiedBy: null,
      loopholes: [],
    };
    this.points.set(id, point);
    this._allPointsDirty = true;
    return point;
  }

  /**
   * Bulk-register cover points from coordinate data.
   */
  addPoints(data: readonly { x: number; y: number; radius?: number; facingAngle?: number }[]): void {
    for (const p of data) {
      this.addPoint(p.x, p.y, p.radius, p.facingAngle);
    }
  }

  /**
   * Remove a cover point by ID. Releases any occupancy.
   */
  removePoint(pointId: string): boolean {
    const result = this.points.delete(pointId);
    if (result) this._allPointsDirty = true;
    return result;
  }

  /** Total number of registered cover points. */
  getSize(): number {
    return this.points.size;
  }

  /** Iterate all points (read-only). */
  getAll(): readonly ICoverPoint[] {
    if (this._allPointsDirty) {
      this._allPointsCache.length = 0;
      for (const p of this.points.values()) this._allPointsCache.push(p);
      this._allPointsDirty = false;
    }
    return this._allPointsCache;
  }

  // -----------------------------------------------------------------
  // Cover Search
  // -----------------------------------------------------------------

  /**
   * Find the best available cover point using the specified evaluator.
   *
   * Filters: unoccupied (or occupied by same NPC), within search radius,
   * score above minimum threshold. Returns null if nothing qualifies.
   */
  findCover(
    type: CoverType,
    npcPosition: Vec2,
    enemies: readonly Vec2[],
    npcId: string,
    maxRadius?: number,
  ): ICoverPoint | null {
    const evaluator = this.evaluators.get(type);
    if (!evaluator) return null;

    const radius = maxRadius ?? this.config.searchRadius;
    const maxRadiusSq = radius * radius;

    const context: ICoverEvalContext = {
      npcPosition,
      enemies,
      maxRadiusSq,
    };

    let bestPoint: ICoverPoint | null = null;
    let bestScore = this.config.minScoreThreshold;

    for (const point of this.points.values()) {
      // Skip locked / occupied points.
      if (this.lockRegistry !== null) {
        if (!this.lockRegistry.isAvailable(point.id, npcId)) continue;
      } else if (point.occupiedBy !== null && point.occupiedBy !== npcId) {
        continue;
      }

      // Squared distance pre-filter.
      const dSq = distanceSq(npcPosition, point);
      if (dSq > maxRadiusSq) continue;

      const score = evaluator.evaluate(point, context);
      if (score > bestScore) {
        bestScore = score;
        bestPoint = point;
      }
    }

    return bestPoint;
  }

  /**
   * Recommend cover type then find cover in one call.
   * Convenience method that combines CoverRecommender + findCover.
   */
  findRecommendedCover(
    situation: ICoverSituation,
    npcPosition: Vec2,
    enemies: readonly Vec2[],
    npcId: string,
  ): ICoverPoint | null {
    const type = recommendCoverType(situation, this.config);
    return this.findCover(type, npcPosition, enemies, npcId);
  }

  // -----------------------------------------------------------------
  // Spatial Query
  // -----------------------------------------------------------------

  /**
   * Check whether a position falls inside any cover point's protection radius.
   * Returns the closest matching point, or null.
   */
  isInCover(position: Vec2): ICoverPoint | null {
    const thresholdSq = this.config.occupyDistance * this.config.occupyDistance;
    let closest: ICoverPoint | null = null;
    let closestDSq = Infinity;

    for (const point of this.points.values()) {
      const dSq = distanceSq(position, point);
      const effectiveSq = Math.max(thresholdSq, point.radius * point.radius);
      if (dSq <= effectiveSq && dSq < closestDSq) {
        closestDSq = dSq;
        closest = point;
      }
    }

    return closest;
  }

  // -----------------------------------------------------------------
  // Occupancy
  // -----------------------------------------------------------------

  /** Mark a cover point as occupied. */
  occupy(pointId: string, npcId: string): void {
    const point = this.points.get(pointId);
    if (point) point.occupiedBy = npcId;
  }

  /** Release a cover point. If npcId given, only release if that NPC holds it. */
  release(pointId: string, npcId?: string): void {
    const point = this.points.get(pointId);
    if (!point) return;
    if (npcId === undefined || point.occupiedBy === npcId) {
      point.occupiedBy = null;
    }
  }

  /** Release all points held by a specific NPC (e.g. on death). */
  releaseAll(npcId: string): void {
    for (const point of this.points.values()) {
      if (point.occupiedBy === npcId) {
        point.occupiedBy = null;
      }
    }
  }

  // -----------------------------------------------------------------
  // Loopholes
  // -----------------------------------------------------------------

  /** Get loopholes for a cover point (generated lazily). */
  getLoopholes(cover: ICoverPoint): readonly ILoophole[] {
    return this.loopholeGen.getLoopholes(cover);
  }

  /** Find the best loophole for engaging an enemy from this cover. */
  findBestLoophole(cover: ICoverPoint, enemyX: number, enemyY: number): ILoophole | null {
    const loopholes = this.getLoopholes(cover);
    return findBestLoophole(loopholes, cover.x, cover.y, enemyX, enemyY);
  }

  // -----------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------

  /** Clear all points, caches, and cover locks. Call on scene teardown. */
  clear(): void {
    this.points.clear();
    this.idCounter = 0;
    this._allPointsCache.length = 0;
    this._allPointsDirty = true;
    this.loopholeGen.clearCache();
    this.lockRegistry?.clear();
  }
}
