// src/scoring/MapScorer.test.ts
// Unit tests for MapScorer.scoreCoverDistribution — focusing on the Gini
// coefficient fix: empty grid cells (count = 0) are now always included in
// the Gini computation so that clumped distributions no longer score as
// "even" when all cover happens to land in a single cell.
//
// The method is private; we reach it through a typed cast to `any` (same
// pattern used in MacroPass.test.ts and Pathfinder.test.ts).

import { describe, it, expect } from 'vitest';
import { MapScorer } from './MapScorer';
import type { MapDefinition, CoverPoint } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let _coverIdSeq = 0;

/** Build a minimal CoverPoint at the given pixel coordinates. */
function cp(x: number, y: number): CoverPoint {
  return {
    id: `cp-${++_coverIdSeq}`,
    x,
    y,
    facingAngle: 0,
    radius: 32,
  };
}

/**
 * Build a MapDefinition that is sufficient for scoreCoverDistribution.
 * The map is 80×60 tiles at 32 px/tile → 2560 × 1920 px.
 * The 4×4 scoring grid therefore has cells of 640 × 480 px each.
 *
 * Cell layout (col,row):
 *   (0,0) x: 0–639,   y: 0–479
 *   (1,0) x: 640–1279, y: 0–479
 *   …
 *   (3,3) x: 1920–2559, y: 1440–1919
 *
 * A point that maps to grid cell (cx,cy) needs:
 *   x = cx * 640 + offset   (offset < 640)
 *   y = cy * 480 + offset   (offset < 480)
 *
 * We use offset = 10 throughout so every coordinate is well within its cell.
 */
const MAP_W_TILES  = 80;
const MAP_H_TILES  = 60;
const TILE_SIZE    = 32;
const CELL_W       = (MAP_W_TILES * TILE_SIZE) / 4; // 640 px
const CELL_H       = (MAP_H_TILES * TILE_SIZE) / 4; // 480 px
const CELL_OFFSET  = 10;                             // safe margin inside each cell

function cellOrigin(col: number, row: number): { x: number; y: number } {
  return {
    x: col * CELL_W + CELL_OFFSET,
    y: row * CELL_H + CELL_OFFSET,
  };
}

function makeMap(coverPoints: CoverPoint[]): MapDefinition {
  return {
    width:        MAP_W_TILES,
    height:       MAP_H_TILES,
    tileSize:     TILE_SIZE,
    seed:         'test',
    layers:       [],
    zones:        [],
    props:        [],
    colliders:    [],
    coverPoints,
    npcSpawns:    [],
    playerSpawn:  { x: 0, y: 0 },
    lanes:        [],
    validation:   { valid: true, errors: [], warnings: [] },
  };
}

/** Call the private scoreCoverDistribution method directly. */
function scoreCover(coverPoints: CoverPoint[]): number {
  const scorer = new MapScorer();
   
  return (scorer as any).scoreCoverDistribution(makeMap(coverPoints));
}

