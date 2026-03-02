/**
 * Integration test: SteeringBehaviors pure-function pipeline.
 *
 * Exercises the complete flocking / pack-steering API end-to-end:
 *   separation, cohesion, alignment, combineForces,
 *   computePackSteering, blendWithPrimary.
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 * No TestNPCHost needed here: SteeringBehaviors are pure functions that
 * operate on Vec2 values — no NPC context required.
 *
 * Edge cases covered:
 *   - Single agent (self) → all forces = (0,0)
 *   - Agents spread symmetrically → cohesion ≈ (0,0)
 *   - Force combination with custom weights
 *   - Pack steering clamped to maxSteeringForce
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createDefaultSteeringConfig,
  separation,
  cohesion,
  alignment,
  combineForces,
  computePackSteering,
  blendWithPrimary,
  type ISteeringConfig,
} from '../navigation/SteeringBehaviors';
import type { Vec2 } from '@alife-sdk/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pt(x: number, y: number): Vec2 {
  return { x, y };
}

function magnitude(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SteeringBehaviors integration', () => {
  let cfg: ISteeringConfig;

  beforeEach(() => {
    cfg = createDefaultSteeringConfig();
  });

  // -------------------------------------------------------------------------
  // separation
  // -------------------------------------------------------------------------
  describe('separation(self, neighbors, config) — repels from nearby agents', () => {
    it('returns non-zero force when a neighbor is within separationRadius', () => {
      const self = pt(0, 0);
      const close = [pt(10, 0)]; // within separationRadius=40
      const force = separation(self, close, cfg);

      expect(magnitude(force)).toBeGreaterThan(0);
    });

    it('force direction points away from the neighbor (neighbor to right → force to left)', () => {
      const self = pt(0, 0);
      const rightNeighbor = [pt(15, 0)];
      const force = separation(self, rightNeighbor, cfg);

      expect(force.x).toBeLessThan(0); // pushed left
      expect(Math.abs(force.y)).toBeLessThan(0.01); // no vertical component
    });

    it('returns (0,0) when no neighbors are within separationRadius', () => {
      const self = pt(0, 0);
      const farNeighbor = [pt(cfg.separationRadius + 1, 0)];
      const force = separation(self, farNeighbor, cfg);

      expect(force.x).toBe(0);
      expect(force.y).toBe(0);
    });

    it('returns (0,0) for empty neighbors array', () => {
      const force = separation(pt(50, 50), [], cfg);

      expect(force.x).toBe(0);
      expect(force.y).toBe(0);
    });

    it('neighbor at same position (distSq=0) does not produce NaN', () => {
      const self = pt(10, 20);
      const same = [pt(10, 20)];
      const force = separation(self, same, cfg);

      expect(isNaN(force.x)).toBe(false);
      expect(isNaN(force.y)).toBe(false);
      // dist=0 → skipped by the guard, so ZERO is returned.
      expect(force.x).toBe(0);
      expect(force.y).toBe(0);
    });

    it('symmetric neighbors on opposite sides cancel → force ≈ (0,0)', () => {
      const self = pt(0, 0);
      // Two equidistant neighbors — forces cancel.
      const neighbors = [pt(20, 0), pt(-20, 0)];
      const force = separation(self, neighbors, cfg);

      expect(Math.abs(force.x)).toBeLessThan(0.01);
      expect(Math.abs(force.y)).toBeLessThan(0.01);
    });
  });

  // -------------------------------------------------------------------------
  // cohesion
  // -------------------------------------------------------------------------
  describe('cohesion(self, neighbors, config) — pulls toward group center', () => {
    it('pulls toward the center of mass of neighbors within neighborRadius', () => {
      const self = pt(0, 0);
      const neighbors = [pt(100, 0), pt(100, 0)]; // center = (100, 0)
      const force = cohesion(self, neighbors, cfg);

      expect(force.x).toBeGreaterThan(0); // pulled right
      expect(Math.abs(force.y)).toBeLessThan(0.01);
    });

    it('returns (0,0) for empty neighbors array', () => {
      const force = cohesion(pt(0, 0), [], cfg);

      expect(force.x).toBe(0);
      expect(force.y).toBe(0);
    });

    it('ignores neighbors beyond neighborRadius', () => {
      const self = pt(0, 0);
      const farNeighbor = [pt(cfg.neighborRadius + 10, 0)];
      const force = cohesion(self, farNeighbor, cfg);

      expect(force.x).toBe(0);
      expect(force.y).toBe(0);
    });

    it('returns a normalized vector (magnitude ≈ 1) when neighbors exist', () => {
      const self = pt(0, 0);
      const neighbors = [pt(50, 0), pt(0, 50)]; // center = (25, 25)
      const force = cohesion(self, neighbors, cfg);
      const mag = magnitude(force);

      expect(mag).toBeCloseTo(1, 2);
    });

    it('agents spread symmetrically around self → cohesion ≈ (0,0)', () => {
      // Self at origin; 4 agents at corners of a square — center of mass = origin.
      const self = pt(0, 0);
      const neighbors = [pt(50, 50), pt(-50, 50), pt(50, -50), pt(-50, -50)];
      const force = cohesion(self, neighbors, cfg);

      expect(Math.abs(force.x)).toBeLessThan(0.01);
      expect(Math.abs(force.y)).toBeLessThan(0.01);
    });
  });

  // -------------------------------------------------------------------------
  // alignment
  // -------------------------------------------------------------------------
  describe('alignment(neighborDirections) — aligns velocity with the group', () => {
    it('returns the average normalized direction when all neighbors move the same way', () => {
      const dirs: Vec2[] = [pt(1, 0), pt(1, 0), pt(1, 0)];
      const force = alignment(dirs);

      expect(force.x).toBeCloseTo(1, 2);
      expect(force.y).toBeCloseTo(0, 2);
    });

    it('returns (0,0) for empty neighborDirections', () => {
      const force = alignment([]);

      expect(force.x).toBe(0);
      expect(force.y).toBe(0);
    });

    it('averages two perpendicular directions → diagonal (0.707, 0.707)', () => {
      const dirs: Vec2[] = [pt(1, 0), pt(0, 1)];
      const force = alignment(dirs);
      const expected = 1 / Math.sqrt(2);

      expect(force.x).toBeCloseTo(expected, 2);
      expect(force.y).toBeCloseTo(expected, 2);
    });

    it('exactly opposing directions cancel → (0,0)', () => {
      const dirs: Vec2[] = [pt(1, 0), pt(-1, 0)];
      const force = alignment(dirs);

      // Average = (0, 0) → magnitude < 0.001 → returns ZERO.
      expect(force.x).toBe(0);
      expect(force.y).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // combineForces
  // -------------------------------------------------------------------------
  describe('combineForces(forces, maxMagnitude) — combines multiple forces', () => {
    it('sums separation, cohesion, alignment forces with their weights', () => {
      const sep = pt(1, 0); // normalized separation (push right... unusual but for test)
      const coh = pt(0, 1); // normalized cohesion (pull down)
      const aln = pt(0, -1); // alignment (up)

      const result = combineForces(
        [
          { force: sep, weight: cfg.separationWeight }, // 1.5
          { force: coh, weight: cfg.cohesionWeight },   // 0.5
          { force: aln, weight: cfg.alignmentWeight },  // 0.3
        ],
        cfg.maxSteeringForce,
      );

      // x = 1 * 1.5 = 1.5; y = 1 * 0.5 + (-1) * 0.3 = 0.2
      expect(result.x).toBeCloseTo(1.5, 2);
      expect(result.y).toBeCloseTo(0.2, 2);
    });

    it('clamps the result to maxMagnitude when the combined force exceeds it', () => {
      const bigForce = pt(1, 0);
      const result = combineForces(
        [{ force: bigForce, weight: 500 }], // raw = 500, well above max=80
        cfg.maxSteeringForce,
      );
      const mag = magnitude(result);

      expect(mag).toBeCloseTo(cfg.maxSteeringForce, 1);
    });

    it('returns (0,0) for empty forces array', () => {
      const result = combineForces([], 100);

      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });

    it('does not clamp when result is within maxMagnitude', () => {
      const result = combineForces(
        [{ force: pt(0, 1), weight: 30 }], // magnitude = 30 < 80
        cfg.maxSteeringForce,
      );
      const mag = magnitude(result);

      expect(mag).toBeCloseTo(30, 1);
    });
  });

  // -------------------------------------------------------------------------
  // computePackSteering
  // -------------------------------------------------------------------------
  describe('computePackSteering(self, neighbors, config) — pack follows the leader', () => {
    it('returns (0,0) when no neighbors', () => {
      const result = computePackSteering(pt(0, 0), [], cfg);

      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });

    it('produces a non-zero force when one neighbor is nearby', () => {
      const self = pt(0, 0);
      const neighbors = [pt(20, 0)]; // within separationRadius
      const result = computePackSteering(self, neighbors, cfg);

      expect(magnitude(result)).toBeGreaterThan(0);
    });

    it('combines separation and cohesion (close + far neighbor)', () => {
      const self = pt(0, 0);
      // One neighbor close (drives separation) + one at moderate distance (drives cohesion).
      const neighbors = [pt(15, 0), pt(100, 0)];
      const result = computePackSteering(self, neighbors, cfg);

      expect(magnitude(result)).toBeGreaterThan(0);
    });

    it('clamps result to maxSteeringForce even with very high separationWeight', () => {
      const tightCfg = createDefaultSteeringConfig({
        separationRadius: 200,
        separationWeight: 999,
        maxSteeringForce: 80,
      });
      const neighbors = [pt(5, 0)]; // very close → huge raw separation force
      const result = computePackSteering(pt(0, 0), neighbors, tightCfg);
      const mag = magnitude(result);

      expect(mag).toBeLessThanOrEqual(80 + 0.01);
    });

    it('neighbor beyond both radii → result is (0,0)', () => {
      // Neighbor far enough to miss both separationRadius and neighborRadius.
      const farNeighbor = [pt(cfg.neighborRadius + 50, 0)];
      const result = computePackSteering(pt(0, 0), farNeighbor, cfg);

      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // blendWithPrimary
  // -------------------------------------------------------------------------
  describe('blendWithPrimary — blend primary vector with steering', () => {
    it('weight=0 → pure primary direction at speed', () => {
      const steering = pt(0, 100); // upward steering
      const { vx, vy } = blendWithPrimary(1, 0, steering, 150, 0);

      // Pure primary (rightward) at speed 150.
      expect(vx).toBeCloseTo(150, 1);
      expect(vy).toBeCloseTo(0, 1);
    });

    it('weight=1 → pure steering direction at speed', () => {
      const steering = pt(0, 1); // normalized upward
      const { vx, vy } = blendWithPrimary(1, 0, steering, 150, 1);

      // Pure steering (upward) at speed 150.
      expect(vx).toBeCloseTo(0, 1);
      expect(vy).toBeCloseTo(150, 1);
    });

    it('weight=0.5 → blended direction, final magnitude ≈ speed', () => {
      const steering = pt(0, 1); // upward
      const { vx, vy } = blendWithPrimary(1, 0, steering, 100, 0.5);
      const mag = Math.sqrt(vx * vx + vy * vy);

      expect(mag).toBeCloseTo(100, 1);
      expect(Math.abs(vx)).toBeGreaterThan(0);
      expect(Math.abs(vy)).toBeGreaterThan(0);
    });

    it('zero primary + zero steering → {vx:0, vy:0}', () => {
      const { vx, vy } = blendWithPrimary(0, 0, pt(0, 0), 100, 0.5);

      expect(vx).toBe(0);
      expect(vy).toBe(0);
    });

    it('orthogonal primary and steering at weight=0.5 → 45° diagonal', () => {
      // primary=(1,0), steering=(0,1) at equal weight → 45°.
      const steering = pt(0, 80); // non-unit but normalized internally
      const { vx, vy } = blendWithPrimary(1, 0, steering, 100, 0.5);

      // Both components equal → true 45°.
      expect(vx).toBeCloseTo(vy, 1);
      expect(Math.sqrt(vx * vx + vy * vy)).toBeCloseTo(100, 1);
    });

    it('large steering magnitude does not inflate final speed beyond `speed` param', () => {
      // Even with a huge steering force, the result is re-normalized to `speed`.
      const hugeForce = pt(10000, 0);
      const { vx, vy } = blendWithPrimary(0, 1, hugeForce, 75, 0.5);
      const mag = Math.sqrt(vx * vx + vy * vy);

      expect(mag).toBeCloseTo(75, 1);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases — single agent
  // -------------------------------------------------------------------------
  describe('Edge case: single agent (self) → all forces = (0,0)', () => {
    it('separation with self as only "neighbor" at same position → ZERO', () => {
      const self = pt(0, 0);
      // distSq = 0 → guard skips → ZERO returned.
      const force = separation(self, [self], cfg);

      expect(force.x).toBe(0);
      expect(force.y).toBe(0);
    });

    it('cohesion with self as only neighbor at same position → ZERO', () => {
      const self = pt(0, 0);
      // Center-of-mass equals self → subtract returns (0,0) → mag < 0.001 → ZERO.
      const force = cohesion(self, [self], cfg);

      expect(force.x).toBe(0);
      expect(force.y).toBe(0);
    });

    it('computePackSteering with self as only neighbor → ZERO', () => {
      const self = pt(50, 50);
      const result = computePackSteering(self, [self], cfg);

      // Both separation (dist=0, skipped) and cohesion (center=self) return ZERO.
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Agents spread evenly → cohesion ≈ (0,0)
  // -------------------------------------------------------------------------
  describe('Agents spread evenly → cohesion ≈ (0,0)', () => {
    it('4 agents at cardinal positions equidistant from self → cohesion ≈ (0,0)', () => {
      const self = pt(0, 0);
      const dist = 60; // within neighborRadius=150
      const neighbors = [pt(dist, 0), pt(-dist, 0), pt(0, dist), pt(0, -dist)];
      const force = cohesion(self, neighbors, cfg);

      // Center of mass = (0, 0) = self → direction vector is zero → ZERO force.
      expect(Math.abs(force.x)).toBeLessThan(0.01);
      expect(Math.abs(force.y)).toBeLessThan(0.01);
    });

    it('8 agents uniformly arranged around self → cohesion ≈ (0,0)', () => {
      const self = pt(0, 0);
      const r = 80;
      const neighbors: Vec2[] = [];
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * 2 * Math.PI;
        neighbors.push(pt(Math.cos(angle) * r, Math.sin(angle) * r));
      }
      const force = cohesion(self, neighbors, cfg);

      expect(Math.abs(force.x)).toBeLessThan(0.01);
      expect(Math.abs(force.y)).toBeLessThan(0.01);
    });
  });
});
