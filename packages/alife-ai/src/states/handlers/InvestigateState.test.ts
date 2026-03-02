// states/handlers/InvestigateState.test.ts
// Tests for InvestigateState — two-phase approach + look-around handler.

import { describe, it, expect, beforeEach } from 'vitest';
import { createDefaultNPCOnlineState } from '../NPCOnlineState';
import { createDefaultStateConfig } from '../IStateConfig';
import type { INPCContext } from '../INPCContext';
import type { INPCOnlineState } from '../INPCOnlineState';
import type { IStateConfig } from '../IStateConfig';
import { InvestigateState } from './InvestigateState';

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

interface MockCtxOptions {
  perceptionEnemies?: Array<{ id: string; x: number; y: number; factionId: string }>;
  nowMs?: number;
  x?: number;
  y?: number;
  moraleState?: INPCOnlineState['moraleState'];
}

function makeMockCtx(overrides: MockCtxOptions = {}) {
  const calls: string[] = [];
  const state: INPCOnlineState = createDefaultNPCOnlineState();
  if (overrides.moraleState) state.moraleState = overrides.moraleState;
  let nowMs = overrides.nowMs ?? 0;

  let enemies = overrides.perceptionEnemies ?? [];

  const ctx: INPCContext = {
    npcId: 'npc-1',
    factionId: 'stalker',
    entityType: 'human',
    x: overrides.x ?? 100,
    y: overrides.y ?? 100,
    state,
    currentStateId: 'INVESTIGATE',
    perception: {
      getVisibleEnemies: () => enemies,
      getVisibleAllies:  () => [],
      getNearbyItems:    () => [],
      hasVisibleEnemy:   () => enemies.length > 0,
    },
    health: null,
    setVelocity:        (vx, vy) => { calls.push(`vel:${vx},${vy}`); },
    halt:               ()       => { calls.push('halt'); },
    setRotation:        (r)      => { calls.push(`rot:${r}`); },
    setAlpha:           (a)      => { calls.push(`alpha:${a}`); },
    teleport:           (x, y)   => { calls.push(`teleport:${x},${y}`); },
    disablePhysics:     ()       => { calls.push('disablePhysics'); },
    transition:         (s)      => { calls.push(`transition:${s}`); },
    emitShoot:          ()       => {},
    emitMeleeHit:       ()       => {},
    emitVocalization:   (t)      => { calls.push(`vocal:${t}`); },
    emitPsiAttackStart: ()       => {},
    cover: null, danger: null, restrictedZones: null,
    squad: null, conditions: null, suspicion: null,
    now:    () => nowMs,
    random: () => 0.5,
  };

  return {
    ctx,
    calls,
    state,
    setNow:     (ms: number)  => { nowMs = ms; },
    setEnemies: (e: typeof enemies) => { enemies = e; },
  };
}

