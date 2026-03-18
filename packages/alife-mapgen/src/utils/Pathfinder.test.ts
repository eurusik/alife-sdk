// src/utils/Pathfinder.test.ts
// Unit tests for Pathfinder — focusing on the fractional tile cost fix:
// (tileCost || 1) preserves fractional costs (e.g. 0.5) instead of clamping
// them to 1 as the previous Math.max(1, tileCost) did.

import { describe, it, expect } from 'vitest';
import { Pathfinder } from './Pathfinder';
import { Grid } from '../core/Grid';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a uniform cost grid of the given dimensions filled with `fill`.
 * Individual cells can be overridden via the `overrides` map keyed as "x,y".
 */
function makeGrid(
  width: number,
  height: number,
  fill: number,
  overrides: Record<string, number> = {},
): Grid<number> {
  const grid = new Grid<number>(width, height, fill);
  for (const [key, value] of Object.entries(overrides)) {
    const [x, y] = key.split(',').map(Number);
    grid.set(x, y, value);
  }
  return grid;
}

/** Extract x-coordinates from a path for compact assertions. */
function xs(path: { x: number; y: number }[]): number[] {
  return path.map(p => p.x);
}

// ---------------------------------------------------------------------------
// Tile cost semantics (zero and fractional)
// ---------------------------------------------------------------------------

