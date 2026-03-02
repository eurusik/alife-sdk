// states/handlers/SleepState.ts
// NPC is asleep — minimal perception, very delayed reactions.
//
// Sleep behavior (scheme@sleep analogue):
//   - Visual perception is intentionally NOT checked (eyes closed).
//   - Sound/nearby enemies detected via perception → cfg.campSleepReactionDelayMs
//     delay → ALERT (NPC wakes up slowly).
//   - NPC inside a restricted/danger zone → ALERT (immediate — physical threat).
//
// Transitions out of SLEEP:
//   - sound/nearby threat (after campSleepReactionDelayMs delay) → ALERT
//   - NPC inside an inaccessible/danger zone                    → ALERT (immediate)

import type { IOnlineStateHandler } from '../IOnlineStateHandler';
import type { INPCContext } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';
import { createDefaultTransitionMap } from '../IStateTransitionMap';
import type { IStateTransitionMap } from '../IStateTransitionMap';
import { moveToward } from './_utils';

// Sentinel: no pending reaction timer.
const NO_PENDING = 0;

/**
 * Stateless sleep-state handler.
 *
 * A single instance can be shared across all NPC entities.
 */
export class SleepState implements IOnlineStateHandler {
  private readonly cfg: IStateConfig;
  private readonly tr: IStateTransitionMap;

  constructor(cfg: IStateConfig, tr?: Partial<IStateTransitionMap>) {
    this.cfg = cfg;
    this.tr = createDefaultTransitionMap(tr);
  }

  enter(ctx: INPCContext): void {
    ctx.halt();
    // Clear any stale delayed reaction from a previous SLEEP activation.
    // We repurpose woundedStartMs as the sleep-reaction-start timestamp.
    ctx.state.woundedStartMs = NO_PENDING;
    // Slightly dim the NPC to indicate sleep visually.
    ctx.setAlpha(0.8);
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    const now = ctx.now();

    // --- Pending delayed-reaction processing ---
    const reactionStart = ctx.state.woundedStartMs;
    if (reactionStart !== NO_PENDING) {
      if (now - reactionStart >= this.cfg.campSleepReactionDelayMs) {
        ctx.state.woundedStartMs = NO_PENDING;
        ctx.transition(this.tr.sleepOnEnemy);
        return;
      }
      // Still waking up — do nothing else.
      return;
    }

    // --- Sound / nearby threat (non-visual perception) → queue delayed ALERT ---
    // Note: visual enemies are intentionally NOT checked here (NPC eyes closed).
    if (ctx.perception !== null) {
      const allies = ctx.perception.getVisibleAllies(); // unused, but good guard
      void allies;
      const enemies = ctx.perception.getVisibleEnemies();
      // We DO check getVisibleEnemies because the perception system may only
      // include sound-detected entities in this list when used properly by the
      // host. If only visual enemies appear here and the host disables visual
      // perception for sleeping NPCs, this list will be empty — which is the
      // correct behaviour. We keep the check simple and host-driven.
      if (enemies.length > 0) {
        const target = enemies[0];
        ctx.state.lastKnownEnemyX = target.x;
        ctx.state.lastKnownEnemyY = target.y;
        ctx.state.woundedStartMs = now;
        return;
      }
    }

    // --- Restricted zone check (immediate wake-up — physical danger) ---
    if (ctx.restrictedZones !== null && !ctx.restrictedZones.isAccessible(ctx.x, ctx.y)) {
      const step = this.cfg.approachSpeed * 2;
      const candidates = [
        { x: ctx.x + step, y: ctx.y },
        { x: ctx.x - step, y: ctx.y },
        { x: ctx.x,        y: ctx.y + step },
        { x: ctx.x,        y: ctx.y - step },
      ];

      const safe = ctx.restrictedZones.filterAccessible(candidates);
      if (safe.length > 0) {
        const dest = safe[0];
        ctx.state.lastKnownEnemyX = dest.x;
        ctx.state.lastKnownEnemyY = dest.y;
        moveToward(ctx, dest.x, dest.y, this.cfg.approachSpeed);
      }

      ctx.transition(this.tr.sleepOnEnemy);
      return;
    }
  }

  exit(ctx: INPCContext): void {
    // Restore full alpha when waking up.
    ctx.setAlpha(1);
    // Clear any pending delayed reaction.
    ctx.state.woundedStartMs = NO_PENDING;
  }
}
