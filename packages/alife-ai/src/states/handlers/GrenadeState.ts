// states/handlers/GrenadeState.ts
// NPC throws a grenade at the last known enemy position.
//
// enter:  record grenadeThrowStartMs = ctx.now()
// update:
//   - if grenadeCount <= 0 → transition 'COMBAT' immediately
//   - if elapsed >= grenadeWindupMs:
//       emit shoot (weaponType: 'GRENADE'), decrement grenadeCount,
//       record lastGrenadeMs, transition 'COMBAT'
//   - during windup: halt movement, face last known enemy
// exit:   nothing

import type { IOnlineStateHandler } from '../IOnlineStateHandler';
import type { INPCContext } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';
import { createDefaultTransitionMap } from '../IStateTransitionMap';
import type { IStateTransitionMap } from '../IStateTransitionMap';

/**
 * Stateless grenade-throw state handler.
 *
 * A single instance can be shared across all NPC entities.
 */
export class GrenadeState implements IOnlineStateHandler {
  private readonly cfg: IStateConfig;
  private readonly tr: IStateTransitionMap;

  constructor(cfg: IStateConfig, tr?: Partial<IStateTransitionMap>) {
    this.cfg = cfg;
    this.tr = createDefaultTransitionMap(tr);
  }

  enter(ctx: INPCContext): void {
    ctx.state.grenadeThrowStartMs = ctx.now();
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    // Abort immediately if no grenades are available.
    if (ctx.state.grenadeCount <= 0) {
      ctx.transition(this.tr.grenadeOnNoAmmo);
      return;
    }

    const now = ctx.now();
    const elapsed = now - ctx.state.grenadeThrowStartMs;

    if (elapsed >= this.cfg.grenadeWindupMs) {
      // Throw the grenade — emit shoot event with GRENADE weapon type.
      ctx.emitShoot({
        npcId: ctx.npcId,
        x: ctx.x,
        y: ctx.y,
        targetX: ctx.state.lastKnownEnemyX,
        targetY: ctx.state.lastKnownEnemyY,
        weaponType: 'GRENADE',
      });

      ctx.state.grenadeCount--;
      ctx.state.lastGrenadeMs = now;
      ctx.transition(this.tr.grenadeOnComplete);
      return;
    }

    // Still in wind-up: halt and face the last known enemy position.
    ctx.halt();
    const dx = ctx.state.lastKnownEnemyX - ctx.x;
    const dy = ctx.state.lastKnownEnemyY - ctx.y;
    if (dx !== 0 || dy !== 0) {
      ctx.setRotation(Math.atan2(dy, dx));
    }
  }

  exit(_ctx: INPCContext): void {
    // Nothing to clean up.
  }
}
