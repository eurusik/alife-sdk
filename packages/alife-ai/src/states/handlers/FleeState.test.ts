// states/handlers/FleeState.test.ts
// Unit tests for the FleeState SHAKEN stuck NPC fix.
//
// Fix under test:
//   When moraleState is 'SHAKEN' and dist >= fleeDistance, the NPC now
//   transitions via this.tr.fleeOnSafe (default: 'PATROL') instead of
//   halting with no transition.  A new fleeOnSafe key was added to
//   IStateTransitionMap with the default value 'PATROL'.
//
// Scenarios covered:
//   1. SHAKEN + far enough (dist >= fleeDistance)  → fleeOnSafe fires
//   2. SHAKEN + not far enough (dist < fleeDistance) → keeps fleeing (no transition)
//   3. STABLE (any distance)                       → fleeOnCalmed fires (existing)
//   4. PANICKED                                    → keeps fleeing regardless of distance
//   5. fleeOnSafe is injectable / overridable
//   6. ctx.halt() is called before the fleeOnSafe transition

import { describe, it, expect, beforeEach } from 'vitest';
import { FleeState } from './FleeState';
import { createDefaultStateConfig } from '../IStateConfig';
import { createDefaultNPCOnlineState } from '../NPCOnlineState';
import type { INPCContext } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

interface MockOverrides {
  /** NPC world position. */
  x?: number;
  y?: number;
  moraleState?: 'STABLE' | 'SHAKEN' | 'PANICKED';
  /** Last known threat position (default 0, 0). */
  lastKnownEnemyX?: number;
  lastKnownEnemyY?: number;
}

/**
 * Build a minimal INPCContext mock that records every call to halt() and
 * transition() in the `calls` array (format: 'halt' | 'transition:<id>').
 * setVelocity calls are recorded as 'vel:<vx>,<vy>' for assertion convenience.
 */
