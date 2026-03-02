// states/handlers/PatrolState.ts
// NPC moves toward the current patrol waypoint stored in ctx.state.
//
// Waypoint management:
//   The handler does NOT own the waypoint list. Instead it moves toward the
//   target position stored in ctx.state.coverPointX / coverPointY (repurposed
//   as the "current patrol point"). External code (e.g. PatrolRouteTracker,
//   A-Life brain hooks) is responsible for writing the next target into these
//   fields before entering PATROL state.
//
//   When the NPC arrives within cfg.waypointArriveThreshold pixels it halts
//   and transitions to IDLE so the host can assign the next waypoint.
//
// Transitions out of PATROL:
//   - visible enemy detected via ctx.perception        → ALERT
//   - squad intel received (opt-in)                    → ALERT (via patrolOnSquadIntel)
//   - accumulated suspicion exceeds threshold (opt-in) → ALERT (via patrolOnSuspicious)
//   - wounded ally detected (opt-in)                   → HELP_WOUNDED (via patrolOnWoundedAlly)
//   - friendly corpse seen (opt-in)                    → suspicion.add(BODY_FOUND) → cascades
//   - arrived at patrol target                         → IDLE
//   - no patrol target set (both coords are 0)         → IDLE

import type { IOnlineStateHandler } from '../IOnlineStateHandler';
import type { INPCContext } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';
import { createDefaultTransitionMap } from '../IStateTransitionMap';
import type { IStateTransitionMap } from '../IStateTransitionMap';
import { moveToward } from './_utils';
import { SuspicionStimuli } from '../../suspicion/SuspicionAccumulator';

/**
 * Stateless patrol-state handler.
 *
 * A single instance can be shared across all NPC entities.
 */
export class PatrolState implements IOnlineStateHandler {
  private readonly cfg: IStateConfig;
  private readonly tr: IStateTransitionMap;

  constructor(cfg: IStateConfig, tr?: Partial<IStateTransitionMap>) {
    this.cfg = cfg;
    this.tr = createDefaultTransitionMap(tr);
  }

  enter(ctx: INPCContext): void {
    // Velocity will be set in update once we resolve the patrol target.
    ctx.halt();
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    // --- Perception: any visible enemy → ALERT ---
    if (ctx.perception?.hasVisibleEnemy()) {
      const enemies = ctx.perception.getVisibleEnemies();
      const target  = enemies[0];
      ctx.state.lastKnownEnemyX = target.x;
      ctx.state.lastKnownEnemyY = target.y;
      ctx.halt();
      ctx.transition(this.tr.patrolOnEnemy);
      return;
    }

    // --- Squad intel check (opt-in) ---
    // Silently skips when ctx.squad is null or getSharedTarget is not implemented.
    const shared = ctx.squad?.getSharedTarget?.() ?? null;
    if (shared !== null) {
      ctx.state.lastKnownEnemyX = shared.x;
      ctx.state.lastKnownEnemyY = shared.y;
      ctx.halt();
      ctx.transition(this.tr.patrolOnSquadIntel);
      return;
    }

    // --- Pack alert check (opt-in) ---
    if (ctx.pack) {
      const level = ctx.pack.getPackAlertLevel();
      if (level !== 'NONE') {
        const pt = ctx.pack.getPackTarget();
        if (pt) {
          ctx.state.lastKnownEnemyX = pt.x;
          ctx.state.lastKnownEnemyY = pt.y;
        }
        ctx.halt();
        ctx.transition(this.tr.patrolOnPackAlert);
        return;
      }
    }

    // --- Suspicion check (opt-in) ---
    // Silently skips when ctx.suspicion is null (not registered by host).
    if (ctx.suspicion?.hasReachedAlert(this.cfg.suspicionAlertThreshold)) {
      const pos = ctx.suspicion.getLastKnownPosition();
      if (pos) {
        ctx.state.lastKnownEnemyX = pos.x;
        ctx.state.lastKnownEnemyY = pos.y;
      }
      ctx.suspicion.clear();
      ctx.halt();
      ctx.transition(this.tr.patrolOnSuspicious);
      return;
    }

    // --- Wounded ally check (opt-in via getWoundedAllies) ---
    // Silently skips when perception is null or getWoundedAllies is not implemented.
    const woundedAllies = ctx.perception?.getWoundedAllies?.() ?? [];
    if (woundedAllies.length > 0) {
      const ally = woundedAllies[0];
      ctx.state.helpWoundedTargetId = ally.id;
      ctx.state.helpWoundedX        = ally.x;
      ctx.state.helpWoundedY        = ally.y;
      ctx.halt();
      ctx.transition(this.tr.patrolOnWoundedAlly);
      return;
    }

    // --- Corpse detection (opt-in via getVisibleCorpses + suspicion) ---
    // Feeds suspicion accumulator; the existing suspicion check above handles transition.
    if (ctx.suspicion) {
      for (const c of ctx.perception?.getVisibleCorpses?.() ?? []) {
        ctx.suspicion.add(SuspicionStimuli.BODY_FOUND, this.cfg.corpseFoundSuspicion, c.x, c.y);
      }
    }

    // --- Patrol target check ---
    // ctx.state.coverPointX/Y stores the current waypoint destination.
    // If both are 0 we have no assignment — fall back to IDLE.
    const targetX = ctx.state.coverPointX;
    const targetY = ctx.state.coverPointY;

    if (targetX === 0 && targetY === 0) {
      ctx.halt();
      ctx.transition(this.tr.patrolOnNoWaypoint);
      return;
    }

    // --- Arrival check ---
    const dx     = targetX - ctx.x;
    const dy     = targetY - ctx.y;
    const distSq = dx * dx + dy * dy;
    const thresh = this.cfg.waypointArriveThreshold;

    if (distSq <= thresh * thresh) {
      ctx.halt();
      // Signal arrival: clear the target so the host knows to assign the next
      // waypoint, then fall back to IDLE until re-assigned.
      ctx.state.coverPointX = 0;
      ctx.state.coverPointY = 0;
      ctx.transition(this.tr.patrolOnNoWaypoint);
      return;
    }

    // --- Move toward target ---
    moveToward(ctx, targetX, targetY, this.cfg.approachSpeed);
  }

  exit(ctx: INPCContext): void {
    ctx.halt();
  }
}
