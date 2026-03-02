// states/IStateConfig.ts
// All hardcoded online-AI constants as a single config object.
// State handlers must read values exclusively from this interface —
// no magic numbers allowed in handler files.

import type { ISteeringConfig } from '../navigation/SteeringBehaviors';
import type { ConditionChannel } from '../conditions/ConditionBank';

// ---------------------------------------------------------------------------
// Sub-interfaces
// ---------------------------------------------------------------------------

/**
 * Movement speeds and distance thresholds used by locomotion logic.
 *
 * Any game that runs only melee/monster AI can satisfy this sub-interface
 * without needing the full {@link IStateConfig}.
 */
export interface IMovementConfig {
  // -------------------------------------------------------------------------
  // Movement speeds (px/s)
  // -------------------------------------------------------------------------

  /** Base approach speed when closing distance to an enemy. */
  approachSpeed: number;

  /** Speed multiplier applied when fleeing (FLEE state). */
  fleeSpeedMultiplier: number;

  /** Additional speed multiplier applied when morale is PANICKED. */
  panicFleeMultiplier: number;

  /** Speed multiplier for a wounded NPC crawling away. */
  woundedCrawlMultiplier: number;

  /** Speed multiplier for grenade evasion sprint. */
  evadeSpeedMultiplier: number;

  /** Speed multiplier for a boar charge attack. */
  chargeSpeedMultiplier: number;

  /** Speed multiplier for bloodsucker stalk approach. */
  stalkSpeedMultiplier: number;

  // -------------------------------------------------------------------------
  // Distance thresholds (pixels)
  // -------------------------------------------------------------------------

  /** Arrival threshold for generic waypoint navigation (px). */
  arriveThreshold: number;

  /** Arrival threshold for patrol waypoint advance (px). */
  waypointArriveThreshold: number;

  /** Maximum distance to engage an enemy before stopping and firing (px). */
  combatRange: number;

  /** Distance an NPC tries to put between itself and a threat when fleeing (px). */
  fleeDistance: number;

  /** Safe distance after grenade evasion sprint before resuming previous state (px). */
  evadeSafeDistance: number;

  /** Range at which a wounded NPC may try a last-stand shot (px). */
  woundedLastStandRange: number;

  /** Melee attack range (px) for monster close-combat states. */
  meleeRange: number;

  /** Distance at which a bloodsucker uncloaks for the melee strike (px). */
  stalkUnclockDistance: number;

  /** Interval (ms) between restricted-zone position checks. */
  restrictedZoneCheckIntervalMs: number;

  /**
   * Optional flocking / pack-movement configuration.
   * State handlers that support group steering call
   * `createDefaultSteeringConfig(cfg.steering)` once in their constructor.
   * Omit to use the built-in defaults.
   */
  readonly steering?: Partial<ISteeringConfig>;
}

/**
 * Weapons, firing rates, damage, and morale thresholds for human combat.
 *
 * Fields that control how ranged combat, grenades, covers, and HP/morale
 * transitions work for human NPCs.
 */
export interface ICombatConfig {
  // -------------------------------------------------------------------------
  // HP thresholds (ratio 0–1, inclusive)
  // -------------------------------------------------------------------------

  /** HP ratio below which the NPC enters the WOUNDED state. */
  woundedHpThreshold: number;

  // -------------------------------------------------------------------------
  // Morale thresholds (value in [-1, 1])
  // -------------------------------------------------------------------------

  /** Morale value at which the NPC transitions from COMBAT to RETREAT. */
  retreatMoraleThreshold: number;

  /** Morale value at which the NPC transitions to FLEE (panic flight). */
  panicMoraleThreshold: number;

  // -------------------------------------------------------------------------
  // Firing / grenade
  // -------------------------------------------------------------------------

  /** Minimum interval (ms) between successive NPC gunshots. */
  fireRateMs: number;

  /** Wind-up duration (ms) before a grenade is thrown. */
  grenadeWindupMs: number;

  // -------------------------------------------------------------------------
  // Damage values (human combat)
  // -------------------------------------------------------------------------

  /** Base bullet damage when no weapon loadout is assigned. */
  bulletDamage: number;

