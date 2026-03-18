
import type { IOnlineStateHandler }    from '../IOnlineStateHandler';
import type { INPCContext }            from '../INPCContext';
import type { IStateConfig }           from '../IStateConfig';
import { createDefaultTransitionMap }  from '../IStateTransitionMap';
import type { IStateTransitionMap }    from '../IStateTransitionMap';
import { moveToward }                  from './_utils';

/**
 * Stateless five-phase kill-wounded handler (X-Ray 16 `stalker_kill_wounded` equivalent).
 *
 * A single instance can be shared across all NPC entities.
 *
 * Opt-in activation (add to the handler registry):
 * ```ts
 * const handlers = buildDefaultHandlerMap(cfg, {
 *   combatOnKillWounded: 'KILL_WOUNDED',
 *   alertOnKillWounded:  'KILL_WOUNDED',
 * });
 * handlers.register('KILL_WOUNDED', new KillWoundedState(cfg));
 * ```
 */
export class KillWoundedState implements IOnlineStateHandler {
  private readonly cfg: IStateConfig;
  private readonly tr:  IStateTransitionMap;

  constructor(cfg: IStateConfig, tr?: Partial<IStateTransitionMap>) {
    this.cfg = cfg;
    this.tr  = createDefaultTransitionMap(tr);
  }

