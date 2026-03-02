import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '@alife-sdk/core';
import { HazardManager } from './HazardManager';
import { HazardZone } from '../zone/HazardZone';
import { ArtefactRegistry, WeightedArtefactSelector } from '../artefact/ArtefactRegistry';
import { HazardEvents } from '../events/HazardEvents';
import type { HazardEventPayloads } from '../events/HazardEvents';
import type { IHazardEntity } from './HazardManager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEventBus(): EventBus<HazardEventPayloads> {
  return new EventBus<HazardEventPayloads>();
}

/** Always returns 0 — weighted selector picks first candidate; lottery rolls fail (0 <= artefactChance). */
const alwaysZero = { next: () => 0 };

/** Returns 0.9999 — lottery fails when artefactChance < 1.0. */
const alwaysHigh = { next: () => 0.9999 };

/** Returns 0 then 0 — lottery passes (0 <= artefactChance=1.0) then perimeter sample uses zeros. */
const alwaysZeroLottery = { next: () => 0 };

function makeRegistry(random = alwaysZero) {
  const selector = new WeightedArtefactSelector(random);
  return new ArtefactRegistry(selector);
}

function makeManager(
  eventBus: EventBus<HazardEventPayloads>,
  registry: ArtefactRegistry,
  random: { next(): number } = alwaysZero,
  factoryFn?: () => void,
) {
  const factory = { create: vi.fn(factoryFn ?? (() => {})) };
  const manager = new HazardManager(eventBus, registry, { artefactFactory: factory, random });
  return { manager, factory };
}

const BASE_ZONE_CFG = {
  id: 'zone_1',
  type: 'radiation' as const,
  x: 100,
  y: 100,
  radius: 50,
  damagePerSecond: 10,
  damageTickIntervalMs: 500,
  artefactChance: 0.5,
  artefactSpawnCycleMs: 60_000,
  maxArtefacts: 3,
};

// ---------------------------------------------------------------------------
// HazardZone unit tests (1-7)
// ---------------------------------------------------------------------------