// ---------------------------------------------------------------------------
// Analytical expectations
//
// The formula (lines 153-165 of MapScorer.ts):
//   values  = cellCounts padded to 16 zeros, then sorted ascending
//   n       = 16
//   mean    = total / 16
//   giniNum = Σ (2*(i+1) - n - 1) * values[i]   for i in 0..15
//   gini    = giniNum / (n * n * mean)
//   evenness = 1 - |gini|
//   score   = (occupiedCells/16)*0.5 + evenness*0.5
//
// Scenario A — all cover in one cell (n=16, 1 occupied cell):
//   values  = [0,0,...,0,K]  where K = total covers
//   giniNum = (2*16-17)*K = 15*K
//   mean    = K/16
//   gini    = 15*K / (16*16*(K/16)) = 15*K / (16*K) = 15/16 = 0.9375
//   evenness = 1 - 0.9375 = 0.0625
//   score   = (1/16)*0.5 + 0.0625*0.5 = 0.03125 + 0.03125 = 0.0625
//
// Scenario B — exactly 1 cover in each of all 16 cells:
//   values  = [1,1,...,1]
//   giniNum = Σ (2*(i+1)-17)*1 for i=0..15 = Σ (2i-15) = 0
//   gini    = 0, evenness = 1
//   score   = (16/16)*0.5 + 1*0.5 = 1.0
//
// Scenario C — 2 covers per cell in 8 cells, remaining 8 cells empty:
//   values  = [0,0,...,0, 2,2,...,2]  (8 zeros then 8 twos)
//   mean    = 16/16 = 1
//   giniNum = Σ_{i=8}^{15} (2*(i+1)-17)*2
//           = 2 * (1+3+5+7+9+11+13+15) = 2 * 64 = 128
//   gini    = 128 / (16*16*1) = 128/256 = 0.5
//   evenness = 0.5
//   score   = (8/16)*0.5 + 0.5*0.5 = 0.25 + 0.25 = 0.5
// ---------------------------------------------------------------------------

const SCORE_ALL_IN_ONE_CELL  = 0.0625;
const SCORE_PERFECTLY_EVEN   = 1.0;
const SCORE_HALF_CELLS        = 0.5;

// ---------------------------------------------------------------------------
// Gini fix: clumped distributions no longer score as "even"
// ---------------------------------------------------------------------------

describe('MapScorer.scoreCoverDistribution — Gini coefficient fix', () => {
  it('all cover in one cell scores near 0 (maximally clumped)', () => {
    // Place 16 cover points all inside grid cell (0,0).
    const { x, y } = cellOrigin(0, 0);
    const points = Array.from({ length: 16 }, () => cp(x, y));

    const result = scoreCover(points);

    expect(result).toBeCloseTo(SCORE_ALL_IN_ONE_CELL, 6);
    // Confirm evenness is very low — score must be well below 0.5.
    expect(result).toBeLessThan(0.2);
  });

  it('cover evenly spread across all 16 cells scores exactly 1', () => {
    // One cover point in every grid cell.
    const points: CoverPoint[] = [];
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const { x, y } = cellOrigin(col, row);
        points.push(cp(x, y));
      }
    }

    const result = scoreCover(points);

    expect(result).toBeCloseTo(SCORE_PERFECTLY_EVEN, 6);
  });

  it('cover in exactly half the cells scores 0.5', () => {
    // 2 cover points each in cells (0,0) through (1,3) — the left 8 cells.
    const points: CoverPoint[] = [];
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 2; col++) {
        const { x, y } = cellOrigin(col, row);
        points.push(cp(x, y));
        points.push(cp(x, y));
      }
    }

    const result = scoreCover(points);

    expect(result).toBeCloseTo(SCORE_HALF_CELLS, 6);
    // Must be strictly between the clumped and uniform extremes.
    expect(result).toBeGreaterThan(SCORE_ALL_IN_ONE_CELL);
    expect(result).toBeLessThan(SCORE_PERFECTLY_EVEN);
  });

  it('single cover point returns 0 (below minimum threshold for scoring)', () => {
    // The method guards `coverPoints.length < 2` and returns 0 immediately.
    const { x, y } = cellOrigin(0, 0);
    const result = scoreCover([cp(x, y)]);

    expect(result).toBe(0);
  });

  it('single cover point does not score as perfectly even', () => {
    // Regression guard: before the fix, a single occupied cell with n=1
    // would collapse the Gini denominator and could return unexpected values.
    // The current guard returns 0, which is far from 1.
    const { x, y } = cellOrigin(2, 2);
    const result = scoreCover([cp(x, y)]);

    expect(result).not.toBeCloseTo(SCORE_PERFECTLY_EVEN, 2);
    expect(result).toBeLessThan(0.5);
  });

  it('Gini value changes between distinct distributions', () => {
    // Three point sets with progressively more even distributions must produce
    // strictly increasing scores — confirming the Gini computation is sensitive
    // to how spread out the covers are.

    // Distribution 1: all in one cell (most clumped).
    const { x: x0, y: y0 } = cellOrigin(0, 0);
    const clumped = Array.from({ length: 16 }, () => cp(x0, y0));

    // Distribution 2: spread across half the cells.
    const halfCells: CoverPoint[] = [];
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 2; col++) {
        const { x, y } = cellOrigin(col, row);
        halfCells.push(cp(x, y), cp(x, y));
      }
    }

    // Distribution 3: exactly one cover per cell (most even).
    const uniform: CoverPoint[] = [];
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const { x, y } = cellOrigin(col, row);
        uniform.push(cp(x, y));
      }
    }

    const scoreClumped  = scoreCover(clumped);
    const scoreHalf     = scoreCover(halfCells);
    const scoreUniform  = scoreCover(uniform);

    expect(scoreClumped).toBeLessThan(scoreHalf);
    expect(scoreHalf).toBeLessThan(scoreUniform);
  });

  it('two covers in the same cell score lower than two covers in separate cells', () => {
    // The fix must cause the empty cells to drag the Gini upward for the
    // clumped case.  This is the minimal two-point regression that would
    // have been hidden before the fix (both distributions had n=1 with the
    // old occupied-only approach).
    const { x: xa, y: ya } = cellOrigin(0, 0);
    const { x: xb, y: yb } = cellOrigin(3, 3);

    const bothInSameCell   = [cp(xa, ya), cp(xa, ya)];
    const inDifferentCells = [cp(xa, ya), cp(xb, yb)];

    const scoreSame      = scoreCover(bothInSameCell);
    const scoreDifferent = scoreCover(inDifferentCells);

    expect(scoreSame).toBeLessThan(scoreDifferent);
  });
});

