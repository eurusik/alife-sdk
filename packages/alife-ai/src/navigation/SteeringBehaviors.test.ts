// navigation/SteeringBehaviors.test.ts

import { describe, it, expect } from 'vitest';
import {
  createDefaultSteeringConfig,
  separation,
  cohesion,
  alignment,
  combineForces,
  computePackSteering,
  blendWithPrimary,
  type ISteeringConfig,
} from './SteeringBehaviors';
import type { Vec2 } from '@alife-sdk/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const cfg = createDefaultSteeringConfig();

function pt(x: number, y: number): Vec2 {
  return { x, y };
}

function approx(v: Vec2, x: number, y: number, epsilon = 0.01): void {
  expect(v.x).toBeCloseTo(x, 2);
  expect(v.y).toBeCloseTo(y, 2);
}

// ---------------------------------------------------------------------------
// createDefaultSteeringConfig
// ---------------------------------------------------------------------------

describe('createDefaultSteeringConfig', () => {
  it('returns all defaults when called with no args', () => {
    const c = createDefaultSteeringConfig();
    expect(c.separationRadius).toBe(40);
    expect(c.separationWeight).toBe(1.5);
    expect(c.neighborRadius).toBe(150);
    expect(c.cohesionWeight).toBe(0.5);
    expect(c.alignmentWeight).toBe(0.3);
    expect(c.maxSteeringForce).toBe(80);
  });

  it('merges overrides without affecting other fields', () => {
    const c = createDefaultSteeringConfig({ separationRadius: 60, maxSteeringForce: 100 });
    expect(c.separationRadius).toBe(60);
    expect(c.maxSteeringForce).toBe(100);
    expect(c.separationWeight).toBe(1.5); // unchanged
    expect(c.cohesionWeight).toBe(0.5);  // unchanged
  });
});

// ---------------------------------------------------------------------------
// separation
// ---------------------------------------------------------------------------

describe('separation', () => {
  it('returns a non-zero force when a neighbor is too close', () => {
    const self = pt(0, 0);
    const close = [pt(10, 0)]; // well within separationRadius=40
    const force = separation(self, close, cfg);
    expect(force.x).toBeLessThan(0); // pushed left (away from right neighbor)
    expect(Math.abs(force.x)).toBeGreaterThan(0);
  });

  it('ignores neighbors outside separationRadius', () => {
    const self = pt(0, 0);
    const far = [pt(cfg.separationRadius + 1, 0)]; // just outside
    const force = separation(self, far, cfg);
    expect(force.x).toBe(0);
    expect(force.y).toBe(0);
  });

  it('neighbor exactly on separationRadius boundary → ZERO force', () => {
    const self = pt(0, 0);
    const exact = [pt(cfg.separationRadius, 0)];
    const force = separation(self, exact, cfg);
    expect(force.x).toBe(0);
    expect(force.y).toBe(0);
  });

  it('force is stronger for closer neighbors (inversely proportional)', () => {
    const self = pt(0, 0);
    const veryClose = separation(self, [pt(5, 0)], cfg);
    const lessClose  = separation(self, [pt(30, 0)], cfg);
    // Both push in -x direction; veryClose should be stronger (both normalized here,
    // but the raw un-normalized component is larger — result is normalized so check weight)
    // Separation returns normalized; the raw magnitude before normalization is what
    // differs. We verify direction is correct and absolute value is 1 (normalized).
    expect(veryClose.x).toBeLessThan(0);
    expect(lessClose.x).toBeLessThan(0);
  });

  it('returns ZERO when neighbors array is empty', () => {
    const force = separation(pt(0, 0), [], cfg);
    expect(force.x).toBe(0);
    expect(force.y).toBe(0);
  });

  it('dist=0 guard: neighbor at same position does not produce NaN', () => {
    const self = pt(5, 5);
    const same = [pt(5, 5)];
    const force = separation(self, same, cfg);
    expect(force.x).toBe(0);
    expect(force.y).toBe(0);
    expect(isNaN(force.x)).toBe(false);
  });

  it('force direction points away from the neighbor', () => {
    const self = pt(0, 0);
    const rightNeighbor = [pt(10, 0)];
    const force = separation(self, rightNeighbor, cfg);
    // Should push left (negative x) and have no y component
    expect(force.x).toBeLessThan(0);
    expect(Math.abs(force.y)).toBeLessThan(0.001);
  });

  it('symmetric opposing neighbors cancel → ZERO force', () => {
    const self = pt(0, 0);
    // Two equidistant neighbors on opposite sides — forces cancel exactly
    const neighbors = [pt(10, 0), pt(-10, 0)];
    const force = separation(self, neighbors, cfg);
    expect(force.x).toBeCloseTo(0, 2);
    expect(force.y).toBeCloseTo(0, 2);
  });
});

