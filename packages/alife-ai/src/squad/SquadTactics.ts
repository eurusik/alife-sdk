// squad/SquadTactics.ts
// Command pattern for squad-level tactical decisions.
// Pure evaluation — no entity references, no framework coupling.

import type { ISquadTacticsConfig } from '../types/IOnlineAIConfig';

/**
 * Squad command identifiers.
 */
export const SquadCommand = {
  ATTACK: 'attack',
  COVER_ME: 'cover_me',
  FOLLOW: 'follow',
  HOLD: 'hold',
  RETREAT: 'retreat',
  SPREAD_OUT: 'spread_out',
} as const;

export type SquadCommand = (typeof SquadCommand)[keyof typeof SquadCommand];

/**
 * Tactical situation snapshot for command evaluation.
 * Aggregates squad state without entity references.
 */
export interface ISquadSituation {
  /** Number of squad members (including leader). */
  readonly squadSize: number;
  /** Number of known enemies in the engagement. */
  readonly enemyCount: number;
  /** Average morale across all squad members [-1, 1]. */
  readonly avgMorale: number;
  /** Whether the leader is currently in cover. */
  readonly leaderInCover: boolean;
}

/**
 * A single tactical command with its evaluation logic.
 * Each command scores a situation and returns a priority value.
 */
export interface ISquadCommandEvaluator {
  readonly command: SquadCommand;
  evaluate(situation: ISquadSituation, config: ISquadTacticsConfig): number;
}

/**
 * Evaluate the best squad command for the current situation.
 *
 * Uses a priority-ordered decision tree (first match wins):
 *
 * 1. Morale collapse → RETREAT
 * 2. No enemies → FOLLOW
 * 3. Badly outnumbered → RETREAT
 * 4. Even fight → HOLD
 * 5. Numerical advantage → ATTACK
 * 6. Leader in cover → COVER_ME
 * 7. Default → SPREAD_OUT
 *
 * @param situation - Current tactical snapshot.
 * @param config - Squad tuning configuration.
 * @returns The recommended squad command.
 */
export function evaluateSituation(
  situation: ISquadSituation,
  config: ISquadTacticsConfig,
): SquadCommand {
  const { squadSize, enemyCount, avgMorale, leaderInCover } = situation;

  // Priority 1: Morale collapse.
  if (avgMorale <= config.moralePanickedThreshold) {
    return SquadCommand.RETREAT;
  }

  // Priority 2: No threats.
  if (enemyCount === 0) {
    return SquadCommand.FOLLOW;
  }

  // Priority 3: Badly outnumbered.
  if (enemyCount > squadSize * config.outnumberRatio) {
    return SquadCommand.RETREAT;
  }

  // Priority 4: Even fight.
  if (enemyCount >= squadSize) {
    return SquadCommand.HOLD;
  }

  // Priority 5: Numerical advantage.
  if (squadSize > enemyCount * config.outnumberRatio) {
    return SquadCommand.ATTACK;
  }

  // Priority 6: Leader in cover — provide suppressive fire.
  if (leaderInCover) {
    return SquadCommand.COVER_ME;
  }

  // Default: distribute tactically.
  return SquadCommand.SPREAD_OUT;
}

/**
 * States that must never be interrupted by squad commands.
 * The host should check this before applying any command.
 */
export const PROTECTED_STATES = new Set([
  'DEAD',
  'WOUNDED',
  'EVADE_GRENADE',
]);

/**
 * Check if a command can be applied to an NPC in the given state.
 */
export function canApplyCommand(currentState: string): boolean {
  return !PROTECTED_STATES.has(currentState);
}
