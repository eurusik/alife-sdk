import { describe, it, expect, vi } from 'vitest';
import { PortRegistry } from '@alife-sdk/core';
import { SocialPlugin, createDefaultSocialPluginConfig } from './SocialPlugin';
import { SocialPorts } from '../ports/SocialPorts';
import { type ISocialNPC, type ISocialData } from '../types/ISocialTypes';
import type { ISocialPresenter } from '../ports/ISocialPresenter';
import type { INPCSocialProvider } from '../ports/INPCSocialProvider';
import { createDefaultSocialConfig } from '../types/ISocialConfig';
import type { IGatheringFSM } from '../campfire/IGatheringFSM';
import type { IBubbleRequest } from '../types/ISocialTypes';

function makeRandom(values: number[] = [0.1]) {
  let idx = 0;
  return {
    next: () => values[idx++ % values.length],
    nextInt: (min: number, max: number) => min + Math.floor(values[idx++ % values.length] * (max - min + 1)),
    nextFloat: (min: number, max: number) => min + values[idx++ % values.length] * (max - min),
  };
}

function makeNPC(id: string, state: string, terrainId: string | null = 'terrain_1'): ISocialNPC & { _terrainId: string | null } {
  return {
    id,
    position: { x: 0, y: 0 },
    factionId: 'loner',
    state,
    _terrainId: terrainId,
  };
}

const minimalData: ISocialData = {
  greetings: { friendly: ['Hi'], neutral: ['Hey'], camp_sleepy: ['Zzz'] },
  remarks: { zone: ['Zone'], weather: ['Rain'], gossip: {} },
  campfire: {
    stories: ['A story'],
    jokes: ['A joke'],
    reactions: { laughter: ['Ha!'], story_react: ['Wow!'], eating: ['*munch*'] },
  },
};

describe('createDefaultSocialPluginConfig', () => {
  it('returns a config with all social sections defined', () => {
    const config = createDefaultSocialPluginConfig();
    expect(config.social).toBeDefined();
    expect(config.social?.meet).toBeDefined();
    expect(config.social?.remark).toBeDefined();
    expect(config.social?.campfire).toBeDefined();
  });

  it('data is undefined by default', () => {
    const config = createDefaultSocialPluginConfig();
    expect(config.data).toBeUndefined();
  });
});

describe('SocialPlugin gatheringStates', () => {
  let plugin: SocialPlugin;
  let presentedBubbles: Array<{ npcId: string; text: string; durationMs: number }>;

  function setupPlugin(gatheringStates?: readonly string[]) {
    const socialConfig = createDefaultSocialConfig({
      campfire: {
        gatheringStates,
        idleDurationMinMs: 100,
        idleDurationMaxMs: 100,
        storyDurationMinMs: 100,
        storyDurationMaxMs: 100,
        jokeDurationMinMs: 100,
        jokeDurationMaxMs: 100,
        eatingDurationMinMs: 100,
        eatingDurationMaxMs: 100,
        reactionDurationMinMs: 100,
        reactionDurationMaxMs: 100,
        reactionStaggerMs: 50,
        minParticipants: 2,
        syncIntervalMs: 100,
        eatingChance: 1.0,
        weightStory: 0.35,
        weightJokeCumulative: 0.65,
      },
    });

    plugin = new SocialPlugin(makeRandom([0.0]), {
      social: socialConfig,
      data: minimalData,
    });

    presentedBubbles = [];

    const portRegistry = new PortRegistry();
    const presenter: ISocialPresenter = {
      showBubble(npcId, text, durationMs) {
        presentedBubbles.push({ npcId, text, durationMs });
      },
    };

    const npcs: Array<ISocialNPC & { _terrainId: string | null }> = [];

    const provider: INPCSocialProvider = {
      getOnlineNPCs: () => npcs,
      areFactionsFriendly: () => true,
      areFactionsHostile: () => false,
      getNPCTerrainId: (id: string) => npcs.find((n) => n.id === id)?._terrainId ?? null,
    };

    portRegistry.provide(SocialPorts.SocialPresenter, presenter);
    portRegistry.provide(SocialPorts.NPCSocialProvider, provider);

    // Simulate kernel install + init
    const fakeKernel = { portRegistry } as any;
    plugin.install(fakeKernel);
    plugin.init();

    return { npcs, presenter, provider };
  }

  it('default gatheringStates includes only camp', () => {
    const { npcs } = setupPlugin(); // no custom gatheringStates
    npcs.push(
      makeNPC('a', 'camp', 'terrain_1'),
      makeNPC('b', 'camp', 'terrain_1'),
    );

    // Trigger campfire sync (syncIntervalMs = 100)
    plugin.update(200);

    // CampfireFSM should have been created and started producing bubbles
    // (idle duration 100ms, delta 200ms → transitions)
    expect(presentedBubbles.length).toBeGreaterThan(0);
  });

  it('default gatheringStates excludes non-camp states', () => {
    const { npcs } = setupPlugin(); // default: only 'camp'
    npcs.push(
      makeNPC('a', 'rest', 'terrain_1'),
      makeNPC('b', 'rest', 'terrain_1'),
    );

    // Trigger multiple sync cycles
    plugin.update(200);
    plugin.update(200);

    // No campfire bubbles because 'rest' is not a gathering state
    // (there may be remark bubbles though, so filter for campfire categories)
    // Actually, since RemarkDispatcher defaults check idle/patrol/camp,
    // and 'rest' is none of those, no bubbles at all should appear
    expect(presentedBubbles).toHaveLength(0);
  });

  it('custom gatheringStates allows non-camp states for campfire', () => {
    const { npcs } = setupPlugin(['camp', 'rest', 'sit']);
    npcs.push(
      makeNPC('a', 'rest', 'terrain_1'),
      makeNPC('b', 'sit', 'terrain_1'),
    );

    // Trigger campfire sync
    plugin.update(200);

    // CampfireFSM should have been created for 'rest' and 'sit' NPCs
    expect(presentedBubbles.length).toBeGreaterThan(0);
  });

  it('custom gatheringStates with single non-default state', () => {
    const { npcs } = setupPlugin(['gathering']);
    npcs.push(
      makeNPC('a', 'gathering', 'terrain_1'),
      makeNPC('b', 'gathering', 'terrain_1'),
    );

    plugin.update(200);

    // Should have campfire bubbles because 'gathering' is in gatheringStates
    expect(presentedBubbles.length).toBeGreaterThan(0);
  });
});

