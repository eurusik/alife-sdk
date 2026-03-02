/**
 * Integration tests: full artefact lifecycle via HazardsPlugin.
 *
 * Covers: register definitions → zone advances to spawn cycle → lottery →
 * WeightedArtefactSelector → IArtefactFactory.create() called →
 * notifyArtefactCollected → zone capacity decrements.
 *
 * No vi.fn() — factory tracked via plain array.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { ALifeKernel } from '@alife-sdk/core';
import { HazardsPlugin } from '../plugin/HazardsPlugin';
import { WeightedArtefactSelector } from '../artefact/ArtefactRegistry';
import type { IArtefactFactory, IArtefactSpawnEvent } from '../ports/IArtefactFactory';
import { HazardEvents } from '../events/HazardEvents';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic random that always returns 0:
 * - lottery: 0 <= artefactChance → passes if artefactChance > 0
 * - WeightedArtefactSelector: roll = 0 * total = 0; first candidate subtracts weight → roll ≤ 0 → picks first
 * - _samplePerimeterPoint: angle = 0, dist = radius * 0.6
 */
const alwaysZero = { next: () => 0 };

/** Always returns 0.9999 — lottery fails if artefactChance < 1.0. */
const alwaysHigh = { next: () => 0.9999 };

function makeKernel(): ALifeKernel {
  return {} as unknown as ALifeKernel;
}

function makeTrackedFactory(): { factory: IArtefactFactory; spawned: IArtefactSpawnEvent[] } {
  const spawned: IArtefactSpawnEvent[] = [];
  const factory: IArtefactFactory = { create: (ev) => { spawned.push(ev); } };
  return { factory, spawned };
}

