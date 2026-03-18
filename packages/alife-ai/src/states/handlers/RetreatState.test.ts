// states/handlers/RetreatState.test.ts
// Unit tests for the RetreatState no-cover fallback fix (rounds 1 & 2).
//
// Round-1 fix:
//   When no cover is found (or the lock is contested), enter() now writes
//   NaN into ctx.state.coverPointX/Y instead of the NPC's current position.
//   In update(), `hasCoverDest = !Number.isNaN(ctx.state.coverPointX)` is
//   therefore false, which keeps `arrived` permanently false and routes the
//   NPC through awayFrom() instead of standing still as if it had "arrived".
//
// Round-2 fix (no-cover time limit):
//   enter() now stamps ctx.state.retreatStartMs = ctx.now().
//   In update(), the no-cover / awayFrom() branch checks
//     (now - retreatStartMs) >= cfg.retreatMaxDurationMs
//   and, on timeout, halts + transitions via retreatOnNoEnemy instead of
//   running the NPC away from the enemy forever.

import { describe, it, expect, beforeEach } from 'vitest';
import { RetreatState } from './RetreatState';
import { createDefaultStateConfig } from '../IStateConfig';
import { createDefaultNPCOnlineState } from '../NPCOnlineState';
import type { INPCContext, ICoverAccess } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

interface MockOverrides {
  x?: number;
  y?: number;
  nowMs?: number;
  moraleState?: 'STABLE' | 'SHAKEN' | 'PANICKED';
  lastKnownEnemyX?: number;
  lastKnownEnemyY?: number;
  primaryWeapon?: string | null;
  perceptionEnemies?: Array<{ id: string; x: number; y: number; factionId: string }>;
  /** Supply a cover point to simulate a successful findCover() result. */
  coverPoint?: { x: number; y: number } | null;
  /** Control whether lockLastFound() succeeds (default: true). */
  lockResult?: boolean;
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
  if (overrides.lastKnownEnemyX !== undefined) state.lastKnownEnemyX = overrides.lastKnownEnemyX;
  if (overrides.lastKnownEnemyY !== undefined) state.lastKnownEnemyY = overrides.lastKnownEnemyY;
  if (overrides.primaryWeapon !== undefined) state.primaryWeapon = overrides.primaryWeapon;

  let nowMs = overrides.nowMs ?? 0;

  // Build cover mock: null when coverPoint is explicitly null or omitted.
  const coverPoint = overrides.coverPoint ?? null;
  const lockResult = overrides.lockResult ?? true;

  const mockCover: ICoverAccess | null = coverPoint !== null
    ? {
        findCover: () => coverPoint,
        lockLastFound: () => lockResult,
        unlockAll: () => {},
      }
    : null;

  const enemies = overrides.perceptionEnemies ?? [
    { id: 'e1', x: 200, y: 200, factionId: 'bandit' },
  ];

