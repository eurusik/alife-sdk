// states/handlers/FleeState.ts
// NPC sprints directly away from the threat's last known position.
//
// Morale-aware speed:
//   - PANICKED NPC : base flee speed × fleeSpeedMultiplier × panicFleeMultiplier
//   - SHAKEN NPC   : base flee speed × fleeSpeedMultiplier (no extra multiplier)
//
// Exit conditions (same rules as the game-layer FleeState):
//   - moraleState is STABLE                              → ALERT  (recovered)
//   - distance from threat > cfg.fleeDistance AND morale
//     is SHAKEN (not PANICKED)                           → PATROL (far enough)
//
// Transitions out of FLEE:
//   - morale is STABLE            → ALERT  (fleeOnCalmed)
//   - far enough + SHAKEN         → PATROL (fleeOnSafe; morale recovery will bring them back)

import type { IOnlineStateHandler } from '../IOnlineStateHandler';
import type { INPCContext } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';
import { createDefaultTransitionMap } from '../IStateTransitionMap';
import type { IStateTransitionMap } from '../IStateTransitionMap';
import { awayFrom } from './_utils';

/**
 * Stateless flee-state handler.
 *
 * A single instance can be shared across all NPC entities.
 */
export class FleeState implements IOnlineStateHandler {
  private readonly cfg: IStateConfig;
  private readonly tr: IStateTransitionMap;

  constructor(cfg: IStateConfig, tr?: Partial<IStateTransitionMap>) {
    this.cfg = cfg;
    this.tr = createDefaultTransitionMap(tr);
  }

  enter(ctx: INPCContext): void {
    // Zero velocity immediately so the first update tick applies the correct
    // flee direction rather than inheriting stale combat velocity.
    ctx.halt();
    ctx.pack?.broadcastAlertLevel('PANIC');
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    const moraleState = ctx.state.moraleState;

    // --- Morale recovery: fully STABLE → resume investigating ---
    if (moraleState === 'STABLE') {
      ctx.halt();
      ctx.transition(this.tr.fleeOnCalmed);
      return;
    }

    let threatX = ctx.state.lastKnownEnemyX;
    let threatY = ctx.state.lastKnownEnemyY;

    // Guard: lastKnownEnemy defaults to (0,0) when it has never been set.
    // Fleeing from world origin is wrong — a SHAKEN NPC far from origin would
    // satisfy dist >= fleeDistance on frame 1 and exit immediately.
    // Prefer the nearest visible enemy; fall back to the NPC's own position so
    // awayFrom() triggers its "exactly on top of threat" escape path instead.
    if (threatX === 0 && threatY === 0) {
      const visible = ctx.perception?.getVisibleEnemies() ?? [];
      if (visible.length > 0) {
        // Pick the closest visible enemy as the threat source.
        let minDist2 = Infinity;
        for (const e of visible) {
          const ex = ctx.x - e.x;
          const ey = ctx.y - e.y;
          const d2 = ex * ex + ey * ey;
          if (d2 < minDist2) { minDist2 = d2; threatX = e.x; threatY = e.y; }
        }
      } else {
        // No known threat position at all — flee from self so awayFrom()
        // uses its default escape direction rather than pulling toward origin.
        threatX = ctx.x;
        threatY = ctx.y;
      }
    }

    const dx   = ctx.x - threatX;
    const dy   = ctx.y - threatY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // --- SHAKEN + far enough → transition out so morale can recover ---
    if (moraleState === 'SHAKEN' && dist >= this.cfg.fleeDistance) {
      ctx.halt();
      ctx.transition(this.tr.fleeOnSafe);
      return;
    }

    // --- Compute flee speed ---
    const panicMult = moraleState === 'PANICKED' ? this.cfg.panicFleeMultiplier : 1.0;
    const speed     = this.cfg.approachSpeed * this.cfg.fleeSpeedMultiplier * panicMult;

    awayFrom(ctx, threatX, threatY, speed);
  }

  exit(ctx: INPCContext): void {
    ctx.halt();
  }
}
