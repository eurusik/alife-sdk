// src/core/AutoTile.ts
// Bitmask resolver for autotile frames.
//
// Supports two modes:
//   4-bit:  NSEW cardinal neighbours only (16 combinations)
//   8-bit:  All 8 neighbours including diagonals (256 combinations)
//
// The resolver queries a TileTypeId grid to compute bitmasks, then asks the
// TileRegistry to produce the final TileCell.

import { type TileTypeId, type TileCell } from '../types.js';
import { Grid } from './Grid.js';
import { TileRegistry } from './TileRegistry.js';

// ---------------------------------------------------------------------------
// Bitmask bit positions for the 8 neighbours
// ---------------------------------------------------------------------------
//
//   NW  N  NE
//    W  *  E
//   SW  S  SE
//
// 4-bit (cardinal only): N=8, E=4, S=2, W=1
// 8-bit: NW=128, N=64, NE=32, W=16, E=8, SW=4, S=2, SE=1

/** 4-bit cardinal bitmask constants. */
export const BITMASK_4 = {
  N: 8,
  E: 4,
  S: 2,
  W: 1,
} as const;

/** 8-bit full bitmask constants. */
export const BITMASK_8 = {
  NW: 128,
  N:   64,
  NE:  32,
  W:   16,
  E:    8,
  SW:   4,
  S:    2,
  SE:   1,
} as const;

// ---------------------------------------------------------------------------
// AutoTile
// ---------------------------------------------------------------------------

/**
 * Computes autotile bitmasks for every cell in a tile-type grid and resolves
 * the appropriate frame from the TileRegistry.
 *
 * Two comparison strategies:
 *   'exact'    — only same tile type increments the mask
 *   'category' — a group function determines whether a neighbour "counts"
 */
export class AutoTile {
  private readonly registry: TileRegistry;

  constructor(registry: TileRegistry) {
    this.registry = registry;
  }

  // ---------------------------------------------------------------------------
  // 4-bit autotile
  // ---------------------------------------------------------------------------

  /**
   * Compute a 4-bit NSEW bitmask for cell (x, y) in the given type grid.
   * A neighbour bit is set when the neighbour tile matches the comparison function.
   */
  computeMask4(
    grid: Grid<TileTypeId>,
    x: number,
    y: number,
    isSame: (a: TileTypeId, b: TileTypeId) => boolean,
  ): number {
    const self = grid.get(x, y);
    if (self === undefined) return 0;

    let mask = 0;
    const n = grid.get(x, y - 1);
    const e = grid.get(x + 1, y);
    const s = grid.get(x, y + 1);
    const w = grid.get(x - 1, y);

    if (n !== undefined && isSame(self, n)) mask |= BITMASK_4.N;
    if (e !== undefined && isSame(self, e)) mask |= BITMASK_4.E;
    if (s !== undefined && isSame(self, s)) mask |= BITMASK_4.S;
    if (w !== undefined && isSame(self, w)) mask |= BITMASK_4.W;

    return mask;
  }

  /**
   * Compute an 8-bit full bitmask (all 8 neighbours) for cell (x, y).
   */
  computeMask8(
    grid: Grid<TileTypeId>,
    x: number,
    y: number,
    isSame: (a: TileTypeId, b: TileTypeId) => boolean,
  ): number {
    const self = grid.get(x, y);
    if (self === undefined) return 0;

    let mask = 0;
    const nw = grid.get(x - 1, y - 1);
    const n  = grid.get(x,     y - 1);
    const ne = grid.get(x + 1, y - 1);
    const w  = grid.get(x - 1, y    );
    const e  = grid.get(x + 1, y    );
    const sw = grid.get(x - 1, y + 1);
    const s  = grid.get(x,     y + 1);
    const se = grid.get(x + 1, y + 1);

    if (nw !== undefined && isSame(self, nw)) mask |= BITMASK_8.NW;
    if (n  !== undefined && isSame(self, n )) mask |= BITMASK_8.N;
    if (ne !== undefined && isSame(self, ne)) mask |= BITMASK_8.NE;
    if (w  !== undefined && isSame(self, w )) mask |= BITMASK_8.W;
    if (e  !== undefined && isSame(self, e )) mask |= BITMASK_8.E;
    if (sw !== undefined && isSame(self, sw)) mask |= BITMASK_8.SW;
    if (s  !== undefined && isSame(self, s )) mask |= BITMASK_8.S;
    if (se !== undefined && isSame(self, se)) mask |= BITMASK_8.SE;

    return mask;
  }

