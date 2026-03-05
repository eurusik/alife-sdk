// config/createDefaultAIConfig.ts
// Factory for production-tuned AI configuration with selective overrides.

import { WeaponCategory } from '../types/IWeaponTypes';
import type { IOnlineAIConfig } from '../types/IOnlineAIConfig';

/**
 * Create a fully populated AI config with production defaults.
 *
 * Each subsystem section can be partially overridden. Values not provided
 * fall back to battle-tested defaults from the reference implementation.
 *
 * @example
 * ```ts
 * const config = createDefaultAIConfig({
 *   cover: { searchRadius: 500 },
 *   navigation: { arrivalThreshold: 12 },
 * });
 * ```
 */
export function createDefaultAIConfig(
  overrides?: Partial<{
    cover: Partial<IOnlineAIConfig['cover']>;
    navigation: Partial<IOnlineAIConfig['navigation']>;
    weapon: Partial<IOnlineAIConfig['weapon']>;
    squad: Partial<IOnlineAIConfig['squad']>;
    monsterAbility: Partial<IOnlineAIConfig['monsterAbility']>;
    perception: Partial<IOnlineAIConfig['perception']>;
    goap: Partial<IOnlineAIConfig['goap']>;
  }>,
): IOnlineAIConfig {
  return {
    cover: {
      searchRadius: 400,
      pointRadius: 24,
      occupyDistance: 30,
      minScoreThreshold: 0.1,
      closeMaxRange: 200,
      farMaxRange: 600,
      ambushMinAngle: Math.PI / 3,
      ambushMaxAngle: (2 * Math.PI) / 3,
      ambushMinDist: 100,
      ambushMaxDist: 300,
      recommendHpCritical: 0.2,
      recommendHpHealthy: 0.6,
      recommendMoraleDemoralized: -0.5,
      recommendOutnumberedCount: 3,
      loopholeFireArc: (2 * Math.PI) / 3,
      loopholeMaxPerCover: 3,
      loopholeOffsetDistance: 16,
      ...overrides?.cover,
    },
    navigation: {
      smoothPointsPerSegment: 8,
      smoothRandomOffset: 10,
      arrivalThreshold: 8,
      dubinsMaxInstantTurn: Math.PI / 4,
      dubinsTurningRadius: 60,
      velocityCurveFast: 1.0,
      velocityCurveMedium: 0.7,
      velocityCurveSlow: 0.4,
      velocityTransitionRate: 0.15,
      restrictedZoneSafeMargin: 20,
      ...overrides?.navigation,
    },
    weapon: {
      weapons: {
        [WeaponCategory.PISTOL]: {
          category: WeaponCategory.PISTOL,
          range: { min: 0, max: 250 },
          damage: 15,
          fireRate: 1.5,
          defaultAmmo: 15,
        },
        [WeaponCategory.SHOTGUN]: {
          category: WeaponCategory.SHOTGUN,
          range: { min: 0, max: 150 },
          damage: 40,
          fireRate: 1.0,
          defaultAmmo: 8,
        },
        [WeaponCategory.RIFLE]: {
          category: WeaponCategory.RIFLE,
          range: { min: 100, max: 400 },
          damage: 25,
          fireRate: 2.0,
          defaultAmmo: 30,
        },
        [WeaponCategory.SNIPER]: {
          category: WeaponCategory.SNIPER,
          range: { min: 300, max: 800 },
          damage: 60,
          fireRate: 0.5,
          defaultAmmo: 10,
        },
        [WeaponCategory.GRENADE]: {
          category: WeaponCategory.GRENADE,
          range: { min: 100, max: 400 },
          damage: 80,
          fireRate: 0.2,
          defaultAmmo: 1,
        },
        [WeaponCategory.MEDKIT]: {
          category: WeaponCategory.MEDKIT,
          range: { min: 0, max: 0 },
          damage: 0,
          fireRate: 0,
          defaultAmmo: 1,
        },
      },
      shotgunEffectiveMax: 150,
      rifleEffectiveMin: 100,
      rifleEffectiveMax: 400,
      sniperEffectiveMin: 300,
      grenadeMinDistance: 100,
      grenadeMaxDistance: 400,
      grenadeMinEnemies: 2,
      medkitHpThreshold: 0.5,
      medkitEmergencyThreshold: 0.2,
      ...overrides?.weapon,
    },
    squad: {
      outnumberRatio: 1.5,
      moralePanickedThreshold: -0.7,
      nearbyRadius: 200,
      ...overrides?.squad,
    },
    monsterAbility: {
      chargeWindupMs: 600,
      chargeDamageMult: 2.0,
      chargeSpeedMult: 2.0,
      stalkApproachDist: 80,
      stalkAlphaInvisible: 0.08,
      stalkUncloakDist: 50,
      leapWindupMs: 400,
      leapAirtimeMs: 350,
      leapDamageMult: 1.5,
      psiChannelMs: 2000,
      psiRadius: 200,
      psiDamagePerTick: 15,
      ...overrides?.monsterAbility,
    },
    perception: {
      visionRange: 300,
      visionHalfAngle: Math.PI / 3,
      hearingRange: 500,
      weaponSoundRange: 600,
      ...overrides?.perception,
    },
    goap: {
      replanIntervalMs: 5000,
      eliteRankThreshold: 5,
      healHpThreshold: 0.3,
      maxPlanDepth: 10,
      dangerMemoryMaxAge: 5000,
      ...overrides?.goap,
    },
  };
}
