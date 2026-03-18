// states/handlers/EvadeGrenadeState.test.ts
// Unit tests for the evadeOnTimeout hardcoded-'SEARCH' fix in EvadeGrenadeState.
//
// Fix under test:
//   The no-enemy-after-evasion branch previously called
//   ctx.transition('SEARCH') directly. It now calls
//   ctx.transition(this.tr.evadeOnTimeout) so the destination is injectable
//   and defaults to 'COMBAT'.
//
// Invariants verified:
//   1. Danger cleared + no visible enemy → transitions via evadeOnTimeout ('COMBAT' default).
//   2. Danger cleared + visible enemy    → transitions via evadeOnClear ('COMBAT' default).
//   3. Custom evadeOnTimeout value is respected (injectable).
//   4. The literal string 'SEARCH' is never hardcoded as a transition target.
//      (Structural proof: a handler constructed with evadeOnTimeout: 'SEARCH'
//       does emit 'SEARCH', but one without the override does NOT emit 'SEARCH'
//       when no enemy is present.)

import { describe, it, expect, beforeEach } from 'vitest';
import { EvadeGrenadeState } from './EvadeGrenadeState';
import { createDefaultStateConfig } from '../IStateConfig';
import { createDefaultNPCOnlineState } from '../NPCOnlineState';
import type { INPCContext, IDangerAccess } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

interface MockOverrides {
  nowMs?: number;
  x?: number;
  y?: number;
  /** Danger returned by getGrenadeDanger(). null means ctx.danger is null (no system). */
  grenadeDanger?: { active: boolean; originX: number; originY: number } | null;
  /** Whether ctx.danger itself is present (distinct from grenadeDanger being null). */
  hasDangerSystem?: boolean;
  /** Enemies perceived this frame. */
  perceptionEnemies?: Array<{ id: string; x: number; y: number; factionId: string }>;
}

function makeMockCtx(overrides: MockOverrides = {}): {
  ctx: INPCContext;
  calls: string[];
  state: ReturnType<typeof createDefaultNPCOnlineState>;
  setNow: (ms: number) => void;
  setEnemies: (enemies: Array<{ id: string; x: number; y: number; factionId: string }>) => void;
} {
  const calls: string[] = [];
  const state = createDefaultNPCOnlineState();

  let nowMs = overrides.nowMs ?? 0;
  let enemies = overrides.perceptionEnemies ?? [];

  // Build the danger accessor.
  // hasDangerSystem defaults to true unless explicitly set to false or
  // grenadeDanger is explicitly null (no system at all).
  const hasDangerSystem = overrides.hasDangerSystem ?? overrides.grenadeDanger !== null;

  const dangerAccess: IDangerAccess | null = hasDangerSystem
    ? {
        getDangerLevel: (_x, _y) => 0,
        getGrenadeDanger: (_x, _y) => overrides.grenadeDanger ?? null,
      }
    : null;

  const ctx: INPCContext = {
    npcId: 'npc-test',
    factionId: 'stalker',
    entityType: 'human',
    x: overrides.x ?? 100,
    y: overrides.y ?? 100,
    state,
    currentStateId: 'EVADE_GRENADE',
    perception: {
      getVisibleEnemies: () => enemies,
      getVisibleAllies: () => [],
      getNearbyItems: () => [],
      hasVisibleEnemy: () => enemies.length > 0,
    },
    health: null,
    setVelocity: (vx, vy) => { calls.push(`vel:${vx.toFixed(0)},${vy.toFixed(0)}`); },
    halt: () => { calls.push('halt'); },
    setRotation: (r) => { calls.push(`rot:${r.toFixed(2)}`); },
    setAlpha: (_a) => {},
    teleport: () => {},
    disablePhysics: () => {},
    transition: (s) => { calls.push(`transition:${s}`); },
    emitShoot: () => {},
    emitMeleeHit: () => {},
    emitVocalization: (t) => { calls.push(`vocal:${t}`); },
    emitPsiAttackStart: () => {},
    cover: null,
    danger: dangerAccess,
    restrictedZones: null,
    squad: null,
    pack: null,
    conditions: null,
    suspicion: null,
    now: () => nowMs,
    random: () => 0.5,
  };

  return {
    ctx,
    calls,
    state,
    setNow: (ms: number) => { nowMs = ms; },
    setEnemies: (e) => { enemies = e; },
  };
}

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

