/**
 * Integration test: "Monster lair-centric terrain selection".
 *
 * Verifies that MonsterBrain selects terrains based on lair affinity,
 * danger preference, and surge immunity -- all using real objects,
 * zero mocks, through the full pipeline:
 *   MonsterBrain -> TerrainSelector -> JobSlotSystem -> MovementSimulator -> EventBus
 */

import { Clock, EventBus, ALifeEvents } from '@alife-sdk/core';
import type { ALifeEventPayloads } from '@alife-sdk/core';
import { MonsterBrain, createDefaultMonsterBrainConfig } from '../brain/MonsterBrain';
import { HumanBrain, createDefaultHumanBrainConfig } from '../brain/HumanBrain';
import { MovementSimulator } from '../movement/MovementSimulator';
import { createBrainConfig, createSelectorConfig, createJobConfig, createTerrain } from './helpers';

// ---------------------------------------------------------------------------
// Local factory
// ---------------------------------------------------------------------------

function createMonsterBrain(opts: {
  npcId: string;
  factionId?: string;
  lairTerrainId?: string;
  position?: { x: number; y: number };
  clock: Clock;
  events: EventBus<ALifeEventPayloads>;
  movement: MovementSimulator;
}): MonsterBrain {
  const brain = new MonsterBrain({
    npcId: opts.npcId,
    factionId: opts.factionId ?? 'monster',
    config: createBrainConfig({ reEvaluateIntervalMs: 0, dangerTolerance: 10 }),
    selectorConfig: createSelectorConfig(),
    jobConfig: createJobConfig(),
    deps: { clock: opts.clock, events: opts.events },
    monsterConfig: createDefaultMonsterBrainConfig(),
    lairTerrainId: opts.lairTerrainId,
  });
  brain.setMovementDispatcher(opts.movement);
  brain.setLastPosition(opts.position ?? { x: 0, y: 0 });
  brain.setRank(3);
  return brain;
}

// ---------------------------------------------------------------------------
// Shared infrastructure
// ---------------------------------------------------------------------------

let clock: Clock;
let events: EventBus<ALifeEventPayloads>;
let movement: MovementSimulator;

