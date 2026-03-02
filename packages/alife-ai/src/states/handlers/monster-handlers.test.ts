// states/handlers/monster-handlers.test.ts
// Comprehensive tests for monster NPC state handlers:
//   MonsterCombatController, ChargeState, StalkState, LeapState, PsiAttackState

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { INPCContext } from '../INPCContext';
import type { INPCOnlineState } from '../INPCOnlineState';
import { createDefaultNPCOnlineState } from '../NPCOnlineState';
import { createDefaultStateConfig } from '../IStateConfig';
import type { IStateConfig } from '../IStateConfig';
import {
  MonsterCombatController,
  CHORNOBYL_ABILITY_SELECTOR,
} from './MonsterCombatController';
import type { MonsterAbilitySelector } from './MonsterCombatController';
import { ChargeState } from './ChargeState';
import { StalkState } from './StalkState';
import { LeapState } from './LeapState';
import { PsiAttackState } from './PsiAttackState';

// ---------------------------------------------------------------------------
// Shared helpers & mock factory
// ---------------------------------------------------------------------------

function makeVisibleEnemy(
  id = 'enemy-1',
  x = 200,
  y = 0,
  factionId = 'bandits',
) {
  return { id, x, y, factionId };
}

type MockMethods = {
  setVelocity: ReturnType<typeof vi.fn>;
  halt: ReturnType<typeof vi.fn>;
  setRotation: ReturnType<typeof vi.fn>;
  setAlpha: ReturnType<typeof vi.fn>;
  teleport: ReturnType<typeof vi.fn>;
  disablePhysics: ReturnType<typeof vi.fn>;
  transition: ReturnType<typeof vi.fn>;
  emitShoot: ReturnType<typeof vi.fn>;
  emitMeleeHit: ReturnType<typeof vi.fn>;
  emitVocalization: ReturnType<typeof vi.fn>;
  emitPsiAttackStart: ReturnType<typeof vi.fn>;
};

function makeMockCtx(
  overrides: Partial<{
    npcId: string;
    factionId: string;
    entityType: string;
    x: number;
    y: number;
    currentStateId: string;
    nowMs: number;
    enemies: ReturnType<typeof makeVisibleEnemy>[];
    hasEnemy: boolean;
  }> = {},
): INPCContext & MockMethods & { state: INPCOnlineState; _nowMs: number } {
  const state = createDefaultNPCOnlineState();
  let nowMs = overrides.nowMs ?? 0;

  const enemies = overrides.enemies ?? [];
  const hasEnemy = overrides.hasEnemy ?? enemies.length > 0;

  const ctx = {
    // Identity
    npcId: overrides.npcId ?? 'npc-1',
    factionId: overrides.factionId ?? 'bandits',
    entityType: overrides.entityType ?? 'monster',
    // Position
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    // State bag
    state,
    // FSM
    currentStateId: overrides.currentStateId ?? 'COMBAT',
    // Optional subsystems
    perception: {
      getVisibleEnemies: () => enemies,
      getVisibleAllies: () => [],
      getNearbyItems: () => [],
      hasVisibleEnemy: () => hasEnemy,
    },
    health: null,
    cover: null,
    danger: null,
    restrictedZones: null,
    squad: null,
    // Time & random
    now: () => nowMs,
    random: () => 0.5,
    // Movement & rendering
    setVelocity: vi.fn(),
    halt: vi.fn(),
    setRotation: vi.fn(),
    setAlpha: vi.fn(),
    teleport: vi.fn(),
    disablePhysics: vi.fn(),
    // FSM control
    transition: vi.fn(),
    // Events
    emitShoot: vi.fn(),
    emitMeleeHit: vi.fn(),
    emitVocalization: vi.fn(),
    emitPsiAttackStart: vi.fn(),
    // Expose for test manipulation
    _nowMs: nowMs,
  };

  // Allow advancing time from tests.
  Object.defineProperty(ctx, '_nowMs', {
    get: () => nowMs,
    set: (v: number) => { nowMs = v; },
  });

  return ctx as unknown as INPCContext & MockMethods & { state: INPCOnlineState; _nowMs: number };
}

const cfg: IStateConfig = createDefaultStateConfig();

// ---------------------------------------------------------------------------
// MonsterCombatController
// ---------------------------------------------------------------------------

