import { describe, it, expect } from 'vitest';
import { WorldState } from '@alife-sdk/core';
import { selectGoal, DEFAULT_GOAL_RULES } from './GoalSelector';
import type { IGoalRule } from './GoalSelector';
import { WorldProperty, GoalPriority, type IGOAPConfig, type INPCWorldSnapshot } from '../types/IPerceptionTypes';

const config: IGOAPConfig = {
  replanIntervalMs: 5000,
  eliteRankThreshold: 5,
  healHpThreshold: 0.3,
  maxPlanDepth: 10,
  dangerMemoryMaxAge: 5000,
};

function makeSnapshot(overrides?: Partial<INPCWorldSnapshot>): INPCWorldSnapshot {
  return {
    isAlive: true,
    hpRatio: 0.8,
    hasWeapon: true,
    hasAmmo: true,
    inCover: false,
    seeEnemy: false,
    enemyPresent: false,
    enemyInRange: false,
    hasDanger: false,
    hasDangerGrenade: false,
    enemyWounded: false,
    nearAnomalyZone: false,
    ...overrides,
  };
}

describe('selectGoal', () => {
  it('selects CRITICALLY_WOUNDED band when HP is low', () => {
    const result = selectGoal(makeSnapshot({ hpRatio: 0.2 }), config);
    expect(result.priority).toBe(GoalPriority.CRITICALLY_WOUNDED);
    expect(result.goal.get(WorldProperty.CRITICALLY_WOUNDED)).toBe(false);
    // ENEMY_PRESENT was removed from _criticalGoal so a GOAP plan can be
    // found even when enemies are present. The property must be absent.
    expect(result.goal.has(WorldProperty.ENEMY_PRESENT)).toBe(false);
  });

  it('selects CRITICALLY_WOUNDED even with enemy present', () => {
    const result = selectGoal(makeSnapshot({ hpRatio: 0.1, enemyPresent: true }), config);
    expect(result.priority).toBe(GoalPriority.CRITICALLY_WOUNDED);
  });

  it('selects ENEMY_PRESENT band when enemy detected', () => {
    const result = selectGoal(makeSnapshot({ hpRatio: 0.8, enemyPresent: true }), config);
    expect(result.priority).toBe(GoalPriority.ENEMY_PRESENT);
    expect(result.goal.get(WorldProperty.ENEMY_PRESENT)).toBe(false);
  });

  it('selects DANGER band when danger without enemy', () => {
    const result = selectGoal(makeSnapshot({ hpRatio: 0.8, hasDanger: true }), config);
    expect(result.priority).toBe(GoalPriority.DANGER);
    expect(result.goal.get(WorldProperty.DANGER)).toBe(false);
  });

  it('selects DEFAULT band when safe', () => {
    const result = selectGoal(makeSnapshot({ hpRatio: 0.8 }), config);
    expect(result.priority).toBe(GoalPriority.DEFAULT);
    expect(result.goal.get(WorldProperty.AT_TARGET)).toBe(true);
  });

  it('enemy priority is above danger priority', () => {
    const result = selectGoal(makeSnapshot({ hpRatio: 0.8, enemyPresent: true, hasDanger: true }), config);
    expect(result.priority).toBe(GoalPriority.ENEMY_PRESENT);
  });

  it('at exactly heal threshold triggers wounded band', () => {
    const result = selectGoal(makeSnapshot({ hpRatio: 0.3 }), config);
    expect(result.priority).toBe(GoalPriority.CRITICALLY_WOUNDED);
  });

  it('just above heal threshold does not trigger wounded', () => {
    const result = selectGoal(makeSnapshot({ hpRatio: 0.31 }), config);
    expect(result.priority).toBe(GoalPriority.DEFAULT);
  });

  it('includes reason string', () => {
    const result = selectGoal(makeSnapshot({ hpRatio: 0.1 }), config);
    expect(result.reason).toContain('HP critical');
  });
});

