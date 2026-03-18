// types/ICoverPoint.ts
// Value objects for the tactical cover system.
// All types are pure data — no behavior, no framework coupling.

import type { Vec2 } from '@alife-sdk/core';

/**
 * A firing position within a cover point.
 *
 * Loopholes represent peek offsets from the cover center where an NPC
 * can expose themselves to fire while remaining partially protected.
 * The firing arc defines the angular range the NPC can engage from
 * this position.
 */
export interface ILoophole {
  /** X offset from cover center to peek position (px). */
  readonly offsetX: number;
  /** Y offset from cover center to peek position (px). */
  readonly offsetY: number;
  /** Start of the valid firing arc (radians, 0 = right, CCW positive). */
  readonly angleMin: number;
  /** End of the valid firing arc (radians). */
  readonly angleMax: number;
}

/**
 * A single cover position in world space.
 *
 * Cover points are registered with a {@link CoverRegistry} and queried
 * during combat to find the best tactical position. Occupancy is tracked
 * per point — only one NPC can shelter at each point at a time.
 */
export interface ICoverPoint {
  /** Unique identifier (e.g. 'cover_0042'). */
  readonly id: string;
  /** World X coordinate. */
  readonly x: number;
  /** World Y coordinate. */
  readonly y: number;
  /** Protection radius in pixels. */
  readonly radius: number;
  /**
   * Direction from cover point toward the shielding obstacle (radians).
   * Used by evaluators to check that the obstacle is between the NPC and the threat.
   * If undefined, directional scoring is skipped.
   */
  readonly facingAngle?: number;
  /** NPC ID currently sheltering here, or null if free. */
  occupiedBy: string | null;
  /** Auto-generated firing positions. Populated lazily. */
  loopholes: readonly ILoophole[];
}

/**
 * Minimal enemy position for cover evaluation.
 * Avoids entity references so evaluators remain pure functions.
 */
export type IEnemyPosition = Vec2;

/**
 * Context passed to cover evaluators for scoring decisions.
 * Aggregates all tactical data an evaluator needs.
 */
export interface ICoverEvalContext {
  /** Position of the NPC seeking cover. */
  readonly npcPosition: Vec2;
  /** Known enemy positions. */
  readonly enemies: readonly IEnemyPosition[];
  /** Search radius limit (squared for perf). */
  readonly maxRadiusSq: number;
}

/**
 * Evaluator categories — each optimizes for a different tactical priority.
 */
export const CoverType = {
  /** Nearest cover — quick retreat, prioritizes proximity. */
  CLOSE: 'close',
  /** Far cover — strategic retreat, maximizes distance from enemies. */
  FAR: 'far',
  /** Balanced scoring — distance + safety + angle (default). */
  BALANCED: 'balanced',
  /** @deprecated Use BALANCED */
  BEST: 'balanced',
  /** Flanking position — good angle on enemy, offensive. */
  AMBUSH: 'ambush',
  /** Maximum safety — minimum aggregate threat exposure. */
  SAFE: 'safe',
} as const;

export type CoverType = (typeof CoverType)[keyof typeof CoverType];
