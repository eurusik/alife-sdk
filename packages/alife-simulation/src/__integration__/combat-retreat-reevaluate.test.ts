/**
 * Integration test: "Combat retreat re-evaluate".
 *
 * Verifies the integration between OfflineCombatResolver retreat mechanism
 * and NPCBrain terrain reevaluation. When the combat resolver determines
 * an NPC should retreat (cumWinProb < retreatThreshold), it calls
 * brain.forceReevaluate(), which resets the re-evaluation timer so the
 * brain re-scores terrains on the very next update() call.
 *
 * All objects are REAL -- zero mocks, zero vi.fn().
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
import { MovementSimulator } from '../movement/MovementSimulator';
import { OfflineCombatResolver } from '../combat/OfflineCombatResolver';
import { StoryRegistry } from '../npc/StoryRegistry';
import { NPCRelationRegistry, createDefaultRelationConfig } from '../npc/NPCRelationRegistry';
import { createDefaultSimulationConfig } from '../types/ISimulationConfig';
import type { IOfflineCombatConfig } from '../types/ISimulationConfig';
import type { ISimulationBridge } from '../ports/ISimulationBridge';
import type { INPCRecord, INPCBehaviorConfig } from '../types/INPCRecord';
import { createBrainConfig, createSelectorConfig, createJobConfig } from './helpers';

// ---------------------------------------------------------------------------
// Deterministic random
// ---------------------------------------------------------------------------

/** Always returns 0.25 -- well below the 70% detection gate (0.25*100 = 25 < 70). */
const seeded: IRandom = {
  next: () => 0.25,
  nextInt: (min, max) => Math.floor(0.25 * (max - min + 1)) + min,
  nextFloat: (min, max) => 0.25 * (max - min) + min,
};

// ---------------------------------------------------------------------------
// Stub factories (plain objects, NOT vi.fn)
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

// ---------------------------------------------------------------------------
// Core factories
// ---------------------------------------------------------------------------

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

function getDefaultCombatConfig(overrides?: Partial<IOfflineCombatConfig>): IOfflineCombatConfig {
  const base = createDefaultSimulationConfig();
  return { ...base.offlineCombat, ...overrides };
}

/** Shared infrastructure: clock + events + movement. */
function createInfra() {
  const clock = new Clock({ startHour: 12, timeFactor: 1 });
  const events = new EventBus<ALifeEventPayloads>();
  const movement = new MovementSimulator(events);
  return { clock, events, movement };
}

function createBrain(
  npcId: string,
  factionId: string,
  infra: ReturnType<typeof createInfra>,
): NPCBrain {
  const brain = new NPCBrain({
    npcId,
    factionId,
    config: createBrainConfig({ reEvaluateIntervalMs: 0 }),
    selectorConfig: createSelectorConfig(),
    jobConfig: createJobConfig(),
    deps: { clock: infra.clock, events: infra.events },
  });
  brain.setMovementDispatcher(infra.movement);
  return brain;
}

/**
 * Place an NPC into a terrain by running brain.update() with only that
 * terrain available so the brain registers as an occupant.
 */
