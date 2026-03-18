// states/handlers/RetreatState.ts
// NPC makes a tactical retreat to FAR cover while periodically firing
// suppressive shots toward the last known enemy position.
//
// Behaviour summary:
//   enter()  — find FAR cover via ctx.cover?.findCover('FAR', ...).
//              Store cover destination in ctx.state.coverPointX/Y.
//   update() — per frame:
//              1. If morale PANICKED → FLEE (panic overrides tactics).
//              2. Move toward the cover point at approachSpeed.
//              3. At cover: fire suppressive burst every retreatFireIntervalMs
//                 via ctx.emitShoot(); wait for morale to recover.
//              4. If morale recovers to STABLE while at cover → COMBAT.
//              5. If no visible enemy and at cover → SEARCH.
//              6. If no cover found: flee away from last known enemy.
//   exit()   — halt().
//
// State ID: 'RETREAT'
// Transitions: → 'FLEE' (panic) | 'COMBAT' (morale stable) | 'SEARCH' (no enemy)

import type { IOnlineStateHandler } from '../IOnlineStateHandler';
import type { INPCContext } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';
import { createDefaultTransitionMap } from '../IStateTransitionMap';
import type { IStateTransitionMap } from '../IStateTransitionMap';
import { moveToward, awayFrom } from './_utils';

/**
 * Stateless retreat-state handler.
 *
 * A single instance can be shared across all NPC entities.
 */
export class RetreatState implements IOnlineStateHandler {
  private readonly cfg: IStateConfig;
  private readonly tr: IStateTransitionMap;

  constructor(cfg: IStateConfig, tr?: Partial<IStateTransitionMap>) {
    this.cfg = cfg;
    this.tr = createDefaultTransitionMap(tr);
  }

  enter(ctx: INPCContext): void {
    // Determine enemy reference position for cover query.
    const enemyX = ctx.state.lastKnownEnemyX;
    const enemyY = ctx.state.lastKnownEnemyY;

    // Find a FAR cover point — maximises distance from the known threat.
    const coverPoint = ctx.cover?.findCover(
      ctx.x, ctx.y,
      enemyX, enemyY,
      'FAR',
    ) ?? null;

    if (coverPoint) {
      // Lock the cover point; if contested, treat as no cover found.
      const locked = ctx.cover?.lockLastFound?.(ctx.npcId) ?? true;
      if (locked) {
        ctx.state.coverPointX = coverPoint.x;
        ctx.state.coverPointY = coverPoint.y;
        ctx.state.hasTakenCover = false;
      } else {
        // Lock contested — signal "no cover" so update() uses awayFrom().
        ctx.state.hasTakenCover = false;
        ctx.state.coverPointX = NaN;
        ctx.state.coverPointY = NaN;
      }
    } else {
      // No cover found — signal "no cover" so update() uses awayFrom().
      ctx.state.hasTakenCover = false;
      ctx.state.coverPointX = NaN;
      ctx.state.coverPointY = NaN;
    }

    // Allow an immediate first suppressive burst on enter.
    ctx.state.lastSuppressiveFireMs = 0;

    // Record entry time so the no-cover flee path can be time-bounded.
    ctx.state.retreatStartMs = ctx.now();
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    // --- PANICKED: panic overrides all tactical behaviour → FLEE ---
    if (ctx.state.moraleState === 'PANICKED') {
      ctx.halt();
      ctx.transition(this.tr.retreatOnPanicked);
      return;
    }

    const now     = ctx.now();
    const dx      = ctx.state.coverPointX - ctx.x;
    const dy      = ctx.state.coverPointY - ctx.y;
    const distSq  = dx * dx + dy * dy;
    const arrived = distSq <= this.cfg.arriveThreshold * this.cfg.arriveThreshold;

    if (!arrived) {
      // --- Move toward the FAR cover point at normal approach speed ---
      const hasCoverDest = !Number.isNaN(ctx.state.coverPointX);

      if (hasCoverDest) {
        moveToward(ctx, ctx.state.coverPointX, ctx.state.coverPointY, this.cfg.approachSpeed);
      } else {
        // No cover destination — run away from last known enemy.
        // Enforce a maximum duration so the NPC eventually stops fleeing and
        // transitions to SEARCH rather than running forever.
        if (now - ctx.state.retreatStartMs >= this.cfg.retreatMaxDurationMs) {
          ctx.halt();
          ctx.transition(this.tr.retreatOnNoEnemy);
          return;
        }
        awayFrom(
          ctx,
          ctx.state.lastKnownEnemyX,
          ctx.state.lastKnownEnemyY,
          this.cfg.approachSpeed,
        );
      }
      return;
    }

    // --- Arrived at cover ---
    ctx.halt();

    // --- Suppressive fire: emit shoot every retreatFireIntervalMs ---
    const timeSinceFire = now - ctx.state.lastSuppressiveFireMs;
    if (timeSinceFire >= this.cfg.retreatFireIntervalMs) {
      ctx.state.lastSuppressiveFireMs = now;

      // Use visible enemy position or fall back to last known.
      let targetX = ctx.state.lastKnownEnemyX;
      let targetY = ctx.state.lastKnownEnemyY;

      if (ctx.perception?.hasVisibleEnemy()) {
        const enemies = ctx.perception.getVisibleEnemies();
        if (enemies.length > 0) {
          targetX = enemies[0].x;
          targetY = enemies[0].y;
        }
      }

      // Only emit shoot if we have a non-trivial direction.
      const sdx = targetX - ctx.x;
      const sdy = targetY - ctx.y;
      if (sdx !== 0 || sdy !== 0) {
        ctx.emitShoot({
          npcId:    ctx.npcId,
          x:        ctx.x,
          y:        ctx.y,
          targetX,
          targetY,
          weaponType: ctx.state.primaryWeapon ?? 'rifle',
        });
      }
    }

    // --- Morale recovered while at cover → return to COMBAT ---
    if (ctx.state.moraleState === 'STABLE') {
      ctx.transition(this.tr.retreatOnStable);
      return;
    }

    // --- No visible enemy while at cover → SEARCH ---
    if (ctx.perception !== null && !ctx.perception.hasVisibleEnemy()) {
      ctx.transition(this.tr.retreatOnNoEnemy);
      return;
    }
  }

  exit(ctx: INPCContext): void {
    ctx.halt();
    ctx.cover?.unlockAll?.(ctx.npcId);
  }
}
