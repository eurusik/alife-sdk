// states/INPCOnlineState.ts
// Mutable per-NPC AI data bag.
//
// All online state handlers are stateless singletons — per-NPC runtime state
// lives here rather than in the handlers themselves. This mirrors the
// AIComponent design in the game layer but strips all Phaser references,
// making it usable in framework-agnostic environments (tests, server-side, etc.)

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type { IEatCorpsePhase } from './eat-corpse/IEatCorpsePhase';

// ---------------------------------------------------------------------------
// Sub-state interfaces
// ---------------------------------------------------------------------------

/**
 * TakeCoverState loophole peek-fire-return-wait cycle phase data.
 * Mirrors the game-layer LoopholeData class as a plain data interface.
 */
export interface ILoopholeState {
  /** Current phase within the peek-fire cycle. */
  phase: 'WAIT' | 'PEEK' | 'FIRE' | 'RETURN';
  /** scene.time.now (or equivalent) at the start of the current phase (ms). */
  phaseStartMs: number;
}

/**
 * Boar charge attack phase data.
 * Mirrors ChargeData from the game layer.
 */
export interface IChargePhase {
  /** Whether the charge sequence has been activated this combat cycle. */
  active: boolean;
  /** scene.time.now at the start of the charge wind-up (ms). */
  windupStartMs: number;
  /** Whether the NPC is currently in the full-speed charge phase. */
  charging: boolean;
  /** World X of the charge target when the charge was initiated. */
  targetX: number;
  /** World Y of the charge target when the charge was initiated. */
  targetY: number;
}

/**
 * Bloodsucker stalk approach phase data.
 * Mirrors StalkData from the game layer.
 */
export interface IStalkPhase {
  /** Whether the stalk sequence has been activated this combat cycle. */
  active: boolean;
  /** Whether the bloodsucker is currently closing distance for the melee strike. */
  approaching: boolean;
}

/**
 * Snork leap attack phase data.
 * Mirrors LeapData from the game layer.
 */
export interface ILeapPhase {
  /** Whether the leap sequence has been activated this combat cycle. */
  active: boolean;
  /** scene.time.now at the start of the leap wind-up (ms). */
  windupStartMs: number;
  /** Whether the snork is currently in the airborne phase. */
  airborne: boolean;
  /** World X when the leap was initiated (interpolation start). */
  startX: number;
  /** World Y when the leap was initiated (interpolation start). */
  startY: number;
  /** World X of the leap landing target. */
  targetX: number;
  /** World Y of the leap landing target. */
  targetY: number;
  /** scene.time.now when the airborne phase began (ms). */
  airStartMs: number;
}

/**
 * Controller PSI attack phase data.
 * Mirrors PsiData from the game layer.
 */
export interface IPsiPhase {
  /** Whether the PSI channel is active. */
  active: boolean;
  /** scene.time.now when channelling began (ms). */
  channelStartMs: number;
}

// ---------------------------------------------------------------------------
// Main data bag
// ---------------------------------------------------------------------------

/**
 * Mutable per-NPC AI data bag.
 *
 * Stored on each NPC instance (e.g. inside PhaserNPCContext or a plain object
 * in tests). All online state handlers are stateless — they read and write
 * this bag each frame via {@link INPCContext.state}.
 *
 * Fields match those in the game-layer AIComponent but use ms-based timers
 * (not scene.time.now subtraction) where possible for portability.
 */
export interface INPCOnlineState {
  // -------------------------------------------------------------------------
  // Target tracking
  // -------------------------------------------------------------------------

  /** Stable entity ID of the current combat target, or null when no target. */
  targetId: string | null;

  /** World X of the last confirmed enemy position (px). */
  lastKnownEnemyX: number;

  /** World Y of the last confirmed enemy position (px). */
  lastKnownEnemyY: number;

  /**
   * Timestamp (ms) until which the target lock is held.
   * Prevents rapid target switching — compare with ctx.now().
   */
  targetLockUntilMs: number;

  // -------------------------------------------------------------------------
  // State timers (absolute ms timestamps — compare with ctx.now())
  // -------------------------------------------------------------------------

  /** ctx.now() when ALERT state was entered. */
  alertStartMs: number;

  /** ctx.now() when SEARCH state was entered. */
  searchStartMs: number;

  /** ctx.now() of the last idle animation change (for random anim cycling). */
  lastIdleAnimChangeMs: number;

  /** ctx.now() of the last melee attack performed. */
  lastMeleeMs: number;

  /** ctx.now() of the last ranged shot fired. */
  lastShootMs: number;

  /** ctx.now() of the last vocalization emitted. */
  lastVocalizationMs: number;

  /** ctx.now() of the last grenade throw. */
  lastGrenadeMs: number;

  /** ctx.now() of the last suppressive fire shot during RETREAT. */
  lastSupressiveFireMs: number;

  /** ctx.now() when the current grenade throw wind-up began. */
  grenadeThrowStartMs: number;

  /** ctx.now() when EVADE_GRENADE state was entered. */
  evadeStartMs: number;

  /** ctx.now() when WOUNDED state was entered. */
  woundedStartMs: number;

