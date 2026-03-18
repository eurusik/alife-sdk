// src/scoring/MapScorer.ts
// Composite scoring function for map candidates.
//
// Each scoring dimension returns 0..1.
// Dimensions are weighted and summed to produce a final score.
// The MapGenerator runs N candidates and picks the highest scorer.
//
// Scoring dimensions:
//   1. Zone spread (symmetry-ish): zones distributed across the map area
//   2. Path diversity: lane types vary (not all the same type)
//   3. Cover distribution: cover points spread across map, not clumped
//   4. Density variance: some zones have more props than others (visual interest)
//   5. Faction balance: factions roughly evenly distributed across map quadrants
//   6. Lane connectivity: every zone connected, bonus for multiple routes

import type { MapDefinition } from '../types.js';

// ---------------------------------------------------------------------------
// Scoring weights
// ---------------------------------------------------------------------------

const WEIGHTS = {
  zoneSpread:       0.25,
  pathDiversity:    0.15,
  coverDistribution:0.20,
  densityVariance:  0.10,
  factionBalance:   0.15,
  laneConnectivity: 0.15,
} as const;

// ---------------------------------------------------------------------------
// MapScorer
// ---------------------------------------------------------------------------

export class MapScorer {
  /**
   * Score a candidate MapDefinition.
   * Higher is better. Returns a value roughly in [0, 1].
   */
  score(map: MapDefinition): number {
    const spread   = this.scoreZoneSpread(map);
    const paths    = this.scorePathDiversity(map);
    const cover    = this.scoreCoverDistribution(map);
    const density  = this.scoreDensityVariance(map);
    const faction  = this.scoreFactionBalance(map);
    const lanes    = this.scoreLaneConnectivity(map);

    return (
      spread   * WEIGHTS.zoneSpread +
      paths    * WEIGHTS.pathDiversity +
      cover    * WEIGHTS.coverDistribution +
      density  * WEIGHTS.densityVariance +
      faction  * WEIGHTS.factionBalance +
      lanes    * WEIGHTS.laneConnectivity
    );
  }

  /**
   * Return a breakdown of individual scores for debugging.
   */
  breakdown(map: MapDefinition): Record<string, number> {
    return {
      zoneSpread:        this.scoreZoneSpread(map),
      pathDiversity:     this.scorePathDiversity(map),
      coverDistribution: this.scoreCoverDistribution(map),
      densityVariance:   this.scoreDensityVariance(map),
      factionBalance:    this.scoreFactionBalance(map),
      laneConnectivity:  this.scoreLaneConnectivity(map),
      total:             this.score(map),
    };
  }

  // ---------------------------------------------------------------------------
  // Zone spread: how evenly distributed are zone centers across the map?
  // Ideal: zones in different quadrants, maximum bounding area.
  // ---------------------------------------------------------------------------

  private scoreZoneSpread(map: MapDefinition): number {
    if (map.zones.length < 2) return 0;

    const mapW = map.width * map.tileSize;
    const mapH = map.height * map.tileSize;

    // Score 1: normalized bounding box area of all zone centers
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (const z of map.zones) {
      const cx = z.pixelBounds.x + z.pixelBounds.width / 2;
      const cy = z.pixelBounds.y + z.pixelBounds.height / 2;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cy < minY) minY = cy;
      if (cy > maxY) maxY = cy;
    }

    const spreadX = (maxX - minX) / mapW;
    const spreadY = (maxY - minY) / mapH;
    const areaScore = spreadX * spreadY;

    // Score 2: quadrant coverage (each quadrant has at least one zone)
    const quadrants = new Set<number>();
    for (const z of map.zones) {
      const cx = z.pixelBounds.x + z.pixelBounds.width / 2;
      const cy = z.pixelBounds.y + z.pixelBounds.height / 2;
      const qx = cx < mapW / 2 ? 0 : 1;
      const qy = cy < mapH / 2 ? 0 : 1;
      quadrants.add(qy * 2 + qx);
    }
    const quadrantScore = quadrants.size / 4;

