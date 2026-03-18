// src/passes/MacroPass.ts
// Pass 1: MACRO — zone placement, road network, and lane routing.
//
// Algorithm:
//   1. Generate N candidate zone layouts using the constraint solver
//   2. Each layout: place zones with min-distance, edge-margin, faction-balance constraints
//   3. Route lanes between zone pairs using A* on a cost grid
//   4. Emit ZoneDefinitions and Lane records into the partial MapDefinition

import { Rng } from '../core/Rng.js';
import { Grid } from '../core/Grid.js';
import {
  TileType,
  type ZoneDefinition,
  type Lane,
  type LaneType,
  type ZoneGenConfig,
  type ZoneType,
} from '../types.js';
import type { TileTypeId } from '../types.js';
import { CheckpointTemplate } from '../zones/templates/CheckpointTemplate.js';
import { CampTemplate } from '../zones/templates/CampTemplate.js';
import { BunkerTemplate } from '../zones/templates/BunkerTemplate.js';
import { FactoryTemplate } from '../zones/templates/FactoryTemplate.js';
import { RuinsTemplate } from '../zones/templates/RuinsTemplate.js';
import type { ZoneTemplate, TemplateVariation, TemplateResult } from '../zones/ZoneTemplate.js';

// ---------------------------------------------------------------------------
// Template registry
// ---------------------------------------------------------------------------

const TEMPLATE_REGISTRY: Record<ZoneType, ZoneTemplate> = {
  checkpoint: new CheckpointTemplate(),
  camp: new CampTemplate(),
  bunker: new BunkerTemplate(),
  factory: new FactoryTemplate(),
  ruins: new RuinsTemplate(),
  // Placeholder fallbacks for unlisted types
  village: new CampTemplate(),
  outpost: new CheckpointTemplate(),
};

// ---------------------------------------------------------------------------
// MacroPass output
// ---------------------------------------------------------------------------

export interface MacroPassResult {
  zones: ZoneDefinition[];
  lanes: Lane[];
  /** Road type grid (tile space): which tiles are roads after this pass. */
  roadGrid: Grid<TileTypeId>;
  /** Zone footprint grid: which tiles are claimed by zones (-1 = free, index = zone index). */
  zoneGrid: Grid<number>;
  /** Template results indexed by zone ID. */
  templateResults: Map<string, TemplateResult>;
}

// ---------------------------------------------------------------------------
// MacroPass
// ---------------------------------------------------------------------------

export class MacroPass {

  /**
   * Run Pass 1: place zones and route roads.
   *
   * @param mapWidth   Map width in tiles
   * @param mapHeight  Map height in tiles
   * @param tileSize   Tile size in pixels
   * @param config     Zone generation config
   * @param rng        Seeded RNG
   */
  run(
    mapWidth: number,
    mapHeight: number,
    tileSize: number,
    config: ZoneGenConfig,
    rng: Rng,
  ): MacroPassResult {
    const roadGrid = new Grid<TileTypeId>(mapWidth, mapHeight, TileType.GRASS_LIGHT);
    const zoneGrid = new Grid<number>(mapWidth, mapHeight, -1);

    const zoneCount = rng.int(config.minZones, config.maxZones);
    const zones = this.placeZones(zoneCount, mapWidth, mapHeight, tileSize, config, rng);
    const templateResults = this.evaluateTemplates(zones, rng);

    // Paint zone ground into zoneGrid
    for (let i = 0; i < zones.length; i++) {
      const z = zones[i];
      zoneGrid.fillRect(z.tileBounds.x, z.tileBounds.y, z.tileBounds.width, z.tileBounds.height, i);
    }

    // Route lanes
    const lanes = this.routeLanes(zones, roadGrid, zoneGrid, config, rng, tileSize);

    return { zones, lanes, roadGrid, zoneGrid, templateResults };
  }

  // ---------------------------------------------------------------------------
  // Zone placement
  // ---------------------------------------------------------------------------

