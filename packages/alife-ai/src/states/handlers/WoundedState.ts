// states/handlers/WoundedState.ts
// NPC is critically wounded: crawls away from threats, attempts to heal with
// medkits, and may panic-flee when hopeless.
//
// Behaviour summary:
//   enter()  — record ctx.now() in ctx.state.woundedStartMs.
//   update() — per frame:
//              1. Check duration limit: if elapsed > woundedMaxDurationMs → FLEE.
//              2. If medkit available AND HP still critically low:
//                 heal(maxHp × medkitHealRatio), consume one medkit.
//                 If HP recovers above woundedHpThreshold → COMBAT.
//              3. If morale PANICKED AND no medkits left → FLEE immediately.
//              4. Move away from last known enemy at crawl speed
//                 (approachSpeed × woundedCrawlMultiplier).
//   exit()   — nothing (no cleanup state needed).
//
// State ID: 'WOUNDED'
// Transitions: → 'COMBAT' (healed) | 'FLEE' (time limit / panic)

import type { IOnlineStateHandler } from '../IOnlineStateHandler';
import type { INPCContext } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';
import { createDefaultTransitionMap } from '../IStateTransitionMap';
import type { IStateTransitionMap } from '../IStateTransitionMap';
import { awayFrom } from './_utils';

/**
 * Stateless wounded-state handler.
 *
 * A single instance can be shared across all NPC entities.
 */
export class WoundedState implements IOnlineStateHandler {
  private readonly cfg: IStateConfig;
  private readonly tr: IStateTransitionMap;

  constructor(cfg: IStateConfig, tr?: Partial<IStateTransitionMap>) {
    this.cfg = cfg;
    this.tr = createDefaultTransitionMap(tr);
  }

  enter(ctx: INPCContext): void {
    ctx.state.woundedStartMs = ctx.now();
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    const now     = ctx.now();
    const elapsed = now - ctx.state.woundedStartMs;

    // --- Time limit: give up and flee after woundedMaxDurationMs ---
    if (elapsed >= this.cfg.woundedMaxDurationMs) {
      ctx.transition(this.tr.woundedOnTimeout);
      return;
    }

    // --- Medkit healing ---
    if (ctx.state.medkitCount > 0 && ctx.health !== null) {
      const hpPercent = ctx.health.hpPercent;

      if (hpPercent < this.cfg.woundedHpThreshold) {
        // Apply heal.
        const healAmount = ctx.health.maxHp * this.cfg.medkitHealRatio;
        ctx.health.heal(healAmount);
        ctx.state.medkitCount -= 1;

        // Re-check HP after heal.
        if (ctx.health.hpPercent >= this.cfg.woundedHpThreshold) {
          ctx.transition(this.tr.woundedOnHealed);
          return;
        }
      }
    }

    // --- Morale PANICKED with no medkits left → flee immediately ---
    if (ctx.state.moraleState === 'PANICKED' && ctx.state.medkitCount <= 0) {
      ctx.transition(this.tr.woundedOnPanic);
      return;
    }

    // --- Crawl away from last known enemy position ---
    const crawlSpeed = this.cfg.approachSpeed * this.cfg.woundedCrawlMultiplier;
    awayFrom(
      ctx,
      ctx.state.lastKnownEnemyX,
      ctx.state.lastKnownEnemyY,
      crawlSpeed,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  exit(_ctx: INPCContext): void {
    // No cleanup required.
  }
}