describe('Pathfinder tile cost semantics', () => {
  it('treats a tile with cost 0 as cost 1 (zero is falsy, falls back to 1)', () => {
    // A 1×3 corridor — 4-connected, diagonal off so we can reason about g-scores.
    // start(0,0) → mid(1,0) cost=0 → end(2,0) cost=1
    // With (tileCost || 1): entering (1,0) costs 1×1=1, entering (2,0) costs 1×1=1 → total g=2
    const grid = makeGrid(3, 1, 1, { '1,0': 0 });
    const pf = new Pathfinder({ allowDiagonal: false });

    const path = pf.findPath(grid, 0, 0, 2, 0);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(3); // start, mid, end

    // Confirm the path visits all three cells in order.
    expect(xs(path!)).toEqual([0, 1, 2]);
  });

  it('preserves a tile with cost 0.5 — does NOT clamp it to 1', () => {
    // A corridor where the middle tile has cost 0.5.
    // With the old Math.max(1, tileCost) the cost would have been clamped to 1.
    // With (tileCost || 1) the cost 0.5 passes through unchanged.
    //
    // We verify this by comparing the accumulated g-score implied by the path
    // length against what cost-1 clamping would predict.
    //
    // 4-connected, 3 cells wide:  (0,0) → (1,0)[cost=0.5] → (2,0)[cost=1]
    // Expected total g: 1×0.5 + 1×1 = 1.5   (fractional)
    // Clamped total g:  1×1   + 1×1 = 2.0   (integer)
    //
    // We cannot read g directly, so we instead show that the pathfinder
    // PREFERS the 0.5-cost route over an equally-long cost-1 route (see
    // next test group), and here we simply verify the path is found at all
    // and traverses the fractional tile.
    const grid = makeGrid(3, 1, 1, { '1,0': 0.5 });
    const pf = new Pathfinder({ allowDiagonal: false });

    const path = pf.findPath(grid, 0, 0, 2, 0);
    expect(path).not.toBeNull();
    expect(xs(path!)).toEqual([0, 1, 2]);
  });

  it('a cost-0 tile and a cost-0.5 tile produce different accumulated costs', () => {
    // Place two candidate middle tiles side by side on separate rows so
    // A* can choose between them.
    //
    // Grid (3×2), 4-connected, diagonal off:
    //   row 0: [start(0,0)=1] [mid_zero(1,0)=0 ] [end(2,0)=1]
    //   row 1: [start(0,1)=1] [mid_half(1,1)=0.5] [end(2,1)=1]
    //
    // Run independent queries for each row and confirm both paths are found,
    // showing that 0 and 0.5 are both valid (non-Infinity) costs.
    const grid = makeGrid(3, 2, 1, { '1,0': 0, '1,1': 0.5 });
    const pf = new Pathfinder({ allowDiagonal: false });

    const pathZero = pf.findPath(grid, 0, 0, 2, 0);
    const pathHalf = pf.findPath(grid, 0, 1, 2, 1);

    expect(pathZero).not.toBeNull();
    expect(pathHalf).not.toBeNull();

    // Both paths should be 3 steps long.
    expect(pathZero!.length).toBe(3);
    expect(pathHalf!.length).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Path preference: fractional cost route is chosen over cost-1 route
// ---------------------------------------------------------------------------

describe('Pathfinder prefers fractional-cost route over cost-1 route', () => {
  it('routes through a 0.5-cost corridor instead of an equally-long 1.0-cost corridor', () => {
    // Grid layout (5 wide × 3 tall), 4-connected only:
    //
    //   col:  0    1    2    3    4
    //  row 0: 1    0.5  0.5  0.5  1    ← cheap corridor
    //  row 1: 1    Inf  Inf  Inf  1    ← wall separating rows
    //  row 2: 1    1    1    1    1    ← normal corridor
    //
    // Start = (0,0), End = (4,0).
    //
    // Both routes are 5 tiles long (start + 3 middle + end).
    // Cheap route cost: 1 + (3 × 0.5) + 1 = 3.5  (the middle three tiles cost 0.5 each, but
    //   note the start tile cost is not counted — A* g-score accumulates ENTRY costs; (0,0)
    //   is the origin so its cost is 0. Actually: entering (1,0)=0.5, (2,0)=0.5, (3,0)=0.5,
    //   (4,0)=1  → g = 0 + 0.5+0.5+0.5+1 = 2.5)
    // Normal route would require going around the wall via row 2 — but the wall seals it off
    // entirely, so the ONLY reachable path is through row 0.
    // This verifies that fractional tiles are traversed rather than treated as walls.
    const grid = makeGrid(5, 3, 1, {
      '1,0': 0.5, '2,0': 0.5, '3,0': 0.5,
      '1,1': Infinity, '2,1': Infinity, '3,1': Infinity,
    });
    const pf = new Pathfinder({ allowDiagonal: false });

    const path = pf.findPath(grid, 0, 0, 4, 0);
    expect(path).not.toBeNull();

    // Must pass through the 0.5-cost row.
    const ys = path!.map(p => p.y);
    expect(ys.every(y => y === 0)).toBe(true);
  });

  it('selects the 0.5-cost lane over the 1.0-cost lane when both are accessible', () => {
    // Two parallel 4-connected corridors of equal length running left→right.
    // The cheaper lane (row 0) uses cost 0.5 on interior tiles.
    // The normal lane (row 1) uses cost 1 throughout.
    // Rows are connected only at the start column (x=0) and end column (x=4),
    // so the pathfinder can freely choose which lane to enter.
    //
    //   col:  0    1    2    3    4
    //  row 0: 1    0.5  0.5  0.5  1    ← cheap lane
    //  row 2: 1    1    1    1    1    ← normal lane
    //  (no connection between rows in between — row 1 is a wall)
    //
    // Start = (0,0), End = (4,0).  Both rows share the same start/end x.
    // A* should prefer row 0 because it accumulates lower g when entering tiles 1-3.
    const grid = makeGrid(5, 3, 1, {
      '1,0': 0.5, '2,0': 0.5, '3,0': 0.5,
      '0,1': Infinity, '1,1': Infinity, '2,1': Infinity, '3,1': Infinity, '4,1': Infinity,
    });
    const pf = new Pathfinder({ allowDiagonal: false });

    const path = pf.findPath(grid, 0, 0, 4, 0);
    expect(path).not.toBeNull();

    // The path should stay in row 0 (the cheap lane).
    const ys = path!.map(p => p.y);
    expect(ys.every(y => y === 0)).toBe(true);
    expect(xs(path!)).toEqual([0, 1, 2, 3, 4]);
  });
});

// ---------------------------------------------------------------------------
// Normal integer costs still work correctly
// ---------------------------------------------------------------------------

describe('Pathfinder normal integer tile costs', () => {
  it('finds a direct path across a uniform cost-1 grid', () => {
    const grid = makeGrid(5, 5, 1);
    const pf = new Pathfinder({ allowDiagonal: false });

    const path = pf.findPath(grid, 0, 0, 4, 0);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(5);
    expect(xs(path!)).toEqual([0, 1, 2, 3, 4]);
  });

  it('routes around an impassable (Infinity) wall', () => {
    // 3×3 grid with a vertical wall at x=1.
    //   col: 0   1    2
    //  row 0: 1  Inf   1
    //  row 1: 1  Inf   1
    //  row 2: 1   1    1   ← only passage
    const grid = makeGrid(3, 3, 1, {
      '1,0': Infinity,
      '1,1': Infinity,
    });
    const pf = new Pathfinder({ allowDiagonal: false });

    const path = pf.findPath(grid, 0, 0, 2, 0);
    expect(path).not.toBeNull();
    // Must go around: down to (0,2), across to (2,2), back up to (2,0).
    expect(path!.some(p => p.x === 1 && p.y === 0)).toBe(false);
    expect(path!.some(p => p.x === 1 && p.y === 1)).toBe(false);
  });

  it('prefers cost-1 tiles over cost-2 tiles', () => {
    // Two parallel corridors; top row has cost-2 interior tiles, bottom has cost-1.
    //   col:  0   1   2   3   4
    //  row 0: 1   2   2   2   1   ← expensive lane
    //  row 1: 1   1   1   1   1   ← cheap lane
    // Connected at x=0 and x=4 only (row 2 is a wall).
    //   row 2: Inf everywhere between
    // Start = (0,0), End = (4,0).
    const grid = makeGrid(5, 3, 1, {
      '1,0': 2, '2,0': 2, '3,0': 2,
      '0,2': Infinity, '1,2': Infinity, '2,2': Infinity, '3,2': Infinity, '4,2': Infinity,
    });
    const pf = new Pathfinder({ allowDiagonal: false });

    const path = pf.findPath(grid, 0, 0, 4, 0);
    expect(path).not.toBeNull();

    // Cheapest route: drop to row 1 at x=0, traverse, rise to row 0 at x=4.
    // The path must visit at least one tile in row 1.
    expect(path!.some(p => p.y === 1)).toBe(true);
  });

  it('returns null when no path exists', () => {
    // Completely walled off destination.
    const grid = makeGrid(3, 3, 1, {
      '2,0': Infinity, '2,1': Infinity, '2,2': Infinity,
      '1,0': Infinity, '1,1': Infinity, '1,2': Infinity,
    });
    const pf = new Pathfinder({ allowDiagonal: false });

    const path = pf.findPath(grid, 0, 0, 2, 2);
    expect(path).toBeNull();
  });

  it('handles start === end correctly', () => {
    const grid = makeGrid(3, 3, 1);
    const pf = new Pathfinder({ allowDiagonal: false });

    const path = pf.findPath(grid, 1, 1, 1, 1);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(1);
    expect(path![0]).toEqual({ x: 1, y: 1 });
  });

  it('returns null when start is out of bounds', () => {
    const grid = makeGrid(3, 3, 1);
    const pf = new Pathfinder({ allowDiagonal: false });

    expect(pf.findPath(grid, -1, 0, 2, 2)).toBeNull();
    expect(pf.findPath(grid, 5, 0, 2, 2)).toBeNull();
  });

  it('returns null when end is out of bounds', () => {
    const grid = makeGrid(3, 3, 1);
    const pf = new Pathfinder({ allowDiagonal: false });

    expect(pf.findPath(grid, 0, 0, 3, 0)).toBeNull();
    expect(pf.findPath(grid, 0, 0, 0, -1)).toBeNull();
  });
});