  private placeZones(
    count: number,
    mapWidth: number,
    mapHeight: number,
    tileSize: number,
    config: ZoneGenConfig,
    rng: Rng,
  ): ZoneDefinition[] {
    const placed: ZoneDefinition[] = [];
    const margin = config.edgeMarginTiles;
    const minDist = config.minZoneDistanceTiles;
    const maxAttempts = 200;

    // Build faction pool from weights
    const factionPool = Object.entries(config.factionWeights)
      .flatMap(([fId, w]) => Array(Math.round(w * 10)).fill(fId)) as string[];

    for (let i = 0; i < count; i++) {
      const zoneType = rng.weightedPick<ZoneType>(
        config.typeWeights as Record<ZoneType, number>,
      );
      const template = TEMPLATE_REGISTRY[zoneType];
      const tw = template.tileWidth;
      const th = template.tileHeight;

      let attempts = 0;
      let placed_this = false;

      while (attempts < maxAttempts) {
        attempts++;
        const tx = rng.int(margin, mapWidth - tw - margin);
        const ty = rng.int(margin, mapHeight - th - margin);

        if (!this.satisfiesConstraints(tx, ty, tw, th, placed, minDist)) continue;

        const factionId = rng.pick(factionPool);

        const zone: ZoneDefinition = {
          id: `zone_${i}_${zoneType}`,
          type: zoneType,
          factionId,
          tileBounds: { x: tx, y: ty, width: tw, height: th },
          pixelBounds: {
            x: tx * tileSize,
            y: ty * tileSize,
            width: tw * tileSize,
            height: th * tileSize,
          },
          jobs: [],
          isPlayerSpawnZone: i === 0,
          clearanceRadius: 4,
        };

        // Fill jobs from template (populated after evaluate below)
        placed.push(zone);
        placed_this = true;
        break;
      }

      if (!placed_this && placed.length === 0) {
        // Must have at least one zone — force place at center
        const tx = Math.max(0, Math.min(mapWidth - tw, Math.floor(mapWidth / 2) - Math.floor(template.tileWidth / 2)));
        const ty = Math.max(0, Math.min(mapHeight - th, Math.floor(mapHeight / 2) - Math.floor(template.tileHeight / 2)));
        placed.push({
          id: `zone_0_${zoneType}`,
          type: zoneType,
          factionId: rng.pick(factionPool),
          tileBounds: { x: tx, y: ty, width: tw, height: template.tileHeight },
          pixelBounds: {
            x: tx * tileSize,
            y: ty * tileSize,
            width: tw * tileSize,
            height: template.tileHeight * tileSize,
          },
          jobs: [],
          isPlayerSpawnZone: true,
          clearanceRadius: 4,
        });
      }
    }

    return placed;
  }

