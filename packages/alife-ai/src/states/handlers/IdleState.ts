// states/handlers/IdleState.ts
// NPC stands still and waits. Lowest-activity state for non-sleeping NPCs.
//
// Transitions out of IDLE:
//   - visible enemy detected via ctx.perception         → ALERT
//   - NPC standing inside a DANGER restricted zone      → ALERT (walk away first)
//   - accumulated suspicion exceeds threshold (opt-in)  → ALERT (via idleOnSuspicious)
//   - wounded ally detected (opt-in)                    → HELP_WOUNDED (via idleOnWoundedAlly)
//   - friendly corpse seen (opt-in)                     → suspicion.add(BODY_FOUND) → cascades
//   - condition channel above threshold (opt-in)        → CAMP  (via idleOnTired)
//
// Note: this is the "calm" default fallback. When the NPC has a patrol task
// assigned, the host should put it in PATROL instead.

import type { IOnlineStateHandler } from '../IOnlineStateHandler';
import type { INPCContext } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';
import { createDefaultTransitionMap } from '../IStateTransitionMap';
import type { IStateTransitionMap } from '../IStateTransitionMap';
import { moveToward } from './_utils';
import { SuspicionStimuli } from '../../suspicion/SuspicionAccumulator';

/**
 * Stateless idle-state handler.
 *
 * A single instance can be shared across all NPC entities.
 */
export class IdleState implements IOnlineStateHandler {
  private readonly cfg: IStateConfig;
  private readonly tr: IStateTransitionMap;

  constructor(cfg: IStateConfig, tr?: Partial<IStateTransitionMap>) {
    this.cfg = cfg;
    this.tr = createDefaultTransitionMap(tr);
  }

  enter(ctx: INPCContext): void {
    ctx.halt();
    // Seed the zone check timer so the check fires on the first update tick.
    ctx.state.lastIdleAnimChangeMs = ctx.now() - this.cfg.restrictedZoneCheckIntervalMs;
    // Reset per-entry corpse deduplication so corpses not yet reacted to
    // can still add suspicion when re-entering IDLE from another state.
    ctx.state.seenCorpseIds = undefined;
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    // --- Perception: any visible enemy → go to ALERT ---
    if (ctx.perception?.hasVisibleEnemy()) {
      const enemies = ctx.perception.getVisibleEnemies();
      const target  = enemies[0];
      ctx.state.lastKnownEnemyX = target.x;
      ctx.state.lastKnownEnemyY = target.y;
      ctx.transition(this.tr.idleOnEnemy);
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
        ctx.transition(this.tr.idleOnPackAlert);
        return;
      }
    }

    // --- Restricted zone DANGER check (throttled) ---
    // Use lastIdleAnimChangeMs as the zone-check timestamp to avoid adding a
    // new field — the semantics ("last periodic check") are close enough.
    const now = ctx.now();
    const timeSinceCheck = now - ctx.state.lastIdleAnimChangeMs;

    if (
      timeSinceCheck >= this.cfg.restrictedZoneCheckIntervalMs &&
      ctx.restrictedZones !== null
    ) {
      ctx.state.lastIdleAnimChangeMs = now;

      if (!ctx.restrictedZones.isAccessible(ctx.x, ctx.y)) {
        // NPC is standing inside a restricted/dangerous zone.
        // Escape direction: pick a safe nearby point by filtering a small set of
        // cardinal candidate positions and walking toward the first accessible one.
        const step = this.cfg.approachSpeed * 2;
        const candidates = [
          { x: ctx.x + step, y: ctx.y },
          { x: ctx.x - step, y: ctx.y },
          { x: ctx.x,        y: ctx.y + step },
          { x: ctx.x,        y: ctx.y - step },
        ];

        const safe = ctx.restrictedZones.filterAccessible(candidates);
        if (safe.length > 0) {
          // Walk toward the safe exit without touching lastKnownEnemyX/Y —
          // writing those fields would broadcast a false enemy position to the
          // pack and cause all nearby NPCs to converge on this coordinate.
          // The NPC stays in IDLE; the throttle ensures we re-check each
          // restrictedZoneCheckIntervalMs until it has cleared the zone.
          moveToward(ctx, safe[0].x, safe[0].y, this.cfg.approachSpeed);
        }
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
      ctx.transition(this.tr.idleOnSuspicious);
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
      ctx.transition(this.tr.idleOnWoundedAlly);
      return;
    }

    // --- Corpse detection (opt-in via getVisibleCorpses + suspicion) ---
    // Feeds suspicion accumulator; the existing suspicion check above handles transition.
    // Each corpse only contributes suspicion once per IDLE entry (seenCorpseIds is
    // cleared in enter()) to prevent the same static corpse from filling the accumulator
    // every frame and causing an IDLE→ALERT→IDLE oscillation.
    if (ctx.suspicion) {
      for (const c of ctx.perception?.getVisibleCorpses?.() ?? []) {
        if (ctx.state.seenCorpseIds?.has(c.id)) continue;
        (ctx.state.seenCorpseIds ??= new Set()).add(c.id);
        ctx.suspicion.add(SuspicionStimuli.BODY_FOUND, this.cfg.corpseFoundSuspicion, c.x, c.y);
      }
    }

    // --- Condition check (opt-in) ---
    // Silently skips when ctx.conditions is null or not registered.
    if (ctx.conditions?.hasCondition(this.cfg.idleConditionChannel, this.cfg.idleConditionThreshold)) {
      ctx.transition(this.tr.idleOnTired);
      return;
    }
  }

  exit(_ctx: INPCContext): void {
    // Nothing to clean up.
  }
}
