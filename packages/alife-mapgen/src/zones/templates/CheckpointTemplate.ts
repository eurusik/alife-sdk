// src/zones/templates/CheckpointTemplate.ts
// A small checkpoint zone: a guard post with a concrete pad and fence.

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

export class CheckpointTemplate implements ZoneTemplate {
  readonly zoneType = 'checkpoint' as const;
  readonly tileWidth = 10;
  readonly tileHeight = 8;

  evaluate(_variation: TemplateVariation, _rng: Rng): TemplateResult {
    const { flipX, flipY } = _variation;
    const W = this.tileWidth;
    const H = this.tileHeight;

    // Concrete pad (6×4 centered in zone)
    const tiles: TilePaintOp[] = [];
    for (let y = 2; y < 6; y++) {
      for (let x = 2; x < 8; x++) {
        tiles.push({ x, y, type: TileType.CONCRETE, layer: 'ground' });
      }
    }

    // Road approach from south edge
    for (let y = 6; y < H; y++) {
      tiles.push({ x: 4, y, type: TileType.ROAD, layer: 'roads' });
      tiles.push({ x: 5, y, type: TileType.ROAD, layer: 'roads' });
    }
    // Road approach from north
    for (let y = 0; y < 2; y++) {
      tiles.push({ x: 4, y, type: TileType.ROAD, layer: 'roads' });
      tiles.push({ x: 5, y, type: TileType.ROAD, layer: 'roads' });
    }

    const finalTiles = applyFlip(tiles, flipX, flipY, W, H);

    // No visible props — buildings rendered by renderZones()
    const props: PropPaintOp[] = [];
    const finalProps = applyFlipProp(props, flipX, flipY, W, H);

    // Auto-generate cover points at building edges (rendered by renderZones)
    // Checkpoint has no template props, so generate cover from the zone structure itself
    // The concrete pad runs x:2-7, y:2-5 — place cover at pad corners
    const coverOps = buildingCoverOps(props.filter(p => p.solid && p.propType === 'building'));
    // If no buildings, add cover at the concrete pad edges
    if (coverOps.length === 0) {
      coverOps.push(
        { rx: 2, ry: 2, facingAngle: Math.PI * 1.25, radius: 32 },  // NW corner of pad
        { rx: 7, ry: 2, facingAngle: Math.PI * 1.75, radius: 32 },  // NE corner
        { rx: 2, ry: 5, facingAngle: Math.PI * 0.75, radius: 32 },  // SW corner
        { rx: 7, ry: 5, facingAngle: Math.PI * 0.25, radius: 32 },  // SE corner
      );
    }
    const finalCover = applyFlipCover(coverOps, flipX, flipY, W, H);

    return {
      tiles: finalTiles,
      props: finalProps,
      coverOps: finalCover,
      spawnOps: [
        { entityId: '__zone_guard_0', rx: 3, ry: 3 },
        { entityId: '__zone_guard_1', rx: 6, ry: 3 },
      ],
      jobs: [
        { type: 'guard', slots: 2, position: undefined },
        { type: 'patrol', slots: 2 },
      ],
      width: W,
      height: H,
    };
  }
}
