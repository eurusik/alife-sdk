/**
 * Integration test: "Surge disrupts campfire sessions".
 *
 * Exercises cross-package interaction between SurgeManager (alife-simulation)
 * and SocialPlugin (alife-social):
 *   1. NPCs in camp state → campfire active → bubbles emitted
 *   2. Surge WARNING → NPCs change state to flee → campfire dissolves
 *   3. Post-surge → NPCs return to camp → campfire reconstructs
 *
 * Uses a mutable INPCSocialProvider to simulate NPC state changes
 * triggered by surge events. All objects are REAL — zero mocks.
 */

import { describe, it, expect } from 'vitest';
import {
  ALifeKernel,
  ALifeEvents,
  FactionsPlugin,
  FactionBuilder,
  Ports,
  SmartTerrain,
} from '@alife-sdk/core';
import type { IRandom } from '@alife-sdk/core';

import { SimulationPlugin } from '../plugin/SimulationPlugin';
import { SimulationPorts } from '../ports/SimulationPorts';
import type { ISimulationBridge } from '../ports/ISimulationBridge';
import { SurgePhase } from '../surge/SurgePhase';

import { SocialPlugin, SocialPorts } from '@alife-sdk/social';
import type { ISocialPresenter, INPCSocialProvider, ISocialNPC, ISocialData } from '@alife-sdk/social';

function stubBridge(): ISimulationBridge {
  return {
    isAlive: () => true,
    applyDamage: () => false,
    getEffectiveDamage: (_id, raw) => raw,
    adjustMorale: () => {},
  };
}

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