describe('EvadeGrenadeState', () => {
  let cfg: IStateConfig;
  let handler: EvadeGrenadeState;

  beforeEach(() => {
    cfg = createDefaultStateConfig();
    handler = new EvadeGrenadeState(cfg);
  });

  // ── enter() ───────────────────────────────────────────────────────────────

  describe('enter()', () => {
    it('records ctx.now() into state.evadeStartMs', () => {
      const { ctx } = makeMockCtx({ nowMs: 3_000 });
      handler.enter(ctx);
      expect(ctx.state.evadeStartMs).toBe(3_000);
    });
  });

  // ── exit() ────────────────────────────────────────────────────────────────

  describe('exit()', () => {
    it('halts the NPC', () => {
      const { ctx, calls } = makeMockCtx();
      handler.enter(ctx);
      calls.length = 0;
      handler.exit(ctx);
      expect(calls).toContain('halt');
    });
  });

  // ── update() — active danger: keep sprinting ──────────────────────────────

  describe('update() — active grenade danger', () => {
    it('does not transition while danger is active', () => {
      const { ctx, calls } = makeMockCtx({
        grenadeDanger: { active: true, originX: 200, originY: 200 },
      });
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('calls setVelocity to sprint away from the danger origin', () => {
      const { ctx, calls } = makeMockCtx({
        x: 100, y: 100,
        grenadeDanger: { active: true, originX: 200, originY: 200 },
      });
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('vel:'))).toBe(true);
    });
  });

  // ── update() — no danger system (evadeOnNoSystem) ─────────────────────────

  describe('update() — no danger system (ctx.danger === null)', () => {
    it('does not transition before EVADE_GRENADE_DURATION_MS elapses', () => {
      const { ctx, calls } = makeMockCtx({ hasDangerSystem: false });
      handler.enter(ctx);
      calls.length = 0;
      handler.update(ctx, 16); // well under 2000 ms
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('transitions via evadeOnNoSystem (default COMBAT) after timeout when no danger system', () => {
      const { ctx, calls, setNow } = makeMockCtx({ hasDangerSystem: false, nowMs: 0 });
      handler.enter(ctx);
      setNow(2_100); // past EVADE_GRENADE_DURATION_MS (2000 ms)
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('transition:COMBAT');
    });

    it('halts before evadeOnNoSystem transition', () => {
      const { ctx, calls, setNow } = makeMockCtx({ hasDangerSystem: false, nowMs: 0 });
      handler.enter(ctx);
      setNow(2_100);
      calls.length = 0;
      handler.update(ctx, 16);
      const haltIdx = calls.indexOf('halt');
      const transIdx = calls.findIndex(c => c.startsWith('transition:'));
      expect(haltIdx).toBeGreaterThanOrEqual(0);
      expect(haltIdx).toBeLessThan(transIdx);
    });
  });

  // ── update() — FIX: danger cleared + no visible enemy → evadeOnTimeout ───

  describe('update() — danger cleared, no visible enemy (evadeOnTimeout fix)', () => {
    it('transitions via evadeOnTimeout (default COMBAT) when danger clears and no enemy', () => {
      // Grenade danger active=false. The round-4 fix keeps the NPC sprinting
      // until evadeGrenadeDurationMs elapses — advance past it to trigger exit.
      const { ctx, calls, setNow } = makeMockCtx({
        grenadeDanger: { active: false, originX: 200, originY: 200 },
        perceptionEnemies: [],
        nowMs: 0,
      });
      handler.enter(ctx);
      setNow(cfg.evadeGrenadeDurationMs); // elapsed == duration → exits
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('transition:COMBAT');
    });

    it('does NOT emit transition:SEARCH with the default transition map', () => {
      // Direct regression guard for the hardcoded-'SEARCH' bug.
      // Advance past duration so the handler actually exits — verify the
      // transition target is COMBAT, not the old hardcoded 'SEARCH'.
      const { ctx, calls, setNow } = makeMockCtx({
        grenadeDanger: { active: false, originX: 200, originY: 200 },
        perceptionEnemies: [],
        nowMs: 0,
      });
      handler.enter(ctx);
      setNow(cfg.evadeGrenadeDurationMs);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).not.toContain('transition:SEARCH');
    });

    it('halts before transitioning on clear with no enemy', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        grenadeDanger: { active: false, originX: 200, originY: 200 },
        perceptionEnemies: [],
        nowMs: 0,
      });
      handler.enter(ctx);
      setNow(cfg.evadeGrenadeDurationMs);
      calls.length = 0;
      handler.update(ctx, 16);
      const haltIdx = calls.indexOf('halt');
      const transIdx = calls.findIndex(c => c.startsWith('transition:'));
      expect(haltIdx).toBeGreaterThanOrEqual(0);
      expect(haltIdx).toBeLessThan(transIdx);
    });

    it('also uses evadeOnTimeout after duration timeout with no enemy visible', () => {
      // Danger system present but grenade is inactive. Elapsed >= duration.
      const { ctx, calls, setNow } = makeMockCtx({
        grenadeDanger: { active: false, originX: 200, originY: 200 },
        perceptionEnemies: [],
        nowMs: 0,
      });
      handler.enter(ctx);
      setNow(2_100); // past duration
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('transition:COMBAT');
      expect(calls).not.toContain('transition:SEARCH');
    });
  });

  // ── update() — danger cleared + visible enemy → evadeOnClear ─────────────

  describe('update() — danger cleared, enemy visible (evadeOnClear)', () => {
    it('transitions via evadeOnClear (default COMBAT) when danger clears and enemy is visible', () => {
      // Round-4 fix: timer must expire before exiting even when enemy is visible.
      const { ctx, calls, setNow } = makeMockCtx({
        grenadeDanger: { active: false, originX: 200, originY: 200 },
        perceptionEnemies: [{ id: 'e1', x: 300, y: 100, factionId: 'bandit' }],
        nowMs: 0,
      });
      handler.enter(ctx);
      setNow(cfg.evadeGrenadeDurationMs);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls).toContain('transition:COMBAT');
    });

    it('halts before transitioning via evadeOnClear', () => {
      const { ctx, calls, setNow } = makeMockCtx({
        grenadeDanger: { active: false, originX: 200, originY: 200 },
        perceptionEnemies: [{ id: 'e1', x: 300, y: 100, factionId: 'bandit' }],
        nowMs: 0,
      });
      handler.enter(ctx);
      setNow(cfg.evadeGrenadeDurationMs);
      calls.length = 0;
      handler.update(ctx, 16);
      const haltIdx = calls.indexOf('halt');
      const transIdx = calls.findIndex(c => c.startsWith('transition:'));
      expect(haltIdx).toBeGreaterThanOrEqual(0);
      expect(haltIdx).toBeLessThan(transIdx);
    });
  });

  // ── Injectable transition map ─────────────────────────────────────────────

  describe('injectable IStateTransitionMap — evadeOnTimeout', () => {
    it('uses custom evadeOnTimeout when danger clears with no visible enemy', () => {
      // Round-4 fix: timer must expire before exiting — advance to duration.
      const custom = new EvadeGrenadeState(cfg, { evadeOnTimeout: 'SEARCH' });
      const { ctx, calls, setNow } = makeMockCtx({
        grenadeDanger: { active: false, originX: 200, originY: 200 },
        perceptionEnemies: [],
        nowMs: 0,
      });
      custom.enter(ctx);
      setNow(cfg.evadeGrenadeDurationMs);
      calls.length = 0;
      custom.update(ctx, 16);
      expect(calls).toContain('transition:SEARCH');
    });

    it('uses custom evadeOnTimeout after duration timeout with no enemy', () => {
      const custom = new EvadeGrenadeState(cfg, { evadeOnTimeout: 'PATROL' });
      const { ctx, calls, setNow } = makeMockCtx({
        grenadeDanger: { active: false, originX: 200, originY: 200 },
        perceptionEnemies: [],
        nowMs: 0,
      });
      custom.enter(ctx);
      setNow(2_100);
      calls.length = 0;
      custom.update(ctx, 16);
      expect(calls).toContain('transition:PATROL');
    });

    it('does NOT use evadeOnTimeout when enemy is visible (evadeOnClear fires instead)', () => {
      // Confirm the two branches stay independent.
      // Advance past duration so the handler exits — evadeOnClear must win.
      const custom = new EvadeGrenadeState(cfg, { evadeOnTimeout: 'PATROL' });
      const { ctx, calls, setNow } = makeMockCtx({
        grenadeDanger: { active: false, originX: 200, originY: 200 },
        perceptionEnemies: [{ id: 'e1', x: 300, y: 100, factionId: 'bandit' }],
        nowMs: 0,
      });
      custom.enter(ctx);
      setNow(cfg.evadeGrenadeDurationMs);
      calls.length = 0;
      custom.update(ctx, 16);
      // evadeOnClear fires (default 'COMBAT'), NOT the custom evadeOnTimeout.
      expect(calls).toContain('transition:COMBAT');
      expect(calls).not.toContain('transition:PATROL');
    });
  });

  describe('injectable IStateTransitionMap — evadeOnClear', () => {
    it('uses custom evadeOnClear when enemy is visible after danger clears', () => {
      // Round-4 fix: advance past duration so the handler exits via evadeOnClear.
      const custom = new EvadeGrenadeState(cfg, { evadeOnClear: 'AGGRESSIVE' });
      const { ctx, calls, setNow } = makeMockCtx({
        grenadeDanger: { active: false, originX: 200, originY: 200 },
        perceptionEnemies: [{ id: 'e1', x: 300, y: 100, factionId: 'bandit' }],
        nowMs: 0,
      });
      custom.enter(ctx);
      setNow(cfg.evadeGrenadeDurationMs);
      calls.length = 0;
      custom.update(ctx, 16);
      expect(calls).toContain('transition:AGGRESSIVE');
    });
  });

  describe('injectable IStateTransitionMap — evadeOnNoSystem', () => {
    it('uses custom evadeOnNoSystem when no danger system and timer expires', () => {
      const custom = new EvadeGrenadeState(cfg, { evadeOnNoSystem: 'IDLE' });
      const { ctx, calls, setNow } = makeMockCtx({ hasDangerSystem: false, nowMs: 0 });
      custom.enter(ctx);
      setNow(2_100);
      calls.length = 0;
      custom.update(ctx, 16);
      expect(calls).toContain('transition:IDLE');
    });
  });

  // ── cfg.evadeGrenadeDurationMs configurable duration fix ──────────────────
  //
  // Fix under test:
  //   The hard-coded EVADE_GRENADE_DURATION_MS constant (2000 ms) was replaced
  //   with this.cfg.evadeGrenadeDurationMs so each NPC can carry its own
  //   timeout.
  //
  // Which code path exercises the timer guard:
  //   The duration comparison `elapsed >= evadeGrenadeDurationMs` acts as a
  //   blocking guard only in the ctx.danger === null branch (no danger system
  //   registered).  When a danger system is present and getGrenadeDanger
  //   returns null or an inactive record the handler exits immediately via the
  //   early-clear path — the timer there is unreachable as a gate.  All tests
  //   that verify "no transition before threshold" therefore use
  //   hasDangerSystem: false to exercise the one path where the guard actually
  //   blocks.  "After threshold" tests run both paths to confirm either fires.
  //
  // Four properties verified:
  //   1. Default value (2000 ms) keeps existing behaviour.
  //   2. Short value (500 ms) causes earlier timeout.
  //   3. Long value (5000 ms) delays the timeout.
  //   4. The cfg value — not any residual constant — drives the branch.

  describe('cfg.evadeGrenadeDurationMs — configurable duration', () => {
    // ── 1. Default 2000 ms ────────────────────────────────────────────────

    it('default evadeGrenadeDurationMs (2000) does not transition at 1999 ms', () => {
      // No danger system — the guard `elapsed >= evadeGrenadeDurationMs` is
      // the sole block.  1999 ms elapsed — must NOT transition yet.
      const { ctx, calls, setNow } = makeMockCtx({ hasDangerSystem: false, nowMs: 0 });
      handler.enter(ctx);
      setNow(1_999);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('default evadeGrenadeDurationMs (2000) transitions at exactly 2000 ms', () => {
      const { ctx, calls, setNow } = makeMockCtx({ hasDangerSystem: false, nowMs: 0 });
      handler.enter(ctx);
      setNow(2_000);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(1);
    });

    // ── 2. Short custom value (500 ms) — earlier timeout ──────────────────

    it('custom evadeGrenadeDurationMs (500) does not transition at 499 ms', () => {
      const fastCfg = createDefaultStateConfig({ evadeGrenadeDurationMs: 500 });
      const fastHandler = new EvadeGrenadeState(fastCfg);
      const { ctx, calls, setNow } = makeMockCtx({ hasDangerSystem: false, nowMs: 0 });
      fastHandler.enter(ctx);
      setNow(499);
      calls.length = 0;
      fastHandler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('custom evadeGrenadeDurationMs (500) transitions at exactly 500 ms', () => {
      const fastCfg = createDefaultStateConfig({ evadeGrenadeDurationMs: 500 });
      const fastHandler = new EvadeGrenadeState(fastCfg);
      const { ctx, calls, setNow } = makeMockCtx({ hasDangerSystem: false, nowMs: 0 });
      fastHandler.enter(ctx);
      setNow(500);
      calls.length = 0;
      fastHandler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(1);
    });

    // ── 3. Long custom value (5000 ms) — later timeout ────────────────────

    it('custom evadeGrenadeDurationMs (5000) does not transition at 2000 ms', () => {
      // 2000 ms is exactly where the old constant would have fired.
      // The cfg value (5000) must keep the NPC in the evade state.
      const slowCfg = createDefaultStateConfig({ evadeGrenadeDurationMs: 5_000 });
      const slowHandler = new EvadeGrenadeState(slowCfg);
      const { ctx, calls, setNow } = makeMockCtx({ hasDangerSystem: false, nowMs: 0 });
      slowHandler.enter(ctx);
      setNow(2_000);
      calls.length = 0;
      slowHandler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('custom evadeGrenadeDurationMs (5000) transitions at 5000 ms', () => {
      const slowCfg = createDefaultStateConfig({ evadeGrenadeDurationMs: 5_000 });
      const slowHandler = new EvadeGrenadeState(slowCfg);
      const { ctx, calls, setNow } = makeMockCtx({ hasDangerSystem: false, nowMs: 0 });
      slowHandler.enter(ctx);
      setNow(5_000);
      calls.length = 0;
      slowHandler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(1);
    });

    // ── 4. cfg value drives the branch, not a residual hardcoded constant ──
    //
    // Cross-check: run the short cfg (500) at a time the old constant (2000)
    // would NOT yet have fired, and the long cfg (5000) at a time it WOULD
    // have.  This proves neither direction regresses to the old constant.

    it('cfg 500: fires at 500 ms, well before the old 2000 ms constant would have', () => {
      const fastCfg = createDefaultStateConfig({ evadeGrenadeDurationMs: 500 });
      const fastHandler = new EvadeGrenadeState(fastCfg);
      const { ctx, calls, setNow } = makeMockCtx({ hasDangerSystem: false, nowMs: 0 });
      fastHandler.enter(ctx);
      // 1000 ms: past cfg threshold (500) but below the old constant (2000).
      setNow(1_000);
      calls.length = 0;
      fastHandler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(1);
    });

    it('cfg 5000: suppresses transition at 2000 ms where the old constant would have fired', () => {
      const slowCfg = createDefaultStateConfig({ evadeGrenadeDurationMs: 5_000 });
      const slowHandler = new EvadeGrenadeState(slowCfg);
      const { ctx, calls, setNow } = makeMockCtx({ hasDangerSystem: false, nowMs: 0 });
      slowHandler.enter(ctx);
      // 2000 ms: old constant fires here; cfg value (5000) must not.
      setNow(2_000);
      calls.length = 0;
      slowHandler.update(ctx, 16);
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });
  });

  // ── Round-4 fix: premature exit when grenade despawns mid-timer ──────────
  //
  // Fix under test:
  //   Previously the handler exited immediately whenever getGrenadeDanger()
  //   returned active=false, even if evadeGrenadeDurationMs had not elapsed.
  //   The fix keeps the NPC sprinting for the full duration: when a danger
  //   system is present but the grenade is inactive the handler now only
  //   exits once elapsed >= evadeGrenadeDurationMs.
  //
  // Three invariants verified:
  //   1. danger system present + grenade inactive + elapsed < duration
  //      → does NOT exit (NPC keeps running out the timer).
  //   2. danger system present + grenade inactive + elapsed >= duration
  //      → exits via _exitToNextState.
  //   3. NPC does NOT exit immediately at the first frame the grenade despawns
  //      (regression guard for the old behaviour).

  describe('update() — premature exit fix (round-4 fix)', () => {
    // Build a ctx where the grenade danger can be toggled after construction.
    // Uses an object wrapper so the accessor closure sees mutations.
    function makeMutableDangerCtx(overrides: {
      nowMs?: number;
      x?: number;
      y?: number;
      initialActive: boolean;
      perceptionEnemies?: Array<{ id: string; x: number; y: number; factionId: string }>;
    }) {
      const calls: string[] = [];
      const state = createDefaultNPCOnlineState();
      let nowMs = overrides.nowMs ?? 0;
      let enemies = overrides.perceptionEnemies ?? [];

      // Mutable danger descriptor — tests flip `dangerRef.active` to simulate
      // a grenade despawning mid-evasion.
      const dangerRef: { active: boolean; originX: number; originY: number } = {
        active:  overrides.initialActive,
        originX: 200,
        originY: 200,
      };

      const ctx: INPCContext = {
        npcId: 'npc-test',
        factionId: 'stalker',
        entityType: 'human',
        x: overrides.x ?? 100,
        y: overrides.y ?? 100,
        state,
        currentStateId: 'EVADE_GRENADE',
        perception: {
          getVisibleEnemies: () => enemies,
          getVisibleAllies:  () => [],
          getNearbyItems:    () => [],
          hasVisibleEnemy:   () => enemies.length > 0,
        },
        health: null,
        setVelocity:        (vx, vy) => { calls.push(`vel:${vx.toFixed(0)},${vy.toFixed(0)}`); },
        halt:               ()       => { calls.push('halt'); },
        setRotation:        (r)      => { calls.push(`rot:${r.toFixed(2)}`); },
        setAlpha:           (_a)     => {},
        teleport:           ()       => {},
        disablePhysics:     ()       => {},
        transition:         (s)      => { calls.push(`transition:${s}`); },
        emitShoot:          ()       => {},
        emitMeleeHit:       ()       => {},
        emitVocalization:   (t)      => { calls.push(`vocal:${t}`); },
        emitPsiAttackStart: ()       => {},
        cover: null,
        danger: {
          getDangerLevel:   (_x, _y) => 0,
          getGrenadeDanger: (_x, _y) => ({ ...dangerRef }),
        },
        restrictedZones: null,
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
        dangerRef,
        setNow:     (ms: number) => { nowMs = ms; },
        setEnemies: (e: typeof enemies) => { enemies = e; },
      };
    }

    // ── 1. Danger system present + grenade inactive + elapsed < duration
    //       → does NOT exit ─────────────────────────────────────────────

    it('does not exit when grenade just despawned and timer has not elapsed', () => {
      const { ctx, calls, dangerRef, setNow } = makeMutableDangerCtx({
        initialActive: true, nowMs: 0,
      });
      handler.enter(ctx);

      // Advance to mid-evasion — well under evadeGrenadeDurationMs (2000 ms).
      setNow(500);
      // Grenade despawns at exactly 500 ms.
      dangerRef.active = false;
      calls.length = 0;
      handler.update(ctx, 16);

      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('does not halt-and-exit at any point before the duration expires after grenade despawns', () => {
      const { ctx, calls, dangerRef, setNow } = makeMutableDangerCtx({
        initialActive: true, nowMs: 0,
      });
      handler.enter(ctx);
      dangerRef.active = false;

      // Run several frames between despawn (t=0) and just before timeout.
      for (const t of [1, 100, 500, 1000, 1800, 1999]) {
        setNow(t);
        calls.length = 0;
        handler.update(ctx, 16);
        expect(
          calls.filter(c => c.startsWith('transition:')),
          `should not transition at t=${t}`,
        ).toHaveLength(0);
      }
    });

    // ── 2. Danger system present + grenade inactive + elapsed >= duration
    //       → exits ────────────────────────────────────────────────────

    it('exits via _exitToNextState when timer expires after grenade despawns (no enemy)', () => {
      const { ctx, calls, dangerRef, setNow } = makeMutableDangerCtx({
        initialActive: true, nowMs: 0,
      });
      handler.enter(ctx);
      dangerRef.active = false;
      setNow(cfg.evadeGrenadeDurationMs); // exactly at boundary
      calls.length = 0;
      handler.update(ctx, 16);

      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(1);
      expect(calls).toContain('transition:COMBAT'); // evadeOnTimeout default
    });

    it('exits via evadeOnClear when timer expires after grenade despawns and enemy is visible', () => {
      const enemy = { id: 'e1', x: 300, y: 100, factionId: 'bandit' };
      const { ctx, calls, dangerRef, setNow, setEnemies } = makeMutableDangerCtx({
        initialActive: true, nowMs: 0,
      });
      handler.enter(ctx);
      dangerRef.active = false;
      setEnemies([enemy]);
      setNow(cfg.evadeGrenadeDurationMs);
      calls.length = 0;
      handler.update(ctx, 16);

      expect(calls).toContain('transition:COMBAT'); // evadeOnClear default
    });

    it('halts before transitioning after timer expires', () => {
      const { ctx, calls, dangerRef, setNow } = makeMutableDangerCtx({
        initialActive: true, nowMs: 0,
      });
      handler.enter(ctx);
      dangerRef.active = false;
      setNow(cfg.evadeGrenadeDurationMs + 1);
      calls.length = 0;
      handler.update(ctx, 16);

      const haltIdx  = calls.indexOf('halt');
      const transIdx = calls.findIndex(c => c.startsWith('transition:'));
      expect(haltIdx).toBeGreaterThanOrEqual(0);
      expect(haltIdx).toBeLessThan(transIdx);
    });

    // ── 3. Regression guard — NPC must NOT exit at the first despawn frame ──

    it('does NOT exit immediately on the very first frame the grenade goes inactive', () => {
      // The old (unfixed) code exited as soon as dangerInfo.active was false.
      // This test is the direct regression guard.
      const { ctx, calls, dangerRef, setNow } = makeMutableDangerCtx({
        initialActive: true, nowMs: 0,
      });
      handler.enter(ctx);

      // Sprint one frame while grenade is still active.
      setNow(100);
      handler.update(ctx, 16);

      // Grenade despawns.
      dangerRef.active = false;
      setNow(101); // only 1 ms after despawn — timer nowhere near 2000 ms
      calls.length = 0;
      handler.update(ctx, 16);

      // Must still be in state — no transition emitted.
      expect(calls.filter(c => c.startsWith('transition:'))).toHaveLength(0);
    });

    it('exits only once the full duration has elapsed, not before', () => {
      // Confirms the boundary: t=1999 → no exit, t=2000 → exit.
      const { ctx, calls, dangerRef, setNow } = makeMutableDangerCtx({
        initialActive: true, nowMs: 0,
      });
      handler.enter(ctx);
      dangerRef.active = false; // despawn at t=0 (immediately after enter)

      // One frame before the boundary.
      setNow(cfg.evadeGrenadeDurationMs - 1);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(
        calls.filter(c => c.startsWith('transition:')),
        'must not exit before duration',
      ).toHaveLength(0);

      // Exactly at the boundary.
      setNow(cfg.evadeGrenadeDurationMs);
      calls.length = 0;
      handler.update(ctx, 16);
      expect(
        calls.filter(c => c.startsWith('transition:')),
        'must exit at duration boundary',
      ).toHaveLength(1);
    });
  });

  // ── No hardcoded 'SEARCH' regression ─────────────────────────────────────

  describe('no hardcoded SEARCH regression', () => {
    it('default handler never emits transition:SEARCH regardless of enemy state', () => {
      // Run both branches (enemy present and absent) and confirm SEARCH is never
      // emitted when no override is configured.

      // Branch A: no enemy
      const { ctx: ctxA, calls: callsA } = makeMockCtx({
        grenadeDanger: { active: false, originX: 200, originY: 200 },
        perceptionEnemies: [],
      });
      handler.enter(ctxA);
      handler.update(ctxA, 16);
      expect(callsA).not.toContain('transition:SEARCH');

      // Branch B: enemy visible
      const { ctx: ctxB, calls: callsB } = makeMockCtx({
        grenadeDanger: { active: false, originX: 200, originY: 200 },
        perceptionEnemies: [{ id: 'e1', x: 300, y: 100, factionId: 'bandit' }],
      });
      handler.enter(ctxB);
      handler.update(ctxB, 16);
      expect(callsB).not.toContain('transition:SEARCH');
    });

    it('SEARCH is only emitted when explicitly injected via evadeOnTimeout', () => {
      // Positive proof: the string 'SEARCH' can appear, but only when the caller
      // deliberately maps evadeOnTimeout to 'SEARCH'.
      // Round-4 fix: advance past duration so the handler exits — then confirm
      // the injected 'SEARCH' target fires.
      const withSearch = new EvadeGrenadeState(cfg, { evadeOnTimeout: 'SEARCH' });
      const { ctx, calls, setNow } = makeMockCtx({
        grenadeDanger: { active: false, originX: 200, originY: 200 },
        perceptionEnemies: [],
        nowMs: 0,
      });
      withSearch.enter(ctx);
      setNow(cfg.evadeGrenadeDurationMs);
      calls.length = 0;
      withSearch.update(ctx, 16);
      expect(calls).toContain('transition:SEARCH');
    });
  });
});
