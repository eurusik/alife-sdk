// cover/CoverEvaluators.ts
// Five tactical cover evaluators implementing the Strategy pattern.
//
// Each evaluator scores a cover point on [0, 1] for a specific tactical
// priority. They are pure functions — no side effects, no state,
// fully deterministic given the same inputs.

import { distanceSq } from '@alife-sdk/core';
import type { Vec2 } from '@alife-sdk/core';
import type { ICoverPoint, ICoverEvalContext, IEnemyPosition } from '../types/ICoverPoint';
import { CoverType } from '../types/ICoverPoint';
import type { ICoverEvaluator } from './ICoverEvaluator';
import type { ICoverConfig } from '../types/IOnlineAIConfig';

// ---------------------------------------------------------------------------
// Shared geometry helpers
// ---------------------------------------------------------------------------

function averageEnemyPosition(enemies: readonly IEnemyPosition[]): Vec2 {
  if (enemies.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const e of enemies) {
    sx += e.x;
    sy += e.y;
  }
  return { x: sx / enemies.length, y: sy / enemies.length };
}

function angleBetween(from: Vec2, to: Vec2): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

// ---------------------------------------------------------------------------
// CLOSE — nearest cover, quick retreat under fire
// ---------------------------------------------------------------------------

export class CloseCoverEvaluator implements ICoverEvaluator {
  readonly type = CoverType.CLOSE;

  private readonly maxRange: number;

  constructor(config: ICoverConfig) {
    this.maxRange = config.closeMaxRange;
  }

  evaluate(point: ICoverPoint, context: ICoverEvalContext): number {
    const dSq = distanceSq(context.npcPosition, point);
    const dist = Math.sqrt(dSq);
    const ratio = dist / this.maxRange;

    // Beyond max range: score drops linearly to 0 at 2x max range.
    if (ratio > 1.0) {
      return clamp01(1.0 - (ratio - 1.0));
    }

    // Within range: closer is better. Score 1.0 at distance 0.
    return 1.0 - ratio;
  }
}

// ---------------------------------------------------------------------------
// FAR — maximize distance from enemies, strategic retreat
// ---------------------------------------------------------------------------

export class FarCoverEvaluator implements ICoverEvaluator {
  readonly type = CoverType.FAR;

  private readonly maxRange: number;

  constructor(config: ICoverConfig) {
    this.maxRange = config.farMaxRange;
  }

  evaluate(point: ICoverPoint, context: ICoverEvalContext): number {
    if (context.enemies.length === 0) return 0.5;

    // Score based on average distance to all enemies.
    let totalDist = 0;
    for (const enemy of context.enemies) {
      totalDist += Math.sqrt(distanceSq(point, enemy));
    }
    const avgDist = totalDist / context.enemies.length;

    // Normalize: 1.0 at maxRange or beyond, 0 at distance 0.
    return clamp01(avgDist / this.maxRange);
  }
}

// ---------------------------------------------------------------------------
// BALANCED — balanced three-factor weighted score
// ---------------------------------------------------------------------------

export class BalancedCoverEvaluator implements ICoverEvaluator {
  readonly type = CoverType.BALANCED;

  evaluate(point: ICoverPoint, context: ICoverEvalContext): number {
    if (context.enemies.length === 0) return 0.5;

    const centroid = averageEnemyPosition(context.enemies);
    const coverDist = Math.sqrt(distanceSq(context.npcPosition, point));
    const enemyDist = Math.sqrt(distanceSq(point, centroid));

    // Factor 1: proximity to NPC (closer = better, max 25 points).
    const proximityScore = clamp01(1.0 - coverDist / 400) * 25;

    // Factor 2: distance from enemies (farther = safer, max 25 points).
    const safetyScore = clamp01(enemyDist / 600) * 25;

    // Factor 3: shielding quality (max 40 points).
    // If facingAngle is available, check that the obstacle (building) is
    // between the cover point and the enemy. facingAngle points from the
    // cover point toward the building center. The enemy should be roughly
    // in the same direction as the building (so the building blocks fire).
    let shieldingScore = 15; // neutral default when facingAngle is missing
    if (point.facingAngle !== undefined) {
      const coverToEnemy = angleBetween(point, centroid);
      let angleDiff = Math.abs(coverToEnemy - point.facingAngle);
      if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
      // angleDiff ≈ 0 means enemy is behind the building (ideal cover)
      // angleDiff ≈ π means enemy is on the NPC's side (no protection)
      shieldingScore = clamp01(1.0 - angleDiff / (Math.PI * 0.75)) * 40;
    }

    // Normalize to [0, 1] (max raw = 90).
    return (proximityScore + safetyScore + shieldingScore) / 90;
  }
}