describe('selectGoal with custom rules', () => {
  it('custom low_ammo priority band inserted between enemy and danger', () => {
    const lowAmmoRule: IGoalRule = {
      priority: 1.5,
      name: 'low_ammo',
      evaluate(snapshot) {
        // Only triggers when enemy AND some custom condition (for test: always)
        if (snapshot.enemyPresent) {
          const goal = new WorldState();
          goal.set('ammoSecured', true);
          return { goal, priority: 1.5 as never, reason: 'Low ammo — secure supplies' };
        }
        return null;
      },
    };

    // Custom rules: critically_wounded first, then low_ammo (replacing enemy_present)
    const customRules: readonly IGoalRule[] = [
      DEFAULT_GOAL_RULES[0], // critically_wounded
      lowAmmoRule,           // low_ammo (overrides enemy_present)
      DEFAULT_GOAL_RULES[3], // danger
      DEFAULT_GOAL_RULES[5], // default
    ];

    const result = selectGoal(makeSnapshot({ hpRatio: 0.8, enemyPresent: true }), config, customRules);
    expect(result.reason).toBe('Low ammo — secure supplies');
    expect(result.goal.get('ammoSecured')).toBe(true);
  });

  it('default rules produce same results as omitting rules param', () => {
    const scenarios: [number, boolean, boolean][] = [
      [0.1, false, false],  // critically wounded
      [0.8, true, false],   // enemy present
      [0.8, false, true],   // danger
      [0.8, false, false],  // default
      [0.1, true, true],    // critically wounded (highest prio)
      [0.8, true, true],    // enemy present (higher than danger)
    ];

    for (const [hp, enemy, danger] of scenarios) {
      const snapshot = makeSnapshot({ hpRatio: hp, enemyPresent: enemy, hasDanger: danger });
      const resultDefault = selectGoal(snapshot, config);
      const resultExplicit = selectGoal(snapshot, config, DEFAULT_GOAL_RULES);
      expect(resultExplicit.priority).toBe(resultDefault.priority);
      expect(resultExplicit.reason).toBe(resultDefault.reason);
    }
  });

  it('empty rules array produces fallback result', () => {
    const result = selectGoal(makeSnapshot({ hpRatio: 0.5, enemyPresent: true, hasDanger: true }), config, []);
    expect(result.priority).toBe(GoalPriority.DEFAULT);
    expect(result.reason).toBe('No rules matched');
  });

  it('custom single-rule set is used exclusively', () => {
    const onlyDefaultRule: IGoalRule = {
      priority: 99,
      name: 'always_idle',
      evaluate() {
        const goal = new WorldState();
        goal.set(WorldProperty.AT_TARGET, true);
        return { goal, priority: GoalPriority.DEFAULT, reason: 'Always idle' };
      },
    };

    // Even with critical HP and enemies, custom single rule returns idle
    const result = selectGoal(makeSnapshot({ hpRatio: 0.1, enemyPresent: true, hasDanger: true }), config, [onlyDefaultRule]);
    expect(result.reason).toBe('Always idle');
    expect(result.priority).toBe(GoalPriority.DEFAULT);
  });

  it('DEFAULT_GOAL_RULES has exactly 6 entries sorted by priority', () => {
    expect(DEFAULT_GOAL_RULES).toHaveLength(6);
    for (let i = 1; i < DEFAULT_GOAL_RULES.length; i++) {
      expect(DEFAULT_GOAL_RULES[i].priority).toBeGreaterThan(DEFAULT_GOAL_RULES[i - 1].priority);
    }
  });
});