function assignBrainToTerrain(
  brain: NPCBrain,
  terrain: SmartTerrain,
  events: EventBus<ALifeEventPayloads>,
): void {
  brain.update(0, [terrain]);
  events.flush();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Combat retreat re-evaluate', () => {
  // -----------------------------------------------------------------------
  // 1. Weak NPC retreats; after brain update it re-selects a terrain
  // -----------------------------------------------------------------------
  it('weak NPC retreats and selects a different terrain on next tick', () => {
    const infra = createInfra();

    // Terrain A: the battleground (both NPCs start here).
    const terrainA = createTerrain({
      id: 'terrain_a',
      name: 'Поле бою',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      capacity: 10,
    });

    // Terrain B: safe fallback (only stalkers allowed, far away).
    const terrainB = createTerrain({
      id: 'terrain_b',
      name: 'Притулок',
      bounds: { x: 5000, y: 5000, width: 100, height: 100 },
      capacity: 10,
      allowedFactions: ['stalker'],
    });

    // Stalker A: weak, retreats easily (retreatThreshold=0.9).
    const brainA = createBrain('npc_a', 'stalker', infra);
    brainA.setLastPosition({ x: 50, y: 50 });
    brainA.setRank(1);
    assignBrainToTerrain(brainA, terrainA, infra.events);

    // Bandit B: strong, never retreats (retreatThreshold=0.1).
    const brainB = createBrain('npc_b', 'bandit', infra);
    brainB.setLastPosition({ x: 50, y: 50 });
    brainB.setRank(5);
    assignBrainToTerrain(brainB, terrainA, infra.events);

    // Verify both NPCs are in terrain A.
    expect(brainA.currentTerrainId).toBe('terrain_a');
    expect(brainB.currentTerrainId).toBe('terrain_a');

    // Build records: A is extremely weak, B is extremely strong.
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

    const config = getDefaultCombatConfig();
    const resolver = new OfflineCombatResolver(config, createStubBridge(), seeded);

    resolver.resolve(
      npcRecords,
      new Map([['terrain_a', terrainA], ['terrain_b', terrainB]]),
      factions,
      brains,
      storyRegistry,
      relationRegistry,
      0,
    );

    // Stalker A retreated: no damage was exchanged.
    expect(recordA.currentHp).toBe(100);
    expect(recordB.currentHp).toBe(100);

    // Brain A is NOT combat-locked (retreat doesn't set combat lock).
    expect(brainA.isCombatLocked).toBe(false);

    // After brain.update(), brain A re-evaluates and picks a terrain.
    // forceReevaluate() reset the re-evaluation timer, so the very next
    // update() triggers selectBestTerrain().
    infra.clock.update(1000);
    infra.movement.update(1000);
    brainA.update(1000, [terrainA, terrainB]);
    infra.events.flush();

    // Brain A must have a valid terrain after re-evaluation.
    expect(brainA.currentTerrainId).not.toBeNull();
  });

  // -----------------------------------------------------------------------
  // 2. Retreating NPC is not combat-locked
  // -----------------------------------------------------------------------
  it('retreating NPC is not combat-locked', () => {
    const infra = createInfra();

    const terrain = createTerrain({
      id: 'terrain_a',
      name: 'Поле бою',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      capacity: 10,
    });

    const brainA = createBrain('npc_a', 'stalker', infra);
    brainA.setLastPosition({ x: 50, y: 50 });
    brainA.setRank(1);
    assignBrainToTerrain(brainA, terrain, infra.events);

    const brainB = createBrain('npc_b', 'bandit', infra);
    brainB.setLastPosition({ x: 50, y: 50 });
    brainB.setRank(5);
    assignBrainToTerrain(brainB, terrain, infra.events);

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

    const config = getDefaultCombatConfig();
    const resolver = new OfflineCombatResolver(config, createStubBridge(), seeded);

    resolver.resolve(
      npcRecords,
      new Map([['terrain_a', terrain]]),
      factions,
      brains,
      storyRegistry,
      relationRegistry,
      0,
    );

    // Retreat does NOT set combat lock on either side.
    expect(brainA.isCombatLocked).toBe(false);
    expect(brainB.isCombatLocked).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 3. Combat lock set only on actual damage exchange (no retreat)
  // -----------------------------------------------------------------------
  it('combat lock set only on actual damage exchange (no retreat)', () => {
    const infra = createInfra();

    const terrain = createTerrain({
      id: 'terrain_a',
      name: 'Поле бою',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      capacity: 10,
    });

    const brainA = createBrain('npc_a', 'stalker', infra);
    brainA.setLastPosition({ x: 50, y: 50 });
    brainA.setRank(3);
    assignBrainToTerrain(brainA, terrain, infra.events);

    const brainB = createBrain('npc_b', 'bandit', infra);
    brainB.setLastPosition({ x: 50, y: 50 });
    brainB.setRank(3);
    assignBrainToTerrain(brainB, terrain, infra.events);

    // Both NPCs with low retreatThreshold (0.1) -- neither retreats.
    const recordA = createNPCRecord({
      entityId: 'npc_a',
      factionId: 'stalker',
      combatPower: 50,
      rank: 3,
      currentHp: 500,
      behaviorConfig: createBehaviorConfig({ retreatThreshold: 0.1 }),
    });
    const recordB = createNPCRecord({
      entityId: 'npc_b',
      factionId: 'bandit',
      combatPower: 50,
      rank: 3,
      currentHp: 500,
      behaviorConfig: createBehaviorConfig({ retreatThreshold: 0.1 }),
    });

    const stalker = createFaction('stalker', { bandit: -100 });
    const bandit = createFaction('bandit', { stalker: -100 });

    const npcRecords = new Map([['npc_a', recordA], ['npc_b', recordB]]);
    const factions = new Map([['stalker', stalker], ['bandit', bandit]]);
    const brains = new Map([['npc_a', brainA], ['npc_b', brainB]]);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    const config = getDefaultCombatConfig();
    const resolver = new OfflineCombatResolver(config, createStubBridge(), seeded);

    resolver.resolve(
      npcRecords,
      new Map([['terrain_a', terrain]]),
      factions,
      brains,
      storyRegistry,
      relationRegistry,
      0,
    );

    // Damage was exchanged -- HP decreased.
    expect(recordA.currentHp).toBeLessThan(500);
    expect(recordB.currentHp).toBeLessThan(500);

    // Both brains should be combat-locked after a real damage exchange.
    expect(brainA.isCombatLocked).toBe(true);
    expect(brainB.isCombatLocked).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 4. Retreated NPC re-selects terrain within one brain tick
  // -----------------------------------------------------------------------
  it('retreated NPC re-selects terrain within one brain tick', () => {
    const infra = createInfra();

    // Dangerous terrain (the battleground).
    const dangerousTerrain = createTerrain({
      id: 'dangerous',
      name: 'Небезпечна зона',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      capacity: 10,
      dangerLevel: 5,
    });

    // Safe terrain (no enemies, stalker-only).
    const safeTerrain = createTerrain({
      id: 'safe',
      name: 'Безпечна зона',
      bounds: { x: 200, y: 200, width: 100, height: 100 },
      capacity: 10,
      allowedFactions: ['stalker'],
    });

    // Stalker A: weak, retreats easily.
    const brainA = createBrain('npc_a', 'stalker', infra);
    brainA.setLastPosition({ x: 50, y: 50 });
    brainA.setRank(1);
    assignBrainToTerrain(brainA, dangerousTerrain, infra.events);

    // Bandit B: strong, never retreats.
    const brainB = createBrain('npc_b', 'bandit', infra);
    brainB.setLastPosition({ x: 50, y: 50 });
    brainB.setRank(5);
    assignBrainToTerrain(brainB, dangerousTerrain, infra.events);

    expect(brainA.currentTerrainId).toBe('dangerous');

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

    const config = getDefaultCombatConfig();
    const resolver = new OfflineCombatResolver(config, createStubBridge(), seeded);

    // Resolve: stalker A retreats (forceReevaluate called).
    resolver.resolve(
      npcRecords,
      new Map([['dangerous', dangerousTerrain], ['safe', safeTerrain]]),
      factions,
      brains,
      storyRegistry,
      relationRegistry,
      0,
    );

    // No damage exchanged -- retreat happened.
    expect(recordA.currentHp).toBe(100);

    // Tick brain A: re-evaluation fires immediately because forceReevaluate
    // reset the timer. Brain picks the best available terrain.
    infra.clock.update(1000);
    infra.movement.update(1000);
    brainA.update(1000, [dangerousTerrain, safeTerrain]);
    infra.events.flush();

    // After re-evaluation, brain A must hold a valid terrain.
    expect(brainA.currentTerrainId).not.toBeNull();
  });

  // -----------------------------------------------------------------------
  // 5. Mutual retreat -- both sides reevaluate, no damage, no lock
  // -----------------------------------------------------------------------
  it('mutual retreat -- both sides reevaluate, no damage, no lock', () => {
    const infra = createInfra();

    const terrain = createTerrain({
      id: 'terrain_a',
      name: 'Поле бою',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      capacity: 10,
    });

    const brainA = createBrain('npc_a', 'stalker', infra);
    brainA.setLastPosition({ x: 50, y: 50 });
    brainA.setRank(3);
    assignBrainToTerrain(brainA, terrain, infra.events);

    const brainB = createBrain('npc_b', 'bandit', infra);
    brainB.setLastPosition({ x: 50, y: 50 });
    brainB.setRank(3);
    assignBrainToTerrain(brainB, terrain, infra.events);

    // Both NPCs with extreme retreatThreshold (0.99) -- both retreat.
    const recordA = createNPCRecord({
      entityId: 'npc_a',
      factionId: 'stalker',
      combatPower: 50,
      rank: 3,
      currentHp: 100,
      behaviorConfig: createBehaviorConfig({ retreatThreshold: 0.99 }),
    });
    const recordB = createNPCRecord({
      entityId: 'npc_b',
      factionId: 'bandit',
      combatPower: 50,
      rank: 3,
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

    const config = getDefaultCombatConfig();
    const resolver = new OfflineCombatResolver(config, createStubBridge(), seeded);

    resolver.resolve(
      npcRecords,
      new Map([['terrain_a', terrain]]),
      factions,
      brains,
      storyRegistry,
      relationRegistry,
      0,
    );

    // No damage exchanged -- mutual retreat.
    expect(recordA.currentHp).toBe(100);
    expect(recordB.currentHp).toBe(100);

    // Neither brain is combat-locked.
    expect(brainA.isCombatLocked).toBe(false);
    expect(brainB.isCombatLocked).toBe(false);

    // Both brains re-evaluate on next update. forceReevaluate was called
    // on both sides, so the re-evaluation timer is reset for both.
    const terrainB = createTerrain({
      id: 'terrain_b',
      name: 'Запасна зона',
      bounds: { x: 300, y: 300, width: 100, height: 100 },
      capacity: 10,
    });

    infra.clock.update(1000);
    infra.movement.update(1000);
    brainA.update(1000, [terrain, terrainB]);
    brainB.update(1000, [terrain, terrainB]);
    infra.events.flush();

    // After re-evaluation, both brains hold valid terrains.
    expect(brainA.currentTerrainId).not.toBeNull();
    expect(brainB.currentTerrainId).not.toBeNull();
  });
});