describe('MonsterCombatController', () => {
  let handler: MonsterCombatController;

  beforeEach(() => {
    handler = new MonsterCombatController(cfg);
  });

  describe('enter / exit', () => {
    it('enter() does nothing (no-op)', () => {
      const ctx = makeMockCtx();
      handler.enter(ctx);
      expect(ctx.halt).not.toHaveBeenCalled();
      expect(ctx.transition).not.toHaveBeenCalled();
    });

    it('exit() does nothing (no-op)', () => {
      const ctx = makeMockCtx();
      handler.exit(ctx);
      expect(ctx.transition).not.toHaveBeenCalled();
    });
  });

  describe('no visible enemy', () => {
    it('transitions to SEARCH when last known position is non-zero', () => {
      const ctx = makeMockCtx({ hasEnemy: false, enemies: [] });
      ctx.state.lastKnownEnemyX = 100;
      ctx.state.lastKnownEnemyY = 200;
      handler.update(ctx, 16);
      expect(ctx.transition).toHaveBeenCalledWith('SEARCH');
    });

    it('transitions to IDLE when no enemy and no last known position', () => {
      const ctx = makeMockCtx({ hasEnemy: false, enemies: [] });
      ctx.state.lastKnownEnemyX = 0;
      ctx.state.lastKnownEnemyY = 0;
      handler.update(ctx, 16);
      expect(ctx.transition).toHaveBeenCalledWith('IDLE');
    });
  });

  describe('melee attack mechanics', () => {
    it('emits melee hit when enemy within meleeRange and cooldown expired', () => {
      const ctx = makeMockCtx({
        x: 0, y: 0,
        enemies: [makeVisibleEnemy('enemy-1', 10, 0)], // within 48px meleeRange
        hasEnemy: true,
      });
      ctx.state.lastMeleeMs = 0;
      ctx._nowMs = cfg.meleeCooldownMs + 1; // cooldown expired
      handler.update(ctx, 16);
      expect(ctx.emitMeleeHit).toHaveBeenCalledWith(
        expect.objectContaining({ npcId: 'npc-1', targetId: 'enemy-1', damage: cfg.meleeDamage }),
      );
    });

    it('does NOT emit melee hit when melee is on cooldown', () => {
      const ctx = makeMockCtx({
        x: 0, y: 0,
        enemies: [makeVisibleEnemy('enemy-1', 10, 0)], // within range
        hasEnemy: true,
      });
      ctx.state.lastMeleeMs = 999;
      ctx._nowMs = 1000; // only 1ms elapsed, cooldown is 1000ms
      handler.update(ctx, 16);
      expect(ctx.emitMeleeHit).not.toHaveBeenCalled();
    });

    it('does NOT emit melee hit when enemy is out of melee range', () => {
      const ctx = makeMockCtx({
        x: 0, y: 0,
        enemies: [makeVisibleEnemy('enemy-1', 200, 0)], // far away
        hasEnemy: true,
      });
      ctx._nowMs = cfg.meleeCooldownMs + 1;
      handler.update(ctx, 16);
      expect(ctx.emitMeleeHit).not.toHaveBeenCalled();
    });

    it('updates lastKnownEnemyX/Y from visible enemy', () => {
      const ctx = makeMockCtx({
        enemies: [makeVisibleEnemy('enemy-1', 123, 456)],
        hasEnemy: true,
      });
      handler.update(ctx, 16);
      expect(ctx.state.lastKnownEnemyX).toBe(123);
      expect(ctx.state.lastKnownEnemyY).toBe(456);
    });

    it('moves toward enemy when farther than meleeRange', () => {
      const ctx = makeMockCtx({
        x: 0, y: 0,
        enemies: [makeVisibleEnemy('enemy-1', 200, 0)],
        hasEnemy: true,
      });
      handler.update(ctx, 16);
      expect(ctx.setVelocity).toHaveBeenCalled();
    });

    it('halts when within meleeRange', () => {
      const ctx = makeMockCtx({
        x: 0, y: 0,
        enemies: [makeVisibleEnemy('enemy-1', 10, 0)], // within 48px
        hasEnemy: true,
      });
      ctx._nowMs = 0;
      ctx.state.lastMeleeMs = 0; // cooldown not expired yet (0 elapsed)
      handler.update(ctx, 16);
      expect(ctx.halt).toHaveBeenCalled();
    });
  });

  describe('ability transitions by entityType (CHORNOBYL_ABILITY_SELECTOR)', () => {
    let stalkerHandler: MonsterCombatController;
    beforeEach(() => {
      stalkerHandler = new MonsterCombatController(cfg, undefined, CHORNOBYL_ABILITY_SELECTOR);
    });

    function makeCtxAt(entityType: string, enemyDist: number, cooldownExpired = true) {
      const ctx = makeMockCtx({
        x: 0, y: 0,
        entityType,
        enemies: [makeVisibleEnemy('enemy-1', enemyDist, 0)],
        hasEnemy: true,
      });
      // Set cooldown expired: lastMeleeMs is far in the past
      ctx.state.lastMeleeMs = 0;
      ctx._nowMs = cooldownExpired ? cfg.meleeCooldownMs + 1 : 100;
      return ctx;
    }

    it('boar beyond meleeRange → transition CHARGE', () => {
      const ctx = makeCtxAt('boar', 100); // 100 > 48 meleeRange
      stalkerHandler.update(ctx, 16);
      expect(ctx.transition).toHaveBeenCalledWith('CHARGE');
    });

    it('boar within meleeRange → does NOT transition to CHARGE', () => {
      const ctx = makeCtxAt('boar', 10); // 10 < 48 meleeRange
      stalkerHandler.update(ctx, 16);
      expect(ctx.transition).not.toHaveBeenCalledWith('CHARGE');
    });

    it('bloodsucker far (dist > 2× meleeRange) → transition STALK', () => {
      const ctx = makeCtxAt('bloodsucker', 200); // 200 > 96 (2×48)
      stalkerHandler.update(ctx, 16);
      expect(ctx.transition).toHaveBeenCalledWith('STALK');
    });

    it('bloodsucker close (dist <= 2× meleeRange) → does NOT transition to STALK', () => {
      const ctx = makeCtxAt('bloodsucker', 50); // 50 < 96
      stalkerHandler.update(ctx, 16);
      expect(ctx.transition).not.toHaveBeenCalledWith('STALK');
    });

    it('snork in medium range (meleeRange < dist <= 3×meleeRange) → transition LEAP', () => {
      const ctx = makeCtxAt('snork', 100); // 48 < 100 <= 144
      stalkerHandler.update(ctx, 16);
      expect(ctx.transition).toHaveBeenCalledWith('LEAP');
    });

    it('snork too close (dist <= meleeRange) → does NOT transition to LEAP', () => {
      const ctx = makeCtxAt('snork', 10); // 10 < 48
      stalkerHandler.update(ctx, 16);
      expect(ctx.transition).not.toHaveBeenCalledWith('LEAP');
    });

    it('snork too far (dist > 3×meleeRange) → does NOT transition to LEAP', () => {
      const ctx = makeCtxAt('snork', 200); // 200 > 144
      stalkerHandler.update(ctx, 16);
      expect(ctx.transition).not.toHaveBeenCalledWith('LEAP');
    });

    it('controller beyond meleeRange → transition PSI_ATTACK', () => {
      const ctx = makeCtxAt('controller', 200);
      stalkerHandler.update(ctx, 16);
      expect(ctx.transition).toHaveBeenCalledWith('PSI_ATTACK');
    });

    it('controller within meleeRange → does NOT transition to PSI_ATTACK', () => {
      const ctx = makeCtxAt('controller', 10);
      stalkerHandler.update(ctx, 16);
      expect(ctx.transition).not.toHaveBeenCalledWith('PSI_ATTACK');
    });

    it('dog (unknown type) → no ability transition', () => {
      const ctx = makeCtxAt('dog', 200);
      stalkerHandler.update(ctx, 16);
      // No ability transition — basic melee only
      const calls = ctx.transition.mock.calls.flat();
      expect(calls).not.toContain('CHARGE');
      expect(calls).not.toContain('STALK');
      expect(calls).not.toContain('LEAP');
      expect(calls).not.toContain('PSI_ATTACK');
    });

    it('ability does NOT trigger when melee cooldown is still active', () => {
      const ctx = makeCtxAt('boar', 200, false); // cooldown NOT expired
      stalkerHandler.update(ctx, 16);
      // Should NOT transition to CHARGE since cooldown active
      expect(ctx.transition).not.toHaveBeenCalledWith('CHARGE');
    });
  });

  describe('injectable MonsterAbilitySelector', () => {
    it('default (no selector) never triggers ability transitions', () => {
      // handler from beforeEach uses default () => null selector
      const ctx = makeMockCtx({
        x: 0, y: 0,
        entityType: 'boar',
        enemies: [makeVisibleEnemy('enemy-1', 200, 0)],
        hasEnemy: true,
      });
      ctx.state.lastMeleeMs = 0;
      ctx._nowMs = cfg.meleeCooldownMs + 1; // cooldown expired
      handler.update(ctx, 16);
      const calls = ctx.transition.mock.calls.flat();
      expect(calls).not.toContain('CHARGE');
      expect(calls).not.toContain('STALK');
      expect(calls).not.toContain('LEAP');
      expect(calls).not.toContain('PSI_ATTACK');
    });

    it('custom selector returning a state ID triggers that transition', () => {
      const customSelector: MonsterAbilitySelector = () => 'custom_ability';
      const customHandler = new MonsterCombatController(cfg, undefined, customSelector);

      const ctx = makeMockCtx({
        x: 0, y: 0,
        entityType: 'dog',
        enemies: [makeVisibleEnemy('enemy-1', 200, 0)],
        hasEnemy: true,
      });
      ctx.state.lastMeleeMs = 0;
      ctx._nowMs = cfg.meleeCooldownMs + 1; // cooldown expired
      customHandler.update(ctx, 16);
      expect(ctx.transition).toHaveBeenCalledWith('custom_ability');
    });

    it('custom selector returning null stays in combat (no ability transition)', () => {
      const nullSelector: MonsterAbilitySelector = () => null;
      const customHandler = new MonsterCombatController(cfg, undefined, nullSelector);

      const ctx = makeMockCtx({
        x: 0, y: 0,
        entityType: 'boar',
        enemies: [makeVisibleEnemy('enemy-1', 200, 0)],
        hasEnemy: true,
      });
      ctx.state.lastMeleeMs = 0;
      ctx._nowMs = cfg.meleeCooldownMs + 1; // cooldown expired
      customHandler.update(ctx, 16);
      // No ability transition fired
      expect(ctx.transition).not.toHaveBeenCalled();
    });

    it('custom transition map remaps monsterOnNoEnemy', () => {
      const customHandler = new MonsterCombatController(cfg, { monsterOnNoEnemy: 'wander' });
      const ctx = makeMockCtx({ hasEnemy: false, enemies: [] });
      ctx.state.lastKnownEnemyX = 0;
      ctx.state.lastKnownEnemyY = 0;
      customHandler.update(ctx, 16);
      expect(ctx.transition).toHaveBeenCalledWith('wander');
    });

    it('custom transition map remaps monsterOnLastKnown', () => {
      const customHandler = new MonsterCombatController(cfg, { monsterOnLastKnown: 'hunt' });
      const ctx = makeMockCtx({ hasEnemy: false, enemies: [] });
      ctx.state.lastKnownEnemyX = 100;
      ctx.state.lastKnownEnemyY = 200;
      customHandler.update(ctx, 16);
      expect(ctx.transition).toHaveBeenCalledWith('hunt');
    });
  });

  describe('pack coordination (opt-in)', () => {
    it('broadcasts COMBAT + target when enemy visible', () => {
      const ctx = makeMockCtx({
        x: 0, y: 0,
        enemies: [makeVisibleEnemy('e1', 10, 20)],
        hasEnemy: true,
      });
      const mockPack = {
        getPackAlertLevel: vi.fn(() => 'NONE' as const),
        getPackTarget: vi.fn(() => null),
        broadcastTarget: vi.fn(),
        broadcastAlertLevel: vi.fn(),
      };
      (ctx as any).pack = mockPack;
      ctx.state.packLastBroadcastMs = 0;
      ctx._nowMs = 1000;
      handler.update(ctx, 16);
      expect(mockPack.broadcastTarget).toHaveBeenCalledWith('e1', 10, 20);
      expect(mockPack.broadcastAlertLevel).toHaveBeenCalledWith('COMBAT');
    });

    it('throttled: does not broadcast twice within packAlertIntervalMs', () => {
      const ctx = makeMockCtx({
        x: 0, y: 0,
        enemies: [makeVisibleEnemy('e1', 10, 20)],
        hasEnemy: true,
      });
      const mockPack = {
        getPackAlertLevel: vi.fn(() => 'NONE' as const),
        getPackTarget: vi.fn(() => null),
        broadcastTarget: vi.fn(),
        broadcastAlertLevel: vi.fn(),
      };
      (ctx as any).pack = mockPack;
      // packLastBroadcastMs = 800, now = 1000, interval = 500 → 200 < 500 → throttled
      ctx.state.packLastBroadcastMs = 800;
      ctx._nowMs = 1000;
      handler.update(ctx, 16);
      expect(mockPack.broadcastTarget).not.toHaveBeenCalled();
    });

    it('broadcasts again after packAlertIntervalMs elapsed', () => {
      const ctx = makeMockCtx({
        x: 0, y: 0,
        enemies: [makeVisibleEnemy('e1', 10, 20)],
        hasEnemy: true,
      });
      const mockPack = {
        getPackAlertLevel: vi.fn(() => 'NONE' as const),
        getPackTarget: vi.fn(() => null),
        broadcastTarget: vi.fn(),
        broadcastAlertLevel: vi.fn(),
      };
      (ctx as any).pack = mockPack;
      // packLastBroadcastMs = 400, now = 1000, interval = 500 → 600 >= 500 → broadcasts
      ctx.state.packLastBroadcastMs = 400;
      ctx._nowMs = 1000;
      handler.update(ctx, 16);
      expect(mockPack.broadcastTarget).toHaveBeenCalledWith('e1', 10, 20);
      expect(mockPack.broadcastAlertLevel).toHaveBeenCalledWith('COMBAT');
    });

    it('null pack → no throw', () => {
      const ctx = makeMockCtx({
        x: 0, y: 0,
        enemies: [makeVisibleEnemy('e1', 10, 20)],
        hasEnemy: true,
      });
      // pack is omitted / null — should not throw
      (ctx as any).pack = null;
      ctx.state.packLastBroadcastMs = 0;
      ctx._nowMs = 1000;
      expect(() => handler.update(ctx, 16)).not.toThrow();
    });
  });

  describe('CHORNOBYL_ABILITY_SELECTOR', () => {
    it('boar at dist > meleeRange → CHARGE', () => {
      expect(CHORNOBYL_ABILITY_SELECTOR('boar', cfg.meleeRange + 1, cfg)).toBe('CHARGE');
    });

    it('boar at dist <= meleeRange → null', () => {
      expect(CHORNOBYL_ABILITY_SELECTOR('boar', cfg.meleeRange - 1, cfg)).toBeNull();
    });

    it('bloodsucker at dist > 2×meleeRange → STALK', () => {
      expect(CHORNOBYL_ABILITY_SELECTOR('bloodsucker', cfg.meleeRange * 2 + 1, cfg)).toBe('STALK');
    });

    it('bloodsucker at dist <= 2×meleeRange → null', () => {
      expect(CHORNOBYL_ABILITY_SELECTOR('bloodsucker', cfg.meleeRange * 2 - 1, cfg)).toBeNull();
    });

    it('snork in medium range (meleeRange < dist <= 3×) → LEAP', () => {
      expect(CHORNOBYL_ABILITY_SELECTOR('snork', cfg.meleeRange + 1, cfg)).toBe('LEAP');
      expect(CHORNOBYL_ABILITY_SELECTOR('snork', cfg.meleeRange * 3, cfg)).toBe('LEAP');
    });

    it('snork too close → null', () => {
      expect(CHORNOBYL_ABILITY_SELECTOR('snork', cfg.meleeRange - 1, cfg)).toBeNull();
    });

    it('snork too far → null', () => {
      expect(CHORNOBYL_ABILITY_SELECTOR('snork', cfg.meleeRange * 3 + 1, cfg)).toBeNull();
    });

    it('controller at dist > meleeRange → PSI_ATTACK', () => {
      expect(CHORNOBYL_ABILITY_SELECTOR('controller', cfg.meleeRange + 1, cfg)).toBe('PSI_ATTACK');
    });

    it('controller at dist <= meleeRange → null', () => {
      expect(CHORNOBYL_ABILITY_SELECTOR('controller', cfg.meleeRange - 1, cfg)).toBeNull();
    });

    it('unknown entity type → null', () => {
      expect(CHORNOBYL_ABILITY_SELECTOR('dog', 999, cfg)).toBeNull();
      expect(CHORNOBYL_ABILITY_SELECTOR('zombie', 999, cfg)).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// ChargeState
// ---------------------------------------------------------------------------

describe('ChargeState', () => {
  let handler: ChargeState;

  beforeEach(() => {
    handler = new ChargeState(cfg);
  });

  describe('lazy initialization of chargePhase', () => {
    it('chargePhase is undefined before enter() is called', () => {
      const ctx = makeMockCtx();
      // State is fresh — chargePhase should not be present.
      expect(ctx.state.chargePhase).toBeUndefined();
    });

    it('chargePhase is defined after enter() is called', () => {
      const ctx = makeMockCtx({
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
      });
      handler.enter(ctx);
      expect(ctx.state.chargePhase).toBeDefined();
    });
  });

  describe('enter()', () => {
    it('sets chargePhase.active = true', () => {
      const ctx = makeMockCtx({
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
      });
      handler.enter(ctx);
      expect(ctx.state.chargePhase?.active).toBe(true);
    });

    it('sets chargePhase.charging = false', () => {
      const ctx = makeMockCtx({
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
      });
      handler.enter(ctx);
      expect(ctx.state.chargePhase?.charging).toBe(false);
    });

    it('stores windupStartMs from ctx.now()', () => {
      const ctx = makeMockCtx({
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
        nowMs: 5000,
      });
      handler.enter(ctx);
      expect(ctx.state.chargePhase?.windupStartMs).toBe(5000);
    });

    it('stores target position from visible enemy', () => {
      const ctx = makeMockCtx({
        enemies: [makeVisibleEnemy('enemy-1', 150, 75)],
        hasEnemy: true,
      });
      handler.enter(ctx);
      expect(ctx.state.chargePhase?.targetX).toBe(150);
      expect(ctx.state.chargePhase?.targetY).toBe(75);
    });

    it('falls back to lastKnownEnemyX/Y when no visible enemy', () => {
      const ctx = makeMockCtx({ hasEnemy: false, enemies: [] });
      ctx.state.lastKnownEnemyX = 300;
      ctx.state.lastKnownEnemyY = 200;
      handler.enter(ctx);
      expect(ctx.state.chargePhase?.targetX).toBe(300);
      expect(ctx.state.chargePhase?.targetY).toBe(200);
    });

    it('calls halt() to stop during windup', () => {
      const ctx = makeMockCtx({
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
      });
      handler.enter(ctx);
      expect(ctx.halt).toHaveBeenCalled();
    });
  });

  describe('exit()', () => {
    it('sets chargePhase.active = false when chargePhase exists', () => {
      const ctx = makeMockCtx();
      // Call enter() first so chargePhase is initialized.
      handler.enter(ctx);
      ctx.state.chargePhase!.active = true;
      handler.exit(ctx);
      expect(ctx.state.chargePhase?.active).toBe(false);
    });

    it('does not throw when chargePhase is undefined', () => {
      const ctx = makeMockCtx();
      // chargePhase not initialized — should not crash.
      expect(() => handler.exit(ctx)).not.toThrow();
    });
  });

  describe('update() — windup phase', () => {
    it('does NOT move during windup (does not call setVelocity with non-zero)', () => {
      const ctx = makeMockCtx({
        x: 0, y: 0,
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
        nowMs: 0,
      });
      handler.enter(ctx);
      // Only 100ms elapsed — windup is 600ms
      ctx._nowMs = 100;
      handler.update(ctx, 100);
      // setVelocity should not have been called during windup (only halt + rotation)
      expect(ctx.setVelocity).not.toHaveBeenCalled();
    });

    it('transitions to chargeOnAbort (IDLE) when no visible enemy during windup', () => {
      const ctx = makeMockCtx({ hasEnemy: false, enemies: [] });
      // Initialize chargePhase manually since enter() was not called.
      ctx.state.chargePhase = { active: true, windupStartMs: 0, charging: false, targetX: 0, targetY: 0 };
      ctx._nowMs = 100; // windup not finished
      handler.update(ctx, 100);
      expect(ctx.transition).toHaveBeenCalledWith('IDLE');
    });

    it('begins charging after windup completes', () => {
      const ctx = makeMockCtx({
        x: 0, y: 0,
        enemies: [makeVisibleEnemy('enemy-1', 200, 0)],
        hasEnemy: true,
        nowMs: 0,
      });
      handler.enter(ctx);
      ctx._nowMs = cfg.chargeWindupMs + 10; // windup complete
      handler.update(ctx, cfg.chargeWindupMs + 10);
      expect(ctx.state.chargePhase?.charging).toBe(true);
    });
  });

  describe('update() — charging phase', () => {
    function setupCharging(enemyX: number, npcX = 0) {
      const ctx = makeMockCtx({
        x: npcX, y: 0,
        enemies: [makeVisibleEnemy('enemy-1', enemyX, 0)],
        hasEnemy: true,
        nowMs: 0,
      });
      handler.enter(ctx);
      // Advance past windup to start charging
      ctx._nowMs = cfg.chargeWindupMs + 10;
      handler.update(ctx, cfg.chargeWindupMs + 10);
      return ctx;
    }

    it('moves toward target during charge at charge speed', () => {
      const ctx = setupCharging(200);
      // Should call setVelocity once charging starts
      expect(ctx.setVelocity).toHaveBeenCalled();
      const [vx] = ctx.setVelocity.mock.calls[ctx.setVelocity.mock.calls.length - 1];
      expect(vx).toBeGreaterThan(0); // moving in positive X direction
    });

    it('emits melee hit with chargeDamageMultiplier on impact', () => {
      // Place NPC just outside meleeRange, target just inside
      const ctx = makeMockCtx({
        x: 0, y: 0,
        enemies: [makeVisibleEnemy('enemy-1', 10, 0)], // within meleeRange
        hasEnemy: true,
        nowMs: 0,
      });
      handler.enter(ctx);
      // Force charging state
      ctx.state.chargePhase!.charging = true;
      ctx.state.chargePhase!.targetX = 10;
      ctx.state.chargePhase!.targetY = 0;
      ctx._nowMs = cfg.chargeWindupMs + 100;
      handler.update(ctx, 100);
      expect(ctx.emitMeleeHit).toHaveBeenCalledWith(
        expect.objectContaining({
          damage: cfg.meleeDamage * cfg.chargeDamageMultiplier,
        }),
      );
    });

    it('transitions to chargeOnComplete (COMBAT) after impact', () => {
      const ctx = makeMockCtx({
        x: 0, y: 0,
        enemies: [makeVisibleEnemy('enemy-1', 10, 0)],
        hasEnemy: true,
        nowMs: cfg.chargeWindupMs + 100,
      });
      handler.enter(ctx);
      ctx.state.chargePhase!.charging = true;
      ctx.state.chargePhase!.windupStartMs = 0;
      ctx.state.chargePhase!.targetX = 10;
      ctx.state.chargePhase!.targetY = 0;
      handler.update(ctx, 100);
      expect(ctx.transition).toHaveBeenCalledWith('COMBAT');
    });

    it('charge damage is greater than normal melee damage', () => {
      expect(cfg.meleeDamage * cfg.chargeDamageMultiplier).toBeGreaterThan(cfg.meleeDamage);
    });
  });

  describe('injectable transition map', () => {
    it('remaps chargeOnAbort to a custom state', () => {
      const customHandler = new ChargeState(cfg, { chargeOnAbort: 'wander' });
      const ctx = makeMockCtx({ hasEnemy: false, enemies: [] });
      ctx.state.chargePhase = { active: true, windupStartMs: 0, charging: false, targetX: 0, targetY: 0 };
      ctx._nowMs = 100;
      customHandler.update(ctx, 100);
      expect(ctx.transition).toHaveBeenCalledWith('wander');
    });

    it('remaps chargeOnComplete to a custom state', () => {
      const customHandler = new ChargeState(cfg, { chargeOnComplete: 'melee_follow' });
      const ctx = makeMockCtx({
        x: 0, y: 0,
        enemies: [makeVisibleEnemy('enemy-1', 10, 0)],
        hasEnemy: true,
        nowMs: cfg.chargeWindupMs + 100,
      });
      customHandler.enter(ctx);
      ctx.state.chargePhase!.charging = true;
      ctx.state.chargePhase!.targetX = 10;
      ctx.state.chargePhase!.targetY = 0;
      customHandler.update(ctx, 100);
      expect(ctx.transition).toHaveBeenCalledWith('melee_follow');
    });
  });
});

// ---------------------------------------------------------------------------
// StalkState
// ---------------------------------------------------------------------------

describe('StalkState', () => {
  let handler: StalkState;

  beforeEach(() => {
    handler = new StalkState(cfg);
  });

  describe('lazy initialization of stalkPhase', () => {
    it('stalkPhase is undefined before enter() is called', () => {
      const ctx = makeMockCtx();
      expect(ctx.state.stalkPhase).toBeUndefined();
    });

    it('stalkPhase is defined after enter() is called', () => {
      const ctx = makeMockCtx();
      handler.enter(ctx);
      expect(ctx.state.stalkPhase).toBeDefined();
    });
  });

  describe('enter()', () => {
    it('sets alpha to stalkAlphaInvisible', () => {
      const ctx = makeMockCtx();
      handler.enter(ctx);
      expect(ctx.setAlpha).toHaveBeenCalledWith(cfg.stalkAlphaInvisible);
    });

    it('sets stalkPhase.active = true', () => {
      const ctx = makeMockCtx();
      handler.enter(ctx);
      expect(ctx.state.stalkPhase?.active).toBe(true);
    });

    it('sets stalkPhase.approaching = false', () => {
      const ctx = makeMockCtx();
      // Pre-initialize with approaching=true to verify reset.
      ctx.state.stalkPhase = { active: false, approaching: true };
      handler.enter(ctx);
      expect(ctx.state.stalkPhase?.approaching).toBe(false);
    });

    it('uses a very small alpha value (nearly invisible)', () => {
      const ctx = makeMockCtx();
      handler.enter(ctx);
      const alphaArg = ctx.setAlpha.mock.calls[0][0];
      expect(alphaArg).toBeLessThan(0.2);
    });
  });

  describe('exit()', () => {
    it('restores alpha to 1.0', () => {
      const ctx = makeMockCtx();
      handler.enter(ctx);
      handler.exit(ctx);
      expect(ctx.setAlpha).toHaveBeenCalledWith(1.0);
    });

    it('sets stalkPhase.active = false when stalkPhase exists', () => {
      const ctx = makeMockCtx();
      handler.enter(ctx);
      ctx.state.stalkPhase!.active = true;
      handler.exit(ctx);
      expect(ctx.state.stalkPhase?.active).toBe(false);
    });

    it('does not throw when stalkPhase is undefined', () => {
      const ctx = makeMockCtx();
      // stalkPhase not initialized.
      expect(() => handler.exit(ctx)).not.toThrow();
    });

    it('restores alpha even if state was interrupted mid-approach', () => {
      const ctx = makeMockCtx();
      handler.enter(ctx);
      ctx.state.stalkPhase!.active = true;
      ctx.state.stalkPhase!.approaching = false;
      handler.exit(ctx);
      const alphaCalls = ctx.setAlpha.mock.calls.map(c => c[0]);
      expect(alphaCalls).toContain(1.0);
    });
  });

  describe('update() — approach phase', () => {
    it('transitions to stalkOnNoEnemy (SEARCH) when no visible enemy', () => {
      const ctx = makeMockCtx({ hasEnemy: false, enemies: [] });
      handler.enter(ctx);
      vi.clearAllMocks();
      handler.update(ctx, 16);
      expect(ctx.transition).toHaveBeenCalledWith('SEARCH');
    });

    it('moves toward enemy during approach (far away)', () => {
      const ctx = makeMockCtx({
        x: 0, y: 0,
        enemies: [makeVisibleEnemy('enemy-1', 300, 0)], // far > stalkUnclockDistance (80)
        hasEnemy: true,
      });
      handler.enter(ctx);
      vi.clearAllMocks();
      handler.update(ctx, 16);
      expect(ctx.setVelocity).toHaveBeenCalled();
      const [vx] = ctx.setVelocity.mock.calls[0];
      expect(vx).toBeGreaterThan(0); // moving toward enemy
    });

    it('stalk speed is slower than full approachSpeed', () => {
      const ctx = makeMockCtx({
        x: 0, y: 0,
        enemies: [makeVisibleEnemy('enemy-1', 300, 0)],
        hasEnemy: true,
      });
      handler.enter(ctx);
      vi.clearAllMocks();
      handler.update(ctx, 16);
      const [vx] = ctx.setVelocity.mock.calls[0];
      const stalkSpeed = cfg.approachSpeed * cfg.stalkSpeedMultiplier;
      expect(Math.abs(vx)).toBeCloseTo(stalkSpeed, 0);
    });

    it('sets approaching flag when within stalkUnclockDistance', () => {
      const dist = cfg.stalkUnclockDistance - 1; // just inside threshold
      const ctx = makeMockCtx({
        x: 0, y: 0,
        enemies: [makeVisibleEnemy('enemy-1', dist, 0)],
        hasEnemy: true,
      });
      handler.enter(ctx);
      vi.clearAllMocks();
      handler.update(ctx, 16);
      expect(ctx.state.stalkPhase?.approaching).toBe(true);
    });
  });

  describe('update() — uncloak phase', () => {
    it('restores alpha to 1.0 when approaching', () => {
      const ctx = makeMockCtx({
        x: 0, y: 0,
        enemies: [makeVisibleEnemy('enemy-1', 10, 0)], // very close
        hasEnemy: true,
      });
      handler.enter(ctx);
      vi.clearAllMocks();
      // First update sets approaching = true
      handler.update(ctx, 16);
      vi.clearAllMocks();
      // Second update triggers uncloak
      handler.update(ctx, 16);
      const alphaCalls = ctx.setAlpha.mock.calls.map(c => c[0]);
      expect(alphaCalls).toContain(1.0);
    });

    it('transitions to stalkOnAttack (COMBAT) after uncloaking', () => {
      const ctx = makeMockCtx({
        x: 0, y: 0,
        enemies: [makeVisibleEnemy('enemy-1', 10, 0)],
        hasEnemy: true,
      });
      handler.enter(ctx);
      // First update: entering uncloak
      handler.update(ctx, 16);
      vi.clearAllMocks();
      // Second update: should transition COMBAT
      handler.update(ctx, 16);
      expect(ctx.transition).toHaveBeenCalledWith('COMBAT');
    });

    it('calls halt() when uncloaking', () => {
      const ctx = makeMockCtx({
        x: 0, y: 0,
        enemies: [makeVisibleEnemy('enemy-1', 10, 0)],
        hasEnemy: true,
      });
      handler.enter(ctx);
      handler.update(ctx, 16); // approaching = true
      vi.clearAllMocks();
      handler.update(ctx, 16); // uncloak
      expect(ctx.halt).toHaveBeenCalled();
    });
  });

  describe('injectable transition map', () => {
    it('remaps stalkOnNoEnemy to a custom state', () => {
      const customHandler = new StalkState(cfg, { stalkOnNoEnemy: 'hunt' });
      const ctx = makeMockCtx({ hasEnemy: false, enemies: [] });
      customHandler.enter(ctx);
      vi.clearAllMocks();
      customHandler.update(ctx, 16);
      expect(ctx.transition).toHaveBeenCalledWith('hunt');
    });

    it('remaps stalkOnAttack to a custom state', () => {
      const customHandler = new StalkState(cfg, { stalkOnAttack: 'ambush' });
      const ctx = makeMockCtx({
        x: 0, y: 0,
        enemies: [makeVisibleEnemy('enemy-1', 10, 0)],
        hasEnemy: true,
      });
      customHandler.enter(ctx);
      customHandler.update(ctx, 16); // approaching = true
      vi.clearAllMocks();
      customHandler.update(ctx, 16); // uncloak → ambush
      expect(ctx.transition).toHaveBeenCalledWith('ambush');
    });
  });
});

// ---------------------------------------------------------------------------
// LeapState
// ---------------------------------------------------------------------------

describe('LeapState', () => {
  let handler: LeapState;

  beforeEach(() => {
    handler = new LeapState(cfg);
  });

  describe('lazy initialization of leapPhase', () => {
    it('leapPhase is undefined before enter() is called', () => {
      const ctx = makeMockCtx();
      expect(ctx.state.leapPhase).toBeUndefined();
    });

    it('leapPhase is defined after enter() is called', () => {
      const ctx = makeMockCtx({
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
      });
      handler.enter(ctx);
      expect(ctx.state.leapPhase).toBeDefined();
    });
  });

  describe('enter()', () => {
    it('sets leapPhase.active = true', () => {
      const ctx = makeMockCtx({
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
        nowMs: 1000,
      });
      handler.enter(ctx);
      expect(ctx.state.leapPhase?.active).toBe(true);
    });

    it('sets leapPhase.airborne = false', () => {
      const ctx = makeMockCtx({
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
      });
      handler.enter(ctx);
      expect(ctx.state.leapPhase?.airborne).toBe(false);
    });

    it('stores windupStartMs from ctx.now()', () => {
      const ctx = makeMockCtx({
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
        nowMs: 2000,
      });
      handler.enter(ctx);
      expect(ctx.state.leapPhase?.windupStartMs).toBe(2000);
    });

    it('stores NPC position as startX/Y', () => {
      const ctx = makeMockCtx({
        x: 50, y: 75,
        enemies: [makeVisibleEnemy('enemy-1', 200, 100)],
        hasEnemy: true,
      });
      handler.enter(ctx);
      expect(ctx.state.leapPhase?.startX).toBe(50);
      expect(ctx.state.leapPhase?.startY).toBe(75);
    });

    it('stores enemy position as targetX/Y', () => {
      const ctx = makeMockCtx({
        x: 0, y: 0,
        enemies: [makeVisibleEnemy('enemy-1', 200, 150)],
        hasEnemy: true,
      });
      handler.enter(ctx);
      expect(ctx.state.leapPhase?.targetX).toBe(200);
      expect(ctx.state.leapPhase?.targetY).toBe(150);
    });

    it('calls halt() during windup', () => {
      const ctx = makeMockCtx({
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
      });
      handler.enter(ctx);
      expect(ctx.halt).toHaveBeenCalled();
    });
  });

  describe('exit()', () => {
    it('sets leapPhase.active = false when leapPhase exists', () => {
      const ctx = makeMockCtx({
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
      });
      handler.enter(ctx);
      ctx.state.leapPhase!.active = true;
      handler.exit(ctx);
      expect(ctx.state.leapPhase?.active).toBe(false);
    });

    it('does not throw when leapPhase is undefined', () => {
      const ctx = makeMockCtx();
      expect(() => handler.exit(ctx)).not.toThrow();
    });
  });

  describe('update() — windup phase', () => {
    it('does not begin airborne before leapWindupMs', () => {
      const ctx = makeMockCtx({
        x: 0, y: 0,
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
        nowMs: 0,
      });
      handler.enter(ctx);
      ctx._nowMs = cfg.leapWindupMs - 10; // before windup ends
      handler.update(ctx, cfg.leapWindupMs - 10);
      expect(ctx.state.leapPhase?.airborne).toBe(false);
    });

    it('sets airborne = true after windup completes', () => {
      const ctx = makeMockCtx({
        x: 0, y: 0,
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
        nowMs: 0,
      });
      handler.enter(ctx);
      ctx._nowMs = cfg.leapWindupMs + 1;
      handler.update(ctx, cfg.leapWindupMs + 1);
      expect(ctx.state.leapPhase?.airborne).toBe(true);
    });

    it('does not teleport during windup', () => {
      const ctx = makeMockCtx({
        x: 0, y: 0,
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
        nowMs: 0,
      });
      handler.enter(ctx);
      ctx._nowMs = cfg.leapWindupMs / 2;
      handler.update(ctx, cfg.leapWindupMs / 2);
      expect(ctx.teleport).not.toHaveBeenCalled();
    });
  });

  describe('update() — airborne phase', () => {
    function setupAirborne(enemyX = 200, npcX = 0) {
      const ctx = makeMockCtx({
        x: npcX, y: 0,
        enemies: [makeVisibleEnemy('enemy-1', enemyX, 0)],
        hasEnemy: true,
        nowMs: 0,
      });
      handler.enter(ctx);
      // Skip to airborne phase
      ctx._nowMs = cfg.leapWindupMs + 1;
      handler.update(ctx, cfg.leapWindupMs + 1);
      vi.clearAllMocks();
      return ctx;
    }

    it('calls teleport() during airborne phase', () => {
      const ctx = setupAirborne();
      ctx._nowMs = cfg.leapWindupMs + 50; // partway through airtime
      handler.update(ctx, 50);
      expect(ctx.teleport).toHaveBeenCalled();
    });

    it('teleported position is between start and target at midpoint', () => {
      const ctx = setupAirborne(200, 0);
      const airStart = ctx.state.leapPhase!.airStartMs;
      ctx._nowMs = airStart + cfg.leapAirtimeMs / 2; // halfway
      handler.update(ctx, cfg.leapAirtimeMs / 2);
      const [tx] = ctx.teleport.mock.calls[0];
      // Should be ~halfway between 0 and 200
      expect(tx).toBeGreaterThan(0);
      expect(tx).toBeLessThan(200);
    });

    it('emits melee hit upon landing', () => {
      const ctx = setupAirborne(100, 0);
      const airStart = ctx.state.leapPhase!.airStartMs;
      ctx._nowMs = airStart + cfg.leapAirtimeMs + 1; // past airtime
      handler.update(ctx, cfg.leapAirtimeMs + 1);
      expect(ctx.emitMeleeHit).toHaveBeenCalledWith(
        expect.objectContaining({ npcId: 'npc-1', damage: cfg.meleeDamage }),
      );
    });

    it('transitions to leapOnLand (COMBAT) after landing', () => {
      const ctx = setupAirborne(100, 0);
      const airStart = ctx.state.leapPhase!.airStartMs;
      ctx._nowMs = airStart + cfg.leapAirtimeMs + 1;
      handler.update(ctx, cfg.leapAirtimeMs + 1);
      expect(ctx.transition).toHaveBeenCalledWith('COMBAT');
    });

    it('teleports to target position on landing', () => {
      const ctx = setupAirborne(100, 0);
      const airStart = ctx.state.leapPhase!.airStartMs;
      ctx._nowMs = airStart + cfg.leapAirtimeMs + 1;
      handler.update(ctx, cfg.leapAirtimeMs + 1);
      // Should teleport to target position
      const lastTeleport = ctx.teleport.mock.calls[ctx.teleport.mock.calls.length - 1];
      expect(lastTeleport[0]).toBe(100);
      expect(lastTeleport[1]).toBe(0);
    });
  });

  describe('injectable transition map', () => {
    it('remaps leapOnLand to a custom state', () => {
      const customHandler = new LeapState(cfg, { leapOnLand: 'melee_follow' });
      const ctx = makeMockCtx({
        x: 0, y: 0,
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
        nowMs: 0,
      });
      customHandler.enter(ctx);
      // Skip to airborne
      ctx._nowMs = cfg.leapWindupMs + 1;
      customHandler.update(ctx, cfg.leapWindupMs + 1);
      vi.clearAllMocks();
      // Complete airtime
      const airStart = ctx.state.leapPhase!.airStartMs;
      ctx._nowMs = airStart + cfg.leapAirtimeMs + 1;
      customHandler.update(ctx, cfg.leapAirtimeMs + 1);
      expect(ctx.transition).toHaveBeenCalledWith('melee_follow');
    });
  });
});

// ---------------------------------------------------------------------------
// PsiAttackState
// ---------------------------------------------------------------------------

describe('PsiAttackState', () => {
  let handler: PsiAttackState;

  beforeEach(() => {
    handler = new PsiAttackState(cfg);
  });

  describe('lazy initialization of psiPhase', () => {
    it('psiPhase is undefined before enter() is called', () => {
      const ctx = makeMockCtx();
      expect(ctx.state.psiPhase).toBeUndefined();
    });

    it('psiPhase is defined after enter() is called', () => {
      const ctx = makeMockCtx({
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
      });
      handler.enter(ctx);
      expect(ctx.state.psiPhase).toBeDefined();
    });
  });

  describe('enter()', () => {
    it('sets psiPhase.active = true', () => {
      const ctx = makeMockCtx({
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
      });
      handler.enter(ctx);
      expect(ctx.state.psiPhase?.active).toBe(true);
    });

    it('stores channelStartMs from ctx.now()', () => {
      const ctx = makeMockCtx({
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
        nowMs: 3000,
      });
      handler.enter(ctx);
      expect(ctx.state.psiPhase?.channelStartMs).toBe(3000);
    });

    it('emits PSI attack start event', () => {
      const ctx = makeMockCtx({
        x: 50, y: 75,
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
      });
      handler.enter(ctx);
      expect(ctx.emitPsiAttackStart).toHaveBeenCalledWith(50, 75);
    });

    it('calls halt() to stand still while channeling', () => {
      const ctx = makeMockCtx({
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
      });
      handler.enter(ctx);
      expect(ctx.halt).toHaveBeenCalled();
    });

    it('updates lastKnownEnemyX/Y from visible enemy', () => {
      const ctx = makeMockCtx({
        enemies: [makeVisibleEnemy('enemy-1', 123, 456)],
        hasEnemy: true,
      });
      handler.enter(ctx);
      expect(ctx.state.lastKnownEnemyX).toBe(123);
      expect(ctx.state.lastKnownEnemyY).toBe(456);
    });
  });

  describe('exit()', () => {
    it('sets psiPhase.active = false when psiPhase exists', () => {
      const ctx = makeMockCtx({
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
      });
      handler.enter(ctx);
      ctx.state.psiPhase!.active = true;
      handler.exit(ctx);
      expect(ctx.state.psiPhase?.active).toBe(false);
    });

    it('does not throw when psiPhase is undefined', () => {
      const ctx = makeMockCtx();
      expect(() => handler.exit(ctx)).not.toThrow();
    });
  });

  describe('update() — channel phase', () => {
    it('transitions to psiOnNoEnemy (IDLE) when no visible enemy', () => {
      const ctx = makeMockCtx({ hasEnemy: false, enemies: [] });
      ctx.state.psiPhase = { active: true, channelStartMs: 0 };
      ctx._nowMs = 100;
      handler.update(ctx, 100);
      expect(ctx.transition).toHaveBeenCalledWith('IDLE');
    });

    it('does NOT emit damage during channel phase', () => {
      const ctx = makeMockCtx({
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
        nowMs: 0,
      });
      handler.enter(ctx);
      ctx._nowMs = cfg.psiChannelMs / 2; // halfway through channel
      handler.update(ctx, cfg.psiChannelMs / 2);
      expect(ctx.emitMeleeHit).not.toHaveBeenCalled();
    });

    it('calls halt() every frame during channel (stays still)', () => {
      const ctx = makeMockCtx({
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
        nowMs: 0,
      });
      handler.enter(ctx);
      vi.clearAllMocks();
      ctx._nowMs = cfg.psiChannelMs / 2;
      handler.update(ctx, cfg.psiChannelMs / 2);
      expect(ctx.halt).toHaveBeenCalled();
    });

    it('does NOT transition to COMBAT before channel completes', () => {
      const ctx = makeMockCtx({
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
        nowMs: 0,
      });
      handler.enter(ctx);
      ctx._nowMs = cfg.psiChannelMs - 1;
      handler.update(ctx, cfg.psiChannelMs - 1);
      expect(ctx.transition).not.toHaveBeenCalledWith('COMBAT');
    });

    it('updates target position during channel from visible enemies', () => {
      const ctx = makeMockCtx({
        enemies: [makeVisibleEnemy('enemy-1', 500, 300)],
        hasEnemy: true,
        nowMs: 0,
      });
      handler.enter(ctx);
      ctx._nowMs = cfg.psiChannelMs / 2;
      handler.update(ctx, cfg.psiChannelMs / 2);
      expect(ctx.state.lastKnownEnemyX).toBe(500);
      expect(ctx.state.lastKnownEnemyY).toBe(300);
    });
  });

  describe('update() — channel complete', () => {
    function setupChannelComplete() {
      const ctx = makeMockCtx({
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
        nowMs: 0,
      });
      handler.enter(ctx);
      return ctx;
    }

    it('emits melee hit (PSI damage) after channel completes', () => {
      const ctx = setupChannelComplete();
      ctx._nowMs = cfg.psiChannelMs + 1;
      handler.update(ctx, cfg.psiChannelMs + 1);
      expect(ctx.emitMeleeHit).toHaveBeenCalledWith(
        expect.objectContaining({ npcId: 'npc-1', damage: cfg.meleeDamage }),
      );
    });

    it('transitions to psiOnComplete (COMBAT) after channel completes', () => {
      const ctx = setupChannelComplete();
      ctx._nowMs = cfg.psiChannelMs + 1;
      handler.update(ctx, cfg.psiChannelMs + 1);
      expect(ctx.transition).toHaveBeenCalledWith('COMBAT');
    });

    it('updates lastMeleeMs when PSI fires', () => {
      const ctx = setupChannelComplete();
      ctx._nowMs = cfg.psiChannelMs + 1;
      handler.update(ctx, cfg.psiChannelMs + 1);
      expect(ctx.state.lastMeleeMs).toBe(cfg.psiChannelMs + 1);
    });

    it('includes targetId in melee hit payload', () => {
      const ctx = setupChannelComplete();
      ctx.state.targetId = 'enemy-1';
      ctx._nowMs = cfg.psiChannelMs + 1;
      handler.update(ctx, cfg.psiChannelMs + 1);
      expect(ctx.emitMeleeHit).toHaveBeenCalledWith(
        expect.objectContaining({ targetId: 'enemy-1' }),
      );
    });
  });

  describe('injectable transition map', () => {
    it('remaps psiOnNoEnemy to a custom state', () => {
      const customHandler = new PsiAttackState(cfg, { psiOnNoEnemy: 'wander' });
      const ctx = makeMockCtx({ hasEnemy: false, enemies: [] });
      ctx.state.psiPhase = { active: true, channelStartMs: 0 };
      ctx._nowMs = 100;
      customHandler.update(ctx, 100);
      expect(ctx.transition).toHaveBeenCalledWith('wander');
    });

    it('remaps psiOnComplete to a custom state', () => {
      const customHandler = new PsiAttackState(cfg, { psiOnComplete: 'psi_drain' });
      const ctx = makeMockCtx({
        enemies: [makeVisibleEnemy('enemy-1', 100, 0)],
        hasEnemy: true,
        nowMs: 0,
      });
      customHandler.enter(ctx);
      ctx._nowMs = cfg.psiChannelMs + 1;
      customHandler.update(ctx, cfg.psiChannelMs + 1);
      expect(ctx.transition).toHaveBeenCalledWith('psi_drain');
    });
  });
});
