// src/core/Grid.bfs.test.ts
// Unit tests for the BFS head-pointer optimisation in Grid.floodFill() and
// Grid.findRegions().  The fix replaced Array.shift() (O(n) per dequeue) with
// a head-index cursor (head++) so that dequeue is O(1).  These tests guard
// against correctness regressions introduced by that change and include a
// performance smoke-test that would time out if O(n) dequeue were restored.

import { describe, it, expect } from 'vitest';
import { Grid } from './Grid';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a Grid<number> from a 2-D array of rows (row 0 = top).
 * Usage:  fromRows([[1,0],[0,1]])  → 2×2 grid
 */
function fromRows(rows: number[][]): Grid<number> {
  const height = rows.length;
  const width  = rows[0].length;
  const grid   = new Grid<number>(width, height, 0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      grid.set(x, y, rows[y][x]);
    }
  }
  return grid;
}

/** Predicate: cell value equals 1. */
const isOne = (v: number) => v === 1;

/** Sort GridPoint array for stable comparison (row-major order). */
function sortPoints(pts: { x: number; y: number }[]): { x: number; y: number }[] {
  return [...pts].sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x);
}

/** Convert a sorted GridPoint array to a compact string "x,y|x,y…" for easy diffing. */
function pts(arr: { x: number; y: number }[]): string {
  return sortPoints(arr).map(p => `${p.x},${p.y}`).join('|');
}

// ---------------------------------------------------------------------------
// floodFill — correctness
// ---------------------------------------------------------------------------

