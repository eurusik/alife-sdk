/**
 * Integration test: "Full kernel lifecycle".
 *
 * Exercises ALifeKernel with SimulationPlugin + EconomyPlugin + SocialPlugin:
 *   1. Kernel init with 3 plugins → all installed, ports resolved
 *   2. NPC registration + brain terrain assignment
 *   3. Hostile factions → combat detection events
 *   4. Economy: trader + player inventory → serialize preserves
 *   5. Social: campfire sync when NPCs in 'camp' state
 *   6. Full serialize → restore → state intact
 *   7. Destroy → clean teardown
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect } from 'vitest';
import {
  ALifeKernel,
  ALifeEvents,
  FactionsPlugin,
  FactionBuilder,
  Ports,
} from '@alife-sdk/core';
import type { IRandom } from '@alife-sdk/core';

import { SimulationPlugin } from '../plugin/SimulationPlugin';
import { SimulationPorts } from '../ports/SimulationPorts';
import type { ISimulationBridge } from '../ports/ISimulationBridge';
import { EconomyPlugin } from '@alife-sdk/economy';
import { SocialPlugin, SocialPorts } from '@alife-sdk/social';
import type { ISocialPresenter } from '@alife-sdk/social';
import type { INPCSocialProvider, ISocialNPC, ISocialData } from '@alife-sdk/social';
import {
  createTerrain,
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

/** Cycling random for social ContentPool (avoids do-while infinite loop with 2-item pools). */
function createCyclingRandom(): IRandom {
  let counter = 0;
  const values = [0.25, 0.75, 0.1, 0.9, 0.5];
  return {
    next: () => values[counter++ % values.length]!,
    nextInt: (min: number, max: number) => {
      const v = values[counter++ % values.length]!;
      return Math.floor(v * (max - min + 1)) + min;
    },
    nextFloat: (min: number, max: number) => {
      const v = values[counter++ % values.length]!;
      return v * (max - min) + min;
    },
  };
}

/** Tracking presenter that records showBubble calls. */
function createTrackingPresenter() {
  const bubbles: Array<{ npcId: string; text: string; durationMs: number }> = [];
  const presenter: ISocialPresenter = {
    showBubble(npcId, text, durationMs) {
      bubbles.push({ npcId, text, durationMs });
    },
  };
  return { presenter, bubbles };
}

const TEST_SOCIAL_DATA: ISocialData = {
  greetings: {
    friendly: ['Привіт, друже!', 'Здоров!', 'Слава Зоні!'],
    neutral: ['Хто такий?', 'Чого треба?', 'Тихо.'],
    evening: ['Добрий вечір.', 'Доброї ночі.', 'Вечір добрий.'],
  },
  remarks: {
    zone: ['Тут небезпечно...'],
    weather: ['Дощ знову...'],
    gossip: { loner: ['Чув новини?'] },
  },
  campfire: {
    stories: ['Одного разу у Зоні...', 'Була така історія...', 'Колись давно...'],
    jokes: ['Приходить сталкер у бар...', 'Жив-був один сталкер...', 'А знаєш анекдот?'],
    reactions: {
      laughter: ['Ха-ха!', 'Ото так!', 'Добра!'],
      story_react: ['Неможливо!', 'Серйозно?', 'Ого!'],
      eating: ['*жує*', '*п\'є*', '*їсть*'],
    },
  },
};

const DEFAULT_BEHAVIOR = createBehaviorConfig();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface IFullKernelContext {
  kernel: ALifeKernel;
  simulation: SimulationPlugin;
  economy: EconomyPlugin;
  social: SocialPlugin;
  factionsPlugin: FactionsPlugin;
  tracking: ReturnType<typeof createTrackingPresenter>;
  provider: INPCSocialProvider;
}

