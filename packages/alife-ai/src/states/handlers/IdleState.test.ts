// states/handlers/IdleState.test.ts
// Focused unit tests for the restricted-zone exit fix in IdleState.
//
// The fix (replacing the old ALERT transition):
//   When the NPC is inside a restricted zone, IdleState now:
//     - calls moveToward() toward the first accessible candidate point
//     - does NOT write lastKnownEnemyX/Y (false enemy-position broadcast)
//     - does NOT call ctx.transition() (stays in IDLE)
//   A `return` after moveToward prevents any further update logic from running.
//
// Also contains tests for the corpse-suspicion deduplication fix:
//   IdleState.seenCorpseIds (Set<string> | undefined) tracks which corpse IDs
//   have already contributed suspicion during the current IDLE entry.
//   enter() clears the Set (sets it to undefined) so re-entries start fresh.

import { describe, it, expect, beforeEach } from 'vitest';
import { createDefaultNPCOnlineState } from '../NPCOnlineState';
import { createDefaultStateConfig } from '../IStateConfig';
import type { INPCContext } from '../INPCContext';
import type { INPCOnlineState } from '../INPCOnlineState';
import type { IStateConfig } from '../IStateConfig';
import { IdleState } from './IdleState';

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
}

function makeMockCtx(overrides: MockCtxOptions = {}) {
  const calls: string[] = [];
  const state: INPCOnlineState = createDefaultNPCOnlineState();
  let nowMs = overrides.nowMs ?? 0;

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
      getVisibleEnemies: () => [],
      getVisibleAllies:  () => [],
      getNearbyItems:    () => [],
      hasVisibleEnemy:   () => false,
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

/** Advance time past the zone-check interval so the throttle allows a check. */
function advancePastInterval(setNow: (ms: number) => void, cfg: IStateConfig, base = 0) {
  setNow(base + cfg.restrictedZoneCheckIntervalMs + 1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build the four cardinal candidates IdleState generates for step = approachSpeed * 2. */
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

describe('IdleState — restricted zone exit fix', () => {
  let cfg: IStateConfig;
  let handler: IdleState;

  beforeEach(() => {
    cfg     = createDefaultStateConfig();
    handler = new IdleState(cfg);
  });

  // ── lastKnownEnemyX/Y preservation ───────────────────────────────────────

  describe('lastKnownEnemyX/Y not modified during zone exit', () => {
    it('leaves lastKnownEnemyX unchanged when NPC is in a restricted zone', () => {
      const { ctx, state, setNow } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [{ x: 400, y: 100 }],
        nowMs: 0,
      });
      state.lastKnownEnemyX = 999;
      handler.enter(ctx);
      advancePastInterval(setNow, cfg);
      handler.update(ctx, 16);
      expect(state.lastKnownEnemyX).toBe(999);
    });

    it('leaves lastKnownEnemyY unchanged when NPC is in a restricted zone', () => {
      const { ctx, state, setNow } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [{ x: 400, y: 100 }],
        nowMs: 0,
      });
      state.lastKnownEnemyY = 777;
      handler.enter(ctx);
      advancePastInterval(setNow, cfg);
      handler.update(ctx, 16);
      expect(state.lastKnownEnemyY).toBe(777);
    });

    it('preserves lastKnownEnemyX/Y == 0 defaults without overwriting them', () => {
      const { ctx, state, setNow } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [{ x: 400, y: 100 }],
        nowMs: 0,
      });
      // defaults are 0 from createDefaultNPCOnlineState
      handler.enter(ctx);
      advancePastInterval(setNow, cfg);
      handler.update(ctx, 16);
      expect(state.lastKnownEnemyX).toBe(0);
      expect(state.lastKnownEnemyY).toBe(0);
    });

    it('does not overwrite lastKnownEnemyX/Y with the safe-exit coordinates', () => {
      const safeExit = { x: 400, y: 250 };
      const { ctx, state, setNow } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [safeExit],
        x: 100, y: 100,
        nowMs: 0,
      });
      state.lastKnownEnemyX = 500;
      state.lastKnownEnemyY = 600;
      handler.enter(ctx);
      advancePastInterval(setNow, cfg);
      handler.update(ctx, 16);
      // Coordinates must not be replaced with the safe-exit point
      expect(state.lastKnownEnemyX).not.toBe(safeExit.x);
      expect(state.lastKnownEnemyY).not.toBe(safeExit.y);
      // And must still hold their original values
      expect(state.lastKnownEnemyX).toBe(500);
      expect(state.lastKnownEnemyY).toBe(600);
    });
  });

  // ── No idleOnEnemy transition ─────────────────────────────────────────────

  describe('idleOnEnemy transition NOT called during zone exit', () => {
    it('does not emit any transition when NPC escapes a restricted zone', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [{ x: 400, y: 100 }],
        nowMs: 0,
      });
      handler.enter(ctx);
      advancePastInterval(setNow, cfg);
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('does not emit transition:ALERT (the old idleOnEnemy default) during zone exit', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [{ x: 400, y: 100 }],
        nowMs: 0,
      });
      handler.enter(ctx);
      advancePastInterval(setNow, cfg);
      handler.update(ctx, 16);
      expect(calls).not.toContain('transition:ALERT');
    });

    it('does not emit any custom idleOnEnemy override during zone exit', () => {
      const customHandler = new IdleState(cfg, { idleOnEnemy: 'COMBAT' });
      const { ctx, calls, setNow } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [{ x: 400, y: 100 }],
        nowMs: 0,
      });
      customHandler.enter(ctx);
      advancePastInterval(setNow, cfg);
      customHandler.update(ctx, 16);
      expect(calls).not.toContain('transition:COMBAT');
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('still emits idleOnEnemy (ALERT) when a real enemy is visible — not confused with zone exit', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        nowMs: 0,
      });
      // Inject a visible enemy into perception — should still trigger the transition
      (ctx as unknown as Record<string, unknown>).perception = {
        getVisibleEnemies: () => [{ id: 'e1', x: 200, y: 200, factionId: 'bandits' }],
        getVisibleAllies:  () => [],
        getNearbyItems:    () => [],
        hasVisibleEnemy:   () => true,
      };
      handler.enter(ctx);
      advancePastInterval(setNow, cfg);
      handler.update(ctx, 16);
      // Enemy detection fires BEFORE the zone check, so ALERT is expected here
      expect(calls).toContain('transition:ALERT');
    });
  });

  // ── moveToward IS called toward the safe exit ─────────────────────────────

  describe('moveToward called toward the first accessible candidate', () => {
    it('calls setVelocity (moveToward output) when a safe exit exists', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [{ x: 400, y: 100 }],
        x: 100, y: 100,
        nowMs: 0,
      });
      handler.enter(ctx);
      advancePastInterval(setNow, cfg);
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(true);
    });

    it('velocity is directed toward the safe-exit x coordinate (positive vx when exit is to the right)', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        // safe exit is to the right of NPC (x=100)
        filterAccessibleResult: [{ x: 400, y: 100 }],
        x: 100, y: 100,
        nowMs: 0,
      });
      handler.enter(ctx);
      advancePastInterval(setNow, cfg);
      handler.update(ctx, 16);
      const velCall = calls.find(c => c.startsWith('vel:'));
      expect(velCall).toBeDefined();
      const [vx] = velCall!.slice(4).split(',').map(Number);
      expect(vx).toBeGreaterThan(0);
    });

    it('velocity is directed toward the safe-exit y coordinate (positive vy when exit is below)', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        // safe exit is directly below NPC (y=100)
        filterAccessibleResult: [{ x: 100, y: 400 }],
        x: 100, y: 100,
        nowMs: 0,
      });
      handler.enter(ctx);
      advancePastInterval(setNow, cfg);
      handler.update(ctx, 16);
      const velCall = calls.find(c => c.startsWith('vel:'));
      expect(velCall).toBeDefined();
      const [, vy] = velCall!.slice(4).split(',').map(Number);
      expect(vy).toBeGreaterThan(0);
    });

    it('uses the first accessible candidate from filterAccessible, not the second', () => {
      // Two candidates: first is to the right, second is to the left.
      // The NPC should move right (positive vx).
      const { ctx, calls, setNow } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [
          { x: 400, y: 100 }, // first — right
          { x: -200, y: 100 }, // second — left
        ],
        x: 100, y: 100,
        nowMs: 0,
      });
      handler.enter(ctx);
      advancePastInterval(setNow, cfg);
      handler.update(ctx, 16);
      const velCall = calls.find(c => c.startsWith('vel:'));
      expect(velCall).toBeDefined();
      const [vx] = velCall!.slice(4).split(',').map(Number);
      // movement toward first candidate (right) → positive vx
      expect(vx).toBeGreaterThan(0);
    });

    it('generates candidates at distance approachSpeed * 2 from NPC position', () => {
      const step = cfg.approachSpeed * 2;
      const npcX = 100;
      const npcY = 100;
      const capturedPoints: Array<{ x: number; y: number }> = [];

      const { ctx, setNow } = makeMockCtx({ x: npcX, y: npcY, nowMs: 0 });
      (ctx as unknown as Record<string, unknown>).restrictedZones = {
        isAccessible: () => false,
        filterAccessible: (pts: ReadonlyArray<{ x: number; y: number }>) => {
          capturedPoints.push(...pts);
          return [pts[0]]; // return first so moveToward is called
        },
      };
      handler.enter(ctx);
      advancePastInterval(setNow, cfg);
      handler.update(ctx, 16);

      const expected = expectedCandidates(npcX, npcY, cfg.approachSpeed);
      expect(capturedPoints).toHaveLength(4);
      expect(capturedPoints).toEqual(expected);
      expect(step).toBe(cfg.approachSpeed * 2);
    });

    it('does NOT call setVelocity when filterAccessible returns no safe point', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [], // no safe exit found
        nowMs: 0,
      });
      handler.enter(ctx);
      advancePastInterval(setNow, cfg);
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(false);
    });

    it('speed passed to moveToward equals cfg.approachSpeed', () => {
      const customCfg = createDefaultStateConfig({ approachSpeed: 80 });
      const customHandler = new IdleState(customCfg);
      const npcX = 100;
      const npcY = 100;
      // Place the safe exit exactly along the +X axis so velocity is (speed, 0)
      const safeExit = { x: npcX + 1000, y: npcY };
      const { ctx, calls, setNow } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [safeExit],
        x: npcX, y: npcY,
        nowMs: 0,
      });
      customHandler.enter(ctx);
      advancePastInterval(setNow, customCfg);
      customHandler.update(ctx, 16);
      const velCall = calls.find(c => c.startsWith('vel:'));
      expect(velCall).toBeDefined();
      const [vx] = velCall!.slice(4).split(',').map(Number);
      // Horizontal-only movement: vx should equal approachSpeed (normalised direction is (1,0))
      expect(vx).toBeCloseTo(customCfg.approachSpeed, 5);
    });
  });

  // ── NPC stays in IDLE ─────────────────────────────────────────────────────

  describe('NPC stays in IDLE during zone escape', () => {
    it('no state transition is emitted during zone escape — NPC stays in IDLE', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [{ x: 400, y: 100 }],
        nowMs: 0,
      });
      handler.enter(ctx);
      advancePastInterval(setNow, cfg);
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('update returns early after zone exit — suspicion check does not fire during same tick', () => {
      let suspicionChecked = false;
      const { ctx, calls, setNow } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [{ x: 400, y: 100 }],
        nowMs: 0,
      });
      (ctx as unknown as Record<string, unknown>).suspicion = {
        hasReachedAlert: () => { suspicionChecked = true; return true; },
        getLastKnownPosition: () => ({ x: 200, y: 200 }),
        clear: () => {},
        clearPosition: () => {},
        getLevel: () => 0.9,
        add: () => {},
      };
      handler.enter(ctx);
      advancePastInterval(setNow, cfg);
      handler.update(ctx, 16);
      // Zone-exit path returns early → suspicion block is unreachable this tick
      expect(suspicionChecked).toBe(false);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('update returns early after zone exit — condition check does not fire during same tick', () => {
      let conditionChecked = false;
      const { ctx, calls, setNow } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [{ x: 400, y: 100 }],
        nowMs: 0,
      });
      (ctx as unknown as Record<string, unknown>).conditions = {
        getLevel: () => 0.9,
        apply: () => {},
        hasCondition: () => { conditionChecked = true; return true; },
      };
      handler.enter(ctx);
      advancePastInterval(setNow, cfg);
      handler.update(ctx, 16);
      expect(conditionChecked).toBe(false);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('re-checks the zone on every elapsed interval while NPC is still inside', () => {
      let checkCount = 0;
      const { ctx, calls, setNow } = makeMockCtx({ x: 100, y: 100, nowMs: 0 });
      (ctx as unknown as Record<string, unknown>).restrictedZones = {
        isAccessible: (_x: number, _y: number) => {
          checkCount++;
          return false;
        },
        filterAccessible: (pts: ReadonlyArray<{ x: number; y: number }>) => [pts[0]],
      };

      handler.enter(ctx);

      // First interval
      setNow(cfg.restrictedZoneCheckIntervalMs + 1);
      handler.update(ctx, 16);
      const firstCheckCount = checkCount;

      // Second interval
      setNow(cfg.restrictedZoneCheckIntervalMs * 2 + 2);
      handler.update(ctx, 16);

      expect(checkCount).toBeGreaterThan(firstCheckCount);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('returns to normal idle behaviour once NPC clears the zone (no vel on accessible)', () => {
      // Start in zone, escape after first interval, confirm no vel on second check
      let inZone = true;
      const { ctx, calls, setNow } = makeMockCtx({ x: 100, y: 100, nowMs: 0 });
      (ctx as unknown as Record<string, unknown>).restrictedZones = {
        isAccessible: () => !inZone,
        filterAccessible: (pts: ReadonlyArray<{ x: number; y: number }>) =>
          inZone ? [] : [...pts],
      };

      handler.enter(ctx);
      setNow(cfg.restrictedZoneCheckIntervalMs + 1);
      handler.update(ctx, 16); // stuck, no safe exit → no vel
      calls.length = 0;

      // NPC has moved out of the zone
      inZone = false;
      setNow(cfg.restrictedZoneCheckIntervalMs * 2 + 2);
      handler.update(ctx, 16);
      // Accessible now → zone-exit branch is skipped → no movement command
      expect(calls.some(c => c.startsWith('vel:'))).toBe(false);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });
  });

  // ── Throttle / timing interactions ────────────────────────────────────────

  describe('zone check throttle', () => {
    it('does not call moveToward before restrictedZoneCheckIntervalMs elapses', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [{ x: 400, y: 100 }],
        nowMs: 0,
      });
      handler.enter(ctx);
      // Advance by less than the interval — the timer was seeded for immediate fire
      // on the FIRST update. To test throttle blocking we need to reset the timer
      // by running the first check and then verify the second is blocked.

      // First check at t=interval+1 → zone-exit fires, timer resets to now
      setNow(cfg.restrictedZoneCheckIntervalMs + 1);
      handler.update(ctx, 16);
      calls.length = 0;

      // Second check well within the interval — throttled
      setNow(cfg.restrictedZoneCheckIntervalMs + 2);
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(false);
    });

    it('fires zone-exit movement again after second full interval elapses', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [{ x: 400, y: 100 }],
        nowMs: 0,
      });
      handler.enter(ctx);

      // First check
      setNow(cfg.restrictedZoneCheckIntervalMs + 1);
      handler.update(ctx, 16);
      calls.length = 0;

      // Second check after another full interval
      setNow(cfg.restrictedZoneCheckIntervalMs * 2 + 2);
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(true);
    });

    it('enter() seeds the timer so zone-exit fires on the very first update tick', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [{ x: 400, y: 100 }],
        nowMs: 0,
      });
      handler.enter(ctx);
      // Do NOT advance time — timer seeded for immediate fire
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(true);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('restrictedZones null → no zone logic at all, no vel, no transition', () => {
      const { ctx, calls } = makeMockCtx({ hasRestrictedZone: false });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(false);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('zone accessible → no zone-exit movement, no transition', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: true,
        nowMs: 0,
      });
      handler.enter(ctx);
      advancePastInterval(setNow, cfg);
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(false);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('in restricted zone but filterAccessible returns empty → no vel, no transition', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [],
        nowMs: 0,
      });
      handler.enter(ctx);
      advancePastInterval(setNow, cfg);
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(false);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('lastKnownEnemyX/Y unchanged when filterAccessible returns empty (no exit found)', () => {
      const { ctx, state, setNow } = makeMockCtx({
        hasRestrictedZone: true,
        restrictedZoneAccessible: false,
        filterAccessibleResult: [],
        nowMs: 0,
      });
      state.lastKnownEnemyX = 42;
      state.lastKnownEnemyY = 43;
      handler.enter(ctx);
      advancePastInterval(setNow, cfg);
      handler.update(ctx, 16);
      expect(state.lastKnownEnemyX).toBe(42);
      expect(state.lastKnownEnemyY).toBe(43);
    });
  });
});