function makeMockCtx(overrides: MockOverrides = {}): {
  ctx: INPCContext;
  calls: string[];
  state: ReturnType<typeof createDefaultNPCOnlineState>;
} {
  const calls: string[] = [];
  const state = createDefaultNPCOnlineState();

  if (overrides.moraleState    !== undefined) state.moraleState    = overrides.moraleState;
  if (overrides.lastKnownEnemyX !== undefined) state.lastKnownEnemyX = overrides.lastKnownEnemyX;
  if (overrides.lastKnownEnemyY !== undefined) state.lastKnownEnemyY = overrides.lastKnownEnemyY;

  const ctx: INPCContext = {
    npcId:         'npc-flee-test',
    factionId:     'stalker',
    entityType:    'human',
    x:             overrides.x ?? 0,
    y:             overrides.y ?? 0,
    state,
    currentStateId: 'FLEE',
    perception:    null,
    health:        null,
    cover:         null,
    danger:        null,
    restrictedZones: null,
    squad:         null,
    pack:          null,
    conditions:    null,
    suspicion:     null,
    setVelocity:   (vx, vy) => { calls.push(`vel:${vx.toFixed(0)},${vy.toFixed(0)}`); },
    halt:          ()       => { calls.push('halt'); },
    setRotation:   ()       => {},
    setAlpha:      ()       => {},
    teleport:      ()       => {},
    disablePhysics:()       => {},
    transition:    (s)      => { calls.push(`transition:${s}`); },
    emitShoot:     ()       => {},
    emitMeleeHit:  ()       => {},
    emitVocalization: ()    => {},
    emitPsiAttackStart: ()  => {},
    now:           () => 0,
    random:        () => 0.5,
  };

  return { ctx, calls, state };
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('FleeState', () => {
  let handler: FleeState;
  let cfg: IStateConfig;

  beforeEach(() => {
    cfg     = createDefaultStateConfig(); // fleeDistance: 400 px by default
    handler = new FleeState(cfg);
  });

  // ── enter() ───────────────────────────────────────────────────────────────

  describe('enter()', () => {
    it('calls halt() on enter to zero inherited velocity', () => {
      const { ctx, calls } = makeMockCtx();
      handler.enter(ctx);
      expect(calls).toContain('halt');
    });

    it('does not trigger any transition on enter', () => {
      const { ctx, calls } = makeMockCtx();
      handler.enter(ctx);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('broadcasts PANIC alert via pack when pack is available', () => {
      const broadcasts: string[] = [];
      const { ctx } = makeMockCtx();
      (ctx as unknown as Record<string, unknown>).pack = {
        broadcastAlertLevel: (level: string) => { broadcasts.push(level); },
      };
      handler.enter(ctx);
      expect(broadcasts).toContain('PANIC');
    });

    it('does not throw when pack is null', () => {
      const { ctx } = makeMockCtx(); // pack: null
      expect(() => handler.enter(ctx)).not.toThrow();
    });
  });

  // ── exit() ────────────────────────────────────────────────────────────────

  describe('exit()', () => {
    it('calls halt() on exit', () => {
      const { ctx, calls } = makeMockCtx();
      handler.exit(ctx);
      expect(calls).toContain('halt');
    });

    it('does not trigger any transition on exit', () => {
      const { ctx, calls } = makeMockCtx();
      handler.exit(ctx);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });
  });

  // ── update(): STABLE morale → fleeOnCalmed (existing behavior) ────────────

  describe('update() — STABLE morale', () => {
    it('transitions to ALERT (fleeOnCalmed default) when morale is STABLE', () => {
      // Distance does not matter for STABLE — recovery fires first.
      const { ctx, calls } = makeMockCtx({
        moraleState:     'STABLE',
        x: 0, y: 0,
        lastKnownEnemyX: 0, lastKnownEnemyY: 0, // dist = 0, well under fleeDistance
      });
      handler.update(ctx, 16);
      expect(calls).toContain('transition:ALERT');
    });

    it('calls halt() before transitioning on STABLE morale', () => {
      const { ctx, calls } = makeMockCtx({
        moraleState: 'STABLE',
        x: 0, y: 0,
        lastKnownEnemyX: 0, lastKnownEnemyY: 0,
      });
      handler.update(ctx, 16);
      const haltIdx      = calls.indexOf('halt');
      const transIdx     = calls.findIndex(c => c.startsWith('transition:'));
      expect(haltIdx).toBeGreaterThanOrEqual(0);
      expect(haltIdx).toBeLessThan(transIdx);
    });

    it('does NOT call setVelocity when morale is STABLE (returns early)', () => {
      const { ctx, calls } = makeMockCtx({
        moraleState: 'STABLE',
        x: 0, y: 0,
        lastKnownEnemyX: 0, lastKnownEnemyY: 0,
      });
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('vel:'))).toHaveLength(0);
    });

    it('STABLE NPC far from threat still uses fleeOnCalmed (not fleeOnSafe)', () => {
      // dist = 500 > fleeDistance (400), but STABLE check runs before distance check.
      const { ctx, calls } = makeMockCtx({
        moraleState:     'STABLE',
        x: 500, y: 0,
        lastKnownEnemyX: 0, lastKnownEnemyY: 0,
      });
      handler.update(ctx, 16);
      expect(calls).toContain('transition:ALERT');
      expect(calls).not.toContain('transition:PATROL');
    });
  });

  // ── update(): SHAKEN + far enough → fleeOnSafe (the bug fix) ──────────────

  describe('update() — SHAKEN + dist >= fleeDistance', () => {
    // NOTE: tests use a non-zero threat position so the flee-from-origin guard
    // does NOT remap the threat to the NPC's own position. When lastKnownEnemy
    // is (0,0) and there are no visible enemies, the threat falls back to the
    // NPC's own position making dist=0, which would never trigger fleeOnSafe.
    // Using threat at (10, 0) avoids this edge case.

    it('transitions to PATROL (fleeOnSafe default) when dist equals fleeDistance exactly', () => {
      // Place NPC exactly fleeDistance away from the threat along the X axis.
      const { ctx, calls } = makeMockCtx({
        moraleState:     'SHAKEN',
        x: 10 + cfg.fleeDistance, y: 0,
        lastKnownEnemyX: 10, lastKnownEnemyY: 0,
      });
      handler.update(ctx, 16);
      expect(calls).toContain('transition:PATROL');
    });

    it('transitions to PATROL when dist is strictly greater than fleeDistance', () => {
      const { ctx, calls } = makeMockCtx({
        moraleState:     'SHAKEN',
        x: 10 + cfg.fleeDistance + 50, y: 0,
        lastKnownEnemyX: 10, lastKnownEnemyY: 0,
      });
      handler.update(ctx, 16);
      expect(calls).toContain('transition:PATROL');
    });

    it('calls halt() before the fleeOnSafe transition', () => {
      const { ctx, calls } = makeMockCtx({
        moraleState:     'SHAKEN',
        x: 10 + cfg.fleeDistance, y: 0,
        lastKnownEnemyX: 10, lastKnownEnemyY: 0,
      });
      handler.update(ctx, 16);
      const haltIdx  = calls.indexOf('halt');
      const transIdx = calls.findIndex(c => c === 'transition:PATROL');
      expect(haltIdx).toBeGreaterThanOrEqual(0);
      expect(haltIdx).toBeLessThan(transIdx);
    });

    it('does NOT set velocity after fleeOnSafe transition fires', () => {
      const { ctx, calls } = makeMockCtx({
        moraleState:     'SHAKEN',
        x: 10 + cfg.fleeDistance, y: 0,
        lastKnownEnemyX: 10, lastKnownEnemyY: 0,
      });
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('vel:'))).toHaveLength(0);
    });

    it('fires exactly one transition when SHAKEN + far enough', () => {
      const { ctx, calls } = makeMockCtx({
        moraleState:     'SHAKEN',
        x: 10 + cfg.fleeDistance + 1, y: 0,
        lastKnownEnemyX: 10, lastKnownEnemyY: 0,
      });
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(1);
    });

    it('works correctly with a diagonal distance equal to fleeDistance', () => {
      // Use a 3-4-5 right triangle scaled so the hypotenuse equals fleeDistance.
      const hyp = cfg.fleeDistance; // 400 by default
      const nx  = (3 / 5) * hyp;   // 240
      const ny  = (4 / 5) * hyp;   // 320
      // Threat at (10, 0), NPC at (10+240, 320) so dist=hyp exactly.
      const { ctx, calls } = makeMockCtx({
        moraleState:     'SHAKEN',
        x: 10 + nx, y: ny,
        lastKnownEnemyX: 10, lastKnownEnemyY: 0,
      });
      handler.update(ctx, 16);
      expect(calls).toContain('transition:PATROL');
    });
  });

  // ── update(): SHAKEN + NOT far enough → keeps fleeing ─────────────────────

  describe('update() — SHAKEN + dist < fleeDistance', () => {
    it('does NOT transition when dist is one pixel short of fleeDistance', () => {
      const { ctx, calls } = makeMockCtx({
        moraleState:     'SHAKEN',
        x: cfg.fleeDistance - 1, y: 0,
        lastKnownEnemyX: 0, lastKnownEnemyY: 0,
      });
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('calls setVelocity (awayFrom) when SHAKEN but not far enough', () => {
      const { ctx, calls } = makeMockCtx({
        moraleState:     'SHAKEN',
        x: cfg.fleeDistance - 50, y: 0,
        lastKnownEnemyX: 0, lastKnownEnemyY: 0,
      });
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(true);
    });

    it('does NOT call halt() mid-flight when SHAKEN and still closing distance', () => {
      const { ctx, calls } = makeMockCtx({
        moraleState:     'SHAKEN',
        x: cfg.fleeDistance - 100, y: 0,
        lastKnownEnemyX: 0, lastKnownEnemyY: 0,
      });
      handler.update(ctx, 16);
      expect(calls).not.toContain('halt');
    });

    it('NPC at the origin (co-located with threat) escapes along positive X when SHAKEN', () => {
      // awayFrom() fallback: NPC exactly on top of threat → escape along +X.
      const { ctx, calls } = makeMockCtx({
        moraleState:     'SHAKEN',
        x: 0, y: 0,
        lastKnownEnemyX: 0, lastKnownEnemyY: 0,
      });
      handler.update(ctx, 16);
      const velCall = calls.find(c => c.startsWith('vel:'));
      expect(velCall).toBeDefined();
      // Positive X velocity expected for the degenerate co-located case.
      const vx = parseFloat(velCall!.split(':')[1].split(',')[0]);
      expect(vx).toBeGreaterThan(0);
    });

    it('keeps fleeing every frame — no transition across multiple ticks', () => {
      const { ctx, calls } = makeMockCtx({
        moraleState:     'SHAKEN',
        x: cfg.fleeDistance - 200, y: 0,
        lastKnownEnemyX: 0, lastKnownEnemyY: 0,
      });
      for (let tick = 0; tick < 5; tick++) {
        calls.length = 0;
        handler.update(ctx, 16);
        expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
        expect(calls.some(c => c.startsWith('vel:'))).toBe(true);
      }
    });
  });

  // ── update(): PANICKED → keeps fleeing regardless of distance ─────────────

  describe('update() — PANICKED morale', () => {
    it('does NOT transition when PANICKED and dist > fleeDistance', () => {
      // A PANICKED NPC has run past the flee threshold — must keep fleeing.
      const { ctx, calls } = makeMockCtx({
        moraleState:     'PANICKED',
        x: cfg.fleeDistance + 100, y: 0,
        lastKnownEnemyX: 0, lastKnownEnemyY: 0,
      });
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('does NOT transition when PANICKED and dist equals fleeDistance', () => {
      const { ctx, calls } = makeMockCtx({
        moraleState:     'PANICKED',
        x: cfg.fleeDistance, y: 0,
        lastKnownEnemyX: 0, lastKnownEnemyY: 0,
      });
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('applies panicFleeMultiplier — panic speed is faster than SHAKEN speed', () => {
      // Both NPCs have the same position and threat; only morale differs.
      const { ctx: shakenCtx, calls: shakenCalls } = makeMockCtx({
        moraleState:     'SHAKEN',
        x: cfg.fleeDistance - 200, y: 0,
        lastKnownEnemyX: 0, lastKnownEnemyY: 0,
      });
      const { ctx: panickedCtx, calls: panickedCalls } = makeMockCtx({
        moraleState:     'PANICKED',
        x: cfg.fleeDistance - 200, y: 0,
        lastKnownEnemyX: 0, lastKnownEnemyY: 0,
      });

      handler.update(shakenCtx, 16);
      handler.update(panickedCtx, 16);

      const speedFrom = (calls: string[]) => {
        const velCall = calls.find(c => c.startsWith('vel:'));
        if (!velCall) return 0;
        const [vxStr] = velCall.split(':')[1].split(',');
        return Math.abs(parseFloat(vxStr));
      };

      expect(speedFrom(panickedCalls)).toBeGreaterThan(speedFrom(shakenCalls));
    });

    it('calls setVelocity (awayFrom) when PANICKED, not halt', () => {
      const { ctx, calls } = makeMockCtx({
        moraleState:     'PANICKED',
        x: 100, y: 0,
        lastKnownEnemyX: 0, lastKnownEnemyY: 0,
      });
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(true);
      expect(calls).not.toContain('halt');
    });

    it('PANICKED NPC at the exact fleeDistance still flees, not transitions', () => {
      // Regression guard: ensure the SHAKEN distance check only fires for SHAKEN.
      const { ctx, calls } = makeMockCtx({
        moraleState:     'PANICKED',
        x: cfg.fleeDistance, y: 0,
        lastKnownEnemyX: 0, lastKnownEnemyY: 0,
      });
      handler.update(ctx, 16);
      expect(calls).not.toContain('transition:PATROL');
    });
  });

  // ── fleeOnSafe is injectable / overridable ─────────────────────────────────

  describe('injectable IStateTransitionMap overrides', () => {
    it('uses custom fleeOnSafe when SHAKEN + far enough', () => {
      const custom = new FleeState(cfg, { fleeOnSafe: 'wander' });
      const { ctx, calls } = makeMockCtx({
        moraleState:     'SHAKEN',
        x: 10 + cfg.fleeDistance, y: 0,
        lastKnownEnemyX: 10, lastKnownEnemyY: 0,
      });
      custom.update(ctx, 16);
      expect(calls).toContain('transition:wander');
    });

    it('custom fleeOnSafe does NOT fire when SHAKEN but dist < fleeDistance', () => {
      const custom = new FleeState(cfg, { fleeOnSafe: 'wander' });
      const { ctx, calls } = makeMockCtx({
        moraleState:     'SHAKEN',
        x: cfg.fleeDistance - 1, y: 0,
        lastKnownEnemyX: 0, lastKnownEnemyY: 0,
      });
      custom.update(ctx, 16);
      expect(calls).not.toContain('transition:wander');
    });

    it('custom fleeOnSafe does NOT fire for PANICKED even when far enough', () => {
      const custom = new FleeState(cfg, { fleeOnSafe: 'wander' });
      const { ctx, calls } = makeMockCtx({
        moraleState:     'PANICKED',
        x: cfg.fleeDistance + 100, y: 0,
        lastKnownEnemyX: 0, lastKnownEnemyY: 0,
      });
      custom.update(ctx, 16);
      expect(calls).not.toContain('transition:wander');
    });

    it('uses custom fleeOnCalmed when morale is STABLE', () => {
      const custom = new FleeState(cfg, { fleeOnCalmed: 'search_area' });
      const { ctx, calls } = makeMockCtx({
        moraleState: 'STABLE',
        x: 0, y: 0,
        lastKnownEnemyX: 0, lastKnownEnemyY: 0,
      });
      custom.update(ctx, 16);
      expect(calls).toContain('transition:search_area');
    });

    it('both fleeOnSafe and fleeOnCalmed can be overridden independently', () => {
      const custom = new FleeState(cfg, { fleeOnSafe: 'camp', fleeOnCalmed: 'patrol_slowly' });

      const { ctx: shakenCtx, calls: shakenCalls } = makeMockCtx({
        moraleState:     'SHAKEN',
        x: 10 + cfg.fleeDistance, y: 0,
        lastKnownEnemyX: 10, lastKnownEnemyY: 0,
      });
      const { ctx: stableCtx, calls: stableCalls } = makeMockCtx({
        moraleState: 'STABLE',
        x: 0, y: 0,
        lastKnownEnemyX: 0, lastKnownEnemyY: 0,
      });

      custom.update(shakenCtx, 16);
      custom.update(stableCtx, 16);

      expect(shakenCalls).toContain('transition:camp');
      expect(stableCalls).toContain('transition:patrol_slowly');
    });

    it('overriding only fleeOnSafe preserves the fleeOnCalmed default', () => {
      const custom = new FleeState(cfg, { fleeOnSafe: 'camp' });
      const { ctx, calls } = makeMockCtx({
        moraleState: 'STABLE',
        x: 0, y: 0,
        lastKnownEnemyX: 0, lastKnownEnemyY: 0,
      });
      custom.update(ctx, 16);
      // fleeOnCalmed default is 'ALERT'
      expect(calls).toContain('transition:ALERT');
    });

    it('overriding only fleeOnCalmed preserves the fleeOnSafe default', () => {
      const custom = new FleeState(cfg, { fleeOnCalmed: 'search_area' });
      const { ctx, calls } = makeMockCtx({
        moraleState:     'SHAKEN',
        x: 10 + cfg.fleeDistance + 10, y: 0,
        lastKnownEnemyX: 10, lastKnownEnemyY: 0,
      });
      custom.update(ctx, 16);
      // fleeOnSafe default is 'PATROL'
      expect(calls).toContain('transition:PATROL');
    });
  });

  // ── Speed calculations ─────────────────────────────────────────────────────

  describe('update() — flee speed', () => {
    it('SHAKEN flee speed equals approachSpeed * fleeSpeedMultiplier', () => {
      const customCfg = createDefaultStateConfig({ approachSpeed: 100, fleeSpeedMultiplier: 2.0 });
      const customHandler = new FleeState(customCfg);

      // Place NPC directly to the right of the threat so velocity is purely +X.
      const { ctx, calls } = makeMockCtx({
        moraleState:     'SHAKEN',
        x: 50,  y: 0, // dist = 50, well under fleeDistance (400)
        lastKnownEnemyX: 0, lastKnownEnemyY: 0,
      });

      customHandler.update(ctx, 16);

      const velCall = calls.find(c => c.startsWith('vel:'));
      expect(velCall).toBeDefined();
      const vx = parseFloat(velCall!.split(':')[1].split(',')[0]);
      // Expected: 100 * 2.0 = 200
      expect(vx).toBeCloseTo(200, 1);
    });

    it('PANICKED flee speed equals approachSpeed * fleeSpeedMultiplier * panicFleeMultiplier', () => {
      const customCfg = createDefaultStateConfig({
        approachSpeed:       100,
        fleeSpeedMultiplier: 2.0,
        panicFleeMultiplier: 1.5,
      });
      const customHandler = new FleeState(customCfg);

      const { ctx, calls } = makeMockCtx({
        moraleState:     'PANICKED',
        x: 50, y: 0,
        lastKnownEnemyX: 0, lastKnownEnemyY: 0,
      });

      customHandler.update(ctx, 16);

      const velCall = calls.find(c => c.startsWith('vel:'));
      expect(velCall).toBeDefined();
      const vx = parseFloat(velCall!.split(':')[1].split(',')[0]);
      // Expected: 100 * 2.0 * 1.5 = 300
      expect(vx).toBeCloseTo(300, 1);
    });
  });

  // ── flee-from-origin fix: lastKnownEnemy=(0,0) branch ────────────────────
  //
  // Fix under test:
  //   When lastKnownEnemyX/Y are both 0 (never set), the NPC now resolves a
  //   real threat source from perception instead of naively fleeing from (0,0).
  //
  // Scenarios covered:
  //   7.  lastKnownEnemy=(0,0) + one visible enemy  → flees away from that enemy
  //   8.  lastKnownEnemy=(0,0) + no visible enemy   → uses own position, dist=0,
  //                                                    does NOT exit SHAKEN immediately
  //   9.  lastKnownEnemy=(0,0) + multiple enemies   → picks the nearest one
  //   10. lastKnownEnemy set to non-zero             → normal path unchanged (regression)
  //   11. PANICKED + lastKnownEnemy=(0,0) + no enemy → still moves (not stuck)

  describe('update() — flee-from-origin fix (lastKnownEnemy unset)', () => {
    // Helper that builds the same INPCContext mock as makeMockCtx but with an
    // injectable perception implementation.  Only getVisibleEnemies() needs to
    // be overridden for FleeState; everything else is a safe no-op.
    function makeMockCtxWithPerception(
      overrides: MockOverrides & {
        visibleEnemies?: Array<{ id: string; x: number; y: number; factionId: string }>;
      } = {},
    ): { ctx: INPCContext; calls: string[] } {
      const { visibleEnemies = [], ...ctxOverrides } = overrides;
      const { ctx, calls } = makeMockCtx(ctxOverrides);

      const perception = {
        getVisibleEnemies: () => visibleEnemies as ReadonlyArray<{
          id: string; x: number; y: number; factionId: string;
        }>,
        getVisibleAllies:  () => [] as ReadonlyArray<{ id: string; x: number; y: number }>,
        getNearbyItems:    () => [] as ReadonlyArray<{ id: string; x: number; y: number; type: string }>,
        hasVisibleEnemy:   () => visibleEnemies.length > 0,
      };

      // perception is readonly on the interface, so we cast via unknown.
      (ctx as unknown as Record<string, unknown>).perception = perception;

      return { ctx, calls };
    }

    // ── 7. Single visible enemy — flee away from it ───────────────────────

    it('flees away from a single visible enemy when lastKnownEnemy is (0,0)', () => {
      // NPC is at (200, 0). Enemy is at (100, 0) — to NPC's left.
      // Expected: flee direction is +X (away from x=100).
      const { ctx, calls } = makeMockCtxWithPerception({
        moraleState:      'SHAKEN',
        x: 200, y: 0,
        lastKnownEnemyX:  0, lastKnownEnemyY: 0,
        visibleEnemies:   [{ id: 'e1', x: 100, y: 0, factionId: 'bandit' }],
      });

      handler.update(ctx, 16);

      const velCall = calls.find(c => c.startsWith('vel:'));
      expect(velCall).toBeDefined();
      const vx = parseFloat(velCall!.split(':')[1].split(',')[0]);
      // NPC is to the right of the enemy — must move further right (+X).
      expect(vx).toBeGreaterThan(0);
    });

    it('flees away from visible enemy in the correct direction on the Y axis', () => {
      // NPC at (0, 300). Enemy at (0, 100) — above NPC on screen (lower Y value).
      // Flee direction: +Y (away from y=100, toward larger Y values).
      const { ctx, calls } = makeMockCtxWithPerception({
        moraleState:      'SHAKEN',
        x: 0, y: 300,
        lastKnownEnemyX:  0, lastKnownEnemyY: 0,
        visibleEnemies:   [{ id: 'e1', x: 0, y: 100, factionId: 'bandit' }],
      });

      handler.update(ctx, 16);

      const velCall = calls.find(c => c.startsWith('vel:'));
      expect(velCall).toBeDefined();
      const vy = parseFloat(velCall!.split(':')[1].split(',')[1]);
      expect(vy).toBeGreaterThan(0);
    });

    it('does NOT use world origin (0,0) as threat when a visible enemy exists', () => {
      // NPC at (0, 200). World origin is directly above it on the Y axis.
      // Enemy is at (0, 300) — directly below.
      // If the code (wrongly) used origin (0,0), the NPC would flee toward +Y.
      // If it correctly uses the enemy at (0,300), the NPC must flee toward -Y.
      const { ctx, calls } = makeMockCtxWithPerception({
        moraleState:      'SHAKEN',
        x: 0, y: 200,
        lastKnownEnemyX:  0, lastKnownEnemyY: 0,
        visibleEnemies:   [{ id: 'e1', x: 0, y: 300, factionId: 'bandit' }],
      });

      handler.update(ctx, 16);

      const velCall = calls.find(c => c.startsWith('vel:'));
      expect(velCall).toBeDefined();
      const vy = parseFloat(velCall!.split(':')[1].split(',')[1]);
      // Must be negative — fleeing away from y=300 means moving toward smaller Y.
      expect(vy).toBeLessThan(0);
    });

    // ── 8. No visible enemy — falls back to own position, no early exit ──────

    it('does NOT immediately exit SHAKEN when lastKnownEnemy=(0,0) and no visible enemy', () => {
      // Without the fix: threatX=0, threatY=0. NPC is at (500,0), which is
      // fleeDistance(400)+ away from origin → exits immediately. Wrong.
      // With the fix: threatX=500, threatY=0 → dist=0 → no early exit.
      const { ctx, calls } = makeMockCtxWithPerception({
        moraleState:      'SHAKEN',
        x: cfg.fleeDistance + 100, y: 0,
        lastKnownEnemyX:  0, lastKnownEnemyY: 0,
        visibleEnemies:   [],
      });

      handler.update(ctx, 16);

      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('calls setVelocity (moves) when no visible enemy and lastKnownEnemy=(0,0)', () => {
      // dist=0 → awayFrom() triggers its "+X escape" path — velocity must be set.
      const { ctx, calls } = makeMockCtxWithPerception({
        moraleState:      'SHAKEN',
        x: 300, y: 0,
        lastKnownEnemyX:  0, lastKnownEnemyY: 0,
        visibleEnemies:   [],
      });

      handler.update(ctx, 16);

      expect(calls.some(c => c.startsWith('vel:'))).toBe(true);
    });

    it('does not call halt() mid-flight when no visible enemy and lastKnownEnemy=(0,0)', () => {
      const { ctx, calls } = makeMockCtxWithPerception({
        moraleState:      'SHAKEN',
        x: 300, y: 0,
        lastKnownEnemyX:  0, lastKnownEnemyY: 0,
        visibleEnemies:   [],
      });

      handler.update(ctx, 16);

      expect(calls).not.toContain('halt');
    });

    it('escape velocity is along +X when falling back to own position (dist=0 path)', () => {
      // awayFrom(ctx, ctx.x, ctx.y, speed): dx=0, dy=0, dist<0.5 → setVelocity(speed, 0).
      const { ctx, calls } = makeMockCtxWithPerception({
        moraleState:      'SHAKEN',
        x: 200, y: 150,
        lastKnownEnemyX:  0, lastKnownEnemyY: 0,
        visibleEnemies:   [],
      });

      handler.update(ctx, 16);

      const velCall = calls.find(c => c.startsWith('vel:'));
      expect(velCall).toBeDefined();
      const vx = parseFloat(velCall!.split(':')[1].split(',')[0]);
      const vy = parseFloat(velCall!.split(':')[1].split(',')[1]);
      expect(vx).toBeGreaterThan(0);
      expect(vy).toBeCloseTo(0, 1);
    });

    // ── 9. Multiple visible enemies — uses the nearest one ───────────────────

    it('picks the nearest visible enemy as threat source when multiple are visible', () => {
      // NPC at (200, 0).
      // Near enemy at (150, 0)  → dist = 50  (closer).
      // Far  enemy at (0,   0)  → dist = 200 (farther).
      // Flee from near enemy (x=150): direction is +X (away from 150, NPC is at 200).
      // Flee from far  enemy (x=0)  : direction would also be +X in this layout,
      // so we need a geometry where the two enemies point in opposite directions.
      //
      // Layout: NPC at (200, 0).
      //   Near enemy at (250, 0) → dist=50  — to NPC's right → flee toward -X.
      //   Far  enemy at (0,   0) → dist=200 — to NPC's left  → flee toward +X.
      //
      // Correct: use near enemy (250) → vx < 0.
      const { ctx, calls } = makeMockCtxWithPerception({
        moraleState:      'SHAKEN',
        x: 200, y: 0,
        lastKnownEnemyX:  0, lastKnownEnemyY: 0,
        visibleEnemies:   [
          { id: 'near', x: 250, y: 0, factionId: 'bandit' },
          { id: 'far',  x:   0, y: 0, factionId: 'bandit' },
        ],
      });

      handler.update(ctx, 16);

      const velCall = calls.find(c => c.startsWith('vel:'));
      expect(velCall).toBeDefined();
      const vx = parseFloat(velCall!.split(':')[1].split(',')[0]);
      // Fleeing from x=250 while standing at x=200 → direction is -X.
      expect(vx).toBeLessThan(0);
    });

    it('selects nearest enemy correctly when enemies straddle the NPC on the Y axis', () => {
      // NPC at (0, 100). Near enemy at (0, 80) — dist=20. Far enemy at (0, 0) — dist=100.
      // Near enemy is above (lower Y). Flee direction from near: +Y.
      // Far enemy is also above. Choosing far would give same sign, so let's flip:
      //   Near at (0, 120) → dist=20, below NPC → flee toward -Y.
      //   Far  at (0,  0)  → dist=100, above NPC → flee toward +Y.
      // Correct selection (near at y=120) → vy < 0.
      const { ctx, calls } = makeMockCtxWithPerception({
        moraleState:      'SHAKEN',
        x: 0, y: 100,
        lastKnownEnemyX:  0, lastKnownEnemyY: 0,
        visibleEnemies:   [
          { id: 'near', x: 0, y: 120, factionId: 'bandit' },
          { id: 'far',  x: 0, y:   0, factionId: 'bandit' },
        ],
      });

      handler.update(ctx, 16);

      const velCall = calls.find(c => c.startsWith('vel:'));
      expect(velCall).toBeDefined();
      const vy = parseFloat(velCall!.split(':')[1].split(',')[1]);
      // Fleeing from y=120 (below) while at y=100 → direction is -Y.
      expect(vy).toBeLessThan(0);
    });

    it('nearest-enemy selection considers squared distance correctly (3-4-5 triangle)', () => {
      // NPC at (0, 0). Two enemies:
      //   A at (30, 40) → dist = 50.
      //   B at (60, 0)  → dist = 60.
      // A is closer. Flee from A: direction is (-30, -40) normalised → vx < 0, vy < 0.
      const { ctx, calls } = makeMockCtxWithPerception({
        moraleState:      'SHAKEN',
        x: 0, y: 0,
        lastKnownEnemyX:  0, lastKnownEnemyY: 0,
        visibleEnemies:   [
          { id: 'a', x: 30, y: 40, factionId: 'bandit' },
          { id: 'b', x: 60, y:  0, factionId: 'bandit' },
        ],
      });

      handler.update(ctx, 16);

      const velCall = calls.find(c => c.startsWith('vel:'));
      expect(velCall).toBeDefined();
      const vx = parseFloat(velCall!.split(':')[1].split(',')[0]);
      const vy = parseFloat(velCall!.split(':')[1].split(',')[1]);
      // Fleeing from (30, 40) while at (0,0) → both components negative.
      expect(vx).toBeLessThan(0);
      expect(vy).toBeLessThan(0);
    });

    // ── 10. lastKnownEnemy set to non-zero → normal behavior unchanged ────────

    it('uses lastKnownEnemyX/Y directly when they are non-zero (regression guard)', () => {
      // Enemy last seen at (50, 0). NPC at (200, 0) — to the right.
      // Normal path: flee from (50, 0) → +X.
      // This test has NO perception mock (perception stays null on the ctx), to
      // confirm the non-zero branch does not touch perception at all.
      const { ctx, calls } = makeMockCtx({
        moraleState:      'SHAKEN',
        x: 200, y: 0,
        lastKnownEnemyX:  50, lastKnownEnemyY: 0,
      });

      handler.update(ctx, 16);

      const velCall = calls.find(c => c.startsWith('vel:'));
      expect(velCall).toBeDefined();
      const vx = parseFloat(velCall!.split(':')[1].split(',')[0]);
      expect(vx).toBeGreaterThan(0);
    });

    it('non-zero lastKnownEnemy still triggers fleeOnSafe when dist >= fleeDistance', () => {
      // NPC is fleeDistance away from a non-zero threat position.
      const threatX = 100;
      const { ctx, calls } = makeMockCtx({
        moraleState:      'SHAKEN',
        x: threatX + cfg.fleeDistance, y: 0,
        lastKnownEnemyX:  threatX, lastKnownEnemyY: 0,
      });

      handler.update(ctx, 16);

      expect(calls).toContain('transition:PATROL');
    });

    it('non-zero lastKnownEnemy in a negative quadrant is used as-is (regression)', () => {
      // Threat at (-100, -100). NPC at (0, 0) — to the upper-right of threat.
      // Flee direction: +X and +Y.
      const { ctx, calls } = makeMockCtx({
        moraleState:      'SHAKEN',
        x: 0, y: 0,
        lastKnownEnemyX:  -100, lastKnownEnemyY: -100,
      });

      handler.update(ctx, 16);

      const velCall = calls.find(c => c.startsWith('vel:'));
      expect(velCall).toBeDefined();
      const vx = parseFloat(velCall!.split(':')[1].split(',')[0]);
      const vy = parseFloat(velCall!.split(':')[1].split(',')[1]);
      expect(vx).toBeGreaterThan(0);
      expect(vy).toBeGreaterThan(0);
    });

    // ── 11. PANICKED + lastKnownEnemy=(0,0) + no enemy → still moves ─────────

    it('PANICKED NPC still calls setVelocity when no visible enemy and lastKnownEnemy=(0,0)', () => {
      // With the fix the fallback sets threat=(ctx.x, ctx.y), so dist=0 < 0.5,
      // and awayFrom() fires its "+X escape" setVelocity call.
      const { ctx, calls } = makeMockCtxWithPerception({
        moraleState:      'PANICKED',
        x: 300, y: 200,
        lastKnownEnemyX:  0, lastKnownEnemyY: 0,
        visibleEnemies:   [],
      });

      handler.update(ctx, 16);

      expect(calls.some(c => c.startsWith('vel:'))).toBe(true);
    });

    it('PANICKED NPC does not call halt() when no visible enemy and lastKnownEnemy=(0,0)', () => {
      const { ctx, calls } = makeMockCtxWithPerception({
        moraleState:      'PANICKED',
        x: 300, y: 200,
        lastKnownEnemyX:  0, lastKnownEnemyY: 0,
        visibleEnemies:   [],
      });

      handler.update(ctx, 16);

      expect(calls).not.toContain('halt');
    });

    it('PANICKED NPC does not transition when no visible enemy and lastKnownEnemy=(0,0)', () => {
      // The SHAKEN fleeOnSafe check is gated on moraleState === 'SHAKEN', so
      // a PANICKED NPC must never exit even with dist=0 falling through to the
      // awayFrom() call.
      const { ctx, calls } = makeMockCtxWithPerception({
        moraleState:      'PANICKED',
        x: cfg.fleeDistance + 100, y: 0,
        lastKnownEnemyX:  0, lastKnownEnemyY: 0,
        visibleEnemies:   [],
      });

      handler.update(ctx, 16);

      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('PANICKED NPC flees from visible enemy at correct speed (panicFleeMultiplier applied)', () => {
      // With a visible enemy the threat position is real → awayFrom() uses the
      // actual direction, so speed should still be approachSpeed * fleeSpeedMultiplier * panicMult.
      const customCfg = createDefaultStateConfig({
        approachSpeed:       100,
        fleeSpeedMultiplier: 2.0,
        panicFleeMultiplier: 1.5,
      });
      const customHandler = new FleeState(customCfg);

      // NPC at (200, 0), enemy at (100, 0) — flee in +X direction.
      const { ctx, calls } = makeMockCtxWithPerception({
        moraleState:      'PANICKED',
        x: 200, y: 0,
        lastKnownEnemyX:  0, lastKnownEnemyY: 0,
        visibleEnemies:   [{ id: 'e1', x: 100, y: 0, factionId: 'bandit' }],
      });

      customHandler.update(ctx, 16);

      const velCall = calls.find(c => c.startsWith('vel:'));
      expect(velCall).toBeDefined();
      const vx = parseFloat(velCall!.split(':')[1].split(',')[0]);
      // Expected: 100 * 2.0 * 1.5 = 300
      expect(vx).toBeCloseTo(300, 1);
    });
  });

  // ── Stateless / shared instance ────────────────────────────────────────────

  describe('shared handler instance', () => {
    it('single FleeState instance handles two independent NPC contexts', () => {
      // NPC A is SHAKEN and far enough → must transition.
      const { ctx: ctxA, calls: callsA } = makeMockCtx({
        moraleState:     'SHAKEN',
        x: 10 + cfg.fleeDistance, y: 0,
        lastKnownEnemyX: 10, lastKnownEnemyY: 0,
      });
      // NPC B is PANICKED and far → must keep fleeing.
      const { ctx: ctxB, calls: callsB } = makeMockCtx({
        moraleState:     'PANICKED',
        x: cfg.fleeDistance + 100, y: 0,
        lastKnownEnemyX: 0, lastKnownEnemyY: 0,
      });

      handler.update(ctxA, 16);
      handler.update(ctxB, 16);

      expect(callsA).toContain('transition:PATROL');
      expect(callsB.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('state is stored on ctx.state, not the handler — updates are independent', () => {
      const { ctx: ctxA, calls: callsA } = makeMockCtx({ moraleState: 'STABLE' });
      const { ctx: ctxB, calls: callsB } = makeMockCtx({
        moraleState:     'SHAKEN',
        x: cfg.fleeDistance - 50, y: 0,
        lastKnownEnemyX: 0, lastKnownEnemyY: 0,
      });

      handler.update(ctxA, 16); // STABLE → ALERT
      handler.update(ctxB, 16); // SHAKEN, not far → flee

      expect(callsA).toContain('transition:ALERT');
      expect(callsB.filter(c => c.startsWith('transition:'))).toHaveLength(0);
      expect(callsB.some(c => c.startsWith('vel:'))).toBe(true);
    });
  });
});
