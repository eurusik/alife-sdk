// states/handlers/TakeCoverState.test.ts
// Unit tests for the lastGrenadeMs / loopholeWaitEndMs field-aliasing fix.
//
// Before the fix TakeCoverState wrote its loophole wait deadline into
// `lastGrenadeMs`, overwriting the real grenade-throw timestamp.  The fix
// introduced a dedicated `loopholeWaitEndMs` field and stopped touching
// `lastGrenadeMs` entirely.
//
// Three invariants are verified:
//   1. `lastGrenadeMs` is NEVER written by TakeCoverState (enter, update, exit).
//   2. `loopholeWaitEndMs` IS set to a future timestamp during the WAIT phase.
//   3. `lastGrenadeMs` retains its pre-existing grenade-throw value after
//      TakeCoverState cycles through its loophole phases.

import { describe, it, expect, beforeEach } from 'vitest';
import { TakeCoverState } from './TakeCoverState';
import { createDefaultStateConfig } from '../IStateConfig';
import { createDefaultNPCOnlineState } from '../NPCOnlineState';
import type { INPCContext } from '../INPCContext';
import type { ICoverAccess } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

interface MockOverrides {
  perceptionEnemies?: Array<{ id: string; x: number; y: number; factionId: string }>;
  nowMs?: number;
  moraleState?: 'STABLE' | 'SHAKEN' | 'PANICKED';
  coverX?: number;
  coverY?: number;
  /** Pre-set lastGrenadeMs to simulate a prior grenade throw. */
  lastGrenadeMs?: number;
}

