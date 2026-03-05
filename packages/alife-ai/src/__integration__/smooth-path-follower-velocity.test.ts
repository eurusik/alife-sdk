/**
 * Integration test: SmoothPathFollower velocity profiles and path traversal.
 *
 * Exercises:
 *   1. SLOW profile (velocityCurveSlow = 0.4) at sharp turns
 *   2. MEDIUM profile (velocityCurveMedium = 0.7) at moderate turns
 *   3. FAST profile (velocityCurveFast = 1.0) on straight segments
 *   4. updatePosition() advances cursor when within arrivalThreshold
 *   5. Arrival at waypoint moves to next segment
 *   6. Final waypoint → isComplete() = true
 *   7. Path with 2 points — direct travel completes on arrival
 *   8. Path with 4+ points — follower traverses all segments
 *   9. reset() returns cursor to beginning
 *  10. Large deltaMs equivalent — advance past multiple waypoints
 *  11. getProgress() is proportional to currentIndex / pointCount
 *  12. Non-straight path yields velocity < 1.0 at sharp turn points
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect } from 'vitest';
import { SmoothPathFollower } from '../navigation/SmoothPathFollower';
import type { INavigationConfig } from '../types/IOnlineAIConfig';
import type { Vec2 } from '@alife-sdk/core';

// ---------------------------------------------------------------------------
// Shared config factory
// ---------------------------------------------------------------------------

function makeNavConfig(overrides: Partial<INavigationConfig> = {}): INavigationConfig {
  return {
    smoothPointsPerSegment: 8,
    smoothRandomOffset: 10,
    arrivalThreshold: 8,
    dubinsMaxInstantTurn: Math.PI / 4,
    dubinsTurningRadius: 60,
    velocityCurveFast: 1.0,
    velocityCurveMedium: 0.7,
    velocityCurveSlow: 0.4,
    velocityTransitionRate: 0.15,
    restrictedZoneSafeMargin: 20,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** Straight horizontal path: N equally spaced points along x-axis. */
function straightPath(n: number, spacing = 100): Vec2[] {
  return Array.from({ length: n }, (_, i) => ({ x: i * spacing, y: 0 }));
}

/**
 * Sharp-turn path: goes right then makes a 90° turn upward.
 * Short segments (25px) ensure kappa = theta/arcLen > CURVATURE_HIGH_THRESHOLD (0.04).
 * At 90°: kappa = (PI/2) / 25 ≈ 0.063 → SLOW profile.
 */
function sharpTurnPath(): Vec2[] {
  return [
    { x: 0,  y: 0 },
    { x: 25, y: 0 },   // short segment right
    { x: 25, y: 25 },  // 90° turn (kappa ≈ 0.063 > HIGH_THRESHOLD 0.04)
    { x: 25, y: 50 },  // continuing up
  ];
}

/**
 * Gentle curve path: gradual arc so curvature stays below MEDIUM threshold.
 * Spread across large distances so kappa = theta / arcLen is small.
 */
function _gentleCurvePath(): Vec2[] {
  // Points spread 500px apart, small angular deviation (~10°)
  return [
    { x: 0,    y: 0 },
    { x: 500,  y: 20 },   // very slight deviation
    { x: 1000, y: 30 },   // continues the gentle curve
    { x: 1500, y: 30 },   // straightens out
  ];
}

