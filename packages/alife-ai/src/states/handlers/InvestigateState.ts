// states/handlers/InvestigateState.ts
// NPC received a suspicious stimulus and moves toward the last known position
// to investigate. Softer than ALERT — no combat assumption, calm approach.
//
// Phase 1 — APPROACH: Move toward ctx.state.lastKnownEnemyX/Y at approachSpeed.
//   - Panicked morale (PANICKED)                → investigateOnPanic (FLEE)
//   - Visible enemy detected via ctx.perception → investigateOnEnemy (ALERT)
//   - Suspicion re-accumulates above threshold  → investigateOnEnemy (ALERT)
//   - Overall timeout (investigateMaxDurationMs) → investigateOnTimeout (PATROL)
//   - Arrived within arriveThreshold            → begin Phase 2
//
// Phase 2 — LOOK_AROUND: Halt at the location, rotate, wait investigateLookAroundMs.
//   - Panicked morale (PANICKED)                → investigateOnPanic (FLEE)
//   - Visible enemy detected via ctx.perception → investigateOnEnemy (ALERT)
//   - Suspicion re-accumulates above threshold  → investigateOnEnemy (ALERT)
//   - Look-around timer expires, nothing found  → investigateOnTimeout (PATROL)
//
// Opt-in integration:
//   ctx.suspicion may be null — all suspicion checks use optional chaining.
//   To activate: register this handler and set patrolOnSuspicious/idleOnSuspicious to 'INVESTIGATE'.
//
// Stateless: a single instance can be shared across all NPC entities.
//
// Sentinel: investigateLookAroundStartMs uses -1 to mean "not yet arrived",
//   avoiding collision with ctx.now() === 0 on the very first frame.

import type { IOnlineStateHandler } from '../IOnlineStateHandler';
import type { INPCContext }          from '../INPCContext';
import type { IStateConfig }         from '../IStateConfig';
import { createDefaultTransitionMap } from '../IStateTransitionMap';
import type { IStateTransitionMap }  from '../IStateTransitionMap';
import { moveToward }                from './_utils';

/**
 * Stateless two-phase investigate handler (X-Ray 16 `xr_investigator` equivalent).
 *
 * A single instance can be shared across all NPC entities.
 *
 * Opt-in activation — wire suspicion to INVESTIGATE instead of ALERT:
 * ```ts
 * const handlers = buildDefaultHandlerMap(cfg, {
 *   patrolOnSuspicious: 'INVESTIGATE',
 *   idleOnSuspicious:   'INVESTIGATE',
 * });
 * handlers.register('INVESTIGATE', new InvestigateState(cfg));
 * ```
 */
export class InvestigateState implements IOnlineStateHandler {
  private readonly cfg: IStateConfig;
  private readonly tr:  IStateTransitionMap;

  constructor(cfg: IStateConfig, tr?: Partial<IStateTransitionMap>) {
    this.cfg = cfg;
    this.tr  = createDefaultTransitionMap(tr);
  }

  enter(ctx: INPCContext): void {
    ctx.state.investigateStartMs           = ctx.now();
    ctx.state.investigateLookAroundStartMs = -1;   // -1 = not yet arrived
    ctx.halt();
    ctx.emitVocalization('INVESTIGATE_START');
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    const now = ctx.now();

    // ── Priority 1 — Panic → abort investigation, flee immediately ──────────
    if (ctx.state.moraleState === 'PANICKED') {
      ctx.halt();
      ctx.transition(this.tr.investigateOnPanic);
      return;
    }

    // ── Priority 2 — Visible enemy → escalate immediately ───────────────────
    if (ctx.perception?.hasVisibleEnemy()) {
      const enemies = ctx.perception.getVisibleEnemies();
      const target  = enemies[0];
      ctx.state.lastKnownEnemyX = target.x;
      ctx.state.lastKnownEnemyY = target.y;
      ctx.state.targetId        = target.id;
      ctx.halt();
      ctx.transition(this.tr.investigateOnEnemy);
      return;
    }

    // ── Phase 2 — LOOK_AROUND (entered when investigateLookAroundStartMs >= 0) ──
    if (ctx.state.investigateLookAroundStartMs >= 0) {
      ctx.halt();

      // Rotate to simulate scanning — two full sweeps over the look-around window.
      // Jitter is derived deterministically from arrival timestamp to avoid
      // consuming ctx.random() budget every frame.
      const elapsed    = now - ctx.state.investigateLookAroundStartMs;
      const jitter     = (ctx.state.investigateLookAroundStartMs % 1000) / 1000 * 0.2;
      const sweepAngle = (elapsed / this.cfg.investigateLookAroundMs) * Math.PI * 4 + jitter;
      ctx.setRotation(sweepAngle);

      // Suspicion re-accumulation during look-around (opt-in)
      if (ctx.suspicion?.hasReachedAlert(this.cfg.suspicionAlertThreshold)) {
        const pos = ctx.suspicion.getLastKnownPosition();
        if (pos) {
          ctx.state.lastKnownEnemyX = pos.x;
          ctx.state.lastKnownEnemyY = pos.y;
        }
        ctx.suspicion.clear();
        ctx.halt();
        ctx.transition(this.tr.investigateOnEnemy);
        return;
      }

      // Timer expired → nothing found, deescalate
      if (elapsed >= this.cfg.investigateLookAroundMs) {
        ctx.suspicion?.clear();
        ctx.halt();
        ctx.transition(this.tr.investigateOnTimeout);
      }
      return;
    }

    // ── Phase 1 — APPROACH: move toward investigate target ──────────────────

    // Overall timeout guard — prevents infinite approach on unreachable points
    if (now - ctx.state.investigateStartMs >= this.cfg.investigateMaxDurationMs) {
      ctx.suspicion?.clear();
      ctx.halt();
      ctx.transition(this.tr.investigateOnTimeout);
      return;
    }

    // Suspicion re-spike during approach → skip look-around, escalate directly
    if (ctx.suspicion?.hasReachedAlert(this.cfg.suspicionAlertThreshold)) {
      const pos = ctx.suspicion.getLastKnownPosition();
      if (pos) {
        ctx.state.lastKnownEnemyX = pos.x;
        ctx.state.lastKnownEnemyY = pos.y;
      }
      ctx.suspicion.clear();
      ctx.halt();
      ctx.transition(this.tr.investigateOnEnemy);
      return;
    }

    const destX  = ctx.state.lastKnownEnemyX;
    const destY  = ctx.state.lastKnownEnemyY;
    const dx     = destX - ctx.x;
    const dy     = destY - ctx.y;
    const distSq = dx * dx + dy * dy;
    const thresh = this.cfg.arriveThreshold;

    if (distSq <= thresh * thresh) {
      // Arrived — begin look-around phase
      ctx.state.investigateLookAroundStartMs = now;
      ctx.halt();
      if (dx !== 0 || dy !== 0) {
        ctx.setRotation(Math.atan2(dy, dx));
      }
      return;
    }

    moveToward(ctx, destX, destY, this.cfg.approachSpeed);
  }

  exit(ctx: INPCContext): void {
    ctx.state.investigateStartMs           = 0;
    ctx.state.investigateLookAroundStartMs = -1;
    ctx.halt();
  }
}
