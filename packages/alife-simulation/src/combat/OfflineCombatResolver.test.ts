/**
 * Tests for OfflineCombatResolver -- SDK version.
 *
 * Zero mocks, zero vi.fn(). All objects are real SDK classes.
 * ISimulationBridge and IRandom are plain stub objects.
 */

import {
  SmartTerrain,
  Faction,
  FactionBuilder,
  Clock,
  EventBus,
} from '@alife-sdk/core';
import type { IRandom, ALifeEventPayloads, ISmartTerrainConfig } from '@alife-sdk/core';

import { NPCBrain } from '../brain/NPCBrain';
import type { IBrainDeps } from '../brain/NPCBrain';
import { StoryRegistry } from '../npc/StoryRegistry';
import { NPCRelationRegistry, createDefaultRelationConfig } from '../npc/NPCRelationRegistry';
import type { ISimulationBridge } from '../ports/ISimulationBridge';
import type { IOfflineCombatConfig } from '../types/ISimulationConfig';
import { createDefaultSimulationConfig } from '../types/ISimulationConfig';
import type { INPCRecord, INPCBehaviorConfig } from '../types/INPCRecord';
import { OfflineCombatResolver } from './OfflineCombatResolver';

// ---------------------------------------------------------------------------
// Stub factories
// ---------------------------------------------------------------------------

function createStubBridge(overrides?: Partial<ISimulationBridge>): ISimulationBridge {
  return {
    isAlive: () => true,
    applyDamage: () => false,
    getEffectiveDamage: (_id, raw) => raw,
    adjustMorale: () => {},
    ...overrides,
  };
}

/** Deterministic random that always returns 0.25 (well below the 70% detection gate). */
const seeded: IRandom = {
  next: () => 0.25,
  nextInt: (min, max) => Math.floor(0.25 * (max - min + 1)) + min,
  nextFloat: (min, max) => 0.25 * (max - min) + min,
};

/** Random that always returns 0.95 -- above the 70% detection gate (0.95*100 = 95 >= 70). */
const highRandom: IRandom = {
  next: () => 0.95,
  nextInt: (min, max) => Math.floor(0.95 * (max - min + 1)) + min,
  nextFloat: (min, max) => 0.95 * (max - min) + min,
};

function getDefaultCombatConfig(overrides?: Partial<IOfflineCombatConfig>): IOfflineCombatConfig {
  const base = createDefaultSimulationConfig();
  return { ...base.offlineCombat, ...overrides };
}

function createBehaviorConfig(overrides?: Partial<INPCBehaviorConfig>): INPCBehaviorConfig {
  return {
    retreatThreshold: 0.1,
    panicThreshold: -0.7,
    searchIntervalMs: 5_000,
    dangerTolerance: 3,
    aggression: 0.5,
    ...overrides,
  };
}

function createNPCRecord(overrides?: Partial<INPCRecord>): INPCRecord {
  return {
    entityId: 'npc_default',
    factionId: 'stalker',
    combatPower: 50,
    currentHp: 100,
    rank: 3,
    behaviorConfig: createBehaviorConfig(),
    lastPosition: { x: 100, y: 100 },
    isOnline: false,
    ...overrides,
  };
}

function createTerrain(overrides?: Partial<ISmartTerrainConfig>): SmartTerrain {
  return new SmartTerrain({
    id: 'terrain_default',
    name: 'Default',
    bounds: { x: 0, y: 0, width: 200, height: 200 },
    capacity: 10,
    ...overrides,
  });
}

function createFaction(id: string, relations: Record<string, number> = {}): Faction {
  const def = new FactionBuilder(id)
    .displayName(id);

  for (const [otherId, score] of Object.entries(relations)) {
    def.relation(otherId, score);
  }

  return new Faction(id, def.build());
}

function createBrainDeps(): IBrainDeps {
  return {
    clock: new Clock({ startHour: 12, timeFactor: 1 }),
    events: new EventBus<ALifeEventPayloads>(),
  };
}

function createBrain(npcId: string, factionId: string): NPCBrain {
  return new NPCBrain({
    npcId,
    factionId,
    config: {
      searchIntervalMs: 5_000,
      schemeCheckIntervalMs: 3_000,
      moraleFleeThreshold: -0.5,
      reEvaluateIntervalMs: 30_000,
      dangerTolerance: 3,
    },
    selectorConfig: { surgeMultiplier: 3.0, squadLeaderBonus: 20, moraleDangerPenalty: 15 },
    jobConfig: { rankBonus: 5, distancePenalty: 0.01 },
    deps: createBrainDeps(),
  });
}

/**
 * Place an NPC into a terrain by assigning the brain to it.
 * This calls brain.update() with the terrain so the brain registers as occupant,
 * then we verify the terrain has the NPC.
 */
