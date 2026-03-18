// states/handlers/CampState.test.ts
// Unit tests for the restricted-zone escape fix in CampState.
//
// The fix (same pattern as IdleState):
//   When the NPC is inside a restricted zone, CampState now:
//     - calls moveToward() toward the first accessible candidate point
//     - does NOT write lastKnownEnemyX/Y (would broadcast a false enemy position)
//     - transitions via campOnDanger (immediate — no delay for danger zones)
//
// Transitions verified:
//   - campOnDanger fires on restricted-zone escape (default target: 'ALERT')
//   - campOnEnemy fires after schemeReactionDelayMs when a real enemy is visible

import { describe, it, expect, beforeEach } from 'vitest';
import { createDefaultNPCOnlineState } from '../NPCOnlineState';
import { createDefaultStateConfig } from '../IStateConfig';
import type { INPCContext } from '../INPCContext';
import type { INPCOnlineState } from '../INPCOnlineState';
import type { IStateConfig } from '../IStateConfig';
import { CampState } from './CampState';

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
  /** Whether perception returns visible enemies. Default: false. */
  hasVisibleEnemy?: boolean;
  /** List of enemies returned by getVisibleEnemies(). Default: []. */
  visibleEnemies?: Array<{ id: string; x: number; y: number; factionId: string }>;
}

function makeMockCtx(overrides: MockCtxOptions = {}) {
  const calls: string[] = [];
  const state: INPCOnlineState = createDefaultNPCOnlineState();
  let nowMs = overrides.nowMs ?? 0;

  const accessible = overrides.restrictedZoneAccessible ?? true;
  const visibleEnemies = overrides.visibleEnemies ?? [];
  const hasVisibleEnemy = overrides.hasVisibleEnemy ?? false;

  const ctx: INPCContext = {
    npcId: 'npc-camp-1',
    factionId: 'stalker',
    entityType: 'human',
    x: overrides.x ?? 100,
    y: overrides.y ?? 100,
    state,
    currentStateId: 'CAMP',
    perception: {
      getVisibleEnemies: () => visibleEnemies,
      getVisibleAllies:  () => [],
      getNearbyItems:    () => [],
      hasVisibleEnemy:   () => hasVisibleEnemy,
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

/** Build the four cardinal candidates CampState generates for step = approachSpeed * 2. */
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

describe('CampState — restricted zone escape fix', () => {
  let cfg: IStateConfig;
  let handler: CampState;

  beforeEach(() => {
    cfg     = createDefaultStateConfig();
    handler = new CampState(cfg);
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
      const customHandler = new CampState(customCfg);
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

  // ── campOnDanger transition fires on zone escape ───────────────────────────

  describe('campOnDanger transition fires immediately on zone escape', () => {
    it('emits transition:ALERT (default campOnDanger) when NPC escapes a restricted zone', () => {
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

    it('uses a custom campOnDanger override when provided', () => {
      const customHandler = new CampState(cfg, { campOnDanger: 'PATROL' });
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

    it('fires campOnDanger even when filterAccessible returns empty (no safe exit)', () => {
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

    it('does NOT fire campOnDanger when the zone is accessible', () => {
      const { ctx, calls } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: true,
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('does NOT fire campOnDanger when restrictedZones is null', () => {
      const { ctx, calls } = makeMockCtx({ hasRestrictedZone: false });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });
  });

  // ── campOnEnemy transition fires for real enemies ─────────────────────────

  describe('campOnEnemy transition fires after delay when a real enemy is visible', () => {
    it('queues a delayed reaction but does NOT transition immediately on enemy detection', () => {
      const nowMs = 0;
      const { ctx, calls, setNow } = makeMockCtx({
        hasVisibleEnemy: true,
        visibleEnemies: [{ id: 'e1', x: 200, y: 200, factionId: 'bandits' }],
        nowMs,
      });
      handler.enter(ctx);
      // Update at t=0 — delay has NOT elapsed yet.
      setNow(0);
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('emits campOnEnemy (COMBAT) after schemeReactionDelayMs elapses', () => {
      // Start at t=1000 so the queued timestamp is non-zero and the pending-reaction
      // guard (`reactionStart !== NO_PENDING_REACTION`) is satisfied on the second update.
      const baseMs = 1000;
      const { ctx, calls, setNow } = makeMockCtx({
        hasVisibleEnemy: true,
        visibleEnemies: [{ id: 'e1', x: 200, y: 200, factionId: 'bandits' }],
        nowMs: baseMs,
      });
      handler.enter(ctx);
      // First update at baseMs queues the delayed reaction (evadeStartMs = baseMs).
      handler.update(ctx, 16);
      // Advance past the delay.
      setNow(baseMs + cfg.schemeReactionDelayMs + 1);
      handler.update(ctx, 16);
      expect(calls).toContain('transition:COMBAT');
    });

    it('records the enemy position in lastKnownEnemyX/Y when a real enemy is visible', () => {
      const { ctx, state } = makeMockCtx({
        hasVisibleEnemy: true,
        visibleEnemies: [{ id: 'e1', x: 200, y: 300, factionId: 'bandits' }],
        nowMs: 0,
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(state.lastKnownEnemyX).toBe(200);
      expect(state.lastKnownEnemyY).toBe(300);
    });

    it('does NOT fire campOnDanger when a real enemy is detected — enemy check runs first', () => {
      // Both a visible enemy and a restricted zone are present.
      // The enemy check runs before the zone check, so campOnDanger must not fire.
      const { ctx, calls, setNow } = makeMockCtx({
        hasVisibleEnemy: true,
        visibleEnemies: [{ id: 'e1', x: 200, y: 200, factionId: 'bandits' }],
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [{ x: 400, y: 100 }],
        nowMs: 0,
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      // Only the enemy-queue branch fires; zone branch is bypassed.
      expect(calls).not.toContain('transition:ALERT');
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('restrictedZones null → no zone logic, no vel, no campOnDanger transition', () => {
      const { ctx, calls } = makeMockCtx({ hasRestrictedZone: false });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(false);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('zone accessible → no zone-exit movement, no campOnDanger transition', () => {
      const { ctx, calls } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: true,
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(false);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('in restricted zone with no safe exit → no vel, but campOnDanger still fires', () => {
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

    it('enter() halts the NPC and resets the reaction timer', () => {
      const { ctx, calls, state } = makeMockCtx();
      state.evadeStartMs = 99999;
      handler.enter(ctx);
      expect(calls).toContain('halt');
      expect(state.evadeStartMs).toBe(0);
    });

    it('exit() clears evadeStartMs and isAlert so they do not leak to the next activation', () => {
      const { ctx, state } = makeMockCtx();
      state.evadeStartMs = 12345;
      state.isAlert = true;
      handler.exit(ctx);
      expect(state.evadeStartMs).toBe(0);
      expect(state.isAlert).toBe(false);
    });
  });
});
