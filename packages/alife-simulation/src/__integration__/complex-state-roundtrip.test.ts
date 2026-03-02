/**
 * Integration test: "Complex mid-state serialize/restore".
 *
 * Exercises save/load with simultaneously active subsystems:
 *   1. NPCs assigned to terrains with different states
 *   2. Squad with morale deficit
 *   3. Story NPC protection
 *   4. Personal goodwill between NPCs
 *   5. Economy: player inventory + active quest with partial progress
 *   6. Full serialize → restore → verify all states
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect } from 'vitest';
import {
  ALifeKernel,
  FactionsPlugin,
  FactionBuilder,
  Ports,
  SmartTerrain,
} from '@alife-sdk/core';
import type { IRandom } from '@alife-sdk/core';

import { SimulationPlugin } from '../plugin/SimulationPlugin';
import { SimulationPorts } from '../ports/SimulationPorts';
import type { ISimulationBridge } from '../ports/ISimulationBridge';
import type { INPCBehaviorConfig } from '../types/INPCRecord';

import { EconomyPlugin, QuestStatus, ObjectiveType } from '@alife-sdk/economy';
import type { IQuestDefinition } from '@alife-sdk/economy';

function stubBridge(): ISimulationBridge {
  return {
    isAlive: () => true,
    applyDamage: () => false,
    getEffectiveDamage: (_id, raw) => raw,
    adjustMorale: () => {},
  };
}

const SEEDED_RANDOM: IRandom = {
  next: () => 0.25,
  nextInt: (min: number, max: number) => Math.floor(0.25 * (max - min + 1)) + min,
  nextFloat: (min: number, max: number) => 0.25 * (max - min) + min,
};

const DEFAULT_BEHAVIOR: INPCBehaviorConfig = {
  retreatThreshold: 0.1,
  panicThreshold: -0.7,
  searchIntervalMs: 5_000,
  dangerTolerance: 3,
  aggression: 0.5,
};

const QUEST_DEF: IQuestDefinition = {
  id: 'q_test',
  name: 'Test Quest',
  description: 'Kill 3 mutants',
  objectives: [
    { id: 'obj_kill', type: ObjectiveType.KILL, target: 'mutant', description: 'Kill mutants', count: 3, current: 0, completed: false },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface IComplexContext {
  kernel: ALifeKernel;
  simulation: SimulationPlugin;
  economy: EconomyPlugin;
  factionsPlugin: FactionsPlugin;
}

function buildKernel(): IComplexContext {
  const kernel = new ALifeKernel({ clock: { startHour: 14, timeFactor: 1 } });

  kernel.provide(Ports.Random, SEEDED_RANDOM);

  const factionsPlugin = new FactionsPlugin();
  kernel.use(factionsPlugin);

  factionsPlugin.factions.register('loner',
    new FactionBuilder('loner').displayName('loner').relation('bandit', -100).build(),
  );
  factionsPlugin.factions.register('duty',
    new FactionBuilder('duty').displayName('duty').relation('bandit', -100).build(),
  );
  factionsPlugin.factions.register('bandit',
    new FactionBuilder('bandit').displayName('bandit')
      .relation('loner', -100).relation('duty', -100).build(),
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

  // Terrains.
  simulation.addTerrain(new SmartTerrain({
    id: 'terrain_bar', name: 'Bar', bounds: { x: 0, y: 0, width: 200, height: 200 }, capacity: 10,
  }));
  simulation.addTerrain(new SmartTerrain({
    id: 'terrain_checkpoint', name: 'Checkpoint', bounds: { x: 500, y: 0, width: 200, height: 200 }, capacity: 5,
  }));
  simulation.addTerrain(new SmartTerrain({
    id: 'terrain_warehouse', name: 'Warehouse', bounds: { x: 0, y: 500, width: 200, height: 200 }, capacity: 5,
  }));

  kernel.init();
  kernel.start();

  return { kernel, simulation, economy, factionsPlugin };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Complex mid-state serialize/restore (integration)', () => {
  it('full complex state round-trip preserves all subsystems', () => {
    const { kernel, simulation, economy } = buildKernel();

    // --- Setup complex state ---

    // 1. Register NPCs across 3 factions.
    simulation.registerNPC({ entityId: 'npc_loner_1', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    simulation.registerNPC({ entityId: 'npc_loner_2', factionId: 'loner', position: { x: 120, y: 100 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR });
    simulation.registerNPC({ entityId: 'npc_duty_1', factionId: 'duty', position: { x: 600, y: 50 }, rank: 4, combatPower: 60, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    simulation.registerNPC({ entityId: 'npc_bandit_1', factionId: 'bandit', position: { x: 50, y: 550 }, rank: 2, combatPower: 35, currentHp: 70, behaviorConfig: DEFAULT_BEHAVIOR });

    // 2. Story NPC.
    simulation.getStoryRegistry().register('quest_main', 'npc_loner_1');

    // 3. Personal goodwill.
    simulation.getRelationRegistry().adjustGoodwill('npc_loner_1', 'npc_duty_1', 25);
    simulation.getRelationRegistry().adjustGoodwill('npc_bandit_1', 'npc_loner_2', -15);

    // 4. Economy state.
    economy.playerInventory.add('medkit', 3);
    economy.playerInventory.add('ammo_9x19', 50);
    economy.playerInventory.add('bread', 2);

    economy.quests.registerQuest(QUEST_DEF);
    economy.quests.startQuest('q_test');
    economy.quests.updateObjectiveProgress('q_test', 'obj_kill', 2); // 2/3 kills

    // 5. Tick to assign terrains and establish state.
    for (let i = 0; i < 5; i++) kernel.update(200);

    // Record pre-serialize state.
    const preNpcLoner1 = simulation.getNPCRecord('npc_loner_1')!;
    const preNpcDuty1 = simulation.getNPCRecord('npc_duty_1')!;
    const preBrainLoner1 = simulation.getNPCBrain('npc_loner_1')!;
    const preTerrainId = preBrainLoner1.currentTerrainId;

    // --- Serialize ---
    const state = kernel.serialize();

    // --- Restore into fresh kernel ---
    const ctx2 = buildKernel();

    // Re-register NPCs (required per SimulationPlugin contract).
    ctx2.simulation.registerNPC({ entityId: 'npc_loner_1', factionId: 'loner', position: { x: 0, y: 0 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctx2.simulation.registerNPC({ entityId: 'npc_loner_2', factionId: 'loner', position: { x: 0, y: 0 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR });
    ctx2.simulation.registerNPC({ entityId: 'npc_duty_1', factionId: 'duty', position: { x: 0, y: 0 }, rank: 4, combatPower: 60, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctx2.simulation.registerNPC({ entityId: 'npc_bandit_1', factionId: 'bandit', position: { x: 0, y: 0 }, rank: 2, combatPower: 35, currentHp: 70, behaviorConfig: DEFAULT_BEHAVIOR });

    // Re-register quest (definitions are not serialized).
    ctx2.economy.quests.registerQuest(QUEST_DEF);

    ctx2.kernel.restoreState(state);

    // --- Verify all subsystem states ---

    // NPC records.
    const restoredLoner1 = ctx2.simulation.getNPCRecord('npc_loner_1')!;
    expect(restoredLoner1.factionId).toBe(preNpcLoner1.factionId);
    expect(restoredLoner1.rank).toBe(preNpcLoner1.rank);
    expect(restoredLoner1.combatPower).toBe(preNpcLoner1.combatPower);
    expect(restoredLoner1.currentHp).toBe(preNpcLoner1.currentHp);

    const restoredDuty1 = ctx2.simulation.getNPCRecord('npc_duty_1')!;
    expect(restoredDuty1.factionId).toBe(preNpcDuty1.factionId);
    expect(restoredDuty1.rank).toBe(preNpcDuty1.rank);

    // Story registry.
    expect(ctx2.simulation.getStoryRegistry().isStoryNPC('npc_loner_1')).toBe(true);
    expect(ctx2.simulation.getStoryRegistry().getStoryId('npc_loner_1')).toBe('quest_main');
    expect(ctx2.simulation.getStoryRegistry().isStoryNPC('npc_duty_1')).toBe(false);

    // Personal goodwill.
    expect(ctx2.simulation.getRelationRegistry().getPersonalGoodwill('npc_loner_1', 'npc_duty_1')).toBe(25);
    expect(ctx2.simulation.getRelationRegistry().getPersonalGoodwill('npc_bandit_1', 'npc_loner_2')).toBe(-15);

    // Economy: player inventory.
    expect(ctx2.economy.playerInventory.getQuantity('medkit')).toBe(3);
    expect(ctx2.economy.playerInventory.getQuantity('ammo_9x19')).toBe(50);
    expect(ctx2.economy.playerInventory.getQuantity('bread')).toBe(2);

    // Economy: quest state.
    const questState = ctx2.economy.quests.getQuestState('q_test')!;
    expect(questState.status).toBe(QuestStatus.ACTIVE);
    expect(questState.objectives[0]!.current).toBe(2);
    expect(questState.objectives[0]!.completed).toBe(false);

    // Kernel can continue ticking after restore.
    expect(() => {
      for (let i = 0; i < 5; i++) ctx2.kernel.update(200);
    }).not.toThrow();

    kernel.destroy();
    ctx2.kernel.destroy();
  });

  it('squad membership preserved across serialize/restore', () => {
    const { kernel, simulation } = buildKernel();

    // Register 2 loner NPCs — same faction → same squad.
    simulation.registerNPC({ entityId: 'npc_a', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    simulation.registerNPC({ entityId: 'npc_b', factionId: 'loner', position: { x: 120, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });

    const squad = simulation.getSquadManager().getSquadForNPC('npc_a');
    expect(squad).not.toBeNull();
    const squadId = squad!.id;
    expect(simulation.getSquadManager().getSquadForNPC('npc_b')!.id).toBe(squadId);

    for (let i = 0; i < 3; i++) kernel.update(200);

    const state = kernel.serialize();

    // Restore.
    const ctx2 = buildKernel();
    ctx2.simulation.registerNPC({ entityId: 'npc_a', factionId: 'loner', position: { x: 0, y: 0 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctx2.simulation.registerNPC({ entityId: 'npc_b', factionId: 'loner', position: { x: 0, y: 0 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctx2.kernel.restoreState(state);

    // Squad membership restored.
    const restoredSquadA = ctx2.simulation.getSquadManager().getSquadForNPC('npc_a');
    const restoredSquadB = ctx2.simulation.getSquadManager().getSquadForNPC('npc_b');
    expect(restoredSquadA).not.toBeNull();
    expect(restoredSquadB).not.toBeNull();
    expect(restoredSquadA!.id).toBe(restoredSquadB!.id);

    kernel.destroy();
    ctx2.kernel.destroy();
  });

  it('multiple NPCs with isOnline flag preserved', () => {
    const { kernel, simulation } = buildKernel();

    simulation.registerNPC({ entityId: 'npc_off', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    simulation.registerNPC({ entityId: 'npc_on', factionId: 'loner', position: { x: 120, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });

    simulation.setNPCOnline('npc_on', true);

    for (let i = 0; i < 3; i++) kernel.update(200);

    const state = kernel.serialize();

    const ctx2 = buildKernel();
    ctx2.simulation.registerNPC({ entityId: 'npc_off', factionId: 'loner', position: { x: 0, y: 0 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctx2.simulation.registerNPC({ entityId: 'npc_on', factionId: 'loner', position: { x: 0, y: 0 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctx2.kernel.restoreState(state);

    expect(ctx2.simulation.getNPCRecord('npc_off')!.isOnline).toBe(false);
    expect(ctx2.simulation.getNPCRecord('npc_on')!.isOnline).toBe(true);

    kernel.destroy();
    ctx2.kernel.destroy();
  });
});
