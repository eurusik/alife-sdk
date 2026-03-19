// goap/GOAPDirector.ts
// Built-in GOAP Director — bridges GOAPPlanner with the FSM.
//
// Register as the COMBAT state handler. On every entry the director
// replans and dispatches actions as sub-states. Each action handler
// reports running/success/failure; on success the director advances
// to the next action. On failure or plan exhaustion the director
// replans from scratch.
//
// Interrupts (morale panic, low HP, grenade) are checked every tick
// and can abort the current action to transition to a built-in FSM state.

import type { IOnlineStateHandler } from '../states/IOnlineStateHandler';
import type { INPCContext } from '../states/INPCContext';
import type { WorldState } from '@alife-sdk/core';

/**
 * Minimal planner interface — accepts any object with a `plan()` method.
 * This allows passing a GOAPPlanner instance, a dynamic wrapper, or a mock.
 */
export interface IGOAPPlannerLike {
  plan(worldState: WorldState, goal: WorldState): Array<{ id: string }> | null;
}

/**
 * Handler for a single GOAP action execution.
 *
 * Stateless — per-NPC data should be stored in `ctx.state.custom`.
 * Return 'running' to continue, 'success' to advance, 'failure' to replan.
 */
export interface IGOAPActionHandler {
  /** Called when this action starts executing. */
  enter(ctx: INPCContext): void;
  /** Called each frame. */
  update(ctx: INPCContext, deltaMs: number): 'running' | 'success' | 'failure';
  /** Called when action completes or is interrupted. */
  exit(ctx: INPCContext): void;
}

/**
 * Interrupt condition — checked every tick before action execution.
 * If condition returns true, the director transitions to targetState.
 */
export interface IGOAPInterrupt {
  readonly condition: (ctx: INPCContext) => boolean;
  readonly targetState: string;
}

/**
 * Configuration for the GOAP Director.
 */
export interface IGOAPDirectorConfig {
  /** Build a WorldState snapshot from the current NPC context. */
  buildWorldState: (ctx: INPCContext) => WorldState;
  /** The goal to achieve. */
  goal: WorldState;
  /** Map GOAP action ID to handler. Unmatched actions are skipped. */
  actionHandlers: Record<string, IGOAPActionHandler>;
  /** Interrupt conditions checked every tick (evaluated in order). */
  interrupts?: IGOAPInterrupt[];
  /** Called when the plan is empty or exhausted (optional fallback). */
  onNoPlan?: (ctx: INPCContext, deltaMs: number) => void;
  /**
   * Optional: if provided, called every tick with the current WorldState.
   * Return true to force an immediate replan (aborts current action).
   * Use this to react to significant state changes mid-plan (e.g., HP drop,
   * new enemy spotted, ally died).
   */
  shouldReplan?: (ctx: INPCContext, currentWorldState: WorldState) => boolean;
}

// Custom state keys used by the director (stored in ctx.state.custom).
const GOAP_PLAN_KEY        = '__goapPlan';
const GOAP_INDEX_KEY       = '__goapIndex';
const GOAP_HANDLER_KEY     = '__goapActiveHandler';
const GOAP_EMPTY_COUNT_KEY = '__goapEmptyCount';

/**
 * Built-in GOAP Director — register as the COMBAT handler.
 *
 * On enter: replans via the provided planner + buildWorldState.
 * Each tick: checks interrupts, then ticks the active action handler.
 * On action success: advances to next action.
 * On action failure or plan exhaustion: replans.
 *
 * @example
 * ```ts
 * const director = new GOAPDirector(planner, {
 *   buildWorldState: (ctx) => WorldState.from({ ... }),
 *   goal: WorldState.from({ targetEliminated: true }),
 *   actionHandlers: {
 *     TakeCover: { enter(ctx) { ... }, update(ctx, dt) { return 'running'; }, exit(ctx) {} },
 *     Attack:    { enter(ctx) { ... }, update(ctx, dt) { return 'success'; }, exit(ctx) {} },
 *   },
 *   interrupts: [
 *     { condition: ctx => ctx.state.moraleState === 'PANICKED', targetState: 'FLEE' },
 *   ],
 * });
 * handlers.register('COMBAT', director);
 * ```
 */
export class GOAPDirector implements IOnlineStateHandler {
  constructor(
    private readonly planner: IGOAPPlannerLike,
    private readonly config: IGOAPDirectorConfig,
  ) {}