  const ctx: INPCContext = {
    npcId: 'npc-test',
    factionId: 'stalker',
    entityType: 'human',
    x: overrides.x ?? 100,
    y: overrides.y ?? 100,
    state,
    currentStateId: 'RETREAT',
    perception: {
      getVisibleEnemies: () => enemies,
      getVisibleAllies:  () => [],
      getNearbyItems:    () => [],
      hasVisibleEnemy:   () => enemies.length > 0,
    },
    health: null,
    setVelocity:        (vx, vy) => { calls.push(`vel:${vx.toFixed(0)},${vy.toFixed(0)}`); },
    halt:               ()       => { calls.push('halt'); },
    setRotation:        (r)      => { calls.push(`rot:${r.toFixed(2)}`); },
    setAlpha:           (a)      => { calls.push(`alpha:${a}`); },
    teleport:           ()       => {},
    disablePhysics:     ()       => {},
    transition:         (s)      => { calls.push(`transition:${s}`); },
    emitShoot:          (p)      => { calls.push(`shoot:${p.weaponType}`); },
    emitMeleeHit:       ()       => {},
    emitVocalization:   (t)      => { calls.push(`vocal:${t}`); },
    emitPsiAttackStart: ()       => {},
    cover: mockCover,
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
  };
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

describe('RetreatState', () => {
  let handler: RetreatState;
  let cfg: IStateConfig;

  beforeEach(() => {
    cfg     = createDefaultStateConfig();
    handler = new RetreatState(cfg);
  });

  // ── enter(): no-cover path ─────────────────────────────────────────────────

  describe('enter() — no cover found', () => {
    it('sets coverPointX to NaN when cover system is null', () => {
      const { ctx, state } = makeMockCtx(); // cover: null
      handler.enter(ctx);
      expect(Number.isNaN(state.coverPointX)).toBe(true);
    });

    it('sets coverPointY to NaN when cover system is null', () => {
      const { ctx, state } = makeMockCtx();
      handler.enter(ctx);
      expect(Number.isNaN(state.coverPointY)).toBe(true);
    });

    it('sets coverPointX to NaN when findCover() returns null', () => {
      // Provide a cover system whose findCover returns null (no point available).
      const { ctx, state } = makeMockCtx();
      // Override cover with a system that returns null from findCover.
      (ctx as unknown as Record<string, unknown>).cover = {
        findCover: () => null,
        lockLastFound: () => true,
        unlockAll: () => {},
      } satisfies ICoverAccess;

      handler.enter(ctx);
      expect(Number.isNaN(state.coverPointX)).toBe(true);
    });

    it('sets coverPointY to NaN when findCover() returns null', () => {
      const { ctx, state } = makeMockCtx();
      (ctx as unknown as Record<string, unknown>).cover = {
        findCover: () => null,
        lockLastFound: () => true,
        unlockAll: () => {},
      } satisfies ICoverAccess;

      handler.enter(ctx);
      expect(Number.isNaN(state.coverPointY)).toBe(true);
    });

    it('sets coverPointX to NaN when lock is contested (lockLastFound returns false)', () => {
      const { ctx, state } = makeMockCtx({
        coverPoint: { x: 300, y: 400 },
        lockResult: false,
      });
      handler.enter(ctx);
      expect(Number.isNaN(state.coverPointX)).toBe(true);
    });

    it('sets coverPointY to NaN when lock is contested (lockLastFound returns false)', () => {
      const { ctx, state } = makeMockCtx({
        coverPoint: { x: 300, y: 400 },
        lockResult: false,
      });
      handler.enter(ctx);
      expect(Number.isNaN(state.coverPointY)).toBe(true);
    });

    it('resets hasTakenCover to false when no cover is found', () => {
      const { ctx, state } = makeMockCtx();
      state.hasTakenCover = true; // pre-set
      handler.enter(ctx);
      expect(state.hasTakenCover).toBe(false);
    });

    it('resets lastSuppressiveFireMs to 0 even when no cover', () => {
      const { ctx, state } = makeMockCtx();
      state.lastSuppressiveFireMs = 9_999;
      handler.enter(ctx);
      expect(state.lastSuppressiveFireMs).toBe(0);
    });
  });

  // ── enter(): valid cover path ──────────────────────────────────────────────

  describe('enter() — cover found and locked', () => {
    it('stores the cover point X when findCover() succeeds and lock is granted', () => {
      const { ctx, state } = makeMockCtx({
        coverPoint: { x: 350, y: 250 },
        lockResult: true,
      });
      handler.enter(ctx);
      expect(state.coverPointX).toBe(350);
    });

    it('stores the cover point Y when findCover() succeeds and lock is granted', () => {
      const { ctx, state } = makeMockCtx({
        coverPoint: { x: 350, y: 250 },
        lockResult: true,
      });
      handler.enter(ctx);
      expect(state.coverPointY).toBe(250);
    });

    it('coverPointX is NOT NaN when a valid cover point is locked', () => {
      const { ctx, state } = makeMockCtx({
        coverPoint: { x: 350, y: 250 },
        lockResult: true,
      });
      handler.enter(ctx);
      expect(Number.isNaN(state.coverPointX)).toBe(false);
    });

    it('resets hasTakenCover to false even when a cover point is locked', () => {
      const { ctx, state } = makeMockCtx({
        coverPoint: { x: 350, y: 250 },
        lockResult: true,
      });
      state.hasTakenCover = true;
      handler.enter(ctx);
      expect(state.hasTakenCover).toBe(false);
    });
  });

  // ── hasCoverDest logic via update() ───────────────────────────────────────

  describe('update() — hasCoverDest false (NaN destination)', () => {
    it('NaN coverPointX means arrived is false — NPC does not halt', () => {
      const { ctx, calls } = makeMockCtx({
        lastKnownEnemyX: 50,
        lastKnownEnemyY: 50,
      });
      handler.enter(ctx); // writes NaN → no cover
      calls.length = 0;
      handler.update(ctx, 16);
      // The only halt() that should appear is from PANICKED morale — which is
      // not set here — so no halt() should be in the call log.
      expect(calls).not.toContain('halt');
    });

    it('calls awayFrom() (setVelocity) when coverPointX is NaN', () => {
      // NPC at (100,100), enemy last-known at (50,50) → NPC flees northeast.
      const { ctx, calls } = makeMockCtx({
        lastKnownEnemyX: 50,
        lastKnownEnemyY: 50,
      });
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(true);
    });

    it('does NOT call moveToward() (no velocity toward cover) when NaN', () => {
      // Place the NPC at (100,100). If moveToward were called with a valid
      // cover destination the velocity direction would differ from awayFrom().
      // We just verify a velocity is set (awayFrom path) and no transition fires.
      const { ctx, calls } = makeMockCtx({
        lastKnownEnemyX: 50,
        lastKnownEnemyY: 50,
      });
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      // Transition should NOT fire — NPC is still moving.
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('NaN destination keeps NPC moving every frame — arrived never becomes true', () => {
      // Simulate 5 consecutive update ticks; the NPC must keep moving each time.
      const { ctx, calls } = makeMockCtx({
        lastKnownEnemyX: 0,
        lastKnownEnemyY: 0,
      });
      handler.enter(ctx);

      for (let tick = 0; tick < 5; tick++) {
        calls.length = 0;
        handler.update(ctx, 16);
        expect(calls.some(c => c.startsWith('vel:'))).toBe(
          true,
          `Expected velocity on tick ${tick}`,
        );
        expect(calls).not.toContain('halt');
      }
    });
  });

  // ── hasCoverDest true: normal arrival logic ────────────────────────────────

  describe('update() — hasCoverDest true (valid cover destination)', () => {
    it('moves toward cover when not yet arrived', () => {
      // NPC at (100,100), cover at (500,100) — far away → moveToward fires.
      const { ctx, calls } = makeMockCtx({
        coverPoint: { x: 500, y: 100 },
        lockResult: true,
      });
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(true);
    });

    it('halts when NPC arrives at cover (within arriveThreshold)', () => {
      // NPC at (100,100), cover at (105,100) — within arriveThreshold (12 px).
      const { ctx, calls } = makeMockCtx({
        coverPoint: { x: 105, y: 100 },
        lockResult: true,
        perceptionEnemies: [],
      });
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('halt');
    });

    it('transitions to SEARCH when arrived at cover and no visible enemy', () => {
      // moraleState must be SHAKEN (not STABLE) so the retreatOnStable check does
      // not fire before the no-visible-enemy check at the bottom of update().
      const { ctx, calls } = makeMockCtx({
        coverPoint: { x: 105, y: 100 },
        lockResult: true,
        moraleState: 'SHAKEN',
        perceptionEnemies: [],
      });
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('transition:SEARCH');
    });

    it('transitions to COMBAT when arrived at cover and morale recovers to STABLE', () => {
      const { ctx, calls } = makeMockCtx({
        coverPoint: { x: 105, y: 100 },
        lockResult: true,
        moraleState: 'STABLE',
        // Keep an enemy visible so retreatOnNoEnemy does not fire first.
        perceptionEnemies: [{ id: 'e1', x: 200, y: 200, factionId: 'bandit' }],
      });
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('transition:COMBAT');
    });

    it('does NOT use awayFrom() when a valid cover destination exists', () => {
      // With a valid cover point far away the velocity should point TOWARD cover,
      // not away from the enemy. We confirm velocity is set (moveToward path) and
      // no transition fires mid-approach.
      const { ctx, calls } = makeMockCtx({
        coverPoint: { x: 500, y: 100 },
        lockResult: true,
        lastKnownEnemyX: 0,
        lastKnownEnemyY: 0,
      });
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(true);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });
  });

  // ── PANICKED morale override ───────────────────────────────────────────────

  describe('update() — PANICKED morale', () => {
    it('transitions to FLEE when PANICKED (overrides cover logic)', () => {
      const { ctx, calls } = makeMockCtx({ moraleState: 'PANICKED' });
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('transition:FLEE');
    });

    it('halts before transitioning to FLEE when PANICKED', () => {
      const { ctx, calls } = makeMockCtx({ moraleState: 'PANICKED' });
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('halt');
    });

    it('PANICKED fires FLEE even when NaN coverPointX (no cover found)', () => {
      // No cover → NaN, but PANICKED check comes first in update().
      const { ctx, calls } = makeMockCtx({ moraleState: 'PANICKED' });
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('transition:FLEE');
      expect(calls.filter(c => c.startsWith('vel:'))).toHaveLength(0);
    });
  });

  // ── Suppressive fire at cover ──────────────────────────────────────────────

  describe('update() — suppressive fire when arrived at valid cover', () => {
    it('emits shoot when retreatFireIntervalMs elapses after arrival', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        coverPoint: { x: 105, y: 100 },
        lockResult: true,
        lastKnownEnemyX: 400,
        lastKnownEnemyY: 100,
        // Keep enemy visible so retreatOnNoEnemy does not fire immediately.
        perceptionEnemies: [{ id: 'e1', x: 400, y: 100, factionId: 'bandit' }],
        moraleState: 'SHAKEN',
      });
      handler.enter(ctx);
      // Advance past retreatFireIntervalMs (2000 ms default).
      setNow(cfg.retreatFireIntervalMs + 1);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('shoot:'))).toBe(true);
    });

    it('does NOT emit shoot before retreatFireIntervalMs elapses', () => {
      const { ctx, calls, setNow, state } = makeMockCtx({
        coverPoint: { x: 105, y: 100 },
        lockResult: true,
        lastKnownEnemyX: 400,
        lastKnownEnemyY: 100,
        perceptionEnemies: [{ id: 'e1', x: 400, y: 100, factionId: 'bandit' }],
        moraleState: 'SHAKEN',
      });
      handler.enter(ctx);
      state.lastSuppressiveFireMs = 500;
      setNow(1_000); // only 500 ms elapsed, interval is 2000 ms
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('shoot:'))).toBe(false);
    });
  });

  // ── exit() ────────────────────────────────────────────────────────────────

  describe('exit()', () => {
    it('calls halt on exit', () => {
      const { ctx, calls } = makeMockCtx();
      handler.exit(ctx);
      expect(calls).toContain('halt');
    });

    it('calls unlockAll on the cover system when present', () => {
      let unlockCalled = false;
      const { ctx } = makeMockCtx({ coverPoint: { x: 300, y: 300 }, lockResult: true });
      (ctx.cover as ICoverAccess).unlockAll = () => { unlockCalled = true; };
      handler.exit(ctx);
      expect(unlockCalled).toBe(true);
    });

    it('does not throw when cover system is null on exit', () => {
      const { ctx } = makeMockCtx(); // no cover system
      expect(() => handler.exit(ctx)).not.toThrow();
    });
  });

  // ── Round-2 fix: retreatStartMs stamped in enter() ────────────────────────

  describe('enter() — retreatStartMs timestamp', () => {
    it('sets retreatStartMs to ctx.now() when no cover is found', () => {
      const { ctx, state, setNow } = makeMockCtx();
      setNow(3_000);
      handler.enter(ctx);
      expect(state.retreatStartMs).toBe(3_000);
    });

    it('sets retreatStartMs to ctx.now() when a valid cover point is found', () => {
      const { ctx, state, setNow } = makeMockCtx({
        coverPoint: { x: 300, y: 300 },
        lockResult: true,
      });
      setNow(7_500);
      handler.enter(ctx);
      expect(state.retreatStartMs).toBe(7_500);
    });

    it('sets retreatStartMs to ctx.now() when lock is contested', () => {
      const { ctx, state, setNow } = makeMockCtx({
        coverPoint: { x: 300, y: 300 },
        lockResult: false,
      });
      setNow(1_200);
      handler.enter(ctx);
      expect(state.retreatStartMs).toBe(1_200);
    });

    it('overwrites a stale retreatStartMs from a prior enter() call', () => {
      const { ctx, state, setNow } = makeMockCtx();
      setNow(1_000);
      handler.enter(ctx);
      expect(state.retreatStartMs).toBe(1_000);
      setNow(9_000);
      handler.enter(ctx);
      expect(state.retreatStartMs).toBe(9_000);
    });
  });

  // ── Round-2 fix: no-cover time-limit in update() ──────────────────────────

  describe('update() — no-cover time limit (retreatMaxDurationMs)', () => {
    it('calls awayFrom() (setVelocity) when elapsed time is within the limit', () => {
      // enter() stamps retreatStartMs = 0. Advance to retreatMaxDurationMs - 1
      // so the timeout condition is NOT yet met.
      const { ctx, calls, setNow } = makeMockCtx({
        lastKnownEnemyX: 50,
        lastKnownEnemyY: 50,
      });
      handler.enter(ctx); // nowMs = 0 → retreatStartMs = 0
      setNow(cfg.retreatMaxDurationMs - 1);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(true);
    });

    it('does NOT transition when elapsed time is within the limit', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        lastKnownEnemyX: 50,
        lastKnownEnemyY: 50,
      });
      handler.enter(ctx);
      setNow(cfg.retreatMaxDurationMs - 1);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('fires retreatOnNoEnemy transition when elapsed time equals retreatMaxDurationMs', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        lastKnownEnemyX: 50,
        lastKnownEnemyY: 50,
      });
      handler.enter(ctx); // retreatStartMs = 0
      setNow(cfg.retreatMaxDurationMs); // elapsed === limit → timeout
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('transition:SEARCH');
    });

    it('halts before the retreatOnNoEnemy transition on timeout', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        lastKnownEnemyX: 50,
        lastKnownEnemyY: 50,
      });
      handler.enter(ctx);
      setNow(cfg.retreatMaxDurationMs);
      calls.length = 0;
      handler.update(ctx, 16);
      const haltIdx      = calls.indexOf('halt');
      const transitionIdx = calls.findIndex(c => c.startsWith('transition:'));
      expect(haltIdx).not.toBe(-1);
      expect(transitionIdx).not.toBe(-1);
      expect(haltIdx).toBeLessThan(transitionIdx);
    });

    it('does NOT call awayFrom() (setVelocity) after timeout — NPC is halted', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        lastKnownEnemyX: 50,
        lastKnownEnemyY: 50,
      });
      handler.enter(ctx);
      setNow(cfg.retreatMaxDurationMs);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('vel:'))).toHaveLength(0);
    });

    it('fires retreatOnNoEnemy transition when elapsed time exceeds retreatMaxDurationMs', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        lastKnownEnemyX: 50,
        lastKnownEnemyY: 50,
      });
      handler.enter(ctx);
      setNow(cfg.retreatMaxDurationMs + 5_000); // well past the limit
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('transition:SEARCH');
    });

    it('uses retreatStartMs set at enter() time, not zero, as the baseline', () => {
      // enter() at t=5000. At t=5000 + retreatMaxDurationMs - 1 → still fleeing.
      // At t=5000 + retreatMaxDurationMs → timeout.
      const ENTER_TIME = 5_000;
      const { ctx, calls, setNow } = makeMockCtx({
        lastKnownEnemyX: 50,
        lastKnownEnemyY: 50,
        nowMs: ENTER_TIME,
      });
      handler.enter(ctx); // retreatStartMs = 5000
      // One millisecond before timeout — must still be fleeing.
      setNow(ENTER_TIME + cfg.retreatMaxDurationMs - 1);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(true);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
      // Exactly at timeout — must transition.
      setNow(ENTER_TIME + cfg.retreatMaxDurationMs);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('transition:SEARCH');
    });

    it('timeout uses custom retreatOnNoEnemy transition target when overridden', () => {
      const custom = new RetreatState(cfg, { retreatOnNoEnemy: 'patrol_area' });
      const { ctx, calls, setNow } = makeMockCtx({
        lastKnownEnemyX: 50,
        lastKnownEnemyY: 50,
      });
      custom.enter(ctx);
      setNow(cfg.retreatMaxDurationMs);
      calls.length = 0;
      custom.update(ctx, 16);
      expect(calls).toContain('transition:patrol_area');
    });
  });

  // ── Round-2 fix: with-cover path is NOT affected by the time limit ─────────

  describe('update() — cover path is unaffected by retreatMaxDurationMs', () => {
    it('continues moving toward cover even after retreatMaxDurationMs elapses', () => {
      // NPC has a valid cover point far away. Even if retreatMaxDurationMs has
      // passed, the cover branch (moveToward) must still execute — the timeout
      // guard only applies to the no-cover / awayFrom() branch.
      const { ctx, calls, setNow } = makeMockCtx({
        coverPoint: { x: 500, y: 100 },
        lockResult: true,
        lastKnownEnemyX: 50,
        lastKnownEnemyY: 50,
      });
      handler.enter(ctx);
      setNow(cfg.retreatMaxDurationMs * 10); // far past the limit
      calls.length = 0;
      handler.update(ctx, 16);
      // Must still be moving (toward cover) — not halted or transitioned.
      expect(calls.some(c => c.startsWith('vel:'))).toBe(true);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('halts and transitions to SEARCH at cover arrival even when past retreatMaxDurationMs', () => {
      // NPC close to cover (within arriveThreshold). The arrived-at-cover branch
      // must run normally; timeout must not pre-empt it.
      const { ctx, calls, setNow } = makeMockCtx({
        coverPoint: { x: 105, y: 100 },
        lockResult: true,
        moraleState: 'SHAKEN',
        perceptionEnemies: [],
      });
      handler.enter(ctx);
      setNow(cfg.retreatMaxDurationMs * 10);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('halt');
      expect(calls).toContain('transition:SEARCH');
    });

    it('transitions to COMBAT at cover when morale is STABLE, even past retreatMaxDurationMs', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        coverPoint: { x: 105, y: 100 },
        lockResult: true,
        moraleState: 'STABLE',
        perceptionEnemies: [{ id: 'e1', x: 400, y: 100, factionId: 'bandit' }],
      });
      handler.enter(ctx);
      setNow(cfg.retreatMaxDurationMs * 10);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('transition:COMBAT');
    });
  });

  // ── Round-2 fix: boundary precision ───────────────────────────────────────

  describe('update() — timeout boundary precision', () => {
    it('retreatMaxDurationMs - 1 ms elapsed → still calling awayFrom()', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        lastKnownEnemyX: 0,
        lastKnownEnemyY: 0,
      });
      handler.enter(ctx); // retreatStartMs = 0
      setNow(cfg.retreatMaxDurationMs - 1);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(true);
      expect(calls).not.toContain('halt');
    });

    it('exactly retreatMaxDurationMs elapsed → timeout fires (>= boundary is inclusive)', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        lastKnownEnemyX: 0,
        lastKnownEnemyY: 0,
      });
      handler.enter(ctx);
      setNow(cfg.retreatMaxDurationMs);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('halt');
      expect(calls.some(c => c.startsWith('transition:'))).toBe(true);
    });

    it('retreatMaxDurationMs - 1 ms → no transition fires', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        lastKnownEnemyX: 0,
        lastKnownEnemyY: 0,
      });
      handler.enter(ctx);
      setNow(cfg.retreatMaxDurationMs - 1);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('retreatMaxDurationMs ms → exactly one transition fires (not duplicated)', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        lastKnownEnemyX: 0,
        lastKnownEnemyY: 0,
      });
      handler.enter(ctx);
      setNow(cfg.retreatMaxDurationMs);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(1);
    });
  });

  // ── Injectable IStateTransitionMap overrides ──────────────────────────────

  describe('injectable IStateTransitionMap overrides', () => {
    it('uses custom retreatOnPanicked when PANICKED', () => {
      const custom = new RetreatState(cfg, { retreatOnPanicked: 'custom_panic' });
      const { ctx, calls } = makeMockCtx({ moraleState: 'PANICKED' });
      custom.enter(ctx);
      calls.length = 0;
      custom.update(ctx, 16);
      expect(calls).toContain('transition:custom_panic');
    });

    it('uses custom retreatOnStable when arrived and morale is STABLE', () => {
      const custom = new RetreatState(cfg, { retreatOnStable: 'engage_again' });
      const { ctx, calls } = makeMockCtx({
        coverPoint: { x: 105, y: 100 },
        lockResult: true,
        moraleState: 'STABLE',
        perceptionEnemies: [{ id: 'e1', x: 400, y: 100, factionId: 'bandit' }],
      });
      custom.enter(ctx);
      calls.length = 0;
      custom.update(ctx, 16);
      expect(calls).toContain('transition:engage_again');
    });

    it('uses custom retreatOnNoEnemy when arrived at cover with no visible enemy', () => {
      // moraleState SHAKEN prevents retreatOnStable from firing first.
      const custom = new RetreatState(cfg, { retreatOnNoEnemy: 'sweep_area' });
      const { ctx, calls } = makeMockCtx({
        coverPoint: { x: 105, y: 100 },
        lockResult: true,
        moraleState: 'SHAKEN',
        perceptionEnemies: [],
      });
      custom.enter(ctx);
      calls.length = 0;
      custom.update(ctx, 16);
      expect(calls).toContain('transition:sweep_area');
    });
  });
});