  /** Fraction of max HP restored by a single medkit use. */
  medkitHealRatio: number;

  /** Duration (ms) of the medkit use animation before the heal is applied. */
  medkitUseDurationMs: number;

  /**
   * HP ratio below which a visible enemy is considered "wounded" and may trigger
   * the KILL_WOUNDED behavior in CombatState / AlertState.
   * Opt-in — only used when `getWoundedEnemies()` is implemented by the host.
   * @default 0.25
   */
  killWoundedEnemyHpThreshold: number;

  /**
   * Approach range (px) at which KillWoundedState stops moving and enters the
   * AIM phase. Shorter than combatRange — execution happens at close quarters.
   * @default 80
   */
  killWoundedExecuteRange: number;
}

/**
 * Monster-specific melee, ability, and lair parameters.
 *
 * A zombie or creature game only needs this sub-interface — no ranged-weapon
 * fields or grenade logic required.
 */
export interface IMonsterConfig {
  // -------------------------------------------------------------------------
  // Damage values (monsters)
  // -------------------------------------------------------------------------

  /** Base melee damage for monster close-combat strikes. */
  meleeDamage: number;

  /** Damage multiplier for a boar charge impact hit. */
  chargeDamageMultiplier: number;

  // -------------------------------------------------------------------------
  // Melee cooldown
  // -------------------------------------------------------------------------

  /** Cooldown (ms) between successive melee strikes. */
  meleeCooldownMs: number;

  // -------------------------------------------------------------------------
  // Monster ability durations (milliseconds)
  // -------------------------------------------------------------------------

  /** Wind-up phase duration (ms) before boar starts charging. */
  chargeWindupMs: number;

  /** Wind-up phase duration (ms) before a snork leaps. */
  leapWindupMs: number;

  /** Airborne phase duration (ms) for the snork leap. */
  leapAirtimeMs: number;

  /** Channel phase duration (ms) for the controller PSI attack. */
  psiChannelMs: number;

  // -------------------------------------------------------------------------
  // Monster lair radii (pixels)
  // -------------------------------------------------------------------------

  /** Inner lair radius — monster will not leave without a target (px). */
  innerLairRadius: number;

  /** Patrol radius — normal movement band around the anchor (px). */
  patrolRadius: number;

  /** Outer lair radius — hard chase break distance (px). */
  outerRadius: number;

  // -------------------------------------------------------------------------
  // Bloodsucker visual alpha values (0–1)
  // -------------------------------------------------------------------------

  /** Alpha while fully invisible during stalk approach. */
  stalkAlphaInvisible: number;

  /** Alpha shimmer while moving during stalk approach. */
  stalkAlphaShimmer: number;
}

/**
 * Timeouts, durations, and periodic intervals that drive state timing.
 *
 * Centralises all "how long does this state last?" constants so SDK users
 * can tune AI responsiveness without touching individual state handlers.
 */
export interface ITimingConfig {
  // -------------------------------------------------------------------------
  // State durations (ms)
  // -------------------------------------------------------------------------

  /** How long (ms) the NPC stays in ALERT before reverting to PATROL/IDLE. */
  alertDuration: number;

  /** How long (ms) the NPC searches before giving up and returning to IDLE. */
  searchDuration: number;

  /** Maximum time (ms) spent in WOUNDED state before transitioning to FLEE. */
  woundedMaxDurationMs: number;

  /** Maximum time (ms) spent in RETREAT state before transitioning to FLEE. */
  retreatMaxDurationMs: number;

  /** Interval (ms) between suppressive shots fired during RETREAT. */
  retreatFireIntervalMs: number;

  /** Duration (ms) of the target-inertia lock (prevents rapid target switching). */
  inertiaLockMs: number;

  /** Delay (ms) before a camp/sleep NPC reacts to a detected threat. */
  schemeReactionDelayMs: number;

  /** Delay (ms) before a sleeping NPC reacts (longer than normal camp delay). */
  campSleepReactionDelayMs: number;

  /**
   * Condition channel monitored in IdleState for fatigue/sickness transitions.
   * Opt-in — only checked when `ctx.conditions` is non-null.
   * @default 'stamina'
   */
  idleConditionChannel: ConditionChannel;