function makeSuspicion(reached: boolean, pos?: { x: number; y: number } | null) {
  let cleared = false;
  return {
    mock: {
      hasReachedAlert: () => reached,
      getLastKnownPosition: () => pos ?? null,
      clear: () => { cleared = true; },
      clearPosition: () => {},
      getLevel: () => (reached ? 0.9 : 0.1),
      add: () => {},
    },
    wasCleared: () => cleared,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InvestigateState', () => {
  let cfg: IStateConfig;
  let handler: InvestigateState;

  beforeEach(() => {
    cfg     = createDefaultStateConfig();
    handler = new InvestigateState(cfg);
  });

  // ── enter() ───────────────────────────────────────────────────────────────

  describe('enter()', () => {
    it('halts NPC', () => {
      const { ctx, calls } = makeMockCtx();
      handler.enter(ctx);
      expect(calls).toContain('halt');
    });

    it('records investigateStartMs', () => {
      const { ctx } = makeMockCtx({ nowMs: 5_000 });
      handler.enter(ctx);
      expect(ctx.state.investigateStartMs).toBe(5_000);
    });

    it('resets investigateLookAroundStartMs to -1 (sentinel: not yet arrived)', () => {
      const { ctx } = makeMockCtx();
      ctx.state.investigateLookAroundStartMs = 9_999;
      handler.enter(ctx);
      expect(ctx.state.investigateLookAroundStartMs).toBe(-1);
    });

    it('emits INVESTIGATE_START vocalization', () => {
      const { ctx, calls } = makeMockCtx();
      handler.enter(ctx);
      expect(calls).toContain('vocal:INVESTIGATE_START');
    });
  });

  // ── update() — morale check ────────────────────────────────────────────────

  describe('update() — morale check', () => {
    it('PANICKED morale → halt + investigateOnPanic (FLEE)', () => {
      const { ctx, calls } = makeMockCtx({ moraleState: 'PANICKED' });
      ctx.state.lastKnownEnemyX = 500;
      ctx.state.lastKnownEnemyY = 100;
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('halt');
      expect(calls).toContain('transition:FLEE');
    });

    it('SHAKEN morale → no panic transition, continues approach', () => {
      const { ctx, calls } = makeMockCtx({ x: 100, y: 100, moraleState: 'SHAKEN' });
      ctx.state.lastKnownEnemyX = 500;
      ctx.state.lastKnownEnemyY = 100;
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls.filter(c => c === 'transition:FLEE')).toHaveLength(0);
    });

    it('investigateOnPanic override routes to custom state', () => {
      const custom = new InvestigateState(cfg, { investigateOnPanic: 'RETREAT' });
      const { ctx, calls } = makeMockCtx({ moraleState: 'PANICKED' });
      custom.enter(ctx);
      calls.length = 0;
      custom.update(ctx, 16);
      expect(calls).toContain('transition:RETREAT');
    });
  });

  // ── update() — Phase 1: APPROACH ──────────────────────────────────────────

  describe('update() — approach phase', () => {
    it('visible enemy → halt + transition to investigateOnEnemy (ALERT)', () => {
      const { ctx, calls } = makeMockCtx({
        perceptionEnemies: [{ id: 'e1', x: 300, y: 300, factionId: 'bandits' }],
      });
      ctx.state.lastKnownEnemyX = 500;
      ctx.state.lastKnownEnemyY = 100;
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('halt');
      expect(calls).toContain('transition:ALERT');
    });

    it('visible enemy updates lastKnownEnemy and targetId', () => {
      const { ctx } = makeMockCtx({
        perceptionEnemies: [{ id: 'e1', x: 222, y: 333, factionId: 'bandits' }],
      });
      ctx.state.lastKnownEnemyX = 500;
      ctx.state.lastKnownEnemyY = 100;
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(ctx.state.lastKnownEnemyX).toBe(222);
      expect(ctx.state.lastKnownEnemyY).toBe(333);
      expect(ctx.state.targetId).toBe('e1');
    });

    it('moves toward lastKnownEnemyX/Y when far away', () => {
      const { ctx, calls } = makeMockCtx({ x: 100, y: 100 });
      ctx.state.lastKnownEnemyX = 500;
      ctx.state.lastKnownEnemyY = 100;
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(true);
    });

    it('arrival within arriveThreshold → sets investigateLookAroundStartMs to ctx.now()', () => {
      const { ctx } = makeMockCtx({ x: 100, y: 100, nowMs: 1_000 });
      ctx.state.lastKnownEnemyX = 100 + cfg.arriveThreshold / 2;
      ctx.state.lastKnownEnemyY = 100;
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(ctx.state.investigateLookAroundStartMs).toBe(1_000);
    });

    it('arrival when ctx.now() === 0 → investigateLookAroundStartMs = 0 (phase 2 active)', () => {
      // Sentinel is -1; arrival writes 0 which is >= 0 → phase 2 correctly activates.
      const { ctx } = makeMockCtx({ x: 100, y: 100, nowMs: 0 });
      ctx.state.lastKnownEnemyX = 100 + cfg.arriveThreshold / 2;
      ctx.state.lastKnownEnemyY = 100;
      handler.enter(ctx); // sets investigateLookAroundStartMs = -1
      handler.update(ctx, 16); // arrives at t=0 → writes 0 → 0 >= 0 → phase 2
      expect(ctx.state.investigateLookAroundStartMs).toBe(0);
    });

    it('arrival halts NPC', () => {
      const { ctx, calls } = makeMockCtx({ x: 100, y: 100 });
      ctx.state.lastKnownEnemyX = 100 + cfg.arriveThreshold / 2;
      ctx.state.lastKnownEnemyY = 100;
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('halt');
    });

    it('arrival sets rotation toward destination', () => {
      const { ctx, calls } = makeMockCtx({ x: 100, y: 100 });
      // slightly to the right
      ctx.state.lastKnownEnemyX = 100 + cfg.arriveThreshold / 2;
      ctx.state.lastKnownEnemyY = 100;
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('rot:'))).toBe(true);
    });

    it('overall timeout (investigateMaxDurationMs) → investigateOnTimeout + suspicion cleared', () => {
      const { ctx, calls, setNow } = makeMockCtx({ x: 100, y: 100, nowMs: 0 });
      // place target far away so NPC never arrives
      ctx.state.lastKnownEnemyX = 10_000;
      ctx.state.lastKnownEnemyY = 100;
      const { mock, wasCleared } = makeSuspicion(false);
      (ctx as unknown as Record<string, unknown>).suspicion = mock;
      handler.enter(ctx);
      setNow(cfg.investigateMaxDurationMs + 1);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('halt');
      expect(calls).toContain('transition:PATROL');
      expect(wasCleared()).toBe(true);
    });
  });

  // ── update() — Phase 2: LOOK_AROUND ───────────────────────────────────────

  describe('update() — look-around phase', () => {
    // Start at nowMs: 1 so arrival sets investigateLookAroundStartMs = 1 >= 0.
    function arriveAndStart(ctx: INPCContext) {
      ctx.state.lastKnownEnemyX = ctx.x + cfg.arriveThreshold / 2;
      ctx.state.lastKnownEnemyY = ctx.y;
      handler.enter(ctx);
      handler.update(ctx, 16); // arrives at t=1, sets investigateLookAroundStartMs=1
    }

    it('halts NPC each look-around frame', () => {
      const { ctx, calls, setNow } = makeMockCtx({ x: 100, y: 100, nowMs: 1 });
      arriveAndStart(ctx);
      calls.length = 0;
      setNow(100);
      handler.update(ctx, 16);
      expect(calls).toContain('halt');
    });

    it('calls setRotation to simulate scanning', () => {
      const { ctx, calls, setNow } = makeMockCtx({ x: 100, y: 100, nowMs: 1 });
      arriveAndStart(ctx);
      calls.length = 0;
      setNow(500);
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('rot:'))).toBe(true);
    });

    it('does NOT call ctx.random() — jitter is deterministic', () => {
      // ctx.random is not present in mock → would throw if called
      const { ctx, calls, setNow } = makeMockCtx({ x: 100, y: 100, nowMs: 1 });
      (ctx as unknown as Record<string, unknown>).random = () => { throw new Error('random() called'); };
      arriveAndStart(ctx);
      calls.length = 0;
      setNow(500);
      expect(() => handler.update(ctx, 16)).not.toThrow();
    });

    it('visible enemy during look-around → halt + investigateOnEnemy', () => {
      const { ctx, calls, setNow, setEnemies } = makeMockCtx({ x: 100, y: 100, nowMs: 1 });
      arriveAndStart(ctx);
      calls.length = 0;
      setEnemies([{ id: 'e2', x: 200, y: 200, factionId: 'bandits' }]);
      setNow(500);
      handler.update(ctx, 16);
      expect(calls).toContain('halt');
      expect(calls).toContain('transition:ALERT');
    });

    it('look-around timeout → halt + transition investigateOnTimeout (PATROL)', () => {
      const { ctx, calls, setNow } = makeMockCtx({ x: 100, y: 100, nowMs: 1 });
      arriveAndStart(ctx);
      calls.length = 0;
      setNow(1 + cfg.investigateLookAroundMs + 1);
      handler.update(ctx, 16);
      expect(calls).toContain('halt');
      expect(calls).toContain('transition:PATROL');
    });

    it('look-around timeout calls suspicion.clear()', () => {
      const { ctx, setNow } = makeMockCtx({ x: 100, y: 100, nowMs: 1 });
      arriveAndStart(ctx);
      const { mock, wasCleared } = makeSuspicion(false);
      (ctx as unknown as Record<string, unknown>).suspicion = mock;
      setNow(1 + cfg.investigateLookAroundMs + 1);
      handler.update(ctx, 16);
      expect(wasCleared()).toBe(true);
    });

    it('before timeout → no transition fired', () => {
      const { ctx, calls, setNow } = makeMockCtx({ x: 100, y: 100, nowMs: 1 });
      arriveAndStart(ctx);
      calls.length = 0;
      setNow(1 + cfg.investigateLookAroundMs / 2);
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('investigateLookAroundMs = 0 → instant look-around, immediate timeout on next frame', () => {
      const fastCfg = createDefaultStateConfig({ investigateLookAroundMs: 0 });
      const fastHandler = new InvestigateState(fastCfg);
      const { ctx, calls, setNow } = makeMockCtx({ x: 100, y: 100, nowMs: 1 });
      ctx.state.lastKnownEnemyX = ctx.x + fastCfg.arriveThreshold / 2;
      ctx.state.lastKnownEnemyY = ctx.y;
      fastHandler.enter(ctx);
      fastHandler.update(ctx, 16); // arrives → phase 2
      calls.length = 0;
      setNow(2); // any time >= arrival → elapsed >= 0 === lookAroundMs
      fastHandler.update(ctx, 16);
      expect(calls).toContain('transition:PATROL');
    });

    it('PANICKED morale during look-around → investigateOnPanic', () => {
      const { ctx, calls, setNow } = makeMockCtx({ x: 100, y: 100, nowMs: 1 });
      arriveAndStart(ctx);
      ctx.state.moraleState = 'PANICKED';
      calls.length = 0;
      setNow(500);
      handler.update(ctx, 16);
      expect(calls).toContain('transition:FLEE');
    });
  });

  // ── Suspicion re-accumulation (opt-in) ────────────────────────────────────

  describe('suspicion checks', () => {
    it('approach: above threshold with position → investigateOnEnemy + clear() called', () => {
      const { ctx, calls } = makeMockCtx({ x: 100, y: 100 });
      ctx.state.lastKnownEnemyX = 500;
      ctx.state.lastKnownEnemyY = 100;
      const { mock, wasCleared } = makeSuspicion(true, { x: 400, y: 100 });
      (ctx as unknown as Record<string, unknown>).suspicion = mock;
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('transition:ALERT');
      expect(wasCleared()).toBe(true);
    });

    it('approach: above threshold, position updates lastKnownEnemy', () => {
      const { ctx } = makeMockCtx({ x: 100, y: 100 });
      ctx.state.lastKnownEnemyX = 500;
      ctx.state.lastKnownEnemyY = 100;
      const { mock } = makeSuspicion(true, { x: 400, y: 200 });
      (ctx as unknown as Record<string, unknown>).suspicion = mock;
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(ctx.state.lastKnownEnemyX).toBe(400);
      expect(ctx.state.lastKnownEnemyY).toBe(200);
    });

    it('approach: above threshold, no position → lastKnown unchanged', () => {
      const { ctx } = makeMockCtx({ x: 100, y: 100 });
      ctx.state.lastKnownEnemyX = 500;
      ctx.state.lastKnownEnemyY = 100;
      const { mock } = makeSuspicion(true, null);
      (ctx as unknown as Record<string, unknown>).suspicion = mock;
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(ctx.state.lastKnownEnemyX).toBe(500);
      expect(ctx.state.lastKnownEnemyY).toBe(100);
    });

    it('approach: suspicion null → no throw, no transition', () => {
      const { ctx, calls } = makeMockCtx({ x: 100, y: 100 });
      ctx.state.lastKnownEnemyX = 500;
      ctx.state.lastKnownEnemyY = 100;
      handler.enter(ctx);
      calls.length = 0;
      expect(() => handler.update(ctx, 16)).not.toThrow();
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('approach: below threshold → no transition', () => {
      const { ctx, calls } = makeMockCtx({ x: 100, y: 100 });
      ctx.state.lastKnownEnemyX = 500;
      ctx.state.lastKnownEnemyY = 100;
      const { mock } = makeSuspicion(false);
      (ctx as unknown as Record<string, unknown>).suspicion = mock;
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('look-around: above threshold → investigateOnEnemy', () => {
      const { ctx, calls, setNow } = makeMockCtx({ x: 100, y: 100, nowMs: 1 });
      ctx.state.lastKnownEnemyX = 100 + cfg.arriveThreshold / 2;
      ctx.state.lastKnownEnemyY = 100;
      handler.enter(ctx);
      handler.update(ctx, 16); // arrives at t=1
      calls.length = 0;
      const { mock } = makeSuspicion(true, { x: 300, y: 100 });
      (ctx as unknown as Record<string, unknown>).suspicion = mock;
      setNow(500);
      handler.update(ctx, 16);
      expect(calls).toContain('transition:ALERT');
    });
  });

  // ── Transition overrides ──────────────────────────────────────────────────

  describe('transition overrides', () => {
    it('investigateOnEnemy override routes enemy detection to custom state', () => {
      const custom = new InvestigateState(cfg, { investigateOnEnemy: 'COMBAT' });
      const { ctx, calls } = makeMockCtx({
        perceptionEnemies: [{ id: 'e1', x: 200, y: 200, factionId: 'bandits' }],
      });
      ctx.state.lastKnownEnemyX = 500;
      ctx.state.lastKnownEnemyY = 100;
      custom.enter(ctx);
      calls.length = 0;
      custom.update(ctx, 16);
      expect(calls).toContain('transition:COMBAT');
    });

    it('investigateOnTimeout override routes timeout to custom state', () => {
      const custom = new InvestigateState(cfg, { investigateOnTimeout: 'IDLE' });
      const { ctx, calls, setNow } = makeMockCtx({ x: 100, y: 100, nowMs: 1 });
      ctx.state.lastKnownEnemyX = 100 + cfg.arriveThreshold / 2;
      ctx.state.lastKnownEnemyY = 100;
      custom.enter(ctx);
      custom.update(ctx, 16); // arrive at t=1
      calls.length = 0;
      setNow(1 + cfg.investigateLookAroundMs + 1);
      custom.update(ctx, 16);
      expect(calls).toContain('transition:IDLE');
    });
  });

  // ── exit() ────────────────────────────────────────────────────────────────

  describe('exit()', () => {
    it('halts NPC', () => {
      const { ctx, calls } = makeMockCtx();
      handler.enter(ctx);
      calls.length = 0;
      handler.exit(ctx);
      expect(calls).toContain('halt');
    });

    it('resets investigateLookAroundStartMs to -1', () => {
      const { ctx } = makeMockCtx({ x: 100, y: 100, nowMs: 1 });
      ctx.state.lastKnownEnemyX = 100 + cfg.arriveThreshold / 2;
      ctx.state.lastKnownEnemyY = 100;
      handler.enter(ctx);
      handler.update(ctx, 16); // arrives at t=1 → lookAroundStartMs = 1 >= 0
      expect(ctx.state.investigateLookAroundStartMs).toBeGreaterThanOrEqual(0);
      handler.exit(ctx);
      expect(ctx.state.investigateLookAroundStartMs).toBe(-1);
    });

    it('resets investigateStartMs to 0', () => {
      const { ctx } = makeMockCtx({ nowMs: 5_000 });
      handler.enter(ctx);
      expect(ctx.state.investigateStartMs).toBe(5_000);
      handler.exit(ctx);
      expect(ctx.state.investigateStartMs).toBe(0);
    });
  });
});
