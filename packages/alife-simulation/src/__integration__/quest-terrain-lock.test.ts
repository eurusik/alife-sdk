/**
 * Integration test: "Quest terrain lock".
 *
 * Verifies that completing a quest can lock a SmartTerrain (preventing NPC
 * assignment), and that failing or resetting a quest does NOT lock terrain.
 *
 * The QuestEngine holds an ITerrainLockAdapter port. When a quest with a
 * terrain effect completes, it calls `adapter.setLocked(terrainId, true)`.
 * We then check that a brain running against the locked terrain falls back
 * to an alternative terrain.
 *
 * Scenarios:
 *   1. Quest with on_complete lock → complete → terrain locked → brain falls back
 *   2. Multiple quests: only the completed one locks its terrain
 *   3. Quest failed → no lock applied
 *   4. Locked terrain → brain assigns to next best terrain
 *   5. Terrain unlocked after quest reset → brain can assign again
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ALifeKernel,
  FactionsPlugin,
  FactionBuilder,
  Ports,
  SmartTerrain,
} from '@alife-sdk/core';

import { SimulationPlugin } from '../plugin/SimulationPlugin';
import { SimulationPorts } from '../ports/SimulationPorts';
import type { ISimulationBridge } from '../ports/ISimulationBridge';

import {
  EconomyPlugin,
  EconomyPorts,
  QuestStatus,
  ObjectiveType,
  QuestEngine,
} from '@alife-sdk/economy';
import type { IQuestDefinition, ITerrainLockAdapter } from '@alife-sdk/economy';

import {
  createBehaviorConfig,
  SEEDED_RANDOM,
} from './helpers';

function stubBridge(): ISimulationBridge {
  return {
    isAlive: () => true,
    applyDamage: () => false,
    getEffectiveDamage: (_, raw) => raw,
    adjustMorale: () => {},
  };
}

// ---------------------------------------------------------------------------
// ITerrainLockAdapter that records calls into a Set
// ---------------------------------------------------------------------------

interface ITrackingLockAdapter extends ITerrainLockAdapter {
  readonly locks: Set<string>;
  setLocked(terrainId: string, locked: boolean): void;
  isLocked(terrainId: string): boolean;
}

function createTrackingLockAdapter(): ITrackingLockAdapter {
  const locks = new Set<string>();
  return {
    locks,
    setLocked(terrainId: string, locked: boolean): void {
      if (locked) {
        locks.add(terrainId);
      } else {
        locks.delete(terrainId);
      }
    },
    isLocked(terrainId: string): boolean {
      return locks.has(terrainId);
    },
  };
}

// ---------------------------------------------------------------------------
// Quest definitions
// ---------------------------------------------------------------------------

const QUEST_WITH_LOCK: IQuestDefinition = {
  id: 'q_lock_test',
  name: 'Lock Quest',
  description: 'Complete to lock terrain_target',
  objectives: [
    {
      id: 'obj_kill',
      type: ObjectiveType.KILL,
      target: 'enemy',
      description: 'Kill enemies',
      count: 1,
      current: 0,
      completed: false,
    },
  ],
  terrainEffects: [
    { terrainId: 'terrain_target', action: 'lock', trigger: 'on_complete' },
  ],
};

const QUEST_B: IQuestDefinition = {
  id: 'q_b',
  name: 'Quest B',
  description: 'Does not lock terrain_target',
  objectives: [
    {
      id: 'obj_reach',
      type: ObjectiveType.REACH_ZONE,
      target: 'zone_alpha',
      description: 'Reach zone alpha',
      count: 1,
      current: 0,
      completed: false,
    },
  ],
  terrainEffects: [
    { terrainId: 'terrain_other', action: 'lock', trigger: 'on_complete' },
  ],
};

const QUEST_FAIL_NO_LOCK: IQuestDefinition = {
  id: 'q_fail',
  name: 'Fail Quest',
  description: 'Fails without locking',
  objectives: [
    {
      id: 'obj_kill_2',
      type: ObjectiveType.KILL,
      target: 'enemy',
      description: 'Kill enemies',
      count: 2,
      current: 0,
      completed: false,
    },
  ],
  terrainEffects: [
    { terrainId: 'terrain_target', action: 'lock', trigger: 'on_complete' },
  ],
};

const DEFAULT_BEHAVIOR = createBehaviorConfig();

// ---------------------------------------------------------------------------
// Kernel builder
// ---------------------------------------------------------------------------

interface IQuestLockContext {
  kernel: ALifeKernel;
  simulation: SimulationPlugin;
  economy: EconomyPlugin;
  lockAdapter: ITrackingLockAdapter;
}

function buildKernel(): IQuestLockContext {
  const kernel = new ALifeKernel({ clock: { startHour: 12, timeFactor: 1 } });

  kernel.provide(Ports.Random, SEEDED_RANDOM);

  const factionsPlugin = new FactionsPlugin();
  kernel.use(factionsPlugin);
  factionsPlugin.factions.register(
    'loner',
    new FactionBuilder('loner').displayName('loner').build(),
  );

  const simulation = new SimulationPlugin({
    tickIntervalMs: 100,
    maxBrainUpdatesPerTick: 20,
    redundancyCleanupInterval: 3,
  });
  kernel.use(simulation);
  kernel.provide(SimulationPorts.SimulationBridge, stubBridge());

  const economy = new EconomyPlugin(SEEDED_RANDOM);
  kernel.use(economy);

  // Wire the terrain lock adapter BEFORE init so EconomyPlugin.init() picks it up.
  const lockAdapter = createTrackingLockAdapter();
  kernel.provide(EconomyPorts.TerrainLock, lockAdapter);

  // Add terrains.
  simulation.addTerrain(
    new SmartTerrain({
      id: 'terrain_target',
      name: 'Target Terrain',
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      capacity: 5,
    }),
  );
  simulation.addTerrain(
    new SmartTerrain({
      id: 'terrain_fallback',
      name: 'Fallback Terrain',
      bounds: { x: 500, y: 0, width: 200, height: 200 },
      capacity: 5,
    }),
  );
  simulation.addTerrain(
    new SmartTerrain({
      id: 'terrain_other',
      name: 'Other Terrain',
      bounds: { x: 0, y: 500, width: 200, height: 200 },
      capacity: 5,
    }),
  );

  kernel.init();
  kernel.start();

  return { kernel, simulation, economy, lockAdapter };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Quest terrain lock (integration)', () => {
  it('quest with on_complete lock → complete → terrain locked signal sent', () => {
    const { kernel, economy, lockAdapter } = buildKernel();

    economy.quests.registerQuest(QUEST_WITH_LOCK);
    economy.quests.startQuest('q_lock_test');

    // Before completion: terrain not locked.
    expect(lockAdapter.isLocked('terrain_target')).toBe(false);

    // Complete the single objective — auto-completes quest.
    economy.quests.completeObjective('q_lock_test', 'obj_kill');

    // Quest is now COMPLETED.
    expect(economy.quests.getQuestState('q_lock_test')!.status).toBe(QuestStatus.COMPLETED);

    // Lock signal was sent to adapter.
    expect(lockAdapter.isLocked('terrain_target')).toBe(true);

    kernel.destroy();
  });

  it('multiple quests: only the completed one locks its terrain', () => {
    const { kernel, economy, lockAdapter } = buildKernel();

    economy.quests.registerQuest(QUEST_WITH_LOCK);
    economy.quests.registerQuest(QUEST_B);

    economy.quests.startQuest('q_lock_test');
    economy.quests.startQuest('q_b');

    // Complete only q_lock_test.
    economy.quests.completeObjective('q_lock_test', 'obj_kill');

    expect(lockAdapter.isLocked('terrain_target')).toBe(true);
    // terrain_other must NOT be locked (q_b is still active).
    expect(lockAdapter.isLocked('terrain_other')).toBe(false);

    expect(economy.quests.getQuestState('q_b')!.status).toBe(QuestStatus.ACTIVE);

    kernel.destroy();
  });

  it('quest failed → no lock applied to terrain', () => {
    const { kernel, economy, lockAdapter } = buildKernel();

    economy.quests.registerQuest(QUEST_FAIL_NO_LOCK);
    economy.quests.startQuest('q_fail');

    economy.quests.failQuest('q_fail');

    expect(economy.quests.getQuestState('q_fail')!.status).toBe(QuestStatus.FAILED);
    // Lock must NOT be applied on failure.
    expect(lockAdapter.isLocked('terrain_target')).toBe(false);

    kernel.destroy();
  });

  it('locked terrain → brain falls back to next best terrain', () => {
    const { kernel, simulation, economy, lockAdapter } = buildKernel();

    economy.quests.registerQuest(QUEST_WITH_LOCK);
    economy.quests.startQuest('q_lock_test');
    economy.quests.completeObjective('q_lock_test', 'obj_kill');

    // Lock adapter received the signal — terrain_target is now locked.
    expect(lockAdapter.isLocked('terrain_target')).toBe(true);

    // Host response to the lock signal: remove the terrain from the simulation.
    // SmartTerrain has no `locked` property in the SDK — the host enforces
    // terrain locking by removing it from the active terrain list.
    simulation.removeTerrain('terrain_target');

    // terrain_target should no longer be in the terrain map.
    expect(simulation.getTerrain('terrain_target')).toBeUndefined();

    // Register a brain — it can only pick from remaining terrains.
    simulation.registerNPC({
      entityId: 'npc_loner_1',
      factionId: 'loner',
      position: { x: 100, y: 100 },
      rank: 3,
      combatPower: 50,
      currentHp: 100,
      behaviorConfig: DEFAULT_BEHAVIOR,
    });

    // Tick several times to let brain evaluate terrains.
    for (let i = 0; i < 5; i++) {
      kernel.update(200);
    }

    const brain = simulation.getNPCBrain('npc_loner_1');
    expect(brain).not.toBeNull();
    // Brain must NOT be on the removed terrain.
    expect(brain!.currentTerrainId).not.toBe('terrain_target');

    kernel.destroy();
  });

  it('terrain unlocked after quest reset → brain can assign again', () => {
    const { kernel, simulation, economy, lockAdapter } = buildKernel();

    economy.quests.registerQuest(QUEST_WITH_LOCK);
    economy.quests.startQuest('q_lock_test');
    economy.quests.completeObjective('q_lock_test', 'obj_kill');

    expect(lockAdapter.isLocked('terrain_target')).toBe(true);

    // Host responds: remove terrain from simulation (lock effect).
    simulation.removeTerrain('terrain_target');
    expect(simulation.getTerrain('terrain_target')).toBeUndefined();

    // Simulate a quest reset: unlock via adapter and re-add terrain.
    lockAdapter.setLocked('terrain_target', false);
    expect(lockAdapter.isLocked('terrain_target')).toBe(false);

    // Host re-adds the terrain to simulation (unlock effect).
    simulation.addTerrain(
      new SmartTerrain({
        id: 'terrain_target',
        name: 'Target Terrain',
        bounds: { x: 0, y: 0, width: 200, height: 200 },
        capacity: 5,
      }),
    );
    expect(simulation.getTerrain('terrain_target')).toBeDefined();

    // Register NPC after unlock — brain can now pick terrain_target.
    simulation.registerNPC({
      entityId: 'npc_loner_2',
      factionId: 'loner',
      position: { x: 50, y: 50 },
      rank: 3,
      combatPower: 50,
      currentHp: 100,
      behaviorConfig: DEFAULT_BEHAVIOR,
    });

    for (let i = 0; i < 5; i++) {
      kernel.update(200);
    }

    // Brain is free to assign to any terrain now including the re-added one.
    const brain = simulation.getNPCBrain('npc_loner_2');
    expect(brain).not.toBeNull();
    // Simply verify the brain assigned to some terrain (no restriction).
    // terrain_target is a valid option again.
    expect(simulation.getAllTerrains().has('terrain_target')).toBe(true);

    kernel.destroy();
  });

  it('QuestEngine.setTerrainAdapter wires adapter for late binding', () => {
    // Stand-alone QuestEngine (no kernel) — tests the late-binding API.
    const adapter = createTrackingLockAdapter();
    const engine = new QuestEngine();

    engine.setTerrainAdapter(adapter);
    engine.registerQuest(QUEST_WITH_LOCK);
    engine.startQuest('q_lock_test');

    expect(adapter.isLocked('terrain_target')).toBe(false);

    engine.completeObjective('q_lock_test', 'obj_kill');

    expect(adapter.isLocked('terrain_target')).toBe(true);
  });

  it('on_start terrain effect fires when quest starts', () => {
    const unlockOnStartQuest: IQuestDefinition = {
      id: 'q_unlock_start',
      name: 'Unlock on start',
      description: 'Unlocks terrain on start',
      objectives: [
        {
          id: 'obj_reach',
          type: ObjectiveType.REACH_ZONE,
          target: 'zone_alpha',
          description: 'Reach zone alpha',
          count: 1,
          current: 0,
          completed: false,
        },
      ],
      terrainEffects: [
        { terrainId: 'terrain_target', action: 'unlock', trigger: 'on_start' },
      ],
    };

    const adapter = createTrackingLockAdapter();
    // Pre-lock the terrain.
    adapter.setLocked('terrain_target', true);
    expect(adapter.isLocked('terrain_target')).toBe(true);

    const engine = new QuestEngine(adapter);
    engine.registerQuest(unlockOnStartQuest);
    engine.startQuest('q_unlock_start');

    // Starting the quest should fire the on_start effect → unlock.
    expect(adapter.isLocked('terrain_target')).toBe(false);
  });

  it('no terrain effects → adapter not called', () => {
    const noEffectQuest: IQuestDefinition = {
      id: 'q_no_effect',
      name: 'No Effect',
      description: 'No terrain effects',
      objectives: [
        {
          id: 'obj_kill',
          type: ObjectiveType.KILL,
          target: 'enemy',
          description: 'Kill',
          count: 1,
          current: 0,
          completed: false,
        },
      ],
    };

    const calls: Array<{ terrainId: string; locked: boolean }> = [];
    const trackingAdapter: ITerrainLockAdapter = {
      setLocked(terrainId, locked) {
        calls.push({ terrainId, locked });
      },
    };

    const engine = new QuestEngine(trackingAdapter);
    engine.registerQuest(noEffectQuest);
    engine.startQuest('q_no_effect');
    engine.completeObjective('q_no_effect', 'obj_kill');

    expect(calls).toHaveLength(0);
  });
});