describe('panic_flee rule', () => {
  it('isPanicked=true + hasDanger=true → PANIC_FLEE goal fires before ENEMY_PRESENT', () => {
    const result = selectGoal(
      makeSnapshot({ isPanicked: true, hasDanger: true, enemyPresent: true, seeEnemy: true }),
      config,
    );
    expect(result.priority).toBe(GoalPriority.PANIC_FLEE);
    expect(result.reason).toContain('Morale collapsed');
    expect(result.goal.get(WorldProperty.DANGER)).toBe(false);
  });

  it('isPanicked=true but hasDanger=false → ENEMY_PRESENT fires (no danger signal to flee from)', () => {
    const result = selectGoal(
      makeSnapshot({ isPanicked: true, hasDanger: false, enemyPresent: true }),
      config,
    );
    expect(result.priority).toBe(GoalPriority.ENEMY_PRESENT);
  });

  it('isPanicked=false + hasDanger=true + enemyPresent=true → ENEMY_PRESENT wins (not panicked)', () => {
    const result = selectGoal(
      makeSnapshot({ isPanicked: false, hasDanger: true, enemyPresent: true }),
      config,
    );
    expect(result.priority).toBe(GoalPriority.ENEMY_PRESENT);
  });

  it('isPanicked=true + hpRatio=0.2 → CRITICALLY_WOUNDED still wins (heal takes highest priority)', () => {
    const result = selectGoal(
      makeSnapshot({ isPanicked: true, hasDanger: true, enemyPresent: true, hpRatio: 0.2 }),
      config,
    );
    expect(result.priority).toBe(GoalPriority.CRITICALLY_WOUNDED);
  });

  it('isPanicked=undefined (absent) → panic_flee rule does not fire', () => {
    const result = selectGoal(
      makeSnapshot({ hasDanger: true, enemyPresent: true }),
      config,
    );
    expect(result.priority).toBe(GoalPriority.ENEMY_PRESENT);
  });
});

describe('anomaly_avoidance rule', () => {
  it('nearAnomalyZone=true → priority ANOMALY_AVOID, reason contains Anomaly', () => {
    const result = selectGoal(makeSnapshot({ nearAnomalyZone: true }), config);
    expect(result.priority).toBe(GoalPriority.ANOMALY_AVOID);
    expect(result.reason).toBe('Anomaly zone detected');
    expect(result.goal.get(WorldProperty.ANOMALY_NEAR)).toBe(false);
  });

  it('nearAnomalyZone=true + enemyPresent=true → ENEMY_PRESENT wins (higher priority)', () => {
    const result = selectGoal(makeSnapshot({ nearAnomalyZone: true, enemyPresent: true }), config);
    expect(result.priority).toBe(GoalPriority.ENEMY_PRESENT);
  });

  it('nearAnomalyZone=true + hasDanger=true → DANGER wins (higher priority)', () => {
    const result = selectGoal(makeSnapshot({ nearAnomalyZone: true, hasDanger: true }), config);
    expect(result.priority).toBe(GoalPriority.DANGER);
  });

  it('nearAnomalyZone=true + hpRatio=0.2 → CRITICALLY_WOUNDED wins (highest priority)', () => {
    const result = selectGoal(makeSnapshot({ nearAnomalyZone: true, hpRatio: 0.2 }), config);
    expect(result.priority).toBe(GoalPriority.CRITICALLY_WOUNDED);
  });

  it('nearAnomalyZone=false → DEFAULT goal fires (anomaly rule returns null)', () => {
    const result = selectGoal(makeSnapshot({ nearAnomalyZone: false }), config);
    expect(result.priority).toBe(GoalPriority.DEFAULT);
  });
});

