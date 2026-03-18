// states/handlers/WoundedState.test.ts
// Unit tests for WoundedState — focusing on the medkit cooldown fix.
//
// Fix recap: `lastMedkitMs` field gates medkit use.
// A medkit is only consumed when `now - lastMedkitMs >= medkitUseDurationMs`.
// After use, `lastMedkitMs` is set to `now`, enforcing the cooldown for the
// next use attempt.
//
// Design note: tests that exercise multi-use sequences (second/third medkit)
// use a tiny medkitHealRatio override (0.01) so each heal leaves the NPC
// below woundedHpThreshold and does NOT trigger a COMBAT transition —
// letting us observe pure cooldown behaviour across multiple updates.

import { describe, it, expect, beforeEach } from 'vitest';
import { WoundedState } from './WoundedState';
import { createDefaultStateConfig } from '../IStateConfig';
import { createDefaultNPCOnlineState } from '../NPCOnlineState';
import type { INPCContext, INPCHealth } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

interface MockOverrides {
  nowMs?: number;
  hp?: number;
  maxHp?: number;
  hpPercent?: number;
  healthNull?: boolean;
  medkitCount?: number;
  lastMedkitMs?: number;
  woundedStartMs?: number;
  moraleState?: 'STABLE' | 'SHAKEN' | 'PANICKED';
  lastKnownEnemyX?: number;
  lastKnownEnemyY?: number;
}

function makeMockCtx(overrides: MockOverrides = {}): {
  ctx: INPCContext;
  calls: string[];
  state: ReturnType<typeof createDefaultNPCOnlineState>;
  setNow: (ms: number) => void;
  healHistory: number[];
} {
  const calls: string[] = [];
  const healHistory: number[] = [];
  const state = createDefaultNPCOnlineState();

  const maxHp = overrides.maxHp ?? 100;
  let hp = overrides.hp ?? maxHp;

  // hpPercentOverride: when set, the hpPercent getter returns a fixed value
  // regardless of actual hp mutations (useful for HP-threshold boundary tests).
  const hpPercentOverride = overrides.hpPercent;

  if (overrides.medkitCount !== undefined)     state.medkitCount   = overrides.medkitCount;
  if (overrides.lastMedkitMs !== undefined)    state.lastMedkitMs  = overrides.lastMedkitMs;
  if (overrides.woundedStartMs !== undefined)  state.woundedStartMs = overrides.woundedStartMs;
  if (overrides.moraleState !== undefined)     state.moraleState   = overrides.moraleState;
  if (overrides.lastKnownEnemyX !== undefined) state.lastKnownEnemyX = overrides.lastKnownEnemyX;
  if (overrides.lastKnownEnemyY !== undefined) state.lastKnownEnemyY = overrides.lastKnownEnemyY;

  let nowMs = overrides.nowMs ?? 0;

  // Build a health object as a mutable reference.
  const healthRef: { value: INPCHealth | null } = {
    value: overrides.healthNull ? null : {
      get hp()        { return hp; },
      get maxHp()     { return maxHp; },
      get hpPercent() {
        return hpPercentOverride !== undefined ? hpPercentOverride : hp / maxHp;
      },
      heal(amount: number) {
        healHistory.push(amount);
        hp = Math.min(hp + amount, maxHp);
      },
    },
  };

  const ctx: INPCContext = {
    npcId: 'npc-1',
    factionId: 'stalker',
    entityType: 'human',
    x: 100,
    y: 100,
    state,
    currentStateId: 'WOUNDED',
    perception: {
      getVisibleEnemies: () => [],
      getVisibleAllies:  () => [],
      getNearbyItems:    () => [],
      hasVisibleEnemy:   () => false,
    },
    get health() { return healthRef.value; },
    setVelocity: (vx, vy) => { calls.push(`vel:${vx.toFixed(0)},${vy.toFixed(0)}`); },
    halt:        ()        => { calls.push('halt'); },
    setRotation: ()        => {},
    setAlpha:    ()        => {},
    teleport:    ()        => {},
    disablePhysics: ()     => {},
    transition:  (s)       => { calls.push(`transition:${s}`); },
    emitShoot:   ()        => {},
    emitMeleeHit: ()       => {},
    emitVocalization: ()   => {},
    emitPsiAttackStart: () => {},
    cover: null,
    danger: null,
    restrictedZones: null,
    squad: null,
    pack: null,
    conditions: null,
    suspicion: null,
    now:    () => nowMs,
    random: () => 0.5,
  };

  return {
    ctx,
    calls,
    state,
    setNow: (ms: number) => { nowMs = ms; },
    healHistory,
  };
}

