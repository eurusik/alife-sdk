// states/handlers/LeapState.ts
// Snork jump-attack state — winds up then arcs through the air to land on target.
//
// Phase pipeline (stored in ctx.state.leapPhase):
//   WINDUP   — entity stops; counts down leapWindupMs; records start + target positions.
//   AIRBORNE — entity position is teleported (lerped) from start → target over leapAirtimeMs.
//              ctx.teleport() sets position directly to bypass normal velocity physics.
//              airborne flag is set true once this phase begins.
//   LAND     — when airtime has fully elapsed: emitMeleeHit + transition (tr.leapOnLand).
//
// All mutable state lives in INPCOnlineState.leapPhase so this handler is
// stateless and safe to share across all NPC entities.

import type { IOnlineStateHandler } from '../IOnlineStateHandler';
import type { INPCContext } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';
import type { IStateTransitionMap } from '../IStateTransitionMap';
import { createDefaultTransitionMap } from '../IStateTransitionMap';

/**
 * Stateless snork leap-attack handler.
 *
 * A single instance can be shared across all NPC entities.
 */
export class LeapState implements IOnlineStateHandler {
  private readonly tr: IStateTransitionMap;

  constructor(
    private readonly cfg: IStateConfig,
    tr?: Partial<IStateTransitionMap>,
  ) {
    this.tr = createDefaultTransitionMap(tr);
  }

  enter(ctx: INPCContext): void {
    const now = ctx.now();

    // Lock target from first visible enemy or last known position.
    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    const targetX = enemies.length > 0 ? enemies[0].x : ctx.state.lastKnownEnemyX;
    const targetY = enemies.length > 0 ? enemies[0].y : ctx.state.lastKnownEnemyY;

    if (enemies.length > 0) {
      ctx.state.lastKnownEnemyX = enemies[0].x;
      ctx.state.lastKnownEnemyY = enemies[0].y;
      ctx.state.targetId = enemies[0].id;
    }

    // Lazy-initialise leap phase data if not yet present.
    ctx.state.leapPhase ??= { active: false, windupStartMs: 0, airborne: false, startX: 0, startY: 0, targetX: 0, targetY: 0, airStartMs: 0 };
    ctx.state.leapPhase.active = true;
    ctx.state.leapPhase.airborne = false;
    ctx.state.leapPhase.windupStartMs = now;
    ctx.state.leapPhase.airStartMs = 0;
    ctx.state.leapPhase.startX = ctx.x;
    ctx.state.leapPhase.startY = ctx.y;
    ctx.state.leapPhase.targetX = targetX;
    ctx.state.leapPhase.targetY = targetY;

    // Stop and crouch during windup.
    ctx.halt();

    // Face target during windup telegraph.
    const dx = targetX - ctx.x;
    const dy = targetY - ctx.y;
    if (dx !== 0 || dy !== 0) {
      ctx.setRotation(Math.atan2(dy, dx));
    }
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    const now = ctx.now();
    const phase = ctx.state.leapPhase!;

    if (!phase.airborne) {
      // -----------------------------------------------------------------------
      // WINDUP phase — wait for leapWindupMs before launching leap
      // -----------------------------------------------------------------------
      const windupElapsed = now - phase.windupStartMs;

      if (windupElapsed < this.cfg.leapWindupMs) {
        // Still winding up — face target but don't move.
        const dx = phase.targetX - ctx.x;
        const dy = phase.targetY - ctx.y;
        if (dx !== 0 || dy !== 0) {
          ctx.setRotation(Math.atan2(dy, dx));
        }
        return;
      }

      // Windup complete — begin airborne phase.
      phase.airborne = true;
      phase.airStartMs = now;
    }

    // -----------------------------------------------------------------------
    // AIRBORNE phase — lerp position from start → target over leapAirtimeMs
    // -----------------------------------------------------------------------
    const airElapsed = now - phase.airStartMs;

    if (airElapsed < this.cfg.leapAirtimeMs) {
      // Lerp progress in [0, 1]; clamped so we never overshoot.
      const progress = Math.min(1, airElapsed / this.cfg.leapAirtimeMs);
      const lerpX = phase.startX + (phase.targetX - phase.startX) * progress;
      const lerpY = phase.startY + (phase.targetY - phase.startY) * progress;

      // Teleport sets world position directly — bypasses arcade velocity so
      // the entity "flies" through the air ignoring normal collision response.
      ctx.teleport(lerpX, lerpY);

      // Face direction of travel during flight.
      const dx = phase.targetX - lerpX;
      const dy = phase.targetY - lerpY;
      if (dx !== 0 || dy !== 0) {
        ctx.setRotation(Math.atan2(dy, dx));
      }
      return;
    }

    // -----------------------------------------------------------------------
    // LAND — airtime elapsed: snap to target, apply damage, return to COMBAT
    // -----------------------------------------------------------------------
    ctx.teleport(phase.targetX, phase.targetY);
    ctx.halt();

    ctx.state.lastMeleeMs = now;
    ctx.emitMeleeHit({
      npcId: ctx.npcId,
      targetId: ctx.state.targetId ?? '',
      damage: this.cfg.meleeDamage,
    });

    ctx.transition(this.tr.leapOnLand);
  }

  exit(ctx: INPCContext): void {
    if (ctx.state.leapPhase) {
      ctx.state.leapPhase.active = false;
    }
  }
}
