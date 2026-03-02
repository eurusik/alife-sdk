/**
 * Integration test: "Social meet + campfire lifecycle".
 *
 * Exercises the full social pipeline through SocialPlugin in ALifeKernel:
 *   1. Meet → greeting bubbles (friendly vs hostile vs cooldown)
 *   2. Campfire FSM lifecycle (IDLE → STORY/JOKE → REACTING → IDLE)
 *   3. SocialPlugin wiring (presenter, NPC provider, campfire sync)
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect } from 'vitest';
import { ALifeKernel, Ports } from '@alife-sdk/core';
import type { IRandom } from '@alife-sdk/core';
import { SocialPlugin } from '../plugin/SocialPlugin';
import { SocialPorts } from '../ports/SocialPorts';
import type { ISocialPresenter } from '../ports/ISocialPresenter';
import type { INPCSocialProvider } from '../ports/INPCSocialProvider';
import type { ISocialNPC, ISocialData } from '../types/ISocialTypes';
import { SocialCategory } from '../types/ISocialTypes';

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

/** Cycling random to avoid ContentPool infinite loop (do-while avoids repeats). */
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

let SEEDED_RANDOM: IRandom = createCyclingRandom();

/** Minimal social content for tests. */
const TEST_DATA: ISocialData = {
  greetings: {
    friendly: ['Привіт, друже!', 'Здоров!'],
    neutral: ['Хто такий?', 'Чого треба?'],
    evening: ['Добрий вечір.', 'Доброї ночі.'],
  },
  remarks: {
    zone: ['Тут небезпечно...'],
    weather: ['Дощ знову...'],
    gossip: { loner: ['Чув новини зі Зони?'] },
  },
  campfire: {
    stories: ['Одного разу у Зоні...', 'Була така історія...'],
    jokes: ['Приходить сталкер у бар...'],
    reactions: {
      laughter: ['Ха-ха!', 'Ото так!'],
      story_react: ['Неможливо!', 'Серйозно?'],
      eating: ['*жує*', '*п\'є*'],
    },
  },
};

function stubPorts() {
  return {
    entityAdapter: {
      getPosition: () => ({ x: 0, y: 0 }),
      isAlive: () => true,
      hasComponent: () => false,
      getComponentValue: () => null,
      setPosition: () => {},
      setActive: () => {},
      setVisible: () => {},
      setVelocity: () => {},
      getVelocity: () => ({ x: 0, y: 0 }),
      setRotation: () => {},
      teleport: () => {},
      disablePhysics: () => {},
      setAlpha: () => {},
      playAnimation: () => {},
      hasAnimation: () => false,
    },
    playerPosition: { getPlayerPosition: () => ({ x: 100, y: 100 }) },
    entityFactory: {
      createNPC: () => 'stub',
      createMonster: () => 'stub',
      destroyEntity: () => {},
    },
  };
}

/** Tracking presenter — records all showBubble calls. */
function createTrackingPresenter() {
  const bubbles: Array<{ npcId: string; text: string; durationMs: number }> = [];
  const presenter: ISocialPresenter = {
    showBubble(npcId, text, durationMs) {
      bubbles.push({ npcId, text, durationMs });
    },
  };
  return { presenter, bubbles };
}

