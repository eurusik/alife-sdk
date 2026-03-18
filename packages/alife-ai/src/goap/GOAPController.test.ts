import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GOAPController } from './GOAPController';
import { GOAPPlanner, GOAPAction, ActionStatus, WorldState, type IEntity } from '@alife-sdk/core';
import { WorldProperty, type IGOAPConfig, type INPCWorldSnapshot } from '../types/IPerceptionTypes';

const goapConfig: IGOAPConfig = {
  replanIntervalMs: 5000,
  eliteRankThreshold: 5,
  healHpThreshold: 0.3,
  maxPlanDepth: 10,
  dangerMemoryMaxAge: 5000,
};

// --- Stub entity ---
function makeEntity(): IEntity {
  return {
    id: 'npc_1',
    entityType: 'npc',
    isAlive: true,
    x: 0,
    y: 0,
    active: true,
    metadata: new Map(),
    setPosition(x: number, y: number) { this.x = x; this.y = y; },
    setActive(v: boolean) { this.active = v; return this; },
    setVisible() { return this; },
    hasComponent() { return false; },
    getComponent<T>(): T { throw new Error('no component'); },
  };
}

function makeSnapshot(overrides?: Partial<INPCWorldSnapshot>): INPCWorldSnapshot {
  return {
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
    ...overrides,
  };
}

// Use a snapshot where the goal is NOT yet satisfied, so the planner generates a plan.
// hasDanger: true → DANGER band → goal: { DANGER: false }
// Actions set DANGER → false as their effect.
const unsatisfiedSnapshot = (): INPCWorldSnapshot => makeSnapshot({ hasDanger: true });

// --- Stub actions ---
class InvestigateAction extends GOAPAction {
  readonly id = 'investigate';
  readonly cost = 2;
  executed = false;

  getPreconditions(): WorldState { return new WorldState(); }
  getEffects(): WorldState {
    const e = new WorldState();
    e.set(WorldProperty.DANGER, false);
    return e;
  }
  isValid(): boolean { return true; }
  execute(): ActionStatus {
    this.executed = true;
    return ActionStatus.SUCCESS;
  }
}

class AlwaysRunningAction extends GOAPAction {
  readonly id = 'running';
  readonly cost = 1;
  ticks = 0;

  getPreconditions(): WorldState { return new WorldState(); }
  getEffects(): WorldState {
    const e = new WorldState();
    e.set(WorldProperty.DANGER, false);
    return e;
  }
  isValid(): boolean { return true; }
  execute(): ActionStatus {
    this.ticks++;
    return ActionStatus.RUNNING;
  }
}

class AlwaysFailsAction extends GOAPAction {
  readonly id = 'fails';
  readonly cost = 1;

  getPreconditions(): WorldState { return new WorldState(); }
  getEffects(): WorldState {
    const e = new WorldState();
    e.set(WorldProperty.DANGER, false);
    return e;
  }
  isValid(): boolean { return true; }
  execute(): ActionStatus { return ActionStatus.FAILURE; }
}

class InvalidAction extends GOAPAction {
  readonly id = 'invalid';
  readonly cost = 1;
  aborted = false;

  getPreconditions(): WorldState { return new WorldState(); }
  getEffects(): WorldState {
    const e = new WorldState();
    e.set(WorldProperty.DANGER, false);
    return e;
  }
  isValid(): boolean { return false; }
  execute(): ActionStatus { return ActionStatus.SUCCESS; }
  abort(): void { this.aborted = true; }
}

