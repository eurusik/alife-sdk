// src/utils/Pathfinder.ts
// A* pathfinder on a 2D grid.
// Returns paths as arrays of grid coordinates (tile space).

import { Grid } from '../core/Grid.js';
import type { GridPoint } from '../core/Grid.js';

// ---------------------------------------------------------------------------
// A* node
// ---------------------------------------------------------------------------

interface AStarNode {
  x: number;
  y: number;
  g: number;  // cost from start
  f: number;  // g + h
  parent: AStarNode | null;
}

// ---------------------------------------------------------------------------
// Binary min-heap (priority queue by f-score)
// ---------------------------------------------------------------------------

class MinHeap {
  private data: AStarNode[] = [];

  push(node: AStarNode): void {
    this.data.push(node);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): AStarNode | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  get size(): number {
    return this.data.length;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.data[parent].f <= this.data[i].f) break;
      [this.data[parent], this.data[i]] = [this.data[i], this.data[parent]];
      i = parent;
    }
  }

  private sinkDown(i: number): void {
    const n = this.data.length;
    while (true) {
      const left = 2 * i + 1;
      const right = left + 1;
      let smallest = i;
      if (left < n && this.data[left].f < this.data[smallest].f) smallest = left;
      if (right < n && this.data[right].f < this.data[smallest].f) smallest = right;
      if (smallest === i) break;
      [this.data[smallest], this.data[i]] = [this.data[i], this.data[smallest]];
      i = smallest;
    }
  }
}

// ---------------------------------------------------------------------------
// Pathfinder
// ---------------------------------------------------------------------------

export interface PathfinderOptions {
  /** Cost multiplier for diagonal movement (default 1.41). */
  diagonalCost?: number;
  /** Whether diagonal movement is allowed (default true). */
  allowDiagonal?: boolean;
  /** Maximum nodes to expand before giving up (default 50000). */
  maxNodes?: number;
}

/**
 * A* pathfinder operating on a cost grid.
 *
 * The cost grid contains per-cell movement costs (1 = normal, higher = harder,
 * Infinity = impassable). A cost of 0 is treated as passable with cost 1.
 */
export class Pathfinder {
  private readonly opts: Required<PathfinderOptions>;

  constructor(opts: PathfinderOptions = {}) {
    this.opts = {
      diagonalCost: opts.diagonalCost ?? 1.41421,
      allowDiagonal: opts.allowDiagonal ?? true,
      maxNodes: opts.maxNodes ?? 50_000,
    };
  }

  /**
   * Find the shortest path from (sx, sy) to (ex, ey) using the given cost grid.
   *
   * Returns an array of GridPoints from start to end (inclusive), or null if
   * no path exists.
   *
   * The `costGrid` contains per-cell traversal costs.
   * Cells with cost === Infinity are impassable.
   */
  findPath(
    costGrid: Grid<number>,
    sx: number,
    sy: number,
    ex: number,
    ey: number,
  ): GridPoint[] | null {
    if (!costGrid.inBounds(sx, sy) || !costGrid.inBounds(ex, ey)) return null;

    const W = costGrid.width;
    const H = costGrid.height;
    const gScore = new Float32Array(W * H).fill(Infinity);
    const closed = new Uint8Array(W * H);

    const startG = 0;
    const startH = this.heuristic(sx, sy, ex, ey);
    const startNode: AStarNode = {
      x: sx, y: sy, g: startG, f: startG + startH, parent: null,
    };

    const open = new MinHeap();
    open.push(startNode);
    gScore[sy * W + sx] = 0;

    let expandedNodes = 0;

    while (open.size > 0) {
      const current = open.pop()!;
      const ci = current.y * W + current.x;

      if (closed[ci]) continue;
      closed[ci] = 1;
      expandedNodes++;

      if (current.x === ex && current.y === ey) {
        return this.reconstructPath(current);
      }

      if (expandedNodes > this.opts.maxNodes) break;

      const neighbours = this.opts.allowDiagonal
        ? costGrid.neighbours8(current.x, current.y)
        : costGrid.neighbours4(current.x, current.y);

      for (const n of neighbours) {
        const ni = n.y * W + n.x;
        if (closed[ni]) continue;

        const tileCost = costGrid.get(n.x, n.y) ?? Infinity;
        if (!isFinite(tileCost)) continue;

        const isDiag = n.x !== current.x && n.y !== current.y;
        const moveCost = isDiag ? this.opts.diagonalCost : 1.0;
        const tentativeG = current.g + moveCost * (tileCost || 1);

        if (tentativeG < gScore[ni]) {
          gScore[ni] = tentativeG;
          const h = this.heuristic(n.x, n.y, ex, ey);
          const node: AStarNode = {
            x: n.x, y: n.y, g: tentativeG, f: tentativeG + h, parent: current,
          };
          open.push(node);
        }
      }
    }

    return null;
  }

  /**
   * Octile distance heuristic — consistent and admissible for 8-connected grids.
   */
  private heuristic(ax: number, ay: number, bx: number, by: number): number {
    const dx = Math.abs(ax - bx);
    const dy = Math.abs(ay - by);
    return (dx + dy) + (this.opts.diagonalCost - 2) * Math.min(dx, dy);
  }

  private reconstructPath(node: AStarNode): GridPoint[] {
    const path: GridPoint[] = [];
    let cur: AStarNode | null = node;
    while (cur !== null) {
      path.push({ x: cur.x, y: cur.y });
      cur = cur.parent;
    }
    return path.reverse();
  }
}