// ---------------------------------------------------------------------------
// Composite score incorporates cover distribution correctly
// ---------------------------------------------------------------------------

describe('MapScorer.score — cover distribution weight reflected in total', () => {
  it('a perfectly even cover layout produces a higher total score than a fully clumped one', () => {
    const scorer = new MapScorer();

    // Minimally valid MapDefinition for the full score() call.
    // We keep zones, lanes, and props absent/empty so only coverDistribution
    // produces a meaningful signal.
    const baseMap = makeMap([]);

    // Clumped map: all 16 covers in cell (0,0).
    const { x: xClump, y: yClump } = cellOrigin(0, 0);
    const clumpedMap: MapDefinition = {
      ...baseMap,
      coverPoints: Array.from({ length: 16 }, () => cp(xClump, yClump)),
    };

    // Uniform map: one cover per cell.
    const uniformCovers: CoverPoint[] = [];
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const { x, y } = cellOrigin(col, row);
        uniformCovers.push(cp(x, y));
      }
    }
    const uniformMap: MapDefinition = { ...baseMap, coverPoints: uniformCovers };

    const clumpedTotal  = scorer.score(clumpedMap);
    const uniformTotal  = scorer.score(uniformMap);

    expect(clumpedTotal).toBeLessThan(uniformTotal);
  });

  it('breakdown() reports coverDistribution consistent with scoreCoverDistribution', () => {
    const scorer = new MapScorer();

    const uniform: CoverPoint[] = [];
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const { x, y } = cellOrigin(col, row);
        uniform.push(cp(x, y));
      }
    }
    const map = makeMap(uniform);

    const bd = scorer.breakdown(map);

    expect(bd.coverDistribution).toBeCloseTo(SCORE_PERFECTLY_EVEN, 6);
    expect(bd.total).toBeCloseTo(scorer.score(map), 10);
  });
});

// ---------------------------------------------------------------------------
// Round-4 fixes: breakdown() double-compute removed; mean=0 guard added
// ---------------------------------------------------------------------------

