// src/passes/PropsPass.ts
// Pass 3: PROPS — scatter trees, barrels, cars, and decoratives with Poisson disk.
//
// Rules:
//   - Trees cluster naturally using Poisson disk in open grass areas
//   - Barrels come from zone template instructions
//   - Cars only placed near roads (within 2 tiles)
//   - No props overlap with roads, zone structures, or each other (footprint check)
//   - Template props take priority; Poisson fills in the remainder

import { poissonDisk } from '../utils/PoissonDisk.js';
import { Grid } from '../core/Grid.js';
import {
  TileType,
  type PropPlacement,
  type CoverPoint,
  type SpawnPoint,
  type ColliderDef,
  type ZoneDefinition,
  type PropGenConfig,
  type TileTypeId,
} from '../types.js';
import type { TemplateResult, PropPaintOp } from '../zones/ZoneTemplate.js';
import type { Rng } from '../core/Rng.js';

// ---------------------------------------------------------------------------
// PropsPass output
// ---------------------------------------------------------------------------

export interface PropsPassResult {
  props: PropPlacement[];
  coverPoints: CoverPoint[];
  npcSpawns: SpawnPoint[];
  colliders: ColliderDef[];
  playerSpawn: { x: number; y: number };
}

// ---------------------------------------------------------------------------
// Texture key constants (must match Phaser preload keys)
// ---------------------------------------------------------------------------

const TEXTURES = {
  tree:        'nature_tree',
  grassTuft:   'nature_grass_tufts',
  barrel:      'objects_barrels',
  car:         'objects_cars',
  fenceWood:   'objects_wood_fence',
  fenceConcrete:'objects_concrete_fence',
  gate:        'objects_metal_gate',
  chest:       'objects_chest',
} as const;

// ---------------------------------------------------------------------------
// Footprint registry (pixels)
// ---------------------------------------------------------------------------

const FOOTPRINTS: Record<string, { w: number; h: number }> = {
  tree:            { w: 20, h: 20 },
  grass_tuft:      { w: 8,  h: 8  },
  barrel:          { w: 16, h: 16 },
  car:             { w: 48, h: 56 },
  fence_wood:      { w: 16, h: 8  },
  fence_concrete:  { w: 16, h: 8  },
  gate:            { w: 48, h: 16 },
  chest:           { w: 24, h: 20 },
  building:        { w: 64, h: 64 },
  interior_object: { w: 16, h: 16 },
  tent:            { w: 80, h: 56 },
  shack:           { w: 56, h: 64 },
  bunker_building: { w: 64, h: 56 },
  sandbag:         { w: 32, h: 16 },
  crate_wood:      { w: 20, h: 20 },
  crate_military:  { w: 24, h: 20 },
  barrel_hazmat:   { w: 20, h: 24 },
  jerrycan:        { w: 12, h: 16 },
  junk_pile:       { w: 48, h: 36 },
  sign:            { w: 16, h: 8  },
  power_pole:      { w: 16, h: 16 },
  lamp_post:       { w: 12, h: 12 },
  metal_gate:      { w: 48, h: 24 },
  barrier:         { w: 40, h: 16 },
  rubble:          { w: 28, h: 20 },
  skeleton:        { w: 32, h: 40 },
  bones:           { w: 20, h: 16 },
  skull_bull:      { w: 24, h: 24 },
  planks:          { w: 32, h: 20 },
  logs:            { w: 36, h: 24 },
  rope:            { w: 20, h: 20 },
  manhole:         { w: 20, h: 20 },
  trash_bags:      { w: 28, h: 20 },
  wall_ruin:       { w: 48, h: 40 },
  truck:           { w: 80, h: 40 },
};

// ---------------------------------------------------------------------------
// PropsPass
// ---------------------------------------------------------------------------

