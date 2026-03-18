// navigation/SmoothPathFollower.ts
// Per-NPC smooth path cursor with curvature-based velocity profiles.
// Stateful but framework-agnostic — no rendering, no physics.

import type { Vec2 } from '@alife-sdk/core';
import type { INavigationConfig } from '../types/IOnlineAIConfig';

const CURVATURE_HIGH_THRESHOLD = 0.04;
const CURVATURE_MEDIUM_THRESHOLD = 0.015;

/**
 * Tracks an NPC's progress along a smooth dense path.
 *
 * The follower advances a cursor through the point array and
 * provides a curvature-derived velocity multiplier with smooth
 * easing between speed bands.
 *
 * @example
 * ```ts
 * const follower = new SmoothPathFollower(densePoints, config);
 *
 * // Each frame:
 * follower.updatePosition(npc.x, npc.y);
 * const target = follower.getCurrentTarget();
 * const speed = baseSpeed * follower.getCurrentVelocityMultiplier();
 * ```
 */
export class SmoothPathFollower {
  private readonly points: readonly Vec2[];
  private readonly velocityMultipliers: readonly number[];
  private readonly thresholdSq: number;
  private readonly transitionRate: number;
  private currentIndex = 0;
  private currentVelocityMultiplier: number;

  constructor(points: readonly Vec2[], config: INavigationConfig) {
    this.points = points;
    this.thresholdSq = config.arrivalThreshold * config.arrivalThreshold;
    this.transitionRate = config.velocityTransitionRate;
    this.velocityMultipliers = this.calculateVelocityProfile(config);
    this.currentVelocityMultiplier = config.velocityCurveFast;
  }

  /**
   * Advance the cursor if the NPC is close enough to the current target.
   * Also steps the velocity multiplier lerp exactly once per frame.
   * @returns `true` if the cursor advanced, `false` if not yet arrived.
   */
  updatePosition(x: number, y: number): boolean {
    const targetMultiplier = this.isComplete()
      ? 1.0
      : (this.velocityMultipliers[this.currentIndex] ?? 1.0);
    this.currentVelocityMultiplier +=
      (targetMultiplier - this.currentVelocityMultiplier) * this.transitionRate;

    if (this.isComplete()) return false;

    const target = this.points[this.currentIndex];
    const dx = target.x - x;
    const dy = target.y - y;
    const distSq = dx * dx + dy * dy;

    if (distSq <= this.thresholdSq) {
      this.currentIndex++;
      return true;
    }

    return false;
  }

  /** Current waypoint the NPC should move toward, or null if path is done. */
  getCurrentTarget(): Vec2 | null {
    return this.isComplete() ? null : this.points[this.currentIndex];
  }

  /** Whether the NPC has reached the end of the path. */
  isComplete(): boolean {
    return this.currentIndex >= this.points.length;
  }

  /**
   * Smoothed velocity multiplier for the current path segment.
   * Value in approximately [velocitySlow, velocityFast] — transitions
   * gradually between speed bands.
   *
   * Pure read — the lerp step is advanced once per frame by updatePosition().
   */
  getCurrentVelocityMultiplier(): number {
    return this.currentVelocityMultiplier;
  }

  /** Reset cursor to the start (for looping patrols). */
  reset(): void {
    this.currentIndex = 0;
    this.currentVelocityMultiplier =
      this.velocityMultipliers.length > 0
        ? this.velocityMultipliers[0]
        : 1.0;
  }

  /** Normalized progress [0, 1]. */
  getProgress(): number {
    if (this.points.length === 0) return 1;
    return Math.min(1, this.currentIndex / this.points.length);
  }

  /** Number of dense points in the smooth path. */
  getPointCount(): number {
    return this.points.length;
  }

  /**
   * Pre-compute a velocity multiplier for each point based on local curvature.
   * Sharp turns get slow multipliers, straight segments get fast.
   */
  private calculateVelocityProfile(config: INavigationConfig): readonly number[] {
    const pts = this.points;
    if (pts.length < 3) {
      return pts.map(() => config.velocityCurveFast);
    }

    const profile: number[] = new Array(pts.length);

    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const c = pts[i + 1];

      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const bcx = c.x - b.x;
      const bcy = c.y - b.y;

      const abLen = Math.sqrt(abx * abx + aby * aby);
      const bcLen = Math.sqrt(bcx * bcx + bcy * bcy);

      if (abLen < 1e-6 || bcLen < 1e-6) {
        profile[i] = config.velocityCurveFast;
        continue;
      }

      const dot = (abx * bcx + aby * bcy) / (abLen * bcLen);
      const theta = Math.acos(Math.max(-1, Math.min(1, dot)));
      const arcLen = (abLen + bcLen) / 2;
      const kappa = arcLen > 1e-6 ? theta / arcLen : 0;

      if (kappa > CURVATURE_HIGH_THRESHOLD) {
        profile[i] = config.velocityCurveSlow;
      } else if (kappa > CURVATURE_MEDIUM_THRESHOLD) {
        profile[i] = config.velocityCurveMedium;
      } else {
        profile[i] = config.velocityCurveFast;
      }
    }

    // Endpoints inherit nearest interior value.
    profile[0] = profile[1] ?? config.velocityCurveFast;
    profile[pts.length - 1] = profile[pts.length - 2] ?? config.velocityCurveFast;

    return profile;
  }
}
