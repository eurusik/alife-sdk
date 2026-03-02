// states/handlers/CampState.ts
// NPC sits at a rest point with reduced vigilance (camp/guard post behavior).
//
// Behavior:
//   - NPC stays stationary at the camp spot.
//   - Reactions to visible enemies are delayed by cfg.schemeReactionDelayMs
//     (simulates lower alertness while at rest).
//   - No delay for danger-zone reactions (immediate relocation).
//
// Transitions out of CAMP:
//   - visible enemy (after schemeReactionDelayMs delay) → COMBAT
//   - NPC inside an inaccessible/restricted zone        → ALERT (walk away first)

import type { IOnlineStateHandler } from '../IOnlineStateHandler';
import type { INPCContext } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';
import { createDefaultTransitionMap } from '../IStateTransitionMap';
import type { IStateTransitionMap } from '../IStateTransitionMap';
import { moveToward } from './_utils';

// Internal flag stored in ctx.state.psiPhaseStartMs repurposed as the
// reaction-pending timer timestamp. We use a sentinel value of 0 for "none".
const NO_PENDING_REACTION = 0;

/**
 * Stateless camp-state handler.
 *
 * A single instance can be shared across all NPC entities.
 */
export class CampState implements IOnlineStateHandler {
  private readonly cfg: IStateConfig;
  private readonly tr: IStateTransitionMap;

  constructor(cfg: IStateConfig, tr?: Partial<IStateTransitionMap>) {
    this.cfg = cfg;
    this.tr = createDefaultTransitionMap(tr);
  }

  enter(ctx: INPCContext): void {
    ctx.halt();
    // Reset the reaction timer (no pending delayed reaction on entry).
    // We repurpose evadeStartMs as a scheme-reaction start timestamp.
    ctx.state.evadeStartMs = NO_PENDING_REACTION;
    // Emit a camp vocalization if a vocalization cooldown allows.
    const now = ctx.now();
    if (now - ctx.state.lastVocalizationMs >= this.cfg.meleeCooldownMs * 3) {
      ctx.emitVocalization('CAMP_IDLE');
      ctx.state.lastVocalizationMs = now;
    }
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    const now = ctx.now();

    // --- Pending delayed-reaction processing ---
    const reactionStart = ctx.state.evadeStartMs;
    if (reactionStart !== NO_PENDING_REACTION) {
      if (now - reactionStart >= this.cfg.schemeReactionDelayMs) {
        // Delay elapsed — execute the queued transition.
        // The target state is encoded in ctx.state.isAlert:
        //   true  → COMBAT
        //   false → ALERT
        ctx.state.evadeStartMs = NO_PENDING_REACTION;
        ctx.transition(ctx.state.isAlert ? this.tr.campOnEnemy : this.tr.campOnDanger);
        return;
      }
      // Still waiting for delay — do nothing else this frame.
      return;
    }

    // --- Visible enemy → queue delayed COMBAT reaction ---
    if (ctx.perception?.hasVisibleEnemy()) {
      const enemies = ctx.perception.getVisibleEnemies();
      const target  = enemies[0];
      ctx.state.lastKnownEnemyX = target.x;
      ctx.state.lastKnownEnemyY = target.y;
      ctx.state.isAlert    = true;
      ctx.state.evadeStartMs = now;
      return;
    }

    // --- Restricted zone check (immediate — no delay for danger zones) ---
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

      ctx.transition(this.tr.campOnDanger);
      return;
    }
  }

  exit(ctx: INPCContext): void {
    // Clear any pending delayed reaction so it doesn't leak into the next
    // activation of this state.
    ctx.state.evadeStartMs = NO_PENDING_REACTION;
    ctx.state.isAlert = false;
  }
}
