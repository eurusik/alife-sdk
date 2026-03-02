// states/handlers/ChargeState.ts
// Boar exclusive straight-line charge attack state.
//
// Phase pipeline (stored in ctx.state.chargePhase):
//   WINDUP  — entity stops during telegraph pause; counts down chargeWindupMs.
//             Target position is locked at enter() time.
//   CHARGE  — entity moves toward stored target at approachSpeed × chargeSpeedMultiplier.
//             Impact: dist <= meleeRange → emitMeleeHit(chargeDamageMultiplier), then COMBAT.
//   Exit    — resets active flag; host caller may also halt movement.
//
// Early abort:
//   - Windup phase with no visible enemy → transition to IDLE (tr.chargeOnAbort).
//
// All mutable state lives in INPCOnlineState.chargePhase so this handler is
// stateless and safe to share across all NPC entities.

import type { IOnlineStateHandler } from '../IOnlineStateHandler';
import type { INPCContext } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';
import type { IStateTransitionMap } from '../IStateTransitionMap';
import { createDefaultTransitionMap } from '../IStateTransitionMap';
import { moveToward, distanceTo } from './_utils';

/**
 * Stateless boar charge-attack handler.
 *
 * A single instance can be shared across all NPC entities.
 */
export class ChargeState implements IOnlineStateHandler {
  private readonly tr: IStateTransitionMap;

  constructor(
    private readonly cfg: IStateConfig,
    tr?: Partial<IStateTransitionMap>,
  ) {
    this.tr = createDefaultTransitionMap(tr);
  }

  enter(ctx: INPCContext): void {
    const now = ctx.now();

    // Lock the target position from the first visible enemy or last known pos.
    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    const targetX = enemies.length > 0 ? enemies[0].x : ctx.state.lastKnownEnemyX;
    const targetY = enemies.length > 0 ? enemies[0].y : ctx.state.lastKnownEnemyY;

    // Lazy-initialise charge phase data if not yet present.
    ctx.state.chargePhase ??= { active: false, windupStartMs: 0, charging: false, targetX: 0, targetY: 0 };
    ctx.state.chargePhase.active = true;
    ctx.state.chargePhase.charging = false;
    ctx.state.chargePhase.windupStartMs = now;
    ctx.state.chargePhase.targetX = targetX;
    ctx.state.chargePhase.targetY = targetY;

    // Stop completely during the windup telegraph.
    ctx.halt();

    // Face the target while winding up.
    const dx = targetX - ctx.x;
    const dy = targetY - ctx.y;
    if (dx !== 0 || dy !== 0) {
      ctx.setRotation(Math.atan2(dy, dx));
    }
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    const now = ctx.now();
    const phase = ctx.state.chargePhase;
    const elapsed = now - phase!.windupStartMs;

    if (!phase!.charging) {
      // -----------------------------------------------------------------------
      // WINDUP phase — wait for chargeWindupMs before launching charge
      // -----------------------------------------------------------------------

      // Safety: if no visible enemy and not yet charging, abort.
      const hasEnemy = ctx.perception?.hasVisibleEnemy() ?? false;
      if (!hasEnemy) {
        ctx.transition(this.tr.chargeOnAbort);
        return;
      }

      if (elapsed < this.cfg.chargeWindupMs) {
        // Still winding up — face target but don't move.
        const dx = phase!.targetX - ctx.x;
        const dy = phase!.targetY - ctx.y;
        if (dx !== 0 || dy !== 0) {
          ctx.setRotation(Math.atan2(dy, dx));
        }
        return;
      }

      // Windup complete — transition to charging phase.
      phase!.charging = true;
    }

    // -----------------------------------------------------------------------
    // CHARGING phase — move toward locked target at charge speed
    // -----------------------------------------------------------------------
    const chargeSpeed = this.cfg.approachSpeed * this.cfg.chargeSpeedMultiplier;
    const dist = distanceTo(ctx.x, ctx.y, phase!.targetX, phase!.targetY);

    if (dist <= this.cfg.meleeRange) {
      // Impact — apply charge damage and return to COMBAT.
      ctx.state.lastMeleeMs = now;
      ctx.emitMeleeHit({
        npcId: ctx.npcId,
        targetId: ctx.state.targetId ?? '',
        damage: this.cfg.meleeDamage * this.cfg.chargeDamageMultiplier,
      });
      ctx.halt();
      ctx.transition(this.tr.chargeOnComplete);
      return;
    }

    // Continue charging toward the locked target.
    moveToward(ctx, phase!.targetX, phase!.targetY, chargeSpeed);
  }

  exit(ctx: INPCContext): void {
    if (ctx.state.chargePhase) {
      ctx.state.chargePhase.active = false;
    }
  }
}
