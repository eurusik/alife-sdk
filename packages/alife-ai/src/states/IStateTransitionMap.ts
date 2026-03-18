/**
 * Injectable map of logical transition names to actual state ID strings.
 *
 * Each handler uses `this.tr.combatOnPanicked` instead of hardcoded `'FLEE'`,
 * allowing SDK users to rename states freely.
 *
 * @example
 * ```ts
 * // Zombie game with custom state names
 * const handlers = buildDefaultHandlerMap(cfg, {
 *   combatOnPanicked: 'shamble_away',
 *   fleeOnCalmed: 'wander',
 *   monsterOnNoEnemy: 'wander',
 * });
 * ```
 */
export interface IStateTransitionMap {
  // ── Idle ──────────────────────────────────────────────────────────────────
  idleOnEnemy: string;           // default: 'ALERT'
  idleOnTired: string;           // default: 'CAMP'  (condition fatigue; override to 'SLEEP' if desired)
  idleOnSuspicious: string;      // default: 'ALERT' (accumulated suspicion; override to 'SEARCH' for softer response)

  // ── Patrol ────────────────────────────────────────────────────────────────
  patrolOnEnemy: string;         // default: 'ALERT'
  patrolOnSquadIntel: string;    // default: 'ALERT'  (squad intel callout; override to 'SEARCH' for softer response)
  patrolOnSuspicious: string;    // default: 'ALERT'  (accumulated suspicion; override to 'SEARCH' for softer response)
  patrolOnNoWaypoint: string;    // default: 'IDLE'

  // ── Alert ─────────────────────────────────────────────────────────────────
  alertOnEnemy: string;          // default: 'COMBAT'
  alertOnTimeout: string;        // default: 'PATROL'
  alertOnPanic: string;          // default: 'FLEE'

  // ── Combat ────────────────────────────────────────────────────────────────
  combatOnNoEnemy: string;       // default: 'IDLE'
  combatOnLastKnown: string;     // default: 'SEARCH'
  combatOnPanicked: string;      // default: 'FLEE'
  combatOnShaken: string;        // default: 'RETREAT'
  combatOnWounded: string;       // default: 'WOUNDED'
  combatOnCover: string;         // default: 'TAKE_COVER'

  // ── Take Cover ────────────────────────────────────────────────────────────
  takeCoverOnNoEnemy: string;    // default: 'SEARCH'
  takeCoverOnPanicked: string;   // default: 'FLEE'
  takeCoverOnShaken: string;     // default: 'RETREAT'

  // ── Flee ──────────────────────────────────────────────────────────────────
  fleeOnCalmed: string;          // default: 'ALERT'
  fleeOnSafe: string;            // default: 'PATROL' – SHAKEN NPC fled far enough; resume patrol

  // ── Search ────────────────────────────────────────────────────────────────
  searchOnEnemy: string;         // default: 'ALERT'
  searchOnTimeout: string;       // default: 'IDLE'

  // ── Grenade ───────────────────────────────────────────────────────────────
  grenadeOnComplete: string;     // default: 'COMBAT'
  grenadeOnNoAmmo: string;       // default: 'COMBAT'

  // ── Evade Grenade ─────────────────────────────────────────────────────────
  evadeOnClear: string;          // default: 'COMBAT'
  evadeOnTimeout: string;        // default: 'COMBAT'
  evadeOnNoSystem: string;       // default: 'COMBAT'

  // ── Wounded ───────────────────────────────────────────────────────────────
  woundedOnHealed: string;       // default: 'COMBAT'
  woundedOnPanic: string;        // default: 'FLEE'
  woundedOnTimeout: string;      // default: 'FLEE'

  // ── Retreat ───────────────────────────────────────────────────────────────
  retreatOnPanicked: string;     // default: 'FLEE'
  retreatOnStable: string;       // default: 'COMBAT'
  retreatOnNoEnemy: string;      // default: 'SEARCH'

  // ── Camp / Sleep ──────────────────────────────────────────────────────────
  campOnEnemy: string;           // default: 'COMBAT'
  campOnDanger: string;          // default: 'ALERT'
  sleepOnEnemy: string;          // default: 'ALERT'

  // ── Monster: base combat ──────────────────────────────────────────────────
  monsterOnNoEnemy: string;      // default: 'IDLE'
  monsterOnLastKnown: string;    // default: 'SEARCH'

  // ── Monster: Charge ───────────────────────────────────────────────────────
  chargeOnComplete: string;      // default: 'COMBAT'
  chargeOnAbort: string;         // default: 'IDLE'

  // ── Monster: Stalk ────────────────────────────────────────────────────────
  stalkOnAttack: string;         // default: 'COMBAT'
  stalkOnNoEnemy: string;        // default: 'SEARCH'

  // ── Monster: Leap ─────────────────────────────────────────────────────────
  leapOnLand: string;            // default: 'COMBAT'

  // ── Monster: PSI Attack ───────────────────────────────────────────────────
  psiOnComplete: string;         // default: 'COMBAT'
  psiOnNoEnemy: string;          // default: 'IDLE'

  // ── EAT_CORPSE (opt-in module) ────────────────────────────────────────────
  eatCorpseOnDone: string;       // default: 'IDLE'
  eatCorpseOnInterrupt: string;  // default: 'ALERT'
  eatCorpseOnNoCorpse: string;   // default: 'IDLE'

  // ── Investigate (opt-in) ─────────────────────────────────────────────────
  investigateOnEnemy: string;    // default: 'ALERT'  (visible enemy or suspicion spike → escalate)
  investigateOnTimeout: string;  // default: 'PATROL' (look-around done, nothing found → deescalate)
  investigateOnPanic: string;    // default: 'FLEE'   (panicked morale → abort investigation)

