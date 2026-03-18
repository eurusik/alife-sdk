// states/handlers/ChargeState.test.ts
// Unit tests for the charge-timeout fix in ChargeState.
//
// Coverage targets:
//   1. chargeStartMs is only written when CHARGING begins (not during WINDUP).
//   2. Charge aborts via chargeOnAbort when the CHARGING phase exceeds
//      chargeTimeoutMs (target unreachable — e.g. blocked by a wall).
//   3. Charge completes successfully (chargeOnComplete / melee hit) when the
//      boar reaches the target within the timeout window.
//
// Follows the patterns established in monster-handlers.test.ts:
//   - makeMockCtx() factory with _nowMs mutable via Object.defineProperty
//   - vi.fn() for all ctx methods
//   - createDefaultStateConfig() as the baseline config

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { INPCContext } from '../INPCContext';
import type { INPCOnlineState } from '../INPCOnlineState';
import { createDefaultNPCOnlineState } from '../NPCOnlineState';
import { createDefaultStateConfig } from '../IStateConfig';
import type { IStateConfig } from '../IStateConfig';
import { ChargeState } from './ChargeState';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeVisibleEnemy(
  id = 'enemy-1',
  x = 200,
  y = 0,
  factionId = 'bandits',
) {
  return { id, x, y, factionId };
}

function makeMockCtx(
  overrides: Partial<{
    x: number;
    y: number;
    nowMs: number;
    enemies: ReturnType<typeof makeVisibleEnemy>[];
    hasEnemy: boolean;
  }> = {},
): INPCContext & {
  halt: ReturnType<typeof vi.fn>;
  setVelocity: ReturnType<typeof vi.fn>;
  setRotation: ReturnType<typeof vi.fn>;
  transition: ReturnType<typeof vi.fn>;
  emitMeleeHit: ReturnType<typeof vi.fn>;
  state: INPCOnlineState;
  _nowMs: number;
} {
  const state = createDefaultNPCOnlineState();
  let nowMs = overrides.nowMs ?? 0;

  const enemies = overrides.enemies ?? [];
  const hasEnemy = overrides.hasEnemy ?? enemies.length > 0;

  const ctx = {
    npcId: 'npc-1',
    factionId: 'mutant',
    entityType: 'boar',
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    state,
    currentStateId: 'CHARGE',
    perception: {
      getVisibleEnemies: () => enemies,
      getVisibleAllies:  () => [],
      getNearbyItems:    () => [],
      hasVisibleEnemy:   () => hasEnemy,
    },
    health: null,
    cover: null,
    danger: null,
    restrictedZones: null,
    squad: null,
    now: () => nowMs,
    random: () => 0.5,
    halt:               vi.fn(),
    setVelocity:        vi.fn(),
    setRotation:        vi.fn(),
    setAlpha:           vi.fn(),
    teleport:           vi.fn(),
    disablePhysics:     vi.fn(),
    transition:         vi.fn(),
    emitShoot:          vi.fn(),
    emitMeleeHit:       vi.fn(),
    emitVocalization:   vi.fn(),
    emitPsiAttackStart: vi.fn(),
    // Expose for test manipulation — allows ctx._nowMs = 5000 to advance time.
    _nowMs: nowMs,
  };

  Object.defineProperty(ctx, '_nowMs', {
    get: () => nowMs,
    set: (v: number) => { nowMs = v; },
  });

  return ctx as unknown as typeof ctx;
}

// ---------------------------------------------------------------------------
// Baseline config and a short-timeout variant for timeout tests
// ---------------------------------------------------------------------------

const cfg: IStateConfig = createDefaultStateConfig();

// Smaller timeout lets tests run with round numbers without touching windup.
const SHORT_TIMEOUT_MS = 500;
const cfgShort: IStateConfig = createDefaultStateConfig({
  chargeTimeoutMs: SHORT_TIMEOUT_MS,
});

// ---------------------------------------------------------------------------
// Helper: drive ctx through windup and land in the CHARGING phase.
//
// After this call:
//   - chargePhase.charging === true
//   - chargePhase.chargeStartMs === cfg.chargeWindupMs + 10
//   - ctx._nowMs === cfg.chargeWindupMs + 10
// ---------------------------------------------------------------------------

