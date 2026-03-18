// states/handlers/SleepState.test.ts
// Unit tests for the restricted-zone escape fix in SleepState.
//
// The fix (same pattern as IdleState / CampState):
//   When the NPC is inside a restricted zone, SleepState now:
//     - calls moveToward() toward the first accessible candidate point
//     - does NOT write lastKnownEnemyX/Y (would broadcast a false enemy position)
//     - transitions via sleepOnEnemy (immediate — no delay for physical danger)
//
// Transitions verified:
//   - sleepOnEnemy fires on restricted-zone escape (default target: 'ALERT')
//   - sleepOnEnemy fires after campSleepReactionDelayMs when a sound/nearby threat
//     is detected via perception

import { describe, it, expect, beforeEach } from 'vitest';
import { createDefaultNPCOnlineState } from '../NPCOnlineState';
import { createDefaultStateConfig } from '../IStateConfig';
import type { INPCContext } from '../INPCContext';
import type { INPCOnlineState } from '../INPCOnlineState';
import type { IStateConfig } from '../IStateConfig';
import { SleepState } from './SleepState';

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

interface MockCtxOptions {
  nowMs?: number;
  x?: number;
  y?: number;
  /** Whether ctx.restrictedZones is wired up at all. */
  hasRestrictedZone?: boolean;
  /**
   * Controls the return value of isAccessible(). When false the NPC is inside
   * a forbidden zone. Default: true.
   */
  restrictedZoneAccessible?: boolean;
  /**
   * Custom list of accessible candidates returned by filterAccessible().
   * When undefined the helper mirrors restrictedZoneAccessible: if accessible
   * it passes through all candidates, otherwise it returns [].
   */
  filterAccessibleResult?: Array<{ x: number; y: number }>;
  /** Whether perception is present at all. Default: true. */
  hasPerception?: boolean;
  /** Enemies returned by getVisibleEnemies(). Default: []. */
  visibleEnemies?: Array<{ id: string; x: number; y: number; factionId: string }>;
}

