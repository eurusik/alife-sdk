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

  // --- tickReactions stale-bubbles fix ---

  describe('tickReactions stale bubbles', () => {
    // Config: reactionDurationMinMs/MaxMs = 200, reactionStaggerMs = 50.
    // Participants: npc_1 (director), npc_2 (stagger 0), npc_3 (stagger 50).
    // All reactions fire once stateTimer >= 50.  stateDuration = 200, so the
    // FSM stays in REACTING until stateTimer >= 200.

    function advanceToReacting(f: CampfireFSM): void {
      f.update(200); // IDLE → STORY
      f.update(200); // STORY → REACTING (stateTimer resets to 0)
    }

    it('returns empty array on the frame after all reactions have fired', () => {
      advanceToReacting(fsm);
      expect(fsm.getState()).toBe(CampfireState.REACTING);

      // Advance past both stagger thresholds (0 ms and 50 ms) in one tick so
      // both pending reactions fire and _pendingReactionCount drops to 0.
      fsm.update(60); // stateTimer = 60 → both reactions fire

      // Next frame: _pendingReactionCount === 0, fix must return [] not stale buffer.
      const subsequent = fsm.update(10); // stateTimer = 70, still < 200
      expect(fsm.getState()).toBe(CampfireState.REACTING);
      expect(subsequent).toHaveLength(0);
    });

    it('empty array returned after all reactions fire is a fresh [] not the internal buffer', () => {
      advanceToReacting(fsm);

      // Drain all pending reactions.
      const draining = fsm.update(60); // both reactions fire
      expect(draining.length).toBeGreaterThan(0);

      // Two subsequent calls must each return a distinct [] literal,
      // proving the early-return path emits `[]` rather than `_reactionBubbles`.
      const frameA = fsm.update(10);
      const frameB = fsm.update(10);

      expect(frameA).toHaveLength(0);
      expect(frameB).toHaveLength(0);
      // Different references — each call returns a new [].
      expect(frameA).not.toBe(frameB);
      // Neither reference is the draining array (which is itself a spread copy).
      expect(frameA).not.toBe(draining);
    });

    it('already-fired reactions are not re-emitted on subsequent ticks', () => {
      advanceToReacting(fsm);

      // Fire the stagger-0 reaction only.
      const first = fsm.update(1); // stateTimer = 1, npc_2 fires
      expect(first).toHaveLength(1);
      const firedNpcId = first[0].npcId;

      // Fire the stagger-50 reaction.
      const second = fsm.update(60); // stateTimer = 61, npc_3 fires
      expect(second).toHaveLength(1);

      // Both pending reactions are now exhausted (_pendingReactionCount === 0).
      // Subsequent ticks must not re-emit either NPC.
      const third = fsm.update(10);  // stateTimer = 71
      const fourth = fsm.update(10); // stateTimer = 81

      expect(third).toHaveLength(0);
      expect(fourth).toHaveLength(0);

      // Confirm the already-fired NPC does not appear in any later tick.
      const allLaterNpcIds = [...third, ...fourth].map((b) => b.npcId);
      expect(allLaterNpcIds).not.toContain(firedNpcId);
    });
  });

  // --- tickReactions array-aliasing fix ---

  describe('tickReactions array aliasing', () => {
    function advanceToReacting(f: CampfireFSM): void {
      f.update(200); // IDLE → STORY (random 0.0 < 0.35)
      f.update(200); // STORY → REACTING
    }

    it('two consecutive tickReactions calls return different array references', () => {
      advanceToReacting(fsm);
      expect(fsm.getState()).toBe(CampfireState.REACTING);

      // Both calls tick during REACTING before the state timer expires (< 200 ms).
      // stateTimer is reset to 0 on enterReacting; each update adds deltaMs.
      const first = fsm.update(10);  // stateTimer = 10
      const second = fsm.update(10); // stateTimer = 20

      expect(first).not.toBe(second);
    });

    it('first call result is not emptied when second call fires', () => {
      advanceToReacting(fsm);

      // reactionStagger = 0 for the first audience NPC, so it fires immediately.
      // Pass stateTimer=0 for first call so the stagger-0 reaction fires.
      const first = fsm.update(1);   // fires npc_2 (stagger 0)
      const snapshot = [...first];   // capture length before second call

      // Second call clears _reactionBubbles internally then re-populates it.
      fsm.update(1);

      // first must still reflect what it held when returned.
      expect(first.length).toBe(snapshot.length);
      expect(first).toEqual(snapshot);
    });

    it('first call contains the reaction bubble that was ready', () => {
      advanceToReacting(fsm);

      // stageTimer starts at 0 after enterReacting.
      // Audience is [npc_2, npc_3] (director is npc_1).
      // reactionStagger = 50 ms, so npc_2 fires at delay 0, npc_3 at delay 50.
      const first = fsm.update(1); // stateTimer = 1 → only delay-0 reaction fires

      expect(first).toHaveLength(1);
      expect(first[0].category).toBe(SocialCategory.CAMPFIRE_STORY_REACT);
      expect(first[0].text).toBe('Wow!');
    });

    it('second call contains only the newly ready reaction, independent of first', () => {
      advanceToReacting(fsm);

      const first = fsm.update(1);  // stateTimer = 1 → delay-0 fires (1 bubble)
      const second = fsm.update(60); // stateTimer = 61 → delay-50 fires (1 bubble)

      // Each array is independent.
      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(first[0].npcId).not.toBe(second[0].npcId);
    });
  });
});
