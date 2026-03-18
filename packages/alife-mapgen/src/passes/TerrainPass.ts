// src/passes/TerrainPass.ts
// Pass 2: TERRAIN — fill ground tiles, paint zone floors, run autotile bitmask,
// inject transition tiles between incompatible tile type neighbours.
//
// Input:  roadGrid + zoneGrid from MacroPass, templateResults
// Output: resolved TileLayer[] for ground, roads, transitions

import { Grid } from '../core/Grid.js';
import { AutoTile } from '../core/AutoTile.js';
import { TileRegistry } from '../core/TileRegistry.js';
import {
  TileType,
  type TileTypeId,
  type TileLayer,
  type TileCell,
} from '../types.js';
import type { ZoneDefinition } from '../types.js';
import type { TemplateResult, TilePaintOp } from '../zones/ZoneTemplate.js';
import type { Rng } from '../core/Rng.js';

// ---------------------------------------------------------------------------
// TerrainPass output
// ---------------------------------------------------------------------------

export interface TerrainPassResult {
  layers: TileLayer[];
  /** Final logical type grid (used by PropsPass for placement constraints). */
  typeGrid: Grid<TileTypeId>;
}

// ---------------------------------------------------------------------------
// TerrainPass
// ---------------------------------------------------------------------------

export class TerrainPass {
  private readonly registry: TileRegistry;
  private readonly autoTile: AutoTile;

  constructor(registry: TileRegistry) {
    this.registry = registry;
    this.autoTile = new AutoTile(registry);
  }

  /**
   * Run Pass 2: resolve tile types to TileCell arrays, building all layers.
   */
  run(
    mapWidth: number,
    mapHeight: number,
    roadGrid: Grid<TileTypeId>,
    zoneGrid: Grid<number>,
    zones: ZoneDefinition[],
    templateResults: Map<string, TemplateResult>,
    rng: Rng,
  ): TerrainPassResult {
    // Step 1: Build the logical type grid for ground layer
    const groundTypeGrid = this.buildGroundTypeGrid(
      mapWidth, mapHeight, roadGrid, zoneGrid, zones, templateResults, rng,
    );

    // Step 2: Build road type grid (overlay on top of ground)
    const roadTypeGrid = this.buildRoadTypeGrid(mapWidth, mapHeight, roadGrid);

    // Step 3: Inject transitions where incompatible tiles meet
    const transitionTypeGrid = this.buildTransitionGrid(
      mapWidth, mapHeight, groundTypeGrid, roadTypeGrid,
    );

    // Step 4: Autotile resolve — produce TileCells
    const groundCells = this.autoTile.resolveAll(groundTypeGrid);
    const roadCells   = this.autoTile.resolveAll(roadTypeGrid);
    const transitionCells = this.resolveTransitionLayer(
      mapWidth, mapHeight, transitionTypeGrid,
    );

    // Step 5: Build object layer from template paint ops
    const objectTypeGrid = this.buildObjectTypeGrid(
      mapWidth, mapHeight, zoneGrid, zones, templateResults,
    );
    const objectCells = this.autoTile.resolveAll(objectTypeGrid);

    // Merge final logical type grid (ground + road override)
    const mergedGrid = groundTypeGrid.clone();
    for (let y = 0; y < mapHeight; y++) {
      for (let x = 0; x < mapWidth; x++) {
        const rt = roadTypeGrid.get(x, y);
        if (rt && rt !== TileType.GRASS_LIGHT) {
          mergedGrid.set(x, y, rt);
        }
      }
    }

    const layers: TileLayer[] = [
      { id: 'ground',      cells: groundCells,     depth: 0 },
      { id: 'roads',       cells: roadCells,        depth: 1 },
      { id: 'transitions', cells: transitionCells,  depth: 2 },
      { id: 'objects',     cells: objectCells,      depth: 3 },
    ];

    return { layers, typeGrid: mergedGrid };
  }

  // ---------------------------------------------------------------------------
  // Ground type grid
  // ---------------------------------------------------------------------------

