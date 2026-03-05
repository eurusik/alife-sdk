// combat/WeaponSelector.ts
// Pure-function weapon selection — multi-factor scoring.
// No side effects, no framework dependencies.

import { WeaponCategory } from '../types/IWeaponTypes';
import type { IWeaponSlot, INPCLoadout } from '../types/IWeaponTypes';
import type { IWeaponSelectionConfig } from '../types/IOnlineAIConfig';

/**
 * Tactical context for weapon selection decisions.
 * Groups NPC loadout and combat situation into a single parameter object.
 */
export interface IWeaponContext {
  readonly loadout: INPCLoadout;
  readonly distanceToEnemy: number;
  readonly enemyCount: number;
  readonly hpRatio: number;
  readonly inCombat?: boolean;
}

/**
 * Distance-based effectiveness score for a weapon category.
 * Returns a value in [0, 1] where 1 = optimal engagement range.
 */
function distanceScore(
  category: WeaponCategory,
  distance: number,
  config: IWeaponSelectionConfig,
): number {
  switch (category) {
    case WeaponCategory.PISTOL:
      return 0.4;

    case WeaponCategory.SHOTGUN: {
      if (config.shotgunEffectiveMax <= 0) return 0;
      if (distance <= config.shotgunEffectiveMax * 0.66) return 1.0;
      if (distance > config.shotgunEffectiveMax * 1.33) return 0.0;
      const overshoot =
        (distance - config.shotgunEffectiveMax * 0.66) /
        (config.shotgunEffectiveMax * 0.66);
      return Math.max(0, 1.0 - overshoot);
    }

    case WeaponCategory.RIFLE: {
      if (config.rifleEffectiveMin <= 0) return 0.6;
      if (distance >= config.rifleEffectiveMin && distance <= config.rifleEffectiveMax)
        return 1.0;
      if (distance < config.rifleEffectiveMin)
        return 0.6 + 0.4 * (distance / config.rifleEffectiveMin);
      const falloff = (distance - config.rifleEffectiveMax) / 200;
      return Math.max(0.2, 1.0 - falloff);
    }

    case WeaponCategory.SNIPER: {
      if (config.sniperEffectiveMin <= 0) return 0.1;
      if (distance >= config.sniperEffectiveMin) return 1.0;
      return 0.1 + 0.9 * (distance / config.sniperEffectiveMin);
    }

    default:
      return 0;
  }
}

/**
 * Modifier based on number of visible enemies.
 * Only activates at 3+ enemies.
 * If `config.scoringFactors` contains an entry for the category, uses its `multiEnemyModifier`.
 */
function enemyCountModifier(
  category: WeaponCategory,
  count: number,
  config: IWeaponSelectionConfig,
): number {
  if (count <= 2) return 1.0;

  const factors = config.scoringFactors?.[String(category)];
  if (factors) return factors.multiEnemyModifier;

  switch (category) {
    case WeaponCategory.SHOTGUN:
      return 1.5;
    case WeaponCategory.RIFLE:
      return 1.3;
    case WeaponCategory.SNIPER:
      return 0.6;
    default:
      return 1.0;
  }
}

/**
 * Modifier based on NPC's current HP ratio.
 * Low HP favors ranged weapons; high HP allows aggression.
 * If `config.scoringFactors` contains an entry for the category, uses its `lowHpModifier` / `highHpModifier`.
 */
function hpRatioModifier(
  category: WeaponCategory,
  hp: number,
  config: IWeaponSelectionConfig,
): number {
  const factors = config.scoringFactors?.[String(category)];

  if (hp < 0.3) {
    if (factors) return factors.lowHpModifier;
    switch (category) {
      case WeaponCategory.SNIPER:
        return 1.3;
      case WeaponCategory.RIFLE:
        return 1.2;
      case WeaponCategory.PISTOL:
        return 0.9;
      case WeaponCategory.SHOTGUN:
        return 0.7;
      default:
        return 1.0;
    }
  }

  if (hp > 0.7) {
    if (factors) return factors.highHpModifier;
    switch (category) {
      case WeaponCategory.SHOTGUN:
        return 1.2;
      case WeaponCategory.PISTOL:
        return 1.1;
      case WeaponCategory.SNIPER:
        return 0.9;
      default:
        return 1.0;
    }
  }

  return 1.0;
}

/**
 * Compute the composite weapon score (distance × enemyCount × hpRatio modifiers).
 */
function weaponScore(
  category: WeaponCategory,
  distanceToEnemy: number,
  enemyCount: number,
  hpRatio: number,
  config: IWeaponSelectionConfig,
): number {
  return (
    distanceScore(category, distanceToEnemy, config) *
    enemyCountModifier(category, enemyCount, config) *
    hpRatioModifier(category, hpRatio, config)
  );
}

/**
 * Select the highest-scoring weapon from an NPC's loadout.
 *
 * Scoring formula: `distanceScore × enemyCountModifier × hpRatioModifier`.
 * Primary weapon wins ties. Returns null if the NPC has no ammo at all
 * (signal to flee/retreat).
 *
 * Single-pass, zero-allocation — no intermediate arrays.
 *
 * @param ctx - Weapon context (loadout, distance, enemy count, HP).
 * @param config - Weapon selection configuration.
 * @returns Best weapon slot, or null if no ammo.
 */
export function selectBestWeapon(
  ctx: IWeaponContext,
  config: IWeaponSelectionConfig,
): IWeaponSlot | null {
  const { loadout, distanceToEnemy, enemyCount, hpRatio } = ctx;
  let bestSlot: IWeaponSlot | null = null;
  let bestScore = -Infinity;

  // Score primary (wins ties via evaluation order — scored first).
  if (loadout.primary && loadout.primary.ammo > 0) {
    bestScore = weaponScore(loadout.primary.category, distanceToEnemy, enemyCount, hpRatio, config);
    bestSlot = loadout.primary;
  }

  // Score secondary — must strictly beat primary to win.
  if (loadout.secondary && loadout.secondary.ammo > 0) {
    const secScore = weaponScore(loadout.secondary.category, distanceToEnemy, enemyCount, hpRatio, config);
    if (secScore > bestScore) {
      bestSlot = loadout.secondary;
    }
  }

  return bestSlot;
}

/**
 * Check whether a grenade throw is tactically advisable.
 *
 * All three conditions must be true:
 * 1. NPC has grenades remaining.
 * 2. At least `grenadeMinEnemies` visible.
 * 3. Enemy within throw range [grenadeMinDistance, grenadeMaxDistance].
 */
export function shouldThrowGrenade(
  ctx: IWeaponContext,
  config: IWeaponSelectionConfig,
): boolean {
  const { loadout, enemyCount, distanceToEnemy } = ctx;
  return (
    loadout.grenades > 0 &&
    enemyCount >= config.grenadeMinEnemies &&
    distanceToEnemy >= config.grenadeMinDistance &&
    distanceToEnemy <= config.grenadeMaxDistance
  );
}

/**
 * Check whether the NPC should use a medkit now.
 *
 * Rules:
 * - Has medkits remaining.
 * - HP below `medkitHpThreshold`.
 * - If HP below `medkitEmergencyThreshold`, use even mid-combat.
 * - Otherwise, only use when not actively in combat.
 */
export function shouldUseMedkit(
  ctx: IWeaponContext,
  config: IWeaponSelectionConfig,
): boolean {
  const { loadout, hpRatio, inCombat } = ctx;
  if (loadout.medkits <= 0) return false;
  if (hpRatio >= config.medkitHpThreshold) return false;
  if (hpRatio < config.medkitEmergencyThreshold) return true;
  return !inCombat;
}