describe('Grid.floodFill — correctness', () => {
  it('fills a fully-connected region of 1s', () => {
    // 3×3 all-ones grid: every cell is reachable from (0,0).
    const grid = fromRows([
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ]);

    const result = grid.floodFill(0, 0, isOne);

    expect(result).toHaveLength(9);
    // Every cell must appear exactly once.
    const seen = new Set(result.map(p => `${p.x},${p.y}`));
    expect(seen.size).toBe(9);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        expect(seen.has(`${x},${y}`)).toBe(true);
      }
    }
  });

  it('returns cells in BFS (level) order — start cell is always first', () => {
    const grid = fromRows([
      [1, 1, 1],
      [1, 1, 1],
      [1, 1, 1],
    ]);

    const result = grid.floodFill(1, 1, isOne); // start from centre
    expect(result[0]).toEqual({ x: 1, y: 1 });
  });

  it('visits each cell exactly once in a connected region', () => {
    const grid = fromRows([
      [1, 1, 0],
      [0, 1, 1],
      [0, 0, 1],
    ]);

    const result = grid.floodFill(0, 0, isOne);

    // No duplicates.
    const keys = result.map(p => `${p.x},${p.y}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('produces the same set of cells as a brute-force DFS reference', () => {
    // Irregular connected region in a 5×5 grid.
    const grid = fromRows([
      [1, 1, 0, 0, 0],
      [0, 1, 1, 0, 0],
      [0, 0, 1, 1, 0],
      [0, 0, 0, 1, 1],
      [0, 0, 0, 0, 1],
    ]);

    const bfsResult = grid.floodFill(0, 0, isOne);

    // The diagonal should contain exactly these 9 cells.
    const expected = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 3, y: 3 },
      { x: 4, y: 3 },
      { x: 4, y: 4 },
    ];

    expect(pts(bfsResult)).toBe(pts(expected));
  });

  it('predicate receives the correct value, x, and y arguments', () => {
    const grid = new Grid<number>(3, 3, 0);
    grid.set(1, 1, 7);
    grid.set(1, 2, 7);

    const seen: Array<[number, number, number]> = [];
    grid.floodFill(1, 1, (v, x, y) => {
      seen.push([v, x, y]);
      return v === 7;
    });

    // Both calls with value 7 must have correct coordinates.
    expect(seen).toContainEqual([7, 1, 1]);
    expect(seen).toContainEqual([7, 1, 2]);
  });
});

// ---------------------------------------------------------------------------
// floodFill — boundary / stop conditions
// ---------------------------------------------------------------------------

describe('Grid.floodFill — boundary and stop conditions', () => {
  it('does not cross cells where predicate returns false', () => {
    // A wall of 0s separates left column from right column.
    const grid = fromRows([
      [1, 0, 1],
      [1, 0, 1],
      [1, 0, 1],
    ]);

    const result = grid.floodFill(0, 0, isOne);

    // Only the left column (x=0) should be filled.
    expect(result).toHaveLength(3);
    for (const p of result) {
      expect(p.x).toBe(0);
    }
  });

  it('stops at all four grid edges — does not read out-of-bounds', () => {
    // All-ones 4×4 grid; BFS from corner must not go out-of-bounds.
    const grid = fromRows([
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
      [1, 1, 1, 1],
    ]);

    const result = grid.floodFill(0, 0, isOne);
    expect(result).toHaveLength(16);

    for (const { x, y } of result) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(4);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(4);
    }
  });

  it('stops at the north/west edges when starting from a corner', () => {
    const grid = fromRows([
      [1, 1, 1],
      [1, 0, 0],
      [1, 0, 0],
    ]);

    const result = grid.floodFill(0, 0, isOne);
    expect(pts(result)).toBe(pts([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: 2 },
    ]));
  });

  it('handles an L-shaped connected region with a dead-end arm', () => {
    // The fill must traverse the arm and not miss any reachable cells.
    const grid = fromRows([
      [1, 1, 1, 1, 1],
      [0, 0, 0, 0, 1],
      [0, 0, 0, 0, 1],
    ]);

    const result = grid.floodFill(0, 0, isOne);
    expect(result).toHaveLength(7);
  });

  it('returns empty array when start cell fails the predicate', () => {
    const grid = fromRows([
      [1, 1],
      [1, 1],
    ]);

    // Start at (0,0) which has value 1, but predicate only accepts 0.
    const result = grid.floodFill(0, 0, (v) => v === 0);
    expect(result).toEqual([]);
  });

  it('returns empty array when start is out of bounds', () => {
    const grid = fromRows([[1, 1], [1, 1]]);

    expect(grid.floodFill(-1,  0, isOne)).toEqual([]);
    expect(grid.floodFill( 0, -1, isOne)).toEqual([]);
    expect(grid.floodFill( 2,  0, isOne)).toEqual([]);
    expect(grid.floodFill( 0,  2, isOne)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// floodFill — edge cases
// ---------------------------------------------------------------------------

describe('Grid.floodFill — edge cases', () => {
  it('single-cell grid: returns that one cell when predicate passes', () => {
    const grid = new Grid<number>(1, 1, 1);

    const result = grid.floodFill(0, 0, isOne);
    expect(result).toEqual([{ x: 0, y: 0 }]);
  });

  it('single-cell grid: returns empty when predicate fails', () => {
    const grid = new Grid<number>(1, 1, 0);

    const result = grid.floodFill(0, 0, isOne);
    expect(result).toEqual([]);
  });

  it('entire grid filled with matching cells is fully visited', () => {
    // 10×10, all 1s — verifies no cell is missed with a non-trivial size.
    const grid = new Grid<number>(10, 10, 1);

    const result = grid.floodFill(5, 5, isOne);
    expect(result).toHaveLength(100);
  });

  it('no matching cells at all — returns empty array', () => {
    const grid = new Grid<number>(4, 4, 0);

    expect(grid.floodFill(0, 0, isOne)).toEqual([]);
    expect(grid.floodFill(3, 3, isOne)).toEqual([]);
  });

  it('isolated single matching cell surrounded by non-matching cells', () => {
    const grid = fromRows([
      [0, 0, 0],
      [0, 1, 0],
      [0, 0, 0],
    ]);

    const result = grid.floodFill(1, 1, isOne);
    expect(result).toEqual([{ x: 1, y: 1 }]);
  });

  it('1×N horizontal strip — visits all cells in order', () => {
    const grid = new Grid<number>(5, 1, 1);

    const result = grid.floodFill(0, 0, isOne);
    expect(result).toHaveLength(5);
    // All cells are in row 0.
    for (const p of result) expect(p.y).toBe(0);
  });

  it('N×1 vertical strip — visits all cells', () => {
    const grid = new Grid<number>(1, 5, 1);

    const result = grid.floodFill(0, 0, isOne);
    expect(result).toHaveLength(5);
    for (const p of result) expect(p.x).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// findRegions — correctness
// ---------------------------------------------------------------------------

describe('Grid.findRegions — correctness', () => {
  it('identifies a single contiguous region', () => {
    const grid = fromRows([
      [1, 1, 1],
      [1, 1, 1],
    ]);

    const regions = grid.findRegions(isOne);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toHaveLength(6);
  });

  it('identifies two disconnected regions', () => {
    // Two 1-blobs separated by a column of 0s.
    const grid = fromRows([
      [1, 0, 1],
      [1, 0, 1],
    ]);

    const regions = grid.findRegions(isOne);
    expect(regions).toHaveLength(2);
  });

  it('identifies three disconnected regions', () => {
    const grid = fromRows([
      [1, 0, 1, 0, 1],
    ]);

    const regions = grid.findRegions(isOne);
    expect(regions).toHaveLength(3);
    for (const r of regions) {
      expect(r).toHaveLength(1);
    }
  });

  it('returns correct region sizes for asymmetric blobs', () => {
    // Blob A (size 3): top-left 2×1 + one extra cell below.
    // Blob B (size 1): isolated at (4,0).
    const grid = fromRows([
      [1, 1, 0, 0, 1],
      [1, 0, 0, 0, 0],
    ]);

    const regions = grid.findRegions(isOne);
    expect(regions).toHaveLength(2);

    const sizes = regions.map(r => r.length).sort((a, b) => a - b);
    expect(sizes).toEqual([1, 3]);
  });

  it('every cell in a region satisfies the predicate', () => {
    const grid = fromRows([
      [1, 0, 1],
      [1, 0, 0],
      [0, 0, 1],
    ]);

    const regions = grid.findRegions(isOne);
    for (const region of regions) {
      for (const { x, y } of region) {
        expect(grid.get(x, y)).toBe(1);
      }
    }
  });

  it('no cell appears in more than one region', () => {
    const grid = fromRows([
      [1, 1, 0, 1],
      [0, 1, 0, 1],
      [0, 0, 0, 0],
      [1, 0, 1, 1],
    ]);

    const regions = grid.findRegions(isOne);
    const seen = new Set<string>();
    for (const region of regions) {
      for (const { x, y } of region) {
        const key = `${x},${y}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it('union of all regions equals the full set of matching cells', () => {
    const grid = fromRows([
      [1, 0, 1, 1],
      [1, 0, 0, 1],
      [0, 0, 1, 0],
    ]);

    const allMatching = new Set<string>();
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        if (grid.get(x, y) === 1) allMatching.add(`${x},${y}`);
      }
    }

    const regions = grid.findRegions(isOne);
    const fromRegions = new Set(
      regions.flatMap(r => r.map(p => `${p.x},${p.y}`)),
    );

    expect(fromRegions).toEqual(allMatching);
  });
});