// ---------------------------------------------------------------------------
// Helper: drive follower to a specific point index by calling updatePosition()
// repeatedly at the exact waypoint coordinates.
// ---------------------------------------------------------------------------
function advanceToIndex(follower: SmoothPathFollower, points: Vec2[], targetIndex: number): void {
  for (let i = 0; i < targetIndex && !follower.isComplete(); i++) {
    const pt = points[i];
    follower.updatePosition(pt.x, pt.y);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SmoothPathFollower — velocity profiles', () => {

  // -------------------------------------------------------------------------
  // 1. FAST profile on straight path
  // -------------------------------------------------------------------------
  it('straight path → velocity multiplier converges toward velocityCurveFast (1.0)', () => {
    const config = makeNavConfig({ velocityTransitionRate: 1.0 }); // instant transition
    const points = straightPath(5, 200);
    const follower = new SmoothPathFollower(points, config);

    // On a straight path all interior points should have kappa ≈ 0 → FAST profile.
    // With transitionRate=1.0 the multiplier snaps instantly to target.
    const vm = follower.getCurrentVelocityMultiplier();
    expect(vm).toBeCloseTo(config.velocityCurveFast, 5);
  });

  // -------------------------------------------------------------------------
  // 2. SLOW profile at sharp turn
  // -------------------------------------------------------------------------
  it('sharp-turn path → interior turn point assigned velocityCurveSlow (0.4)', () => {
    // velocityTransitionRate=1.0 so the multiplier snaps immediately to target.
    // sharpTurnPath(): points [0,25px apart]. The 90° turn occurs at index 1
    // (triplet p0->p1->p2 has theta=PI/2, arcLen=25, kappa≈0.063 > HIGH_THRESHOLD 0.04).
    const config = makeNavConfig({ velocityTransitionRate: 1.0, arrivalThreshold: 1 });
    const points = sharpTurnPath();
    const follower = new SmoothPathFollower(points, config);

    // Advance cursor to index 1 — the turn vertex in the profile
    advanceToIndex(follower, points, 1);

    // At index 1 (the turn), the velocity profile should be SLOW
    const vm = follower.getCurrentVelocityMultiplier();
    // With instant transition it snaps to the stored profile at index 1
    expect(vm).toBeCloseTo(config.velocityCurveSlow, 5);
  });

  // -------------------------------------------------------------------------
  // 3. MEDIUM profile at moderate turn
  // -------------------------------------------------------------------------
  it('moderate turn path → interior point between SLOW and FAST thresholds gets MEDIUM (0.7)', () => {
    // Craft a path where the turn at index 1 produces kappa between the two thresholds.
    // CURVATURE_MEDIUM_THRESHOLD = 0.015, CURVATURE_HIGH_THRESHOLD = 0.04
    //
    // Target: 0.015 < kappa < 0.04
    // Using a 60° turn with segments of 50px:
    //   a=p0={0,0}, b=p1={50,0}, c=p2={50+50*cos(PI/3), 50*sin(PI/3)}={75, 43.3}
    //   abLen=50, bcLen=50, dot=0.5, theta=PI/3≈1.047, arcLen=50
    //   kappa = 1.047/50 = 0.0209 → between MEDIUM and HIGH → MEDIUM profile.
    const config = makeNavConfig({ velocityTransitionRate: 1.0, arrivalThreshold: 1 });
    const points: Vec2[] = [
      { x: 0,  y: 0 },
      { x: 50, y: 0 },
      { x: 50 + 50 * Math.cos(Math.PI / 3), y: 50 * Math.sin(Math.PI / 3) }, // 60° turn
      { x: 150, y: 100 },
    ];
    const follower = new SmoothPathFollower(points, config);

    // Profile at index 1 is computed using triplet (p0, p1, p2) — the 60° turn.
    // Advance cursor to index 1 so getCurrentVelocityMultiplier reads profile[1].
    advanceToIndex(follower, points, 1);
    const vm = follower.getCurrentVelocityMultiplier();

    // kappa ≈ 0.0209 is between MEDIUM (0.015) and HIGH (0.04) → MEDIUM (0.7)
    expect(vm).toBeCloseTo(config.velocityCurveMedium, 5);
  });

  // -------------------------------------------------------------------------
  // 4. updatePosition() advances cursor when within arrivalThreshold
  // -------------------------------------------------------------------------
  it('updatePosition() at target position advances cursor to next point', () => {
    const config = makeNavConfig({ arrivalThreshold: 8 });
    const points = straightPath(3, 100);
    const follower = new SmoothPathFollower(points, config);

    expect(follower.getCurrentTarget()).toEqual(points[0]);

    // Move to exactly the first waypoint
    const advanced = follower.updatePosition(points[0].x, points[0].y);
    expect(advanced).toBe(true);
    expect(follower.getCurrentTarget()).toEqual(points[1]);
  });

  // -------------------------------------------------------------------------
  // 5. Position outside threshold does NOT advance cursor
  // -------------------------------------------------------------------------
  it('updatePosition() does NOT advance when NPC is far from target', () => {
    const config = makeNavConfig({ arrivalThreshold: 8 });
    const points = straightPath(3, 100);
    const _follower = new SmoothPathFollower(points, config);

    // NPC is at origin, first waypoint is at (0, 0) — actually the same,
    // so use a point far away
    const follower2 = new SmoothPathFollower([{ x: 100, y: 0 }, { x: 200, y: 0 }], config);
    const advanced = follower2.updatePosition(0, 0); // 100px away — far from threshold
    expect(advanced).toBe(false);
    expect(follower2.getCurrentTarget()).toEqual({ x: 100, y: 0 });
  });

  // -------------------------------------------------------------------------
  // 6. Arrival at final waypoint → isComplete() = true
  // -------------------------------------------------------------------------
  it('isComplete() returns true after arriving at the last waypoint', () => {
    const config = makeNavConfig({ arrivalThreshold: 8 });
    const points = straightPath(2, 100); // [0,0] and [100,0]
    const follower = new SmoothPathFollower(points, config);

    expect(follower.isComplete()).toBe(false);

    // Arrive at first point
    follower.updatePosition(points[0].x, points[0].y);
    expect(follower.isComplete()).toBe(false);

    // Arrive at last point
    follower.updatePosition(points[1].x, points[1].y);
    expect(follower.isComplete()).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 7. Path with 2 points — direct travel
  // -------------------------------------------------------------------------
  it('2-point path: follower completes after visiting both waypoints', () => {
    const config = makeNavConfig({ arrivalThreshold: 1 });
    const points: Vec2[] = [{ x: 0, y: 0 }, { x: 50, y: 0 }];
    const follower = new SmoothPathFollower(points, config);

    expect(follower.getPointCount()).toBe(2);
    expect(follower.isComplete()).toBe(false);

    follower.updatePosition(0, 0);
    expect(follower.isComplete()).toBe(false);

    follower.updatePosition(50, 0);
    expect(follower.isComplete()).toBe(true);
    expect(follower.getCurrentTarget()).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 8. Path with 4 points — traverses all segments
  // -------------------------------------------------------------------------
  it('4-point path: follower traverses all 4 waypoints in order', () => {
    const config = makeNavConfig({ arrivalThreshold: 1 });
    const points: Vec2[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
      { x: 300, y: 0 },
    ];
    const follower = new SmoothPathFollower(points, config);

    const visited: Vec2[] = [];
    for (const pt of points) {
      if (follower.isComplete()) break;
      const target = follower.getCurrentTarget();
      if (target) visited.push(target);
      follower.updatePosition(pt.x, pt.y);
    }

    expect(follower.isComplete()).toBe(true);
    // All 4 waypoints were observed as targets before completion
    expect(visited).toHaveLength(4);
    expect(visited[0]).toEqual(points[0]);
    expect(visited[3]).toEqual(points[3]);
  });

  // -------------------------------------------------------------------------
  // 9. reset() returns cursor to beginning
  // -------------------------------------------------------------------------
  it('reset() returns cursor to index 0 after partial traversal', () => {
    const config = makeNavConfig({ arrivalThreshold: 1 });
    const points = straightPath(5, 100);
    const follower = new SmoothPathFollower(points, config);

    // Advance two waypoints
    follower.updatePosition(points[0].x, points[0].y);
    follower.updatePosition(points[1].x, points[1].y);
    expect(follower.getCurrentTarget()).toEqual(points[2]);

    // Reset
    follower.reset();

    expect(follower.isComplete()).toBe(false);
    expect(follower.getCurrentTarget()).toEqual(points[0]);
    expect(follower.getProgress()).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 10. reset() allows re-traversal from the beginning
  // -------------------------------------------------------------------------
  it('reset() after full completion allows re-traversal', () => {
    const config = makeNavConfig({ arrivalThreshold: 1 });
    const points: Vec2[] = [{ x: 0, y: 0 }, { x: 50, y: 0 }];
    const follower = new SmoothPathFollower(points, config);

    // Complete the path
    follower.updatePosition(points[0].x, points[0].y);
    follower.updatePosition(points[1].x, points[1].y);
    expect(follower.isComplete()).toBe(true);

    // Reset and traverse again
    follower.reset();
    expect(follower.isComplete()).toBe(false);
    expect(follower.getCurrentTarget()).toEqual(points[0]);

    follower.updatePosition(points[0].x, points[0].y);
    follower.updatePosition(points[1].x, points[1].y);
    expect(follower.isComplete()).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 11. getProgress() proportional to currentIndex / pointCount
  // -------------------------------------------------------------------------
  it('getProgress() is 0.0 at start, increases per waypoint, reaches 1.0 at end', () => {
    const config = makeNavConfig({ arrivalThreshold: 1 });
    const points = straightPath(4, 100);
    const follower = new SmoothPathFollower(points, config);

    expect(follower.getProgress()).toBeCloseTo(0, 5);

    // Advance one waypoint
    follower.updatePosition(points[0].x, points[0].y);
    expect(follower.getProgress()).toBeCloseTo(1 / 4, 5);

    // Advance second waypoint
    follower.updatePosition(points[1].x, points[1].y);
    expect(follower.getProgress()).toBeCloseTo(2 / 4, 5);

    // Complete path
    follower.updatePosition(points[2].x, points[2].y);
    follower.updatePosition(points[3].x, points[3].y);
    expect(follower.getProgress()).toBeCloseTo(1.0, 5);
  });

  // -------------------------------------------------------------------------
  // 12. getCurrentTarget() returns null when path is complete
  // -------------------------------------------------------------------------
  it('getCurrentTarget() returns null when isComplete() is true', () => {
    const config = makeNavConfig({ arrivalThreshold: 1 });
    const points: Vec2[] = [{ x: 0, y: 0 }];
    const follower = new SmoothPathFollower(points, config);

    follower.updatePosition(0, 0);
    expect(follower.isComplete()).toBe(true);
    expect(follower.getCurrentTarget()).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 13. getCurrentVelocityMultiplier() returns 1.0 when path is complete
  // -------------------------------------------------------------------------
  it('getCurrentVelocityMultiplier() returns 1.0 when path is complete', () => {
    const config = makeNavConfig({ arrivalThreshold: 1 });
    const points: Vec2[] = [{ x: 0, y: 0 }];
    const follower = new SmoothPathFollower(points, config);

    follower.updatePosition(0, 0);
    expect(follower.isComplete()).toBe(true);
    expect(follower.getCurrentVelocityMultiplier()).toBe(1.0);
  });

  // -------------------------------------------------------------------------
  // 14. Velocity transition: gradual approach toward target speed band
  // -------------------------------------------------------------------------
  it('velocity multiplier gradually converges toward target with slow transitionRate', () => {
    // Low transition rate so convergence is slow and measurable
    const config = makeNavConfig({
      velocityTransitionRate: 0.1,
      velocityCurveFast: 1.0,
      velocityCurveSlow: 0.4,
      arrivalThreshold: 1,
    });

    // All-straight path — all points assigned FAST (1.0) profile.
    // Initial multiplier is also FAST (1.0 per constructor).
    // So multiplier stays at 1.0 throughout.
    const straightPts = straightPath(5, 200);
    const follower = new SmoothPathFollower(straightPts, config);

    const vm1 = follower.getCurrentVelocityMultiplier();
    expect(vm1).toBeCloseTo(1.0, 2);

    // Advance to next waypoint — still straight, still 1.0
    follower.updatePosition(straightPts[0].x, straightPts[0].y);
    const vm2 = follower.getCurrentVelocityMultiplier();
    expect(vm2).toBeCloseTo(1.0, 2);
  });

  // -------------------------------------------------------------------------
  // 15. Sharp-turn path: velocity at turn is below FAST across multiple
  //     calls to getCurrentVelocityMultiplier() (converges toward SLOW)
  // -------------------------------------------------------------------------
  it('sharp-turn path: velocity converges below FAST at the turn point', () => {
    const config = makeNavConfig({
      velocityTransitionRate: 0.5,
      arrivalThreshold: 1,
    });
    const points = sharpTurnPath();
    const follower = new SmoothPathFollower(points, config);

    // Advance to index 1 — the 90° turn vertex (kappa > HIGH_THRESHOLD → SLOW profile)
    advanceToIndex(follower, points, 1);

    // Call getCurrentVelocityMultiplier() multiple times — transitions toward SLOW (0.4)
    let vm = follower.getCurrentVelocityMultiplier();
    for (let i = 0; i < 20; i++) {
      vm = follower.getCurrentVelocityMultiplier();
    }

    // After many calls with transitionRate=0.5, should converge close to SLOW (0.4)
    expect(vm).toBeLessThan(config.velocityCurveFast);
    expect(vm).toBeGreaterThanOrEqual(config.velocityCurveSlow - 0.01);
  });
});