  private buildGroundTypeGrid(
    W: number,
    H: number,
    roadGrid: Grid<TileTypeId>,
    _zoneGrid: Grid<number>,
    zones: ZoneDefinition[],
    templateResults: Map<string, TemplateResult>,
    rng: Rng,
  ): Grid<TileTypeId> {
    const grid = new Grid<TileTypeId>(W, H, TileType.GRASS_LIGHT);

    // Scatter light/dark grass variation using simple noise pattern
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // Deterministic variation: darker patches using position-based hash
        const hash = ((x * 7 + y * 13) ^ (x * 3)) & 0xFF;
        if (hash < 30) {
          grid.set(x, y, TileType.GRASS_DARK);
        }
      }
    }

    // Paint zone ground tiles from templates
    for (let i = 0; i < zones.length; i++) {
      const zone = zones[i];
      const result = templateResults.get(zone.id);
      if (!result) continue;

      const ox = zone.tileBounds.x;
      const oy = zone.tileBounds.y;

      for (const op of result.tiles) {
        if (op.layer !== 'ground') continue;
        grid.set(ox + op.x, oy + op.y, op.type);
      }
    }

    // Override road cells in zone interiors (roads cut through zones)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const rt = roadGrid.get(x, y);
        if (rt && (rt === TileType.ROAD || rt === TileType.ROAD_DIRT)) {
          // Don't overwrite zone concrete with grass — road layer handles this
        }
      }
    }

    void rng; // used for future variation
    return grid;
  }

  // ---------------------------------------------------------------------------
  // Road type grid
  // ---------------------------------------------------------------------------

  private buildRoadTypeGrid(
    W: number,
    H: number,
    roadGrid: Grid<TileTypeId>,
  ): Grid<TileTypeId> {
    const grid = new Grid<TileTypeId>(W, H, TileType.EMPTY);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const rt = roadGrid.get(x, y);
        if (rt && rt !== TileType.GRASS_LIGHT) {
          grid.set(x, y, rt);
        }
      }
    }
    return grid;
  }

  // ---------------------------------------------------------------------------
  // Transition grid
  // ---------------------------------------------------------------------------

  /**
   * Scan borders between ground and road layers and inject transition tiles.
   */
  private buildTransitionGrid(
    W: number,
    H: number,
    groundGrid: Grid<TileTypeId>,
    roadGrid: Grid<TileTypeId>,
  ): Grid<TileTypeId> {
    const grid = new Grid<TileTypeId>(W, H, TileType.EMPTY);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const roadType = roadGrid.get(x, y);
        if (!roadType || roadType === TileType.EMPTY) continue;

        // This is a road cell — check each cardinal neighbour for a grass ground cell
        for (const { nx, ny } of [
          { nx: x, ny: y - 1 },
          { nx: x + 1, ny: y },
          { nx: x, ny: y + 1 },
          { nx: x - 1, ny: y },
        ]) {
          if (!groundGrid.inBounds(nx, ny)) continue;
          const neighbourRoad = roadGrid.get(nx, ny);
          if (neighbourRoad && neighbourRoad !== TileType.EMPTY) continue;

          const groundType = groundGrid.get(nx, ny);
          if (!groundType) continue;

          const transitionType = this.registry.getTransition(groundType, roadType);
          if (transitionType) {
            grid.set(nx, ny, transitionType);
          }
        }
      }
    }

    // Also inject grass↔dirt transitions at zone borders
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const gt = groundGrid.get(x, y);
        if (!gt) continue;

        for (const { nx, ny } of [
          { nx: x + 1, ny: y },
          { nx: x, ny: y + 1 },
        ]) {
          if (!groundGrid.inBounds(nx, ny)) continue;
          const ngt = groundGrid.get(nx, ny);
          if (!ngt || ngt === gt) continue;

          const transitionType = this.registry.getTransition(gt, ngt);
          if (transitionType && grid.get(x, y) === TileType.EMPTY) {
            // Place transition at the boundary cell
            grid.set(x, y, transitionType);
          }
        }
      }
    }

    return grid;
  }

  // ---------------------------------------------------------------------------
  // Transition layer resolution
  // ---------------------------------------------------------------------------

  private resolveTransitionLayer(
    W: number,
    H: number,
    transitionTypeGrid: Grid<TileTypeId>,
  ): TileCell[] {
    const cells: TileCell[] = new Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = transitionTypeGrid.get(x, y);
        if (!t || t === TileType.EMPTY) {
          cells[y * W + x] = this.registry.empty();
        } else {
          cells[y * W + x] = this.registry.resolve(t, 0);
        }
      }
    }
    return cells;
  }

  // ---------------------------------------------------------------------------
  // Object type grid (zone interior objects layer)
  // ---------------------------------------------------------------------------

  private buildObjectTypeGrid(
    W: number,
    H: number,
    _zoneGrid: Grid<number>,
    zones: ZoneDefinition[],
    templateResults: Map<string, TemplateResult>,
  ): Grid<TileTypeId> {
    const grid = new Grid<TileTypeId>(W, H, TileType.EMPTY);

    for (let i = 0; i < zones.length; i++) {
      const zone = zones[i];
      const result = templateResults.get(zone.id);
      if (!result) continue;

      const ox = zone.tileBounds.x;
      const oy = zone.tileBounds.y;

      for (const op of result.tiles) {
        if (op.layer !== 'objects' && op.layer !== 'roads') continue;
        grid.set(ox + op.x, oy + op.y, op.type);
      }
    }

    return grid;
  }

  // ---------------------------------------------------------------------------
  // Utility: build a paint op list for the "roads" sublayer from the road grid
  // ---------------------------------------------------------------------------

  buildRoadPaintOps(
    roadGrid: Grid<TileTypeId>,
  ): TilePaintOp[] {
    const ops: TilePaintOp[] = [];
    for (let y = 0; y < roadGrid.height; y++) {
      for (let x = 0; x < roadGrid.width; x++) {
        const t = roadGrid.get(x, y);
        if (t && t !== TileType.GRASS_LIGHT && t !== TileType.EMPTY) {
          ops.push({ x, y, type: t, layer: 'roads' });
        }
      }
    }
    return ops;
  }
}
