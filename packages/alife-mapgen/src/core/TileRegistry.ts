// src/core/TileRegistry.ts
// Registry mapping logical TileTypeIds to rendering metadata and compatibility rules.
// Drives autotile frame selection and transition injection.

import { TileType, type TileTypeId, type TileCell } from '../types.js';

// ---------------------------------------------------------------------------
// Tile definition record stored in the registry
// ---------------------------------------------------------------------------

export interface TileDefinition {
  id: TileTypeId;
  /** Phaser texture key for this tile's spritesheet. */
  textureKey: string;
  /**
   * Base frame index within the sheet.
   * For autotiled tiles, this is the "isolated" frame; AutoTile resolves the final frame.
   */
  baseFrame: number;
  /** True if this tile type uses bitmask autotiling (multi-frame spritesheet). */
  autotile: boolean;
  /** True if physics should block movement on this tile. */
  solid: boolean;
  /**
   * Render layer depth offset added on top of the layer's base depth.
   * Positive = render on top.
   */
  depthOffset: number;
}

// ---------------------------------------------------------------------------
// Transition rule: when tileA borders tileB, inject tileT between them
// ---------------------------------------------------------------------------

export interface TransitionRule {
  from: TileTypeId;
  to: TileTypeId;
  /** The tile type used for the blending/transition cell. */
  via: TileTypeId;
}

// ---------------------------------------------------------------------------
// Tile compatibility matrix
// ---------------------------------------------------------------------------

/**
 * Defines which tile types can be direct neighbours without a forced transition.
 * Pairs not in this list will trigger transition injection if a TransitionRule exists.
 */
export type CompatibilityMatrix = ReadonlySet<string>;

