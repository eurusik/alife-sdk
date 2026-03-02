/**
 * Integration test: HumanBrain equipment-based terrain selection.
 *
 * Verifies that weapon type, aggressiveness, and cautiousness traits
 * bias terrain scoring through the full NPCBrain -> TerrainSelector ->
 * JobSlotSystem -> MovementSimulator -> EventBus pipeline -- zero mocks.
 */

import { SmartTerrain, Clock, EventBus } from '@alife-sdk/core';
import type { ALifeEventPayloads, ISmartTerrainConfig } from '@alife-sdk/core';
import { HumanBrain, createDefaultHumanBrainConfig } from '../brain/HumanBrain';
import type { IEquipmentPreference } from '../brain/HumanBrain';
import { NPCBrain } from '../brain/NPCBrain';
import { MovementSimulator } from '../movement/MovementSimulator';
import { createBrainConfig, createSelectorConfig, createJobConfig, createTerrain } from './helpers';

// ---------------------------------------------------------------------------
// Local factories
// ---------------------------------------------------------------------------

/** Scoring config that zeroes out shelter bonus and jitter to isolate equipment effects. */
const NEUTRAL_SCORING: ISmartTerrainConfig['scoring'] = {
  shelterBonus: 0,
  scoringJitter: 0,
};

function createHumanBrain(opts: {
  npcId: string;
  factionId?: string;
  equipment?: Partial<IEquipmentPreference>;
  position?: { x: number; y: number };
  clock: Clock;
  events: EventBus<ALifeEventPayloads>;
  movement: MovementSimulator;
}): HumanBrain {
  const equipment: IEquipmentPreference = {
    preferredWeaponType: opts.equipment?.preferredWeaponType ?? 'rifle',
    preferredArmor: opts.equipment?.preferredArmor ?? 'medium',
    aggressiveness: opts.equipment?.aggressiveness ?? 0.5,
    cautiousness: opts.equipment?.cautiousness ?? 0.5,
    ...opts.equipment,
  };

  const brain = new HumanBrain({
    npcId: opts.npcId,
    factionId: opts.factionId ?? 'stalkers',
    config: createBrainConfig({ reEvaluateIntervalMs: 0 }),
    selectorConfig: createSelectorConfig(),
    jobConfig: createJobConfig(),
    deps: { clock: opts.clock, events: opts.events },
    humanConfig: createDefaultHumanBrainConfig(),
    equipment,
  });
  brain.setMovementDispatcher(opts.movement);
  brain.setLastPosition(opts.position ?? { x: 0, y: 0 });
  brain.setRank(3);
  return brain;
}

/** Shared infrastructure: clock + events + movement. */
function createInfra() {
  const clock = new Clock({ startHour: 12, timeFactor: 1 });
  const events = new EventBus<ALifeEventPayloads>();
  const movement = new MovementSimulator(events);
  return { clock, events, movement };
}