// ---------------------------------------------------------------------------
// WoundedState — medkit cooldown
// ---------------------------------------------------------------------------

describe('WoundedState — medkit cooldown', () => {
  let handler: WoundedState;
  let cfg: IStateConfig;

  beforeEach(() => {
    cfg     = createDefaultStateConfig();
    handler = new WoundedState(cfg);
  });

  // ── 1. First medkit use works immediately ─────────────────────────────────

  describe('first medkit use (lastMedkitMs = 0)', () => {
    it('uses medkit on the first update when lastMedkitMs is 0 and now >= medkitUseDurationMs', () => {
      // Use a large maxHp so the heal does NOT push HP above woundedHpThreshold
      // (which would cause a COMBAT transition and mask the medkit consumption).
      // hp=1, maxHp=100000: heal = 100000*0.5 = 50000 → 50001/100000 = 50% > 20% → COMBAT.
      // We just verify medkitCount decremented; the COMBAT transition is irrelevant here.
      const { ctx, state, setNow } = makeMockCtx({
        hp: 10,
        maxHp: 100,
        medkitCount: 1,
        lastMedkitMs: 0,
        woundedStartMs: 0,
      });
      setNow(cfg.medkitUseDurationMs);
      handler.update(ctx, 16);
      expect(state.medkitCount).toBe(0);
    });

    it('applies heal on first use', () => {
      const { ctx, setNow, healHistory } = makeMockCtx({
        hp: 10,
        maxHp: 100,
        medkitCount: 1,
        lastMedkitMs: 0,
        woundedStartMs: 0,
      });
      setNow(cfg.medkitUseDurationMs);
      handler.update(ctx, 16);
      expect(healHistory).toHaveLength(1);
      expect(healHistory[0]).toBeCloseTo(cfg.medkitHealRatio * 100);
    });

    it('uses medkit when lastMedkitMs is 0 and now is well beyond medkitUseDurationMs', () => {
      // Use tiny healRatio so HP stays below threshold → no early COMBAT exit,
      // letting us count medkits across a straightforward single call.
      // Set woundedStartMs = now so elapsed = 0 and the timeout does NOT fire.
      const tinyCfg = createDefaultStateConfig({ medkitHealRatio: 0.01 });
      const tinyHandler = new WoundedState(tinyCfg);
      const nowAtUpdate = tinyCfg.medkitUseDurationMs * 4; // well within woundedMaxDurationMs
      const { ctx, state, setNow } = makeMockCtx({
        hp: 1,
        maxHp: 100,
        medkitCount: 2,
        lastMedkitMs: 0,
        woundedStartMs: nowAtUpdate, // elapsed = 0 at this update → no timeout
      });
      setNow(nowAtUpdate);
      tinyHandler.update(ctx, 16);
      // Only one medkit used per update — cooldown resets to now after the use.
      expect(state.medkitCount).toBe(1);
    });
  });

  // ── 2. Second medkit NOT used within cooldown period ──────────────────────

  describe('second medkit blocked within cooldown period', () => {
    // All tests here use a tiny heal ratio so HP stays below threshold across
    // multiple updates, keeping the NPC in WOUNDED state.
    let tinyCfg: IStateConfig;
    let tinyHandler: WoundedState;

    beforeEach(() => {
      tinyCfg    = createDefaultStateConfig({ medkitHealRatio: 0.01 });
      tinyHandler = new WoundedState(tinyCfg);
    });

    it('does NOT use a second medkit when cooldown has not elapsed', () => {
      const { ctx, state, setNow } = makeMockCtx({
        hp: 1,
        maxHp: 100,
        medkitCount: 2,
        lastMedkitMs: 0,
        woundedStartMs: 0,
      });

      // First use at t = medkitUseDurationMs.
      setNow(tinyCfg.medkitUseDurationMs);
      tinyHandler.update(ctx, 16);
      expect(state.medkitCount).toBe(1);
      expect(state.lastMedkitMs).toBe(tinyCfg.medkitUseDurationMs);

      // Advance by only half the cooldown — second use must NOT fire.
      const halfCooldown = tinyCfg.medkitUseDurationMs / 2;
      setNow(tinyCfg.medkitUseDurationMs + halfCooldown);
      tinyHandler.update(ctx, 16);

      expect(state.medkitCount).toBe(1); // unchanged
    });

    it('does NOT apply heal during cooldown period', () => {
      const { ctx, state, setNow, healHistory } = makeMockCtx({
        hp: 1,
        maxHp: 100,
        medkitCount: 2,
        lastMedkitMs: 0,
        woundedStartMs: 0,
      });

      setNow(tinyCfg.medkitUseDurationMs);
      tinyHandler.update(ctx, 16);
      const healsAfterFirst = healHistory.length; // 1

      // One ms before cooldown expires.
      setNow(tinyCfg.medkitUseDurationMs * 2 - 1);
      tinyHandler.update(ctx, 16);

      // No additional heal should have fired.
      expect(healHistory.length).toBe(healsAfterFirst);
      expect(state.medkitCount).toBe(1);
    });

    it('blocks medkit even when lastMedkitMs is set directly and elapsed < duration', () => {
      // Simulate a partially-elapsed cooldown by pre-setting lastMedkitMs.
      const firstUseTime = 5_000;
      const { ctx, state, setNow } = makeMockCtx({
        hp: 1,
        maxHp: 100,
        medkitCount: 3,
        lastMedkitMs: firstUseTime,
        woundedStartMs: 0,
      });

      // Advance to just one ms short of the next allowed use.
      setNow(firstUseTime + tinyCfg.medkitUseDurationMs - 1);
      tinyHandler.update(ctx, 16);

      expect(state.medkitCount).toBe(3); // none consumed
    });
  });

  // ── 3. Second medkit IS used after cooldown expires ───────────────────────

  describe('second medkit allowed after cooldown expires', () => {
    let tinyCfg: IStateConfig;
    let tinyHandler: WoundedState;

    beforeEach(() => {
      tinyCfg    = createDefaultStateConfig({ medkitHealRatio: 0.01 });
      tinyHandler = new WoundedState(tinyCfg);
    });

    it('uses second medkit exactly when cooldown elapses (elapsed === medkitUseDurationMs)', () => {
      const { ctx, state, setNow } = makeMockCtx({
        hp: 1,
        maxHp: 100,
        medkitCount: 2,
        lastMedkitMs: 0,
        woundedStartMs: 0,
      });

      // First use.
      setNow(tinyCfg.medkitUseDurationMs);
      tinyHandler.update(ctx, 16);
      expect(state.medkitCount).toBe(1);
      expect(state.lastMedkitMs).toBe(tinyCfg.medkitUseDurationMs);

      // Advance by exactly medkitUseDurationMs more — cooldown just expired.
      setNow(tinyCfg.medkitUseDurationMs * 2);
      tinyHandler.update(ctx, 16);

      expect(state.medkitCount).toBe(0);
    });

    it('uses second medkit after cooldown has well surpassed', () => {
      // woundedStartMs set to first-use time so elapsed stays low and timeout
      // does NOT fire during the second update at 5× the cooldown window.
      const firstUseTime = tinyCfg.medkitUseDurationMs;
      const { ctx, state, setNow } = makeMockCtx({
        hp: 1,
        maxHp: 100,
        medkitCount: 2,
        lastMedkitMs: 0,
        woundedStartMs: firstUseTime, // elapsed = 0 at first update → no timeout
      });

      setNow(firstUseTime);
      tinyHandler.update(ctx, 16);
      expect(state.medkitCount).toBe(1);

      // 4× cooldown later — well past the cooldown, but elapsed from woundedStartMs
      // = 4 * 3000 = 12000, which is < woundedMaxDurationMs (15000).
      setNow(firstUseTime + tinyCfg.medkitUseDurationMs * 4);
      tinyHandler.update(ctx, 16);
      expect(state.medkitCount).toBe(0);
    });

    it('applies heal on second use after cooldown', () => {
      const { ctx, setNow, healHistory } = makeMockCtx({
        hp: 1,
        maxHp: 100,
        medkitCount: 2,
        lastMedkitMs: 0,
        woundedStartMs: 0,
      });

      setNow(tinyCfg.medkitUseDurationMs);
      tinyHandler.update(ctx, 16);
      const firstHealCount = healHistory.length; // 1

      setNow(tinyCfg.medkitUseDurationMs * 2);
      tinyHandler.update(ctx, 16);
      expect(healHistory.length).toBe(firstHealCount + 1);
    });
  });

  // ── 4. lastMedkitMs updated after each use ────────────────────────────────

  describe('lastMedkitMs timestamp tracking', () => {
    it('sets lastMedkitMs to now after first use', () => {
      const { ctx, state, setNow } = makeMockCtx({
        hp: 10,
        maxHp: 100,
        medkitCount: 1,
        lastMedkitMs: 0,
        woundedStartMs: 0,
      });

      const useTime = cfg.medkitUseDurationMs + 500;
      setNow(useTime);
      handler.update(ctx, 16);

      expect(state.lastMedkitMs).toBe(useTime);
    });

    it('updates lastMedkitMs to the second use timestamp after second use', () => {
      const tinyCfg    = createDefaultStateConfig({ medkitHealRatio: 0.01 });
      const tinyHandler = new WoundedState(tinyCfg);

      const { ctx, state, setNow } = makeMockCtx({
        hp: 1,
        maxHp: 100,
        medkitCount: 2,
        lastMedkitMs: 0,
        woundedStartMs: 0,
      });

      const firstUseTime  = tinyCfg.medkitUseDurationMs;
      const secondUseTime = tinyCfg.medkitUseDurationMs * 2 + 123;

      setNow(firstUseTime);
      tinyHandler.update(ctx, 16);
      expect(state.lastMedkitMs).toBe(firstUseTime);

      setNow(secondUseTime);
      tinyHandler.update(ctx, 16);
      expect(state.lastMedkitMs).toBe(secondUseTime);
    });

    it('does NOT update lastMedkitMs when no medkit is used (no stock)', () => {
      const { ctx, state, setNow } = makeMockCtx({
        hp: 10,
        maxHp: 100,
        medkitCount: 0,
        lastMedkitMs: 0,
        woundedStartMs: 0,
      });

      setNow(cfg.medkitUseDurationMs * 3);
      handler.update(ctx, 16);

      expect(state.lastMedkitMs).toBe(0); // unchanged
    });

    it('does NOT update lastMedkitMs during cooldown period', () => {
      const tinyCfg    = createDefaultStateConfig({ medkitHealRatio: 0.01 });
      const tinyHandler = new WoundedState(tinyCfg);

      const { ctx, state, setNow } = makeMockCtx({
        hp: 1,
        maxHp: 100,
        medkitCount: 2,
        lastMedkitMs: 0,
        woundedStartMs: 0,
      });

      setNow(tinyCfg.medkitUseDurationMs);
      tinyHandler.update(ctx, 16);
      const stampAfterFirst = state.lastMedkitMs; // === tinyCfg.medkitUseDurationMs

      // Mid-cooldown — stamp must not change.
      setNow(tinyCfg.medkitUseDurationMs + 100);
      tinyHandler.update(ctx, 16);
      expect(state.lastMedkitMs).toBe(stampAfterFirst);
    });
  });

  // ── 5. Medkits are NOT all consumed in rapid succession ───────────────────

  describe('rapid succession does NOT drain all medkits', () => {
    it('only one medkit consumed across many fast updates within the cooldown window', () => {
      const tinyCfg    = createDefaultStateConfig({ medkitHealRatio: 0.01 });
      const tinyHandler = new WoundedState(tinyCfg);

      const { ctx, state, setNow } = makeMockCtx({
        hp: 1,
        maxHp: 100,
        medkitCount: 5,
        lastMedkitMs: 0,
        woundedStartMs: 0,
      });

      // First eligible use.
      setNow(tinyCfg.medkitUseDurationMs);
      tinyHandler.update(ctx, 16);
      expect(state.medkitCount).toBe(4);

      // Fire many updates at 16 ms increments — all within cooldown window.
      for (let tick = 1; tick <= 50; tick++) {
        setNow(tinyCfg.medkitUseDurationMs + tick * 16);
        tinyHandler.update(ctx, 16);
      }

      // Only the initial medkit should have been consumed.
      expect(state.medkitCount).toBe(4);
    });

    it('heals exactly once per cooldown window over multiple windows', () => {
      const tinyCfg    = createDefaultStateConfig({ medkitHealRatio: 0.01 });
      const tinyHandler = new WoundedState(tinyCfg);

      const { ctx, state, setNow, healHistory } = makeMockCtx({
        hp: 1,
        maxHp: 100,
        medkitCount: 3,
        lastMedkitMs: 0,
        woundedStartMs: 0,
      });

      // Window 1 — first use at t = medkitUseDurationMs.
      setNow(tinyCfg.medkitUseDurationMs);
      tinyHandler.update(ctx, 16);
      expect(healHistory.length).toBe(1);
      expect(state.medkitCount).toBe(2);

      // Rapid updates inside window 1 (should be no-ops).
      for (let i = 1; i <= 10; i++) {
        setNow(tinyCfg.medkitUseDurationMs + i * 100);
        tinyHandler.update(ctx, 16);
      }
      expect(healHistory.length).toBe(1); // still only 1 heal

      // Window 2 — second use exactly when cooldown expires.
      setNow(tinyCfg.medkitUseDurationMs * 2);
      tinyHandler.update(ctx, 16);
      expect(healHistory.length).toBe(2);
      expect(state.medkitCount).toBe(1);

      // Rapid updates inside window 2.
      for (let i = 1; i <= 10; i++) {
        setNow(tinyCfg.medkitUseDurationMs * 2 + i * 100);
        tinyHandler.update(ctx, 16);
      }
      expect(healHistory.length).toBe(2); // still only 2 heals

      // Window 3 — third use.
      setNow(tinyCfg.medkitUseDurationMs * 3);
      tinyHandler.update(ctx, 16);
      expect(healHistory.length).toBe(3);
      expect(state.medkitCount).toBe(0);
    });

    it('medkit count never goes below zero with many rapid updates', () => {
      const tinyCfg    = createDefaultStateConfig({ medkitHealRatio: 0.01 });
      const tinyHandler = new WoundedState(tinyCfg);

      const { ctx, state, setNow } = makeMockCtx({
        hp: 1,
        maxHp: 100,
        medkitCount: 1,
        lastMedkitMs: 0,
        woundedStartMs: 0,
      });

      // Trigger first (and only) use.
      setNow(tinyCfg.medkitUseDurationMs);
      tinyHandler.update(ctx, 16);

      // Fire 100 rapid updates — stock is already 0.
      for (let i = 1; i <= 100; i++) {
        setNow(tinyCfg.medkitUseDurationMs + i * 16);
        tinyHandler.update(ctx, 16);
      }

      expect(state.medkitCount).toBe(0);
    });
  });

  // ── 6. Boundary: cooldown comparison is >= (inclusive at boundary) ────────

  describe('cooldown boundary precision', () => {
    it('does NOT fire at (lastMedkitMs + medkitUseDurationMs - 1)', () => {
      const tinyCfg    = createDefaultStateConfig({ medkitHealRatio: 0.01 });
      const tinyHandler = new WoundedState(tinyCfg);

      const firstUseTime = tinyCfg.medkitUseDurationMs;
      const { ctx, state, setNow } = makeMockCtx({
        hp: 1,
        maxHp: 100,
        medkitCount: 2,
        lastMedkitMs: 0,
        woundedStartMs: 0,
      });

      setNow(firstUseTime);
      tinyHandler.update(ctx, 16);
      expect(state.medkitCount).toBe(1);

      // One ms before cooldown expires — elapsed = medkitUseDurationMs - 1 < threshold.
      setNow(firstUseTime + tinyCfg.medkitUseDurationMs - 1);
      tinyHandler.update(ctx, 16);
      expect(state.medkitCount).toBe(1); // unchanged
    });

    it('fires exactly at (lastMedkitMs + medkitUseDurationMs)', () => {
      const tinyCfg    = createDefaultStateConfig({ medkitHealRatio: 0.01 });
      const tinyHandler = new WoundedState(tinyCfg);

      const firstUseTime = tinyCfg.medkitUseDurationMs;
      const { ctx, state, setNow } = makeMockCtx({
        hp: 1,
        maxHp: 100,
        medkitCount: 2,
        lastMedkitMs: 0,
        woundedStartMs: 0,
      });

      setNow(firstUseTime);
      tinyHandler.update(ctx, 16);
      expect(state.medkitCount).toBe(1);

      // Exactly at the boundary — now - lastMedkitMs === medkitUseDurationMs.
      setNow(firstUseTime + tinyCfg.medkitUseDurationMs);
      tinyHandler.update(ctx, 16);
      expect(state.medkitCount).toBe(0);
    });
  });

  // ── 7. No medkit use when health is null ──────────────────────────────────

  describe('medkit use skipped when health is null', () => {
    it('does not consume medkit when ctx.health is null', () => {
      // Use healthNull: true so the factory wires health to null from the start.
      const { ctx, state, setNow } = makeMockCtx({
        healthNull: true,
        medkitCount: 1,
        lastMedkitMs: 0,
        woundedStartMs: 0,
      });

      setNow(cfg.medkitUseDurationMs * 5);
      handler.update(ctx, 16);

      expect(state.medkitCount).toBe(1); // untouched
      expect(state.lastMedkitMs).toBe(0);
    });
  });

  // ── 8. Medkit use skipped when HP is already above threshold ─────────────

  describe('medkit use skipped when HP is already at or above threshold', () => {
    it('does NOT use medkit when hpPercent equals woundedHpThreshold', () => {
      // HP exactly at threshold — condition is `hpPercent < threshold`, so equals
      // should NOT trigger a medkit use.
      const { ctx, state, setNow } = makeMockCtx({
        hpPercent: cfg.woundedHpThreshold, // exactly 0.2
        medkitCount: 1,
        lastMedkitMs: 0,
        woundedStartMs: 0,
      });

      setNow(cfg.medkitUseDurationMs);
      handler.update(ctx, 16);

      expect(state.medkitCount).toBe(1); // not consumed
    });

    it('does NOT use medkit when hpPercent is above threshold', () => {
      const { ctx, state, setNow } = makeMockCtx({
        hpPercent: cfg.woundedHpThreshold + 0.1,
        medkitCount: 1,
        lastMedkitMs: 0,
        woundedStartMs: 0,
      });

      setNow(cfg.medkitUseDurationMs);
      handler.update(ctx, 16);

      expect(state.medkitCount).toBe(1);
    });
  });

  // ── 9. Healing triggers COMBAT transition when HP recovers above threshold ─

  describe('COMBAT transition after healing above threshold', () => {
    it('transitions to COMBAT when medkit heal pushes HP above threshold', () => {
      // HP at 10/100 = 10%, healed by medkitHealRatio=0.5 → +50 HP → 60% > 20%.
      const { ctx, calls, setNow } = makeMockCtx({
        hp: 10,
        maxHp: 100,
        medkitCount: 1,
        lastMedkitMs: 0,
        woundedStartMs: 0,
      });

      setNow(cfg.medkitUseDurationMs);
      handler.update(ctx, 16);

      expect(calls).toContain('transition:COMBAT');
    });

    it('does NOT transition to COMBAT when HP is still below threshold after heal', () => {
      // medkitHealRatio = 0.05 (tiny). HP = 5/200 = 2.5%; healed by 200*0.05=10 → 15/200=7.5% < 20%.
      const smallHealCfg     = createDefaultStateConfig({ medkitHealRatio: 0.05 });
      const smallHealHandler = new WoundedState(smallHealCfg);
      const { ctx, calls, setNow } = makeMockCtx({
        hp: 5,
        maxHp: 200,
        medkitCount: 1,
        lastMedkitMs: 0,
        woundedStartMs: 0,
      });

      setNow(smallHealCfg.medkitUseDurationMs);
      smallHealHandler.update(ctx, 16);

      expect(calls.some(c => c === 'transition:COMBAT')).toBe(false);
    });
  });

  // ── 10. enter() sets woundedStartMs ──────────────────────────────────────

  describe('enter()', () => {
    it('records woundedStartMs as ctx.now() on enter', () => {
      const { ctx, state, setNow } = makeMockCtx();
      setNow(7_500);
      handler.enter(ctx);
      expect(state.woundedStartMs).toBe(7_500);
    });

    it('enter does not alter lastMedkitMs', () => {
      const { ctx, state, setNow } = makeMockCtx({ lastMedkitMs: 1_234 });
      setNow(10_000);
      handler.enter(ctx);
      expect(state.lastMedkitMs).toBe(1_234); // untouched by enter
    });
  });

  // ── 11. Timeout → FLEE transition ────────────────────────────────────────

  describe('timeout → FLEE transition', () => {
    it('transitions to FLEE after woundedMaxDurationMs regardless of medkits', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        hp: 10,
        maxHp: 100,
        medkitCount: 5,
        woundedStartMs: 0,
      });

      setNow(cfg.woundedMaxDurationMs + 1);
      handler.update(ctx, 16);

      expect(calls).toContain('transition:FLEE');
    });

    it('does NOT transition to FLEE before woundedMaxDurationMs elapses', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        hp: 10,
        maxHp: 100,
        medkitCount: 0,
        moraleState: 'STABLE',
        woundedStartMs: 0,
      });

      setNow(cfg.woundedMaxDurationMs - 1);
      handler.update(ctx, 16);

      expect(calls.some(c => c === 'transition:FLEE')).toBe(false);
    });
  });

  // ── 12. PANICKED with no medkits → FLEE ───────────────────────────────────

  describe('PANICKED + no medkits → FLEE', () => {
    it('transitions to FLEE when PANICKED and medkitCount is 0', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        hp: 10,
        maxHp: 100,
        medkitCount: 0,
        moraleState: 'PANICKED',
        woundedStartMs: 0,
      });

      setNow(100); // well within woundedMaxDurationMs
      handler.update(ctx, 16);

      expect(calls).toContain('transition:FLEE');
    });

    it('does NOT transition to FLEE when PANICKED but medkits are available and cooldown ready', () => {
      // With medkits + PANICKED + cooldown ready, the healing branch runs first
      // and heals above threshold → COMBAT, not FLEE.
      const { ctx, calls, setNow } = makeMockCtx({
        hp: 10,
        maxHp: 100,
        medkitCount: 1,
        moraleState: 'PANICKED',
        lastMedkitMs: 0,
        woundedStartMs: 0,
      });

      setNow(cfg.medkitUseDurationMs);
      handler.update(ctx, 16);

      // Medkit was used → healed above threshold → COMBAT.
      expect(calls).toContain('transition:COMBAT');
      expect(calls).not.toContain('transition:FLEE');
    });
  });

  // ── 13. Custom transition map overrides ──────────────────────────────────

  describe('injectable IStateTransitionMap overrides', () => {
    it('uses custom woundedOnHealed target when HP recovers', () => {
      const customHandler = new WoundedState(cfg, { woundedOnHealed: 'ALERT' });
      const { ctx, calls, setNow } = makeMockCtx({
        hp: 10,
        maxHp: 100,
        medkitCount: 1,
        lastMedkitMs: 0,
        woundedStartMs: 0,
      });

      setNow(cfg.medkitUseDurationMs);
      customHandler.update(ctx, 16);

      expect(calls).toContain('transition:ALERT');
    });

    it('uses custom woundedOnTimeout when duration elapses', () => {
      const customHandler = new WoundedState(cfg, { woundedOnTimeout: 'DEAD' });
      const { ctx, calls, setNow } = makeMockCtx({
        medkitCount: 0,
        woundedStartMs: 0,
      });

      setNow(cfg.woundedMaxDurationMs);
      customHandler.update(ctx, 16);

      expect(calls).toContain('transition:DEAD');
    });

    it('uses custom woundedOnPanic when PANICKED with no medkits', () => {
      const customHandler = new WoundedState(cfg, { woundedOnPanic: 'RETREAT' });
      const { ctx, calls, setNow } = makeMockCtx({
        medkitCount: 0,
        moraleState: 'PANICKED',
        woundedStartMs: 0,
      });

      setNow(100);
      customHandler.update(ctx, 16);

      expect(calls).toContain('transition:RETREAT');
    });
  });
});
