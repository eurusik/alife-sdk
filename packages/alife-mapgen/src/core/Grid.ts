// src/core/Grid.ts
// Generic 2D grid with typed cells.
// Column-major flat storage: index = y * width + x
// Exposes neighbour enumeration, flood-fill, line-of-sight, and region queries.

/** Directional offsets for 4-connectivity. */
const DIRS_4 = [
  { dx: 0, dy: -1 },  // N
  { dx: 1, dy: 0 },   // E
  { dx: 0, dy: 1 },   // S
  { dx: -1, dy: 0 },  // W
] as const;

/** Directional offsets for 8-connectivity (includes diagonals). */
const DIRS_8 = [
  { dx: 0, dy: -1 },   // N
  { dx: 1, dy: -1 },   // NE
  { dx: 1, dy: 0 },    // E
  { dx: 1, dy: 1 },    // SE
  { dx: 0, dy: 1 },    // S
  { dx: -1, dy: 1 },   // SW
  { dx: -1, dy: 0 },   // W
  { dx: -1, dy: -1 },  // NW
] as const;

export interface GridPoint {
  x: number;
  y: number;
}

/**
 * Generic 2D grid backed by a flat typed array (or a regular array for complex types).
 *
 * T should be a primitive, enum, or object reference.
 * For performance-critical numeric grids, prefer Float32Grid / Uint8Grid subtypes.
 */
export class Grid<T> {
  readonly width: number;
  readonly height: number;
  protected readonly cells: T[];

  constructor(width: number, height: number, fill: T) {
    this.width = width;
    this.height = height;
    this.cells = new Array<T>(width * height).fill(fill);
  }

  /** Convert (x, y) to flat index. No bounds check. */
  index(x: number, y: number): number {
    return y * this.width + x;
  }

  /** True if (x, y) is inside the grid. */
  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  /** Get cell at (x, y). Returns `undefined` if out of bounds. */
  get(x: number, y: number): T | undefined {
    if (!this.inBounds(x, y)) return undefined;
    return this.cells[this.index(x, y)];
  }

  /** Get cell at (x, y), throwing on out-of-bounds. */
  getStrict(x: number, y: number): T {
    if (!this.inBounds(x, y)) {
      throw new RangeError(`Grid.getStrict: (${x}, ${y}) out of bounds [${this.width}x${this.height}]`);
    }
    return this.cells[this.index(x, y)];
  }

  /** Set cell at (x, y). Silently ignores out-of-bounds. */
  set(x: number, y: number, value: T): void {
    if (!this.inBounds(x, y)) return;
    this.cells[this.index(x, y)] = value;
  }

  /** Fill a rectangular region with a value. Clamps to grid bounds. */
  fillRect(x: number, y: number, w: number, h: number, value: T): void {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(this.width, x + w);
    const y1 = Math.min(this.height, y + h);
    for (let cy = y0; cy < y1; cy++) {
      for (let cx = x0; cx < x1; cx++) {
        this.cells[cy * this.width + cx] = value;
      }
    }
  }

  /** Fill every cell with a value. */
  fill(value: T): void {
    this.cells.fill(value);
  }

  /** Get 4-connected neighbours that are in-bounds. */
  neighbours4(x: number, y: number): GridPoint[] {
    const result: GridPoint[] = [];
    for (const { dx, dy } of DIRS_4) {
      const nx = x + dx;
      const ny = y + dy;
      if (this.inBounds(nx, ny)) result.push({ x: nx, y: ny });
    }
    return result;
  }

  /** Get 8-connected neighbours that are in-bounds. */
  neighbours8(x: number, y: number): GridPoint[] {
    const result: GridPoint[] = [];
    for (const { dx, dy } of DIRS_8) {
      const nx = x + dx;
      const ny = y + dy;
      if (this.inBounds(nx, ny)) result.push({ x: nx, y: ny });
    }
    return result;
  }

  /**
   * BFS flood-fill starting from (sx, sy), visiting cells where `predicate` is true.
   * Returns all visited cells including the start (if predicate passes).
   */
  floodFill(sx: number, sy: number, predicate: (v: T, x: number, y: number) => boolean): GridPoint[] {
    const startVal = this.get(sx, sy);
    if (startVal === undefined || !predicate(startVal, sx, sy)) return [];

    const visited = new Set<number>();
    const queue: GridPoint[] = [{ x: sx, y: sy }];
    visited.add(this.index(sx, sy));
    const result: GridPoint[] = [];

    while (queue.length > 0) {
      const { x, y } = queue.shift()!;
      result.push({ x, y });

      for (const n of this.neighbours4(x, y)) {
        const ni = this.index(n.x, n.y);
        if (visited.has(ni)) continue;
        const nv = this.cells[ni];
        if (predicate(nv, n.x, n.y)) {
          visited.add(ni);
          queue.push(n);
        }
      }
    }
    return result;
  }

  /**
   * Returns all connected regions where `predicate` is satisfied.
   * Each inner array is one contiguous region.
   */
  findRegions(predicate: (v: T, x: number, y: number) => boolean): GridPoint[][] {
    const visited = new Uint8Array(this.width * this.height);
    const regions: GridPoint[][] = [];

    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const i = y * this.width + x;
        if (visited[i]) continue;
        const v = this.cells[i];
        if (!predicate(v, x, y)) continue;

        // BFS from here
        const region: GridPoint[] = [];
        const queue: GridPoint[] = [{ x, y }];
        visited[i] = 1;

        while (queue.length > 0) {
          const cur = queue.shift()!;
          region.push(cur);
          for (const n of this.neighbours4(cur.x, cur.y)) {
            const ni = n.y * this.width + n.x;
            if (visited[ni]) continue;
            const nv = this.cells[ni];
            if (predicate(nv, n.x, n.y)) {
              visited[ni] = 1;
              queue.push(n);
            }
          }
        }
        regions.push(region);
      }
    }
    return regions;
  }

  /**
   * Bresenham line rasterization — returns all grid cells along the line from
   * (x0, y0) to (x1, y1) inclusive.
   */
  rasterizeLine(x0: number, y0: number, x1: number, y1: number): GridPoint[] {
    const points: GridPoint[] = [];
    let dx = Math.abs(x1 - x0);
    let dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    let cx = x0;
    let cy = y0;

    while (true) {
      if (this.inBounds(cx, cy)) points.push({ x: cx, y: cy });
      if (cx === x1 && cy === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; cx += sx; }
      if (e2 < dx)  { err += dx; cy += sy; }
    }
    return points;
  }

  /**
   * Apply a function to every cell, setting the cell to the returned value.
   */
  map(fn: (v: T, x: number, y: number) => T): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.cells[y * this.width + x] = fn(this.cells[y * this.width + x], x, y);
      }
    }
  }

  /**
   * Collect all cells matching a predicate, along with their coordinates.
   */
  query(predicate: (v: T, x: number, y: number) => boolean): Array<{ x: number; y: number; value: T }> {
    const result: Array<{ x: number; y: number; value: T }> = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const v = this.cells[y * this.width + x];
        if (predicate(v, x, y)) result.push({ x, y, value: v });
      }
    }
    return result;
  }

  /** Return a deep copy of this grid. */
  clone(): Grid<T> {
    const copy = new Grid<T>(this.width, this.height, this.cells[0]);
    for (let i = 0; i < this.cells.length; i++) {
      copy.cells[i] = this.cells[i];
    }
    return copy;
  }

  /** Expose the raw flat array for bulk operations. Read-only intent. */
  rawCells(): ReadonlyArray<T> {
    return this.cells;
  }
}
