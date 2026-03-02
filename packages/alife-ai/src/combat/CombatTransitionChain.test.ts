import { describe, it, expect } from 'vitest';
import {
  evaluateTransitions,
  DEFAULT_COMBAT_RULES,
  createDefaultCombatTransitionConfig,
  WoundedRule,
  NoAmmoRule,
  EvadeDangerRule,
  MoraleRule,
  GrenadeOpportunityRule,
  SearchRule,
} from './CombatTransitionChain';
import type { ICombatContext } from './CombatTransitionChain';
import { WeaponCategory } from '../types/IWeaponTypes';
import type { INPCLoadout, IWeaponSlot } from '../types/IWeaponTypes';
import { createDefaultAIConfig } from '../config/createDefaultAIConfig';

const weaponConfig = createDefaultAIConfig().weapon;
const cfg = createDefaultCombatTransitionConfig();

function makeSlot(category: WeaponCategory, ammo = 10): IWeaponSlot {
  const c = weaponConfig.weapons[category];
  return { category, ammo, maxAmmo: c.defaultAmmo, range: c.range, damage: c.damage, fireRate: c.fireRate };
}

function makeLoadout(overrides?: Partial<INPCLoadout>): INPCLoadout {
  return {
    primary: makeSlot(WeaponCategory.RIFLE),
    secondary: makeSlot(WeaponCategory.PISTOL),
    grenades: 2,
    medkits: 1,
    ...overrides,
  };
}

function makeContext(overrides?: Partial<ICombatContext>): ICombatContext {
  return {
    hpRatio: 0.8,
    moraleValue: 0,
    isPanicked: false,
    lostSightMs: 0,
    distanceToEnemy: 200,
    visibleEnemyCount: 1,
    loadout: makeLoadout(),
    canSwitchTarget: true,
    timeSinceWoundedMs: Infinity,
    hasExplosiveDanger: false,
    hasAmmo: true,
    ...overrides,
  };
}

