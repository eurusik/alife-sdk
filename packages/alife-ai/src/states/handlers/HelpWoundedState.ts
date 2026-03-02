// states/handlers/HelpWoundedState.ts
// NPC detected a wounded ally and moves toward them to provide assistance.
// Softer social response — not combat, no weapon use.
//
// Phase 1 — APPROACH: Move toward the wounded ally at approachSpeed.
//   - Panicked morale (PANICKED)                → helpWoundedOnPanic (FLEE)
//   - Visible enemy detected via ctx.perception → helpWoundedOnEnemy (ALERT)
//   - Overall timeout (helpWoundedMaxDurationMs) → helpWoundedOnComplete (PATROL)
//   - Ally gone from getWoundedAllies() list    → helpWoundedOnComplete (PATROL)
//   - Arrived within arriveThreshold            → begin Phase 2
//
// Phase 2 — ASSIST: Halt next to ally, hold position for helpWoundedAssistMs.
//   - Panicked morale (PANICKED)                → helpWoundedOnPanic (FLEE)
//   - Visible enemy detected via ctx.perception → helpWoundedOnEnemy (ALERT)
//   - Ally gone from getWoundedAllies() list    → helpWoundedOnComplete (healed or dead)
//   - Assist timer expires                      → helpWoundedOnComplete (PATROL)
//
// Pre-conditions set by calling state (PatrolState / IdleState):
//   ctx.state.helpWoundedTargetId = ally.id
//   ctx.state.helpWoundedX        = ally.x
//   ctx.state.helpWoundedY        = ally.y
//
// Opt-in integration:
//   Requires ctx.perception?.getWoundedAllies?.() to be implemented.
//   Without it, Phase 1 immediately transitions to helpWoundedOnComplete.
//
// Stateless: a single instance can be shared across all NPC entities.

import type { IOnlineStateHandler } from '../IOnlineStateHandler';
import type { INPCContext }          from '../INPCContext';
import type { IStateConfig }         from '../IStateConfig';
import { createDefaultTransitionMap } from '../IStateTransitionMap';
import type { IStateTransitionMap }  from '../IStateTransitionMap';
import { moveToward }                from './_utils';

/**
 * Stateless two-phase help-wounded handler (X-Ray 16 `xr_help_wounded` equivalent).
 *
 * A single instance can be shared across all NPC entities.
 *
 * Opt-in activation:
 * ```ts
 * const handlers = buildDefaultHandlerMap(cfg, {
 *   patrolOnWoundedAlly: 'HELP_WOUNDED',
 *   idleOnWoundedAlly:   'HELP_WOUNDED',
 * });
 * handlers.register('HELP_WOUNDED', new HelpWoundedState(cfg));
 * ```
 */
export class HelpWoundedState implements IOnlineStateHandler {
  private readonly cfg: IStateConfig;
  private readonly tr:  IStateTransitionMap;

  constructor(cfg: IStateConfig, tr?: Partial<IStateTransitionMap>) {
    this.cfg = cfg;
    this.tr  = createDefaultTransitionMap(tr);
  }

  enter(ctx: INPCContext): void {
    ctx.state.helpWoundedStartMs       = ctx.now();
    ctx.state.helpWoundedAssistStartMs = -1;   // -1 = not yet arrived
    ctx.halt();
    ctx.emitVocalization('HELP_WOUNDED_MOVING');
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    const now = ctx.now();

    // ── Priority 1 — Panic → flee ───────────────────────────────────────────
    if (ctx.state.moraleState === 'PANICKED') {
      ctx.halt();
      ctx.transition(this.tr.helpWoundedOnPanic);
      return;
    }

    // ── Priority 2 — Visible enemy → abandon help, fight ────────────────────
    if (ctx.perception?.hasVisibleEnemy()) {
      const enemies = ctx.perception.getVisibleEnemies();
      const target  = enemies[0];
      ctx.state.lastKnownEnemyX = target.x;
      ctx.state.lastKnownEnemyY = target.y;
      ctx.state.targetId        = target.id;
      ctx.halt();
      ctx.transition(this.tr.helpWoundedOnEnemy);
      return;
    }

    // ── Phase 2 — ASSIST (arrived, helpWoundedAssistStartMs >= 0) ────────────
    if (ctx.state.helpWoundedAssistStartMs >= 0) {
      ctx.halt();

      // Re-check if ally is still wounded (opt-in)
      const allies = ctx.perception?.getWoundedAllies?.() ?? [];
      const stillWounded = allies.find(a => a.id === ctx.state.helpWoundedTargetId);
      if (!stillWounded) {
        ctx.transition(this.tr.helpWoundedOnComplete);   // healed or died
        return;
      }

      // Assist timer
      if (now - ctx.state.helpWoundedAssistStartMs >= this.cfg.helpWoundedAssistMs) {
        ctx.transition(this.tr.helpWoundedOnComplete);
      }
      return;
    }

    // ── Phase 1 — APPROACH ───────────────────────────────────────────────────

    // Overall timeout — prevents infinite approach on unreachable ally
    if (now - ctx.state.helpWoundedStartMs >= this.cfg.helpWoundedMaxDurationMs) {
      ctx.halt();
      ctx.transition(this.tr.helpWoundedOnComplete);
      return;
    }

    // Update ally position from fresh perception each frame (ally may crawl)
    const allies = ctx.perception?.getWoundedAllies?.() ?? [];
    const target = allies.find(a => a.id === ctx.state.helpWoundedTargetId) ?? null;

    if (!target) {
      // Ally healed, died, or left perception range
      ctx.halt();
      ctx.transition(this.tr.helpWoundedOnComplete);
      return;
    }

    // Keep destination current
    ctx.state.helpWoundedX = target.x;
    ctx.state.helpWoundedY = target.y;

    const dx     = target.x - ctx.x;
    const dy     = target.y - ctx.y;
    const distSq = dx * dx + dy * dy;
    const thresh = this.cfg.arriveThreshold;

    if (distSq <= thresh * thresh) {
      // Arrived — begin assist phase
      ctx.state.helpWoundedAssistStartMs = now;
      ctx.halt();
      ctx.emitVocalization('HELP_WOUNDED_ASSIST');
      return;
    }

    moveToward(ctx, target.x, target.y, this.cfg.approachSpeed);
  }

  exit(ctx: INPCContext): void {
    ctx.state.helpWoundedStartMs       = 0;
    ctx.state.helpWoundedAssistStartMs = -1;
    ctx.state.helpWoundedTargetId      = null;
    ctx.state.helpWoundedX             = 0;
    ctx.state.helpWoundedY             = 0;
    ctx.halt();
  }
}
