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

export interface StateTransitionEvent {
  readonly from: string;
  readonly to: string;
  readonly timestamp: number;
}

export class StateMachine {
  private currentStateId: string;
  private previousStateId: string | null = null;
  private stateEnterTime: number;
  private readonly registry: AIStateRegistry;
  private readonly entity: IEntity;
  private readonly timeFn: () => number;

  private readonly enterListeners = new Map<string, Set<(from: string | null) => void>>();
  private readonly exitListeners = new Map<string, Set<(to: string) => void>>();
  private readonly changeListeners = new Set<(from: string, to: string) => void>();
  private readonly historyLog: StateTransitionEvent[] = [];
  private readonly maxHistoryLength: number;

  constructor(entity: IEntity, registry: AIStateRegistry, initialState: string, timeFn: () => number = Date.now, maxHistoryLength = 100) {
    this.entity = entity;
    this.registry = registry;
    this.timeFn = timeFn;
    this.maxHistoryLength = maxHistoryLength;
    this.currentStateId = initialState;
    this.stateEnterTime = this.timeFn();

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

  /** Previous state identifier, or `null` if no transition has occurred yet. */
  get previous(): string | null {
    return this.previousStateId;
  }

  /** Milliseconds elapsed since entering the current state. */
  get currentStateDuration(): number {
    return this.timeFn() - this.stateEnterTime;
  }

  // -----------------------------------------------------------------------
  // Tag queries
  // -----------------------------------------------------------------------

  /** Returns `true` if the current state has the given tag. */
  hasTag(tag: string): boolean {
    const def = this.registry.tryGet(this.currentStateId);
    return def?.tags?.includes(tag) ?? false;
  }

  /** Returns the metadata object of the current state, or `undefined`. */
  get metadata(): Readonly<Record<string, unknown>> | undefined {
    return this.registry.tryGet(this.currentStateId)?.metadata;
  }

  // -----------------------------------------------------------------------
  // Event subscriptions
  // -----------------------------------------------------------------------

  /**
   * Subscribe to the moment the FSM enters `state`.
   * @returns Unsubscribe function.
   */
  onEnter(state: string, callback: (from: string | null) => void): () => void {
    if (!this.enterListeners.has(state)) this.enterListeners.set(state, new Set());
    this.enterListeners.get(state)!.add(callback);
    return () => this.enterListeners.get(state)?.delete(callback);
  }

  /**
   * Subscribe to the moment the FSM exits `state`.
   * @returns Unsubscribe function.
   */
  onExit(state: string, callback: (to: string) => void): () => void {
    if (!this.exitListeners.has(state)) this.exitListeners.set(state, new Set());
    this.exitListeners.get(state)!.add(callback);
    return () => this.exitListeners.get(state)?.delete(callback);
  }

  /**
   * Subscribe to any state change.
   * @returns Unsubscribe function.
   */
  onChange(callback: (from: string, to: string) => void): () => void {
    this.changeListeners.add(callback);
    return () => this.changeListeners.delete(callback);
  }

  // -----------------------------------------------------------------------
  // History
  // -----------------------------------------------------------------------

  /** Returns a snapshot of the transition history (oldest first). */
  getHistory(): readonly StateTransitionEvent[] {
    return [...this.historyLog];
  }

  /** Clears the transition history. */
  clearHistory(): void {
    this.historyLog.length = 0;
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

    const from = this.currentStateId;

    // Exit
    oldDefinition.handler.exit(this.entity);
    this.exitListeners.get(from)?.forEach(cb => cb(newState));

    // Advance state
    this.previousStateId = from;
    this.currentStateId = newState;
    this.stateEnterTime = this.timeFn();

    // Record history (bounded by maxHistoryLength to prevent unbounded growth).
    this.historyLog.push({ from, to: newState, timestamp: this.stateEnterTime });
    if (this.historyLog.length > this.maxHistoryLength) {
      this.historyLog.shift();
    }

    // Notify change listeners
    this.changeListeners.forEach(cb => cb(from, newState));

    // Enter
    newDefinition.handler.enter(this.entity);
    this.enterListeners.get(newState)?.forEach(cb => cb(from));

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
