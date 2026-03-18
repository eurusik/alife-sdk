// src/zones/templates/FactoryTemplate.ts
// Large industrial factory zone: broad concrete base, buildings, vehicle access.

import {
  type ZoneTemplate,
  type TemplateVariation,
  type TemplateResult,
  type TilePaintOp,
  type PropPaintOp,
  applyFlip,
  applyFlipProp,
  applyFlipCover,
  buildingCoverOps,
} from '../ZoneTemplate.js';
import { TileType } from '../../types.js';
import type { Rng } from '../../core/Rng.js';

export class FactoryTemplate implements ZoneTemplate {
  readonly zoneType = 'factory' as const;
  readonly tileWidth = 20;
  readonly tileHeight = 16;

  evaluate(variation: TemplateVariation, rng: Rng): TemplateResult {
    const { flipX, flipY } = variation;
    const W = this.tileWidth;
    const H = this.tileHeight;

    const tiles: TilePaintOp[] = [];

    // Full concrete yard
    for (let y = 2; y < 14; y++) {
      for (let x = 1; x < 19; x++) {
        tiles.push({ x, y, type: TileType.CONCRETE, layer: 'ground' });
      }
    }

    // Central asphalt road through factory
    for (let y = 2; y < 14; y++) {
      tiles.push({ x: 9,  y, type: TileType.ASPHALT, layer: 'roads' });
      tiles.push({ x: 10, y, type: TileType.ASPHALT, layer: 'roads' });
    }

    // Road entry north
    for (let y = 0; y < 2; y++) {
      tiles.push({ x: 9,  y, type: TileType.ROAD, layer: 'roads' });
      tiles.push({ x: 10, y, type: TileType.ROAD, layer: 'roads' });
    }

    // Road exit south
    for (let y = 14; y < H; y++) {
      tiles.push({ x: 9,  y, type: TileType.ROAD, layer: 'roads' });
      tiles.push({ x: 10, y, type: TileType.ROAD, layer: 'roads' });
    }

    const finalTiles = applyFlip(tiles, flipX, flipY, W, H);

    const props: PropPaintOp[] = [
      // Building footprints (for collision/occupation only)
      {
        rx: 1, ry: 2,
        propType: 'building',
        frameIndex: 0,
        textureKey: 'buildings_house_parts',
        solid: true,
        lootable: false,
        footprintW: 96,
        footprintH: 80,
      },
      {
        rx: 12, ry: 2,
        propType: 'building',
        frameIndex: 8,
        textureKey: 'buildings_house_parts',
        solid: true,
        lootable: false,
        footprintW: 96,
        footprintH: 80,
      },
      {
        rx: 3, ry: 10,
        propType: 'building',
        frameIndex: 16,
        textureKey: 'buildings_house_parts',
        solid: true,
        lootable: false,
        footprintW: 80,
        footprintH: 48,
      },
      // Tree outside perimeter
      {
        rx: 0, ry: 6,
        propType: 'tree',
        frameIndex: rng.int(0, 2),
        textureKey: 'nature_tree',
        solid: true,
        lootable: false,
        footprintW: 20,
        footprintH: 20,
      },
    ];

    const finalProps = applyFlipProp(props, flipX, flipY, W, H);

    // Auto-generate cover points at building edges
    const coverOps = buildingCoverOps(props.filter(p => p.solid && p.propType === 'building'));
    const finalCover = applyFlipCover(coverOps, flipX, flipY, W, H);

    return {
      tiles: finalTiles,
      props: finalProps,
      coverOps: finalCover,
      spawnOps: [
        { entityId: '__zone_guard_0',   rx: 2,  ry: 8 },
        { entityId: '__zone_guard_1',   rx: 17, ry: 8 },
        { entityId: '__zone_guard_2',   rx: 9,  ry: 3 },
        { entityId: '__zone_patrol_0',  rx: 5,  ry: 6 },
        { entityId: '__zone_patrol_1',  rx: 14, ry: 6 },
        { entityId: '__zone_patrol_2',  rx: 9,  ry: 12 },
      ],
      jobs: [
        { type: 'guard', slots: 3 },
        { type: 'patrol', slots: 3 },
        { type: 'loot', slots: 2 },
      ],
      width: W,
      height: H,
    };
  }
}
