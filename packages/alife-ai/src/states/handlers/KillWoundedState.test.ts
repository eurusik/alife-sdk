// states/handlers/KillWoundedState.test.ts
// Tests for KillWoundedState — five-phase approach + aim + taunt + execute + pause.

import { describe, it, expect, beforeEach } from 'vitest';
import { createDefaultNPCOnlineState } from '../NPCOnlineState';
import { createDefaultStateConfig }   from '../IStateConfig';
import type { INPCContext }            from '../INPCContext';
import type { INPCOnlineState }        from '../INPCOnlineState';
import type { IStateConfig }           from '../IStateConfig';
import { KillWoundedState }            from './KillWoundedState';

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

type WoundedEnemy = { id: string; x: number; y: number; hpPercent: number };

interface MockCtxOptions {
  perceptionEnemies?: Array<{ id: string; x: number; y: number; factionId: string }>;
  woundedEnemies?: WoundedEnemy[];
  nowMs?: number;
  x?: number;
  y?: number;
  moraleState?: INPCOnlineState['moraleState'];
  lastShootMs?: number;
}

function makeMockCtx(overrides: MockCtxOptions = {}) {
  const calls: string[] = [];
  const state: INPCOnlineState = createDefaultNPCOnlineState();
  if (overrides.moraleState) state.moraleState = overrides.moraleState;
  if (overrides.lastShootMs !== undefined) state.lastShootMs = overrides.lastShootMs;
  let nowMs = overrides.nowMs ?? 0;

  let enemies  = overrides.perceptionEnemies ?? [];
  let wounded  = overrides.woundedEnemies ?? [];

  const ctx: INPCContext = {
    npcId: 'npc-1',
    factionId: 'stalker',
    entityType: 'human',
    x: overrides.x ?? 100,
    y: overrides.y ?? 100,
    state,
    currentStateId: 'KILL_WOUNDED',
    perception: {
      getVisibleEnemies:  () => enemies,
      getVisibleAllies:   () => [],
      getNearbyItems:     () => [],
      hasVisibleEnemy:    () => enemies.length > 0,
      getWoundedEnemies:  () => wounded,
    },
    health: null,
    setVelocity:        (vx, vy) => { calls.push(`vel:${vx},${vy}`); },
    halt:               ()       => { calls.push('halt'); },
    setRotation:        (r)      => { calls.push(`rot:${r.toFixed(4)}`); },
    setAlpha:           (a)      => { calls.push(`alpha:${a}`); },
    teleport:           (x, y)   => { calls.push(`teleport:${x},${y}`); },
    disablePhysics:     ()       => { calls.push('disablePhysics'); },
    transition:         (s)      => { calls.push(`transition:${s}`); },
    emitShoot:          (p)      => { calls.push(`shoot:${p.weaponType}`); },
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
    setNow:          (ms: number)           => { nowMs = ms; },
    setEnemies:      (e: typeof enemies)    => { enemies = e; },
    setWounded:      (w: WoundedEnemy[])    => { wounded = w; },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KillWoundedState', () => {
  let cfg: IStateConfig;
  let handler: KillWoundedState;

  beforeEach(() => {
    cfg     = createDefaultStateConfig();
    handler = new KillWoundedState(cfg);
  });

  // ── enter() ───────────────────────────────────────────────────────────────

  describe('enter()', () => {
    it('halts NPC', () => {
      const { ctx, calls } = makeMockCtx();
      handler.enter(ctx);
      expect(calls).toContain('halt');
    });

    it('records killWoundedStartMs', () => {
      const { ctx } = makeMockCtx({ nowMs: 5_000 });
      handler.enter(ctx);
      expect(ctx.state.killWoundedStartMs).toBe(5_000);
    });

    it('resets all sentinels to -1', () => {
      const { ctx } = makeMockCtx();
      ctx.state.killWoundedAimStartMs      = 9_000;
      ctx.state.killWoundedTauntStartMs    = 9_000;
      ctx.state.killWoundedExecuteStartMs  = 9_000;
      ctx.state.killWoundedPauseStartMs    = 9_000;
      handler.enter(ctx);
      expect(ctx.state.killWoundedAimStartMs).toBe(-1);
      expect(ctx.state.killWoundedTauntStartMs).toBe(-1);
      expect(ctx.state.killWoundedExecuteStartMs).toBe(-1);
      expect(ctx.state.killWoundedPauseStartMs).toBe(-1);
    });

    it('resets killWoundedShotsFired to 0', () => {
      const { ctx } = makeMockCtx();
      ctx.state.killWoundedShotsFired = 5;
      handler.enter(ctx);
      expect(ctx.state.killWoundedShotsFired).toBe(0);
    });
  });

  // ── update() — PANICKED priority ─────────────────────────────────────────

  describe('update() — panic priority', () => {
    it('PANICKED → halt + killWoundedOnPanic (FLEE)', () => {
      const { ctx, calls } = makeMockCtx({ moraleState: 'PANICKED' });
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('halt');
      expect(calls).toContain('transition:FLEE');
    });

    it('custom override killWoundedOnPanic: RETREAT fires correctly', () => {
      const custom = new KillWoundedState(cfg, { killWoundedOnPanic: 'RETREAT' });
      const { ctx, calls } = makeMockCtx({ moraleState: 'PANICKED' });
      custom.enter(ctx);
      calls.length = 0;
      custom.update(ctx, 16);
      expect(calls).toContain('transition:RETREAT');
    });

    it('PANICKED during AIM phase → killWoundedOnPanic', () => {
      const e: WoundedEnemy = { id: 'e1', x: 100 + cfg.killWoundedExecuteRange / 2, y: 100, hpPercent: 0.1 };
      const { ctx, calls } = makeMockCtx({ x: 100, y: 100, nowMs: 1, woundedEnemies: [e] });
      ctx.state.killWoundedTargetId = 'e1'; ctx.state.killWoundedTargetX = e.x; ctx.state.killWoundedTargetY = e.y;
      handler.enter(ctx);
      handler.update(ctx, 16); // arrive → aimStartMs set
      ctx.state.moraleState = 'PANICKED';
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('transition:FLEE');
    });

    it('PANICKED during EXECUTE phase → killWoundedOnPanic', () => {
      const { ctx, calls } = makeMockCtx({ moraleState: 'PANICKED' });
      ctx.state.killWoundedExecuteStartMs = 1;
      handler.enter(ctx);
      ctx.state.killWoundedExecuteStartMs = 1; // re-set after enter
      ctx.state.moraleState = 'PANICKED';
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('transition:FLEE');
    });

    it('PANICKED during PAUSE phase → killWoundedOnPanic', () => {
      const { ctx, calls } = makeMockCtx({ moraleState: 'PANICKED' });
      ctx.state.killWoundedPauseStartMs = 1;
      handler.enter(ctx);
      ctx.state.killWoundedPauseStartMs = 1;
      ctx.state.moraleState = 'PANICKED';
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('transition:FLEE');
    });
  });

  // ── update() — APPROACH phase ─────────────────────────────────────────────

  describe('update() — approach phase', () => {
    it('moves toward killWoundedTargetX/Y', () => {
      const e: WoundedEnemy = { id: 'e1', x: 500, y: 100, hpPercent: 0.1 };
      const { ctx, calls } = makeMockCtx({ x: 100, y: 100, woundedEnemies: [e] });
      ctx.state.killWoundedTargetId = 'e1'; ctx.state.killWoundedTargetX = e.x; ctx.state.killWoundedTargetY = e.y;
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(true);
    });

    it('updates killWoundedTargetX/Y from live perception each frame', () => {
      const e: WoundedEnemy = { id: 'e1', x: 500, y: 100, hpPercent: 0.1 };
      const { ctx, state, setWounded } = makeMockCtx({ x: 100, y: 100, woundedEnemies: [e] });
      ctx.state.killWoundedTargetId = 'e1'; ctx.state.killWoundedTargetX = e.x; ctx.state.killWoundedTargetY = e.y;
      handler.enter(ctx);
      setWounded([{ id: 'e1', x: 520, y: 110, hpPercent: 0.1 }]);
      handler.update(ctx, 16);
      expect(state.killWoundedTargetX).toBe(520);
      expect(state.killWoundedTargetY).toBe(110);
    });

    it('overall timeout → killWoundedOnTimeout (COMBAT)', () => {
      const e: WoundedEnemy = { id: 'e1', x: 10_000, y: 100, hpPercent: 0.1 };
      const { ctx, calls, setNow } = makeMockCtx({ x: 100, y: 100, nowMs: 0, woundedEnemies: [e] });
      ctx.state.killWoundedTargetId = 'e1'; ctx.state.killWoundedTargetX = e.x; ctx.state.killWoundedTargetY = e.y;
      handler.enter(ctx);
      setNow(cfg.killWoundedMaxApproachMs + 1);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('halt');
      expect(calls).toContain('transition:COMBAT');
    });

    it('target gone + visible enemy → killWoundedOnComplete (COMBAT)', () => {
      const enemy = { id: 'e1', x: 200, y: 100, factionId: 'bandits' };
      const { ctx, calls } = makeMockCtx({ x: 100, y: 100, perceptionEnemies: [enemy] });
      ctx.state.killWoundedTargetId = 'e1';
      ctx.state.killWoundedTargetX = 200;
      ctx.state.killWoundedTargetY = 100;
      // no woundedEnemies set → target healed
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('halt');
      expect(calls).toContain('transition:COMBAT');
    });

    it('target gone + no visible enemy → killWoundedOnNoTarget (SEARCH)', () => {
      const { ctx, calls } = makeMockCtx({ x: 100, y: 100 });
      ctx.state.killWoundedTargetId = 'e1';
      ctx.state.killWoundedTargetX = 200;
      ctx.state.killWoundedTargetY = 100;
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('halt');
      expect(calls).toContain('transition:SEARCH');
    });

    it('arrival within killWoundedExecuteRange → sets killWoundedAimStartMs', () => {
      const e: WoundedEnemy = { id: 'e1', x: 100 + cfg.killWoundedExecuteRange / 2, y: 100, hpPercent: 0.1 };
      const { ctx } = makeMockCtx({ x: 100, y: 100, nowMs: 2_000, woundedEnemies: [e] });
      ctx.state.killWoundedTargetId = 'e1'; ctx.state.killWoundedTargetX = e.x; ctx.state.killWoundedTargetY = e.y;
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(ctx.state.killWoundedAimStartMs).toBe(2_000);
    });

    it('arrival halts NPC', () => {
      const e: WoundedEnemy = { id: 'e1', x: 100 + cfg.killWoundedExecuteRange / 2, y: 100, hpPercent: 0.1 };
      const { ctx, calls } = makeMockCtx({ x: 100, y: 100, woundedEnemies: [e] });
      ctx.state.killWoundedTargetId = 'e1'; ctx.state.killWoundedTargetX = e.x; ctx.state.killWoundedTargetY = e.y;
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('halt');
    });
  });

  // ── update() — AIM phase ──────────────────────────────────────────────────

  describe('update() — aim phase', () => {
    function arriveToAim(ctx: INPCContext, e: WoundedEnemy) {
      ctx.state.killWoundedTargetId = e.id;
      ctx.state.killWoundedTargetX  = e.x;
      ctx.state.killWoundedTargetY  = e.y;
      handler.enter(ctx);
      handler.update(ctx, 16); // arrives → aimStartMs set
    }

    it('halts NPC each AIM frame', () => {
      const e: WoundedEnemy = { id: 'e1', x: 100 + cfg.killWoundedExecuteRange / 2, y: 100, hpPercent: 0.1 };
      const { ctx, calls, setNow } = makeMockCtx({ x: 100, y: 100, nowMs: 1, woundedEnemies: [e] });
      arriveToAim(ctx, e);
      calls.length = 0;
      setNow(500);
      handler.update(ctx, 16);
      expect(calls).toContain('halt');
    });

    it('sets rotation toward target in AIM phase', () => {
      const e: WoundedEnemy = { id: 'e1', x: 100 + cfg.killWoundedExecuteRange / 2, y: 100, hpPercent: 0.1 };
      const { ctx, calls, setNow } = makeMockCtx({ x: 100, y: 100, nowMs: 1, woundedEnemies: [e] });
      arriveToAim(ctx, e);
      calls.length = 0;
      setNow(500);
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('rot:'))).toBe(true);
    });

    it('before killWoundedAimMs → no taunt vocalization', () => {
      const e: WoundedEnemy = { id: 'e1', x: 100 + cfg.killWoundedExecuteRange / 2, y: 100, hpPercent: 0.1 };
      const { ctx, calls, setNow } = makeMockCtx({ x: 100, y: 100, nowMs: 1, woundedEnemies: [e] });
      arriveToAim(ctx, e);
      calls.length = 0;
      setNow(1 + cfg.killWoundedAimMs / 2);
      handler.update(ctx, 16);
      expect(calls.filter(c => c === 'vocal:KILL_WOUNDED_TAUNT')).toHaveLength(0);
    });

    it('after killWoundedAimMs → emits KILL_WOUNDED_TAUNT vocalization', () => {
      const e: WoundedEnemy = { id: 'e1', x: 100 + cfg.killWoundedExecuteRange / 2, y: 100, hpPercent: 0.1 };
      const { ctx, calls, setNow } = makeMockCtx({ x: 100, y: 100, nowMs: 1, woundedEnemies: [e] });
      arriveToAim(ctx, e);
      calls.length = 0;
      setNow(1 + cfg.killWoundedAimMs + 1);
      handler.update(ctx, 16);
      expect(calls).toContain('vocal:KILL_WOUNDED_TAUNT');
    });

    it('after killWoundedAimMs → sets killWoundedTauntStartMs', () => {
      const e: WoundedEnemy = { id: 'e1', x: 100 + cfg.killWoundedExecuteRange / 2, y: 100, hpPercent: 0.1 };
      const { ctx, setNow } = makeMockCtx({ x: 100, y: 100, nowMs: 1, woundedEnemies: [e] });
      arriveToAim(ctx, e);
      const tauntNow = 1 + cfg.killWoundedAimMs + 1;
      setNow(tauntNow);
      handler.update(ctx, 16);
      expect(ctx.state.killWoundedTauntStartMs).toBe(tauntNow);
    });
  });

  // ── update() — TAUNT phase ────────────────────────────────────────────────

  describe('update() — taunt phase', () => {
    function enterTauntPhase(
      ctx: INPCContext,
      nowRef: { value: number },
      setNow: (ms: number) => void,
    ) {
      const e: WoundedEnemy = { id: 'e1', x: 100 + cfg.killWoundedExecuteRange / 2, y: 100, hpPercent: 0.1 };
      ctx.state.killWoundedTargetId = 'e1'; ctx.state.killWoundedTargetX = e.x; ctx.state.killWoundedTargetY = e.y;
      handler.enter(ctx);
      handler.update(ctx, 16); // arrive → AIM phase
      nowRef.value = 1 + cfg.killWoundedAimMs + 1;
      setNow(nowRef.value);
      handler.update(ctx, 16); // aim done → TAUNT phase
    }

    it('halts NPC in TAUNT phase', () => {
      const nowRef = { value: 1 };
      const { ctx, calls, setNow } = makeMockCtx({
        x: 100, y: 100, nowMs: 1,
        woundedEnemies: [{ id: 'e1', x: 100 + cfg.killWoundedExecuteRange / 2, y: 100, hpPercent: 0.1 }],
      });
      enterTauntPhase(ctx, nowRef, setNow);
      calls.length = 0;
      setNow(nowRef.value + cfg.killWoundedTauntMs / 2);
      handler.update(ctx, 16);
      expect(calls).toContain('halt');
    });

    it('before killWoundedTauntMs → no shot fired', () => {
      const nowRef = { value: 1 };
      const { ctx, calls, setNow } = makeMockCtx({
        x: 100, y: 100, nowMs: 1,
        woundedEnemies: [{ id: 'e1', x: 100 + cfg.killWoundedExecuteRange / 2, y: 100, hpPercent: 0.1 }],
      });
      enterTauntPhase(ctx, nowRef, setNow);
      calls.length = 0;
      setNow(nowRef.value + cfg.killWoundedTauntMs / 2);
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('shoot:'))).toHaveLength(0);
    });

    it('after killWoundedTauntMs → sets killWoundedExecuteStartMs', () => {
      const nowRef = { value: 1 };
      const { ctx, setNow } = makeMockCtx({
        x: 100, y: 100, nowMs: 1,
        woundedEnemies: [{ id: 'e1', x: 100 + cfg.killWoundedExecuteRange / 2, y: 100, hpPercent: 0.1 }],
      });
      enterTauntPhase(ctx, nowRef, setNow);
      const execNow = nowRef.value + cfg.killWoundedTauntMs + 1;
      setNow(execNow);
      handler.update(ctx, 16);
      expect(ctx.state.killWoundedExecuteStartMs).toBe(execNow);
    });
  });

  // ── update() — EXECUTE phase ──────────────────────────────────────────────

  describe('update() — execute phase', () => {
    it('halts NPC in EXECUTE phase', () => {
      const { ctx, calls } = makeMockCtx({ nowMs: 1 });
      handler.enter(ctx);
      ctx.state.killWoundedExecuteStartMs = 1;
      ctx.state.killWoundedTargetX = 200;
      ctx.state.killWoundedTargetY = 100;
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('halt');
    });

    it('fires shot when fireRateMs elapsed', () => {
      const { ctx, calls, setNow } = makeMockCtx({ nowMs: 1, lastShootMs: 0 });
      ctx.state.killWoundedTargetX = 200;
      ctx.state.killWoundedTargetY = 100;
      handler.enter(ctx);
      ctx.state.killWoundedExecuteStartMs = 1;
      setNow(1 + cfg.fireRateMs + 1);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('shoot:'))).toBe(true);
    });

    it('increments killWoundedShotsFired on each shot', () => {
      const { ctx, setNow } = makeMockCtx({ nowMs: 1, lastShootMs: 0 });
      ctx.state.killWoundedTargetX = 200;
      ctx.state.killWoundedTargetY = 100;
      handler.enter(ctx);
      ctx.state.killWoundedExecuteStartMs = 1;
      setNow(1 + cfg.fireRateMs + 1);
      handler.update(ctx, 16);
      expect(ctx.state.killWoundedShotsFired).toBe(1);
    });

    it('uses primaryWeapon ?? pistol as weaponType', () => {
      const { ctx, calls, setNow } = makeMockCtx({ nowMs: 1, lastShootMs: 0 });
      ctx.state.primaryWeapon = null;
      ctx.state.killWoundedTargetX = 200;
      ctx.state.killWoundedTargetY = 100;
      handler.enter(ctx);
      ctx.state.killWoundedExecuteStartMs = 1;
      setNow(1 + cfg.fireRateMs + 1);
      handler.update(ctx, 16);
      expect(calls.some(c => c === 'shoot:pistol')).toBe(true);
    });

    it('uses primaryWeapon when set', () => {
      const { ctx, calls, setNow } = makeMockCtx({ nowMs: 1, lastShootMs: 0 });
      ctx.state.primaryWeapon = 'rifle';
      ctx.state.killWoundedTargetX = 200;
      ctx.state.killWoundedTargetY = 100;
      handler.enter(ctx);
      ctx.state.killWoundedExecuteStartMs = 1;
      setNow(1 + cfg.fireRateMs + 1);
      handler.update(ctx, 16);
      expect(calls.some(c => c === 'shoot:rifle')).toBe(true);
    });

    it('does NOT fire when fireRateMs cooldown not elapsed', () => {
      const { ctx, calls } = makeMockCtx({ nowMs: 1 });
      ctx.state.lastShootMs = 1; // just shot
      ctx.state.killWoundedTargetX = 200;
      ctx.state.killWoundedTargetY = 100;
      handler.enter(ctx);
      ctx.state.killWoundedExecuteStartMs = 1;
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('shoot:'))).toHaveLength(0);
    });

    it('after all burst shots → sets killWoundedPauseStartMs', () => {
      const { ctx, setNow } = makeMockCtx({ nowMs: 1 });
      ctx.state.killWoundedShotsFired = cfg.killWoundedBurstCount; // already fired all
      ctx.state.killWoundedTargetX = 200;
      ctx.state.killWoundedTargetY = 100;
      handler.enter(ctx);
      ctx.state.killWoundedExecuteStartMs = 1;
      ctx.state.killWoundedShotsFired = cfg.killWoundedBurstCount;
      const pauseNow = 5_000;
      setNow(pauseNow);
      handler.update(ctx, 16);
      expect(ctx.state.killWoundedPauseStartMs).toBe(pauseNow);
    });
  });

  // ── update() — PAUSE phase ────────────────────────────────────────────────

  describe('update() — pause phase', () => {
    it('halts NPC in PAUSE phase', () => {
      const { ctx, calls } = makeMockCtx({ nowMs: 1 });
      handler.enter(ctx);
      ctx.state.killWoundedPauseStartMs = 1;
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('halt');
    });

    it('before killWoundedPauseMs → no transition', () => {
      const { ctx, calls, setNow } = makeMockCtx({ nowMs: 1 });
      handler.enter(ctx);
      ctx.state.killWoundedPauseStartMs = 1;
      calls.length = 0;
      setNow(1 + cfg.killWoundedPauseMs / 2);
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('after pause + visible enemy → killWoundedOnComplete (COMBAT)', () => {
      const enemy = { id: 'e2', x: 300, y: 100, factionId: 'bandits' };
      const { ctx, calls, setNow } = makeMockCtx({ nowMs: 1, perceptionEnemies: [enemy] });
      handler.enter(ctx);
      ctx.state.killWoundedPauseStartMs = 1;
      calls.length = 0;
      setNow(1 + cfg.killWoundedPauseMs + 1);
      handler.update(ctx, 16);
      expect(calls).toContain('transition:COMBAT');
    });

    it('after pause + no enemy + lastKnown set → killWoundedOnNoTarget (SEARCH)', () => {
      const { ctx, calls, setNow } = makeMockCtx({ nowMs: 1 });
      ctx.state.lastKnownEnemyX = 300;
      ctx.state.lastKnownEnemyY = 100;
      handler.enter(ctx);
      ctx.state.killWoundedPauseStartMs = 1;
      calls.length = 0;
      setNow(1 + cfg.killWoundedPauseMs + 1);
      handler.update(ctx, 16);
      expect(calls).toContain('transition:SEARCH');
    });

    it('after pause + no enemy + lastKnown 0,0 → killWoundedOnComplete (COMBAT fallback)', () => {
      const { ctx, calls, setNow } = makeMockCtx({ nowMs: 1 });
      // lastKnownEnemyX/Y default 0,0
      handler.enter(ctx);
      ctx.state.killWoundedPauseStartMs = 1;
      calls.length = 0;
      setNow(1 + cfg.killWoundedPauseMs + 1);
      handler.update(ctx, 16);
      expect(calls).toContain('transition:COMBAT');
    });
  });

  // ── opt-in: getWoundedEnemies not implemented ─────────────────────────────

  describe('opt-in: no getWoundedEnemies', () => {
    it('perception without getWoundedEnemies → target lost → killWoundedOnNoTarget', () => {
      const { ctx, calls } = makeMockCtx();
      ctx.state.killWoundedTargetId = 'e1';
      ctx.state.killWoundedTargetX = 500;
      ctx.state.killWoundedTargetY = 100;
      (ctx as unknown as Record<string, unknown>).perception = {
        getVisibleEnemies:  () => [],
        getVisibleAllies:   () => [],
        getNearbyItems:     () => [],
        hasVisibleEnemy:    () => false,
        // getWoundedEnemies omitted
      };
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('transition:SEARCH');
    });

    it('null perception → no throw', () => {
      const { ctx } = makeMockCtx();
      ctx.state.killWoundedTargetId = 'e1';
      (ctx as unknown as Record<string, unknown>).perception = null;
      handler.enter(ctx);
      expect(() => handler.update(ctx, 16)).not.toThrow();
    });
  });

  // ── Transition overrides ──────────────────────────────────────────────────

  describe('transition overrides', () => {
    it('killWoundedOnTimeout override fires custom state', () => {
      const custom = new KillWoundedState(cfg, { killWoundedOnTimeout: 'FLEE' });
      const e: WoundedEnemy = { id: 'e1', x: 10_000, y: 100, hpPercent: 0.1 };
      const { ctx, calls, setNow } = makeMockCtx({ x: 100, y: 100, nowMs: 0, woundedEnemies: [e] });
      ctx.state.killWoundedTargetId = 'e1'; ctx.state.killWoundedTargetX = e.x; ctx.state.killWoundedTargetY = e.y;
      custom.enter(ctx);
      setNow(cfg.killWoundedMaxApproachMs + 1);
      calls.length = 0;
      custom.update(ctx, 16);
      expect(calls).toContain('transition:FLEE');
    });

    it('killWoundedOnNoTarget override fires custom state', () => {
      const custom = new KillWoundedState(cfg, { killWoundedOnNoTarget: 'IDLE' });
      const { ctx, calls } = makeMockCtx();
      ctx.state.killWoundedTargetId = 'e1';
      ctx.state.killWoundedTargetX = 500;
      ctx.state.killWoundedTargetY = 100;
      custom.enter(ctx);
      calls.length = 0;
      custom.update(ctx, 16);
      expect(calls).toContain('transition:IDLE');
    });

    it('killWoundedOnComplete override fires on pause done + visible enemy', () => {
      const custom = new KillWoundedState(cfg, { killWoundedOnComplete: 'PATROL' });
      const enemy = { id: 'e2', x: 300, y: 100, factionId: 'bandits' };
      const { ctx, calls, setNow } = makeMockCtx({ nowMs: 1, perceptionEnemies: [enemy] });
      custom.enter(ctx);
      ctx.state.killWoundedPauseStartMs = 1;
      setNow(1 + cfg.killWoundedPauseMs + 1);
      calls.length = 0;
      custom.update(ctx, 16);
      expect(calls).toContain('transition:PATROL');
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

    it('clears killWoundedTargetId to null', () => {
      const { ctx } = makeMockCtx();
      ctx.state.killWoundedTargetId = 'e-42';
      handler.enter(ctx);
      handler.exit(ctx);
      expect(ctx.state.killWoundedTargetId).toBeNull();
    });

    it('resets killWoundedStartMs to 0', () => {
      const { ctx } = makeMockCtx({ nowMs: 9_000 });
      handler.enter(ctx);
      expect(ctx.state.killWoundedStartMs).toBe(9_000);
      handler.exit(ctx);
      expect(ctx.state.killWoundedStartMs).toBe(0);
    });

    it('resets all sentinels to -1', () => {
      const { ctx } = makeMockCtx();
      handler.enter(ctx);
      ctx.state.killWoundedAimStartMs     = 100;
      ctx.state.killWoundedTauntStartMs   = 200;
      ctx.state.killWoundedExecuteStartMs = 300;
      ctx.state.killWoundedPauseStartMs   = 400;
      handler.exit(ctx);
      expect(ctx.state.killWoundedAimStartMs).toBe(-1);
      expect(ctx.state.killWoundedTauntStartMs).toBe(-1);
      expect(ctx.state.killWoundedExecuteStartMs).toBe(-1);
      expect(ctx.state.killWoundedPauseStartMs).toBe(-1);
    });

    it('resets killWoundedShotsFired to 0', () => {
      const { ctx } = makeMockCtx();
      handler.enter(ctx);
      ctx.state.killWoundedShotsFired = 3;
      handler.exit(ctx);
      expect(ctx.state.killWoundedShotsFired).toBe(0);
    });

    it('resets killWoundedTargetX/Y to 0', () => {
      const { ctx } = makeMockCtx();
      ctx.state.killWoundedTargetX = 777;
      ctx.state.killWoundedTargetY = 888;
      handler.enter(ctx);
      handler.exit(ctx);
      expect(ctx.state.killWoundedTargetX).toBe(0);
      expect(ctx.state.killWoundedTargetY).toBe(0);
    });
  });
});
