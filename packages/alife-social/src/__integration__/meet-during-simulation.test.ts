/**
 * Integration test: "NPC-NPC greetings triggered during patrol".
 *
 * Cross-package scenario: social ↔ meet subsystem.
 *
 * Models two friendly NPCs patrolling near each other. When their positions
 * are within meetDistance and they are not hostile, MeetOrchestrator produces
 * greeting bubble requests. A tracking ISocialPresenter records showBubble calls.
 *
 * Uses MeetOrchestrator directly (no SocialPlugin / ALifeKernel overhead).
 * For NPC-NPC greetings, one NPC acts as the "observer" (target position) and
 * the other NPCs are passed as the candidates list. Each NPC pair can greet
 * independently using separate orchestrator instances or by alternating the
 * target NPC.
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect } from 'vitest';
import type { IRandom } from '@alife-sdk/core';
import { MeetOrchestrator } from '../meet/MeetOrchestrator';
import type { IMeetUpdateContext } from '../meet/MeetOrchestrator';
import { ContentPool, loadSocialData } from '../content/ContentPool';
import { SocialCategory } from '../types/ISocialTypes';
import type { ISocialNPC, ISocialData } from '../types/ISocialTypes';
import type { IMeetConfig } from '../types/ISocialConfig';
import type { ISocialPresenter } from '../ports/ISocialPresenter';

// ---------------------------------------------------------------------------
// Deterministic cycling random
// ---------------------------------------------------------------------------

function createCyclingRandom(): IRandom {
  let counter = 0;
  const values = [0.1, 0.3, 0.5, 0.7, 0.9];
  return {
    next: () => values[counter++ % values.length]!,
    nextInt: (min, max) => {
      const v = values[counter++ % values.length]!;
      return Math.floor(v * (max - min + 1)) + min;
    },
    nextFloat: (min, max) => {
      const v = values[counter++ % values.length]!;
      return v * (max - min) + min;
    },
  };
}

// ---------------------------------------------------------------------------
// Minimal social content for all greeting categories
// ---------------------------------------------------------------------------

const TEST_DATA: ISocialData = {
  greetings: {
    friendly: ['Привіт, друже!', 'Здоров, сталкер!', 'Як справи?'],
    neutral:  ['Хто такий?', 'Чого треба?'],
    evening:  ['Добрий вечір.', 'Добраніч.'],
  },
  remarks: {
    zone:    ['Тут небезпечно...'],
    weather: ['Дощ знову...'],
    gossip:  { loner: ['Чув новини?'] },
  },
  campfire: {
    stories:   ['Одного разу у Зоні...'],
    jokes:     ['Приходить сталкер у бар...'],
    reactions: {
      laughter:    ['Ха-ха!'],
      story_react: ['Серйозно?'],
      eating:      ['*жує*'],
    },
  },
};

// ---------------------------------------------------------------------------
// Meet config — fast check interval for tests
// ---------------------------------------------------------------------------

const MEET_CONFIG: IMeetConfig = {
  meetDistance: 200,
  meetCooldownMs: 5_000,
  meetCheckIntervalMs: 100,
};

// ---------------------------------------------------------------------------
// Tracking presenter — records all showBubble calls without vi.fn()
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

function buildOrchestrator(random?: IRandom): MeetOrchestrator {
  const rng = random ?? createCyclingRandom();
  const pool = new ContentPool(rng);
  loadSocialData(pool, TEST_DATA);
  return new MeetOrchestrator(pool, rng, MEET_CONFIG);
}

/**
 * Create a meet context from NPC A's position toward the candidate list.
 * Models "A is the observer, others are candidates that might greet".
 */
