// core/SpatialGrid.ts
// Generic spatial hash grid for efficient radius and rectangle queries.
//
// Algorithm:
//   The world is divided into axis-aligned cells of cellSize x cellSize pixels.
//   Each item hashes to exactly one cell based on its position (extracted via
//   a caller-supplied positionFn). Cells are lazily created as Maps keyed by
//   integer and pruned when empty to bound memory.
//
// Performance:
//   insert / remove / update   O(1)
//   queryRadius / queryRect    O(k), k = items in intersected cells
//   No Math.sqrt on the hot path — radius checks use squared distance.
//   Cell keys are packed integers (no string allocation).
//   Query methods reuse a scratch array to avoid per-call allocation.
//
// Generic design:
//   SpatialGrid<T> works with any item type. The caller provides a positionFn
//   that extracts a Vec2 from T, so there is no interface constraint on T.
//   Internally, items are tracked via a WeakRef-free identity Map (item -> cell key).

import type { Vec2 } from './Vec2';

export interface IRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// ---------------------------------------------------------------------------
// SpatialGrid<T>
// ---------------------------------------------------------------------------

/**
 * Spatial hash grid that supports fast radius and rectangle queries
 * over an arbitrary item type.
 *
 * @typeParam T - Any object stored in the grid. Position is extracted
 *   via the `positionFn` supplied at construction time.
 *
 * @example
 * ```ts
 * interface NPC { name: string; pos: Vec2 }
 *
 * const grid = new SpatialGrid<NPC>(200, (npc) => npc.pos);
 * grid.insert(myNpc);
 *
 * const nearby = grid.queryRadius({ x: 400, y: 300 }, 250);
 * ```
 */
export class SpatialGrid<T> {
  // ---------------------------------------------------------------------------
  // Integer key packing constants
  // ---------------------------------------------------------------------------

  /** Offset to shift cell indices into non-negative range. Supports +/-512 cells. */
  private static readonly CELL_OFFSET = 512;

  /** Stride for packing (cx, cy) into a single integer. */
  private static readonly CELL_STRIDE = 1024;

  // ---------------------------------------------------------------------------
  // Internal state
  // ---------------------------------------------------------------------------

  /** Pixel size of each square cell. */
  private readonly cellSize: number;

  /** Extracts a world-space position from an item. */
  private readonly positionFn: (item: T) => Vec2;

  /**
   * Packed integer key -> Set of items whose position hashes to that cell.
   * Cells are created lazily and deleted when they become empty.
   */
  private readonly cells: Map<number, Set<T>> = new Map();

  /**
   * item -> packed integer cell key where that item currently lives.
   * Enables O(1) lookup of the old cell in update() and remove().
   */
  private readonly itemToCell: Map<T, number> = new Map();

  /**
   * Scratch array reused by queryRadius() and queryRect() to avoid
   * allocating a new array on every call. Callers that need to hold
   * results beyond the next query should copy the returned array.
   */
  private readonly _scratchResults: T[] = [];

  // ---------------------------------------------------------------------------
  // Constructor
  // ---------------------------------------------------------------------------

  /**
   * @param cellSize   - Width and height of each grid cell in world units.
   *   A good default is 2x your most common query radius so that a centred
   *   radius query never reads more than ~9 cells.
   * @param positionFn - Pure function that extracts a Vec2 from an item.
   */
  constructor(cellSize: number, positionFn: (item: T) => Vec2) {
    if (cellSize <= 0) {
      throw new RangeError(`SpatialGrid: cellSize must be > 0, got ${cellSize}`);
    }
    this.cellSize = cellSize;
    this.positionFn = positionFn;
  }

  // ---------------------------------------------------------------------------
  // Mutation API
  // ---------------------------------------------------------------------------

  /**
   * Add an item to the grid.
   *
   * If the item is already tracked, this behaves like {@link update} to keep
   * internal state consistent.
   */
  insert(item: T): void {
    if (this.itemToCell.has(item)) {
      this.update(item);
      return;
    }

    const pos = this.positionFn(item);
    const key = this.cellKeyInt(pos.x, pos.y);
    this.addToCell(key, item);
    this.itemToCell.set(item, key);
  }

  /**
   * Remove an item from the grid.
   *
   * @returns `true` if the item was found and removed, `false` if it was not tracked.
   */
  remove(item: T): boolean {
    const key = this.itemToCell.get(item);
    if (key === undefined) return false;

    this.removeFromCell(key, item);
    this.itemToCell.delete(item);
    return true;
  }