beforeEach(() => {
  clock = new Clock({ startHour: 12, timeFactor: 1 });
  events = new EventBus<ALifeEventPayloads>();
  movement = new MovementSimulator(events);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Monster lair-centric terrain selection', () => {
  it('monster selects lair terrain despite others having better base fitness', () => {
    // Lair is far away (penalty ~-50) while nearby terrain has better base score.
    // The +1000 lair bonus must overwhelm distance penalty.
    const lair = createTerrain({
      id: 'lair_cave',
      name: 'Лігво',
      bounds: { x: 5_000, y: 5_000, width: 200, height: 200 },
      capacity: 5,
      dangerLevel: 1,
      scoring: { scoringJitter: 0 },
      jobs: [{ type: 'camp', slots: 3, position: { x: 5_100, y: 5_100 } }],
    });
    const nearby = createTerrain({
      id: 'nearby_camp',
      name: 'Табір',
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      capacity: 10,
      dangerLevel: 5,
      scoring: { scoringJitter: 0 },
      jobs: [{ type: 'camp', slots: 5, position: { x: 100, y: 100 } }],
    });
    const far = createTerrain({
      id: 'far_outpost',
      name: 'Далекий пост',
      bounds: { x: 8_000, y: 8_000, width: 200, height: 200 },
      capacity: 5,
      dangerLevel: 3,
      scoring: { scoringJitter: 0 },
      jobs: [{ type: 'guard', slots: 2, position: { x: 8_100, y: 8_100 } }],
    });

    const monster = createMonsterBrain({
      npcId: 'dog_alpha',
      lairTerrainId: 'lair_cave',
      position: { x: 50, y: 50 },
      clock,
      events,
      movement,
    });

    monster.update(0, [lair, nearby, far]);
    events.flush();

    expect(monster.currentTerrainId).toBe('lair_cave');
  });

  it('monster prefers the highest-danger terrain when no lair is assigned', () => {
    // All terrains co-located so distance is equal.
    // With rank 10 all terrains pass the rankMatchBonus check, so the
    // only differentiator is dangerAffinity (2 × dangerLevel).
    const safe = createTerrain({
      id: 'safe_zone',
      name: 'Безпечна зона',
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      capacity: 5,
      dangerLevel: 0,
      scoring: { scoringJitter: 0 },
      jobs: [{ type: 'camp', slots: 3, position: { x: 100, y: 100 } }],
    });
    const moderate = createTerrain({
      id: 'moderate_zone',
      name: 'Помірна зона',
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      capacity: 5,
      dangerLevel: 3,
      scoring: { scoringJitter: 0 },
      jobs: [{ type: 'camp', slots: 3, position: { x: 100, y: 100 } }],
    });
    const dangerous = createTerrain({
      id: 'danger_zone',
      name: 'Небезпечна зона',
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      capacity: 5,
      dangerLevel: 8,
      scoring: { scoringJitter: 0 },
      jobs: [{ type: 'camp', slots: 3, position: { x: 100, y: 100 } }],
    });

    const monster = createMonsterBrain({
      npcId: 'bloodsucker_1',
      position: { x: 100, y: 100 },
      clock,
      events,
      movement,
    });
    // High rank ensures rankMatchBonus applies uniformly across all terrains.
    monster.setRank(10);

    monster.update(0, [safe, moderate, dangerous]);
    events.flush();

    expect(monster.currentTerrainId).toBe('danger_zone');
  });

  it('monster stays in non-shelter lair while surge is active in the world', () => {
    // Architectural contract: ALifeSimulator never calls setSurgeActive(true)
    // on MonsterBrain. Monsters are native to the Zone and don't shelter.
    // This test verifies that when a surge is active in the world (but NOT
    // signalled to the monster), the monster continues to prefer its lair
    // over available shelters through normal re-evaluation.
    const shelter = createTerrain({
      id: 'shelter_bunker',
      name: 'Укриття',
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      capacity: 10,
      isShelter: true,
      dangerLevel: 0,
      scoring: { scoringJitter: 0 },
      jobs: [{ type: 'camp', slots: 5, position: { x: 100, y: 100 } }],
    });
    const openField = createTerrain({
      id: 'open_field',
      name: 'Відкрите поле',
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      capacity: 5,
      isShelter: false,
      dangerLevel: 6,
      scoring: { scoringJitter: 0 },
      jobs: [{ type: 'guard', slots: 3, position: { x: 100, y: 100 } }],
    });

    const monster = createMonsterBrain({
      npcId: 'snork_1',
      lairTerrainId: 'open_field',
      position: { x: 100, y: 100 },
      clock,
      events,
      movement,
    });

    // Initial assignment -- monster picks lair (open_field) with +1000 bonus
    monster.update(0, [shelter, openField]);
    events.flush();
    expect(monster.currentTerrainId).toBe('open_field');

    // Force re-evaluation as if time passed -- monster still prefers its lair
    // surgeActive is NOT set (monster is immune by architectural contract)
    monster.forceReevaluate();
    monster.update(0, [shelter, openField]);
    events.flush();

    expect(monster.currentTerrainId).toBe('open_field');
  });

  it('monster dispatches movement to lair and NPC_MOVED emits on completion', () => {
    const lair = createTerrain({
      id: 'lair_den',
      name: 'Лігво',
      bounds: { x: 1_000, y: 1_000, width: 200, height: 200 },
      capacity: 5,
      scoring: { scoringJitter: 0 },
      jobs: [{ type: 'camp', slots: 3, position: { x: 1_100, y: 1_100 } }],
    });

    const monster = createMonsterBrain({
      npcId: 'boar_1',
      lairTerrainId: 'lair_den',
      position: { x: 0, y: 0 },
      clock,
      events,
      movement,
    });

    const movedPayloads: Array<{ npcId: string; toZone: string }> = [];
    events.on(
      ALifeEvents.NPC_MOVED,
      (p) => movedPayloads.push(p as (typeof movedPayloads)[0]),
    );

    // First tick: brain selects lair, dispatches movement
    monster.update(0, [lair]);
    events.flush();

    expect(monster.currentTerrainId).toBe('lair_den');
    expect(movement.isMoving('boar_1')).toBe(true);

    // Distance from (0,0) to lair center (1100,1100) ~= 1556px
    // At 50px/s => ~31.1s => use 32_000ms to be safe
    movement.update(32_000);
    events.flush();

    expect(movedPayloads).toHaveLength(1);
    expect(movedPayloads[0].npcId).toBe('boar_1');
    expect(movedPayloads[0].toZone).toBe('lair_den');
    expect(movement.isMoving('boar_1')).toBe(false);
  });

  it('monster stays in current terrain when no viable alternative exists', () => {
    const onlyTerrain = createTerrain({
      id: 'lonely_ruin',
      name: 'Самотня руїна',
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      capacity: 5,
      scoring: { scoringJitter: 0 },
      jobs: [{ type: 'camp', slots: 3, position: { x: 100, y: 100 } }],
    });

    const monster = createMonsterBrain({
      npcId: 'controller_1',
      position: { x: 100, y: 100 },
      clock,
      events,
      movement,
    });

    // First tick: assign to the only terrain
    monster.update(0, [onlyTerrain]);
    events.flush();
    expect(monster.currentTerrainId).toBe('lonely_ruin');

    // Force re-evaluation -- still only one terrain, monster stays put
    monster.forceReevaluate();
    monster.update(0, [onlyTerrain]);
    events.flush();

    expect(monster.currentTerrainId).toBe('lonely_ruin');
  });

  it('human flees to shelter during surge while monster stays in the open', () => {
    const shelter = createTerrain({
      id: 'shelter_vault',
      name: 'Сховище',
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      capacity: 10,
      isShelter: true,
      dangerLevel: 0,
      scoring: { scoringJitter: 0 },
      jobs: [{ type: 'camp', slots: 5, position: { x: 100, y: 100 } }],
    });
    const dangerousField = createTerrain({
      id: 'anomaly_field',
      name: 'Аномальне поле',
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      capacity: 10,
      isShelter: false,
      dangerLevel: 7,
      scoring: { scoringJitter: 0 },
      jobs: [{ type: 'guard', slots: 5, position: { x: 100, y: 100 } }],
    });

    const terrains = [shelter, dangerousField];

    // Create a human stalker
    const human = new HumanBrain({
      npcId: 'stalker_1',
      factionId: 'stalkers',
      config: createBrainConfig({ reEvaluateIntervalMs: 0 }),
      selectorConfig: createSelectorConfig(),
      jobConfig: createJobConfig(),
      deps: { clock, events },
      humanConfig: createDefaultHumanBrainConfig(),
      equipment: { preferredWeaponType: 'rifle', preferredArmor: 'medium', aggressiveness: 0.5, cautiousness: 0.5 },
    });
    human.setMovementDispatcher(movement);
    human.setLastPosition({ x: 100, y: 100 });
    human.setRank(2);

    // Create a monster
    const monster = createMonsterBrain({
      npcId: 'dog_pack_1',
      lairTerrainId: 'anomaly_field',
      position: { x: 100, y: 100 },
      clock,
      events,
      movement,
    });

    // Initial tick: both choose terrains
    human.update(0, terrains);
    monster.update(0, terrains);
    events.flush();

    // Pre-surge: human picks shelter (+50 bonus), monster picks anomaly_field (+1000 lair bonus)
    expect(human.currentTerrainId).toBe('shelter_vault');
    expect(monster.currentTerrainId).toBe('anomaly_field');

    // Surge activates: human receives the signal, monster does NOT
    // (architectural contract -- ALifeSimulator only notifies human brains)
    human.setSurgeActive(true);
    human.forceReevaluate();
    monster.forceReevaluate();

    human.update(0, terrains);
    monster.update(0, terrains);
    events.flush();

    // Human stays in shelter -- surge filters non-shelters
    expect(human.currentTerrainId).toBe('shelter_vault');
    // Monster stays in the dangerous open field -- never received surge signal
    expect(monster.currentTerrainId).toBe('anomaly_field');
  });
});
