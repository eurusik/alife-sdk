// states/handlers/CombatState.cover-cooldown.test.ts
// Unit tests for the seek-cover cooldown fix in CombatState.
//
// Fix: `lastSeekCoverMs` field + 3000ms cooldown guard on the cover transition.
// Cover transition only fires when `now - lastSeekCoverMs >= 3000`.
//
// Test matrix:
//   1. First entry  — lastSeekCoverMs=0, now=3001 → cover IS sought.
//   2. Within cooldown — lastSeekCoverMs updated, now < lastSeekCoverMs+3000 → cover NOT sought.
//   3. After cooldown  — now >= lastSeekCoverMs+3000 → cover IS sought again.
//   4. Timestamp write — lastSeekCoverMs is set to `now` when transition fires.

import { describe, it, expect, beforeEach } from 'vitest';
import { CombatState } from './CombatState';
import { createDefaultStateConfig } from '../IStateConfig';
import { createDefaultNPCOnlineState } from '../NPCOnlineState';
import type { INPCContext } from '../INPCContext';
import type { ICoverAccess } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';

// ---------------------------------------------------------------------------
// Constants mirroring the implementation — keeps tests explicit.
// ---------------------------------------------------------------------------

const COVER_COOLDOWN_MS = 3000;

// ---------------------------------------------------------------------------
// Mock builder
// ---------------------------------------------------------------------------

interface CoverCooldownOverrides {
  /** ctx.now() return value. */
  nowMs?: number;
  /** Whether a cover point is available (null cover blocks transition). */
  coverAvailable?: boolean;
  /** Pre-set lastSeekCoverMs on state before the update call. */
  lastSeekCoverMs?: number;
}

/**
 * Build a minimal INPCContext for cover-cooldown tests.
 *
 * NPC is fixed at (100, 100). The enemy is placed at (150, 100) so that
 * `dist` (50) < default `combatRange` (200), keeping the NPC in the
 * halt-and-check-cover branch on every call.
 *
 * HP is healthy (hpPercent = 1), morale is STABLE, and no wounded enemies
 * are visible — so none of the early-return guards fire before the cover check.
 */
