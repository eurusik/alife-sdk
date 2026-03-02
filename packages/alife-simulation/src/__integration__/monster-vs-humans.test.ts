/**
 * Integration test: "Монстр проти сталкерів".
 *
 * Verifies combat outcome asymmetry between monsters and human NPCs:
 *   - High-rank monster kills low-rank rookie stalker
 *   - High-rank veteran stalker kills weakened monster
 *   - MonsterBrain lair affinity vs HumanBrain equipment scoring
 *   - Full narrative: monster → rookie dies → veteran kills monster
 *
 * All objects are REAL -- zero mocks, zero vi.fn().
 */

import { ALifeEvents } from '@alife-sdk/core';
import type { ALifeEventPayloads } from '@alife-sdk/core';

import { MonsterBrain, createDefaultMonsterBrainConfig } from '../brain/MonsterBrain';
import { HumanBrain, createDefaultHumanBrainConfig } from '../brain/HumanBrain';
import { OfflineCombatResolver } from '../combat/OfflineCombatResolver';
import { StoryRegistry } from '../npc/StoryRegistry';
import { NPCRelationRegistry, createDefaultRelationConfig } from '../npc/NPCRelationRegistry';
import type { INPCRecord } from '../types/INPCRecord';

import {
  createTerrain,
  createBrainConfig,
  createSelectorConfig,
  createJobConfig,
  createSharedDeps,
  createNPCRecord,
  createFaction,
  createStubBridge,
  getDefaultCombatConfig,
  assignBrainToTerrain,
  SEEDED_RANDOM,
} from './helpers';

// ---------------------------------------------------------------------------
// Local factories
// ---------------------------------------------------------------------------

function createMonsterBrain(
  opts: {
    npcId: string;
    lairTerrainId?: string;
    position?: { x: number; y: number };
  },
  deps: ReturnType<typeof createSharedDeps>,
) {
  const brain = new MonsterBrain({
    npcId: opts.npcId,
    factionId: 'monster',
    config: createBrainConfig({ reEvaluateIntervalMs: 0, dangerTolerance: 10 }),
    selectorConfig: createSelectorConfig(),
    jobConfig: createJobConfig(),
    deps: { clock: deps.clock, events: deps.events },
    monsterConfig: createDefaultMonsterBrainConfig(),
    lairTerrainId: opts.lairTerrainId,
  });
  brain.setMovementDispatcher(deps.movement);
  brain.setLastPosition(opts.position ?? { x: 100, y: 100 });
  return brain;
}