  private satisfiesConstraints(
    tx: number,
    ty: number,
    tw: number,
    th: number,
    placed: ZoneDefinition[],
    minDist: number,
  ): boolean {
    for (const z of placed) {
      const cx1 = tx + tw / 2;
      const cy1 = ty + th / 2;
      const cx2 = z.tileBounds.x + z.tileBounds.width / 2;
      const cy2 = z.tileBounds.y + z.tileBounds.height / 2;
      const dx = cx1 - cx2;
      const dy = cy1 - cy2;
      if (Math.sqrt(dx * dx + dy * dy) < minDist) return false;

      // Also check AABB overlap with clearance
      const clearance = 3;
      if (
        tx < z.tileBounds.x + z.tileBounds.width + clearance &&
        tx + tw > z.tileBounds.x - clearance &&
        ty < z.tileBounds.y + z.tileBounds.height + clearance &&
        ty + th > z.tileBounds.y - clearance
      ) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // Template evaluation
  // ---------------------------------------------------------------------------

  private evaluateTemplates(zones: ZoneDefinition[], rng: Rng): Map<string, TemplateResult> {
    const results = new Map<string, TemplateResult>();
    for (const zone of zones) {
      const template = TEMPLATE_REGISTRY[zone.type];
      const variation: TemplateVariation = {
        flipX: rng.chance(0.5),
        flipY: false, // keep vertical orientation stable
        colorVariant: rng.int(0, 2) as 0 | 1 | 2,
      };
      const result = template.evaluate(variation, rng.fork(zone.id));
      // Populate zone jobs from template
      zone.jobs = result.jobs;
      results.set(zone.id, result);
    }
    return results;
  }

  // ---------------------------------------------------------------------------
  // Lane routing
  // ---------------------------------------------------------------------------

  private routeLanes(
    zones: ZoneDefinition[],
    roadGrid: Grid<TileTypeId>,
    _zoneGrid: Grid<number>,
    config: ZoneGenConfig,
    rng: Rng,
    tileSize: number,
  ): Lane[] {
    const lanes: Lane[] = [];

    if (zones.length < 2) return lanes;

    // Determine which zone pairs to connect
    const pairs = this.buildConnectionPairs(zones, config.laneCount, rng);

    let laneIdCounter = 0;
    for (const [fromIdx, toIdx] of pairs) {
      const fromZone = zones[fromIdx];
      const toZone   = zones[toIdx];

      // Zone centers in tile space
      const fcx = fromZone.tileBounds.x + fromZone.tileBounds.width / 2;
      const fcy = fromZone.tileBounds.y + fromZone.tileBounds.height / 2;
      const ecx = toZone.tileBounds.x + toZone.tileBounds.width / 2;
      const ecy = toZone.tileBounds.y + toZone.tileBounds.height / 2;

      // Project start/end to zone edges (roads connect at zone boundary, not center)
      const { x: sx, y: sy } = this.projectToZoneEdge(fromZone, ecx, ecy);
      const { x: ex, y: ey } = this.projectToZoneEdge(toZone, fcx, fcy);

      const laneType = this.pickLaneType(fromZone.type, toZone.type, rng);
      const roadType: TileTypeId = laneType === 'road' ? TileType.ROAD :
                                   laneType === 'ruins_shortcut' ? TileType.ROAD_DIRT :
                                   TileType.ROAD_DIRT;

      // Build smooth waypoints directly (no A* grid-walk).
      // Use S-curve routing: mostly-direct path with gentle perpendicular offsets
      // for organic feel.
      const controlPoints = this.buildSmoothControlPoints(sx, sy, ex, ey, rng);

      // Convert to pixel-space waypoints
      const waypoints = controlPoints.map(pt => ({
        x: pt.x * tileSize + tileSize / 2,
        y: pt.y * tileSize + tileSize / 2,
      }));

      // Rasterize the smooth path onto the road grid for collision/prop avoidance
      this.rasterizeSmoothRoad(controlPoints, roadGrid, roadType, laneType === 'road' ? 2 : 1);

      lanes.push({
        id: `lane_${laneIdCounter++}`,
        fromZoneId: fromZone.id,
        toZoneId: toZone.id,
        type: laneType,
        waypoints,
        width: laneType === 'road' ? 64 : 32,
      });
    }

    return lanes;
  }

  /**
   * Build smooth control points for a road between two points.
   * Creates a mostly-direct path with gentle S-curve for organic feel.
   */
  private buildSmoothControlPoints(
    sx: number, sy: number,
    ex: number, ey: number,
    rng: Rng,
  ): { x: number; y: number }[] {
    const dx = ex - sx;
    const dy = ey - sy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1) return [{ x: sx, y: sy }, { x: ex, y: ey }];

    // Normal vector perpendicular to the direct line
    const nx = -dy / dist;
    const ny = dx / dist;

    // Gentle S-curve: two midpoints offset to opposite sides of the direct line.
    // Offset is small (5-12% of distance) so roads stay mostly straight.
    const offset1 = rng.float(0.03, 0.10) * dist * (rng.chance(0.5) ? 1 : -1);
    const offset2 = -offset1 * rng.float(0.4, 0.9); // opposite side, slightly less

    const t1 = 0.3 + rng.float(0, 0.1);  // first midpoint at ~30-40%
    const t2 = 0.6 + rng.float(0, 0.1);  // second midpoint at ~60-70%

    return [
      { x: sx, y: sy },
      { x: sx + dx * t1 + nx * offset1, y: sy + dy * t1 + ny * offset1 },
      { x: sx + dx * t2 + nx * offset2, y: sy + dy * t2 + ny * offset2 },
      { x: ex, y: ey },
    ];
  }

  /**
   * Project from zone center toward a target point, returning the point
   * where the ray exits the zone bounding box (with a small margin).
   */
  private projectToZoneEdge(
    zone: ZoneDefinition,
    targetX: number,
    targetY: number,
  ): { x: number; y: number } {
    const cx = zone.tileBounds.x + zone.tileBounds.width / 2;
    const cy = zone.tileBounds.y + zone.tileBounds.height / 2;
    const dx = targetX - cx;
    const dy = targetY - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };

    const hw = zone.tileBounds.width / 2 + 1;  // +1 tile margin outside zone
    const hh = zone.tileBounds.height / 2 + 1;

    // Find the smallest t > 0 where the ray exits the AABB
    let t = Infinity;
    if (dx !== 0) {
      const tx = (dx > 0 ? hw : -hw) / dx;
      if (tx > 0) t = Math.min(t, tx);
    }
    if (dy !== 0) {
      const ty = (dy > 0 ? hh : -hh) / dy;
      if (ty > 0) t = Math.min(t, ty);
    }
    if (!isFinite(t)) t = 1;

    return { x: cx + dx * t, y: cy + dy * t };
  }

