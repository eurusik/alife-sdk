// states/handlers/MonsterCombatController.ts
// Base melee combat state handler for all monster types.
//
// Handles:
//   - Moving toward the visible enemy at approachSpeed
//   - Applying melee hits when within meleeRange (respects meleeCooldownMs)
//   - Transitioning to species-specific ability states via MonsterAbilitySelector
//   - Transitioning to SEARCH when no visual contact (last known exists)
//   - Transitioning to IDLE when no contact and no last known position
//
// Monsters do NOT use ranged weapons, grenades, or cover.
// Special ability transitions are gated by meleeCooldown to prevent
// immediate re-activation after returning from an ability state.

import type { IOnlineStateHandler } from '../IOnlineStateHandler';
import type { INPCContext } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';
import type { IStateTransitionMap } from '../IStateTransitionMap';
import { createDefaultTransitionMap } from '../IStateTransitionMap';
import { moveToward, distanceTo } from './_utils';

/**
 * Callback that selects a special ability state ID for a monster entity.
 * Return null to continue basic melee combat.
 *
 * @param entityType - The NPC's entity type string (e.g., 'boar', 'zombie')
 * @param dist - Current distance to the enemy
 * @param cfg - Current state config (for meleeRange etc.)
 * @returns State ID to transition to, or null to stay in combat
 */
export type MonsterAbilitySelector = (
  entityType: string,
  dist: number,
  cfg: IStateConfig,
) => string | null;

/**
 * Chornobyl-style ability selector preset.
 * boar→CHARGE, bloodsucker→STALK, snork→LEAP, controller→PSI_ATTACK.
 *
 * Pass this as `abilitySelector` to {@link MonsterCombatController} and
 * register the corresponding ability states in your {@link StateHandlerMap}:
 *
 * ```ts
 * const handlers = buildMonsterHandlerMap(cfg)
 *   .register(ONLINE_STATE.CHARGE,     new ChargeState(cfg))
 *   .register(ONLINE_STATE.STALK,      new StalkState(cfg))
 *   .register(ONLINE_STATE.LEAP,       new LeapState(cfg))
 *   .register(ONLINE_STATE.PSI_ATTACK, new PsiAttackState(cfg));
 *
 * // Tell MonsterCombatController to use it:
 * handlers.register(
 *   ONLINE_STATE.COMBAT,
 *   new MonsterCombatController(cfg, tr, CHORNOBYL_ABILITY_SELECTOR),
 * );
 * ```
 */
export const CHORNOBYL_ABILITY_SELECTOR: MonsterAbilitySelector = (
  entityType,
  dist,
  cfg,
) => {
  switch (entityType) {
    case 'boar':
      // Charge when the boar is beyond direct melee range.
      return dist > cfg.meleeRange ? 'CHARGE' : null;

    case 'bloodsucker':
      // Stalk when the bloodsucker is far enough to cloak without being seen.
      return dist > cfg.meleeRange * 2 ? 'STALK' : null;

    case 'snork': {
      // Leap when in medium-to-far range (beyond melee but within 3× melee).
      const leapRange = cfg.meleeRange * 3;
      return dist > cfg.meleeRange && dist <= leapRange ? 'LEAP' : null;
    }

    case 'controller':
      // PSI attack when the controller is beyond direct melee range.
      return dist > cfg.meleeRange ? 'PSI_ATTACK' : null;

    // Dogs and other unspecified types rely solely on basic melee.
    default:
      return null;
  }
};

/**
 * Stateless monster melee combat handler.
 *
 * Shared across all monster entity types. Species-specific ability
 * transitions are driven by an injectable {@link MonsterAbilitySelector}
 * callback rather than a hardcoded switch — fully agnostic.
 *
 * A single instance can be shared across all NPC entities.
 */
export class MonsterCombatController implements IOnlineStateHandler {
  private readonly tr: IStateTransitionMap;
  private readonly selectAbility: MonsterAbilitySelector;

  constructor(
    private readonly cfg: IStateConfig,
    tr?: Partial<IStateTransitionMap>,
    abilitySelector?: MonsterAbilitySelector,
  ) {
    this.tr = createDefaultTransitionMap(tr);
    this.selectAbility = abilitySelector ?? (() => null);
  }

  enter(_ctx: INPCContext): void {
    // No special enter logic for monster combat — perception/movement
    // is handled in the first update tick.
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    const now = ctx.now();

    // -----------------------------------------------------------------------
    // 1. Resolve visible enemy
    // -----------------------------------------------------------------------
    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    const hasEnemy = enemies.length > 0;

    if (!hasEnemy) {
      // No visual contact — use last known position or idle.
      if (ctx.state.lastKnownEnemyX !== 0 || ctx.state.lastKnownEnemyY !== 0) {
        ctx.transition(this.tr.monsterOnLastKnown);
      } else {
        ctx.transition(this.tr.monsterOnNoEnemy);
      }
      return;
    }

    // Update last known position from closest visible enemy.
    const enemy = enemies[0];
    ctx.state.lastKnownEnemyX = enemy.x;
    ctx.state.lastKnownEnemyY = enemy.y;
    ctx.state.targetId = enemy.id;

    // Pack broadcast (opt-in, throttled)
    if (now - ctx.state.packLastBroadcastMs >= this.cfg.packAlertIntervalMs) {
      ctx.state.packLastBroadcastMs = now;
      ctx.pack?.broadcastTarget(enemy.id, enemy.x, enemy.y);
      ctx.pack?.broadcastAlertLevel('COMBAT');
    }

    // -----------------------------------------------------------------------
    // 2. Compute distance to enemy
    // -----------------------------------------------------------------------
    const dist = distanceTo(ctx.x, ctx.y, enemy.x, enemy.y);

    // -----------------------------------------------------------------------
    // 3. Move toward enemy or halt when in melee range
    // -----------------------------------------------------------------------
    if (dist > this.cfg.meleeRange) {
      moveToward(ctx, enemy.x, enemy.y, this.cfg.approachSpeed);
    } else {
      ctx.halt();
      // Face the enemy even when standing still.
      const dx = enemy.x - ctx.x;
      const dy = enemy.y - ctx.y;
      if (dx !== 0 || dy !== 0) {
        ctx.setRotation(Math.atan2(dy, dx));
      }
    }

    // -----------------------------------------------------------------------
    // 4. Melee attack when in range and off cooldown
    // -----------------------------------------------------------------------
    if (dist <= this.cfg.meleeRange) {
      if (now - ctx.state.lastMeleeMs >= this.cfg.meleeCooldownMs) {
        ctx.state.lastMeleeMs = now;
        ctx.emitMeleeHit({
          npcId: ctx.npcId,
          targetId: enemy.id,
          damage: this.cfg.meleeDamage,
        });
      }
    }

    // -----------------------------------------------------------------------
    // 5. Special ability transitions (only when melee cooldown is expired)
    // -----------------------------------------------------------------------
    const meleeCooldownRemaining = this.cfg.meleeCooldownMs - (now - ctx.state.lastMeleeMs);
    if (meleeCooldownRemaining <= 0) {
      const abilityTransition = this.selectAbility(ctx.entityType, dist, this.cfg);
      if (abilityTransition !== null) {
        ctx.transition(abilityTransition);
      }
    }
  }

  exit(_ctx: INPCContext): void {
    // No cleanup needed.
  }
}
