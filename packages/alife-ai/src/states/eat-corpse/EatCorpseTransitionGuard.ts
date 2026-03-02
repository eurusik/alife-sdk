// states/eat-corpse/EatCorpseTransitionGuard.ts
// Decorator that adds periodic corpse-hunger checks to calm-state handlers.

import type { IOnlineStateHandler } from '../IOnlineStateHandler';
import type { INPCContext } from '../INPCContext';
import type { ICorpseSource } from './ICorpseSource';
import { createDefaultEatCorpseGuardConfig } from './IEatCorpseConfig';
import type { IEatCorpseGuardConfig } from './IEatCorpseConfig';

/**
 * Wraps an existing calm-state handler (IDLE, PATROL, CAMP, etc.) with a
 * periodic hunger check. When the NPC's HP drops below `hungerHpThreshold`,
 * a random roll is performed, and if corpses are nearby, the NPC transitions
 * to `eatStateId` (default `'EAT_CORPSE'`).
 *
 * The inner handler's behavior is fully preserved — enter, update, and exit
 * are all forwarded before the hunger check runs.
 *
 * **Memory**: stores a `Map<string, number>` (npcId → lastCheckMs) in the
 * decorator closure. Entries are removed in `exit()` to prevent leaks.
 *
 * @example
 * ```ts
 * // Wrap IDLE and PATROL so dogs/boars look for corpses while calm:
 * const idleWithEating = withEatCorpseGuard(handlers.get('IDLE')!, corpseSource, {
 *   allowedEntityTypes: ['dog', 'boar'],
 *   hungerHpThreshold: 0.7,
 * });
 * handlers.set('IDLE', idleWithEating);
 * handlers.set('PATROL', withEatCorpseGuard(handlers.get('PATROL')!, corpseSource, {
 *   allowedEntityTypes: ['dog', 'boar'],
 * }));
 * ```
 *
 * @param inner      - The handler to wrap.
 * @param corpseSource - Host-provided corpse discovery service.
 * @param guardCfg   - Optional config overrides.
 */
export function withEatCorpseGuard(
  inner: IOnlineStateHandler,
  corpseSource: ICorpseSource,
  guardCfg?: Partial<IEatCorpseGuardConfig>,
): IOnlineStateHandler {
  const cfg = createDefaultEatCorpseGuardConfig(guardCfg);
  // Per-NPC last-check timestamps, stored in decorator closure.
  const lastCheckMs = new Map<string, number>();

  return {
    enter(ctx: INPCContext): void {
      inner.enter(ctx);
    },

    exit(ctx: INPCContext): void {
      inner.exit(ctx);
      lastCheckMs.delete(ctx.npcId);
    },

    update(ctx: INPCContext, deltaMs: number): void {
      // Capture current state ID before delegating so we can detect if the
      // inner handler already triggered a transition (e.g. IDLE spotted an
      // enemy and called ctx.transition('ALERT')). If the state changed we
      // must bail — overriding a completed transition would cause the NPC to
      // ignore threats and walk toward corpses during combat.
      const stateBefore = ctx.currentStateId;
      inner.update(ctx, deltaMs);
      if (ctx.currentStateId !== stateBefore) return;

      // Entity-type filter (skip if this NPC type doesn't eat).
      if (
        cfg.allowedEntityTypes !== null &&
        !cfg.allowedEntityTypes.includes(ctx.entityType)
      ) {
        return;
      }

      // Throttle: only check every checkIntervalMs.
      // Use -Infinity as sentinel so the very first call always proceeds
      // regardless of ctx.now() value (even if it returns 0).
      const now = ctx.now();
      const last = lastCheckMs.get(ctx.npcId) ?? -Infinity;
      if (now - last < cfg.checkIntervalMs) return;
      lastCheckMs.set(ctx.npcId, now);

      // Only hungry NPCs look for food.
      if ((ctx.health?.hpPercent ?? 1) > cfg.hungerHpThreshold) return;

      // Probabilistic roll to avoid every NPC eating at the same moment.
      if (ctx.random() >= cfg.eatProbability) return;

      // Pre-flight corpse check — avoids EAT_CORPSE enter/exit ping-pong.
      const corpses = corpseSource.findCorpses(
        ctx.npcId, ctx.x, ctx.y, cfg.searchRadius,
      );
      if (corpses.length === 0) return;

      ctx.transition(cfg.eatStateId);
    },
  };
}
