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
// Integration: HazardZone damage pipeline (1-8)
// ---------------------------------------------------------------------------

describe('HazardZone damage pipeline', () => {
  it('1. entity inside zone gets HAZARD_DAMAGE after damageTickIntervalMs elapsed', () => {
    const plugin = makePlugin();
    plugin.manager.addZone({
      id: 'rad_1',
      type: 'radiation',
      x: 100,
      y: 100,
      radius: 50,
      damagePerSecond: 10,
      damageTickIntervalMs: 500,
      artefactChance: 0,
      maxArtefacts: 0,
    });

    const received: DamagePayload[] = [];
    plugin.events.on(HazardEvents.HAZARD_DAMAGE, (p) => { received.push(p); });

    const entity: IHazardEntity = { id: 'stalker_1', position: { x: 100, y: 100 } };
    plugin.manager.tick(500, [entity]);

    expect(received).toHaveLength(1);
    expect(received[0].entityId).toBe('stalker_1');
    expect(received[0].zoneId).toBe('rad_1');
    expect(received[0].damageTypeId).toBe('radiation');
    expect(received[0].damage).toBeGreaterThan(0);
  });

  it('2. entity outside zone receives no damage event', () => {
    const plugin = makePlugin();
    plugin.manager.addZone({
      id: 'rad_2',
      type: 'radiation',
      x: 100,
      y: 100,
      radius: 50,
      damagePerSecond: 10,
      damageTickIntervalMs: 500,
      artefactChance: 0,
      maxArtefacts: 0,
    });

    const received: DamagePayload[] = [];
    plugin.events.on(HazardEvents.HAZARD_DAMAGE, (p) => { received.push(p); });

    // Entity far outside zone (zone center: 100,100 radius: 50)
    const entity: IHazardEntity = { id: 'safe_npc', position: { x: 500, y: 500 } };
    plugin.manager.tick(500, [entity]);

    expect(received).toHaveLength(0);
  });

  it('3. entity with partial immunity (0.5 resistance) gets halved damage', () => {
    const plugin = makePlugin();
    plugin.manager.addZone({
      id: 'rad_3',
      type: 'radiation',
      x: 100,
      y: 100,
      radius: 50,
      damagePerSecond: 10,
      damageTickIntervalMs: 1000,
      artefactChance: 0,
      maxArtefacts: 0,
    });

    const received: DamagePayload[] = [];
    plugin.events.on(HazardEvents.HAZARD_DAMAGE, (p) => { received.push(p); });

    const immunity = new Map<string, number>([['radiation', 0.5]]);
    const entity: IHazardEntity = { id: 'armored_stalker', position: { x: 100, y: 100 }, immunity };

    plugin.manager.tick(1000, [entity]);

    // Base: 10 dps × 1000ms / 1000 = 10, × (1 - 0.5) = 5
    expect(received).toHaveLength(1);
    expect(received[0].damage).toBeCloseTo(5);
  });

  it('4. entity with full immunity (1.0 resistance) gets zero damage — no event emitted', () => {
    const plugin = makePlugin();
    plugin.manager.addZone({
      id: 'fire_4',
      type: 'fire',
      x: 100,
      y: 100,
      radius: 50,
      damagePerSecond: 20,
      damageTickIntervalMs: 500,
      artefactChance: 0,
      maxArtefacts: 0,
    });

    const received: DamagePayload[] = [];
    plugin.events.on(HazardEvents.HAZARD_DAMAGE, (p) => { received.push(p); });

    const immunity = new Map<string, number>([['fire', 1.0]]);
    const entity: IHazardEntity = { id: 'fire_immune', position: { x: 100, y: 100 }, immunity };

    plugin.manager.tick(500, [entity]);

    expect(received).toHaveLength(0);
  });

  it('5. large deltaMs (1200ms, interval 500ms) → 2 damage ticks in one tick() call', () => {
    const plugin = makePlugin();
    plugin.manager.addZone({
      id: 'rad_5',
      type: 'radiation',
      x: 0,
      y: 0,
      radius: 100,
      damagePerSecond: 10,
      damageTickIntervalMs: 500,
      artefactChance: 0,
      maxArtefacts: 0,
    });

    const received: DamagePayload[] = [];
    plugin.events.on(HazardEvents.HAZARD_DAMAGE, (p) => { received.push(p); });

    const entity: IHazardEntity = { id: 'entity_5', position: { x: 0, y: 0 } };

    // 1200ms with 500ms interval → ticks at 500ms and 1000ms → 2 events
    plugin.manager.tick(1200, [entity]);

    expect(received).toHaveLength(2);
    expect(received[0].entityId).toBe('entity_5');
    expect(received[1].entityId).toBe('entity_5');
  });

  it('6. multiple entities inside zone simultaneously → one event per entity per tick', () => {
    const plugin = makePlugin();
    plugin.manager.addZone({
      id: 'rad_6',
      type: 'radiation',
      x: 200,
      y: 200,
      radius: 100,
      damagePerSecond: 10,
      damageTickIntervalMs: 500,
      artefactChance: 0,
      maxArtefacts: 0,
    });

    const received: DamagePayload[] = [];
    plugin.events.on(HazardEvents.HAZARD_DAMAGE, (p) => { received.push(p); });

    const entities: IHazardEntity[] = [
      { id: 'entity_a', position: { x: 200, y: 200 } },
      { id: 'entity_b', position: { x: 210, y: 200 } },
      { id: 'entity_c', position: { x: 200, y: 210 } },
    ];

    plugin.manager.tick(500, entities);

    expect(received).toHaveLength(3);
    const ids = received.map((e) => e.entityId);
    expect(ids).toContain('entity_a');
    expect(ids).toContain('entity_b');
    expect(ids).toContain('entity_c');
  });

  it('7. entity at zone boundary (exactly radius distance) is included', () => {
    const plugin = makePlugin();
    plugin.manager.addZone({
      id: 'rad_7',
      type: 'radiation',
      x: 0,
      y: 0,
      radius: 50,
      damagePerSecond: 10,
      damageTickIntervalMs: 500,
      artefactChance: 0,
      maxArtefacts: 0,
    });

    const received: DamagePayload[] = [];
    plugin.events.on(HazardEvents.HAZARD_DAMAGE, (p) => { received.push(p); });

    // Exactly at radius: distance = 50, radius = 50 → containsPoint uses <=
    const entity: IHazardEntity = { id: 'boundary_entity', position: { x: 50, y: 0 } };
    plugin.manager.tick(500, [entity]);

    expect(received).toHaveLength(1);
    expect(received[0].entityId).toBe('boundary_entity');
  });

  it('8. removeZone() → entity no longer takes damage', () => {
    const plugin = makePlugin();
    plugin.manager.addZone({
      id: 'rad_8',
      type: 'radiation',
      x: 0,
      y: 0,
      radius: 50,
      damagePerSecond: 10,
      damageTickIntervalMs: 500,
      artefactChance: 0,
      maxArtefacts: 0,
    });

    const received: DamagePayload[] = [];
    plugin.events.on(HazardEvents.HAZARD_DAMAGE, (p) => { received.push(p); });

    const entity: IHazardEntity = { id: 'entity_8', position: { x: 0, y: 0 } };

    // First tick: zone is present → damage expected
    plugin.manager.tick(500, [entity]);
    expect(received).toHaveLength(1);

    // Remove the zone
    plugin.manager.removeZone('rad_8');

    // Second tick: zone removed → no new events
    plugin.manager.tick(500, [entity]);
    expect(received).toHaveLength(1); // still only 1 from before
  });
});