  // ---------------------------------------------------------------------------
  // Full-grid resolve pass
  // ---------------------------------------------------------------------------

  /**
   * Resolve all cells in a TileTypeId grid into TileCell objects,
   * applying 4-bit bitmask autotiling where the tile definition requires it.
   *
   * Returns a flat array parallel to the grid's cells array.
   * Non-autotile tiles get their base frame directly.
   * Autotile tiles get their frame from the bitmask lookup.
   *
   * The `isSame` predicate defaults to exact type equality.
   */
  resolveAll(
    grid: Grid<TileTypeId>,
    isSame: (a: TileTypeId, b: TileTypeId) => boolean = (a, b) => a === b,
  ): TileCell[] {
    const W = grid.width;
    const H = grid.height;
    const result: TileCell[] = new Array(W * H);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const id = grid.get(x, y)!;
        const def = this.registry.getDef(id);

        if (!def || def.baseFrame === -1) {
          result[y * W + x] = this.registry.empty();
          continue;
        }

        let frameIndex: number;
        if (def.autotile) {
          const mask = this.computeMask4(grid, x, y, isSame);
          frameIndex = def.baseFrame + (mask & 0xF);
        } else {
          frameIndex = def.baseFrame;
        }

        result[y * W + x] = {
          type: id,
          textureKey: def.textureKey,
          frameIndex,
          solid: def.solid,
        };
      }
    }

    return result;
  }

  /**
   * Resolve a single cell. Useful for incremental updates.
   */
  resolveCell(
    grid: Grid<TileTypeId>,
    x: number,
    y: number,
    isSame: (a: TileTypeId, b: TileTypeId) => boolean = (a, b) => a === b,
  ): TileCell {
    const id = grid.get(x, y);
    if (id === undefined) return this.registry.empty();

    const def = this.registry.getDef(id);
    if (!def || def.baseFrame === -1) return this.registry.empty();

    if (def.autotile) {
      const mask = this.computeMask4(grid, x, y, isSame);
      return {
        type: id,
        textureKey: def.textureKey,
        frameIndex: def.baseFrame + (mask & 0xF),
        solid: def.solid,
      };
    }

    return {
      type: id,
      textureKey: def.textureKey,
      frameIndex: def.baseFrame,
      solid: def.solid,
    };
  }

  // ---------------------------------------------------------------------------
  // Road-specific autotile: edge-only bitmask for road continuity
  // ---------------------------------------------------------------------------

  /**
   * Computes a 4-bit bitmask specifically for road tiles.
   * A bit is set when the neighbour is also a road (or transition tile).
   * Used to select the correct road frame (straight, corner, T-junction, cross).
   */
  computeRoadMask(grid: Grid<TileTypeId>, x: number, y: number): number {
    const ROAD_TYPES = new Set<TileTypeId>([
      'road',
      'road_dirt',
      'dirt_to_road',
      'grass_to_road',
    ] as TileTypeId[]);

    const self = grid.get(x, y);
    if (!self || !ROAD_TYPES.has(self)) return 0;

    let mask = 0;
    const n = grid.get(x, y - 1);
    const e = grid.get(x + 1, y);
    const s = grid.get(x, y + 1);
    const w = grid.get(x - 1, y);

    if (n !== undefined && ROAD_TYPES.has(n)) mask |= BITMASK_4.N;
    if (e !== undefined && ROAD_TYPES.has(e)) mask |= BITMASK_4.E;
    if (s !== undefined && ROAD_TYPES.has(s)) mask |= BITMASK_4.S;
    if (w !== undefined && ROAD_TYPES.has(w)) mask |= BITMASK_4.W;

    return mask;
  }
}
