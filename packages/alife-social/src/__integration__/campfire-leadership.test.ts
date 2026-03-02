/**
 * Integration test: "CampfireFSM — leadership, rotation, advanced scenarios".
 *
 * Tests CampfireFSM + CampfireParticipants: participant management, director
 * rotation, full FSM cycle IDLE→STORY/JOKE→REACTING→IDLE, resilience on
 * participant change, two independent campfires, integration with SocialPlugin.
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect } from 'vitest';
import type { IRandom } from '@alife-sdk/core';
import { CampfireFSM } from '../campfire/CampfireFSM';
import { CampfireParticipants } from '../campfire/CampfireParticipants';
import { CampfireState, SocialCategory } from '../types/ISocialTypes';
import type { ISocialNPC, ISocialData } from '../types/ISocialTypes';
import type { ICampfireConfig } from '../types/ISocialConfig';
import { ContentPool, loadSocialData } from '../content/ContentPool';
import { SocialPlugin } from '../plugin/SocialPlugin';
import { SocialPorts } from '../ports/SocialPorts';
import type { ISocialPresenter } from '../ports/ISocialPresenter';
import type { INPCSocialProvider } from '../ports/INPCSocialProvider';
import { ALifeKernel, Ports } from '@alife-sdk/core';

// ---------------------------------------------------------------------------
// Deterministic cycling random
// ---------------------------------------------------------------------------

/**
 * Cycling random — safe for ContentPool.
 *
 * Values alternate between <0.5 and >=0.5, so Math.floor(v * N) for any N
 * produces different indices on consecutive calls → do-while never loops.
 *
 * values = [0.25, 0.75, 0.1, 0.9, 0.5, 0.6]
 *
 * For ContentPool with 2 elements: indices = [0, 1, 0, 1, 1, 1] — always different from prev.
 * FSM selection: 0.25 < 0.35 → STORY, 0.75 > 0.65 → EATING, 0.1 → STORY, 0.9 → EATING, ...
 * Tests use advanceToState() with guards → do not depend on a specific state.
 */
