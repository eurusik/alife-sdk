// types/IOnlineAIConfig.ts
// Hierarchical configuration for all online AI subsystems.
// Every numeric literal in the AI package is sourced from here.

import type { IWeaponConfig, WeaponCategory } from './IWeaponTypes';
import type { IPerceptionConfig, IGOAPConfig } from './IPerceptionTypes';

/**
 * Cover system tuning constants.
 */
export interface ICoverConfig {
  /** Max search radius when finding cover (px). */
  readonly searchRadius: number;
  /** Default protection radius for cover points (px). */
  readonly pointRadius: number;
  /** Distance within which an NPC counts as "in cover" (px). */
  readonly occupyDistance: number;
  /** Minimum score threshold — points below this are rejected. */
  readonly minScoreThreshold: number;

  // --- Evaluator tuning ---
  /** CLOSE evaluator: max acceptable distance (px). */
  readonly closeMaxRange: number;
  /** FAR evaluator: max acceptable distance (px). */
  readonly farMaxRange: number;
  /** AMBUSH evaluator: minimum flanking angle (radians). */
  readonly ambushMinAngle: number;
  /** AMBUSH evaluator: maximum flanking angle (radians). */
  readonly ambushMaxAngle: number;
  /** AMBUSH evaluator: minimum distance from enemy (px). */
  readonly ambushMinDist: number;
  /** AMBUSH evaluator: maximum distance from enemy (px). */
  readonly ambushMaxDist: number;

  // --- Recommender tuning ---
  /** HP ratio below which cover is critical (CLOSE). */
  readonly recommendHpCritical: number;
  /** HP ratio above which NPC can be offensive (AMBUSH). */
  readonly recommendHpHealthy: number;
  /** Morale below which NPC should flee (FAR/SAFE). */
  readonly recommendMoraleDemoralized: number;
  /** Enemy count above which SAFE is preferred. */
  readonly recommendOutnumberedCount: number;

  // --- Loophole tuning ---
  /** Total angular width of a loophole firing arc (radians). */
  readonly loopholeFireArc: number;
  /** Maximum loopholes per cover point. */
  readonly loopholeMaxPerCover: number;
  /** Distance from cover center to peek position (px). */
  readonly loopholeOffsetDistance: number;
}

/**
 * Navigation and pathfinding tuning constants.
 */
export interface INavigationConfig {
  /** CatmullRom interpolation points per path segment. */
  readonly smoothPointsPerSegment: number;
  /** Max random jitter offset for path smoothing (px). */
  readonly smoothRandomOffset: number;
  /** Distance threshold for considering a waypoint reached (px). */
  readonly arrivalThreshold: number;
  /** Maximum turn angle before Dubins arc insertion (radians). */
  readonly dubinsMaxInstantTurn: number;
  /** Turning radius for Dubins arcs (px). */
  readonly dubinsTurningRadius: number;
  /** Velocity multiplier for straight segments. */
  readonly velocityCurveFast: number;
  /** Velocity multiplier for moderate turns. */
  readonly velocityCurveMedium: number;
  /** Velocity multiplier for sharp turns. */
  readonly velocityCurveSlow: number;
  /** Interpolation rate for velocity transitions per step. */
  readonly velocityTransitionRate: number;
  /** Safety margin around restricted zones (px). */
  readonly restrictedZoneSafeMargin: number;
}

/**
 * Per-weapon-category scoring factors for multi-factor weapon selection.
 * When provided in `IWeaponSelectionConfig.scoringFactors`, overrides the
 * hardcoded enemy-count and HP-ratio modifiers for the given category.
 */
export interface IWeaponScoringFactors {
  /** Base effectiveness score (unused by default distance scoring, reserved for extensions). */
  readonly baseEffectiveness: number;
  /** Modifier applied when 3+ enemies are visible. */
  readonly multiEnemyModifier: number;
  /** Modifier applied when HP ratio < 0.3. */
  readonly lowHpModifier: number;
  /** Modifier applied when HP ratio > 0.7. */
  readonly highHpModifier: number;
}

/**
 * Weapon selection and loadout tuning constants.
 */
export interface IWeaponSelectionConfig {
  /** Per-weapon-category configurations. */
  readonly weapons: Readonly<Record<WeaponCategory, IWeaponConfig>>;
  /** Shotgun maximum effective range (px). */
  readonly shotgunEffectiveMax: number;
  /** Rifle minimum effective range (px). */
  readonly rifleEffectiveMin: number;
  /** Rifle maximum effective range (px). */
  readonly rifleEffectiveMax: number;
  /** Sniper minimum effective range (px). */
  readonly sniperEffectiveMin: number;
  /** Minimum throw distance for grenades (px). */
  readonly grenadeMinDistance: number;
  /** Maximum throw distance for grenades (px). */
  readonly grenadeMaxDistance: number;
  /** Minimum enemies to justify a grenade throw. */
  readonly grenadeMinEnemies: number;
  /** HP ratio threshold to consider using a medkit. */
  readonly medkitHpThreshold: number;
  /** HP ratio below which medkit is used even in combat. */
  readonly medkitEmergencyThreshold: number;
  /** Optional per-category scoring overrides for enemy-count and HP-ratio modifiers. */
  readonly scoringFactors?: Readonly<Record<string, IWeaponScoringFactors>>;
}

/**
 * Squad tactical evaluation tuning.
 */
export interface ISquadTacticsConfig {
  /** Enemy-to-ally ratio above which the squad is outnumbered. */
  readonly outnumberRatio: number;
  /** Morale value at which NPC is considered panicked. */
  readonly moralePanickedThreshold: number;
  /** Distance within which squad members are considered "nearby" (px). */
  readonly nearbyRadius: number;
}

/**
 * Monster ability timing constants.
 */
export interface IMonsterAbilityConfig {
  // Charge (Boar)
  readonly chargeWindupMs: number;
  readonly chargeDamageMult: number;
  readonly chargeSpeedMult: number;
  // Stalk (Bloodsucker)
  readonly stalkApproachDist: number;
  readonly stalkAlphaInvisible: number;
  readonly stalkUncloakDist: number;
  // Leap (Snork)
  readonly leapWindupMs: number;
  readonly leapAirtimeMs: number;
  readonly leapDamageMult: number;
  // PSI Attack (Controller)
  readonly psiChannelMs: number;
  readonly psiRadius: number;
  readonly psiDamagePerTick: number;
}

/**
 * Root configuration for all online AI subsystems.
 * Passed to AIPlugin constructor; each subsystem reads its own section.
 */
export interface IOnlineAIConfig {
  readonly cover: ICoverConfig;
  readonly navigation: INavigationConfig;
  readonly weapon: IWeaponSelectionConfig;
  readonly squad: ISquadTacticsConfig;
  readonly monsterAbility: IMonsterAbilityConfig;
  readonly perception: IPerceptionConfig;
  readonly goap: IGOAPConfig;
}
