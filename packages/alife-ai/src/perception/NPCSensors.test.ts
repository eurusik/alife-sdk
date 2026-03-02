import { describe, it, expect } from 'vitest';
import { NPCSensors, filterFreshIntel } from './NPCSensors';
import type { IPerceptibleEntity } from './NPCSensors';
import type { Vec2 } from '@alife-sdk/core';
import type { SpatialGrid } from '@alife-sdk/core';

// Mock SpatialGrid — повертає всі entities в queryRadius
function makeMockGrid(entities: Array<{ id: string; position: Vec2 }>): SpatialGrid<{ id: string; position: Vec2 }> {
  return {
    queryRadius: (_pos: Vec2, _radius: number) => entities,
  } as unknown as SpatialGrid<{ id: string; position: Vec2 }>;
}

// Helper: create IPerceptibleEntity
function makeEntity(overrides: Partial<IPerceptibleEntity> & { id: string }): IPerceptibleEntity {
  return {
    id: overrides.id,
    position: overrides.position ?? { x: 0, y: 0 },
    factionId: overrides.factionId ?? 'faction_a',
    facingAngle: overrides.facingAngle ?? 0,
    isAlive: overrides.isAlive ?? true,
    visionRange: overrides.visionRange ?? 300,
    visionHalfAngle: overrides.visionHalfAngle ?? Math.PI / 3, // 120° total
    hearingRange: overrides.hearingRange ?? 500,
  };
}

const alwaysHostile = () => true;
const neverHostile = () => false;

