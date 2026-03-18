// states/handlers/CombatTransitionHandler.test.ts
// Unit tests for the CombatTransitionHandler transition-map fix.
//
// Focus areas:
//   1. Default tr wiring: chain result strings map to the correct default state IDs.
//   2. Custom tr overrides: constructor's _tr parameter is applied to each mapped key.
//   3. Unknown chain results fall through unchanged (EVADE_GRENADE, GRENADE).
//   4. Partial overrides only affect specified keys; unspecified keys keep their defaults.

import { describe, it, expect, beforeEach } from 'vitest';
import { CombatTransitionHandler } from './CombatTransitionHandler';
import { createDefaultStateConfig } from '../IStateConfig';
import { createDefaultNPCOnlineState } from '../NPCOnlineState';
import type { INPCContext } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';
import type { ITransitionRule } from '../../combat/CombatTransitionChain';

// ---------------------------------------------------------------------------
// Mock helpers — mirrors the style in combat-handlers.test.ts
// ---------------------------------------------------------------------------

interface MockOverrides {
  perceptionEnemies?: Array<{ id: string; x: number; y: number; factionId: string }>;
  hpPercent?: number;
  nowMs?: number;
  moraleState?: 'STABLE' | 'SHAKEN' | 'PANICKED';
  morale?: number;
  primaryWeapon?: string | null;
  secondaryWeapon?: string | null;
  woundedStartMs?: number;
  targetLockUntilMs?: number;
  hasExplosiveDanger?: boolean;
  lastKnownEnemyX?: number;
  lastKnownEnemyY?: number;
  grenadeCount?: number;
}

function makeMockCtx(overrides: MockOverrides = {}): {
  ctx: INPCContext;
  calls: string[];
  state: ReturnType<typeof createDefaultNPCOnlineState>;
  setNow: (ms: number) => void;
} {
  const calls: string[] = [];
  const state = createDefaultNPCOnlineState();

  if (overrides.moraleState !== undefined) state.moraleState = overrides.moraleState;
  if (overrides.morale !== undefined) state.morale = overrides.morale;
  if (overrides.primaryWeapon !== undefined) state.primaryWeapon = overrides.primaryWeapon;
  if (overrides.secondaryWeapon !== undefined) state.secondaryWeapon = overrides.secondaryWeapon;
  if (overrides.woundedStartMs !== undefined) state.woundedStartMs = overrides.woundedStartMs;
  if (overrides.targetLockUntilMs !== undefined) state.targetLockUntilMs = overrides.targetLockUntilMs;
  if (overrides.lastKnownEnemyX !== undefined) state.lastKnownEnemyX = overrides.lastKnownEnemyX;
  if (overrides.lastKnownEnemyY !== undefined) state.lastKnownEnemyY = overrides.lastKnownEnemyY;
  if (overrides.grenadeCount !== undefined) state.grenadeCount = overrides.grenadeCount;

  let nowMs = overrides.nowMs ?? 0;

  const enemies = overrides.perceptionEnemies ?? [
    { id: 'e1', x: 200, y: 200, factionId: 'bandit' },
  ];

  const hpPercent = overrides.hpPercent ?? 1;

  const ctx: INPCContext = {
    npcId: 'npc-1',
    factionId: 'stalker',
    entityType: 'human',
    x: 100,
    y: 100,
    state,
    currentStateId: 'COMBAT',
    perception: {
      getVisibleEnemies: () => enemies,
      getVisibleAllies: () => [],
      getNearbyItems: () => [],
      hasVisibleEnemy: () => enemies.length > 0,
      getWoundedEnemies: () => [],
    },
    health: {
      hp: hpPercent * 100,
      maxHp: 100,
      hpPercent,
      heal: () => {},
    },
    setVelocity: () => {},
    halt: () => {},
    setRotation: () => {},
    setAlpha: () => {},
    teleport: () => {},
    disablePhysics: () => {},
    transition: (s) => { calls.push(`transition:${s}`); },
    emitShoot: () => {},
    emitMeleeHit: () => {},
    emitVocalization: () => {},
    emitPsiAttackStart: () => {},
    cover: null,
    danger:
      overrides.hasExplosiveDanger !== undefined
        ? {
            getDangerLevel: () => (overrides.hasExplosiveDanger ? 1 : 0),
            getGrenadeDanger: () =>
              overrides.hasExplosiveDanger
                ? { active: true, originX: 100, originY: 100 }
                : null,
          }
        : null,
    restrictedZones: null,
    squad: null,
    now: () => nowMs,
    random: () => 0.5,
  };

  return {
    ctx,
    calls,
    state,
    setNow: (ms: number) => { nowMs = ms; },
  };
}