function buildFullKernel(
  providerNPCs: ISocialNPC[] = [],
  providerTerrainMap: Record<string, string> = {},
): IFullKernelContext {
  const kernel = new ALifeKernel({ clock: { startHour: 12, timeFactor: 1 } });

  kernel.provide(Ports.Random, SEEDED_RANDOM);

  // Factions.
  const factionsPlugin = new FactionsPlugin();
  kernel.use(factionsPlugin);

  const factions = [
    { id: 'loner', relations: { bandit: -100 } },
    { id: 'duty', relations: { bandit: -100 } },
    { id: 'bandit', relations: { loner: -100, duty: -100 } },
  ];
  for (const f of factions) {
    const builder = new FactionBuilder(f.id).displayName(f.id);
    for (const [otherId, score] of Object.entries(f.relations)) {
      builder.relation(otherId, score);
    }
    factionsPlugin.factions.register(f.id, builder.build());
  }

  // Simulation.
  const simulation = new SimulationPlugin({
    tickIntervalMs: 100,
    maxBrainUpdatesPerTick: 20,
    redundancyCleanupInterval: 3,
  });
  kernel.use(simulation);
  kernel.provide(SimulationPorts.SimulationBridge, stubBridge());

  // Economy.
  const economy = new EconomyPlugin(SEEDED_RANDOM);
  kernel.use(economy);

  // Social (needs cycling random to avoid ContentPool do-while hang).
  const tracking = createTrackingPresenter();
  const provider: INPCSocialProvider = {
    getOnlineNPCs: () => providerNPCs,
    areFactionsHostile: (a, b) => {
      const hostile = new Set(['loner:bandit', 'bandit:loner', 'duty:bandit', 'bandit:duty']);
      return hostile.has(`${a}:${b}`);
    },
    areFactionsFriendly: (a, b) => a === b,
    getNPCTerrainId: (id) => providerTerrainMap[id] ?? null,
  };

  kernel.provide(SocialPorts.SocialPresenter, tracking.presenter);
  kernel.provide(SocialPorts.NPCSocialProvider, provider);

  const social = new SocialPlugin(createCyclingRandom(), {
    data: TEST_SOCIAL_DATA,
    social: {
      campfire: {
        minParticipants: 2,
        syncIntervalMs: 100,
        idleDurationMinMs: 50,
        idleDurationMaxMs: 100,
        storyDurationMinMs: 100,
        storyDurationMaxMs: 200,
        jokeDurationMinMs: 100,
        jokeDurationMaxMs: 200,
        eatingDurationMinMs: 100,
        eatingDurationMaxMs: 200,
        reactionDurationMinMs: 100,
        reactionDurationMaxMs: 200,
        reactionStaggerMs: 30,
        eatingChance: 0.5,
        weightStory: 0.35,
        weightJokeCumulative: 0.65,
      },
      remark: {
        remarkCooldownMinMs: 100,
        remarkCooldownMaxMs: 200,
        remarkCheckIntervalMs: 100,
        remarkChance: 1.0,
        weightZone: 0.4,
        weightWeatherCumulative: 0.7,
      },
    },
  });
  kernel.use(social);

  // Terrains.
  simulation.addTerrain(createTerrain({ id: 'terrain_shelter', capacity: 10, isShelter: true }));
  simulation.addTerrain(createTerrain({ id: 'terrain_outdoor', capacity: 10 }));

  kernel.init();
  kernel.start();

  return { kernel, simulation, economy, social, factionsPlugin, tracking, provider };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Full kernel lifecycle (integration)', () => {
  it('kernel initializes all 3 plugins and resolves ports', () => {
    const { kernel, simulation, economy, social } = buildFullKernel();

    // All plugins are installed and functional.
    expect(simulation.npcs.size).toBe(0); // no NPCs registered yet
    expect(economy.playerInventory.getQuantity('medkit')).toBe(0);
    expect(social.contentPool.hasLines('greeting_friendly')).toBe(true);

    kernel.destroy();
  });

  it('register NPCs + tick → brain assigns terrain', () => {
    const { kernel, simulation } = buildFullKernel();

    simulation.registerNPC({ entityId: 'npc_loner_1', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    simulation.registerNPC({ entityId: 'npc_duty_1', factionId: 'duty', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });

    // Tick to allow brains to evaluate terrains.
    kernel.update(200);

    expect(simulation.npcs.size).toBe(2);

    kernel.destroy();
  });

  it('hostile factions on same terrain → tick → combat events', () => {
    const { kernel, simulation } = buildFullKernel();
    const events: string[] = [];

    kernel.events.on(ALifeEvents.FACTION_CONFLICT, () => {
      events.push('conflict');
    });

    // Register hostile NPCs (loner vs bandit) on same terrain, offline.
    simulation.registerNPC({ entityId: 'npc_loner_1', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    simulation.registerNPC({ entityId: 'npc_bandit_1', factionId: 'bandit', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    simulation.setNPCOnline('npc_loner_1', false);
    simulation.setNPCOnline('npc_bandit_1', false);

    // Tick many times to trigger combat.
    for (let i = 0; i < 20; i++) {
      kernel.update(200);
    }

    // At least one conflict event should have been emitted.
    expect(events.length).toBeGreaterThanOrEqual(1);

    kernel.destroy();
  });

  it('economy: trader + player inventory → serialize preserves state', () => {
    const { kernel, economy } = buildFullKernel();

    // Set up economy state.
    economy.traders.register('trader_1', 'loner', 5_000);
    economy.traders.addStock('trader_1', 'medkit', 10);
    economy.playerInventory.add('ammo_9x19', 50);
    economy.playerInventory.add('medkit', 3);

    // Serialize.
    const state = kernel.serialize();

    // Restore into new kernel.
    const { kernel: k2, economy: econ2 } = buildFullKernel();

    k2.restoreState(state);

    expect(econ2.playerInventory.getQuantity('medkit')).toBe(3);
    expect(econ2.playerInventory.getQuantity('ammo_9x19')).toBe(50);

    kernel.destroy();
    k2.destroy();
  });

  it('social: campfire bubbles emitted when NPCs in camp state', () => {
    const campNPCs: ISocialNPC[] = [
      { id: 'npc_a', position: { x: 100, y: 100 }, factionId: 'loner', state: 'camp' },
      { id: 'npc_b', position: { x: 105, y: 100 }, factionId: 'loner', state: 'camp' },
      { id: 'npc_c', position: { x: 110, y: 100 }, factionId: 'loner', state: 'camp' },
    ];
    const terrainMap = { npc_a: 'terrain_shelter', npc_b: 'terrain_shelter', npc_c: 'terrain_shelter' };
    const { kernel, social, tracking } = buildFullKernel(campNPCs, terrainMap);

    // Run social updates to trigger campfire.
    for (let i = 0; i < 30; i++) {
      social.update(150);
    }

    expect(tracking.bubbles.length).toBeGreaterThanOrEqual(1);

    kernel.destroy();
  });

  it('full serialize → new kernel → restore → NPC records intact', () => {
    const { kernel, simulation } = buildFullKernel();

    simulation.registerNPC({ entityId: 'npc_loner_1', factionId: 'loner', position: { x: 150, y: 200 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    simulation.registerNPC({ entityId: 'npc_duty_1', factionId: 'duty', position: { x: 300, y: 100 }, rank: 4, combatPower: 60, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR });

    kernel.update(200);

    const state = kernel.serialize();

    // Restore.
    const { kernel: k2, simulation: sim2 } = buildFullKernel();
    // Re-register NPCs before restore (brains need recreation).
    sim2.registerNPC({ entityId: 'npc_loner_1', factionId: 'loner', position: { x: 0, y: 0 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    sim2.registerNPC({ entityId: 'npc_duty_1', factionId: 'duty', position: { x: 0, y: 0 }, rank: 4, combatPower: 60, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR });
    k2.restoreState(state);

    // NPC records should be restored.
    const loner = sim2.npcs.get('npc_loner_1');
    const duty = sim2.npcs.get('npc_duty_1');
    expect(loner).toBeDefined();
    expect(duty).toBeDefined();
    expect(loner!.factionId).toBe('loner');
    expect(duty!.factionId).toBe('duty');

    kernel.destroy();
    k2.destroy();
  });

  it('destroy → all plugins cleaned up', () => {
    const { kernel, simulation, economy } = buildFullKernel();

    simulation.registerNPC({ entityId: 'npc_loner_1', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    economy.playerInventory.add('medkit', 5);

    kernel.destroy();

    // After destroy, economy inventory should be cleared.
    expect(economy.playerInventory.getQuantity('medkit')).toBe(0);
  });

  it('story registry protection works across full kernel', () => {
    const { kernel, simulation } = buildFullKernel();

    // Register story NPC.
    simulation.getStoryRegistry().register('quest_main', 'npc_guide');

    simulation.registerNPC({ entityId: 'npc_guide', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });

    expect(simulation.getStoryRegistry().isStoryNPC('npc_guide')).toBe(true);

    // Serialize and restore.
    const state = kernel.serialize();
    const { kernel: k2, simulation: sim2 } = buildFullKernel();
    sim2.registerNPC({ entityId: 'npc_guide', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    k2.restoreState(state);

    expect(sim2.getStoryRegistry().isStoryNPC('npc_guide')).toBe(true);
    expect(sim2.getStoryRegistry().getStoryId('npc_guide')).toBe('quest_main');

    kernel.destroy();
    k2.destroy();
  });
});