  /**
   * Re-hash an item after its position has changed.
   *
   * If the item has not crossed a cell boundary this is a no-op.
   * If the item is not yet tracked, it is inserted automatically.
   */
  update(item: T): void {
    const pos = this.positionFn(item);
    const newKey = this.cellKeyInt(pos.x, pos.y);
    const oldKey = this.itemToCell.get(item);

    if (oldKey === undefined) {
      // Not yet tracked — insert.
      this.addToCell(newKey, item);
      this.itemToCell.set(item, newKey);
      return;
    }

    if (oldKey === newKey) {
      // Still in the same cell — nothing to do.
      return;
    }

    // Moved to a different cell — re-bucket.
    this.removeFromCell(oldKey, item);
    this.addToCell(newKey, item);
    this.itemToCell.set(item, newKey);
  }

  /** Remove all items and all cells. */
  clear(): void {
    this.cells.clear();
    this.itemToCell.clear();
  }

  // ---------------------------------------------------------------------------
  // Query API
  // ---------------------------------------------------------------------------

  /**
   * Return all items within `radius` world-units of `center`.
   *
   * **Note:** The returned array is reused between calls. Callers that need
   * to hold the result beyond the next query should copy it (e.g. `[...result]`).
   *
   * Algorithm:
   *   1. Compute the cell-space AABB that covers the bounding box of the circle.
   *   2. Iterate that rectangular band of cells.
   *   3. Filter each candidate by exact squared distance (no sqrt).
   */
  queryRadius(center: Vec2, radius: number): T[] {
    const radiusSq = radius * radius;
    const results = this._scratchResults;
    results.length = 0;

    const minCX = Math.floor((center.x - radius) / this.cellSize);
    const minCY = Math.floor((center.y - radius) / this.cellSize);
    const maxCX = Math.floor((center.x + radius) / this.cellSize);
    const maxCY = Math.floor((center.y + radius) / this.cellSize);

    for (let cy = minCY; cy <= maxCY; cy++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        const cell = this.cells.get(
          (cx + SpatialGrid.CELL_OFFSET) * SpatialGrid.CELL_STRIDE +
            (cy + SpatialGrid.CELL_OFFSET),
        );
        if (!cell) continue;

        for (const item of cell) {
          const pos = this.positionFn(item);
          const dx = pos.x - center.x;
          const dy = pos.y - center.y;
          if (dx * dx + dy * dy <= radiusSq) {
            results.push(item);
          }
        }
      }
    }

    return results;
  }

  /**
   * Return all items whose position lies within the axis-aligned rectangle
   * defined by its top-left corner (x, y) and dimensions (width x height).
   *
   * **Note:** The returned array is reused between calls. Callers that need
   * to hold the result beyond the next query should copy it (e.g. `[...result]`).
   */
  queryRect(bounds: IRect): T[] {
    const { x, y, width, height } = bounds;
    const right = x + width;
    const bottom = y + height;
    const results = this._scratchResults;
    results.length = 0;

    const minCX = Math.floor(x / this.cellSize);
    const minCY = Math.floor(y / this.cellSize);
    const maxCX = Math.floor(right / this.cellSize);
    const maxCY = Math.floor(bottom / this.cellSize);

    for (let cy = minCY; cy <= maxCY; cy++) {
      for (let cx = minCX; cx <= maxCX; cx++) {
        const cell = this.cells.get(
          (cx + SpatialGrid.CELL_OFFSET) * SpatialGrid.CELL_STRIDE +
            (cy + SpatialGrid.CELL_OFFSET),
        );
        if (!cell) continue;

        for (const item of cell) {
          const pos = this.positionFn(item);
          if (pos.x >= x && pos.x <= right && pos.y >= y && pos.y <= bottom) {
            results.push(item);
          }
        }
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Diagnostics
  // ---------------------------------------------------------------------------

  /** Total number of items currently tracked by the grid. */
  get size(): number {
    return this.itemToCell.size;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Pack cell coordinates (cx, cy) into a single non-negative integer.
   * Supports cell indices in the range [-512, +511].
   */
  private cellKeyInt(x: number, y: number): number {
    let cx = Math.floor(x / this.cellSize);
    let cy = Math.floor(y / this.cellSize);
    cx = Math.max(-512, Math.min(511, cx));
    cy = Math.max(-512, Math.min(511, cy));
    return (cx + SpatialGrid.CELL_OFFSET) * SpatialGrid.CELL_STRIDE + (cy + SpatialGrid.CELL_OFFSET);
  }

  /** Add an item to the cell identified by `key`, creating the cell lazily. */
  private addToCell(key: number, item: T): void {
    let cell = this.cells.get(key);
    if (!cell) {
      cell = new Set<T>();
      this.cells.set(key, cell);
    }
    cell.add(item);
  }

  /**
   * Remove an item from the cell at `key`.
   * Prunes the cell if it becomes empty to prevent unbounded growth.
   */
  private removeFromCell(key: number, item: T): void {
    const cell = this.cells.get(key);
    if (!cell) return;

    cell.delete(item);

    if (cell.size === 0) {
      this.cells.delete(key);
    }
  }
}