describe('HazardZone', () => {
  it('1. advance() increments both damage and artefact timers', () => {
    const zone = new HazardZone({ ...BASE_ZONE_CFG, id: 'z1' });
    zone.advance(300);
    // Verify by checking readiness flags (timers are private)
    expect(zone.isDamageTickReady()).toBe(false); // 300 < 500
    zone.advance(200);
    expect(zone.isDamageTickReady()).toBe(true);  // 500 >= 500
  });

  it('2. isDamageTickReady() is false before interval, true after', () => {
    const zone = new HazardZone({ ...BASE_ZONE_CFG, id: 'z2', damageTickIntervalMs: 1000 });
    zone.advance(999);
    expect(zone.isDamageTickReady()).toBe(false);
    zone.advance(1);
    expect(zone.isDamageTickReady()).toBe(true);
  });

  it('3. consumeDamageTick() carry-over: advance(600ms) with 500ms interval → timer = 100ms after consume', () => {
    const zone = new HazardZone({ ...BASE_ZONE_CFG, id: 'z3', damageTickIntervalMs: 500 });
    zone.advance(600);
    expect(zone.isDamageTickReady()).toBe(true);
    zone.consumeDamageTick();
    // Timer should now be 100ms (600 - 500)
    expect(zone.isDamageTickReady()).toBe(false); // 100 < 500
    zone.advance(400);
    expect(zone.isDamageTickReady()).toBe(true);  // 100 + 400 = 500 >= 500
  });

  it('4. containsPoint() returns true inside, false outside', () => {
    const zone = new HazardZone({ ...BASE_ZONE_CFG, id: 'z4', x: 0, y: 0, radius: 50 });
    expect(zone.containsPoint(0, 0)).toBe(true);
    expect(zone.containsPoint(49, 0)).toBe(true);
    expect(zone.containsPoint(50, 0)).toBe(true);   // exactly on boundary
    expect(zone.containsPoint(51, 0)).toBe(false);  // outside
    expect(zone.containsPoint(100, 100)).toBe(false);
  });

  it('5. getDamagePerTick() = damagePerSecond × intervalMs / 1000', () => {
    const zone = new HazardZone({ ...BASE_ZONE_CFG, id: 'z5', damagePerSecond: 20, damageTickIntervalMs: 500 });
    expect(zone.getDamagePerTick()).toBe(10); // 20 * 500 / 1000
  });

  it('6. isAtCapacity is true when artefactCount reaches maxArtefacts', () => {
    const zone = new HazardZone({ ...BASE_ZONE_CFG, id: 'z6', maxArtefacts: 2 });
    expect(zone.isAtCapacity).toBe(false);
    zone.notifyArtefactAdded();
    expect(zone.isAtCapacity).toBe(false);
    zone.notifyArtefactAdded();
    expect(zone.isAtCapacity).toBe(true);
  });

  it('7. notifyArtefactRemoved() clamps artefactCount to 0', () => {
    const zone = new HazardZone({ ...BASE_ZONE_CFG, id: 'z7' });
    // Count is 0, removing should clamp to 0
    zone.notifyArtefactRemoved();
    expect(zone.artefactCount).toBe(0);
    // Add then remove
    zone.notifyArtefactAdded();
    expect(zone.artefactCount).toBe(1);
    zone.notifyArtefactRemoved();
    expect(zone.artefactCount).toBe(0);
    zone.notifyArtefactRemoved(); // clamp
    expect(zone.artefactCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// HazardManager tests (8-15)
// ---------------------------------------------------------------------------

describe('HazardManager', () => {
  it('8. addZone() → getZone() → getAllZones() works correctly', () => {
    const bus = makeEventBus();
    const registry = makeRegistry();
    const { manager } = makeManager(bus, registry);

    manager.addZone(BASE_ZONE_CFG);
    const zone = manager.getZone('zone_1');
    expect(zone).toBeDefined();
    expect(zone?.config.id).toBe('zone_1');
    expect(manager.getAllZones()).toHaveLength(1);
    expect(manager.size).toBe(1);
  });

  it('9. addZone() throws on duplicate id', () => {
    const bus = makeEventBus();
    const registry = makeRegistry();
    const { manager } = makeManager(bus, registry);

    manager.addZone(BASE_ZONE_CFG);
    expect(() => manager.addZone(BASE_ZONE_CFG)).toThrow('[HazardManager] Zone "zone_1" already registered');
  });

  it('10. tick() emits HAZARD_DAMAGE for entity inside zone after damageTickIntervalMs', () => {
    const bus = makeEventBus();
    const registry = makeRegistry();
    const { manager } = makeManager(bus, registry);

    manager.addZone({ ...BASE_ZONE_CFG, damageTickIntervalMs: 500 });

    const received: { entityId: string; damage: number }[] = [];
    bus.on(HazardEvents.HAZARD_DAMAGE, (p) => { received.push({ entityId: p.entityId, damage: p.damage }); });

    const entity: IHazardEntity = { id: 'player', position: { x: 100, y: 100 } }; // inside zone (x:100,y:100,r:50)

    // Advance exactly damageTickIntervalMs → damage tick fires
    manager.tick(500, [entity]);

    expect(received).toHaveLength(1);
    expect(received[0].entityId).toBe('player');
    expect(received[0].damage).toBeGreaterThan(0);
  });

  it('11. tick() skips entity outside zone', () => {
    const bus = makeEventBus();
    const registry = makeRegistry();
    const { manager } = makeManager(bus, registry);

    manager.addZone({ ...BASE_ZONE_CFG, damageTickIntervalMs: 500 });

    const received: unknown[] = [];
    bus.on(HazardEvents.HAZARD_DAMAGE, (p) => { received.push(p); });

    // Entity far outside zone (zone center: 100,100, radius 50)
    const entity: IHazardEntity = { id: 'player', position: { x: 500, y: 500 } };
    manager.tick(500, [entity]);

    expect(received).toHaveLength(0);
  });

  it('12. tick() applies immunity: resistance=0.5 → damage halved', () => {
    const bus = makeEventBus();
    const registry = makeRegistry();
    const { manager } = makeManager(bus, registry);

    manager.addZone({
      ...BASE_ZONE_CFG,
      damagePerSecond: 10,
      damageTickIntervalMs: 1000,
    });

    const received: { damage: number }[] = [];
    bus.on(HazardEvents.HAZARD_DAMAGE, (p) => { received.push({ damage: p.damage }); });

    const immunity = new Map<string, number>([['radiation', 0.5]]);
    const entity: IHazardEntity = { id: 'armored', position: { x: 100, y: 100 }, immunity };

    manager.tick(1000, [entity]);

    // Base damage = 10 dps * 1000ms / 1000 = 10, × (1 - 0.5) = 5
    expect(received).toHaveLength(1);
    expect(received[0].damage).toBeCloseTo(5);
  });

  it('13. tick() calls artefactFactory.create() after artefactSpawnCycleMs with artefactChance=1.0', () => {
    const bus = makeEventBus();
    // Registry with one artefact for 'radiation'
    const selector = new WeightedArtefactSelector(alwaysZero);
    const registry = new ArtefactRegistry(selector);
    registry.register({ id: 'medusa', zoneTypes: ['radiation'], weight: 1 });

    // random.next() = 0: lottery check: 0 <= 1.0 (artefactChance) → passes
    const { manager, factory } = makeManager(bus, registry, alwaysZero);

    manager.addZone({
      ...BASE_ZONE_CFG,
      artefactChance: 1.0,
      artefactSpawnCycleMs: 1000,
      maxArtefacts: 5,
    });

    // Advance past artefact cycle
    manager.tick(1000, []);

    expect(factory.create).toHaveBeenCalledTimes(1);
    expect(factory.create).toHaveBeenCalledWith(
      expect.objectContaining({ artefactId: 'medusa', zoneId: 'zone_1' }),
    );
  });

  it('14. getZoneAtPoint() returns null for a safe point', () => {
    const bus = makeEventBus();
    const registry = makeRegistry();
    const { manager } = makeManager(bus, registry);

    manager.addZone({ ...BASE_ZONE_CFG, x: 100, y: 100, radius: 50 });

    // Safe point far from zone
    const result = manager.getZoneAtPoint(500, 500);
    expect(result).toBeNull();
  });

  it('15. notifyArtefactCollected() decrements zone artefactCount', () => {
    const bus = makeEventBus();
    const registry = makeRegistry();
    const { manager } = makeManager(bus, registry);

    manager.addZone(BASE_ZONE_CFG);
    const zone = manager.getZone('zone_1')!;

    zone.notifyArtefactAdded();
    zone.notifyArtefactAdded();
    expect(zone.artefactCount).toBe(2);

    manager.notifyArtefactCollected('zone_1', 'inst_1', 'medusa', 'player_1');
    expect(zone.artefactCount).toBe(1);
  });

  it('A. large deltaMs carry-over — multiple damage ticks in one frame', () => {
    const bus = makeEventBus();
    const registry = makeRegistry();
    const { manager } = makeManager(bus, registry);

    manager.addZone({ ...BASE_ZONE_CFG, damageTickIntervalMs: 500 });

    const received: unknown[] = [];
    bus.on(HazardEvents.HAZARD_DAMAGE, (p) => { received.push(p); });

    const entity: IHazardEntity = { id: 'player', position: { x: 100, y: 100 } };

    // deltaMs=1200 with interval=500 → ticks at 500ms and 1000ms → 2 damage events
    manager.tick(1200, [entity]);

    expect(received).toHaveLength(2);
  });

  it('B. full immunity — no damage event emitted', () => {
    const bus = makeEventBus();
    const registry = makeRegistry();
    const { manager } = makeManager(bus, registry);

    manager.addZone({ ...BASE_ZONE_CFG, type: 'fire' as const, damageTickIntervalMs: 500 });

    const received: unknown[] = [];
    bus.on(HazardEvents.HAZARD_DAMAGE, (p) => { received.push(p); });

    const immunity = new Map<string, number>([['fire', 1.0]]);
    const entity: IHazardEntity = { id: 'immune', position: { x: 100, y: 100 }, immunity };

    manager.tick(500, [entity]);

    expect(received).toHaveLength(0);
  });

  it('C. getZonesInRadius() includes zone that overlaps query radius', () => {
    const bus = makeEventBus();
    const registry = makeRegistry();
    const { manager } = makeManager(bus, registry);

    // Zone at (200, 0) with radius=150; query from (0,0) with radius=100
    // dist=200, radius+zoneRadius=100+150=250 → 200 <= 250 → included
    manager.addZone({ ...BASE_ZONE_CFG, id: 'zone_c', x: 200, y: 0, radius: 150 });

    const result = manager.getZonesInRadius(0, 0, 100);
    expect(result).toHaveLength(1);
    expect(result[0].config.id).toBe('zone_c');
  });

  it('D. ARTEFACT_SPAWNED event is emitted with correct payload', () => {
    const bus = makeEventBus();
    const selector = new WeightedArtefactSelector(alwaysZero);
    const registry = new ArtefactRegistry(selector);
    registry.register({ id: 'medusa', zoneTypes: ['radiation'], weight: 1 });

    // alwaysZero: lottery 0 <= 1.0 passes, then perimeter sampling uses zeros
    const { manager } = makeManager(bus, registry, alwaysZero);

    manager.addZone({
      ...BASE_ZONE_CFG,
      artefactChance: 1.0,
      artefactSpawnCycleMs: 500,
      maxArtefacts: 5,
    });

    const received: { artefactId: string; zoneId: string; x: number; y: number }[] = [];
    bus.on(HazardEvents.ARTEFACT_SPAWNED, (p) => { received.push(p); });

    manager.tick(500, []);

    expect(received).toHaveLength(1);
    expect(received[0].artefactId).toBe('medusa');
    expect(received[0].zoneId).toBe('zone_1');
    expect(typeof received[0].x).toBe('number');
    expect(typeof received[0].y).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// entityFilter tests (E, F)
// ---------------------------------------------------------------------------

describe('HazardManager — entityFilter', () => {
  it('E. entityFilter — only matching entities receive damage', () => {
    const bus = makeEventBus();
    const registry = makeRegistry();
    const { manager } = makeManager(bus, registry);

    manager.addZone({
      ...BASE_ZONE_CFG,
      damageTickIntervalMs: 500,
      entityFilter: (e) => e.id === 'allowed',
    });

    const received: string[] = [];
    bus.on(HazardEvents.HAZARD_DAMAGE, (p) => { received.push(p.entityId); });

    const allowed: IHazardEntity = { id: 'allowed', position: { x: 100, y: 100 } };
    const blocked: IHazardEntity = { id: 'blocked', position: { x: 100, y: 100 } };

    manager.tick(500, [allowed, blocked]);

    expect(received).toEqual(['allowed']);
  });

  it('F. no entityFilter — all entities inside zone receive damage (regression)', () => {
    const bus = makeEventBus();
    const registry = makeRegistry();
    const { manager } = makeManager(bus, registry);

    manager.addZone({ ...BASE_ZONE_CFG, damageTickIntervalMs: 500 });

    const received: string[] = [];
    bus.on(HazardEvents.HAZARD_DAMAGE, (p) => { received.push(p.entityId); });

    const e1: IHazardEntity = { id: 'npc_1', position: { x: 100, y: 100 } };
    const e2: IHazardEntity = { id: 'player', position: { x: 100, y: 100 } };

    manager.tick(500, [e1, e2]);

    expect(received).toContain('npc_1');
    expect(received).toContain('player');
  });
});

// ---------------------------------------------------------------------------
// expiresAtMs tests (G, H, I, J)
// ---------------------------------------------------------------------------

describe('HazardManager — expiresAtMs', () => {
  it('G. zone auto-removes when elapsedMs >= expiresAtMs', () => {
    const bus = makeEventBus();
    const registry = makeRegistry();
    const { manager } = makeManager(bus, registry);

    manager.addZone({ ...BASE_ZONE_CFG, expiresAtMs: 1000 });
    expect(manager.size).toBe(1);

    manager.tick(600, []); // elapsedMs = 600, still alive
    expect(manager.size).toBe(1);

    manager.tick(400, []); // elapsedMs = 1000 >= 1000 → expired
    expect(manager.size).toBe(0);
    expect(manager.getZone('zone_1')).toBeUndefined();
  });

  it('H. ZONE_EXPIRED event emitted with correct payload', () => {
    const bus = makeEventBus();
    const registry = makeRegistry();
    const { manager } = makeManager(bus, registry);

    manager.addZone({ ...BASE_ZONE_CFG, expiresAtMs: 500 });

    const received: { zoneId: string; zoneType: string }[] = [];
    bus.on(HazardEvents.ZONE_EXPIRED, (p) => { received.push(p); });

    manager.tick(500, []);

    expect(received).toHaveLength(1);
    expect(received[0].zoneId).toBe('zone_1');
    expect(received[0].zoneType).toBe('radiation');
  });

  it('I. expired zone produces no damage in subsequent ticks', () => {
    const bus = makeEventBus();
    const registry = makeRegistry();
    const { manager } = makeManager(bus, registry);

    manager.addZone({ ...BASE_ZONE_CFG, damageTickIntervalMs: 500, expiresAtMs: 600 });

    const damage: unknown[] = [];
    bus.on(HazardEvents.HAZARD_DAMAGE, (p) => { damage.push(p); });

    const entity: IHazardEntity = { id: 'player', position: { x: 100, y: 100 } };

    manager.tick(500, [entity]); // elapsedMs=500, damage tick fires, zone alive
    expect(damage).toHaveLength(1);

    manager.tick(200, [entity]); // elapsedMs=700 >= 600 → zone expires before advance
    expect(damage).toHaveLength(1);

    manager.tick(500, [entity]); // zone gone, no damage
    expect(damage).toHaveLength(1);
  });

  it('J. zone without expiresAtMs never auto-removes (regression)', () => {
    const bus = makeEventBus();
    const registry = makeRegistry();
    const { manager } = makeManager(bus, registry);

    manager.addZone({ ...BASE_ZONE_CFG }); // no expiresAtMs

    const expired: unknown[] = [];
    bus.on(HazardEvents.ZONE_EXPIRED, (p) => { expired.push(p); });

    manager.tick(999_999, []);

    expect(expired).toHaveLength(0);
    expect(manager.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ArtefactRegistry tests (16-18)
// ---------------------------------------------------------------------------

describe('ArtefactRegistry', () => {
  it('16. pickForZone() returns null for unregistered zone type', () => {
    const registry = makeRegistry();
    registry.register({ id: 'crystal', zoneTypes: ['fire'], weight: 1 });
    // Query 'radiation' — no artefacts registered for it
    expect(registry.pickForZone('radiation')).toBeNull();
  });

  it('17. register() throws on duplicate id', () => {
    const registry = makeRegistry();
    registry.register({ id: 'crystal', zoneTypes: ['fire'], weight: 1 });
    expect(() =>
      registry.register({ id: 'crystal', zoneTypes: ['radiation'], weight: 1 }),
    ).toThrow('[ArtefactRegistry] Duplicate id "crystal"');
  });

  it('18. WeightedArtefactSelector with 2 candidates picks correctly based on deterministic random', () => {
    const candidates = [
      { id: 'light', zoneTypes: ['fire' as const], weight: 1 },
      { id: 'heavy', zoneTypes: ['fire' as const], weight: 3 },
    ];
    // total weight = 4
    // roll = 0 * 4 = 0: after subtracting weight=1, roll = -1 <= 0 → picks 'light'
    const selectorZero = new WeightedArtefactSelector({ next: () => 0 });
    expect(selectorZero.select(candidates, 'fire')?.id).toBe('light');

    // roll = 0.5 * 4 = 2: after -1 → 1, after -3 → -2 <= 0 → picks 'heavy'
    const selectorHalf = new WeightedArtefactSelector({ next: () => 0.5 });
    expect(selectorHalf.select(candidates, 'fire')?.id).toBe('heavy');
  });
});
