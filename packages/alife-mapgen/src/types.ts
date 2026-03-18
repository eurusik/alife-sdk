// src/types.ts
// Public type contract for the @alife-sdk/mapgen package.
// All map data flows through these interfaces — the generator produces them,
// the Phaser adapter consumes them.

// ---------------------------------------------------------------------------
// Tile identifiers
// ---------------------------------------------------------------------------

/** Canonical tile type IDs used throughout the generator. */
export const TileType = {
  // Ground
  GRASS_LIGHT: 'grass_light',
  GRASS_DARK: 'grass_dark',
  DIRT: 'dirt',
  CONCRETE: 'concrete',
  ASPHALT: 'asphalt',

  // Roads
  ROAD: 'road',
  ROAD_DIRT: 'road_dirt',

  // Transitions
  GRASS_TO_DIRT: 'grass_to_dirt',
  DIRT_TO_ROAD: 'dirt_to_road',
  GRASS_TO_ROAD: 'grass_to_road',

  // Special
  EMPTY: 'empty',
  BLOCKED: 'blocked',
} as const;

export type TileTypeId = typeof TileType[keyof typeof TileType];

// ---------------------------------------------------------------------------
// Tile layer cell
// ---------------------------------------------------------------------------

/**
 * A single resolved tile cell in a layer.
 * `frameIndex` refers to the frame within the spritesheet for the given texture.
 * -1 means "no tile" (transparent).
 */
export interface TileCell {
  /** Logical tile type. */
  type: TileTypeId;
  /** Texture key (matches the Phaser texture atlas key). */
  textureKey: string;
  /** Frame index within the spritesheet (-1 = empty). */
  frameIndex: number;
  /** True if physics should block movement through this cell. */
  solid: boolean;
}

// ---------------------------------------------------------------------------
// Tile layers
// ---------------------------------------------------------------------------

export type LayerId = 'ground' | 'roads' | 'transitions' | 'objects' | 'overlay';

/** A full 2D grid layer of resolved tile cells. */
export interface TileLayer {
  id: LayerId;
  /** Column-major flat array: index = y * width + x */
  cells: TileCell[];
  /** Render depth for this layer (higher = drawn on top). */
  depth: number;
}

// ---------------------------------------------------------------------------
// Zone definitions
// ---------------------------------------------------------------------------

export type ZoneType =
  | 'checkpoint'
  | 'camp'
  | 'bunker'
  | 'factory'
  | 'village'
  | 'ruins'
  | 'outpost';

export type FactionId = string;

/** Axis-aligned bounding rectangle in tile coordinates. */
export interface TileRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pixel-space bounding rectangle. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ZoneDefinition {
  id: string;
  type: ZoneType;
  factionId: FactionId;
  /** Bounds in tile coordinates. */
  tileBounds: TileRect;
  /** Bounds in pixel coordinates (derived, for convenience). */
  pixelBounds: PixelRect;
  /** NPC job slots available inside this zone. */
  jobs: ZoneJob[];
  /** True if this zone can serve as a player spawn location. */
  isPlayerSpawnZone: boolean;
  /** Clearance radius in tiles around this zone (no other zones within it). */
  clearanceRadius: number;
}

export interface ZoneJob {
  type: 'patrol' | 'guard' | 'loot' | 'rest';
  slots: number;
  /** Pixel-space position override for guard/patrol anchors. */
  position?: { x: number; y: number };
}

// ---------------------------------------------------------------------------
// Props (decorative & interactive objects)
// ---------------------------------------------------------------------------

export type PropType =
  | 'tree'
  | 'grass_tuft'
  | 'barrel'
  | 'car'
  | 'fence_wood'
  | 'fence_concrete'
  | 'gate'
  | 'chest'
  | 'interior_object'
  | 'tent'
  | 'shack'
  | 'bunker_building'
  | 'sandbag'
  | 'crate_wood'
  | 'crate_military'
  | 'barrel_hazmat'
  | 'jerrycan'
  | 'junk_pile'
  | 'sign'
  | 'power_pole'
  | 'lamp_post'
  | 'metal_gate'
  | 'barrier'
  | 'rubble'
  | 'skeleton'
  | 'bones'
  | 'skull_bull'
  | 'planks'
  | 'logs'
  | 'rope'
  | 'manhole'
  | 'trash_bags'
  | 'wall_ruin'
  | 'truck';

export interface PropPlacement {
  id: string;
  type: PropType;
  /** Texture key (matches Phaser atlas key). */
  textureKey: string;
  /** Frame within the spritesheet. */
  frameIndex: number;
  /** Pixel-space position (center of sprite). */
  x: number;
  y: number;
  /** Render depth. */
  depth: number;
  /** True if this prop should have a physics body. */
  solid: boolean;
  /** Footprint in pixels (used for overlap checks during placement). */
  footprintW: number;
  footprintH: number;
  /** Whether this prop can be looted. */
  lootable: boolean;
  /** Optional zone this prop belongs to. */
  zoneId?: string;
}

// ---------------------------------------------------------------------------
// Collision shapes
// ---------------------------------------------------------------------------