  enter(ctx: INPCContext): void {
    ctx.state.killWoundedStartMs       = ctx.now();
    ctx.state.killWoundedAimStartMs    = -1;
    ctx.state.killWoundedTauntStartMs  = -1;
    ctx.state.killWoundedExecuteStartMs = -1;
    ctx.state.killWoundedShotsFired    = 0;
    ctx.state.killWoundedPauseStartMs  = -1;
    ctx.halt();
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    const now = ctx.now();

    // ── Priority: panic → flee ───────────────────────────────────────────────
    if (ctx.state.moraleState === 'PANICKED') {
      ctx.halt();
      ctx.transition(this.tr.killWoundedOnPanic);
      return;
    }

    // ── PAUSE phase ───────────────────────────────────────────────────────────
    if (ctx.state.killWoundedPauseStartMs >= 0) {
      ctx.halt();
      if (now - ctx.state.killWoundedPauseStartMs >= this.cfg.killWoundedPauseMs) {
        if (ctx.perception?.hasVisibleEnemy()) {
          ctx.transition(this.tr.killWoundedOnComplete);   // new threat → COMBAT
        } else if (ctx.state.lastKnownEnemyX !== 0 || ctx.state.lastKnownEnemyY !== 0) {
          ctx.transition(this.tr.killWoundedOnNoTarget);   // last position known → SEARCH
        } else {
          ctx.transition(this.tr.killWoundedOnComplete);   // nothing → COMBAT fallback
        }
      }
      return;
    }

    // ── EXECUTE phase ─────────────────────────────────────────────────────────
    if (ctx.state.killWoundedExecuteStartMs >= 0) {
      ctx.halt();
      // Refresh target position — wounded enemy may have crawled since AIM began
      const execTarget = ctx.perception?.getWoundedEnemies?.()
        ?.find(e => e.id === ctx.state.killWoundedTargetId);
      if (execTarget) {
        ctx.state.killWoundedTargetX = execTarget.x;
        ctx.state.killWoundedTargetY = execTarget.y;
      }
      ctx.setRotation(Math.atan2(
        ctx.state.killWoundedTargetY - ctx.y,
        ctx.state.killWoundedTargetX - ctx.x,
      ));

      if (ctx.state.killWoundedShotsFired >= this.cfg.killWoundedBurstCount) {
        // All shots fired → move to pause
        ctx.state.killWoundedPauseStartMs = now;
        return;
      }

      // Fire next shot when cooldown elapsed
      if (now - ctx.state.lastShootMs >= this.cfg.fireRateMs) {
        ctx.state.lastShootMs = now;
        ctx.state.killWoundedShotsFired++;
        ctx.emitShoot({
          npcId:    ctx.npcId,
          x:        ctx.x,
          y:        ctx.y,
          targetX:  ctx.state.killWoundedTargetX,
          targetY:  ctx.state.killWoundedTargetY,
          weaponType: ctx.state.primaryWeapon ?? 'pistol',
        });
      }
      return;
    }

    // ── TAUNT phase ───────────────────────────────────────────────────────────
    if (ctx.state.killWoundedTauntStartMs >= 0) {
      ctx.halt();
      if (now - ctx.state.killWoundedTauntStartMs >= this.cfg.killWoundedTauntMs) {
        ctx.state.killWoundedExecuteStartMs = now;
        ctx.state.killWoundedShotsFired     = 0;
      }
      return;
    }

    // ── AIM phase ─────────────────────────────────────────────────────────────
    if (ctx.state.killWoundedAimStartMs >= 0) {
      ctx.halt();
      // Refresh target position — wounded enemy may crawl during the aim wind-up
      const aimTarget = ctx.perception?.getWoundedEnemies?.()
        ?.find(e => e.id === ctx.state.killWoundedTargetId);
      if (aimTarget) {
        ctx.state.killWoundedTargetX = aimTarget.x;
        ctx.state.killWoundedTargetY = aimTarget.y;
      }
      ctx.setRotation(Math.atan2(
        ctx.state.killWoundedTargetY - ctx.y,
        ctx.state.killWoundedTargetX - ctx.x,
      ));
      if (now - ctx.state.killWoundedAimStartMs >= this.cfg.killWoundedAimMs) {
        ctx.emitVocalization('KILL_WOUNDED_TAUNT');
        ctx.state.killWoundedTauntStartMs = now;
      }
      return;
    }

    // ── APPROACH phase ────────────────────────────────────────────────────────

    // Overall approach timeout
    if (now - ctx.state.killWoundedStartMs >= this.cfg.killWoundedMaxApproachMs) {
      ctx.halt();
      ctx.transition(this.tr.killWoundedOnTimeout);
      return;
    }

    // Refresh target position from live perception
    const woundedEnemies = ctx.perception?.getWoundedEnemies?.() ?? [];
    const target = woundedEnemies.find(e => e.id === ctx.state.killWoundedTargetId) ?? null;

    if (!target) {
      // Target healed, died, or left perception range
      ctx.halt();
      if (ctx.perception?.hasVisibleEnemy()) {
        ctx.transition(this.tr.killWoundedOnComplete);   // still enemies → COMBAT
      } else {
        ctx.transition(this.tr.killWoundedOnNoTarget);   // no one → SEARCH
      }
      return;
    }

    // Keep destination current (wounded enemy may crawl)
    ctx.state.killWoundedTargetX = target.x;
    ctx.state.killWoundedTargetY = target.y;

    // Arrival check → begin AIM
    const dx     = target.x - ctx.x;
    const dy     = target.y - ctx.y;
    const distSq = dx * dx + dy * dy;
    const range  = this.cfg.killWoundedExecuteRange;

    if (distSq <= range * range) {
      ctx.halt();
      ctx.state.killWoundedAimStartMs = now;
      return;
    }

    moveToward(ctx, target.x, target.y, this.cfg.approachSpeed);
  }

  exit(ctx: INPCContext): void {
    ctx.state.killWoundedTargetId        = null;
    ctx.state.killWoundedStartMs         = 0;
    ctx.state.killWoundedAimStartMs      = -1;
    ctx.state.killWoundedTauntStartMs    = -1;
    ctx.state.killWoundedExecuteStartMs  = -1;
    ctx.state.killWoundedShotsFired      = 0;
    ctx.state.killWoundedPauseStartMs    = -1;
    ctx.state.killWoundedTargetX         = 0;
    ctx.state.killWoundedTargetY         = 0;
    ctx.halt();
  }
}
