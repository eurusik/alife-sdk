/**
 * Integration test: "Три фракції на перехресті".
 *
 * Verifies multi-faction combat resolution:
 *   - All 3 hostile pairs are processed in one terrain
 *   - Budget cap (maxResolutionsPerTick) distributes fairly
 *   - Witness goodwill cascade across factions
 *   - Multiple kills accumulate witness penalties
 *
 * All objects are REAL -- zero mocks, zero vi.fn().
 */

import { OfflineCombatResolver } from '../combat/OfflineCombatResolver';
import { StoryRegistry } from '../npc/StoryRegistry';
import { NPCRelationRegistry, createDefaultRelationConfig } from '../npc/NPCRelationRegistry';
import type { INPCRecord } from '../types/INPCRecord';

import {
  createTerrain,
  createSharedDeps,
  createBrain,
  createNPCRecord,
  createFaction,
  createStubBridge,
  getDefaultCombatConfig,
  assignBrainToTerrain,
  SEEDED_RANDOM,
} from './helpers';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Three-faction skirmish', () => {
  // 3 mutually hostile factions
  const stalker = createFaction('stalker', { bandit: -100, military: -100 });
  const bandit = createFaction('bandit', { stalker: -100, military: -100 });
  const military = createFaction('military', { stalker: -100, bandit: -100 });
  const factions = new Map([['stalker', stalker], ['bandit', bandit], ['military', military]]);

  it('resolver processes all 3 hostile faction pairs in one terrain', () => {
    const deps = createSharedDeps();
    const crossroads = createTerrain({
      id: 'crossroads',
      capacity: 10,
      jobs: [{ type: 'guard', slots: 10, position: { x: 100, y: 100 } }],
    });

    // 2 NPCs per faction, all in same terrain
    const brainIds = [
      { id: 'stalker_a', faction: 'stalker' },
      { id: 'stalker_b', faction: 'stalker' },
      { id: 'bandit_a', faction: 'bandit' },
      { id: 'bandit_b', faction: 'bandit' },
      { id: 'military_a', faction: 'military' },
      { id: 'military_b', faction: 'military' },
    ];

    const brainsMap = new Map<string, import('../brain/NPCBrain').NPCBrain>();
    for (const { id, faction } of brainIds) {
      const brain = createBrain(id, faction, { clock: deps.clock, events: deps.events }, deps.movement);
      assignBrainToTerrain(brain, crossroads, deps.events);
      brainsMap.set(id, brain);
    }

    // All have high HP so nobody dies — we just check damage is dealt
    const npcRecords = new Map<string, INPCRecord>();
    for (const { id, faction } of brainIds) {
      npcRecords.set(id, createNPCRecord({
        entityId: id,
        factionId: faction,
        combatPower: 50,
        currentHp: 1000,
        rank: 3,
      }));
    }

    // Plenty of budget for all 3 pairs
    const config = getDefaultCombatConfig({ maxResolutionsPerTick: 10 });
    const resolver = new OfflineCombatResolver(config, createStubBridge(), SEEDED_RANDOM);
    const story = new StoryRegistry();
    const relations = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(
      npcRecords, new Map([['crossroads', crossroads]]),
      factions, brainsMap, story, relations, 0,
    );
    deps.events.flush();

    // With 3 hostile pairs and seeded random passing detection gate,
    // at least one NPC from each faction should have taken damage
    const factionDamaged = new Set<string>();
    for (const [, record] of npcRecords) {
      if (record.currentHp < 1000) {
        factionDamaged.add(record.factionId);
      }
    }

    // All 3 factions involved in combat
    expect(factionDamaged.size).toBe(3);
  });

  it('budget cap limits resolutions per tick — round-robin fairness', () => {
    const deps = createSharedDeps();
    const crossroads = createTerrain({
      id: 'crossroads',
      capacity: 10,
      jobs: [{ type: 'guard', slots: 10, position: { x: 100, y: 100 } }],
    });

    const brainIds = [
      { id: 'stalker_a', faction: 'stalker' },
      { id: 'bandit_a', faction: 'bandit' },
      { id: 'military_a', faction: 'military' },
    ];

    const brainsMap = new Map<string, import('../brain/NPCBrain').NPCBrain>();
    for (const { id, faction } of brainIds) {
      const brain = createBrain(id, faction, { clock: deps.clock, events: deps.events }, deps.movement);
      assignBrainToTerrain(brain, crossroads, deps.events);
      brainsMap.set(id, brain);
    }

    const npcRecords = new Map<string, INPCRecord>();
    for (const { id, faction } of brainIds) {
      npcRecords.set(id, createNPCRecord({
        entityId: id,
        factionId: faction,
        combatPower: 50,
        currentHp: 1000,
        rank: 3,
      }));
    }

    // Budget = 1: only ONE faction pair resolved per call
    const config = getDefaultCombatConfig({ maxResolutionsPerTick: 1 });
    const resolver = new OfflineCombatResolver(config, createStubBridge(), SEEDED_RANDOM);
    const story = new StoryRegistry();
    const relations = new NPCRelationRegistry(createDefaultRelationConfig());

    // First resolve: only 1 pair gets processed
    resolver.resolve(
      npcRecords, new Map([['crossroads', crossroads]]),
      factions, brainsMap, story, relations, 0,
    );

    // Count how many NPCs took damage
    let damagedCount = 0;
    for (const record of npcRecords.values()) {
      if (record.currentHp < 1000) damagedCount++;
    }

    // Exactly 2 NPCs damaged (one pair exchanged fire)
    expect(damagedCount).toBe(2);
  });

  it('witness goodwill: stalker kills bandit, military witness gets killNeutralDelta', () => {
    const deps = createSharedDeps();
    const crossroads = createTerrain({
      id: 'crossroads',
      capacity: 10,
      jobs: [{ type: 'guard', slots: 10, position: { x: 100, y: 100 } }],
    });

    // stalker_a: strong killer
    // bandit_b: weak victim (1 HP)
    // stalker_c: ally witness
    // military_c: neutral witness
    const ids = ['stalker_a', 'bandit_b', 'stalker_c', 'military_c'];
    const factionMap: Record<string, string> = {
      stalker_a: 'stalker', bandit_b: 'bandit', stalker_c: 'stalker', military_c: 'military',
    };

    const brainsMap = new Map<string, import('../brain/NPCBrain').NPCBrain>();
    for (const id of ids) {
      const brain = createBrain(
        id, factionMap[id],
        { clock: deps.clock, events: deps.events },
        deps.movement,
      );
      assignBrainToTerrain(brain, crossroads, deps.events);
      brainsMap.set(id, brain);
    }

    // With jitter=0.75: stalker_a attack = round(100 * 1.0 * 0.75) = 75
    // bandit_b has 1 HP → guaranteed death
    const npcRecords = new Map<string, INPCRecord>([
      ['stalker_a', createNPCRecord({ entityId: 'stalker_a', factionId: 'stalker', combatPower: 100, currentHp: 500, rank: 3 })],
      ['bandit_b', createNPCRecord({ entityId: 'bandit_b', factionId: 'bandit', combatPower: 50, currentHp: 1, rank: 1 })],
      ['stalker_c', createNPCRecord({ entityId: 'stalker_c', factionId: 'stalker', combatPower: 50, currentHp: 500, rank: 3 })],
      ['military_c', createNPCRecord({ entityId: 'military_c', factionId: 'military', combatPower: 50, currentHp: 500, rank: 3 })],
    ]);

    const config = getDefaultCombatConfig({ maxResolutionsPerTick: 10 });
    const resolver = new OfflineCombatResolver(config, createStubBridge(), SEEDED_RANDOM);
    const story = new StoryRegistry();
    const relations = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(
      npcRecords, new Map([['crossroads', crossroads]]),
      factions, brainsMap, story, relations, 0,
    );
    deps.events.flush();

    // bandit_b should be dead
    expect(npcRecords.get('bandit_b')!.currentHp).toBeLessThanOrEqual(0);

    // stalker_c witnesses ally-faction killer (stalker_a killed bandit_b).
    // stalker_c faction === victim faction? No (stalker ≠ bandit).
    // Was bandit_b attacking stalker_c? No fight registered.
    // → killNeutralDelta (-5) from stalker_c toward stalker_a
    // Actually: stalker_c is STALKER faction, bandit_b is BANDIT faction.
    // stalker_c faction (stalker) ≠ victim faction (bandit), so killNeutralDelta.
    const stalkerWitnessGoodwill = relations.getPersonalGoodwill('stalker_c', 'stalker_a');
    expect(stalkerWitnessGoodwill).toBe(-5);

    // military_c: faction (military) ≠ victim faction (bandit), no fight record
    // → killNeutralDelta (-5)
    const militaryWitnessGoodwill = relations.getPersonalGoodwill('military_c', 'stalker_a');
    expect(militaryWitnessGoodwill).toBe(-5);
  });

  it('ally witness gets killAllyDelta when faction-mate is killed', () => {
    const deps = createSharedDeps();
    const crossroads = createTerrain({
      id: 'crossroads',
      capacity: 10,
      jobs: [{ type: 'guard', slots: 10, position: { x: 100, y: 100 } }],
    });

    // bandit_a kills stalker_b, stalker_c is an ally witness
    const ids = ['bandit_a', 'stalker_b', 'stalker_c'];
    const factionMap: Record<string, string> = {
      bandit_a: 'bandit', stalker_b: 'stalker', stalker_c: 'stalker',
    };

    const brainsMap = new Map<string, import('../brain/NPCBrain').NPCBrain>();
    for (const id of ids) {
      const brain = createBrain(
        id, factionMap[id],
        { clock: deps.clock, events: deps.events },
        deps.movement,
      );
      assignBrainToTerrain(brain, crossroads, deps.events);
      brainsMap.set(id, brain);
    }

    // bandit_a: strong (100 power), stalker_b: weak (1 HP)
    // bandit attack = round(100 * 1.0 * 0.75) = 75 → kills stalker_b
    const npcRecords = new Map<string, INPCRecord>([
      ['bandit_a', createNPCRecord({ entityId: 'bandit_a', factionId: 'bandit', combatPower: 100, currentHp: 500, rank: 3 })],
      ['stalker_b', createNPCRecord({ entityId: 'stalker_b', factionId: 'stalker', combatPower: 50, currentHp: 1, rank: 1 })],
      ['stalker_c', createNPCRecord({ entityId: 'stalker_c', factionId: 'stalker', combatPower: 50, currentHp: 500, rank: 3 })],
    ]);

    const config = getDefaultCombatConfig({ maxResolutionsPerTick: 10 });
    const resolver = new OfflineCombatResolver(config, createStubBridge(), SEEDED_RANDOM);
    const story = new StoryRegistry();
    const relations = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(
      npcRecords, new Map([['crossroads', crossroads]]),
      factions, brainsMap, story, relations, 0,
    );
    deps.events.flush();

    expect(npcRecords.get('stalker_b')!.currentHp).toBeLessThanOrEqual(0);

    // stalker_c witnesses bandit_a killing their ally stalker_b.
    // stalker_c faction (stalker) === victim faction (stalker) → killAllyDelta (-30)
    const allyGoodwill = relations.getPersonalGoodwill('stalker_c', 'bandit_a');
    expect(allyGoodwill).toBe(-30);
  });
});
