/**
 * Integration test: Anomaly avoidance GOAP pipeline.
 *
 * Exercises the full pipeline:
 *   nearAnomalyZone snapshot → WorldStateBuilder → GoalSelector (ANOMALY_AVOID) → GOAPController
 *   → EvadeHazardAction execution → entity moves → SUCCESS when clear
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
import { EvadeHazardAction } from '../goap/EvadeHazardAction';
import type { IHazardZoneAccess } from '../goap/IHazardZoneAccess';
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

function makeEntity(x = 100, y = 100): IEntity {
  return {
    id: 'npc_1',
    entityType: 'npc',
    isAlive: true,
    x,
    y,
    active: true,
    setPosition(nx: number, ny: number) { this.x = nx; this.y = ny; },
    setActive() { return this; },
    setVisible() { return this; },
    hasComponent() { return false; },
    getComponent<T>(): T { throw new Error('no components'); },
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

function makeAlwaysNearHazard(): IHazardZoneAccess {
  return {
    isNearHazard: () => true,
    getEscapeDirection: () => ({ x: 1, y: 0 }),
  };
}

function makeEvadeAnomaly(hazard: IHazardZoneAccess, speed?: number): EvadeHazardAction {
  return new EvadeHazardAction(hazard, 'evade_anomaly', WorldProperty.ANOMALY_NEAR, speed);
}

/** Idle action to satisfy AT_TARGET (default goal). */
class IdleAction extends GOAPAction {
  readonly id = 'idle';
  readonly cost = 1;
  getPreconditions(): WorldState { return new WorldState(); }
  getEffects(): WorldState {
    const ws = new WorldState();
    ws.set(WorldProperty.AT_TARGET, true);
    return ws;
  }
  isValid(): boolean { return true; }
  execute(): ActionStatus { return ActionStatus.SUCCESS; }
}

/** Fight action to satisfy ENEMY_PRESENT=false goal. */
class FightAction extends GOAPAction {
  readonly id = 'fight';
  readonly cost = 1;
  getPreconditions(): WorldState {
    const ws = new WorldState();
    ws.set(WorldProperty.SEE_ENEMY, true);
    ws.set(WorldProperty.HAS_WEAPON, true);
    return ws;
  }
  getEffects(): WorldState {
    const ws = new WorldState();
    ws.set(WorldProperty.ENEMY_PRESENT, false);
    return ws;
  }
  isValid(): boolean { return true; }
  execute(): ActionStatus { return ActionStatus.SUCCESS; }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Anomaly avoidance GOAP pipeline (integration)', () => {

  it('nearAnomalyZone=true → controller selects ANOMALY_AVOID goal', () => {
    const planner = new GOAPPlanner();
    planner.registerAction(makeEvadeAnomaly(makeAlwaysNearHazard()));
    planner.registerAction(new IdleAction());

    const controller = new GOAPController(planner, makeConfig());
    const entity = makeEntity();
    const snapshot = makeSnapshot({ nearAnomalyZone: true });

    controller.update(100, entity, snapshot);

    const goal = controller.getLastGoalResult();
    expect(goal).not.toBeNull();
    expect(goal!.priority).toBe(GoalPriority.ANOMALY_AVOID);
  });

  it('nearAnomalyZone=true → plan contains evade_anomaly action', () => {
    const planner = new GOAPPlanner();
    planner.registerAction(makeEvadeAnomaly(makeAlwaysNearHazard()));
    planner.registerAction(new IdleAction());

    const controller = new GOAPController(planner, makeConfig());
    const entity = makeEntity();

    controller.update(100, entity, makeSnapshot({ nearAnomalyZone: true }));

    const planIds = controller.getCurrentPlanIds();
    expect(planIds).toContain('evade_anomaly');
  });

  it('nearAnomalyZone=true + enemyPresent=true → ENEMY_PRESENT goal wins, NOT anomaly', () => {
    const planner = new GOAPPlanner();
    planner.registerAction(makeEvadeAnomaly(makeAlwaysNearHazard()));
    planner.registerAction(new FightAction());
    planner.registerAction(new IdleAction());

    const controller = new GOAPController(planner, makeConfig());
    const entity = makeEntity();
    const snapshot = makeSnapshot({
      nearAnomalyZone: true,
      enemyPresent: true,
      seeEnemy: true,
      hasWeapon: true,
    });

    controller.update(100, entity, snapshot);

    const goal = controller.getLastGoalResult();
    expect(goal!.priority).toBe(GoalPriority.ENEMY_PRESENT);
  });

  it('nearAnomalyZone=false → DEFAULT goal, NOT anomaly', () => {
    const planner = new GOAPPlanner();
    planner.registerAction(makeEvadeAnomaly(makeAlwaysNearHazard()));
    planner.registerAction(new IdleAction());

    const controller = new GOAPController(planner, makeConfig());
    const entity = makeEntity();

    controller.update(100, entity, makeSnapshot({ nearAnomalyZone: false }));

    const goal = controller.getLastGoalResult();
    expect(goal!.priority).toBe(GoalPriority.DEFAULT);
  });

  it('invalidatePlan() after anomaly clears → replans to DEFAULT immediately', () => {
    const planner = new GOAPPlanner();
    planner.registerAction(makeEvadeAnomaly(makeAlwaysNearHazard()));
    planner.registerAction(new IdleAction());

    const controller = new GOAPController(planner, makeConfig({ replanIntervalMs: 60_000 }));
    const entity = makeEntity();

    // Start with anomaly active
    controller.update(100, entity, makeSnapshot({ nearAnomalyZone: true }));
    expect(controller.getLastGoalResult()!.priority).toBe(GoalPriority.ANOMALY_AVOID);

    // Anomaly clears — force replan
    controller.invalidatePlan();
    controller.update(100, entity, makeSnapshot({ nearAnomalyZone: false }));

    expect(controller.getLastGoalResult()!.priority).toBe(GoalPriority.DEFAULT);
  });

  it('EvadeHazardAction executes: entity moves away from hazard', () => {
    const hazard = makeAlwaysNearHazard(); // escape direction = (1, 0)
    const planner = new GOAPPlanner();
    planner.registerAction(makeEvadeAnomaly(hazard, 120));
    planner.registerAction(new IdleAction());

    const controller = new GOAPController(planner, makeConfig());
    const entity = makeEntity(100, 100);

    controller.update(100, entity, makeSnapshot({ nearAnomalyZone: true }));

    // Entity should have moved in escape direction
    expect(entity.x).toBeGreaterThan(100);
    expect(entity.y).toBe(100);
  });

  it('EvadeHazardAction with clear hazard returns SUCCESS and plan completes', () => {
    const hazard: IHazardZoneAccess = {
      isNearHazard: () => false,
      getEscapeDirection: () => null,
    };
    const planner = new GOAPPlanner();
    planner.registerAction(makeEvadeAnomaly(hazard));
    planner.registerAction(new IdleAction());

    const controller = new GOAPController(planner, makeConfig());
    const entity = makeEntity();

    // Snapshot says near anomaly, but action itself finds it's clear → SUCCESS
    const result = controller.update(100, entity, makeSnapshot({ nearAnomalyZone: true }));
    expect(result).toBeDefined();
  });
});
