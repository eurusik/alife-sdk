// goap/GoalSelector.ts
// Pure function to select a GOAP goal based on configurable priority rules.
// No side effects — all decision logic is deterministic.

import { WorldState } from '@alife-sdk/core';
import { WorldProperty, GoalPriority, type GoalPriorityLevel, type IGOAPConfig, type INPCWorldSnapshot } from '../types/IPerceptionTypes';

/**
 * Result of goal selection including the priority band that was chosen.
 */
export interface IGoalResult {
  readonly goal: WorldState;
  readonly priority: GoalPriorityLevel;
  readonly reason: string;
}

/**
 * A single goal selection rule, evaluated in priority order.
 * Lower priority number = higher importance.
 */
export interface IGoalRule {
  readonly priority: number;
  readonly name: string;
  evaluate(
    snapshot: INPCWorldSnapshot,
    config: IGOAPConfig,
  ): IGoalResult | null;
}

// ---------------------------------------------------------------------------
// Pre-allocated WorldState and IGoalResult objects for DEFAULT_GOAL_RULES.
// These are immutable after construction — rules return the same instances
// every evaluation to avoid per-tick allocations.
// ---------------------------------------------------------------------------

const _criticalGoal: WorldState = /* @__PURE__ */ (() => {
  const ws = new WorldState();
  ws.set(WorldProperty.CRITICALLY_WOUNDED, false);
  ws.set(WorldProperty.ENEMY_PRESENT, false);
  return ws;
})();

const _enemyResult: IGoalResult = /* @__PURE__ */ (() => {
  const ws = new WorldState();
  ws.set(WorldProperty.ENEMY_PRESENT, false);
  return { goal: ws, priority: GoalPriority.ENEMY_PRESENT, reason: 'Enemy detected' };
})();

// Pre-allocated panic-flee goal: same world target as DANGER (DANGER=false)
// but at a higher priority band so it fires before ENEMY_PRESENT.
const _panicFleeResult: IGoalResult = /* @__PURE__ */ (() => {
  const ws = new WorldState();
  ws.set(WorldProperty.DANGER, false);
  return { goal: ws, priority: GoalPriority.PANIC_FLEE, reason: 'Morale collapsed — flee immediately' };
})();

const _dangerResult: IGoalResult = /* @__PURE__ */ (() => {
  const ws = new WorldState();
  ws.set(WorldProperty.DANGER, false);
  return { goal: ws, priority: GoalPriority.DANGER, reason: 'Danger signal without visible enemy' };
})();

const _anomalyResult: IGoalResult = /* @__PURE__ */ (() => {
  const ws = new WorldState();
  ws.set(WorldProperty.ANOMALY_NEAR, false);
  return { goal: ws, priority: GoalPriority.ANOMALY_AVOID, reason: 'Anomaly zone detected' };
})();

const _defaultResult: IGoalResult = /* @__PURE__ */ (() => {
  const ws = new WorldState();
  ws.set(WorldProperty.AT_TARGET, true);
  return { goal: ws, priority: GoalPriority.DEFAULT, reason: 'No threats — patrol or idle' };
})();

/**
 * Default goal rules corresponding to the 5-band priority hierarchy.
 * Sorted by priority ascending (highest importance first).
 *
 * WorldState objects are pre-allocated and reused across evaluations to
 * eliminate per-tick allocations.
 */
export const DEFAULT_GOAL_RULES: readonly IGoalRule[] = [
  {
    priority: GoalPriority.CRITICALLY_WOUNDED,
    name: 'critically_wounded',
    evaluate(snapshot, config) {
      if (snapshot.hpRatio <= config.healHpThreshold) {
        return {
          goal: _criticalGoal,
          priority: GoalPriority.CRITICALLY_WOUNDED,
          reason: `HP critical (${(snapshot.hpRatio * 100).toFixed(0)}%)`,
        };
      }
      return null;
    },
  },
  {
    priority: GoalPriority.PANIC_FLEE,
    name: 'panic_flee',
    evaluate(snapshot) {
      // A panicked NPC (morale collapsed) with an active danger signal must
      // flee before any combat goal is considered.  hasDanger is set to true
      // by buildNPCWorldSnapshot when moralePanic is true, so FleeAction will
      // have a valid precondition (DANGER=true) to plan against.
      if (snapshot.isPanicked && snapshot.hasDanger) return _panicFleeResult;
      return null;
    },
  },
  {
    priority: GoalPriority.ENEMY_PRESENT,
    name: 'enemy_present',
    evaluate(snapshot) {
      if (snapshot.enemyPresent) return _enemyResult;
      return null;
    },
  },
  {
    priority: GoalPriority.DANGER,
    name: 'danger',
    evaluate(snapshot) {
      if (snapshot.hasDanger) return _dangerResult;
      return null;
    },
  },
  {
    priority: GoalPriority.ANOMALY_AVOID,
    name: 'anomaly_avoidance',
    evaluate(snapshot) {
      if (snapshot.nearAnomalyZone) return _anomalyResult;
      return null;
    },
  },
  {
    priority: GoalPriority.DEFAULT,
    name: 'default',
    evaluate() {
      return _defaultResult;
    },
  },
];

/**
 * Select a GOAP goal based on the current NPC state.
 *
 * Rules are evaluated in order — first rule that returns a non-null result wins.
 * DEFAULT_GOAL_RULES provides the original 4-band hierarchy.
 *
 * @param snapshot - Pre-computed NPC world data
 * @param config - GOAP configuration (healHpThreshold)
 * @param rules - Optional custom goal rules. Defaults to DEFAULT_GOAL_RULES.
 * @returns Goal and priority band info
 */
export function selectGoal(
  snapshot: INPCWorldSnapshot,
  config: IGOAPConfig,
  rules?: readonly IGoalRule[],
): IGoalResult {
  for (const rule of (rules ?? DEFAULT_GOAL_RULES)) {
    const result = rule.evaluate(snapshot, config);
    if (result) return result;
  }

  // Fallback — should not normally be reached with default rules
  const goal = new WorldState();
  return { goal, priority: GoalPriority.DEFAULT, reason: 'No rules matched' };
}
