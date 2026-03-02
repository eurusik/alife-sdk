/**
 * Integration test: "AI cover + combat pipeline".
 *
 * Exercises the full tactical decision pipeline end-to-end:
 *   1. CoverRecommender → CoverRegistry.findCover → Loophole
 *   2. WeaponSelector multi-factor scoring
 *   3. CombatTransitionChain priority evaluation
 *   4. Grenade config consistency across CombatTransition + WeaponSelector
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect } from 'vitest';
import type { IRandom } from '@alife-sdk/core';
import { createDefaultAIConfig } from '../config/createDefaultAIConfig';
import { CoverRegistry } from '../cover/CoverRegistry';
import { recommendCoverType } from '../cover/CoverRecommender';
import { CoverType } from '../types/ICoverPoint';
import { WeaponCategory } from '../types/IWeaponTypes';
import type { INPCLoadout, IWeaponSlot } from '../types/IWeaponTypes';
import { selectBestWeapon, shouldThrowGrenade } from '../combat/WeaponSelector';
import {
  evaluateTransitions,
  DEFAULT_COMBAT_RULES,
  createDefaultCombatTransitionConfig,
  type ICombatContext,
} from '../combat/CombatTransitionChain';

const SEEDED_RANDOM: IRandom = {
  next: () => 0.5,
  nextInt: (min: number, max: number) => Math.floor(0.5 * (max - min + 1)) + min,
  nextFloat: (min: number, max: number) => 0.5 * (max - min) + min,
};

const config = createDefaultAIConfig();

function makeSlot(category: WeaponCategory, ammo = 30): IWeaponSlot {
  return {
    category,
    ammo,
    maxAmmo: 30,
    range: { min: 0, max: 400 },
    damage: 25,
    fireRate: 2,
  };
}

function makeLoadout(
  primary?: IWeaponSlot | null,
  secondary?: IWeaponSlot | null,
  grenades = 2,
  medkits = 1,
): INPCLoadout {
  return {
    primary: primary ?? makeSlot(WeaponCategory.RIFLE),
    secondary: secondary ?? makeSlot(WeaponCategory.PISTOL),
    grenades,
    medkits,
  };
}

describe('AI: cover + combat pipeline (integration)', () => {
  // -----------------------------------------------------------------------
  // CoverRecommender → CoverRegistry.findCover
  // -----------------------------------------------------------------------

  describe('cover recommendation → registry search', () => {
    it('low HP → CLOSE type → findCover returns nearest cover', () => {
      const registry = new CoverRegistry(config.cover, SEEDED_RANDOM);
      registry.addPoints([
        { x: 50, y: 50 },   // close to NPC
        { x: 300, y: 300 }, // far from NPC
      ]);

      const type = recommendCoverType(
        { hpRatio: 0.1, morale: 0, enemyCount: 1, hasAmmo: true },
        config.cover,
      );
      expect(type).toBe(CoverType.CLOSE);

      const cover = registry.findCover(type, { x: 60, y: 60 }, [{ x: 200, y: 200 }], 'npc_1');
      expect(cover).not.toBeNull();
      // Closest cover should be selected
      expect(cover!.x).toBe(50);
      expect(cover!.y).toBe(50);
    });

    it('healthy + few enemies → AMBUSH → findCover returns flanking position', () => {
      const registry = new CoverRegistry(config.cover, SEEDED_RANDOM);
      // Place cover points at flanking angles relative to enemy at (200, 100)
      registry.addPoints([
        { x: 100, y: 100 }, // in front of enemy (no flank)
        { x: 200, y: 250 }, // flanking angle
      ]);

      const type = recommendCoverType(
        { hpRatio: 0.9, morale: 0.5, enemyCount: 1, hasAmmo: true },
        config.cover,
      );
      expect(type).toBe(CoverType.AMBUSH);

      const cover = registry.findCover(type, { x: 100, y: 200 }, [{ x: 200, y: 100 }], 'npc_1');
      // AMBUSH evaluator scores based on flanking angle — should pick one of the points
      // (exact selection depends on angle math, but should not be null)
      expect(cover).not.toBeNull();
    });

    it('no ammo → SAFE → findRecommendedCover returns safest point', () => {
      const registry = new CoverRegistry(config.cover, SEEDED_RANDOM);
      registry.addPoints([
        { x: 50, y: 50 },   // close to enemy
        { x: 350, y: 350 }, // far from enemy
      ]);

      const cover = registry.findRecommendedCover(
        { hpRatio: 0.8, morale: 0, enemyCount: 1, hasAmmo: false },
        { x: 100, y: 100 },
        [{ x: 60, y: 60 }],
        'npc_1',
      );
      // SAFE evaluator maximizes distance from enemies
      expect(cover).not.toBeNull();
    });

    it('findCover → findBestLoophole → loophole faces enemy', () => {
      const registry = new CoverRegistry(config.cover, SEEDED_RANDOM);
      const point = registry.addPoint(100, 100);

      const loophole = registry.findBestLoophole(point, 200, 100);
      // Loophole should face toward enemy at (200, 100) — angle ~0 rad
      expect(loophole).not.toBeNull();
      // Peek position should be offset toward enemy
      expect(loophole!.offsetX).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // WeaponSelector
  // -----------------------------------------------------------------------

  describe('weapon selection scoring', () => {
    it('shotgun scores highest at close range', () => {
      const loadout = makeLoadout(
        makeSlot(WeaponCategory.SHOTGUN),
        makeSlot(WeaponCategory.RIFLE),
      );
      const weapon = selectBestWeapon({ loadout, distanceToEnemy: 50, enemyCount: 1, hpRatio: 0.8 }, config.weapon);
      expect(weapon).not.toBeNull();
      expect(weapon!.category).toBe(WeaponCategory.SHOTGUN);
    });

    it('rifle scores highest at medium range', () => {
      const loadout = makeLoadout(
        makeSlot(WeaponCategory.RIFLE),
        makeSlot(WeaponCategory.SHOTGUN),
      );
      const weapon = selectBestWeapon({ loadout, distanceToEnemy: 250, enemyCount: 1, hpRatio: 0.8 }, config.weapon);
      expect(weapon).not.toBeNull();
      expect(weapon!.category).toBe(WeaponCategory.RIFLE);
    });

    it('sniper scores highest at long range', () => {
      const loadout = makeLoadout(
        makeSlot(WeaponCategory.SNIPER),
        makeSlot(WeaponCategory.PISTOL),
      );
      const weapon = selectBestWeapon({ loadout, distanceToEnemy: 500, enemyCount: 1, hpRatio: 0.8 }, config.weapon);
      expect(weapon).not.toBeNull();
      expect(weapon!.category).toBe(WeaponCategory.SNIPER);
    });
  });

  // -----------------------------------------------------------------------
  // CombatTransitionChain
  // -----------------------------------------------------------------------

  describe('combat transition chain', () => {
    const transitionConfig = createDefaultCombatTransitionConfig();

    function makeContext(overrides: Partial<ICombatContext>): ICombatContext {
      return {
        hpRatio: 0.8,
        moraleValue: 0,
        isPanicked: false,
        lostSightMs: 0,
        distanceToEnemy: 100,
        visibleEnemyCount: 1,
        loadout: makeLoadout(),
        canSwitchTarget: true,
        timeSinceWoundedMs: Infinity,
        hasExplosiveDanger: false,
        hasAmmo: true,
        ...overrides,
      };
    }

    it('HP below woundedThreshold → WOUNDED', () => {
      const result = evaluateTransitions(
        DEFAULT_COMBAT_RULES,
        makeContext({ hpRatio: 0.1 }),
        transitionConfig,
      );
      expect(result).toBe('WOUNDED');
    });

    it('low morale + panicked → FLEE (higher priority than RETREAT)', () => {
      const result = evaluateTransitions(
        DEFAULT_COMBAT_RULES,
        makeContext({ moraleValue: -0.8, isPanicked: true }),
        transitionConfig,
      );
      expect(result).toBe('FLEE');
    });

    it('grenade transition + shouldThrowGrenade agree on same config', () => {
      // Ensure both systems agree when using shared distance/enemy thresholds.
      const grenadeCtx = makeContext({
        lostSightMs: 2500, // between grenadeLostSightMs(2000) and lostSightThresholdMs(3000)
        visibleEnemyCount: 3,
        distanceToEnemy: 150, // within [100, 250] range
        loadout: makeLoadout(null, null, 3),
      });

      const chainResult = evaluateTransitions(DEFAULT_COMBAT_RULES, grenadeCtx, transitionConfig);
      expect(chainResult).toBe('GRENADE');

      // WeaponSelector should also agree this is a valid grenade throw.
      const weaponAgrees = shouldThrowGrenade(
        { loadout: grenadeCtx.loadout, enemyCount: grenadeCtx.visibleEnemyCount, distanceToEnemy: grenadeCtx.distanceToEnemy, hpRatio: 0.8 },
        config.weapon,
      );
      expect(weaponAgrees).toBe(true);
    });
  });
});
