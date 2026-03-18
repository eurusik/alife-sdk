import { describe, it, expect } from 'vitest';
import { MacroPass } from './MacroPass';
import { Rng } from '../core/Rng';
import type { ZoneGenConfig } from '../types';

// catmullRomInterpolate is private, so we reach it via a typed helper to keep
// tests readable while avoiding changes to the production API.
function interpolate(
  pts: { x: number; y: number }[],
  segmentsPerSpan = 20,
): { x: number; y: number }[] {
   
  return (new MacroPass() as any).catmullRomInterpolate(pts, segmentsPerSpan);
}

function hasNaN(pts: { x: number; y: number }[]): boolean {
  return pts.some(p => isNaN(p.x) || isNaN(p.y));
}

// ---------------------------------------------------------------------------
// Division-by-zero fix: coincident control points (steps === 0 in the
// two-point linear branch).
// ---------------------------------------------------------------------------

describe('catmullRomInterpolate — coincident points (division-by-zero fix)', () => {
  it('returns a single valid point when both points are identical integers', () => {
    const result = interpolate([{ x: 5, y: 10 }, { x: 5, y: 10 }]);

    expect(result.length).toBe(1);
    expect(result[0]).toEqual({ x: 5, y: 10 });
  });

  it('returns a single valid point when both points are identical floats', () => {
    const result = interpolate([{ x: 3.7, y: -2.1 }, { x: 3.7, y: -2.1 }]);

    expect(result.length).toBe(1);
    expect(result[0]).toEqual({ x: 3.7, y: -2.1 });
  });

  it('produces no NaN values for coincident points', () => {
    const result = interpolate([{ x: 0, y: 0 }, { x: 0, y: 0 }]);

    expect(hasNaN(result)).toBe(false);
  });

  it('produces no NaN values when 4-point spline has coincident middle points', () => {
    // Force two adjacent control points to the same position inside a 4-point
    // Catmull-Rom chain to verify the spline branch also stays NaN-free.
    const result = interpolate([
      { x: 0, y: 0 },
      { x: 5, y: 5 },
      { x: 5, y: 5 }, // coincident with previous
      { x: 10, y: 0 },
    ]);

    expect(hasNaN(result)).toBe(false);
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Normal (non-coincident) cases must continue to work correctly.
// ---------------------------------------------------------------------------

describe('catmullRomInterpolate — non-coincident points (regression)', () => {
  it('two-point path: interpolates between distinct points', () => {
    const result = interpolate([{ x: 0, y: 0 }, { x: 3, y: 4 }]);

    // Distance is 5, so steps = ceil(5) = 5 → 6 points (i=0..5).
    expect(result.length).toBe(6);
    expect(result[0]).toEqual({ x: 0, y: 0 });
    expect(result[result.length - 1]).toEqual({ x: 3, y: 4 });
    expect(hasNaN(result)).toBe(false);
  });

  it('two-point path: all interpolated x values lie between start and end', () => {
    const result = interpolate([{ x: 0, y: 0 }, { x: 10, y: 0 }]);

    for (const p of result) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(10);
    }
  });

  it('four-point spline: produces more points than the input', () => {
    const pts = [
      { x: 0,   y: 0   },
      { x: 10,  y: 5   },
      { x: 20,  y: -5  },
      { x: 30,  y: 0   },
    ];
    const result = interpolate(pts, 20);

    // 3 spans × 20 samples + 1 closing point = 61 minimum.
    expect(result.length).toBeGreaterThan(pts.length);
    expect(hasNaN(result)).toBe(false);
  });

  it('four-point spline: starts and ends at the original endpoints', () => {
    const pts = [
      { x: 0,  y: 0  },
      { x: 10, y: 5  },
      { x: 20, y: -5 },
      { x: 30, y: 0  },
    ];
    const result = interpolate(pts, 20);

    expect(result[0].x).toBeCloseTo(pts[0].x);
    expect(result[0].y).toBeCloseTo(pts[0].y);
    expect(result[result.length - 1].x).toBeCloseTo(pts[pts.length - 1].x);
    expect(result[result.length - 1].y).toBeCloseTo(pts[pts.length - 1].y);
  });

  it('single point: returns it unchanged', () => {
    const result = interpolate([{ x: 7, y: 3 }]);

    expect(result).toEqual([{ x: 7, y: 3 }]);
  });

  it('empty input: returns empty array', () => {
    expect(interpolate([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Helpers for MacroPass.run() tests
// ---------------------------------------------------------------------------

/**
 * Minimal valid ZoneGenConfig for regression testing.
 * Uses a generous map size so zone placement always succeeds within 200
 * attempts and no fallback force-place path is required.
 */
function makeConfig(overrides: Partial<ZoneGenConfig> = {}): ZoneGenConfig {
  return {
    minZones: 3,
    maxZones: 3,
    edgeMarginTiles: 2,
    minZoneDistanceTiles: 10,
    laneCount: 3,
    typeWeights: { camp: 1 },
    factionWeights: { bandits: 1 },
    ...overrides,
  };
}

function runPass(seed: string, config?: Partial<ZoneGenConfig>) {
  const pass = new MacroPass();
  const rng = new Rng(seed);
  return pass.run(100, 100, 32, makeConfig(config), rng);
}

// ---------------------------------------------------------------------------
// Dead-code-removal regression: isPlayerSpawnZone assignment (fix: i === 0 only)
// ---------------------------------------------------------------------------

describe('MacroPass zone placement — isPlayerSpawnZone (dead-code removal fix)', () => {
  it('first zone (index 0) has isPlayerSpawnZone = true', () => {
    const { zones } = runPass('spawn-zone-seed');

    expect(zones.length).toBeGreaterThanOrEqual(1);
    expect(zones[0].isPlayerSpawnZone).toBe(true);
  });

  it('all zones beyond index 0 have isPlayerSpawnZone = false', () => {
    const { zones } = runPass('spawn-zone-seed');

    // Skipping index 0 intentionally — it is the player spawn zone.
    for (let i = 1; i < zones.length; i++) {
      expect(zones[i].isPlayerSpawnZone).toBe(false);
    }
  });

  it('exactly one zone is the player spawn zone regardless of total count', () => {
    const { zones } = runPass('spawn-zone-seed-2', { minZones: 4, maxZones: 4 });

    const spawnZones = zones.filter(z => z.isPlayerSpawnZone);
    expect(spawnZones.length).toBe(1);
  });

  it('the single player spawn zone is always the first element in the zones array', () => {
    const { zones } = runPass('spawn-zone-seed-3', { minZones: 4, maxZones: 4 });

    expect(zones[0].isPlayerSpawnZone).toBe(true);
    // Confirm it is the only one.
    expect(zones.slice(1).every(z => !z.isPlayerSpawnZone)).toBe(true);
  });

  it('produces a consistent result across two runs with the same seed (determinism)', () => {
    const first  = runPass('determinism-seed');
    const second = runPass('determinism-seed');

    expect(first.zones.map(z => z.isPlayerSpawnZone))
      .toEqual(second.zones.map(z => z.isPlayerSpawnZone));
  });
});

// ---------------------------------------------------------------------------
// Dead-code-removal regression: zone placement still works correctly
// ---------------------------------------------------------------------------

describe('MacroPass zone placement — basic regression after dead code removal', () => {
  it('returns the requested number of zones', () => {
    const { zones } = runPass('count-seed', { minZones: 3, maxZones: 3 });

    expect(zones.length).toBe(3);
  });

  it('every zone has a valid id, type, tileBounds, and pixelBounds', () => {
    const { zones } = runPass('fields-seed');

    for (const zone of zones) {
      expect(typeof zone.id).toBe('string');
      expect(zone.id.length).toBeGreaterThan(0);
      expect(typeof zone.type).toBe('string');

      // tileBounds: positive non-zero dimensions
      expect(zone.tileBounds.width).toBeGreaterThan(0);
      expect(zone.tileBounds.height).toBeGreaterThan(0);

      // pixelBounds must be proportional to tileBounds
      expect(zone.pixelBounds.width).toBe(zone.tileBounds.width * 32);
      expect(zone.pixelBounds.height).toBe(zone.tileBounds.height * 32);
    }
  });

  it('zones stay within the map boundaries', () => {
    const mapWidth = 100;
    const mapHeight = 100;
    const { zones } = runPass('bounds-seed', { edgeMarginTiles: 2 });

    for (const zone of zones) {
      expect(zone.tileBounds.x).toBeGreaterThanOrEqual(0);
      expect(zone.tileBounds.y).toBeGreaterThanOrEqual(0);
      expect(zone.tileBounds.x + zone.tileBounds.width).toBeLessThanOrEqual(mapWidth);
      expect(zone.tileBounds.y + zone.tileBounds.height).toBeLessThanOrEqual(mapHeight);
    }
  });

  it('routes lanes between zones when enough zones are placed', () => {
    const { lanes } = runPass('lanes-seed', { minZones: 3, maxZones: 3, laneCount: 3 });

    // A spanning chain over 3 zones produces at least 2 lanes.
    expect(lanes.length).toBeGreaterThanOrEqual(2);
  });

  it('each lane references valid zone ids from the zones array', () => {
    const { zones, lanes } = runPass('lane-refs-seed', { minZones: 3, maxZones: 3 });

    const zoneIds = new Set(zones.map(z => z.id));
    for (const lane of lanes) {
      expect(zoneIds.has(lane.fromZoneId)).toBe(true);
      expect(zoneIds.has(lane.toZoneId)).toBe(true);
    }
  });

  it('zoneGrid cells inside a zone footprint are set to the zone index', () => {
    const { zones, zoneGrid } = runPass('grid-seed');

    for (let i = 0; i < zones.length; i++) {
      const { x, y, width, height } = zones[i].tileBounds;
      // Sample the four corners of the footprint.
      expect(zoneGrid.get(x, y)).toBe(i);
      expect(zoneGrid.get(x + width - 1, y)).toBe(i);
      expect(zoneGrid.get(x, y + height - 1)).toBe(i);
      expect(zoneGrid.get(x + width - 1, y + height - 1)).toBe(i);
    }
  });
});
