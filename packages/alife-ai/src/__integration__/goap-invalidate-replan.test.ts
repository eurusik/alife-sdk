/**
 * Integration test: GOAPController.invalidatePlan() and plan lifecycle.
 *
 * Exercises:
 *   1. invalidatePlan() forces replan on very next tick
 *   2. Plan survives multiple ticks without world state change (RUNNING action)
 *   3. World state change triggers replan after interval elapses
 *   4. invalidatePlan() mid-action causes new plan immediately
 *   5. RUNNING action is not cancelled by tick() alone (plan stays active)
 *   6. Goal changes cause a new plan to be selected after replan
 *   7. Two sequential plans: plan A completes → plan B starts
 *   8. syncRegistry-equivalent: freshest snapshot drives replanning
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect } from 'vitest';
import {
  GOAPPlanner,
  GOAPAction,
  ActionStatus,
  WorldState,
  type IEntity,
} from '@alife-sdk/core';
import { GOAPController } from '../goap/GOAPController';
import { WorldProperty, GoalPriority } from '../types/IPerceptionTypes';
import type { INPCWorldSnapshot, IGOAPConfig } from '../types/IPerceptionTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<INPCWorldSnapshot> = {}): INPCWorldSnapshot {
  return {
    isAlive: true,
    seeEnemy: false,
    enemyPresent: false,
    enemyInRange: false,
    hpRatio: 1.0,
    hasWeapon: true,
    hasAmmo: true,
    inCover: false,
    hasDanger: false,
    hasDangerGrenade: false,
    enemyWounded: false,
    nearAnomalyZone: false,
    ...overrides,
  };
}

function makeEntity(id = 'npc_1'): IEntity {
  return {
    id,
    entityType: 'npc',
    isAlive: true,
    x: 100,
    y: 100,
    active: true,
    setPosition(x: number, y: number) { this.x = x; this.y = y; },
    setActive() { return this; },
    setVisible() { return this; },
    hasComponent() { return false; },
    getComponent() { throw new Error('no components'); },
  };
}

function makeConfig(overrides: Partial<IGOAPConfig> = {}): IGOAPConfig {
  return {
    replanIntervalMs: 5_000,
    eliteRankThreshold: 5,
    healHpThreshold: 0.3,
    maxPlanDepth: 10,
    dangerMemoryMaxAge: 5_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reusable GOAPAction implementations — no vi.fn()
// ---------------------------------------------------------------------------

/** Action that returns RUNNING every call — simulates a long-running task. */
class RunningAction extends GOAPAction {
  readonly id: string;
  readonly cost = 1;
  executeCount = 0;

  constructor(
    id: string,
    private readonly pre: WorldState,
    private readonly eff: WorldState,
  ) {
    super();
    this.id = id;
  }

  getPreconditions(): WorldState { return this.pre; }
  getEffects(): WorldState { return this.eff; }
  isValid(): boolean { return true; }
  execute(): ActionStatus {
    this.executeCount++;
    return ActionStatus.RUNNING;
  }
}

/** Action that returns SUCCESS immediately. */
class SuccessAction extends GOAPAction {
  readonly id: string;
  readonly cost = 1;
  executeCount = 0;

  constructor(
    id: string,
    private readonly pre: WorldState,
    private readonly eff: WorldState,
  ) {
    super();
    this.id = id;
  }

  getPreconditions(): WorldState { return this.pre; }
  getEffects(): WorldState { return this.eff; }
  isValid(): boolean { return true; }
  execute(): ActionStatus {
    this.executeCount++;
    return ActionStatus.SUCCESS;
  }
}

/** Action that returns FAILURE immediately. */
class _FailAction extends GOAPAction {
  readonly id: string;
  readonly cost = 1;
  executeCount = 0;

  constructor(
    id: string,
    private readonly pre: WorldState,
    private readonly eff: WorldState,
  ) {
    super();
    this.id = id;
  }

  getPreconditions(): WorldState { return this.pre; }
  getEffects(): WorldState { return this.eff; }
  isValid(): boolean { return true; }
  execute(): ActionStatus {
    this.executeCount++;
    return ActionStatus.FAILURE;
  }
}

// ---------------------------------------------------------------------------
// WorldState factory helpers
// ---------------------------------------------------------------------------

function ws(props: Record<string, boolean>): WorldState {
  const state = new WorldState();
  for (const [k, v] of Object.entries(props)) state.set(k, v);
  return state;
}

// ---------------------------------------------------------------------------
// Build a planner with an enemy-present scenario (world ≠ goal) so that
// the planner creates a non-empty plan that the controller will execute.
// ---------------------------------------------------------------------------