export interface ColliderDef {
  /** Pixel-space rectangle. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Origin of this collider: a zone, a prop, or a map boundary. */
  source: 'zone' | 'prop' | 'boundary';
  sourceId: string;
}

// ---------------------------------------------------------------------------
// Cover points (for NPC GOAP cover-seeking)
// ---------------------------------------------------------------------------

export interface CoverPoint {
  id: string;
  x: number;
  y: number;
  /** Direction this cover protects from (radians, 0 = right). */
  facingAngle: number;
  /** Radius of effective cover. */
  radius: number;
  /** Which zone this is near, if any. */
  zoneId?: string;
}

// ---------------------------------------------------------------------------
// Spawn points
// ---------------------------------------------------------------------------

export interface SpawnPoint {
  id: string;
  entityId: string;
  factionId: FactionId;
  x: number;
  y: number;
  zoneId: string;
}

// ---------------------------------------------------------------------------
// Lanes (paths between zones)
// ---------------------------------------------------------------------------

export type LaneType = 'road' | 'forest_path' | 'ruins_shortcut';

export interface LaneWaypoint {
  x: number;
  y: number;
}

export interface Lane {
  id: string;
  fromZoneId: string;
  toZoneId: string;
  type: LaneType;
  waypoints: LaneWaypoint[];
  /** Width in pixels. Used for road tile painting and NPC path following. */
  width: number;
}

// ---------------------------------------------------------------------------
// Top-level MapDefinition
// ---------------------------------------------------------------------------

/** Complete map data produced by MapGenerator and consumed by a renderer adapter. */
export interface MapDefinition {
  /** Map width in tiles. */
  width: number;
  /** Map height in tiles. */
  height: number;
  /** Tile size in pixels. */
  tileSize: number;
  /** Seed used to generate this map (for reproducibility). */
  seed: string;
  /** All tile layers in render order. */
  layers: TileLayer[];
  /** Logical zone definitions. */
  zones: ZoneDefinition[];
  /** Scattered prop placements. */
  props: PropPlacement[];
  /** Static physics colliders. */
  colliders: ColliderDef[];
  /** NPC cover point candidates. */
  coverPoints: CoverPoint[];
  /** NPC initial spawn positions. */
  npcSpawns: SpawnPoint[];
  /** Player starting position in pixels. */
  playerSpawn: { x: number; y: number };
  /** Path lanes between zones. */
  lanes: Lane[];
  /** Validation result (populated after generation). */
  validation: ValidationResult;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Generator configuration
// ---------------------------------------------------------------------------

export interface MapGenConfig {
  /** Width in tiles. */
  width: number;
  /** Height in tiles. */
  height: number;
  /** Tile size in pixels. */
  tileSize: number;
  /** Deterministic seed string. */
  seed: string;
  /** How many candidate maps to generate and score before picking the best. */
  candidateCount: number;
  /** Zone placement constraints. */
  zoneConfig: ZoneGenConfig;
  /** Prop scatter configuration. */
  propConfig: PropGenConfig;
}

export interface ZoneGenConfig {
  /** Minimum number of zones to place. */
  minZones: number;
  /** Maximum number of zones to place. */
  maxZones: number;
  /** Minimum edge margin in tiles (zones cannot be placed within this many tiles of the map edge). */
  edgeMarginTiles: number;
  /** Minimum distance between zone centers in tiles. */
  minZoneDistanceTiles: number;
  /** Zone types and their relative weights. */
  typeWeights: Partial<Record<ZoneType, number>>;
  /** Faction distribution weights. */
  factionWeights: Record<FactionId, number>;
  /** Number of distinct path lanes between zones (2–3). */
  laneCount: number;
}

export interface PropGenConfig {
  /** Target density of trees (trees per 100 tiles outside roads/zones). */
  treeDensity: number;
  /** Target density of grass tufts (per 100 tiles). */
  grassDensity: number;
  /** Target number of barrels per zone. */
  barrelsPerZone: number;
  /** Target number of cars per zone (only near roads). */
  carsPerZone: number;
  /** Minimum distance between props of the same type (Poisson disk radius, px). */
  poissonRadius: number;
}

// ---------------------------------------------------------------------------
// Default config
// ---------------------------------------------------------------------------

export const DEFAULT_MAPGEN_CONFIG: MapGenConfig = {
  width: 80,
  height: 60,
  tileSize: 32,
  seed: 'alife-default',
  candidateCount: 5,
  zoneConfig: {
    minZones: 3,
    maxZones: 5,
    edgeMarginTiles: 4,
    minZoneDistanceTiles: 16,
    typeWeights: {
      factory: 2,
      bunker: 2,
      camp: 3,
      checkpoint: 2,
      ruins: 1,
    },
    factionWeights: {
      stalker: 1,
      bandit: 1,
      neutral: 0.5,
    },
    laneCount: 2,
  },
  propConfig: {
    treeDensity: 18,
    grassDensity: 14,
    barrelsPerZone: 3,
    carsPerZone: 1,
    poissonRadius: 28,
  },
};
