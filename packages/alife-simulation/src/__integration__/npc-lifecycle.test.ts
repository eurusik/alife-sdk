/**
 * Integration test: "Повний цикл життя NPC".
 *
 * Capstone test tying ALL subsystems together end-to-end:
 *   SpawnRegistry → NPCBrain → MovementSimulator → OfflineCombatResolver → SurgeManager
 *
 * Lifecycle phases:
 *   1. Spawn point eligible → NPC "born" (brain + record created)
 *   2. Brain selects terrain, movement dispatches journey
 *   3. NPC arrives, gets a job (TASK_ASSIGNED)
 *   4. NPC survives combat (high HP vs weak hostile)
 *   5. Surge kills NPC (outdoor, no shelter)
 *   6. Aftermath resets spawn → point eligible again
 *   7. Full lifecycle narrative (all steps combined)
 *
 * All objects are REAL -- zero mocks, zero vi.fn().
 */

import { SpawnRegistry, ALifeEvents } from '@alife-sdk/core';

import { OfflineCombatResolver } from '../combat/OfflineCombatResolver';
import { SurgeManager, type ISurgeNPCRecord } from '../surge/SurgeManager';
import { SurgePhase } from '../surge/SurgePhase';
import { StoryRegistry } from '../npc/StoryRegistry';
import { NPCRelationRegistry, createDefaultRelationConfig } from '../npc/NPCRelationRegistry';