  /**
   * Rasterize a smooth path onto the road grid using dense-point interpolation.
   * Paints tiles around each interpolated point between control points.
   */
  private rasterizeSmoothRoad(
    controlPoints: { x: number; y: number }[],
    roadGrid: Grid<TileTypeId>,
    roadType: TileTypeId,
    halfWidth: number,
  ): void {
    // Interpolate with Catmull-Rom to get dense pixel points
    const dense = this.catmullRomInterpolate(controlPoints, 20);

    for (const pt of dense) {
      const tx = Math.round(pt.x);
      const ty = Math.round(pt.y);
      // Paint a square of tiles around each point
      for (let dy = -halfWidth; dy <= halfWidth; dy++) {
        for (let dx = -halfWidth; dx <= halfWidth; dx++) {
          if (roadGrid.inBounds(tx + dx, ty + dy)) {
            roadGrid.set(tx + dx, ty + dy, roadType);
          }
        }
      }
    }
  }

  /**
   * Catmull-Rom spline interpolation for tile-space control points.
   */
  private catmullRomInterpolate(
    pts: { x: number; y: number }[],
    segmentsPerSpan: number,
  ): { x: number; y: number }[] {
    if (pts.length < 2) return [...pts];
    if (pts.length === 2) {
      // Linear interpolation
      const result: { x: number; y: number }[] = [];
      const dx = pts[1].x - pts[0].x;
      const dy = pts[1].y - pts[0].y;
      const steps = Math.ceil(Math.sqrt(dx * dx + dy * dy));
      if (steps === 0) {
        result.push({ x: pts[0].x, y: pts[0].y });
        return result;
      }
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        result.push({ x: pts[0].x + dx * t, y: pts[0].y + dy * t });
      }
      return result;
    }

    const result: { x: number; y: number }[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(i - 1, 0)];
      const p1 = pts[i];
      const p2 = pts[Math.min(i + 1, pts.length - 1)];
      const p3 = pts[Math.min(i + 2, pts.length - 1)];

      for (let s = 0; s < segmentsPerSpan; s++) {
        const t = s / segmentsPerSpan;
        const t2 = t * t;
        const t3 = t2 * t;
        result.push({
          x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t +
              (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
              (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          y: 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t +
              (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
              (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
        });
      }
    }
    result.push(pts[pts.length - 1]);
    return result;
  }

  private buildConnectionPairs(
    zones: ZoneDefinition[],
    laneCount: number,
    rng: Rng,
  ): Array<[number, number]> {
    const pairs: Array<[number, number]> = [];
    const n = zones.length;
    if (n < 2) return pairs;

    // Always connect zones in a spanning chain
    const order = Array.from({ length: n }, (_, i) => i);
    rng.shuffle(order);

    for (let i = 0; i < order.length - 1; i++) {
      pairs.push([order[i], order[i + 1]]);
    }

    // Add extra cross-connections up to laneCount total
    let extras = Math.max(0, laneCount - (n - 1));
    let attempts = 0;
    while (extras > 0 && attempts < 50) {
      attempts++;
      const a = rng.int(0, n - 1);
      const b = rng.int(0, n - 1);
      if (a === b) continue;
      const key: [number, number] = a < b ? [a, b] : [b, a];
      if (!pairs.some(([pa, pb]) => pa === key[0] && pb === key[1])) {
        pairs.push(key);
        extras--;
      }
    }

    return pairs;
  }

  private pickLaneType(fromType: ZoneType, toType: ZoneType, rng: Rng): LaneType {
    if (fromType === 'ruins' || toType === 'ruins') return 'ruins_shortcut';
    if ((fromType === 'factory' && toType === 'bunker') ||
        (fromType === 'bunker' && toType === 'factory')) return 'road';
    return rng.pick<LaneType>(['road', 'forest_path', 'road']);
  }
}
