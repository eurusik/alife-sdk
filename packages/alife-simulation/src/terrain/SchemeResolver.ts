/**
 * Condition-list resolver for behavior schemes.
 *
 * Given an ordered list of conditions, resolves the first matching scheme
 * based on current time-of-day and terrain state. Uses first-match
 * evaluation semantics.
 */

import { TerrainState } from './TerrainStateManager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConditionKind = 'day' | 'night' | 'alert' | 'combat' | 'peaceful';

/** Tunable parameters attached to a behavior scheme. */
export interface ISchemeParams {
  readonly scanArc?: number;
  readonly engageRange?: number;
  readonly alertness?: number;
}

/**
 * Context supplied to custom predicate functions.
 *
 * Mirrors the arguments of `resolve()` so custom predicates can evaluate
 * any combination of time-of-day and terrain state.
 */
export interface ISchemeContext {
  readonly isNight: boolean;
  readonly terrainState: TerrainState;
}

/** A single condition -> scheme mapping in the condition list. */
export interface ISchemeConditionConfig {
  /**
   * Built-in condition kind. When `customPredicate` is also provided,
   * **both** must match (logical AND).
   */
  readonly when: ConditionKind;
  readonly scheme: string;
  readonly params?: ISchemeParams;
  /**
   * Optional custom predicate evaluated **after** the built-in `when` check.
   * Return `true` to accept the condition, `false` to skip it.
   *
   * ```ts
   * { when: 'day', scheme: 'sniper_guard',
   *   customPredicate: (ctx) => ctx.terrainState === TerrainState.PEACEFUL }
   * ```
   */
  readonly customPredicate?: (ctx: ISchemeContext) => boolean;
}

/** Result of a successful resolution. */
export interface ISchemeOverride {
  readonly scheme: string;
  readonly params: ISchemeParams | null;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export function resolve(
  conditions: readonly ISchemeConditionConfig[],
  isNight: boolean,
  terrainState: TerrainState,
): ISchemeOverride | null {
  for (const cond of conditions) {
    if (!matchesCondition(cond.when, isNight, terrainState)) continue;

    if (cond.customPredicate && !cond.customPredicate({ isNight, terrainState })) {
      continue;
    }

    return {
      scheme: cond.scheme,
      params: cond.params ?? null,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function matchesCondition(
  kind: ConditionKind,
  isNight: boolean,
  terrainState: TerrainState,
): boolean {
  switch (kind) {
    case 'day':
      return !isNight;
    case 'night':
      return isNight;
    case 'combat':
      return terrainState === TerrainState.COMBAT;
    case 'alert':
      return terrainState >= TerrainState.ALERT;
    case 'peaceful':
      return terrainState === TerrainState.PEACEFUL;
    default:
      return false;
  }
}
