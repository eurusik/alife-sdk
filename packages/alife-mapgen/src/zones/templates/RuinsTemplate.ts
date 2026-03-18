// src/zones/templates/RuinsTemplate.ts
// Abandoned ruins zone: overgrown trees, patchy ground.

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

export class RuinsTemplate implements ZoneTemplate {
  readonly zoneType = 'ruins' as const;
  readonly tileWidth = 12;
  readonly tileHeight = 10;

  evaluate(variation: TemplateVariation, rng: Rng): TemplateResult {
    const { flipX, flipY } = variation;
    const W = this.tileWidth;
    const H = this.tileHeight;

    const tiles: TilePaintOp[] = [];

    // Patchy dirt floor with gaps (overgrown)
    const dirtPositions = [
      [2,1],[3,1],[4,1],[5,1],[6,1],[7,1],[8,1],[9,1],
      [1,2],[2,2],[3,2],[4,2],[5,2],[6,2],[7,2],[8,2],[9,2],[10,2],
      [1,3],[2,3],[3,3],[7,3],[8,3],[9,3],[10,3],
      [1,4],[2,4],[3,4],[8,4],[9,4],[10,4],
      [2,5],[3,5],[7,5],[8,5],[9,5],
      [2,6],[3,6],[4,6],[6,6],[7,6],[8,6],[9,6],
      [2,7],[3,7],[4,7],[5,7],[6,7],[7,7],[8,7],
      [2,8],[3,8],[4,8],[5,8],[6,8],[7,8],
    ];
    for (const [x, y] of dirtPositions) {
      tiles.push({ x, y, type: TileType.DIRT, layer: 'ground' });
    }

    // Dirt road shortcut path through center
    for (let y = 4; y < 6; y++) {
      for (let x = 0; x < W; x++) {
        tiles.push({ x, y, type: TileType.ROAD_DIRT, layer: 'roads' });
      }
    }

    const finalTiles = applyFlip(tiles, flipX, flipY, W, H);

    const props: PropPaintOp[] = [
      // Building footprints (for collision/occupation only)
      {
        rx: 2, ry: 2,
        propType: 'building',
        frameIndex: 24,
        textureKey: 'buildings_house_walls',
        solid: true,
        lootable: false,
        footprintW: 48,
        footprintH: 32,
      },
      {
        rx: 8, ry: 6,
        propType: 'building',
        frameIndex: 24,
        textureKey: 'buildings_house_walls',
        solid: true,
        lootable: false,
        footprintW: 48,
        footprintH: 32,
      },
      // Overgrown trees
      {
        rx: 1, ry: 1,
        propType: 'tree',
        frameIndex: rng.int(0, 2),
        textureKey: 'nature_tree',
        solid: true,
        lootable: false,
        footprintW: 20,
        footprintH: 20,
      },
      {
        rx: 10, ry: 1,
        propType: 'tree',
        frameIndex: rng.int(0, 2),
        textureKey: 'nature_tree',
        solid: true,
        lootable: false,
        footprintW: 20,
        footprintH: 20,
      },
      {
        rx: 10, ry: 8,
        propType: 'tree',
        frameIndex: rng.int(0, 2),
        textureKey: 'nature_tree',
        solid: true,
        lootable: false,
        footprintW: 20,
        footprintH: 20,
      },
      {
        rx: 1, ry: 8,
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
        { entityId: '__zone_patrol_0', rx: 3, ry: 5 },
        { entityId: '__zone_patrol_1', rx: 8, ry: 5 },
      ],
      jobs: [
        { type: 'patrol', slots: 2 },
        { type: 'loot', slots: 1 },
      ],
      width: W,
      height: H,
    };
  }
}
