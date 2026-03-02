// states/eat-corpse/EatCorpseState.test.ts

import { describe, it, expect, vi } from 'vitest';
import { createDefaultNPCOnlineState } from '../NPCOnlineState';
import { createDefaultStateConfig } from '../IStateConfig';
import type { INPCContext } from '../INPCContext';
import type { INPCOnlineState } from '../INPCOnlineState';
import type { ICorpseSource } from './ICorpseSource';
import type { ICorpseRecord } from './ICorpseSource';
import { EatCorpseState } from './EatCorpseState';
import { withEatCorpseGuard } from './EatCorpseTransitionGuard';
import type { IOnlineStateHandler } from '../IOnlineStateHandler';
import { createDefaultTransitionMap } from '../IStateTransitionMap';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCorpse(id: string, x = 200, y = 200, healAmount = 25): ICorpseRecord {
  return { id, x, y, healAmount };
}

function makeSource(corpses: ICorpseRecord[] = []): ICorpseSource {
  return {
    findCorpses: vi.fn().mockReturnValue(corpses),
    consumeCorpse: vi.fn().mockReturnValue(true),
  };
}

interface MockOptions {
  enemies?: Array<{ id: string; x: number; y: number; factionId: string }>;
  hp?: number;
  hpPercent?: number;
  nowMs?: number;
  x?: number;
  y?: number;
  entityType?: string;
}

function makeMockCtx(opts: MockOptions = {}): {
  ctx: INPCContext;
  state: INPCOnlineState;
  calls: string[];
  nowMs: { value: number };
} {
  const calls: string[] = [];
  const state: INPCOnlineState = createDefaultNPCOnlineState();
  const nowMs = { value: opts.nowMs ?? 0 };
  const enemies = opts.enemies ?? [];
  // Track currentStateId mutably so guard tests can detect inner transitions.
  let currentStateId = 'IDLE';

  const ctx: INPCContext = {
    npcId: 'npc-1',
    factionId: 'mutant',
    entityType: opts.entityType ?? 'dog',
    x: opts.x ?? 100,
    y: opts.y ?? 100,
    state,
    get currentStateId() { return currentStateId; },
    perception: {
      getVisibleEnemies: () => enemies,
      getVisibleAllies:  () => [],
      getNearbyItems:    () => [],
      hasVisibleEnemy:   () => enemies.length > 0,
    },
    health: {
      hp:        opts.hp ?? 100,
      maxHp:     100,
      hpPercent: opts.hpPercent ?? (opts.hp ?? 100) / 100,
      heal: (amount: number) => { calls.push(`heal:${amount}`); },
    },
    setVelocity:       (vx, vy) => { calls.push(`vel:${vx.toFixed(0)},${vy.toFixed(0)}`); },
    halt:              ()       => { calls.push('halt'); },
    setRotation:       ()       => {},
    setAlpha:          ()       => {},
    teleport:          ()       => {},
    disablePhysics:    ()       => {},
    transition:        (s)      => { calls.push(`tr:${s}`); currentStateId = s; },
    emitShoot:         ()       => {},
    emitMeleeHit:      ()       => {},
    emitVocalization:  (t)      => { calls.push(`vocal:${t}`); },
    emitPsiAttackStart: ()      => {},
    cover:         null,
    danger:        null,
    restrictedZones: null,
    squad:         null,
    now:    () => nowMs.value,
    random: () => 0.1,  // predictably below any threshold
  };

  return { ctx, state, calls, nowMs };
}

const cfg = createDefaultStateConfig();

// ---------------------------------------------------------------------------
// EatCorpseState
// ---------------------------------------------------------------------------