  enter(ctx: INPCContext): void {
    this._replan(ctx);
  }

  update(ctx: INPCContext, deltaMs: number): void {
    // 1. Check interrupts (highest priority).
    if (this.config.interrupts) {
      for (const interrupt of this.config.interrupts) {
        if (interrupt.condition(ctx)) {
          this._exitCurrentAction(ctx);
          ctx.transition(interrupt.targetState);
          return;
        }
      }
    }

    // 2. Check if world state changed enough to warrant replanning.
    if (this.config.shouldReplan) {
      const ws = this.config.buildWorldState(ctx);
      if (this.config.shouldReplan(ctx, ws)) {
        this._exitCurrentAction(ctx);
        this._replan(ctx);
      }
    }

    // 3. Get current plan and action.
    const plan = this._read(ctx, GOAP_PLAN_KEY) as Array<{ id: string }> | undefined;
    const index = (this._read(ctx, GOAP_INDEX_KEY) as number | undefined) ?? 0;

    if (!plan || index >= plan.length) {
      if (this.config.onNoPlan) {
        this.config.onNoPlan(ctx, deltaMs);
      }
      return;
    }

    // 4. Get or enter the action handler.
    const action = plan[index];
    const handler = this.config.actionHandlers[action.id];
    if (!handler) {
      this._advanceAction(ctx);
      return;
    }

    const activeHandlerId = this._read(ctx, GOAP_HANDLER_KEY) as string | undefined;
    if (activeHandlerId !== action.id) {
      if (activeHandlerId) {
        const prevHandler = this.config.actionHandlers[activeHandlerId];
        prevHandler?.exit(ctx);
      }
      handler.enter(ctx);
      this._write(ctx, GOAP_HANDLER_KEY, action.id);
    }

    // 5. Tick the action handler.
    const result = handler.update(ctx, deltaMs);

    if (result === 'success') {
      handler.exit(ctx);
      this._write(ctx, GOAP_HANDLER_KEY, undefined);
      this._advanceAction(ctx);
    } else if (result === 'failure') {
      handler.exit(ctx);
      this._write(ctx, GOAP_HANDLER_KEY, undefined);
      this._replan(ctx);
    }
  }

  exit(ctx: INPCContext): void {
    this._exitCurrentAction(ctx);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /** Read a GOAP key from ctx.state.custom (always fresh, never cached). */
  private _read(ctx: INPCContext, key: string): unknown {
    return (ctx.state.custom ?? {})[key];
  }

  /** Write a single GOAP key to ctx.state.custom (always fresh, never cached). */
  private _write(ctx: INPCContext, key: string, value: unknown): void {
    ctx.state.custom = { ...(ctx.state.custom ?? {}), [key]: value };
  }

  private _replan(ctx: INPCContext): void {
    const ws = this.config.buildWorldState(ctx);
    const plan = this.planner.plan(ws, this.config.goal);

    const resultPlan = plan ?? [];
    let emptyCount = (this._read(ctx, GOAP_EMPTY_COUNT_KEY) as number) ?? 0;
    emptyCount = resultPlan.length === 0 ? emptyCount + 1 : 0;

    this._write(ctx, GOAP_PLAN_KEY, resultPlan);
    this._write(ctx, GOAP_INDEX_KEY, 0);
    this._write(ctx, GOAP_HANDLER_KEY, undefined);
    this._write(ctx, GOAP_EMPTY_COUNT_KEY, emptyCount);
  }

  private _advanceAction(ctx: INPCContext): void {
    const index = ((this._read(ctx, GOAP_INDEX_KEY) as number) ?? 0) + 1;
    const plan = this._read(ctx, GOAP_PLAN_KEY) as Array<{ id: string }> | undefined;

    this._write(ctx, GOAP_INDEX_KEY, index);

    if (!plan || index >= plan.length) {
      const emptyCount = (this._read(ctx, GOAP_EMPTY_COUNT_KEY) as number) ?? 0;
      if (emptyCount < 3) {
        this._replan(ctx);
      }
    }
  }

  private _exitCurrentAction(ctx: INPCContext): void {
    const activeId = this._read(ctx, GOAP_HANDLER_KEY) as string | undefined;
    if (activeId) {
      this.config.actionHandlers[activeId]?.exit(ctx);
      this._write(ctx, GOAP_HANDLER_KEY, undefined);
    }
  }
}
