// src/index.ts
// Public API surface for @alife-sdk/mapgen

// Main generator
export { MapGenerator } from './MapGenerator.js';

// Types
export {
  TileType,
  DEFAULT_MAPGEN_CONFIG,
} from './types.js';
export type {
  MapDefinition,
  MapGenConfig,
  ZoneGenConfig,
  PropGenConfig,
  TileTypeId,
  TileCell,
  TileLayer,
  LayerId,
  ZoneDefinition,
  ZoneJob,
  ZoneType,
  FactionId,
  TileRect,
  PixelRect,
  PropPlacement,
  PropType,
  ColliderDef,
  CoverPoint,
  SpawnPoint,
  Lane,
  LaneType,
  LaneWaypoint,
  ValidationResult,
} from './types.js';

// Core primitives (for extension)
export { Grid } from './core/Grid.js';
export { Rng } from './core/Rng.js';
export { TileRegistry } from './core/TileRegistry.js';
export { AutoTile } from './core/AutoTile.js';
export type { TileDefinition, TransitionRule } from './core/TileRegistry.js';

// Passes (for custom pipeline construction)
export { MacroPass } from './passes/MacroPass.js';
export { TerrainPass } from './passes/TerrainPass.js';
export { PropsPass } from './passes/PropsPass.js';
export type { MacroPassResult } from './passes/MacroPass.js';
export type { TerrainPassResult } from './passes/TerrainPass.js';
export type { PropsPassResult } from './passes/PropsPass.js';

// Zone templates (for custom zone authoring)
export type { ZoneTemplate, TemplateVariation, TemplateResult } from './zones/ZoneTemplate.js';

// Scoring
export { MapScorer } from './scoring/MapScorer.js';
export { validateMap, findUnreachableZones } from './scoring/validators.js';

// Utilities
export { poissonDisk } from './utils/PoissonDisk.js';
export { Pathfinder } from './utils/Pathfinder.js';