describe('EatCorpseState.enter', () => {
  it('transitions to eatCorpseOnNoCorpse when no corpses nearby', () => {
    const source = makeSource([]);
    const handler = new EatCorpseState(cfg, undefined, source);
    const { ctx, calls } = makeMockCtx();

    handler.enter(ctx);

    expect(calls).toContain('tr:IDLE');  // default eatCorpseOnNoCorpse
  });

  it('sets eatCorpsePhase.active and emits vocalization when corpse found', () => {
    const corpse = makeCorpse('c1');
    const source = makeSource([corpse]);
    const handler = new EatCorpseState(cfg, undefined, source);
    const { ctx, state, calls } = makeMockCtx();

    handler.enter(ctx);

    expect(state.eatCorpsePhase?.active).toBe(true);
    expect(state.eatCorpsePhase?.corpseId).toBe('c1');
    expect(state.eatCorpsePhase?.corpseX).toBe(200);
    expect(calls).toContain('vocal:EAT_CORPSE_START');
    expect(calls.some(c => c.startsWith('tr:'))).toBe(false);  // no immediate transition
  });

  it('targets the nearest (first) corpse', () => {
    const near = makeCorpse('near', 120, 100);
    const far  = makeCorpse('far', 500, 500);
    const source = makeSource([near, far]);
    const handler = new EatCorpseState(cfg, undefined, source);
    const { ctx, state } = makeMockCtx();

    handler.enter(ctx);

    expect(state.eatCorpsePhase?.corpseId).toBe('near');
  });

  it('uses custom transition name via IStateTransitionMap override', () => {
    const source = makeSource([]);
    const handler = new EatCorpseState(cfg, { eatCorpseOnNoCorpse: 'WANDER' }, source);
    const { ctx, calls } = makeMockCtx();

    handler.enter(ctx);

    expect(calls).toContain('tr:WANDER');
  });
});

describe('EatCorpseState.update — APPROACH phase', () => {
  it('moves toward corpse while far', () => {
    const corpse = makeCorpse('c1', 500, 100);  // far right
    const source = makeSource([corpse]);
    const handler = new EatCorpseState(cfg, undefined, source, { arriveThreshold: 24 });
    const { ctx, calls } = makeMockCtx({ x: 100, y: 100 });

    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 100);

    const hasMoved = calls.some(c => c.startsWith('vel:'));
    expect(hasMoved).toBe(true);
    expect(ctx.state.eatCorpsePhase?.eating).toBe(false);
  });

  it('transitions to EATING phase when at corpse', () => {
    const corpse = makeCorpse('c1', 105, 100);  // close (dist < 24)
    const source = makeSource([corpse]);
    const handler = new EatCorpseState(cfg, undefined, source, { arriveThreshold: 24 });
    const { ctx, calls } = makeMockCtx({ x: 100, y: 100 });

    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 100);

    expect(ctx.state.eatCorpsePhase?.eating).toBe(true);
    expect(calls).toContain('halt');
  });

  it('interrupts to eatCorpseOnInterrupt when enemy spotted during approach', () => {
    const corpse = makeCorpse('c1', 500, 100);
    const source = makeSource([corpse]);
    const handler = new EatCorpseState(cfg, undefined, source);
    const { ctx, calls, state } = makeMockCtx({
      x: 100, y: 100,
      enemies: [{ id: 'e1', x: 300, y: 100, factionId: 'military' }],
    });

    handler.enter(ctx);
    calls.length = 0;
    handler.update(ctx, 100);

    expect(calls).toContain('tr:ALERT');
    expect(state.targetId).toBe('e1');
  });
});

