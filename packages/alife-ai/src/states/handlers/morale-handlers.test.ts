// states/handlers/morale-handlers.test.ts
// Comprehensive tests for three morale-driven state handlers:
//   - EvadeGrenadeState  — flee from grenade/explosion threats
//   - WoundedState       — crawl, heal with medkits, panic transitions
//   - RetreatState       — tactical retreat to FAR cover + suppressive fire

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EvadeGrenadeState } from './EvadeGrenadeState';
import { WoundedState } from './WoundedState';
import { RetreatState } from './RetreatState';
import { createDefaultStateConfig } from '../IStateConfig';
import { createDefaultNPCOnlineState } from '../NPCOnlineState';
import type { INPCContext, IDangerAccess, INPCPerception, INPCHealth, ICoverAccess } from '../INPCContext';
import type { INPCOnlineState } from '../INPCOnlineState';
import type { IStateConfig } from '../IStateConfig';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface ICtxOpts {
  x?: number;
  y?: number;
  now?: number;
  danger?: IDangerAccess | null;
  perception?: INPCPerception | null;
  health?: INPCHealth | null;
  cover?: ICoverAccess | null;
  state?: Partial<INPCOnlineState>;
}

function makeCtx(opts: ICtxOpts = {}): INPCContext & {
  velocityX: number;
  velocityY: number;
  halted: boolean;
  transitions: string[];
  shoots: Array<{ targetX: number; targetY: number; weaponType: string }>;
} {
  const state: INPCOnlineState = {
    ...createDefaultNPCOnlineState(),
    ...(opts.state ?? {}),
  };

  const ctx = {
    npcId: 'test-npc',
    factionId: 'military',
    entityType: 'npc',
    x: opts.x ?? 100,
    y: opts.y ?? 100,
    state,

    // tracking fields
    velocityX: 0,
    velocityY: 0,
    halted: false,
    transitions: [] as string[],
    shoots: [] as Array<{ targetX: number; targetY: number; weaponType: string }>,

    currentStateId: 'EVADE_GRENADE',
    perception: opts.perception !== undefined ? opts.perception : null,
    health: opts.health !== undefined ? opts.health : null,
    cover: opts.cover !== undefined ? opts.cover : null,
    danger: opts.danger !== undefined ? opts.danger : null,
    restrictedZones: null,
    squad: null,

    _nowMs: opts.now ?? 1000,
    now() { return ctx._nowMs; },
    random() { return 0.5; },

    setVelocity(vx: number, vy: number) {
      ctx.velocityX = vx;
      ctx.velocityY = vy;
      ctx.halted = false;
    },
    halt() {
      ctx.velocityX = 0;
      ctx.velocityY = 0;
      ctx.halted = true;
    },
    setRotation(_r: number) {},
    setAlpha(_a: number) {},
    teleport(_x: number, _y: number) {},
    disablePhysics() {},

    transition(newStateId: string) {
      ctx.transitions.push(newStateId);
    },
    emitShoot(payload: { targetX: number; targetY: number; weaponType: string; npcId: string; x: number; y: number }) {
      ctx.shoots.push({ targetX: payload.targetX, targetY: payload.targetY, weaponType: payload.weaponType });
    },
    emitMeleeHit(_payload: unknown) {},
    emitVocalization(_type: string) {},
    emitPsiAttackStart(_x: number, _y: number) {},
  };

  return ctx as typeof ctx;
}

function makeDanger(opts: {
  active?: boolean;
  originX?: number;
  originY?: number;
} = {}): IDangerAccess {
  return {
    getDangerLevel: (_x: number, _y: number) => 0,
    getGrenadeDanger: (_x: number, _y: number) => ({
      active: opts.active ?? true,
      originX: opts.originX ?? 0,
      originY: opts.originY ?? 0,
    }),
  };
}

function makePerception(hasEnemy: boolean, enemies: Array<{ id: string; x: number; y: number; factionId: string }> = []): INPCPerception {
  const defaultEnemies = hasEnemy
    ? (enemies.length > 0 ? enemies : [{ id: 'enemy-1', x: 200, y: 200, factionId: 'bandits' }])
    : [];
  return {
    getVisibleEnemies: () => defaultEnemies,
    getVisibleAllies: () => [],
    getNearbyItems: () => [],
    hasVisibleEnemy: () => hasEnemy,
  };
}

function makeHealth(hp: number, maxHp = 100): INPCHealth {
  let currentHp = hp;
  return {
    get hp() { return currentHp; },
    get maxHp() { return maxHp; },
    get hpPercent() { return currentHp / maxHp; },
    heal(amount: number) { currentHp = Math.min(maxHp, currentHp + amount); },
  };
}

function makeCover(point: { x: number; y: number } | null = { x: 500, y: 500 }): ICoverAccess {
  return {
    findCover: (_x, _y, _ex, _ey, _type) => point,
  };
}

// ---------------------------------------------------------------------------
// EvadeGrenadeState
// ---------------------------------------------------------------------------

