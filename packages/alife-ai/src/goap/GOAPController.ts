// goap/GOAPController.ts
// Mediator orchestrating WorldStateBuilder → GoalSelector → GOAPPlanner → Action execution.
// Per-NPC controller with periodic replanning and plan invalidation.

import { GOAPPlanner, type GOAPAction, ActionStatus, type WorldState, type IEntity } from '@alife-sdk/core';
import type { IGOAPConfig, INPCWorldSnapshot } from '../types/IPerceptionTypes';
import { buildWorldState } from './WorldStateBuilder';
import { selectGoal, type IGoalResult } from './GoalSelector';

/**
 * Serialized state for save/load round-trips.
 *
 * The current plan is ephemeral — it is NOT serialized. On restore the
 * controller forces a replan on the next `update()` call.
 */
export interface IGOAPControllerState {
  readonly replanTimer: number;
  readonly currentIndex: number;
}

/**
 * Result of a single update tick.
 */
export interface IGOAPUpdateResult {
  /** Whether GOAP handled behaviour this frame (true = suppress FSM). */
  readonly handled: boolean;
  /** Current action ID (null if no plan). */
  readonly currentActionId: string | null;
  /** Whether a replan occurred this frame. */
  readonly replanned: boolean;
}

/**
 * GOAP Controller — per-NPC mediator.
 *
 * Orchestrates the GOAP pipeline:
 * 1. Build world state snapshot
 * 2. Select goal (priority bands)
 * 3. Plan (A* search via GOAPPlanner)
 * 4. Execute current action
 * 5. Handle success/failure/replan
 *
 * The controller does NOT own the planner's action pool — actions
 * are registered externally via the planner.
 *
 * @example
 * ```ts
 * const planner = new GOAPPlanner();
 * planner.registerAction(new IdleAction());
 * planner.registerAction(new PatrolAction());
 *
 * const controller = new GOAPController(planner, goapConfig);
 *
 * // Each frame:
 * const result = controller.update(deltaMs, entity, snapshot);
 * if (!result.handled) {
 *   // Fall back to FSM
 * }
 * ```
 */
export class GOAPController {
  private currentPlan: GOAPAction[] = [];
  private currentIndex = 0;
  private replanTimer = 0;
  private planInvalid = true;
  private lastGoalResult: IGoalResult | null = null;

  constructor(
    private readonly planner: GOAPPlanner,
    private readonly config: IGOAPConfig,
  ) {}

  /**
   * Update the GOAP controller for one frame.
   *
   * @param deltaMs - Elapsed time since last frame (ms)
   * @param entity - The entity being controlled
   * @param snapshot - Pre-computed NPC world data
   * @returns Whether GOAP handled this frame
   */
  update(
    deltaMs: number,
    entity: IEntity,
    snapshot: INPCWorldSnapshot,
  ): IGOAPUpdateResult {
    this.replanTimer += deltaMs;

    let replanned = false;

    // Check if replan is needed — only build WorldState when replanning
    if (this.needsReplan()) {
      const prevAction = this.currentPlan[this.currentIndex] ?? null;
      const worldState = buildWorldState(snapshot);
      replanned = this.replan(worldState, snapshot);
      // Abort the previous action only if it is no longer present anywhere in
      // the new plan.  Comparing against currentPlan[currentIndex] (always 0
      // after replan) would cause a spurious abort when prevAction was mid-plan
      // (index > 0) and the new plan still contains the same action object.
      if (prevAction && !this.currentPlan.includes(prevAction)) {
        prevAction.abort(entity);
      }
    }

    // Execute current action
    if (this.currentPlan.length > 0 && this.currentIndex < this.currentPlan.length) {
      const action = this.currentPlan[this.currentIndex];

      if (!action.isValid(entity)) {
        action.abort(entity);
        this.planInvalid = true;
        return { handled: false, currentActionId: action.id, replanned };
      }

      const status = action.execute(entity, deltaMs);

      if (status === ActionStatus.SUCCESS) {
        this.currentIndex++;
        if (this.currentIndex >= this.currentPlan.length) {
          this.planInvalid = true;
        }
        return { handled: true, currentActionId: action.id, replanned };
      }

      if (status === ActionStatus.FAILURE) {
        action.abort(entity);
        this.planInvalid = true;
        return { handled: false, currentActionId: action.id, replanned };
      }

      // RUNNING
      return { handled: true, currentActionId: action.id, replanned };
    }

    return { handled: false, currentActionId: null, replanned };
  }

