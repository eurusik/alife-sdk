/**
 * Abstract GOAP action base.
 *
 * Each concrete action encodes:
 *   - id:            Unique string identifier for logging and plan inspection.
 *   - cost:          Planner cost. Lower = preferred path.
 *   - preconditions: WorldState properties that must be true before execution.
 *   - effects:       WorldState properties this action produces on success.
 *
 * Execution lifecycle per action:
 *   1. isValid()  -- real-time guard (can bail on stale conditions)
 *   2. execute()  -- called every tick; returns RUNNING / SUCCESS / FAILURE
 *   3. abort()    -- called when the action is interrupted (default no-op)
 */

import type { WorldState } from './WorldState';
import type { IEntity } from '../entity/IEntity';

// ---------------------------------------------------------------------------
// Action status
// ---------------------------------------------------------------------------

export const ActionStatus = {
  RUNNING: 'running',
  SUCCESS: 'success',
  FAILURE: 'failure',
} as const;

export type ActionStatus = (typeof ActionStatus)[keyof typeof ActionStatus];

// ---------------------------------------------------------------------------
// Abstract base class
// ---------------------------------------------------------------------------

export abstract class GOAPAction {
  /** Unique action identifier for logging and plan inspection. */
  abstract readonly id: string;

  /** Planner cost. Lower cost = preferred path. */
  abstract readonly cost: number;

  /** Preconditions that must be true for this action to be valid. */
  abstract getPreconditions(): WorldState;

  /** Effects this action has on the world state when it completes. */
  abstract getEffects(): WorldState;

  /** Check if the action can currently execute (real-time guard). */
  abstract isValid(entity: IEntity): boolean;

  /**
   * Execute one tick of this action.
   *
   * @param entity  - The entity executing this action.
   * @param delta   - Milliseconds elapsed since the last tick.
   * @returns Status indicating whether to continue, succeed, or fail.
   */
  abstract execute(entity: IEntity, delta: number): ActionStatus;

  /** Called when the action is interrupted. Override for cleanup. */
  abort(_entity: IEntity): void {
    // Default no-op. Concrete actions override for cleanup.
  }
}