function makeCoverCooldownCtx(overrides: CoverCooldownOverrides = {}): {
  ctx: INPCContext;
  calls: string[];
  state: ReturnType<typeof createDefaultNPCOnlineState>;
  setNow: (ms: number) => void;
} {
  const calls: string[] = [];
  const state = createDefaultNPCOnlineState();

  if (overrides.lastSeekCoverMs !== undefined) {
    state.lastSeekCoverMs = overrides.lastSeekCoverMs;
  }

  let nowMs = overrides.nowMs ?? 0;

  const coverPoint = { x: 90, y: 90 };
  const mockCover: ICoverAccess | null =
    overrides.coverAvailable !== false
      ? { findCover: () => coverPoint }
      : null;

  const ctx: INPCContext = {
    npcId: 'npc-cover-test',
    factionId: 'stalker',
    entityType: 'human',
    x: 100,
    y: 100,
    state,
    currentStateId: 'COMBAT',
    perception: {
      // Enemy inside combatRange so NPC halts and reaches cover-check branch.
      getVisibleEnemies: () => [{ id: 'e1', x: 150, y: 100, factionId: 'bandit' }],
      getVisibleAllies:  () => [],
      getNearbyItems:    () => [],
      hasVisibleEnemy:   () => true,
      // No wounded enemies — skip kill-wounded seam.
      getWoundedEnemies: () => [],
    },
    health: {
      hp: 100,
      maxHp: 100,
      hpPercent: 1,
      heal: () => {},
    },
    setVelocity: (vx, vy) => { calls.push(`vel:${vx.toFixed(0)},${vy.toFixed(0)}`); },
    halt:        ()       => { calls.push('halt'); },
    setRotation: (r)      => { calls.push(`rot:${r.toFixed(2)}`); },
    setAlpha:    (a)      => { calls.push(`alpha:${a}`); },
    teleport:    ()       => {},
    disablePhysics: ()    => {},
    transition:  (s)      => { calls.push(`transition:${s}`); },
    emitShoot:   (p)      => { calls.push(`shoot:${p.weaponType}`); },
    emitMeleeHit:       ()  => {},
    emitVocalization:   (t) => { calls.push(`vocal:${t}`); },
    emitPsiAttackStart: ()  => {},
    cover:          mockCover,
    danger:         null,
    restrictedZones: null,
    squad:          null,
    pack:           null,
    conditions:     null,
    suspicion:      null,
    now:    () => nowMs,
    random: () => 0.5,
  };

  return {
    ctx,
    calls,
    state,
    setNow: (ms: number) => { nowMs = ms; },
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('CombatState — seek-cover cooldown', () => {
  let handler: CombatState;
  let cfg: IStateConfig;

  beforeEach(() => {
    cfg = createDefaultStateConfig();
    handler = new CombatState(cfg);
  });

  // -------------------------------------------------------------------------
  // 1. First entry — lastSeekCoverMs=0 and now > cooldown window
  // -------------------------------------------------------------------------

  describe('first entry (lastSeekCoverMs = 0)', () => {
    it('seeks cover when now exceeds the cooldown window from epoch zero', () => {
      const { ctx, calls } = makeCoverCooldownCtx({
        nowMs: COVER_COOLDOWN_MS + 1,  // 3001ms — elapsed > 3000
        // lastSeekCoverMs defaults to 0 via createDefaultNPCOnlineState
      });

      handler.update(ctx, 16);

      expect(calls).toContain('transition:TAKE_COVER');
    });

    it('does NOT seek cover when now exactly equals the cooldown value', () => {
      // Edge case: elapsed = now(3000) - lastSeekCoverMs(0) = 3000.
      // Condition is `>= 3000`, so 3000 >= 3000 is true — cover IS sought.
      // This confirms the boundary is inclusive (>=).
      const { ctx, calls } = makeCoverCooldownCtx({
        nowMs: COVER_COOLDOWN_MS, // 3000ms — elapsed === 3000
      });

      handler.update(ctx, 16);

      expect(calls).toContain('transition:TAKE_COVER');
    });

    it('does NOT seek cover when now is just below cooldown from epoch zero', () => {
      // elapsed = 2999 - 0 = 2999 < 3000 → blocked.
      const { ctx, calls } = makeCoverCooldownCtx({
        nowMs: COVER_COOLDOWN_MS - 1, // 2999ms
      });

      handler.update(ctx, 16);

      expect(calls.some(c => c === 'transition:TAKE_COVER')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Within cooldown — transition must be suppressed
  // -------------------------------------------------------------------------

  describe('within cooldown period', () => {
    it('does NOT seek cover immediately after a prior seek', () => {
      // Simulate: NPC sought cover at t=5000, now = t=5001 → 1ms elapsed.
      const { ctx, calls, state } = makeCoverCooldownCtx({ nowMs: 5001 });
      state.lastSeekCoverMs = 5000; // just sought cover 1ms ago

      handler.update(ctx, 16);

      expect(calls.some(c => c === 'transition:TAKE_COVER')).toBe(false);
    });

    it('does NOT seek cover at the midpoint of the cooldown window', () => {
      // lastSeekCoverMs = 4000, now = 5500 → elapsed = 1500ms < 3000ms.
      const { ctx, calls, state } = makeCoverCooldownCtx({ nowMs: 5500 });
      state.lastSeekCoverMs = 4000;

      handler.update(ctx, 16);

      expect(calls.some(c => c === 'transition:TAKE_COVER')).toBe(false);
    });

    it('does NOT seek cover one millisecond before cooldown expires', () => {
      // lastSeekCoverMs = 10000, now = 10000 + 2999 → elapsed = 2999 < 3000.
      const seekTime = 10_000;
      const { ctx, calls, state } = makeCoverCooldownCtx({
        nowMs: seekTime + COVER_COOLDOWN_MS - 1,
      });
      state.lastSeekCoverMs = seekTime;

      handler.update(ctx, 16);

      expect(calls.some(c => c === 'transition:TAKE_COVER')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 3. After cooldown — transition must re-fire
  // -------------------------------------------------------------------------

  describe('after cooldown expires', () => {
    it('seeks cover again once cooldown has elapsed exactly', () => {
      // lastSeekCoverMs = 10000, now = 13000 → elapsed = 3000 >= 3000 → allowed.
      const seekTime = 10_000;
      const { ctx, calls, state } = makeCoverCooldownCtx({
        nowMs: seekTime + COVER_COOLDOWN_MS,
      });
      state.lastSeekCoverMs = seekTime;

      handler.update(ctx, 16);

      expect(calls).toContain('transition:TAKE_COVER');
    });

    it('seeks cover again well after cooldown has elapsed', () => {
      // lastSeekCoverMs = 10000, now = 20000 → elapsed = 10000 >> 3000.
      const { ctx, calls, state } = makeCoverCooldownCtx({ nowMs: 20_000 });
      state.lastSeekCoverMs = 10_000;

      handler.update(ctx, 16);

      expect(calls).toContain('transition:TAKE_COVER');
    });

    it('allows repeated cover-seeks separated by full cooldown intervals', () => {
      // Tick 1: first seek at t=3000.
      const { ctx, calls, state, setNow } = makeCoverCooldownCtx({
        nowMs: COVER_COOLDOWN_MS + 1,
      });

      handler.update(ctx, 16);
      expect(calls).toContain('transition:TAKE_COVER');

      // Tick 2: same instant — cooldown starts from now (lastSeekCoverMs = 3001).
      // At t=3001 + 1ms = 3002, elapsed = 1ms < 3000ms → blocked.
      calls.length = 0;
      setNow(COVER_COOLDOWN_MS + 2);
      handler.update(ctx, 16);
      expect(calls.some(c => c === 'transition:TAKE_COVER')).toBe(false);

      // Tick 3: advance past the new cooldown window.
      calls.length = 0;
      setNow(state.lastSeekCoverMs + COVER_COOLDOWN_MS + 1);
      handler.update(ctx, 16);
      expect(calls).toContain('transition:TAKE_COVER');
    });
  });

  // -------------------------------------------------------------------------
  // 4. lastSeekCoverMs is stamped with ctx.now() when transition fires
  // -------------------------------------------------------------------------

  describe('lastSeekCoverMs timestamp write', () => {
    it('records ctx.now() in lastSeekCoverMs when transition fires', () => {
      const fireTime = 5_000;
      const { ctx, state } = makeCoverCooldownCtx({ nowMs: fireTime });
      // lastSeekCoverMs starts at 0 — cooldown window already elapsed.

      handler.update(ctx, 16);

      expect(state.lastSeekCoverMs).toBe(fireTime);
    });

    it('does NOT update lastSeekCoverMs when cooldown blocks the transition', () => {
      const seekTime = 10_000;
      const { ctx, state } = makeCoverCooldownCtx({
        nowMs: seekTime + 1, // only 1ms elapsed — blocked
      });
      state.lastSeekCoverMs = seekTime;

      handler.update(ctx, 16);

      // Should remain unchanged.
      expect(state.lastSeekCoverMs).toBe(seekTime);
    });

    it('does NOT update lastSeekCoverMs when cover system is absent', () => {
      const { ctx, state } = makeCoverCooldownCtx({
        nowMs: COVER_COOLDOWN_MS + 1,
        coverAvailable: false, // ctx.cover === null
      });

      handler.update(ctx, 16);

      expect(state.lastSeekCoverMs).toBe(0);
    });

    it('does NOT update lastSeekCoverMs when findCover returns null', () => {
      const calls: string[] = [];
      const state = createDefaultNPCOnlineState();

      // Build ctx with a cover system that returns null for findCover.
      const nullCover: ICoverAccess = { findCover: () => null };
      const ctx: INPCContext = {
        npcId: 'npc-no-cover-point',
        factionId: 'stalker',
        entityType: 'human',
        x: 100,
        y: 100,
        state,
        currentStateId: 'COMBAT',
        perception: {
          getVisibleEnemies:  () => [{ id: 'e1', x: 150, y: 100, factionId: 'bandit' }],
          getVisibleAllies:   () => [],
          getNearbyItems:     () => [],
          hasVisibleEnemy:    () => true,
          getWoundedEnemies:  () => [],
        },
        health: { hp: 100, maxHp: 100, hpPercent: 1, heal: () => {} },
        setVelocity:        (vx, vy) => { calls.push(`vel:${vx},${vy}`); },
        halt:               ()       => { calls.push('halt'); },
        setRotation:        (r)      => { calls.push(`rot:${r}`); },
        setAlpha:           ()       => {},
        teleport:           ()       => {},
        disablePhysics:     ()       => {},
        transition:         (s)      => { calls.push(`transition:${s}`); },
        emitShoot:          (p)      => { calls.push(`shoot:${p.weaponType}`); },
        emitMeleeHit:       ()       => {},
        emitVocalization:   ()       => {},
        emitPsiAttackStart: ()       => {},
        cover:              nullCover,
        danger:             null,
        restrictedZones:    null,
        squad:              null,
        pack:               null,
        conditions:         null,
        suspicion:          null,
        now:    () => COVER_COOLDOWN_MS + 1,
        random: () => 0.5,
      };

      handler.update(ctx, 16);

      expect(state.lastSeekCoverMs).toBe(0);
      expect(calls.some(c => c === 'transition:TAKE_COVER')).toBe(false);
    });

    it('writes coverPointX/Y from findCover result when transition fires', () => {
      const { ctx, state } = makeCoverCooldownCtx({
        nowMs: COVER_COOLDOWN_MS + 1,
      });
      // makeCoverCooldownCtx sets coverPoint to { x: 90, y: 90 }.

      handler.update(ctx, 16);

      expect(state.coverPointX).toBe(90);
      expect(state.coverPointY).toBe(90);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Regression — cooldown does not affect other branches
  // -------------------------------------------------------------------------

  describe('cooldown isolation (no side-effects on other transitions)', () => {
    it('still transitions to FLEE on PANICKED morale regardless of cooldown state', () => {
      const { ctx, calls, state } = makeCoverCooldownCtx({
        nowMs: COVER_COOLDOWN_MS + 1,
      });
      state.moraleState = 'PANICKED';

      handler.update(ctx, 16);

      expect(calls).toContain('transition:FLEE');
      expect(calls.some(c => c === 'transition:TAKE_COVER')).toBe(false);
    });

    it('still transitions to IDLE when no enemy is visible regardless of cooldown state', () => {
      const calls: string[] = [];
      const state = createDefaultNPCOnlineState();

      const ctx: INPCContext = {
        npcId:          'npc-no-enemy',
        factionId:      'stalker',
        entityType:     'human',
        x:              100,
        y:              100,
        state,
        currentStateId: 'COMBAT',
        perception: {
          getVisibleEnemies:  () => [],
          getVisibleAllies:   () => [],
          getNearbyItems:     () => [],
          hasVisibleEnemy:    () => false,
          getWoundedEnemies:  () => [],
        },
        health:             { hp: 100, maxHp: 100, hpPercent: 1, heal: () => {} },
        setVelocity:        () => {},
        halt:               () => {},
        setRotation:        () => {},
        setAlpha:           () => {},
        teleport:           () => {},
        disablePhysics:     () => {},
        transition:         (s) => { calls.push(`transition:${s}`); },
        emitShoot:          () => {},
        emitMeleeHit:       () => {},
        emitVocalization:   () => {},
        emitPsiAttackStart: () => {},
        cover:              { findCover: () => ({ x: 90, y: 90 }) },
        danger:             null,
        restrictedZones:    null,
        squad:              null,
        pack:               null,
        conditions:         null,
        suspicion:          null,
        now:    () => COVER_COOLDOWN_MS + 1,
        random: () => 0.5,
      };

      handler.update(ctx, 16);

      expect(calls).toContain('transition:IDLE');
    });

    it('cover cooldown check is not reached when enemy is out of combatRange', () => {
      // Enemy far away → NPC approaches via moveToward, never enters the halt branch.
      const { ctx, calls } = makeCoverCooldownCtx({ nowMs: COVER_COOLDOWN_MS + 1 });
      // Override enemy to be far outside combatRange.
      (ctx.perception!.getVisibleEnemies as () => Array<{ id: string; x: number; y: number; factionId: string }>) =
        () => [{ id: 'e1', x: 800, y: 100, factionId: 'bandit' }];

      handler.update(ctx, 16);

      expect(calls.some(c => c === 'transition:TAKE_COVER')).toBe(false);
      // NPC should be moving toward enemy instead.
      expect(calls.some(c => c.startsWith('vel:'))).toBe(true);
    });
  });
});
