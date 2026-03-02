import { describe, it, expect } from 'vitest';
import {
  MonsterAbility,
  DEFAULT_ABILITY_RULES,
  createLinearChargeData,
  createApproachData,
  createLeapData,
  createChannelAbilityData,
  selectMonsterAbility,
  shouldMonsterFlee,
} from './MonsterAbilityData';
import type { IMonsterAbilityContext, IMonsterAbilityRule } from './MonsterAbilityData';

function makeContext(overrides?: Partial<IMonsterAbilityContext>): IMonsterAbilityContext {
  return {
    monsterType: 'boar',
    distanceToEnemy: 200,
    attackRange: 40,
    meleeCooldownRemaining: 0,
    hpRatio: 0.8,
    moraleValue: 0,
    ...overrides,
  };
}

describe('MonsterAbilityData factories', () => {
  it('createLinearChargeData initializes windup phase', () => {
    const data = createLinearChargeData(0, 0, 100, 100, 600);
    expect(data.phase).toBe('windup');
    expect(data.timer).toBe(600);
    expect(data.targetX).toBe(100);
    expect(data.targetY).toBe(100);
  });

  it('createApproachData initializes approach phase', () => {
    const data = createApproachData(50, 60);
    expect(data.phase).toBe('approach');
    expect(data.targetX).toBe(50);
  });

  it('createLeapData initializes windup phase', () => {
    const data = createLeapData(0, 0, 80, 80, 400);
    expect(data.phase).toBe('windup');
    expect(data.timer).toBe(400);
  });

  it('createChannelAbilityData initializes channel phase', () => {
    const data = createChannelAbilityData(100, 200, 2000);
    expect(data.phase).toBe('channel');
    expect(data.timer).toBe(2000);
  });
});

describe('selectMonsterAbility', () => {
  it('boar charges when out of melee range', () => {
    const ctx = makeContext({ monsterType: 'boar', distanceToEnemy: 100, attackRange: 40 });
    expect(selectMonsterAbility(ctx)).toBe(MonsterAbility.CHARGE);
  });

  it('boar does not charge when in melee range', () => {
    const ctx = makeContext({ monsterType: 'boar', distanceToEnemy: 30, attackRange: 40 });
    expect(selectMonsterAbility(ctx)).toBeNull();
  });

  it('bloodsucker stalks when far away', () => {
    const ctx = makeContext({ monsterType: 'bloodsucker', distanceToEnemy: 200, attackRange: 40 });
    expect(selectMonsterAbility(ctx)).toBe(MonsterAbility.STALK);
  });

  it('bloodsucker does not stalk when close', () => {
    const ctx = makeContext({ monsterType: 'bloodsucker', distanceToEnemy: 60, attackRange: 40 });
    expect(selectMonsterAbility(ctx)).toBeNull();
  });

  it('snork leaps within range window', () => {
    const ctx = makeContext({ monsterType: 'snork', distanceToEnemy: 80, attackRange: 40 });
    expect(selectMonsterAbility(ctx)).toBe(MonsterAbility.LEAP);
  });

  it('snork does not leap when too close', () => {
    const ctx = makeContext({ monsterType: 'snork', distanceToEnemy: 30, attackRange: 40 });
    expect(selectMonsterAbility(ctx)).toBeNull();
  });

  it('snork does not leap when too far', () => {
    const ctx = makeContext({ monsterType: 'snork', distanceToEnemy: 200, attackRange: 40 });
    expect(selectMonsterAbility(ctx)).toBeNull();
  });

  it('controller uses PSI when out of melee', () => {
    const ctx = makeContext({ monsterType: 'controller', distanceToEnemy: 150, attackRange: 40 });
    expect(selectMonsterAbility(ctx)).toBe(MonsterAbility.PSI_ATTACK);
  });

  it('dog has no special ability', () => {
    const ctx = makeContext({ monsterType: 'dog', distanceToEnemy: 100, attackRange: 40 });
    expect(selectMonsterAbility(ctx)).toBeNull();
  });

  it('returns null when melee on cooldown', () => {
    const ctx = makeContext({ monsterType: 'boar', distanceToEnemy: 200, meleeCooldownRemaining: 500 });
    expect(selectMonsterAbility(ctx)).toBeNull();
  });

  it('returns null for unknown monster type', () => {
    const ctx = makeContext({ monsterType: 'chimera', distanceToEnemy: 200 });
    expect(selectMonsterAbility(ctx)).toBeNull();
  });
});