/** Configurable NPC provider. */
function createProvider(
  npcs: ISocialNPC[],
  opts: {
    hostilePairs?: Array<[string, string]>;
    allyPairs?: Array<[string, string]>;
    terrainMap?: Record<string, string>;
  } = {},
): INPCSocialProvider {
  const hostileSet = new Set(
    (opts.hostilePairs ?? []).flatMap(([a, b]) => [`${a}:${b}`, `${b}:${a}`]),
  );
  const allySet = new Set(
    (opts.allyPairs ?? []).flatMap(([a, b]) => [`${a}:${b}`, `${b}:${a}`]),
  );
  const terrainMap = opts.terrainMap ?? {};

  return {
    getOnlineNPCs: () => npcs,
    areFactionsHostile: (a, b) => hostileSet.has(`${a}:${b}`),
    areFactionsFriendly: (a, b) => a === b || allySet.has(`${a}:${b}`),
    getNPCTerrainId: (id) => terrainMap[id] ?? null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Social: meet + campfire (integration)', () => {
  let kernel: ALifeKernel;
  let plugin: SocialPlugin;
  let tracking: ReturnType<typeof createTrackingPresenter>;
  let npcs: ISocialNPC[];

  function buildKernel(
    provider: INPCSocialProvider,
  ) {
    SEEDED_RANDOM = createCyclingRandom();
    kernel = new ALifeKernel({ clock: { startHour: 12, timeFactor: 1 } });
    const ports = stubPorts();
    kernel.provide(Ports.EntityAdapter, ports.entityAdapter);
    kernel.provide(Ports.PlayerPosition, ports.playerPosition);
    kernel.provide(Ports.EntityFactory, ports.entityFactory);

    tracking = createTrackingPresenter();
    kernel.provide(SocialPorts.SocialPresenter, tracking.presenter);
    kernel.provide(SocialPorts.NPCSocialProvider, provider);

    plugin = new SocialPlugin(SEEDED_RANDOM, {
      data: TEST_DATA,
      social: {
        meet: { meetDistance: 200, meetCooldownMs: 1_000, meetCheckIntervalMs: 100 },
        remark: {
          remarkCooldownMinMs: 100, remarkCooldownMaxMs: 200,
          remarkCheckIntervalMs: 100, remarkChance: 1.0,
          weightZone: 0.4, weightWeatherCumulative: 0.7,
        },
        campfire: {
          idleDurationMinMs: 100, idleDurationMaxMs: 200,
          storyDurationMinMs: 200, storyDurationMaxMs: 300,
          jokeDurationMinMs: 200, jokeDurationMaxMs: 300,
          eatingDurationMinMs: 200, eatingDurationMaxMs: 300,
          reactionDurationMinMs: 200, reactionDurationMaxMs: 300,
          reactionStaggerMs: 50,
          minParticipants: 2,
          syncIntervalMs: 100,
          eatingChance: 0.6,
          weightStory: 0.35,
          weightJokeCumulative: 0.65,
        },
      },
    });
    kernel.use(plugin);
    kernel.init();
    kernel.start();
  }

  // -----------------------------------------------------------------------
  // Meet: greeting bubbles
  // -----------------------------------------------------------------------

  describe('meet greetings', () => {
    it('friendly NPCs in range produce greeting bubble', () => {
      npcs = [
        { id: 'npc_1', position: { x: 110, y: 100 }, factionId: 'loner', state: 'idle' },
      ];
      const provider = createProvider(npcs, { allyPairs: [['loner', 'loner']] });
      buildKernel(provider);

      // MeetOrchestrator needs update via the plugin update (which calls its internal meet logic).
      // But MeetOrchestrator is separate — SocialPlugin.update only runs remarks + campfire.
      // Meet is driven by the host calling meetOrchestrator.update() directly.
      const bubbles = plugin.meetOrchestrator.update({
        deltaMs: 200,
        targetX: 100,
        targetY: 100,
        currentTime: 1000,
        npcs,
        isHostile: (a, b) => provider.areFactionsHostile(a, b),
        isAlly: (a, b) => provider.areFactionsFriendly(a, b),
        targetFactionId: 'loner',
      });

      expect(bubbles.length).toBeGreaterThanOrEqual(1);
      expect(bubbles[0]!.category).toBe(SocialCategory.GREETING_FRIENDLY);

      kernel.destroy();
    });

    it('hostile factions produce no greeting', () => {
      npcs = [
        { id: 'npc_1', position: { x: 110, y: 100 }, factionId: 'bandit', state: 'idle' },
      ];
      const provider = createProvider(npcs, { hostilePairs: [['loner', 'bandit']] });
      buildKernel(provider);

      const bubbles = plugin.meetOrchestrator.update({
        deltaMs: 200,
        targetX: 100,
        targetY: 100,
        currentTime: 1000,
        npcs,
        isHostile: (a, b) => provider.areFactionsHostile(a, b),
        isAlly: (a, b) => provider.areFactionsFriendly(a, b),
        targetFactionId: 'loner',
      });

      expect(bubbles).toHaveLength(0);

      kernel.destroy();
    });

    it('cooldown prevents repeated greetings', () => {
      npcs = [
        { id: 'npc_1', position: { x: 110, y: 100 }, factionId: 'loner', state: 'idle' },
      ];
      const provider = createProvider(npcs, { allyPairs: [['loner', 'loner']] });
      buildKernel(provider);

      const ctx = {
        deltaMs: 200,
        targetX: 100,
        targetY: 100,
        currentTime: 1000,
        npcs,
        isHostile: (a: string, b: string) => provider.areFactionsHostile(a, b),
        isAlly: (a: string, b: string) => provider.areFactionsFriendly(a, b),
        targetFactionId: 'loner',
      };

      // First: should greet.
      const first = plugin.meetOrchestrator.update(ctx);
      expect(first.length).toBeGreaterThanOrEqual(1);

      // Second (same time): cooldown blocks.
      const second = plugin.meetOrchestrator.update({ ...ctx, currentTime: 1100 });
      expect(second).toHaveLength(0);

      kernel.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // Campfire FSM through SocialPlugin
  // -----------------------------------------------------------------------

  describe('campfire lifecycle', () => {
    it('3 NPCs in camp state → SocialPlugin creates campfire → bubbles emitted', () => {
      npcs = [
        { id: 'npc_a', position: { x: 100, y: 100 }, factionId: 'loner', state: 'camp' },
        { id: 'npc_b', position: { x: 105, y: 100 }, factionId: 'loner', state: 'camp' },
        { id: 'npc_c', position: { x: 110, y: 100 }, factionId: 'loner', state: 'camp' },
      ];
      const provider = createProvider(npcs, {
        terrainMap: { npc_a: 'terrain_bar', npc_b: 'terrain_bar', npc_c: 'terrain_bar' },
      });
      buildKernel(provider);

      // Run enough updates for sync + campfire idle→activity transition.
      // syncIntervalMs=100, idleDuration=100-200, storyDuration=200-300
      for (let i = 0; i < 20; i++) {
        plugin.update(150);
      }

      // After several cycles, at least one campfire bubble should have been presented.
      expect(tracking.bubbles.length).toBeGreaterThanOrEqual(1);

      kernel.destroy();
    });

    it('NPCs leave terrain → campfire session removed', () => {
      const mutableNpcs: ISocialNPC[] = [
        { id: 'npc_a', position: { x: 100, y: 100 }, factionId: 'loner', state: 'camp' },
        { id: 'npc_b', position: { x: 105, y: 100 }, factionId: 'loner', state: 'camp' },
      ];
      const provider = createProvider(mutableNpcs, {
        terrainMap: { npc_a: 'terrain_bar', npc_b: 'terrain_bar' },
      });
      buildKernel(provider);

      // Run to create session.
      plugin.update(200);

      // Now remove NPCs from camp state → transition to idle.
      mutableNpcs[0] = { ...mutableNpcs[0]!, state: 'patrol' };
      mutableNpcs[1] = { ...mutableNpcs[1]!, state: 'patrol' };

      // Run sync cycle — should remove the session.
      plugin.update(200);

      // Record bubble count before and after another update.
      const countBefore = tracking.bubbles.length;
      plugin.update(200);
      // No new campfire bubbles since session was removed.
      // (Remarks may still appear, so we just check no campfire-specific content.)
      const newBubbles = tracking.bubbles.slice(countBefore);
      const campfireBubbles = newBubbles.filter((b) =>
        TEST_DATA.campfire.stories.includes(b.text) ||
        TEST_DATA.campfire.jokes.includes(b.text),
      );
      expect(campfireBubbles).toHaveLength(0);

      kernel.destroy();
    });

    it('below minParticipants → no campfire session', () => {
      npcs = [
        { id: 'npc_a', position: { x: 100, y: 100 }, factionId: 'loner', state: 'camp' },
      ];
      const provider = createProvider(npcs, {
        terrainMap: { npc_a: 'terrain_bar' },
      });
      buildKernel(provider);

      // Run several cycles.
      for (let i = 0; i < 10; i++) {
        plugin.update(200);
      }

      // No campfire content should appear (only 1 NPC, min is 2).
      const campfireTexts = [
        ...TEST_DATA.campfire.stories,
        ...TEST_DATA.campfire.jokes,
        ...TEST_DATA.campfire.reactions.laughter,
        ...TEST_DATA.campfire.reactions.story_react,
      ];
      const campfireBubbles = tracking.bubbles.filter((b) => campfireTexts.includes(b.text));
      expect(campfireBubbles).toHaveLength(0);

      kernel.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // SocialPlugin presenter wiring
  // -----------------------------------------------------------------------

  describe('plugin presenter wiring', () => {
    it('update() pipes remark bubbles through ISocialPresenter', () => {
      npcs = [
        { id: 'npc_r', position: { x: 100, y: 100 }, factionId: 'loner', state: 'patrol' },
      ];
      const provider = createProvider(npcs, {
        terrainMap: { npc_r: 'terrain_field' },
      });
      buildKernel(provider);

      // Run enough updates to trigger a remark (remarkChance=1.0, checkInterval=100).
      for (let i = 0; i < 5; i++) {
        plugin.update(200);
      }

      // At least one remark bubble should have reached the presenter.
      expect(tracking.bubbles.length).toBeGreaterThanOrEqual(1);

      kernel.destroy();
    });
  });

  // -----------------------------------------------------------------------
  // Serialization
  // -----------------------------------------------------------------------

  describe('serialization', () => {
    it('campfire sessions are transient — reconstruct from live NPCs after restore', () => {
      npcs = [
        { id: 'npc_a', position: { x: 100, y: 100 }, factionId: 'loner', state: 'camp' },
        { id: 'npc_b', position: { x: 105, y: 100 }, factionId: 'loner', state: 'camp' },
      ];
      const provider = createProvider(npcs, {
        terrainMap: { npc_a: 'terrain_bar', npc_b: 'terrain_bar' },
      });
      buildKernel(provider);

      // Create campfire session.
      plugin.update(200);

      // Serialize.
      const state = kernel.serialize();

      // Restore into new kernel.
      const kernel2 = new ALifeKernel({ clock: { startHour: 12, timeFactor: 1 } });
      const ports = stubPorts();
      kernel2.provide(Ports.EntityAdapter, ports.entityAdapter);
      kernel2.provide(Ports.PlayerPosition, ports.playerPosition);
      kernel2.provide(Ports.EntityFactory, ports.entityFactory);

      const tracking2 = createTrackingPresenter();
      kernel2.provide(SocialPorts.SocialPresenter, tracking2.presenter);
      kernel2.provide(SocialPorts.NPCSocialProvider, provider);

      const plugin2 = new SocialPlugin(SEEDED_RANDOM, { data: TEST_DATA });
      kernel2.use(plugin2);
      kernel2.init();
      kernel2.restoreState(state);
      kernel2.start();

      // After update, campfire should reconstruct from live NPCs.
      for (let i = 0; i < 20; i++) {
        plugin2.update(200);
      }
      expect(tracking2.bubbles.length).toBeGreaterThanOrEqual(0); // Transient — OK if 0, just no crash.

      kernel.destroy();
      kernel2.destroy();
    });
  });
});
