/**
 * Integration test: WeaponSelector + LoadoutBuilder
 *
 * Exercises the weapon selection pipeline end-to-end using real implementations:
 *   selectBestWeapon(), shouldThrowGrenade(), shouldUseMedkit(), createLoadout()
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 * Config is built via createDefaultAIConfig().
 */

import { describe, it, expect } from 'vitest';
import { selectBestWeapon, shouldThrowGrenade, shouldUseMedkit } from '../combat/WeaponSelector';
import type { IWeaponContext } from '../combat/WeaponSelector';
import { LoadoutBuilder, createLoadout } from '../combat/LoadoutBuilder';
import { WeaponCategory } from '../types/IWeaponTypes';
import type { INPCLoadout } from '../types/IWeaponTypes';
import { createDefaultAIConfig } from '../config/createDefaultAIConfig';

// ---------------------------------------------------------------------------
// Shared config
// ---------------------------------------------------------------------------

const config = createDefaultAIConfig();
const weaponCfg = config.weapon;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal loadout with only a primary weapon. */
function primaryOnly(category: WeaponCategory, ammo = 30): INPCLoadout {
  return new LoadoutBuilder(weaponCfg)
    .withPrimary(category, ammo)
    .build();
}

/** Build a loadout with primary + secondary. */
function primaryAndSecondary(
  primaryCat: WeaponCategory,
  primaryAmmo: number,
  secondaryCat: WeaponCategory,
  secondaryAmmo = 15,
): INPCLoadout {
  return new LoadoutBuilder(weaponCfg)
    .withPrimary(primaryCat, primaryAmmo)
    .withSecondary(secondaryCat, secondaryAmmo)
    .build();
}