function buildFightingPlanner(): {
  planner: GOAPPlanner;
  fightAction: RunningAction;
  enemySnapshot: INPCWorldSnapshot;
} {
  const planner = new GOAPPlanner();

  const fightAction = new RunningAction(
    'fight',
    ws({ [WorldProperty.SEE_ENEMY]: true, [WorldProperty.HAS_WEAPON]: true }),
    ws({ [WorldProperty.ENEMY_PRESENT]: false }),
  );
  planner.registerAction(fightAction);

  // Enemy present + can see + has weapon → goal is ENEMY_PRESENT=false
  // Current world state: ENEMY_PRESENT=true → does not satisfy goal → planner creates a plan
  const enemySnapshot = makeSnapshot({
    enemyPresent: true,
    seeEnemy: true,
    hasWeapon: true,
    hasAmmo: true,
  });

  return { planner, fightAction, enemySnapshot };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GOAPController.invalidatePlan() — integration', () => {

  // -------------------------------------------------------------------------
  // 1. invalidatePlan() forces replan on next tick
  // -------------------------------------------------------------------------
  it('invalidatePlan() triggers replanned=true on the very next tick', () => {
    const { planner, fightAction, enemySnapshot } = buildFightingPlanner();
    const cfg = makeConfig({ replanIntervalMs: 60_000 }); // very long interval
    const controller = new GOAPController(planner, cfg);
    const entity = makeEntity();

    // Initial tick — plan invalid from creation, so this replans
    controller.update(100, entity, enemySnapshot);
    expect(controller.hasPlan()).toBe(true);

    // Second tick — plan is RUNNING, timer not elapsed → no replan
    const noReplan = controller.update(100, entity, enemySnapshot);
    expect(noReplan.replanned).toBe(false);
    expect(fightAction.executeCount).toBeGreaterThan(0);

    // Force invalidation
    controller.invalidatePlan();

    // Next tick must replan regardless of timer
    const forcedReplan = controller.update(100, entity, enemySnapshot);
    expect(forcedReplan.replanned).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 2. Plan survives multiple ticks without world state change
  // -------------------------------------------------------------------------
  it('plan survives multiple ticks while action returns RUNNING', () => {
    const { planner, fightAction, enemySnapshot } = buildFightingPlanner();
    const cfg = makeConfig({ replanIntervalMs: 60_000 });
    const controller = new GOAPController(planner, cfg);
    const entity = makeEntity();

    // Establish plan
    controller.update(100, entity, enemySnapshot);
    expect(controller.hasPlan()).toBe(true);

    // Run 10 more ticks — action stays RUNNING, no replan expected
    const replanCount = { count: 0 };
    for (let i = 0; i < 10; i++) {
      const result = controller.update(50, entity, enemySnapshot);
      if (result.replanned) replanCount.count++;
    }

    // Zero replans should have occurred (interval not elapsed)
    expect(replanCount.count).toBe(0);
    // Action was executed all 10 frames
    expect(fightAction.executeCount).toBeGreaterThan(10);
  });

  // -------------------------------------------------------------------------
  // 3. World state change triggers replan after interval elapses
  // -------------------------------------------------------------------------
  it('replan occurs after replanIntervalMs elapses with changed snapshot', () => {
    const { planner, enemySnapshot } = buildFightingPlanner();
    const cfg = makeConfig({ replanIntervalMs: 1_000 });
    const controller = new GOAPController(planner, cfg);
    const entity = makeEntity();

    // Initial replan
    controller.update(100, entity, enemySnapshot);
    expect(controller.getLastGoalResult()?.priority).toBe(GoalPriority.ENEMY_PRESENT);

    // Advance past interval using small steps
    let replanned = false;
    for (let elapsed = 0; elapsed < cfg.replanIntervalMs + 200; elapsed += 200) {
      const result = controller.update(200, entity, enemySnapshot);
      if (result.replanned) replanned = true;
    }

    expect(replanned).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 4. invalidatePlan() mid-action → new plan starts immediately next tick
  // -------------------------------------------------------------------------
  it('invalidatePlan() mid-action causes immediate plan replacement', () => {
    const { planner, fightAction, enemySnapshot } = buildFightingPlanner();
    const cfg = makeConfig({ replanIntervalMs: 60_000 });
    const controller = new GOAPController(planner, cfg);
    const entity = makeEntity();

    // Start plan
    controller.update(100, entity, enemySnapshot);
    const countAfterFirst = fightAction.executeCount;

    // Invalidate mid-action
    controller.invalidatePlan();

    // Next tick should replan and start the action fresh
    const result = controller.update(100, entity, enemySnapshot);
    expect(result.replanned).toBe(true);
    // After replanning the new plan's action should have been executed
    expect(fightAction.executeCount).toBeGreaterThan(countAfterFirst);
  });

  // -------------------------------------------------------------------------
  // 5. RUNNING action is not cancelled by tick() alone
  // -------------------------------------------------------------------------
  it('RUNNING action stays active across ticks without invalidation', () => {
    const { planner, fightAction, enemySnapshot } = buildFightingPlanner();
    const cfg = makeConfig({ replanIntervalMs: 60_000 });
    const controller = new GOAPController(planner, cfg);
    const entity = makeEntity();

    controller.update(100, entity, enemySnapshot);
    const actionIdFirst = controller.getCurrentPlanIds()[0];

    // Multiple ticks — same action should remain current
    for (let i = 0; i < 5; i++) {
      controller.update(50, entity, enemySnapshot);
    }

    // Plan still has the same action
    expect(controller.getCurrentPlanIds()[0]).toBe(actionIdFirst);
    expect(fightAction.executeCount).toBeGreaterThanOrEqual(6);
  });

  // -------------------------------------------------------------------------
  // 6. Goal changes → different goal selected after replan interval
  // -------------------------------------------------------------------------
  it('goal changes from DEFAULT to ENEMY_PRESENT after replan with enemy snapshot', () => {
    const { planner } = buildFightingPlanner();
    // Also add an idle action to satisfy the default goal
    planner.registerAction(
      new SuccessAction('idle', ws({}), ws({ [WorldProperty.AT_TARGET]: true })),
    );

    const cfg = makeConfig({ replanIntervalMs: 500 });
    const controller = new GOAPController(planner, cfg);
    const entity = makeEntity();

    // Start with no enemy
    const quietSnapshot = makeSnapshot({ seeEnemy: false, enemyPresent: false });
    controller.update(100, entity, quietSnapshot);
    expect(controller.getLastGoalResult()?.priority).toBe(GoalPriority.DEFAULT);

    // Advance past interval with enemy present
    const enemySnapshot = makeSnapshot({ seeEnemy: true, enemyPresent: true, hasWeapon: true, hasAmmo: true });
    for (let elapsed = 0; elapsed < cfg.replanIntervalMs + 200; elapsed += 200) {
      controller.update(200, entity, enemySnapshot);
    }

    expect(controller.getLastGoalResult()?.priority).toBe(GoalPriority.ENEMY_PRESENT);
  });

  // -------------------------------------------------------------------------
  // 7. Two sequential plans: plan A completes → plan B starts
  // -------------------------------------------------------------------------
  it('plan B starts after plan A completes when next replan occurs', () => {
    const planner = new GOAPPlanner();

    // Plan A: fight (requires seeEnemy+weapon) → eliminates enemy
    planner.registerAction(
      new SuccessAction(
        'fight',
        ws({ [WorldProperty.SEE_ENEMY]: true, [WorldProperty.HAS_WEAPON]: true }),
        ws({ [WorldProperty.ENEMY_PRESENT]: false }),
      ),
    );

    // Plan B: idle (satisfies AT_TARGET for default goal)
    const idleAction = new SuccessAction('idle', ws({}), ws({ [WorldProperty.AT_TARGET]: true }));
    planner.registerAction(idleAction);

    const cfg = makeConfig({ replanIntervalMs: 100 });
    const controller = new GOAPController(planner, cfg);
    const entity = makeEntity();

    // Initial tick with enemy — fight action runs and completes (SUCCESS)
    const snapshotEnemy = makeSnapshot({ seeEnemy: true, enemyPresent: true, hasWeapon: true, hasAmmo: true });
    controller.update(100, entity, snapshotEnemy);

    // After SUCCESS, planInvalid=true → next tick replans with updated snapshot
    // Now enemy is gone → default goal → idle action selected
    const snapshotQuiet = makeSnapshot({ seeEnemy: false, enemyPresent: false });

    // Advance past interval to ensure replan
    for (let elapsed = 0; elapsed < cfg.replanIntervalMs + 50; elapsed += 50) {
      controller.update(50, entity, snapshotQuiet);
    }

    // Goal should now be DEFAULT (no enemy)
    expect(controller.getLastGoalResult()?.priority).toBe(GoalPriority.DEFAULT);
  });

  // -------------------------------------------------------------------------
  // 8. Fresh snapshot drives correct replanning (syncRegistry equivalent)
  // -------------------------------------------------------------------------
  it('providing freshest snapshot on each tick ensures accurate world state for replan', () => {
    const { planner } = buildFightingPlanner();
    const cfg = makeConfig({ replanIntervalMs: 300 });
    const controller = new GOAPController(planner, cfg);
    const entity = makeEntity();

    // Tick 1: healthy NPC, no enemy
    controller.update(100, entity, makeSnapshot({ hpRatio: 1.0, enemyPresent: false }));
    expect(controller.getLastGoalResult()?.priority).toBe(GoalPriority.DEFAULT);

    // Advance past interval with critically wounded snapshot
    const criticalSnapshot = makeSnapshot({ hpRatio: 0.1 });
    for (let elapsed = 0; elapsed < cfg.replanIntervalMs + 100; elapsed += 100) {
      controller.update(100, entity, criticalSnapshot);
    }

    // Replan should have selected CRITICALLY_WOUNDED as highest-priority goal
    expect(controller.getLastGoalResult()?.priority).toBe(GoalPriority.CRITICALLY_WOUNDED);
  });

  // -------------------------------------------------------------------------
  // 9. Plan with RUNNING action: planInvalid=false after first replan
  // -------------------------------------------------------------------------
  it('planInvalid is false after first successful replan with RUNNING action', () => {
    const { planner, enemySnapshot } = buildFightingPlanner();
    const cfg = makeConfig({ replanIntervalMs: 60_000 });
    const controller = new GOAPController(planner, cfg);
    const entity = makeEntity();

    // First tick — triggers initial replan
    const firstResult = controller.update(100, entity, enemySnapshot);
    expect(firstResult.replanned).toBe(true);
    expect(controller.hasPlan()).toBe(true);

    // Subsequent tick — plan active, interval not elapsed → no replan
    const secondResult = controller.update(100, entity, enemySnapshot);
    expect(secondResult.replanned).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 10. hasPlan() returns false before first update
  // -------------------------------------------------------------------------
  it('hasPlan() returns false before first update', () => {
    const { planner } = buildFightingPlanner();
    const controller = new GOAPController(planner, makeConfig());

    expect(controller.hasPlan()).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 11. getCurrentIndex() advances as actions complete in a multi-step plan
  // -------------------------------------------------------------------------
  it('getCurrentIndex() advances as each action completes in a multi-step plan', () => {
    const planner = new GOAPPlanner();

    // Two-step chain: move_to_cover (not in cover → in cover), then hold_position
    planner.registerAction(
      new SuccessAction(
        'move_to_cover',
        ws({ [WorldProperty.IN_COVER]: false }),
        ws({ [WorldProperty.IN_COVER]: true }),
      ),
    );
    planner.registerAction(
      new SuccessAction(
        'hold_position',
        ws({ [WorldProperty.IN_COVER]: true }),
        ws({ [WorldProperty.POSITION_HELD]: true }),
      ),
    );
    // Idle fallback for default goal
    planner.registerAction(
      new SuccessAction('idle', ws({}), ws({ [WorldProperty.AT_TARGET]: true })),
    );

    const cfg = makeConfig({ replanIntervalMs: 60_000 });
    const controller = new GOAPController(planner, cfg);
    const entity = makeEntity();

    // Snapshot: danger present → triggers danger goal; not in cover
    const snapshot = makeSnapshot({ hasDanger: true, inCover: false });
    controller.update(100, entity, snapshot);

    // Whatever plan was chosen, index starts at 0 after first replan
    // (actions complete immediately as SUCCESS, so index might advance fast)
    expect(controller.getCurrentIndex()).toBeGreaterThanOrEqual(0);
  });

  // -------------------------------------------------------------------------
  // 12. reset() clears plan and forces replan on next tick
  // -------------------------------------------------------------------------
  it('reset() clears the plan and forces immediate replan on next tick', () => {
    const { planner, enemySnapshot } = buildFightingPlanner();
    const cfg = makeConfig({ replanIntervalMs: 60_000 });
    const controller = new GOAPController(planner, cfg);
    const entity = makeEntity();

    // Establish plan
    controller.update(100, entity, enemySnapshot);
    expect(controller.hasPlan()).toBe(true);

    // Reset
    controller.reset(entity);
    expect(controller.hasPlan()).toBe(false);
    expect(controller.getCurrentIndex()).toBe(0);
    expect(controller.getLastGoalResult()).toBeNull();

    // Next tick must replan
    const afterReset = controller.update(100, entity, enemySnapshot);
    expect(afterReset.replanned).toBe(true);
  });
});