// Construct a handler wired to a single custom rule that always returns the
// given result string. This lets each test drive _resolveTransition() in
// complete isolation from the real combat-rule evaluation logic.
function makeHandlerWithFixedResult(
  cfg: IStateConfig,
  chainResult: string,
  trOverrides?: Record<string, string>,
): CombatTransitionHandler {
  const rule: ITransitionRule = {
    name: 'fixed',
    priority: 999,
    evaluate: () => chainResult,
  };
  return new CombatTransitionHandler(cfg, {}, [rule], trOverrides);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CombatTransitionHandler — transition map', () => {
  let cfg: IStateConfig;

  beforeEach(() => {
    cfg = createDefaultStateConfig();
  });

  // -------------------------------------------------------------------------
  // 1. Default transitions
  // -------------------------------------------------------------------------

  describe('default tr wiring', () => {
    it('WOUNDED chain result → default combatOnWounded state (WOUNDED)', () => {
      const handler = makeHandlerWithFixedResult(cfg, 'WOUNDED');
      const { ctx, calls } = makeMockCtx();
      handler.update(ctx, 16);
      expect(calls).toContain('transition:WOUNDED');
    });

    it('RETREAT chain result → default combatOnShaken state (RETREAT)', () => {
      const handler = makeHandlerWithFixedResult(cfg, 'RETREAT');
      const { ctx, calls } = makeMockCtx();
      handler.update(ctx, 16);
      expect(calls).toContain('transition:RETREAT');
    });

    it('FLEE chain result → default combatOnPanicked state (FLEE)', () => {
      const handler = makeHandlerWithFixedResult(cfg, 'FLEE');
      const { ctx, calls } = makeMockCtx();
      handler.update(ctx, 16);
      expect(calls).toContain('transition:FLEE');
    });

    it('SEARCH chain result → default combatOnLastKnown state (SEARCH)', () => {
      const handler = makeHandlerWithFixedResult(cfg, 'SEARCH');
      const { ctx, calls } = makeMockCtx();
      handler.update(ctx, 16);
      expect(calls).toContain('transition:SEARCH');
    });
  });

  // -------------------------------------------------------------------------
  // 2. Custom tr overrides are respected
  // -------------------------------------------------------------------------

  describe('custom tr overrides', () => {
    it('WOUNDED chain result uses custom combatOnWounded override', () => {
      const handler = makeHandlerWithFixedResult(cfg, 'WOUNDED', {
        combatOnWounded: 'CUSTOM_WOUNDED',
      });
      const { ctx, calls } = makeMockCtx();
      handler.update(ctx, 16);
      expect(calls).toContain('transition:CUSTOM_WOUNDED');
      expect(calls).not.toContain('transition:WOUNDED');
    });

    it('RETREAT chain result uses custom combatOnShaken override', () => {
      const handler = makeHandlerWithFixedResult(cfg, 'RETREAT', {
        combatOnShaken: 'tactical_withdrawal',
      });
      const { ctx, calls } = makeMockCtx();
      handler.update(ctx, 16);
      expect(calls).toContain('transition:tactical_withdrawal');
      expect(calls).not.toContain('transition:RETREAT');
    });

    it('FLEE chain result uses custom combatOnPanicked override', () => {
      const handler = makeHandlerWithFixedResult(cfg, 'FLEE', {
        combatOnPanicked: 'shamble_away',
      });
      const { ctx, calls } = makeMockCtx();
      handler.update(ctx, 16);
      expect(calls).toContain('transition:shamble_away');
      expect(calls).not.toContain('transition:FLEE');
    });

    it('SEARCH chain result uses custom combatOnLastKnown override', () => {
      const handler = makeHandlerWithFixedResult(cfg, 'SEARCH', {
        combatOnLastKnown: 'investigate',
      });
      const { ctx, calls } = makeMockCtx();
      handler.update(ctx, 16);
      expect(calls).toContain('transition:investigate');
      expect(calls).not.toContain('transition:SEARCH');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Unknown chain results pass through unchanged
  // -------------------------------------------------------------------------

  describe('unknown chain results pass through unchanged', () => {
    it('EVADE_GRENADE passes through as-is (not in tr map)', () => {
      const handler = makeHandlerWithFixedResult(cfg, 'EVADE_GRENADE');
      const { ctx, calls } = makeMockCtx();
      handler.update(ctx, 16);
      expect(calls).toContain('transition:EVADE_GRENADE');
    });

    it('GRENADE passes through as-is (not in tr map)', () => {
      const handler = makeHandlerWithFixedResult(cfg, 'GRENADE');
      const { ctx, calls } = makeMockCtx();
      handler.update(ctx, 16);
      expect(calls).toContain('transition:GRENADE');
    });

    it('arbitrary unknown result passes through unchanged', () => {
      const handler = makeHandlerWithFixedResult(cfg, 'DEAD');
      const { ctx, calls } = makeMockCtx();
      handler.update(ctx, 16);
      expect(calls).toContain('transition:DEAD');
    });

    it('custom tr overrides do not affect pass-through of EVADE_GRENADE', () => {
      // Even when tr overrides are present for other keys, unmapped results
      // still fall through verbatim.
      const handler = makeHandlerWithFixedResult(cfg, 'EVADE_GRENADE', {
        combatOnWounded: 'CUSTOM_WOUNDED',
        combatOnShaken: 'tactical_withdrawal',
      });
      const { ctx, calls } = makeMockCtx();
      handler.update(ctx, 16);
      expect(calls).toContain('transition:EVADE_GRENADE');
    });
  });

  // -------------------------------------------------------------------------
  // 4. Partial overrides only affect specified keys
  // -------------------------------------------------------------------------

  describe('partial tr overrides only affect specified keys', () => {
    it('overriding combatOnWounded does not change combatOnShaken default', () => {
      // Handler wired to return RETREAT so combatOnShaken is exercised.
      const handler = makeHandlerWithFixedResult(cfg, 'RETREAT', {
        combatOnWounded: 'MY_WOUNDED',
        // combatOnShaken intentionally not overridden
      });
      const { ctx, calls } = makeMockCtx();
      handler.update(ctx, 16);
      // RETREAT maps through combatOnShaken which must still be the default 'RETREAT' state.
      expect(calls).toContain('transition:RETREAT');
    });

    it('overriding combatOnShaken does not change combatOnPanicked default', () => {
      const handler = makeHandlerWithFixedResult(cfg, 'FLEE', {
        combatOnShaken: 'tactical_withdrawal',
        // combatOnPanicked intentionally not overridden
      });
      const { ctx, calls } = makeMockCtx();
      handler.update(ctx, 16);
      expect(calls).toContain('transition:FLEE');
    });

    it('overriding combatOnPanicked does not change combatOnLastKnown default', () => {
      const handler = makeHandlerWithFixedResult(cfg, 'SEARCH', {
        combatOnPanicked: 'shamble_away',
        // combatOnLastKnown intentionally not overridden
      });
      const { ctx, calls } = makeMockCtx();
      handler.update(ctx, 16);
      expect(calls).toContain('transition:SEARCH');
    });

    it('overriding combatOnLastKnown does not change combatOnWounded default', () => {
      const handler = makeHandlerWithFixedResult(cfg, 'WOUNDED', {
        combatOnLastKnown: 'investigate',
        // combatOnWounded intentionally not overridden
      });
      const { ctx, calls } = makeMockCtx();
      handler.update(ctx, 16);
      expect(calls).toContain('transition:WOUNDED');
    });

    it('multiple simultaneous overrides each apply to their respective chain results', () => {
      // Build two separate handlers — one per result — sharing the same tr overrides.
      const trOverrides = {
        combatOnWounded: 'MY_WOUNDED',
        combatOnShaken: 'MY_RETREAT',
      };

      const woundedHandler = makeHandlerWithFixedResult(cfg, 'WOUNDED', trOverrides);
      const { ctx: ctxW, calls: callsW } = makeMockCtx();
      woundedHandler.update(ctxW, 16);
      expect(callsW).toContain('transition:MY_WOUNDED');

      const retreatHandler = makeHandlerWithFixedResult(cfg, 'RETREAT', trOverrides);
      const { ctx: ctxR, calls: callsR } = makeMockCtx();
      retreatHandler.update(ctxR, 16);
      expect(callsR).toContain('transition:MY_RETREAT');
    });
  });

  // -------------------------------------------------------------------------
  // 5. Integration: default rules produce the correct mapped output
  // -------------------------------------------------------------------------

  describe('integration: real combat rules + tr map', () => {
    it('panicked NPC triggers FLEE via default combatOnPanicked', () => {
      const handler = new CombatTransitionHandler(cfg);
      const { ctx, calls } = makeMockCtx({ moraleState: 'PANICKED', morale: -1 });
      handler.update(ctx, 16);
      expect(calls).toContain('transition:FLEE');
    });

    it('critically low HP triggers WOUNDED via default combatOnWounded', () => {
      const handler = new CombatTransitionHandler(cfg);
      const { ctx, calls } = makeMockCtx({
        hpPercent: cfg.woundedHpThreshold - 0.05,
        moraleState: 'STABLE',
        woundedStartMs: 0,
      });
      handler.update(ctx, 16);
      expect(calls).toContain('transition:WOUNDED');
    });

    it('explosive danger triggers EVADE_GRENADE (pass-through)', () => {
      const handler = new CombatTransitionHandler(cfg);
      const { ctx, calls } = makeMockCtx({
        hpPercent: 0.9,
        moraleState: 'STABLE',
        hasExplosiveDanger: true,
      });
      handler.update(ctx, 16);
      expect(calls).toContain('transition:EVADE_GRENADE');
    });

    it('panicked NPC uses custom combatOnPanicked with real combat rules', () => {
      const handler = new CombatTransitionHandler(cfg, {}, undefined, {
        combatOnPanicked: 'zombie_scatter',
      });
      const { ctx, calls } = makeMockCtx({ moraleState: 'PANICKED', morale: -1 });
      handler.update(ctx, 16);
      expect(calls).toContain('transition:zombie_scatter');
      expect(calls).not.toContain('transition:FLEE');
    });

    it('critically low HP uses custom combatOnWounded with real combat rules', () => {
      const handler = new CombatTransitionHandler(cfg, {}, undefined, {
        combatOnWounded: 'crawl_to_safety',
      });
      const { ctx, calls } = makeMockCtx({
        hpPercent: cfg.woundedHpThreshold - 0.05,
        moraleState: 'STABLE',
        woundedStartMs: 0,
      });
      handler.update(ctx, 16);
      expect(calls).toContain('transition:crawl_to_safety');
      expect(calls).not.toContain('transition:WOUNDED');
    });

    it('enemy lost for extended time triggers SEARCH via default combatOnLastKnown', () => {
      const handler = new CombatTransitionHandler(cfg);
      const { ctx, calls, state, setNow } = makeMockCtx({
        perceptionEnemies: [],
        hpPercent: 0.9,
        moraleState: 'STABLE',
        morale: 0.1,
        primaryWeapon: 'rifle',
      });
      state.lastShootMs = 10;
      setNow(10 + 3100); // past lostSightThresholdMs (3000ms default)
      handler.update(ctx, 16);
      expect(calls).toContain('transition:SEARCH');
    });

    it('enemy lost for extended time uses custom combatOnLastKnown override', () => {
      const handler = new CombatTransitionHandler(cfg, {}, undefined, {
        combatOnLastKnown: 'hunt_down',
      });
      const { ctx, calls, state, setNow } = makeMockCtx({
        perceptionEnemies: [],
        hpPercent: 0.9,
        moraleState: 'STABLE',
        morale: 0.1,
        primaryWeapon: 'rifle',
      });
      state.lastShootMs = 10;
      setNow(10 + 3100);
      handler.update(ctx, 16);
      expect(calls).toContain('transition:hunt_down');
      expect(calls).not.toContain('transition:SEARCH');
    });
  });

  // -------------------------------------------------------------------------
  // 6. No transition when chain returns null
  // -------------------------------------------------------------------------

  describe('no transition when chain returns null', () => {
    it('does not call ctx.transition when evaluateTransitions returns null', () => {
      const noFireRule: ITransitionRule = {
        name: 'noFire',
        priority: 999,
        evaluate: () => null,
      };
      const handler = new CombatTransitionHandler(cfg, {}, [noFireRule]);
      const { ctx, calls } = makeMockCtx();
      handler.update(ctx, 16);
      expect(calls.some(c => c.startsWith('transition:'))).toBe(false);
    });
  });
});
