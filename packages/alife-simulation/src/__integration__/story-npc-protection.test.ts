/**
 * Integration test: "Story NPC protection".
 *
 * Exercises StoryRegistry integration with offline combat and redundancy cleanup:
 *   1. Story NPCs are immune to offline combat damage exchanges
 *   2. Story NPCs survive redundancy cleanup even when dead
 *   3. Unregistering removes protection
 *   4. Serialize/restore preserves story entries
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect } from 'vitest';
import {
  ALifeKernel,
  FactionsPlugin,
  FactionBuilder,
  Ports,
} from '@alife-sdk/core';

import { SimulationPlugin } from '../plugin/SimulationPlugin';
import { SimulationPorts } from '../ports/SimulationPorts';
import type { ISimulationBridge } from '../ports/ISimulationBridge';
import {
  createTerrain,
  createBehaviorConfig,
  SEEDED_RANDOM,
} from './helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_BEHAVIOR = createBehaviorConfig();

interface IKernelContext {
  kernel: ALifeKernel;
  plugin: SimulationPlugin;
}

function buildKernel(
  bridge: ISimulationBridge,
): IKernelContext {
  const kernel = new ALifeKernel({ clock: { startHour: 12, timeFactor: 1 } });

  kernel.provide(Ports.Random, SEEDED_RANDOM);
  kernel.provide(SimulationPorts.SimulationBridge, bridge);

  const factionsPlugin = new FactionsPlugin();
  kernel.use(factionsPlugin);

  // Hostile factions.
  const loner = new FactionBuilder('loner').displayName('Loner').relation('bandit', -100).build();
  const bandit = new FactionBuilder('bandit').displayName('Bandit').relation('loner', -100).build();
  factionsPlugin.factions.register('loner', loner);
  factionsPlugin.factions.register('bandit', bandit);

  const plugin = new SimulationPlugin({
    tickIntervalMs: 100,
    maxBrainUpdatesPerTick: 20,
    redundancyCleanupInterval: 1, // every tick
    simulation: {
      offlineCombat: {
        detectionProbability: 100, // always detect
        maxResolutionsPerTick: 10,
      },
    },
  });
  kernel.use(plugin);

  // Shared terrain.
  const terrain = createTerrain({ id: 'terrain_bar', capacity: 10 });
  plugin.addTerrain(terrain);

  kernel.init();
  kernel.start();

  return { kernel, plugin };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Story NPC protection (integration)', () => {
  it('isStoryNPC returns true after registration', () => {
    const bridge: ISimulationBridge = {
      isAlive: () => true,
      applyDamage: () => false,
      getEffectiveDamage: (_, raw) => raw,
      adjustMorale: () => {},
    };
    const { kernel, plugin } = buildKernel(bridge);
    const storyRegistry = plugin.getStoryRegistry();

    storyRegistry.register('quest_main', 'npc_guide');
    expect(storyRegistry.isStoryNPC('npc_guide')).toBe(true);
    expect(storyRegistry.getStoryId('npc_guide')).toBe('quest_main');

    kernel.destroy();
  });

  it('story NPC survives offline combat — exchange skipped', () => {
    const damageCalls: string[] = [];
    const bridge: ISimulationBridge = {
      isAlive: () => true,
      applyDamage: (entityId) => {
        damageCalls.push(entityId);
        return true; // fatal if damage applied
      },
      getEffectiveDamage: (_, raw) => raw,
      adjustMorale: () => {},
    };
    const { kernel, plugin } = buildKernel(bridge);

    // Register story NPC.
    plugin.getStoryRegistry().register('quest_main', 'npc_guide');

    // Register hostile NPCs on same terrain.
    plugin.registerNPC({ entityId: 'npc_guide', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    plugin.registerNPC({ entityId: 'npc_bandit_1', factionId: 'bandit', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    plugin.setNPCOnline('npc_guide', false);
    plugin.setNPCOnline('npc_bandit_1', false);

    // Tick several times to trigger combat.
    for (let i = 0; i < 10; i++) {
      kernel.update(200);
    }

    // Story NPC should still be alive (combat exchange skipped).
    const guideRecord = plugin.npcs.get('npc_guide');
    expect(guideRecord!.currentHp).toBe(100);

    kernel.destroy();
  });

  it('non-story NPC can be killed in offline combat', () => {
    const bridge: ISimulationBridge = {
      isAlive: (_id) => {
        // Only used for checking during combat
        return true;
      },
      applyDamage: () => false,
      getEffectiveDamage: (_, raw) => raw,
      adjustMorale: () => {},
    };
    const { kernel, plugin } = buildKernel(bridge);

    // Two hostile NPCs, no story protection.
    plugin.registerNPC({ entityId: 'npc_loner_1', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 100, currentHp: 50, behaviorConfig: DEFAULT_BEHAVIOR });
    plugin.registerNPC({ entityId: 'npc_bandit_1', factionId: 'bandit', position: { x: 100, y: 100 }, rank: 3, combatPower: 100, currentHp: 50, behaviorConfig: DEFAULT_BEHAVIOR });
    plugin.setNPCOnline('npc_loner_1', false);
    plugin.setNPCOnline('npc_bandit_1', false);

    // Tick until at least one dies.
    for (let i = 0; i < 50; i++) {
      kernel.update(200);
    }

    const loner = plugin.npcs.get('npc_loner_1');
    const bandit = plugin.npcs.get('npc_bandit_1');

    // At least one should have taken damage (HP < initial).
    const lonerDamaged = !loner || loner.currentHp < 50;
    const banditDamaged = !bandit || bandit.currentHp < 50;
    expect(lonerDamaged || banditDamaged).toBe(true);

    kernel.destroy();
  });

  it('redundancy cleanup removes dead non-story NPC', () => {
    const bridge: ISimulationBridge = {
      isAlive: () => true,
      applyDamage: () => false,
      getEffectiveDamage: (_, raw) => raw,
      adjustMorale: () => {},
    };
    const { kernel, plugin } = buildKernel(bridge);

    plugin.registerNPC({ entityId: 'npc_dead', factionId: 'loner', position: { x: 100, y: 100 }, rank: 2, combatPower: 50, currentHp: 0, behaviorConfig: DEFAULT_BEHAVIOR });
    plugin.setNPCOnline('npc_dead', false);

    expect(plugin.npcs.has('npc_dead')).toBe(true);

    // Tick to trigger cleanup (redundancyCleanupInterval=1).
    for (let i = 0; i < 5; i++) {
      kernel.update(200);
    }

    expect(plugin.npcs.has('npc_dead')).toBe(false);

    kernel.destroy();
  });

  it('redundancy cleanup does NOT remove dead story NPC', () => {
    const bridge: ISimulationBridge = {
      isAlive: () => true,
      applyDamage: () => false,
      getEffectiveDamage: (_, raw) => raw,
      adjustMorale: () => {},
    };
    const { kernel, plugin } = buildKernel(bridge);

    plugin.getStoryRegistry().register('quest_main', 'npc_guide');

    plugin.registerNPC({ entityId: 'npc_guide', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 0, behaviorConfig: DEFAULT_BEHAVIOR });
    plugin.setNPCOnline('npc_guide', false);

    // Tick multiple times to trigger cleanup.
    for (let i = 0; i < 10; i++) {
      kernel.update(200);
    }

    // Dead story NPC should still be in the registry — NOT cleaned up.
    expect(plugin.npcs.has('npc_guide')).toBe(true);

    kernel.destroy();
  });

  it('serialize/restore preserves story registry entries', () => {
    const bridge: ISimulationBridge = {
      isAlive: () => true,
      applyDamage: () => false,
      getEffectiveDamage: (_, raw) => raw,
      adjustMorale: () => {},
    };
    const { kernel, plugin } = buildKernel(bridge);

    plugin.getStoryRegistry().register('quest_main', 'npc_guide');
    plugin.getStoryRegistry().register('quest_side', 'npc_trader');

    plugin.registerNPC({ entityId: 'npc_guide', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });

    const state = kernel.serialize();

    // Restore into a new kernel.
    const { kernel: k2, plugin: p2 } = buildKernel(bridge);
    p2.registerNPC({ entityId: 'npc_guide', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    k2.restoreState(state);

    expect(p2.getStoryRegistry().isStoryNPC('npc_guide')).toBe(true);
    expect(p2.getStoryRegistry().getStoryId('npc_guide')).toBe('quest_main');
    expect(p2.getStoryRegistry().isStoryNPC('npc_trader')).toBe(true);

    kernel.destroy();
    k2.destroy();
  });

  it('unregistered story NPC loses protection', () => {
    const bridge: ISimulationBridge = {
      isAlive: () => true,
      applyDamage: () => false,
      getEffectiveDamage: (_, raw) => raw,
      adjustMorale: () => {},
    };
    const { kernel, plugin } = buildKernel(bridge);

    // Register then unregister.
    plugin.getStoryRegistry().register('quest_main', 'npc_guide');
    expect(plugin.getStoryRegistry().isStoryNPC('npc_guide')).toBe(true);

    plugin.getStoryRegistry().unregister('quest_main');
    expect(plugin.getStoryRegistry().isStoryNPC('npc_guide')).toBe(false);

    kernel.destroy();
  });
});