describe('EvadeGrenadeState', () => {
  let cfg: IStateConfig;
  let handler: EvadeGrenadeState;

  beforeEach(() => {
    cfg = createDefaultStateConfig();
    handler = new EvadeGrenadeState(cfg);
  });

  describe('enter()', () => {
    it('records evadeStartMs from ctx.now()', () => {
      const ctx = makeCtx({ now: 5000 });
      handler.enter(ctx);
      expect(ctx.state.evadeStartMs).toBe(5000);
    });

    it('records evadeStartMs of 0 when ctx.now() is 0', () => {
      const ctx = makeCtx({ now: 0 });
      handler.enter(ctx);
      expect(ctx.state.evadeStartMs).toBe(0);
    });

    it('does not trigger any transition on enter', () => {
      const ctx = makeCtx({ now: 1000 });
      handler.enter(ctx);
      expect(ctx.transitions).toHaveLength(0);
    });

    it('does not halt on enter (no immediate stop)', () => {
      const ctx = makeCtx({ now: 1000 });
      handler.enter(ctx);
      // halted should not be set (no halt() called in enter)
      expect(ctx.halted).toBe(false);
    });
  });

  describe('update() — grenade danger active', () => {
    it('moves away from danger origin when grenade is active', () => {
      const ctx = makeCtx({
        x: 200, y: 200,
        now: 1000,
        danger: makeDanger({ active: true, originX: 200, originY: 100 }),
      });
      ctx.state.evadeStartMs = 1000;

      handler.update(ctx, 16);

      // Should be moving (velocity non-zero) and not transitioning yet
      expect(ctx.transitions).toHaveLength(0);
      // Moving away from (200,100) while at (200,200): dy = 200-100 = 100, so should move in positive Y
      expect(ctx.velocityY).toBeGreaterThan(0);
    });

    it('applies evadeSpeedMultiplier to approachSpeed', () => {
      const customCfg = createDefaultStateConfig({ approachSpeed: 100, evadeSpeedMultiplier: 2.0 });
      const customHandler = new EvadeGrenadeState(customCfg);

      const ctx = makeCtx({
        x: 200, y: 100,
        now: 1000,
        danger: makeDanger({ active: true, originX: 100, originY: 100 }),
      });
      ctx.state.evadeStartMs = 1000;

      customHandler.update(ctx, 16);

      // Moving purely in X direction: speed = 100 * 2.0 = 200
      expect(ctx.velocityX).toBeCloseTo(200, 1);
      expect(ctx.velocityY).toBeCloseTo(0, 1);
    });

    it('does not transition while grenade is still active', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        now: 2000,
        danger: makeDanger({ active: true, originX: 0, originY: 0 }),
      });
      ctx.state.evadeStartMs = 2000;

      handler.update(ctx, 16);

      expect(ctx.transitions).toHaveLength(0);
    });

    it('handles NPC exactly at danger origin (degenerate case)', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        now: 1000,
        danger: makeDanger({ active: true, originX: 100, originY: 100 }),
      });
      ctx.state.evadeStartMs = 1000;

      // Should not throw — fallback to positive X direction
      expect(() => handler.update(ctx, 16)).not.toThrow();
    });
  });

  describe('update() — grenade danger cleared early', () => {
    // The NPC always runs the full evadeGrenadeDurationMs even when danger clears early.
    // Transitions only fire once elapsed >= evadeGrenadeDurationMs (2000ms by default).
    it('transitions to COMBAT when enemy visible after danger clears and timer expires', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        now: 3000,
        danger: makeDanger({ active: false }),
        perception: makePerception(true),
      });
      ctx.state.evadeStartMs = 1000; // 2000ms elapsed — at the threshold

      handler.update(ctx, 16);

      expect(ctx.transitions).toContain('COMBAT');
    });

    it('transitions to COMBAT (evadeOnTimeout default) when no enemy visible after danger clears and timer expires', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        now: 3000,
        danger: makeDanger({ active: false }),
        perception: makePerception(false),
      });
      ctx.state.evadeStartMs = 1000; // 2000ms elapsed — at the threshold

      handler.update(ctx, 16);

      // evadeOnTimeout defaults to 'COMBAT' — override with { evadeOnTimeout: 'SEARCH' } to get SEARCH
      expect(ctx.transitions).toContain('COMBAT');
    });

    it('halts before transitioning when danger clears and timer expires', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        now: 3000,
        danger: makeDanger({ active: false }),
        perception: makePerception(false),
      });
      ctx.state.evadeStartMs = 1000; // 2000ms elapsed — at the threshold
      ctx.velocityX = 200;
      ctx.velocityY = 200;

      handler.update(ctx, 16);

      expect(ctx.transitions.length).toBeGreaterThan(0);
    });
  });

  describe('update() — timer expiry', () => {
    it('transitions to COMBAT after 2000ms when enemy visible and no danger system', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        now: 3000,
        danger: null,
        perception: makePerception(true),
      });
      ctx.state.evadeStartMs = 1000; // 2000ms elapsed

      handler.update(ctx, 16);

      expect(ctx.transitions).toContain('COMBAT');
    });

    it('transitions to COMBAT after 2000ms when no danger system (regardless of perception)', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        now: 3001,
        danger: null,
        perception: null,
      });
      ctx.state.evadeStartMs = 1000;

      handler.update(ctx, 16);

      expect(ctx.transitions).toContain('COMBAT');
    });

    it('does NOT transition before 2000ms when no danger system', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        now: 2999,
        danger: null,
      });
      ctx.state.evadeStartMs = 1000; // only 1999ms elapsed

      handler.update(ctx, 16);

      expect(ctx.transitions).toHaveLength(0);
    });

    it('transitions to COMBAT after timer when danger system says no danger and enemy visible', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        now: 3100,
        danger: makeDanger({ active: false }),
        perception: makePerception(true),
      });
      ctx.state.evadeStartMs = 1000;

      handler.update(ctx, 16);

      expect(ctx.transitions).toContain('COMBAT');
    });

    it('transitions to COMBAT (evadeOnTimeout default) after timer when danger cleared and no enemy visible', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        now: 3100,
        danger: makeDanger({ active: false }),
        perception: makePerception(false),
      });
      ctx.state.evadeStartMs = 1000;

      handler.update(ctx, 16);

      // evadeOnTimeout defaults to 'COMBAT' — use { evadeOnTimeout: 'SEARCH' } to get SEARCH
      expect(ctx.transitions).toContain('COMBAT');
    });
  });

  describe('exit()', () => {
    it('halts the NPC on exit', () => {
      const ctx = makeCtx({ x: 100, y: 100 });
      ctx.velocityX = 300;
      ctx.velocityY = 150;

      handler.exit(ctx);

      expect(ctx.halted).toBe(true);
    });

    it('does not trigger any transition on exit', () => {
      const ctx = makeCtx();
      handler.exit(ctx);
      expect(ctx.transitions).toHaveLength(0);
    });
  });

  describe('multiple handlers share single instance across NPCs', () => {
    it('each NPC has independent evadeStartMs', () => {
      const ctxA = makeCtx({ now: 1000 });
      const ctxB = makeCtx({ now: 2000 });

      handler.enter(ctxA);
      handler.enter(ctxB);

      expect(ctxA.state.evadeStartMs).toBe(1000);
      expect(ctxB.state.evadeStartMs).toBe(2000);
    });
  });

  describe('injectable IStateTransitionMap overrides', () => {
    it('uses custom evadeOnNoSystem when no danger system and timer expires', () => {
      const customHandler = new EvadeGrenadeState(cfg, { evadeOnNoSystem: 'engage' });
      const ctx = makeCtx({
        x: 100, y: 100,
        now: 3001,
        danger: null,
      });
      ctx.state.evadeStartMs = 1000;

      customHandler.update(ctx, 16);

      expect(ctx.transitions).toContain('engage');
    });

    it('uses custom evadeOnClear when enemy visible after danger clears', () => {
      const customHandler = new EvadeGrenadeState(cfg, { evadeOnClear: 'fight_back' });
      const ctx = makeCtx({
        x: 100, y: 100,
        now: 3000,
        danger: makeDanger({ active: false }),
        perception: makePerception(true),
      });
      ctx.state.evadeStartMs = 1000; // 2000ms elapsed — at the threshold

      customHandler.update(ctx, 16);

      expect(ctx.transitions).toContain('fight_back');
    });
  });
});

