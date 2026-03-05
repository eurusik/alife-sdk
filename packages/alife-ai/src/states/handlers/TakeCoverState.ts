// states/handlers/TakeCoverState.ts
// NPC shelters at a cover point and uses a loophole peek-fire cycle.
//
// Loophole phase cycle:
//   WAIT   — NPC halts behind cover. Duration: random [loopholeWaitMinMs, loopholeWaitMaxMs].
//   PEEK   — NPC moves toward cover point. Duration: loopholePeekDurationMs.
//   FIRE   — NPC emits shoot, stays in place. Duration: loopholeFireDurationMs.
//   RETURN — NPC moves back / waits to return. Duration: loopholeReturnDurationMs.
//
// Transitions out:
//   - No visible enemy → SEARCH
//   - Morale PANICKED  → FLEE
//   - Morale SHAKEN    → RETREAT
//
// enter: find cover, set coverPointX/Y, init loophole state
// exit:  clear hasTakenCover + loophole

import type { IOnlineStateHandler } from '../IOnlineStateHandler';
import type { INPCContext } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';
import { createDefaultTransitionMap } from '../IStateTransitionMap';
import type { IStateTransitionMap } from '../IStateTransitionMap';
import { moveToward } from './_utils';

/**
 * Stateless take-cover state handler.
 *
 * A single instance can be shared across all NPC entities.
 */
export class TakeCoverState implements IOnlineStateHandler {
  private readonly cfg: IStateConfig;
  private readonly tr: IStateTransitionMap;

  constructor(cfg: IStateConfig, tr?: Partial<IStateTransitionMap>) {
    this.cfg = cfg;
    this.tr = createDefaultTransitionMap(tr);
  }

  enter(ctx: INPCContext): void {
    // Attempt to find a cover point using the cover subsystem.
    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    const enemy = enemies[0] ?? null;

    let coverPt: { x: number; y: number } | null = null;

    if (ctx.cover !== null && enemy !== null) {
      coverPt = ctx.cover.findCover(ctx.x, ctx.y, enemy.x, enemy.y);
    } else if (ctx.cover !== null) {
      // No enemy visible, find any nearby cover.
      coverPt = ctx.cover.findCover(ctx.x, ctx.y, ctx.x, ctx.y);
    }

    if (coverPt !== null) {
      // Lock the cover point; if contested, clear the selection so the NPC
      // does not march into a point already occupied by another NPC.
      const locked = ctx.cover?.lockLastFound?.(ctx.npcId) ?? true;
      if (locked) {
        ctx.state.coverPointX = coverPt.x;
        ctx.state.coverPointY = coverPt.y;
      } else {
        coverPt = null; // eslint-disable-line no-useless-assignment
      }
    }
    // If no cover found, we still enter — the NPC will try to move to last
    // known coverPointX/Y (which may be 0,0 as fallback).

    ctx.state.hasTakenCover = false;

    // Initialise the loophole cycle starting in WAIT phase.
    const waitDuration =
      this.cfg.loopholeWaitMinMs +
      ctx.random() * (this.cfg.loopholeWaitMaxMs - this.cfg.loopholeWaitMinMs);

    ctx.state.loophole = {
      phase: 'WAIT',
      phaseStartMs: ctx.now(),
    };

    // Store wait duration as a scratch value in phaseStartMs offset.
    // We re-use phaseStartMs + phase duration to know when to advance.
    // The actual wait end is computed as: phaseStartMs + waitDuration.
    // Save waitDuration separately via a small trick: store -(waitDuration) in
    // lastGrenadeMs as a per-NPC scratch. This avoids adding new fields.
    // Instead, simpler: store the wait-end timestamp directly in lastGrenadeMs.
    ctx.state.lastGrenadeMs = ctx.now() + waitDuration;
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    const now = ctx.now();

    // -------------------------------------------------------------------------
    // Morale + perception exit checks
    // -------------------------------------------------------------------------
    if (ctx.state.moraleState === 'PANICKED') {
      ctx.transition(this.tr.takeCoverOnPanicked);
      return;
    }

    if (ctx.state.moraleState === 'SHAKEN') {
      ctx.transition(this.tr.takeCoverOnShaken);
      return;
    }

    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    const hasEnemy = enemies.length > 0;

    if (!hasEnemy) {
      ctx.transition(this.tr.takeCoverOnNoEnemy);
      return;
    }

    // Update last known enemy position.
    const enemy = enemies[0];
    ctx.state.lastKnownEnemyX = enemy.x;
    ctx.state.lastKnownEnemyY = enemy.y;

    // -------------------------------------------------------------------------
    // Ensure loophole state is initialised (safety guard).
    // -------------------------------------------------------------------------
    if (ctx.state.loophole === null) {
      const waitDuration =
        this.cfg.loopholeWaitMinMs +
        ctx.random() * (this.cfg.loopholeWaitMaxMs - this.cfg.loopholeWaitMinMs);
      ctx.state.loophole = { phase: 'WAIT', phaseStartMs: now };
      ctx.state.lastGrenadeMs = now + waitDuration;
    }

    // -------------------------------------------------------------------------
    // Move to cover point if not yet there.
    // -------------------------------------------------------------------------
    if (!ctx.state.hasTakenCover) {
      const dx = ctx.state.coverPointX - ctx.x;
      const dy = ctx.state.coverPointY - ctx.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > this.cfg.arriveThreshold) {
        moveToward(ctx, ctx.state.coverPointX, ctx.state.coverPointY, this.cfg.approachSpeed);
        return;
      }
      ctx.state.hasTakenCover = true;
      ctx.halt();
    }