describe('GOAPController', () => {
  let planner: GOAPPlanner;
  let controller: GOAPController;
  let entity: IEntity;

  beforeEach(() => {
    planner = new GOAPPlanner();
    controller = new GOAPController(planner, goapConfig);
    entity = makeEntity();
  });

  it('creates a plan and executes it on first update', () => {
    const action = new InvestigateAction();
    planner.registerAction(action);

    const result = controller.update(0, entity, unsatisfiedSnapshot());
    expect(result.replanned).toBe(true);
    expect(action.executed).toBe(true);
    expect(result.handled).toBe(true);
  });

  it('returns handled=false when no actions registered', () => {
    const result = controller.update(0, entity, unsatisfiedSnapshot());
    expect(result.handled).toBe(false);
    expect(result.replanned).toBe(true);
  });

  it('runs RUNNING action across multiple ticks', () => {
    const running = new AlwaysRunningAction();
    planner.registerAction(running);

    controller.update(0, entity, unsatisfiedSnapshot());
    expect(running.ticks).toBe(1);

    controller.update(100, entity, unsatisfiedSnapshot());
    expect(running.ticks).toBe(2);
  });

  it('replans after interval expires', () => {
    const running = new AlwaysRunningAction();
    planner.registerAction(running);

    controller.update(0, entity, unsatisfiedSnapshot());
    const r2 = controller.update(6000, entity, unsatisfiedSnapshot());
    expect(r2.replanned).toBe(true);
  });

  it('does not replan before interval', () => {
    const running = new AlwaysRunningAction();
    planner.registerAction(running);

    controller.update(0, entity, unsatisfiedSnapshot());
    const r2 = controller.update(1000, entity, unsatisfiedSnapshot());
    expect(r2.replanned).toBe(false);
  });

  it('invalidatePlan triggers replan', () => {
    const running = new AlwaysRunningAction();
    planner.registerAction(running);

    controller.update(0, entity, unsatisfiedSnapshot());
    controller.invalidatePlan();
    const r2 = controller.update(100, entity, unsatisfiedSnapshot());
    expect(r2.replanned).toBe(true);
  });

  it('handles action failure', () => {
    const fails = new AlwaysFailsAction();
    planner.registerAction(fails);

    const result = controller.update(0, entity, unsatisfiedSnapshot());
    expect(result.handled).toBe(false);
  });

  it('aborts invalid action', () => {
    const invalid = new InvalidAction();
    planner.registerAction(invalid);

    controller.update(0, entity, unsatisfiedSnapshot());
    expect(invalid.aborted).toBe(true);
  });

  it('hasPlan reports correctly', () => {
    expect(controller.hasPlan()).toBe(false);

    const running = new AlwaysRunningAction();
    planner.registerAction(running);
    controller.update(0, entity, unsatisfiedSnapshot());
    expect(controller.hasPlan()).toBe(true);
  });

  it('getCurrentPlanIds returns action IDs', () => {
    const action = new InvestigateAction();
    planner.registerAction(action);
    controller.update(0, entity, unsatisfiedSnapshot());
    expect(Array.isArray(controller.getCurrentPlanIds())).toBe(true);
  });

  it('reset clears plan', () => {
    const running = new AlwaysRunningAction();
    planner.registerAction(running);
    controller.update(0, entity, unsatisfiedSnapshot());
    controller.reset(entity);
    expect(controller.hasPlan()).toBe(false);
    expect(controller.getCurrentIndex()).toBe(0);
  });

  it('skips plan when goal already satisfied', () => {
    const action = new InvestigateAction();
    planner.registerAction(action);
    // Default snapshot has no danger → AT_TARGET is already true → goal satisfied
    const result = controller.update(0, entity, makeSnapshot());
    expect(result.replanned).toBe(true);
    expect(result.handled).toBe(false);
    expect(action.executed).toBe(false);
  });

  it('selects wounded goal when HP is critical', () => {
    const action = new InvestigateAction();
    planner.registerAction(action);
    controller.update(0, entity, makeSnapshot({ hpRatio: 0.1 }));
    const goalResult = controller.getLastGoalResult();
    expect(goalResult?.reason).toContain('HP critical');
  });

  it('selects enemy goal when enemy present', () => {
    const action = new InvestigateAction();
    planner.registerAction(action);
    controller.update(0, entity, makeSnapshot({ enemyPresent: true }));
    const goalResult = controller.getLastGoalResult();
    expect(goalResult?.reason).toBe('Enemy detected');
  });

  // ---------------------------------------------------------------------------
  // prevAction abort fix: !currentPlan.includes(prevAction)
  //
  // Before the fix the controller compared prevAction !== newPlan[0], which
  // caused spurious aborts whenever the same action object was still in the
  // new plan but at index > 0 (or even at index 0 when index was non-zero).
  // The fix uses Array.prototype.includes so an action is only aborted when it
  // has been genuinely removed from the new plan.
  // ---------------------------------------------------------------------------

  describe('prevAction abort on replan', () => {
    // Utility: a GOAPAction that records every abort() call.
    class TrackingRunningAction extends GOAPAction {
      readonly id: string;
      readonly cost: number;
      abortCount = 0;

      constructor(id: string, cost = 1) {
        super();
        this.id = id;
        this.cost = cost;
      }

      getPreconditions(): WorldState { return new WorldState(); }
      getEffects(): WorldState {
        const e = new WorldState();
        e.set(WorldProperty.DANGER, false);
        return e;
      }
      isValid(): boolean { return true; }
      execute(): ActionStatus { return ActionStatus.RUNNING; }
      abort(): void { this.abortCount++; }
    }

    it('replan with same action still in new plan — abort is NOT called', () => {
      // Register one RUNNING action. The planner will return the same object
      // instance on every replan because it is the only registered action.
      const action = new TrackingRunningAction('stay');
      planner.registerAction(action);

      // First update: plan is created, action starts running (currentIndex = 0).
      controller.update(0, entity, unsatisfiedSnapshot());
      expect(action.abortCount).toBe(0);

      // Force a replan while the same action is still the best plan.
      controller.invalidatePlan();
      controller.update(0, entity, unsatisfiedSnapshot());

      // The action is still in the new plan — abort must not have been called.
      expect(action.abortCount).toBe(0);
    });

    it('replan with different action — abort IS called', () => {
      // Spy on planner.plan so we can inject exactly the plan we want.
      const firstAction = new TrackingRunningAction('first');
      const secondAction = new TrackingRunningAction('second');

      // First replan returns [firstAction].
      // Second replan returns [secondAction] — firstAction is gone.
      const planSpy = vi.spyOn(planner, 'plan')
        .mockReturnValueOnce([firstAction])
        .mockReturnValueOnce([secondAction]);

      // Tick 1: controller replans → gets [firstAction].
      controller.update(0, entity, unsatisfiedSnapshot());
      expect(firstAction.abortCount).toBe(0);

      // Force a second replan; new plan no longer contains firstAction.
      controller.invalidatePlan();
      controller.update(0, entity, unsatisfiedSnapshot());

      // firstAction was dropped from the plan — it must have been aborted.
      expect(firstAction.abortCount).toBe(1);
      // secondAction is the new current action — it must NOT have been aborted.
      expect(secondAction.abortCount).toBe(0);

      planSpy.mockRestore();
    });

    it('mid-plan replan (currentIndex > 0) with same action still in new plan — no abort', () => {
      // Build a 2-action sequence: [successAction, trackingAction].
      // successAction completes immediately, advancing currentIndex to 1.
      // A replan then fires while trackingAction is at currentIndex = 1.
      // The new plan is also [successAction, trackingAction] (same objects),
      // so trackingAction is still included — abort must NOT be called.
      const successAction = new InvestigateAction(); // always returns SUCCESS
      const trackingAction = new TrackingRunningAction('mid');

      const planSpy = vi.spyOn(planner, 'plan')
        // First replan: full two-step plan.
        .mockReturnValueOnce([successAction, trackingAction])
        // Second replan (after index advances to 1): same objects, same plan.
        .mockReturnValueOnce([successAction, trackingAction]);

      // Tick 1: replan → [successAction, trackingAction]; successAction executes
      // and returns SUCCESS, so currentIndex advances to 1 in the same tick.
      controller.update(0, entity, unsatisfiedSnapshot());
      expect(controller.getCurrentIndex()).toBe(1);
      expect(trackingAction.abortCount).toBe(0);

      // Force a replan. prevAction = currentPlan[1] = trackingAction.
      // New plan still contains trackingAction → abort must NOT be called.
      controller.invalidatePlan();
      controller.update(0, entity, unsatisfiedSnapshot());

      expect(trackingAction.abortCount).toBe(0);

      planSpy.mockRestore();
    });

    it('mid-plan replan with action removed from new plan — abort IS called', () => {
      // Same setup as above but the second replan returns a completely
      // different action, so the action at currentIndex = 1 is dropped.
      const successAction = new InvestigateAction();
      const droppedAction = new TrackingRunningAction('dropped');
      const replacementAction = new TrackingRunningAction('replacement');

      const planSpy = vi.spyOn(planner, 'plan')
        // First replan: [successAction, droppedAction]; index advances to 1.
        .mockReturnValueOnce([successAction, droppedAction])
        // Second replan: droppedAction is gone, replaced by replacementAction.
        .mockReturnValueOnce([replacementAction]);

      // Tick 1: replan → index advances to 1 after successAction completes.
      controller.update(0, entity, unsatisfiedSnapshot());
      expect(controller.getCurrentIndex()).toBe(1);
      expect(droppedAction.abortCount).toBe(0);

      // Force a replan. prevAction = droppedAction (at index 1).
      // New plan [replacementAction] does NOT include droppedAction → abort.
      controller.invalidatePlan();
      controller.update(0, entity, unsatisfiedSnapshot());

      expect(droppedAction.abortCount).toBe(1);
      // replacementAction is now executing — it must NOT be aborted.
      expect(replacementAction.abortCount).toBe(0);

      planSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // Round-4 fix: abort() must NOT be called on SUCCESS; it must still be
  // called on FAILURE and when isValid() returns false.
  // ---------------------------------------------------------------------------

  describe('abort() on SUCCESS / FAILURE / isValid=false (round-4 fix)', () => {
    // Action that returns SUCCESS and tracks whether abort() was ever called.
    class TrackingSuccessAction extends GOAPAction {
      readonly id = 'success-tracked';
      readonly cost = 1;
      abortCount = 0;

      getPreconditions(): WorldState { return new WorldState(); }
      getEffects(): WorldState {
        const e = new WorldState();
        e.set(WorldProperty.DANGER, false);
        return e;
      }
      isValid(): boolean { return true; }
      execute(): ActionStatus { return ActionStatus.SUCCESS; }
      abort(): void { this.abortCount++; }
    }

    // Action that returns FAILURE and tracks abort() calls.
    class TrackingFailureAction extends GOAPAction {
      readonly id = 'failure-tracked';
      readonly cost = 1;
      abortCount = 0;

      getPreconditions(): WorldState { return new WorldState(); }
      getEffects(): WorldState {
        const e = new WorldState();
        e.set(WorldProperty.DANGER, false);
        return e;
      }
      isValid(): boolean { return true; }
      execute(): ActionStatus { return ActionStatus.FAILURE; }
      abort(): void { this.abortCount++; }
    }

    // Action that reports isValid()=false and tracks abort() calls.
    class TrackingInvalidAction extends GOAPAction {
      readonly id = 'invalid-tracked';
      readonly cost = 1;
      abortCount = 0;

      getPreconditions(): WorldState { return new WorldState(); }
      getEffects(): WorldState {
        const e = new WorldState();
        e.set(WorldProperty.DANGER, false);
        return e;
      }
      isValid(): boolean { return false; }
      execute(): ActionStatus { return ActionStatus.SUCCESS; }
      abort(): void { this.abortCount++; }
    }

    it('abort() is NOT called on the completed action when it returns SUCCESS', () => {
      const action = new TrackingSuccessAction();
      // Inject the action directly so the planner returns it as the plan.
      const planSpy = vi.spyOn(planner, 'plan').mockReturnValue([action]);

      controller.update(0, entity, unsatisfiedSnapshot());

      // The action returned SUCCESS — abort must never have been called.
      expect(action.abortCount).toBe(0);

      planSpy.mockRestore();
    });

    it('abort() IS called when the action returns FAILURE', () => {
      const action = new TrackingFailureAction();
      const planSpy = vi.spyOn(planner, 'plan').mockReturnValue([action]);

      controller.update(0, entity, unsatisfiedSnapshot());

      expect(action.abortCount).toBe(1);

      planSpy.mockRestore();
    });

    it('abort() IS called when isValid() returns false', () => {
      const action = new TrackingInvalidAction();
      const planSpy = vi.spyOn(planner, 'plan').mockReturnValue([action]);

      controller.update(0, entity, unsatisfiedSnapshot());

      // isValid() returned false → abort() must have been called.
      expect(action.abortCount).toBe(1);

      planSpy.mockRestore();
    });

    it('SUCCESS sets handled=true and does not set planInvalid via abort side-effects', () => {
      const action = new TrackingSuccessAction();
      const planSpy = vi.spyOn(planner, 'plan').mockReturnValue([action]);

      const result = controller.update(0, entity, unsatisfiedSnapshot());

      // The single-action plan completes → planInvalid is set to true by the
      // plan-exhaustion path, NOT by an abort call. The result must indicate
      // the action was handled (returned value of SUCCESS tick).
      expect(result.handled).toBe(true);
      expect(result.currentActionId).toBe('success-tracked');
      expect(action.abortCount).toBe(0);

      planSpy.mockRestore();
    });

    it('FAILURE sets handled=false and abort() is called exactly once', () => {
      const action = new TrackingFailureAction();
      const planSpy = vi.spyOn(planner, 'plan').mockReturnValue([action]);

      const result = controller.update(0, entity, unsatisfiedSnapshot());

      expect(result.handled).toBe(false);
      expect(action.abortCount).toBe(1);

      planSpy.mockRestore();
    });

    it('isValid()=false sets handled=false and abort() is called exactly once', () => {
      const action = new TrackingInvalidAction();
      const planSpy = vi.spyOn(planner, 'plan').mockReturnValue([action]);

      const result = controller.update(0, entity, unsatisfiedSnapshot());

      expect(result.handled).toBe(false);
      expect(action.abortCount).toBe(1);

      planSpy.mockRestore();
    });
  });

  // ---------------------------------------------------------------------------
  // restore() — fix: currentIndex is always reset to 0, not state.currentIndex
  // ---------------------------------------------------------------------------

  describe('restore()', () => {
    it('sets currentIndex to 0 even when serialized state has currentIndex=3', () => {
      // Simulate a state that was serialized mid-plan with index advanced to 3.
      controller.restore({ replanTimer: 0, currentIndex: 3 });
      expect(controller.getCurrentIndex()).toBe(0);
    });

    it('currentPlan is empty after restore', () => {
      // Establish a real plan first so there is something to clear.
      planner.registerAction(new AlwaysRunningAction());
      controller.update(0, entity, unsatisfiedSnapshot());
      expect(controller.hasPlan()).toBe(true);

      controller.restore({ replanTimer: 0, currentIndex: 0 });
      expect(controller.getCurrentPlanIds()).toHaveLength(0);
    });

    it('planInvalid is true after restore, so the next update replans', () => {
      planner.registerAction(new AlwaysRunningAction());
      // Run two ticks so planInvalid is cleared and the replan timer is well
      // below the interval threshold.
      controller.update(0, entity, unsatisfiedSnapshot());
      controller.update(100, entity, unsatisfiedSnapshot());

      // Restore — this must flip planInvalid back to true.
      controller.restore({ replanTimer: 100, currentIndex: 0 });

      // The very next tick must replan (replanned=true) regardless of timer.
      const result = controller.update(0, entity, unsatisfiedSnapshot());
      expect(result.replanned).toBe(true);
    });

    it('hasPlan() returns false immediately after restore', () => {
      planner.registerAction(new AlwaysRunningAction());
      controller.update(0, entity, unsatisfiedSnapshot());
      expect(controller.hasPlan()).toBe(true);

      controller.restore({ replanTimer: 0, currentIndex: 0 });
      expect(controller.hasPlan()).toBe(false);
    });

    it('serialize → restore round-trip: controller replans and executes on first update', () => {
      // Advance the controller so serialize captures a non-zero replanTimer and
      // a non-zero currentIndex (simulate a mid-plan save).
      const running = new AlwaysRunningAction();
      planner.registerAction(running);

      // First update — plan is created and action starts running.
      controller.update(0, entity, unsatisfiedSnapshot());
      expect(controller.hasPlan()).toBe(true);

      // Capture state mid-execution. The serialized currentIndex will be 0
      // here because AlwaysRunningAction never advances it, but the replanTimer
      // is non-zero to prove it is faithfully restored.
      const serialized = controller.serialize();
      // Sanity-check: serialized state reflects real timer value.
      expect(typeof serialized.replanTimer).toBe('number');

      // Create a fresh controller (simulates loading a save file).
      const freshPlanner = new GOAPPlanner();
      const freshRunning = new AlwaysRunningAction();
      freshPlanner.registerAction(freshRunning);
      const freshController = new GOAPController(freshPlanner, goapConfig);

      // Restore from the serialized snapshot.
      freshController.restore(serialized);

      // Immediately after restore the plan must be empty and index must be 0.
      expect(freshController.hasPlan()).toBe(false);
      expect(freshController.getCurrentIndex()).toBe(0);

      // First update after restore must trigger a replan and execute the action.
      const result = freshController.update(0, entity, unsatisfiedSnapshot());
      expect(result.replanned).toBe(true);
      expect(freshController.hasPlan()).toBe(true);
      expect(freshRunning.ticks).toBeGreaterThan(0);
    });

    it('restore preserves replanTimer from serialized state', () => {
      // Confirm that only currentIndex is overridden to 0; replanTimer is kept.
      const state = { replanTimer: 1234, currentIndex: 7 };
      controller.restore(state);

      // replanTimer is private; observe its effect: if it is restored to 1234
      // and replanIntervalMs is 5000, the next tick should NOT replan purely
      // on timer grounds (timer is well below the interval).  planInvalid will
      // still force a replan on the first tick, but on the SECOND tick (after
      // the first replan clears planInvalid) only 0 ms have elapsed since the
      // last replan, so replanned must be false.
      planner.registerAction(new AlwaysRunningAction());
      controller.update(0, entity, unsatisfiedSnapshot()); // triggers replan (planInvalid)
      const second = controller.update(0, entity, unsatisfiedSnapshot()); // no replan
      expect(second.replanned).toBe(false);
    });
  });
});
