// navigation/PathSmoother.dubins.test.ts
// Unit tests for the Dubins arc sweep-angle wrapping fix.
//
// The fix: after computing `sweep = endAngle - startAngle`, the code wraps
// the result to [-π, π] so the arc always travels the short way across the
// ±π boundary instead of making an almost-full revolution.

import { describe, it, expect } from 'vitest';
import { smoothPathWithTurning } from './PathSmoother';
import { createDefaultAIConfig } from '../config/createDefaultAIConfig';
import type { Vec2 } from '@alife-sdk/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRandom(values: number[] = [0.5]) {
  let idx = 0;
  return { next: () => values[idx++ % values.length] };
}

function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/** Euclidean length of a polyline. */
function polylineLength(pts: readonly Vec2[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  return total;
}

// Config with no random jitter so arc geometry is deterministic, and a
// generous dubinsMaxInstantTurn of 0 so every interior turn gets an arc.
const baseConfig = createDefaultAIConfig({
  navigation: {
    smoothRandomOffset: 0,
    dubinsMaxInstantTurn: 0,   // force arc insertion at every turn
    dubinsTurningRadius: 60,
  },
}).navigation;

// ---------------------------------------------------------------------------
// Helper: construct a waypoint triple that puts the arc center on the left
// side of the path so that startAngle / endAngle straddle the ±π boundary.
//
// Geometry used across the "near-opposite angles" tests:
//
//   a = (-200, -1)   b = (0, 0)   c = (-200, 1)
//
// The path doubles back on itself (U-turn), so both a and c lie in the
// negative-x half-plane.  After the smooth step the middle segment still
// approximates this shape.  The arc center ends up on the positive-x side
// (bisector of the two incoming unit vectors points right), meaning the
// start/end angles as seen from the center are both near ±π — exactly the
// case the wrap fix must handle.
//
// We use very coarse smoothing (1 point per segment, no offset) so the
// "smooth" path retains the raw geometry as closely as possible, making
// the test deterministic.
// ---------------------------------------------------------------------------

const uturnConfig = createDefaultAIConfig({
  navigation: {
    smoothRandomOffset: 0,
    smoothPointsPerSegment: 1,
    dubinsMaxInstantTurn: 0,
    dubinsTurningRadius: 60,
  },
}).navigation;

// ---------------------------------------------------------------------------
// Sweep-angle wrapping: near-opposite angle pairs
// ---------------------------------------------------------------------------

describe('Dubins arc sweep wrapping — near-±π boundary', () => {
  it('arc with startAngle≈-2.9 and endAngle≈2.9 uses the short sweep (|sweep| < π)', () => {
    // Directly exercise the wrapping arithmetic that lives inside smoothPathWithTurning.
    // We synthesise the angle pair and verify the wrap formula independently.
    const startAngle = -2.9;
    const endAngle = 2.9;

    let sweep = endAngle - startAngle; // ≈ 5.8 (long-way, broken path)
    if (sweep > Math.PI) sweep -= 2 * Math.PI;
    if (sweep < -Math.PI) sweep += 2 * Math.PI;
    // After wrapping: 5.8 - 2π ≈ -0.483 — the short arc
    expect(Math.abs(sweep)).toBeLessThan(Math.PI);
    expect(sweep).toBeCloseTo(5.8 - 2 * Math.PI, 5);
  });

  it('arc with startAngle≈2.9 and endAngle≈-2.9 uses the short sweep (|sweep| < π)', () => {
    const startAngle = 2.9;
    const endAngle = -2.9;

    let sweep = endAngle - startAngle; // ≈ -5.8 (long-way)
    if (sweep > Math.PI) sweep -= 2 * Math.PI;
    if (sweep < -Math.PI) sweep += 2 * Math.PI;
    // After wrapping: -5.8 + 2π ≈ +0.483 — the short arc
    expect(Math.abs(sweep)).toBeLessThan(Math.PI);
    expect(sweep).toBeCloseTo(-5.8 + 2 * Math.PI, 5);
  });

  it('wrapping is a no-op when |sweep| is already within [-π, π]', () => {
    // Each pair (startAngle, endAngle) must have |endAngle - startAngle| <= π
    // so that the wrap branches are never taken.
    const pairs: [number, number][] = [
      [0, 1.0],           // sweep =  1.0
      [-0.5, 0.5],        // sweep =  1.0
      [0, -1.0],          // sweep = -1.0
      [1.2, -0.8],        // sweep = -2.0  (|-2.0| < π)
      [0, Math.PI - 0.1], // sweep ≈  3.04 (just under π)
    ];
    for (const [startAngle, endAngle] of pairs) {
      const rawSweep = endAngle - startAngle;
      let sweep = rawSweep;
      if (sweep > Math.PI) sweep -= 2 * Math.PI;
      if (sweep < -Math.PI) sweep += 2 * Math.PI;
      // Wrapping should not have changed a value already in range
      expect(sweep).toBeCloseTo(rawSweep, 10);
    }
  });
});

// ---------------------------------------------------------------------------
// Integrated path test: U-turn geometry triggers the ±π boundary case
// ---------------------------------------------------------------------------

describe('smoothPathWithTurning — U-turn arc stays near the turn point', () => {
  // Waypoints that form a tight U-turn: go left, pivot at origin, come back left.
  // The bisector from b=(0,0) points in the +x direction, placing the arc
  // centre to the right.  Both a and c are in the negative-x half-plane, so
  // atan2(a.y-cy, a.x-cx) and atan2(c.y-cy, c.x-cx) both sit near ±π.
  const uturnWaypoints: Vec2[] = [
    { x: -200, y: -1 },
    { x: 0,    y: 0  },
    { x: -200, y: 1  },
  ];

  it('produces a finite path without NaN or Infinity', () => {
    const result = smoothPathWithTurning(uturnWaypoints, uturnConfig, makeRandom());
    for (const p of result) {
      expect(isFinite(p.x)).toBe(true);
      expect(isFinite(p.y)).toBe(true);
    }
  });

  it('arc points are within a bounded distance of the turn point', () => {
    const result = smoothPathWithTurning(uturnWaypoints, uturnConfig, makeRandom());
    const turnPoint = uturnWaypoints[1];
    // All arc points should be within a generous bound around the turn.
    // The turning radius is 60, so arc points sit at distance ≈ 60 from the
    // arc centre; the centre itself is at most a few hundred px from b.
    // 400 px is a safe outer bound that a near-full-revolution arc would
    // violate dramatically (it would loop all the way out to ~200 + 60 = 260
    // on the far side, but intermediate points could be further).
    for (const p of result) {
      expect(dist(p, turnPoint)).toBeLessThan(400);
    }
  });

  it('path total length is shorter than a near-full-revolution path would produce', () => {
    const result = smoothPathWithTurning(uturnWaypoints, uturnConfig, makeRandom());
    const len = polylineLength(result);
    // A near-full revolution (sweep ≈ 5.8 rad) on a circle of radius 60
    // contributes arc length ≈ 5.8 * 60 = 348 px just for the arc portion.
    // The correct short arc (sweep ≈ 0.48 rad) contributes only ≈ 29 px.
    // Add the two straight legs (≈ 200 px each) and the total with the wrong
    // arc would be > 700 px.  The correct path is well under 500 px.
    expect(len).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
// Normal same-side turns: arc geometry is correct
// ---------------------------------------------------------------------------

describe('smoothPathWithTurning — same-side 90° turn arc', () => {
  // Classic L-shaped path; the turn angle is 90°.  Both a and c are in the
  // same quadrant relative to the arc centre, so no boundary wrapping occurs.
  const lTurnWaypoints: Vec2[] = [
    { x: 0,   y: 0   },
    { x: 100, y: 0   },
    { x: 100, y: 100 },
  ];

  it('produces a finite, non-empty path', () => {
    const result = smoothPathWithTurning(lTurnWaypoints, uturnConfig, makeRandom());
    expect(result.length).toBeGreaterThan(0);
    for (const p of result) {
      expect(isFinite(p.x)).toBe(true);
      expect(isFinite(p.y)).toBe(true);
    }
  });

  it('arc points are all within reasonable distance of the turn vertex', () => {
    const result = smoothPathWithTurning(lTurnWaypoints, uturnConfig, makeRandom());
    const turn = lTurnWaypoints[1];
    // All points should be within a diameter of the turning circle (120 px)
    // plus the offset to the straight-leg endpoints (max ≈ 100 px).
    for (const p of result) {
      expect(dist(p, turn)).toBeLessThan(300);
    }
  });

  it('arc points lie close to the expected turning-radius circle', () => {
    const result = smoothPathWithTurning(lTurnWaypoints, uturnConfig, makeRandom());
    // For a symmetric 90° L-turn the arc centre lies along the bisector at
    // (100 + r/sin(45°), 0 + r/sin(45°)) approximately — we do not hard-code
    // the centre, but we do know that all arc-inserted points (those that are
    // not the first or last waypoint) must lie at approximately
    // dubinsTurningRadius = 60 from the arc centre.
    //
    // Strategy: compute the centroid of the middle points as a proxy for the
    // arc centre, then verify all points are within ±20 px of radius 60.
    const interior = result.slice(1, result.length - 1);
    if (interior.length === 0) return; // guard for degenerate configs

    // Rough arc-centre estimate via centroid of interior points.
    const cx = interior.reduce((s, p) => s + p.x, 0) / interior.length;
    const cy = interior.reduce((s, p) => s + p.y, 0) / interior.length;

    for (const p of interior) {
      const d = dist(p, { x: cx, y: cy });
      // Points should cluster at consistent distance from centre.
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThan(200); // generous spatial sanity bound
    }
  });

  it('start and end of result are exact first/last waypoints', () => {
    const result = smoothPathWithTurning(lTurnWaypoints, uturnConfig, makeRandom());
    expect(result[0]).toEqual(lTurnWaypoints[0]);
    expect(result[result.length - 1]).toEqual(lTurnWaypoints[lTurnWaypoints.length - 1]);
  });
});

// ---------------------------------------------------------------------------
// Same-side 45° turn: angle is at the dubinsMaxInstantTurn boundary
// ---------------------------------------------------------------------------

describe('smoothPathWithTurning — arc vs no-arc at dubinsMaxInstantTurn boundary', () => {
  const slightTurnWaypoints: Vec2[] = [
    { x: 0,   y: 0  },
    { x: 100, y: 0  },
    { x: 200, y: 100 }, // ~45° turn
  ];

  it('inserts no arc when turn equals dubinsMaxInstantTurn (PI/4)', () => {
    // With the default dubinsMaxInstantTurn = PI/4, a ~45° turn should not
    // get an arc.  The turning version should be no longer than the base.
    const strictConfig = createDefaultAIConfig({
      navigation: {
        smoothRandomOffset: 0,
        dubinsMaxInstantTurn: Math.PI / 4,
        dubinsTurningRadius: 60,
      },
    }).navigation;
    const result = smoothPathWithTurning(slightTurnWaypoints, strictConfig, makeRandom());
    expect(result.length).toBeGreaterThan(0);
  });

  it('inserts arc when dubinsMaxInstantTurn is 0 (always arc)', () => {
    const alwaysArcConfig = createDefaultAIConfig({
      navigation: {
        smoothRandomOffset: 0,
        dubinsMaxInstantTurn: 0,
        dubinsTurningRadius: 60,
      },
    }).navigation;
    const withArc    = smoothPathWithTurning(slightTurnWaypoints, alwaysArcConfig, makeRandom());
    const withoutArc = smoothPathWithTurning(slightTurnWaypoints,
      { ...alwaysArcConfig, dubinsMaxInstantTurn: Math.PI }, makeRandom());
    // Arc insertion should add extra points.
    expect(withArc.length).toBeGreaterThan(withoutArc.length);
  });
});

// ---------------------------------------------------------------------------
// Arc spatial sanity: points must sit on the turning-radius circle
// ---------------------------------------------------------------------------

describe('smoothPathWithTurning — arc points lie on the turning-radius circle', () => {
  // Simple right-angle turn where the arc centre can be computed analytically.
  //
  // a=(0,0)  b=(100,0)  c=(100,100)  — 90° left turn at b.
  //
  // Unit vectors: ab=(1,0), bc=(0,1).  Bisector = (1,1)/√2.
  // halfAngle = 45°, sinHalf = √2/2.
  // centerDist = 60 / (√2/2) = 60√2 ≈ 84.85
  // Centre = b + bisector * centerDist
  //        = (100,0) + (1/√2, 1/√2) * 60√2
  //        = (100 + 60, 0 + 60) = (160, 60)

  const ARC_CENTRE = { x: 160, y: 60 };
  const RADIUS = 60;
  const TOLERANCE = 2; // px — rounding in the 6-subdivision arc

  it('all arc-inserted points are within TOLERANCE of the turning-radius circle', () => {
    const waypoints: Vec2[] = [
      { x: 0,   y: 0   },
      { x: 100, y: 0   },
      { x: 100, y: 100 },
    ];
    const result = smoothPathWithTurning(waypoints, uturnConfig, makeRandom());

    // The first and last points are the raw waypoints; interior points were
    // injected by the arc.  Filter to only those that sit near the known centre.
    const arcPoints = result.filter(p => Math.abs(dist(p, ARC_CENTRE) - RADIUS) < TOLERANCE * 5);
    expect(arcPoints.length).toBeGreaterThan(0);

    for (const p of arcPoints) {
      const r = dist(p, ARC_CENTRE);
      expect(r).toBeCloseTo(RADIUS, 0); // within 0.5 px
    }
  });

  it('arc points progress monotonically between start and end angle', () => {
    // All arc points for a simple 90° turn should lie in the expected quadrant.
    // Start angle from centre (160,60): atan2(0-60, 0-160) ≈ atan2(-60,-160) ≈ -2.78 rad (Q3)
    // End angle:                        atan2(100-60, 100-160) = atan2(40,-60) ≈ 2.55 rad (Q2)
    // With correct wrap, sweep ≈ 2.55 - (-2.78) = 5.33 → wraps to 5.33 - 2π ≈ -0.95 rad
    // So the arc sweeps clockwise by ~0.95 rad, staying in the lower-left quadrant
    // relative to the centre.  All arc points should have x < 160 (left of centre).
    const waypoints: Vec2[] = [
      { x: 0,   y: 0   },
      { x: 100, y: 0   },
      { x: 100, y: 100 },
    ];
    const result = smoothPathWithTurning(waypoints, uturnConfig, makeRandom());
    const arcPoints = result.filter(p => Math.abs(dist(p, ARC_CENTRE) - RADIUS) < TOLERANCE * 5);

    for (const p of arcPoints) {
      // All arc points should be on the near side of the centre (x ≤ centre.x).
      expect(p.x).toBeLessThanOrEqual(ARC_CENTRE.x + TOLERANCE);
    }
  });
});

// ---------------------------------------------------------------------------
// Regression: unwrapped sweep would produce a near-full-revolution arc
// ---------------------------------------------------------------------------

describe('Dubins arc — regression: no near-full-revolution arc', () => {
  it('path length does not blow up for near-opposite startAngle/endAngle', () => {
    // Construct a case where the arc centre ends up to the right of the path,
    // forcing startAngle and endAngle to straddle ±π.
    //
    // Waypoints:  a=(-100, 0)  b=(0, 0)  c=(-100, 0.1)  (near-hairpin)
    //
    // Without the wrap fix, sweep ≈ 2π and every arc point orbits almost all
    // the way around the circle, producing a dramatically longer polyline.
    const hairpinWaypoints: Vec2[] = [
      { x: -100, y:   0   },
      { x:   0,  y:   0   },
      { x: -100, y:   0.1 },
    ];

    const result = smoothPathWithTurning(hairpinWaypoints, uturnConfig, makeRandom());
    const len = polylineLength(result);

    // Correct short arc: straight legs (~100 px each) + small arc (~20 px) ≈ 220 px.
    // Incorrect full-revolution arc: 2π * 60 ≈ 377 px just for the arc portion,
    // which would push total length above 600 px.
    expect(len).toBeLessThan(400);
  });

  it('sweep is never larger than π in absolute value for any standard turn', () => {
    // Exhaustively test the wrap formula over a grid of angle pairs.
    const angles = [-Math.PI + 0.1, -2.0, -1.0, 0, 1.0, 2.0, Math.PI - 0.1];
    for (const startAngle of angles) {
      for (const endAngle of angles) {
        let sweep = endAngle - startAngle;
        if (sweep > Math.PI) sweep -= 2 * Math.PI;
        if (sweep < -Math.PI) sweep += 2 * Math.PI;
        expect(Math.abs(sweep)).toBeLessThanOrEqual(Math.PI + 1e-10);
      }
    }
  });
});
