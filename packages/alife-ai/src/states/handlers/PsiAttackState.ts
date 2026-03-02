// states/handlers/PsiAttackState.ts
// Controller PSI ranged channeled attack state.
//
// Phase pipeline (stored in ctx.state.psiPhase):
//   CHANNEL — Controller stands still; emitPsiAttackStart() fires on enter for
//             VFX/audio. Counts down psiChannelMs.
//             Once complete: emit PSI damage via emitMeleeHit (weaponType-agnostic),
//             then transition (tr.psiOnComplete).
//
// Early abort:
//   - No visible enemy during channel → transition (tr.psiOnNoEnemy).
//
// All mutable state lives in INPCOnlineState.psiPhase so this handler is
// stateless and safe to share across all NPC entities.

import type { IOnlineStateHandler } from '../IOnlineStateHandler';
import type { INPCContext } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';
import type { IStateTransitionMap } from '../IStateTransitionMap';
import { createDefaultTransitionMap } from '../IStateTransitionMap';

/**
 * Stateless Controller PSI attack handler.
 *
 * A single instance can be shared across all NPC entities.
 */
export class PsiAttackState implements IOnlineStateHandler {
  private readonly tr: IStateTransitionMap;

  constructor(
    private readonly cfg: IStateConfig,
    tr?: Partial<IStateTransitionMap>,
  ) {
    this.tr = createDefaultTransitionMap(tr);
  }

  enter(ctx: INPCContext): void {
    const now = ctx.now();

    // Update last known target position before channeling begins.
    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    if (enemies.length > 0) {
      ctx.state.lastKnownEnemyX = enemies[0].x;
      ctx.state.lastKnownEnemyY = enemies[0].y;
      ctx.state.targetId = enemies[0].id;
    }

    // Lazy-initialise PSI phase data if not yet present.
    ctx.state.psiPhase ??= { active: false, channelStartMs: 0 };
    ctx.state.psiPhase.active = true;
    ctx.state.psiPhase.channelStartMs = now;

    // Stand still while channeling.
    ctx.halt();

    // Face the target.
    const dx = ctx.state.lastKnownEnemyX - ctx.x;
    const dy = ctx.state.lastKnownEnemyY - ctx.y;
    if (dx !== 0 || dy !== 0) {
      ctx.setRotation(Math.atan2(dy, dx));
    }

    // Notify VFX/audio systems that PSI channel has begun.
    ctx.emitPsiAttackStart(ctx.x, ctx.y);
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    const now = ctx.now();

    // -----------------------------------------------------------------------
    // Abort: no visible enemy → psiOnNoEnemy
    // -----------------------------------------------------------------------
    const hasEnemy = ctx.perception?.hasVisibleEnemy() ?? false;
    if (!hasEnemy) {
      ctx.transition(this.tr.psiOnNoEnemy);
      return;
    }

    // Refresh target position each frame during the channel.
    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    if (enemies.length > 0) {
      ctx.state.lastKnownEnemyX = enemies[0].x;
      ctx.state.lastKnownEnemyY = enemies[0].y;
      ctx.state.targetId = enemies[0].id;
    }

    // -----------------------------------------------------------------------
    // CHANNEL phase — stay still, face target, count down psiChannelMs
    // -----------------------------------------------------------------------
    const elapsed = now - ctx.state.psiPhase!.channelStartMs;

    // Face the target while channeling.
    const dx = ctx.state.lastKnownEnemyX - ctx.x;
    const dy = ctx.state.lastKnownEnemyY - ctx.y;
    if (dx !== 0 || dy !== 0) {
      ctx.setRotation(Math.atan2(dy, dx));
    }

    // Ensure NPC stays still during channel.
    ctx.halt();

    if (elapsed < this.cfg.psiChannelMs) {
      // Still channeling.
      return;
    }

    // -----------------------------------------------------------------------
    // Channel complete — emit PSI damage and transition
    // -----------------------------------------------------------------------
    ctx.state.lastMeleeMs = now;
    ctx.emitMeleeHit({
      npcId: ctx.npcId,
      targetId: ctx.state.targetId ?? '',
      damage: this.cfg.meleeDamage,
    });

    ctx.transition(this.tr.psiOnComplete);
  }

  exit(ctx: INPCContext): void {
    if (ctx.state.psiPhase) {
      ctx.state.psiPhase.active = false;
    }
  }
}
