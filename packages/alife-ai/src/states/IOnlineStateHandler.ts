// states/IOnlineStateHandler.ts
// Contract for all online NPC state handlers.
//
// All state handlers must be stateless singletons — per-NPC runtime state
// lives in INPCContext.state (INPCOnlineState), NOT in the handler itself.
// This allows a single handler instance to be shared across all NPC instances.
//
// Lifecycle per active state:
//   1. enter(ctx)          — called once when the FSM transitions into this state.
//   2. update(ctx, deltaMs) — called every frame while this state is active.
//   3. exit(ctx)           — called once when the FSM transitions out of this state.

import type { INPCContext } from './INPCContext';

/**
 * Contract for all online NPC AI state handlers.
 *
 * Handlers are stateless — all mutable per-NPC data must be read from and
 * written to {@link INPCContext.state}. This ensures a single handler
 * instance can safely drive any number of simultaneous NPC entities.
 *
 * @example
 * ```ts
 * export class IdleStateHandler implements IOnlineStateHandler {
 *   enter(ctx: INPCContext): void {
 *     ctx.halt();
 *   }
 *
 *   update(ctx: INPCContext, deltaMs: number): void {
 *     if (ctx.perception?.hasVisibleEnemy()) {
 *       ctx.transition('COMBAT');
 *     }
 *   }
 *
 *   exit(_ctx: INPCContext): void {
 *     // nothing
 *   }
 * }
 * ```
 */
export interface IOnlineStateHandler {
  /**
   * Called once when the FSM transitions into this state.
   *
   * Use to reset per-NPC timers, set initial velocities, emit entry
   * vocalizations, etc.
   *
   * @param ctx - The NPC context for the entering entity.
   */
  enter(ctx: INPCContext): void;

  /**
   * Called every frame while this state is active.
   *
   * Contains the main per-frame logic: perception checks, movement commands,
   * combat calculations, and transition triggers.
   *
   * @param ctx     - The NPC context for the updating entity.
   * @param deltaMs - Elapsed time since the last frame (milliseconds).
   */
  update(ctx: INPCContext, deltaMs: number): void;

  /**
   * Called once when the FSM transitions out of this state.
   *
   * Use to clean up any per-NPC flags or release resources (e.g. halt movement,
   * clear loophole state, reset animation overrides).
   *
   * @param ctx - The NPC context for the exiting entity.
   */
  exit(ctx: INPCContext): void;
}