describe('NPCSensors', () => {
  describe('detectVision()', () => {
    it('1. returns [] for empty observers', () => {
      const grid = makeMockGrid([]);
      const sensors = new NPCSensors({ spatialGrid: grid, isHostile: alwaysHostile });
      expect(sensors.detectVision([])).toHaveLength(0);
    });

    it('2. detects entity directly in front (in FOV) → visual event', () => {
      const observer = makeEntity({ id: 'obs', position: { x: 0, y: 0 }, facingAngle: 0 });
      const target = makeEntity({ id: 'tgt', position: { x: 100, y: 0 }, factionId: 'faction_b' });
      const grid = makeMockGrid([{ id: 'tgt', position: target.position }]);
      const sensors = new NPCSensors({ spatialGrid: grid, isHostile: alwaysHostile });

      const events = sensors.detectVision([observer, target]);
      expect(events).toHaveLength(1);
      expect(events[0].observerId).toBe('obs');
      expect(events[0].targetId).toBe('tgt');
      expect(events[0].channel).toBe('visual');
      expect(events[0].confidence).toBe(1.0);
    });

    it('3. ignores entity behind observer (out of FOV angle)', () => {
      const observer = makeEntity({ id: 'obs', position: { x: 0, y: 0 }, facingAngle: 0, visionHalfAngle: Math.PI / 4 });
      // Entity directly behind (angle = Math.PI from facing 0)
      const target = makeEntity({ id: 'tgt', position: { x: -100, y: 0 }, factionId: 'faction_b' });
      const grid = makeMockGrid([{ id: 'tgt', position: target.position }]);
      const sensors = new NPCSensors({ spatialGrid: grid, isHostile: alwaysHostile });

      expect(sensors.detectVision([observer, target])).toHaveLength(0);
    });

    it('4. ignores entity out of vision range', () => {
      const observer = makeEntity({ id: 'obs', position: { x: 0, y: 0 }, facingAngle: 0, visionRange: 100 });
      const target = makeEntity({ id: 'tgt', position: { x: 500, y: 0 }, factionId: 'faction_b' });
      // grid mock returns target regardless of radius check — testing FOV range guard
      const grid = makeMockGrid([{ id: 'tgt', position: target.position }]);
      const sensors = new NPCSensors({ spatialGrid: grid, isHostile: alwaysHostile });

      expect(sensors.detectVision([observer, target])).toHaveLength(0);
    });

    it('5. ignores friendly entity (isHostile returns false)', () => {
      const observer = makeEntity({ id: 'obs', position: { x: 0, y: 0 }, facingAngle: 0 });
      const target = makeEntity({ id: 'tgt', position: { x: 50, y: 0 }, factionId: 'faction_a' }); // same faction
      const grid = makeMockGrid([{ id: 'tgt', position: target.position }]);
      const sensors = new NPCSensors({ spatialGrid: grid, isHostile: neverHostile });

      expect(sensors.detectVision([observer, target])).toHaveLength(0);
    });

    it('6. ignores dead entities', () => {
      const observer = makeEntity({ id: 'obs', position: { x: 0, y: 0 }, facingAngle: 0 });
      const target = makeEntity({ id: 'tgt', position: { x: 50, y: 0 }, isAlive: false, factionId: 'faction_b' });
      const grid = makeMockGrid([{ id: 'tgt', position: target.position }]);
      const sensors = new NPCSensors({ spatialGrid: grid, isHostile: alwaysHostile });

      expect(sensors.detectVision([observer, target])).toHaveLength(0);
    });

    it('7. observer does not detect itself', () => {
      const observer = makeEntity({ id: 'obs', position: { x: 0, y: 0 }, facingAngle: 0 });
      const grid = makeMockGrid([{ id: 'obs', position: observer.position }]);
      const sensors = new NPCSensors({ spatialGrid: grid, isHostile: alwaysHostile });

      expect(sensors.detectVision([observer])).toHaveLength(0);
    });

    it('8. dead observer does not detect anything', () => {
      const observer = makeEntity({ id: 'obs', position: { x: 0, y: 0 }, facingAngle: 0, isAlive: false });
      const target = makeEntity({ id: 'tgt', position: { x: 50, y: 0 }, factionId: 'faction_b' });
      const grid = makeMockGrid([{ id: 'tgt', position: target.position }]);
      const sensors = new NPCSensors({ spatialGrid: grid, isHostile: alwaysHostile });

      expect(sensors.detectVision([observer, target])).toHaveLength(0);
    });

    it('9. multiple observers can each detect a target', () => {
      const obs1 = makeEntity({ id: 'obs1', position: { x: 0, y: 0 }, facingAngle: 0, factionId: 'faction_a' });
      const obs2 = makeEntity({ id: 'obs2', position: { x: 10, y: 0 }, facingAngle: 0, factionId: 'faction_a' });
      const target = makeEntity({ id: 'tgt', position: { x: 100, y: 0 }, factionId: 'faction_b' });
      const grid = makeMockGrid([{ id: 'tgt', position: target.position }]);
      const sensors = new NPCSensors({ spatialGrid: grid, isHostile: alwaysHostile });

      const events = sensors.detectVision([obs1, obs2, target]);
      expect(events).toHaveLength(2);
      const observerIds = events.map(e => e.observerId);
      expect(observerIds).toContain('obs1');
      expect(observerIds).toContain('obs2');
    });

    it('9b. one observer detects multiple targets', () => {
      const observer = makeEntity({ id: 'obs', position: { x: 0, y: 0 }, facingAngle: 0, factionId: 'faction_a' });
      const tgt1 = makeEntity({ id: 'tgt1', position: { x: 50, y: 0 }, factionId: 'faction_b' });
      const tgt2 = makeEntity({ id: 'tgt2', position: { x: 80, y: 0 }, factionId: 'faction_b' });
      const grid = makeMockGrid([
        { id: 'tgt1', position: tgt1.position },
        { id: 'tgt2', position: tgt2.position },
      ]);
      const sensors = new NPCSensors({ spatialGrid: grid, isHostile: alwaysHostile });

      const events = sensors.detectVision([observer, tgt1, tgt2]);
      // Filter only observer's detections (targets may also detect each other)
      const obsEvents = events.filter(e => e.observerId === 'obs');
      expect(obsEvents).toHaveLength(2);
      const ids = obsEvents.map(e => e.targetId);
      expect(ids).toContain('tgt1');
      expect(ids).toContain('tgt2');
    });

    it('10. targetPosition matches target entity position', () => {
      const observer = makeEntity({ id: 'obs', position: { x: 0, y: 0 }, facingAngle: 0 });
      const targetPos = { x: 120, y: 0 };
      const target = makeEntity({ id: 'tgt', position: targetPos, factionId: 'faction_b' });
      const grid = makeMockGrid([{ id: 'tgt', position: targetPos }]);
      const sensors = new NPCSensors({ spatialGrid: grid, isHostile: alwaysHostile });

      const events = sensors.detectVision([observer, target]);
      expect(events[0].targetPosition).toEqual(targetPos);
    });
  });

  describe('detectVision() — isLineOfSightClear', () => {
    it('LOS clear → detection emitted', () => {
      const observer = makeEntity({ id: 'obs', position: { x: 0, y: 0 }, facingAngle: 0 });
      const target = makeEntity({ id: 'tgt', position: { x: 100, y: 0 }, factionId: 'faction_b' });
      const grid = makeMockGrid([{ id: 'tgt', position: target.position }]);
      const sensors = new NPCSensors({
        spatialGrid: grid,
        isHostile: alwaysHostile,
        isLineOfSightClear: () => true,
      });

      expect(sensors.detectVision([observer, target])).toHaveLength(1);
    });

    it('LOS blocked → no detection despite target being in FOV', () => {
      const observer = makeEntity({ id: 'obs', position: { x: 0, y: 0 }, facingAngle: 0 });
      const target = makeEntity({ id: 'tgt', position: { x: 100, y: 0 }, factionId: 'faction_b' });
      const grid = makeMockGrid([{ id: 'tgt', position: target.position }]);
      const sensors = new NPCSensors({
        spatialGrid: grid,
        isHostile: alwaysHostile,
        isLineOfSightClear: () => false,
      });

      expect(sensors.detectVision([observer, target])).toHaveLength(0);
    });

    it('LOS callback receives observer and target positions in correct order', () => {
      const observer = makeEntity({ id: 'obs', position: { x: 10, y: 20 }, facingAngle: 0 });
      const target = makeEntity({ id: 'tgt', position: { x: 110, y: 20 }, factionId: 'faction_b' });
      const grid = makeMockGrid([{ id: 'tgt', position: target.position }]);

      const calls: Array<[Vec2, Vec2]> = [];
      const sensors = new NPCSensors({
        spatialGrid: grid,
        isHostile: alwaysHostile,
        isLineOfSightClear: (from, to) => { calls.push([from, to]); return true; },
      });

      sensors.detectVision([observer, target]);
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toEqual(observer.position);
      expect(calls[0][1]).toEqual(target.position);
    });

    it('mixed: one target blocked, one clear → only clear emitted', () => {
      const observer = makeEntity({ id: 'obs', position: { x: 0, y: 0 }, facingAngle: 0 });
      const blocked = makeEntity({ id: 'blocked', position: { x: 80, y: 0 }, factionId: 'faction_b' });
      const visible = makeEntity({ id: 'visible', position: { x: 90, y: 0 }, factionId: 'faction_b' });
      const grid = makeMockGrid([
        { id: 'blocked', position: blocked.position },
        { id: 'visible', position: visible.position },
      ]);
      const sensors = new NPCSensors({
        spatialGrid: grid,
        isHostile: alwaysHostile,
        isLineOfSightClear: (_from, to) => to.x !== 80,
      });

      const events = sensors.detectVision([observer, blocked, visible]);
      const obsEvents = events.filter(e => e.observerId === 'obs');
      expect(obsEvents).toHaveLength(1);
      expect(obsEvents[0].targetId).toBe('visible');
    });

    it('without isLineOfSightClear → LOS assumed clear (backward compat)', () => {
      const observer = makeEntity({ id: 'obs', position: { x: 0, y: 0 }, facingAngle: 0 });
      const target = makeEntity({ id: 'tgt', position: { x: 100, y: 0 }, factionId: 'faction_b' });
      const grid = makeMockGrid([{ id: 'tgt', position: target.position }]);
      const sensors = new NPCSensors({ spatialGrid: grid, isHostile: alwaysHostile });

      expect(sensors.detectVision([observer, target])).toHaveLength(1);
    });
  });

  describe('detectSound()', () => {
    it('1. detects hearer within sound range → sound event', () => {
      const hearer = makeEntity({ id: 'h1', position: { x: 100, y: 0 }, hearingRange: 500 });
      const grid = makeMockGrid([]);
      const sensors = new NPCSensors({ spatialGrid: grid, isHostile: alwaysHostile });

      const events = sensors.detectSound({ x: 0, y: 0 }, 300, 'shooter', 'faction_a', [hearer]);
      expect(events).toHaveLength(1);
      expect(events[0].observerId).toBe('h1');
      expect(events[0].channel).toBe('sound');
    });

    it('2. ignores hearer beyond sound range', () => {
      const hearer = makeEntity({ id: 'h1', position: { x: 1000, y: 0 }, hearingRange: 2000 });
      const grid = makeMockGrid([]);
      const sensors = new NPCSensors({ spatialGrid: grid, isHostile: alwaysHostile });

      expect(sensors.detectSound({ x: 0, y: 0 }, 300, 'src', 'f', [hearer])).toHaveLength(0);
    });

    it('3. ignores hearer beyond their own hearing range (even if within sound range)', () => {
      const hearer = makeEntity({ id: 'h1', position: { x: 200, y: 0 }, hearingRange: 50 });
      const grid = makeMockGrid([]);
      const sensors = new NPCSensors({ spatialGrid: grid, isHostile: alwaysHostile });

      // soundRange=500 covers hearer, but hearer.hearingRange=50 < dist=200
      expect(sensors.detectSound({ x: 0, y: 0 }, 500, 'src', 'f', [hearer])).toHaveLength(0);
    });

    it('4. confidence decreases with distance (linear decay)', () => {
      const near = makeEntity({ id: 'near', position: { x: 50, y: 0 }, hearingRange: 500 });
      const far = makeEntity({ id: 'far', position: { x: 200, y: 0 }, hearingRange: 500 });
      const grid = makeMockGrid([]);
      const sensors = new NPCSensors({ spatialGrid: grid, isHostile: alwaysHostile });

      const events = sensors.detectSound({ x: 0, y: 0 }, 300, 'src', 'f', [near, far]);
      const nearConf = events.find(e => e.observerId === 'near')!.confidence;
      const farConf = events.find(e => e.observerId === 'far')!.confidence;
      expect(nearConf).toBeGreaterThan(farConf);
      expect(nearConf).toBeLessThan(1.0);
    });

    it('5. detects friendly faction (sound is omnidirectional, no faction filter)', () => {
      const hearer = makeEntity({ id: 'h1', position: { x: 50, y: 0 }, factionId: 'faction_a', hearingRange: 500 });
      const grid = makeMockGrid([]);
      const sensors = new NPCSensors({ spatialGrid: grid, isHostile: neverHostile });

      expect(sensors.detectSound({ x: 0, y: 0 }, 200, 'src', 'faction_a', [hearer])).toHaveLength(1);
    });

    it('6. ignores dead hearers', () => {
      const hearer = makeEntity({ id: 'h1', position: { x: 50, y: 0 }, isAlive: false, hearingRange: 500 });
      const grid = makeMockGrid([]);
      const sensors = new NPCSensors({ spatialGrid: grid, isHostile: alwaysHostile });

      expect(sensors.detectSound({ x: 0, y: 0 }, 200, 'src', 'f', [hearer])).toHaveLength(0);
    });

    it('7. source entity does not hear its own sound', () => {
      const source = makeEntity({ id: 'src', position: { x: 0, y: 0 }, hearingRange: 500 });
      const grid = makeMockGrid([]);
      const sensors = new NPCSensors({ spatialGrid: grid, isHostile: alwaysHostile });

      expect(sensors.detectSound({ x: 0, y: 0 }, 300, 'src', 'f', [source])).toHaveLength(0);
    });

    it('8. targetPosition is the sound source position', () => {
      const hearer = makeEntity({ id: 'h1', position: { x: 50, y: 0 }, hearingRange: 500 });
      const grid = makeMockGrid([]);
      const sensors = new NPCSensors({ spatialGrid: grid, isHostile: alwaysHostile });
      const sourcePos = { x: 0, y: 0 };

      const events = sensors.detectSound(sourcePos, 200, 'src', 'f', [hearer]);
      expect(events[0].targetPosition).toEqual(sourcePos);
    });

    it('9. returns empty for empty hearers list', () => {
      const grid = makeMockGrid([]);
      const sensors = new NPCSensors({ spatialGrid: grid, isHostile: alwaysHostile });

      expect(sensors.detectSound({ x: 0, y: 0 }, 300, 'src', 'f', [])).toHaveLength(0);
    });

    it('10a. soundRange=0 returns [] without NaN/throw', () => {
      const hearer = makeEntity({ id: 'h1', position: { x: 0, y: 0 }, hearingRange: 500 });
      const grid = makeMockGrid([]);
      const sensors = new NPCSensors({ spatialGrid: grid, isHostile: alwaysHostile });

      expect(sensors.detectSound({ x: 0, y: 0 }, 0, 'src', 'f', [hearer])).toHaveLength(0);
    });

    it('10. confidence is 0 at exactly soundRange boundary', () => {
      const hearer = makeEntity({ id: 'h1', position: { x: 300, y: 0 }, hearingRange: 1000 });
      const grid = makeMockGrid([]);
      const sensors = new NPCSensors({ spatialGrid: grid, isHostile: alwaysHostile });

      const events = sensors.detectSound({ x: 0, y: 0 }, 300, 'src', 'f', [hearer]);
      // dist=300 = soundRange → confidence = max(0, 1 - 300/300) = 0
      expect(events).toHaveLength(1);
      expect(events[0].confidence).toBe(0);
    });
  });
});

