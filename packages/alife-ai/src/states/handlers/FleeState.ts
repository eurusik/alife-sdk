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
//   - morale is STABLE   → ALERT
//   - far enough + SHAKEN → PATROL (then morale recovery will bring them back)

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

    const threatX = ctx.state.lastKnownEnemyX;
    const threatY = ctx.state.lastKnownEnemyY;

    const dx   = ctx.x - threatX;
    const dy   = ctx.y - threatY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // --- SHAKEN + far enough → hold and wait for morale recovery ---
    if (moraleState === 'SHAKEN' && dist >= this.cfg.fleeDistance) {
      ctx.halt();
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
