// states/OnlineStateRegistryBuilder.ts
// Factory functions that assemble the Map<stateId, IOnlineStateHandler> for
// OnlineAIDriver.
//
// All handlers are stateless — per-NPC runtime data lives in INPCOnlineState.
// The returned StateHandlerMap is a fresh instance each call and safe to mutate.
//
// Four functions:
//   buildCoreHandlerMap()             — private: 13 shared states, no COMBAT
//   buildDefaultHandlerMap()          — human NPCs: core + CombatState (14 states)
//   buildMonsterHandlerMap()          — monsters:   core + MonsterCombatController (14 states)
//   buildChornobylMonsterHandlerMap() — Stalker-style: core + MonsterCombatController
//                                       (CHORNOBYL_ABILITY_SELECTOR) + 4 ability states (18 states)
//
// Monster ability states (CHARGE, STALK, LEAP, PSI_ATTACK) are opt-in:
//   - Use buildChornobylMonsterHandlerMap() for the full Stalker preset, or
//   - Manually extend buildMonsterHandlerMap() for custom ability sets.

import {
  DeadState,
  IdleState,
  PatrolState,
  AlertState,
  FleeState,
  SearchState,
  CampState,
  SleepState,
  CombatState,
  TakeCoverState,
  GrenadeState,
  EvadeGrenadeState,
  WoundedState,
  RetreatState,
  MonsterCombatController,
  CHORNOBYL_ABILITY_SELECTOR,
  ChargeState,
  StalkState,
  LeapState,
  PsiAttackState,
} from './handlers/index';

import { createDefaultStateConfig } from './IStateConfig';
import type { IStateConfig } from './IStateConfig';
import type { IStateTransitionMap } from './IStateTransitionMap';
import { StateHandlerMap } from './StateHandlerMap';

// ---------------------------------------------------------------------------
// State identifiers (string constants — not const enum, so hosts can extend)
// ---------------------------------------------------------------------------

/**
 * Canonical state identifier strings used by both factory functions.
 *
 * Exported so hosts can reference them without hard-coding string literals.
 */
export const ONLINE_STATE = {
  DEAD: 'DEAD',
  IDLE: 'IDLE',
  PATROL: 'PATROL',
  ALERT: 'ALERT',
  FLEE: 'FLEE',
  SEARCH: 'SEARCH',
  CAMP: 'CAMP',
  SLEEP: 'SLEEP',
  COMBAT: 'COMBAT',
  TAKE_COVER: 'TAKE_COVER',
  GRENADE: 'GRENADE',
  EVADE_GRENADE: 'EVADE_GRENADE',
  WOUNDED: 'WOUNDED',
  RETREAT: 'RETREAT',
  CHARGE: 'CHARGE',
  STALK: 'STALK',
  LEAP: 'LEAP',
  PSI_ATTACK: 'PSI_ATTACK',
} as const;

// ---------------------------------------------------------------------------
// buildCoreHandlerMap (private)
// ---------------------------------------------------------------------------

/**
 * Shared base: 13 states common to both humans and monsters.
 * Does NOT include COMBAT (differs per entity type) nor monster ability states.
 */
function buildCoreHandlerMap(
  cfg: IStateConfig,
  tr?: Partial<IStateTransitionMap>,
): StateHandlerMap {
  return new StateHandlerMap([
    [ONLINE_STATE.DEAD,          new DeadState(cfg, tr)],
    [ONLINE_STATE.IDLE,          new IdleState(cfg, tr)],
    [ONLINE_STATE.PATROL,        new PatrolState(cfg, tr)],
    [ONLINE_STATE.ALERT,         new AlertState(cfg, tr)],
    [ONLINE_STATE.FLEE,          new FleeState(cfg, tr)],
    [ONLINE_STATE.SEARCH,        new SearchState(cfg, tr)],
    [ONLINE_STATE.CAMP,          new CampState(cfg, tr)],
    [ONLINE_STATE.SLEEP,         new SleepState(cfg, tr)],
    [ONLINE_STATE.TAKE_COVER,    new TakeCoverState(cfg, tr)],
    [ONLINE_STATE.GRENADE,       new GrenadeState(cfg, tr)],
    [ONLINE_STATE.EVADE_GRENADE, new EvadeGrenadeState(cfg, tr)],
    [ONLINE_STATE.WOUNDED,       new WoundedState(cfg, tr)],
    [ONLINE_STATE.RETREAT,       new RetreatState(cfg, tr)],
  ]);
}

// ---------------------------------------------------------------------------
// buildDefaultHandlerMap
// ---------------------------------------------------------------------------

/**
 * Build a handler map for human NPC entities.
 *
 * Registers 14 states: the 13 shared core states plus {@link CombatState}
 * (ranged weapon engagement, cover seeking, morale checks).
 *
 * The returned Map is a new instance each call — safe to mutate (e.g. replace
 * individual entries) without affecting other callers.
 *
 * @param config - Optional partial config overrides; merged with defaults.
 * @param tr - Optional partial transition map overrides; handlers use these
 *   instead of hard-coded state IDs, allowing SDK users to rename states.
 * @returns Fresh {@link StateHandlerMap} ready for {@link OnlineAIDriver}.
 *
 * @example
 * ```ts
 * const handlers = buildDefaultHandlerMap({ combatRange: 300 })
 *   .register('HUNT', new HuntState(cfg));
 * const driver = new OnlineAIDriver(ctx, handlers, 'IDLE');
 * ```
 */