describe('filterFreshIntel()', () => {
  it('1. returns empty for empty input', () => {
    expect(filterFreshIntel([], 1000)).toHaveLength(0);
  });

  it('2. returns fresh targets (within freshnessMs)', () => {
    const targets = [{ id: 't1', position: { x: 0, y: 0 }, lastSeenMs: 4000 }];
    const result = filterFreshIntel(targets, 5000, 2000); // 5000 - 4000 = 1000 < 2000 → fresh
    expect(result).toHaveLength(1);
  });

  it('3. filters stale targets (older than freshnessMs)', () => {
    const targets = [{ id: 't1', position: { x: 0, y: 0 }, lastSeenMs: 1000 }];
    const result = filterFreshIntel(targets, 10000, 2000); // 10000 - 1000 = 9000 > 2000 → stale
    expect(result).toHaveLength(0);
  });

  it('4. uses default freshnessMs of 5000', () => {
    const targets = [{ id: 't1', position: { x: 0, y: 0 }, lastSeenMs: 9999 }];
    const result = filterFreshIntel(targets, 10000); // 10000 - 9999 = 1 < 5000 → fresh
    expect(result).toHaveLength(1);
  });

  it('5. target seen exactly at freshnessMs boundary is included', () => {
    const targets = [{ id: 't1', position: { x: 0, y: 0 }, lastSeenMs: 5000 }];
    const result = filterFreshIntel(targets, 10000, 5000); // 10000 - 5000 = 5000 <= 5000 → fresh
    expect(result).toHaveLength(1);
  });

  it('6. preserves id and position in returned objects', () => {
    const pos = { x: 42, y: 77 };
    const targets = [{ id: 'enemy_1', position: pos, lastSeenMs: 9000 }];
    const result = filterFreshIntel(targets, 10000, 5000);
    expect(result[0].id).toBe('enemy_1');
    expect(result[0].position).toEqual(pos);
  });

  it('7. mixes fresh and stale targets — only fresh returned', () => {
    const targets = [
      { id: 'fresh', position: { x: 0, y: 0 }, lastSeenMs: 9500 },
      { id: 'stale', position: { x: 0, y: 0 }, lastSeenMs: 1000 },
    ];
    const result = filterFreshIntel(targets, 10000, 2000);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('fresh');
  });
});