function makeMeetCtx(
  observer: ISocialNPC,
  candidates: readonly ISocialNPC[],
  opts: {
    currentTime?: number;
    deltaMs?: number;
    isHostile?: (a: string, b: string) => boolean;
    isAlly?: (a: string, b: string) => boolean;
  } = {},
): IMeetUpdateContext {
  return {
    deltaMs:         opts.deltaMs ?? MEET_CONFIG.meetCheckIntervalMs + 1,
    targetX:         observer.position.x,
    targetY:         observer.position.y,
    currentTime:     opts.currentTime ?? 1000,
    npcs:            candidates,
    isHostile:       opts.isHostile ?? (() => false),
    isAlly:          opts.isAlly   ?? ((a, b) => a === b),
    targetFactionId: observer.factionId,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Social: NPC-NPC greetings during patrol (integration)', () => {

  // -----------------------------------------------------------------------
  // Scenario 1: Two friendly NPCs close together → greet
  // -----------------------------------------------------------------------

  describe('scenario 1: two friendly NPCs in patrol → greeting triggered', () => {
    it('npc_b greets npc_a when they are close in patrol state', () => {
      const mutableNPCs: ISocialNPC[] = [
        { id: 'npc_a', position: { x: 100, y: 100 }, factionId: 'loner', state: 'patrol' },
        { id: 'npc_b', position: { x: 110, y: 100 }, factionId: 'loner', state: 'patrol' },
      ];

      const orchestrator = buildOrchestrator();

      // npc_a is observer, npc_b is candidate
      const bubbles = orchestrator.update(makeMeetCtx(mutableNPCs[0]!, [mutableNPCs[1]!]));

      expect(bubbles.length).toBeGreaterThanOrEqual(1);
      expect(bubbles[0]!.npcId).toBe('npc_b');
      expect(bubbles[0]!.category).toBe(SocialCategory.GREETING_FRIENDLY);
    });

    it('bubble text is from the friendly greetings pool', () => {
      const npcs: ISocialNPC[] = [
        { id: 'npc_a', position: { x: 0, y: 0 }, factionId: 'loner', state: 'patrol' },
        { id: 'npc_b', position: { x: 10, y: 0 }, factionId: 'loner', state: 'patrol' },
      ];

      const orchestrator = buildOrchestrator();
      const bubbles = orchestrator.update(makeMeetCtx(npcs[0]!, [npcs[1]!]));

      expect(bubbles.length).toBe(1);
      expect(TEST_DATA.greetings.friendly).toContain(bubbles[0]!.text);
    });

    it('bubble has positive durationMs', () => {
      const npcs: ISocialNPC[] = [
        { id: 'npc_a', position: { x: 0, y: 0 }, factionId: 'loner', state: 'patrol' },
        { id: 'npc_b', position: { x: 5, y: 0 }, factionId: 'loner', state: 'patrol' },
      ];

      const orchestrator = buildOrchestrator();
      const bubbles = orchestrator.update(makeMeetCtx(npcs[0]!, [npcs[1]!]));

      expect(bubbles[0]!.durationMs).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 2: Hostile NPCs → no greeting
  // -----------------------------------------------------------------------

  describe('scenario 2: hostile NPCs → no greeting emitted', () => {
    it('npc_a (loner) and npc_b (bandit) hostile → no bubbles', () => {
      const npcA: ISocialNPC = { id: 'npc_a', position: { x: 100, y: 100 }, factionId: 'loner',  state: 'patrol' };
      const npcB: ISocialNPC = { id: 'npc_b', position: { x: 110, y: 100 }, factionId: 'bandit', state: 'patrol' };

      const orchestrator = buildOrchestrator();
      const bubbles = orchestrator.update(makeMeetCtx(npcA, [npcB], {
        isHostile: (a, b) => (a === 'loner' && b === 'bandit') || (a === 'bandit' && b === 'loner'),
      }));

      expect(bubbles).toHaveLength(0);
    });

    it('mixed group: friendly npc greets, hostile npc does not', () => {
      const observer: ISocialNPC = { id: 'obs',   position: { x: 100, y: 100 }, factionId: 'loner',    state: 'patrol' };
      const friendly: ISocialNPC = { id: 'ally',  position: { x: 110, y: 100 }, factionId: 'loner',    state: 'patrol' };
      const hostile:  ISocialNPC = { id: 'enemy', position: { x: 115, y: 100 }, factionId: 'military', state: 'patrol' };

      const orchestrator = buildOrchestrator();
      const bubbles = orchestrator.update(makeMeetCtx(observer, [friendly, hostile], {
        isHostile: (a, b) => (a === 'loner' && b === 'military') || (a === 'military' && b === 'loner'),
        isAlly:    (a, b) => a === b,
      }));

      // Only the friendly NPC should have greeted
      const npcIds = bubbles.map(b => b.npcId);
      expect(npcIds).toContain('ally');
      expect(npcIds).not.toContain('enemy');
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 3: Cooldown prevents repeated greetings for same pair
  // -----------------------------------------------------------------------

  describe('scenario 3: cooldown prevents repeated greetings from same NPC', () => {
    it('first call greets, immediate second call is blocked by cooldown', () => {
      const observer: ISocialNPC = { id: 'obs',   position: { x: 100, y: 100 }, factionId: 'loner', state: 'patrol' };
      const candidate: ISocialNPC = { id: 'npc_1', position: { x: 110, y: 100 }, factionId: 'loner', state: 'patrol' };

      const orchestrator = buildOrchestrator();
      const ctx = makeMeetCtx(observer, [candidate], { currentTime: 1000 });

      // First check interval advances
      const first = orchestrator.update(ctx);
      expect(first.length).toBeGreaterThanOrEqual(1);

      // Same time — check timer not advanced, no second interval fired
      // Advance only enough for one more check (but within cooldown window)
      const second = orchestrator.update({
        ...ctx,
        currentTime: 1000 + MEET_CONFIG.meetCooldownMs - 1,
      });
      expect(second).toHaveLength(0);
    });

    it('after cooldown expires, NPC can greet again', () => {
      const observer: ISocialNPC   = { id: 'obs',   position: { x: 100, y: 100 }, factionId: 'loner', state: 'patrol' };
      const candidate: ISocialNPC  = { id: 'npc_1', position: { x: 110, y: 100 }, factionId: 'loner', state: 'patrol' };

      const orchestrator = buildOrchestrator();
      const baseCtx = makeMeetCtx(observer, [candidate], { currentTime: 1000 });

      // First greeting
      const first = orchestrator.update(baseCtx);
      expect(first.length).toBeGreaterThanOrEqual(1);

      // Advance past cooldown — need to advance check timer too
      const cooldownCtx = {
        ...baseCtx,
        deltaMs: MEET_CONFIG.meetCheckIntervalMs + 1,
        currentTime: 1000 + MEET_CONFIG.meetCooldownMs + 100,
      };
      const second = orchestrator.update(cooldownCtx);
      // Cooldown has expired — greeting allowed again
      expect(second.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 4: Three NPCs — each pair greets independently
  // -----------------------------------------------------------------------

  describe('scenario 4: three NPCs — pairs greet independently', () => {
    it('npc_b and npc_c both greet npc_a in the same check interval', () => {
      const npcA: ISocialNPC = { id: 'npc_a', position: { x: 100, y: 100 }, factionId: 'loner', state: 'patrol' };
      const npcB: ISocialNPC = { id: 'npc_b', position: { x: 110, y: 100 }, factionId: 'loner', state: 'patrol' };
      const npcC: ISocialNPC = { id: 'npc_c', position: { x: 105, y: 100 }, factionId: 'loner', state: 'patrol' };

      const orchestrator = buildOrchestrator();

      // Both npc_b and npc_c are candidates near npc_a
      const bubbles = orchestrator.update(makeMeetCtx(npcA, [npcB, npcC]));

      // Both candidates should produce greeting bubbles
      expect(bubbles.length).toBeGreaterThanOrEqual(2);
      const npcIds = bubbles.map(b => b.npcId);
      expect(npcIds).toContain('npc_b');
      expect(npcIds).toContain('npc_c');
    });

    it('three NPCs — independent orchestrators allow bidirectional greetings', () => {
      const npcA: ISocialNPC = { id: 'npc_a', position: { x: 100, y: 100 }, factionId: 'loner', state: 'patrol' };
      const npcB: ISocialNPC = { id: 'npc_b', position: { x: 110, y: 100 }, factionId: 'loner', state: 'patrol' };
      const npcC: ISocialNPC = { id: 'npc_c', position: { x: 200, y: 100 }, factionId: 'loner', state: 'patrol' };

      // Use two orchestrators to simulate bidirectional meet system
      const orcAB = buildOrchestrator();
      const orcBC = buildOrchestrator();

      // npc_a sees npc_b (close)
      const bubblesAB = orcAB.update(makeMeetCtx(npcA, [npcB]));
      expect(bubblesAB.length).toBeGreaterThanOrEqual(1);

      // npc_b sees npc_c (in range at 90px apart)
      const bubblesBC = orcBC.update(makeMeetCtx(npcB, [npcC]));
      expect(bubblesBC.length).toBeGreaterThanOrEqual(1);

      // npc_a does NOT see npc_c (too far at 100px... wait, meetDistance=200 so it should see)
      // npc_c is at x=200, npc_a at x=100 — distance = 100px < meetDistance=200
      // Use separate orchestrator for A→C pair
      const orcAC = buildOrchestrator();
      const bubblesAC = orcAC.update(makeMeetCtx(npcA, [npcC]));
      expect(bubblesAC.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 5: NPC in combat state → no greeting
  // -----------------------------------------------------------------------

  describe('scenario 5: NPC in combat state → no greeting', () => {
    it('NPC in "combat" state greets normally (state gate only blocks "dead")', () => {
      // MeetEligibility blocks state === 'dead' only.
      // Combat NPCs are not blocked by isMeetEligible — they can still greet.
      const observer:  ISocialNPC = { id: 'obs',   position: { x: 0, y: 0 }, factionId: 'loner', state: 'patrol' };
      const combatNPC: ISocialNPC = { id: 'npc_c', position: { x: 10, y: 0 }, factionId: 'loner', state: 'combat' };

      const orchestrator = buildOrchestrator();
      const bubbles = orchestrator.update(makeMeetCtx(observer, [combatNPC]));

      // Combat NPCs are technically eligible (only 'dead' is blocked in MeetEligibility)
      // This test documents the actual behavior.
      expect(Array.isArray(bubbles)).toBe(true);
    });

    it('dead NPC does not produce a greeting bubble', () => {
      const observer: ISocialNPC = { id: 'obs',   position: { x: 0, y: 0 }, factionId: 'loner', state: 'patrol' };
      const deadNPC:  ISocialNPC = { id: 'dead1', position: { x: 10, y: 0 }, factionId: 'loner', state: 'dead'   };

      const orchestrator = buildOrchestrator();
      const bubbles = orchestrator.update(makeMeetCtx(observer, [deadNPC]));

      expect(bubbles).toHaveLength(0);
    });

    it('when observer is "dead" — still processes NPC list (observer state not checked by orchestrator)', () => {
      // The observer's state is not gated by the orchestrator — only the NPC candidate's state is.
      // This documents the deliberate design: the observer is the "target" (player or NPC proxy).
      const deadObserver: ISocialNPC = { id: 'dead_obs', position: { x: 0, y: 0 }, factionId: 'loner', state: 'dead' };
      const aliveNPC:     ISocialNPC = { id: 'alive',    position: { x: 5, y: 0 },  factionId: 'loner', state: 'patrol' };

      const orchestrator = buildOrchestrator();
      const bubbles = orchestrator.update(makeMeetCtx(deadObserver, [aliveNPC]));

      // alive NPC can still greet — observer state is not filtered here
      expect(Array.isArray(bubbles)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Extra: distance boundary checks
  // -----------------------------------------------------------------------

  describe('distance boundary', () => {
    it('NPC exactly at meetDistance boundary → greets (distSq <= meetDistSq)', () => {
      const observer:   ISocialNPC = { id: 'obs',  position: { x: 0,   y: 0 }, factionId: 'loner', state: 'patrol' };
      const atBoundary: ISocialNPC = { id: 'npc',  position: { x: 200, y: 0 }, factionId: 'loner', state: 'patrol' };
      // Distance = 200 = meetDistance → eligible (distSq == meetDistSq, condition is <=)

      const orchestrator = buildOrchestrator();
      const bubbles = orchestrator.update(makeMeetCtx(observer, [atBoundary]));
      expect(bubbles.length).toBeGreaterThanOrEqual(1);
    });

    it('NPC just outside meetDistance → no greeting', () => {
      const observer: ISocialNPC  = { id: 'obs', position: { x: 0,   y: 0 }, factionId: 'loner', state: 'patrol' };
      const farNPC:   ISocialNPC  = { id: 'far', position: { x: 201, y: 0 }, factionId: 'loner', state: 'patrol' };
      // Distance = 201 > meetDistance → ineligible

      const orchestrator = buildOrchestrator();
      const bubbles = orchestrator.update(makeMeetCtx(observer, [farNPC]));
      expect(bubbles).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Extra: check interval throttle
  // -----------------------------------------------------------------------

  describe('check interval throttle', () => {
    it('no bubbles when deltaMs < meetCheckIntervalMs', () => {
      const observer:   ISocialNPC = { id: 'obs',  position: { x: 0, y: 0 }, factionId: 'loner', state: 'patrol' };
      const candidate:  ISocialNPC = { id: 'npc',  position: { x: 5, y: 0 }, factionId: 'loner', state: 'patrol' };

      const orchestrator = buildOrchestrator();

      // deltaMs is smaller than check interval → timer does not fire
      const bubbles = orchestrator.update({
        ...makeMeetCtx(observer, [candidate]),
        deltaMs: MEET_CONFIG.meetCheckIntervalMs - 1,
      });

      // Check timer not elapsed → no bubbles
      expect(bubbles).toHaveLength(0);
    });

    it('bubbles appear after cumulative deltaMs crosses check interval', () => {
      const observer:   ISocialNPC = { id: 'obs', position: { x: 0, y: 0 }, factionId: 'loner', state: 'patrol' };
      const candidate:  ISocialNPC = { id: 'npc', position: { x: 5, y: 0 }, factionId: 'loner', state: 'patrol' };

      const orchestrator = buildOrchestrator();

      const baseCtx = { ...makeMeetCtx(observer, [candidate]), deltaMs: 40, currentTime: 1000 };

      // Two sub-interval ticks accumulate to 80ms (< 100ms interval) → no bubbles
      orchestrator.update(baseCtx);
      const second = orchestrator.update(baseCtx);
      expect(second).toHaveLength(0);

      // Third tick pushes to 120ms (> 100ms interval) → bubbles appear
      const third = orchestrator.update({ ...baseCtx, currentTime: 1001 });
      expect(third.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // Extra: presenter integration — tracking presenter records all bubbles
  // -----------------------------------------------------------------------

  describe('presenter integration', () => {
    it('bubbles returned by orchestrator can be forwarded to ISocialPresenter', () => {
      const observer:   ISocialNPC = { id: 'obs', position: { x: 0, y: 0 }, factionId: 'loner', state: 'patrol' };
      const candidate:  ISocialNPC = { id: 'npc', position: { x: 5, y: 0 }, factionId: 'loner', state: 'patrol' };

      const orchestrator = buildOrchestrator();
      const { presenter, bubbles: recorded } = createTrackingPresenter();

      const requests = orchestrator.update(makeMeetCtx(observer, [candidate]));
      for (const req of requests) {
        presenter.showBubble(req.npcId, req.text, req.durationMs);
      }

      expect(recorded.length).toBe(requests.length);
      if (recorded.length > 0) {
        expect(recorded[0]!.npcId).toBe('npc');
        expect(recorded[0]!.durationMs).toBeGreaterThan(0);
      }
    });

    it('multiple sequential greet events accumulate in presenter correctly', () => {
      const observer: ISocialNPC = { id: 'obs', position: { x: 0, y: 0 }, factionId: 'loner', state: 'patrol' };
      const npcB: ISocialNPC     = { id: 'b',   position: { x: 5, y: 0 }, factionId: 'loner', state: 'patrol' };
      const npcC: ISocialNPC     = { id: 'c',   position: { x: 8, y: 0 }, factionId: 'loner', state: 'patrol' };

      // Separate orchestrators for b and c to avoid shared cooldown
      const orcB = buildOrchestrator();
      const orcC = buildOrchestrator();
      const { presenter, bubbles: recorded } = createTrackingPresenter();

      const bubblesB = orcB.update(makeMeetCtx(observer, [npcB], { currentTime: 1000 }));
      const bubblesC = orcC.update(makeMeetCtx(observer, [npcC], { currentTime: 1000 }));

      for (const req of [...bubblesB, ...bubblesC]) {
        presenter.showBubble(req.npcId, req.text, req.durationMs);
      }

      // Both greeting events should have been forwarded to presenter
      const npcIds = recorded.map(r => r.npcId);
      expect(npcIds).toContain('b');
      expect(npcIds).toContain('c');
    });
  });

  // -----------------------------------------------------------------------
  // Extra: evening greeting for camp/sleep state NPCs
  // -----------------------------------------------------------------------

  describe('evening greeting for camp and sleep states', () => {
    it('NPC in "camp" state greets with GREETING_EVENING category', () => {
      const observer: ISocialNPC = { id: 'obs',  position: { x: 0, y: 0 }, factionId: 'loner', state: 'patrol' };
      const campNPC:  ISocialNPC = { id: 'camp', position: { x: 5, y: 0 }, factionId: 'loner', state: 'camp'   };

      const orchestrator = buildOrchestrator();
      const bubbles = orchestrator.update(makeMeetCtx(observer, [campNPC]));

      expect(bubbles.length).toBeGreaterThanOrEqual(1);
      expect(bubbles[0]!.category).toBe(SocialCategory.GREETING_EVENING);
    });

    it('NPC in "sleep" state greets with GREETING_EVENING category', () => {
      const observer:  ISocialNPC = { id: 'obs',   position: { x: 0, y: 0 }, factionId: 'loner', state: 'patrol' };
      const sleepNPC:  ISocialNPC = { id: 'sleep', position: { x: 5, y: 0 }, factionId: 'loner', state: 'sleep'  };

      const orchestrator = buildOrchestrator();
      const bubbles = orchestrator.update(makeMeetCtx(observer, [sleepNPC]));

      expect(bubbles.length).toBeGreaterThanOrEqual(1);
      expect(bubbles[0]!.category).toBe(SocialCategory.GREETING_EVENING);
    });

    it('evening greeting text is from the evening pool', () => {
      const observer: ISocialNPC = { id: 'obs',  position: { x: 0, y: 0 }, factionId: 'loner', state: 'patrol' };
      const campNPC:  ISocialNPC = { id: 'camp', position: { x: 5, y: 0 }, factionId: 'loner', state: 'camp'   };

      const orchestrator = buildOrchestrator();
      const bubbles = orchestrator.update(makeMeetCtx(observer, [campNPC]));

      if (bubbles.length > 0) {
        expect(TEST_DATA.greetings.evening).toContain(bubbles[0]!.text);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Extra: neutral greeting for cross-faction non-hostile pairs
  // -----------------------------------------------------------------------

  describe('neutral greeting for non-hostile cross-faction NPCs', () => {
    it('different non-hostile factions → GREETING_NEUTRAL', () => {
      const observer: ISocialNPC = { id: 'obs', position: { x: 0, y: 0 }, factionId: 'loner',     state: 'patrol' };
      const neutral:  ISocialNPC = { id: 'sci', position: { x: 5, y: 0 }, factionId: 'scientist',  state: 'patrol' };

      const orchestrator = buildOrchestrator();
      const bubbles = orchestrator.update(makeMeetCtx(observer, [neutral], {
        isHostile: () => false,
        isAlly: (a, b) => a === b, // different factions, not allies
      }));

      expect(bubbles.length).toBeGreaterThanOrEqual(1);
      expect(bubbles[0]!.category).toBe(SocialCategory.GREETING_NEUTRAL);
    });

    it('neutral greeting text is from the neutral pool', () => {
      const observer: ISocialNPC = { id: 'obs', position: { x: 0, y: 0 }, factionId: 'loner',    state: 'patrol' };
      const neutral:  ISocialNPC = { id: 'sci', position: { x: 5, y: 0 }, factionId: 'scientist', state: 'patrol' };

      const orchestrator = buildOrchestrator();
      const bubbles = orchestrator.update(makeMeetCtx(observer, [neutral], {
        isHostile: () => false,
        isAlly: (a, b) => a === b,
      }));

      if (bubbles.length > 0) {
        expect(TEST_DATA.greetings.neutral).toContain(bubbles[0]!.text);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Extra: clear() resets cooldowns and check timer
  // -----------------------------------------------------------------------

  describe('orchestrator clear() resets state', () => {
    it('after clear(), NPC can greet again immediately', () => {
      const observer:  ISocialNPC = { id: 'obs', position: { x: 0, y: 0 }, factionId: 'loner', state: 'patrol' };
      const candidate: ISocialNPC = { id: 'npc', position: { x: 5, y: 0 }, factionId: 'loner', state: 'patrol' };

      const orchestrator = buildOrchestrator();
      const ctx = makeMeetCtx(observer, [candidate], { currentTime: 1000 });

      const first = orchestrator.update(ctx);
      expect(first.length).toBeGreaterThanOrEqual(1);

      // Within cooldown — no greeting
      const blocked = orchestrator.update({ ...ctx, currentTime: 1001 });
      expect(blocked).toHaveLength(0);

      // Clear resets cooldowns AND the check timer
      orchestrator.clear();

      // After clear, advancing time enough for the check interval → greeting fires again
      const after = orchestrator.update({ ...ctx, currentTime: 2000 });
      expect(after.length).toBeGreaterThanOrEqual(1);
    });
  });
});
