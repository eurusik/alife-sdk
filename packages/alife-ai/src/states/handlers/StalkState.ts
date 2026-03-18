// states/handlers/StalkState.ts
// Bloodsucker near-invisibility approach state.
//
// Phase pipeline (stored in ctx.state.stalkPhase):
//   APPROACH  — entity alpha drops to stalkAlphaInvisible; moves toward enemy
//               at approachSpeed × stalkSpeedMultiplier. Transitions to uncloak
//               when distance < stalkUncloakDistance.
//   UNCLOAK   — alpha restored to 1.0, then transition to COMBAT for the melee strike.
//
// exit() always restores full alpha (1.0) so the bloodsucker is never permanently
// invisible if the state is interrupted (e.g. takes damage → COMBAT).
//
// All mutable state lives in INPCOnlineState.stalkPhase so this handler is
// stateless and safe to share across all NPC entities.

import type { IOnlineStateHandler } from '../IOnlineStateHandler';
import type { INPCContext } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';
import type { IStateTransitionMap } from '../IStateTransitionMap';
import { createDefaultTransitionMap } from '../IStateTransitionMap';
import { moveToward, distanceTo } from './_utils';

/**
 * Stateless bloodsucker stalk-approach handler.
 *
 * A single instance can be shared across all NPC entities.
 */
export class StalkState implements IOnlineStateHandler {
  private readonly tr: IStateTransitionMap;

  constructor(
    private readonly cfg: IStateConfig,
    tr?: Partial<IStateTransitionMap>,
  ) {
    this.tr = createDefaultTransitionMap(tr);
  }

  enter(ctx: INPCContext): void {
    // Go invisible immediately on enter.
    ctx.setAlpha(this.cfg.stalkAlphaInvisible);

    // Lazy-initialise stalk phase data if not yet present.
    ctx.state.stalkPhase ??= { active: false, approaching: false };
    ctx.state.stalkPhase.active = true;
    ctx.state.stalkPhase.approaching = false;
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    // -----------------------------------------------------------------------
    // No visible enemy during stalk → transition to SEARCH
    // -----------------------------------------------------------------------
    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    const hasEnemy = enemies.length > 0;

    if (!hasEnemy) {
      ctx.transition(this.tr.stalkOnNoEnemy);
      return;
    }

    // Update last known position.
    const enemy = enemies[0];
    ctx.state.lastKnownEnemyX = enemy.x;
    ctx.state.lastKnownEnemyY = enemy.y;
    ctx.state.targetId = enemy.id;

    const dist = distanceTo(ctx.x, ctx.y, enemy.x, enemy.y);

    // -----------------------------------------------------------------------
    // APPROACH phase — close distance invisibly
    // -----------------------------------------------------------------------
    if (!ctx.state.stalkPhase!.approaching) {
      if (dist <= this.cfg.stalkUncloakDistance) {
        // Close enough — flag as approaching (uncloak next frame).
        ctx.state.stalkPhase!.approaching = true;
        return;
      }

      // Move toward enemy at reduced stalk speed.
      const stalkSpeed = this.cfg.approachSpeed * this.cfg.stalkSpeedMultiplier;
      moveToward(ctx, enemy.x, enemy.y, stalkSpeed);
      return;
    }

    // -----------------------------------------------------------------------
    // UNCLOAK phase — restore alpha and attack
    // -----------------------------------------------------------------------
    ctx.setAlpha(1.0);
    ctx.halt();
    ctx.transition(this.tr.stalkOnAttack);
  }

  exit(ctx: INPCContext): void {
    // Always restore full visibility on exit — prevents permanent invisibility
    // if the state is interrupted by damage or an external transition.
    ctx.setAlpha(1.0);
    if (ctx.state.stalkPhase) {
      ctx.state.stalkPhase.active = false;
    }
  }
}