function createHumanBrain(
  opts: {
    npcId: string;
    factionId?: string;
    rank?: number;
    position?: { x: number; y: number };
  },
  deps: ReturnType<typeof createSharedDeps>,
) {
  const brain = new HumanBrain({
    npcId: opts.npcId,
    factionId: opts.factionId ?? 'stalker',
    config: createBrainConfig({ reEvaluateIntervalMs: 0 }),
    selectorConfig: createSelectorConfig(),
    jobConfig: createJobConfig(),
    deps: { clock: deps.clock, events: deps.events },
    humanConfig: createDefaultHumanBrainConfig(),
    equipment: { preferredWeaponType: 'rifle', preferredArmor: 'medium', aggressiveness: 0.5, cautiousness: 0.5 },
  });
  brain.setMovementDispatcher(deps.movement);
  brain.setLastPosition(opts.position ?? { x: 100, y: 100 });
  brain.setRank(opts.rank ?? 3);
  return brain;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Monster vs humans', () => {
  // Shared state rebuilt per test
  const monsterFaction = createFaction('monster', { stalker: -100 });
  const stalkerFaction = createFaction('stalker', { monster: -100 });
  const factions = new Map([['monster', monsterFaction], ['stalker', stalkerFaction]]);

  it('monster (rank 3, power 80) kills rookie stalker (rank 1, power 30)', () => {
    const deps = createSharedDeps();
    const lair = createTerrain({
      id: 'lair',
      capacity: 5,
      jobs: [{ type: 'guard', slots: 5, position: { x: 100, y: 100 } }],
    });

    // Monster: rank 3 (mult 1.0), power 80
    const monsterBrain = createMonsterBrain({ npcId: 'bloodsucker_1', lairTerrainId: 'lair' }, deps);
    monsterBrain.setRank(3);
    assignBrainToTerrain(monsterBrain, lair, deps.events);

    // Rookie: rank 1 (mult 0.8), power 30
    const rookieBrain = createHumanBrain({ npcId: 'rookie_1', rank: 1 }, deps);
    assignBrainToTerrain(rookieBrain, lair, deps.events);

    expect(lair.occupantCount).toBe(2);

    // With SEEDED_RANDOM (0.25), jitter = 0.5 + 0.25*(1.5-0.5) = 0.75
    // Monster attack: round(80 * 1.0 * 0.75) = 60
    // Rookie attack:  round(30 * 0.8 * 0.75) = 18
    const monsterRecord = createNPCRecord({
      entityId: 'bloodsucker_1',
      factionId: 'monster',
      combatPower: 80,
      currentHp: 200,
      rank: 3,
    });
    const rookieRecord = createNPCRecord({
      entityId: 'rookie_1',
      factionId: 'stalker',
      combatPower: 30,
      currentHp: 50, // 50 < 60 damage from monster → one-shot kill
      rank: 1,
    });

    const npcRecords = new Map<string, INPCRecord>([
      ['bloodsucker_1', monsterRecord],
      ['rookie_1', rookieRecord],
    ]);
    const brains = new Map([
      ['bloodsucker_1', monsterBrain as import('../brain/NPCBrain').NPCBrain],
      ['rookie_1', rookieBrain as import('../brain/NPCBrain').NPCBrain],
    ]);

    const resolver = new OfflineCombatResolver(getDefaultCombatConfig(), createStubBridge(), SEEDED_RANDOM);
    const story = new StoryRegistry();
    const relations = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(npcRecords, new Map([['lair', lair]]), factions, brains, story, relations, 0);
    deps.events.flush();

    // Rookie dies: 50 HP - 60 damage = -10
    expect(rookieRecord.currentHp).toBeLessThanOrEqual(0);
    // Monster survives: 200 HP - 18 damage = 182
    expect(monsterRecord.currentHp).toBeGreaterThan(0);
    // Terrain freed from dead rookie
    expect(lair.hasOccupant('rookie_1')).toBe(false);
    expect(lair.hasOccupant('bloodsucker_1')).toBe(true);
  });

  it('veteran stalker (rank 5, power 60) kills wounded monster (HP 60)', () => {
    const deps = createSharedDeps();
    const lair = createTerrain({
      id: 'lair',
      capacity: 5,
      jobs: [{ type: 'guard', slots: 5, position: { x: 100, y: 100 } }],
    });

    // Monster: rank 3 (mult 1.0), power 80, wounded to 60 HP
    const monsterBrain = createMonsterBrain({ npcId: 'bloodsucker_1', lairTerrainId: 'lair' }, deps);
    monsterBrain.setRank(3);
    assignBrainToTerrain(monsterBrain, lair, deps.events);

    // Veteran: rank 5 (mult 1.5), power 60 -> attack = round(60*1.5*0.75) = 68
    const veteranBrain = createHumanBrain({ npcId: 'veteran_1', rank: 5 }, deps);
    assignBrainToTerrain(veteranBrain, lair, deps.events);

    // Monster attack: round(80 * 1.0 * 0.75) = 60
    // Veteran attack:  round(60 * 1.5 * 0.75) = 68
    const monsterRecord = createNPCRecord({
      entityId: 'bloodsucker_1',
      factionId: 'monster',
      combatPower: 80,
      currentHp: 60, // 60 < 68 damage from veteran → one-shot kill
      rank: 3,
    });
    const veteranRecord = createNPCRecord({
      entityId: 'veteran_1',
      factionId: 'stalker',
      combatPower: 60,
      currentHp: 120,
      rank: 5,
    });

    const npcRecords = new Map<string, INPCRecord>([
      ['bloodsucker_1', monsterRecord],
      ['veteran_1', veteranRecord],
    ]);
    const brains = new Map([
      ['bloodsucker_1', monsterBrain as import('../brain/NPCBrain').NPCBrain],
      ['veteran_1', veteranBrain as import('../brain/NPCBrain').NPCBrain],
    ]);

    const resolver = new OfflineCombatResolver(getDefaultCombatConfig(), createStubBridge(), SEEDED_RANDOM);
    const story = new StoryRegistry();
    const relations = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(npcRecords, new Map([['lair', lair]]), factions, brains, story, relations, 0);
    deps.events.flush();

    // Monster dies: 60 HP - 68 damage = -8
    expect(monsterRecord.currentHp).toBeLessThanOrEqual(0);
    expect(veteranRecord.currentHp).toBeGreaterThan(0);
    expect(lair.hasOccupant('bloodsucker_1')).toBe(false);
    expect(lair.hasOccupant('veteran_1')).toBe(true);
  });

  it('MonsterBrain picks lair (+1000), HumanBrain picks guard-tagged terrain', () => {
    const deps = createSharedDeps();

    const lairTerrain = createTerrain({
      id: 'monster_lair',
      capacity: 5,
      dangerLevel: 8,
      bounds: { x: 1000, y: 1000, width: 200, height: 200 },
      scoring: { scoringJitter: 0 },
    });
    const guardTerrain = createTerrain({
      id: 'guard_post',
      capacity: 5,
      tags: ['guard'],
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      scoring: { scoringJitter: 0 },
    });

    // Monster far from lair, but lair bonus dominates
    const monsterBrain = createMonsterBrain(
      { npcId: 'boar_1', lairTerrainId: 'monster_lair', position: { x: 50, y: 50 } },
      deps,
    );
    monsterBrain.setRank(3);
    monsterBrain.update(0, [lairTerrain, guardTerrain]);
    deps.events.flush();

    expect(monsterBrain.currentTerrainId).toBe('monster_lair');

    // Sniper HumanBrain should pick guard-tagged terrain
    const sniperBrain = new HumanBrain({
      npcId: 'sniper_1',
      factionId: 'stalker',
      config: createBrainConfig({ reEvaluateIntervalMs: 0 }),
      selectorConfig: createSelectorConfig(),
      jobConfig: createJobConfig(),
      deps: { clock: deps.clock, events: deps.events },
      humanConfig: createDefaultHumanBrainConfig(),
      equipment: { preferredWeaponType: 'sniper', preferredArmor: 'medium', aggressiveness: 0.3, cautiousness: 0.3 },
    });
    sniperBrain.setMovementDispatcher(deps.movement);
    sniperBrain.setLastPosition({ x: 50, y: 50 });
    sniperBrain.setRank(3);
    sniperBrain.update(0, [lairTerrain, guardTerrain]);
    deps.events.flush();

    // Guard-tagged terrain gets +15 sniper bonus — should win over monster_lair
    // (which is far away and has no guard tag bonus for humans)
    expect(sniperBrain.currentTerrainId).toBe('guard_post');
  });

  it('full narrative: monster in lair → rookie enters & dies → veteran enters & kills', () => {
    const deps = createSharedDeps();
    const lair = createTerrain({
      id: 'lair',
      capacity: 5,
      jobs: [{ type: 'guard', slots: 5, position: { x: 100, y: 100 } }],
    });

    const diedPayloads: Array<{ npcId: string }> = [];
    deps.events.on(ALifeEvents.NPC_DIED, (p: ALifeEventPayloads[typeof ALifeEvents.NPC_DIED]) => {
      diedPayloads.push(p);
    });

    // --- Tick 0: monster assigned to lair ---
    const monsterBrain = createMonsterBrain({ npcId: 'bloodsucker_1', lairTerrainId: 'lair' }, deps);
    monsterBrain.setRank(3);
    assignBrainToTerrain(monsterBrain, lair, deps.events);
    expect(lair.hasOccupant('bloodsucker_1')).toBe(true);

    // Monster starts with 80 HP. Tick 1: rookie deals 18 → 62 HP.
    // Tick 2: veteran deals 68 → -6 HP → dead.
    const monsterRecord = createNPCRecord({
      entityId: 'bloodsucker_1',
      factionId: 'monster',
      combatPower: 80,
      currentHp: 80,
      rank: 3,
    });

    const story = new StoryRegistry();
    const relations = new NPCRelationRegistry(createDefaultRelationConfig());
    const resolver = new OfflineCombatResolver(getDefaultCombatConfig(), createStubBridge(), SEEDED_RANDOM);

    // --- Tick 1: rookie enters, combat → rookie dies ---
    const rookieBrain = createHumanBrain({ npcId: 'rookie_1', rank: 1 }, deps);
    assignBrainToTerrain(rookieBrain, lair, deps.events);

    const rookieRecord = createNPCRecord({
      entityId: 'rookie_1',
      factionId: 'stalker',
      combatPower: 30,
      currentHp: 50, // 50 < 60 damage from monster → dies
      rank: 1,
    });

    const npcRecords = new Map<string, INPCRecord>([
      ['bloodsucker_1', monsterRecord],
      ['rookie_1', rookieRecord],
    ]);
    const brains = new Map([
      ['bloodsucker_1', monsterBrain as import('../brain/NPCBrain').NPCBrain],
      ['rookie_1', rookieBrain as import('../brain/NPCBrain').NPCBrain],
    ]);

    resolver.resolve(npcRecords, new Map([['lair', lair]]), factions, brains, story, relations, 0);
    deps.events.flush();

    expect(rookieRecord.currentHp).toBeLessThanOrEqual(0);
    expect(diedPayloads).toHaveLength(1);
    expect(diedPayloads[0].npcId).toBe('rookie_1');

    // Monster took some damage but survived
    const monsterHpAfterRookie = monsterRecord.currentHp;
    expect(monsterHpAfterRookie).toBeGreaterThan(0);

    // --- Tick 2: veteran enters, combat → monster dies ---
    const veteranBrain = createHumanBrain({ npcId: 'veteran_1', rank: 5 }, deps);
    assignBrainToTerrain(veteranBrain, lair, deps.events);

    const veteranRecord = createNPCRecord({
      entityId: 'veteran_1',
      factionId: 'stalker',
      combatPower: 60,
      currentHp: 120,
      rank: 5,
    });

    npcRecords.set('veteran_1', veteranRecord);
    npcRecords.delete('rookie_1'); // dead
    brains.set('veteran_1', veteranBrain as import('../brain/NPCBrain').NPCBrain);
    brains.delete('rookie_1');

    resolver.resolve(npcRecords, new Map([['lair', lair]]), factions, brains, story, relations, 0);
    deps.events.flush();

    expect(monsterRecord.currentHp).toBeLessThanOrEqual(0);
    expect(diedPayloads).toHaveLength(2);
    expect(diedPayloads[1].npcId).toBe('bloodsucker_1');

    // Veteran occupies lair alone
    expect(veteranRecord.currentHp).toBeGreaterThan(0);
    expect(lair.hasOccupant('veteran_1')).toBe(true);
    expect(lair.hasOccupant('bloodsucker_1')).toBe(false);
  });
});