function compatKey(a: TileTypeId, b: TileTypeId): string {
  // Order-independent key
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// ---------------------------------------------------------------------------
// TileRegistry
// ---------------------------------------------------------------------------

/**
 * Central registry for all tile definitions, compatibility, and transition rules.
 *
 * Consumed by AutoTile (for frame resolution) and TerrainPass (for transition injection).
 *
 * Tile spritesheet layouts assumed:
 *   new-tileset.png       — 48px tiles, 3 columns × N rows of grass light variants
 *   new-tileset-dark.png  — same layout, dark grass
 *   dirt-road.png         — 16 autotile frames in a 4×4 grid (RPG Maker XP format):
 *                           rows 0–3: road variants, bitmask-indexed
 *   buildings/tileset.png — mixed tileset, base at frame 0
 */
export class TileRegistry {
  private readonly defs = new Map<TileTypeId, TileDefinition>();
  private readonly transitions: TransitionRule[] = [];
  private readonly compatibility: Set<string> = new Set();

  constructor() {
    this.registerDefaults();
    this.registerDefaultTransitions();
    this.registerDefaultCompatibility();
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  register(def: TileDefinition): void {
    this.defs.set(def.id, def);
  }

  addTransition(rule: TransitionRule): void {
    this.transitions.push(rule);
  }

  addCompatible(a: TileTypeId, b: TileTypeId): void {
    this.compatibility.add(compatKey(a, b));
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  getDef(id: TileTypeId): TileDefinition | undefined {
    return this.defs.get(id);
  }

  getDefStrict(id: TileTypeId): TileDefinition {
    const def = this.defs.get(id);
    if (!def) throw new Error(`TileRegistry: unknown tile type "${id}"`);
    return def;
  }

  /**
   * Returns the tile type that should be injected between `from` and `to`,
   * or null if they are directly compatible (or no transition rule exists).
   */
  getTransition(from: TileTypeId, to: TileTypeId): TileTypeId | null {
    if (this.isCompatible(from, to)) return null;
    for (const rule of this.transitions) {
      if ((rule.from === from && rule.to === to) || (rule.from === to && rule.to === from)) {
        return rule.via;
      }
    }
    return null;
  }

  isCompatible(a: TileTypeId, b: TileTypeId): boolean {
    if (a === b) return true;
    return this.compatibility.has(compatKey(a, b));
  }

  /**
   * Produce a TileCell for the given tile type and bitmask (for autotile types).
   * Non-autotile types ignore the bitmask and return the base frame.
   */
  resolve(id: TileTypeId, bitmask = 0): TileCell {
    const def = this.getDefStrict(id);
    const frameIndex = def.autotile
      ? this.resolveAutotileFrame(def, bitmask)
      : def.baseFrame;

    return {
      type: id,
      textureKey: def.textureKey,
      frameIndex,
      solid: def.solid,
    };
  }

  /** Empty (transparent) cell constant. */
  empty(): TileCell {
    return {
      type: TileType.EMPTY,
      textureKey: '',
      frameIndex: -1,
      solid: false,
    };
  }

  // ---------------------------------------------------------------------------
  // Autotile frame resolution
  // ---------------------------------------------------------------------------

  /**
   * Resolves a frame index from a 4-bit NSEW bitmask (bits: N=8, E=4, S=2, W=1).
   *
   * Assumes the spritesheet uses the standard 16-frame RPG Maker XP autotile layout:
   *
   *   Frame 0  = no neighbours (isolated)
   *   Frames 1–14 = various edge/corner combos
   *   Frame 15 = fully surrounded
   *
   * The bitmask encodes which cardinal neighbours are the SAME tile type.
   */
  private resolveAutotileFrame(def: TileDefinition, bitmask: number): number {
    // Simple 4-bit RPG-style lookup: bitmask 0..15 → frame offset
    // The spritesheet frames start at def.baseFrame.
    // For 16-frame autotile sheets: frame = baseFrame + (bitmask & 0xF)
    return def.baseFrame + (bitmask & 0xF);
  }

  // ---------------------------------------------------------------------------
  // Default registrations
  // ---------------------------------------------------------------------------

  private registerDefaults(): void {
    // Ground tiles
    this.register({
      id: TileType.GRASS_LIGHT,
      textureKey: 'terrain_grass_light',
      baseFrame: 0,
      autotile: false,
      solid: false,
      depthOffset: 0,
    });

    this.register({
      id: TileType.GRASS_DARK,
      textureKey: 'terrain_grass_dark',
      baseFrame: 0,
      autotile: false,
      solid: false,
      depthOffset: 0,
    });

    // Dirt — use a different grass frame for visual variation
    // new-tileset.png 16×16: 9 cols × 10 rows = 90 frames
    // Frame 0 = top-left grass, frames in later rows have edge/border variants
    this.register({
      id: TileType.DIRT,
      textureKey: 'terrain_grass_dark',
      baseFrame: 0,
      autotile: false,
      solid: false,
      depthOffset: 0,
    });

    // Concrete — use dark grass variant as stand-in
    this.register({
      id: TileType.CONCRETE,
      textureKey: 'terrain_grass_dark',
      baseFrame: 1,
      autotile: false,
      solid: false,
      depthOffset: 0,
    });

    this.register({
      id: TileType.ASPHALT,
      textureKey: 'terrain_road',
      baseFrame: 0,
      autotile: false,
      solid: false,
      depthOffset: 0,
    });

    // Road — dirt-road.png has only 6 frames (3×2 at 16×16)
    // Disable autotile, use frame 0 (plain road)
    this.register({
      id: TileType.ROAD,
      textureKey: 'terrain_road',
      baseFrame: 0,
      autotile: false,
      solid: false,
      depthOffset: 0,
    });

    this.register({
      id: TileType.ROAD_DIRT,
      textureKey: 'terrain_road',
      baseFrame: 0,
      autotile: false,
      solid: false,
      depthOffset: 0,
    });

    // Transitions — use grass variants (no autotile, fixed frames)
    this.register({
      id: TileType.GRASS_TO_DIRT,
      textureKey: 'terrain_grass_light',
      baseFrame: 1,
      autotile: false,
      solid: false,
      depthOffset: 0,
    });

    this.register({
      id: TileType.DIRT_TO_ROAD,
      textureKey: 'terrain_road',
      baseFrame: 1,
      autotile: false,
      solid: false,
      depthOffset: 0,
    });

    this.register({
      id: TileType.GRASS_TO_ROAD,
      textureKey: 'terrain_grass_light',
      baseFrame: 2,
      autotile: false,
      solid: false,
      depthOffset: 0,
    });

    // Special
    this.register({
      id: TileType.EMPTY,
      textureKey: '',
      baseFrame: -1,
      autotile: false,
      solid: false,
      depthOffset: 0,
    });

    this.register({
      id: TileType.BLOCKED,
      textureKey: '',
      baseFrame: -1,
      autotile: false,
      solid: true,
      depthOffset: 0,
    });
  }

  private registerDefaultTransitions(): void {
    this.addTransition({ from: TileType.GRASS_LIGHT, to: TileType.DIRT, via: TileType.GRASS_TO_DIRT });
    this.addTransition({ from: TileType.GRASS_DARK, to: TileType.DIRT, via: TileType.GRASS_TO_DIRT });
    this.addTransition({ from: TileType.DIRT, to: TileType.ROAD, via: TileType.DIRT_TO_ROAD });
    this.addTransition({ from: TileType.GRASS_LIGHT, to: TileType.ROAD, via: TileType.GRASS_TO_ROAD });
    this.addTransition({ from: TileType.GRASS_DARK, to: TileType.ROAD, via: TileType.GRASS_TO_ROAD });
  }

  private registerDefaultCompatibility(): void {
    // Grass variants are compatible with each other
    this.addCompatible(TileType.GRASS_LIGHT, TileType.GRASS_DARK);
    // Dirt is compatible with itself (covered by same-type rule)
    // Roads are compatible with asphalt
    this.addCompatible(TileType.ROAD, TileType.ASPHALT);
    this.addCompatible(TileType.ROAD, TileType.ROAD_DIRT);
    // Transition tiles are compatible with both ends
    this.addCompatible(TileType.GRASS_TO_DIRT, TileType.GRASS_LIGHT);
    this.addCompatible(TileType.GRASS_TO_DIRT, TileType.GRASS_DARK);
    this.addCompatible(TileType.GRASS_TO_DIRT, TileType.DIRT);
    this.addCompatible(TileType.DIRT_TO_ROAD, TileType.DIRT);
    this.addCompatible(TileType.DIRT_TO_ROAD, TileType.ROAD);
    this.addCompatible(TileType.GRASS_TO_ROAD, TileType.GRASS_LIGHT);
    this.addCompatible(TileType.GRASS_TO_ROAD, TileType.GRASS_DARK);
    this.addCompatible(TileType.GRASS_TO_ROAD, TileType.ROAD);
    // Concrete is compatible with road (zone interiors)
    this.addCompatible(TileType.CONCRETE, TileType.ROAD);
    this.addCompatible(TileType.CONCRETE, TileType.ASPHALT);
    this.addCompatible(TileType.CONCRETE, TileType.DIRT);
  }
}