function makeMockCtx(overrides: MockCtxOptions = {}) {
  const calls: string[] = [];
  const state: INPCOnlineState = createDefaultNPCOnlineState();
  let nowMs = overrides.nowMs ?? 0;

  const accessible = overrides.restrictedZoneAccessible ?? true;
  const visibleEnemies = overrides.visibleEnemies ?? [];
  const hasPerception = overrides.hasPerception ?? true;

  const ctx: INPCContext = {
    npcId: 'npc-sleep-1',
    factionId: 'stalker',
    entityType: 'human',
    x: overrides.x ?? 100,
    y: overrides.y ?? 100,
    state,
    currentStateId: 'SLEEP',
    perception: hasPerception
      ? {
          getVisibleEnemies: () => visibleEnemies,
          getVisibleAllies:  () => [],
          getNearbyItems:    () => [],
          hasVisibleEnemy:   () => visibleEnemies.length > 0,
        }
      : null,
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
    cover: null, danger: null,
    squad: null, pack: null, conditions: null, suspicion: null,
    restrictedZones: overrides.hasRestrictedZone === true
      ? {
          isAccessible: (_x: number, _y: number) => accessible,
          filterAccessible: (pts) => {
            if (overrides.filterAccessibleResult !== undefined) {
              return overrides.filterAccessibleResult;
            }
            return accessible ? [...pts] : [];
          },
        }
      : null,
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

/** Build the four cardinal candidates SleepState generates for step = approachSpeed * 2. */
function expectedCandidates(x: number, y: number, speed: number) {
  const step = speed * 2;
  return [
    { x: x + step, y },
    { x: x - step, y },
    { x,           y: y + step },
    { x,           y: y - step },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SleepState — restricted zone escape fix', () => {
  let cfg: IStateConfig;
  let handler: SleepState;

  beforeEach(() => {
    cfg     = createDefaultStateConfig();
    handler = new SleepState(cfg);
  });

  // ── lastKnownEnemyX/Y not modified ────────────────────────────────────────

  describe('lastKnownEnemyX/Y not modified during zone escape', () => {
    it('leaves lastKnownEnemyX unchanged when NPC is in a restricted zone', () => {
      const { ctx, state } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [{ x: 400, y: 100 }],
      });
      state.lastKnownEnemyX = 999;
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(state.lastKnownEnemyX).toBe(999);
    });

    it('leaves lastKnownEnemyY unchanged when NPC is in a restricted zone', () => {
      const { ctx, state } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [{ x: 400, y: 100 }],
      });
      state.lastKnownEnemyY = 777;
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(state.lastKnownEnemyY).toBe(777);
    });

    it('preserves lastKnownEnemyX/Y == 0 defaults without overwriting them', () => {
      const { ctx, state } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [{ x: 400, y: 100 }],
      });
      // Defaults from createDefaultNPCOnlineState() are 0.
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(state.lastKnownEnemyX).toBe(0);
      expect(state.lastKnownEnemyY).toBe(0);
    });

    it('does not overwrite lastKnownEnemyX/Y with the safe-exit coordinates', () => {
      const safeExit = { x: 400, y: 250 };
      const { ctx, state } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [safeExit],
        x: 100, y: 100,
      });
      state.lastKnownEnemyX = 500;
      state.lastKnownEnemyY = 600;
      handler.enter(ctx);
      handler.update(ctx, 16);
      // Coordinates must not be replaced with the safe-exit point.
      expect(state.lastKnownEnemyX).not.toBe(safeExit.x);
      expect(state.lastKnownEnemyY).not.toBe(safeExit.y);
      // And must still hold their original values.
      expect(state.lastKnownEnemyX).toBe(500);
      expect(state.lastKnownEnemyY).toBe(600);
    });

    it('leaves lastKnownEnemyX/Y unchanged when filterAccessible returns empty (no exit found)', () => {
      const { ctx, state } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [],
      });
      state.lastKnownEnemyX = 42;
      state.lastKnownEnemyY = 43;
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(state.lastKnownEnemyX).toBe(42);
      expect(state.lastKnownEnemyY).toBe(43);
    });
  });

  // ── moveToward called toward safe exit ────────────────────────────────────

  describe('moveToward called toward the first accessible candidate', () => {
    it('calls setVelocity (moveToward output) when a safe exit exists', () => {
      const { ctx, calls } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [{ x: 400, y: 100 }],
        x: 100, y: 100,
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(true);
    });

    it('velocity is directed toward the safe-exit x coordinate (positive vx when exit is to the right)', () => {
      const { ctx, calls } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [{ x: 400, y: 100 }],
        x: 100, y: 100,
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      const velCall = calls.find(c => c.startsWith('vel:'));
      expect(velCall).toBeDefined();
      const [vx] = velCall!.slice(4).split(',').map(Number);
      expect(vx).toBeGreaterThan(0);
    });

    it('velocity is directed toward the safe-exit y coordinate (positive vy when exit is below)', () => {
      const { ctx, calls } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [{ x: 100, y: 400 }],
        x: 100, y: 100,
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      const velCall = calls.find(c => c.startsWith('vel:'));
      expect(velCall).toBeDefined();
      const [, vy] = velCall!.slice(4).split(',').map(Number);
      expect(vy).toBeGreaterThan(0);
    });

    it('uses the first accessible candidate from filterAccessible, not the second', () => {
      // First candidate is to the right, second is to the left — NPC must move right.
      const { ctx, calls } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [
          { x: 400, y: 100 },  // first — right
          { x: -200, y: 100 }, // second — left
        ],
        x: 100, y: 100,
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      const velCall = calls.find(c => c.startsWith('vel:'));
      expect(velCall).toBeDefined();
      const [vx] = velCall!.slice(4).split(',').map(Number);
      expect(vx).toBeGreaterThan(0);
    });

    it('does NOT call setVelocity when filterAccessible returns no safe point', () => {
      const { ctx, calls } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [],
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(false);
    });

    it('speed passed to moveToward equals cfg.approachSpeed', () => {
      const customCfg = createDefaultStateConfig({ approachSpeed: 80 });
      const customHandler = new SleepState(customCfg);
      const npcX = 100;
      const npcY = 100;
      // Safe exit along +X so velocity is (approachSpeed, 0).
      const safeExit = { x: npcX + 1000, y: npcY };
      const { ctx, calls } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [safeExit],
        x: npcX, y: npcY,
      });
      customHandler.enter(ctx);
      customHandler.update(ctx, 16);
      const velCall = calls.find(c => c.startsWith('vel:'));
      expect(velCall).toBeDefined();
      const [vx] = velCall!.slice(4).split(',').map(Number);
      // Direction is (1, 0) — vx must equal approachSpeed.
      expect(vx).toBeCloseTo(customCfg.approachSpeed, 5);
    });

    it('generates candidates at distance approachSpeed * 2 from NPC position', () => {
      const npcX = 100;
      const npcY = 100;
      const capturedPoints: Array<{ x: number; y: number }> = [];

      const { ctx } = makeMockCtx({ x: npcX, y: npcY });
      (ctx as unknown as Record<string, unknown>).restrictedZones = {
        isAccessible: () => false,
        filterAccessible: (pts: ReadonlyArray<{ x: number; y: number }>) => {
          capturedPoints.push(...pts);
          return [pts[0]]; // return first so moveToward is called
        },
      };
      handler.enter(ctx);
      handler.update(ctx, 16);

      const expected = expectedCandidates(npcX, npcY, cfg.approachSpeed);
      expect(capturedPoints).toHaveLength(4);
      expect(capturedPoints).toEqual(expected);
    });
  });

  // ── sleepOnEnemy transition fires on zone escape ──────────────────────────

  describe('sleepOnEnemy transition fires immediately on zone escape', () => {
    it('emits transition:ALERT (default sleepOnEnemy) when NPC escapes a restricted zone', () => {
      const { ctx, calls } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [{ x: 400, y: 100 }],
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(calls).toContain('transition:ALERT');
    });

    it('emits exactly one transition call on zone escape', () => {
      const { ctx, calls } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [{ x: 400, y: 100 }],
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(1);
    });

    it('uses a custom sleepOnEnemy override when provided', () => {
      const customHandler = new SleepState(cfg, { sleepOnEnemy: 'PATROL' });
      const { ctx, calls } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [{ x: 400, y: 100 }],
      });
      customHandler.enter(ctx);
      customHandler.update(ctx, 16);
      expect(calls).toContain('transition:PATROL');
      expect(calls).not.toContain('transition:ALERT');
    });

    it('fires sleepOnEnemy even when filterAccessible returns empty (no safe exit)', () => {
      // No safe exit → moveToward is not called, but the transition still fires.
      const { ctx, calls } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [],
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(calls).toContain('transition:ALERT');
    });

    it('does NOT fire sleepOnEnemy when the zone is accessible', () => {
      const { ctx, calls } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: true,
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('does NOT fire sleepOnEnemy when restrictedZones is null', () => {
      const { ctx, calls } = makeMockCtx({ hasRestrictedZone: false });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });
  });

  // ── sleepOnEnemy transition fires for sound / nearby threats ──────────────

  describe('sleepOnEnemy transition fires after delay for sound/nearby threats', () => {
    it('queues a delayed reaction but does NOT transition immediately on threat detection', () => {
      const { ctx, calls } = makeMockCtx({
        visibleEnemies: [{ id: 'e1', x: 200, y: 200, factionId: 'bandits' }],
        nowMs: 0,
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      // Delay has NOT elapsed yet — no transition.
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('emits sleepOnEnemy (ALERT) after campSleepReactionDelayMs elapses', () => {
      // Start at t=1000 so the queued timestamp is non-zero and the pending-reaction
      // guard (`reactionStart !== NO_PENDING`) is satisfied on the second update.
      const baseMs = 1000;
      const { ctx, calls, setNow } = makeMockCtx({
        visibleEnemies: [{ id: 'e1', x: 200, y: 200, factionId: 'bandits' }],
        nowMs: baseMs,
      });
      handler.enter(ctx);
      // First update at baseMs queues the delayed reaction (woundedStartMs = baseMs).
      handler.update(ctx, 16);
      // Advance past the sleep reaction delay.
      setNow(baseMs + cfg.campSleepReactionDelayMs + 1);
      handler.update(ctx, 16);
      expect(calls).toContain('transition:ALERT');
    });

    it('records the threat position in lastKnownEnemyX/Y on sound detection', () => {
      const { ctx, state } = makeMockCtx({
        visibleEnemies: [{ id: 'e1', x: 200, y: 300, factionId: 'bandits' }],
        nowMs: 0,
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(state.lastKnownEnemyX).toBe(200);
      expect(state.lastKnownEnemyY).toBe(300);
    });

    it('does NOT fire zone-escape sleepOnEnemy when a sound threat is detected — threat check runs first', () => {
      // Both a visible enemy (sound) and a restricted zone are present.
      // The enemy/sound check runs before the zone check, so no immediate zone transition.
      const { ctx, calls } = makeMockCtx({
        visibleEnemies: [{ id: 'e1', x: 200, y: 200, factionId: 'bandits' }],
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [{ x: 400, y: 100 }],
        nowMs: 0,
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      // The perception branch queues the delayed reaction and returns early —
      // the zone branch is unreachable this tick.
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(false);
    });

    it('no threat detected when perception is null — falls through to zone check', () => {
      // With perception null the enemy branch is skipped, so the zone branch runs.
      const { ctx, calls } = makeMockCtx({
        hasPerception: false,
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [{ x: 400, y: 100 }],
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      // Zone branch fires sleepOnEnemy immediately.
      expect(calls).toContain('transition:ALERT');
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('restrictedZones null → no zone logic, no vel, no transition', () => {
      const { ctx, calls } = makeMockCtx({ hasRestrictedZone: false });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(false);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('zone accessible → no zone-exit movement, no transition', () => {
      const { ctx, calls } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: true,
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(false);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('in restricted zone with no safe exit → no vel, but sleepOnEnemy still fires', () => {
      const { ctx, calls } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [],
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(false);
      expect(calls).toContain('transition:ALERT');
    });

    it('enter() halts the NPC, dims alpha to 0.8, and resets sleepReactionStartMs', () => {
      const { ctx, calls, state } = makeMockCtx();
      state.sleepReactionStartMs = 99999;
      handler.enter(ctx);
      expect(calls).toContain('halt');
      expect(calls).toContain('alpha:0.8');
      expect(state.sleepReactionStartMs).toBe(0);
    });

    it('exit() restores alpha to 1 and clears sleepReactionStartMs so it does not leak to the next activation', () => {
      const { ctx, calls, state } = makeMockCtx();
      state.sleepReactionStartMs = 12345;
      handler.exit(ctx);
      expect(calls).toContain('alpha:1');
      expect(state.sleepReactionStartMs).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// SleepState — sleepReactionStartMs fix (does not corrupt woundedStartMs)
// ---------------------------------------------------------------------------

describe('SleepState — sleepReactionStartMs fix: woundedStartMs isolation', () => {
  let cfg: IStateConfig;
  let handler: SleepState;

  beforeEach(() => {
    cfg     = createDefaultStateConfig();
    handler = new SleepState(cfg);
  });

  // ── 1. enter() must not modify woundedStartMs ────────────────────────────

  describe('enter() does not touch woundedStartMs', () => {
    it('leaves woundedStartMs at its prior value after enter()', () => {
      const { ctx, state } = makeMockCtx();
      state.woundedStartMs = 42_000;
      handler.enter(ctx);
      expect(state.woundedStartMs).toBe(42_000);
    });

    it('leaves woundedStartMs at 0 when it was already 0 before enter()', () => {
      const { ctx, state } = makeMockCtx();
      // Default from createDefaultNPCOnlineState() is 0 — enter() must not write it.
      handler.enter(ctx);
      expect(state.woundedStartMs).toBe(0);
    });
  });

  // ── 2. Detecting an enemy must not touch woundedStartMs ──────────────────

  describe('enemy detection does not modify woundedStartMs', () => {
    it('leaves woundedStartMs unchanged when an enemy is detected', () => {
      const sentinel = 55_000;
      const { ctx, state } = makeMockCtx({
        visibleEnemies: [{ id: 'e1', x: 200, y: 200, factionId: 'bandits' }],
        nowMs: 1_000,
      });
      state.woundedStartMs = sentinel;
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(state.woundedStartMs).toBe(sentinel);
    });

    it('woundedStartMs is still unchanged on the update that fires the delayed ALERT', () => {
      const sentinel = 55_000;
      const baseMs   = 1_000;
      const { ctx, state, setNow } = makeMockCtx({
        visibleEnemies: [{ id: 'e1', x: 200, y: 200, factionId: 'bandits' }],
        nowMs: baseMs,
      });
      state.woundedStartMs = sentinel;
      handler.enter(ctx);
      // First update queues the delayed reaction.
      handler.update(ctx, 16);
      // Advance past the sleep reaction delay so the transition fires.
      setNow(baseMs + cfg.campSleepReactionDelayMs + 1);
      handler.update(ctx, 16);
      expect(state.woundedStartMs).toBe(sentinel);
    });
  });

  // ── 3. sleepReactionStartMs IS set when an enemy is detected ─────────────

  describe('sleepReactionStartMs is set on enemy detection', () => {
    it('sets sleepReactionStartMs to ctx.now() when a visible enemy is detected', () => {
      const detectionMs = 3_500;
      const { ctx, state, setNow } = makeMockCtx({
        visibleEnemies: [{ id: 'e1', x: 200, y: 200, factionId: 'bandits' }],
      });
      state.sleepReactionStartMs = 0;
      setNow(detectionMs);
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(state.sleepReactionStartMs).toBe(detectionMs);
    });
  });

  // ── 4. exit() must not modify woundedStartMs ─────────────────────────────

  describe('exit() does not touch woundedStartMs', () => {
    it('leaves woundedStartMs at its prior value after exit()', () => {
      const { ctx, state } = makeMockCtx();
      state.woundedStartMs = 77_777;
      handler.exit(ctx);
      expect(state.woundedStartMs).toBe(77_777);
    });
  });

  // ── 5. exit() resets sleepReactionStartMs to 0 ───────────────────────────

  describe('exit() resets sleepReactionStartMs', () => {
    it('resets sleepReactionStartMs to 0 on exit()', () => {
      const { ctx, state } = makeMockCtx();
      state.sleepReactionStartMs = 8_888;
      handler.exit(ctx);
      expect(state.sleepReactionStartMs).toBe(0);
    });

    it('resets sleepReactionStartMs to 0 on exit() even when it was already 0', () => {
      const { ctx, state } = makeMockCtx();
      state.sleepReactionStartMs = 0;
      handler.exit(ctx);
      expect(state.sleepReactionStartMs).toBe(0);
    });
  });

  // ── 6. Full SLEEP lifecycle preserves a pre-existing woundedStartMs ───────

  describe('pre-existing woundedStartMs survives the full SLEEP lifecycle', () => {
    it('woundedStartMs is unchanged across enter → enemy detection → delayed ALERT → exit', () => {
      const priorWoundedStart = 12_345;
      const baseMs            = 1_000;
      const { ctx, state, setNow } = makeMockCtx({
        visibleEnemies: [{ id: 'e1', x: 200, y: 200, factionId: 'bandits' }],
        nowMs: baseMs,
      });

      // Simulate a value written by WoundedState before the NPC fell asleep.
      state.woundedStartMs = priorWoundedStart;

      // Enter SLEEP.
      handler.enter(ctx);
      expect(state.woundedStartMs).toBe(priorWoundedStart);

      // Enemy detected — queues reaction, must not touch woundedStartMs.
      handler.update(ctx, 16);
      expect(state.woundedStartMs).toBe(priorWoundedStart);

      // Advance past delay so sleepOnEnemy fires.
      setNow(baseMs + cfg.campSleepReactionDelayMs + 1);
      handler.update(ctx, 16);
      expect(state.woundedStartMs).toBe(priorWoundedStart);

      // Exit SLEEP (NPC woke up).
      handler.exit(ctx);
      expect(state.woundedStartMs).toBe(priorWoundedStart);

      // And sleepReactionStartMs must be cleared.
      expect(state.sleepReactionStartMs).toBe(0);
    });
  });
});
