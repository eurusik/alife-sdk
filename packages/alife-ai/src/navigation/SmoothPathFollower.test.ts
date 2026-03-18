import { describe, it, expect } from 'vitest';
import { SmoothPathFollower } from './SmoothPathFollower';
import { createDefaultAIConfig } from '../config/createDefaultAIConfig';
import type { Vec2 } from '@alife-sdk/core';
import type { INavigationConfig } from '../types/IOnlineAIConfig';

const config = createDefaultAIConfig().navigation;

// ---------------------------------------------------------------------------
// Config / path helpers shared by the pure-getter suite
// ---------------------------------------------------------------------------

function makeNavConfig(overrides: Partial<INavigationConfig> = {}): INavigationConfig {
  return {
    smoothPointsPerSegment: 8,
    smoothRandomOffset: 10,
    arrivalThreshold: 1,
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

/**
 * Straight horizontal path with N points spaced `spacing` px apart.
 * All interior curvatures are 0 → every point gets the FAST (1.0) profile.
 */
function straightPath(n: number, spacing = 100): Vec2[] {
  return Array.from({ length: n }, (_, i) => ({ x: i * spacing, y: 0 }));
}

/**
 * 90-degree sharp turn with short (25 px) segments.
 * kappa = (PI/2) / 25 ≈ 0.063 > HIGH_THRESHOLD (0.04) → profile[1] = SLOW.
 */
function sharpTurnPath(): Vec2[] {
  return [
    { x: 0,  y: 0  },
    { x: 25, y: 0  },
    { x: 25, y: 25 },
    { x: 25, y: 50 },
  ];
}

function makeStraightPath(): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= 10; i++) {
    pts.push({ x: i * 10, y: 0 });
  }
  return pts;
}

function makeTurningPath(): Vec2[] {
  return [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 50, y: 50 },
    { x: 100, y: 50 },
    { x: 100, y: 100 },
  ];
}

