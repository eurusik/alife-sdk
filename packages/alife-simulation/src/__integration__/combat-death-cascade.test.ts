/**
 * Integration test: "Combat death cascade".
 *
 * Verifies the full death cascade when OfflineCombatResolver kills an NPC:
 *   - Terrain slot freed (another NPC can enter)
 *   - brain.onDeath() releases terrain and emits NPC_DIED
 *   - NPCRelationRegistry receives witness notifications
 *   - Ally death morale penalty cascades to surviving faction members
 *   - Combat lock prevents brain reevaluation until expiry
 *
 * All objects are REAL -- zero mocks, zero vi.fn().
 * ISimulationBridge and IRandom are plain stub objects.
 */

import {
  SmartTerrain,
  Faction,
  FactionBuilder,
  Clock,
  EventBus,
  ALifeEvents,
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
import { OfflineCombatResolver } from '../combat/OfflineCombatResolver';
import { MovementSimulator } from '../movement/MovementSimulator';

// ---------------------------------------------------------------------------
// Deterministic random
// ---------------------------------------------------------------------------

/** Deterministic random that always returns 0.25 (well below the 70% detection gate). */
const seeded: IRandom = {
  next: () => 0.25,
  nextInt: (min, max) => Math.floor(0.25 * (max - min + 1)) + min,
  nextFloat: (min, max) => 0.25 * (max - min) + min,
};

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

/** Shared infrastructure: clock + events + movement. */
function createSharedDeps() {
  const clock = new Clock({ startHour: 12, timeFactor: 1 });
  const events = new EventBus<ALifeEventPayloads>();
  const movement = new MovementSimulator(events);
  return { clock, events, movement };
}

function createBrain(
  npcId: string,
  factionId: string,
  deps?: IBrainDeps,
): NPCBrain {
  const d = deps ?? createBrainDeps();
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
    deps: d,
  });
}

/**
 * Place an NPC into a terrain by assigning the brain to it.
 * This calls brain.update() with the terrain so the brain registers as occupant.
 */