/** Advance one full tick: clock -> movement -> brain -> flush. */
function tick(
  infra: ReturnType<typeof createInfra>,
  brain: NPCBrain,
  terrains: readonly SmartTerrain[],
  deltaMs = 0,
): void {
  infra.clock.update(deltaMs);
  infra.movement.update(deltaMs);
  brain.update(deltaMs, terrains);
  infra.events.flush();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HumanBrain equipment-based terrain selection', () => {
  it('sniper selects guard-tagged terrain over patrol-tagged terrain', () => {
    const infra = createInfra();

    const guardTerrain = createTerrain({
      id: 'guard_tower',
      name: 'Вежа',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      capacity: 5,
      tags: ['guard'],
      scoring: NEUTRAL_SCORING,
      jobs: [{ type: 'guard', slots: 3, position: { x: 50, y: 50 } }],
    });
    const patrolTerrain = createTerrain({
      id: 'patrol_route',
      name: 'Патруль',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      capacity: 5,
      tags: ['patrol'],
      scoring: NEUTRAL_SCORING,
      jobs: [{ type: 'patrol', slots: 3, position: { x: 50, y: 50 } }],
    });

    const sniper = createHumanBrain({
      npcId: 'sniper_01',
      equipment: { preferredWeaponType: 'sniper' },
      position: { x: 50, y: 50 },
      ...infra,
    });

    tick(infra, sniper, [guardTerrain, patrolTerrain]);

    expect(sniper.currentTerrainId).toBe('guard_tower');
  });

  it('aggressive NPC selects patrol-tagged terrain over guard-tagged terrain', () => {
    const infra = createInfra();

    const guardTerrain = createTerrain({
      id: 'guard_post',
      name: 'Вежа',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      capacity: 5,
      tags: ['guard'],
      scoring: NEUTRAL_SCORING,
      jobs: [{ type: 'guard', slots: 3, position: { x: 50, y: 50 } }],
    });
    const patrolTerrain = createTerrain({
      id: 'patrol_zone',
      name: 'Патруль',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      capacity: 5,
      tags: ['patrol'],
      scoring: NEUTRAL_SCORING,
      jobs: [{ type: 'patrol', slots: 3, position: { x: 50, y: 50 } }],
    });

    const aggressive = createHumanBrain({
      npcId: 'rambo_01',
      equipment: { aggressiveness: 0.9 },
      position: { x: 50, y: 50 },
      ...infra,
    });

    tick(infra, aggressive, [guardTerrain, patrolTerrain]);

    expect(aggressive.currentTerrainId).toBe('patrol_zone');
  });

  it('cautious NPC selects camp-tagged terrain over patrol-tagged terrain', () => {
    const infra = createInfra();

    const campTerrain = createTerrain({
      id: 'camp_site',
      name: 'Табір',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      capacity: 5,
      tags: ['camp'],
      scoring: NEUTRAL_SCORING,
      jobs: [{ type: 'camp', slots: 3, position: { x: 50, y: 50 } }],
    });
    const patrolTerrain = createTerrain({
      id: 'patrol_area',
      name: 'Патруль',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      capacity: 5,
      tags: ['patrol'],
      scoring: NEUTRAL_SCORING,
      jobs: [{ type: 'patrol', slots: 3, position: { x: 50, y: 50 } }],
    });

    const cautious = createHumanBrain({
      npcId: 'careful_01',
      equipment: { cautiousness: 0.8 },
      position: { x: 50, y: 50 },
      ...infra,
    });

    tick(infra, cautious, [campTerrain, patrolTerrain]);

    expect(cautious.currentTerrainId).toBe('camp_site');
  });

  it('equipment bonus coexists with movement dispatch', () => {
    const infra = createInfra();

    const guardTerrain = createTerrain({
      id: 'distant_guard',
      name: 'Далека вежа',
      bounds: { x: 500, y: 500, width: 100, height: 100 },
      capacity: 5,
      tags: ['guard'],
      scoring: NEUTRAL_SCORING,
      jobs: [{ type: 'guard', slots: 3, position: { x: 550, y: 550 } }],
    });

    const sniper = createHumanBrain({
      npcId: 'sniper_02',
      equipment: { preferredWeaponType: 'sniper' },
      position: { x: 0, y: 0 },
      ...infra,
    });

    tick(infra, sniper, [guardTerrain]);

    expect(sniper.currentTerrainId).toBe('distant_guard');
    expect(sniper.currentTask).not.toBeNull();
    expect(infra.movement.isMoving('sniper_02')).toBe(true);
  });

  it('surge overrides equipment preference -- non-shelters filtered out', () => {
    const infra = createInfra();

    // Guard terrain is nearby but not a shelter
    const guardTerrain = createTerrain({
      id: 'open_guard',
      name: 'Відкрита вежа',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      capacity: 5,
      tags: ['guard'],
      scoring: NEUTRAL_SCORING,
      jobs: [{ type: 'guard', slots: 3, position: { x: 50, y: 50 } }],
    });
    // Shelter is far away, no guard tag
    const shelterTerrain = createTerrain({
      id: 'far_shelter',
      name: 'Далекий бункер',
      bounds: { x: 2000, y: 2000, width: 100, height: 100 },
      capacity: 10,
      isShelter: true,
      scoring: NEUTRAL_SCORING,
      jobs: [{ type: 'camp', slots: 5, position: { x: 2050, y: 2050 } }],
    });

    const sniper = createHumanBrain({
      npcId: 'sniper_03',
      equipment: { preferredWeaponType: 'sniper' },
      position: { x: 50, y: 50 },
      ...infra,
    });

    // First tick: sniper picks guard terrain (nearby, +15 bonus)
    tick(infra, sniper, [guardTerrain, shelterTerrain]);
    expect(sniper.currentTerrainId).toBe('open_guard');

    // Surge activates -- non-shelters filtered out
    sniper.setSurgeActive(true);
    tick(infra, sniper, [guardTerrain, shelterTerrain]);

    expect(sniper.currentTerrainId).toBe('far_shelter');
  });

  it('HumanBrain sniper gravitates to guard terrain while generic NPCBrain picks by fitness', () => {
    const infra = createInfra();

    const guardTerrain = createTerrain({
      id: 'watchtower',
      name: 'Спостережна вежа',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      capacity: 5,
      tags: ['guard'],
      scoring: NEUTRAL_SCORING,
      jobs: [{ type: 'guard', slots: 3, position: { x: 50, y: 50 } }],
    });
    const plainTerrain = createTerrain({
      id: 'plain_base',
      name: 'База',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      capacity: 5,
      scoring: NEUTRAL_SCORING,
      jobs: [{ type: 'camp', slots: 3, position: { x: 50, y: 50 } }],
    });

    const sniper = createHumanBrain({
      npcId: 'sniper_04',
      equipment: { preferredWeaponType: 'sniper' },
      position: { x: 50, y: 50 },
      ...infra,
    });

    const generic = new NPCBrain({
      npcId: 'generic_01',
      factionId: 'stalkers',
      config: createBrainConfig({ reEvaluateIntervalMs: 0 }),
      selectorConfig: createSelectorConfig(),
      jobConfig: createJobConfig(),
      deps: { clock: infra.clock, events: infra.events },
    });
    generic.setMovementDispatcher(infra.movement);
    generic.setLastPosition({ x: 50, y: 50 });
    generic.setRank(3);

    // Sniper updates first -- gets guard bonus +15 on watchtower
    tick(infra, sniper, [guardTerrain, plainTerrain]);
    expect(sniper.currentTerrainId).toBe('watchtower');

    // Generic NPC has no equipment bonus -- both terrains score equally,
    // so it picks the first one with highest base score.
    // With watchtower already holding 1 occupant (capacity=5, remaining=4)
    // and plain_base at full capacity (remaining=5), generic picks plain_base.
    tick(infra, generic, [guardTerrain, plainTerrain]);
    expect(generic.currentTerrainId).toBe('plain_base');
  });
});
