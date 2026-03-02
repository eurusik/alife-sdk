import { describe, it, expect, beforeEach } from 'vitest';
import { CampfireFSM } from './CampfireFSM';
import { ContentPool } from '../content/ContentPool';
import { CampfireState, SocialCategory } from '../types/ISocialTypes';
import type { ICampfireConfig } from '../types/ISocialConfig';

const config: ICampfireConfig = {
  idleDurationMinMs: 100,
  idleDurationMaxMs: 100,
  storyDurationMinMs: 100,
  storyDurationMaxMs: 100,
  jokeDurationMinMs: 100,
  jokeDurationMaxMs: 100,
  eatingDurationMinMs: 100,
  eatingDurationMaxMs: 100,
  reactionDurationMinMs: 200,
  reactionDurationMaxMs: 200,
  reactionStaggerMs: 50,
  minParticipants: 2,
  syncIntervalMs: 3000,
  eatingChance: 1.0,
  weightStory: 0.35,
  weightJokeCumulative: 0.65,
};

function makeRandom(values: number[] = [0.0]) {
  let idx = 0;
  return {
    next: () => values[idx++ % values.length],
    nextInt: (min: number, max: number) => min + Math.floor(values[idx++ % values.length] * (max - min + 1)),
    nextFloat: (min: number, max: number) => min + values[idx++ % values.length] * (max - min),
  };
}

function makePool(random: ReturnType<typeof makeRandom>): ContentPool {
  const pool = new ContentPool(random);
  pool.addLines(SocialCategory.CAMPFIRE_STORY, ['A story...']);
  pool.addLines(SocialCategory.CAMPFIRE_JOKE, ['A joke...']);
  pool.addLines(SocialCategory.CAMPFIRE_LAUGHTER, ['Ha ha!']);
  pool.addLines(SocialCategory.CAMPFIRE_STORY_REACT, ['Wow!']);
  pool.addLines(SocialCategory.CAMPFIRE_EATING, ['*munch*']);
  return pool;
}

describe('CampfireFSM', () => {
  let fsm: CampfireFSM;
  let random: ReturnType<typeof makeRandom>;

  beforeEach(() => {
    random = makeRandom([0.0]);
    fsm = new CampfireFSM('terrain_1', makePool(random), random, config);
    fsm.setParticipants(['npc_1', 'npc_2', 'npc_3']);
  });

  it('starts in IDLE state', () => {
    expect(fsm.getState()).toBe(CampfireState.IDLE);
  });

  it('transitions from IDLE to activity', () => {
    // Random 0.0 < 0.35 → STORY
    const bubbles = fsm.update(200); // Exceeds idle duration
    expect(fsm.getState()).toBe(CampfireState.STORY);
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0].category).toBe(SocialCategory.CAMPFIRE_STORY);
  });

  it('transitions to JOKE when random in range', () => {
    const jokeRandom = makeRandom([0.5]); // 0.5 > 0.35 but < 0.65 → JOKE
    const jokePool = makePool(jokeRandom);
    const jokeFsm = new CampfireFSM('t', jokePool, jokeRandom, config);
    jokeFsm.setParticipants(['a', 'b']);
    jokeFsm.update(200); // IDLE → JOKE
    expect(jokeFsm.getState()).toBe(CampfireState.JOKE);
  });

  it('transitions to EATING when random high', () => {
    const eatRandom = makeRandom([0.8]); // 0.8 > 0.65 → EATING
    const eatPool = makePool(eatRandom);
    const eatFsm = new CampfireFSM('t', eatPool, eatRandom, config);
    eatFsm.setParticipants(['a', 'b']);
    const bubbles = eatFsm.update(200);
    expect(eatFsm.getState()).toBe(CampfireState.EATING);
    expect(bubbles.length).toBeGreaterThan(0);
    expect(bubbles[0].category).toBe(SocialCategory.CAMPFIRE_EATING);
  });

  it('transitions STORY → REACTING', () => {
    fsm.update(200); // IDLE → STORY
    expect(fsm.getState()).toBe(CampfireState.STORY);
    fsm.update(200); // STORY → REACTING
    expect(fsm.getState()).toBe(CampfireState.REACTING);
  });

  it('fires staggered reactions', () => {
    fsm.update(200); // → STORY
    fsm.update(200); // → REACTING (timers set)
    // First reaction at stagger 0
    const r1 = fsm.update(10);
    expect(r1.length).toBeGreaterThan(0);
    expect(r1[0].category).toBe(SocialCategory.CAMPFIRE_STORY_REACT);
  });

  it('fires laughter reactions after joke', () => {
    const jokeRandom = makeRandom([0.5]);
    const jokeFsm = new CampfireFSM('t', makePool(jokeRandom), jokeRandom, config);
    jokeFsm.setParticipants(['a', 'b', 'c']);
    jokeFsm.update(200); // → JOKE
    jokeFsm.update(200); // → REACTING
    const reactions = jokeFsm.update(10);
    const hasLaughter = reactions.some((r) => r.category === SocialCategory.CAMPFIRE_LAUGHTER);
    expect(hasLaughter).toBe(true);
  });

  it('transitions REACTING → IDLE', () => {
    fsm.update(200); // → STORY
    fsm.update(200); // → REACTING
    fsm.update(300); // → IDLE
    expect(fsm.getState()).toBe(CampfireState.IDLE);
  });

  it('transitions EATING → IDLE', () => {
    const eatRandom = makeRandom([0.8]);
    const eatFsm = new CampfireFSM('t', makePool(eatRandom), eatRandom, config);
    eatFsm.setParticipants(['a', 'b']);
    eatFsm.update(200); // → EATING
    eatFsm.update(200); // → IDLE
    expect(eatFsm.getState()).toBe(CampfireState.IDLE);
  });

  it('returns no bubbles with insufficient participants', () => {
    const emptyFsm = new CampfireFSM('t', makePool(random), random, config);
    emptyFsm.setParticipants(['only_one']);
    const bubbles = emptyFsm.update(200);
    expect(bubbles).toHaveLength(0);
  });

  it('setParticipants returns false below minimum', () => {
    expect(fsm.setParticipants(['one'])).toBe(false);
  });

  it('terrainId is accessible', () => {
    expect(fsm.terrainId).toBe('terrain_1');
  });

  it('clear resets FSM', () => {
    fsm.update(200); // → STORY
    fsm.clear();
    expect(fsm.getState()).toBe(CampfireState.IDLE);
    expect(fsm.participantCount).toBe(0);
  });

  it('getDirectorId returns director after activity', () => {
    fsm.update(200); // → STORY
    expect(fsm.getDirectorId()).toBeTruthy();
  });

  it('full cycle returns to IDLE', () => {
    fsm.update(200); // → STORY
    fsm.update(200); // → REACTING
    fsm.update(300); // → IDLE
    expect(fsm.getState()).toBe(CampfireState.IDLE);
    // Can start another cycle
    fsm.update(200);
    expect(fsm.getState()).not.toBe(CampfireState.IDLE);
  });
});
