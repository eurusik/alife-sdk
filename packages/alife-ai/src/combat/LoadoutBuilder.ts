// combat/LoadoutBuilder.ts
// Builder pattern for creating NPC weapon loadouts.
// Clean, fluent API — no framework dependencies.

import { WeaponCategory } from '../types/IWeaponTypes';
import type { IWeaponSlot, INPCLoadout } from '../types/IWeaponTypes';
import type { IWeaponSelectionConfig } from '../types/IOnlineAIConfig';

/**
 * Builds an NPC loadout step-by-step with a fluent API.
 *
 * @example
 * ```ts
 * const loadout = new LoadoutBuilder(config.weapon)
 *   .withPrimary(WeaponCategory.RIFLE)
 *   .withSecondary(WeaponCategory.PISTOL)
 *   .withGrenades(2)
 *   .withMedkits(1)
 *   .build();
 * ```
 */
export class LoadoutBuilder {
  private primary: IWeaponSlot | null = null;
  private secondary: IWeaponSlot | null = null;
  private grenades = 0;
  private medkits = 0;
  private readonly weaponConfigs: IWeaponSelectionConfig;

  constructor(weaponConfigs: IWeaponSelectionConfig) {
    this.weaponConfigs = weaponConfigs;
  }

  withPrimary(category: WeaponCategory, ammo?: number): this {
    this.primary = this.createSlot(category, ammo);
    return this;
  }

  withSecondary(category: WeaponCategory, ammo?: number): this {
    this.secondary = this.createSlot(category, ammo);
    return this;
  }

  withGrenades(count: number): this {
    this.grenades = Math.max(0, count);
    return this;
  }

  withMedkits(count: number): this {
    this.medkits = Math.max(0, count);
    return this;
  }

  build(): INPCLoadout {
    return {
      primary: this.primary,
      secondary: this.secondary,
      grenades: this.grenades,
      medkits: this.medkits,
    };
  }

  private createSlot(category: WeaponCategory, ammoOverride?: number): IWeaponSlot {
    const cfg = this.weaponConfigs.weapons[category];
    if (!cfg) {
      throw new Error(`[LoadoutBuilder] Unknown weapon category: ${String(category)}. Register it in IWeaponSelectionConfig.weapons.`);
    }
    const ammo = ammoOverride ?? cfg.defaultAmmo;
    return {
      category,
      ammo,
      maxAmmo: Math.max(ammo, cfg.defaultAmmo),
      range: cfg.range,
      damage: cfg.damage,
      fireRate: cfg.fireRate,
    };
  }
}

/**
 * Preferred weapon type for faction-based loadout generation.
 * Maps to a WeaponCategory used as the primary at mid ranks.
 */
/**
 * Recipe for creating a rank-appropriate NPC loadout.
 * When `useFactionPreference` is true, the primary weapon is resolved
 * via `resolveMidRankPrimary(factionPreference)` instead of using the literal `primary` value.
 */
export interface ILoadoutRecipe {
  readonly primary: WeaponCategory;
  readonly secondary?: WeaponCategory | null;
  readonly grenades: number;
  readonly medkits: number;
  readonly useFactionPreference?: boolean;
}

/**
 * Default rank → loadout recipes matching the original if-else chain.
 * Ranks not present (7+) fall through to formula-based generation.
 */
export const DEFAULT_LOADOUT_RECIPES: Readonly<Record<number, ILoadoutRecipe>> = {
  1: { primary: WeaponCategory.PISTOL, grenades: 0, medkits: 0 },
  2: { primary: WeaponCategory.PISTOL, grenades: 0, medkits: 1 },
  3: { primary: WeaponCategory.PISTOL, grenades: 0, medkits: 1, useFactionPreference: true, secondary: WeaponCategory.PISTOL },
  4: { primary: WeaponCategory.PISTOL, grenades: 1, medkits: 2, useFactionPreference: true, secondary: WeaponCategory.PISTOL },
  5: { primary: WeaponCategory.RIFLE, secondary: WeaponCategory.SHOTGUN, grenades: 1, medkits: 2 },
  6: { primary: WeaponCategory.RIFLE, secondary: WeaponCategory.SHOTGUN, grenades: 2, medkits: 2 },
};

export const FactionWeaponPreference = {
  rifle: WeaponCategory.RIFLE,
  shotgun: WeaponCategory.SHOTGUN,
  pistol: WeaponCategory.PISTOL,
  sniper: WeaponCategory.SNIPER,
} as const;

export type FactionWeaponPreference =
  (typeof FactionWeaponPreference)[keyof typeof FactionWeaponPreference];

/**
 * Resolve the primary weapon for mid-rank NPCs (rank 3–4) based on faction preference.
 * Sniper is too advanced for rookies — falls back to rifle.
 */