    return (areaScore * 0.6 + quadrantScore * 0.4);
  }

  // ---------------------------------------------------------------------------
  // Path diversity: lane types should not all be the same
  // ---------------------------------------------------------------------------

  private scorePathDiversity(map: MapDefinition): number {
    if (map.lanes.length === 0) return 0;
    const typeSet = new Set(map.lanes.map(l => l.type));
    return Math.min(1, typeSet.size / 2); // 2+ types = perfect score
  }

  // ---------------------------------------------------------------------------
  // Cover distribution: cover points spread evenly, not all in one corner
  // ---------------------------------------------------------------------------

  private scoreCoverDistribution(map: MapDefinition): number {
    if (map.coverPoints.length < 2) return 0;

    const mapW = map.width * map.tileSize;
    const mapH = map.height * map.tileSize;
    const cellW = mapW / 4;
    const cellH = mapH / 4;

    // Count cover points per 4×4 grid cell
    const cellCounts = new Map<number, number>();
    for (const cp of map.coverPoints) {
      const cx = Math.min(3, Math.floor(cp.x / cellW));
      const cy = Math.min(3, Math.floor(cp.y / cellH));
      const key = cy * 4 + cx;
      cellCounts.set(key, (cellCounts.get(key) ?? 0) + 1);
    }

    const occupiedCells = cellCounts.size;
    const totalCells = 16;

    // Gini coefficient of cover distribution (lower = more even)
    const values = Array.from(cellCounts.values()).sort((a, b) => a - b);
    const n = values.length;
    const mean = values.reduce((s, v) => s + v, 0) / n;
    let giniNumerator = 0;
    for (let i = 0; i < n; i++) {
      giniNumerator += (2 * (i + 1) - n - 1) * values[i];
    }
    const gini = n === 1 ? 0 : giniNumerator / (n * n * mean);
    const evenness = 1 - Math.abs(gini);

    return (occupiedCells / totalCells) * 0.5 + evenness * 0.5;
  }

  // ---------------------------------------------------------------------------
  // Density variance: zones should have different prop counts
  // ---------------------------------------------------------------------------

  private scoreDensityVariance(map: MapDefinition): number {
    if (map.zones.length < 2) return 0.5; // neutral

    const propCountsByZone = new Map<string, number>();
    for (const prop of map.props) {
      if (!prop.zoneId) continue;
      propCountsByZone.set(prop.zoneId, (propCountsByZone.get(prop.zoneId) ?? 0) + 1);
    }

    const counts = Array.from(propCountsByZone.values());
    if (counts.length < 2) return 0.5;

    const mean = counts.reduce((s, v) => s + v, 0) / counts.length;
    const variance = counts.reduce((s, v) => s + (v - mean) ** 2, 0) / counts.length;
    const stdDev = Math.sqrt(variance);
    const cv = mean > 0 ? stdDev / mean : 0; // coefficient of variation

    // Target CV around 0.3–0.6 (some variance but not extreme)
    const target = 0.45;
    const score = 1 - Math.min(1, Math.abs(cv - target) / target);
    return score;
  }

  // ---------------------------------------------------------------------------
  // Faction balance: different factions in different map halves
  // ---------------------------------------------------------------------------

  private scoreFactionBalance(map: MapDefinition): number {
    if (map.zones.length < 2) return 0.5;

    const mapW = map.width * map.tileSize;
    const leftFactions = new Set<string>();
    const rightFactions = new Set<string>();

    for (const z of map.zones) {
      const cx = z.pixelBounds.x + z.pixelBounds.width / 2;
      if (cx < mapW / 2) leftFactions.add(z.factionId);
      else                rightFactions.add(z.factionId);
    }

    // Good: both halves have zones, different factions on different sides
    if (leftFactions.size === 0 || rightFactions.size === 0) return 0.1;

    const totalFactions = new Set([...leftFactions, ...rightFactions]).size;
    const mixScore = totalFactions >= 2 ? 1 : 0.5;

    return mixScore;
  }

  // ---------------------------------------------------------------------------
  // Lane connectivity: every zone has at least one lane; bonus for 2+
  // ---------------------------------------------------------------------------

  private scoreLaneConnectivity(map: MapDefinition): number {
    if (map.zones.length === 0) return 0;

    const laneCount = new Map<string, number>();
    for (const lane of map.lanes) {
      laneCount.set(lane.fromZoneId, (laneCount.get(lane.fromZoneId) ?? 0) + 1);
      laneCount.set(lane.toZoneId,   (laneCount.get(lane.toZoneId)   ?? 0) + 1);
    }

    let connectedZones = 0;
    let multiConnected = 0;

    for (const zone of map.zones) {
      const count = laneCount.get(zone.id) ?? 0;
      if (count >= 1) connectedZones++;
      if (count >= 2) multiConnected++;
    }

    const connectRatio = connectedZones / map.zones.length;
    const multiRatio   = multiConnected  / map.zones.length;

    return connectRatio * 0.7 + multiRatio * 0.3;
  }
}
