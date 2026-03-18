// src/zones/templates/BunkerTemplate.ts
// Underground bunker entrance zone: concrete fortifications, heavy cover, single road access.

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

export class BunkerTemplate implements ZoneTemplate {
  readonly zoneType = 'bunker' as const;
  readonly tileWidth = 14;
  readonly tileHeight = 12;

  evaluate(variation: TemplateVariation, _rng: Rng): TemplateResult {
    const { flipX, flipY } = variation;
    const W = this.tileWidth;
    const H = this.tileHeight;

    const tiles: TilePaintOp[] = [];

    // Concrete base
    for (let y = 2; y < 10; y++) {
      for (let x = 2; x < 12; x++) {
        tiles.push({ x, y, type: TileType.CONCRETE, layer: 'ground' });
      }
    }

    // Road access from east
    for (let x = 12; x < W; x++) {
      tiles.push({ x, y: 5, type: TileType.ROAD, layer: 'roads' });
      tiles.push({ x, y: 6, type: TileType.ROAD, layer: 'roads' });
    }

    // Asphalt reinforced inner zone
    for (let y = 4; y < 8; y++) {
      for (let x = 4; x < 10; x++) {
        tiles.push({ x, y, type: TileType.ASPHALT, layer: 'ground' });
      }
    }

    const finalTiles = applyFlip(tiles, flipX, flipY, W, H);

    const props: PropPaintOp[] = [
      // Bunker entrance (heavy structure — for collision/occupation only)
      {
        rx: 5, ry: 4,
        propType: 'building',
        frameIndex: 16,
        textureKey: 'buildings_house_parts',
        solid: true,
        lootable: false,
        footprintW: 64,
        footprintH: 64,
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
        { entityId: '__zone_guard_0', rx: 3, ry: 5 },
        { entityId: '__zone_guard_1', rx: 10, ry: 5 },
        { entityId: '__zone_patrol_0', rx: 6, ry: 3 },
        { entityId: '__zone_patrol_1', rx: 6, ry: 8 },
      ],
      jobs: [
        { type: 'guard', slots: 3, position: undefined },
        { type: 'patrol', slots: 3 },
        { type: 'loot', slots: 1 },
      ],
      width: W,
      height: H,
    };
  }
}