// ---------------------------------------------------------------------------
// WoundedState
// ---------------------------------------------------------------------------

describe('WoundedState', () => {
  let cfg: IStateConfig;
  let handler: WoundedState;

  beforeEach(() => {
    cfg = createDefaultStateConfig();
    handler = new WoundedState(cfg);
  });

  describe('enter()', () => {
    it('records woundedStartMs from ctx.now()', () => {
      const ctx = makeCtx({ now: 3000 });
      handler.enter(ctx);
      expect(ctx.state.woundedStartMs).toBe(3000);
    });

    it('does not transition on enter', () => {
      const ctx = makeCtx({ now: 1000 });
      handler.enter(ctx);
      expect(ctx.transitions).toHaveLength(0);
    });

    it('records woundedStartMs at time 0', () => {
      const ctx = makeCtx({ now: 0 });
      handler.enter(ctx);
      expect(ctx.state.woundedStartMs).toBe(0);
    });
  });

  describe('update() — medkit healing', () => {
    it('heals NPC when medkitCount > 0 and HP critically low', () => {
      const health = makeHealth(15, 100); // 15% — below woundedHpThreshold(0.2)
      const ctx = makeCtx({
        now: 4000,
        health,
        state: { woundedStartMs: 1000, medkitCount: 2, lastMedkitMs: 0 },
      });

      handler.update(ctx, 16);

      // healAmount = 100 * 0.5 = 50; HP becomes 65
      expect(health.hp).toBeGreaterThan(15);
    });

    it('consumes one medkit when healing', () => {
      const health = makeHealth(15, 100);
      const ctx = makeCtx({
        now: 4000,
        health,
        state: { woundedStartMs: 1000, medkitCount: 3, lastMedkitMs: 0 },
      });

      handler.update(ctx, 16);

      expect(ctx.state.medkitCount).toBe(2);
    });

    it('transitions to COMBAT when HP recovers above woundedHpThreshold after medkit', () => {
      // HP at 15%, maxHp=100, healRatio=0.5 → heals 50 HP → 65% > 20% threshold
      const health = makeHealth(15, 100);
      const ctx = makeCtx({
        now: 4000,
        health,
        state: { woundedStartMs: 1000, medkitCount: 1, moraleState: 'STABLE', lastMedkitMs: 0 },
      });

      handler.update(ctx, 16);

      expect(ctx.transitions).toContain('COMBAT');
    });

    it('does NOT transition to COMBAT when medkit used but HP still below threshold', () => {
      // HP at 1%, maxHp=1000, healRatio=0.5 → heals 500 HP → 501/1000 = 50.1% > 20% threshold
      // Edge case: very low HP with a custom config
      const smallHealCfg = createDefaultStateConfig({ medkitHealRatio: 0.05, woundedHpThreshold: 0.5 });
      const smallHealHandler = new WoundedState(smallHealCfg);

      // HP=10%, heals 5%: 15% still below 50% threshold
      const health = makeHealth(10, 100);
      const ctx = makeCtx({
        now: 4000,
        health,
        state: { woundedStartMs: 1000, medkitCount: 1, moraleState: 'STABLE', lastMedkitMs: 0 },
      });

      smallHealHandler.update(ctx, 16);

      // HP = 10 + 5 = 15, still below 50 threshold → no COMBAT transition
      expect(ctx.transitions).not.toContain('COMBAT');
    });

    it('does not use medkit when medkitCount is 0', () => {
      const health = makeHealth(15, 100);
      const healSpy = vi.spyOn(health, 'heal');
      const ctx = makeCtx({
        now: 1000,
        health,
        state: { woundedStartMs: 1000, medkitCount: 0, moraleState: 'STABLE' },
      });

      handler.update(ctx, 16);

      expect(healSpy).not.toHaveBeenCalled();
    });

    it('does not use medkit when HP is already above woundedHpThreshold', () => {
      const health = makeHealth(50, 100); // 50% — above threshold (0.2)
      const healSpy = vi.spyOn(health, 'heal');
      const ctx = makeCtx({
        now: 1000,
        health,
        state: { woundedStartMs: 1000, medkitCount: 3, moraleState: 'STABLE' },
      });

      handler.update(ctx, 16);

      expect(healSpy).not.toHaveBeenCalled();
    });

    it('does not crash when health is null', () => {
      const ctx = makeCtx({
        now: 1000,
        health: null,
        state: { woundedStartMs: 1000, medkitCount: 3, moraleState: 'STABLE' },
      });

      expect(() => handler.update(ctx, 16)).not.toThrow();
    });
  });

  describe('update() — panic + no medkits → FLEE', () => {
    it('transitions to FLEE when PANICKED and no medkits', () => {
      const ctx = makeCtx({
        now: 1000,
        state: { woundedStartMs: 1000, medkitCount: 0, moraleState: 'PANICKED' },
      });

      handler.update(ctx, 16);

      expect(ctx.transitions).toContain('FLEE');
    });

    it('does NOT flee to FLEE when PANICKED but has medkits', () => {
      const health = makeHealth(15, 100);
      const ctx = makeCtx({
        now: 1000,
        health,
        state: { woundedStartMs: 1000, medkitCount: 2, moraleState: 'PANICKED' },
      });

      handler.update(ctx, 16);

      // Should heal first (medkit available), then potentially COMBAT (HP>threshold)
      expect(ctx.transitions).not.toContain('FLEE');
    });

    it('does NOT flee when SHAKEN (only PANICKED triggers immediate flee)', () => {
      const ctx = makeCtx({
        now: 1000,
        state: { woundedStartMs: 1000, medkitCount: 0, moraleState: 'SHAKEN' },
      });

      handler.update(ctx, 16);

      expect(ctx.transitions).not.toContain('FLEE');
    });

    it('does NOT flee when STABLE and no medkits', () => {
      const ctx = makeCtx({
        now: 1000,
        state: { woundedStartMs: 1000, medkitCount: 0, moraleState: 'STABLE' },
      });

      handler.update(ctx, 16);

      // Should continue crawling
      expect(ctx.transitions).not.toContain('FLEE');
    });
  });

  describe('update() — time limit → FLEE', () => {
    it('transitions to FLEE after woundedMaxDurationMs', () => {
      const ctx = makeCtx({
        now: 1000 + cfg.woundedMaxDurationMs,
        state: { woundedStartMs: 1000 },
      });

      handler.update(ctx, 16);

      expect(ctx.transitions).toContain('FLEE');
    });

    it('does NOT flee before woundedMaxDurationMs', () => {
      const ctx = makeCtx({
        now: 1000 + cfg.woundedMaxDurationMs - 1,
        state: { woundedStartMs: 1000 },
      });

      handler.update(ctx, 16);

      expect(ctx.transitions).not.toContain('FLEE');
    });

    it('time limit check takes priority over medkit healing', () => {
      const health = makeHealth(15, 100);
      const ctx = makeCtx({
        now: 1000 + cfg.woundedMaxDurationMs,
        health,
        state: { woundedStartMs: 1000, medkitCount: 5 },
      });

      handler.update(ctx, 16);

      expect(ctx.transitions).toContain('FLEE');
    });
  });

  describe('update() — crawl movement', () => {
    it('crawls away from lastKnownEnemyX/Y at woundedCrawlMultiplier speed', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        now: 1000,
        state: {
          woundedStartMs: 1000,
          lastKnownEnemyX: 100,
          lastKnownEnemyY: 0, // enemy is directly above
          medkitCount: 0,
          moraleState: 'STABLE',
        },
      });

      handler.update(ctx, 16);

      // Should crawl away from enemy (y:0) so moving in +Y direction
      expect(ctx.velocityY).toBeGreaterThan(0);
    });

    it('crawl speed = approachSpeed * woundedCrawlMultiplier', () => {
      const customCfg = createDefaultStateConfig({ approachSpeed: 100, woundedCrawlMultiplier: 0.3 });
      const customHandler = new WoundedState(customCfg);

      const ctx = makeCtx({
        x: 100, y: 100,
        now: 1000,
        state: {
          woundedStartMs: 1000,
          lastKnownEnemyX: 100,
          lastKnownEnemyY: 0,
          medkitCount: 0,
          moraleState: 'STABLE',
        },
      });

      customHandler.update(ctx, 16);

      // Crawl speed = 100 * 0.3 = 30
      expect(Math.abs(ctx.velocityY)).toBeCloseTo(30, 1);
    });
  });

  describe('exit()', () => {
    it('does nothing in exit (no cleanup needed)', () => {
      const ctx = makeCtx();
      ctx.velocityX = 50;
      ctx.velocityY = 50;

      handler.exit(ctx);

      // WoundedState.exit() is intentionally a no-op
      expect(ctx.transitions).toHaveLength(0);
    });

    it('exit does not call halt()', () => {
      const ctx = makeCtx();
      const haltSpy = vi.spyOn(ctx, 'halt');

      handler.exit(ctx);

      expect(haltSpy).not.toHaveBeenCalled();
    });
  });

  describe('multiple NPCs share single handler instance', () => {
    it('each NPC has independent woundedStartMs', () => {
      const ctxA = makeCtx({ now: 1000 });
      const ctxB = makeCtx({ now: 5000 });

      handler.enter(ctxA);
      handler.enter(ctxB);

      expect(ctxA.state.woundedStartMs).toBe(1000);
      expect(ctxB.state.woundedStartMs).toBe(5000);
    });
  });

  describe('injectable IStateTransitionMap overrides', () => {
    it('uses custom woundedOnPanic when PANICKED with no medkits', () => {
      const customHandler = new WoundedState(cfg, { woundedOnPanic: 'crawl_away' });
      const ctx = makeCtx({
        now: 1000,
        state: { woundedStartMs: 1000, medkitCount: 0, moraleState: 'PANICKED' },
      });

      customHandler.update(ctx, 16);

      expect(ctx.transitions).toContain('crawl_away');
    });

    it('uses custom woundedOnTimeout when time limit exceeded', () => {
      const customHandler = new WoundedState(cfg, { woundedOnTimeout: 'give_up' });
      const ctx = makeCtx({
        now: 1000 + cfg.woundedMaxDurationMs,
        state: { woundedStartMs: 1000 },
      });

      customHandler.update(ctx, 16);

      expect(ctx.transitions).toContain('give_up');
    });

    it('uses custom woundedOnHealed when HP recovers above threshold', () => {
      const health = makeHealth(15, 100);
      const customHandler = new WoundedState(cfg, { woundedOnHealed: 'back_to_fight' });
      const ctx = makeCtx({
        now: 4000,
        health,
        state: { woundedStartMs: 1000, medkitCount: 1, moraleState: 'STABLE', lastMedkitMs: 0 },
      });

      customHandler.update(ctx, 16);

      expect(ctx.transitions).toContain('back_to_fight');
    });
  });
});