import {
  createTerrain,
  createSharedDeps,
  createBrain,
  createFaction,
  createNPCRecord,
  createStubBridge,
  getDefaultCombatConfig,
  getDefaultSurgeConfig,
  assignBrainToTerrain,
  SEEDED_RANDOM,
} from './helpers';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NPC lifecycle', () => {
  // -----------------------------------------------------------------------
  // 1. Spawn point eligible → NPC "born"
  // -----------------------------------------------------------------------
  it('spawn point eligible → NPC "born" with brain + record', () => {
    const spawnRegistry = new SpawnRegistry();

    spawnRegistry.addPoint({
      id: 'sp_outpost',
      terrainId: 'outpost',
      position: { x: 200, y: 200 },
      factionId: 'stalker',
      maxNPCs: 2,
    });

    // Not yet spawned → eligible
    const eligible = spawnRegistry.getEligiblePoints();
    expect(eligible).toHaveLength(1);
    expect(eligible[0].id).toBe('sp_outpost');

    // "Spawn" an NPC: create brain + record, mark spawn point
    const deps = createSharedDeps();
    const brain = createBrain(
      'npc_rookie', 'stalker',
      { clock: deps.clock, events: deps.events }, deps.movement,
      { position: { x: 200, y: 200 }, rank: 2, brainConfig: { reEvaluateIntervalMs: 0 } },
    );
    const record = createNPCRecord({
      entityId: 'npc_rookie',
      factionId: 'stalker',
      combatPower: 40,
      currentHp: 100,
      rank: 2,
    });

    spawnRegistry.markSpawned('sp_outpost');

    // After spawn: cooldown active → not eligible
    expect(spawnRegistry.getEligiblePoints()).toHaveLength(0);

    // Brain and record exist
    expect(brain.npcId).toBe('npc_rookie');
    expect(record.entityId).toBe('npc_rookie');
  });

  // -----------------------------------------------------------------------
  // 2. Brain selects terrain, movement dispatches journey
  // -----------------------------------------------------------------------
  it('brain selects terrain → movement dispatches journey', () => {
    const deps = createSharedDeps();

    const outpost = createTerrain({
      id: 'outpost',
      capacity: 5,
      bounds: { x: 500, y: 500, width: 200, height: 200 },
      scoring: { scoringJitter: 0 },
      jobs: [{ type: 'guard', slots: 5, position: { x: 600, y: 600 } }],
    });

    // NPC far from terrain → journey dispatched
    const brain = createBrain(
      'npc_a', 'stalker',
      { clock: deps.clock, events: deps.events }, deps.movement,
      { position: { x: 50, y: 50 }, brainConfig: { reEvaluateIntervalMs: 0 } },
    );

    brain.update(0, [outpost]);
    deps.events.flush();

    expect(brain.currentTerrainId).toBe('outpost');
    expect(deps.movement.isMoving('npc_a')).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 3. NPC arrives, gets a job (TASK_ASSIGNED)
  // -----------------------------------------------------------------------
  it('NPC arrives at terrain → gets TASK_ASSIGNED', () => {
    const deps = createSharedDeps();

    const outpost = createTerrain({
      id: 'outpost',
      capacity: 5,
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      scoring: { scoringJitter: 0 },
      jobs: [{ type: 'guard', slots: 5, position: { x: 100, y: 100 } }],
    });

    // NPC at the terrain's center → no travel needed
    const brain = createBrain(
      'npc_a', 'stalker',
      { clock: deps.clock, events: deps.events }, deps.movement,
      { position: { x: 100, y: 100 }, brainConfig: { reEvaluateIntervalMs: 0 } },
    );

    const taskEvents: Array<{ npcId: string; terrainId: string; taskType: string }> = [];
    deps.events.on(ALifeEvents.TASK_ASSIGNED, (p) =>
      taskEvents.push(p as typeof taskEvents[0]),
    );

    brain.update(0, [outpost]);
    deps.events.flush();

    expect(brain.currentTerrainId).toBe('outpost');
    expect(brain.currentTask).not.toBeNull();
    expect(brain.currentTask!.slotType).toBe('guard');

    expect(taskEvents).toHaveLength(1);
    expect(taskEvents[0].npcId).toBe('npc_a');
    expect(taskEvents[0].taskType).toBe('guard');
  });

  // -----------------------------------------------------------------------
  // 4. NPC survives combat (high HP vs weak hostile)
  // -----------------------------------------------------------------------
  it('NPC survives combat — weak hostile dies', () => {
    const deps = createSharedDeps();

    const terrain = createTerrain({
      id: 'crossroads',
      capacity: 10,
      scoring: { scoringJitter: 0 },
      jobs: [{ type: 'guard', slots: 10, position: { x: 100, y: 100 } }],
    });

    // Strong stalker
    const brainStrong = createBrain(
      'npc_strong', 'stalker',
      { clock: deps.clock, events: deps.events }, deps.movement,
      { position: { x: 100, y: 100 }, rank: 4, brainConfig: { reEvaluateIntervalMs: 0 } },
    );
    assignBrainToTerrain(brainStrong, terrain, deps.events);

    // Weak bandit
    const brainWeak = createBrain(
      'npc_weak', 'bandit',
      { clock: deps.clock, events: deps.events }, deps.movement,
      { position: { x: 100, y: 100 }, rank: 1, brainConfig: { reEvaluateIntervalMs: 0 } },
    );
    assignBrainToTerrain(brainWeak, terrain, deps.events);

    // Jitter for SEEDED_RANDOM (0.25): 0.5 + 0.25*(1.5-0.5) = 0.75
    // Strong: power 50 × rank4(1.2) × 0.75 = 45 damage
    // Weak:   power 50 × rank1(0.8) × 0.75 = 30 damage
    const recordStrong = createNPCRecord({
      entityId: 'npc_strong', factionId: 'stalker',
      combatPower: 50, currentHp: 200, rank: 4,
    });
    const recordWeak = createNPCRecord({
      entityId: 'npc_weak', factionId: 'bandit',
      combatPower: 50, currentHp: 40, rank: 1,
    });

    const stalker = createFaction('stalker', { bandit: -100 });
    const bandit = createFaction('bandit', { stalker: -100 });

    const bridge = createStubBridge();
    const resolver = new OfflineCombatResolver(getDefaultCombatConfig(), bridge, SEEDED_RANDOM);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    const npcRecords = new Map([['npc_strong', recordStrong], ['npc_weak', recordWeak]]);
    const factions = new Map([['stalker', stalker], ['bandit', bandit]]);
    const brains = new Map([['npc_strong', brainStrong], ['npc_weak', brainWeak]]);

    resolver.resolve(
      npcRecords, new Map([['crossroads', terrain]]), factions, brains,
      storyRegistry, relationRegistry, 0,
    );
    deps.events.flush();

    // Weak bandit dies (40 HP - 45 damage < 0)
    expect(recordWeak.currentHp).toBeLessThanOrEqual(0);

    // Strong stalker survives (200 HP - 30 damage = 170)
    expect(recordStrong.currentHp).toBeGreaterThan(0);

    // Strong is combat-locked after exchange
    expect(brainStrong.isCombatLocked).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 5. Surge kills outdoor NPC
  // -----------------------------------------------------------------------
  it('surge kills outdoor NPC → brain.onDeath()', () => {
    const deps = createSharedDeps();
    const spawnRegistry = new SpawnRegistry();

    const shelter = createTerrain({
      id: 'bunker',
      isShelter: true,
      capacity: 5,
    });

    const brain = createBrain(
      'npc_doomed', 'stalker',
      { clock: deps.clock, events: deps.events }, deps.movement,
      { position: { x: 800, y: 800 }, brainConfig: { reEvaluateIntervalMs: 0 } },
    );

    const aliveSet = new Set(['npc_doomed']);
    const deadNpcs: string[] = [];

    const bridge = createStubBridge({
      isAlive: (id) => aliveSet.has(id),
      applyDamage: (id) => {
        aliveSet.delete(id);
        return true; // killed
      },
    });

    const manager = new SurgeManager({
      config: getDefaultSurgeConfig(),
      events: deps.events,
      spawnRegistry,
      bridge,
      random: SEEDED_RANDOM,
      onSurgeDeath: (npcId) => {
        deadNpcs.push(npcId);
        // Simulate brain death callback
        brain.onDeath();
      },
    });
    manager.init();

    // NPC is outdoor (null terrain = no shelter)
    const npcs = new Map<string, ISurgeNPCRecord>([
      ['npc_doomed', { entityId: 'npc_doomed', currentTerrainId: null }],
    ]);

    // Listen for NPC_DIED
    const diedEvents: string[] = [];
    deps.events.on(ALifeEvents.NPC_DIED, (p) => diedEvents.push((p as { npcId: string }).npcId));

    // Force surge → WARNING
    manager.forceSurge();
    expect(manager.getPhase()).toBe(SurgePhase.WARNING);

    // WARNING → ACTIVE
    manager.update(501, npcs, [shelter]);
    expect(manager.getPhase()).toBe(SurgePhase.ACTIVE);

    // Damage tick
    manager.update(501, npcs, [shelter]);

    // Flush to deliver NPC_DIED event from brain.onDeath()
    deps.events.flush();

    // NPC died from surge
    expect(deadNpcs).toContain('npc_doomed');
    expect(diedEvents).toContain('npc_doomed');

    // Brain terrain is null after death
    expect(brain.currentTerrainId).toBeNull();
  });

  // -----------------------------------------------------------------------
  // 6. Aftermath resets spawn → point eligible again
  // -----------------------------------------------------------------------
  it('aftermath resets spawn cooldown → point eligible again', () => {
    const deps = createSharedDeps();
    const spawnRegistry = new SpawnRegistry();

    spawnRegistry.addPoint({
      id: 'sp_field',
      terrainId: 'field',
      position: { x: 300, y: 300 },
      factionId: 'stalker',
      maxNPCs: 2,
    });
    spawnRegistry.markSpawned('sp_field');
    // Simulate NPC death → decrement active count
    spawnRegistry.markDespawned('sp_field');

    // Cooldown still active
    expect(spawnRegistry.getEligiblePoints()).toHaveLength(0);

    const bridge = createStubBridge({ isAlive: () => true });

    const manager = new SurgeManager({
      config: getDefaultSurgeConfig(),
      events: deps.events,
      spawnRegistry,
      bridge,
      random: SEEDED_RANDOM,
    });
    manager.init();

    const npcs = new Map<string, ISurgeNPCRecord>([
      ['survivor', { entityId: 'survivor', currentTerrainId: 'bunker' }],
    ]);
    const shelter = createTerrain({ id: 'bunker', isShelter: true, capacity: 5 });

    // Advance: WARNING → ACTIVE → AFTERMATH
    manager.forceSurge();
    manager.update(501, npcs, [shelter]);  // WARNING → ACTIVE
    manager.update(2_001, npcs, [shelter]); // ACTIVE → AFTERMATH
    expect(manager.getPhase()).toBe(SurgePhase.AFTERMATH);

    // Aftermath effects fire on first update
    manager.update(1, npcs, [shelter]);

    // Spawn cooldown reset → eligible
    const eligible = spawnRegistry.getEligiblePoints();
    expect(eligible).toHaveLength(1);
    expect(eligible[0].id).toBe('sp_field');
  });

  // -----------------------------------------------------------------------
  // 7. Full lifecycle: spawn → terrain → job → combat → surge death → respawn
  // -----------------------------------------------------------------------
  it('full lifecycle: spawn → terrain → job → combat → surge → death → respawn eligible', () => {
    const deps = createSharedDeps();
    const spawnRegistry = new SpawnRegistry();

    // --- Step 1: Spawn infrastructure ---
    const outpost = createTerrain({
      id: 'outpost',
      capacity: 10,
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      scoring: { scoringJitter: 0 },
      jobs: [{ type: 'guard', slots: 10, position: { x: 100, y: 100 } }],
    });
    const shelter = createTerrain({
      id: 'bunker',
      capacity: 10,
      isShelter: true,
      bounds: { x: 500, y: 0, width: 200, height: 200 },
      scoring: { scoringJitter: 0 },
      jobs: [{ type: 'camp', slots: 10, position: { x: 600, y: 100 } }],
    });
    const terrains = [outpost, shelter];

    spawnRegistry.addPoint({
      id: 'sp_outpost',
      terrainId: 'outpost',
      position: { x: 100, y: 100 },
      factionId: 'stalker',
      maxNPCs: 2,
    });

    // --- Step 2: Check eligibility and "spawn" NPC ---
    expect(spawnRegistry.getEligiblePoints()).toHaveLength(1);

    const brain = createBrain(
      'npc_lifecycle', 'stalker',
      { clock: deps.clock, events: deps.events }, deps.movement,
      { position: { x: 100, y: 100 }, rank: 3, brainConfig: { reEvaluateIntervalMs: 0 } },
    );
    const record = createNPCRecord({
      entityId: 'npc_lifecycle',
      factionId: 'stalker',
      combatPower: 50,
      currentHp: 200,
      rank: 3,
    });
    spawnRegistry.markSpawned('sp_outpost');

    // --- Step 3: Brain selects terrain and gets a job ---
    const taskEvents: Array<{ npcId: string; taskType: string }> = [];
    deps.events.on(ALifeEvents.TASK_ASSIGNED, (p) =>
      taskEvents.push(p as typeof taskEvents[0]),
    );

    // NPC only knows about the outpost initially (shelter discovered later during surge)
    brain.update(0, [outpost]);
    deps.events.flush();

    expect(brain.currentTerrainId).toBe('outpost');
    expect(brain.currentTask).not.toBeNull();
    expect(taskEvents).toHaveLength(1);
    expect(taskEvents[0].taskType).toBe('guard');

    // --- Step 4: Combat — NPC survives against weak bandit ---
    const brainBandit = createBrain(
      'bandit_1', 'bandit',
      { clock: deps.clock, events: deps.events }, deps.movement,
      { position: { x: 100, y: 100 }, rank: 1, brainConfig: { reEvaluateIntervalMs: 0 } },
    );
    assignBrainToTerrain(brainBandit, outpost, deps.events);

    const recordBandit = createNPCRecord({
      entityId: 'bandit_1', factionId: 'bandit',
      combatPower: 30, currentHp: 30, rank: 1,
    });

    const stalkerF = createFaction('stalker', { bandit: -100 });
    const banditF = createFaction('bandit', { stalker: -100 });

    const bridge = createStubBridge();
    const resolver = new OfflineCombatResolver(getDefaultCombatConfig(), bridge, SEEDED_RANDOM);
    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    const npcRecords = new Map([
      ['npc_lifecycle', record],
      ['bandit_1', recordBandit],
    ]);
    const factions = new Map([['stalker', stalkerF], ['bandit', banditF]]);
    const brainMap = new Map([['npc_lifecycle', brain], ['bandit_1', brainBandit]]);

    resolver.resolve(
      npcRecords, new Map([['outpost', outpost]]), factions, brainMap,
      storyRegistry, relationRegistry, 0,
    );
    deps.events.flush();

    // Bandit dies: power 30 × rank1(0.8) × jitter(0.75) = 18 damage to stalker
    // Stalker: power 50 × rank3(1.0) × jitter(0.75) = 38 damage to bandit → 30-38 < 0
    expect(recordBandit.currentHp).toBeLessThanOrEqual(0);
    expect(record.currentHp).toBeGreaterThan(0); // 200 - 18 = 182

    // NPC is combat-locked
    expect(brain.isCombatLocked).toBe(true);

    // --- Step 5: Combat lock expires, NPC continues normal operations ---
    // Advance past combat lock (15_000ms default)
    brain.update(15_001, terrains);
    deps.events.flush();
    expect(brain.isCombatLocked).toBe(false);

    // --- Step 6: Surge kills the NPC (outdoor, far from shelter) ---
    const aliveSet = new Set(['npc_lifecycle']);
    const surgeDeadNpcs: string[] = [];

    const surgeBridge = createStubBridge({
      isAlive: (id) => aliveSet.has(id),
      applyDamage: (id) => {
        if (id === 'npc_lifecycle') {
          aliveSet.delete(id);
          return true;
        }
        return false;
      },
    });

    const surgeManager = new SurgeManager({
      config: getDefaultSurgeConfig(),
      events: deps.events,
      spawnRegistry,
      bridge: surgeBridge,
      random: SEEDED_RANDOM,
      onSurgeDeath: (npcId) => {
        surgeDeadNpcs.push(npcId);
        brain.onDeath();
        spawnRegistry.markDespawned('sp_outpost');
      },
    });
    surgeManager.init();

    // NPC is outdoor (in outpost which is NOT a shelter)
    const surgeNpcs = new Map<string, ISurgeNPCRecord>([
      ['npc_lifecycle', { entityId: 'npc_lifecycle', currentTerrainId: 'outpost' }],
    ]);

    // Force surge
    surgeManager.forceSurge();
    surgeManager.update(501, surgeNpcs, terrains); // WARNING → ACTIVE
    expect(surgeManager.getPhase()).toBe(SurgePhase.ACTIVE);

    // Damage tick → NPC dies (outpost is NOT a shelter)
    surgeManager.update(501, surgeNpcs, terrains);
    deps.events.flush();

    expect(surgeDeadNpcs).toContain('npc_lifecycle');
    expect(brain.currentTerrainId).toBeNull();

    // --- Step 7: Aftermath resets spawn → point eligible again ---
    // Remove dead NPC from surge tracking
    surgeNpcs.delete('npc_lifecycle');

    surgeManager.update(2_000, surgeNpcs, terrains); // ACTIVE → AFTERMATH
    expect(surgeManager.getPhase()).toBe(SurgePhase.AFTERMATH);

    // Aftermath effects trigger
    surgeManager.update(1, surgeNpcs, terrains);

    // Spawn point cooldown reset → eligible for new NPC
    const eligible = spawnRegistry.getEligiblePoints();
    expect(eligible).toHaveLength(1);
    expect(eligible[0].id).toBe('sp_outpost');

    // The cycle can begin anew: a new NPC can be spawned at this point
    const newBrain = createBrain(
      'npc_replacement', 'stalker',
      { clock: deps.clock, events: deps.events }, deps.movement,
      { position: { x: 100, y: 100 }, brainConfig: { reEvaluateIntervalMs: 0 } },
    );
    spawnRegistry.markSpawned('sp_outpost');

    newBrain.update(0, terrains);
    deps.events.flush();

    expect(newBrain.currentTerrainId).not.toBeNull();
    expect(newBrain.currentTask).not.toBeNull();
  });
});