describe('SocialPlugin createGatheringFSM injection', () => {
  const minCampfireConfig = {
    idleDurationMinMs: 100,
    idleDurationMaxMs: 100,
    storyDurationMinMs: 100,
    storyDurationMaxMs: 100,
    jokeDurationMinMs: 100,
    jokeDurationMaxMs: 100,
    eatingDurationMinMs: 100,
    eatingDurationMaxMs: 100,
    reactionDurationMinMs: 100,
    reactionDurationMaxMs: 100,
    reactionStaggerMs: 50,
    minParticipants: 2,
    syncIntervalMs: 100,
    eatingChance: 1.0,
    weightStory: 0.35,
    weightJokeCumulative: 0.65,
  };

  function setupPluginWithFactory(
    createGatheringFSM?: (terrainId: string) => IGatheringFSM,
  ) {
    const socialConfig = createDefaultSocialConfig({
      campfire: minCampfireConfig,
      createGatheringFSM,
    });

    const plugin = new SocialPlugin(makeRandom([0.0]), {
      social: socialConfig,
      data: minimalData,
    });

    const presentedBubbles: Array<{ npcId: string; text: string; durationMs: number }> = [];
    const portRegistry = new PortRegistry();

    const presenter: ISocialPresenter = {
      showBubble(npcId, text, durationMs) {
        presentedBubbles.push({ npcId, text, durationMs });
      },
    };

    const npcs: Array<ISocialNPC & { _terrainId: string | null }> = [];

    const provider: INPCSocialProvider = {
      getOnlineNPCs: () => npcs,
      areFactionsFriendly: () => true,
      areFactionsHostile: () => false,
      getNPCTerrainId: (id: string) => npcs.find((n) => n.id === id)?._terrainId ?? null,
    };

    portRegistry.provide(SocialPorts.SocialPresenter, presenter);
    portRegistry.provide(SocialPorts.NPCSocialProvider, provider);

    const fakeKernel = { portRegistry } as any;
    plugin.install(fakeKernel);
    plugin.init();

    return { plugin, npcs, presentedBubbles };
  }

  it('backward compat: no createGatheringFSM → default CampfireFSM produces bubbles', () => {
    const { plugin, npcs, presentedBubbles } = setupPluginWithFactory();
    npcs.push(
      makeNPC('a', 'camp', 'terrain_1'),
      makeNPC('b', 'camp', 'terrain_1'),
    );

    // Trigger sync + enough delta for FSM to transition
    plugin.update(200);

    // Default CampfireFSM should produce at least one bubble
    expect(presentedBubbles.length).toBeGreaterThan(0);
  });

  it('custom createGatheringFSM factory is called when a new session is created', () => {
    const factoryCallArgs: string[] = [];
    const fsmUpdate = vi.fn<[number], IBubbleRequest[]>().mockReturnValue([]);
    const fsmSetParticipants = vi.fn<[readonly string[]], boolean>().mockReturnValue(true);
    const fsmClear = vi.fn<[], void>();

    const factory = vi.fn((terrainId: string): IGatheringFSM => {
      factoryCallArgs.push(terrainId);
      return {
        update: fsmUpdate,
        setParticipants: fsmSetParticipants,
        clear: fsmClear,
      };
    });

    const { plugin, npcs } = setupPluginWithFactory(factory);
    npcs.push(
      makeNPC('a', 'camp', 'terrain_1'),
      makeNPC('b', 'camp', 'terrain_1'),
    );

    // Trigger sync — factory should be called once for 'terrain_1'
    plugin.update(150);

    expect(factory).toHaveBeenCalledTimes(1);
    expect(factoryCallArgs).toEqual(['terrain_1']);
    expect(fsmSetParticipants).toHaveBeenCalledWith(['a', 'b']);
  });

  it('custom FSM update() is called each plugin update tick after session creation', () => {
    const fsmUpdate = vi.fn<[number], IBubbleRequest[]>().mockReturnValue([]);
    const fsmSetParticipants = vi.fn<[readonly string[]], boolean>().mockReturnValue(true);
    const fsmClear = vi.fn<[], void>();

    const factory = (_terrainId: string): IGatheringFSM => ({
      update: fsmUpdate,
      setParticipants: fsmSetParticipants,
      clear: fsmClear,
    });

    const { plugin, npcs } = setupPluginWithFactory(factory);
    npcs.push(
      makeNPC('a', 'camp', 'terrain_1'),
      makeNPC('b', 'camp', 'terrain_1'),
    );

    // First update: triggers sync (at 150ms >= syncIntervalMs 100ms) + FSM update
    plugin.update(150);
    expect(fsmUpdate).toHaveBeenCalledTimes(1);
    expect(fsmUpdate).toHaveBeenCalledWith(150);

    // Second update: no sync (timer at 50ms < 100ms), but FSM update still called
    plugin.update(50);
    expect(fsmUpdate).toHaveBeenCalledTimes(2);
    expect(fsmUpdate).toHaveBeenLastCalledWith(50);
  });

  it('custom FSM bubbles are presented via the presenter', () => {
    const customBubble: IBubbleRequest = {
      npcId: 'a',
      text: 'Custom gathering text!',
      durationMs: 3000,
    };

    const fsmUpdate = vi.fn<[number], IBubbleRequest[]>().mockReturnValue([customBubble]);
    const fsmSetParticipants = vi.fn<[readonly string[]], boolean>().mockReturnValue(true);
    const fsmClear = vi.fn<[], void>();

    const factory = (_terrainId: string): IGatheringFSM => ({
      update: fsmUpdate,
      setParticipants: fsmSetParticipants,
      clear: fsmClear,
    });

    const { plugin, npcs, presentedBubbles } = setupPluginWithFactory(factory);
    npcs.push(
      makeNPC('a', 'camp', 'terrain_1'),
      makeNPC('b', 'camp', 'terrain_1'),
    );

    plugin.update(150);

    // The custom bubble returned by our mock FSM should have been presented
    expect(presentedBubbles).toContainEqual({
      npcId: 'a',
      text: 'Custom gathering text!',
      durationMs: 3000,
    });
  });

  it('custom FSM clear() is called when session is destroyed', () => {
    const fsmUpdate = vi.fn<[number], IBubbleRequest[]>().mockReturnValue([]);
    const fsmSetParticipants = vi.fn<[readonly string[]], boolean>().mockReturnValue(true);
    const fsmClear = vi.fn<[], void>();

    const factory = (_terrainId: string): IGatheringFSM => ({
      update: fsmUpdate,
      setParticipants: fsmSetParticipants,
      clear: fsmClear,
    });

    const { plugin, npcs } = setupPluginWithFactory(factory);
    npcs.push(
      makeNPC('a', 'camp', 'terrain_1'),
      makeNPC('b', 'camp', 'terrain_1'),
    );

    // Create the session
    plugin.update(150);
    expect(fsmClear).not.toHaveBeenCalled();

    // Remove NPCs so session dissolves on next sync
    npcs.length = 0;
    plugin.update(150); // triggers another sync cycle

    // Session should have been cleared
    expect(fsmClear).toHaveBeenCalled();
  });
});