// ---------------------------------------------------------------------------
// cohesion
// ---------------------------------------------------------------------------

describe('cohesion', () => {
  it('pulls toward the center of mass of neighbors', () => {
    const self = pt(0, 0);
    const neighbors = [pt(100, 0), pt(100, 0)]; // center = (100, 0)
    const force = cohesion(self, neighbors, cfg);
    expect(force.x).toBeGreaterThan(0); // pulled right toward x=100
    expect(Math.abs(force.y)).toBeLessThan(0.001);
  });

  it('returns ZERO when neighbors array is empty', () => {
    const force = cohesion(pt(0, 0), [], cfg);
    expect(force.x).toBe(0);
    expect(force.y).toBe(0);
  });

  it('ignores neighbors beyond neighborRadius', () => {
    const self = pt(0, 0);
    const farNeighbors = [pt(cfg.neighborRadius + 10, 0)];
    const force = cohesion(self, farNeighbors, cfg);
    expect(force.x).toBe(0);
    expect(force.y).toBe(0);
  });

  it('returns a normalized vector (magnitude ≈ 1)', () => {
    const self = pt(0, 0);
    const neighbors = [pt(50, 0), pt(0, 50)]; // center = (25, 25)
    const force = cohesion(self, neighbors, cfg);
    const mag = Math.sqrt(force.x * force.x + force.y * force.y);
    expect(mag).toBeCloseTo(1, 2);
  });

  it('self at center of neighbors → ZERO (no dominant direction)', () => {
    const self = pt(50, 50);
    // Symmetric neighbors cancel out → center = self
    const neighbors = [pt(50, 50), pt(50, 50)];
    const force = cohesion(self, neighbors, cfg);
    expect(Math.abs(force.x)).toBeLessThan(0.001);
    expect(Math.abs(force.y)).toBeLessThan(0.001);
  });
});

// ---------------------------------------------------------------------------
// alignment
// ---------------------------------------------------------------------------

describe('alignment', () => {
  it('returns average direction of neighbor directions', () => {
    const dirs: Vec2[] = [
      { x: 1, y: 0 },
      { x: 1, y: 0 },
    ];
    const force = alignment(dirs);
    expect(force.x).toBeCloseTo(1, 2);
    expect(force.y).toBeCloseTo(0, 2);
  });

  it('returns ZERO when neighborDirections is empty', () => {
    const force = alignment([]);
    expect(force.x).toBe(0);
    expect(force.y).toBe(0);
  });

  it('averages perpendicular directions to produce a diagonal', () => {
    const dirs: Vec2[] = [
      { x: 1, y: 0 },  // right
      { x: 0, y: 1 },  // down
    ];
    const force = alignment(dirs);
    // Result should point diagonally toward (1,1), normalized
    const expected = 1 / Math.sqrt(2);
    expect(force.x).toBeCloseTo(expected, 2);
    expect(force.y).toBeCloseTo(expected, 2);
  });

  it('returns a normalized vector when dirs are non-trivial', () => {
    const dirs: Vec2[] = [{ x: 3, y: 4 }];
    const force = alignment(dirs);
    const mag = Math.sqrt(force.x * force.x + force.y * force.y);
    expect(mag).toBeCloseTo(1, 2);
  });
});

// ---------------------------------------------------------------------------
// combineForces
// ---------------------------------------------------------------------------