describe('CombatTransitionChain', () => {
  describe('WoundedRule', () => {
    it('triggers WOUNDED below HP threshold', () => {
      const ctx = makeContext({ hpRatio: 0.15, timeSinceWoundedMs: Infinity });
      expect(WoundedRule.evaluate(ctx, cfg)).toBe('WOUNDED');
    });

    it('respects reentry cooldown', () => {
      const ctx = makeContext({ hpRatio: 0.15, timeSinceWoundedMs: 5000 });
      expect(WoundedRule.evaluate(ctx, cfg)).toBeNull();
    });

    it('passes when HP is fine', () => {
      const ctx = makeContext({ hpRatio: 0.5 });
      expect(WoundedRule.evaluate(ctx, cfg)).toBeNull();
    });
  });

  describe('NoAmmoRule', () => {
    it('triggers RETREAT when no ammo', () => {
      const ctx = makeContext({ hasAmmo: false });
      expect(NoAmmoRule.evaluate(ctx, cfg)).toBe('RETREAT');
    });

    it('passes when has ammo', () => {
      const ctx = makeContext({ hasAmmo: true });
      expect(NoAmmoRule.evaluate(ctx, cfg)).toBeNull();
    });
  });

  describe('EvadeDangerRule', () => {
    it('triggers EVADE_GRENADE on explosive danger', () => {
      const ctx = makeContext({ hasExplosiveDanger: true });
      expect(EvadeDangerRule.evaluate(ctx, cfg)).toBe('EVADE_GRENADE');
    });

    it('passes when no danger', () => {
      const ctx = makeContext({ hasExplosiveDanger: false });
      expect(EvadeDangerRule.evaluate(ctx, cfg)).toBeNull();
    });
  });

  describe('MoraleRule', () => {
    it('triggers FLEE when panicked', () => {
      const ctx = makeContext({ isPanicked: true });
      expect(MoraleRule.evaluate(ctx, cfg)).toBe('FLEE');
    });

    it('triggers RETREAT on low morale if can switch target', () => {
      const ctx = makeContext({ moraleValue: -0.5, canSwitchTarget: true });
      expect(MoraleRule.evaluate(ctx, cfg)).toBe('RETREAT');
    });

    it('passes on low morale if cannot switch target', () => {
      const ctx = makeContext({ moraleValue: -0.5, canSwitchTarget: false });
      expect(MoraleRule.evaluate(ctx, cfg)).toBeNull();
    });

    it('passes when morale is fine', () => {
      const ctx = makeContext({ moraleValue: 0 });
      expect(MoraleRule.evaluate(ctx, cfg)).toBeNull();
    });
  });

  describe('GrenadeOpportunityRule', () => {
    it('triggers GRENADE when conditions met', () => {
      const ctx = makeContext({
        lostSightMs: 2500,
        visibleEnemyCount: 2,
        distanceToEnemy: 150,
        loadout: makeLoadout({ grenades: 1 }),
      });
      expect(GrenadeOpportunityRule.evaluate(ctx, cfg)).toBe('GRENADE');
    });

    it('passes when lost sight too recently', () => {
      const ctx = makeContext({ lostSightMs: 1000 });
      expect(GrenadeOpportunityRule.evaluate(ctx, cfg)).toBeNull();
    });

    it('passes when lost sight too long (search takes over)', () => {
      const ctx = makeContext({ lostSightMs: 4000 });
      expect(GrenadeOpportunityRule.evaluate(ctx, cfg)).toBeNull();
    });

    it('passes when no grenades', () => {
      const ctx = makeContext({
        lostSightMs: 2500,
        visibleEnemyCount: 2,
        loadout: makeLoadout({ grenades: 0 }),
      });
      expect(GrenadeOpportunityRule.evaluate(ctx, cfg)).toBeNull();
    });

    it('passes when enemy out of throw range', () => {
      const ctx = makeContext({ lostSightMs: 2500, distanceToEnemy: 500 });
      expect(GrenadeOpportunityRule.evaluate(ctx, cfg)).toBeNull();
    });
  });

  describe('SearchRule', () => {
    it('triggers SEARCH after lost sight threshold', () => {
      const ctx = makeContext({ lostSightMs: 3500 });
      expect(SearchRule.evaluate(ctx, cfg)).toBe('SEARCH');
    });

    it('passes when still tracking', () => {
      const ctx = makeContext({ lostSightMs: 1000 });
      expect(SearchRule.evaluate(ctx, cfg)).toBeNull();
    });
  });

  describe('evaluateTransitions (full chain)', () => {
    it('returns null when all conditions normal', () => {
      const ctx = makeContext();
      expect(evaluateTransitions(DEFAULT_COMBAT_RULES, ctx, cfg)).toBeNull();
    });

    it('wounded takes priority over morale', () => {
      const ctx = makeContext({
        hpRatio: 0.1,
        moraleValue: -0.8,
        isPanicked: true,
        timeSinceWoundedMs: Infinity,
      });
      expect(evaluateTransitions(DEFAULT_COMBAT_RULES, ctx, cfg)).toBe('WOUNDED');
    });

    it('no-ammo takes priority over explosive danger', () => {
      const ctx = makeContext({
        hasAmmo: false,
        hasExplosiveDanger: true,
      });
      expect(evaluateTransitions(DEFAULT_COMBAT_RULES, ctx, cfg)).toBe('RETREAT');
    });

    it('evade takes priority over morale', () => {
      const ctx = makeContext({
        hasExplosiveDanger: true,
        isPanicked: true,
      });
      expect(evaluateTransitions(DEFAULT_COMBAT_RULES, ctx, cfg)).toBe('EVADE_GRENADE');
    });

    it('supports custom rule injection', () => {
      const customRule = {
        name: 'custom',
        priority: 0,
        evaluate: () => 'CUSTOM_STATE' as string,
      };
      const ctx = makeContext({ hpRatio: 0.1, timeSinceWoundedMs: Infinity });
      const result = evaluateTransitions([customRule, ...DEFAULT_COMBAT_RULES], ctx, cfg);
      expect(result).toBe('CUSTOM_STATE');
    });
  });
});
