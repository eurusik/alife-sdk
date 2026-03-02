// states/handlers/DeadState.ts
// Terminal state — the NPC is dead.
//
// enter()  — halts velocity and disables the physics body so the corpse no
//             longer participates in collisions.
// update() — deliberate no-op: the entity will be cleaned up by the host.
//             Any AI tick that reaches a dead NPC is silently swallowed.
// exit()   — safety no-op; the FSM should never leave DEAD under normal
//             operation, but implementations are allowed to resurrect NPCs.

import type { IOnlineStateHandler } from '../IOnlineStateHandler';
import type { INPCContext } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';
import type { IStateTransitionMap } from '../IStateTransitionMap';

/**
 * Stateless dead-state handler.
 *
 * A single instance can be shared across all NPC entities.
 */
export class DeadState implements IOnlineStateHandler {
  // IStateConfig and IStateTransitionMap are accepted but not used in this
  // terminal state — kept for constructor signature consistency with all other
  // handlers.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_cfg: IStateConfig, _tr?: Partial<IStateTransitionMap>) {}

  enter(ctx: INPCContext): void {
    ctx.halt();
    ctx.disablePhysics();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  update(_ctx: INPCContext, _deltaMs: number): void {
    // Intentional no-op — dead entities do nothing each frame.
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  exit(_ctx: INPCContext): void {
    // The FSM should not exit DEAD under normal operation.
    // No cleanup required — this is a safety no-op.
  }
}
