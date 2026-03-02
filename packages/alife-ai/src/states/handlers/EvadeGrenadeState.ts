// states/handlers/EvadeGrenadeState.ts
// NPC sprints away from an active grenade or explosion danger.
//
// Behaviour summary:
//   enter()  — record ctx.now() in ctx.state.evadeStartMs so the handler
//              knows when the evasion sprint began.
//   update() — query ctx.danger?.getGrenadeDanger(x, y) each frame.
//              If grenade danger is active:
//                - move AWAY from the danger origin at
//                  approachSpeed × evadeSpeedMultiplier (sprint).
//              Exit conditions:
//                (a) Grenade danger is no longer active AND
//                    elapsed >= evadeGrenadeDurationMs  → COMBAT or SEARCH
//                (b) No danger system registered AND
//                    elapsed >= evadeGrenadeDurationMs  → COMBAT
//                (c) Grenade danger cleared early (active===false) →
//                    check enemy visibility: enemy present → COMBAT,
//                    else → SEARCH.
//   exit()   — halt() so the NPC doesn't keep drifting.
//
// State ID: 'EVADE_GRENADE'
// Transitions: → 'COMBAT' | 'SEARCH'

import type { IOnlineStateHandler } from '../IOnlineStateHandler';
import type { INPCContext } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';
import { createDefaultTransitionMap } from '../IStateTransitionMap';
import type { IStateTransitionMap } from '../IStateTransitionMap';
import { awayFrom } from './_utils';

/**
 * Default evasion sprint duration (ms).
 * Long enough to clear a grenade blast radius at sprint speed.
 */
const EVADE_GRENADE_DURATION_MS = 2_000;

/**
 * Stateless evade-grenade state handler.
 *
 * A single instance can be shared across all NPC entities.
 */
export class EvadeGrenadeState implements IOnlineStateHandler {
  private readonly cfg: IStateConfig;
  private readonly tr: IStateTransitionMap;

  constructor(cfg: IStateConfig, tr?: Partial<IStateTransitionMap>) {
    this.cfg = cfg;
    this.tr = createDefaultTransitionMap(tr);
  }

  enter(ctx: INPCContext): void {
    ctx.state.evadeStartMs = ctx.now();
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    const now     = ctx.now();
    const elapsed = now - ctx.state.evadeStartMs;

    // --- Query grenade/explosion danger ---
    const dangerInfo = ctx.danger?.getGrenadeDanger(ctx.x, ctx.y) ?? null;

    if (dangerInfo && dangerInfo.active) {
      // Sprint directly away from the danger origin.
      const speed = this.cfg.approachSpeed * this.cfg.evadeSpeedMultiplier;
      awayFrom(ctx, dangerInfo.originX, dangerInfo.originY, speed);
      // Don't exit yet — keep sprinting until danger clears or timer expires.
      return;
    }

    // --- No active grenade danger ---
    if (ctx.danger === null) {
      // No danger system at all — time out and return to COMBAT.
      if (elapsed >= EVADE_GRENADE_DURATION_MS) {
        ctx.halt();
        ctx.transition(this.tr.evadeOnNoSystem);
      }
      return;
    }

    // Danger system present but grenade is no longer active (or was never found).
    if (elapsed >= EVADE_GRENADE_DURATION_MS) {
      ctx.halt();
      this._exitToNextState(ctx);
      return;
    }

    // Danger cleared early — transition immediately.
    ctx.halt();
    this._exitToNextState(ctx);
  }

  exit(ctx: INPCContext): void {
    ctx.halt();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Choose the post-evade state based on whether an enemy is currently visible.
   * enemy visible → evadeOnClear (default: 'COMBAT'), no enemy → SEARCH.
   */
  private _exitToNextState(ctx: INPCContext): void {
    if (ctx.perception?.hasVisibleEnemy()) {
      ctx.transition(this.tr.evadeOnClear);
    } else {
      ctx.transition('SEARCH');
    }
  }
}