  // ── Help Wounded (opt-in) ────────────────────────────────────────────────
  patrolOnWoundedAlly: string;   // default: 'HELP_WOUNDED' (patrol sees wounded ally → help)
  idleOnWoundedAlly: string;     // default: 'HELP_WOUNDED' (idle sees wounded ally → help)
  helpWoundedOnEnemy: string;    // default: 'ALERT'        (enemy appears → abort + fight)
  helpWoundedOnComplete: string; // default: 'PATROL'       (ally healed/gone or timeout)
  helpWoundedOnPanic: string;    // default: 'FLEE'         (panicked morale → flee)

  // ── Kill Wounded (opt-in) ─────────────────────────────────────────────────
  combatOnKillWounded: string;    // default: 'KILL_WOUNDED' (STABLE NPC in combat sees wounded enemy)
  alertOnKillWounded: string;     // default: 'KILL_WOUNDED' (STABLE NPC in alert sees wounded enemy)
  killWoundedOnComplete: string;  // default: 'COMBAT'       (executed / new enemy visible after pause)
  killWoundedOnNoTarget: string;  // default: 'SEARCH'       (target disappeared before execution)
  killWoundedOnPanic: string;     // default: 'FLEE'         (panicked morale → abort)
  killWoundedOnTimeout: string;   // default: 'COMBAT'       (approach timeout → give up)

  // ── Pack coordination (opt-in IPackAccess) ───────────────────────────────
  idleOnPackAlert:   string;  // default: 'ALERT'  (pack alerted/combat while NPC is IDLE)
  patrolOnPackAlert: string;  // default: 'ALERT'  (pack alerted/combat while NPC is PATROL)
  alertOnPackCombat: string;  // default: 'SEARCH' (pack in COMBAT, no direct sighting → investigate)
}

/**
 * Creates a transition map with Chornobyl-style defaults.
 * Pass `overrides` to remap any transitions for your own state names.
 */
export function createDefaultTransitionMap(
  overrides?: Partial<IStateTransitionMap>,
): IStateTransitionMap {
  return {
    idleOnEnemy: 'ALERT',
    idleOnTired: 'CAMP',
    idleOnSuspicious: 'ALERT',
    patrolOnEnemy: 'ALERT',
    patrolOnSquadIntel: 'ALERT',
    patrolOnSuspicious: 'ALERT',
    patrolOnNoWaypoint: 'IDLE',
    alertOnEnemy: 'COMBAT',
    alertOnTimeout: 'PATROL',
    alertOnPanic: 'FLEE',
    combatOnNoEnemy: 'IDLE',
    combatOnLastKnown: 'SEARCH',
    combatOnPanicked: 'FLEE',
    combatOnShaken: 'RETREAT',
    combatOnWounded: 'WOUNDED',
    combatOnCover: 'TAKE_COVER',
    takeCoverOnNoEnemy: 'SEARCH',
    takeCoverOnPanicked: 'FLEE',
    takeCoverOnShaken: 'RETREAT',
    fleeOnCalmed: 'ALERT',
    fleeOnSafe: 'PATROL',
    searchOnEnemy: 'ALERT',
    searchOnTimeout: 'IDLE',
    grenadeOnComplete: 'COMBAT',
    grenadeOnNoAmmo: 'COMBAT',
    evadeOnClear: 'COMBAT',
    evadeOnTimeout: 'COMBAT',
    evadeOnNoSystem: 'COMBAT',
    woundedOnHealed: 'COMBAT',
    woundedOnPanic: 'FLEE',
    woundedOnTimeout: 'FLEE',
    retreatOnPanicked: 'FLEE',
    retreatOnStable: 'COMBAT',
    retreatOnNoEnemy: 'SEARCH',
    campOnEnemy: 'COMBAT',
    campOnDanger: 'ALERT',
    sleepOnEnemy: 'ALERT',
    monsterOnNoEnemy: 'IDLE',
    monsterOnLastKnown: 'SEARCH',
    chargeOnComplete: 'COMBAT',
    chargeOnAbort: 'IDLE',
    stalkOnAttack: 'COMBAT',
    stalkOnNoEnemy: 'SEARCH',
    leapOnLand: 'COMBAT',
    psiOnComplete: 'COMBAT',
    psiOnNoEnemy: 'IDLE',
    eatCorpseOnDone: 'IDLE',
    eatCorpseOnInterrupt: 'ALERT',
    eatCorpseOnNoCorpse: 'IDLE',
    investigateOnEnemy: 'ALERT',
    investigateOnTimeout: 'PATROL',
    investigateOnPanic: 'FLEE',
    patrolOnWoundedAlly: 'HELP_WOUNDED',
    idleOnWoundedAlly: 'HELP_WOUNDED',
    helpWoundedOnEnemy: 'ALERT',
    helpWoundedOnComplete: 'PATROL',
    helpWoundedOnPanic: 'FLEE',
    combatOnKillWounded: 'KILL_WOUNDED',
    alertOnKillWounded: 'KILL_WOUNDED',
    killWoundedOnComplete: 'COMBAT',
    killWoundedOnNoTarget: 'SEARCH',
    killWoundedOnPanic: 'FLEE',
    killWoundedOnTimeout: 'COMBAT',
    idleOnPackAlert:   'ALERT',
    patrolOnPackAlert: 'ALERT',
    alertOnPackCombat: 'SEARCH',
    ...overrides,
  };
}
