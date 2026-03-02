// states/handlers/SearchState.ts
// NPC lost visual contact on the enemy and moves to the last known position
// to check if it is still there.
//
// Transitions out of SEARCH:
//   - visible enemy spotted again              → ALERT  (re-escalate)
//   - search timer (cfg.searchDuration) expired → IDLE   (gave up)
//   - arrived at last known position           → wait in place until timer

import type { IOnlineStateHandler } from '../IOnlineStateHandler';
import type { INPCContext } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';
import { createDefaultTransitionMap } from '../IStateTransitionMap';
import type { IStateTransitionMap } from '../IStateTransitionMap';
import { moveToward } from './_utils';

/**
 * Stateless search-state handler.
 *
 * A single instance can be shared across all NPC entities.
 */
export class SearchState implements IOnlineStateHandler {
  private readonly cfg: IStateConfig;
  private readonly tr: IStateTransitionMap;

  constructor(cfg: IStateConfig, tr?: Partial<IStateTransitionMap>) {
    this.cfg = cfg;
    this.tr = createDefaultTransitionMap(tr);
  }

  enter(ctx: INPCContext): void {
    ctx.state.searchStartMs = ctx.now();
    // Do not overwrite lastKnownEnemyX/Y here — the caller (e.g. CombatState
    // transitioning to SEARCH) has already set the last confirmed position.
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    // --- Perception: enemy becomes visible → re-escalate to ALERT ---
    if (ctx.perception?.hasVisibleEnemy()) {
      const enemies = ctx.perception.getVisibleEnemies();
      const target  = enemies[0];
      ctx.state.lastKnownEnemyX = target.x;
      ctx.state.lastKnownEnemyY = target.y;
      ctx.transition(this.tr.searchOnEnemy);
      return;
    }

    // --- Timer countdown ---
    const elapsed = ctx.now() - ctx.state.searchStartMs;
    if (elapsed >= this.cfg.searchDuration) {
      // Gave up searching — clear target lock, return to idle.
      ctx.state.targetId = null;
      ctx.halt();
      ctx.transition(this.tr.searchOnTimeout);
      return;
    }

    // --- Move toward last known enemy position ---
    const targetX = ctx.state.lastKnownEnemyX;
    const targetY = ctx.state.lastKnownEnemyY;

    const dx     = targetX - ctx.x;
    const dy     = targetY - ctx.y;
    const distSq = dx * dx + dy * dy;
    const thresh = this.cfg.arriveThreshold;

    if (distSq <= thresh * thresh) {
      // Reached the last known position; nothing here — wait for timer.
      ctx.halt();
    } else {
      moveToward(ctx, targetX, targetY, this.cfg.approachSpeed);
    }
  }

  exit(ctx: INPCContext): void {
    ctx.halt();
  }
}
