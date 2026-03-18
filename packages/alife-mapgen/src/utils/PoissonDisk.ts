// src/utils/PoissonDisk.ts
// Bridson's algorithm for Poisson disk sampling in 2D.
// Produces a set of points with minimum distance `r` between any two points,
// uniformly filling the domain. Much more natural looking than uniform random.
//
// Reference: Robert Bridson, "Fast Poisson Disk Sampling in Arbitrary Dimensions"
// SIGGRAPH 2007

import { Rng } from '../core/Rng.js';

export interface PoissonPoint {
  x: number;
  y: number;
}

export interface PoissonDiskOptions {
  /** Domain width in pixels. */
  width: number;
  /** Domain height in pixels. */
  height: number;
  /** Minimum distance between any two points. */
  minRadius: number;
  /** Number of candidates to try per active point before discarding (default 30). */
  maxAttempts?: number;
  /** Seeded RNG instance. */
  rng: Rng;
}

/**
 * Generates a Poisson disk sampled point set within a rectangular domain.
 *
 * The returned points are guaranteed to have a minimum separation of `minRadius`
 * and are distributed with no clumping (unlike uniform random scattering).
 *
 * Optional `accept` predicate filters individual candidates.
 */
export function poissonDisk(
  opts: PoissonDiskOptions,
  accept?: (x: number, y: number) => boolean,
): PoissonPoint[] {
  const { width, height, minRadius, rng } = opts;
  const maxAttempts = opts.maxAttempts ?? 30;
  const cellSize = minRadius / Math.SQRT2;

  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);

  // Background grid: -1 = empty, otherwise index into `points`
  const grid = new Int32Array(cols * rows).fill(-1);

  const points: PoissonPoint[] = [];
  const active: number[] = [];

  function gridIndex(x: number, y: number): number {
    const gx = Math.floor(x / cellSize);
    const gy = Math.floor(y / cellSize);
    return gy * cols + gx;
  }

  function isValidPoint(x: number, y: number): boolean {
    if (x < 0 || x >= width || y < 0 || y >= height) return false;
    if (accept && !accept(x, y)) return false;

    const gx = Math.floor(x / cellSize);
    const gy = Math.floor(y / cellSize);
    const x0 = Math.max(0, gx - 2);
    const x1 = Math.min(cols - 1, gx + 2);
    const y0 = Math.max(0, gy - 2);
    const y1 = Math.min(rows - 1, gy + 2);

    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const idx = grid[cy * cols + cx];
        if (idx === -1) continue;
        const p = points[idx];
        const dx = p.x - x;
        const dy = p.y - y;
        if (dx * dx + dy * dy < minRadius * minRadius) return false;
      }
    }
    return true;
  }

  function addPoint(x: number, y: number): void {
    const idx = points.length;
    points.push({ x, y });
    active.push(idx);
    grid[gridIndex(x, y)] = idx;
  }

  // Initial seed point.
  // Retry up to maxAttempts times so that a restrictive `accept` predicate
  // does not silently leave the active list empty (which would cause the
  // algorithm to return zero points immediately).
  for (let seedAttempt = 0; seedAttempt < maxAttempts; seedAttempt++) {
    const sx = rng.float(0, width);
    const sy = rng.float(0, height);
    if (!accept || accept(sx, sy)) {
      addPoint(sx, sy);
      break;
    }
  }
  // If every seed candidate was rejected the domain either has no valid area
  // or is extremely constrained; the algorithm returns an empty array, which
  // is the correct result for a fully-rejected domain.

  while (active.length > 0) {
    const activeIdx = rng.int(0, active.length - 1);
    const pIdx = active[activeIdx];
    const p = points[pIdx];
    let found = false;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const angle = rng.float(0, Math.PI * 2);
      const radius = rng.float(minRadius, minRadius * 2);
      const nx = p.x + Math.cos(angle) * radius;
      const ny = p.y + Math.sin(angle) * radius;

      if (isValidPoint(nx, ny)) {
        addPoint(nx, ny);
        found = true;
        break;
      }
    }

    if (!found) {
      // Remove from active list (swap-and-pop for O(1))
      active[activeIdx] = active[active.length - 1];
      active.pop();
    }
  }

  return points;
}