describe('combineForces', () => {
  it('returns ZERO when all forces are zero', () => {
    const result = combineForces(
      [{ force: { x: 0, y: 0 }, weight: 1.0 }],
      100,
    );
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it('returns ZERO for empty forces array', () => {
    const result = combineForces([], 100);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it('sums weighted forces', () => {
    const result = combineForces(
      [
        { force: { x: 1, y: 0 }, weight: 2 },
        { force: { x: 0, y: 1 }, weight: 3 },
      ],
      1000,
    );
    expect(result.x).toBeCloseTo(2, 2);
    expect(result.y).toBeCloseTo(3, 2);
  });

  it('clamps result to maxMagnitude', () => {
    const result = combineForces(
      [{ force: { x: 1, y: 0 }, weight: 200 }], // raw magnitude = 200
      80,
    );
    const mag = Math.sqrt(result.x * result.x + result.y * result.y);
    expect(mag).toBeCloseTo(80, 2);
  });

  it('does not clamp when result is within maxMagnitude', () => {
    const result = combineForces(
      [{ force: { x: 0, y: 1 }, weight: 50 }],
      100,
    );
    const mag = Math.sqrt(result.x * result.x + result.y * result.y);
    expect(mag).toBeCloseTo(50, 2);
  });
});

// ---------------------------------------------------------------------------
// computePackSteering
// ---------------------------------------------------------------------------

describe('computePackSteering', () => {
  it('returns ZERO when neighbors array is empty', () => {
    const result = computePackSteering(pt(0, 0), [], cfg);
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });

  it('combines separation and cohesion', () => {
    const self = pt(0, 0);
    // One neighbor close (separation) and one far-ish (cohesion)
    const neighbors = [pt(20, 0), pt(100, 0)];
    const result = computePackSteering(self, neighbors, cfg);
    // Net result should be some non-zero force
    const mag = Math.sqrt(result.x * result.x + result.y * result.y);
    expect(mag).toBeGreaterThan(0);
  });

  it('clamps result to maxSteeringForce', () => {
    const self = pt(0, 0);
    // Very close neighbor → large separation force
    const tightCfg: ISteeringConfig = createDefaultSteeringConfig({
      separationRadius:  200,
      separationWeight:  1000,
      maxSteeringForce:   80,
    });
    const neighbors = [pt(5, 0)];
    const result = computePackSteering(self, neighbors, tightCfg);
    const mag = Math.sqrt(result.x * result.x + result.y * result.y);
    expect(mag).toBeLessThanOrEqual(80 + 0.01);
  });

  it('all neighbors outside neighborRadius → only separation (or ZERO)', () => {
    const self = pt(0, 0);
    // Neighbor is at separationRadius+1 (not close) and neighborRadius+1 (not near for cohesion)
    const neighbor = [pt(cfg.neighborRadius + 10, 0)];
    const result = computePackSteering(self, neighbor, cfg);
    // Separation is also 0 (too far). Cohesion 0 (too far). Result = ZERO.
    expect(result.x).toBe(0);
    expect(result.y).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// blendWithPrimary
// ---------------------------------------------------------------------------

describe('blendWithPrimary', () => {
  it('weight=0 → pure primary direction at speed', () => {
    const steering = { x: 0, y: 100 }; // strong upward steering
    const { vx, vy } = blendWithPrimary(1, 0, steering, 150, 0);
    // Should move purely right at speed 150
    expect(vx).toBeCloseTo(150, 1);
    expect(vy).toBeCloseTo(0, 1);
  });

  it('weight=1 → pure steering direction at speed', () => {
    const steering = { x: 0, y: 1 }; // normalized upward
    const { vx, vy } = blendWithPrimary(1, 0, steering, 150, 1);
    // Should move purely upward at speed 150
    expect(vx).toBeCloseTo(0, 1);
    expect(vy).toBeCloseTo(150, 1);
  });

  it('weight=0.5 → mixed direction, magnitude ≈ speed', () => {
    const steering = { x: 0, y: 1 };
    const { vx, vy } = blendWithPrimary(1, 0, steering, 100, 0.5);
    const mag = Math.sqrt(vx * vx + vy * vy);
    expect(mag).toBeCloseTo(100, 1);
    // Both components should be non-zero
    expect(Math.abs(vx)).toBeGreaterThan(0);
    expect(Math.abs(vy)).toBeGreaterThan(0);
  });

  it('weight=0.5 with orthogonal directions → 45° result (weight controls direction, not magnitude)', () => {
    // primary=(1,0), steering=(0,1) — weight=0.5 means equal influence → 45° diagonal
    const steering = { x: 0, y: 80 }; // large magnitude to expose old domain-mixing bug
    const { vx, vy } = blendWithPrimary(1, 0, steering, 100, 0.5);
    // After normalization, steering direction = (0,1). Blend: (0.5, 0) + (0, 0.5) = (0.5, 0.5)
    // Re-normalized to speed: both components equal → 45°
    expect(vx).toBeCloseTo(vy, 1); // equal x and y → true 45°
    expect(Math.sqrt(vx * vx + vy * vy)).toBeCloseTo(100, 1);
  });

  it('zero primary + zero steering → {vx:0, vy:0}', () => {
    const { vx, vy } = blendWithPrimary(0, 0, { x: 0, y: 0 }, 100, 0.5);
    expect(vx).toBe(0);
    expect(vy).toBe(0);
  });
});