function assignBrainToTerrain(brain: NPCBrain, terrain: SmartTerrain): void {
  brain.update(0, [terrain]);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Combat death cascade', () => {
  // -----------------------------------------------------------------------
  // 1. Death frees terrain slot -- another NPC can occupy it next tick
  // -----------------------------------------------------------------------
  it('death frees terrain slot — another NPC can occupy it next tick', () => {
    const config = getDefaultCombatConfig();
    const bridge = createStubBridge();
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    // Terrain with capacity=2
    const terrain = createTerrain({ id: 'outpost', capacity: 2, jobs: [{ type: 'guard', slots: 2, position: { x: 100, y: 100 } }] });

    // Shared deps so all brains share the same EventBus
    const sharedDeps = createSharedDeps();
    const deps: IBrainDeps = { clock: sharedDeps.clock, events: sharedDeps.events };

    // npc_a: stalker, 1 HP (will die)
    const brainA = createBrain('npc_a', 'stalker', deps);
    brainA.setMovementDispatcher(sharedDeps.movement);
    brainA.setLastPosition({ x: 100, y: 100 });
    brainA.setRank(3);
    assignBrainToTerrain(brainA, terrain);
    sharedDeps.events.flush();

    // npc_b: bandit, 1000 HP (killer)
    const brainB = createBrain('npc_b', 'bandit', deps);
    brainB.setMovementDispatcher(sharedDeps.movement);
    brainB.setLastPosition({ x: 100, y: 100 });
    brainB.setRank(3);
    assignBrainToTerrain(brainB, terrain);
    sharedDeps.events.flush();

    // Terrain is now at capacity (2/2)
    expect(terrain.occupantCount).toBe(2);
    expect(terrain.hasCapacity).toBe(false);

    // npc_c: stalker, waiting (not in terrain)
    const brainC = createBrain('npc_c', 'stalker', deps);
    brainC.setMovementDispatcher(sharedDeps.movement);
    brainC.setLastPosition({ x: 100, y: 100 });
    brainC.setRank(3);

    const recordA = createNPCRecord({ entityId: 'npc_a', factionId: 'stalker', combatPower: 50, currentHp: 1 });
    const recordB = createNPCRecord({ entityId: 'npc_b', factionId: 'bandit', combatPower: 50, currentHp: 1000 });

    const stalker = createFaction('stalker', { bandit: -100 });
    const bandit = createFaction('bandit', { stalker: -100 });

    const npcRecords = new Map([['npc_a', recordA], ['npc_b', recordB]]);
    const factions = new Map([['stalker', stalker], ['bandit', bandit]]);
    const brains = new Map([['npc_a', brainA], ['npc_b', brainB], ['npc_c', brainC]]);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    // Resolve combat -- npc_a dies
    resolver.resolve(
      npcRecords, new Map([['outpost', terrain]]), factions, brains,
      storyRegistry, relationRegistry, 0,
    );
    sharedDeps.events.flush();

    // npc_a is dead, terrain has freed a slot
    expect(recordA.currentHp).toBeLessThanOrEqual(0);
    expect(terrain.hasOccupant('npc_a')).toBe(false);
    expect(terrain.hasCapacity).toBe(true);

    // On next brain.update() for npc_c, it can enter the freed slot
    brainC.update(0, [terrain]);
    sharedDeps.events.flush();

    expect(brainC.currentTerrainId).toBe('outpost');
    expect(terrain.hasOccupant('npc_c')).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 2. brain.onDeath releases terrain and emits NPC_DIED
  // -----------------------------------------------------------------------
  it('brain.onDeath releases terrain and emits NPC_DIED', () => {
    const config = getDefaultCombatConfig();
    const bridge = createStubBridge();
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    const terrain = createTerrain({ id: 'camp', jobs: [{ type: 'camp', slots: 5, position: { x: 100, y: 100 } }] });

    const sharedDeps = createSharedDeps();
    const deps: IBrainDeps = { clock: sharedDeps.clock, events: sharedDeps.events };

    const brainA = createBrain('npc_a', 'stalker', deps);
    brainA.setMovementDispatcher(sharedDeps.movement);
    brainA.setLastPosition({ x: 100, y: 100 });
    brainA.setRank(3);
    assignBrainToTerrain(brainA, terrain);
    sharedDeps.events.flush();

    const brainB = createBrain('npc_b', 'bandit', deps);
    brainB.setMovementDispatcher(sharedDeps.movement);
    brainB.setLastPosition({ x: 100, y: 100 });
    brainB.setRank(3);
    assignBrainToTerrain(brainB, terrain);
    sharedDeps.events.flush();

    // Listen for NPC_DIED
    const diedPayloads: Array<{ npcId: string; killedBy: string; zoneId: string }> = [];
    sharedDeps.events.on(
      ALifeEvents.NPC_DIED,
      (p) => diedPayloads.push(p as typeof diedPayloads[0]),
    );

    const recordA = createNPCRecord({ entityId: 'npc_a', factionId: 'stalker', combatPower: 50, currentHp: 1 });
    const recordB = createNPCRecord({ entityId: 'npc_b', factionId: 'bandit', combatPower: 50, currentHp: 1000 });

    const stalker = createFaction('stalker', { bandit: -100 });
    const bandit = createFaction('bandit', { stalker: -100 });

    const npcRecords = new Map([['npc_a', recordA], ['npc_b', recordB]]);
    const factions = new Map([['stalker', stalker], ['bandit', bandit]]);
    const brains = new Map([['npc_a', brainA], ['npc_b', brainB]]);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(
      npcRecords, new Map([['camp', terrain]]), factions, brains,
      storyRegistry, relationRegistry, 0,
    );
    sharedDeps.events.flush();

    // npc_a died
    expect(recordA.currentHp).toBeLessThanOrEqual(0);

    // NPC_DIED emitted with correct npcId
    expect(diedPayloads).toHaveLength(1);
    expect(diedPayloads[0].npcId).toBe('npc_a');

    // brain.currentTerrainId is null after death
    expect(brainA.currentTerrainId).toBeNull();

    // terrain no longer has npc_a
    expect(terrain.hasOccupant('npc_a')).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 3. Relation registry gets witness notifications on kill
  // -----------------------------------------------------------------------
  it('relation registry gets witness notifications on kill', () => {
    const config = getDefaultCombatConfig();
    const bridge = createStubBridge();
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    const terrain = createTerrain({ id: 't1', jobs: [{ type: 'guard', slots: 5, position: { x: 100, y: 100 } }] });

    const sharedDeps = createSharedDeps();
    const deps: IBrainDeps = { clock: sharedDeps.clock, events: sharedDeps.events };

    // stalker_a: will die (1 HP)
    const brainA = createBrain('stalker_a', 'stalker', deps);
    brainA.setMovementDispatcher(sharedDeps.movement);
    brainA.setLastPosition({ x: 100, y: 100 });
    brainA.setRank(3);
    assignBrainToTerrain(brainA, terrain);
    sharedDeps.events.flush();

    // bandit_b: killer (1000 HP)
    const brainB = createBrain('bandit_b', 'bandit', deps);
    brainB.setMovementDispatcher(sharedDeps.movement);
    brainB.setLastPosition({ x: 100, y: 100 });
    brainB.setRank(3);
    assignBrainToTerrain(brainB, terrain);
    sharedDeps.events.flush();

    // stalker_c: witness (500 HP, same faction as victim)
    const brainC = createBrain('stalker_c', 'stalker', deps);
    brainC.setMovementDispatcher(sharedDeps.movement);
    brainC.setLastPosition({ x: 100, y: 100 });
    brainC.setRank(3);
    assignBrainToTerrain(brainC, terrain);
    sharedDeps.events.flush();

    const recordA = createNPCRecord({ entityId: 'stalker_a', factionId: 'stalker', combatPower: 50, currentHp: 1 });
    const recordB = createNPCRecord({ entityId: 'bandit_b', factionId: 'bandit', combatPower: 50, currentHp: 1000 });
    const recordC = createNPCRecord({ entityId: 'stalker_c', factionId: 'stalker', combatPower: 50, currentHp: 500 });

    const stalker = createFaction('stalker', { bandit: -100 });
    const bandit = createFaction('bandit', { stalker: -100 });

    const npcRecords = new Map([
      ['stalker_a', recordA], ['bandit_b', recordB], ['stalker_c', recordC],
    ]);
    const factions = new Map([['stalker', stalker], ['bandit', bandit]]);
    const brains = new Map([
      ['stalker_a', brainA], ['bandit_b', brainB], ['stalker_c', brainC],
    ]);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(
      npcRecords, new Map([['t1', terrain]]), factions, brains,
      storyRegistry, relationRegistry, 0,
    );
    sharedDeps.events.flush();

    // stalker_a should be dead
    expect(recordA.currentHp).toBeLessThanOrEqual(0);

    // stalker_c witnessed bandit_b kill their ally stalker_a.
    // Witness faction (stalker) === victim faction (stalker), so killAllyDelta (-30).
    const goodwillCtoB = relationRegistry.getPersonalGoodwill('stalker_c', 'bandit_b');
    expect(goodwillCtoB).toBe(-30);

    // Dead NPC's relations are cleaned up via removeNPC.
    // After removeNPC, any previously-set goodwill involving stalker_a should be 0.
    const goodwillAtoB = relationRegistry.getPersonalGoodwill('stalker_a', 'bandit_b');
    expect(goodwillAtoB).toBe(0);
  });

  // -----------------------------------------------------------------------
  // 4. Ally death morale penalty cascades to surviving faction members
  // -----------------------------------------------------------------------
  it('ally death morale penalty cascades to surviving faction members', () => {
    const config = getDefaultCombatConfig();

    // Track adjustMorale calls via the bridge
    const moraleAdjustments: Array<{ entityId: string; delta: number; reason: string }> = [];
    const bridge = createStubBridge({
      adjustMorale: (entityId, delta, reason) => {
        moraleAdjustments.push({ entityId, delta, reason });
      },
    });
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    const terrain = createTerrain({ id: 't1', jobs: [{ type: 'guard', slots: 5, position: { x: 100, y: 100 } }] });

    const sharedDeps = createSharedDeps();
    const deps: IBrainDeps = { clock: sharedDeps.clock, events: sharedDeps.events };

    // stalker_a: will die (1 HP)
    const brainA = createBrain('stalker_a', 'stalker', deps);
    brainA.setMovementDispatcher(sharedDeps.movement);
    brainA.setLastPosition({ x: 100, y: 100 });
    brainA.setRank(3);
    assignBrainToTerrain(brainA, terrain);
    sharedDeps.events.flush();

    // bandit_b: killer (1000 HP)
    const brainB = createBrain('bandit_b', 'bandit', deps);
    brainB.setMovementDispatcher(sharedDeps.movement);
    brainB.setLastPosition({ x: 100, y: 100 });
    brainB.setRank(3);
    assignBrainToTerrain(brainB, terrain);
    sharedDeps.events.flush();

    // stalker_c: ally of stalker_a (500 HP)
    const brainC = createBrain('stalker_c', 'stalker', deps);
    brainC.setMovementDispatcher(sharedDeps.movement);
    brainC.setLastPosition({ x: 100, y: 100 });
    brainC.setRank(3);
    assignBrainToTerrain(brainC, terrain);
    sharedDeps.events.flush();

    const recordA = createNPCRecord({ entityId: 'stalker_a', factionId: 'stalker', combatPower: 50, currentHp: 1 });
    const recordB = createNPCRecord({ entityId: 'bandit_b', factionId: 'bandit', combatPower: 50, currentHp: 1000 });
    const recordC = createNPCRecord({ entityId: 'stalker_c', factionId: 'stalker', combatPower: 50, currentHp: 500 });

    const stalker = createFaction('stalker', { bandit: -100 });
    const bandit = createFaction('bandit', { stalker: -100 });

    const npcRecords = new Map([
      ['stalker_a', recordA], ['bandit_b', recordB], ['stalker_c', recordC],
    ]);
    const factions = new Map([['stalker', stalker], ['bandit', bandit]]);
    const brains = new Map([
      ['stalker_a', brainA], ['bandit_b', brainB], ['stalker_c', brainC],
    ]);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(
      npcRecords, new Map([['t1', terrain]]), factions, brains,
      storyRegistry, relationRegistry, 0,
    );
    sharedDeps.events.flush();

    // stalker_a should have died
    expect(recordA.currentHp).toBeLessThanOrEqual(0);

    // stalker_c should have received an ally_died morale penalty
    const allyDeathPenalties = moraleAdjustments.filter(
      (a) => a.entityId === 'stalker_c' && a.reason === 'ally_died',
    );
    expect(allyDeathPenalties).toHaveLength(1);
    expect(allyDeathPenalties[0].delta).toBe(config.moraleAllyDeathPenalty);
  });

  // -----------------------------------------------------------------------
  // 5. Combat lock prevents brain reevaluation until expiry
  // -----------------------------------------------------------------------
  it('combat lock prevents brain reevaluation until expiry', () => {
    const combatLockMs = 15_000;
    const config = getDefaultCombatConfig({ combatLockMs });
    const bridge = createStubBridge();
    const resolver = new OfflineCombatResolver(config, bridge, seeded);

    const terrain = createTerrain({ id: 't1', jobs: [{ type: 'guard', slots: 5, position: { x: 100, y: 100 } }] });
    const terrain2 = createTerrain({ id: 't2', capacity: 5, jobs: [{ type: 'camp', slots: 5, position: { x: 500, y: 500 } }], bounds: { x: 400, y: 400, width: 200, height: 200 } });

    const sharedDeps = createSharedDeps();
    const deps: IBrainDeps = { clock: sharedDeps.clock, events: sharedDeps.events };

    const brainA = createBrain('npc_a', 'stalker', deps);
    brainA.setMovementDispatcher(sharedDeps.movement);
    brainA.setLastPosition({ x: 100, y: 100 });
    brainA.setRank(3);
    assignBrainToTerrain(brainA, terrain);
    sharedDeps.events.flush();

    const brainB = createBrain('npc_b', 'bandit', deps);
    brainB.setMovementDispatcher(sharedDeps.movement);
    brainB.setLastPosition({ x: 100, y: 100 });
    brainB.setRank(3);
    assignBrainToTerrain(brainB, terrain);
    sharedDeps.events.flush();

    // Both NPCs have lots of HP so both survive the exchange
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

    // After exchange, both brains are combat-locked
    expect(brainA.isCombatLocked).toBe(true);
    expect(brainB.isCombatLocked).toBe(true);

    // Record the terrain assignment before lock expires
    const terrainBeforeLock = brainA.currentTerrainId;

    // Update with 14_999 ms -- still 1ms remaining on the lock
    brainA.update(14_999, [terrain, terrain2]);
    sharedDeps.events.flush();

    // Still combat locked (1ms remaining)
    expect(brainA.isCombatLocked).toBe(true);
    // Terrain unchanged because brain was locked and returned early
    expect(brainA.currentTerrainId).toBe(terrainBeforeLock);

    // Update with 2 more ms -- lock expires (14_999 + 2 = 15_001 > 15_000)
    brainA.update(2, [terrain, terrain2]);
    sharedDeps.events.flush();

    // Lock has expired
    expect(brainA.isCombatLocked).toBe(false);
  });
});