describe('EatCorpseState.update — EATING phase', () => {
  function setupEatingPhase(eatDurationMs = 2_000) {
    const corpse = makeCorpse('c1', 105, 100, 30);
    const source = makeSource([corpse]);
    const handler = new EatCorpseState(cfg, undefined, source, {
      arriveThreshold: 24,
      eatDurationMs,
    });
    const { ctx, calls, state, nowMs } = makeMockCtx({ x: 100, y: 100 });

    handler.enter(ctx);
    handler.update(ctx, 100);  // arrives → eating=true
    calls.length = 0;

    return { handler, ctx, calls, state, source, nowMs };
  }

  it('halts while eating timer has not expired', () => {
    const { handler, ctx, calls, nowMs } = setupEatingPhase(2_000);
    nowMs.value = 1_000;

    handler.update(ctx, 100);

    expect(calls).toContain('halt');
    expect(calls.some(c => c.startsWith('tr:'))).toBe(false);
  });

  it('heals, boosts morale, consumes corpse, transitions on completion', () => {
    const { handler, ctx, calls, state, source, nowMs } = setupEatingPhase(2_000);
    nowMs.value = 2_001;

    handler.update(ctx, 100);

    expect(calls).toContain('heal:30');
    expect(state.morale).toBeGreaterThan(0);
    expect((source.consumeCorpse as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('npc-1', 'c1');
    expect(calls).toContain('vocal:EAT_CORPSE_DONE');
    expect(calls).toContain('tr:IDLE');
  });

  it('skips heal and morale when consumeCorpse returns false (corpse already taken)', () => {
    const corpse = makeCorpse('c1', 105, 100, 30);
    const source: ICorpseSource = {
      findCorpses: vi.fn().mockReturnValue([corpse]),
      consumeCorpse: vi.fn().mockReturnValue(false),
    };
    const handler = new EatCorpseState(cfg, undefined, source, {
      arriveThreshold: 24,
      eatDurationMs: 1_000,
      moraleBoost: 0.15,
    });
    const { ctx, calls, state, nowMs } = makeMockCtx({ x: 100, y: 100 });

    handler.enter(ctx);
    handler.update(ctx, 100);  // arrive
    calls.length = 0;
    nowMs.value = 1_001;
    handler.update(ctx, 100);  // eating complete

    // No heal or morale boost when corpse was already consumed by another NPC.
    expect(calls.some(c => c.startsWith('heal:'))).toBe(false);
    expect(state.morale).toBe(0);
    // Still emits vocalization and transitions out cleanly.
    expect(calls).toContain('vocal:EAT_CORPSE_DONE');
    expect(calls).toContain('tr:IDLE');
  });

  it('interrupts to eatCorpseOnInterrupt when enemy spotted during eating', () => {
    const corpse = makeCorpse('c1', 105, 100);
    const source = makeSource([corpse]);
    const handler = new EatCorpseState(cfg, undefined, source, { arriveThreshold: 24, eatDurationMs: 5_000 });
    const { ctx, calls } = makeMockCtx({
      x: 100, y: 100,
      enemies: [],
    });

    handler.enter(ctx);
    handler.update(ctx, 100);  // arrive
    calls.length = 0;

    // Enemy appears mid-eat.
    (ctx.perception as { getVisibleEnemies: () => unknown[]; hasVisibleEnemy: () => boolean }).getVisibleEnemies =
      () => [{ id: 'e1', x: 200, y: 100, factionId: 'military' }];
    (ctx.perception as { hasVisibleEnemy: () => boolean }).hasVisibleEnemy = () => true;

    handler.update(ctx, 100);

    expect(calls).toContain('tr:ALERT');
    expect((source.consumeCorpse as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('respects eatCorpseOnDone override', () => {
    const { handler, ctx, calls, nowMs } = setupEatingPhase(2_000);
    nowMs.value = 2_001;
    // Patch tr via a new handler instance.
    const corpse = makeCorpse('c1', 105, 100, 30);
    const source2 = makeSource([corpse]);
    const h2 = new EatCorpseState(cfg, { eatCorpseOnDone: 'PATROL' }, source2, {
      arriveThreshold: 24, eatDurationMs: 1_000,
    });
    const { ctx: ctx2, calls: calls2, nowMs: t2 } = makeMockCtx({ x: 100, y: 100 });

    h2.enter(ctx2);
    h2.update(ctx2, 100);  // arrive
    calls2.length = 0;
    t2.value = 1_001;
    h2.update(ctx2, 100);

    expect(calls2).toContain('tr:PATROL');
    void calls;  // suppress unused warning
  });

  it('does not call heal when healAmount is 0', () => {
    const corpse = makeCorpse('c1', 105, 100, 0);
    const source = makeSource([corpse]);
    const handler = new EatCorpseState(cfg, undefined, source, { arriveThreshold: 24, eatDurationMs: 1_000 });
    const { ctx, calls, nowMs } = makeMockCtx({ x: 100, y: 100 });

    handler.enter(ctx);
    handler.update(ctx, 100);
    calls.length = 0;
    nowMs.value = 1_001;
    handler.update(ctx, 100);

    expect(calls.some(c => c.startsWith('heal:'))).toBe(false);
    expect(calls).toContain('tr:IDLE');
  });
});

describe('EatCorpseState.exit', () => {
  it('marks eatCorpsePhase.active = false', () => {
    const corpse = makeCorpse('c1');
    const source = makeSource([corpse]);
    const handler = new EatCorpseState(cfg, undefined, source);
    const { ctx, state } = makeMockCtx();

    handler.enter(ctx);
    expect(state.eatCorpsePhase?.active).toBe(true);

    handler.exit(ctx);
    expect(state.eatCorpsePhase?.active).toBe(false);
  });

  it('correctly reinitializes phase on second eat cycle (re-entry after completion)', () => {
    let round = 0;
    const source: ICorpseSource = {
      findCorpses: vi.fn().mockImplementation(() =>
        round === 0
          ? [makeCorpse('c1', 105, 100, 30)]
          : [makeCorpse('c2', 105, 100, 50)],
      ),
      consumeCorpse: vi.fn().mockReturnValue(true),
    };
    const handler = new EatCorpseState(cfg, undefined, source, {
      arriveThreshold: 24,
      eatDurationMs: 1_000,
    });
    const { ctx, state, nowMs } = makeMockCtx({ x: 100, y: 100 });

    // --- First cycle ---
    handler.enter(ctx);
    handler.update(ctx, 100);  // arrive
    nowMs.value = 1_001;
    handler.update(ctx, 100);  // complete
    handler.exit(ctx);
    expect(state.eatCorpsePhase?.active).toBe(false);

    // --- Second cycle with a different corpse ---
    round = 1;
    handler.enter(ctx);
    expect(state.eatCorpsePhase?.corpseId).toBe('c2');
    expect(state.eatCorpsePhase?.healAmount).toBe(50);
    expect(state.eatCorpsePhase?.eating).toBe(false);  // reset, not stale
    expect(state.eatCorpsePhase?.active).toBe(true);
  });

  it('is safe to call when eatCorpsePhase is undefined', () => {
    const source = makeSource([]);
    const handler = new EatCorpseState(cfg, undefined, source);
    const { ctx } = makeMockCtx();

    expect(() => handler.exit(ctx)).not.toThrow();
  });

  it('does not consume corpse on exit without completion', () => {
    const corpse = makeCorpse('c1', 105, 100);
    const source = makeSource([corpse]);
    const handler = new EatCorpseState(cfg, undefined, source, { arriveThreshold: 24 });
    const { ctx } = makeMockCtx({ x: 100, y: 100 });

    handler.enter(ctx);
    handler.update(ctx, 100);  // arrive
    handler.exit(ctx);  // interrupted, not completed

    expect((source.consumeCorpse as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// withEatCorpseGuard
// ---------------------------------------------------------------------------

describe('withEatCorpseGuard', () => {
  function makeInnerHandler(): IOnlineStateHandler & { updateCalled: number } {
    const h = {
      updateCalled: 0,
      enter: vi.fn(),
      update: vi.fn(() => { h.updateCalled++; }),
      exit: vi.fn(),
    };
    return h;
  }

  it('forwards enter/update/exit to inner handler', () => {
    const inner = makeInnerHandler();
    const source = makeSource([]);
    const guard = withEatCorpseGuard(inner, source, { checkIntervalMs: 0 });
    const { ctx } = makeMockCtx({ hpPercent: 0.3 });

    guard.enter(ctx);
    guard.update(ctx, 16);
    guard.exit(ctx);

    expect(inner.enter).toHaveBeenCalledOnce();
    expect(inner.update).toHaveBeenCalledOnce();
    expect(inner.exit).toHaveBeenCalledOnce();
  });

  it('does not trigger when HP is above threshold', () => {
    const inner = makeInnerHandler();
    const corpse = makeCorpse('c1');
    const source = makeSource([corpse]);
    const guard = withEatCorpseGuard(inner, source, {
      checkIntervalMs: 0,
      hungerHpThreshold: 0.5,
    });
    const { ctx, calls } = makeMockCtx({ hpPercent: 0.9 });

    guard.update(ctx, 16);

    expect(calls.some(c => c.startsWith('tr:'))).toBe(false);
  });

  it('does not trigger when no corpses found', () => {
    const inner = makeInnerHandler();
    const source = makeSource([]);
    const guard = withEatCorpseGuard(inner, source, {
      checkIntervalMs: 0,
      hungerHpThreshold: 1.0,  // always hungry
      eatProbability: 1.0,
    });
    const { ctx, calls } = makeMockCtx({ hpPercent: 0.3 });

    guard.update(ctx, 16);

    expect(calls.some(c => c.startsWith('tr:'))).toBe(false);
  });

  it('does not trigger when random roll fails', () => {
    const inner = makeInnerHandler();
    const source = makeSource([makeCorpse('c1')]);
    const guard = withEatCorpseGuard(inner, source, {
      checkIntervalMs: 0,
      hungerHpThreshold: 1.0,
      eatProbability: 0.0,  // never triggers
    });
    const { ctx, calls } = makeMockCtx({ hpPercent: 0.3 });

    guard.update(ctx, 16);

    expect(calls.some(c => c.startsWith('tr:'))).toBe(false);
  });

  it('triggers transition when all conditions met', () => {
    const inner = makeInnerHandler();
    const source = makeSource([makeCorpse('c1')]);
    const guard = withEatCorpseGuard(inner, source, {
      checkIntervalMs: 0,
      hungerHpThreshold: 1.0,  // always hungry
      eatProbability: 1.0,
    });
    const { ctx, calls } = makeMockCtx({ hpPercent: 0.3 });

    guard.update(ctx, 16);

    expect(calls).toContain('tr:EAT_CORPSE');
  });

  it('respects allowedEntityTypes filter', () => {
    const inner = makeInnerHandler();
    const source = makeSource([makeCorpse('c1')]);
    const guard = withEatCorpseGuard(inner, source, {
      checkIntervalMs: 0,
      hungerHpThreshold: 1.0,
      eatProbability: 1.0,
      allowedEntityTypes: ['boar'],  // dog not allowed
    });
    const { ctx, calls } = makeMockCtx({ entityType: 'dog', hpPercent: 0.3 });

    guard.update(ctx, 16);

    expect(calls.some(c => c.startsWith('tr:'))).toBe(false);
  });

  it('triggers when entity type is in allowedEntityTypes', () => {
    const inner = makeInnerHandler();
    const source = makeSource([makeCorpse('c1')]);
    const guard = withEatCorpseGuard(inner, source, {
      checkIntervalMs: 0,
      hungerHpThreshold: 1.0,
      eatProbability: 1.0,
      allowedEntityTypes: ['dog', 'boar'],
    });
    const { ctx, calls } = makeMockCtx({ entityType: 'dog', hpPercent: 0.3 });

    guard.update(ctx, 16);

    expect(calls).toContain('tr:EAT_CORPSE');
  });

  it('throttles findCorpses calls by checkIntervalMs', () => {
    const inner = makeInnerHandler();
    const source = makeSource([makeCorpse('c1')]);
    const guard = withEatCorpseGuard(inner, source, {
      checkIntervalMs: 1_000,
      hungerHpThreshold: 1.0,
      eatProbability: 1.0,
    });
    const { ctx, nowMs } = makeMockCtx({ hpPercent: 0.3 });

    nowMs.value = 0;
    guard.update(ctx, 16);   // triggers at t=0
    nowMs.value = 500;
    guard.update(ctx, 16);   // throttled
    nowMs.value = 1_001;
    guard.update(ctx, 16);   // triggers again

    expect(source.findCorpses).toHaveBeenCalledTimes(2);
  });

  it('uses custom eatStateId', () => {
    const inner = makeInnerHandler();
    const source = makeSource([makeCorpse('c1')]);
    const guard = withEatCorpseGuard(inner, source, {
      checkIntervalMs: 0,
      hungerHpThreshold: 1.0,
      eatProbability: 1.0,
      eatStateId: 'FEAST',
    });
    const { ctx, calls } = makeMockCtx({ hpPercent: 0.3 });

    guard.update(ctx, 16);

    expect(calls).toContain('tr:FEAST');
  });

  it('cleans up lastCheckMs on exit so re-entry is not throttled', () => {
    // After exit(), the per-NPC timestamp is deleted.
    // On the next update after re-entry, last = -Infinity → fires immediately
    // (not throttled by the remaining interval from before exit).
    const inner = makeInnerHandler();
    const source = makeSource([makeCorpse('c1')]);
    const guard = withEatCorpseGuard(inner, source, {
      checkIntervalMs: 10_000,
      hungerHpThreshold: 1.0,
      eatProbability: 1.0,
    });
    const { ctx, calls, nowMs } = makeMockCtx({ hpPercent: 0.3 });

    nowMs.value = 0;
    guard.update(ctx, 16);   // fires at t=0, sets lastCheckMs[npcId]=0
    calls.length = 0;

    // Still throttled 100ms later (10000ms interval not elapsed).
    nowMs.value = 100;
    guard.update(ctx, 16);
    expect(calls.some(c => c.startsWith('tr:'))).toBe(false);

    // exit() deletes the timestamp entry.
    guard.exit(ctx);
    calls.length = 0;

    // Re-enter and update at t=200 — last=-Infinity now → fires immediately.
    guard.enter(ctx);
    guard.update(ctx, 16);
    expect(calls.some(c => c.startsWith('tr:'))).toBe(true);
  });

  it('does not override a transition already made by the inner handler', () => {
    // Simulate inner handler (e.g. IdleState) detecting an enemy and
    // calling ctx.transition('ALERT') before the guard runs its hunger check.
    const inner: IOnlineStateHandler = {
      enter: vi.fn(),
      update: vi.fn((ctx: INPCContext) => { ctx.transition('ALERT'); }),
      exit: vi.fn(),
    };
    const source = makeSource([makeCorpse('c1')]);
    const guard = withEatCorpseGuard(inner, source, {
      checkIntervalMs: 0,
      hungerHpThreshold: 1.0,  // always hungry
      eatProbability: 1.0,
    });
    const { ctx, calls } = makeMockCtx({ hpPercent: 0.3 });

    guard.update(ctx, 16);

    // ALERT from the inner handler must be the only transition.
    expect(calls).toContain('tr:ALERT');
    expect(calls).not.toContain('tr:EAT_CORPSE');
    // findCorpses must not be called — no spatial query wasted.
    expect(source.findCorpses).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// IStateTransitionMap new slots
// ---------------------------------------------------------------------------

describe('IStateTransitionMap eat-corpse slots', () => {
  it('createDefaultTransitionMap includes eat-corpse defaults', () => {
    const tr = createDefaultTransitionMap();
    expect(tr.eatCorpseOnDone).toBe('IDLE');
    expect(tr.eatCorpseOnInterrupt).toBe('ALERT');
    expect(tr.eatCorpseOnNoCorpse).toBe('IDLE');
  });

  it('eat-corpse slots are overridable', () => {
    const tr = createDefaultTransitionMap({
      eatCorpseOnDone: 'PATROL',
      eatCorpseOnInterrupt: 'COMBAT',
      eatCorpseOnNoCorpse: 'SEARCH',
    });
    expect(tr.eatCorpseOnDone).toBe('PATROL');
    expect(tr.eatCorpseOnInterrupt).toBe('COMBAT');
    expect(tr.eatCorpseOnNoCorpse).toBe('SEARCH');
  });
});