function makeCtx(overrides: Partial<IWeaponContext> & { loadout: INPCLoadout }): IWeaponContext {
  return {
    distanceToEnemy: 100,
    enemyCount: 1,
    hpRatio: 1.0,
    inCombat: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// selectBestWeapon — distance-based selection
// ---------------------------------------------------------------------------

describe('selectBestWeapon() — distance-based selection', () => {
  it('close range (< shotgunEffectiveMax * 0.66) prefers shotgun over sniper', () => {
    // Shotgun effective range 150px — within 0.66 * 150 = 99px for maximum shotgun score.
    // Sniper needs >= sniperEffectiveMin (300px) for max score.
    const dist = 60; // deeply within shotgun optimal range
    const loadout = primaryAndSecondary(WeaponCategory.SNIPER, 10, WeaponCategory.SHOTGUN, 8);
    const ctx = makeCtx({ loadout, distanceToEnemy: dist, enemyCount: 1, hpRatio: 0.8 });

    const selected = selectBestWeapon(ctx, weaponCfg);
    // Secondary shotgun must beat primary sniper at this range
    expect(selected).not.toBeNull();
    expect(selected!.category).toBe(WeaponCategory.SHOTGUN);
  });

  it('long range (>= sniperEffectiveMin) prefers sniper over shotgun', () => {
    const dist = weaponCfg.sniperEffectiveMin + 50; // 350px — optimal for sniper
    const loadout = primaryAndSecondary(WeaponCategory.SNIPER, 10, WeaponCategory.SHOTGUN, 8);
    const ctx = makeCtx({ loadout, distanceToEnemy: dist, enemyCount: 1, hpRatio: 0.8 });

    const selected = selectBestWeapon(ctx, weaponCfg);
    // Sniper is primary so it wins ties; at long range it also gets distance 1.0
    expect(selected).not.toBeNull();
    expect(selected!.category).toBe(WeaponCategory.SNIPER);
  });

  it('long range prefers rifle over shotgun', () => {
    // Rifle optimal range: 100-400px. Shotgun falls to 0 beyond 150 * 1.33 = ~200px.
    const dist = 350;
    const loadout = primaryAndSecondary(WeaponCategory.RIFLE, 30, WeaponCategory.SHOTGUN, 8);
    const ctx = makeCtx({ loadout, distanceToEnemy: dist, enemyCount: 1, hpRatio: 0.8 });

    const selected = selectBestWeapon(ctx, weaponCfg);
    expect(selected).not.toBeNull();
    expect(selected!.category).toBe(WeaponCategory.RIFLE);
  });

  it('mid range (100-400px) rifle gets distance score 1.0', () => {
    const dist = 200; // solidly in rifle optimal range
    const loadout = primaryOnly(WeaponCategory.RIFLE);
    const ctx = makeCtx({ loadout, distanceToEnemy: dist });

    const selected = selectBestWeapon(ctx, weaponCfg);
    expect(selected).not.toBeNull();
    expect(selected!.category).toBe(WeaponCategory.RIFLE);
  });

  it('pistol gets constant 0.4 distance score regardless of range', () => {
    // Pistol distance score is always 0.4. Rifle at close range still beats it.
    const distClose = 50;
    const loadout1 = primaryAndSecondary(WeaponCategory.RIFLE, 30, WeaponCategory.PISTOL, 15);
    const ctx1 = makeCtx({ loadout: loadout1, distanceToEnemy: distClose, enemyCount: 1, hpRatio: 0.8 });

    const selected1 = selectBestWeapon(ctx1, weaponCfg);
    // Rifle at 50px: score = distanceScore(RIFLE, 50) * 1.0 * highHpModifier(1.0)
    // RIFLE at 50px: distance < rifleEffectiveMin (100), so score = 0.6 + 0.4 * (50/100) = 0.8
    // PISTOL at any range: 0.4 * 1.0 * highHpModifier = 0.4 * 1.1 = 0.44
    // rifle 0.8 > pistol 0.44, so rifle wins
    expect(selected1!.category).toBe(WeaponCategory.RIFLE);
  });
});

// ---------------------------------------------------------------------------
// selectBestWeapon — ammo fallback
// ---------------------------------------------------------------------------

describe('selectBestWeapon() — ammo fallback', () => {
  it('no primary ammo + has secondary → uses secondary', () => {
    const loadout = primaryAndSecondary(WeaponCategory.RIFLE, 0, WeaponCategory.PISTOL, 15);
    const ctx = makeCtx({ loadout, distanceToEnemy: 200, enemyCount: 1, hpRatio: 0.8 });

    const selected = selectBestWeapon(ctx, weaponCfg);
    expect(selected).not.toBeNull();
    expect(selected!.category).toBe(WeaponCategory.PISTOL);
  });

  it('primary has ammo → primary wins even if secondary scores higher', () => {
    // Rifle primary at 200px vs shotgun secondary at 200px.
    // Rifle is optimal here, shotgun scores 0 beyond 150 * 1.33.
    const loadout = primaryAndSecondary(WeaponCategory.RIFLE, 30, WeaponCategory.SHOTGUN, 8);
    const ctx = makeCtx({ loadout, distanceToEnemy: 200, enemyCount: 1, hpRatio: 0.8 });

    const selected = selectBestWeapon(ctx, weaponCfg);
    expect(selected!.category).toBe(WeaponCategory.RIFLE);
  });

  it('empty loadout (no primary, no secondary) → returns null', () => {
    const loadout: INPCLoadout = { primary: null, secondary: null, grenades: 0, medkits: 0 };
    const ctx = makeCtx({ loadout, distanceToEnemy: 100, enemyCount: 1, hpRatio: 1.0 });

    const selected = selectBestWeapon(ctx, weaponCfg);
    expect(selected).toBeNull();
  });

  it('primary with 0 ammo and no secondary → returns null', () => {
    const loadout = primaryOnly(WeaponCategory.RIFLE, 0);
    const ctx = makeCtx({ loadout, distanceToEnemy: 200, enemyCount: 1, hpRatio: 0.8 });

    const selected = selectBestWeapon(ctx, weaponCfg);
    expect(selected).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// selectBestWeapon — HP modifiers
// ---------------------------------------------------------------------------

describe('selectBestWeapon() — HP modifiers', () => {
  it('HP < 0.3 → sniper modifier 1.3 boosts sniper score (vs pistol at same range)', () => {
    // At 350px, sniper distance score = 1.0. With low HP modifier 1.3, composite = 1.3.
    // Pistol distance score = 0.4, low HP modifier = 0.9, composite = 0.36.
    // Sniper wins.
    const loadout = primaryAndSecondary(WeaponCategory.SNIPER, 10, WeaponCategory.PISTOL, 15);
    const ctx = makeCtx({ loadout, distanceToEnemy: 350, enemyCount: 1, hpRatio: 0.2 });

    const selected = selectBestWeapon(ctx, weaponCfg);
    expect(selected!.category).toBe(WeaponCategory.SNIPER);
  });

  it('HP < 0.3 → shotgun modifier 0.7 penalises shotgun (vs rifle at same range)', () => {
    // At 150px: shotgun dist=1.0 * lowHp 0.7 = 0.7; rifle dist=0.6+0.4*(150/100)=1.0 * lowHp 1.2 = 1.2
    // Rifle wins clearly.
    const loadout = primaryAndSecondary(WeaponCategory.RIFLE, 30, WeaponCategory.SHOTGUN, 8);
    const ctx = makeCtx({ loadout, distanceToEnemy: 150, enemyCount: 1, hpRatio: 0.2 });

    const selected = selectBestWeapon(ctx, weaponCfg);
    expect(selected!.category).toBe(WeaponCategory.RIFLE);
  });

  it('HP > 0.7 → shotgun high-HP modifier 1.2 boosts shotgun at close range', () => {
    // At 60px: shotgun dist=1.0 * highHp 1.2 = 1.2; sniper dist=0.1+0.9*(60/300)=0.28 * highHp 0.9 = 0.252
    // Shotgun beats sniper.
    const loadout = primaryAndSecondary(WeaponCategory.SNIPER, 10, WeaponCategory.SHOTGUN, 8);
    const ctx = makeCtx({ loadout, distanceToEnemy: 60, enemyCount: 1, hpRatio: 0.9 });

    const selected = selectBestWeapon(ctx, weaponCfg);
    expect(selected!.category).toBe(WeaponCategory.SHOTGUN);
  });
});

// ---------------------------------------------------------------------------
// shouldThrowGrenade
// ---------------------------------------------------------------------------

describe('shouldThrowGrenade()', () => {
  it('has grenade + enemy count >= grenadeMinEnemies + in range → returns true', () => {
    const loadout: INPCLoadout = { primary: null, secondary: null, grenades: 2, medkits: 0 };
    // Default config: grenadeMinEnemies=2, grenadeMinDistance=100, grenadeMaxDistance=400
    const ctx = makeCtx({ loadout, distanceToEnemy: 200, enemyCount: 2 });

    expect(shouldThrowGrenade(ctx, weaponCfg)).toBe(true);
  });

  it('has grenade + single enemy (below threshold) → does not throw', () => {
    const loadout: INPCLoadout = { primary: null, secondary: null, grenades: 2, medkits: 0 };
    // enemyCount=1 < grenadeMinEnemies=2 → false
    const ctx = makeCtx({ loadout, distanceToEnemy: 200, enemyCount: 1 });

    expect(shouldThrowGrenade(ctx, weaponCfg)).toBe(false);
  });

  it('has grenade + enough enemies + enemy too close (< grenadeMinDistance) → does not throw', () => {
    const loadout: INPCLoadout = { primary: null, secondary: null, grenades: 2, medkits: 0 };
    const ctx = makeCtx({ loadout, distanceToEnemy: 50, enemyCount: 3 });

    expect(shouldThrowGrenade(ctx, weaponCfg)).toBe(false);
  });

  it('has grenade + enough enemies + enemy too far (> grenadeMaxDistance) → does not throw', () => {
    const loadout: INPCLoadout = { primary: null, secondary: null, grenades: 2, medkits: 0 };
    const ctx = makeCtx({ loadout, distanceToEnemy: 500, enemyCount: 3 });

    expect(shouldThrowGrenade(ctx, weaponCfg)).toBe(false);
  });

  it('no grenades → does not throw even with enemy cluster in range', () => {
    const loadout: INPCLoadout = { primary: null, secondary: null, grenades: 0, medkits: 0 };
    const ctx = makeCtx({ loadout, distanceToEnemy: 200, enemyCount: 5 });

    expect(shouldThrowGrenade(ctx, weaponCfg)).toBe(false);
  });

  it('grenade should not be thrown when primary weapon is also available — selectBestWeapon returns primary', () => {
    // shouldThrowGrenade and selectBestWeapon are independent functions.
    // With single enemy in range, grenade check returns false but weapon selector returns primary.
    const loadout: INPCLoadout = {
      primary: new LoadoutBuilder(weaponCfg).withPrimary(WeaponCategory.RIFLE).build().primary!,
      secondary: null,
      grenades: 2,
      medkits: 0,
    };
    const ctx = makeCtx({ loadout, distanceToEnemy: 200, enemyCount: 1 });

    expect(shouldThrowGrenade(ctx, weaponCfg)).toBe(false);
    expect(selectBestWeapon(ctx, weaponCfg)).not.toBeNull();
    expect(selectBestWeapon(ctx, weaponCfg)!.category).toBe(WeaponCategory.RIFLE);
  });
});

// ---------------------------------------------------------------------------
// shouldUseMedkit
// ---------------------------------------------------------------------------

describe('shouldUseMedkit()', () => {
  it('HP < medkitHpThreshold + not in combat → uses medkit', () => {
    // medkitHpThreshold=0.5, medkitEmergencyThreshold=0.2
    const loadout: INPCLoadout = { primary: null, secondary: null, grenades: 0, medkits: 1 };
    const ctx = makeCtx({ loadout, hpRatio: 0.3, inCombat: false });

    expect(shouldUseMedkit(ctx, weaponCfg)).toBe(true);
  });

  it('HP < medkitEmergencyThreshold → uses medkit even in combat', () => {
    const loadout: INPCLoadout = { primary: null, secondary: null, grenades: 0, medkits: 1 };
    // HP below emergency threshold (0.2)
    const ctx = makeCtx({ loadout, hpRatio: 0.1, inCombat: true });

    expect(shouldUseMedkit(ctx, weaponCfg)).toBe(true);
  });

  it('HP >= medkitHpThreshold → does not use medkit', () => {
    const loadout: INPCLoadout = { primary: null, secondary: null, grenades: 0, medkits: 1 };
    const ctx = makeCtx({ loadout, hpRatio: 0.8, inCombat: false });

    expect(shouldUseMedkit(ctx, weaponCfg)).toBe(false);
  });

  it('no medkits → never uses medkit regardless of HP', () => {
    const loadout: INPCLoadout = { primary: null, secondary: null, grenades: 0, medkits: 0 };
    const ctx = makeCtx({ loadout, hpRatio: 0.05, inCombat: false });

    expect(shouldUseMedkit(ctx, weaponCfg)).toBe(false);
  });

  it('HP between emergency and threshold + in combat → does not use medkit', () => {
    // HP = 0.25: >= medkitEmergencyThreshold (0.2) but < medkitHpThreshold (0.5)
    // In combat → should not use (wait for out-of-combat)
    const loadout: INPCLoadout = { primary: null, secondary: null, grenades: 0, medkits: 2 };
    const ctx = makeCtx({ loadout, hpRatio: 0.25, inCombat: true });

    expect(shouldUseMedkit(ctx, weaponCfg)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createLoadout — rank-based loadout generation
// ---------------------------------------------------------------------------

describe('createLoadout() — rank-based loadout generation', () => {
  it('rank 1 → pistol primary, no secondary, no grenades', () => {
    const loadout = createLoadout(1, WeaponCategory.RIFLE, weaponCfg);

    expect(loadout.primary).not.toBeNull();
    expect(loadout.primary!.category).toBe(WeaponCategory.PISTOL);
    expect(loadout.secondary).toBeNull();
    expect(loadout.grenades).toBe(0);
    expect(loadout.medkits).toBe(0);
  });

  it('rank 5 → rifle primary, shotgun secondary, 1 grenade, 2 medkits', () => {
    const loadout = createLoadout(5, WeaponCategory.RIFLE, weaponCfg);

    expect(loadout.primary!.category).toBe(WeaponCategory.RIFLE);
    expect(loadout.secondary!.category).toBe(WeaponCategory.SHOTGUN);
    expect(loadout.grenades).toBe(1);
    expect(loadout.medkits).toBe(2);
  });

  it('rank 7+ → sniper primary, rifle secondary, 3 grenades', () => {
    const loadout = createLoadout(7, WeaponCategory.RIFLE, weaponCfg);

    expect(loadout.primary!.category).toBe(WeaponCategory.SNIPER);
    expect(loadout.secondary!.category).toBe(WeaponCategory.RIFLE);
    expect(loadout.grenades).toBe(Math.min(7 - 4, 3)); // 3
    expect(loadout.medkits).toBe(3);
  });

  it('rank 6 with sniper faction preference → sniper primary', () => {
    const loadout = createLoadout(6, WeaponCategory.SNIPER, weaponCfg);

    expect(loadout.primary!.category).toBe(WeaponCategory.SNIPER);
  });

  it('rank 6 with non-sniper faction preference → rifle primary', () => {
    const loadout = createLoadout(6, WeaponCategory.RIFLE, weaponCfg);

    expect(loadout.primary!.category).toBe(WeaponCategory.RIFLE);
  });

  it('rank 2 → pistol primary, no secondary, 1 medkit', () => {
    const loadout = createLoadout(2, WeaponCategory.RIFLE, weaponCfg);

    expect(loadout.primary!.category).toBe(WeaponCategory.PISTOL);
    expect(loadout.secondary).toBeNull();
    expect(loadout.grenades).toBe(0);
    expect(loadout.medkits).toBe(1);
  });

  it('rank 3 with shotgun faction preference → shotgun primary (mid-rank faction resolve)', () => {
    const loadout = createLoadout(3, WeaponCategory.SHOTGUN, weaponCfg);

    // resolveMidRankPrimary(SHOTGUN) = SHOTGUN
    expect(loadout.primary!.category).toBe(WeaponCategory.SHOTGUN);
    expect(loadout.secondary!.category).toBe(WeaponCategory.PISTOL);
    expect(loadout.medkits).toBe(1);
  });

  it('rank 3 with sniper faction preference → falls back to rifle (sniper too advanced)', () => {
    const loadout = createLoadout(3, WeaponCategory.SNIPER, weaponCfg);

    // resolveMidRankPrimary(SNIPER) = RIFLE
    expect(loadout.primary!.category).toBe(WeaponCategory.RIFLE);
  });

  it('created loadout weapons have positive ammo from defaultAmmo config', () => {
    const loadout = createLoadout(5, WeaponCategory.RIFLE, weaponCfg);

    expect(loadout.primary!.ammo).toBeGreaterThan(0);
    expect(loadout.secondary!.ammo).toBeGreaterThan(0);
  });

  it('custom recipe map overrides default logic for exact rank match', () => {
    const customRecipes = {
      1: {
        primary: WeaponCategory.SNIPER,
        grenades: 5,
        medkits: 3,
      },
    } as const;

    const loadout = createLoadout(1, WeaponCategory.RIFLE, weaponCfg, customRecipes);

    expect(loadout.primary!.category).toBe(WeaponCategory.SNIPER);
    expect(loadout.grenades).toBe(5);
    expect(loadout.medkits).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// selectBestWeapon — tie breaking (primary wins ties)
// ---------------------------------------------------------------------------

describe('selectBestWeapon() — tie breaking', () => {
  it('primary wins a tie (same score) — scored first in evaluation order', () => {
    // Two identical pistols: primary scores first, secondary must strictly beat it.
    const primarySlot = new LoadoutBuilder(weaponCfg).withPrimary(WeaponCategory.PISTOL, 15).build().primary!;
    const secondarySlot = new LoadoutBuilder(weaponCfg).withSecondary(WeaponCategory.PISTOL, 15).build().secondary!;

    const loadout: INPCLoadout = {
      primary: primarySlot,
      secondary: secondarySlot,
      grenades: 0,
      medkits: 0,
    };
    const ctx = makeCtx({ loadout, distanceToEnemy: 100, enemyCount: 1, hpRatio: 0.5 });

    const selected = selectBestWeapon(ctx, weaponCfg);
    // Same category, same scores — primary wins (secondary must strictly beat primary)
    expect(selected).toBe(primarySlot);
  });
});
