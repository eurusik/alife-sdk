import { describe, it, expect } from 'vitest';
import { LoadoutBuilder, createLoadout, FactionWeaponPreference, DEFAULT_LOADOUT_RECIPES } from './LoadoutBuilder';
import type { ILoadoutRecipe } from './LoadoutBuilder';
import { WeaponCategory } from '../types/IWeaponTypes';
import { createDefaultAIConfig } from '../config/createDefaultAIConfig';

const config = createDefaultAIConfig().weapon;

describe('LoadoutBuilder', () => {
  it('builds empty loadout by default', () => {
    const loadout = new LoadoutBuilder(config).build();
    expect(loadout.primary).toBeNull();
    expect(loadout.secondary).toBeNull();
    expect(loadout.grenades).toBe(0);
    expect(loadout.medkits).toBe(0);
  });

  it('builds loadout with all slots', () => {
    const loadout = new LoadoutBuilder(config)
      .withPrimary(WeaponCategory.RIFLE)
      .withSecondary(WeaponCategory.PISTOL)
      .withGrenades(2)
      .withMedkits(1)
      .build();
    expect(loadout.primary!.category).toBe(WeaponCategory.RIFLE);
    expect(loadout.secondary!.category).toBe(WeaponCategory.PISTOL);
    expect(loadout.grenades).toBe(2);
    expect(loadout.medkits).toBe(1);
  });

  it('uses default ammo from config', () => {
    const loadout = new LoadoutBuilder(config)
      .withPrimary(WeaponCategory.RIFLE)
      .build();
    expect(loadout.primary!.ammo).toBe(config.weapons[WeaponCategory.RIFLE].defaultAmmo);
    expect(loadout.primary!.maxAmmo).toBe(config.weapons[WeaponCategory.RIFLE].defaultAmmo);
  });

  it('allows custom ammo count', () => {
    const loadout = new LoadoutBuilder(config)
      .withPrimary(WeaponCategory.RIFLE, 5)
      .build();
    expect(loadout.primary!.ammo).toBe(5);
  });

  // -------------------------------------------------------------------------
  // maxAmmo fix (round-4): Math.max(ammo, defaultAmmo)
  // -------------------------------------------------------------------------

  it('maxAmmo fix — ammoOverride > defaultAmmo: maxAmmo equals the override, not defaultAmmo', () => {
    // RIFLE defaultAmmo = 30. Passing 60 must yield maxAmmo = 60.
    const riffleDefault = config.weapons[WeaponCategory.RIFLE].defaultAmmo; // 30
    const override = riffleDefault + 30; // 60 — strictly above default
    const loadout = new LoadoutBuilder(config)
      .withPrimary(WeaponCategory.RIFLE, override)
      .build();
    expect(loadout.primary!.ammo).toBe(override);
    expect(loadout.primary!.maxAmmo).toBe(override);
    expect(loadout.primary!.maxAmmo).toBeGreaterThan(riffleDefault);
  });

  it('maxAmmo fix — ammoOverride < defaultAmmo: maxAmmo equals defaultAmmo', () => {
    // RIFLE defaultAmmo = 30. Passing 5 must yield maxAmmo = 30 (the floor).
    const riffleDefault = config.weapons[WeaponCategory.RIFLE].defaultAmmo; // 30
    const override = 5; // strictly below default
    const loadout = new LoadoutBuilder(config)
      .withPrimary(WeaponCategory.RIFLE, override)
      .build();
    expect(loadout.primary!.ammo).toBe(override);
    expect(loadout.primary!.maxAmmo).toBe(riffleDefault);
  });

  it('maxAmmo fix — no override: maxAmmo equals defaultAmmo', () => {
    // Covered by the existing "uses default ammo from config" test; repeated
    // here explicitly for the fix contract to make it easy to see all four cases.
    const riffleDefault = config.weapons[WeaponCategory.RIFLE].defaultAmmo;
    const loadout = new LoadoutBuilder(config)
      .withPrimary(WeaponCategory.RIFLE)
      .build();
    expect(loadout.primary!.ammo).toBe(riffleDefault);
    expect(loadout.primary!.maxAmmo).toBe(riffleDefault);
  });

  it('maxAmmo fix — ammo <= maxAmmo invariant holds for every weapon category', () => {
    // For both ammoOverride below and above defaultAmmo, ammo must never exceed maxAmmo.
    const cases: Array<{ category: WeaponCategory; override: number | undefined }> = [
      { category: WeaponCategory.PISTOL,  override: undefined }, // no override
      { category: WeaponCategory.PISTOL,  override: 1 },         // below default (15)
      { category: WeaponCategory.PISTOL,  override: 30 },        // above default (15)
      { category: WeaponCategory.SHOTGUN, override: undefined },
      { category: WeaponCategory.SHOTGUN, override: 2 },         // below default (8)
      { category: WeaponCategory.SHOTGUN, override: 20 },        // above default (8)
      { category: WeaponCategory.RIFLE,   override: undefined },
      { category: WeaponCategory.RIFLE,   override: 5 },         // below default (30)
      { category: WeaponCategory.RIFLE,   override: 60 },        // above default (30)
      { category: WeaponCategory.SNIPER,  override: undefined },
      { category: WeaponCategory.SNIPER,  override: 2 },         // below default (10)
      { category: WeaponCategory.SNIPER,  override: 25 },        // above default (10)
    ];

    for (const { category, override } of cases) {
      const loadout = new LoadoutBuilder(config)
        .withPrimary(category as WeaponCategory, override)
        .build();
      const slot = loadout.primary!;
      expect(slot.ammo).toBeLessThanOrEqual(slot.maxAmmo);
    }
  });

  it('clamps grenades to 0 minimum', () => {
    const loadout = new LoadoutBuilder(config).withGrenades(-1).build();
    expect(loadout.grenades).toBe(0);
  });

  it('preserves weapon stats from config', () => {
    const loadout = new LoadoutBuilder(config)
      .withPrimary(WeaponCategory.SNIPER)
      .build();
    const sniperCfg = config.weapons[WeaponCategory.SNIPER];
    expect(loadout.primary!.damage).toBe(sniperCfg.damage);
    expect(loadout.primary!.fireRate).toBe(sniperCfg.fireRate);
    expect(loadout.primary!.range).toEqual(sniperCfg.range);
  });
});

