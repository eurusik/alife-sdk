import { describe, it, expect } from 'vitest';
import { selectBestWeapon, shouldThrowGrenade, shouldUseMedkit } from './WeaponSelector';
import type { IWeaponContext } from './WeaponSelector';
import { WeaponCategory } from '../types/IWeaponTypes';
import type { INPCLoadout, IWeaponSlot } from '../types/IWeaponTypes';
import type { IWeaponSelectionConfig } from '../types/IOnlineAIConfig';
import { createDefaultAIConfig } from '../config/createDefaultAIConfig';

const config = createDefaultAIConfig().weapon;

function makeSlot(category: WeaponCategory, ammo = 10): IWeaponSlot {
  const cfg = config.weapons[category];
  return {
    category,
    ammo,
    maxAmmo: cfg.defaultAmmo,
    range: cfg.range,
    damage: cfg.damage,
    fireRate: cfg.fireRate,
  };
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

function makeCtx(overrides?: Partial<IWeaponContext>): IWeaponContext {
  return {
    loadout: makeLoadout(),
    distanceToEnemy: 200,
    enemyCount: 1,
    hpRatio: 0.8,
    ...overrides,
  };
}

describe('selectBestWeapon', () => {
  it('returns null when no ammo remains', () => {
    const ctx = makeCtx({
      loadout: makeLoadout({
        primary: makeSlot(WeaponCategory.RIFLE, 0),
        secondary: makeSlot(WeaponCategory.PISTOL, 0),
      }),
    });
    expect(selectBestWeapon(ctx, config)).toBeNull();
  });

  it('returns null when both slots are null', () => {
    const ctx = makeCtx({ loadout: makeLoadout({ primary: null, secondary: null }) });
    expect(selectBestWeapon(ctx, config)).toBeNull();
  });

  it('prefers rifle at mid range', () => {
    const ctx = makeCtx({
      loadout: makeLoadout({
        primary: makeSlot(WeaponCategory.RIFLE),
        secondary: makeSlot(WeaponCategory.PISTOL),
      }),
      distanceToEnemy: 250,
      enemyCount: 1,
      hpRatio: 0.5,
    });
    const result = selectBestWeapon(ctx, config);
    expect(result).not.toBeNull();
    expect(result!.category).toBe(WeaponCategory.RIFLE);
  });

  it('prefers shotgun at close range', () => {
    const ctx = makeCtx({
      loadout: makeLoadout({
        primary: makeSlot(WeaponCategory.SHOTGUN),
        secondary: makeSlot(WeaponCategory.PISTOL),
      }),
      distanceToEnemy: 50,
      hpRatio: 0.8,
    });
    const result = selectBestWeapon(ctx, config);
    expect(result!.category).toBe(WeaponCategory.SHOTGUN);
  });

  it('prefers sniper at long range', () => {
    const ctx = makeCtx({
      loadout: makeLoadout({
        primary: makeSlot(WeaponCategory.SNIPER),
        secondary: makeSlot(WeaponCategory.RIFLE),
      }),
      distanceToEnemy: 500,
      hpRatio: 0.5,
    });
    const result = selectBestWeapon(ctx, config);
    expect(result!.category).toBe(WeaponCategory.SNIPER);
  });

  it('shotgun gets bonus against multiple enemies', () => {
    const loadout = makeLoadout({
      primary: makeSlot(WeaponCategory.SHOTGUN),
      secondary: makeSlot(WeaponCategory.PISTOL),
    });
    const single = selectBestWeapon(makeCtx({ loadout, distanceToEnemy: 80, enemyCount: 1, hpRatio: 0.5 }), config);
    const multi = selectBestWeapon(makeCtx({ loadout, distanceToEnemy: 80, enemyCount: 4, hpRatio: 0.5 }), config);
    // Shotgun should dominate at close range regardless, but especially vs 4.
    expect(single!.category).toBe(WeaponCategory.SHOTGUN);
    expect(multi!.category).toBe(WeaponCategory.SHOTGUN);
  });

  it('low HP favors ranged weapons', () => {
    const ctx = makeCtx({
      loadout: makeLoadout({
        primary: makeSlot(WeaponCategory.SNIPER),
        secondary: makeSlot(WeaponCategory.SHOTGUN),
      }),
      distanceToEnemy: 300,
      hpRatio: 0.2,
    });
    // At 0.2 HP, sniper should score higher than shotgun at medium range.
    const result = selectBestWeapon(ctx, config);
    expect(result!.category).toBe(WeaponCategory.SNIPER);
  });

  it('falls back to pistol when only secondary has ammo', () => {
    const ctx = makeCtx({
      loadout: makeLoadout({
        primary: makeSlot(WeaponCategory.RIFLE, 0),
        secondary: makeSlot(WeaponCategory.PISTOL, 15),
      }),
      hpRatio: 0.5,
    });
    const result = selectBestWeapon(ctx, config);
    expect(result!.category).toBe(WeaponCategory.PISTOL);
  });

  it('primary wins ties', () => {
    // Both same category, both have ammo.
    const loadout = makeLoadout({
      primary: makeSlot(WeaponCategory.PISTOL, 10),
      secondary: makeSlot(WeaponCategory.PISTOL, 10),
    });
    const result = selectBestWeapon(makeCtx({ loadout, hpRatio: 0.5 }), config);
    expect(result).toBe(loadout.primary);
  });
});

describe('shouldThrowGrenade', () => {
  it('returns true when all conditions met', () => {
    const ctx = makeCtx({ loadout: makeLoadout({ grenades: 1 }), enemyCount: 2, distanceToEnemy: 150 });
    expect(shouldThrowGrenade(ctx, config)).toBe(true);
  });

  it('returns false when no grenades', () => {
    const ctx = makeCtx({ loadout: makeLoadout({ grenades: 0 }), enemyCount: 3, distanceToEnemy: 150 });
    expect(shouldThrowGrenade(ctx, config)).toBe(false);
  });

  it('returns false with too few enemies', () => {
    const ctx = makeCtx({ loadout: makeLoadout({ grenades: 1 }), enemyCount: 1, distanceToEnemy: 150 });
    expect(shouldThrowGrenade(ctx, config)).toBe(false);
  });

  it('returns false when enemy too close', () => {
    const ctx = makeCtx({ loadout: makeLoadout({ grenades: 1 }), enemyCount: 2, distanceToEnemy: 50 });
    expect(shouldThrowGrenade(ctx, config)).toBe(false);
  });

  it('returns false when enemy too far', () => {
    const ctx = makeCtx({ loadout: makeLoadout({ grenades: 1 }), enemyCount: 2, distanceToEnemy: 500 });
    expect(shouldThrowGrenade(ctx, config)).toBe(false);
  });
});

describe('shouldUseMedkit', () => {
  it('returns true when low HP and not in combat', () => {
    const ctx = makeCtx({ loadout: makeLoadout({ medkits: 1 }), hpRatio: 0.3, inCombat: false });
    expect(shouldUseMedkit(ctx, config)).toBe(true);
  });

  it('returns true at emergency threshold even in combat', () => {
    const ctx = makeCtx({ loadout: makeLoadout({ medkits: 1 }), hpRatio: 0.15, inCombat: true });
    expect(shouldUseMedkit(ctx, config)).toBe(true);
  });

  it('returns false when no medkits', () => {
    const ctx = makeCtx({ loadout: makeLoadout({ medkits: 0 }), hpRatio: 0.1, inCombat: false });
    expect(shouldUseMedkit(ctx, config)).toBe(false);
  });

  it('returns false when HP above threshold', () => {
    const ctx = makeCtx({ loadout: makeLoadout({ medkits: 1 }), hpRatio: 0.8, inCombat: false });
    expect(shouldUseMedkit(ctx, config)).toBe(false);
  });

  it('returns false when low HP but in combat (non-emergency)', () => {
    const ctx = makeCtx({ loadout: makeLoadout({ medkits: 1 }), hpRatio: 0.25, inCombat: true });
    expect(shouldUseMedkit(ctx, config)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Custom scoringFactors tests
// ---------------------------------------------------------------------------
describe('selectBestWeapon with custom scoringFactors', () => {
  it('uses custom multiEnemyModifier from scoringFactors', () => {
    // Override shotgun so it gets a huge multi-enemy penalty instead of the default 1.5 bonus.
    const customConfig: IWeaponSelectionConfig = {
      ...config,
      scoringFactors: {
        [String(WeaponCategory.SHOTGUN)]: {
          baseEffectiveness: 1.0,
          multiEnemyModifier: 0.1,  // was 1.5 by default
          lowHpModifier: 1.0,
          highHpModifier: 1.0,
        },
      },
    };

    const ctx = makeCtx({
      loadout: makeLoadout({
        primary: makeSlot(WeaponCategory.SHOTGUN),
        secondary: makeSlot(WeaponCategory.PISTOL),
      }),
      distanceToEnemy: 50,
      enemyCount: 4,
      hpRatio: 0.5,
    });

    // At close range with 4 enemies, default would pick shotgun (1.5 multi bonus).
    // With custom config, shotgun gets 0.1 multi modifier, so pistol should win.
    const result = selectBestWeapon(ctx, customConfig);
    expect(result).not.toBeNull();
    expect(result!.category).toBe(WeaponCategory.PISTOL);
  });

  it('uses custom lowHpModifier from scoringFactors', () => {
    // Give sniper a big penalty at low HP instead of the default 1.3 bonus.
    const customConfig: IWeaponSelectionConfig = {
      ...config,
      scoringFactors: {
        [String(WeaponCategory.SNIPER)]: {
          baseEffectiveness: 1.0,
          multiEnemyModifier: 1.0,
          lowHpModifier: 0.05,  // was 1.3 by default
          highHpModifier: 1.0,
        },
      },
    };

    const ctx = makeCtx({
      loadout: makeLoadout({
        primary: makeSlot(WeaponCategory.SNIPER),
        secondary: makeSlot(WeaponCategory.RIFLE),
      }),
      distanceToEnemy: 500,
      hpRatio: 0.2,
    });

    // At low HP + long range, default would pick sniper (1.3 low HP bonus).
    // With custom config, sniper gets 0.05, so rifle should win.
    const result = selectBestWeapon(ctx, customConfig);
    expect(result).not.toBeNull();
    expect(result!.category).toBe(WeaponCategory.RIFLE);
  });

  it('uses custom highHpModifier from scoringFactors', () => {
    // Give shotgun a huge penalty at high HP instead of the default 1.2 bonus.
    const customConfig: IWeaponSelectionConfig = {
      ...config,
      scoringFactors: {
        [String(WeaponCategory.SHOTGUN)]: {
          baseEffectiveness: 1.0,
          multiEnemyModifier: 1.0,
          lowHpModifier: 1.0,
          highHpModifier: 0.01,  // was 1.2 by default
        },
      },
    };

    const ctx = makeCtx({
      loadout: makeLoadout({
        primary: makeSlot(WeaponCategory.SHOTGUN),
        secondary: makeSlot(WeaponCategory.PISTOL),
      }),
      distanceToEnemy: 50,
      hpRatio: 0.9,
    });

    // At close range + high HP, shotgun normally dominates.
    // With custom highHpModifier=0.01, pistol should win.
    const result = selectBestWeapon(ctx, customConfig);
    expect(result).not.toBeNull();
    expect(result!.category).toBe(WeaponCategory.PISTOL);
  });

  it('handles zero-value effective range config without NaN (bug audit fix)', () => {
    const zeroConfig: IWeaponSelectionConfig = {
      ...config,
      shotgunEffectiveMax: 0,
      rifleEffectiveMin: 0,
      rifleEffectiveMax: 0,
      sniperEffectiveMin: 0,
    };

    const ctx = makeCtx({
      loadout: makeLoadout({
        primary: makeSlot(WeaponCategory.RIFLE),
        secondary: makeSlot(WeaponCategory.PISTOL),
      }),
      hpRatio: 0.5,
    });

    // Should not throw and should return a valid weapon (no NaN/Infinity in scoring).
    const result = selectBestWeapon(ctx, zeroConfig);
    expect(result).not.toBeNull();
    // Score should be a finite number (no NaN propagation).
    expect(Number.isFinite(result!.damage)).toBe(true);
  });

  it('shotgun returns 0 score when effectiveMax is 0', () => {
    const zeroConfig: IWeaponSelectionConfig = {
      ...config,
      shotgunEffectiveMax: 0,
    };

    const ctx = makeCtx({
      loadout: makeLoadout({
        primary: makeSlot(WeaponCategory.SHOTGUN),
        secondary: makeSlot(WeaponCategory.PISTOL),
      }),
      distanceToEnemy: 50,
      hpRatio: 0.5,
    });

    // Shotgun score=0 with effectiveMax=0, so pistol should win.
    const result = selectBestWeapon(ctx, zeroConfig);
    expect(result).not.toBeNull();
    expect(result!.category).toBe(WeaponCategory.PISTOL);
  });

  it('rifle returns fallback 0.6 when effectiveMin is 0', () => {
    const zeroConfig: IWeaponSelectionConfig = {
      ...config,
      rifleEffectiveMin: 0,
      rifleEffectiveMax: 0,
    };

    const ctx = makeCtx({
      loadout: makeLoadout({
        primary: makeSlot(WeaponCategory.RIFLE),
        secondary: null,
      }),
      hpRatio: 0.5,
    });

    // Rifle should still return a result (fallback 0.6 score, not NaN).
    const result = selectBestWeapon(ctx, zeroConfig);
    expect(result).not.toBeNull();
    expect(result!.category).toBe(WeaponCategory.RIFLE);
  });

  it('sniper returns fallback 0.1 when effectiveMin is 0', () => {
    const zeroConfig: IWeaponSelectionConfig = {
      ...config,
      sniperEffectiveMin: 0,
    };

    const ctx = makeCtx({
      loadout: makeLoadout({
        primary: makeSlot(WeaponCategory.SNIPER),
        secondary: null,
      }),
      hpRatio: 0.5,
    });

    // Sniper should still return a result (fallback 0.1 score, not NaN).
    const result = selectBestWeapon(ctx, zeroConfig);
    expect(result).not.toBeNull();
    expect(result!.category).toBe(WeaponCategory.SNIPER);
  });

  it('unconfigured categories still use hardcoded defaults', () => {
    // Only override shotgun, leave rifle at defaults.
    const customConfig: IWeaponSelectionConfig = {
      ...config,
      scoringFactors: {
        [String(WeaponCategory.SHOTGUN)]: {
          baseEffectiveness: 1.0,
          multiEnemyModifier: 0.1,
          lowHpModifier: 1.0,
          highHpModifier: 1.0,
        },
      },
    };

    const ctx = makeCtx({
      loadout: makeLoadout({
        primary: makeSlot(WeaponCategory.RIFLE),
        secondary: makeSlot(WeaponCategory.PISTOL),
      }),
      distanceToEnemy: 250,
      hpRatio: 0.5,
    });

    // Rifle should still work with default scoring (not overridden).
    const result = selectBestWeapon(ctx, customConfig);
    expect(result).not.toBeNull();
    expect(result!.category).toBe(WeaponCategory.RIFLE);
  });
});

// ---------------------------------------------------------------------------
// IWeaponContext reusability — same context object accepted by all 3 functions
// ---------------------------------------------------------------------------
describe('IWeaponContext shared across all weapon functions', () => {
  it('all weapon functions accept the same IWeaponContext without throwing', () => {
    const someLoadout = makeLoadout({
      primary: makeSlot(WeaponCategory.RIFLE),
      secondary: makeSlot(WeaponCategory.PISTOL),
      grenades: 3,
      medkits: 2,
    });

    const ctx: IWeaponContext = {
      loadout: someLoadout,
      distanceToEnemy: 100,
      enemyCount: 2,
      hpRatio: 0.8,
      inCombat: true,
    };

    // All three functions must accept the exact same context object without error.
    expect(() => selectBestWeapon(ctx, config)).not.toThrow();
    expect(() => shouldThrowGrenade(ctx, config)).not.toThrow();
    expect(() => shouldUseMedkit(ctx, config)).not.toThrow();
  });

  it('IWeaponContext with inCombat=false is accepted by all 3 functions', () => {
    const ctx: IWeaponContext = {
      loadout: makeLoadout({ medkits: 1, grenades: 1 }),
      distanceToEnemy: 200,
      enemyCount: 1,
      hpRatio: 0.4,
      inCombat: false,
    };

    const weapon = selectBestWeapon(ctx, config);
    const throwGrenade = shouldThrowGrenade(ctx, config);
    const useMedkit = shouldUseMedkit(ctx, config);

    // With grenades=1 and enemyCount=1, grenade threshold (2) not met.
    expect(throwGrenade).toBe(false);
    // Low HP (0.4 < 0.5 threshold) and not in combat → medkit should be used.
    expect(useMedkit).toBe(true);
    // Weapon result should be non-null (both primary and secondary have ammo).
    expect(weapon).not.toBeNull();
  });

  it('IWeaponContext with null slots and zero consumables returns sensible results', () => {
    const ctx: IWeaponContext = {
      loadout: { primary: null, secondary: null, grenades: 0, medkits: 0 },
      distanceToEnemy: 150,
      enemyCount: 3,
      hpRatio: 0.1,
      inCombat: true,
    };

    expect(selectBestWeapon(ctx, config)).toBeNull();
    expect(shouldThrowGrenade(ctx, config)).toBe(false);
    expect(shouldUseMedkit(ctx, config)).toBe(false);
  });
});
