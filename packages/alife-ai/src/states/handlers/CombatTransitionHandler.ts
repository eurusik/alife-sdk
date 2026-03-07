// states/handlers/CombatTransitionHandler.ts
// Coordinator that wraps the pure-function CombatTransitionChain for use as a
// state handler.
//
// Bridges INPCContext → ICombatContext so the existing SDK logic can evaluate
// all priority-ordered transition rules and return the appropriate next state.
//
// enter:  nothing
// update: build ICombatContext snapshot from ctx, run evaluateTransitions(),
//         call ctx.transition() if a rule fires
// exit:   nothing

import type { IOnlineStateHandler } from '../IOnlineStateHandler';
import type { INPCContext } from '../INPCContext';
import type { IStateConfig } from '../IStateConfig';
import type { IStateTransitionMap } from '../IStateTransitionMap';
import {
  evaluateTransitions,
  createDefaultCombatTransitionConfig,
  DEFAULT_COMBAT_RULES,
} from '../../combat/CombatTransitionChain';
import type {
  ICombatContext,
  ICombatTransitionConfig,
  ITransitionRule,
} from '../../combat/CombatTransitionChain';
import { WeaponCategory } from '../../types/IWeaponTypes';
import type { INPCLoadout } from '../../types/IWeaponTypes';

/**
 * Stateless combat-transition coordinator handler.
 *
 * Consumes the pure-function CombatTransitionChain and bridges it to the
 * INPCContext facade so any state handler can delegate complex transition
 * evaluation without duplicating rule logic.
 *
 * A single instance can be shared across all NPC entities.
 */
export class CombatTransitionHandler implements IOnlineStateHandler {
  private readonly transitionCfg: ICombatTransitionConfig;
  private readonly rules: readonly ITransitionRule[];

  constructor(
    private readonly cfg: IStateConfig,
    transitionCfgOverrides?: Partial<ICombatTransitionConfig>,
    rules?: readonly ITransitionRule[],
    _tr?: Partial<IStateTransitionMap>,
  ) {
    this.transitionCfg = createDefaultCombatTransitionConfig({
      woundedHpThreshold: cfg.woundedHpThreshold,
      retreatMoraleThreshold: cfg.retreatMoraleThreshold,
      ...transitionCfgOverrides,
    });
    this.rules = rules ?? DEFAULT_COMBAT_RULES;
  }

  enter(_ctx: INPCContext): void {
    // Nothing to set up.
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    const snapshot = this._buildSnapshot(ctx);
    const next = evaluateTransitions(this.rules, snapshot, this.transitionCfg);
    if (next !== null) {
      ctx.transition(next);
    }
  }

  exit(_ctx: INPCContext): void {
    // Nothing to clean up.
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Build a framework-agnostic ICombatContext snapshot from INPCContext.
   */
  private _buildSnapshot(ctx: INPCContext): ICombatContext {
    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    const enemy = enemies[0] ?? null;

    const hpRatio =
      ctx.health !== null
        ? ctx.health.hpPercent
        : 1;

    const moraleValue = ctx.state.morale;
    const isPanicked = ctx.state.moraleState === 'PANICKED';

    // Lost sight: if no visible enemy, estimate time since last known position.
    // We treat lastShootMs as a proxy for "last active combat tick". If there is
    // a visible enemy, lostSightMs = 0.
    const lostSightMs = enemy !== null
      ? 0
      : (ctx.state.lastShootMs > 0 ? ctx.now() - ctx.state.lastShootMs : Infinity);

    const distanceToEnemy = enemy !== null
      ? Math.sqrt(
          Math.pow(enemy.x - ctx.x, 2) + Math.pow(enemy.y - ctx.y, 2),
        )
      : Math.sqrt(
          Math.pow(ctx.state.lastKnownEnemyX - ctx.x, 2) +
          Math.pow(ctx.state.lastKnownEnemyY - ctx.y, 2),
        );

    // Target-inertia: can switch target if lock expired.
    const canSwitchTarget = ctx.now() >= ctx.state.targetLockUntilMs;

    // Explosive danger check via danger subsystem.
    const hasExplosiveDanger =
      ctx.danger?.getGrenadeDanger(ctx.x, ctx.y)?.active ?? false;

    // Build a minimal loadout from state bag.
    const loadout = this._buildLoadout(ctx);

    // Has ammo if primary or secondary has ammo, or we have no loadout (default: has ammo).
    const hasAmmo =
      (loadout.primary !== null && loadout.primary.ammo > 0) ||
      (loadout.secondary !== null && loadout.secondary.ammo > 0) ||
      (loadout.primary === null && loadout.secondary === null);

    // Time since wounded: use woundedStartMs as a proxy.
    const timeSinceWoundedMs =
      ctx.state.woundedStartMs > 0
        ? ctx.now() - ctx.state.woundedStartMs
        : Infinity;

    return {
      hpRatio,
      moraleValue,
      isPanicked,
      lostSightMs,
      distanceToEnemy,
      visibleEnemyCount: enemies.length,
      loadout,
      canSwitchTarget,
      timeSinceWoundedMs,
      hasExplosiveDanger,
      hasAmmo,
    };
  }

  /**
   * Build a minimal INPCLoadout from the NPC's state bag.
   * Returns a loadout with no weapons when the state has no weapon info,
   * which signals the chain to fall back to default behaviour.
   */
  private _buildLoadout(ctx: INPCContext): INPCLoadout {
    const primaryWeapon = ctx.state.primaryWeapon;
    const secondaryWeapon = ctx.state.secondaryWeapon;

    // Create minimal weapon slots with reasonable defaults when weapon type is known.
    const primary = primaryWeapon !== null
      ? {
          category: WeaponCategory.RIFLE,
          ammo: 30,
          maxAmmo: 30,
          range: { min: 100, max: 400 },
          damage: this.cfg.bulletDamage,
          fireRate: 1,
        }
      : null;

    const secondary = secondaryWeapon !== null
      ? {
          category: WeaponCategory.PISTOL,
          ammo: 15,
          maxAmmo: 15,
          range: { min: 0, max: 200 },
          damage: this.cfg.bulletDamage * 0.7,
          fireRate: 1,
        }
      : null;

    return {
      primary,
      secondary,
      grenades: ctx.state.grenadeCount,
      medkits: ctx.state.medkitCount,
    };
  }
}