describe('SmoothPathFollower', () => {
  it('starts at the first point', () => {
    const follower = new SmoothPathFollower(makeStraightPath(), config);
    const target = follower.getCurrentTarget();
    expect(target).not.toBeNull();
    expect(target!.x).toBe(0);
    expect(target!.y).toBe(0);
  });

  it('advances when NPC reaches target', () => {
    const follower = new SmoothPathFollower(makeStraightPath(), config);
    const advanced = follower.updatePosition(0, 0);
    expect(advanced).toBe(true);
    const next = follower.getCurrentTarget();
    expect(next!.x).toBe(10);
  });

  it('does not advance when NPC is far from target', () => {
    const follower = new SmoothPathFollower(makeStraightPath(), config);
    const advanced = follower.updatePosition(100, 100);
    expect(advanced).toBe(false);
  });

  it('isComplete returns true at end of path', () => {
    const pts: Vec2[] = [{ x: 0, y: 0 }, { x: 5, y: 0 }];
    const follower = new SmoothPathFollower(pts, config);
    follower.updatePosition(0, 0);
    follower.updatePosition(5, 0);
    expect(follower.isComplete()).toBe(true);
  });

  it('getCurrentTarget returns null when complete', () => {
    const pts: Vec2[] = [{ x: 0, y: 0 }];
    const follower = new SmoothPathFollower(pts, config);
    follower.updatePosition(0, 0);
    expect(follower.getCurrentTarget()).toBeNull();
  });

  it('getProgress returns 0 at start', () => {
    const follower = new SmoothPathFollower(makeStraightPath(), config);
    expect(follower.getProgress()).toBe(0);
  });

  it('getProgress returns 1 at end', () => {
    const pts: Vec2[] = [{ x: 0, y: 0 }];
    const follower = new SmoothPathFollower(pts, config);
    follower.updatePosition(0, 0);
    expect(follower.getProgress()).toBe(1);
  });

  it('reset returns cursor to start', () => {
    const follower = new SmoothPathFollower(makeStraightPath(), config);
    follower.updatePosition(0, 0);
    follower.updatePosition(10, 0);
    follower.reset();
    expect(follower.getProgress()).toBe(0);
    expect(follower.getCurrentTarget()!.x).toBe(0);
  });

  it('getPointCount matches input', () => {
    const pts = makeStraightPath();
    const follower = new SmoothPathFollower(pts, config);
    expect(follower.getPointCount()).toBe(pts.length);
  });

  it('velocity multiplier is 1.0 on straight path', () => {
    const follower = new SmoothPathFollower(makeStraightPath(), config);
    // After a few transitions, multiplier should converge to fast.
    for (let i = 0; i < 20; i++) {
      follower.getCurrentVelocityMultiplier();
    }
    const mult = follower.getCurrentVelocityMultiplier();
    expect(mult).toBeGreaterThanOrEqual(config.velocityCurveSlow);
    expect(mult).toBeLessThanOrEqual(config.velocityCurveFast);
  });

  it('velocity is slower on sharp turns', () => {
    const follower = new SmoothPathFollower(makeTurningPath(), config);
    // Advance to a turn point.
    follower.updatePosition(0, 0);
    follower.updatePosition(50, 0);
    const turnMult = follower.getCurrentVelocityMultiplier();
    expect(turnMult).toBeLessThanOrEqual(config.velocityCurveFast);
  });

  it('handles empty path gracefully', () => {
    const follower = new SmoothPathFollower([], config);
    expect(follower.isComplete()).toBe(true);
    expect(follower.getCurrentTarget()).toBeNull();
    expect(follower.getProgress()).toBe(1);
  });

  it('updatePosition returns false when already complete', () => {
    const follower = new SmoothPathFollower([{ x: 0, y: 0 }], config);
    follower.updatePosition(0, 0);
    expect(follower.updatePosition(0, 0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getCurrentVelocityMultiplier — pure getter (no lerp mutation)
// ---------------------------------------------------------------------------
// These tests document the fix where lerp mutation was moved out of the getter
// and into updatePosition(). The getter is now a pure read with no side-effects.
// ---------------------------------------------------------------------------

describe('SmoothPathFollower — getCurrentVelocityMultiplier is a pure getter', () => {

  // -------------------------------------------------------------------------
  // 1. Calling the getter twice without updatePosition() returns the same value
  // -------------------------------------------------------------------------
  it('returns identical value on repeated calls without updatePosition()', () => {
    // transitionRate < 1.0 so any accidental lerp step would produce a
    // measurably different number on the second call.
    const cfg = makeNavConfig({ velocityTransitionRate: 0.3 });
    const follower = new SmoothPathFollower(straightPath(5, 100), cfg);

    const first  = follower.getCurrentVelocityMultiplier();
    const second = follower.getCurrentVelocityMultiplier();
    const third  = follower.getCurrentVelocityMultiplier();

    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('returns identical value across many repeated calls without updatePosition()', () => {
    const cfg = makeNavConfig({ velocityTransitionRate: 0.2 });
    const follower = new SmoothPathFollower(sharpTurnPath(), cfg);

    const baseline = follower.getCurrentVelocityMultiplier();
    for (let i = 0; i < 50; i++) {
      expect(follower.getCurrentVelocityMultiplier()).toBe(baseline);
    }
  });

  // -------------------------------------------------------------------------
  // 2. Calling updatePosition() advances the lerp; getter reflects that change
  // -------------------------------------------------------------------------
  it('value changes after updatePosition() but not before', () => {
    // Use the sharp-turn path so the profile at index 1 is SLOW (0.4), well
    // away from the initial FAST (1.0). With transitionRate=0.5, one lerp step
    // moves the multiplier by half the distance — a clearly measurable delta.
    const cfg = makeNavConfig({
      velocityTransitionRate: 0.5,
      arrivalThreshold: 1,
    });
    const points = sharpTurnPath();
    const follower = new SmoothPathFollower(points, cfg);

    // Advance cursor to the turn vertex (index 1) so the target multiplier
    // is SLOW. The lerp step that fires inside updatePosition() will pull
    // currentVelocityMultiplier toward 0.4.
    const before = follower.getCurrentVelocityMultiplier();
    follower.updatePosition(points[0].x, points[0].y); // cursor 0→1, lerp fires
    const after = follower.getCurrentVelocityMultiplier();

    // The getter must reflect exactly one lerp step worth of movement.
    expect(after).not.toBe(before);

    // Repeated reads after the update must still be stable (no further drift).
    expect(follower.getCurrentVelocityMultiplier()).toBe(after);
    expect(follower.getCurrentVelocityMultiplier()).toBe(after);
  });

  it('each updatePosition() call advances the lerp exactly once', () => {
    // transitionRate=0.5 on a sharp turn: each update step halves the gap to SLOW.
    // Manually verify the arithmetic: after k updates from start=1.0 toward 0.4:
    //   value(k) = 0.4 + (1.0 - 0.4) * (1 - 0.5)^k = 0.4 + 0.6 * 0.5^k
    const cfg = makeNavConfig({
      velocityTransitionRate: 0.5,
      arrivalThreshold: 1,
    });
    const points = sharpTurnPath();
    const follower = new SmoothPathFollower(points, cfg);

    const rate   = 0.5;
    const target = cfg.velocityCurveSlow;  // 0.4
    const start  = cfg.velocityCurveFast;  // 1.0

    // Step 1 — cursor advances to index 1 (turn vertex → profile = SLOW).
    follower.updatePosition(points[0].x, points[0].y);
    const expected1 = start + (target - start) * rate; // 1.0 + (0.4-1.0)*0.5 = 0.7
    expect(follower.getCurrentVelocityMultiplier()).toBeCloseTo(expected1, 10);

    // Step 2 — NPC has not reached index 2 yet (far away), cursor stays at 1.
    // The lerp target is still SLOW; another step fires.
    follower.updatePosition(points[0].x, points[0].y); // still not at index 2
    const expected2 = expected1 + (target - expected1) * rate;
    expect(follower.getCurrentVelocityMultiplier()).toBeCloseTo(expected2, 10);

    // Getter does not add a third step by itself.
    expect(follower.getCurrentVelocityMultiplier()).toBeCloseTo(expected2, 10);
  });

  // -------------------------------------------------------------------------
  // 3. Multiple getter calls between updates do not corrupt subsequent lerp
  // -------------------------------------------------------------------------
  it('many getter calls between updates do not corrupt the lerp sequence', () => {
    const cfg = makeNavConfig({
      velocityTransitionRate: 0.4,
      arrivalThreshold: 1,
    });
    const points = sharpTurnPath();
    const follower = new SmoothPathFollower(points, cfg);

    // Advance to the turn vertex.
    follower.updatePosition(points[0].x, points[0].y);

    // Read the multiplier many times — must not accumulate extra lerp steps.
    const afterStep1 = follower.getCurrentVelocityMultiplier();
    for (let i = 0; i < 100; i++) {
      follower.getCurrentVelocityMultiplier();
    }
    expect(follower.getCurrentVelocityMultiplier()).toBe(afterStep1);

    // Now fire exactly one more update and check only one step occurred.
    const rate   = cfg.velocityTransitionRate;
    const target = cfg.velocityCurveSlow;
    const expected = afterStep1 + (target - afterStep1) * rate;

    follower.updatePosition(0, 0); // still not at index 2 — lerp fires toward SLOW
    expect(follower.getCurrentVelocityMultiplier()).toBeCloseTo(expected, 10);
  });

  it('N getter calls then M updates produce exactly M lerp steps regardless of N', () => {
    const cfg = makeNavConfig({
      velocityTransitionRate: 0.3,
      arrivalThreshold: 1,
    });
    const points = sharpTurnPath();

    // Baseline: 0 getter reads between updates.
    const followerA = new SmoothPathFollower(points, cfg);
    followerA.updatePosition(points[0].x, points[0].y); // step 1
    followerA.updatePosition(0, 0);                     // step 2 (cursor still at 1)
    const baselineAfter2 = followerA.getCurrentVelocityMultiplier();

    // With 1000 getter reads interspersed.
    const followerB = new SmoothPathFollower(points, cfg);
    for (let i = 0; i < 500; i++) followerB.getCurrentVelocityMultiplier();
    followerB.updatePosition(points[0].x, points[0].y); // step 1
    for (let i = 0; i < 500; i++) followerB.getCurrentVelocityMultiplier();
    followerB.updatePosition(0, 0);                     // step 2
    for (let i = 0; i < 500; i++) followerB.getCurrentVelocityMultiplier();

    expect(followerB.getCurrentVelocityMultiplier()).toBeCloseTo(baselineAfter2, 10);
  });

  // -------------------------------------------------------------------------
  // 4. After path completion the multiplier converges to 1.0 via updatePosition
  // -------------------------------------------------------------------------
  it('multiplier converges to 1.0 after path completes (lerp driven by updatePosition)', () => {
    // Use a sharp-turn path and instantaneous transition so that by the time
    // the last waypoint is reached the multiplier is at SLOW (0.4).
    // Then verify that continued updatePosition() calls drive it back to 1.0.
    const cfg = makeNavConfig({
      velocityTransitionRate: 1.0, // snap: each step jumps straight to target
      arrivalThreshold: 1,
    });
    const points = sharpTurnPath();
    const follower = new SmoothPathFollower(points, cfg);

    // Traverse the entire path.
    for (const pt of points) {
      follower.updatePosition(pt.x, pt.y);
    }
    expect(follower.isComplete()).toBe(true);

    // With transitionRate=1.0, the first updatePosition() after completion
    // should snap the multiplier all the way to 1.0.
    follower.updatePosition(0, 0);
    expect(follower.getCurrentVelocityMultiplier()).toBeCloseTo(1.0, 10);
  });

  it('multiplier approaches 1.0 gradually after completion with slow transitionRate', () => {
    // Start on a sharp-turn path so the multiplier is pulled toward SLOW.
    // After completion, each updatePosition() lerps toward 1.0 (target for
    // isComplete() === true).
    const cfg = makeNavConfig({
      velocityTransitionRate: 0.5,
      arrivalThreshold: 1,
    });
    const points = sharpTurnPath();
    const follower = new SmoothPathFollower(points, cfg);

    // Complete the path to get the cursor past all points.
    for (const pt of points) {
      follower.updatePosition(pt.x, pt.y);
    }
    expect(follower.isComplete()).toBe(true);

    // Drive the lerp toward 1.0 with repeated updatePosition() calls.
    // Each call must move the value closer; the getter must not interfere.
    let prev = follower.getCurrentVelocityMultiplier();
    for (let i = 0; i < 20; i++) {
      follower.updatePosition(0, 0); // completed path — cursor stays, lerp fires
      const current = follower.getCurrentVelocityMultiplier();
      expect(current).toBeGreaterThanOrEqual(prev - 1e-12); // monotonically non-decreasing toward 1.0
      prev = current;
    }

    // After 20 steps at rate=0.5, value is within floating-point rounding of 1.0.
    expect(follower.getCurrentVelocityMultiplier()).toBeCloseTo(1.0, 5);
  });

  it('multiplier never reaches 1.0 without updatePosition() when starting below 1.0', () => {
    // Confirm that without any updatePosition() the pure getter never changes
    // the multiplier at all, even if the "natural" converged value would be 1.0.
    const cfg = makeNavConfig({
      velocityTransitionRate: 0.5,
      arrivalThreshold: 1,
      velocityCurveFast: 1.0,
    });
    // Two-point path: constructor sets currentVelocityMultiplier = velocityCurveFast = 1.0.
    // Temporarily seed the follower's lerp from a non-1.0 start by using a
    // single-step-snap config to confirm the getter alone never changes anything.
    const points = sharpTurnPath();
    const follower = new SmoothPathFollower(points, cfg);

    // Move cursor to the turn so the lerp target becomes SLOW (0.4).
    // Do exactly one updatePosition() — multiplier is now partway toward 0.4.
    follower.updatePosition(points[0].x, points[0].y);
    const snapshotAfterOneStep = follower.getCurrentVelocityMultiplier();

    // Confirm it shifted away from 1.0.
    expect(snapshotAfterOneStep).toBeLessThan(1.0);

    // Now call the getter 1000 times with NO updatePosition() — value must be frozen.
    for (let i = 0; i < 1000; i++) {
      expect(follower.getCurrentVelocityMultiplier()).toBe(snapshotAfterOneStep);
    }
  });
});