function resolveMidRankPrimary(preference: WeaponCategory): WeaponCategory {
  if (preference === WeaponCategory.SHOTGUN) return WeaponCategory.SHOTGUN;
  if (preference === WeaponCategory.SNIPER) return WeaponCategory.RIFLE;
  return WeaponCategory.RIFLE;
}

/**
 * Create a rank-appropriate loadout for an NPC.
 *
 * Rank determines the tier of equipment. Faction preference
 * influences weapon choice at mid ranks where multiple options
 * are viable.
 *
 * | Rank | Primary | Secondary | Grenades | Medkits |
 * |------|---------|-----------|----------|---------|
 * | 1    | PISTOL  | —         | 0        | 0       |
 * | 2    | PISTOL  | —         | 0        | 1       |
 * | 3    | faction | PISTOL    | 0        | 1       |
 * | 4    | faction | PISTOL    | 1        | 2       |
 * | 5    | RIFLE   | SHOTGUN   | 1        | 2       |
 * | 6    | RIFLE*  | SHOTGUN   | 2        | 2       |
 * | 7+   | SNIPER  | RIFLE     | min(r-4,3) | 3    |
 *
 * *At rank 6, sniper factions get SNIPER as primary.
 *
 * @param recipes - Optional custom recipe map. If provided and a matching rank
 *   entry exists (exact or highest rank <= current), it is used instead of the
 *   built-in if-else chain. If not provided, the original hardcoded logic applies.
 */
export function createLoadout(
  rank: number,
  factionPreference: WeaponCategory,
  config: IWeaponSelectionConfig,
  recipes?: Readonly<Record<number, ILoadoutRecipe>>,
): INPCLoadout {
  if (recipes) {
    const recipe = findRecipe(rank, recipes);
    if (recipe) {
      return applyRecipe(recipe, factionPreference, config);
    }
  }

  return createLoadoutDefault(rank, factionPreference, config);
}

/**
 * Find the best matching recipe for the given rank.
 * Returns exact match, or the highest rank key <= current rank.
 * Returns undefined if no suitable recipe exists.
 */
function findRecipe(
  rank: number,
  recipes: Readonly<Record<number, ILoadoutRecipe>>,
): ILoadoutRecipe | undefined {
  if (recipes[rank]) return recipes[rank];

  // Find highest rank key that is <= current rank.
  let bestKey = -1;
  for (const key of Object.keys(recipes)) {
    const k = Number(key);
    if (k <= rank && k > bestKey) bestKey = k;
  }

  return bestKey >= 0 ? recipes[bestKey] : undefined;
}

/**
 * Apply a recipe to build a loadout.
 */
function applyRecipe(
  recipe: ILoadoutRecipe,
  factionPreference: WeaponCategory,
  config: IWeaponSelectionConfig,
): INPCLoadout {
  const b = new LoadoutBuilder(config);

  const primaryCategory = recipe.useFactionPreference
    ? resolveMidRankPrimary(factionPreference)
    : recipe.primary;
  b.withPrimary(primaryCategory);

  if (recipe.secondary != null) {
    b.withSecondary(recipe.secondary);
  }

  b.withGrenades(recipe.grenades);
  b.withMedkits(recipe.medkits);

  return b.build();
}

/**
 * Original hardcoded loadout creation logic (unchanged).
 */
function createLoadoutDefault(
  rank: number,
  factionPreference: WeaponCategory,
  config: IWeaponSelectionConfig,
): INPCLoadout {
  const b = new LoadoutBuilder(config);

  if (rank <= 1) {
    return b.withPrimary(WeaponCategory.PISTOL).build();
  }

  if (rank === 2) {
    return b.withPrimary(WeaponCategory.PISTOL).withMedkits(1).build();
  }

  if (rank === 3) {
    return b
      .withPrimary(resolveMidRankPrimary(factionPreference))
      .withSecondary(WeaponCategory.PISTOL)
      .withMedkits(1)
      .build();
  }

  if (rank === 4) {
    return b
      .withPrimary(resolveMidRankPrimary(factionPreference))
      .withSecondary(WeaponCategory.PISTOL)
      .withGrenades(1)
      .withMedkits(2)
      .build();
  }

  if (rank === 5) {
    return b
      .withPrimary(WeaponCategory.RIFLE)
      .withSecondary(WeaponCategory.SHOTGUN)
      .withGrenades(1)
      .withMedkits(2)
      .build();
  }

  if (rank === 6) {
    const primary =
      factionPreference === WeaponCategory.SNIPER
        ? WeaponCategory.SNIPER
        : WeaponCategory.RIFLE;
    return b
      .withPrimary(primary)
      .withSecondary(WeaponCategory.SHOTGUN)
      .withGrenades(2)
      .withMedkits(2)
      .build();
  }

  // Rank 7+
  return b
    .withPrimary(WeaponCategory.SNIPER)
    .withSecondary(WeaponCategory.RIFLE)
    .withGrenades(Math.min(rank - 4, 3))
    .withMedkits(3)
    .build();
}