// ---------------------------------------------------------------------------
// Corpse suspicion deduplication
// ---------------------------------------------------------------------------
//
// The fix: INPCOnlineState.seenCorpseIds (Set<string> | undefined) tracks which
// corpse IDs have already contributed suspicion during the current IDLE entry.
// enter() clears the Set (sets it to undefined) so re-entries start fresh.
//
// Invariants tested:
//   1. First frame with a corpse → suspicion.add IS called
//   2. Second frame, same corpse ID → suspicion.add is NOT called (deduped)
//   3. Different corpse ID in a subsequent frame → suspicion.add IS called
//   4. Re-entering IDLE via enter() → same corpse triggers suspicion again
//   5. seenCorpseIds is undefined before the first corpse is seen (lazy init)
//   6. Multiple corpses in one frame → each triggers exactly one suspicion.add

type Corpse = { id: string; x: number; y: number };

interface CorpseMockCtxOptions {
  x?: number;
  y?: number;
  /** Corpses returned by perception.getVisibleCorpses(). Default: []. */
  corpses?: Corpse[];
}

function makeCorpseMockCtx(overrides: CorpseMockCtxOptions = {}) {
  const calls: string[] = [];
  const addCalls: Array<[string, number, number | undefined, number | undefined]> = [];
  const state: INPCOnlineState = createDefaultNPCOnlineState();

  let corpses: Corpse[] = overrides.corpses ?? [];

  const ctx: INPCContext = {
    npcId:    'npc-idle-corpse-1',
    factionId: 'stalker',
    entityType: 'human',
    x: overrides.x ?? 100,
    y: overrides.y ?? 100,
    state,
    currentStateId: 'IDLE',
    perception: {
      getVisibleEnemies:  () => [],
      getVisibleAllies:   () => [],
      getNearbyItems:     () => [],
      hasVisibleEnemy:    () => false,
      getWoundedAllies:   () => [],
      getVisibleCorpses:  () => corpses,
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
    squad: null, pack: null, conditions: null,
    suspicion: {
      getLevel:             () => 0,
      hasReachedAlert:      () => false,
      getLastKnownPosition: () => null,
      clearPosition:        () => {},
      clear:                () => {},
      add: (stimulus, amount, x?, y?) => {
        addCalls.push([stimulus, amount, x, y]);
      },
    },
    now:    () => 0,
    random: () => 0.5,
  };

  return {
    ctx,
    calls,
    /** All recorded suspicion.add() invocations as [stimulus, amount, x, y]. */
    addCalls,
    state,
    setCorpses: (c: Corpse[]) => { corpses = c; },
  };
}

describe('IdleState — corpse suspicion deduplication', () => {
  let cfg: IStateConfig;
  let handler: IdleState;

  beforeEach(() => {
    cfg     = createDefaultStateConfig();
    handler = new IdleState(cfg);
  });

  // ── 1. First frame with a corpse → suspicion.add IS called ────────────────

  describe('first-frame corpse', () => {
    it('calls suspicion.add once when a corpse is seen for the first time', () => {
      const { ctx, addCalls } = makeCorpseMockCtx({
        corpses: [{ id: 'corpse-1', x: 200, y: 200 }],
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(addCalls).toHaveLength(1);
    });

    it('uses BODY_FOUND stimulus when calling suspicion.add', () => {
      const { ctx, addCalls } = makeCorpseMockCtx({
        corpses: [{ id: 'corpse-1', x: 200, y: 200 }],
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(addCalls[0][0]).toBe('body_found');
    });

    it('passes the corpse world position to suspicion.add', () => {
      const { ctx, addCalls } = makeCorpseMockCtx({
        corpses: [{ id: 'corpse-1', x: 333, y: 444 }],
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(addCalls[0][2]).toBe(333);
      expect(addCalls[0][3]).toBe(444);
    });

    it('passes cfg.corpseFoundSuspicion as the amount', () => {
      const { ctx, addCalls } = makeCorpseMockCtx({
        corpses: [{ id: 'corpse-1', x: 200, y: 200 }],
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(addCalls[0][1]).toBe(cfg.corpseFoundSuspicion);
    });
  });

  // ── 2. Second frame, same corpse → suspicion.add is NOT called ────────────

  describe('same-corpse deduplication across frames', () => {
    it('does not call suspicion.add on the second update with the same corpse', () => {
      const { ctx, addCalls } = makeCorpseMockCtx({
        corpses: [{ id: 'corpse-1', x: 200, y: 200 }],
      });
      handler.enter(ctx);
      handler.update(ctx, 16); // first frame — registered
      const countAfterFirstFrame = addCalls.length;
      handler.update(ctx, 16); // second frame — should be deduplicated
      expect(addCalls.length).toBe(countAfterFirstFrame);
    });

    it('does not call suspicion.add across many subsequent frames for the same corpse', () => {
      const { ctx, addCalls } = makeCorpseMockCtx({
        corpses: [{ id: 'corpse-1', x: 200, y: 200 }],
      });
      handler.enter(ctx);
      for (let i = 0; i < 10; i++) {
        handler.update(ctx, 16);
      }
      // Only the very first update should have fired suspicion.add
      expect(addCalls).toHaveLength(1);
    });

    it('records the corpse id in seenCorpseIds after first frame', () => {
      const { ctx, state } = makeCorpseMockCtx({
        corpses: [{ id: 'corpse-42', x: 200, y: 200 }],
      });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(state.seenCorpseIds?.has('corpse-42')).toBe(true);
    });
  });

  // ── 3. Different corpse ID → suspicion.add IS called ─────────────────────

  describe('different corpse triggers additional suspicion', () => {
    it('calls suspicion.add for a second distinct corpse even after the first was processed', () => {
      const corpse1: Corpse = { id: 'corpse-A', x: 100, y: 100 };
      const corpse2: Corpse = { id: 'corpse-B', x: 300, y: 300 };
      const { ctx, addCalls, setCorpses } = makeCorpseMockCtx({ corpses: [corpse1] });

      handler.enter(ctx);
      handler.update(ctx, 16); // frame 1 — corpse-A registered
      setCorpses([corpse2]);
      handler.update(ctx, 16); // frame 2 — corpse-B is new
      expect(addCalls).toHaveLength(2);
    });

    it('adds corpse-B with its own world position, not corpse-A position', () => {
      const corpse1: Corpse = { id: 'corpse-A', x: 111, y: 111 };
      const corpse2: Corpse = { id: 'corpse-B', x: 999, y: 888 };
      const { ctx, addCalls, setCorpses } = makeCorpseMockCtx({ corpses: [corpse1] });

      handler.enter(ctx);
      handler.update(ctx, 16);
      setCorpses([corpse2]);
      handler.update(ctx, 16);
      expect(addCalls[1][2]).toBe(999);
      expect(addCalls[1][3]).toBe(888);
    });

    it('does not re-fire suspicion for corpse-A when corpse-B arrives in the same frame', () => {
      const corpse1: Corpse = { id: 'corpse-A', x: 100, y: 100 };
      const corpse2: Corpse = { id: 'corpse-B', x: 300, y: 300 };
      const { ctx, addCalls, setCorpses } = makeCorpseMockCtx({ corpses: [corpse1] });

      handler.enter(ctx);
      handler.update(ctx, 16); // corpse-A added
      setCorpses([corpse1, corpse2]); // both visible
      handler.update(ctx, 16); // only corpse-B should fire
      expect(addCalls).toHaveLength(2);
      expect(addCalls[1][2]).toBe(corpse2.x);
    });
  });

  // ── 4. Re-entering IDLE — same corpse triggers suspicion again ────────────

  describe('re-entry via enter() resets deduplication', () => {
    it('calls suspicion.add again for a previously-seen corpse after enter() is called', () => {
      const { ctx, addCalls } = makeCorpseMockCtx({
        corpses: [{ id: 'corpse-1', x: 200, y: 200 }],
      });

      // First IDLE entry
      handler.enter(ctx);
      handler.update(ctx, 16); // corpse-1 registered
      expect(addCalls).toHaveLength(1);

      // Simulate leaving and re-entering IDLE (e.g. IDLE→ALERT→IDLE cycle)
      handler.exit(ctx);
      handler.enter(ctx); // seenCorpseIds must be cleared here
      handler.update(ctx, 16); // corpse-1 is new again
      expect(addCalls).toHaveLength(2);
    });

    it('seenCorpseIds is undefined immediately after enter()', () => {
      const { ctx, state } = makeCorpseMockCtx({
        corpses: [{ id: 'corpse-1', x: 200, y: 200 }],
      });

      handler.enter(ctx);
      handler.update(ctx, 16); // populates seenCorpseIds

      // Re-enter — Set should be cleared
      handler.exit(ctx);
      handler.enter(ctx);
      expect(state.seenCorpseIds).toBeUndefined();
    });

    it('fires suspicion.add the correct total number of times across two IDLE entries', () => {
      const { ctx, addCalls } = makeCorpseMockCtx({
        corpses: [{ id: 'corpse-1', x: 200, y: 200 }],
      });

      handler.enter(ctx);
      handler.update(ctx, 16); // +1
      handler.update(ctx, 16); // deduped
      handler.update(ctx, 16); // deduped

      handler.exit(ctx);
      handler.enter(ctx);
      handler.update(ctx, 16); // +1 after reset
      handler.update(ctx, 16); // deduped

      // Total: exactly 2 calls (once per IDLE entry)
      expect(addCalls).toHaveLength(2);
    });
  });

  // ── 5. seenCorpseIds is undefined initially (lazy init) ───────────────────

  describe('seenCorpseIds lazy initialisation', () => {
    it('seenCorpseIds is undefined on a fresh INPCOnlineState before any IDLE entry', () => {
      const state = createDefaultNPCOnlineState();
      expect(state.seenCorpseIds).toBeUndefined();
    });

    it('seenCorpseIds remains undefined after enter() when no corpses have been seen yet', () => {
      const { ctx, state } = makeCorpseMockCtx({ corpses: [] });
      handler.enter(ctx);
      expect(state.seenCorpseIds).toBeUndefined();
    });

    it('seenCorpseIds is undefined after enter() even when a previous IDLE entry populated it', () => {
      const { ctx, state } = makeCorpseMockCtx({
        corpses: [{ id: 'corpse-1', x: 200, y: 200 }],
      });
      handler.enter(ctx);
      handler.update(ctx, 16); // creates and populates seenCorpseIds
      expect(state.seenCorpseIds).toBeDefined();

      handler.exit(ctx);
      handler.enter(ctx); // must clear it back to undefined
      expect(state.seenCorpseIds).toBeUndefined();
    });

    it('seenCorpseIds is created (not undefined) after first corpse is seen in update()', () => {
      const { ctx, state } = makeCorpseMockCtx({
        corpses: [{ id: 'corpse-1', x: 200, y: 200 }],
      });
      handler.enter(ctx);
      expect(state.seenCorpseIds).toBeUndefined(); // before any update
      handler.update(ctx, 16);
      expect(state.seenCorpseIds).toBeInstanceOf(Set);
    });

    it('seenCorpseIds stays undefined across multiple updates when no corpses are visible', () => {
      const { ctx, state } = makeCorpseMockCtx({ corpses: [] });
      handler.enter(ctx);
      handler.update(ctx, 16);
      handler.update(ctx, 16);
      handler.update(ctx, 16);
      expect(state.seenCorpseIds).toBeUndefined();
    });
  });

  // ── 6. Multiple corpses in one frame — each processed exactly once ─────────

  describe('multiple corpses in a single frame', () => {
    it('calls suspicion.add once per unique corpse when multiple corpses are visible simultaneously', () => {
      const corpses: Corpse[] = [
        { id: 'c1', x: 100, y: 100 },
        { id: 'c2', x: 200, y: 200 },
        { id: 'c3', x: 300, y: 300 },
      ];
      const { ctx, addCalls } = makeCorpseMockCtx({ corpses });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(addCalls).toHaveLength(3);
    });

    it('does not double-fire for any corpse when the same multi-corpse list is seen again next frame', () => {
      const corpses: Corpse[] = [
        { id: 'c1', x: 100, y: 100 },
        { id: 'c2', x: 200, y: 200 },
        { id: 'c3', x: 300, y: 300 },
      ];
      const { ctx, addCalls } = makeCorpseMockCtx({ corpses });
      handler.enter(ctx);
      handler.update(ctx, 16); // all 3 registered
      handler.update(ctx, 16); // all 3 deduped
      handler.update(ctx, 16); // all 3 deduped
      expect(addCalls).toHaveLength(3);
    });

    it('all three corpse IDs are stored in seenCorpseIds after one frame', () => {
      const corpses: Corpse[] = [
        { id: 'c1', x: 100, y: 100 },
        { id: 'c2', x: 200, y: 200 },
        { id: 'c3', x: 300, y: 300 },
      ];
      const { ctx, state } = makeCorpseMockCtx({ corpses });
      handler.enter(ctx);
      handler.update(ctx, 16);
      expect(state.seenCorpseIds?.has('c1')).toBe(true);
      expect(state.seenCorpseIds?.has('c2')).toBe(true);
      expect(state.seenCorpseIds?.has('c3')).toBe(true);
    });

    it('fires suspicion.add for the correct positions of each corpse in multi-corpse frame', () => {
      const corpses: Corpse[] = [
        { id: 'cA', x: 111, y: 222 },
        { id: 'cB', x: 333, y: 444 },
      ];
      const { ctx, addCalls } = makeCorpseMockCtx({ corpses });
      handler.enter(ctx);
      handler.update(ctx, 16);
      const positions = addCalls.map(([, , x, y]) => ({ x, y }));
      expect(positions).toContainEqual({ x: 111, y: 222 });
      expect(positions).toContainEqual({ x: 333, y: 444 });
    });

    it('after re-entry, a 4th new corpse added alongside existing 3 fires only once for the new one', () => {
      const initial: Corpse[] = [
        { id: 'c1', x: 100, y: 100 },
        { id: 'c2', x: 200, y: 200 },
        { id: 'c3', x: 300, y: 300 },
      ];
      const { ctx, addCalls, setCorpses } = makeCorpseMockCtx({ corpses: initial });
      handler.enter(ctx);
      handler.update(ctx, 16); // 3 fires

      // Re-enter: all IDs are cleared
      handler.exit(ctx);
      handler.enter(ctx);

      // Now 4 corpses visible: original 3 + a new one
      setCorpses([...initial, { id: 'c4', x: 400, y: 400 }]);
      handler.update(ctx, 16); // 4 fires (reset → all are new)
      expect(addCalls).toHaveLength(7); // 3 + 4
    });
  });

  // ── Additional guards: suspicion null / getVisibleCorpses absent ──────────

  describe('opt-in guards', () => {
    it('does not throw when ctx.suspicion is null', () => {
      const { ctx } = makeCorpseMockCtx({
        corpses: [{ id: 'c1', x: 100, y: 100 }],
      });
      (ctx as unknown as Record<string, unknown>).suspicion = null;
      handler.enter(ctx);
      expect(() => handler.update(ctx, 16)).not.toThrow();
    });

    it('does not throw when perception.getVisibleCorpses is absent', () => {
      const { ctx } = makeCorpseMockCtx();
      (ctx as unknown as Record<string, unknown>).perception = {
        getVisibleEnemies: () => [],
        getVisibleAllies:  () => [],
        getNearbyItems:    () => [],
        hasVisibleEnemy:   () => false,
        getWoundedAllies:  () => [],
        // getVisibleCorpses intentionally omitted
      };
      handler.enter(ctx);
      expect(() => handler.update(ctx, 16)).not.toThrow();
    });

    it('does not call suspicion.add when ctx.suspicion is null, even with visible corpses', () => {
      const { ctx, addCalls } = makeCorpseMockCtx({
        corpses: [{ id: 'c1', x: 100, y: 100 }],
      });
      (ctx as unknown as Record<string, unknown>).suspicion = null;
      handler.enter(ctx);
      handler.update(ctx, 16);
      // addCalls belongs to the mock suspicion which was replaced — confirm no
      // unexpected add reached the original mock (it was replaced; test is about no-throw)
      expect(addCalls).toHaveLength(0);
    });

    it('does not populate seenCorpseIds when ctx.suspicion is null', () => {
      const { ctx, state } = makeCorpseMockCtx({
        corpses: [{ id: 'c1', x: 100, y: 100 }],
      });
      (ctx as unknown as Record<string, unknown>).suspicion = null;
      handler.enter(ctx);
      handler.update(ctx, 16);
      // seenCorpseIds block is guarded by ctx.suspicion — Set must stay undefined
      expect(state.seenCorpseIds).toBeUndefined();
    });
  });
});