export class PropsPass {
  /**
   * Run Pass 3: populate all prop placements, cover points, colliders, and spawns.
   */
  run(
    mapWidth: number,
    mapHeight: number,
    tileSize: number,
    typeGrid: Grid<TileTypeId>,
    zones: ZoneDefinition[],
    templateResults: Map<string, TemplateResult>,
    config: PropGenConfig,
    rng: Rng,
  ): PropsPassResult {
    const props: PropPlacement[] = [];
    const coverPoints: CoverPoint[] = [];
    const npcSpawns: SpawnPoint[] = [];
    const colliders: ColliderDef[] = [];

    const mapPixelW = mapWidth * tileSize;
    const mapPixelH = mapHeight * tileSize;

    // Build occupation map (pixel-space, for footprint checks)
    // We use a coarse grid of 8px cells for fast overlap checks
    const cellSize = 8;
    const occCols = Math.ceil(mapPixelW / cellSize);
    const occRows = Math.ceil(mapPixelH / cellSize);
    const occupied = new Uint8Array(occCols * occRows);

    function markOccupied(px: number, py: number, fw: number, fh: number): void {
      const x0 = Math.max(0, Math.floor((px - fw / 2) / cellSize));
      const y0 = Math.max(0, Math.floor((py - fh / 2) / cellSize));
      const x1 = Math.min(occCols - 1, Math.ceil((px + fw / 2) / cellSize));
      const y1 = Math.min(occRows - 1, Math.ceil((py + fh / 2) / cellSize));
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          occupied[cy * occCols + cx] = 1;
        }
      }
    }

    function isOccupied(px: number, py: number, fw: number, fh: number): boolean {
      const x0 = Math.max(0, Math.floor((px - fw / 2) / cellSize));
      const y0 = Math.max(0, Math.floor((py - fh / 2) / cellSize));
      const x1 = Math.min(occCols - 1, Math.ceil((px + fw / 2) / cellSize));
      const y1 = Math.min(occRows - 1, Math.ceil((py + fh / 2) / cellSize));
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          if (occupied[cy * occCols + cx]) return true;
        }
      }
      return false;
    }

    // Mark roads as occupied so no props land on them
    for (let ty = 0; ty < mapHeight; ty++) {
      for (let tx = 0; tx < mapWidth; tx++) {
        const t = typeGrid.get(tx, ty);
        if (t === TileType.ROAD || t === TileType.ROAD_DIRT || t === TileType.ASPHALT) {
          const px = tx * tileSize + tileSize / 2;
          const py = ty * tileSize + tileSize / 2;
          markOccupied(px, py, tileSize, tileSize);
        }
      }
    }

    // Step 1: Place template props for each zone
    let propIdCounter = 0;

    for (const zone of zones) {
      const result = templateResults.get(zone.id);
      if (!result) continue;

      const ox = zone.tileBounds.x * tileSize;
      const oy = zone.tileBounds.y * tileSize;

      for (const op of result.props) {
        const px = ox + op.rx * tileSize + tileSize / 2;
        const py = oy + op.ry * tileSize + tileSize / 2;
        const footprint = FOOTPRINTS[op.propType] ?? { w: 16, h: 16 };

        const prop = this.makeProp(
          `prop_${propIdCounter++}`,
          op, px, py, zone.id, footprint,
        );
        props.push(prop);
        markOccupied(px, py, footprint.w, footprint.h);

        if (op.solid) {
          colliders.push({
            x: px - footprint.w / 2,
            y: py - footprint.h / 2,
            width: footprint.w,
            height: footprint.h,
            source: 'prop',
            sourceId: prop.id,
          });
        }
      }

      // Cover points from template
      // Guard: discard any cover op whose world-pixel position falls outside the
      // zone's pixel bounds.  buildingCoverOps() places points one tile outside
      // building corners; when a building sits within 1 tile of the zone edge
      // the computed rx/ry can be negative or exceed the zone dimension, which
      // produces off-map world coordinates (e.g. y=-97).  NPCs seeking those
      // points run toward them, appearing to flee instead of taking cover.
      const zonePxX = zone.pixelBounds.x;
      const zonePxY = zone.pixelBounds.y;
      const zonePxW = zone.pixelBounds.width;
      const zonePxH = zone.pixelBounds.height;
      let coverIdCounter = 0;
      for (const op of result.coverOps) {
        const px = ox + op.rx * tileSize + tileSize / 2;
        const py = oy + op.ry * tileSize + tileSize / 2;
        // Reject points that land outside the zone's pixel rectangle.
        if (px < zonePxX || px > zonePxX + zonePxW ||
            py < zonePxY || py > zonePxY + zonePxH) {
          continue;
        }
        coverPoints.push({
          id: `cover_${zone.id}_${coverIdCounter++}`,
          x: px,
          y: py,
          facingAngle: op.facingAngle,
          radius: op.radius,
          zoneId: zone.id,
        });
      }

      // NPC spawns from template
      for (const op of result.spawnOps) {
        const px = ox + op.rx * tileSize + tileSize / 2;
        const py = oy + op.ry * tileSize + tileSize / 2;
        npcSpawns.push({
          id: `spawn_${zone.id}_${op.entityId}`,
          entityId: op.entityId.startsWith('__zone_') ? `${zone.id}_${op.entityId}` : op.entityId,
          factionId: zone.factionId,
          x: px,
          y: py,
          zoneId: zone.id,
        });
      }

      // Zone boundary collider
      colliders.push({
        x: zone.pixelBounds.x,
        y: zone.pixelBounds.y,
        width: zone.pixelBounds.width,
        height: zone.pixelBounds.height,
        source: 'zone',
        sourceId: zone.id,
      });
    }

    // Step 2: Scatter abandoned cars near roads (before trees so trees don't overlap)
    const carRng = rng.fork('cars');
    const roadAdjacentSpots: Array<{ x: number; y: number }> = [];

    for (let ty = 0; ty < mapHeight; ty++) {
      for (let tx = 0; tx < mapWidth; tx++) {
        const t = typeGrid.get(tx, ty);
        if (t === TileType.ROAD || t === TileType.ROAD_DIRT || t === TileType.ASPHALT ||
            t === TileType.DIRT_TO_ROAD || t === TileType.GRASS_TO_ROAD ||
            t === TileType.CONCRETE || t === TileType.BLOCKED) continue;

        let nearRoad = false;
        for (let dy = -2; dy <= 2 && !nearRoad; dy++) {
          for (let dx = -2; dx <= 2 && !nearRoad; dx++) {
            const nt = typeGrid.get(tx + dx, ty + dy);
            if (
              nt === TileType.ROAD || nt === TileType.ROAD_DIRT ||
              nt === TileType.ASPHALT || nt === TileType.DIRT_TO_ROAD ||
              nt === TileType.GRASS_TO_ROAD
            ) {
              nearRoad = true;
            }
          }
        }
        if (nearRoad) {
          roadAdjacentSpots.push({
            x: tx * tileSize + tileSize / 2,
            y: ty * tileSize + tileSize / 2,
          });
        }
      }
    }

    carRng.shuffle(roadAdjacentSpots);
    const carFp = FOOTPRINTS['car'];
    const maxCars = Math.min(5, Math.max(2, Math.floor(roadAdjacentSpots.length * 0.005)));
    let lastCarVariant = -1;

    for (let i = 0, carsPlaced = 0; i < roadAdjacentSpots.length && carsPlaced < maxCars; i++) {
      const spot = roadAdjacentSpots[i];
      if (isOccupied(spot.x, spot.y, carFp.w, carFp.h)) continue;

      // Pick variant, avoid same color twice in a row
      let variant = carRng.int(0, 3);
      if (variant === lastCarVariant) variant = (variant + 1) % 4;
      lastCarVariant = variant;

      const carPropId = `prop_${propIdCounter++}`;
      props.push({
        id: carPropId,
        type: 'car',
        textureKey: TEXTURES.car,
        frameIndex: variant,
        x: spot.x,
        y: spot.y,
        depth: 3,
        solid: true,
        footprintW: carFp.w,
        footprintH: carFp.h,
        lootable: false,
      });
      // Mark larger area so trees don't grow on top of cars
      markOccupied(spot.x, spot.y, carFp.w + 16, carFp.h + 16);
      colliders.push({
        x: spot.x - carFp.w / 2,
        y: spot.y - carFp.h / 2,
        width: carFp.w,
        height: carFp.h,
        source: 'prop',
        sourceId: carPropId,
      });
      carsPlaced++;
    }

    // Step 3: Poisson disk tree scatter in open grass areas
    const treePoissonRng = rng.fork('trees');
    const treePoints = poissonDisk(
      {
        width: mapPixelW,
        height: mapPixelH,
        minRadius: config.poissonRadius,
        rng: treePoissonRng,
      },
      (px, py) => {
        const tx = Math.floor(px / tileSize);
        const ty = Math.floor(py / tileSize);
        const t = typeGrid.get(tx, ty);
        // Only on grass, not occupied
        if (t !== TileType.GRASS_LIGHT && t !== TileType.GRASS_DARK) return false;
        if (isOccupied(px, py, 24, 24)) return false;
        return true;
      },
    );

    // Throttle to density target
    const maxTrees = Math.round((mapWidth * mapHeight * config.treeDensity) / 100);
    const shuffledTrees = treePoints.slice(0, Math.min(treePoints.length, maxTrees));
    treePoissonRng.shuffle(shuffledTrees);

    for (const pt of shuffledTrees) {
      const fp = FOOTPRINTS['tree'];
      const frameIndex = rng.int(0, 2);
      const op: PropPaintOp = {
        rx: 0, ry: 0,
        propType: 'tree',
        frameIndex,
        textureKey: TEXTURES.tree,
        solid: true,
        lootable: false,
        footprintW: fp.w,
        footprintH: fp.h,
      };
      const prop = this.makeProp(
        `prop_${propIdCounter++}`, op, pt.x, pt.y, undefined, fp,
      );
      props.push(prop);
      markOccupied(pt.x, pt.y, fp.w + 8, fp.h + 8);

      colliders.push({
        x: pt.x - fp.w / 2,
        y: pt.y - fp.h / 2,
        width: fp.w,
        height: fp.h,
        source: 'prop',
        sourceId: prop.id,
      });
    }

    // Step 4: Grass tufts scatter (decorative, no collision)
    const grassRng = rng.fork('grass');
    const grassPoints = poissonDisk(
      {
        width: mapPixelW,
        height: mapPixelH,
        minRadius: config.poissonRadius * 0.5,
        rng: grassRng,
      },
      (px, py) => {
        const tx = Math.floor(px / tileSize);
        const ty = Math.floor(py / tileSize);
        const t = typeGrid.get(tx, ty);
        if (t !== TileType.GRASS_LIGHT && t !== TileType.GRASS_DARK) return false;
        if (isOccupied(px, py, 8, 8)) return false;
        return true;
      },
    );

    const maxGrass = Math.round((mapWidth * mapHeight * config.grassDensity) / 100);
    for (const pt of grassPoints.slice(0, maxGrass)) {
      props.push({
        id: `prop_${propIdCounter++}`,
        type: 'grass_tuft',
        textureKey: TEXTURES.grassTuft,
        frameIndex: rng.int(0, 3),
        x: pt.x,
        y: pt.y,
        depth: 1.5,
        solid: false,
        footprintW: 8,
        footprintH: 8,
        lootable: false,
      });
    }

    // Step 5: Determine player spawn (from first isPlayerSpawnZone zone center)
    const playerZone = zones.find(z => z.isPlayerSpawnZone) ?? zones[0];
    const playerSpawn = playerZone
      ? {
          x: playerZone.pixelBounds.x + playerZone.pixelBounds.width * 0.25,
          y: playerZone.pixelBounds.y + playerZone.pixelBounds.height * 0.5,
        }
      : { x: mapPixelW / 2, y: mapPixelH / 2 };

    return { props, coverPoints, npcSpawns, colliders, playerSpawn };
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private makeProp(
    id: string,
    op: PropPaintOp,
    px: number,
    py: number,
    zoneId: string | undefined,
    footprint: { w: number; h: number },
  ): PropPlacement {
    return {
      id,
      type: op.propType as PropPlacement['type'],
      textureKey: op.textureKey,
      frameIndex: op.frameIndex,
      x: px,
      y: py,
      depth: op.solid ? 3 : 1.5,
      solid: op.solid,
      footprintW: footprint.w,
      footprintH: footprint.h,
      lootable: op.lootable,
      zoneId,
    };
  }
}
