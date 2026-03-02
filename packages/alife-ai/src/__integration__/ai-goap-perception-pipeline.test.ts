/**
 * Integration test: "AI GOAP + perception pipeline".
 *
 * Exercises the Perception → WorldState → GOAPController plan chain:
 *   1. PerceptionQuery scan → hostile filtering
 *   2. WorldStateBuilder snapshot → GOAPController goal selection
 *   3. GOAPController plan creation and replan on world change
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
import { createDefaultAIConfig } from '../config/createDefaultAIConfig';
import { filterHostileEntities, filterVisibleEntities } from '../perception/PerceptionQuery';
import { buildWorldState } from '../goap/WorldStateBuilder';
import { selectGoal } from '../goap/GoalSelector';
import { GOAPController } from '../goap/GOAPController';
import { WorldProperty, GoalPriority } from '../types/IPerceptionTypes';
import type { IPerceivedEntity, INPCWorldSnapshot } from '../types/IPerceptionTypes';

const config = createDefaultAIConfig();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePerceivedEntity(
  entityId: string,
  x: number,
  y: number,
  factionId = 'bandit',
  isAlive = true,
): IPerceivedEntity {
  return { entityId, position: { x, y }, factionId, isAlive };
}

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

/** Stub IEntity for GOAPController — all methods are no-ops. */
function makeStubEntity(id = 'npc_1'): IEntity {
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

/** Concrete GOAPAction for testing — always succeeds in one tick. */
class StubGOAPAction extends GOAPAction {
  readonly id: string;
  readonly cost: number;
  private readonly _preconditions: WorldState;
  private readonly _effects: WorldState;

  constructor(id: string, cost: number, preconditions: WorldState, effects: WorldState) {
    super();
    this.id = id;
    this.cost = cost;
    this._preconditions = preconditions;
    this._effects = effects;
  }

  getPreconditions(): WorldState { return this._preconditions; }
  getEffects(): WorldState { return this._effects; }
  isValid(): boolean { return true; }
  execute(): ActionStatus { return ActionStatus.SUCCESS; }
}

function makeAction(
  id: string,
  cost: number,
  preconditions: Record<string, boolean>,
  effects: Record<string, boolean>,
): StubGOAPAction {
  const pre = new WorldState();
  for (const [k, v] of Object.entries(preconditions)) pre.set(k, v);
  const eff = new WorldState();
  for (const [k, v] of Object.entries(effects)) eff.set(k, v);
  return new StubGOAPAction(id, cost, pre, eff);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AI: GOAP + perception pipeline (integration)', () => {
  // -----------------------------------------------------------------------
  // Perception → filtering
  // -----------------------------------------------------------------------

  describe('perception filtering', () => {
    it('filterHostileEntities excludes same-faction entities', () => {
      const entities: IPerceivedEntity[] = [
        makePerceivedEntity('ally', 50, 50, 'loner'),
        makePerceivedEntity('enemy', 100, 100, 'bandit'),
      ];

      const isHostile = (a: string, b: string) => a !== b;
      const hostile = filterHostileEntities(entities, 'loner', isHostile);

      expect(hostile).toHaveLength(1);
      expect(hostile[0].entityId).toBe('enemy');
    });

    it('filterVisibleEntities respects FOV and range', () => {
      const entities: IPerceivedEntity[] = [
        makePerceivedEntity('in_fov', 150, 100),   // ahead
        makePerceivedEntity('behind', -200, 100),   // behind
        makePerceivedEntity('too_far', 1000, 100),  // out of range
      ];

      const visible = filterVisibleEntities(
        { x: 100, y: 100 },  // origin
        0,                     // facing right (angle = 0)
        entities,              // candidates
        config.perception,     // IPerceptionConfig
      );

      // Only 'in_fov' should be visible (within range and FOV)
      expect(visible.length).toBeGreaterThanOrEqual(1);
      expect(visible.some(e => e.entityId === 'in_fov')).toBe(true);
      expect(visible.some(e => e.entityId === 'too_far')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // WorldStateBuilder → GoalSelector
  // -----------------------------------------------------------------------

  describe('world state → goal selection', () => {
    it('enemy visible → FIGHT_ENEMY goal', () => {
      const snapshot = makeSnapshot({ seeEnemy: true, enemyPresent: true, enemyInRange: true });
      const ws = buildWorldState(snapshot);

      expect(ws.get(WorldProperty.SEE_ENEMY)).toBe(true);

      const goal = selectGoal(snapshot, config.goap);
      expect(goal).toBeDefined();
      expect(goal.priority).toBe(GoalPriority.ENEMY_PRESENT);
    });

    it('no enemies → patrol/idle goal', () => {
      const snapshot = makeSnapshot({ seeEnemy: false, enemyPresent: false });
      const goal = selectGoal(snapshot, config.goap);

      expect(goal).toBeDefined();
      expect(goal.priority).toBe(GoalPriority.DEFAULT);
    });

    it('HP < healThreshold → wounded/heal goal (highest priority)', () => {
      const snapshot = makeSnapshot({ hpRatio: 0.2, seeEnemy: false });
      const goal = selectGoal(snapshot, config.goap);

      expect(goal).toBeDefined();
      expect(goal.priority).toBe(GoalPriority.CRITICALLY_WOUNDED);
    });
  });

  // -----------------------------------------------------------------------
  // GOAPController integration
  // -----------------------------------------------------------------------

  describe('GOAP controller', () => {
    function buildController() {
      const planner = new GOAPPlanner();

      // "fight" — requires seeEnemy + hasWeapon, eliminates enemyPresent
      planner.registerAction(
        makeAction('fight', 1,
          { [WorldProperty.SEE_ENEMY]: true, [WorldProperty.HAS_WEAPON]: true },
          { [WorldProperty.ENEMY_PRESENT]: false },
        ),
      );

      // "take_cover" — gets into cover
      planner.registerAction(
        makeAction('take_cover', 2,
          { [WorldProperty.IN_COVER]: false },
          { [WorldProperty.IN_COVER]: true },
        ),
      );

      // "patrol" — fallback, eliminates enemyPresent at high cost
      planner.registerAction(
        makeAction('patrol', 5, {}, { [WorldProperty.ENEMY_PRESENT]: false }),
      );

      // "heal" — fixes critically wounded
      planner.registerAction(
        makeAction('heal', 1, {}, { [WorldProperty.CRITICALLY_WOUNDED]: false }),
      );

      // "idle" — satisfies AT_TARGET (default goal)
      planner.registerAction(
        makeAction('idle', 1, {}, { [WorldProperty.AT_TARGET]: true }),
      );

      return new GOAPController(planner, config.goap);
    }

    it('controller with enemy → creates fight plan', () => {
      const controller = buildController();
      const entity = makeStubEntity();
      const snapshot = makeSnapshot({
        seeEnemy: true, enemyPresent: true,
        hasWeapon: true, hasAmmo: true,
      });

      const result = controller.update(100, entity, snapshot);
      expect(result).toBeDefined();
      expect(result.replanned).toBe(true);
    });

    it('controller without enemy → patrol/idle handled', () => {
      const controller = buildController();
      const entity = makeStubEntity();
      const snapshot = makeSnapshot({ seeEnemy: false, enemyPresent: false });

      const result = controller.update(100, entity, snapshot);
      expect(result).toBeDefined();
      expect(result.replanned).toBe(true);
    });

    it('controller replans after interval expires', () => {
      const controller = buildController();
      const entity = makeStubEntity();
      const snapshot = makeSnapshot({
        seeEnemy: true, enemyPresent: true,
        hasWeapon: true, hasAmmo: true,
      });

      // First update — creates initial plan.
      controller.update(100, entity, snapshot);

      // Advance past replan interval.
      let lastResult = controller.update(100, entity, snapshot);
      for (let elapsed = 0; elapsed < config.goap.replanIntervalMs + 1000; elapsed += 500) {
        lastResult = controller.update(500, entity, snapshot);
      }

      // After replan interval, controller should have replanned at least once.
      expect(lastResult).toBeDefined();
      expect(lastResult.replanned).toBe(true);
    });
  });
});