  /** ctx.now() when the current PSI channel began (legacy — use psiPhase). */
  psiPhaseStartMs: number;

  /** ctx.now() when INVESTIGATE state was entered. */
  investigateStartMs: number;

  /** ctx.now() when the NPC arrived at the investigate target and began looking around. -1 = not yet arrived. */
  investigateLookAroundStartMs: number;

  // -------------------------------------------------------------------------
  // Help wounded (opt-in HelpWoundedState)
  // -------------------------------------------------------------------------

  /** ID of the wounded ally being helped. Null when not in HELP_WOUNDED. */
  helpWoundedTargetId: string | null;

  /** ctx.now() when HELP_WOUNDED state was entered (overall approach timeout). */
  helpWoundedStartMs: number;

  /** ctx.now() when the NPC arrived next to the wounded ally and began assisting. -1 = not yet arrived. */
  helpWoundedAssistStartMs: number;

  /** World X of the wounded ally target (populated by calling state before enter()). */
  helpWoundedX: number;

  /** World Y of the wounded ally target (populated by calling state before enter()). */
  helpWoundedY: number;

  // -------------------------------------------------------------------------
  // Kill wounded (opt-in KillWoundedState)
  // -------------------------------------------------------------------------

  /** ID of the wounded enemy being hunted. Null when not in KILL_WOUNDED. */
  killWoundedTargetId: string | null;

  /** ctx.now() when KILL_WOUNDED state was entered (overall approach timeout). */
  killWoundedStartMs: number;

  /** ctx.now() when the AIM phase began. -1 = not yet in aim phase. */
  killWoundedAimStartMs: number;

  /** ctx.now() when the TAUNT phase began. -1 = not yet in taunt phase. */
  killWoundedTauntStartMs: number;

  /** ctx.now() when the EXECUTE phase began (first shot in burst). -1 = not yet. */
  killWoundedExecuteStartMs: number;

  /** Number of shots fired so far in the current EXECUTE burst. */
  killWoundedShotsFired: number;

  /** ctx.now() when the PAUSE phase began (post-kill stand). -1 = not yet. */
  killWoundedPauseStartMs: number;

  /** World X of the wounded enemy target (updated each frame from perception). */
  killWoundedTargetX: number;

  /** World Y of the wounded enemy target (updated each frame from perception). */
  killWoundedTargetY: number;

  // -------------------------------------------------------------------------
  // Pack coordination (opt-in IPackAccess)
  // -------------------------------------------------------------------------

  /** Timestamp of last outgoing pack broadcast (ms). Used to throttle MonsterCombatController broadcasts. */
  packLastBroadcastMs: number;

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  /** Current patrol waypoint index (wraps by handler). */
  patrolWaypointIndex: number;

  /** Current search waypoint index. */
  searchWaypointIndex: number;

  // -------------------------------------------------------------------------
  // Loadout (weapon/item inventory)
  // -------------------------------------------------------------------------

  /** ID of the primary weapon (e.g. 'rifle'), or null if unarmed. */
  primaryWeapon: string | null;

  /** ID of the secondary weapon (e.g. 'pistol'), or null if not carrying one. */
  secondaryWeapon: string | null;

  /** Remaining grenade count. */
  grenadeCount: number;

  /** Remaining medkit count. */
  medkitCount: number;

  // -------------------------------------------------------------------------
  // State flags
  // -------------------------------------------------------------------------

  /** True while the NPC is in ALERT (aware of potential threat). */
  isAlert: boolean;

  /** True while the NPC is occupying a cover position. */
  hasTakenCover: boolean;

  /** World X of the current cover point (valid when hasTakenCover is true). */
  coverPointX: number;

  /** World Y of the current cover point (valid when hasTakenCover is true). */
  coverPointY: number;

  /**
   * TakeCoverState loophole peek-fire-return-wait cycle data.
   * Null when not in TAKE_COVER state.
   */
  loophole: ILoopholeState | null;

  // -------------------------------------------------------------------------
  // Monster ability phases
  // -------------------------------------------------------------------------

  /** Boar charge attack data. */
  chargePhase?: IChargePhase;

  /** Bloodsucker stalk approach data. */
  stalkPhase?: IStalkPhase;

  /** Snork leap attack data. */
  leapPhase?: ILeapPhase;

  /** Controller PSI attack data. */
  psiPhase?: IPsiPhase;

  /**
   * EAT_CORPSE state phase data.
   * Opt-in — only populated by the `eat-corpse` module.
   * Undefined for NPCs that never enter EAT_CORPSE.
   */
  eatCorpsePhase?: IEatCorpsePhase;

  // -------------------------------------------------------------------------
  // Morale
  // -------------------------------------------------------------------------

  /**
   * Morale value in the range [-1, 1].
   * 0 = neutral, +1 = fully confident, -1 = fully panicked.
   */
  morale: number;

  /**
   * Discrete morale state derived from `morale`.
   * - STABLE   : morale > retreatMoraleThreshold
   * - SHAKEN   : retreatMoraleThreshold >= morale > panicMoraleThreshold
   * - PANICKED : morale <= panicMoraleThreshold
   */
  moraleState: 'STABLE' | 'SHAKEN' | 'PANICKED';
}