// ---------------------------------------------------------------------------
// RetreatState
// ---------------------------------------------------------------------------

describe('RetreatState', () => {
  let cfg: IStateConfig;
  let handler: RetreatState;

  beforeEach(() => {
    cfg = createDefaultStateConfig();
    handler = new RetreatState(cfg);
  });

  describe('enter()', () => {
    it('finds FAR cover and stores position in coverPointX/Y', () => {
      const cover = makeCover({ x: 400, y: 600 });
      const ctx = makeCtx({
        x: 100, y: 100,
        cover,
        state: { lastKnownEnemyX: 200, lastKnownEnemyY: 200 },
      });

      handler.enter(ctx);

      expect(ctx.state.coverPointX).toBe(400);
      expect(ctx.state.coverPointY).toBe(600);
    });

    it('resets lastSuppressiveFireMs to 0 for immediate first burst', () => {
      const cover = makeCover({ x: 400, y: 600 });
      const ctx = makeCtx({
        x: 100, y: 100,
        cover,
        state: { lastSuppressiveFireMs: 9999 },
      });

      handler.enter(ctx);

      expect(ctx.state.lastSuppressiveFireMs).toBe(0);
    });

    it('signals no-cover with NaN destination when no cover found', () => {
      const ctx = makeCtx({
        x: 100, y: 200,
        cover: makeCover(null),
      });

      handler.enter(ctx);

      // No cover found — coverPointX/Y are NaN so update() routes through awayFrom().
      expect(Number.isNaN(ctx.state.coverPointX)).toBe(true);
      expect(Number.isNaN(ctx.state.coverPointY)).toBe(true);
    });

    it('works without a cover system (null cover)', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        cover: null,
        state: { lastKnownEnemyX: 200, lastKnownEnemyY: 200 },
      });

      expect(() => handler.enter(ctx)).not.toThrow();
    });

    it('does not transition on enter', () => {
      const ctx = makeCtx({ cover: makeCover() });
      handler.enter(ctx);
      expect(ctx.transitions).toHaveLength(0);
    });

    it('calls findCover with FAR type', () => {
      const findCoverSpy = vi.fn().mockReturnValue({ x: 500, y: 500 });
      const cover: ICoverAccess = { findCover: findCoverSpy };
      const ctx = makeCtx({
        x: 100, y: 100,
        cover,
        state: { lastKnownEnemyX: 200, lastKnownEnemyY: 200 },
      });

      handler.enter(ctx);

      expect(findCoverSpy).toHaveBeenCalledWith(
        100, 100,
        200, 200,
        'FAR',
      );
    });
  });

  describe('update() — PANICKED → FLEE', () => {
    it('transitions to FLEE immediately when morale is PANICKED', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        cover: makeCover({ x: 500, y: 500 }),
        state: { moraleState: 'PANICKED', coverPointX: 500, coverPointY: 500 },
      });

      handler.update(ctx, 16);

      expect(ctx.transitions).toContain('FLEE');
    });

    it('halts before fleeing when PANICKED', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        cover: makeCover({ x: 500, y: 500 }),
        state: { moraleState: 'PANICKED', coverPointX: 500, coverPointY: 500 },
      });
      ctx.velocityX = 200;
      ctx.velocityY = 200;

      handler.update(ctx, 16);

      expect(ctx.halted).toBe(true);
    });

    it('does NOT transition to FLEE when morale is SHAKEN', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        cover: makeCover({ x: 500, y: 500 }),
        state: {
          moraleState: 'SHAKEN',
          coverPointX: 500, coverPointY: 500,
        },
      });

      handler.update(ctx, 16);

      expect(ctx.transitions).not.toContain('FLEE');
    });
  });

  describe('update() — moving toward cover', () => {
    it('moves toward cover point when not yet arrived', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        cover: makeCover({ x: 500, y: 100 }),
        state: {
          moraleState: 'SHAKEN',
          coverPointX: 500, coverPointY: 100,
          lastKnownEnemyX: 0, lastKnownEnemyY: 0,
        },
      });

      handler.update(ctx, 16);

      // Should be moving toward x=500 (positive X velocity)
      expect(ctx.velocityX).toBeGreaterThan(0);
      expect(ctx.transitions).toHaveLength(0);
    });

    it('move speed equals approachSpeed', () => {
      const customCfg = createDefaultStateConfig({ approachSpeed: 200 });
      const customHandler = new RetreatState(customCfg);

      const ctx = makeCtx({
        x: 100, y: 100,
        cover: makeCover({ x: 500, y: 100 }),
        state: {
          moraleState: 'SHAKEN',
          coverPointX: 500, coverPointY: 100,
        },
      });

      customHandler.update(ctx, 16);

      // Purely horizontal movement: velocity X ≈ 200
      expect(Math.abs(ctx.velocityX)).toBeCloseTo(200, 1);
    });
  });

  describe('update() — arrived at cover → suppressive fire + state transitions', () => {
    it('halts when arrived at cover', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        cover: makeCover({ x: 100, y: 100 }),
        state: {
          moraleState: 'SHAKEN',
          coverPointX: 100, coverPointY: 100,
          lastSuppressiveFireMs: 0,
          lastKnownEnemyX: 200, lastKnownEnemyY: 200,
          primaryWeapon: 'rifle',
        },
        now: 10000,
      });

      handler.update(ctx, 16);

      expect(ctx.halted).toBe(true);
    });

    it('fires suppressive shot when arrived at cover and fire interval elapsed', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        now: 10000,
        state: {
          moraleState: 'SHAKEN',
          coverPointX: 100, coverPointY: 100,
          lastSuppressiveFireMs: 0, // interval definitely elapsed
          lastKnownEnemyX: 300, lastKnownEnemyY: 300,
          primaryWeapon: 'rifle',
        },
        perception: makePerception(false),
      });

      handler.update(ctx, 16);

      expect(ctx.shoots).toHaveLength(1);
    });

    it('suppressive fire targets visible enemy when available', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        now: 10000,
        perception: makePerception(true, [{ id: 'e1', x: 400, y: 500, factionId: 'bandits' }]),
        state: {
          moraleState: 'SHAKEN',
          coverPointX: 100, coverPointY: 100,
          lastSuppressiveFireMs: 0,
          lastKnownEnemyX: 200, lastKnownEnemyY: 200,
          primaryWeapon: 'rifle',
        },
      });

      handler.update(ctx, 16);

      expect(ctx.shoots).toHaveLength(1);
      expect(ctx.shoots[0].targetX).toBe(400);
      expect(ctx.shoots[0].targetY).toBe(500);
    });

    it('suppressive fire uses lastKnownEnemyX/Y when no visible enemy', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        now: 10000,
        perception: makePerception(false),
        state: {
          moraleState: 'SHAKEN',
          coverPointX: 100, coverPointY: 100,
          lastSuppressiveFireMs: 0,
          lastKnownEnemyX: 600, lastKnownEnemyY: 700,
          primaryWeapon: 'pistol',
        },
      });

      handler.update(ctx, 16);

      expect(ctx.shoots).toHaveLength(1);
      expect(ctx.shoots[0].targetX).toBe(600);
      expect(ctx.shoots[0].targetY).toBe(700);
    });

    it('uses primary weapon type in shoot payload', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        now: 10000,
        perception: makePerception(false),
        state: {
          moraleState: 'SHAKEN',
          coverPointX: 100, coverPointY: 100,
          lastSuppressiveFireMs: 0,
          lastKnownEnemyX: 300, lastKnownEnemyY: 300,
          primaryWeapon: 'sniper',
        },
      });

      handler.update(ctx, 16);

      expect(ctx.shoots[0].weaponType).toBe('sniper');
    });

    it('falls back to "rifle" weapon type when no primary weapon', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        now: 10000,
        perception: makePerception(false),
        state: {
          moraleState: 'SHAKEN',
          coverPointX: 100, coverPointY: 100,
          lastSuppressiveFireMs: 0,
          lastKnownEnemyX: 300, lastKnownEnemyY: 300,
          primaryWeapon: null,
        },
      });

      handler.update(ctx, 16);

      expect(ctx.shoots[0].weaponType).toBe('rifle');
    });

    it('does NOT fire suppressive shot before retreatFireIntervalMs elapses', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        now: 1500,
        state: {
          moraleState: 'SHAKEN',
          coverPointX: 100, coverPointY: 100,
          lastSuppressiveFireMs: 1000, // only 500ms ago
          lastKnownEnemyX: 300, lastKnownEnemyY: 300,
        },
        perception: makePerception(false),
      });

      handler.update(ctx, 16);

      expect(ctx.shoots).toHaveLength(0);
    });

    it('updates lastSuppressiveFireMs after firing', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        now: 10000,
        perception: makePerception(false),
        state: {
          moraleState: 'SHAKEN',
          coverPointX: 100, coverPointY: 100,
          lastSuppressiveFireMs: 0,
          lastKnownEnemyX: 300, lastKnownEnemyY: 300,
          primaryWeapon: 'rifle',
        },
      });

      handler.update(ctx, 16);

      expect(ctx.state.lastSuppressiveFireMs).toBe(10000);
    });

    it('transitions to COMBAT when morale is STABLE at cover', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        now: 10000,
        perception: makePerception(true),
        state: {
          moraleState: 'STABLE',
          coverPointX: 100, coverPointY: 100,
          lastSuppressiveFireMs: 0,
          lastKnownEnemyX: 300, lastKnownEnemyY: 300,
          primaryWeapon: 'rifle',
        },
      });

      handler.update(ctx, 16);

      expect(ctx.transitions).toContain('COMBAT');
    });

    it('transitions to SEARCH when at cover with no visible enemy and not STABLE', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        now: 10000,
        perception: makePerception(false),
        state: {
          moraleState: 'SHAKEN',
          coverPointX: 100, coverPointY: 100,
          lastSuppressiveFireMs: 0,
          lastKnownEnemyX: 300, lastKnownEnemyY: 300,
          primaryWeapon: 'rifle',
        },
      });

      handler.update(ctx, 16);

      expect(ctx.transitions).toContain('SEARCH');
    });

    it('does NOT transition to SEARCH when perception is null (no perception system)', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        now: 10000,
        perception: null,
        state: {
          moraleState: 'SHAKEN',
          coverPointX: 100, coverPointY: 100,
          lastSuppressiveFireMs: 0,
          lastKnownEnemyX: 300, lastKnownEnemyY: 300,
          primaryWeapon: 'rifle',
        },
      });

      handler.update(ctx, 16);

      // No perception → can't determine enemy visibility → no SEARCH
      expect(ctx.transitions).not.toContain('SEARCH');
    });
  });

  describe('update() — no cover found (flee fallback)', () => {
    it('flees away from last known enemy when cover point equals NPC position', () => {
      const ctx = makeCtx({
        x: 200, y: 200,
        cover: makeCover(null),
        state: {
          moraleState: 'SHAKEN',
          coverPointX: 200, coverPointY: 200, // same as NPC position
          lastKnownEnemyX: 200, lastKnownEnemyY: 100,
        },
      });
      // Manually set coverPointX != ctx.x to avoid hasCoverDest shortcut
      ctx.state.coverPointX = 200;
      ctx.state.coverPointY = 200;

      // Set ctx x to something different to trigger flee
      (ctx as any).x = 200;
      (ctx as any).y = 200;

      handler.update(ctx, 16);

      // With coverPoint == NPC position, hasCoverDest = false → awayFrom is called
      // since NPC is at (200,200) and enemy is at (200,100): move in +Y direction
    });
  });

  describe('exit()', () => {
    it('halts the NPC on exit', () => {
      const ctx = makeCtx();
      ctx.velocityX = 150;
      ctx.velocityY = 150;

      handler.exit(ctx);

      expect(ctx.halted).toBe(true);
    });

    it('does not trigger any transition on exit', () => {
      const ctx = makeCtx();
      handler.exit(ctx);
      expect(ctx.transitions).toHaveLength(0);
    });
  });

  describe('multiple NPCs share single handler instance', () => {
    it('each NPC stores independent cover points', () => {
      const coverA: ICoverAccess = { findCover: () => ({ x: 300, y: 300 }) };
      const coverB: ICoverAccess = { findCover: () => ({ x: 600, y: 600 }) };

      const ctxA = makeCtx({ x: 100, y: 100, cover: coverA });
      const ctxB = makeCtx({ x: 100, y: 100, cover: coverB });

      handler.enter(ctxA);
      handler.enter(ctxB);

      expect(ctxA.state.coverPointX).toBe(300);
      expect(ctxB.state.coverPointX).toBe(600);
    });
  });

  describe('does not fire when target is at NPC position (degenerate case)', () => {
    it('does not emit shoot when target dx and dy are both 0', () => {
      const ctx = makeCtx({
        x: 100, y: 100,
        now: 10000,
        perception: makePerception(false),
        state: {
          moraleState: 'SHAKEN',
          coverPointX: 100, coverPointY: 100,
          lastSuppressiveFireMs: 0,
          lastKnownEnemyX: 100, // same as NPC X
          lastKnownEnemyY: 100, // same as NPC Y
          primaryWeapon: 'rifle',
        },
      });

      handler.update(ctx, 16);

      expect(ctx.shoots).toHaveLength(0);
    });
  });

  describe('injectable IStateTransitionMap overrides', () => {
    it('uses custom retreatOnStable when morale is STABLE at cover', () => {
      const customHandler = new RetreatState(cfg, { retreatOnStable: 'engage' });
      const ctx = makeCtx({
        x: 100, y: 100,
        now: 10000,
        perception: makePerception(true),
        state: {
          moraleState: 'STABLE',
          coverPointX: 100, coverPointY: 100,
          lastSuppressiveFireMs: 0,
          lastKnownEnemyX: 300, lastKnownEnemyY: 300,
          primaryWeapon: 'rifle',
        },
      });

      customHandler.update(ctx, 16);

      expect(ctx.transitions).toContain('engage');
    });

    it('uses custom retreatOnPanicked when morale is PANICKED', () => {
      const customHandler = new RetreatState(cfg, { retreatOnPanicked: 'run_away' });
      const ctx = makeCtx({
        x: 100, y: 100,
        cover: makeCover({ x: 500, y: 500 }),
        state: { moraleState: 'PANICKED', coverPointX: 500, coverPointY: 500 },
      });

      customHandler.update(ctx, 16);

      expect(ctx.transitions).toContain('run_away');
    });

    it('uses custom retreatOnNoEnemy when at cover with no visible enemy', () => {
      const customHandler = new RetreatState(cfg, { retreatOnNoEnemy: 'patrol' });
      const ctx = makeCtx({
        x: 100, y: 100,
        now: 10000,
        perception: makePerception(false),
        state: {
          moraleState: 'SHAKEN',
          coverPointX: 100, coverPointY: 100,
          lastSuppressiveFireMs: 0,
          lastKnownEnemyX: 300, lastKnownEnemyY: 300,
          primaryWeapon: 'rifle',
        },
      });

      customHandler.update(ctx, 16);

      expect(ctx.transitions).toContain('patrol');
    });
  });
});