function makeMockCtx(overrides: MockOverrides = {}): {
  ctx: INPCContext;
  calls: string[];
  state: ReturnType<typeof createDefaultNPCOnlineState>;
  setNow: (ms: number) => void;
} {
  const calls: string[] = [];
  const state = createDefaultNPCOnlineState();

  if (overrides.moraleState !== undefined) state.moraleState = overrides.moraleState;
  if (overrides.lastGrenadeMs !== undefined) state.lastGrenadeMs = overrides.lastGrenadeMs;

  let nowMs = overrides.nowMs ?? 0;

  const mockCover: ICoverAccess | null =
    overrides.coverX !== undefined
      ? {
          findCover: () => ({ x: overrides.coverX!, y: overrides.coverY ?? 0 }),
          lockLastFound: () => true,
        }
      : null;

  const enemies = overrides.perceptionEnemies ?? [
    { id: 'e1', x: 200, y: 200, factionId: 'bandit' },
  ];

  const ctx: INPCContext = {
    npcId: 'npc-1',
    factionId: 'stalker',
    entityType: 'human',
    x: 100,
    y: 100,
    state,
    currentStateId: 'TAKE_COVER',
    perception: {
      getVisibleEnemies: () => enemies,
      getVisibleAllies: () => [],
      getNearbyItems: () => [],
      hasVisibleEnemy: () => enemies.length > 0,
    },
    health: { hp: 100, maxHp: 100, hpPercent: 1, heal: () => {} },
    setVelocity: (vx, vy) => { calls.push(`vel:${vx.toFixed(0)},${vy.toFixed(0)}`); },
    halt: () => { calls.push('halt'); },
    setRotation: (r) => { calls.push(`rot:${r.toFixed(2)}`); },
    setAlpha: () => {},
    teleport: () => {},
    disablePhysics: () => {},
    transition: (s) => { calls.push(`transition:${s}`); },
    emitShoot: (p) => { calls.push(`shoot:${p.weaponType}`); },
    emitMeleeHit: () => {},
    emitVocalization: () => {},
    emitPsiAttackStart: () => {},
    cover: mockCover,
    danger: null,
    restrictedZones: null,
    squad: null,
    pack: null,
    conditions: null,
    suspicion: null,
    now: () => nowMs,
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
// Helpers that drive the loophole cycle to a specific phase.
// ---------------------------------------------------------------------------

/** Advance ctx from initial WAIT through to PEEK. */
function advanceToPeek(
  handler: TakeCoverState,
  ctx: INPCContext,
  state: ReturnType<typeof createDefaultNPCOnlineState>,
  setNow: (ms: number) => void,
): void {
  setNow(state.loopholeWaitEndMs + 1);
  handler.update(ctx, 16);
}

/** Advance from PEEK to FIRE. */
function advanceToFire(
  handler: TakeCoverState,
  ctx: INPCContext,
  state: ReturnType<typeof createDefaultNPCOnlineState>,
  setNow: (ms: number) => void,
  cfg: IStateConfig,
): void {
  const peekStart = state.loophole!.phaseStartMs;
  setNow(peekStart + cfg.loopholePeekDurationMs + 1);
  handler.update(ctx, 16);
}

/** Advance from FIRE to RETURN. */
function advanceToReturn(
  handler: TakeCoverState,
  ctx: INPCContext,
  state: ReturnType<typeof createDefaultNPCOnlineState>,
  setNow: (ms: number) => void,
  cfg: IStateConfig,
): void {
  const fireStart = state.loophole!.phaseStartMs;
  setNow(fireStart + cfg.loopholeFireDurationMs + 1);
  handler.update(ctx, 16);
}

/** Advance from RETURN back to WAIT (completes one full cycle). */
function advanceToWaitAgain(
  handler: TakeCoverState,
  ctx: INPCContext,
  state: ReturnType<typeof createDefaultNPCOnlineState>,
  setNow: (ms: number) => void,
  cfg: IStateConfig,
): void {
  const returnStart = state.loophole!.phaseStartMs;
  setNow(returnStart + cfg.loopholeReturnDurationMs + 1);
  handler.update(ctx, 16);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TakeCoverState — lastGrenadeMs / loopholeWaitEndMs field aliasing fix', () => {
  let handler: TakeCoverState;
  let cfg: IStateConfig;

  // NPC is close to cover so it arrives immediately (hasTakenCover goes true
  // in the first update) and the loophole cycle begins.
  const COVER_NEAR = { coverX: 105, coverY: 100 }; // within arriveThreshold (12px)

  beforeEach(() => {
    cfg = createDefaultStateConfig();
    handler = new TakeCoverState(cfg);
  });

  // =========================================================================
  // 1. lastGrenadeMs is NOT modified by TakeCoverState
  // =========================================================================

  describe('lastGrenadeMs is never modified', () => {
    it('enter() does not touch lastGrenadeMs when it is 0 (default)', () => {
      const { ctx, state } = makeMockCtx(COVER_NEAR);
      expect(state.lastGrenadeMs).toBe(0);
      handler.enter(ctx);
      expect(state.lastGrenadeMs).toBe(0);
    });

    it('enter() preserves a pre-existing lastGrenadeMs value', () => {
      const { ctx, state } = makeMockCtx({ ...COVER_NEAR, lastGrenadeMs: 4000 });
      handler.enter(ctx);
      expect(state.lastGrenadeMs).toBe(4000);
    });

    it('update() in WAIT phase does not modify lastGrenadeMs', () => {
      const { ctx, state, setNow } = makeMockCtx({ ...COVER_NEAR, lastGrenadeMs: 9000 });
      handler.enter(ctx);
      // Stay inside the WAIT window — loopholeWaitEndMs has not been reached yet.
      setNow(state.loopholeWaitEndMs - 1);
      handler.update(ctx, 16);
      expect(state.loophole?.phase).toBe('WAIT');
      expect(state.lastGrenadeMs).toBe(9000);
    });

    it('update() at WAIT→PEEK transition does not modify lastGrenadeMs', () => {
      const { ctx, state, setNow } = makeMockCtx({ ...COVER_NEAR, lastGrenadeMs: 7500 });
      handler.enter(ctx);
      advanceToPeek(handler, ctx, state, setNow);
      expect(state.loophole?.phase).toBe('PEEK');
      expect(state.lastGrenadeMs).toBe(7500);
    });

    it('update() in FIRE phase does not modify lastGrenadeMs', () => {
      const { ctx, state, setNow } = makeMockCtx({ ...COVER_NEAR, lastGrenadeMs: 3300 });
      handler.enter(ctx);
      advanceToPeek(handler, ctx, state, setNow);
      advanceToFire(handler, ctx, state, setNow, cfg);
      expect(state.loophole?.phase).toBe('FIRE');
      expect(state.lastGrenadeMs).toBe(3300);
    });

    it('update() at FIRE→RETURN transition does not modify lastGrenadeMs', () => {
      const { ctx, state, setNow } = makeMockCtx({ ...COVER_NEAR, lastGrenadeMs: 1234 });
      handler.enter(ctx);
      advanceToPeek(handler, ctx, state, setNow);
      advanceToFire(handler, ctx, state, setNow, cfg);
      advanceToReturn(handler, ctx, state, setNow, cfg);
      expect(state.loophole?.phase).toBe('RETURN');
      expect(state.lastGrenadeMs).toBe(1234);
    });

    it('update() at RETURN→WAIT (second cycle start) does not modify lastGrenadeMs', () => {
      const { ctx, state, setNow } = makeMockCtx({ ...COVER_NEAR, lastGrenadeMs: 5678 });
      handler.enter(ctx);
      advanceToPeek(handler, ctx, state, setNow);
      advanceToFire(handler, ctx, state, setNow, cfg);
      advanceToReturn(handler, ctx, state, setNow, cfg);
      advanceToWaitAgain(handler, ctx, state, setNow, cfg);
      expect(state.loophole?.phase).toBe('WAIT');
      expect(state.lastGrenadeMs).toBe(5678);
    });

    it('exit() does not modify lastGrenadeMs', () => {
      const { ctx, state } = makeMockCtx({ ...COVER_NEAR, lastGrenadeMs: 8800 });
      handler.enter(ctx);
      handler.exit(ctx);
      expect(state.lastGrenadeMs).toBe(8800);
    });
  });

  // =========================================================================
  // 2. loopholeWaitEndMs IS set during the WAIT phase
  // =========================================================================

  describe('loopholeWaitEndMs is correctly set', () => {
    it('enter() sets loopholeWaitEndMs to a future timestamp', () => {
      const { ctx, state, setNow } = makeMockCtx(COVER_NEAR);
      setNow(1000);
      handler.enter(ctx);
      // loopholeWaitEndMs must be strictly after the enter timestamp.
      expect(state.loopholeWaitEndMs).toBeGreaterThan(1000);
    });

    it('loopholeWaitEndMs equals ctx.now() + wait duration at enter time', () => {
      // With random() fixed at 0.5 the wait duration is:
      //   loopholeWaitMinMs + 0.5 * (loopholeWaitMaxMs - loopholeWaitMinMs)
      //   = 1500 + 0.5 * (3000 - 1500) = 2250 ms
      const { ctx, state, setNow } = makeMockCtx(COVER_NEAR);
      const ENTER_TIME = 5000;
      setNow(ENTER_TIME);
      handler.enter(ctx);
      const expectedWaitDuration =
        cfg.loopholeWaitMinMs + 0.5 * (cfg.loopholeWaitMaxMs - cfg.loopholeWaitMinMs);
      expect(state.loopholeWaitEndMs).toBe(ENTER_TIME + expectedWaitDuration);
    });

    it('loopholeWaitEndMs controls the WAIT→PEEK transition (one ms before: stays WAIT)', () => {
      const { ctx, state, setNow } = makeMockCtx(COVER_NEAR);
      handler.enter(ctx);
      setNow(state.loopholeWaitEndMs - 1);
      handler.update(ctx, 16);
      expect(state.loophole?.phase).toBe('WAIT');
    });

    it('loopholeWaitEndMs controls the WAIT→PEEK transition (at deadline: advances to PEEK)', () => {
      const { ctx, state, setNow } = makeMockCtx(COVER_NEAR);
      handler.enter(ctx);
      setNow(state.loopholeWaitEndMs);
      handler.update(ctx, 16);
      expect(state.loophole?.phase).toBe('PEEK');
    });

    it('loopholeWaitEndMs is refreshed when RETURN phase ends (second WAIT cycle)', () => {
      const { ctx, state, setNow } = makeMockCtx(COVER_NEAR);
      handler.enter(ctx);
      const firstWaitEnd = state.loopholeWaitEndMs;

      advanceToPeek(handler, ctx, state, setNow);
      advanceToFire(handler, ctx, state, setNow, cfg);
      advanceToReturn(handler, ctx, state, setNow, cfg);

      // Complete RETURN → WAIT — a new loopholeWaitEndMs must be written.
      const returnStart = state.loophole!.phaseStartMs;
      const secondCycleNow = returnStart + cfg.loopholeReturnDurationMs + 1;
      setNow(secondCycleNow);
      handler.update(ctx, 16);
      expect(state.loophole?.phase).toBe('WAIT');

      // The new deadline must be in the future relative to secondCycleNow.
      expect(state.loopholeWaitEndMs).toBeGreaterThan(secondCycleNow);
      // And it must differ from the first deadline (clock advanced, so it must be larger).
      expect(state.loopholeWaitEndMs).toBeGreaterThan(firstWaitEnd);
    });

    it('loopholeWaitEndMs is set even when no cover system is available', () => {
      // No coverX → ctx.cover is null; TakeCoverState must still initialise loopholeWaitEndMs.
      const { ctx, state, setNow } = makeMockCtx({ nowMs: 2000 });
      setNow(2000);
      handler.enter(ctx);
      expect(state.loopholeWaitEndMs).toBeGreaterThan(2000);
    });

    it('loopholeWaitEndMs is not cleared by exit()', () => {
      // Exit only clears loophole object; loopholeWaitEndMs persists as a leftover
      // timer — it is harmless and matches the fix's design (field is write-only
      // by TakeCoverState, not cleaned up on exit).
      const { ctx, state } = makeMockCtx(COVER_NEAR);
      handler.enter(ctx);
      const endMs = state.loopholeWaitEndMs;
      handler.exit(ctx);
      expect(state.loopholeWaitEndMs).toBe(endMs);
    });
  });

  // =========================================================================
  // 3. lastGrenadeMs retains actual grenade-throw time after a full TakeCoverState run
  // =========================================================================

  describe('lastGrenadeMs reflects actual grenade throw time after TakeCoverState runs', () => {
    it('lastGrenadeMs written by GrenadeState is intact after enter+update through a full cycle', () => {
      // Simulate a grenade throw that happened before TakeCoverState was entered.
      const GRENADE_THROW_TIME = 3000;

      const { ctx, state, setNow } = makeMockCtx({
        ...COVER_NEAR,
        lastGrenadeMs: GRENADE_THROW_TIME,
      });

      // Enter TakeCoverState (as CombatState would do after a grenade throw).
      setNow(GRENADE_THROW_TIME + 500); // 500ms after throw
      handler.enter(ctx);

      // Drive through a complete loophole cycle: WAIT → PEEK → FIRE → RETURN → WAIT.
      advanceToPeek(handler, ctx, state, setNow);
      advanceToFire(handler, ctx, state, setNow, cfg);
      advanceToReturn(handler, ctx, state, setNow, cfg);
      advanceToWaitAgain(handler, ctx, state, setNow, cfg);

      // lastGrenadeMs must still record the actual throw time, unchanged.
      expect(state.lastGrenadeMs).toBe(GRENADE_THROW_TIME);
    });

    it('lastGrenadeMs retains 0 (never thrown) when TakeCoverState runs from a clean state', () => {
      const { ctx, state, setNow } = makeMockCtx(COVER_NEAR);
      setNow(10_000);
      handler.enter(ctx);
      advanceToPeek(handler, ctx, state, setNow);
      advanceToFire(handler, ctx, state, setNow, cfg);
      advanceToReturn(handler, ctx, state, setNow, cfg);
      advanceToWaitAgain(handler, ctx, state, setNow, cfg);
      handler.exit(ctx);
      // Default is 0 (grenade never thrown) — must stay 0 throughout.
      expect(state.lastGrenadeMs).toBe(0);
    });

    it('grenade cooldown computed from lastGrenadeMs is unaffected by loophole wait timing', () => {
      // Regression guard: CombatState uses (now - lastGrenadeMs >= grenadeCooldown)
      // to decide whether to re-enter GrenadeState.  If TakeCoverState had
      // corrupted lastGrenadeMs with the loophole end timestamp, a grenade throw
      // in the far future would appear, blocking the cooldown indefinitely.

      const GRENADE_THROW_TIME = 1000;
      const GRENADE_COOLDOWN_MS = 5000; // hypothetical host cooldown

      const { ctx, state, setNow } = makeMockCtx({
        ...COVER_NEAR,
        lastGrenadeMs: GRENADE_THROW_TIME,
      });

      // Enter TakeCoverState and run through two loophole cycles.
      setNow(GRENADE_THROW_TIME + 100);
      handler.enter(ctx);
      advanceToPeek(handler, ctx, state, setNow);
      advanceToFire(handler, ctx, state, setNow, cfg);
      advanceToReturn(handler, ctx, state, setNow, cfg);
      advanceToWaitAgain(handler, ctx, state, setNow, cfg);

      // After TakeCoverState, simulate checking grenade cooldown.
      // The now value at end of cycle is well past GRENADE_THROW_TIME + GRENADE_COOLDOWN_MS.
      const nowAfterCycle = state.loopholeWaitEndMs; // conservative — current fake clock value
      const elapsed = nowAfterCycle - state.lastGrenadeMs;

      // Elapsed since the real throw must be positive (time moved forward).
      expect(elapsed).toBeGreaterThan(0);

      // lastGrenadeMs must still equal the actual throw time, so the cooldown
      // check will correctly see a large positive elapsed value rather than a
      // negative or tiny value caused by corruption.
      expect(state.lastGrenadeMs).toBe(GRENADE_THROW_TIME);
    });
  });
});
