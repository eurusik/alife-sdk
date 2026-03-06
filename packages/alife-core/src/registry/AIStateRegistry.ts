import { Registry } from './Registry';
import type { IEntity } from '../entity/IEntity';

/** Lifecycle hooks for a single AI FSM state. */
export interface IStateHandler {
  /** Called once when the FSM transitions into this state. */
  enter(entity: IEntity): void;
  /** Called every frame while this state is active. `delta` is seconds since last frame. */
  update(entity: IEntity, delta: number): void;
  /** Called once when the FSM transitions out of this state. */
  exit(entity: IEntity): void;
}

/** Rule that triggers an automatic state transition. Evaluated every frame. */
export interface ITransitionCondition {
  /** AI state ID to transition to when the condition fires. */
  readonly targetState: string;
  /** Predicate evaluated every frame. Return `true` to trigger the transition. */
  readonly condition: (entity: IEntity) => boolean;
  /** Evaluation order (highest first). First matching condition wins. */
  readonly priority: number;
}

/** Complete definition of an AI state for registration in AIStateRegistry. */
export interface IAIStateDefinition {
  /** Lifecycle callbacks (enter/update/exit). */
  readonly handler: IStateHandler;
  /** Whitelist of state IDs this state can transition to. Unset = unrestricted. */
  readonly allowedTransitions?: readonly string[];
  /** Auto-evaluated rules checked every frame, sorted by priority (descending). */
  readonly transitionConditions?: readonly ITransitionCondition[];
  /** Guard: return `false` to veto entering this state from `fromState`. */
  readonly canEnter?: (entity: IEntity, fromState: string) => boolean;
  /** Guard: return `false` to prevent leaving this state for `toState`. */
  readonly canExit?: (entity: IEntity, toState: string) => boolean;
  /** Categorical tags for querying state group membership (e.g. 'combat', 'grounded'). */
  readonly tags?: readonly string[];
  /** Arbitrary metadata for tooling/debugging (e.g. animation hints, priority weights). */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/** Registry of AI FSM states with built-in transition evaluation. */
export class AIStateRegistry extends Registry<string, IAIStateDefinition> {
  constructor() {
    super({ name: 'AIStateRegistry' });
  }

  /** @override Pre-sort transition conditions by priority (descending) at registration time. */
  override register(id: string, config: IAIStateDefinition): this {
    const sorted = config.transitionConditions
      ? { ...config, transitionConditions: [...config.transitionConditions].sort((a, b) => b.priority - a.priority) }
      : config;
    super.register(id, sorted);
    return this;
  }

  /** Evaluate pre-sorted transition conditions for the current state. Returns the first matching target state ID, or `null`. */
  evaluateTransitions(currentState: string, entity: IEntity): string | null {
    const state = this.tryGet(currentState);
    if (!state?.transitionConditions) return null;

    for (const tc of state.transitionConditions) {
      if (tc.condition(entity)) return tc.targetState;
    }
    return null;
  }
}