const BASE_ZONE = {
  id: 'rad_zone',
  type: 'radiation' as const,
  x: 100,
  y: 100,
  radius: 60,
  damagePerSecond: 5,
  damageTickIntervalMs: 500,
  artefactChance: 1.0,
  artefactSpawnCycleMs: 1000,
  maxArtefacts: 3,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Artefact Spawn Lifecycle (integration)', () => {
  it('1. artefactChance:1.0 → after artefactSpawnCycleMs, factory.create() called with correct payload', () => {
    const { factory, spawned } = makeTrackedFactory();
    const plugin = new HazardsPlugin(alwaysZero, { artefactFactory: factory });
    plugin.install(makeKernel());
    plugin.artefacts.register({ id: 'medusa', zoneTypes: ['radiation'], weight: 1 });
    plugin.init();

    plugin.manager.addZone({ ...BASE_ZONE });

    // Advance exactly one spawn cycle
    plugin.manager.tick(1000, []);

    expect(spawned).toHaveLength(1);
    expect(spawned[0].artefactId).toBe('medusa');
    expect(spawned[0].zoneId).toBe('rad_zone');
    expect(typeof spawned[0].x).toBe('number');
    expect(typeof spawned[0].y).toBe('number');
  });

  it('2. zone at capacity (maxArtefacts:2, 2 already added) → factory.create() NOT called', () => {
    const { factory, spawned } = makeTrackedFactory();
    const plugin = new HazardsPlugin(alwaysZero, { artefactFactory: factory });
    plugin.install(makeKernel());
    plugin.artefacts.register({ id: 'medusa', zoneTypes: ['radiation'], weight: 1 });
    plugin.init();

    plugin.manager.addZone({ ...BASE_ZONE, maxArtefacts: 2 });
    const zone = plugin.manager.getZone('rad_zone')!;

    // Fill to capacity
    zone.notifyArtefactAdded();
    zone.notifyArtefactAdded();
    expect(zone.isAtCapacity).toBe(true);

    plugin.manager.tick(1000, []);

    expect(spawned).toHaveLength(0);
  });

  it('3. artefactChance:0.0 → lottery always fails → no spawn', () => {
    const { factory, spawned } = makeTrackedFactory();
    const plugin = new HazardsPlugin(alwaysZero, { artefactFactory: factory });
    plugin.install(makeKernel());
    plugin.artefacts.register({ id: 'medusa', zoneTypes: ['radiation'], weight: 1 });
    plugin.init();

    plugin.manager.addZone({ ...BASE_ZONE, artefactChance: 0.0 });

    // With alwaysZero: lottery check is 0 > 0.0 → false means lottery passes.
    // Wait: trySpawn: "if (random.next() > zone.config.artefactChance) return null"
    // 0 > 0.0 is false → lottery passes! So use alwaysHigh instead.
    // Actually for chance=0.0, need random > 0.0 to be true. alwaysHigh returns 0.9999 > 0.0 → returns null.
    // So we need to use a plugin with alwaysHigh for this test.
    // Re-reading: we already constructed with alwaysZero. Let me use a separate plugin.
    const { factory: f2, spawned: sp2 } = makeTrackedFactory();
    const plugin2 = new HazardsPlugin(alwaysHigh, { artefactFactory: f2 });
    plugin2.install(makeKernel());
    plugin2.artefacts.register({ id: 'medusa', zoneTypes: ['radiation'], weight: 1 });
    plugin2.init();
    plugin2.manager.addZone({ ...BASE_ZONE, artefactChance: 0.0 });

    plugin2.manager.tick(1000, []);

    expect(sp2).toHaveLength(0);
  });

  it('4. notifyArtefactCollected() → zone.artefactCount decrements → slot opens → next cycle spawns', () => {
    const { factory, spawned } = makeTrackedFactory();
    const plugin = new HazardsPlugin(alwaysZero, { artefactFactory: factory });
    plugin.install(makeKernel());
    plugin.artefacts.register({ id: 'medusa', zoneTypes: ['radiation'], weight: 1 });
    plugin.init();

    plugin.manager.addZone({ ...BASE_ZONE, maxArtefacts: 1, artefactSpawnCycleMs: 1000 });
    const zone = plugin.manager.getZone('rad_zone')!;

    // Fill zone to capacity manually
    zone.notifyArtefactAdded();
    expect(zone.isAtCapacity).toBe(true);

    // Tick — spawn cycle fires but zone is at capacity → no spawn
    plugin.manager.tick(1000, []);
    expect(spawned).toHaveLength(0);

    // Collect the artefact → frees a slot
    plugin.manager.notifyArtefactCollected('rad_zone', 'inst_1', 'medusa', 'player_1');
    expect(zone.artefactCount).toBe(0);
    expect(zone.isAtCapacity).toBe(false);

    // Next cycle → slot available → spawn
    plugin.manager.tick(1000, []);
    expect(spawned).toHaveLength(1);
    expect(spawned[0].artefactId).toBe('medusa');
  });

  it('5. two zone types → artefact registered for one type only → only matching zone spawns', () => {
    const { factory, spawned } = makeTrackedFactory();
    const plugin = new HazardsPlugin(alwaysZero, { artefactFactory: factory });
    plugin.install(makeKernel());
    // Only registered for 'radiation', not 'fire'
    plugin.artefacts.register({ id: 'medusa', zoneTypes: ['radiation'], weight: 1 });
    plugin.init();

    plugin.manager.addZone({ ...BASE_ZONE, id: 'rad_zone', type: 'radiation', artefactChance: 1.0, artefactSpawnCycleMs: 1000 });
    plugin.manager.addZone({
      id: 'fire_zone',
      type: 'fire',
      x: 400,
      y: 400,
      radius: 60,
      damagePerSecond: 8,
      damageTickIntervalMs: 500,
      artefactChance: 1.0,
      artefactSpawnCycleMs: 1000,
      maxArtefacts: 3,
    });

    plugin.manager.tick(1000, []);

    // Only the radiation zone spawned an artefact
    expect(spawned).toHaveLength(1);
    expect(spawned[0].zoneId).toBe('rad_zone');
    expect(spawned[0].artefactId).toBe('medusa');
  });

  it('6. WeightedArtefactSelector: two candidates weights 1 and 3 → seeded random picks correctly', () => {
    // weight=1, weight=3 → total=4
    // random=0: roll = 0*4 = 0; after subtract weight=1 → roll=-1 ≤ 0 → picks first ('light')
    const selectorZero = new WeightedArtefactSelector({ next: () => 0 });
    const candidates = [
      { id: 'light', zoneTypes: ['radiation' as const], weight: 1 },
      { id: 'heavy', zoneTypes: ['radiation' as const], weight: 3 },
    ];
    expect(selectorZero.select(candidates, 'radiation')?.id).toBe('light');

    // random=0.5: roll = 0.5*4 = 2; after subtract 1 → 1 > 0; after subtract 3 → -2 ≤ 0 → picks 'heavy'
    const selectorHalf = new WeightedArtefactSelector({ next: () => 0.5 });
    expect(selectorHalf.select(candidates, 'radiation')?.id).toBe('heavy');

    // Verify via full plugin: two artefacts registered, random=0 → always picks 'light'
    const { factory, spawned } = makeTrackedFactory();
    const plugin = new HazardsPlugin({ next: () => 0 }, { artefactFactory: factory });
    plugin.install(makeKernel());
    plugin.artefacts.register({ id: 'light', zoneTypes: ['radiation'], weight: 1 });
    plugin.artefacts.register({ id: 'heavy', zoneTypes: ['radiation'], weight: 3 });
    plugin.init();
    plugin.manager.addZone({ ...BASE_ZONE, artefactSpawnCycleMs: 1000 });
    plugin.manager.tick(1000, []);

    expect(spawned).toHaveLength(1);
    expect(spawned[0].artefactId).toBe('light');
  });

  it('7. ARTEFACT_SPAWNED event payload matches factory.create() call', () => {
    const { factory, spawned } = makeTrackedFactory();
    const plugin = new HazardsPlugin(alwaysZero, { artefactFactory: factory });
    plugin.install(makeKernel());
    plugin.artefacts.register({ id: 'medusa', zoneTypes: ['radiation'], weight: 1 });
    plugin.init();

    const zoneEvents: { artefactId: string; zoneId: string; x: number; y: number }[] = [];
    plugin.events.on(HazardEvents.ARTEFACT_SPAWNED, (p) => { zoneEvents.push(p); });

    plugin.manager.addZone({ ...BASE_ZONE, artefactSpawnCycleMs: 1000 });
    plugin.manager.tick(1000, []);

    expect(spawned).toHaveLength(1);
    expect(zoneEvents).toHaveLength(1);

    // Event payload matches factory call
    expect(zoneEvents[0].artefactId).toBe(spawned[0].artefactId);
    expect(zoneEvents[0].zoneId).toBe(spawned[0].zoneId);
    expect(zoneEvents[0].x).toBe(spawned[0].x);
    expect(zoneEvents[0].y).toBe(spawned[0].y);
  });

  it('8. spawn position is within zone radius (60-95% of radius from center)', () => {
    // With alwaysZero:
    //   angle = 0 * 2π = 0
    //   dist = radius * (0.6 + 0 * 0.35) = radius * 0.6
    // So spawnX = x + cos(0) * dist = x + radius*0.6
    //    spawnY = y + sin(0) * dist = y + 0 = y
    const radius = 60;
    const cx = 100;
    const cy = 100;

    const { factory, spawned } = makeTrackedFactory();
    const plugin = new HazardsPlugin(alwaysZero, { artefactFactory: factory });
    plugin.install(makeKernel());
    plugin.artefacts.register({ id: 'medusa', zoneTypes: ['radiation'], weight: 1 });
    plugin.init();

    plugin.manager.addZone({ ...BASE_ZONE, x: cx, y: cy, radius, artefactSpawnCycleMs: 1000 });
    plugin.manager.tick(1000, []);

    expect(spawned).toHaveLength(1);
    const dx = spawned[0].x - cx;
    const dy = spawned[0].y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);

    const minDist = radius * 0.6;
    const maxDist = radius * 0.95;
    expect(dist).toBeGreaterThanOrEqual(minDist - 0.001);
    expect(dist).toBeLessThanOrEqual(maxDist + 0.001);
  });
});
