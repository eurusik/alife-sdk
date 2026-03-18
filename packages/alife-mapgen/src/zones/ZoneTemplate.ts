// src/zones/ZoneTemplate.ts
// Base interface and variation logic for handcrafted zone prefabs.
//
// A ZoneTemplate describes a logical layout: which tiles to paint within
// the zone's bounds, which jobs to assign, and which props to place.
// The MacroPass instantiates templates at specific tile positions.

import type { TileTypeId, ZoneType, ZoneJob } from '../types.js';
import type { Rng } from '../core/Rng.js';

// ---------------------------------------------------------------------------
// Template tile paint instruction
// ---------------------------------------------------------------------------

/** A paint instruction: paint `type` at (x, y) relative to zone origin. */
export interface TilePaintOp {
  x: number;
  y: number;
  type: TileTypeId;
  /** Which layer to paint on ('ground' | 'roads' | 'objects'). */
  layer: 'ground' | 'roads' | 'objects';
}

// ---------------------------------------------------------------------------
// Template prop placement instruction
// ---------------------------------------------------------------------------

export interface PropPaintOp {
  /** Relative tile position (will be converted to pixel center). */
  rx: number;
  ry: number;
  propType: string;
  frameIndex: number;
  textureKey: string;
  solid: boolean;
  lootable: boolean;
  footprintW: number;
  footprintH: number;
}

// ---------------------------------------------------------------------------
// Zone cover point instruction
// ---------------------------------------------------------------------------

export interface CoverOp {
  rx: number;
  ry: number;
  facingAngle: number;
  radius: number;
}

// ---------------------------------------------------------------------------
// Spawn instruction
// ---------------------------------------------------------------------------

export interface SpawnOp {
  entityId: string;
  rx: number;
  ry: number;
}

// ---------------------------------------------------------------------------
// Template result
// ---------------------------------------------------------------------------

/** The output of evaluating a template at a given position and orientation. */
export interface TemplateResult {
  tiles: TilePaintOp[];
  props: PropPaintOp[];
  coverOps: CoverOp[];
  spawnOps: SpawnOp[];
  jobs: ZoneJob[];
  /** Bounding box in tile-space (relative to zone origin). */
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Variation parameters
// ---------------------------------------------------------------------------

/** Variation flags that can be applied to any template. */
export interface TemplateVariation {
  /** Mirror horizontally. */
  flipX: boolean;
  /** Mirror vertically. */
  flipY: boolean;
  /** Swap building color (0, 1, or 2 for blue/red/yellow). */
  colorVariant: 0 | 1 | 2;
}

// ---------------------------------------------------------------------------
// ZoneTemplate interface
// ---------------------------------------------------------------------------

/**
 * A handcrafted zone prefab.
 *
 * Each concrete subclass describes a specific tactical zone type and
 * contains the ground-truth layout data.
 */
export interface ZoneTemplate {
  /** Zone type this template produces. */
  readonly zoneType: ZoneType;
  /** Tile dimensions (intrinsic — before rotation/flip). */
  readonly tileWidth: number;
  readonly tileHeight: number;

  /**
   * Evaluate the template, applying variation parameters.
   * Returns a TemplateResult with all paint ops relative to (0,0).
   */
  evaluate(variation: TemplateVariation, rng: Rng): TemplateResult;
}

// ---------------------------------------------------------------------------
// Variation helper
// ---------------------------------------------------------------------------

/**
 * Apply flipX and flipY to a list of paint ops, constraining within the
 * given width/height.
 */
export function applyFlip(
  ops: TilePaintOp[],
  flipX: boolean,
  flipY: boolean,
  width: number,
  height: number,
): TilePaintOp[] {
  if (!flipX && !flipY) return ops;
  return ops.map((op) => ({
    ...op,
    x: flipX ? width - 1 - op.x : op.x,
    y: flipY ? height - 1 - op.y : op.y,
  }));
}

export function applyFlipProp(
  ops: PropPaintOp[],
  flipX: boolean,
  flipY: boolean,
  width: number,
  height: number,
): PropPaintOp[] {
  if (!flipX && !flipY) return ops;
  return ops.map((op) => ({
    ...op,
    rx: flipX ? width - 1 - op.rx : op.rx,
    ry: flipY ? height - 1 - op.ry : op.ry,
  }));
}

/**
 * Auto-generate cover points at the 4 corners of each solid building.
 *
 * In top-down view, cover means hiding behind a building corner and
 * peeking around it to shoot. Each corner point sits 1 tile diagonally
 * outside the building footprint, with facingAngle pointing toward the
 * building center (so the NPC faces the wall it hides behind).
 *
 *        ╔══════════╗
 *   C0 ● ║          ║ ● C1
 *        ║ BUILDING ║
 *   C2 ● ║          ║ ● C3
 *        ╚══════════╝
 *
 * tileSize = 32px assumed. Radius scales with building footprint size.
 */
export function buildingCoverOps(buildings: PropPaintOp[]): CoverOp[] {
  const TILE = 32;
  const OFFSET = 1; // tiles from building corner to cover point
  const ops: CoverOp[] = [];

  for (const b of buildings) {
    const halfW = b.footprintW / TILE / 2;
    const halfH = b.footprintH / TILE / 2;
    const cx = b.rx;
    const cy = b.ry;
    const radius = Math.max(24, Math.round(Math.max(b.footprintW, b.footprintH) * 0.5));

    // Top-left corner — peek right or down
    ops.push({
      rx: Math.round(cx - halfW - OFFSET),
      ry: Math.round(cy - halfH - OFFSET),
      facingAngle: Math.PI / 4,       // faces SE (toward building center)
      radius,
    });

    // Top-right corner — peek left or down
    ops.push({
      rx: Math.round(cx + halfW + OFFSET),
      ry: Math.round(cy - halfH - OFFSET),
      facingAngle: Math.PI * 3 / 4,   // faces SW (toward building center)
      radius,
    });

    // Bottom-left corner — peek right or up
    ops.push({
      rx: Math.round(cx - halfW - OFFSET),
      ry: Math.round(cy + halfH + OFFSET),
      facingAngle: -Math.PI / 4,      // faces NE (toward building center)
      radius,
    });

    // Bottom-right corner — peek left or up
    ops.push({
      rx: Math.round(cx + halfW + OFFSET),
      ry: Math.round(cy + halfH + OFFSET),
      facingAngle: -Math.PI * 3 / 4,  // faces NW (toward building center)
      radius,
    });
  }

  return ops;
}

export function applyFlipCover(
  ops: CoverOp[],
  flipX: boolean,
  flipY: boolean,
  width: number,
  height: number,
): CoverOp[] {
  if (!flipX && !flipY) return ops;
  return ops.map((op) => ({
    ...op,
    rx: flipX ? width - 1 - op.rx : op.rx,
    ry: flipY ? height - 1 - op.ry : op.ry,
    facingAngle: (() => {
      let a = op.facingAngle;
      if (flipX) a = Math.PI - a;
      if (flipY) a = -a;
      return a;
    })(),
  }));
}