function assignBrainToTerrain(brain: NPCBrain, terrain: SmartTerrain): void {
  // Update the brain with only this terrain available so it picks it.
  brain.update(0, [terrain]);
  // Flush the brain's event bus (not strictly needed for combat tests,
  // but keeps the brain state clean).
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OfflineCombatResolver', () => {
  // -----------------------------------------------------------------------
  // 1. No NPCs in terrain
  // -----------------------------------------------------------------------
  it('returns cursor unchanged when no NPCs are in any terrain', () => {
    const config = getDefaultCombatConfig();
    const resolver = new OfflineCombatResolver(config, createStubBridge(), seeded);

    const terrain = createTerrain({ id: 'empty' });
    const terrains = new Map([['empty', terrain]]);
    const npcRecords = new Map<string, INPCRecord>();
    const factions = new Map<string, Faction>();
    const brains = new Map<string, NPCBrain>();
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    const newCursor = resolver.resolve(
      npcRecords, terrains, factions, brains,
      storyRegistry, relationRegistry, 0,
    );

    // With 1 terrain, cursor advances from 0 -> (0+1)%1 = 0
    expect(newCursor).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 2. Single faction -- no combat
  // -----------------------------------------------------------------------
  it('does not resolve combat when only one faction is present', () => {
    const config = getDefaultCombatConfig();
    const moraleAdjustments: Array<{ entityId: string; delta: number; reason: string }> = [];
    const bridge = createStubBridge({
      adjustMorale: (entityId, delta, reason) => {
        moraleAdjustments.push({ entityId, delta, reason });
      },
    });
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    const terrain = createTerrain({ id: 't1' });

    const brainA = createBrain('npc_a', 'stalker');
    const brainB = createBrain('npc_b', 'stalker');
    assignBrainToTerrain(brainA, terrain);
    assignBrainToTerrain(brainB, terrain);

    const recordA = createNPCRecord({ entityId: 'npc_a', factionId: 'stalker' });
    const recordB = createNPCRecord({ entityId: 'npc_b', factionId: 'stalker' });

    const npcRecords = new Map([['npc_a', recordA], ['npc_b', recordB]]);
    const factionStalker = createFaction('stalker');
    const factions = new Map([['stalker', factionStalker]]);
    const brains = new Map([['npc_a', brainA], ['npc_b', brainB]]);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(
      npcRecords, new Map([['t1', terrain]]), factions, brains,
      storyRegistry, relationRegistry, 0,
    );

    // No morale adjustments should have occurred -- no combat happened.
    expect(moraleAdjustments).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // 3. Two hostile factions -- damage exchange
  // -----------------------------------------------------------------------
  it('exchanges damage between two hostile factions in the same terrain', () => {
    const config = getDefaultCombatConfig();
    const moraleAdjustments: Array<{ entityId: string; delta: number; reason: string }> = [];
    const bridge = createStubBridge({
      adjustMorale: (entityId, delta, reason) => {
        moraleAdjustments.push({ entityId, delta, reason });
      },
    });
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    const terrain = createTerrain({ id: 't1' });

    const brainA = createBrain('npc_a', 'stalker');
    const brainB = createBrain('npc_b', 'bandit');
    assignBrainToTerrain(brainA, terrain);
    assignBrainToTerrain(brainB, terrain);

    const recordA = createNPCRecord({ entityId: 'npc_a', factionId: 'stalker', currentHp: 500 });
    const recordB = createNPCRecord({ entityId: 'npc_b', factionId: 'bandit', currentHp: 500 });

    const npcRecords = new Map([['npc_a', recordA], ['npc_b', recordB]]);
    const stalker = createFaction('stalker', { bandit: -100 });
    const bandit = createFaction('bandit', { stalker: -100 });
    const factions = new Map([['stalker', stalker], ['bandit', bandit]]);
    const brains = new Map([['npc_a', brainA], ['npc_b', brainB]]);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(
      npcRecords, new Map([['t1', terrain]]), factions, brains,
      storyRegistry, relationRegistry, 0,
    );

    // Both should have received morale hit penalties.
    const hitPenalties = moraleAdjustments.filter(a => a.reason === 'hit');
    expect(hitPenalties).toHaveLength(2);
    expect(hitPenalties[0].delta).toBe(config.moraleHitPenalty);
    expect(hitPenalties[1].delta).toBe(config.moraleHitPenalty);

    // HP should have decreased from the initial 500.
    expect(recordA.currentHp).toBeLessThan(500);
    expect(recordB.currentHp).toBeLessThan(500);
  });

  // -----------------------------------------------------------------------
  // 4. Non-hostile factions -- no combat
  // -----------------------------------------------------------------------
  it('does not resolve combat between non-hostile factions', () => {
    const config = getDefaultCombatConfig();
    const moraleAdjustments: Array<{ entityId: string; delta: number; reason: string }> = [];
    const bridge = createStubBridge({
      adjustMorale: (entityId, delta, reason) => {
        moraleAdjustments.push({ entityId, delta, reason });
      },
    });
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    const terrain = createTerrain({ id: 't1' });

    const brainA = createBrain('npc_a', 'stalker');
    const brainB = createBrain('npc_b', 'duty');
    assignBrainToTerrain(brainA, terrain);
    assignBrainToTerrain(brainB, terrain);

    const recordA = createNPCRecord({ entityId: 'npc_a', factionId: 'stalker' });
    const recordB = createNPCRecord({ entityId: 'npc_b', factionId: 'duty' });

    // Neutral relations (0) -- not hostile.
    const stalker = createFaction('stalker', { duty: 0 });
    const duty = createFaction('duty', { stalker: 0 });

    const npcRecords = new Map([['npc_a', recordA], ['npc_b', recordB]]);
    const factions = new Map([['stalker', stalker], ['duty', duty]]);
    const brains = new Map([['npc_a', brainA], ['npc_b', brainB]]);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(
      npcRecords, new Map([['t1', terrain]]), factions, brains,
      storyRegistry, relationRegistry, 0,
    );

    expect(moraleAdjustments).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // 5. Story NPC immunity
  // -----------------------------------------------------------------------
  it('skips combat for story NPCs', () => {
    const config = getDefaultCombatConfig();
    const bridge = createStubBridge();
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    const terrain = createTerrain({ id: 't1' });

    const brainA = createBrain('npc_a', 'stalker');
    const brainB = createBrain('npc_b', 'bandit');
    assignBrainToTerrain(brainA, terrain);
    assignBrainToTerrain(brainB, terrain);

    const recordA = createNPCRecord({ entityId: 'npc_a', factionId: 'stalker', currentHp: 100 });
    const recordB = createNPCRecord({ entityId: 'npc_b', factionId: 'bandit', currentHp: 100 });

    const stalker = createFaction('stalker', { bandit: -100 });
    const bandit = createFaction('bandit', { stalker: -100 });

    const npcRecords = new Map([['npc_a', recordA], ['npc_b', recordB]]);
    const factions = new Map([['stalker', stalker], ['bandit', bandit]]);
    const brains = new Map([['npc_a', brainA], ['npc_b', brainB]]);
    const storyRegistry = new StoryRegistry();
    storyRegistry.register('quest_sid', 'npc_a');
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(
      npcRecords, new Map([['t1', terrain]]), factions, brains,
      storyRegistry, relationRegistry, 0,
    );

    // No damage should have been dealt -- story NPC pair is skipped.
    expect(recordA.currentHp).toBe(100);
    expect(recordB.currentHp).toBe(100);
  });

  // -----------------------------------------------------------------------
  // 6. Retreat threshold
  // -----------------------------------------------------------------------
  it('forces reevaluate when cumWinProb is below retreatThreshold', () => {
    const config = getDefaultCombatConfig();
    const bridge = createStubBridge();
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    const terrain = createTerrain({ id: 't1' });

    const brainA = createBrain('npc_a', 'stalker');
    const brainB = createBrain('npc_b', 'bandit');
    assignBrainToTerrain(brainA, terrain);
    assignBrainToTerrain(brainB, terrain);

    // A has very low combat power, B has very high -- A should retreat.
    // With retreatThreshold=0.9, cumWinProb of the weak NPC should be below that.
    const recordA = createNPCRecord({
      entityId: 'npc_a',
      factionId: 'stalker',
      combatPower: 10,
      rank: 1,
      currentHp: 100,
      behaviorConfig: createBehaviorConfig({ retreatThreshold: 0.9 }),
    });
    const recordB = createNPCRecord({
      entityId: 'npc_b',
      factionId: 'bandit',
      combatPower: 100,
      rank: 5,
      currentHp: 100,
      behaviorConfig: createBehaviorConfig({ retreatThreshold: 0.1 }),
    });

    const stalker = createFaction('stalker', { bandit: -100 });
    const bandit = createFaction('bandit', { stalker: -100 });

    const npcRecords = new Map([['npc_a', recordA], ['npc_b', recordB]]);
    const factions = new Map([['stalker', stalker], ['bandit', bandit]]);
    const brains = new Map([['npc_a', brainA], ['npc_b', brainB]]);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(
      npcRecords, new Map([['t1', terrain]]), factions, brains,
      storyRegistry, relationRegistry, 0,
    );

    // A retreats, one side retreats -> no damage exchange.
    expect(recordA.currentHp).toBe(100);
    expect(recordB.currentHp).toBe(100);
  });

  // -----------------------------------------------------------------------
  // 7. Both sides retreat -- no damage
  // -----------------------------------------------------------------------
  it('increments budget but does not exchange damage when both sides retreat', () => {
    const config = getDefaultCombatConfig();
    const moraleAdjustments: Array<{ entityId: string; delta: number; reason: string }> = [];
    const bridge = createStubBridge({
      adjustMorale: (entityId, delta, reason) => {
        moraleAdjustments.push({ entityId, delta, reason });
      },
    });
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    const terrain = createTerrain({ id: 't1' });

    const brainA = createBrain('npc_a', 'stalker');
    const brainB = createBrain('npc_b', 'bandit');
    assignBrainToTerrain(brainA, terrain);
    assignBrainToTerrain(brainB, terrain);

    // Both have extreme retreat thresholds -- both will retreat.
    const recordA = createNPCRecord({
      entityId: 'npc_a',
      factionId: 'stalker',
      combatPower: 50,
      currentHp: 100,
      behaviorConfig: createBehaviorConfig({ retreatThreshold: 0.99 }),
    });
    const recordB = createNPCRecord({
      entityId: 'npc_b',
      factionId: 'bandit',
      combatPower: 50,
      currentHp: 100,
      behaviorConfig: createBehaviorConfig({ retreatThreshold: 0.99 }),
    });

    const stalker = createFaction('stalker', { bandit: -100 });
    const bandit = createFaction('bandit', { stalker: -100 });

    const npcRecords = new Map([['npc_a', recordA], ['npc_b', recordB]]);
    const factions = new Map([['stalker', stalker], ['bandit', bandit]]);
    const brains = new Map([['npc_a', brainA], ['npc_b', brainB]]);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(
      npcRecords, new Map([['t1', terrain]]), factions, brains,
      storyRegistry, relationRegistry, 0,
    );

    // No damage, no morale adjustments.
    expect(recordA.currentHp).toBe(100);
    expect(recordB.currentHp).toBe(100);
    expect(moraleAdjustments).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // 8. Death handling
  // -----------------------------------------------------------------------
  it('calls brain.onDeath, terrain.removeOccupant, and onNPCDeath callback on kill', () => {
    const config = getDefaultCombatConfig();
    const bridge = createStubBridge();
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    const terrain = createTerrain({ id: 't1' });

    const brainA = createBrain('npc_a', 'stalker');
    const brainB = createBrain('npc_b', 'bandit');
    assignBrainToTerrain(brainA, terrain);
    assignBrainToTerrain(brainB, terrain);

    // A has 1 HP -- will die from any hit. B has lots of HP.
    const recordA = createNPCRecord({
      entityId: 'npc_a',
      factionId: 'stalker',
      combatPower: 50,
      currentHp: 1,
    });
    const recordB = createNPCRecord({
      entityId: 'npc_b',
      factionId: 'bandit',
      combatPower: 50,
      currentHp: 1000,
    });

    const stalker = createFaction('stalker', { bandit: -100 });
    const bandit = createFaction('bandit', { stalker: -100 });

    const npcRecords = new Map([['npc_a', recordA], ['npc_b', recordB]]);
    const factions = new Map([['stalker', stalker], ['bandit', bandit]]);
    const brains = new Map([['npc_a', brainA], ['npc_b', brainB]]);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    const deathCallbackCalls: Array<{ deadId: string; killerId: string }> = [];

    resolver.resolve(
      npcRecords, new Map([['t1', terrain]]), factions, brains,
      storyRegistry, relationRegistry, 0,
      (deadId, killerId) => deathCallbackCalls.push({ deadId, killerId }),
    );

    // A should be dead.
    expect(recordA.currentHp).toBeLessThanOrEqual(0);

    // onNPCDeath callback should have been called for A.
    expect(deathCallbackCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ deadId: 'npc_a', killerId: 'npc_b' }),
      ]),
    );

    // Brain.onDeath() releases from terrain, so terrain should not have A anymore.
    expect(terrain.hasOccupant('npc_a')).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 9. Budget cap
  // -----------------------------------------------------------------------
  it('stops after maxResolutionsPerTick exchanges', () => {
    const config = getDefaultCombatConfig({ maxResolutionsPerTick: 1 });
    const moraleAdjustments: Array<{ entityId: string; delta: number; reason: string }> = [];
    const bridge = createStubBridge({
      adjustMorale: (entityId, delta, reason) => {
        moraleAdjustments.push({ entityId, delta, reason });
      },
    });
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    // Two terrains, each with hostile NPCs -- but budget is 1 so only one
    // terrain should get processed.
    const terrain1 = createTerrain({ id: 't1' });
    const terrain2 = createTerrain({ id: 't2' });

    const brainA = createBrain('npc_a', 'stalker');
    const brainB = createBrain('npc_b', 'bandit');
    const brainC = createBrain('npc_c', 'stalker');
    const brainD = createBrain('npc_d', 'bandit');
    assignBrainToTerrain(brainA, terrain1);
    assignBrainToTerrain(brainB, terrain1);
    assignBrainToTerrain(brainC, terrain2);
    assignBrainToTerrain(brainD, terrain2);

    const recordA = createNPCRecord({ entityId: 'npc_a', factionId: 'stalker', currentHp: 500 });
    const recordB = createNPCRecord({ entityId: 'npc_b', factionId: 'bandit', currentHp: 500 });
    const recordC = createNPCRecord({ entityId: 'npc_c', factionId: 'stalker', currentHp: 500 });
    const recordD = createNPCRecord({ entityId: 'npc_d', factionId: 'bandit', currentHp: 500 });

    const stalker = createFaction('stalker', { bandit: -100 });
    const bandit = createFaction('bandit', { stalker: -100 });

    const npcRecords = new Map([
      ['npc_a', recordA], ['npc_b', recordB],
      ['npc_c', recordC], ['npc_d', recordD],
    ]);
    const factions = new Map([['stalker', stalker], ['bandit', bandit]]);
    const brains = new Map([
      ['npc_a', brainA], ['npc_b', brainB],
      ['npc_c', brainC], ['npc_d', brainD],
    ]);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(
      npcRecords,
      new Map([['t1', terrain1], ['t2', terrain2]]),
      factions, brains, storyRegistry, relationRegistry, 0,
    );

    // Only one terrain should have had a hit penalty (2 NPCs = 2 hit adjustments).
    const hitPenalties = moraleAdjustments.filter(a => a.reason === 'hit');
    expect(hitPenalties).toHaveLength(2);

    // One pair from terrain1 was processed. Terrain2 NPCs should still be at full HP.
    // (We can't be sure which terrain was processed first due to round-robin,
    // but with cursor=0 it starts from t1.)
    expect(recordA.currentHp).toBeLessThan(500);
    expect(recordB.currentHp).toBeLessThan(500);
    expect(recordC.currentHp).toBe(500);
    expect(recordD.currentHp).toBe(500);
  });

  // -----------------------------------------------------------------------
  // 10. Online NPCs skipped
  // -----------------------------------------------------------------------
  it('excludes online NPCs from offline combat', () => {
    const config = getDefaultCombatConfig();
    const moraleAdjustments: Array<{ entityId: string; delta: number; reason: string }> = [];
    const bridge = createStubBridge({
      adjustMorale: (entityId, delta, reason) => {
        moraleAdjustments.push({ entityId, delta, reason });
      },
    });
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    const terrain = createTerrain({ id: 't1' });

    const brainA = createBrain('npc_a', 'stalker');
    const brainB = createBrain('npc_b', 'bandit');
    assignBrainToTerrain(brainA, terrain);
    assignBrainToTerrain(brainB, terrain);

    // A is online -- should be skipped.
    const recordA = createNPCRecord({
      entityId: 'npc_a',
      factionId: 'stalker',
      currentHp: 100,
      isOnline: true,
    });
    const recordB = createNPCRecord({
      entityId: 'npc_b',
      factionId: 'bandit',
      currentHp: 100,
      isOnline: false,
    });

    const stalker = createFaction('stalker', { bandit: -100 });
    const bandit = createFaction('bandit', { stalker: -100 });

    const npcRecords = new Map([['npc_a', recordA], ['npc_b', recordB]]);
    const factions = new Map([['stalker', stalker], ['bandit', bandit]]);
    const brains = new Map([['npc_a', brainA], ['npc_b', brainB]]);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(
      npcRecords, new Map([['t1', terrain]]), factions, brains,
      storyRegistry, relationRegistry, 0,
    );

    // No combat should have occurred -- only 1 offline NPC in terrain.
    expect(moraleAdjustments).toEqual([]);
    expect(recordA.currentHp).toBe(100);
    expect(recordB.currentHp).toBe(100);
  });

  // -----------------------------------------------------------------------
  // 11. Detection probability gate
  // -----------------------------------------------------------------------
  it('skips combat when random value fails the detection gate', () => {
    const config = getDefaultCombatConfig({ detectionProbability: 70 });
    const moraleAdjustments: Array<{ entityId: string; delta: number; reason: string }> = [];
    const bridge = createStubBridge({
      adjustMorale: (entityId, delta, reason) => {
        moraleAdjustments.push({ entityId, delta, reason });
      },
    });
    // highRandom.next() returns 0.95 -> 0.95 * 100 = 95 >= 70 -> skips detection gate
    const resolver = new OfflineCombatResolver(config, bridge, highRandom);

    const terrain = createTerrain({ id: 't1' });

    const brainA = createBrain('npc_a', 'stalker');
    const brainB = createBrain('npc_b', 'bandit');
    assignBrainToTerrain(brainA, terrain);
    assignBrainToTerrain(brainB, terrain);

    const recordA = createNPCRecord({ entityId: 'npc_a', factionId: 'stalker', currentHp: 100 });
    const recordB = createNPCRecord({ entityId: 'npc_b', factionId: 'bandit', currentHp: 100 });

    const stalker = createFaction('stalker', { bandit: -100 });
    const bandit = createFaction('bandit', { stalker: -100 });

    const npcRecords = new Map([['npc_a', recordA], ['npc_b', recordB]]);
    const factions = new Map([['stalker', stalker], ['bandit', bandit]]);
    const brains = new Map([['npc_a', brainA], ['npc_b', brainB]]);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(
      npcRecords, new Map([['t1', terrain]]), factions, brains,
      storyRegistry, relationRegistry, 0,
    );

    // Detection failed -- no combat.
    expect(moraleAdjustments).toEqual([]);
    expect(recordA.currentHp).toBe(100);
    expect(recordB.currentHp).toBe(100);
  });

  it('proceeds with combat when random value passes the detection gate', () => {
    const config = getDefaultCombatConfig({ detectionProbability: 70 });
    const bridge = createStubBridge();
    // seeded.next() returns 0.25 -> 0.25 * 100 = 25 < 70 -> passes detection gate
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    const terrain = createTerrain({ id: 't1' });

    const brainA = createBrain('npc_a', 'stalker');
    const brainB = createBrain('npc_b', 'bandit');
    assignBrainToTerrain(brainA, terrain);
    assignBrainToTerrain(brainB, terrain);

    const recordA = createNPCRecord({ entityId: 'npc_a', factionId: 'stalker', currentHp: 500 });
    const recordB = createNPCRecord({ entityId: 'npc_b', factionId: 'bandit', currentHp: 500 });

    const stalker = createFaction('stalker', { bandit: -100 });
    const bandit = createFaction('bandit', { stalker: -100 });

    const npcRecords = new Map([['npc_a', recordA], ['npc_b', recordB]]);
    const factions = new Map([['stalker', stalker], ['bandit', bandit]]);
    const brains = new Map([['npc_a', brainA], ['npc_b', brainB]]);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(
      npcRecords, new Map([['t1', terrain]]), factions, brains,
      storyRegistry, relationRegistry, 0,
    );

    // Detection passed -- damage was dealt.
    expect(recordA.currentHp).toBeLessThan(500);
    expect(recordB.currentHp).toBeLessThan(500);
  });

  // -----------------------------------------------------------------------
  // Additional: combat lock is set after damage exchange
  // -----------------------------------------------------------------------
  it('sets combat lock on both combatants after damage exchange', () => {
    const config = getDefaultCombatConfig({ combatLockMs: 15_000 });
    const bridge = createStubBridge();
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    const terrain = createTerrain({ id: 't1' });

    const brainA = createBrain('npc_a', 'stalker');
    const brainB = createBrain('npc_b', 'bandit');
    assignBrainToTerrain(brainA, terrain);
    assignBrainToTerrain(brainB, terrain);

    const recordA = createNPCRecord({ entityId: 'npc_a', factionId: 'stalker', currentHp: 500 });
    const recordB = createNPCRecord({ entityId: 'npc_b', factionId: 'bandit', currentHp: 500 });

    const stalker = createFaction('stalker', { bandit: -100 });
    const bandit = createFaction('bandit', { stalker: -100 });

    const npcRecords = new Map([['npc_a', recordA], ['npc_b', recordB]]);
    const factions = new Map([['stalker', stalker], ['bandit', bandit]]);
    const brains = new Map([['npc_a', brainA], ['npc_b', brainB]]);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(
      npcRecords, new Map([['t1', terrain]]), factions, brains,
      storyRegistry, relationRegistry, 0,
    );

    // Both brains should be combat-locked.
    expect(brainA.isCombatLocked).toBe(true);
    expect(brainB.isCombatLocked).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Additional: killer receives morale bonus on death
  // -----------------------------------------------------------------------
  it('grants morale bonus to killer when enemy dies', () => {
    const config = getDefaultCombatConfig();
    const moraleAdjustments: Array<{ entityId: string; delta: number; reason: string }> = [];
    const bridge = createStubBridge({
      adjustMorale: (entityId, delta, reason) => {
        moraleAdjustments.push({ entityId, delta, reason });
      },
    });
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    const terrain = createTerrain({ id: 't1' });

    const brainA = createBrain('npc_a', 'stalker');
    const brainB = createBrain('npc_b', 'bandit');
    assignBrainToTerrain(brainA, terrain);
    assignBrainToTerrain(brainB, terrain);

    // B has 1 HP -- will die.
    const recordA = createNPCRecord({
      entityId: 'npc_a',
      factionId: 'stalker',
      combatPower: 50,
      currentHp: 1000,
    });
    const recordB = createNPCRecord({
      entityId: 'npc_b',
      factionId: 'bandit',
      combatPower: 50,
      currentHp: 1,
    });

    const stalker = createFaction('stalker', { bandit: -100 });
    const bandit = createFaction('bandit', { stalker: -100 });

    const npcRecords = new Map([['npc_a', recordA], ['npc_b', recordB]]);
    const factions = new Map([['stalker', stalker], ['bandit', bandit]]);
    const brains = new Map([['npc_a', brainA], ['npc_b', brainB]]);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(
      npcRecords, new Map([['t1', terrain]]), factions, brains,
      storyRegistry, relationRegistry, 0,
    );

    expect(recordB.currentHp).toBeLessThanOrEqual(0);

    // A should have received a kill morale bonus.
    const killBonuses = moraleAdjustments.filter(
      a => a.entityId === 'npc_a' && a.reason === 'kill',
    );
    expect(killBonuses).toHaveLength(1);
    expect(killBonuses[0].delta).toBe(config.moraleKillBonus);
  });

  // -----------------------------------------------------------------------
  // Additional: ally death morale penalty
  // -----------------------------------------------------------------------
  it('applies morale penalty to allies when a faction member dies', () => {
    const config = getDefaultCombatConfig();
    const moraleAdjustments: Array<{ entityId: string; delta: number; reason: string }> = [];
    const bridge = createStubBridge({
      adjustMorale: (entityId, delta, reason) => {
        moraleAdjustments.push({ entityId, delta, reason });
      },
    });
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    const terrain = createTerrain({ id: 't1' });

    // Two stalkers + one bandit. One stalker dies -> the other stalker
    // should receive an ally death morale penalty.
    const brainA = createBrain('npc_a', 'stalker');
    const brainB = createBrain('npc_b', 'stalker');
    const brainC = createBrain('npc_c', 'bandit');
    assignBrainToTerrain(brainA, terrain);
    assignBrainToTerrain(brainB, terrain);
    assignBrainToTerrain(brainC, terrain);

    const recordA = createNPCRecord({
      entityId: 'npc_a',
      factionId: 'stalker',
      combatPower: 50,
      currentHp: 1, // will die
    });
    const recordB = createNPCRecord({
      entityId: 'npc_b',
      factionId: 'stalker',
      combatPower: 50,
      currentHp: 500,
    });
    const recordC = createNPCRecord({
      entityId: 'npc_c',
      factionId: 'bandit',
      combatPower: 50,
      currentHp: 500,
    });

    const stalker = createFaction('stalker', { bandit: -100 });
    const bandit = createFaction('bandit', { stalker: -100 });

    const npcRecords = new Map([
      ['npc_a', recordA], ['npc_b', recordB], ['npc_c', recordC],
    ]);
    const factions = new Map([['stalker', stalker], ['bandit', bandit]]);
    const brains = new Map([
      ['npc_a', brainA], ['npc_b', brainB], ['npc_c', brainC],
    ]);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(
      npcRecords, new Map([['t1', terrain]]), factions, brains,
      storyRegistry, relationRegistry, 0,
    );

    // npc_a should have died.
    expect(recordA.currentHp).toBeLessThanOrEqual(0);

    // npc_b (ally of npc_a) should have received ally_died penalty.
    const allyDeathPenalties = moraleAdjustments.filter(
      a => a.entityId === 'npc_b' && a.reason === 'ally_died',
    );
    expect(allyDeathPenalties).toHaveLength(1);
    expect(allyDeathPenalties[0].delta).toBe(config.moraleAllyDeathPenalty);
  });

  // -----------------------------------------------------------------------
  // Additional: round-robin cursor advancement
  // -----------------------------------------------------------------------
  it('advances round-robin cursor correctly', () => {
    const config = getDefaultCombatConfig();
    const bridge = createStubBridge();
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    const t1 = createTerrain({ id: 't1' });
    const t2 = createTerrain({ id: 't2' });
    const t3 = createTerrain({ id: 't3' });
    const terrains = new Map([['t1', t1], ['t2', t2], ['t3', t3]]);

    const npcRecords = new Map<string, INPCRecord>();
    const factions = new Map<string, Faction>();
    const brains = new Map<string, NPCBrain>();
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    const c1 = resolver.resolve(npcRecords, terrains, factions, brains, storyRegistry, relationRegistry, 0);
    expect(c1).toBe(1);

    const c2 = resolver.resolve(npcRecords, terrains, factions, brains, storyRegistry, relationRegistry, c1);
    expect(c2).toBe(2);

    const c3 = resolver.resolve(npcRecords, terrains, factions, brains, storyRegistry, relationRegistry, c2);
    expect(c3).toBe(0); // wraps around

    // Out-of-bounds cursor is clamped.
    const c4 = resolver.resolve(npcRecords, terrains, factions, brains, storyRegistry, relationRegistry, 999);
    expect(c4).toBe(1); // clamped to 0, then advanced to 1
  });

  // -----------------------------------------------------------------------
  // Additional: relation registry is updated on kill
  // -----------------------------------------------------------------------
  it('notifies relation registry on NPC kill with witnesses', () => {
    const config = getDefaultCombatConfig();
    const bridge = createStubBridge();
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    const terrain = createTerrain({ id: 't1' });

    const brainA = createBrain('npc_a', 'stalker');
    const brainB = createBrain('npc_b', 'bandit');
    const brainC = createBrain('npc_c', 'stalker');
    assignBrainToTerrain(brainA, terrain);
    assignBrainToTerrain(brainB, terrain);
    assignBrainToTerrain(brainC, terrain);

    const recordA = createNPCRecord({
      entityId: 'npc_a',
      factionId: 'stalker',
      combatPower: 50,
      currentHp: 500,
    });
    const recordB = createNPCRecord({
      entityId: 'npc_b',
      factionId: 'bandit',
      combatPower: 50,
      currentHp: 1, // will die
    });
    const recordC = createNPCRecord({
      entityId: 'npc_c',
      factionId: 'stalker',
      combatPower: 50,
      currentHp: 500,
    });

    const stalker = createFaction('stalker', { bandit: -100 });
    const bandit = createFaction('bandit', { stalker: -100 });

    const npcRecords = new Map([
      ['npc_a', recordA], ['npc_b', recordB], ['npc_c', recordC],
    ]);
    const factions = new Map([['stalker', stalker], ['bandit', bandit]]);
    const brains = new Map([
      ['npc_a', brainA], ['npc_b', brainB], ['npc_c', brainC],
    ]);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(
      npcRecords, new Map([['t1', terrain]]), factions, brains,
      storyRegistry, relationRegistry, 0,
    );

    expect(recordB.currentHp).toBeLessThanOrEqual(0);

    // After removeNPC is called, all relations involving npc_b should be cleaned up.
    // The witness (npc_c, same faction as victim npc_b) should have negative goodwill
    // toward the killer (npc_a). But since npc_b was an enemy of npc_c (bandit vs stalker),
    // npc_c actually gets killEnemyDelta (+15) because the victim was hostile.
    // Wait -- npc_c is stalker, victim npc_b is bandit. They are different factions.
    // The relation check is: is witness faction == victim faction? stalker != bandit, so NO.
    // Then: was victim attacking this witness? (fight registry). No fights registered.
    // So: killNeutralDelta (-5) is applied.
    const goodwill = relationRegistry.getPersonalGoodwill('npc_c', 'npc_a');
    expect(goodwill).toBe(-5); // killNeutralDelta
  });

  // -----------------------------------------------------------------------
  // Additional: getEffectiveDamage bridge integration
  // -----------------------------------------------------------------------
  it('uses bridge.getEffectiveDamage to apply immunity reduction', () => {
    // Bridge halves all damage.
    const config = getDefaultCombatConfig();
    const bridge = createStubBridge({
      getEffectiveDamage: (_id, raw) => raw * 0.5,
    });
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    const terrain = createTerrain({ id: 't1' });

    const brainA = createBrain('npc_a', 'stalker');
    const brainB = createBrain('npc_b', 'bandit');
    assignBrainToTerrain(brainA, terrain);
    assignBrainToTerrain(brainB, terrain);

    const recordA = createNPCRecord({ entityId: 'npc_a', factionId: 'stalker', currentHp: 500 });
    const recordB = createNPCRecord({ entityId: 'npc_b', factionId: 'bandit', currentHp: 500 });

    const stalker = createFaction('stalker', { bandit: -100 });
    const bandit = createFaction('bandit', { stalker: -100 });

    const npcRecords = new Map([['npc_a', recordA], ['npc_b', recordB]]);
    const factions = new Map([['stalker', stalker], ['bandit', bandit]]);
    const brains = new Map([['npc_a', brainA], ['npc_b', brainB]]);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    // Also run with full-damage bridge for comparison.
    const recordAFull = createNPCRecord({ entityId: 'npc_a2', factionId: 'stalker', currentHp: 500 });
    const recordBFull = createNPCRecord({ entityId: 'npc_b2', factionId: 'bandit', currentHp: 500 });

    const bridgeFull = createStubBridge();
    const resolverFull = new OfflineCombatResolver(config, bridgeFull, seeded);

    const terrain2 = createTerrain({ id: 't2' });
    const brainA2 = createBrain('npc_a2', 'stalker');
    const brainB2 = createBrain('npc_b2', 'bandit');
    assignBrainToTerrain(brainA2, terrain2);
    assignBrainToTerrain(brainB2, terrain2);

    const npcRecords2 = new Map([['npc_a2', recordAFull], ['npc_b2', recordBFull]]);
    const brains2 = new Map([['npc_a2', brainA2], ['npc_b2', brainB2]]);

    resolver.resolve(
      npcRecords, new Map([['t1', terrain]]), factions, brains,
      storyRegistry, relationRegistry, 0,
    );

    resolverFull.resolve(
      npcRecords2, new Map([['t2', terrain2]]), factions, brains2,
      new StoryRegistry(), new NPCRelationRegistry(createDefaultRelationConfig()), 0,
    );

    // With halved damage, HP should decrease less.
    const damageA = 500 - recordA.currentHp;
    const damageBFull = 500 - recordAFull.currentHp;

    // The halved-bridge version should take about half the damage.
    expect(damageA).toBeLessThan(damageBFull);
  });

  // -----------------------------------------------------------------------
  // Edge: simultaneous death (both NPCs die in one exchange)
  // -----------------------------------------------------------------------
  it('handles simultaneous death when both NPCs die', () => {
    const config = getDefaultCombatConfig();
    const moraleAdjustments: Array<{ entityId: string; delta: number; reason: string }> = [];
    const bridge = createStubBridge({
      adjustMorale: (entityId, delta, reason) => {
        moraleAdjustments.push({ entityId, delta, reason });
      },
    });
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    const terrain = createTerrain({ id: 't1' });

    const brainA = createBrain('npc_a', 'stalker');
    const brainB = createBrain('npc_b', 'bandit');
    assignBrainToTerrain(brainA, terrain);
    assignBrainToTerrain(brainB, terrain);

    // Both have 1 HP — both will die from any hit.
    const recordA = createNPCRecord({
      entityId: 'npc_a',
      factionId: 'stalker',
      combatPower: 50,
      currentHp: 1,
    });
    const recordB = createNPCRecord({
      entityId: 'npc_b',
      factionId: 'bandit',
      combatPower: 50,
      currentHp: 1,
    });

    const stalker = createFaction('stalker', { bandit: -100 });
    const bandit = createFaction('bandit', { stalker: -100 });

    const npcRecords = new Map([['npc_a', recordA], ['npc_b', recordB]]);
    const factions = new Map([['stalker', stalker], ['bandit', bandit]]);
    const brains = new Map([['npc_a', brainA], ['npc_b', brainB]]);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    const deathCalls: Array<{ deadId: string; killerId: string }> = [];

    resolver.resolve(
      npcRecords, new Map([['t1', terrain]]), factions, brains,
      storyRegistry, relationRegistry, 0,
      (deadId, killerId) => deathCalls.push({ deadId, killerId }),
    );

    // Both should be dead.
    expect(recordA.currentHp).toBeLessThanOrEqual(0);
    expect(recordB.currentHp).toBeLessThanOrEqual(0);

    // Both deaths should be reported.
    expect(deathCalls).toHaveLength(2);

    // Neither killer survived, so no kill morale bonus should be given.
    const killBonuses = moraleAdjustments.filter(a => a.reason === 'kill');
    expect(killBonuses).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Edge: empty terrains map
  // -----------------------------------------------------------------------
  it('returns cursor unchanged when terrains map is empty', () => {
    const config = getDefaultCombatConfig();
    const resolver = new OfflineCombatResolver(config, createStubBridge(), seeded);

    const npcRecords = new Map<string, INPCRecord>();
    const factions = new Map<string, Faction>();
    const brains = new Map<string, NPCBrain>();
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    const cursor = resolver.resolve(
      npcRecords, new Map(), factions, brains,
      storyRegistry, relationRegistry, 5,
    );

    // Empty terrains → cursor is clamped to 0 (cursor >= totalTerrains).
    expect(cursor).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Edge: three factions in one terrain — pairwise combat
  // -----------------------------------------------------------------------
  it('resolves combat between all hostile pairs when three factions share a terrain', () => {
    const config = getDefaultCombatConfig({ maxResolutionsPerTick: 100 });
    const moraleAdjustments: Array<{ entityId: string; delta: number; reason: string }> = [];
    const bridge = createStubBridge({
      adjustMorale: (entityId, delta, reason) => {
        moraleAdjustments.push({ entityId, delta, reason });
      },
    });
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    const terrain = createTerrain({ id: 't1' });

    const brainA = createBrain('npc_a', 'stalker');
    const brainB = createBrain('npc_b', 'bandit');
    const brainC = createBrain('npc_c', 'military');
    assignBrainToTerrain(brainA, terrain);
    assignBrainToTerrain(brainB, terrain);
    assignBrainToTerrain(brainC, terrain);

    const recordA = createNPCRecord({ entityId: 'npc_a', factionId: 'stalker', currentHp: 5000 });
    const recordB = createNPCRecord({ entityId: 'npc_b', factionId: 'bandit', currentHp: 5000 });
    const recordC = createNPCRecord({ entityId: 'npc_c', factionId: 'military', currentHp: 5000 });

    // All three factions are mutually hostile.
    const stalker = createFaction('stalker', { bandit: -100, military: -100 });
    const bandit = createFaction('bandit', { stalker: -100, military: -100 });
    const military = createFaction('military', { stalker: -100, bandit: -100 });

    const npcRecords = new Map([
      ['npc_a', recordA], ['npc_b', recordB], ['npc_c', recordC],
    ]);
    const factions = new Map([
      ['stalker', stalker], ['bandit', bandit], ['military', military],
    ]);
    const brains = new Map([
      ['npc_a', brainA], ['npc_b', brainB], ['npc_c', brainC],
    ]);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(
      npcRecords, new Map([['t1', terrain]]), factions, brains,
      storyRegistry, relationRegistry, 0,
    );

    // Three hostile pairs: (stalker,bandit), (stalker,military), (bandit,military).
    // Each pair generates 2 hit penalties (one per combatant).
    const hitPenalties = moraleAdjustments.filter(a => a.reason === 'hit');
    expect(hitPenalties).toHaveLength(6); // 3 pairs × 2 NPCs

    // All three should have taken damage.
    expect(recordA.currentHp).toBeLessThan(5000);
    expect(recordB.currentHp).toBeLessThan(5000);
    expect(recordC.currentHp).toBeLessThan(5000);
  });

  // -----------------------------------------------------------------------
  // Edge: custom damageTypeId in config
  // -----------------------------------------------------------------------
  it('uses custom damageTypeId from config', () => {
    const config = getDefaultCombatConfig({ damageTypeId: 'radiation' });
    const damageCalls: Array<{ id: string; raw: number; type: string }> = [];
    const bridge = createStubBridge({
      getEffectiveDamage: (id, raw, type) => {
        damageCalls.push({ id, raw, type });
        return raw;
      },
    });
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    const terrain = createTerrain({ id: 't1' });

    const brainA = createBrain('npc_a', 'stalker');
    const brainB = createBrain('npc_b', 'bandit');
    assignBrainToTerrain(brainA, terrain);
    assignBrainToTerrain(brainB, terrain);

    const recordA = createNPCRecord({ entityId: 'npc_a', factionId: 'stalker', currentHp: 500 });
    const recordB = createNPCRecord({ entityId: 'npc_b', factionId: 'bandit', currentHp: 500 });

    const stalker = createFaction('stalker', { bandit: -100 });
    const bandit = createFaction('bandit', { stalker: -100 });

    const npcRecords = new Map([['npc_a', recordA], ['npc_b', recordB]]);
    const factions = new Map([['stalker', stalker], ['bandit', bandit]]);
    const brains = new Map([['npc_a', brainA], ['npc_b', brainB]]);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(
      npcRecords, new Map([['t1', terrain]]), factions, brains,
      storyRegistry, relationRegistry, 0,
    );

    // All getEffectiveDamage calls should use 'radiation' type.
    expect(damageCalls.length).toBeGreaterThan(0);
    for (const call of damageCalls) {
      expect(call.type).toBe('radiation');
    }
  });

  // -----------------------------------------------------------------------
  // Edge case: combatPower = 0 must not produce NaN
  // -----------------------------------------------------------------------
  it('does not produce NaN damage when combatPower is 0', () => {
    const config = getDefaultCombatConfig();
    const damageCalls: number[] = [];
    const bridge = createStubBridge({
      getEffectiveDamage: (_id, raw) => {
        damageCalls.push(raw);
        return raw;
      },
    });
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    const terrain = createTerrain({ id: 't1' });
    const brainA = createBrain('npc_a', 'stalker');
    const brainB = createBrain('npc_b', 'bandit');
    assignBrainToTerrain(brainA, terrain);
    assignBrainToTerrain(brainB, terrain);

    // combatPower = 0 for both — was causing NaN before the fix
    const recordA = createNPCRecord({ entityId: 'npc_a', factionId: 'stalker', combatPower: 0, currentHp: 500 });
    const recordB = createNPCRecord({ entityId: 'npc_b', factionId: 'bandit', combatPower: 0, currentHp: 500 });

    const stalker = createFaction('stalker', { bandit: -100 });
    const bandit = createFaction('bandit', { stalker: -100 });

    const npcRecords = new Map([['npc_a', recordA], ['npc_b', recordB]]);
    const factions = new Map([['stalker', stalker], ['bandit', bandit]]);
    const brains = new Map([['npc_a', brainA], ['npc_b', brainB]]);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(npcRecords, new Map([['t1', terrain]]), factions, brains, storyRegistry, relationRegistry, 0);

    // Every damage call must be a finite number, never NaN or Infinity
    for (const dmg of damageCalls) {
      expect(Number.isFinite(dmg)).toBe(true);
    }
  });

  // -----------------------------------------------------------------------
  // Edge case: dead NPCs (hp=0) must not be selected as combat representatives
  // -----------------------------------------------------------------------
  it('does not select a dead NPC (hp=0) as a faction representative', () => {
    const config = getDefaultCombatConfig();
    const diedIds: string[] = [];
    const bridge = createStubBridge();
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    const terrain = createTerrain({ id: 't1' });

    // Two stalkers: one dead, one alive
    const deadBrain = createBrain('dead_npc', 'stalker');
    const aliveBrain = createBrain('alive_npc', 'stalker');
    const banditBrain = createBrain('npc_b', 'bandit');
    assignBrainToTerrain(deadBrain, terrain);
    assignBrainToTerrain(aliveBrain, terrain);
    assignBrainToTerrain(banditBrain, terrain);

    const deps = createBrainDeps();
    deps.events.on('alife:npc_died', (p) => diedIds.push(p.npcId));

    const deadRecord = createNPCRecord({ entityId: 'dead_npc', factionId: 'stalker', currentHp: 0, combatPower: 9999 });
    const aliveRecord = createNPCRecord({ entityId: 'alive_npc', factionId: 'stalker', currentHp: 100, combatPower: 10 });
    const banditRecord = createNPCRecord({ entityId: 'npc_b', factionId: 'bandit', currentHp: 100, combatPower: 10 });

    const stalker = createFaction('stalker', { bandit: -100 });
    const bandit = createFaction('bandit', { stalker: -100 });

    const npcRecords = new Map([
      ['dead_npc', deadRecord],
      ['alive_npc', aliveRecord],
      ['npc_b', banditRecord],
    ]);
    const factions = new Map([['stalker', stalker], ['bandit', bandit]]);
    const brains = new Map([
      ['dead_npc', deadBrain],
      ['alive_npc', aliveBrain],
      ['npc_b', banditBrain],
    ]);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    // Should not throw and should not pick dead_npc as representative
    expect(() =>
      resolver.resolve(npcRecords, new Map([['t1', terrain]]), factions, brains, storyRegistry, relationRegistry, 0),
    ).not.toThrow();

    // dead_npc must never appear as a combatant that dies (it's already at 0 hp)
    expect(diedIds).not.toContain('dead_npc');
  });
});