    // -------------------------------------------------------------------------
    // Loophole phase state machine.
    // -------------------------------------------------------------------------
    const loophole = ctx.state.loophole;

    switch (loophole.phase) {

      // -----------------------------------------------------------------------
      // WAIT: NPC crouches behind cover.
      // -----------------------------------------------------------------------
      case 'WAIT': {
        ctx.halt();
        // ctx.state.lastGrenadeMs stores the wait-end timestamp.
        if (now >= ctx.state.lastGrenadeMs) {
          loophole.phase = 'PEEK';
          loophole.phaseStartMs = now;
        }
        break;
      }

      // -----------------------------------------------------------------------
      // PEEK: NPC moves toward the cover peek position (= cover centre for now).
      // -----------------------------------------------------------------------
      case 'PEEK': {
        const elapsed = now - loophole.phaseStartMs;
        if (elapsed >= this.cfg.loopholePeekDurationMs) {
          ctx.halt();
          loophole.phase = 'FIRE';
          loophole.phaseStartMs = now;
        } else {
          // Move toward enemy slightly — simulate peeking out of cover.
          moveToward(ctx, enemy.x, enemy.y, this.cfg.approachSpeed * 0.5);
        }
        break;
      }

      // -----------------------------------------------------------------------
      // FIRE: NPC holds and fires at enemy.
      // -----------------------------------------------------------------------
      case 'FIRE': {
        const elapsed = now - loophole.phaseStartMs;
        ctx.halt();

        // Face the enemy.
        const dx = enemy.x - ctx.x;
        const dy = enemy.y - ctx.y;
        if (dx !== 0 || dy !== 0) {
          ctx.setRotation(Math.atan2(dy, dx));
        }

        // Fire at fire rate.
        if (now - ctx.state.lastShootMs >= this.cfg.fireRateMs) {
          ctx.state.lastShootMs = now;
          ctx.emitShoot({
            npcId: ctx.npcId,
            x: ctx.x,
            y: ctx.y,
            targetX: enemy.x,
            targetY: enemy.y,
            weaponType: ctx.state.primaryWeapon ?? 'rifle',
          });
        }

        if (elapsed >= this.cfg.loopholeFireDurationMs) {
          loophole.phase = 'RETURN';
          loophole.phaseStartMs = now;
        }
        break;
      }

      // -----------------------------------------------------------------------
      // RETURN: NPC moves back to cover centre.
      // -----------------------------------------------------------------------
      case 'RETURN': {
        const elapsed = now - loophole.phaseStartMs;

        if (elapsed >= this.cfg.loopholeReturnDurationMs) {
          ctx.halt();
          // Start next WAIT phase.
          const waitDuration =
            this.cfg.loopholeWaitMinMs +
            ctx.random() * (this.cfg.loopholeWaitMaxMs - this.cfg.loopholeWaitMinMs);
          loophole.phase = 'WAIT';
          loophole.phaseStartMs = now;
          ctx.state.lastGrenadeMs = now + waitDuration;
        } else {
          // Move back toward cover point.
          moveToward(ctx, ctx.state.coverPointX, ctx.state.coverPointY, this.cfg.approachSpeed);
        }
        break;
      }
    }
  }

  exit(ctx: INPCContext): void {
    ctx.state.hasTakenCover = false;
    ctx.state.loophole = null;
    ctx.cover?.unlockAll?.(ctx.npcId);
  }
}