describe('selectGoal with full INPCWorldSnapshot', () => {
  it('uses all snapshot fields — full snapshot with multiple fields set', () => {
    const fullSnapshot: INPCWorldSnapshot = {
      isAlive: true,
      hpRatio: 0.75,
      hasWeapon: true,
      hasAmmo: true,
      inCover: true,
      seeEnemy: true,
      enemyPresent: true,
      enemyInRange: true,
      hasDanger: false,
      hasDangerGrenade: false,
      enemyWounded: true,
      nearAnomalyZone: false,
    };
    // enemyPresent=true should trigger ENEMY_PRESENT goal band
    const result = selectGoal(fullSnapshot, config);
    expect(result.priority).toBe(GoalPriority.ENEMY_PRESENT);
    expect(result.goal.get(WorldProperty.ENEMY_PRESENT)).toBe(false);
  });

  it('full snapshot with all danger flags — enemy takes priority over danger', () => {
    const fullSnapshot: INPCWorldSnapshot = {
      isAlive: true,
      hpRatio: 0.9,
      hasWeapon: true,
      hasAmmo: true,
      inCover: false,
      seeEnemy: true,
      enemyPresent: true,
      enemyInRange: true,
      hasDanger: true,
      hasDangerGrenade: true,
      enemyWounded: false,
      nearAnomalyZone: false,
    };
    const result = selectGoal(fullSnapshot, config);
    expect(result.priority).toBe(GoalPriority.ENEMY_PRESENT);
  });

  it('full snapshot with no threats — selects DEFAULT goal', () => {
    const fullSnapshot: INPCWorldSnapshot = {
      isAlive: true,
      hpRatio: 1.0,
      hasWeapon: true,
      hasAmmo: true,
      inCover: false,
      seeEnemy: false,
      enemyPresent: false,
      enemyInRange: false,
      hasDanger: false,
      hasDangerGrenade: false,
      enemyWounded: false,
      nearAnomalyZone: false,
    };
    const result = selectGoal(fullSnapshot, config);
    expect(result.priority).toBe(GoalPriority.DEFAULT);
    expect(result.goal.get(WorldProperty.AT_TARGET)).toBe(true);
  });

  it('custom rule using snapshot.inCover enables cover-awareness beyond basic 3 fields', () => {
    // This rule triggers only when the NPC is NOT in cover AND has an enemy present.
    // It inserts a "seek_cover" goal between enemy_present and danger, demonstrating
    // that the snapshot approach supports richer custom logic beyond hpRatio/enemyPresent/hasDanger.
    const seekCoverRule: IGoalRule = {
      priority: 0.9,
      name: 'seek_cover_when_exposed',
      evaluate(snapshot) {
        if (snapshot.enemyPresent && !snapshot.inCover) {
          const goal = new WorldState();
          goal.set(WorldProperty.IN_COVER, true);
          return { goal, priority: 0.9 as never, reason: 'Exposed to enemy — seek cover' };
        }
        return null;
      },
    };

    const customRules: readonly IGoalRule[] = [
      DEFAULT_GOAL_RULES[0], // critically_wounded
      seekCoverRule,          // seek_cover (uses inCover from snapshot)
      DEFAULT_GOAL_RULES[5], // default
    ];

    // NPC is exposed (inCover=false) with enemy present → seekCoverRule should fire
    const exposedSnapshot = makeSnapshot({ hpRatio: 0.8, enemyPresent: true, inCover: false });
    const result = selectGoal(exposedSnapshot, config, customRules);
    expect(result.reason).toBe('Exposed to enemy — seek cover');
    expect(result.goal.get(WorldProperty.IN_COVER)).toBe(true);
  });

  it('custom rule using snapshot.inCover does NOT fire when already in cover', () => {
    const seekCoverRule: IGoalRule = {
      priority: 0.9,
      name: 'seek_cover_when_exposed',
      evaluate(snapshot) {
        if (snapshot.enemyPresent && !snapshot.inCover) {
          const goal = new WorldState();
          goal.set(WorldProperty.IN_COVER, true);
          return { goal, priority: 0.9 as never, reason: 'Exposed to enemy — seek cover' };
        }
        return null;
      },
    };

    const customRules: readonly IGoalRule[] = [
      DEFAULT_GOAL_RULES[0], // critically_wounded
      seekCoverRule,
      DEFAULT_GOAL_RULES[5], // default
    ];

    // NPC is in cover — rule should NOT fire, default is selected instead
    const inCoverSnapshot = makeSnapshot({ hpRatio: 0.8, enemyPresent: true, inCover: true });
    const result = selectGoal(inCoverSnapshot, config, customRules);
    expect(result.priority).toBe(GoalPriority.DEFAULT);
  });

  it('custom rule using snapshot.enemyWounded enables wound-based goal', () => {
    const finishWoundedRule: IGoalRule = {
      priority: 1.2,
      name: 'press_wounded_enemy',
      evaluate(snapshot) {
        if (snapshot.enemyPresent && snapshot.enemyWounded) {
          const goal = new WorldState();
          goal.set(WorldProperty.READY_TO_KILL, true);
          return { goal, priority: 1.2 as never, reason: 'Enemy wounded — press attack' };
        }
        return null;
      },
    };

    const customRules: readonly IGoalRule[] = [
      DEFAULT_GOAL_RULES[0], // critically_wounded (highest)
      finishWoundedRule,      // uses enemyWounded field
      DEFAULT_GOAL_RULES[3], // danger
      DEFAULT_GOAL_RULES[5], // default
    ];

    const woundedEnemySnapshot = makeSnapshot({ hpRatio: 0.8, enemyPresent: true, enemyWounded: true });
    const result = selectGoal(woundedEnemySnapshot, config, customRules);
    expect(result.reason).toBe('Enemy wounded — press attack');
    expect(result.goal.get(WorldProperty.READY_TO_KILL)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// _criticalGoal fix: ENEMY_PRESENT removed so critically wounded NPCs can
// get a GOAP plan even when enemies are present.
// ---------------------------------------------------------------------------

describe('_criticalGoal ENEMY_PRESENT removal', () => {
  it('critically wounded + enemy present → goal does NOT contain ENEMY_PRESENT', () => {
    // Before the fix _criticalGoal had ENEMY_PRESENT=false which forced the
    // planner to also neutralise the enemy before it could heal — making a
    // plan impossible when enemies were active.  The property must be absent.
    const result = selectGoal(makeSnapshot({ hpRatio: 0.15, enemyPresent: true }), config);
    expect(result.priority).toBe(GoalPriority.CRITICALLY_WOUNDED);
    expect(result.goal.has(WorldProperty.ENEMY_PRESENT)).toBe(false);
  });

  it('critically wounded + enemy present → goal only requires CRITICALLY_WOUNDED=false', () => {
    // The sole exit condition for the heal goal must be clearing the wounded
    // flag; no other termination condition should be imposed.
    const result = selectGoal(makeSnapshot({ hpRatio: 0.15, enemyPresent: true }), config);
    expect(result.priority).toBe(GoalPriority.CRITICALLY_WOUNDED);
    expect(result.goal.get(WorldProperty.CRITICALLY_WOUNDED)).toBe(false);
  });

  it('critically wounded + no enemy → same goal (regression: fix did not break the no-enemy path)', () => {
    // Ensure the friendly-fire-free path is unaffected: the goal must still
    // target CRITICALLY_WOUNDED=false and must not reintroduce ENEMY_PRESENT.
    const result = selectGoal(makeSnapshot({ hpRatio: 0.2, enemyPresent: false }), config);
    expect(result.priority).toBe(GoalPriority.CRITICALLY_WOUNDED);
    expect(result.goal.get(WorldProperty.CRITICALLY_WOUNDED)).toBe(false);
    expect(result.goal.has(WorldProperty.ENEMY_PRESENT)).toBe(false);
  });

  it('critical goal WorldState has exactly 1 property set (not 2)', () => {
    // Verifies the pre-allocated _criticalGoal object was not accidentally
    // left with ENEMY_PRESENT alongside CRITICALLY_WOUNDED.  Both the
    // enemy-present and no-enemy paths share the same pre-allocated instance,
    // so one size check covers both scenarios.
    const result = selectGoal(makeSnapshot({ hpRatio: 0.1, enemyPresent: true }), config);
    expect(result.priority).toBe(GoalPriority.CRITICALLY_WOUNDED);
    const propertyCount = [...result.goal.keys()].length;
    expect(propertyCount).toBe(1);
  });
});
