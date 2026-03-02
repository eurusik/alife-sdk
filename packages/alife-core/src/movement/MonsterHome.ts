/**
 * 3-radius lair territory system for monsters.
 *
 * A MonsterHome captures the three concentric radii that define how a mutant
 * relates to its anchor point:
 *
 *   inner   -- personal space; any intruder triggers an immediate attack.
 *   patrol  -- roam zone; the monster circles within this radius when idle.
 *   outer   -- hard pursuit boundary; the monster breaks off chase beyond this.
 *
 * All distance checks use squared math for performance (no Math.sqrt in
 * the hot path). getRandomPatrolPoint() uses polar sampling for uniform
 * distribution over the patrol annulus.
 */

import type { Vec2 } from '../core/Vec2';
import { distanceSq } from '../core/Vec2';
import type { IRandom } from '../ports/IRandom';
import { DefaultRandom } from '../ports/IRandom';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ILairConfig {
  readonly anchor: Vec2;
  readonly innerRadius: number;
  readonly patrolRadius: number;
  readonly outerRadius: number;
}

// ---------------------------------------------------------------------------
// MonsterHome
// ---------------------------------------------------------------------------

export class MonsterHome {
  readonly anchor: Vec2;

  private readonly innerRadius: number;
  private readonly patrolRadius: number;
  private readonly outerRadius: number;

  private readonly innerSq: number;
  private readonly patrolSq: number;
  private readonly outerSq: number;

  private readonly random: IRandom;

  constructor(config: ILairConfig, random?: IRandom) {
    this.anchor = config.anchor;

    // Enforce minimum radius hierarchy: inner < patrol < outer.
    this.innerRadius = Math.max(1, config.innerRadius);
    this.patrolRadius = Math.max(this.innerRadius + 1, config.patrolRadius);
    this.outerRadius = Math.max(this.patrolRadius + 1, config.outerRadius);

    this.innerSq = this.innerRadius * this.innerRadius;
    this.patrolSq = this.patrolRadius * this.patrolRadius;
    this.outerSq = this.outerRadius * this.outerRadius;

    this.random = random ?? new DefaultRandom();
  }

  // -----------------------------------------------------------------------
  // Zone checks
  // -----------------------------------------------------------------------

  /** True when the point is within the inner (personal space) radius. */
  isInInnerZone(point: Vec2): boolean {
    return this.distanceFromAnchorSq(point) <= this.innerSq;
  }

  /** True when the point is within the patrol radius but outside the inner zone. */
  isInPatrolZone(point: Vec2): boolean {
    const dsq = this.distanceFromAnchorSq(point);
    return dsq > this.innerSq && dsq <= this.patrolSq;
  }

  /** True when the point is within the outer radius. */
  isInOuterZone(point: Vec2): boolean {
    return this.distanceFromAnchorSq(point) <= this.outerSq;
  }

  /** True when the point is beyond the outer radius -- out of territory. */
  isOutOfTerritory(point: Vec2): boolean {
    return this.distanceFromAnchorSq(point) > this.outerSq;
  }

  // -----------------------------------------------------------------------
  // Patrol target
  // -----------------------------------------------------------------------

  /**
   * Random point within the patrol annulus (between inner and patrol radii)
   * using polar sampling for uniform distribution.
   */
  getRandomPatrolPoint(): Vec2 {
    const angle = this.random.next() * Math.PI * 2;
    const dist = Math.sqrt(
      this.random.next() * (this.patrolSq - this.innerSq) + this.innerSq,
    );

    return {
      x: this.anchor.x + Math.cos(angle) * dist,
      y: this.anchor.y + Math.sin(angle) * dist,
    };
  }

  // -----------------------------------------------------------------------
  // Distance
  // -----------------------------------------------------------------------

  /** Squared Euclidean distance from anchor to the given point. */
  distanceFromAnchorSq(point: Vec2): number {
    return distanceSq(this.anchor, point);
  }
}
