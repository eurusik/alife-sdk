/**
 * Integration test: "AI navigation + monster ability pipeline".
 *
 * Exercises:
 *   1. PathSmoother → SmoothPathFollower full traversal
 *   2. RestrictedZoneManager filtering waypoints before smoothing
 *   3. Monster ability selection + phase data creation
 *   4. Monster flee decision
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect } from 'vitest';
import type { IRandom, Vec2 } from '@alife-sdk/core';
import { createDefaultAIConfig } from '../config/createDefaultAIConfig';
import { smoothPath } from '../navigation/PathSmoother';
import { SmoothPathFollower } from '../navigation/SmoothPathFollower';
import {
  RestrictedZoneManager,
  RestrictionType,
} from '../navigation/RestrictedZoneManager';
import {
  selectMonsterAbility,
  shouldMonsterFlee,
  createLinearChargeData,
  createApproachData,
  createLeapData,
  createChannelAbilityData,
  type IMonsterAbilityContext,
} from '../combat/MonsterAbilityData';

const SEEDED_RANDOM: IRandom = {
  next: () => 0.5,
  nextInt: (min: number, max: number) => Math.floor(0.5 * (max - min + 1)) + min,
  nextFloat: (min: number, max: number) => 0.5 * (max - min) + min,
};

const config = createDefaultAIConfig();

describe('AI: navigation + monster pipeline (integration)', () => {
  // -----------------------------------------------------------------------
  // PathSmoother → SmoothPathFollower
  // -----------------------------------------------------------------------

  describe('smooth path traversal', () => {
    it('PathSmoother output traversed by SmoothPathFollower → isComplete()', () => {
      const waypoints: Vec2[] = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 200, y: 100 },
        { x: 300, y: 100 },
      ];

      const dense = smoothPath(waypoints, config.navigation, SEEDED_RANDOM);
      expect(dense.length).toBeGreaterThan(waypoints.length);

      const follower = new SmoothPathFollower(dense, config.navigation);
      expect(follower.isComplete()).toBe(false);

      // Walk through each point by simulating arrival.
      for (let i = 0; i < dense.length + 10; i++) {
        if (follower.isComplete()) break;
        const target = follower.getCurrentTarget()!;
        follower.updatePosition(target.x, target.y);
      }

      expect(follower.isComplete()).toBe(true);
      expect(follower.getProgress()).toBe(1);
    });

    it('velocity profile: varies across path (slow at turns, fast on straights)', () => {
      // L-shaped path with a sharp 90° turn
      const waypoints: Vec2[] = [
        { x: 0, y: 0 },
        { x: 200, y: 0 },     // straight segment
        { x: 200, y: 200 },   // 90° turn
        { x: 400, y: 200 },   // straight again
      ];

      const dense = smoothPath(waypoints, config.navigation, SEEDED_RANDOM);
      const follower = new SmoothPathFollower(dense, config.navigation);

      const velocities: number[] = [];
      for (let i = 0; i < dense.length && !follower.isComplete(); i++) {
        velocities.push(follower.getCurrentVelocityMultiplier());
        const target = follower.getCurrentTarget()!;
        follower.updatePosition(target.x, target.y);
      }

      // Velocity should vary (not all the same)
      const unique = new Set(velocities.map(v => Math.round(v * 100)));
      expect(unique.size).toBeGreaterThan(1);
    });

    it('SmoothPathFollower mid-journey position is between start and end', () => {
      const waypoints: Vec2[] = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 200, y: 0 },
        { x: 300, y: 0 },
      ];

      const dense = smoothPath(waypoints, config.navigation, SEEDED_RANDOM);
      const follower = new SmoothPathFollower(dense, config.navigation);

      // Advance halfway
      const halfway = Math.floor(dense.length / 2);
      for (let i = 0; i < halfway; i++) {
        const target = follower.getCurrentTarget()!;
        follower.updatePosition(target.x, target.y);
      }

      expect(follower.isComplete()).toBe(false);
      const progress = follower.getProgress();
      expect(progress).toBeGreaterThan(0);
      expect(progress).toBeLessThan(1);
    });
  });

  // -----------------------------------------------------------------------
  // RestrictedZoneManager filtering
  // -----------------------------------------------------------------------

  describe('restricted zones + navigation', () => {
    it('filterAccessibleWaypoints removes points inside OUT zone', () => {
      const zones = new RestrictedZoneManager(config.navigation.restrictedZoneSafeMargin);
      zones.addZone({
        id: 'rad_zone',
        type: RestrictionType.OUT,
        x: 150,
        y: 0,
        radius: 60,
        active: true,
      });

      const waypoints: Vec2[] = [
        { x: 0, y: 0 },     // accessible
        { x: 150, y: 0 },   // inside OUT zone
        { x: 300, y: 0 },   // accessible
      ];

      const filtered = zones.filterAccessibleWaypoints(waypoints);
      expect(filtered.length).toBeLessThan(waypoints.length);
      // Middle point should be excluded
      const xValues = filtered.map(p => p.x);
      expect(xValues).not.toContain(150);
    });
  });

  // -----------------------------------------------------------------------
  // Monster ability pipeline
  // -----------------------------------------------------------------------

  describe('monster ability selection + phase data', () => {
    function makeContext(overrides: Partial<IMonsterAbilityContext>): IMonsterAbilityContext {
      return {
        monsterType: 'boar',
        distanceToEnemy: 100,
        attackRange: 40,
        meleeCooldownRemaining: 0,
        hpRatio: 0.8,
        moraleValue: 0,
        ...overrides,
      };
    }

    it('boar at distance → charge ability', () => {
      const ability = selectMonsterAbility(
        makeContext({ monsterType: 'boar', distanceToEnemy: 100, attackRange: 40 }),
      );
      expect(ability).toBe('charge');

      // Create charge phase data
      const data = createLinearChargeData(0, 0, 100, 0, config.monsterAbility.chargeWindupMs);
      expect(data.phase).toBe('windup');
      expect(data.timer).toBe(600);
    });

    it('bloodsucker far away → stalk ability', () => {
      const ability = selectMonsterAbility(
        makeContext({ monsterType: 'bloodsucker', distanceToEnemy: 200, attackRange: 40 }),
      );
      expect(ability).toBe('stalk');

      const data = createApproachData(200, 0);
      expect(data.phase).toBe('approach');
    });

    it('snork in leap range → leap ability', () => {
      const ability = selectMonsterAbility(
        makeContext({ monsterType: 'snork', distanceToEnemy: 80, attackRange: 40 }),
      );
      expect(ability).toBe('leap');

      const data = createLeapData(0, 0, 80, 0, config.monsterAbility.leapWindupMs);
      expect(data.phase).toBe('windup');
      expect(data.timer).toBe(400);
    });

    it('melee cooldown active → no ability triggered', () => {
      const ability = selectMonsterAbility(
        makeContext({ monsterType: 'boar', meleeCooldownRemaining: 500 }),
      );
      expect(ability).toBeNull();
    });

    it('shouldMonsterFlee: low HP + low morale → true', () => {
      expect(shouldMonsterFlee(0.1, -0.5)).toBe(true);
    });

    it('shouldMonsterFlee: healthy → false', () => {
      expect(shouldMonsterFlee(0.8, 0)).toBe(false);
    });

    it('controller at range → psi_attack ability', () => {
      const ability = selectMonsterAbility(
        makeContext({ monsterType: 'controller', distanceToEnemy: 100, attackRange: 40 }),
      );
      expect(ability).toBe('psi_attack');

      const data = createChannelAbilityData(100, 0, config.monsterAbility.psiChannelMs);
      expect(data.phase).toBe('channel');
      expect(data.timer).toBe(2000);
    });
  });
});