  /**
   * Condition intensity above which IdleState transitions to rest/camp.
   * Uses strict `>` comparison against the channel level.
   * @default 0.8
   */
  idleConditionThreshold: number;

  /**
   * Suspicion level above which IDLE/PATROL transitions to the alert state.
   * Opt-in — only checked when `ctx.suspicion` is non-null.
   * Uses strict `>` comparison via {@link ISuspicionAccess.hasReachedAlert}.
   * @default 0.7
   */
  suspicionAlertThreshold: number;

  /**
   * Maximum time (ms) spent in the APPROACH phase before giving up and
   * transitioning via `investigateOnTimeout`. Prevents NPCs from getting
   * stuck indefinitely when the investigation point is unreachable.
   * @default 10000
   */
  investigateMaxDurationMs: number;

  /**
   * How long (ms) the NPC spends "looking around" at the investigate location
   * before concluding no threat is present and returning to PATROL/IDLE.
   * @default 3000
   */
  investigateLookAroundMs: number;

  /**
   * How long (ms) the NPC stands next to the wounded ally providing assistance.
   * @default 5000
   */
  helpWoundedAssistMs: number;

  /**
   * Maximum time (ms) for the APPROACH phase of HelpWoundedState before giving up.
   * @default 10000
   */
  helpWoundedMaxDurationMs: number;

  /**
   * Suspicion amount added to the accumulator when the NPC spots a friendly corpse.
   * Only active when `ctx.suspicion` is non-null and `getVisibleCorpses()` is implemented.
   * @default 0.6
   */
  corpseFoundSuspicion: number;

  /**
   * Maximum time (ms) allowed for the APPROACH phase of KillWoundedState before
   * aborting and transitioning via `killWoundedOnTimeout`.
   * @default 8000
   */
  killWoundedMaxApproachMs: number;

  /**
   * Duration (ms) of the AIM phase (weapon-raise pause) before taunting.
   * @default 800
   */
  killWoundedAimMs: number;

  /**
   * Duration (ms) of the TAUNT phase (bark plays out) before firing.
   * @default 1200
   */
  killWoundedTauntMs: number;

  /**
   * Number of shots to fire in the EXECUTE burst.
   * @default 3
   */
  killWoundedBurstCount: number;

  /**
   * Duration (ms) to stand still after all burst shots fired (PAUSE phase).
   * Equivalent to X-Ray's PauseAfterKill 1000ms inertia.
   * @default 1000
   */
  killWoundedPauseMs: number;

  /**
   * Minimum interval (ms) between outgoing pack broadcasts from MonsterCombatController.
   * Prevents saturating the host's pack record with per-frame writes.
   * @default 500
   */
  packAlertIntervalMs: number;

  /**
   * Time-to-live (ms) for a pack alert level without a refresh broadcast.
   * Host implementations should reset the level to 'NONE' after this duration
   * to prevent PATROL↔ALERT livelock when contacts fade.
   * @default 5000
   */
  packAlertTtlMs: number;

  // -------------------------------------------------------------------------
  // Loophole peek-fire cycle (TakeCoverState)
  // -------------------------------------------------------------------------

  /** Minimum random wait duration (ms) while hiding behind cover. */
  loopholeWaitMinMs: number;

  /** Maximum random wait duration (ms) while hiding behind cover. */
  loopholeWaitMaxMs: number;

  /** Duration (ms) of the peek-out phase before firing. */
  loopholePeekDurationMs: number;

  /** Duration (ms) of the fire phase while peeked out. */
  loopholeFireDurationMs: number;

  /** Duration (ms) of the return-to-cover phase after firing. */
  loopholeReturnDurationMs: number;
}

// ---------------------------------------------------------------------------
// Composed type
// ---------------------------------------------------------------------------