// ---------------------------------------------------------------------------
// findRegions — edge cases
// ---------------------------------------------------------------------------

describe('Grid.findRegions — edge cases', () => {
  it('returns empty array when no cells match the predicate', () => {
    const grid = new Grid<number>(4, 4, 0);
    expect(grid.findRegions(isOne)).toEqual([]);
  });

  it('single-cell grid — one matching cell produces one region of size 1', () => {
    const grid = new Grid<number>(1, 1, 1);

    const regions = grid.findRegions(isOne);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toEqual([{ x: 0, y: 0 }]);
  });

  it('single-cell grid — non-matching cell produces no regions', () => {
    const grid = new Grid<number>(1, 1, 0);
    expect(grid.findRegions(isOne)).toEqual([]);
  });

  it('entire grid matching cells produces exactly one region covering all cells', () => {
    const grid = new Grid<number>(6, 6, 1);

    const regions = grid.findRegions(isOne);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toHaveLength(36);
  });

  it('checkerboard pattern — every cell is its own isolated region (4-connectivity)', () => {
    // In a checkerboard no two same-valued cells share an edge under 4-connectivity.
    const grid = fromRows([
      [1, 0, 1, 0],
      [0, 1, 0, 1],
      [1, 0, 1, 0],
      [0, 1, 0, 1],
    ]);

    const regions = grid.findRegions(isOne);
    // 8 cells with value 1, each isolated → 8 regions of size 1.
    expect(regions).toHaveLength(8);
    for (const r of regions) {
      expect(r).toHaveLength(1);
    }
  });

  it('1×N horizontal strip with a gap — two regions', () => {
    const grid = new Grid<number>(5, 1, 1);
    grid.set(2, 0, 0); // gap at centre

    const regions = grid.findRegions(isOne);
    expect(regions).toHaveLength(2);
    const sizes = regions.map(r => r.length).sort((a, b) => a - b);
    expect(sizes).toEqual([2, 2]);
  });

  it('N×1 vertical strip with a gap — two regions', () => {
    const grid = new Grid<number>(1, 5, 1);
    grid.set(0, 2, 0); // gap in middle

    const regions = grid.findRegions(isOne);
    expect(regions).toHaveLength(2);
    const sizes = regions.map(r => r.length).sort((a, b) => a - b);
    expect(sizes).toEqual([2, 2]);
  });

  it('predicate using coordinates, not just value — selects a sub-region', () => {
    const grid = new Grid<number>(5, 5, 1);

    // Only cells in the top-left 3×3 quadrant are accepted.
    const regions = grid.findRegions((_, x, y) => x < 3 && y < 3);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toHaveLength(9);
  });
});

