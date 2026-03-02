// states/NPCOnlineState.ts
// Concrete factory for creating a fresh INPCOnlineState with all defaults.

import type { INPCOnlineState } from './INPCOnlineState';

/**
 * Create a new {@link INPCOnlineState} with all fields initialised to their
 * zero/null/default values.
 *
 * Call once per NPC instance and store the result on the NPC's context object.
 * All online state handlers share this bag (via INPCContext.state) and mutate
 * it in-place each frame.
 *
 * @example
 * ```ts
 * class MyNPCContext implements INPCContext {
 *   readonly state = createDefaultNPCOnlineState();
 *   // ...
 * }
 * ```
 */
export function createDefaultNPCOnlineState(): INPCOnlineState {
  return {
    // Target tracking
    targetId: null,
    lastKnownEnemyX: 0,
    lastKnownEnemyY: 0,
    targetLockUntilMs: 0,

    // Timers (all start at 0 — handlers treat 0 as "never fired")
    alertStartMs: 0,
    searchStartMs: 0,
    lastIdleAnimChangeMs: 0,
    lastMeleeMs: 0,
    lastShootMs: 0,
    lastVocalizationMs: 0,
    lastGrenadeMs: 0,
    lastSupressiveFireMs: 0,
    grenadeThrowStartMs: 0,
    evadeStartMs: 0,
    woundedStartMs: 0,
    psiPhaseStartMs: 0,
    investigateStartMs: 0,
    investigateLookAroundStartMs: -1,

    helpWoundedTargetId: null,
    helpWoundedStartMs: 0,
    helpWoundedAssistStartMs: -1,
    helpWoundedX: 0,
    helpWoundedY: 0,

    killWoundedTargetId: null,
    killWoundedStartMs: 0,
    killWoundedAimStartMs: -1,
    killWoundedTauntStartMs: -1,
    killWoundedExecuteStartMs: -1,
    killWoundedShotsFired: 0,
    killWoundedPauseStartMs: -1,
    killWoundedTargetX: 0,
    killWoundedTargetY: 0,

    packLastBroadcastMs: 0,

    // Navigation
    patrolWaypointIndex: 0,
    searchWaypointIndex: 0,

    // Loadout
    primaryWeapon: null,
    secondaryWeapon: null,
    grenadeCount: 0,
    medkitCount: 0,

    // State flags
    isAlert: false,
    hasTakenCover: false,
    coverPointX: 0,
    coverPointY: 0,
    loophole: null,

    // Morale
    morale: 0,
    moraleState: 'STABLE',
  };
}