const CAMPFIRE_TEXTS = [
  ...TEST_SOCIAL_DATA.campfire.stories,
  ...TEST_SOCIAL_DATA.campfire.jokes,
  ...TEST_SOCIAL_DATA.campfire.reactions.laughter,
  ...TEST_SOCIAL_DATA.campfire.reactions.story_react,
  ...TEST_SOCIAL_DATA.campfire.reactions.eating,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ISurgeSocialContext {
  kernel: ALifeKernel;
  simulation: SimulationPlugin;
  social: SocialPlugin;
  tracking: ReturnType<typeof createTrackingPresenter>;
  /** Mutable NPC list — modify to simulate state changes. */
  mutableNPCs: ISocialNPC[];
}

function buildKernel(): ISurgeSocialContext {
  const kernel = new ALifeKernel({ clock: { startHour: 12, timeFactor: 1 } });

  kernel.provide(Ports.Random, createCyclingRandom());

  const factionsPlugin = new FactionsPlugin();
  kernel.use(factionsPlugin);
  factionsPlugin.factions.register('loner',
    new FactionBuilder('loner').displayName('loner').build(),
  );

  const simulation = new SimulationPlugin({
    tickIntervalMs: 100,
    maxBrainUpdatesPerTick: 20,
    redundancyCleanupInterval: 3,
    simulation: {
      surge: {
        intervalMinMs: 1_000,
        intervalMaxMs: 1_000,
        warningDurationMs: 200,
        activeDurationMs: 500,
        aftermathDurationMs: 200,
        damagePerTick: 25,
        damageTickIntervalMs: 100,
        moralePenalty: -0.3,
        moraleRestore: 0.15,
      },
    },
  });
  kernel.use(simulation);
  kernel.provide(SimulationPorts.SimulationBridge, stubBridge());

  simulation.addTerrain(new SmartTerrain({
    id: 'terrain_shelter',
    name: 'Shelter',
    bounds: { x: 0, y: 0, width: 200, height: 200 },
    capacity: 10,
    isShelter: true,
  }));

  // Mutable NPC list for the social provider.
  const mutableNPCs: ISocialNPC[] = [
    { id: 'npc_a', position: { x: 100, y: 100 }, factionId: 'loner', state: 'camp' },
    { id: 'npc_b', position: { x: 105, y: 100 }, factionId: 'loner', state: 'camp' },
    { id: 'npc_c', position: { x: 110, y: 100 }, factionId: 'loner', state: 'camp' },
  ];

  const tracking = createTrackingPresenter();
  const provider: INPCSocialProvider = {
    getOnlineNPCs: () => mutableNPCs,
    areFactionsHostile: () => false,
    areFactionsFriendly: (a, b) => a === b,
    getNPCTerrainId: () => 'terrain_shelter',
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
        remarkCooldownMinMs: 5_000,
        remarkCooldownMaxMs: 10_000,
        remarkCheckIntervalMs: 5_000,
        remarkChance: 0,
        weightZone: 0.4,
        weightWeatherCumulative: 0.7,
      },
    },
  });
  kernel.use(social);

  kernel.init();
  kernel.start();

  return { kernel, simulation, social, tracking, mutableNPCs };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Surge → Social campfire disruption (integration)', () => {
  it('campfire active before surge — bubbles emitted', () => {
    const { kernel, social, tracking } = buildKernel();

    // Run social updates to trigger campfire sync + FSM progression.
    for (let i = 0; i < 30; i++) {
      social.update(150);
    }

    // Campfire should have produced at least one bubble.
    const campfireBubbles = tracking.bubbles.filter(b => CAMPFIRE_TEXTS.includes(b.text));
    expect(campfireBubbles.length).toBeGreaterThanOrEqual(1);

    kernel.destroy();
  });

  it('NPCs change state from camp to flee → campfire dissolves', () => {
    const { kernel, social, tracking, mutableNPCs } = buildKernel();

    // Phase 1: Establish campfire.
    for (let i = 0; i < 20; i++) {
      social.update(150);
    }

    const campfireBubblesBefore = tracking.bubbles.filter(b => CAMPFIRE_TEXTS.includes(b.text));
    expect(campfireBubblesBefore.length).toBeGreaterThanOrEqual(1);

    // Phase 2: Simulate surge — NPCs flee (change state).
    const countBeforeStateChange = tracking.bubbles.length;
    mutableNPCs[0] = { ...mutableNPCs[0]!, state: 'flee' };
    mutableNPCs[1] = { ...mutableNPCs[1]!, state: 'flee' };
    mutableNPCs[2] = { ...mutableNPCs[2]!, state: 'flee' };

    // Run social updates — campfire sync should remove session (0 camp NPCs < minParticipants).
    for (let i = 0; i < 10; i++) {
      social.update(150);
    }

    // No NEW campfire bubbles after state change.
    const newBubbles = tracking.bubbles.slice(countBeforeStateChange);
    const newCampfireBubbles = newBubbles.filter(b => CAMPFIRE_TEXTS.includes(b.text));
    expect(newCampfireBubbles).toHaveLength(0);

    kernel.destroy();
  });

  it('post-surge: NPCs return to camp → campfire reconstructs', () => {
    const { kernel, social, tracking, mutableNPCs } = buildKernel();

    // Phase 1: Campfire active.
    for (let i = 0; i < 20; i++) {
      social.update(150);
    }
    expect(tracking.bubbles.filter(b => CAMPFIRE_TEXTS.includes(b.text)).length).toBeGreaterThanOrEqual(1);

    // Phase 2: NPCs flee.
    mutableNPCs[0] = { ...mutableNPCs[0]!, state: 'flee' };
    mutableNPCs[1] = { ...mutableNPCs[1]!, state: 'flee' };
    mutableNPCs[2] = { ...mutableNPCs[2]!, state: 'flee' };
    for (let i = 0; i < 5; i++) {
      social.update(150);
    }

    // Phase 3: NPCs return to camp.
    const countBeforeReturn = tracking.bubbles.length;
    mutableNPCs[0] = { ...mutableNPCs[0]!, state: 'camp' };
    mutableNPCs[1] = { ...mutableNPCs[1]!, state: 'camp' };
    mutableNPCs[2] = { ...mutableNPCs[2]!, state: 'camp' };

    // Run enough updates for campfire to reconstruct and produce content.
    for (let i = 0; i < 30; i++) {
      social.update(150);
    }

    const newBubbles = tracking.bubbles.slice(countBeforeReturn);
    const newCampfireBubbles = newBubbles.filter(b => CAMPFIRE_TEXTS.includes(b.text));
    expect(newCampfireBubbles.length).toBeGreaterThanOrEqual(1);

    kernel.destroy();
  });

  it('surge phase propagates through kernel events', () => {
    const { kernel, simulation } = buildKernel();

    const surgeEvents: string[] = [];
    kernel.events.on(ALifeEvents.SURGE_WARNING, () => surgeEvents.push('warning'));
    kernel.events.on(ALifeEvents.SURGE_STARTED, () => surgeEvents.push('started'));
    kernel.events.on(ALifeEvents.SURGE_ENDED, () => surgeEvents.push('ended'));

    // Force surge.
    simulation.getSurgeManager().forceSurge();
    expect(simulation.getSurgeManager().getPhase()).toBe(SurgePhase.WARNING);

    // Tick through WARNING → ACTIVE → AFTERMATH → INACTIVE.
    // warningDurationMs=200, activeDurationMs=500, aftermathDurationMs=200
    for (let i = 0; i < 50; i++) {
      kernel.update(50);
    }

    // All surge phases should have been reached.
    expect(surgeEvents).toContain('warning');
    expect(surgeEvents).toContain('started');
    expect(surgeEvents).toContain('ended');

    kernel.destroy();
  });
});