export function buildDefaultHandlerMap(
  config?: Partial<IStateConfig>,
  tr?: Partial<IStateTransitionMap>,
): StateHandlerMap {
  const cfg = createDefaultStateConfig(config);
  return buildCoreHandlerMap(cfg, tr)
    .register(ONLINE_STATE.COMBAT, new CombatState(cfg, tr));
}

// ---------------------------------------------------------------------------
// buildMonsterHandlerMap
// ---------------------------------------------------------------------------

/**
 * Build a handler map for monster entities.
 *
 * Registers 14 states: the 13 shared core states plus
 * {@link MonsterCombatController} (melee attacks, no special abilities by
 * default). Monster ability states are opt-in — register them explicitly and
 * provide a matching {@link MonsterAbilitySelector}.
 *
 * @param config - Optional partial config overrides; merged with defaults.
 * @param tr - Optional partial transition map overrides; passed to all handlers.
 * @returns Fresh {@link StateHandlerMap} ready for {@link OnlineAIDriver}.
 *
 * @example Basic monster (melee only):
 * ```ts
 * const handlers = buildMonsterHandlerMap({ meleeRange: 64 });
 * const driver = new OnlineAIDriver(monsterCtx, handlers, 'IDLE');
 * ```
 *
 * @example Stalker-style monster with ability states:
 * ```ts
 * import { CHORNOBYL_ABILITY_SELECTOR } from '@alife-sdk/ai/states';
 *
 * const cfg = { meleeRange: 64 };
 * const handlers = buildMonsterHandlerMap(cfg)
 *   .register(ONLINE_STATE.COMBAT,     new MonsterCombatController(cfg, tr, CHORNOBYL_ABILITY_SELECTOR))
 *   .register(ONLINE_STATE.CHARGE,     new ChargeState(cfg, tr))
 *   .register(ONLINE_STATE.STALK,      new StalkState(cfg, tr))
 *   .register(ONLINE_STATE.LEAP,       new LeapState(cfg, tr))
 *   .register(ONLINE_STATE.PSI_ATTACK, new PsiAttackState(cfg, tr));
 * ```
 */
export function buildMonsterHandlerMap(
  config?: Partial<IStateConfig>,
  tr?: Partial<IStateTransitionMap>,
): StateHandlerMap {
  const cfg = createDefaultStateConfig(config);
  return buildCoreHandlerMap(cfg, tr)
    .register(ONLINE_STATE.COMBAT, new MonsterCombatController(cfg, tr));
}

// ---------------------------------------------------------------------------
// buildChornobylMonsterHandlerMap
// ---------------------------------------------------------------------------

/**
 * Build a handler map for Stalker-style monster entities.
 *
 * Registers 18 states: the 13 shared core states plus
 * {@link MonsterCombatController} wired to {@link CHORNOBYL_ABILITY_SELECTOR}
 * and the four species-specific ability states:
 *
 * | Entity type   | Ability state |
 * |---------------|--------------|
 * | `boar`        | `CHARGE`     |
 * | `bloodsucker` | `STALK`      |
 * | `snork`       | `LEAP`       |
 * | `controller`  | `PSI_ATTACK` |
 *
 * All five state registrations are guaranteed to be consistent — no risk of
 * the ability selector returning a state ID that is not in the map.
 *
 * For a custom entity-to-ability mapping pass `abilitySelector` to
 * {@link MonsterCombatController} and register only the states you need via
 * {@link buildMonsterHandlerMap} + `.register()`.
 *
 * @param config - Optional partial config overrides; merged with defaults.
 * @param tr - Optional partial transition map overrides; passed to all handlers.
 * @returns Fresh {@link StateHandlerMap} ready for {@link OnlineAIDriver}.
 *
 * @example
 * ```ts
 * const handlers = buildChornobylMonsterHandlerMap({ meleeRange: 64 });
 * const driver = new OnlineAIDriver(monsterCtx, handlers, 'IDLE');
 * ```
 */
export function buildChornobylMonsterHandlerMap(
  config?: Partial<IStateConfig>,
  tr?: Partial<IStateTransitionMap>,
): StateHandlerMap {
  const cfg = createDefaultStateConfig(config);
  return buildCoreHandlerMap(cfg, tr)
    .register(ONLINE_STATE.COMBAT,     new MonsterCombatController(cfg, tr, CHORNOBYL_ABILITY_SELECTOR))
    .register(ONLINE_STATE.CHARGE,     new ChargeState(cfg, tr))
    .register(ONLINE_STATE.STALK,      new StalkState(cfg, tr))
    .register(ONLINE_STATE.LEAP,       new LeapState(cfg, tr))
    .register(ONLINE_STATE.PSI_ATTACK, new PsiAttackState(cfg, tr));
}
