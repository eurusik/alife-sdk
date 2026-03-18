import { describe, it, expect } from 'vitest';
import { AnimDirection } from './IAnimationTypes';
import { WeaponCategory } from './IWeaponTypes';
import { WorldProperty, GoalPriority } from './IPerceptionTypes';

describe('AnimDirection', () => {
  it('contains 8 directions', () => {
    expect(Object.keys(AnimDirection)).toHaveLength(8);
  });

  it('all values are unique strings', () => {
    const values = Object.values(AnimDirection);
    expect(new Set(values).size).toBe(8);
    for (const v of values) expect(typeof v).toBe('string');
  });

  it('includes all cardinal and intercardinal directions', () => {
    expect(AnimDirection.UP).toBeDefined();
    expect(AnimDirection.DOWN).toBeDefined();
    expect(AnimDirection.LEFT).toBeDefined();
    expect(AnimDirection.RIGHT).toBeDefined();
    expect(AnimDirection.UP_LEFT).toBeDefined();
    expect(AnimDirection.UP_RIGHT).toBeDefined();
    expect(AnimDirection.DOWN_LEFT).toBeDefined();
    expect(AnimDirection.DOWN_RIGHT).toBeDefined();
  });
});

describe('WeaponCategory', () => {
  it('contains 6 categories', () => {
    expect(Object.keys(WeaponCategory)).toHaveLength(6);
  });

  it('all values are unique numbers', () => {
    const values = Object.values(WeaponCategory);
    expect(new Set(values).size).toBe(6);
    for (const v of values) expect(typeof v).toBe('number');
  });

  it('has expected categories', () => {
    expect(WeaponCategory.PISTOL).toBeDefined();
    expect(WeaponCategory.SHOTGUN).toBeDefined();
    expect(WeaponCategory.RIFLE).toBeDefined();
    expect(WeaponCategory.SNIPER).toBeDefined();
    expect(WeaponCategory.GRENADE).toBeDefined();
    expect(WeaponCategory.MEDKIT).toBeDefined();
  });
});

describe('WorldProperty', () => {
  it('contains 17 properties', () => {
    expect(Object.keys(WorldProperty)).toHaveLength(17);
  });

  it('all values are unique strings', () => {
    const values = Object.values(WorldProperty);
    expect(new Set(values).size).toBe(17);
    for (const v of values) expect(typeof v).toBe('string');
  });
});

describe('GoalPriority', () => {
  it('contains 6 priority bands', () => {
    expect(Object.keys(GoalPriority)).toHaveLength(6);
  });

  it('has correct priority ordering (lower = higher priority)', () => {
    expect(GoalPriority.CRITICALLY_WOUNDED).toBeLessThan(GoalPriority.ENEMY_PRESENT);
    expect(GoalPriority.ENEMY_PRESENT).toBeLessThan(GoalPriority.DANGER);
    expect(GoalPriority.DANGER).toBeLessThan(GoalPriority.ANOMALY_AVOID);
    expect(GoalPriority.ANOMALY_AVOID).toBeLessThan(GoalPriority.DEFAULT);
  });
});