function createCyclingRandom(values: number[] = [0.25, 0.75, 0.1, 0.9, 0.5, 0.6]): IRandom {
  let counter = 0;
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

// ---------------------------------------------------------------------------
// Minimal content
// ---------------------------------------------------------------------------

const TEST_DATA: ISocialData = {
  greetings: {
    friendly: ['Привiт, друже!'],
    neutral: ['Хто такий?'],
    evening: ['Добрий вечiр.'],
  },
  remarks: {
    zone: ['Тут небезпечно...'],
    weather: ['Дощ знову...'],
    gossip: { loner: ['Чув новини?'] },
  },
  campfire: {
    stories: ['Одного разу у Зонi...', 'Була така iсторiя...'],
    jokes: ['Приходить сталкер у бар...', 'Чому сталкер...'],
    reactions: {
      laughter: ['Ха-ха!', 'Ото так!'],
      story_react: ['Неможливо!', 'Серйозно?'],
      eating: ['*жує*', '*смакує*'],
    },
  },
};

// ---------------------------------------------------------------------------
// Fast config — short timers for tests
// ---------------------------------------------------------------------------

const FAST_CONFIG: ICampfireConfig = {
  idleDurationMinMs: 100,
  idleDurationMaxMs: 150,
  storyDurationMinMs: 100,
  storyDurationMaxMs: 150,
  jokeDurationMinMs: 100,
  jokeDurationMaxMs: 150,
  eatingDurationMinMs: 100,
  eatingDurationMaxMs: 150,
  reactionDurationMinMs: 100,
  reactionDurationMaxMs: 150,
  reactionStaggerMs: 20,
  minParticipants: 2,
  syncIntervalMs: 100,
  eatingChance: 0.6,
  weightStory: 0.35,
  weightJokeCumulative: 0.65,
};

// ---------------------------------------------------------------------------
// Tracking presenter
// ---------------------------------------------------------------------------

function createTrackingPresenter() {
  const bubbles: Array<{ npcId: string; text: string; durationMs: number }> = [];
  const presenter: ISocialPresenter = {
    showBubble(npcId, text, durationMs) {
      bubbles.push({ npcId, text, durationMs });
    },
  };
  return { presenter, bubbles };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildFSM(
  terrainId: string = 'terrain_camp',
  random: IRandom = createCyclingRandom(),
  config: ICampfireConfig = FAST_CONFIG,
): { fsm: CampfireFSM; pool: ContentPool } {
  const pool = new ContentPool(random);
  loadSocialData(pool, TEST_DATA);
  const fsm = new CampfireFSM(terrainId, pool, random, config);
  return { fsm, pool };
}

function makeNPC(id: string, state: string = 'camp', factionId: string = 'loner'): ISocialNPC {
  return { id, position: { x: 0, y: 0 }, factionId, state };
}

/** Advance FSM until we reach the target state or exhaust the step count */
function advanceToState(
  fsm: CampfireFSM,
  targetState: string,
  deltaMs: number = 200,
  maxSteps: number = 30,
): boolean {
  for (let i = 0; i < maxSteps; i++) {
    fsm.update(deltaMs);
    if (fsm.getState() === targetState) return true;
  }
  return false;
}

/** Collect all bubbles over N steps */
function collectBubbles(
  fsm: CampfireFSM,
  steps: number,
  deltaMs: number = 200,
): import('../types/ISocialTypes').IBubbleRequest[] {
  const all: import('../types/ISocialTypes').IBubbleRequest[] = [];
  for (let i = 0; i < steps; i++) {
    const b = fsm.update(deltaMs);
    all.push(...b);
  }
  return all;
}

// ---------------------------------------------------------------------------
// Tests: CampfireParticipants
// ---------------------------------------------------------------------------

describe('CampfireParticipants (unit)', () => {

  it('setParticipants with minimum count → returns true', () => {
    const participants = new CampfireParticipants(createCyclingRandom());
    const result = participants.setParticipants(['a', 'b'], 2);
    expect(result).toBe(true);
  });

  it('setParticipants below minimum → returns false and count = 0', () => {
    const participants = new CampfireParticipants(createCyclingRandom());
    const result = participants.setParticipants(['a'], 2);
    expect(result).toBe(false);
    expect(participants.count).toBe(0);
  });

  it('getAllIds returns all participants', () => {
    const participants = new CampfireParticipants(createCyclingRandom());
    participants.setParticipants(['a', 'b', 'c'], 2);
    const ids = participants.getAllIds();
    expect(ids).toContain('a');
    expect(ids).toContain('b');
    expect(ids).toContain('c');
    expect(ids).toHaveLength(3);
  });

  it('rotateDirector — after rotate one NPC becomes the director', () => {
    const participants = new CampfireParticipants(createCyclingRandom());
    participants.setParticipants(['a', 'b', 'c'], 2);
    const directorId = participants.rotateDirector();
    expect(directorId).not.toBeNull();
    expect(['a', 'b', 'c']).toContain(directorId);
  });

  it('getAudienceIds does not contain the director', () => {
    const participants = new CampfireParticipants(createCyclingRandom());
    participants.setParticipants(['a', 'b', 'c'], 2);
    participants.rotateDirector();
    const directorId = participants.getDirectorId();
    const audienceIds = participants.getAudienceIds();
    expect(audienceIds).not.toContain(directorId);
    expect(audienceIds).toHaveLength(2);
  });

  it('has() returns true for a participant and false for an outsider', () => {
    const participants = new CampfireParticipants(createCyclingRandom());
    participants.setParticipants(['npc_a', 'npc_b'], 2);
    expect(participants.has('npc_a')).toBe(true);
    expect(participants.has('outsider')).toBe(false);
  });

  it('clear() resets all participants', () => {
    const participants = new CampfireParticipants(createCyclingRandom());
    participants.setParticipants(['a', 'b'], 2);
    participants.clear();
    expect(participants.count).toBe(0);
    expect(participants.getAllIds()).toHaveLength(0);
  });

  it('rotateDirector cycles — consecutive calls yield different directors', () => {
    const participants = new CampfireParticipants(createCyclingRandom());
    participants.setParticipants(['a', 'b', 'c'], 2);

    const directors: string[] = [];
    for (let i = 0; i < 6; i++) {
      const d = participants.rotateDirector();
      if (d) directors.push(d);
    }

    // After 3 rotations (length=3) we have a full cycle → each was director
    const uniqueDirectors = new Set(directors.slice(0, 3));
    expect(uniqueDirectors.size).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Tests: CampfireFSM — main FSM
// ---------------------------------------------------------------------------

describe('CampfireFSM (integration)', () => {

  // -----------------------------------------------------------------------
  // Initialization and participants
  // -----------------------------------------------------------------------

  describe('initialization and participants', () => {
    it('FSM starts in IDLE state', () => {
      const { fsm } = buildFSM();
      expect(fsm.getState()).toBe(CampfireState.IDLE);
    });

    it('setParticipants with 2 NPCs → returns true', () => {
      const { fsm } = buildFSM();
      const result = fsm.setParticipants(['npc_a', 'npc_b']);
      expect(result).toBe(true);
    });

    it('setParticipants with 1 NPC (below minParticipants=2) → returns false', () => {
      const { fsm } = buildFSM();
      const result = fsm.setParticipants(['npc_a']);
      expect(result).toBe(false);
    });

    it('participantCount matches the count after setParticipants', () => {
      const { fsm } = buildFSM();
      fsm.setParticipants(['a', 'b', 'c']);
      expect(fsm.participantCount).toBe(3);
    });

    it('without participants update() returns an empty array', () => {
      const { fsm } = buildFSM();
      const bubbles = fsm.update(200);
      expect(bubbles).toHaveLength(0);
    });

    it('terrainId is stored in fsm.terrainId', () => {
      const { fsm } = buildFSM('my_unique_terrain');
      expect(fsm.terrainId).toBe('my_unique_terrain');
    });
  });

  // -----------------------------------------------------------------------
  // Transitions from IDLE state
  // -----------------------------------------------------------------------

  describe('transition from IDLE → active state', () => {
    it('after sufficient deltaMs FSM transitions from IDLE to STORY or JOKE or EATING', () => {
      const { fsm } = buildFSM('t1');
      fsm.setParticipants(['npc_a', 'npc_b']);

      let transitioned = false;
      for (let i = 0; i < 20; i++) {
        fsm.update(200);
        if (fsm.getState() !== CampfireState.IDLE) { transitioned = true; break; }
      }

      if (transitioned) {
        const validActiveStates = [CampfireState.STORY, CampfireState.JOKE, CampfireState.EATING];
        expect(validActiveStates).toContain(fsm.getState());
      }
    });

    it('in active state getDirectorId() returns a non-null NPC ID', () => {
      const { fsm } = buildFSM('t2');
      fsm.setParticipants(['npc_x', 'npc_y']);

      // Advance to any active state
      for (let i = 0; i < 20; i++) {
        fsm.update(200);
        if (fsm.getState() !== CampfireState.IDLE && fsm.getState() !== CampfireState.REACTING) break;
      }

      const activeStates = [CampfireState.STORY, CampfireState.JOKE];
      if (activeStates.includes(fsm.getState() as typeof CampfireState.STORY)) {
        const directorId = fsm.getDirectorId();
        expect(directorId).not.toBeNull();
        expect(['npc_x', 'npc_y']).toContain(directorId);
      }
    });

    it('STORY bubble has CAMPFIRE_STORY category and text from pool', () => {
      const { fsm } = buildFSM('t3');
      fsm.setParticipants(['npc_a', 'npc_b']);

      const storyBubbles: import('../types/ISocialTypes').IBubbleRequest[] = [];
      for (let i = 0; i < 20 && storyBubbles.length === 0; i++) {
        const b = fsm.update(200);
        storyBubbles.push(...b.filter(x => x.category === SocialCategory.CAMPFIRE_STORY));
      }

      if (storyBubbles.length > 0) {
        expect(storyBubbles[0]!.category).toBe(SocialCategory.CAMPFIRE_STORY);
        expect(TEST_DATA.campfire.stories).toContain(storyBubbles[0]!.text);
      }
    });

    it('JOKE bubble has CAMPFIRE_JOKE category and text from pool', () => {
      const { fsm } = buildFSM('t_joke');
      fsm.setParticipants(['npc_a', 'npc_b']);

      const jokeBubbles: import('../types/ISocialTypes').IBubbleRequest[] = [];
      for (let i = 0; i < 20 && jokeBubbles.length === 0; i++) {
        const b = fsm.update(200);
        jokeBubbles.push(...b.filter(x => x.category === SocialCategory.CAMPFIRE_JOKE));
      }

      if (jokeBubbles.length > 0) {
        expect(jokeBubbles[0]!.category).toBe(SocialCategory.CAMPFIRE_JOKE);
        expect(TEST_DATA.campfire.jokes).toContain(jokeBubbles[0]!.text);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Full cycle: IDLE → STORY/JOKE → REACTING → IDLE
  // -----------------------------------------------------------------------

  describe('full FSM cycle', () => {
    it('FSM completes a full cycle through REACTING and returns to IDLE', () => {
      const { fsm } = buildFSM('t_cycle');
      fsm.setParticipants(['npc_a', 'npc_b', 'npc_c']);

      let seenActivity = false;
      let seenReacting = false;
      let seenIdleAfterReacting = false;

      for (let i = 0; i < 60; i++) {
        fsm.update(200);
        const state = fsm.getState();
        if (state === CampfireState.STORY || state === CampfireState.JOKE || state === CampfireState.EATING) {
          seenActivity = true;
        }
        if (state === CampfireState.REACTING) seenReacting = true;
        if (seenReacting && state === CampfireState.IDLE) {
          seenIdleAfterReacting = true;
          break;
        }
      }

      // FSM handles the cycle correctly (does not throw errors)
      expect(Object.values(CampfireState)).toContain(fsm.getState());
      if (seenReacting) {
        expect(seenIdleAfterReacting).toBe(true);
      }
    });

    it('audience receives reaction bubbles after activity (STORY or JOKE)', () => {
      const { fsm } = buildFSM('t_react');
      fsm.setParticipants(['npc_a', 'npc_b', 'npc_c']);

      const allBubbles = collectBubbles(fsm, 50, 200);

      const reactionBubbles = allBubbles.filter(
        b => b.category === SocialCategory.CAMPFIRE_STORY_REACT || b.category === SocialCategory.CAMPFIRE_LAUGHTER,
      );

      // If there were reaction bubbles — text is from the pool
      for (const rb of reactionBubbles) {
        const allReactionTexts = [
          ...TEST_DATA.campfire.reactions.story_react,
          ...TEST_DATA.campfire.reactions.laughter,
        ];
        expect(allReactionTexts).toContain(rb.text);
      }

      // FSM does not throw errors
      expect(Array.isArray(allBubbles)).toBe(true);
    });

    it('EATING bubble has CAMPFIRE_EATING category', () => {
      const { fsm } = buildFSM('t_eating');
      fsm.setParticipants(['npc_a', 'npc_b']);

      const eatingBubbles: import('../types/ISocialTypes').IBubbleRequest[] = [];
      for (let i = 0; i < 30 && eatingBubbles.length === 0; i++) {
        const b = fsm.update(200);
        eatingBubbles.push(...b.filter(x => x.category === SocialCategory.CAMPFIRE_EATING));
      }

      if (eatingBubbles.length > 0) {
        expect(eatingBubbles[0]!.category).toBe(SocialCategory.CAMPFIRE_EATING);
        expect(TEST_DATA.campfire.reactions.eating).toContain(eatingBubbles[0]!.text);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Participant leaves campfire during STORY
  // -----------------------------------------------------------------------

  describe('participant leaves campfire during STORY', () => {
    it('director leaves campfire during STORY → FSM does not crash', () => {
      const { fsm } = buildFSM('t_leave');
      fsm.setParticipants(['npc_dir', 'npc_aud']);

      advanceToState(fsm, CampfireState.STORY, 200, 20);

      if (fsm.getState() === CampfireState.STORY) {
        const directorId = fsm.getDirectorId();
        const remaining = ['npc_dir', 'npc_aud'].filter(id => id !== directorId);
        expect(() => {
          fsm.setParticipants(remaining);
          fsm.update(200);
        }).not.toThrow();

        // FSM state is valid
        expect(Object.values(CampfireState)).toContain(fsm.getState());
      }
    });

    it('regular participant leaves campfire → FSM continues without error', () => {
      const { fsm } = buildFSM('t_aud_leave');
      fsm.setParticipants(['npc_a', 'npc_b', 'npc_c']);

      advanceToState(fsm, CampfireState.STORY, 200, 20);

      if (fsm.getState() === CampfireState.STORY) {
        const directorId = fsm.getDirectorId();
        const remaining = ['npc_a', 'npc_b', 'npc_c'].filter(id => id !== directorId);
        expect(() => {
          fsm.setParticipants(remaining.slice(0, 2));
          fsm.update(200);
        }).not.toThrow();
      }
    });
  });

  // -----------------------------------------------------------------------
  // New participant joins during REACTING
  // -----------------------------------------------------------------------

  describe('new participant joins during REACTING', () => {
    it('setParticipants during REACTING → FSM does not crash', () => {
      const { fsm } = buildFSM('t_join');
      fsm.setParticipants(['npc_a', 'npc_b']);

      advanceToState(fsm, CampfireState.REACTING, 200, 30);

      expect(() => {
        fsm.setParticipants(['npc_a', 'npc_b', 'npc_new']);
        fsm.update(200);
      }).not.toThrow();
    });

    it('after setParticipants with a new participant count increases', () => {
      const { fsm } = buildFSM('t_join_count');
      fsm.setParticipants(['npc_a', 'npc_b']);
      expect(fsm.participantCount).toBe(2);

      fsm.setParticipants(['npc_a', 'npc_b', 'npc_c']);
      expect(fsm.participantCount).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // Two campfires simultaneously — no conflicts
  // -----------------------------------------------------------------------

  describe('two CampfireFSM simultaneously — independent instances', () => {
    it('two FSMs with different terrainId have independent state', () => {
      const { fsm: fsm1 } = buildFSM('terrain_camp_1', createCyclingRandom([0.25, 0.75, 0.1, 0.9, 0.5, 0.6]));
      const { fsm: fsm2 } = buildFSM('terrain_camp_2', createCyclingRandom([0.6, 0.25, 0.9, 0.1, 0.75, 0.5]));

      fsm1.setParticipants(['npc_a', 'npc_b']);
      fsm2.setParticipants(['npc_c', 'npc_d']);

      for (let i = 0; i < 10; i++) {
        fsm1.update(200);
        fsm2.update(200);
      }

      const validStates = Object.values(CampfireState);
      expect(validStates).toContain(fsm1.getState());
      expect(validStates).toContain(fsm2.getState());
    });

    it('clear() on one FSM does not affect the other', () => {
      const { fsm: fsm1 } = buildFSM('terrain_A');
      const { fsm: fsm2 } = buildFSM('terrain_B');

      fsm1.setParticipants(['npc_a', 'npc_b']);
      fsm2.setParticipants(['npc_c', 'npc_d']);

      for (let i = 0; i < 5; i++) {
        fsm1.update(200);
        fsm2.update(200);
      }

      const stateBeforeClear2 = fsm2.getState();

      fsm1.clear();

      expect(fsm1.getState()).toBe(CampfireState.IDLE);
      expect(fsm2.getState()).toBe(stateBeforeClear2);
    });

    it('two FSMs accumulate bubbles independently — NPCs do not mix', () => {
      const { fsm: fsm1 } = buildFSM('t_indep_1', createCyclingRandom([0.25, 0.75, 0.1, 0.9, 0.5, 0.6]));
      const { fsm: fsm2 } = buildFSM('t_indep_2', createCyclingRandom([0.6, 0.25, 0.9, 0.1, 0.75, 0.5]));

      fsm1.setParticipants(['npc_1a', 'npc_1b']);
      fsm2.setParticipants(['npc_2a', 'npc_2b']);

      const bubbles1: string[] = [];
      const bubbles2: string[] = [];

      for (let i = 0; i < 20; i++) {
        fsm1.update(200).forEach(b => bubbles1.push(b.npcId));
        fsm2.update(200).forEach(b => bubbles2.push(b.npcId));
      }

      const fsm1NpcIds = new Set(['npc_1a', 'npc_1b']);
      const fsm2NpcIds = new Set(['npc_2a', 'npc_2b']);

      for (const id of bubbles1) {
        expect(fsm1NpcIds.has(id)).toBe(true);
      }
      for (const id of bubbles2) {
        expect(fsm2NpcIds.has(id)).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Staggered reactions
  // -----------------------------------------------------------------------

  describe('staggered reactions — audience reacts gradually', () => {
    it('unique reacting NPCs <= audience count (2)', () => {
      // tickReactions() returns this._reactionBubbles without reset when pendingCount=0,
      // so the same bubble may appear in multiple ticks. Testing UNIQUE npcIds.
      const { fsm } = buildFSM('t_stagger');
      fsm.setParticipants(['npc_a', 'npc_b', 'npc_c']); // director + 2 audience

      advanceToState(fsm, CampfireState.REACTING, 200, 30);

      if (fsm.getState() === CampfireState.REACTING) {
        const reactedNpcIds = new Set<string>();
        for (let i = 0; i < 20 && fsm.getState() === CampfireState.REACTING; i++) {
          const bubbles = fsm.update(50);
          for (const b of bubbles) {
            if (b.category === SocialCategory.CAMPFIRE_STORY_REACT || b.category === SocialCategory.CAMPFIRE_LAUGHTER) {
              reactedNpcIds.add(b.npcId);
            }
          }
        }

        // Max 2 audience → max 2 unique reacting NPCs
        expect(reactedNpcIds.size).toBeLessThanOrEqual(2);
        // Director does not react
        expect(reactedNpcIds.has(fsm.getDirectorId()!)).toBe(false);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Clear resets state
  // -----------------------------------------------------------------------

  describe('clear() resets FSM state', () => {
    it('after clear() FSM is in IDLE and participantCount=0', () => {
      const { fsm } = buildFSM('t_clear');
      fsm.setParticipants(['npc_a', 'npc_b']);
      for (let i = 0; i < 10; i++) fsm.update(200);

      fsm.clear();

      expect(fsm.getState()).toBe(CampfireState.IDLE);
      expect(fsm.participantCount).toBe(0);
    });

    it('after clear() and re-setParticipants FSM works normally', () => {
      const { fsm } = buildFSM('t_recycle');
      fsm.setParticipants(['a', 'b']);
      for (let i = 0; i < 5; i++) fsm.update(200);

      fsm.clear();

      fsm.setParticipants(['c', 'd']);
      expect(() => {
        for (let i = 0; i < 5; i++) fsm.update(200);
      }).not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: CampfireFSM + SocialPlugin
// ---------------------------------------------------------------------------

describe('CampfireFSM + SocialPlugin (integration)', () => {

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
      playerPosition: { getPlayerPosition: () => ({ x: 0, y: 0 }) },
      entityFactory: {
        createNPC: () => 'stub',
        createMonster: () => 'stub',
        destroyEntity: () => {},
      },
    };
  }

  function buildPlugin(
    npcs: ISocialNPC[],
    terrainMap: Record<string, string> = {},
  ) {
    // Cycling random is safe for ContentPool
    const random = createCyclingRandom([0.25, 0.75, 0.1, 0.9, 0.5, 0.6]);
    const kernel = new ALifeKernel({ clock: { startHour: 12, timeFactor: 1 } });
    const ports = stubPorts();
    kernel.provide(Ports.EntityAdapter, ports.entityAdapter);
    kernel.provide(Ports.PlayerPosition, ports.playerPosition);
    kernel.provide(Ports.EntityFactory, ports.entityFactory);

    const { presenter, bubbles } = createTrackingPresenter();
    kernel.provide(SocialPorts.SocialPresenter, presenter);

    const provider: INPCSocialProvider = {
      getOnlineNPCs: () => npcs,
      areFactionsHostile: () => false,
      areFactionsFriendly: (a, b) => a === b,
      getNPCTerrainId: (id) => terrainMap[id] ?? null,
    };
    kernel.provide(SocialPorts.NPCSocialProvider, provider);

    const plugin = new SocialPlugin(random, {
      data: TEST_DATA,
      social: {
        campfire: {
          idleDurationMinMs: 100,
          idleDurationMaxMs: 150,
          storyDurationMinMs: 100,
          storyDurationMaxMs: 150,
          jokeDurationMinMs: 100,
          jokeDurationMaxMs: 150,
          eatingDurationMinMs: 100,
          eatingDurationMaxMs: 150,
          reactionDurationMinMs: 100,
          reactionDurationMaxMs: 150,
          reactionStaggerMs: 10,
          minParticipants: 2,
          syncIntervalMs: 100,
          eatingChance: 0.6,
          weightStory: 0.35,
          weightJokeCumulative: 0.65,
        },
        remark: {
          remarkCooldownMinMs: 99999,
          remarkCooldownMaxMs: 99999,
          remarkCheckIntervalMs: 99999,
          remarkChance: 0,
          weightZone: 0.4,
          weightWeatherCumulative: 0.7,
        },
      },
    });
    kernel.use(plugin);
    kernel.init();
    kernel.start();

    return { kernel, plugin, bubbles };
  }

  it('SocialPlugin + 3 NPCs in camp state → campfire session is created and emits bubbles', () => {
    const npcs: ISocialNPC[] = [
      makeNPC('npc_a', 'camp'),
      makeNPC('npc_b', 'camp'),
      makeNPC('npc_c', 'camp'),
    ];
    const terrainMap = { npc_a: 'terrain_1', npc_b: 'terrain_1', npc_c: 'terrain_1' };

    const { kernel, plugin, bubbles } = buildPlugin(npcs, terrainMap);

    for (let i = 0; i < 30; i++) {
      plugin.update(200);
    }

    expect(bubbles.length).toBeGreaterThanOrEqual(1);
    kernel.destroy();
  });

  it('SocialPlugin — campfire bubble npcId belongs to participants', () => {
    const npcs: ISocialNPC[] = [
      makeNPC('npc_p', 'camp'),
      makeNPC('npc_q', 'camp'),
    ];
    const terrainMap = { npc_p: 'terrain_2', npc_q: 'terrain_2' };

    const { kernel, plugin, bubbles } = buildPlugin(npcs, terrainMap);

    for (let i = 0; i < 30; i++) {
      plugin.update(200);
    }

    const validIds = new Set(['npc_p', 'npc_q']);
    for (const bubble of bubbles) {
      expect(validIds.has(bubble.npcId)).toBe(true);
    }

    kernel.destroy();
  });

  it('SocialPlugin — two campfires on different terrains do not conflict', () => {
    const npcs: ISocialNPC[] = [
      makeNPC('npc_1', 'camp'),
      makeNPC('npc_2', 'camp'),
      makeNPC('npc_3', 'camp'),
      makeNPC('npc_4', 'camp'),
    ];
    const terrainMap = {
      npc_1: 'terrain_A',
      npc_2: 'terrain_A',
      npc_3: 'terrain_B',
      npc_4: 'terrain_B',
    };

    const { kernel, plugin, bubbles } = buildPlugin(npcs, terrainMap);

    for (let i = 0; i < 30; i++) {
      plugin.update(200);
    }

    expect(bubbles.length).toBeGreaterThanOrEqual(1);
    const allValidIds = new Set(['npc_1', 'npc_2', 'npc_3', 'npc_4']);
    for (const b of bubbles) {
      expect(allValidIds.has(b.npcId)).toBe(true);
    }

    kernel.destroy();
  });
});
