import { describe, it, expect, beforeEach } from 'vitest';
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
});