describe('MapScorer round-4 fixes', () => {
  // -------------------------------------------------------------------------
  // Fix 1 — breakdown().total equals score() (no double-compute divergence)
  //
  // Before the fix, breakdown() re-called each private scorer and recomputed
  // the weighted sum independently. Any floating-point ordering difference
  // between the two paths could cause subtle divergence. After the fix,
  // breakdown().total is derived from the same intermediate variables that
  // flow into the weighted sum returned by score(), so the two values are
  // always bitwise identical.
  // -------------------------------------------------------------------------

  it('breakdown().total equals score() for a map with no cover (all zero sub-scores)', () => {
    const scorer = new MapScorer();
    const map = makeMap([]); // empty cover → coverDistribution = 0

    const total = scorer.score(map);
    const bd    = scorer.breakdown(map);

    // Both must agree — and neither must be NaN (mean=0 guard).
    expect(bd.total).not.toBeNaN();
    expect(total).not.toBeNaN();
    expect(bd.total).toBeCloseTo(total, 10);
  });

  it('breakdown().total equals score() for a clumped cover layout', () => {
    const scorer = new MapScorer();
    const { x, y } = cellOrigin(0, 0);
    const map = makeMap(Array.from({ length: 16 }, () => cp(x, y)));

    const total = scorer.score(map);
    const bd    = scorer.breakdown(map);

    expect(bd.total).toBeCloseTo(total, 10);
  });

  it('breakdown().total equals score() for a uniform cover layout', () => {
    const scorer = new MapScorer();
    const covers: CoverPoint[] = [];
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const { x, y } = cellOrigin(col, row);
        covers.push(cp(x, y));
      }
    }
    const map = makeMap(covers);

    const total = scorer.score(map);
    const bd    = scorer.breakdown(map);

    expect(bd.total).toBeCloseTo(total, 10);
  });

  // -------------------------------------------------------------------------
  // Fix 2 — mean=0 guard: zero cover points must not produce NaN
  //
  // scoreCoverDistribution() pads values to 16 cells. When coverPoints is
  // empty the method returns 0 via the `length < 2` guard before computing
  // the Gini coefficient, so mean is never zero inside the Gini path.
  //
  // However, a map with exactly zero cover points exercised a branch where
  // mean could theoretically reach the Gini formula. The explicit `if (mean === 0) return 0`
  // guard prevents a divide-by-zero that would produce NaN in the score.
  // These tests confirm both the public API and each breakdown field are finite.
  // -------------------------------------------------------------------------

  it('mean=0 guard — score() returns a finite number when coverPoints is empty', () => {
    const scorer = new MapScorer();
    const map    = makeMap([]);

    const result = scorer.score(map);

    expect(result).not.toBeNaN();
    expect(isFinite(result)).toBe(true);
  });

  it('mean=0 guard — breakdown() returns finite values for every field when coverPoints is empty', () => {
    const scorer = new MapScorer();
    const map    = makeMap([]);

    const bd = scorer.breakdown(map);

    for (const [key, value] of Object.entries(bd)) {
      expect(isFinite(value)).toBe(true);
      expect(value).not.toBeNaN();
      // Extra: field must not be undefined (regression on shape).
      expect(value).toBeDefined();
      void key; // suppress unused-variable lint
    }
  });

  it('mean=0 guard — coverDistribution is 0 when there are no cover points', () => {
    // The length < 2 guard returns 0 directly; the mean=0 guard is a
    // defence-in-depth behind it. Both paths must yield 0, never NaN.
    const scorer = new MapScorer();
    const map    = makeMap([]);

    const bd = scorer.breakdown(map);

    expect(bd.coverDistribution).toBe(0);
  });

  it('mean=0 guard — coverDistribution is 0 when there is exactly one cover point', () => {
    const scorer = new MapScorer();
    const { x, y } = cellOrigin(1, 1);
    const map = makeMap([cp(x, y)]);

    const bd = scorer.breakdown(map);

    expect(bd.coverDistribution).toBe(0);
    expect(bd.total).not.toBeNaN();
  });
});
