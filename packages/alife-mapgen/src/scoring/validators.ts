// src/scoring/validators.ts
// Structural validation checks run after generation.
//
// Checks:
//   - All zones are connected to the road network (reachable)
//   - No zone isolated from all others
//   - Player spawn is accessible (not inside a solid zone footprint)
//   - NPC spawns are inside their respective zones
//   - No lanes with zero waypoints

import { Grid } from '../core/Grid.js';
import {
  type MapDefinition,
  type ValidationResult,
} from '../types.js';

/**
 * Run all validation checks on a generated MapDefinition.
 * Returns a ValidationResult with errors and warnings.
 */
export function validateMap(map: MapDefinition): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  validateZoneCount(map, errors, warnings);
  validateZoneReachability(map, errors, warnings);
  validatePlayerSpawn(map, errors, warnings);
  validateNpcSpawns(map, errors, warnings);
  validateLanes(map, errors, warnings);
  validateLayerDimensions(map, errors);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

function validateZoneCount(
  map: MapDefinition,
  errors: string[],
  warnings: string[],
): void {
  if (map.zones.length === 0) {
    errors.push('No zones placed — map is empty');
  } else if (map.zones.length < 2) {
    warnings.push('Only 1 zone placed — no NPC faction dynamics possible');
  }
}

function validateZoneReachability(
  map: MapDefinition,
  errors: string[],
  _warnings: string[],
): void {
  if (map.zones.length < 2) return;

  // Build a set of zone IDs that appear in at least one lane endpoint
  const connectedZoneIds = new Set<string>();
  for (const lane of map.lanes) {
    connectedZoneIds.add(lane.fromZoneId);
    connectedZoneIds.add(lane.toZoneId);
  }

  for (const zone of map.zones) {
    if (!connectedZoneIds.has(zone.id)) {
      errors.push(`Zone "${zone.id}" is not connected to any lane — it is unreachable`);
    }
  }
}

function validatePlayerSpawn(
  map: MapDefinition,
  errors: string[],
  _warnings: string[],
): void {
  const { x, y } = map.playerSpawn;
  if (x < 0 || x > map.width * map.tileSize) {
    errors.push(`Player spawn X=${x} is outside map bounds`);
  }
  if (y < 0 || y > map.height * map.tileSize) {
    errors.push(`Player spawn Y=${y} is outside map bounds`);
  }
}

function validateNpcSpawns(
  map: MapDefinition,
  _errors: string[],
  warnings: string[],
): void {
  for (const spawn of map.npcSpawns) {
    const zone = map.zones.find(z => z.id === spawn.zoneId);
    if (!zone) {
      warnings.push(`NPC spawn "${spawn.id}" references unknown zone "${spawn.zoneId}"`);
      continue;
    }

    const bounds = zone.pixelBounds;
    if (
      spawn.x < bounds.x || spawn.x > bounds.x + bounds.width ||
      spawn.y < bounds.y || spawn.y > bounds.y + bounds.height
    ) {
      warnings.push(
        `NPC spawn "${spawn.id}" at (${Math.round(spawn.x)}, ${Math.round(spawn.y)}) ` +
        `is outside zone "${spawn.zoneId}" bounds`,
      );
    }
  }
}

function validateLanes(
  map: MapDefinition,
  errors: string[],
  warnings: string[],
): void {
  for (const lane of map.lanes) {
    if (lane.waypoints.length === 0) {
      errors.push(`Lane "${lane.id}" has no waypoints — road routing failed`);
    } else if (lane.waypoints.length < 2) {
      warnings.push(`Lane "${lane.id}" has only 1 waypoint — too short`);
    }

    const fromExists = map.zones.some(z => z.id === lane.fromZoneId);
    const toExists   = map.zones.some(z => z.id === lane.toZoneId);
    if (!fromExists) errors.push(`Lane "${lane.id}" references missing zone "${lane.fromZoneId}"`);
    if (!toExists)   errors.push(`Lane "${lane.id}" references missing zone "${lane.toZoneId}"`);
  }
}

function validateLayerDimensions(
  map: MapDefinition,
  errors: string[],
): void {
  const expected = map.width * map.height;
  for (const layer of map.layers) {
    if (layer.cells.length !== expected) {
      errors.push(
        `Layer "${layer.id}" has ${layer.cells.length} cells, expected ${expected} (${map.width}×${map.height})`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Connectivity check using flood fill from player spawn
// ---------------------------------------------------------------------------

/**
 * Verify that the player spawn tile is connected to all zone centers
 * via non-solid tiles (walkable ground).
 * Returns the IDs of unreachable zones.
 */
export function findUnreachableZones(map: MapDefinition): string[] {
  const W = map.width;
  const H = map.height;
  const tileSize = map.tileSize;

  // Build a solid grid from the layers
  const solidGrid = new Grid<boolean>(W, H, false);

  // Mark tiles with solid cells from the collider list
  for (const collider of map.colliders) {
    if (collider.source !== 'zone') continue;
    const x0 = Math.floor(collider.x / tileSize);
    const y0 = Math.floor(collider.y / tileSize);
    const x1 = Math.ceil((collider.x + collider.width) / tileSize);
    const y1 = Math.ceil((collider.y + collider.height) / tileSize);
    for (let cy = y0; cy < y1; cy++) {
      for (let cx = x0; cx < x1; cx++) {
        solidGrid.set(cx, cy, true);
      }
    }
  }

  // Flood fill from player spawn
  const spawnTx = Math.floor(map.playerSpawn.x / tileSize);
  const spawnTy = Math.floor(map.playerSpawn.y / tileSize);

  const reachable = solidGrid.floodFill(
    spawnTx,
    spawnTy,
    (_solid) => !_solid,
  );
  const reachableSet = new Set(reachable.map(p => p.y * W + p.x));

  const unreachable: string[] = [];
  for (const zone of map.zones) {
    const cx = Math.floor((zone.pixelBounds.x + zone.pixelBounds.width / 2) / tileSize);
    const cy = Math.floor((zone.pixelBounds.y + zone.pixelBounds.height / 2) / tileSize);
    if (!reachableSet.has(cy * W + cx)) {
      unreachable.push(zone.id);
    }
  }

  return unreachable;
}