describe('selectMonsterAbility with custom rules', () => {
  it('custom rules for mutant_dog with pounce ability', () => {
    const customRules: Readonly<Record<string, readonly IMonsterAbilityRule[]>> = {
      mutant_dog: [
        {
          abilityId: 'pounce',
          shouldTrigger: (ctx) => ctx.distanceToEnemy > ctx.attackRange * 1.5,
        },
      ],
    };
    const ctx = makeContext({ monsterType: 'mutant_dog', distanceToEnemy: 100, attackRange: 40 });
    expect(selectMonsterAbility(ctx, customRules)).toBe('pounce');
  });

  it('unknown monster type with default rules returns null', () => {
    const ctx = makeContext({ monsterType: 'pseudogiant', distanceToEnemy: 200, attackRange: 40 });
    expect(selectMonsterAbility(ctx, DEFAULT_ABILITY_RULES)).toBeNull();
  });

  it('custom rules override boar behavior', () => {
    const customRules: Readonly<Record<string, readonly IMonsterAbilityRule[]>> = {
      boar: [
        {
          abilityId: 'headbutt',
          shouldTrigger: (ctx) => ctx.distanceToEnemy <= ctx.attackRange,
        },
      ],
    };
    // In range: custom rule triggers headbutt
    const ctxClose = makeContext({ monsterType: 'boar', distanceToEnemy: 30, attackRange: 40 });
    expect(selectMonsterAbility(ctxClose, customRules)).toBe('headbutt');

    // Out of range: custom rule does not trigger, no other rules → null
    const ctxFar = makeContext({ monsterType: 'boar', distanceToEnemy: 200, attackRange: 40 });
    expect(selectMonsterAbility(ctxFar, customRules)).toBeNull();
  });

  it('custom rules with multiple abilities per monster evaluates in order', () => {
    const customRules: Readonly<Record<string, readonly IMonsterAbilityRule[]>> = {
      chimera: [
        {
          abilityId: 'teleport',
          shouldTrigger: (ctx) => ctx.distanceToEnemy > ctx.attackRange * 5,
        },
        {
          abilityId: 'claw_swipe',
          shouldTrigger: (ctx) => ctx.distanceToEnemy > ctx.attackRange,
        },
      ],
    };
    // Very far → first rule (teleport) matches
    const ctxVeryFar = makeContext({ monsterType: 'chimera', distanceToEnemy: 300, attackRange: 40 });
    expect(selectMonsterAbility(ctxVeryFar, customRules)).toBe('teleport');

    // Medium distance → first rule fails, second (claw_swipe) matches
    const ctxMedium = makeContext({ monsterType: 'chimera', distanceToEnemy: 80, attackRange: 40 });
    expect(selectMonsterAbility(ctxMedium, customRules)).toBe('claw_swipe');

    // Close → neither rule matches
    const ctxClose = makeContext({ monsterType: 'chimera', distanceToEnemy: 30, attackRange: 40 });
    expect(selectMonsterAbility(ctxClose, customRules)).toBeNull();
  });

  it('melee cooldown still prevents custom rules from firing', () => {
    const customRules: Readonly<Record<string, readonly IMonsterAbilityRule[]>> = {
      boar: [
        { abilityId: 'always_trigger', shouldTrigger: () => true },
      ],
    };
    const ctx = makeContext({ monsterType: 'boar', meleeCooldownRemaining: 100 });
    expect(selectMonsterAbility(ctx, customRules)).toBeNull();
  });
});

describe('shouldMonsterFlee', () => {
  it('flees when low HP and low morale', () => {
    expect(shouldMonsterFlee(0.15, -0.5)).toBe(true);
  });

  it('does not flee with good HP', () => {
    expect(shouldMonsterFlee(0.5, -0.5)).toBe(false);
  });

  it('does not flee with good morale', () => {
    expect(shouldMonsterFlee(0.15, 0)).toBe(false);
  });

  it('does not flee at exact thresholds', () => {
    expect(shouldMonsterFlee(0.2, -0.3)).toBe(false);
  });
});