/**
 * Complete set of tuning constants for all online AI state handlers.
 *
 * Composes all four sub-interfaces via intersection so existing code using
 * `IStateConfig` compiles unchanged.  For minimal usage (e.g. a monster-only
 * game that needs no ranged combat), you can satisfy individual sub-interfaces
 * instead of the full `IStateConfig`.
 *
 * Create with {@link createDefaultStateConfig} and override individual fields
 * to customise the AI behaviour without modifying any handler code.
 *
 * @example
 * ```ts
 * // Full config for a human NPC
 * const cfg = createDefaultStateConfig({ combatRange: 250 });
 *
 * // Partial config — just movement for a simple platformer enemy
 * const move: IMovementConfig = createDefaultStateConfig({ approachSpeed: 80 });
 * ```
 */
export type IStateConfig = IMovementConfig & ICombatConfig & IMonsterConfig & ITimingConfig;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a {@link IStateConfig} pre-populated with the production defaults
 * extracted from the game-layer constants.
 *
 * Call with a partial override object to customise individual values:
 * ```ts
 * const cfg = createDefaultStateConfig({ combatRange: 250 });
 * ```
 */
export function createDefaultStateConfig(
  overrides?: Partial<IStateConfig>,
): IStateConfig {
  return {
    // -----------------------------------------------------------------------
    // IMovementConfig
    // -----------------------------------------------------------------------
    approachSpeed: 150,
    fleeSpeedMultiplier: 1.5,
    panicFleeMultiplier: 1.3,
    woundedCrawlMultiplier: 0.3,
    evadeSpeedMultiplier: 1.5,
    chargeSpeedMultiplier: 2.0,
    stalkSpeedMultiplier: 0.4,

    arriveThreshold: 12,
    waypointArriveThreshold: 24,
    combatRange: 200,
    fleeDistance: 400,
    evadeSafeDistance: 200,
    woundedLastStandRange: 100,
    meleeRange: 48,
    stalkUnclockDistance: 80,
    restrictedZoneCheckIntervalMs: 1_000,

    // -----------------------------------------------------------------------
    // ICombatConfig
    // -----------------------------------------------------------------------
    woundedHpThreshold: 0.2,
    retreatMoraleThreshold: -0.3,
    panicMoraleThreshold: -0.7,

    fireRateMs: 1_000,
    grenadeWindupMs: 1_000,

    bulletDamage: 10,
    medkitHealRatio: 0.5,
    medkitUseDurationMs: 3_000,
    killWoundedEnemyHpThreshold: 0.25,
    killWoundedExecuteRange: 80,

    // -----------------------------------------------------------------------
    // IMonsterConfig
    // -----------------------------------------------------------------------
    meleeDamage: 15,
    chargeDamageMultiplier: 2.0,
    meleeCooldownMs: 1_000,

    chargeWindupMs: 600,
    leapWindupMs: 400,
    leapAirtimeMs: 350,
    psiChannelMs: 2_000,

    innerLairRadius: 80,
    patrolRadius: 180,
    outerRadius: 350,

    stalkAlphaInvisible: 0.08,
    stalkAlphaShimmer: 0.3,

    // -----------------------------------------------------------------------
    // ITimingConfig
    // -----------------------------------------------------------------------
    alertDuration: 5_000,
    searchDuration: 8_000,
    woundedMaxDurationMs: 15_000,
    retreatMaxDurationMs: 8_000,
    retreatFireIntervalMs: 2_000,
    inertiaLockMs: 3_000,
    schemeReactionDelayMs: 400,
    campSleepReactionDelayMs: 800,

    idleConditionChannel: 'stamina',
    idleConditionThreshold: 0.8,
    suspicionAlertThreshold: 0.7,
    investigateMaxDurationMs: 10_000,
    investigateLookAroundMs: 3_000,
    helpWoundedAssistMs: 5_000,
    helpWoundedMaxDurationMs: 10_000,
    corpseFoundSuspicion: 0.6,
    killWoundedMaxApproachMs: 8_000,
    killWoundedAimMs: 800,
    killWoundedTauntMs: 1_200,
    killWoundedBurstCount: 3,
    killWoundedPauseMs: 1_000,
    packAlertIntervalMs: 500,
    packAlertTtlMs: 5_000,

    loopholeWaitMinMs: 1_500,
    loopholeWaitMaxMs: 3_000,
    loopholePeekDurationMs: 600,
    loopholeFireDurationMs: 1_200,
    loopholeReturnDurationMs: 400,

    ...overrides,
  };
}
