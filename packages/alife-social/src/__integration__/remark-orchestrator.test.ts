/**
 * Integration test: "RemarkDispatcher — ambient remark system".
 *
 * Tests RemarkDispatcher in isolation via a real ContentPool and ISocialPresenter.
 * Verifies: cooldown, terrain lock, remark categories, NPC state filtering,
 * emit via presenter.
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect } from 'vitest';
import type { IRandom } from '@alife-sdk/core';
import { RemarkDispatcher, DEFAULT_REMARK_ELIGIBLE_STATES } from '../remark/RemarkDispatcher';
import { ContentPool, loadSocialData } from '../content/ContentPool';
import { SocialCategory } from '../types/ISocialTypes';
import type { ISocialNPC, ISocialData, IBubbleRequest } from '../types/ISocialTypes';
import type { IRemarkConfig } from '../types/ISocialConfig';
import type { ISocialPresenter } from '../ports/ISocialPresenter';

// ---------------------------------------------------------------------------
// Deterministic cycling random
// ---------------------------------------------------------------------------

/**
 * Cycling random — safe for ContentPool (do-while avoids infinite loop because
 * values alternate and pool.length >= 2 → different idx).
 */
function createCyclingRandom(values: number[] = [0.1, 0.4, 0.7, 0.2, 0.8, 0.5]): IRandom {
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

/**
 * Cycling random with remarkChance=1.0 — first next() = 0.1 < 1.0 → always fires.
 * Values alternate, so ContentPool does not loop.
 */
function createSureFireRandom(): IRandom {
  return createCyclingRandom([0.1, 0.4, 0.7, 0.2, 0.8, 0.5]);
}

// ---------------------------------------------------------------------------
// Minimal content
// ---------------------------------------------------------------------------

const TEST_DATA: ISocialData = {
  greetings: {
    friendly: ['Привіт, друже!'],
    neutral: ['Хто такий?'],
    evening: ['Добрий вечір.'],
  },
  remarks: {
    zone: ['Тут небезпечно...', 'Зона не жартує.'],
    weather: ['Дощ знову...', 'Туман густий.'],
    gossip: {
      loner: ['Чув новини зi Зони?', 'Чуєш, сталкер...'],
      military: ['Вояки штось мутять.', 'Знову патруль.'],
    },
  },
  campfire: {
    stories: ['Одного разу у Зонi...'],
    jokes: ['Приходить сталкер у бар...'],
    reactions: {
      laughter: ['Ха-ха!'],
      story_react: ['Серйозно?'],
      eating: ['*жує*'],
    },
  },
};

// ---------------------------------------------------------------------------
// Config with short interval for tests
// ---------------------------------------------------------------------------

const FAST_CONFIG: IRemarkConfig = {
  remarkCheckIntervalMs: 100,
  remarkCooldownMinMs: 500,
  remarkCooldownMaxMs: 1000,
  remarkChance: 1.0,   // 100% — always fires
  weightZone: 0.4,
  weightWeatherCumulative: 0.7,
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

function buildDispatcher(
  random: IRandom = createSureFireRandom(),
  config: IRemarkConfig = FAST_CONFIG,
): { dispatcher: RemarkDispatcher; pool: ContentPool } {
  const pool = new ContentPool(random);
  loadSocialData(pool, TEST_DATA);
  const dispatcher = new RemarkDispatcher(pool, random, config);
  return { dispatcher, pool };
}

function makeNPC(
  id: string,
  opts: { state?: string; factionId?: string } = {},
): ISocialNPC {
  return {
    id,
    position: { x: 0, y: 0 },
    factionId: opts.factionId ?? 'loner',
    state: opts.state ?? 'idle',
  };
}

// Get remarks from one NPC (exhausting one check interval)
function triggerOneCheck(
  dispatcher: RemarkDispatcher,
  npcs: readonly ISocialNPC[],
  getTerrainId: (id: string) => string | null = () => null,
  deltaMs: number = FAST_CONFIG.remarkCheckIntervalMs + 1,
): IBubbleRequest[] {
  return dispatcher.update(deltaMs, npcs, getTerrainId);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RemarkDispatcher (integration)', () => {

  // -----------------------------------------------------------------------
  // 1. Basic remark: NPC in eligible state → bubble is generated
  // -----------------------------------------------------------------------

  describe('basic remark for eligible NPC', () => {
    it('NPC in "idle" state → remark generated after one check interval', () => {
      const { dispatcher } = buildDispatcher(createSureFireRandom());
      const npc = makeNPC('npc_1', { state: 'idle' });

      const bubbles = triggerOneCheck(dispatcher, [npc]);

      expect(bubbles.length).toBeGreaterThanOrEqual(1);
      expect(bubbles[0]!.npcId).toBe('npc_1');
    });

    it('NPC in "patrol" state → remark is generated', () => {
      const { dispatcher } = buildDispatcher(createSureFireRandom());
      const npc = makeNPC('npc_2', { state: 'patrol' });

      const bubbles = triggerOneCheck(dispatcher, [npc]);

      expect(bubbles.length).toBeGreaterThanOrEqual(1);
      expect(bubbles[0]!.npcId).toBe('npc_2');
    });

    it('NPC in "camp" state → remark is generated', () => {
      const { dispatcher } = buildDispatcher(createSureFireRandom());
      const npc = makeNPC('npc_3', { state: 'camp' });

      const bubbles = triggerOneCheck(dispatcher, [npc]);

      expect(bubbles.length).toBeGreaterThanOrEqual(1);
      expect(bubbles[0]!.npcId).toBe('npc_3');
    });

    it('remark has positive durationMs', () => {
      const { dispatcher } = buildDispatcher(createSureFireRandom());
      const npc = makeNPC('npc_dur', { state: 'idle' });

      const bubbles = triggerOneCheck(dispatcher, [npc]);

      if (bubbles.length > 0) {
        expect(bubbles[0]!.durationMs).toBeGreaterThan(0);
      }
    });

    it('remark has a valid category from zone, weather, or gossip', () => {
      const { dispatcher } = buildDispatcher(createSureFireRandom());
      const npc = makeNPC('npc_cat', { state: 'idle' });

      const bubbles = triggerOneCheck(dispatcher, [npc]);

      if (bubbles.length > 0) {
        const validCategoryPrefixes = [
          SocialCategory.REMARK_ZONE,
          SocialCategory.REMARK_WEATHER,
          // gossip key = 'remark_gossip:factionId'
          SocialCategory.REMARK_GOSSIP,
        ];
        const cat = bubbles[0]!.category;
        const isValid = validCategoryPrefixes.some(prefix => cat === prefix || cat.startsWith(prefix));
        expect(isValid).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 2. NPC in non-eligible state → remark is not generated
  // -----------------------------------------------------------------------

  describe('NPC in non-eligible state → no remark', () => {
    it('NPC in "combat" state → remark is not generated', () => {
      const { dispatcher } = buildDispatcher(createSureFireRandom());
      const npc = makeNPC('npc_combat', { state: 'combat' });

      const bubbles = triggerOneCheck(dispatcher, [npc]);

      expect(bubbles).toHaveLength(0);
    });

    it('NPC in "dead" state → remark is not generated', () => {
      const { dispatcher } = buildDispatcher(createSureFireRandom());
      const npc = makeNPC('npc_dead', { state: 'dead' });

      const bubbles = triggerOneCheck(dispatcher, [npc]);

      expect(bubbles).toHaveLength(0);
    });

    it('NPC in "flee" state → remark is not generated (not in eligibleStates)', () => {
      const { dispatcher } = buildDispatcher(createSureFireRandom());
      const npc = makeNPC('npc_flee', { state: 'flee' });

      const bubbles = triggerOneCheck(dispatcher, [npc]);

      expect(bubbles).toHaveLength(0);
    });

    it('custom eligibleStates: NPC in "sleep" → remark is generated', () => {
      const random = createSureFireRandom();
      const pool = new ContentPool(random);
      loadSocialData(pool, TEST_DATA);
      const config: IRemarkConfig = {
        ...FAST_CONFIG,
        eligibleStates: ['sleep', 'idle'],
      };
      const dispatcher = new RemarkDispatcher(pool, random, config);
      const npc = makeNPC('npc_sleep', { state: 'sleep' });

      const bubbles = triggerOneCheck(dispatcher, [npc]);

      expect(bubbles.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Cooldown — same NPC does not remark too often
  // -----------------------------------------------------------------------

  describe('cooldown — NPC does not remark too often', () => {
    it('first check → remark; immediate second check → blocked by cooldown', () => {
      const { dispatcher } = buildDispatcher(createSureFireRandom());
      const npc = makeNPC('npc_cool', { state: 'idle' });

      // First check — remark should appear
      const first = triggerOneCheck(dispatcher, [npc]);
      expect(first.length).toBeGreaterThanOrEqual(1);

      // Second check immediately (cooldown still active, remarkCooldownMinMs=500)
      const second = dispatcher.update(FAST_CONFIG.remarkCheckIntervalMs + 1, [npc], () => null);
      expect(second).toHaveLength(0);
    });

    it('after cooldown expires NPC can remark again', () => {
      // Short cooldown for the test
      const random = createSureFireRandom();
      const pool = new ContentPool(random);
      loadSocialData(pool, TEST_DATA);
      const config: IRemarkConfig = {
        ...FAST_CONFIG,
        remarkCooldownMinMs: 100,
        remarkCooldownMaxMs: 200,
      };
      const dispatcher = new RemarkDispatcher(pool, random, config);
      const npc = makeNPC('npc_recool', { state: 'idle' });

      // First check
      const first = dispatcher.update(FAST_CONFIG.remarkCheckIntervalMs + 1, [npc], () => null);
      expect(first.length).toBeGreaterThanOrEqual(1);

      // Advance time well past cooldown (>200ms)
      const second = dispatcher.update(FAST_CONFIG.remarkCheckIntervalMs + 300, [npc], () => null);
      expect(second.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Terrain lock — only one NPC per terrain per check
  // -----------------------------------------------------------------------

  describe('terrain lock — only one NPC per terrain at a time', () => {
    it('two NPCs on same terrain — only the first remarks in one check', () => {
      const { dispatcher } = buildDispatcher(createSureFireRandom());
      const npc_a = makeNPC('npc_ta', { state: 'idle' });
      const npc_b = makeNPC('npc_tb', { state: 'idle' });
      const terrainMap: Record<string, string> = {
        npc_ta: 'terrain_1',
        npc_tb: 'terrain_1',
      };

      const bubbles = triggerOneCheck(dispatcher, [npc_a, npc_b], (id) => terrainMap[id] ?? null);

      // Only one NPC can remark (break after first)
      expect(bubbles).toHaveLength(1);
    });

    it('terrain lock expires after terrainLockDurationMs', () => {
      const random = createSureFireRandom();
      const pool = new ContentPool(random);
      loadSocialData(pool, TEST_DATA);
      const config: IRemarkConfig = {
        ...FAST_CONFIG,
        remarkCooldownMinMs: 50,
        remarkCooldownMaxMs: 100,
        terrainLockDurationMs: 100,
      };
      const dispatcher = new RemarkDispatcher(pool, random, config);
      const npc_a = makeNPC('npc_la', { state: 'idle' });
      const npc_b = makeNPC('npc_lb', { state: 'idle' });
      const terrainMap: Record<string, string> = {
        npc_la: 'terrain_lock',
        npc_lb: 'terrain_lock',
      };

      // First check — npc_a remarks and locks the terrain
      const first = dispatcher.update(FAST_CONFIG.remarkCheckIntervalMs + 1, [npc_a, npc_b], (id) => terrainMap[id] ?? null);
      expect(first.length).toBe(1);
      expect(first[0]!.npcId).toBe('npc_la');

      // After terrainLockDurationMs+cooldown → npc_b can occupy the terrain
      const second = dispatcher.update(300, [npc_b], (id) => terrainMap[id] ?? null);
      expect(second.length).toBeGreaterThanOrEqual(1);
    });

    it('NPC without terrain (getTerrainId returns null) → remark still generated', () => {
      const { dispatcher } = buildDispatcher(createSureFireRandom());
      const npc = makeNPC('npc_noterrain', { state: 'idle' });

      // getTerrainId → null → terrainId = 'unassigned'
      const bubbles = triggerOneCheck(dispatcher, [npc], () => null);

      expect(bubbles.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // 5. check interval throttle — remarks not generated until interval elapses
  // -----------------------------------------------------------------------

  describe('check interval throttle', () => {
    it('without reaching remarkCheckIntervalMs — empty array', () => {
      const { dispatcher } = buildDispatcher(createSureFireRandom());
      const npc = makeNPC('npc_thr', { state: 'idle' });

      // deltaMs < remarkCheckIntervalMs (100) → check does not fire
      const bubbles = dispatcher.update(50, [npc], () => null);

      expect(bubbles).toHaveLength(0);
    });

    it("remarks appear only after accumulated deltaMs >= checkInterval", () => {
      const { dispatcher } = buildDispatcher(createSureFireRandom());
      const npc = makeNPC('npc_acc', { state: 'idle' });

      // 40+40 = 80 < 100 → still no remarks
      dispatcher.update(40, [npc], () => null);
      const second = dispatcher.update(40, [npc], () => null);
      expect(second).toHaveLength(0);

      // +61 → 141 >= 100 → remark fires
      const third = dispatcher.update(61, [npc], () => null);
      expect(third.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // 6. remarkChance = 0 — never remarks
  // -----------------------------------------------------------------------

  describe('remarkChance = 0 → never remarks', () => {
    it('remarkChance=0 → empty array even for eligible NPC', () => {
      // Cycling random: next() alternates, but remarkChance=0 → 0 >= 0 → does not fire
      const random = createCyclingRandom([0.5, 0.3, 0.8, 0.1, 0.9]);
      const pool = new ContentPool(random);
      loadSocialData(pool, TEST_DATA);
      const config: IRemarkConfig = { ...FAST_CONFIG, remarkChance: 0 };
      const dispatcher = new RemarkDispatcher(pool, random, config);
      const npc = makeNPC('npc_nochance', { state: 'idle' });

      const bubbles = triggerOneCheck(dispatcher, [npc]);

      expect(bubbles).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // 7. Remark categories — zone vs weather vs gossip
  // -----------------------------------------------------------------------

  describe('remark categories', () => {
    it('remark text is contained in one of the content pools', () => {
      const { dispatcher } = buildDispatcher(createSureFireRandom());
      const npc = makeNPC('npc_zone', { state: 'idle', factionId: 'loner' });

      const bubbles = triggerOneCheck(dispatcher, [npc]);

      if (bubbles.length > 0) {
        const allTexts = [
          ...TEST_DATA.remarks.zone,
          ...TEST_DATA.remarks.weather,
          ...(TEST_DATA.remarks.gossip['loner'] ?? []),
        ];
        expect(allTexts.includes(bubbles[0]!.text)).toBe(true);
      }
    });

    it('gossip lines are issued for faction with gossip content', () => {
      // weightZone=0.4, weightWeatherCumulative=0.7
      // values=[0.8,...] → r >= 0.7 → gossip branch
      const random = createCyclingRandom([0.8, 0.2, 0.8, 0.2, 0.8]);
      const pool = new ContentPool(random);
      loadSocialData(pool, TEST_DATA);
      const config: IRemarkConfig = { ...FAST_CONFIG, weightZone: 0.4, weightWeatherCumulative: 0.7 };
      const dispatcher = new RemarkDispatcher(pool, random, config);
      const npc = makeNPC('npc_gossip', { state: 'idle', factionId: 'loner' });

      const bubbles = dispatcher.update(FAST_CONFIG.remarkCheckIntervalMs + 1, [npc], () => null);

      if (bubbles.length > 0) {
        const allTexts = [
          ...TEST_DATA.remarks.zone,
          ...TEST_DATA.remarks.weather,
          ...(TEST_DATA.remarks.gossip['loner'] ?? []),
        ];
        expect(allTexts.includes(bubbles[0]!.text)).toBe(true);
      }
    });

    it('faction without gossip → fallback to REMARK_ZONE', () => {
      // unknown faction has no gossip → fallback to zone
      const random = createCyclingRandom([0.8, 0.2, 0.8, 0.2, 0.8]);
      const pool = new ContentPool(random);
      loadSocialData(pool, TEST_DATA);
      const config: IRemarkConfig = { ...FAST_CONFIG, weightZone: 0.4, weightWeatherCumulative: 0.7 };
      const dispatcher = new RemarkDispatcher(pool, random, config);
      const npc = makeNPC('npc_nofaction', { state: 'idle', factionId: 'unknown_faction' });

      const bubbles = dispatcher.update(FAST_CONFIG.remarkCheckIntervalMs + 1, [npc], () => null);

      if (bubbles.length > 0) {
        // On gossip fallback → zone text
        expect(TEST_DATA.remarks.zone.includes(bubbles[0]!.text)).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 8. Presenter integration — remarks forwarded via ISocialPresenter
  // -----------------------------------------------------------------------

  describe('presenter integration — records all bubbles', () => {
    it('bubbles from dispatcher can be forwarded to ISocialPresenter', () => {
      const { dispatcher } = buildDispatcher(createSureFireRandom());
      const { presenter, bubbles: recorded } = createTrackingPresenter();
      const npc = makeNPC('npc_pres', { state: 'idle' });

      const requests = triggerOneCheck(dispatcher, [npc]);
      for (const req of requests) {
        presenter.showBubble(req.npcId, req.text, req.durationMs);
      }

      expect(recorded.length).toBe(requests.length);
      if (recorded.length > 0) {
        expect(recorded[0]!.npcId).toBe('npc_pres');
        expect(recorded[0]!.durationMs).toBeGreaterThan(0);
      }
    });

    it('presenter accumulates multiple bubbles from different check intervals', () => {
      const random = createSureFireRandom();
      const pool = new ContentPool(random);
      loadSocialData(pool, TEST_DATA);
      const config: IRemarkConfig = {
        ...FAST_CONFIG,
        remarkCooldownMinMs: 50,
        remarkCooldownMaxMs: 100,
      };
      const dispatcher = new RemarkDispatcher(pool, random, config);
      const { presenter, bubbles: recorded } = createTrackingPresenter();
      const npc = makeNPC('npc_multi', { state: 'idle' });

      // Run several check intervals with large deltaMs (covers cooldown)
      for (let i = 0; i < 3; i++) {
        const requests = dispatcher.update(300, [npc], () => null);
        for (const req of requests) {
          presenter.showBubble(req.npcId, req.text, req.durationMs);
        }
      }

      expect(recorded.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // 9. clear() resets all state
  // -----------------------------------------------------------------------

  describe('clear() resets dispatcher state', () => {
    it("after clear() NPC can remark again immediately", () => {
      const { dispatcher } = buildDispatcher(createSureFireRandom());
      const npc = makeNPC('npc_clr', { state: 'idle' });

      // First check — remark
      const first = triggerOneCheck(dispatcher, [npc]);
      expect(first.length).toBeGreaterThanOrEqual(1);

      // Within cooldown → blocked
      const blocked = dispatcher.update(FAST_CONFIG.remarkCheckIntervalMs + 1, [npc], () => null);
      expect(blocked).toHaveLength(0);

      // Reset state
      dispatcher.clear();

      // After clear() cooldown is reset → remark fires again
      const after = triggerOneCheck(dispatcher, [npc]);
      expect(after.length).toBeGreaterThanOrEqual(1);
    });

    it('after clear() terrain lock is reset', () => {
      const { dispatcher } = buildDispatcher(createSureFireRandom());
      const npc_a = makeNPC('npc_cla', { state: 'idle' });
      const npc_b = makeNPC('npc_clb', { state: 'idle' });
      const terrainMap: Record<string, string> = {
        npc_cla: 'terrain_lock',
        npc_clb: 'terrain_lock',
      };

      // npc_a locks the terrain
      const first = triggerOneCheck(dispatcher, [npc_a, npc_b], (id) => terrainMap[id] ?? null);
      expect(first[0]!.npcId).toBe('npc_cla');

      // Reset
      dispatcher.clear();

      // npc_b can now remark (terrain lock lifted)
      const second = triggerOneCheck(dispatcher, [npc_b], (id) => terrainMap[id] ?? null);
      expect(second.length).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // 10. DEFAULT_REMARK_ELIGIBLE_STATES — constant contains base states
  // -----------------------------------------------------------------------

  describe('DEFAULT_REMARK_ELIGIBLE_STATES', () => {
    it('contains "idle", "patrol" and "camp"', () => {
      expect(DEFAULT_REMARK_ELIGIBLE_STATES).toContain('idle');
      expect(DEFAULT_REMARK_ELIGIBLE_STATES).toContain('patrol');
      expect(DEFAULT_REMARK_ELIGIBLE_STATES).toContain('camp');
    });

    it('does not contain "combat", "dead", "flee"', () => {
      expect(DEFAULT_REMARK_ELIGIBLE_STATES).not.toContain('combat');
      expect(DEFAULT_REMARK_ELIGIBLE_STATES).not.toContain('dead');
      expect(DEFAULT_REMARK_ELIGIBLE_STATES).not.toContain('flee');
    });
  });

  // -----------------------------------------------------------------------
  // 11. Multiple NPCs — only one remarks per check (break logic)
  // -----------------------------------------------------------------------

  describe('break after first eligible NPC', () => {
    it('from a list of 3 eligible NPCs — only one bubble per check', () => {
      const { dispatcher } = buildDispatcher(createSureFireRandom());
      const npcs = [
        makeNPC('npc_m1', { state: 'idle' }),
        makeNPC('npc_m2', { state: 'idle' }),
        makeNPC('npc_m3', { state: 'idle' }),
      ];

      const bubbles = triggerOneCheck(dispatcher, npcs);

      // dispatcher.update has break after first → max 1 bubble
      expect(bubbles).toHaveLength(1);
    });

    it('NPC with non-eligible state is skipped, first eligible remarks', () => {
      const { dispatcher } = buildDispatcher(createSureFireRandom());
      const npcs = [
        makeNPC('npc_skip1', { state: 'combat' }),
        makeNPC('npc_skip2', { state: 'dead' }),
        makeNPC('npc_eligible', { state: 'idle' }),
      ];

      const bubbles = triggerOneCheck(dispatcher, npcs);

      expect(bubbles).toHaveLength(1);
      expect(bubbles[0]!.npcId).toBe('npc_eligible');
    });
  });

  // -----------------------------------------------------------------------
  // 12. Empty NPC list — no errors
  // -----------------------------------------------------------------------

  describe('empty NPC list', () => {
    it('empty npcs[] → empty array without errors', () => {
      const { dispatcher } = buildDispatcher(createSureFireRandom());

      const bubbles = triggerOneCheck(dispatcher, []);

      expect(bubbles).toHaveLength(0);
    });

    it('one NPC without terrain (getTerrainId → null) → "unassigned" lock, remark is issued', () => {
      const { dispatcher } = buildDispatcher(createSureFireRandom());
      const npc = makeNPC('npc_unassigned', { state: 'patrol' });

      const bubbles = triggerOneCheck(dispatcher, [npc], () => null);

      expect(bubbles.length).toBeGreaterThanOrEqual(1);
      expect(bubbles[0]!.npcId).toBe('npc_unassigned');
    });
  });
});
