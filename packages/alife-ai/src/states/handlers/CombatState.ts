// states/handlers/CombatState.ts
// Human NPC actively engages a visible enemy.
//
// Logic:
//   enter  — nothing special (vocalization handled by caller if needed)
//   update —
//     1. No visible enemy → SEARCH (if lastKnown known) or IDLE
//     2. Morale PANICKED  → FLEE
//     3. Morale SHAKEN    → RETREAT
//     4. HP below woundedHpThreshold → WOUNDED
//     5. Visible enemy wounded (STABLE morale, opt-in) → KILL_WOUNDED
//     6. Move toward enemy when dist > combatRange, otherwise halt + check cover
//     7. Fire when cooldown elapsed
//     8. Share target with squad if available
//   exit   — nothing

import type { IOnlineStateHandler } from '../IOnlineStateHandler';
import type { INPCContext } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';
import { createDefaultTransitionMap } from '../IStateTransitionMap';
import type { IStateTransitionMap } from '../IStateTransitionMap';
import { moveToward } from './_utils';

/**
 * Stateless combat state handler for human NPCs.
 *
 * Monsters use a separate controller (MonsterCombatController from Slice 14).
 * A single instance can be shared across all NPC entities.
 */
export class CombatState implements IOnlineStateHandler {
  private readonly cfg: IStateConfig;
  private readonly tr: IStateTransitionMap;

  constructor(cfg: IStateConfig, tr?: Partial<IStateTransitionMap>) {
    this.cfg = cfg;
    this.tr = createDefaultTransitionMap(tr);
  }

  enter(_ctx: INPCContext): void {
    // No special enter action — caller may emit vocalization if desired.
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    const now = ctx.now();

    // -------------------------------------------------------------------------
    // 1. Perception: resolve visible enemy
    // -------------------------------------------------------------------------
    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    const hasEnemy = enemies.length > 0;

    if (!hasEnemy) {
      // No visual contact — transition based on whether a last position is known.
      if (ctx.state.lastKnownEnemyX !== 0 || ctx.state.lastKnownEnemyY !== 0) {
        ctx.transition(this.tr.combatOnLastKnown);
      } else {
        ctx.transition(this.tr.combatOnNoEnemy);
      }
      return;
    }

    // Update last known enemy position from the closest visible enemy.
    const enemy = enemies[0];
    ctx.state.lastKnownEnemyX = enemy.x;
    ctx.state.lastKnownEnemyY = enemy.y;

    // -------------------------------------------------------------------------
    // 2. Morale checks (highest priority after target acquisition)
    // -------------------------------------------------------------------------
    if (ctx.state.moraleState === 'PANICKED') {
      ctx.transition(this.tr.combatOnPanicked);
      return;
    }

    if (ctx.state.moraleState === 'SHAKEN') {
      ctx.transition(this.tr.combatOnShaken);
      return;
    }

    // -------------------------------------------------------------------------
    // 3. HP threshold — wounded
    // -------------------------------------------------------------------------
    if (ctx.health !== null) {
      if (ctx.health.hpPercent < this.cfg.woundedHpThreshold) {
        ctx.transition(this.tr.combatOnWounded);
        return;
      }
    }

    // -------------------------------------------------------------------------
    // 4. Kill-wounded seam (opt-in) — only when morale is STABLE
    // -------------------------------------------------------------------------
    const woundedEnemies = ctx.perception?.getWoundedEnemies?.() ?? [];
    if (woundedEnemies.length > 0) {
      const we = woundedEnemies[0];
      ctx.state.killWoundedTargetId = we.id;
      ctx.state.killWoundedTargetX  = we.x;
      ctx.state.killWoundedTargetY  = we.y;
      ctx.state.lastKnownEnemyX     = we.x;
      ctx.state.lastKnownEnemyY     = we.y;
      ctx.halt();
      ctx.transition(this.tr.combatOnKillWounded);
      return;
    }

    // -------------------------------------------------------------------------
    // 5. Movement — approach or halt
    // -------------------------------------------------------------------------
    const dx = enemy.x - ctx.x;
    const dy = enemy.y - ctx.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > this.cfg.combatRange) {
      moveToward(ctx, enemy.x, enemy.y, this.cfg.approachSpeed);
    } else {
      ctx.halt();
      ctx.setRotation(Math.atan2(dy, dx));

      // Check cover transition when already in combat range.
      if (ctx.cover !== null) {
        const coverPt = ctx.cover.findCover(ctx.x, ctx.y, enemy.x, enemy.y, 'CLOSE');
        if (coverPt !== null) {
          ctx.state.coverPointX = coverPt.x;
          ctx.state.coverPointY = coverPt.y;
          ctx.transition(this.tr.combatOnCover);
          return;
        }
      }
    }

    // -------------------------------------------------------------------------
    // 7. Fire when cooldown elapsed
    // -------------------------------------------------------------------------
    if (now - ctx.state.lastShootMs >= this.cfg.fireRateMs) {
      ctx.state.lastShootMs = now;

      const weaponType = ctx.state.primaryWeapon ?? 'rifle';
      ctx.emitShoot({
        npcId: ctx.npcId,
        x: ctx.x,
        y: ctx.y,
        targetX: enemy.x,
        targetY: enemy.y,
        weaponType,
      });
    }

    // -------------------------------------------------------------------------
    // 8. Share target with squad
    // -------------------------------------------------------------------------
    if (ctx.squad !== null) {
      ctx.squad.shareTarget(enemy.id, enemy.x, enemy.y);
    }
  }

  exit(_ctx: INPCContext): void {
    // Nothing to clean up.
  }
}