  /**
   * Force a replan on the next update.
   * Call this when significant world changes occur (damage taken, new enemy, etc.).
   */
  invalidatePlan(): void {
    this.planInvalid = true;
  }

  /**
   * Get the last goal selection result (for debugging/logging).
   */
  getLastGoalResult(): IGoalResult | null {
    return this.lastGoalResult;
  }

  /**
   * Get the current plan action IDs (for debugging).
   */
  getCurrentPlanIds(): string[] {
    return this.currentPlan.map((a) => a.id);
  }

  /**
   * Get the current progress within the plan.
   */
  getCurrentIndex(): number {
    return this.currentIndex;
  }

  /**
   * Whether the controller has a valid plan.
   */
  hasPlan(): boolean {
    return this.currentPlan.length > 0 && this.currentIndex < this.currentPlan.length;
  }

  /**
   * Reset the controller — clears plan and forces replan.
   */
  reset(entity: IEntity): void {
    this.finalizeCurrent(entity);
    this.currentPlan = [];
    this.currentIndex = 0;
    this.replanTimer = 0;
    this.planInvalid = true;
    this.lastGoalResult = null;
  }

  /**
   * Serialize controller state for save/load.
   *
   * The current plan is intentionally excluded — it is rebuilt on the next
   * `update()` call after restore, which triggers an immediate replan.
   */
  serialize(): IGOAPControllerState {
    return {
      replanTimer: this.replanTimer,
      currentIndex: this.currentIndex,
    };
  }

  /**
   * Restore controller state from a serialized snapshot.
   *
   * The plan is cleared and `planInvalid` is set to `true` so that the
   * controller replans on the very next `update()` call.
   */
  restore(state: IGOAPControllerState): void {
    this.currentPlan = [];
    this.currentIndex = 0;
    this.replanTimer = state.replanTimer;
    this.planInvalid = true;
    this.lastGoalResult = null;
  }

  private needsReplan(): boolean {
    if (this.planInvalid) return true;
    if (this.currentPlan.length === 0) return true;
    if (this.replanTimer >= this.config.replanIntervalMs) return true;
    return false;
  }

  private replan(worldState: WorldState, snapshot: INPCWorldSnapshot): boolean {
    this.replanTimer = 0;
    this.planInvalid = false;

    const goalResult = selectGoal(snapshot, this.config);
    this.lastGoalResult = goalResult;

    if (worldState.satisfies(goalResult.goal)) {
      this.currentPlan = [];
      this.currentIndex = 0;
      return true;
    }

    const plan = this.planner.plan(worldState, goalResult.goal, this.config.maxPlanDepth);

    if (plan && plan.length > 0) {
      // If the new plan's current action is the same object as the running
      // action, keep executing it without resetting its internal state
      // (timers, phase, etc.).  This prevents periodic replans from
      // interrupting long-running actions like AttackFromCover's peek-fire cycle.
      const currentAction = this.currentPlan[this.currentIndex];
      if (currentAction && plan.length > 0 && plan[0] === currentAction) {
        // Same action continues — just update the rest of the plan
        this.currentPlan = plan;
        // currentIndex stays the same (0, since plan[0] === currentAction)
        this.currentIndex = 0;
        return true;
      }
      this.currentPlan = plan;
      this.currentIndex = 0;
      return true;
    }

    this.currentPlan = [];
    this.currentIndex = 0;
    return true;
  }

  private finalizeCurrent(entity: IEntity): void {
    if (this.currentPlan.length > 0 && this.currentIndex < this.currentPlan.length) {
      this.currentPlan[this.currentIndex].abort(entity);
    }
  }
}
