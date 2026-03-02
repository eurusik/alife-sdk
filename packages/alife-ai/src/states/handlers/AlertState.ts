// states/handlers/AlertState.ts
// NPC heard something (gunshot, sound) and investigates the source.
// Upgrades to COMBAT when the enemy is directly spotted; reverts to PATROL
// if the alert timer expires without finding anyone.
//
// Morale-aware:
//   - PANICKED NPC → skip investigation, flee immediately (FLEE).
//
// Transitions out of ALERT:
//   - morale is PANICKED                        → FLEE
//   - visible enemy spotted                     → COMBAT
//   - alert timer (cfg.alertDuration) expired   → PATROL
//   - arrived at last known position            → wait in place until timer

import type { IOnlineStateHandler } from '../IOnlineStateHandler';
import type { INPCContext } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';
import { createDefaultTransitionMap } from '../IStateTransitionMap';
import type { IStateTransitionMap } from '../IStateTransitionMap';
import { moveToward } from './_utils';

/**
 * Stateless alert-state handler.
 *
 * A single instance can be shared across all NPC entities.
 */
export class AlertState implements IOnlineStateHandler {
  private readonly cfg: IStateConfig;
  private readonly tr: IStateTransitionMap;

  constructor(cfg: IStateConfig, tr?: Partial<IStateTransitionMap>) {
    this.cfg = cfg;
    this.tr = createDefaultTransitionMap(tr);
  }

  enter(ctx: INPCContext): void {
    ctx.state.alertStartMs = ctx.now();
    ctx.halt();
    // Pack alert broadcast (opt-in)
    if (ctx.state.lastKnownEnemyX !== 0 || ctx.state.lastKnownEnemyY !== 0) {
      ctx.pack?.broadcastTarget(
        ctx.state.targetId,
        ctx.state.lastKnownEnemyX,
        ctx.state.lastKnownEnemyY,
      );
      ctx.pack?.broadcastAlertLevel('ALERTED');
    }
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    // --- Morale check: panicked NPC flees immediately ---
    if (ctx.state.moraleState === 'PANICKED') {
      ctx.transition(this.tr.alertOnPanic);
      return;
    }

    // --- Perception: visible enemy → COMBAT (or KILL_WOUNDED if wounded, opt-in) ---
    if (ctx.perception?.hasVisibleEnemy()) {
      const enemies = ctx.perception.getVisibleEnemies();
      const target  = enemies[0];
      ctx.state.lastKnownEnemyX = target.x;
      ctx.state.lastKnownEnemyY = target.y;

      // Kill-wounded seam (opt-in) — only when morale is STABLE
      if (ctx.state.moraleState === 'STABLE') {
        const woundedEnemies = ctx.perception?.getWoundedEnemies?.() ?? [];
        if (woundedEnemies.length > 0) {
          const we = woundedEnemies[0];
          ctx.state.killWoundedTargetId = we.id;
          ctx.state.killWoundedTargetX  = we.x;
          ctx.state.killWoundedTargetY  = we.y;
          ctx.transition(this.tr.alertOnKillWounded);
          return;
        }
      }

      ctx.transition(this.tr.alertOnEnemy);
      return;
    }

    // --- Pack combat fast-path (opt-in): skip alert timer when pack is already fighting ---
    if (ctx.pack?.getPackAlertLevel() === 'COMBAT') {
      const pt = ctx.pack.getPackTarget();
      if (pt) {
        ctx.state.lastKnownEnemyX = pt.x;
        ctx.state.lastKnownEnemyY = pt.y;
        ctx.state.targetId = pt.id;
      }
      ctx.transition(this.tr.alertOnPackCombat);
      return;
    }

    // --- Timer countdown ---
    const elapsed = ctx.now() - ctx.state.alertStartMs;
    if (elapsed >= this.cfg.alertDuration) {
      ctx.halt();
      ctx.transition(this.tr.alertOnTimeout);
      return;
    }

    // --- Move toward last known position ---
    const targetX = ctx.state.lastKnownEnemyX;
    const targetY = ctx.state.lastKnownEnemyY;

    const dx     = targetX - ctx.x;
    const dy     = targetY - ctx.y;
    const distSq = dx * dx + dy * dy;
    const thresh = this.cfg.arriveThreshold;

    if (distSq <= thresh * thresh) {
      // Reached the sound source; nothing found — wait for timer.
      ctx.halt();
      // Face the direction we were heading (last known angle).
      if (targetX !== ctx.x || targetY !== ctx.y) {
        ctx.setRotation(Math.atan2(targetY - ctx.y, targetX - ctx.x));
      }
    } else {
      moveToward(ctx, targetX, targetY, this.cfg.approachSpeed);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  exit(_ctx: INPCContext): void {
    // Nothing to clean up.
  }
}