// ---------------------------------------------------------------------------
// AMBUSH — flanking position, offensive posture
// ---------------------------------------------------------------------------

export class AmbushCoverEvaluator implements ICoverEvaluator {
  readonly type = CoverType.AMBUSH;

  private readonly minAngle: number;
  private readonly maxAngle: number;
  private readonly minDist: number;
  private readonly maxDist: number;

  constructor(config: ICoverConfig) {
    this.minAngle = config.ambushMinAngle;
    this.maxAngle = config.ambushMaxAngle;
    this.minDist = config.ambushMinDist;
    this.maxDist = config.ambushMaxDist;
  }

  evaluate(point: ICoverPoint, context: ICoverEvalContext): number {
    if (context.enemies.length === 0) return 0;

    const centroid = averageEnemyPosition(context.enemies);

    // Distance from cover to enemy centroid.
    const dist = Math.sqrt(distanceSq(point, centroid));
    if (dist < this.minDist || dist > this.maxDist) {
      // Outside ambush distance band — poor score.
      return clamp01(0.2 - Math.abs(dist - (this.minDist + this.maxDist) / 2) / this.maxDist);
    }

    // Flanking angle: angle between (enemy→NPC) and (enemy→cover).
    const enemyToNpc = angleBetween(centroid, context.npcPosition);
    const enemyToCover = angleBetween(centroid, point);
    let flankAngle = Math.abs(enemyToNpc - enemyToCover);
    if (flankAngle > Math.PI) flankAngle = 2 * Math.PI - flankAngle;

    // Best flanking is between minAngle and maxAngle (roughly 60°-120°).
    if (flankAngle >= this.minAngle && flankAngle <= this.maxAngle) {
      // Perfect flanking band — high score.
      if (this.maxDist === this.minDist) return 0.85;
      const distScore = 1.0 - Math.abs(dist - (this.minDist + this.maxDist) / 2) / (this.maxDist - this.minDist);
      return clamp01(0.7 + distScore * 0.3);
    }

    // Outside flanking band — reduced score based on deviation.
    let deviation: number;
    if (flankAngle < this.minAngle) {
      if (this.minAngle <= 0) return 0;
      deviation = (this.minAngle - flankAngle) / this.minAngle;
    } else {
      if (Math.PI - this.maxAngle <= 0) return 0;
      deviation = (flankAngle - this.maxAngle) / (Math.PI - this.maxAngle);
    }

    return clamp01(0.5 * (1.0 - deviation));
  }
}

// ---------------------------------------------------------------------------
// SAFE — minimize aggregate threat exposure
// ---------------------------------------------------------------------------

export class SafeCoverEvaluator implements ICoverEvaluator {
  readonly type = CoverType.SAFE;

  evaluate(point: ICoverPoint, context: ICoverEvalContext): number {
    if (context.enemies.length === 0) return 1.0;

    // Aggregate threat: sum of inverse squared distances to each enemy.
    // Lower threat = safer = higher score.
    let threatSum = 0;
    for (const enemy of context.enemies) {
      const dSq = distanceSq(point, enemy);
      // Avoid division by zero; minimum distance of 1px.
      threatSum += 1.0 / Math.max(1, dSq);
    }

    // Normalize threat to [0, 1]. Empirically, threat rarely exceeds 0.01
    // for reasonable distances (>10px per enemy).
    const normalizedThreat = clamp01(threatSum * 5000);

    return 1.0 - normalizedThreat;
  }
}

// ---------------------------------------------------------------------------
// Factory — create all evaluators from config
// ---------------------------------------------------------------------------

/**
 * Create a complete set of cover evaluators keyed by CoverType.
 *
 * @param config - Cover subsystem configuration.
 * @returns Map of CoverType → ICoverEvaluator.
 */
export function createCoverEvaluators(
  config: ICoverConfig,
): ReadonlyMap<CoverType, ICoverEvaluator> {
  const map = new Map<CoverType, ICoverEvaluator>();
  map.set(CoverType.CLOSE, new CloseCoverEvaluator(config));
  map.set(CoverType.FAR, new FarCoverEvaluator(config));
  map.set(CoverType.BALANCED, new BalancedCoverEvaluator());
  map.set(CoverType.AMBUSH, new AmbushCoverEvaluator(config));
  map.set(CoverType.SAFE, new SafeCoverEvaluator());
  return map;
}

/** @deprecated Use BalancedCoverEvaluator */
export const BestCoverEvaluator = BalancedCoverEvaluator;
