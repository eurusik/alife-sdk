/**
 * Generic finite state machine that works with the AIStateRegistry plugin system.
 *
 * The FSM delegates state behaviour to IStateHandler instances registered
 * in the AIStateRegistry. Each update tick runs the current handler's
 * update() method and then evaluates auto-transition conditions.
 *
 * Lifecycle per state:
 *   1. enter()  -- called once when transitioning into the state
 *   2. update() -- called every tick while the state is active
 *   3. exit()   -- called once when transitioning out of the state
 */

import type { IEntity } from '../entity/IEntity';
import type { AIStateRegistry } from '../registry/AIStateRegistry';

export type TransitionResult =
  | { readonly success: true }
  | { readonly success: false; readonly reason: 'not_allowed' | 'exit_guard' | 'enter_guard' };

export class StateMachine {
  private currentStateId: string;
  private readonly registry: AIStateRegistry;
  private readonly entity: IEntity;

  constructor(entity: IEntity, registry: AIStateRegistry, initialState: string) {
    this.entity = entity;
    this.registry = registry;
    this.currentStateId = initialState;

    const definition = this.registry.get(this.currentStateId);
    definition.handler.enter(this.entity);
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  /** Current active state identifier. */
  get state(): string {
    return this.currentStateId;
  }

  // -----------------------------------------------------------------------
  // Transitions
  // -----------------------------------------------------------------------

  /**
   * Force transition to a new state.
   *
   * Calls exit() on the current state handler, then enter() on the new one.
   * If the target state is the same as the current state, the transition
   * is still performed (exit + enter) to allow state reset semantics.
   */
  transition(newState: string): TransitionResult {
    const oldDefinition = this.registry.get(this.currentStateId);
    const newDefinition = this.registry.get(newState);

    // Whitelist check: if allowedTransitions is set, only listed targets are permitted.
    if (oldDefinition.allowedTransitions && !oldDefinition.allowedTransitions.includes(newState)) {
      return { success: false, reason: 'not_allowed' };
    }

    if (oldDefinition.canExit?.(this.entity, newState) === false) return { success: false, reason: 'exit_guard' };
    if (newDefinition.canEnter?.(this.entity, this.currentStateId) === false) return { success: false, reason: 'enter_guard' };

    oldDefinition.handler.exit(this.entity);
    this.currentStateId = newState;
    newDefinition.handler.enter(this.entity);
    return { success: true };
  }

  // -----------------------------------------------------------------------
  // Update
  // -----------------------------------------------------------------------

  /**
   * Run one tick of the FSM.
   *
   * First, the current handler's update() is called. Then the registry's
   * auto-transition conditions are evaluated. If any condition fires,
   * the FSM transitions to the target state automatically.
   *
   * @param delta - Seconds elapsed since the last update.
   */
  update(delta: number): void {
    const definition = this.registry.get(this.currentStateId);
    definition.handler.update(this.entity, delta);

    const nextState = this.registry.evaluateTransitions(
      this.currentStateId,
      this.entity,
    );

    if (nextState !== null) {
      this.transition(nextState);
    }
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  /** Exit the current state. Call when the entity is destroyed. */
  destroy(): void {
    const definition = this.registry.get(this.currentStateId);
    definition.handler.exit(this.entity);
  }
}
