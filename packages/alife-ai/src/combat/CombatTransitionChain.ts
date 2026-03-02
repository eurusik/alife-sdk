// combat/CombatTransitionChain.ts
// Chain of Responsibility pattern for combat state transitions.
// Each rule is a pure function evaluated in priority order.

import type { INPCLoadout } from '../types/IWeaponTypes';

/**
 * Snapshot of an NPC's combat state for transition evaluation.
 * Framework-agnostic — no entity references, only data.
 */
export interface ICombatContext {
  /** Current HP / max HP [0, 1]. */
  readonly hpRatio: number;
  /** Morale value [-1, 1]. */
  readonly moraleValue: number;
  /** Is morale in PANICKED state. */
  readonly isPanicked: boolean;
  /** Time since last visual contact with enemy (ms). */
  readonly lostSightMs: number;
  /** Distance to nearest known enemy (px). */
  readonly distanceToEnemy: number;
  /** Number of visible enemies. */
  readonly visibleEnemyCount: number;
  /** NPC weapon loadout for tactical decisions. */
  readonly loadout: INPCLoadout;
  /** Whether the NPC can switch targets (not inertia-locked). */
  readonly canSwitchTarget: boolean;
  /** Time since the NPC last exited wounded state (ms). Infinity if never. */
  readonly timeSinceWoundedMs: number;
  /** Whether a grenade/explosion danger is active near the NPC. */
  readonly hasExplosiveDanger: boolean;
  /** Whether the NPC has any ammo remaining. */
  readonly hasAmmo: boolean;
}

/**
 * Result of a transition rule evaluation.
 * A string state key (framework-agnostic) or null to continue the chain.
 */
export type TransitionResult = string | null;

/**
 * A single rule in the combat transition chain.
 *
 * Rules are stateless pure functions — they read the combat context
 * and return a target state string, or null to pass to the next rule.
 */
export interface ITransitionRule {
  readonly name: string;
  readonly priority: number;
  evaluate(context: ICombatContext, config: ICombatTransitionConfig): TransitionResult;
}

/**
 * Configuration thresholds for combat transitions.
 */
export interface ICombatTransitionConfig {
  /** HP ratio below which the NPC is considered wounded. */
  readonly woundedHpThreshold: number;
  /** Minimum time before re-entering wounded state (ms). */
  readonly woundedReentryCooldownMs: number;
  /** Morale below which the NPC should retreat. */
  readonly retreatMoraleThreshold: number;
  /** Time without visual contact before throwing a grenade (ms). */
  readonly grenadeLostSightMs: number;
  /** Time without visual contact before searching (ms). */
  readonly lostSightThresholdMs: number;
  /** Minimum enemies for grenade throw. */
  readonly grenadeMinEnemies: number;
  /** Grenade throw distance range [min, max] (px). */
  readonly grenadeMinDistance: number;
  readonly grenadeMaxDistance: number;
}

/** Default production configuration. */
export function createDefaultCombatTransitionConfig(
  overrides?: Partial<ICombatTransitionConfig>,
): ICombatTransitionConfig {
  return {
    woundedHpThreshold: 0.2,
    woundedReentryCooldownMs: 10_000,
    retreatMoraleThreshold: -0.3,
    grenadeLostSightMs: 2_000,
    lostSightThresholdMs: 3_000,
    grenadeMinEnemies: 2,
    grenadeMinDistance: 80,
    grenadeMaxDistance: 250,
    ...overrides,
  };
}

// -----------------------------------------------------------------------
// Concrete rules — priority ordered
// -----------------------------------------------------------------------

/** Priority 1: Critically wounded NPC seeks safety. */
export const WoundedRule: ITransitionRule = {
  name: 'wounded',
  priority: 1,
  evaluate(ctx, cfg) {
    if (ctx.hpRatio >= cfg.woundedHpThreshold) return null;
    if (ctx.timeSinceWoundedMs < cfg.woundedReentryCooldownMs) return null;
    return 'WOUNDED';
  },
};

/** Priority 2: No ammo → retreat. */
export const NoAmmoRule: ITransitionRule = {
  name: 'noAmmo',
  priority: 2,
  evaluate(ctx) {
    return ctx.hasAmmo ? null : 'RETREAT';
  },
};

/** Priority 3: Explosive danger nearby → evade. */
export const EvadeDangerRule: ITransitionRule = {
  name: 'evadeDanger',
  priority: 3,
  evaluate(ctx) {
    return ctx.hasExplosiveDanger ? 'EVADE_GRENADE' : null;
  },
};

/** Priority 4: Low morale → retreat; panicked → flee. */
export const MoraleRule: ITransitionRule = {
  name: 'morale',
  priority: 4,
  evaluate(ctx, cfg) {
    if (ctx.isPanicked) return 'FLEE';
    if (ctx.moraleValue < cfg.retreatMoraleThreshold && ctx.canSwitchTarget)
      return 'RETREAT';
    return null;
  },
};

/** Priority 5: Lost sight long enough, has grenades → throw. */
export const GrenadeOpportunityRule: ITransitionRule = {
  name: 'grenadeOpportunity',
  priority: 5,
  evaluate(ctx, cfg) {
    if (ctx.lostSightMs < cfg.grenadeLostSightMs) return null;
    if (ctx.lostSightMs >= cfg.lostSightThresholdMs) return null;
    if (ctx.loadout.grenades <= 0) return null;
    if (ctx.visibleEnemyCount < cfg.grenadeMinEnemies) return null;
    if (
      ctx.distanceToEnemy < cfg.grenadeMinDistance ||
      ctx.distanceToEnemy > cfg.grenadeMaxDistance
    )
      return null;
    return 'GRENADE';
  },
};

/** Priority 6: Lost sight for extended time → search. */
export const SearchRule: ITransitionRule = {
  name: 'search',
  priority: 6,
  evaluate(ctx, cfg) {
    return ctx.lostSightMs >= cfg.lostSightThresholdMs ? 'SEARCH' : null;
  },
};

/**
 * The complete default combat transition chain.
 * Rules are sorted by priority (lowest number = highest priority).
 */
export const DEFAULT_COMBAT_RULES: readonly ITransitionRule[] = [
  WoundedRule,
  NoAmmoRule,
  EvadeDangerRule,
  MoraleRule,
  GrenadeOpportunityRule,
  SearchRule,
];

/**
 * Evaluate all rules in priority order. Returns the first matching
 * state transition, or null if no rule triggers.
 *
 * @param rules - Transition rules sorted by priority.
 * @param context - Current combat snapshot.
 * @param config - Threshold configuration.
 * @returns Target state string, or null.
 */
export function evaluateTransitions(
  rules: readonly ITransitionRule[],
  context: ICombatContext,
  config: ICombatTransitionConfig,
): TransitionResult {
  for (const rule of rules) {
    const result = rule.evaluate(context, config);
    if (result !== null) return result;
  }
  return null;
}