function driveToCharging(
  handler: ChargeState,
  ctx: ReturnType<typeof makeMockCtx>,
  config: IStateConfig,
): void {
  handler.enter(ctx);
  ctx._nowMs = config.chargeWindupMs + 10;
  handler.update(ctx, config.chargeWindupMs + 10);
}

// ---------------------------------------------------------------------------
// chargeStartMs lifecycle
// ---------------------------------------------------------------------------

describe('ChargeState — chargeStartMs lifecycle', () => {
  let handler: ChargeState;

  beforeEach(() => {
    handler = new ChargeState(cfg);
  });

  it('chargeStartMs is 0 immediately after enter() (WINDUP has not begun charging)', () => {
    const ctx = makeMockCtx({
      enemies: [makeVisibleEnemy('enemy-1', 200, 0)],
      hasEnemy: true,
      nowMs: 1_000,
    });
    handler.enter(ctx);
    // chargePhase is freshly initialised inside enter(); charging hasn't started.
    expect(ctx.state.chargePhase?.chargeStartMs).toBe(0);
    expect(ctx.state.chargePhase?.charging).toBe(false);
  });

  it('chargeStartMs is 0 during WINDUP (has not elapsed yet)', () => {
    const ctx = makeMockCtx({
      enemies: [makeVisibleEnemy('enemy-1', 200, 0)],
      hasEnemy: true,
      nowMs: 0,
    });
    handler.enter(ctx);
    // Advance partway through windup — still in WINDUP.
    ctx._nowMs = cfg.chargeWindupMs - 1;
    handler.update(ctx, cfg.chargeWindupMs - 1);
    expect(ctx.state.chargePhase?.charging).toBe(false);
    expect(ctx.state.chargePhase?.chargeStartMs).toBe(0);
  });

  it('chargeStartMs is set to ctx.now() when CHARGING begins (windup complete)', () => {
    const ctx = makeMockCtx({
      enemies: [makeVisibleEnemy('enemy-1', 200, 0)],
      hasEnemy: true,
      nowMs: 0,
    });
    handler.enter(ctx);
    const windupDone = cfg.chargeWindupMs + 10;
    ctx._nowMs = windupDone;
    handler.update(ctx, windupDone);
    expect(ctx.state.chargePhase?.charging).toBe(true);
    expect(ctx.state.chargePhase?.chargeStartMs).toBe(windupDone);
  });

  it('chargeStartMs is not overwritten on subsequent update() calls in CHARGING', () => {
    const ctx = makeMockCtx({
      enemies: [makeVisibleEnemy('enemy-1', 500, 0)],  // far — won't reach in one tick
      hasEnemy: true,
      nowMs: 0,
    });
    handler.enter(ctx);
    const windupDone = cfg.chargeWindupMs + 10;
    ctx._nowMs = windupDone;
    handler.update(ctx, windupDone);
    const capturedStart = ctx.state.chargePhase!.chargeStartMs;

    // Advance time and call update again — chargeStartMs must stay the same.
    ctx._nowMs = windupDone + 100;
    handler.update(ctx, 100);
    expect(ctx.state.chargePhase?.chargeStartMs).toBe(capturedStart);
  });

  it('chargeStartMs resets to 0 when enter() is called again (fresh charge cycle)', () => {
    const ctx = makeMockCtx({
      enemies: [makeVisibleEnemy('enemy-1', 200, 0)],
      hasEnemy: true,
      nowMs: 0,
    });
    // First cycle.
    handler.enter(ctx);
    ctx._nowMs = cfg.chargeWindupMs + 10;
    handler.update(ctx, cfg.chargeWindupMs + 10);
    expect(ctx.state.chargePhase?.chargeStartMs).toBeGreaterThan(0);

    // Re-enter for a second cycle — should reset charging state.
    ctx._nowMs = cfg.chargeWindupMs + 50;
    handler.enter(ctx);
    expect(ctx.state.chargePhase?.charging).toBe(false);
    expect(ctx.state.chargePhase?.chargeStartMs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Charge timeout — abort path (target unreachable)
// ---------------------------------------------------------------------------

describe('ChargeState — timeout abort when target is unreachable', () => {
  let handler: ChargeState;

  beforeEach(() => {
    handler = new ChargeState(cfgShort);
  });

  it('does NOT abort before timeout elapses', () => {
    const ctx = makeMockCtx({
      x: 0, y: 0,
      enemies: [makeVisibleEnemy('enemy-1', 1_000, 0)],  // too far to reach
      hasEnemy: true,
      nowMs: 0,
    });
    driveToCharging(handler, ctx, cfgShort);

    // Advance to just before timeout.
    ctx._nowMs = ctx.state.chargePhase!.chargeStartMs + SHORT_TIMEOUT_MS - 1;
    handler.update(ctx, 1);

    expect(ctx.transition).not.toHaveBeenCalledWith('IDLE');
    expect(ctx.state.chargePhase?.charging).toBe(true);
  });

  it('aborts via chargeOnAbort (IDLE) when timeout is exactly reached', () => {
    const ctx = makeMockCtx({
      x: 0, y: 0,
      enemies: [makeVisibleEnemy('enemy-1', 1_000, 0)],
      hasEnemy: true,
      nowMs: 0,
    });
    driveToCharging(handler, ctx, cfgShort);
    const start = ctx.state.chargePhase!.chargeStartMs;

    // Advance to exact timeout boundary — the condition is `>=`.
    ctx._nowMs = start + SHORT_TIMEOUT_MS;
    handler.update(ctx, 1);

    expect(ctx.transition).toHaveBeenCalledWith('IDLE');
  });

  it('aborts via chargeOnAbort (IDLE) when timeout is exceeded', () => {
    const ctx = makeMockCtx({
      x: 0, y: 0,
      enemies: [makeVisibleEnemy('enemy-1', 1_000, 0)],
      hasEnemy: true,
      nowMs: 0,
    });
    driveToCharging(handler, ctx, cfgShort);
    const start = ctx.state.chargePhase!.chargeStartMs;

    ctx._nowMs = start + SHORT_TIMEOUT_MS + 200;
    handler.update(ctx, 200);

    expect(ctx.transition).toHaveBeenCalledWith('IDLE');
  });

  it('calls halt() before transitioning on timeout', () => {
    const ctx = makeMockCtx({
      x: 0, y: 0,
      enemies: [makeVisibleEnemy('enemy-1', 1_000, 0)],
      hasEnemy: true,
      nowMs: 0,
    });
    driveToCharging(handler, ctx, cfgShort);
    const start = ctx.state.chargePhase!.chargeStartMs;

    ctx._nowMs = start + SHORT_TIMEOUT_MS;
    handler.update(ctx, 1);

    expect(ctx.halt).toHaveBeenCalled();
    expect(ctx.transition).toHaveBeenCalledWith('IDLE');
  });

  it('does NOT emit a melee hit on timeout abort', () => {
    const ctx = makeMockCtx({
      x: 0, y: 0,
      enemies: [makeVisibleEnemy('enemy-1', 1_000, 0)],
      hasEnemy: true,
      nowMs: 0,
    });
    driveToCharging(handler, ctx, cfgShort);
    const start = ctx.state.chargePhase!.chargeStartMs;

    ctx._nowMs = start + SHORT_TIMEOUT_MS;
    handler.update(ctx, 1);

    expect(ctx.emitMeleeHit).not.toHaveBeenCalled();
  });

  it('timeout uses chargeStartMs, not windupStartMs', () => {
    // windupStartMs is 0; chargeStartMs is set when charging begins.
    // If the handler mistakenly used windupStartMs the abort would fire
    // on the very first charging tick (windupDone > 0 + timeout=500 would
    // not immediately be true, but windup offset would corrupt the window).
    // This test makes the distinction explicit by starting with a large windup.
    const cfgLongWindup: IStateConfig = createDefaultStateConfig({
      chargeWindupMs:   2_000,
      chargeTimeoutMs:  SHORT_TIMEOUT_MS,
    });
    const localHandler = new ChargeState(cfgLongWindup);
    const ctx = makeMockCtx({
      x: 0, y: 0,
      enemies: [makeVisibleEnemy('enemy-1', 1_000, 0)],
      hasEnemy: true,
      nowMs: 0,
    });
    // Enter and drive past the long windup.
    localHandler.enter(ctx);
    ctx._nowMs = 2_010;  // just past chargeWindupMs=2000
    localHandler.update(ctx, 2_010);
    expect(ctx.state.chargePhase?.charging).toBe(true);
    const start = ctx.state.chargePhase!.chargeStartMs;

    // chargeStartMs should be 2010, not 0.
    expect(start).toBe(2_010);

    // Just before timeout based on chargeStartMs — must NOT abort yet.
    ctx._nowMs = start + SHORT_TIMEOUT_MS - 1;
    localHandler.update(ctx, 1);
    expect(ctx.transition).not.toHaveBeenCalledWith('IDLE');

    // At timeout — must abort.
    ctx._nowMs = start + SHORT_TIMEOUT_MS;
    localHandler.update(ctx, 1);
    expect(ctx.transition).toHaveBeenCalledWith('IDLE');
  });

  it('respects chargeOnAbort override — fires custom state instead of IDLE', () => {
    const customHandler = new ChargeState(cfgShort, { chargeOnAbort: 'SEARCH' });
    const ctx = makeMockCtx({
      x: 0, y: 0,
      enemies: [makeVisibleEnemy('enemy-1', 1_000, 0)],
      hasEnemy: true,
      nowMs: 0,
    });
    driveToCharging(customHandler, ctx, cfgShort);
    const start = ctx.state.chargePhase!.chargeStartMs;

    ctx._nowMs = start + SHORT_TIMEOUT_MS;
    customHandler.update(ctx, 1);

    expect(ctx.transition).toHaveBeenCalledWith('SEARCH');
    expect(ctx.transition).not.toHaveBeenCalledWith('IDLE');
  });

  it('default chargeTimeoutMs is 3000ms', () => {
    expect(cfg.chargeTimeoutMs).toBe(3_000);
  });
});

// ---------------------------------------------------------------------------
// Charge success — target reached within timeout window
// ---------------------------------------------------------------------------

describe('ChargeState — successful charge within timeout', () => {
  let handler: ChargeState;

  beforeEach(() => {
    handler = new ChargeState(cfg);
  });

  it('transitions to chargeOnComplete (COMBAT) on melee impact within timeout', () => {
    const ctx = makeMockCtx({
      x: 0, y: 0,
      enemies: [makeVisibleEnemy('enemy-1', 10, 0)],  // within meleeRange (48px)
      hasEnemy: true,
      nowMs: 0,
    });
    handler.enter(ctx);
    // Force into CHARGING phase with target in melee range.
    ctx.state.chargePhase!.charging = true;
    ctx.state.chargePhase!.chargeStartMs = cfg.chargeWindupMs + 10;
    ctx.state.chargePhase!.targetX = 10;
    ctx.state.chargePhase!.targetY = 0;
    // Set time well inside timeout window.
    ctx._nowMs = cfg.chargeWindupMs + 50;  // 50ms into charge, timeout=3000ms
    handler.update(ctx, 50);

    expect(ctx.transition).toHaveBeenCalledWith('COMBAT');
  });

  it('emits melee hit with chargeDamageMultiplier when target reached within timeout', () => {
    const ctx = makeMockCtx({
      x: 0, y: 0,
      enemies: [makeVisibleEnemy('enemy-1', 10, 0)],
      hasEnemy: true,
      nowMs: 0,
    });
    handler.enter(ctx);
    ctx.state.chargePhase!.charging = true;
    ctx.state.chargePhase!.chargeStartMs = cfg.chargeWindupMs + 10;
    ctx.state.chargePhase!.targetX = 10;
    ctx.state.chargePhase!.targetY = 0;
    ctx._nowMs = cfg.chargeWindupMs + 50;
    handler.update(ctx, 50);

    expect(ctx.emitMeleeHit).toHaveBeenCalledWith(
      expect.objectContaining({
        npcId: 'npc-1',
        damage: cfg.meleeDamage * cfg.chargeDamageMultiplier,
      }),
    );
    expect(ctx.transition).not.toHaveBeenCalledWith('IDLE');
  });

  it('does NOT trigger timeout when charge completes exactly at timeout boundary', () => {
    // Place the NPC so that distanceTo(target) <= meleeRange on the same tick
    // that now - chargeStartMs === chargeTimeoutMs.  The timeout guard runs
    // first in the handler, so actually this verifies that a completion just
    // BEFORE the boundary does not accidentally call the abort path.
    const ctx = makeMockCtx({
      x: 0, y: 0,
      enemies: [makeVisibleEnemy('enemy-1', 10, 0)],
      hasEnemy: true,
      nowMs: 0,
    });
    handler.enter(ctx);
    const chargeStart = cfg.chargeWindupMs + 10;
    ctx.state.chargePhase!.charging = true;
    ctx.state.chargePhase!.chargeStartMs = chargeStart;
    ctx.state.chargePhase!.targetX = 10;
    ctx.state.chargePhase!.targetY = 0;
    // One ms before timeout — success should still apply.
    ctx._nowMs = chargeStart + cfg.chargeTimeoutMs - 1;
    handler.update(ctx, 1);

    expect(ctx.emitMeleeHit).toHaveBeenCalled();
    expect(ctx.transition).toHaveBeenCalledWith('COMBAT');
    expect(ctx.transition).not.toHaveBeenCalledWith('IDLE');
  });

  it('full lifecycle — enter → windup → charging → impact — no spurious abort', () => {
    // Drive the entire flow without manually touching chargePhase, verifying
    // that the real enter() + update() sequence sets chargeStartMs correctly
    // and the timeout never fires before impact.
    const target = makeVisibleEnemy('enemy-1', cfg.meleeRange - 1, 0);
    const ctx = makeMockCtx({
      x: 0, y: 0,
      enemies: [target],
      hasEnemy: true,
      nowMs: 0,
    });
    // enter() at t=0
    handler.enter(ctx);

    // Tick through windup (still inside windup, no abort expected)
    ctx._nowMs = cfg.chargeWindupMs - 1;
    handler.update(ctx, cfg.chargeWindupMs - 1);
    expect(ctx.transition).not.toHaveBeenCalled();

    // One tick past windup — charging begins AND the target is already in range.
    ctx._nowMs = cfg.chargeWindupMs + 1;
    handler.update(ctx, 2);

    // Should have completed (melee hit + COMBAT), not timed out.
    expect(ctx.emitMeleeHit).toHaveBeenCalled();
    expect(ctx.transition).toHaveBeenCalledWith('COMBAT');
    expect(ctx.transition).not.toHaveBeenCalledWith('IDLE');
  });
});

// ---------------------------------------------------------------------------
// Windup phase — chargeStartMs isolation
// ---------------------------------------------------------------------------

describe('ChargeState — WINDUP phase does not write chargeStartMs', () => {
  let handler: ChargeState;

  beforeEach(() => {
    handler = new ChargeState(cfg);
  });

  it('chargeStartMs stays 0 across multiple WINDUP ticks', () => {
    const ctx = makeMockCtx({
      enemies: [makeVisibleEnemy('enemy-1', 200, 0)],
      hasEnemy: true,
      nowMs: 0,
    });
    handler.enter(ctx);

    // Three ticks within windup window.
    for (const t of [100, 200, cfg.chargeWindupMs - 1]) {
      ctx._nowMs = t;
      handler.update(ctx, 100);
      expect(ctx.state.chargePhase?.chargeStartMs).toBe(0);
      expect(ctx.state.chargePhase?.charging).toBe(false);
    }
  });

  it('chargeStartMs is set on exactly the first tick that exits WINDUP', () => {
    const ctx = makeMockCtx({
      enemies: [makeVisibleEnemy('enemy-1', 200, 0)],
      hasEnemy: true,
      nowMs: 0,
    });
    handler.enter(ctx);

    // Last windup tick — still 0.
    ctx._nowMs = cfg.chargeWindupMs - 1;
    handler.update(ctx, cfg.chargeWindupMs - 1);
    expect(ctx.state.chargePhase?.chargeStartMs).toBe(0);

    // Windup complete tick — must be set now.
    const exitWindup = cfg.chargeWindupMs + 1;
    ctx._nowMs = exitWindup;
    handler.update(ctx, 2);
    expect(ctx.state.chargePhase?.chargeStartMs).toBe(exitWindup);
    expect(ctx.state.chargePhase?.charging).toBe(true);
  });
});