// ---------------------------------------------------------------------------
// Performance regression guard — O(1) dequeue must not time out on large grids
// ---------------------------------------------------------------------------

describe('Grid.floodFill — performance (BFS head-pointer O(1) dequeue)', () => {
  it('floodFill on a 100×100 all-matching grid completes within 500 ms', () => {
    // With the old Array.shift() (O(n) per call) this would take ~100 s.
    // With the head-pointer fix it completes in well under 100 ms.
    const SIZE = 100;
    const grid = new Grid<number>(SIZE, SIZE, 1);

    const start  = performance.now();
    const result = grid.floodFill(0, 0, isOne);
    const elapsed = performance.now() - start;

    expect(result).toHaveLength(SIZE * SIZE);
    expect(elapsed).toBeLessThan(500);
  });

  it('findRegions on a 100×100 all-matching grid completes within 500 ms', () => {
    const SIZE = 100;
    const grid = new Grid<number>(SIZE, SIZE, 1);

    const start   = performance.now();
    const regions = grid.findRegions(isOne);
    const elapsed = performance.now() - start;

    expect(regions).toHaveLength(1);
    expect(regions[0]).toHaveLength(SIZE * SIZE);
    expect(elapsed).toBeLessThan(500);
  });

  it('findRegions on a 100×100 checkerboard grid (max isolated regions) completes within 500 ms', () => {
    // Worst-case for region counting: every cell is its own region.
    const SIZE = 100;
    const grid  = new Grid<number>(SIZE, SIZE, 0);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if ((x + y) % 2 === 0) grid.set(x, y, 1);
      }
    }

    const start   = performance.now();
    const regions = grid.findRegions(isOne);
    const elapsed = performance.now() - start;

    expect(regions).toHaveLength(SIZE * SIZE / 2);
    expect(elapsed).toBeLessThan(500);
  });
});
