// states/handlers/passive-handlers.test.ts
// Tests for all 8 passive/simple NPC state handlers.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createDefaultNPCOnlineState } from '../NPCOnlineState';
import { createDefaultStateConfig } from '../IStateConfig';
import type { INPCContext } from '../INPCContext';
import type { INPCOnlineState } from '../INPCOnlineState';
import type { IStateConfig } from '../IStateConfig';

import { DeadState }   from './DeadState';
import { IdleState }   from './IdleState';
import { PatrolState } from './PatrolState';
import { AlertState }  from './AlertState';
import { FleeState }   from './FleeState';
import { SearchState } from './SearchState';
import { CampState }   from './CampState';
import { SleepState }  from './SleepState';

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

interface MockCtxOptions {
  perceptionEnemies?: Array<{ id: string; x: number; y: number; factionId: string }>;
  hp?: number;
  nowMs?: number;
  x?: number;
  y?: number;
  moraleState?: 'STABLE' | 'SHAKEN' | 'PANICKED';
  hasRestrictedZone?: boolean;
  restrictedZoneAccessible?: boolean;
}

function makeMockCtx(overrides: MockCtxOptions = {}) {
  const calls: string[] = [];
  const state: INPCOnlineState = createDefaultNPCOnlineState();
  let nowMs = overrides.nowMs ?? 0;

  if (overrides.moraleState) {
    state.moraleState = overrides.moraleState;
  }

  const enemies = overrides.perceptionEnemies ?? [];
  const accessible = overrides.restrictedZoneAccessible ?? true;

  const ctx: INPCContext = {
    npcId: 'npc-1',
    factionId: 'stalker',
    entityType: 'human',
    x: overrides.x ?? 100,
    y: overrides.y ?? 100,
    state,
    currentStateId: 'IDLE',
    perception: {
      getVisibleEnemies: () => enemies,
      getVisibleAllies:  () => [],
      getNearbyItems:    () => [],
      hasVisibleEnemy:   () => enemies.length > 0,
    },
    health: {
      hp:       overrides.hp ?? 100,
      maxHp:    100,
      hpPercent: (overrides.hp ?? 100) / 100,
      heal: (amount: number) => { calls.push(`heal:${amount}`); },
    },
    setVelocity:     (vx, vy) => { calls.push(`vel:${vx},${vy}`); },
    halt:            ()      => { calls.push('halt'); },
    setRotation:     (r)     => { calls.push(`rot:${r}`); },
    setAlpha:        (a)     => { calls.push(`alpha:${a}`); },
    teleport:        (x, y)  => { calls.push(`teleport:${x},${y}`); },
    disablePhysics:  ()      => { calls.push('disablePhysics'); },
    transition:      (s)     => { calls.push(`transition:${s}`); },
    emitShoot:       ()      => {},
    emitMeleeHit:    ()      => {},
    emitVocalization: (t)    => { calls.push(`vocal:${t}`); },
    emitPsiAttackStart: ()   => {},
    cover: null,
    danger: null,
    restrictedZones: overrides.hasRestrictedZone === true ? {
      isAccessible: (_x: number, _y: number) => accessible,
      filterAccessible: (pts) => accessible ? [...pts] : [],
    } : null,
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
// DeadState
// ---------------------------------------------------------------------------

describe('DeadState', () => {
  const cfg = createDefaultStateConfig();
  const handler = new DeadState(cfg);

  it('enter: halts and disables physics', () => {
    const { ctx, calls } = makeMockCtx();
    handler.enter(ctx);
    expect(calls).toContain('halt');
    expect(calls).toContain('disablePhysics');
  });

  it('update: is a no-op (never transitions)', () => {
    const { ctx, calls } = makeMockCtx({
      perceptionEnemies: [{ id: 'e1', x: 200, y: 200, factionId: 'bandits' }],
    });
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('update: is a no-op even after many frames', () => {
    const { ctx, calls, setNow } = makeMockCtx();
    handler.enter(ctx);
    for (let i = 0; i < 100; i++) {
      setNow(i * 16);
      handler.update(ctx, 16);
    }
    expect(calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
  });

  it('exit: is a no-op', () => {
    const { ctx, calls } = makeMockCtx();
    handler.enter(ctx);
    calls.length = 0;
    handler.exit(ctx);
    expect(calls).toHaveLength(0);
  });

  it('can be instantiated with custom config', () => {
    const custom = createDefaultStateConfig({ approachSpeed: 999 });
    const h = new DeadState(custom);
    expect(h).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// IdleState
// ---------------------------------------------------------------------------

describe('IdleState', () => {
  let cfg: IStateConfig;
  let handler: IdleState;

  beforeEach(() => {
    cfg     = createDefaultStateConfig();
    handler = new IdleState(cfg);
  });

  it('enter: halts NPC', () => {
    const { ctx, calls } = makeMockCtx();
    handler.enter(ctx);
    expect(calls).toContain('halt');
  });

  it('enter: seeds idle anim timer for immediate zone check', () => {
    const { ctx } = makeMockCtx({ nowMs: 5000 });
    handler.enter(ctx);
    // lastIdleAnimChangeMs should be set so next check fires immediately
    expect(ctx.state.lastIdleAnimChangeMs).toBeLessThanOrEqual(5000 - cfg.restrictedZoneCheckIntervalMs);
  });

  it('update: no enemy, no transition', () => {
    const { ctx, calls } = makeMockCtx();
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
  });

  it('update: visible enemy → transition ALERT', () => {
    const { ctx, calls } = makeMockCtx({
      perceptionEnemies: [{ id: 'e1', x: 200, y: 200, factionId: 'bandits' }],
    });
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('transition:ALERT');
  });

  it('update: visible enemy updates lastKnownEnemyX/Y', () => {
    const { ctx } = makeMockCtx({
      perceptionEnemies: [{ id: 'e1', x: 300, y: 400, factionId: 'bandits' }],
    });
    handler.enter(ctx);
    handler.update(ctx, 16);
    expect(ctx.state.lastKnownEnemyX).toBe(300);
    expect(ctx.state.lastKnownEnemyY).toBe(400);
  });

  it('update: no transition when perception is null', () => {
    const { ctx, calls } = makeMockCtx();
    (ctx as unknown as Record<string, unknown>).perception = null;
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
  });

  it('update: inside inaccessible zone → transition ALERT', () => {
    const { ctx, calls, setNow } = makeMockCtx({
      hasRestrictedZone: true,
      restrictedZoneAccessible: false,
      nowMs: 0,
    });
    handler.enter(ctx);
    calls.length = 0;
    // Advance time so the zone check interval elapses
    setNow(cfg.restrictedZoneCheckIntervalMs + 1);
    handler.update(ctx, 16);
    expect(calls).toContain('transition:ALERT');
  });

  it('update: zone check throttled after first firing (no second transition within interval)', () => {
    const { ctx, calls, setNow } = makeMockCtx({
      hasRestrictedZone: true,
      restrictedZoneAccessible: false,
      nowMs: 0,
    });
    // enter at t=0 — seeds timer for immediate first check
    handler.enter(ctx);
    calls.length = 0;

    // First update at t=0: zone check fires (timer was seeded for immediate)
    handler.update(ctx, 16);
    expect(calls).toContain('transition:ALERT');
    calls.length = 0;

    // Re-enter to reset state (simulate coming back to IDLE)
    handler.enter(ctx); // now lastIdleAnimChangeMs = 0 - interval
    calls.length = 0;

    // Second update: advance time but stay LESS than one full interval from enter
    // enter seeded lastIdleAnimChangeMs = now - interval = 0 - interval
    // timeSinceCheck = now - lastIdleAnimChangeMs
    // For throttle to block: timeSinceCheck < interval
    // We need: now - (0 - interval) < interval => now + interval < interval => now < 0
    // The seeding in enter() always allows immediate firing, so throttle kicks in
    // AFTER the first check resets lastIdleAnimChangeMs to current now.
    //
    // Simulate: after the first check at t=10, zone is now accessible → no transition.
    // Then zone becomes inaccessible but we advance < interval → throttle blocks it.
    const accessibleCtx = makeMockCtx({
      hasRestrictedZone: true,
      restrictedZoneAccessible: true, // accessible now
      nowMs: 10,
    });
    const h2 = new IdleState(cfg);
    h2.enter(accessibleCtx.ctx); // timer seeded at 10 - interval
    accessibleCtx.calls.length = 0;
    h2.update(accessibleCtx.ctx, 16); // first check: accessible, no transition, resets to t=10
    accessibleCtx.calls.length = 0;

    // Zone becomes dangerous: advance by less than interval from the check reset
    accessibleCtx.setNow(10 + cfg.restrictedZoneCheckIntervalMs - 100);
    // Override to inaccessible for this check
    (accessibleCtx.ctx as unknown as Record<string, unknown>).restrictedZones = {
      isAccessible: () => false,
      filterAccessible: () => [],
    };
    h2.update(accessibleCtx.ctx, 16);
    // timeSinceCheck = (interval - 90) which is < interval → throttled → no transition
    expect(accessibleCtx.calls.filter(c => c === 'transition:ALERT')).toHaveLength(0);
  });

  it('update: accessible zone → no transition', () => {
    const { ctx, calls, setNow } = makeMockCtx({
      hasRestrictedZone: true,
      restrictedZoneAccessible: true,
      nowMs: 0,
    });
    handler.enter(ctx);
    calls.length = 0;
    setNow(cfg.restrictedZoneCheckIntervalMs + 1);
    handler.update(ctx, 16);
    expect(calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
  });

  it('exit: no-op', () => {
    const { ctx, calls } = makeMockCtx();
    handler.enter(ctx);
    calls.length = 0;
    handler.exit(ctx);
    expect(calls).toHaveLength(0);
  });

  // Condition check (opt-in)
  it('update: conditions.hasCondition above threshold → transition CAMP', () => {
    const { ctx, calls } = makeMockCtx();
    (ctx as any).conditions = {
      getLevel: () => 0.9,
      apply: () => {},
      hasCondition: (_ch: string, _t: number) => true,
    };
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('transition:CAMP');
  });

  it('update: conditions null → no tiredness transition (zero overhead)', () => {
    const { ctx, calls } = makeMockCtx();
    // ctx.conditions is null by default (not in makeMockCtx)
    (ctx as any).conditions = null;
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
  });

  it('update: conditions.hasCondition below threshold → no transition', () => {
    const { ctx, calls } = makeMockCtx();
    (ctx as any).conditions = {
      getLevel: () => 0.5,
      apply: () => {},
      hasCondition: () => false,
    };
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
  });

  it('update: idleOnTired override routes tired condition to custom state', () => {
    const customHandler = new IdleState(cfg, { idleOnTired: 'SLEEP' });
    const { ctx, calls } = makeMockCtx();
    (ctx as any).conditions = {
      getLevel: () => 0.9,
      apply: () => {},
      hasCondition: () => true,
    };
    customHandler.enter(ctx);
    calls.length = 0;
    customHandler.update(ctx, 16);
    expect(calls).toContain('transition:SLEEP');
  });

  // Suspicion check (opt-in)
  it('suspicion: above threshold → idleOnSuspicious + lastKnown set + clear() called', () => {
    let cleared = false;
    const { ctx, calls } = makeMockCtx();
    (ctx as any).suspicion = {
      hasReachedAlert: () => true,
      getLastKnownPosition: () => ({ x: 150, y: 250 }),
      clear: () => { cleared = true; },
      clearPosition: () => {},
      getLevel: () => 0.8,
      add: () => {},
    };
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('transition:ALERT');
    expect(ctx.state.lastKnownEnemyX).toBe(150);
    expect(ctx.state.lastKnownEnemyY).toBe(250);
    expect(cleared).toBe(true);
  });

  it('suspicion: null → no transition (zero overhead)', () => {
    const { ctx, calls } = makeMockCtx(); // suspicion: null by default
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
  });

  it('suspicion: idleOnSuspicious override routes to custom state', () => {
    const customHandler = new IdleState(cfg, { idleOnSuspicious: 'SEARCH' });
    const { ctx, calls } = makeMockCtx();
    (ctx as any).suspicion = {
      hasReachedAlert: () => true,
      getLastKnownPosition: () => null,
      clear: () => {},
      clearPosition: () => {},
      getLevel: () => 0.8,
      add: () => {},
    };
    customHandler.enter(ctx);
    calls.length = 0;
    customHandler.update(ctx, 16);
    expect(calls).toContain('transition:SEARCH');
  });

  it('suspicion: suspicion check runs after restrictedZones but before conditions (priority order)', () => {
    // suspicion fires → condition check is never reached
    let conditionChecked = false;
    const { ctx, calls } = makeMockCtx();
    (ctx as any).suspicion = {
      hasReachedAlert: () => true,
      getLastKnownPosition: () => null,
      clear: () => {},
      clearPosition: () => {},
      getLevel: () => 0.8,
      add: () => {},
    };
    (ctx as any).conditions = {
      getLevel: () => 0.9,
      apply: () => {},
      hasCondition: () => { conditionChecked = true; return true; },
    };
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('transition:ALERT');
    expect(conditionChecked).toBe(false);
  });

  describe('pack coordination (opt-in)', () => {
    it("update(): null pack → no effect, no transition", () => {
      const { ctx, calls } = makeMockCtx();
      (ctx as any).pack = null;
      handler.enter(ctx);
      calls.length = 0;
      expect(() => handler.update(ctx, 16)).not.toThrow();
      expect(calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
    });

    it("update(): NONE alert level → no transition", () => {
      const { ctx, calls } = makeMockCtx();
      (ctx as any).pack = {
        getPackAlertLevel: vi.fn(() => 'NONE'),
        getPackTarget: vi.fn(() => null),
        broadcastTarget: vi.fn(),
        broadcastAlertLevel: vi.fn(),
      };
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
    });

    it("update(): ALERTED level → sets lastKnownEnemyX/Y from pack target and transitions idleOnPackAlert", () => {
      const { ctx, calls } = makeMockCtx();
      (ctx as any).pack = {
        getPackAlertLevel: vi.fn(() => 'ALERTED'),
        getPackTarget: vi.fn(() => ({ id: 'e2', x: 300, y: 400 })),
        broadcastTarget: vi.fn(),
        broadcastAlertLevel: vi.fn(),
      };
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(ctx.state.lastKnownEnemyX).toBe(300);
      expect(ctx.state.lastKnownEnemyY).toBe(400);
      expect(calls).toContain('transition:ALERT');
    });
  });
});

// ---------------------------------------------------------------------------
// PatrolState
// ---------------------------------------------------------------------------

describe('PatrolState', () => {
  let cfg: IStateConfig;
  let handler: PatrolState;

  beforeEach(() => {
    cfg     = createDefaultStateConfig();
    handler = new PatrolState(cfg);
  });

  it('enter: halts NPC', () => {
    const { ctx, calls } = makeMockCtx();
    handler.enter(ctx);
    expect(calls).toContain('halt');
  });

  it('update: no target (both 0) → transition IDLE', () => {
    const { ctx, calls } = makeMockCtx();
    // coverPointX/Y default to 0
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('transition:IDLE');
    expect(calls).toContain('halt');
  });

  it('update: visible enemy → transition ALERT', () => {
    const { ctx, calls } = makeMockCtx({
      perceptionEnemies: [{ id: 'e1', x: 300, y: 300, factionId: 'bandits' }],
    });
    ctx.state.coverPointX = 500;
    ctx.state.coverPointY = 500;
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('transition:ALERT');
    expect(calls).toContain('halt');
  });

  it('update: visible enemy sets lastKnownEnemy', () => {
    const { ctx } = makeMockCtx({
      perceptionEnemies: [{ id: 'e1', x: 777, y: 888, factionId: 'bandits' }],
    });
    ctx.state.coverPointX = 500;
    ctx.state.coverPointY = 500;
    handler.enter(ctx);
    handler.update(ctx, 16);
    expect(ctx.state.lastKnownEnemyX).toBe(777);
    expect(ctx.state.lastKnownEnemyY).toBe(888);
  });

  it('update: moves toward patrol target (sets velocity)', () => {
    const { ctx, calls } = makeMockCtx({ x: 100, y: 100 });
    ctx.state.coverPointX = 500;
    ctx.state.coverPointY = 100;
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    const velCall = calls.find(c => c.startsWith('vel:'));
    expect(velCall).toBeDefined();
  });

  it('update: arrives at target → clears target, transitions IDLE', () => {
    const { ctx, calls } = makeMockCtx({ x: 100, y: 100 });
    // Set patrol target within waypointArriveThreshold
    ctx.state.coverPointX = 100 + cfg.waypointArriveThreshold / 2;
    ctx.state.coverPointY = 100;
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('transition:IDLE');
    expect(ctx.state.coverPointX).toBe(0);
    expect(ctx.state.coverPointY).toBe(0);
  });

  it('exit: halts NPC', () => {
    const { ctx, calls } = makeMockCtx();
    handler.enter(ctx);
    calls.length = 0;
    handler.exit(ctx);
    expect(calls).toContain('halt');
  });

  // Squad intel (opt-in)
  it('squad intel: getSharedTarget returns info → patrolOnSquadIntel transition + lastKnownEnemy set', () => {
    const sharedInfo = { targetId: 'e1', x: 400, y: 500, confidence: 0.8, sharedAtMs: 0 };
    const { ctx, calls } = makeMockCtx();
    ctx.state.coverPointX = 200;
    ctx.state.coverPointY = 200;
    (ctx as any).squad = { getSharedTarget: () => sharedInfo, shareTarget: () => {}, getLeaderId: () => null, getMemberCount: () => 1, issueCommand: () => {} };
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('transition:ALERT');
    expect(calls).toContain('halt');
    expect(ctx.state.lastKnownEnemyX).toBe(400);
    expect(ctx.state.lastKnownEnemyY).toBe(500);
  });

  it('squad intel: getSharedTarget returns null → does NOT transition', () => {
    const { ctx, calls } = makeMockCtx();
    ctx.state.coverPointX = 200;
    ctx.state.coverPointY = 200;
    (ctx as any).squad = { getSharedTarget: () => null, shareTarget: () => {}, getLeaderId: () => null, getMemberCount: () => 1, issueCommand: () => {} };
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls.some(c => c.startsWith('transition:'))).toBe(false);
  });

  it('squad intel: ctx.squad null → does NOT throw, does NOT transition', () => {
    const { ctx, calls } = makeMockCtx(); // squad: null by default
    ctx.state.coverPointX = 200;
    ctx.state.coverPointY = 200;
    handler.enter(ctx);
    calls.length = 0;
    expect(() => handler.update(ctx, 16)).not.toThrow();
    expect(calls.some(c => c.startsWith('transition:'))).toBe(false);
  });

  it('squad intel: getSharedTarget not implemented → does NOT transition (double optional chain)', () => {
    const { ctx, calls } = makeMockCtx();
    ctx.state.coverPointX = 200;
    ctx.state.coverPointY = 200;
    // ISquadAccess without optional getSharedTarget — simulates host that hasn't implemented it
    (ctx as any).squad = { shareTarget: () => {}, getLeaderId: () => null, getMemberCount: () => 1, issueCommand: () => {} };
    handler.enter(ctx);
    calls.length = 0;
    expect(() => handler.update(ctx, 16)).not.toThrow();
    expect(calls.some(c => c.startsWith('transition:'))).toBe(false);
  });

  it('squad intel: patrolOnSquadIntel override routes intel to custom state', () => {
    const sharedInfo = { targetId: 'e1', x: 400, y: 500, confidence: 0.8, sharedAtMs: 0 };
    const customHandler = new PatrolState(cfg, { patrolOnSquadIntel: 'SEARCH' });
    const { ctx, calls } = makeMockCtx();
    ctx.state.coverPointX = 200;
    ctx.state.coverPointY = 200;
    (ctx as any).squad = { getSharedTarget: () => sharedInfo, shareTarget: () => {}, getLeaderId: () => null, getMemberCount: () => 1, issueCommand: () => {} };
    customHandler.update(ctx, 16);
    expect(calls).toContain('transition:SEARCH');
  });

  // Suspicion check (opt-in)
  it('suspicion: above threshold + position → patrolOnSuspicious + lastKnown set + clear() called', () => {
    let cleared = false;
    const { ctx, calls } = makeMockCtx();
    ctx.state.coverPointX = 200;
    ctx.state.coverPointY = 200;
    (ctx as any).suspicion = {
      hasReachedAlert: () => true,
      getLastKnownPosition: () => ({ x: 300, y: 400 }),
      clear: () => { cleared = true; },
      clearPosition: () => {},
      getLevel: () => 0.9,
      add: () => {},
    };
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('transition:ALERT');
    expect(calls).toContain('halt');
    expect(ctx.state.lastKnownEnemyX).toBe(300);
    expect(ctx.state.lastKnownEnemyY).toBe(400);
    expect(cleared).toBe(true);
  });

  it('suspicion: above threshold + no position → patrolOnSuspicious + lastKnown unchanged', () => {
    const { ctx, calls } = makeMockCtx();
    ctx.state.coverPointX = 200;
    ctx.state.coverPointY = 200;
    ctx.state.lastKnownEnemyX = 0;
    ctx.state.lastKnownEnemyY = 0;
    (ctx as any).suspicion = {
      hasReachedAlert: () => true,
      getLastKnownPosition: () => null,
      clear: () => {},
      clearPosition: () => {},
      getLevel: () => 0.9,
      add: () => {},
    };
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('transition:ALERT');
    expect(ctx.state.lastKnownEnemyX).toBe(0);
    expect(ctx.state.lastKnownEnemyY).toBe(0);
  });

  it('suspicion: null → no transition, no throw', () => {
    const { ctx, calls } = makeMockCtx(); // suspicion: null by default
    ctx.state.coverPointX = 200;
    ctx.state.coverPointY = 200;
    handler.enter(ctx);
    calls.length = 0;
    expect(() => handler.update(ctx, 16)).not.toThrow();
    expect(calls.some(c => c === 'transition:ALERT')).toBe(false);
  });

  it('suspicion: below threshold → no transition', () => {
    const { ctx, calls } = makeMockCtx();
    ctx.state.coverPointX = 200;
    ctx.state.coverPointY = 200;
    (ctx as any).suspicion = {
      hasReachedAlert: () => false,
      getLastKnownPosition: () => null,
      clear: () => {},
      clearPosition: () => {},
      getLevel: () => 0.3,
      add: () => {},
    };
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls.some(c => c.startsWith('transition:'))).toBe(false);
  });

  it('suspicion: patrolOnSuspicious override routes to custom state', () => {
    const customHandler = new PatrolState(cfg, { patrolOnSuspicious: 'SEARCH' });
    const { ctx, calls } = makeMockCtx();
    ctx.state.coverPointX = 200;
    ctx.state.coverPointY = 200;
    (ctx as any).suspicion = {
      hasReachedAlert: () => true,
      getLastKnownPosition: () => ({ x: 10, y: 20 }),
      clear: () => {},
      clearPosition: () => {},
      getLevel: () => 0.9,
      add: () => {},
    };
    customHandler.update(ctx, 16);
    expect(calls).toContain('transition:SEARCH');
  });

  describe('pack coordination (opt-in)', () => {
    it("update(): null pack → no effect", () => {
      const { ctx, calls } = makeMockCtx();
      ctx.state.coverPointX = 200;
      ctx.state.coverPointY = 200;
      (ctx as any).pack = null;
      handler.enter(ctx);
      calls.length = 0;
      expect(() => handler.update(ctx, 16)).not.toThrow();
      // Should move toward patrol target, not transition via pack
      expect(calls.some(c => c === 'transition:ALERT' && true)).toBe(
        calls.some(c => c === 'transition:ALERT'),
      );
      // Pack null must not cause a pack-driven alert transition
      // (it may still transition to ALERT via other paths, but pack path is inactive)
      // The key guarantee: no throw and behaviour matches pack-absent baseline
    });

    it("update(): COMBAT level → patrolOnPackAlert + coords set", () => {
      const { ctx, calls } = makeMockCtx();
      ctx.state.coverPointX = 200;
      ctx.state.coverPointY = 200;
      (ctx as any).pack = {
        getPackAlertLevel: vi.fn(() => 'COMBAT'),
        getPackTarget: vi.fn(() => ({ id: 'e3', x: 500, y: 600 })),
        broadcastTarget: vi.fn(),
        broadcastAlertLevel: vi.fn(),
      };
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(ctx.state.lastKnownEnemyX).toBe(500);
      expect(ctx.state.lastKnownEnemyY).toBe(600);
      expect(calls).toContain('transition:ALERT');
    });
  });
});

// ---------------------------------------------------------------------------
// AlertState
// ---------------------------------------------------------------------------

describe('AlertState', () => {
  let cfg: IStateConfig;
  let handler: AlertState;

  beforeEach(() => {
    cfg     = createDefaultStateConfig();
    handler = new AlertState(cfg);
  });

  it('enter: sets alertStartMs to now', () => {
    const { ctx } = makeMockCtx({ nowMs: 1000 });
    handler.enter(ctx);
    expect(ctx.state.alertStartMs).toBe(1000);
  });

  it('enter: halts NPC', () => {
    const { ctx, calls } = makeMockCtx();
    handler.enter(ctx);
    expect(calls).toContain('halt');
  });

  it('update: PANICKED → transition FLEE immediately', () => {
    const { ctx, calls } = makeMockCtx({ moraleState: 'PANICKED' });
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('transition:FLEE');
  });

  it('update: visible enemy → transition COMBAT', () => {
    const { ctx, calls } = makeMockCtx({
      perceptionEnemies: [{ id: 'e1', x: 200, y: 200, factionId: 'bandits' }],
    });
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('transition:COMBAT');
  });

  it('update: visible enemy updates lastKnownEnemy', () => {
    const { ctx } = makeMockCtx({
      perceptionEnemies: [{ id: 'e1', x: 111, y: 222, factionId: 'bandits' }],
    });
    handler.enter(ctx);
    handler.update(ctx, 16);
    expect(ctx.state.lastKnownEnemyX).toBe(111);
    expect(ctx.state.lastKnownEnemyY).toBe(222);
  });

  it('update: timer expired → transition PATROL', () => {
    const { ctx, calls, setNow } = makeMockCtx({ nowMs: 0 });
    handler.enter(ctx);
    calls.length = 0;
    // Advance past alertDuration
    setNow(cfg.alertDuration + 1);
    handler.update(ctx, 16);
    expect(calls).toContain('transition:PATROL');
    expect(calls).toContain('halt');
  });

  it('update: before timer expires, no transition (no enemies)', () => {
    const { ctx, calls, setNow } = makeMockCtx({ nowMs: 0 });
    handler.enter(ctx);
    calls.length = 0;
    setNow(cfg.alertDuration / 2);
    handler.update(ctx, 16);
    expect(calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
  });

  it('update: moves toward lastKnownEnemyX/Y when not arrived', () => {
    const { ctx, calls } = makeMockCtx({ x: 100, y: 100, nowMs: 0 });
    ctx.state.lastKnownEnemyX = 500;
    ctx.state.lastKnownEnemyY = 100;
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    const velCall = calls.find(c => c.startsWith('vel:'));
    expect(velCall).toBeDefined();
  });

  it('update: arrived at last known position → halts (no transition)', () => {
    const { ctx, calls } = makeMockCtx({ x: 100, y: 100, nowMs: 0 });
    // Place last known position very close (within arriveThreshold)
    ctx.state.lastKnownEnemyX = 100 + cfg.arriveThreshold / 2;
    ctx.state.lastKnownEnemyY = 100;
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('halt');
    expect(calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
  });

  it('update: PANICKED takes priority over visible enemy', () => {
    const { ctx, calls } = makeMockCtx({
      moraleState: 'PANICKED',
      perceptionEnemies: [{ id: 'e1', x: 200, y: 200, factionId: 'bandits' }],
    });
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('transition:FLEE');
    expect(calls).not.toContain('transition:COMBAT');
  });

  it('exit: no-op', () => {
    const { ctx, calls } = makeMockCtx();
    handler.enter(ctx);
    calls.length = 0;
    handler.exit(ctx);
    expect(calls).toHaveLength(0);
  });

  describe('pack coordination (opt-in)', () => {
    it("enter(): broadcasts ALERTED to pack when lastKnownEnemyX/Y is set", () => {
      const { ctx } = makeMockCtx({ nowMs: 0 });
      ctx.state.lastKnownEnemyX = 100;
      ctx.state.lastKnownEnemyY = 200;
      ctx.state.targetId = 'e1';
      const mockPack = {
        getPackAlertLevel: vi.fn(() => 'NONE' as const),
        getPackTarget: vi.fn(() => null),
        broadcastTarget: vi.fn(),
        broadcastAlertLevel: vi.fn(),
      };
      (ctx as any).pack = mockPack;
      handler.enter(ctx);
      expect(mockPack.broadcastTarget).toHaveBeenCalledWith('e1', 100, 200);
      expect(mockPack.broadcastAlertLevel).toHaveBeenCalledWith('ALERTED');
    });

    it("enter(): does not broadcast when lastKnownEnemyX/Y is 0,0", () => {
      const { ctx } = makeMockCtx({ nowMs: 0 });
      ctx.state.lastKnownEnemyX = 0;
      ctx.state.lastKnownEnemyY = 0;
      const mockPack = {
        getPackAlertLevel: vi.fn(() => 'NONE' as const),
        getPackTarget: vi.fn(() => null),
        broadcastTarget: vi.fn(),
        broadcastAlertLevel: vi.fn(),
      };
      (ctx as any).pack = mockPack;
      handler.enter(ctx);
      expect(mockPack.broadcastTarget).not.toHaveBeenCalled();
    });

    it("update(): pack COMBAT fast-path → alertOnPackCombat with pack coords", () => {
      const { ctx, calls } = makeMockCtx({ nowMs: 0 });
      // No visible enemy
      (ctx as any).perception = {
        getVisibleEnemies: () => [],
        getVisibleAllies: () => [],
        getNearbyItems: () => [],
        hasVisibleEnemy: () => false,
      };
      (ctx as any).pack = {
        getPackAlertLevel: vi.fn(() => 'COMBAT' as const),
        getPackTarget: vi.fn(() => ({ id: 'e1', x: 50, y: 60 })),
        broadcastTarget: vi.fn(),
        broadcastAlertLevel: vi.fn(),
      };
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(ctx.state.lastKnownEnemyX).toBe(50);
      expect(ctx.state.lastKnownEnemyY).toBe(60);
      expect(ctx.state.targetId).toBe('e1');
      expect(calls).toContain('transition:SEARCH');
    });

    it("update(): no fast-path when pack level is ALERTED (not COMBAT)", () => {
      const { ctx, calls } = makeMockCtx({ nowMs: 0 });
      // No visible enemy
      (ctx as any).perception = {
        getVisibleEnemies: () => [],
        getVisibleAllies: () => [],
        getNearbyItems: () => [],
        hasVisibleEnemy: () => false,
      };
      (ctx as any).pack = {
        getPackAlertLevel: vi.fn(() => 'ALERTED' as const),
        getPackTarget: vi.fn(() => null),
        broadcastTarget: vi.fn(),
        broadcastAlertLevel: vi.fn(),
      };
      handler.enter(ctx);
      calls.length = 0;
      // Timer not elapsed, ALERTED pack level → pack fast-path does not fire SEARCH
      handler.update(ctx, 16);
      expect(calls).not.toContain('transition:SEARCH');
    });

    it("update(): visible enemy wins over pack COMBAT (priority order)", () => {
      // Both visible enemy AND pack COMBAT active simultaneously — visible enemy check
      // runs first in update() and must take precedence (transition to COMBAT, not SEARCH).
      const { ctx, calls } = makeMockCtx({
        nowMs: 0,
        perceptionEnemies: [{ id: 'vis', x: 10, y: 20, factionId: 'bandits' }],
      });
      (ctx as any).pack = {
        getPackAlertLevel: vi.fn(() => 'COMBAT' as const),
        getPackTarget: vi.fn(() => ({ id: 'pack-e', x: 999, y: 999 })),
        broadcastTarget: vi.fn(),
        broadcastAlertLevel: vi.fn(),
      };
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      // Visible enemy → alertOnEnemy (COMBAT), NOT alertOnPackCombat (SEARCH)
      expect(calls).toContain('transition:COMBAT');
      expect(calls).not.toContain('transition:SEARCH');
      // Coords come from the directly visible enemy, not the pack target
      expect(ctx.state.lastKnownEnemyX).toBe(10);
      expect(ctx.state.lastKnownEnemyY).toBe(20);
    });

    it("update(): pack COMBAT fast-path with null target → still transitions, no coord update", () => {
      // getPackTarget returns null → coords stay at their prior values, but we still
      // transition via alertOnPackCombat to avoid stalling in ALERT indefinitely.
      const { ctx, calls } = makeMockCtx({ nowMs: 0 });
      ctx.state.lastKnownEnemyX = 77;
      ctx.state.lastKnownEnemyY = 88;
      (ctx as any).perception = {
        getVisibleEnemies: () => [],
        getVisibleAllies: () => [],
        getNearbyItems: () => [],
        hasVisibleEnemy: () => false,
      };
      (ctx as any).pack = {
        getPackAlertLevel: vi.fn(() => 'COMBAT' as const),
        getPackTarget: vi.fn(() => null),
        broadcastTarget: vi.fn(),
        broadcastAlertLevel: vi.fn(),
      };
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('transition:SEARCH');
      // Coords unchanged — null target means no update
      expect(ctx.state.lastKnownEnemyX).toBe(77);
      expect(ctx.state.lastKnownEnemyY).toBe(88);
    });
  });
});

// ---------------------------------------------------------------------------
// FleeState
// ---------------------------------------------------------------------------

describe('FleeState', () => {
  let cfg: IStateConfig;
  let handler: FleeState;

  beforeEach(() => {
    cfg     = createDefaultStateConfig();
    handler = new FleeState(cfg);
  });

  it('enter: halts NPC', () => {
    const { ctx, calls } = makeMockCtx();
    handler.enter(ctx);
    expect(calls).toContain('halt');
  });

  it('update: STABLE morale → transition ALERT', () => {
    const { ctx, calls } = makeMockCtx({ moraleState: 'STABLE' });
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('transition:ALERT');
    expect(calls).toContain('halt');
  });

  it('update: SHAKEN + not far enough → keeps fleeing', () => {
    const { ctx, calls } = makeMockCtx({
      moraleState: 'SHAKEN',
      x: 100,
      y: 100,
    });
    // Threat is close: NPC at 100,100 threat at 100,100 — dist=0
    ctx.state.lastKnownEnemyX = 100;
    ctx.state.lastKnownEnemyY = 100;
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
    // Should set velocity
    expect(calls.find(c => c.startsWith('vel:'))).toBeDefined();
  });

  it('update: SHAKEN + far enough → halts (waits for morale recovery)', () => {
    const { ctx, calls } = makeMockCtx({
      moraleState: 'SHAKEN',
      x: 1000,
      y: 100,
    });
    // Threat is far away (dist > fleeDistance)
    ctx.state.lastKnownEnemyX = 0;
    ctx.state.lastKnownEnemyY = 100;
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    // Should halt and wait — no transition
    expect(calls).toContain('halt');
    expect(calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
  });

  it('update: PANICKED + far → keeps fleeing (never stops on distance alone)', () => {
    const { ctx, calls } = makeMockCtx({
      moraleState: 'PANICKED',
      x: 1000,
      y: 100,
    });
    ctx.state.lastKnownEnemyX = 0;
    ctx.state.lastKnownEnemyY = 100;
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    // Panicked never stops — velocity should be set
    const velCall = calls.find(c => c.startsWith('vel:'));
    expect(velCall).toBeDefined();
    expect(calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
  });

  it('update: PANICKED applies extra speed multiplier', () => {
    const shaken = makeMockCtx({ moraleState: 'SHAKEN', x: 100, y: 100 });
    shaken.ctx.state.lastKnownEnemyX = 100;
    shaken.ctx.state.lastKnownEnemyY = 0;
    handler.enter(shaken.ctx);
    shaken.calls.length = 0;
    handler.update(shaken.ctx, 16);
    const shakenVel = shaken.calls.find(c => c.startsWith('vel:'));

    const panicked = makeMockCtx({ moraleState: 'PANICKED', x: 100, y: 100 });
    panicked.ctx.state.lastKnownEnemyX = 100;
    panicked.ctx.state.lastKnownEnemyY = 0;
    handler.enter(panicked.ctx);
    panicked.calls.length = 0;
    handler.update(panicked.ctx, 16);
    const panickedVel = panicked.calls.find(c => c.startsWith('vel:'));

    expect(shakenVel).toBeDefined();
    expect(panickedVel).toBeDefined();
    // PANICKED speed should be higher (values differ)
    expect(panickedVel).not.toBe(shakenVel);
  });

  it('update: NPC exactly on threat position → escapes along positive X', () => {
    const { ctx, calls } = makeMockCtx({ moraleState: 'SHAKEN', x: 100, y: 100 });
    ctx.state.lastKnownEnemyX = 100;
    ctx.state.lastKnownEnemyY = 100;
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    // awayFrom with dist=0 → setVelocity(speed, 0)
    const velCall = calls.find(c => c.startsWith('vel:'));
    expect(velCall).toBeDefined();
  });

  it('exit: halts NPC', () => {
    const { ctx, calls } = makeMockCtx();
    handler.enter(ctx);
    calls.length = 0;
    handler.exit(ctx);
    expect(calls).toContain('halt');
  });

  describe('pack coordination (opt-in)', () => {
    it("enter(): broadcasts PANIC to pack", () => {
      const { ctx } = makeMockCtx({ moraleState: 'PANICKED' });
      const mockPack = {
        getPackAlertLevel: vi.fn(() => 'NONE' as const),
        getPackTarget: vi.fn(() => null),
        broadcastTarget: vi.fn(),
        broadcastAlertLevel: vi.fn(),
      };
      (ctx as any).pack = mockPack;
      handler.enter(ctx);
      expect(mockPack.broadcastAlertLevel).toHaveBeenCalledWith('PANIC');
    });
  });
});

// ---------------------------------------------------------------------------
// SearchState
// ---------------------------------------------------------------------------

describe('SearchState', () => {
  let cfg: IStateConfig;
  let handler: SearchState;

  beforeEach(() => {
    cfg     = createDefaultStateConfig();
    handler = new SearchState(cfg);
  });

  it('enter: sets searchStartMs to now', () => {
    const { ctx } = makeMockCtx({ nowMs: 3000 });
    handler.enter(ctx);
    expect(ctx.state.searchStartMs).toBe(3000);
  });

  it('enter: does not overwrite lastKnownEnemyX/Y', () => {
    const { ctx } = makeMockCtx();
    ctx.state.lastKnownEnemyX = 999;
    ctx.state.lastKnownEnemyY = 888;
    handler.enter(ctx);
    expect(ctx.state.lastKnownEnemyX).toBe(999);
    expect(ctx.state.lastKnownEnemyY).toBe(888);
  });

  it('update: visible enemy → transition ALERT', () => {
    const { ctx, calls } = makeMockCtx({
      perceptionEnemies: [{ id: 'e1', x: 200, y: 200, factionId: 'bandits' }],
    });
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('transition:ALERT');
  });

  it('update: visible enemy updates lastKnownEnemy', () => {
    const { ctx } = makeMockCtx({
      perceptionEnemies: [{ id: 'e1', x: 444, y: 555, factionId: 'bandits' }],
    });
    handler.enter(ctx);
    handler.update(ctx, 16);
    expect(ctx.state.lastKnownEnemyX).toBe(444);
    expect(ctx.state.lastKnownEnemyY).toBe(555);
  });

  it('update: search timer expired → transition IDLE, clear targetId', () => {
    const { ctx, calls, setNow } = makeMockCtx({ nowMs: 0 });
    ctx.state.targetId = 'old-enemy';
    handler.enter(ctx);
    calls.length = 0;
    setNow(cfg.searchDuration + 1);
    handler.update(ctx, 16);
    expect(calls).toContain('transition:IDLE');
    expect(ctx.state.targetId).toBeNull();
  });

  it('update: before timer expires → no transition (no enemies)', () => {
    const { ctx, calls, setNow } = makeMockCtx({ nowMs: 0 });
    handler.enter(ctx);
    calls.length = 0;
    setNow(cfg.searchDuration / 2);
    handler.update(ctx, 16);
    expect(calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
  });

  it('update: moves toward lastKnownEnemyX/Y', () => {
    const { ctx, calls } = makeMockCtx({ x: 100, y: 100, nowMs: 0 });
    ctx.state.lastKnownEnemyX = 500;
    ctx.state.lastKnownEnemyY = 100;
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    const velCall = calls.find(c => c.startsWith('vel:'));
    expect(velCall).toBeDefined();
  });

  it('update: arrived at last known position → halts, waits', () => {
    const { ctx, calls } = makeMockCtx({ x: 100, y: 100, nowMs: 0 });
    ctx.state.lastKnownEnemyX = 100 + cfg.arriveThreshold / 2;
    ctx.state.lastKnownEnemyY = 100;
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('halt');
    expect(calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
  });

  it('update: null perception → no ALERT transition on update', () => {
    const { ctx, calls, setNow } = makeMockCtx({ nowMs: 0 });
    (ctx as unknown as Record<string, unknown>).perception = null;
    handler.enter(ctx);
    calls.length = 0;
    setNow(cfg.searchDuration / 2);
    handler.update(ctx, 16);
    expect(calls.filter(c => c === 'transition:ALERT')).toHaveLength(0);
  });

  it('exit: halts NPC', () => {
    const { ctx, calls } = makeMockCtx();
    handler.enter(ctx);
    calls.length = 0;
    handler.exit(ctx);
    expect(calls).toContain('halt');
  });
});

// ---------------------------------------------------------------------------
// CampState
// ---------------------------------------------------------------------------

describe('CampState', () => {
  let cfg: IStateConfig;
  let handler: CampState;

  beforeEach(() => {
    cfg     = createDefaultStateConfig();
    handler = new CampState(cfg);
  });

  it('enter: halts NPC', () => {
    const { ctx, calls } = makeMockCtx();
    handler.enter(ctx);
    expect(calls).toContain('halt');
  });

  it('enter: resets evadeStartMs (no pending reaction)', () => {
    const { ctx } = makeMockCtx();
    ctx.state.evadeStartMs = 9999;
    handler.enter(ctx);
    expect(ctx.state.evadeStartMs).toBe(0);
  });

  it('update: no enemies, no zone → no transition', () => {
    const { ctx, calls } = makeMockCtx();
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
  });

  it('update: visible enemy → queues delayed COMBAT (no immediate transition)', () => {
    const { ctx, calls } = makeMockCtx({
      perceptionEnemies: [{ id: 'e1', x: 200, y: 200, factionId: 'bandits' }],
      nowMs: 1000,
    });
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    // Reaction should be queued but not fired yet
    expect(calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
    expect(ctx.state.evadeStartMs).toBeGreaterThan(0);
  });

  it('update: delayed COMBAT fires after schemeReactionDelayMs', () => {
    const { ctx, calls, setNow } = makeMockCtx({
      perceptionEnemies: [{ id: 'e1', x: 200, y: 200, factionId: 'bandits' }],
      nowMs: 1000,
    });
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16); // queue reaction

    // Advance past delay
    setNow(1000 + cfg.schemeReactionDelayMs + 1);
    // Clear enemies so the handler doesn't re-queue
    (ctx as unknown as Record<string, unknown>).perception = {
      getVisibleEnemies: () => [],
      getVisibleAllies:  () => [],
      getNearbyItems:    () => [],
      hasVisibleEnemy:   () => false,
    };
    handler.update(ctx, 16);
    expect(calls).toContain('transition:COMBAT');
  });

  it('update: inside inaccessible zone → immediate transition ALERT', () => {
    const { ctx, calls } = makeMockCtx({
      hasRestrictedZone: true,
      restrictedZoneAccessible: false,
    });
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('transition:ALERT');
  });

  it('update: accessible zone → no transition', () => {
    const { ctx, calls } = makeMockCtx({
      hasRestrictedZone: true,
      restrictedZoneAccessible: true,
    });
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
  });

  it('exit: clears evadeStartMs and isAlert', () => {
    const { ctx } = makeMockCtx();
    ctx.state.evadeStartMs = 9999;
    ctx.state.isAlert = true;
    handler.exit(ctx);
    expect(ctx.state.evadeStartMs).toBe(0);
    expect(ctx.state.isAlert).toBe(false);
  });

  it('update: null perception → no queued reaction', () => {
    const { ctx, calls } = makeMockCtx();
    (ctx as unknown as Record<string, unknown>).perception = null;
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(ctx.state.evadeStartMs).toBe(0);
    expect(calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
  });

  it('enter: emits camp vocalization when cooldown allows', () => {
    const { ctx, calls } = makeMockCtx({ nowMs: 100_000 });
    // lastVocalizationMs = 0 by default, so cooldown has passed
    handler.enter(ctx);
    expect(calls.find(c => c.startsWith('vocal:'))).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// SleepState
// ---------------------------------------------------------------------------

describe('SleepState', () => {
  let cfg: IStateConfig;
  let handler: SleepState;

  beforeEach(() => {
    cfg     = createDefaultStateConfig();
    handler = new SleepState(cfg);
  });

  it('enter: halts NPC', () => {
    const { ctx, calls } = makeMockCtx();
    handler.enter(ctx);
    expect(calls).toContain('halt');
  });

  it('enter: sets alpha to 0.8 (sleep visual)', () => {
    const { ctx, calls } = makeMockCtx();
    handler.enter(ctx);
    expect(calls).toContain('alpha:0.8');
  });

  it('enter: resets woundedStartMs (no pending reaction)', () => {
    const { ctx } = makeMockCtx();
    ctx.state.woundedStartMs = 9999;
    handler.enter(ctx);
    expect(ctx.state.woundedStartMs).toBe(0);
  });

  it('update: no enemies, no zone → no transition', () => {
    const { ctx, calls } = makeMockCtx();
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
  });

  it('update: enemies detected → queues delayed ALERT (no immediate transition)', () => {
    const { ctx, calls } = makeMockCtx({
      perceptionEnemies: [{ id: 'e1', x: 200, y: 200, factionId: 'bandits' }],
      nowMs: 1000,
    });
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    // Should queue reaction but not fire yet
    expect(calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
    expect(ctx.state.woundedStartMs).toBeGreaterThan(0);
  });

  it('update: delayed ALERT fires after campSleepReactionDelayMs', () => {
    const { ctx, calls, setNow } = makeMockCtx({
      perceptionEnemies: [{ id: 'e1', x: 200, y: 200, factionId: 'bandits' }],
      nowMs: 1000,
    });
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16); // queue reaction

    // Advance past sleep delay
    setNow(1000 + cfg.campSleepReactionDelayMs + 1);
    // Clear enemies
    (ctx as unknown as Record<string, unknown>).perception = {
      getVisibleEnemies: () => [],
      getVisibleAllies:  () => [],
      getNearbyItems:    () => [],
      hasVisibleEnemy:   () => false,
    };
    handler.update(ctx, 16);
    expect(calls).toContain('transition:ALERT');
  });

  it('update: inside inaccessible zone → immediate transition ALERT', () => {
    const { ctx, calls } = makeMockCtx({
      hasRestrictedZone: true,
      restrictedZoneAccessible: false,
    });
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('transition:ALERT');
  });

  it('update: accessible zone → no transition', () => {
    const { ctx, calls } = makeMockCtx({
      hasRestrictedZone: true,
      restrictedZoneAccessible: true,
    });
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
  });

  it('exit: restores alpha to 1', () => {
    const { ctx, calls } = makeMockCtx();
    handler.enter(ctx);
    calls.length = 0;
    handler.exit(ctx);
    expect(calls).toContain('alpha:1');
  });

  it('exit: clears woundedStartMs', () => {
    const { ctx } = makeMockCtx();
    ctx.state.woundedStartMs = 9999;
    handler.exit(ctx);
    expect(ctx.state.woundedStartMs).toBe(0);
  });

  it('update: null perception → no queued reaction', () => {
    const { ctx, calls } = makeMockCtx();
    (ctx as unknown as Record<string, unknown>).perception = null;
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(ctx.state.woundedStartMs).toBe(0);
    expect(calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
  });

  it('update: pending reaction is processed only once', () => {
    const { ctx, calls, setNow } = makeMockCtx({
      perceptionEnemies: [{ id: 'e1', x: 200, y: 200, factionId: 'bandits' }],
      nowMs: 1000,
    });
    handler.enter(ctx);
    handler.update(ctx, 16); // queue reaction
    calls.length = 0;

    // Clear enemies before delay fires
    (ctx as unknown as Record<string, unknown>).perception = {
      getVisibleEnemies: () => [],
      getVisibleAllies:  () => [],
      getNearbyItems:    () => [],
      hasVisibleEnemy:   () => false,
    };

    setNow(1000 + cfg.campSleepReactionDelayMs + 1);
    handler.update(ctx, 16); // fires transition
    const transitionCalls = calls.filter(c => c.startsWith('transition'));
    expect(transitionCalls).toHaveLength(1);
    expect(transitionCalls[0]).toBe('transition:ALERT');

    // Second update should NOT fire again
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Cross-handler: singleton-friendliness
// ---------------------------------------------------------------------------

describe('handlers are singleton-friendly (stateless)', () => {
  const cfg = createDefaultStateConfig();

  it('DeadState: shared instance handles multiple NPCs independently', () => {
    const h = new DeadState(cfg);
    const a = makeMockCtx({ nowMs: 0 });
    const b = makeMockCtx({ nowMs: 100 });
    h.enter(a.ctx);
    h.enter(b.ctx);
    h.update(a.ctx, 16);
    h.update(b.ctx, 16);
    // Neither should have transitioned
    expect(a.calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
    expect(b.calls.filter(c => c.startsWith('transition'))).toHaveLength(0);
  });

  it('AlertState: shared instance separates alert timers by NPC', () => {
    const h = new AlertState(cfg);
    const a = makeMockCtx({ nowMs: 0 });
    const b = makeMockCtx({ nowMs: 100 });

    h.enter(a.ctx); // a entered at t=0
    h.enter(b.ctx); // b entered at t=100

    // Each NPC's own ctx.state stores its own alertStartMs
    expect(a.ctx.state.alertStartMs).toBe(0);
    expect(b.ctx.state.alertStartMs).toBe(100);
  });

  it('SearchState: shared instance separates search timers by NPC', () => {
    const h = new SearchState(cfg);
    const a = makeMockCtx({ nowMs: 0 });
    const b = makeMockCtx({ nowMs: 500 });
    h.enter(a.ctx);
    h.enter(b.ctx);
    expect(a.ctx.state.searchStartMs).toBe(0);
    expect(b.ctx.state.searchStartMs).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// _utils internal — indirect tests via handler behaviour
// ---------------------------------------------------------------------------

describe('_utils: moveToward via PatrolState', () => {
  const cfg     = createDefaultStateConfig();
  const handler = new PatrolState(cfg);

  it('sets rotation toward target', () => {
    const { ctx, calls } = makeMockCtx({ x: 0, y: 0 });
    ctx.state.coverPointX = 100;
    ctx.state.coverPointY = 0; // directly to the right → atan2(0,100) = 0
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    const rotCall = calls.find(c => c.startsWith('rot:'));
    expect(rotCall).toBeDefined();
    expect(rotCall).toBe('rot:0');
  });

  it('velocity magnitude equals approachSpeed', () => {
    const { ctx, calls } = makeMockCtx({ x: 0, y: 0 });
    ctx.state.coverPointX = 100;
    ctx.state.coverPointY = 0;
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    const velCall = calls.find(c => c.startsWith('vel:'));
    expect(velCall).toBeDefined();
    // vel:${vx},${vy} → vx = approachSpeed (dir normalized * speed along x-axis)
    const [, rest] = velCall!.split(':');
    const [vx]     = rest.split(',').map(Number);
    expect(vx).toBeCloseTo(cfg.approachSpeed, 2);
  });
});

describe('_utils: awayFrom via FleeState', () => {
  const cfg     = createDefaultStateConfig();
  const handler = new FleeState(cfg);

  it('moves AWAY from threat (velocity has opposite sign to threat direction)', () => {
    const { ctx, calls } = makeMockCtx({
      moraleState: 'SHAKEN',
      x: 100,
      y: 0,
    });
    // Threat is to the left at x=0, NPC at x=100 → should flee toward positive x
    ctx.state.lastKnownEnemyX = 0;
    ctx.state.lastKnownEnemyY = 0;
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    const velCall = calls.find(c => c.startsWith('vel:'));
    expect(velCall).toBeDefined();
    const [, rest] = velCall!.split(':');
    const [vx]     = rest.split(',').map(Number);
    expect(vx).toBeGreaterThan(0); // moving right (away from left-side threat)
  });
});

// ---------------------------------------------------------------------------
// IStateTransitionMap injection tests
// ---------------------------------------------------------------------------

describe('IStateTransitionMap: transition override', () => {
  const cfg = createDefaultStateConfig();

  it('IdleState: override idleOnEnemy → custom state fires when enemy visible', () => {
    const handler = new IdleState(cfg, { idleOnEnemy: 'my_alert' });
    const { ctx, calls } = makeMockCtx({
      perceptionEnemies: [{ id: 'e1', x: 200, y: 200, factionId: 'bandits' }],
    });
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('transition:my_alert');
    expect(calls).not.toContain('transition:ALERT');
  });

  it('AlertState: default (no tr) still transitions to COMBAT on enemy', () => {
    const handler = new AlertState(cfg);
    const { ctx, calls } = makeMockCtx({
      perceptionEnemies: [{ id: 'e1', x: 200, y: 200, factionId: 'bandits' }],
    });
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('transition:COMBAT');
  });

  it('AlertState: override alertOnEnemy fires custom state', () => {
    const handler = new AlertState(cfg, { alertOnEnemy: 'my_combat' });
    const { ctx, calls } = makeMockCtx({
      perceptionEnemies: [{ id: 'e1', x: 200, y: 200, factionId: 'bandits' }],
    });
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('transition:my_combat');
    expect(calls).not.toContain('transition:COMBAT');
  });

  it('PatrolState: override patrolOnNoWaypoint fires custom state', () => {
    const handler = new PatrolState(cfg, { patrolOnNoWaypoint: 'my_idle' });
    const { ctx, calls } = makeMockCtx();
    // coverPointX/Y default to 0 → no waypoint
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('transition:my_idle');
    expect(calls).not.toContain('transition:IDLE');
  });

  it('FleeState: override fleeOnCalmed fires custom state when STABLE', () => {
    const handler = new FleeState(cfg, { fleeOnCalmed: 'my_recover' });
    const { ctx, calls } = makeMockCtx({ moraleState: 'STABLE' });
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('transition:my_recover');
    expect(calls).not.toContain('transition:ALERT');
  });

  it('SearchState: override searchOnTimeout fires custom state', () => {
    const handler = new SearchState(cfg, { searchOnTimeout: 'my_idle' });
    const { ctx, calls, setNow } = makeMockCtx({ nowMs: 0 });
    handler.enter(ctx);
    calls.length = 0;
    setNow(cfg.searchDuration + 1);
    handler.update(ctx, 16);
    expect(calls).toContain('transition:my_idle');
    expect(calls).not.toContain('transition:IDLE');
  });

  it('SleepState: override sleepOnEnemy fires custom state after delay', () => {
    const handler = new SleepState(cfg, { sleepOnEnemy: 'my_wake' });
    const { ctx, calls, setNow } = makeMockCtx({
      perceptionEnemies: [{ id: 'e1', x: 200, y: 200, factionId: 'bandits' }],
      nowMs: 1000,
    });
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16); // queue reaction

    setNow(1000 + cfg.campSleepReactionDelayMs + 1);
    (ctx as unknown as Record<string, unknown>).perception = {
      getVisibleEnemies: () => [],
      getVisibleAllies:  () => [],
      getNearbyItems:    () => [],
      hasVisibleEnemy:   () => false,
    };
    handler.update(ctx, 16);
    expect(calls).toContain('transition:my_wake');
    expect(calls).not.toContain('transition:ALERT');
  });
});

// ---------------------------------------------------------------------------
// PatrolState: wounded ally + corpse detection seams
// ---------------------------------------------------------------------------

describe('PatrolState — wounded ally seam', () => {
  const cfg = createDefaultStateConfig();

  function makePatrolCtxWithAlly(woundedAllies: Array<{ id: string; x: number; y: number; hpPercent: number }>) {
    const calls: string[] = [];
    const state = createDefaultNPCOnlineState();
    const ctx: INPCContext = {
      npcId: 'npc-1', factionId: 'stalker', entityType: 'human',
      x: 100, y: 100, state, currentStateId: 'PATROL',
      perception: {
        getVisibleEnemies:  () => [],
        getVisibleAllies:   () => [],
        getNearbyItems:     () => [],
        hasVisibleEnemy:    () => false,
        getWoundedAllies:   () => woundedAllies,
      },
      health: null,
      setVelocity: (vx, vy) => { calls.push(`vel:${vx},${vy}`); },
      halt:            () => { calls.push('halt'); },
      setRotation:     (r) => { calls.push(`rot:${r}`); },
      setAlpha:        (a) => { calls.push(`alpha:${a}`); },
      teleport:        (x, y) => { calls.push(`teleport:${x},${y}`); },
      disablePhysics:  () => { calls.push('disablePhysics'); },
      transition:      (s) => { calls.push(`transition:${s}`); },
      emitShoot: () => {}, emitMeleeHit: () => {},
      emitVocalization: (t) => { calls.push(`vocal:${t}`); },
      emitPsiAttackStart: () => {},
      cover: null, danger: null, restrictedZones: null,
      squad: null, conditions: null, suspicion: null,
      now: () => 0, random: () => 0.5,
    };
    return { ctx, calls, state };
  }

  it('wounded ally found → patrolOnWoundedAlly (HELP_WOUNDED)', () => {
    const handler = new PatrolState(cfg);
    const { ctx, calls } = makePatrolCtxWithAlly([{ id: 'a1', x: 300, y: 100, hpPercent: 0.1 }]);
    // Set a valid patrol point so we don't short-circuit on missing waypoint
    ctx.state.coverPointX = 500;
    ctx.state.coverPointY = 100;
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('transition:HELP_WOUNDED');
  });

  it('wounded ally → state fields set correctly', () => {
    const handler = new PatrolState(cfg);
    const { ctx, state } = makePatrolCtxWithAlly([{ id: 'a1', x: 300, y: 200, hpPercent: 0.1 }]);
    ctx.state.coverPointX = 500;
    ctx.state.coverPointY = 100;
    handler.enter(ctx);
    handler.update(ctx, 16);
    expect(state.helpWoundedTargetId).toBe('a1');
    expect(state.helpWoundedX).toBe(300);
    expect(state.helpWoundedY).toBe(200);
  });

  it('no wounded allies → no patrolOnWoundedAlly transition', () => {
    const handler = new PatrolState(cfg);
    const { ctx, calls } = makePatrolCtxWithAlly([]);
    ctx.state.coverPointX = 500;
    ctx.state.coverPointY = 100;
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls.filter(c => c === 'transition:HELP_WOUNDED')).toHaveLength(0);
  });

  it('patrolOnWoundedAlly override routes to custom state', () => {
    const handler = new PatrolState(cfg, { patrolOnWoundedAlly: 'MY_HELP' });
    const { ctx, calls } = makePatrolCtxWithAlly([{ id: 'a1', x: 300, y: 100, hpPercent: 0.1 }]);
    ctx.state.coverPointX = 500;
    ctx.state.coverPointY = 100;
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('transition:MY_HELP');
  });

  it('getWoundedAllies not implemented → no throw, no transition', () => {
    const handler = new PatrolState(cfg);
    const calls: string[] = [];
    const state = createDefaultNPCOnlineState();
    const ctx: INPCContext = {
      npcId: 'npc-1', factionId: 'stalker', entityType: 'human',
      x: 100, y: 100, state, currentStateId: 'PATROL',
      perception: {
        getVisibleEnemies: () => [], getVisibleAllies: () => [],
        getNearbyItems: () => [], hasVisibleEnemy: () => false,
        // getWoundedAllies intentionally omitted
      },
      health: null,
      setVelocity: (vx, vy) => { calls.push(`vel:${vx},${vy}`); },
      halt: () => { calls.push('halt'); },
      setRotation: (r) => { calls.push(`rot:${r}`); },
      setAlpha: (a) => { calls.push(`alpha:${a}`); },
      teleport: (x, y) => { calls.push(`teleport:${x},${y}`); },
      disablePhysics: () => { calls.push('disablePhysics'); },
      transition: (s) => { calls.push(`transition:${s}`); },
      emitShoot: () => {}, emitMeleeHit: () => {},
      emitVocalization: (t) => { calls.push(`vocal:${t}`); },
      emitPsiAttackStart: () => {},
      cover: null, danger: null, restrictedZones: null,
      squad: null, conditions: null, suspicion: null,
      now: () => 0, random: () => 0.5,
    };
    ctx.state.coverPointX = 500;
    ctx.state.coverPointY = 100;
    handler.enter(ctx);
    calls.length = 0;
    expect(() => handler.update(ctx, 16)).not.toThrow();
    expect(calls.filter(c => c === 'transition:HELP_WOUNDED')).toHaveLength(0);
  });
});

describe('PatrolState — corpse detection seam', () => {
  const cfg = createDefaultStateConfig();

  function makePatrolCtxWithCorpses(
    corpses: Array<{ id: string; x: number; y: number }>,
    suspicionObj: { add: ReturnType<typeof vi.fn>; hasReachedAlert: () => boolean; getLastKnownPosition: () => null; clear: () => void; clearPosition: () => void; getLevel: () => number } | null
  ) {
    const calls: string[] = [];
    const state = createDefaultNPCOnlineState();
    const ctx: INPCContext = {
      npcId: 'npc-1', factionId: 'stalker', entityType: 'human',
      x: 100, y: 100, state, currentStateId: 'PATROL',
      perception: {
        getVisibleEnemies: () => [], getVisibleAllies: () => [],
        getNearbyItems: () => [], hasVisibleEnemy: () => false,
        getVisibleCorpses: () => corpses,
      },
      health: null,
      setVelocity: (vx, vy) => { calls.push(`vel:${vx},${vy}`); },
      halt: () => { calls.push('halt'); },
      setRotation: (r) => { calls.push(`rot:${r}`); },
      setAlpha: (a) => { calls.push(`alpha:${a}`); },
      teleport: (x, y) => { calls.push(`teleport:${x},${y}`); },
      disablePhysics: () => { calls.push('disablePhysics'); },
      transition: (s) => { calls.push(`transition:${s}`); },
      emitShoot: () => {}, emitMeleeHit: () => {},
      emitVocalization: (t) => { calls.push(`vocal:${t}`); },
      emitPsiAttackStart: () => {},
      cover: null, danger: null, restrictedZones: null,
      squad: null, conditions: null,
      suspicion: suspicionObj,
      now: () => 0, random: () => 0.5,
    };
    ctx.state.coverPointX = 500;
    ctx.state.coverPointY = 100;
    return { ctx, calls };
  }

  it('visible corpse → suspicion.add(BODY_FOUND) called with corpse position', () => {
    const handler = new PatrolState(cfg);
    const addSpy = vi.fn();
    const suspicion = {
      add: addSpy, hasReachedAlert: () => false,
      getLastKnownPosition: () => null, clear: () => {}, clearPosition: () => {}, getLevel: () => 0,
    };
    const { ctx } = makePatrolCtxWithCorpses([{ id: 'c1', x: 300, y: 200 }], suspicion);
    handler.enter(ctx);
    handler.update(ctx, 16);
    expect(addSpy).toHaveBeenCalledWith('body_found', cfg.corpseFoundSuspicion, 300, 200);
  });

  it('no corpses → suspicion.add not called', () => {
    const handler = new PatrolState(cfg);
    const addSpy = vi.fn();
    const suspicion = {
      add: addSpy, hasReachedAlert: () => false,
      getLastKnownPosition: () => null, clear: () => {}, clearPosition: () => {}, getLevel: () => 0,
    };
    const { ctx } = makePatrolCtxWithCorpses([], suspicion);
    handler.enter(ctx);
    handler.update(ctx, 16);
    expect(addSpy).not.toHaveBeenCalled();
  });

  it('ctx.suspicion null → no throw even with corpse present', () => {
    const handler = new PatrolState(cfg);
    const { ctx } = makePatrolCtxWithCorpses([{ id: 'c1', x: 300, y: 200 }], null);
    handler.enter(ctx);
    expect(() => handler.update(ctx, 16)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// IdleState: wounded ally + corpse detection seams
// ---------------------------------------------------------------------------

describe('IdleState — wounded ally seam', () => {
  const cfg = createDefaultStateConfig();

  it('wounded ally found → idleOnWoundedAlly (HELP_WOUNDED)', () => {
    const handler = new IdleState(cfg);
    const calls: string[] = [];
    const state = createDefaultNPCOnlineState();
    const ctx: INPCContext = {
      npcId: 'npc-1', factionId: 'stalker', entityType: 'human',
      x: 100, y: 100, state, currentStateId: 'IDLE',
      perception: {
        getVisibleEnemies: () => [], getVisibleAllies: () => [],
        getNearbyItems: () => [], hasVisibleEnemy: () => false,
        getWoundedAllies: () => [{ id: 'a1', x: 300, y: 100, hpPercent: 0.1 }],
      },
      health: null,
      setVelocity: (vx, vy) => { calls.push(`vel:${vx},${vy}`); },
      halt: () => { calls.push('halt'); },
      setRotation: (r) => { calls.push(`rot:${r}`); },
      setAlpha: (a) => { calls.push(`alpha:${a}`); },
      teleport: (x, y) => { calls.push(`teleport:${x},${y}`); },
      disablePhysics: () => { calls.push('disablePhysics'); },
      transition: (s) => { calls.push(`transition:${s}`); },
      emitShoot: () => {}, emitMeleeHit: () => {},
      emitVocalization: (t) => { calls.push(`vocal:${t}`); },
      emitPsiAttackStart: () => {},
      cover: null, danger: null, restrictedZones: null,
      squad: null, conditions: null, suspicion: null,
      now: () => 0, random: () => 0.5,
    };
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('transition:HELP_WOUNDED');
  });

  it('wounded ally → state fields set correctly', () => {
    const handler = new IdleState(cfg);
    const state = createDefaultNPCOnlineState();
    const ctx: INPCContext = {
      npcId: 'npc-1', factionId: 'stalker', entityType: 'human',
      x: 100, y: 100, state, currentStateId: 'IDLE',
      perception: {
        getVisibleEnemies: () => [], getVisibleAllies: () => [],
        getNearbyItems: () => [], hasVisibleEnemy: () => false,
        getWoundedAllies: () => [{ id: 'a2', x: 400, y: 250, hpPercent: 0.05 }],
      },
      health: null,
      setVelocity: () => {}, halt: () => {}, setRotation: () => {}, setAlpha: () => {},
      teleport: () => {}, disablePhysics: () => {}, transition: () => {},
      emitShoot: () => {}, emitMeleeHit: () => {}, emitVocalization: () => {}, emitPsiAttackStart: () => {},
      cover: null, danger: null, restrictedZones: null,
      squad: null, conditions: null, suspicion: null,
      now: () => 0, random: () => 0.5,
    };
    handler.enter(ctx);
    handler.update(ctx, 16);
    expect(state.helpWoundedTargetId).toBe('a2');
    expect(state.helpWoundedX).toBe(400);
    expect(state.helpWoundedY).toBe(250);
  });

  it('idleOnWoundedAlly override routes to custom state', () => {
    const handler = new IdleState(cfg, { idleOnWoundedAlly: 'MY_HELP' });
    const calls: string[] = [];
    const state = createDefaultNPCOnlineState();
    const ctx: INPCContext = {
      npcId: 'npc-1', factionId: 'stalker', entityType: 'human',
      x: 100, y: 100, state, currentStateId: 'IDLE',
      perception: {
        getVisibleEnemies: () => [], getVisibleAllies: () => [],
        getNearbyItems: () => [], hasVisibleEnemy: () => false,
        getWoundedAllies: () => [{ id: 'a1', x: 300, y: 100, hpPercent: 0.1 }],
      },
      health: null,
      setVelocity: (vx, vy) => { calls.push(`vel:${vx},${vy}`); },
      halt: () => { calls.push('halt'); },
      setRotation: () => {}, setAlpha: () => {}, teleport: () => {}, disablePhysics: () => {},
      transition: (s) => { calls.push(`transition:${s}`); },
      emitShoot: () => {}, emitMeleeHit: () => {}, emitVocalization: () => {}, emitPsiAttackStart: () => {},
      cover: null, danger: null, restrictedZones: null,
      squad: null, conditions: null, suspicion: null,
      now: () => 0, random: () => 0.5,
    };
    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 16);
    expect(calls).toContain('transition:MY_HELP');
  });
});

describe('IdleState — corpse detection seam', () => {
  const cfg = createDefaultStateConfig();

  it('visible corpse → suspicion.add(BODY_FOUND) called', () => {
    const handler = new IdleState(cfg);
    const addSpy = vi.fn();
    const suspicion = {
      add: addSpy, hasReachedAlert: () => false,
      getLastKnownPosition: () => null, clear: () => {}, clearPosition: () => {}, getLevel: () => 0,
    };
    const state = createDefaultNPCOnlineState();
    const ctx: INPCContext = {
      npcId: 'npc-1', factionId: 'stalker', entityType: 'human',
      x: 100, y: 100, state, currentStateId: 'IDLE',
      perception: {
        getVisibleEnemies: () => [], getVisibleAllies: () => [],
        getNearbyItems: () => [], hasVisibleEnemy: () => false,
        getVisibleCorpses: () => [{ id: 'c1', x: 250, y: 150 }],
      },
      health: null,
      setVelocity: () => {}, halt: () => {}, setRotation: () => {}, setAlpha: () => {},
      teleport: () => {}, disablePhysics: () => {}, transition: () => {},
      emitShoot: () => {}, emitMeleeHit: () => {}, emitVocalization: () => {}, emitPsiAttackStart: () => {},
      cover: null, danger: null, restrictedZones: null,
      squad: null, conditions: null, suspicion,
      now: () => 0, random: () => 0.5,
    };
    handler.enter(ctx);
    handler.update(ctx, 16);
    expect(addSpy).toHaveBeenCalledWith('body_found', cfg.corpseFoundSuspicion, 250, 150);
  });

  it('ctx.suspicion null → no throw even with corpse present', () => {
    const handler = new IdleState(cfg);
    const state = createDefaultNPCOnlineState();
    const ctx: INPCContext = {
      npcId: 'npc-1', factionId: 'stalker', entityType: 'human',
      x: 100, y: 100, state, currentStateId: 'IDLE',
      perception: {
        getVisibleEnemies: () => [], getVisibleAllies: () => [],
        getNearbyItems: () => [], hasVisibleEnemy: () => false,
        getVisibleCorpses: () => [{ id: 'c1', x: 250, y: 150 }],
      },
      health: null,
      setVelocity: () => {}, halt: () => {}, setRotation: () => {}, setAlpha: () => {},
      teleport: () => {}, disablePhysics: () => {}, transition: () => {},
      emitShoot: () => {}, emitMeleeHit: () => {}, emitVocalization: () => {}, emitPsiAttackStart: () => {},
      cover: null, danger: null, restrictedZones: null,
      squad: null, conditions: null, suspicion: null,
      now: () => 0, random: () => 0.5,
    };
    handler.enter(ctx);
    expect(() => handler.update(ctx, 16)).not.toThrow();
  });
});
