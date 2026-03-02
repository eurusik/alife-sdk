// states/eat-corpse/EatCorpseState.ts
// Opt-in state handler: predatory NPC approaches and consumes a nearby corpse.
//
// Phase cycle:
//   APPROACH — NPC moves toward the target corpse.
//   EATING   — NPC halts at the corpse for eatDurationMs.
//   DONE     — Reward applied, consumeCorpse() called, transition out.
//
// Transitions out:
//   - Eating complete      → eatCorpseOnDone     (default: 'IDLE')
//   - No corpse in radius  → eatCorpseOnNoCorpse (default: 'IDLE')
//   - Enemy spotted        → eatCorpseOnInterrupt (default: 'ALERT')
//
// enter: find nearest corpse, set phase data
// exit:  mark phase inactive (corpse NOT consumed unless eating completed)
//
// Opt-in: never registered by buildDefaultHandlerMap / buildMonsterHandlerMap.
// Register manually:
//   handlerMap.set('EAT_CORPSE', new EatCorpseState(cfg, tr, corpseSource));

import type { IOnlineStateHandler } from '../IOnlineStateHandler';
import type { INPCContext } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';
import { createDefaultTransitionMap } from '../IStateTransitionMap';
import type { IStateTransitionMap } from '../IStateTransitionMap';
import { moveToward, distanceTo } from '../handlers/_utils';
import type { ICorpseSource } from './ICorpseSource';
import { createDefaultEatCorpseConfig } from './IEatCorpseConfig';
import type { IEatCorpseConfig } from './IEatCorpseConfig';

/**
 * Stateless EAT_CORPSE state handler for predatory NPCs.
 *
 * A single instance can be shared across all NPC entities.
 *
 * @example
 * ```ts
 * // Register alongside the default monster handler map:
 * const handlers = buildMonsterHandlerMap(cfg, {
 *   monsterOnNoEnemy: 'EAT_CORPSE',   // try eating after a kill
 *   eatCorpseOnNoCorpse: 'IDLE',      // nothing nearby? just idle
 * });
 * handlers.set('EAT_CORPSE', new EatCorpseState(cfg, tr, corpseSource));
 * ```
 */
export class EatCorpseState implements IOnlineStateHandler {
  private readonly cfg: IStateConfig;
  private readonly tr: IStateTransitionMap;
  private readonly source: ICorpseSource;
  private readonly eatCfg: IEatCorpseConfig;

  constructor(
    cfg: IStateConfig,
    tr: Partial<IStateTransitionMap> | undefined,
    corpseSource: ICorpseSource,
    eatCfg?: Partial<IEatCorpseConfig>,
  ) {
    this.cfg = cfg;
    this.tr = createDefaultTransitionMap(tr);
    this.source = corpseSource;
    this.eatCfg = createDefaultEatCorpseConfig(eatCfg);
  }

  enter(ctx: INPCContext): void {
    const corpses = this.source.findCorpses(
      ctx.npcId, ctx.x, ctx.y, this.eatCfg.searchRadius,
    );

    if (corpses.length === 0) {
      ctx.transition(this.tr.eatCorpseOnNoCorpse);
      return;
    }

    const target = corpses[0];

    // Lazy-init phase bag — zero cost for NPCs that never eat.
    ctx.state.eatCorpsePhase ??= {
      active: false,
      corpseId: '',
      corpseX: 0,
      corpseY: 0,
      healAmount: 0,
      eatStartMs: 0,
      eating: false,
    };

    const phase = ctx.state.eatCorpsePhase;
    phase.active    = true;
    phase.corpseId  = target.id;
    phase.corpseX   = target.x;
    phase.corpseY   = target.y;
    phase.healAmount = target.healAmount;
    phase.eatStartMs = 0;
    phase.eating    = false;

    ctx.emitVocalization('EAT_CORPSE_START');
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    const phase = ctx.state.eatCorpsePhase;
    if (!phase?.active) {
      ctx.transition(this.tr.eatCorpseOnNoCorpse);
      return;
    }

    // Interrupt: enemy spotted (even while eating).
    if (ctx.perception?.hasVisibleEnemy()) {
      const enemy = ctx.perception.getVisibleEnemies()[0];
      ctx.state.lastKnownEnemyX = enemy.x;
      ctx.state.lastKnownEnemyY = enemy.y;
      ctx.state.targetId = enemy.id;
      ctx.transition(this.tr.eatCorpseOnInterrupt);
      return;
    }

    const now = ctx.now();

    // APPROACH phase: move toward corpse until close enough.
    if (!phase.eating) {
      const dist = distanceTo(ctx.x, ctx.y, phase.corpseX, phase.corpseY);
      if (dist > this.eatCfg.arriveThreshold) {
        const speed = this.eatCfg.approachSpeed ?? this.cfg.approachSpeed;
        moveToward(ctx, phase.corpseX, phase.corpseY, speed);
        return;
      }
      // Arrived — start eating.
      phase.eating = true;
      phase.eatStartMs = now;
      ctx.halt();
      return;
    }

    // EATING phase: wait for duration then apply reward.
    ctx.halt();

    if (now - phase.eatStartMs >= this.eatCfg.eatDurationMs) {
      // consumeCorpse returns false if another NPC already consumed this
      // corpse during the approach/eating phase (TOCTOU race). Gate heal and
      // morale reward on successful consumption — always transition out.
      const consumed = this.source.consumeCorpse(ctx.npcId, phase.corpseId);
      if (consumed) {
        if (phase.healAmount > 0) {
          ctx.health?.heal(phase.healAmount);
        }
        ctx.state.morale = Math.min(1, Math.max(-1,
          ctx.state.morale + this.eatCfg.moraleBoost));
      }
      ctx.emitVocalization('EAT_CORPSE_DONE');
      ctx.transition(this.tr.eatCorpseOnDone);
    }
  }

  exit(ctx: INPCContext): void {
    if (ctx.state.eatCorpsePhase) {
      ctx.state.eatCorpsePhase.active = false;
    }
  }
}
