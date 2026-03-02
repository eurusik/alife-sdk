// states/handlers/HelpWoundedState.test.ts
// Tests for HelpWoundedState — two-phase approach + assist handler.

import { describe, it, expect, beforeEach } from 'vitest';
import { createDefaultNPCOnlineState } from '../NPCOnlineState';
import { createDefaultStateConfig } from '../IStateConfig';
import type { INPCContext } from '../INPCContext';
import type { INPCOnlineState } from '../INPCOnlineState';
import type { IStateConfig } from '../IStateConfig';
import { HelpWoundedState } from './HelpWoundedState';

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

type WoundedAlly = { id: string; x: number; y: number; hpPercent: number };

interface MockCtxOptions {
  perceptionEnemies?: Array<{ id: string; x: number; y: number; factionId: string }>;
  woundedAllies?: WoundedAlly[];
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
  let wounded = overrides.woundedAllies ?? [];

  const ctx: INPCContext = {
    npcId: 'npc-1',
    factionId: 'stalker',
    entityType: 'human',
    x: overrides.x ?? 100,
    y: overrides.y ?? 100,
    state,
    currentStateId: 'HELP_WOUNDED',
    perception: {
      getVisibleEnemies:  () => enemies,
      getVisibleAllies:   () => [],
      getNearbyItems:     () => [],
      hasVisibleEnemy:    () => enemies.length > 0,
      getWoundedAllies:   () => wounded,
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
    setNow:         (ms: number)      => { nowMs = ms; },
    setEnemies:     (e: typeof enemies) => { enemies = e; },
    setWounded:     (w: WoundedAlly[]) => { wounded = w; },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HelpWoundedState', () => {
  let cfg: IStateConfig;
  let handler: HelpWoundedState;

  beforeEach(() => {
    cfg     = createDefaultStateConfig();
    handler = new HelpWoundedState(cfg);
  });

  // ── enter() ───────────────────────────────────────────────────────────────

  describe('enter()', () => {
    it('halts NPC', () => {
      const { ctx, calls } = makeMockCtx();
      handler.enter(ctx);
      expect(calls).toContain('halt');
    });

    it('records helpWoundedStartMs', () => {
      const { ctx } = makeMockCtx({ nowMs: 3_000 });
      handler.enter(ctx);
      expect(ctx.state.helpWoundedStartMs).toBe(3_000);
    });

    it('resets helpWoundedAssistStartMs to -1', () => {
      const { ctx } = makeMockCtx();
      ctx.state.helpWoundedAssistStartMs = 9_999;
      handler.enter(ctx);
      expect(ctx.state.helpWoundedAssistStartMs).toBe(-1);
    });

    it('emits HELP_WOUNDED_MOVING vocalization', () => {
      const { ctx, calls } = makeMockCtx();
      handler.enter(ctx);
      expect(calls).toContain('vocal:HELP_WOUNDED_MOVING');
    });
  });

  // ── update() — morale check ────────────────────────────────────────────────

  describe('update() — morale check', () => {
    it('PANICKED → halt + helpWoundedOnPanic (FLEE)', () => {
      const { ctx, calls } = makeMockCtx({ moraleState: 'PANICKED' });
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('halt');
      expect(calls).toContain('transition:FLEE');
    });

    it('SHAKEN morale → no panic transition', () => {
      const ally: WoundedAlly = { id: 'a1', x: 500, y: 100, hpPercent: 0.1 };
      const { ctx, calls } = makeMockCtx({ x: 100, y: 100, moraleState: 'SHAKEN', woundedAllies: [ally] });
      ctx.state.helpWoundedTargetId = 'a1';
      ctx.state.helpWoundedX = ally.x;
      ctx.state.helpWoundedY = ally.y;
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls.filter(c => c === 'transition:FLEE')).toHaveLength(0);
    });

    it('investigateOnPanic override fires custom state', () => {
      const custom = new HelpWoundedState(cfg, { helpWoundedOnPanic: 'RETREAT' });
      const { ctx, calls } = makeMockCtx({ moraleState: 'PANICKED' });
      custom.enter(ctx);
      calls.length = 0;
      custom.update(ctx, 16);
      expect(calls).toContain('transition:RETREAT');
    });
  });

  // ── update() — Phase 1: APPROACH ──────────────────────────────────────────

  describe('update() — approach phase', () => {
    function setupApproach(ctx: INPCContext, ally: WoundedAlly) {
      ctx.state.helpWoundedTargetId = ally.id;
      ctx.state.helpWoundedX        = ally.x;
      ctx.state.helpWoundedY        = ally.y;
    }

    it('visible enemy → halt + helpWoundedOnEnemy (ALERT)', () => {
      const ally: WoundedAlly = { id: 'a1', x: 500, y: 100, hpPercent: 0.1 };
      const { ctx, calls } = makeMockCtx({
        x: 100, y: 100,
        woundedAllies: [ally],
        perceptionEnemies: [{ id: 'e1', x: 300, y: 300, factionId: 'bandits' }],
      });
      setupApproach(ctx, ally);
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('halt');
      expect(calls).toContain('transition:ALERT');
    });

    it('visible enemy updates lastKnownEnemy and targetId', () => {
      const ally: WoundedAlly = { id: 'a1', x: 500, y: 100, hpPercent: 0.1 };
      const { ctx } = makeMockCtx({
        x: 100, y: 100,
        woundedAllies: [ally],
        perceptionEnemies: [{ id: 'e1', x: 222, y: 333, factionId: 'bandits' }],
      });
      setupApproach(ctx, ally);
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(ctx.state.lastKnownEnemyX).toBe(222);
      expect(ctx.state.lastKnownEnemyY).toBe(333);
      expect(ctx.state.targetId).toBe('e1');
    });

    it('moves toward ally position', () => {
      const ally: WoundedAlly = { id: 'a1', x: 500, y: 100, hpPercent: 0.1 };
      const { ctx, calls } = makeMockCtx({ x: 100, y: 100, woundedAllies: [ally] });
      setupApproach(ctx, ally);
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(true);
    });

    it('updates helpWoundedX/Y from live perception each frame', () => {
      const ally: WoundedAlly = { id: 'a1', x: 500, y: 100, hpPercent: 0.1 };
      const { ctx, state, setWounded } = makeMockCtx({ x: 100, y: 100, woundedAllies: [ally] });
      setupApproach(ctx, ally);
      handler.enter(ctx);
      // Ally crawls
      setWounded([{ id: 'a1', x: 520, y: 110, hpPercent: 0.1 }]);
      handler.update(ctx, 16);
      expect(state.helpWoundedX).toBe(520);
      expect(state.helpWoundedY).toBe(110);
    });

    it('ally gone from list → halt + helpWoundedOnComplete (PATROL)', () => {
      const { ctx, calls } = makeMockCtx({ x: 100, y: 100 });
      // Pre-set target but no wounded allies in perception
      ctx.state.helpWoundedTargetId = 'a1';
      ctx.state.helpWoundedX = 500;
      ctx.state.helpWoundedY = 100;
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('halt');
      expect(calls).toContain('transition:PATROL');
    });

    it('overall timeout → halt + helpWoundedOnComplete', () => {
      const ally: WoundedAlly = { id: 'a1', x: 10_000, y: 100, hpPercent: 0.1 };
      const { ctx, calls, setNow } = makeMockCtx({ x: 100, y: 100, nowMs: 0, woundedAllies: [ally] });
      setupApproach(ctx, ally);
      handler.enter(ctx);
      setNow(cfg.helpWoundedMaxDurationMs + 1);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('halt');
      expect(calls).toContain('transition:PATROL');
    });

    it('arrival within arriveThreshold → sets helpWoundedAssistStartMs', () => {
      const ally: WoundedAlly = { id: 'a1', x: 100 + cfg.arriveThreshold / 2, y: 100, hpPercent: 0.1 };
      const { ctx } = makeMockCtx({ x: 100, y: 100, nowMs: 1_000, woundedAllies: [ally] });
      setupApproach(ctx, ally);
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(ctx.state.helpWoundedAssistStartMs).toBe(1_000);
    });

    it('arrival halts NPC and emits HELP_WOUNDED_ASSIST vocalization', () => {
      const ally: WoundedAlly = { id: 'a1', x: 100 + cfg.arriveThreshold / 2, y: 100, hpPercent: 0.1 };
      const { ctx, calls } = makeMockCtx({ x: 100, y: 100, woundedAllies: [ally] });
      setupApproach(ctx, ally);
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('halt');
      expect(calls).toContain('vocal:HELP_WOUNDED_ASSIST');
    });
  });

  // ── update() — Phase 2: ASSIST ────────────────────────────────────────────

  describe('update() — assist phase', () => {
    function arriveAndAssist(ctx: INPCContext, ally: WoundedAlly) {
      ctx.state.helpWoundedTargetId = ally.id;
      ctx.state.helpWoundedX = ally.x;
      ctx.state.helpWoundedY = ally.y;
      handler.enter(ctx);
      handler.update(ctx, 16); // arrive → helpWoundedAssistStartMs set
    }

    it('halts NPC each assist frame', () => {
      const ally: WoundedAlly = { id: 'a1', x: 100 + cfg.arriveThreshold / 2, y: 100, hpPercent: 0.1 };
      const { ctx, calls, setNow } = makeMockCtx({ x: 100, y: 100, nowMs: 1, woundedAllies: [ally] });
      arriveAndAssist(ctx, ally);
      calls.length = 0;
      setNow(500);
      handler.update(ctx, 16);
      expect(calls).toContain('halt');
    });

    it('ally healed (gone from list) → helpWoundedOnComplete', () => {
      const ally: WoundedAlly = { id: 'a1', x: 100 + cfg.arriveThreshold / 2, y: 100, hpPercent: 0.1 };
      const { ctx, calls, setNow, setWounded } = makeMockCtx({ x: 100, y: 100, nowMs: 1, woundedAllies: [ally] });
      arriveAndAssist(ctx, ally);
      setWounded([]); // ally healed
      calls.length = 0;
      setNow(500);
      handler.update(ctx, 16);
      expect(calls).toContain('transition:PATROL');
    });

    it('assist timer expires → helpWoundedOnComplete', () => {
      const ally: WoundedAlly = { id: 'a1', x: 100 + cfg.arriveThreshold / 2, y: 100, hpPercent: 0.1 };
      const { ctx, calls, setNow } = makeMockCtx({ x: 100, y: 100, nowMs: 1, woundedAllies: [ally] });
      arriveAndAssist(ctx, ally);
      calls.length = 0;
      setNow(1 + cfg.helpWoundedAssistMs + 1);
      handler.update(ctx, 16);
      expect(calls).toContain('transition:PATROL');
    });

    it('enemy appears during assist → helpWoundedOnEnemy', () => {
      const ally: WoundedAlly = { id: 'a1', x: 100 + cfg.arriveThreshold / 2, y: 100, hpPercent: 0.1 };
      const { ctx, calls, setNow, setEnemies } = makeMockCtx({ x: 100, y: 100, nowMs: 1, woundedAllies: [ally] });
      arriveAndAssist(ctx, ally);
      setEnemies([{ id: 'e1', x: 300, y: 300, factionId: 'bandits' }]);
      calls.length = 0;
      setNow(500);
      handler.update(ctx, 16);
      expect(calls).toContain('transition:ALERT');
    });

    it('PANICKED during assist → helpWoundedOnPanic', () => {
      const ally: WoundedAlly = { id: 'a1', x: 100 + cfg.arriveThreshold / 2, y: 100, hpPercent: 0.1 };
      const { ctx, calls, setNow } = makeMockCtx({ x: 100, y: 100, nowMs: 1, woundedAllies: [ally] });
      arriveAndAssist(ctx, ally);
      ctx.state.moraleState = 'PANICKED';
      calls.length = 0;
      setNow(500);
      handler.update(ctx, 16);
      expect(calls).toContain('transition:FLEE');
    });

    it('before timer, ally still wounded → no transition', () => {
      const ally: WoundedAlly = { id: 'a1', x: 100 + cfg.arriveThreshold / 2, y: 100, hpPercent: 0.1 };
      const { ctx, calls, setNow } = makeMockCtx({ x: 100, y: 100, nowMs: 1, woundedAllies: [ally] });
      arriveAndAssist(ctx, ally);
      calls.length = 0;
      setNow(1 + cfg.helpWoundedAssistMs / 2);
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });
  });

  // ── opt-in: getWoundedAllies not implemented ──────────────────────────────

  describe('opt-in: no getWoundedAllies', () => {
    it('ally gone immediately → helpWoundedOnComplete on first update', () => {
      const { ctx, calls } = makeMockCtx();
      // No getWoundedAllies in perception (mock provides it empty)
      ctx.state.helpWoundedTargetId = 'a1';
      ctx.state.helpWoundedX = 500;
      ctx.state.helpWoundedY = 100;
      // Override perception to omit getWoundedAllies
      (ctx as unknown as Record<string, unknown>).perception = {
        getVisibleEnemies:  () => [],
        getVisibleAllies:   () => [],
        getNearbyItems:     () => [],
        hasVisibleEnemy:    () => false,
        // getWoundedAllies omitted
      };
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('transition:PATROL');
    });

    it('null perception → no throw', () => {
      const { ctx } = makeMockCtx();
      ctx.state.helpWoundedTargetId = 'a1';
      ctx.state.helpWoundedX = 500;
      ctx.state.helpWoundedY = 100;
      (ctx as unknown as Record<string, unknown>).perception = null;
      handler.enter(ctx);
      expect(() => handler.update(ctx, 16)).not.toThrow();
    });
  });

  // ── Transition overrides ──────────────────────────────────────────────────

  describe('transition overrides', () => {
    it('helpWoundedOnEnemy override', () => {
      const custom = new HelpWoundedState(cfg, { helpWoundedOnEnemy: 'COMBAT' });
      const ally: WoundedAlly = { id: 'a1', x: 500, y: 100, hpPercent: 0.1 };
      const { ctx, calls } = makeMockCtx({
        x: 100, y: 100,
        woundedAllies: [ally],
        perceptionEnemies: [{ id: 'e1', x: 300, y: 300, factionId: 'bandits' }],
      });
      ctx.state.helpWoundedTargetId = 'a1';
      ctx.state.helpWoundedX = ally.x;
      ctx.state.helpWoundedY = ally.y;
      custom.enter(ctx);
      calls.length = 0;
      custom.update(ctx, 16);
      expect(calls).toContain('transition:COMBAT');
    });

    it('helpWoundedOnComplete override', () => {
      const custom = new HelpWoundedState(cfg, { helpWoundedOnComplete: 'IDLE' });
      const { ctx, calls } = makeMockCtx({ x: 100, y: 100 });
      ctx.state.helpWoundedTargetId = 'a1'; // ally not in list → immediate complete
      ctx.state.helpWoundedX = 500;
      ctx.state.helpWoundedY = 100;
      custom.enter(ctx);
      calls.length = 0;
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

    it('resets helpWoundedAssistStartMs to -1', () => {
      const ally: WoundedAlly = { id: 'a1', x: 100 + cfg.arriveThreshold / 2, y: 100, hpPercent: 0.1 };
      const { ctx } = makeMockCtx({ x: 100, y: 100, nowMs: 1, woundedAllies: [ally] });
      ctx.state.helpWoundedTargetId = 'a1';
      ctx.state.helpWoundedX = ally.x;
      ctx.state.helpWoundedY = ally.y;
      handler.enter(ctx);
      handler.update(ctx, 16); // arrive → assistStartMs = 1
      expect(ctx.state.helpWoundedAssistStartMs).toBeGreaterThanOrEqual(0);
      handler.exit(ctx);
      expect(ctx.state.helpWoundedAssistStartMs).toBe(-1);
    });

    it('resets helpWoundedStartMs to 0', () => {
      const { ctx } = makeMockCtx({ nowMs: 5_000 });
      handler.enter(ctx);
      expect(ctx.state.helpWoundedStartMs).toBe(5_000);
      handler.exit(ctx);
      expect(ctx.state.helpWoundedStartMs).toBe(0);
    });

    it('clears helpWoundedTargetId', () => {
      const { ctx } = makeMockCtx();
      ctx.state.helpWoundedTargetId = 'ally-42';
      handler.enter(ctx);
      handler.exit(ctx);
      expect(ctx.state.helpWoundedTargetId).toBeNull();
    });

    it('resets helpWoundedX/Y to 0', () => {
      const { ctx } = makeMockCtx();
      ctx.state.helpWoundedX = 999;
      ctx.state.helpWoundedY = 888;
      handler.enter(ctx);
      handler.exit(ctx);
      expect(ctx.state.helpWoundedX).toBe(0);
      expect(ctx.state.helpWoundedY).toBe(0);
    });
  });
});
