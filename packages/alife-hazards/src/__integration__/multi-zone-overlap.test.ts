import { describe, it, expect } from 'vitest';
import type { ALifeKernel } from '@alife-sdk/core';
import { HazardsPlugin } from '../plugin/HazardsPlugin';
import { HazardEvents } from '../events/HazardEvents';
import type { HazardEventPayloads } from '../events/HazardEvents';
import type { IHazardEntity } from '../manager/HazardManager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const random = { next: () => 0 };
const stubKernel = {} as ALifeKernel;

function makePlugin(): HazardsPlugin {
  const plugin = new HazardsPlugin(random, {
    artefactFactory: { create: () => {} },
  });
  plugin.install(stubKernel);
  plugin.init();
  return plugin;
}

type DamagePayload = HazardEventPayloads['hazard:damage'];

// ---------------------------------------------------------------------------
// Integration: multi-zone overlap (1-6)
// ---------------------------------------------------------------------------

describe('Multi-zone overlap', () => {
  it('1. two zones at same center → entity at center → two HAZARD_DAMAGE events (one per zone)', () => {
    const plugin = makePlugin();

    plugin.manager.addZone({
      id: 'zone_a',
      type: 'radiation',
      x: 0,
      y: 0,
      radius: 100,
      damagePerSecond: 10,
      damageTickIntervalMs: 500,
      artefactChance: 0,
      maxArtefacts: 0,
    });
    plugin.manager.addZone({
      id: 'zone_b',
      type: 'radiation',
      x: 0,
      y: 0,
      radius: 100,
      damagePerSecond: 20,
      damageTickIntervalMs: 500,
      artefactChance: 0,
      maxArtefacts: 0,
    });

    const events: DamagePayload[] = [];
    plugin.events.on(HazardEvents.HAZARD_DAMAGE, (p) => { events.push(p); });

    const entity: IHazardEntity = { id: 'center_entity', position: { x: 0, y: 0 } };
    plugin.manager.tick(500, [entity]);

    expect(events).toHaveLength(2);
    const byZone = new Map(events.map((e) => [e.zoneId, e]));
    expect(byZone.has('zone_a')).toBe(true);
    expect(byZone.has('zone_b')).toBe(true);
  });

  it('2. two zones partially overlapping → entity in overlap region → damage from both', () => {
    const plugin = makePlugin();

    // zone_fire: center (0, 0), radius 80
    // zone_rad:  center (100, 0), radius 80
    // Overlap region: x in [20, 80] approx; entity at (50, 0) is inside both
    plugin.manager.addZone({
      id: 'zone_fire',
      type: 'fire',
      x: 0,
      y: 0,
      radius: 80,
      damagePerSecond: 10,
      damageTickIntervalMs: 500,
      artefactChance: 0,
      maxArtefacts: 0,
    });
    plugin.manager.addZone({
      id: 'zone_rad',
      type: 'radiation',
      x: 100,
      y: 0,
      radius: 80,
      damagePerSecond: 15,
      damageTickIntervalMs: 500,
      artefactChance: 0,
      maxArtefacts: 0,
    });

    const events: DamagePayload[] = [];
    plugin.events.on(HazardEvents.HAZARD_DAMAGE, (p) => { events.push(p); });

    // Entity at (50, 0): dist to (0,0)=50 <= 80 ✓, dist to (100,0)=50 <= 80 ✓
    const entity: IHazardEntity = { id: 'overlap_entity', position: { x: 50, y: 0 } };
    plugin.manager.tick(500, [entity]);

    expect(events).toHaveLength(2);
    const byZone = new Map(events.map((e) => [e.zoneId, e]));
    expect(byZone.has('zone_fire')).toBe(true);
    expect(byZone.has('zone_rad')).toBe(true);
  });

  it('3. entity outside both zones → no events', () => {
    const plugin = makePlugin();

    plugin.manager.addZone({
      id: 'zone_c1',
      type: 'fire',
      x: 0,
      y: 0,
      radius: 50,
      damagePerSecond: 10,
      damageTickIntervalMs: 500,
      artefactChance: 0,
      maxArtefacts: 0,
    });
    plugin.manager.addZone({
      id: 'zone_c2',
      type: 'radiation',
      x: 200,
      y: 0,
      radius: 50,
      damagePerSecond: 10,
      damageTickIntervalMs: 500,
      artefactChance: 0,
      maxArtefacts: 0,
    });

    const events: DamagePayload[] = [];
    plugin.events.on(HazardEvents.HAZARD_DAMAGE, (p) => { events.push(p); });

    // Entity at (500, 500) — far outside both zones
    const entity: IHazardEntity = { id: 'safe_entity', position: { x: 500, y: 500 } };
    plugin.manager.tick(500, [entity]);

    expect(events).toHaveLength(0);
  });

  it('4. entity inside only first zone, outside second → one event', () => {
    const plugin = makePlugin();

    // zone_d1: center (0, 0), radius 50
    // zone_d2: center (300, 0), radius 50
    plugin.manager.addZone({
      id: 'zone_d1',
      type: 'fire',
      x: 0,
      y: 0,
      radius: 50,
      damagePerSecond: 10,
      damageTickIntervalMs: 500,
      artefactChance: 0,
      maxArtefacts: 0,
    });
    plugin.manager.addZone({
      id: 'zone_d2',
      type: 'radiation',
      x: 300,
      y: 0,
      radius: 50,
      damagePerSecond: 10,
      damageTickIntervalMs: 500,
      artefactChance: 0,
      maxArtefacts: 0,
    });

    const events: DamagePayload[] = [];
    plugin.events.on(HazardEvents.HAZARD_DAMAGE, (p) => { events.push(p); });

    // Entity at (25, 0): inside zone_d1 (dist=25<=50), outside zone_d2 (dist=275>50)
    const entity: IHazardEntity = { id: 'partial_entity', position: { x: 25, y: 0 } };
    plugin.manager.tick(500, [entity]);

    expect(events).toHaveLength(1);
    expect(events[0].zoneId).toBe('zone_d1');
  });

  it('5. two zones of different types (fire + radiation) → entity with immunity for one type → only immune one is skipped', () => {
    const plugin = makePlugin();

    plugin.manager.addZone({
      id: 'zone_fire',
      type: 'fire',
      x: 0,
      y: 0,
      radius: 100,
      damagePerSecond: 20,
      damageTickIntervalMs: 500,
      artefactChance: 0,
      maxArtefacts: 0,
    });
    plugin.manager.addZone({
      id: 'zone_rad',
      type: 'radiation',
      x: 0,
      y: 0,
      radius: 100,
      damagePerSecond: 10,
      damageTickIntervalMs: 500,
      artefactChance: 0,
      maxArtefacts: 0,
    });

    const events: DamagePayload[] = [];
    plugin.events.on(HazardEvents.HAZARD_DAMAGE, (p) => { events.push(p); });

    // Entity is fully immune to fire but not radiation
    const immunity = new Map<string, number>([['fire', 1.0]]);
    const entity: IHazardEntity = { id: 'fire_immune_entity', position: { x: 0, y: 0 }, immunity };

    plugin.manager.tick(500, [entity]);

    // Only radiation damage should be emitted (fire is fully blocked)
    expect(events).toHaveLength(1);
    expect(events[0].zoneId).toBe('zone_rad');
    expect(events[0].damageTypeId).toBe('radiation');
    expect(events[0].damage).toBeGreaterThan(0);
  });

  it('6. total accumulated damage across two zones = sum of individual zone damages', () => {
    const plugin = makePlugin();

    // zone_f: 20 dps × 500ms / 1000 = 10 per tick
    // zone_r: 10 dps × 500ms / 1000 = 5 per tick
    // Total expected: 15
    plugin.manager.addZone({
      id: 'zone_f',
      type: 'fire',
      x: 0,
      y: 0,
      radius: 100,
      damagePerSecond: 20,
      damageTickIntervalMs: 500,
      artefactChance: 0,
      maxArtefacts: 0,
    });
    plugin.manager.addZone({
      id: 'zone_r',
      type: 'radiation',
      x: 0,
      y: 0,
      radius: 100,
      damagePerSecond: 10,
      damageTickIntervalMs: 500,
      artefactChance: 0,
      maxArtefacts: 0,
    });

    const events: DamagePayload[] = [];
    plugin.events.on(HazardEvents.HAZARD_DAMAGE, (p) => { events.push(p); });

    const entity: IHazardEntity = { id: 'math_entity', position: { x: 0, y: 0 } };
    plugin.manager.tick(500, [entity]);

    expect(events).toHaveLength(2);

    const byZone = new Map(events.map((e) => [e.zoneId, e]));
    const fireDmg = byZone.get('zone_f')!.damage;
    const radDmg  = byZone.get('zone_r')!.damage;

    // Verify individual amounts
    expect(fireDmg).toBeCloseTo(10);  // 20 * 500 / 1000
    expect(radDmg).toBeCloseTo(5);    // 10 * 500 / 1000

    // Verify the math: total = sum of parts
    const totalDamage = events.reduce((sum, e) => sum + e.damage, 0);
    expect(totalDamage).toBeCloseTo(fireDmg + radDmg);
    expect(totalDamage).toBeCloseTo(15);
  });
});
