// src/zones/templates/CampTemplate.ts
// A medium-sized stalker/bandit camp: houses, trees, parked vehicle.

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

export class CampTemplate implements ZoneTemplate {
  readonly zoneType = 'camp' as const;
  readonly tileWidth = 16;
  readonly tileHeight = 14;

  evaluate(variation: TemplateVariation, rng: Rng): TemplateResult {
    const { flipX, flipY, colorVariant } = variation;
    const W = this.tileWidth;
    const H = this.tileHeight;

    const tiles: TilePaintOp[] = [];

    // Central dirt courtyard (10×8)
    for (let y = 3; y < 11; y++) {
      for (let x = 3; x < 13; x++) {
        tiles.push({ x, y, type: TileType.DIRT, layer: 'ground' });
      }
    }

    // Road entry from south
    for (let y = 11; y < H; y++) {
      for (let x = 7; x <= 9; x++) {
        tiles.push({ x, y, type: TileType.ROAD, layer: 'roads' });
      }
    }

    const finalTiles = applyFlip(tiles, flipX, flipY, W, H);

    const houseFrame = colorVariant * 8;

    const props: PropPaintOp[] = [
      // Main building (for collision/occupation only)
      {
        rx: 3, ry: 3,
        propType: 'building',
        frameIndex: houseFrame,
        textureKey: 'buildings_tileset',
        solid: true,
        lootable: false,
        footprintW: 64,
        footprintH: 48,
      },
      // Side building
      {
        rx: 9, ry: 3,
        propType: 'building',
        frameIndex: houseFrame + 4,
        textureKey: 'buildings_tileset',
        solid: true,
        lootable: false,
        footprintW: 48,
        footprintH: 48,
      },
      // Trees at corners
      {
        rx: 1, ry: 2,
        propType: 'tree',
        frameIndex: rng.int(0, 2),
        textureKey: 'nature_tree',
        solid: true,
        lootable: false,
        footprintW: 20,
        footprintH: 20,
      },
      {
        rx: 13, ry: 2,
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
        { entityId: '__zone_guard_0', rx: 4, ry: 6 },
        { entityId: '__zone_guard_1', rx: 11, ry: 6 },
        { entityId: '__zone_patrol_0', rx: 7, ry: 10 },
        { entityId: '__zone_patrol_1', rx: 8, ry: 4 },
      ],
      jobs: [
        { type: 'guard', slots: 2 },
        { type: 'patrol', slots: 2 },
        { type: 'rest', slots: 2 },
      ],
      width: W,
      height: H,
    };
  }
}