describe('createLoadout', () => {
  it('rank 1 gets pistol only', () => {
    const loadout = createLoadout(1, FactionWeaponPreference.rifle, config);
    expect(loadout.primary!.category).toBe(WeaponCategory.PISTOL);
    expect(loadout.secondary).toBeNull();
    expect(loadout.grenades).toBe(0);
    expect(loadout.medkits).toBe(0);
  });

  it('rank 2 gets pistol + 1 medkit', () => {
    const loadout = createLoadout(2, FactionWeaponPreference.rifle, config);
    expect(loadout.primary!.category).toBe(WeaponCategory.PISTOL);
    expect(loadout.medkits).toBe(1);
  });

  it('rank 3 rifle faction gets rifle + pistol', () => {
    const loadout = createLoadout(3, FactionWeaponPreference.rifle, config);
    expect(loadout.primary!.category).toBe(WeaponCategory.RIFLE);
    expect(loadout.secondary!.category).toBe(WeaponCategory.PISTOL);
  });

  it('rank 3 shotgun faction gets shotgun + pistol', () => {
    const loadout = createLoadout(3, FactionWeaponPreference.shotgun, config);
    expect(loadout.primary!.category).toBe(WeaponCategory.SHOTGUN);
    expect(loadout.secondary!.category).toBe(WeaponCategory.PISTOL);
  });

  it('rank 3 sniper faction falls back to rifle', () => {
    const loadout = createLoadout(3, FactionWeaponPreference.sniper, config);
    expect(loadout.primary!.category).toBe(WeaponCategory.RIFLE);
  });

  it('rank 4 adds a grenade', () => {
    const loadout = createLoadout(4, FactionWeaponPreference.rifle, config);
    expect(loadout.grenades).toBe(1);
    expect(loadout.medkits).toBe(2);
  });

  it('rank 5 gets rifle + shotgun', () => {
    const loadout = createLoadout(5, FactionWeaponPreference.rifle, config);
    expect(loadout.primary!.category).toBe(WeaponCategory.RIFLE);
    expect(loadout.secondary!.category).toBe(WeaponCategory.SHOTGUN);
  });

  it('rank 6 sniper faction gets sniper as primary', () => {
    const loadout = createLoadout(6, FactionWeaponPreference.sniper, config);
    expect(loadout.primary!.category).toBe(WeaponCategory.SNIPER);
  });

  it('rank 6 rifle faction gets rifle as primary', () => {
    const loadout = createLoadout(6, FactionWeaponPreference.rifle, config);
    expect(loadout.primary!.category).toBe(WeaponCategory.RIFLE);
  });

  it('rank 7+ gets sniper + rifle', () => {
    const loadout = createLoadout(7, FactionWeaponPreference.rifle, config);
    expect(loadout.primary!.category).toBe(WeaponCategory.SNIPER);
    expect(loadout.secondary!.category).toBe(WeaponCategory.RIFLE);
    expect(loadout.grenades).toBe(3);
    expect(loadout.medkits).toBe(3);
  });

  it('rank 8 grenades capped at 3', () => {
    const loadout = createLoadout(8, FactionWeaponPreference.rifle, config);
    expect(loadout.grenades).toBe(3);
  });

  it('rank 10 grenades still capped at 3', () => {
    const loadout = createLoadout(10, FactionWeaponPreference.rifle, config);
    expect(loadout.grenades).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Custom recipes tests
// ---------------------------------------------------------------------------
describe('createLoadout with custom recipes', () => {
  const customRecipes: Readonly<Record<number, ILoadoutRecipe>> = {
    1: { primary: WeaponCategory.SHOTGUN, grenades: 1, medkits: 1 },
    3: { primary: WeaponCategory.SNIPER, secondary: WeaponCategory.RIFLE, grenades: 2, medkits: 3 },
  };

  it('uses custom recipe for exact rank match', () => {
    const loadout = createLoadout(1, FactionWeaponPreference.rifle, config, customRecipes);
    expect(loadout.primary!.category).toBe(WeaponCategory.SHOTGUN);
    expect(loadout.grenades).toBe(1);
    expect(loadout.medkits).toBe(1);
  });

  it('uses custom recipe with secondary weapon', () => {
    const loadout = createLoadout(3, FactionWeaponPreference.rifle, config, customRecipes);
    expect(loadout.primary!.category).toBe(WeaponCategory.SNIPER);
    expect(loadout.secondary!.category).toBe(WeaponCategory.RIFLE);
    expect(loadout.grenades).toBe(2);
    expect(loadout.medkits).toBe(3);
  });

  it('uses highest rank <= current when no exact match', () => {
    // Rank 2 is not in recipes, so it should use rank 1 recipe (highest key <= 2).
    const loadout = createLoadout(2, FactionWeaponPreference.rifle, config, customRecipes);
    expect(loadout.primary!.category).toBe(WeaponCategory.SHOTGUN);
    expect(loadout.grenades).toBe(1);
  });

  it('uses highest rank <= current for high ranks', () => {
    // Rank 5 not in recipes, highest key <= 5 is 3.
    const loadout = createLoadout(5, FactionWeaponPreference.rifle, config, customRecipes);
    expect(loadout.primary!.category).toBe(WeaponCategory.SNIPER);
    expect(loadout.secondary!.category).toBe(WeaponCategory.RIFLE);
  });

  it('falls back to default logic when recipes is undefined', () => {
    const loadout = createLoadout(1, FactionWeaponPreference.rifle, config, undefined);
    expect(loadout.primary!.category).toBe(WeaponCategory.PISTOL);
    expect(loadout.secondary).toBeNull();
    expect(loadout.grenades).toBe(0);
  });

  it('useFactionPreference applies resolveMidRankPrimary', () => {
    const factionRecipes: Readonly<Record<number, ILoadoutRecipe>> = {
      1: { primary: WeaponCategory.PISTOL, grenades: 0, medkits: 0, useFactionPreference: true },
    };
    // With shotgun faction preference, useFactionPreference should resolve to shotgun.
    const loadout = createLoadout(1, FactionWeaponPreference.shotgun, config, factionRecipes);
    expect(loadout.primary!.category).toBe(WeaponCategory.SHOTGUN);
  });

  it('DEFAULT_LOADOUT_RECIPES is exported and has expected ranks', () => {
    expect(DEFAULT_LOADOUT_RECIPES[1]).toBeDefined();
    expect(DEFAULT_LOADOUT_RECIPES[2]).toBeDefined();
    expect(DEFAULT_LOADOUT_RECIPES[3]).toBeDefined();
    expect(DEFAULT_LOADOUT_RECIPES[4]).toBeDefined();
    expect(DEFAULT_LOADOUT_RECIPES[5]).toBeDefined();
    expect(DEFAULT_LOADOUT_RECIPES[6]).toBeDefined();
    expect(DEFAULT_LOADOUT_RECIPES[1].primary).toBe(WeaponCategory.PISTOL);
    expect(DEFAULT_LOADOUT_RECIPES[5].primary).toBe(WeaponCategory.RIFLE);
  });
});
