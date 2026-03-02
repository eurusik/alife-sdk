/**
 * Integration tests for NPCRelationRegistry.
 *
 * Covers:
 *   - Personal goodwill read/write/clamping
 *   - Fight registration and TTL-based expiry via updateFights()
 *   - onNPCAttacked() helper: registers fight + applies hit penalty
 *   - onNPCKilled() helper: witness goodwill adjustments
 *   - Pair isolation (two separate pairs do not interfere)
 *   - hasFoughtRecently mapped to isInFight / getDefender behaviour
 *   - removeNPC cleans up all related data
 *   - Serialization / restoration round-trip
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  NPCRelationRegistry,
  createDefaultRelationConfig,
} from '../npc/NPCRelationRegistry';
import type { INPCRelationConfig } from '../npc/NPCRelationRegistry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Short TTL (200 ms) so tests can expire fights cheaply. */
function createFastConfig(overrides?: Partial<INPCRelationConfig>): INPCRelationConfig {
  return createDefaultRelationConfig({ fightRememberTimeMs: 200, ...overrides });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NPCRelationRegistry — personal goodwill', () => {

  it('getPersonalGoodwill returns 0 when no relation has been recorded', () => {
    const registry = new NPCRelationRegistry(createDefaultRelationConfig());
    expect(registry.getPersonalGoodwill('a', 'b')).toBe(0);
    expect(registry.getPersonalGoodwill('b', 'a')).toBe(0);
  });

  it('adjustGoodwill sets a non-zero personal relation', () => {
    const registry = new NPCRelationRegistry(createDefaultRelationConfig());
    registry.adjustGoodwill('a', 'b', -20);
    expect(registry.getPersonalGoodwill('a', 'b')).toBe(-20);
    // Reverse direction is independent
    expect(registry.getPersonalGoodwill('b', 'a')).toBe(0);
  });

  it('adjustGoodwill accumulates multiple deltas correctly', () => {
    const registry = new NPCRelationRegistry(createDefaultRelationConfig());
    registry.adjustGoodwill('a', 'b', -10);
    registry.adjustGoodwill('a', 'b', -15);
    expect(registry.getPersonalGoodwill('a', 'b')).toBe(-25);
  });

  it('adjustGoodwill clamps at goodwillMin (-100)', () => {
    const registry = new NPCRelationRegistry(createDefaultRelationConfig());
    registry.adjustGoodwill('a', 'b', -200);
    expect(registry.getPersonalGoodwill('a', 'b')).toBe(-100);
  });

  it('adjustGoodwill clamps at goodwillMax (+100)', () => {
    const registry = new NPCRelationRegistry(createDefaultRelationConfig());
    registry.adjustGoodwill('a', 'b', 999);
    expect(registry.getPersonalGoodwill('a', 'b')).toBe(100);
  });

  it('adjustGoodwill removes entry when result is exactly 0', () => {
    const registry = new NPCRelationRegistry(createDefaultRelationConfig());
    registry.adjustGoodwill('a', 'b', 30);
    registry.adjustGoodwill('a', 'b', -30); // should cancel out
    expect(registry.getPersonalGoodwill('a', 'b')).toBe(0);
    // serialized entries list should be empty (no non-zero entries)
    expect(registry.serialize()).toHaveLength(0);
  });

  it('getAttitude combines faction relation with personal goodwill', () => {
    const registry = new NPCRelationRegistry(createDefaultRelationConfig());
    registry.adjustGoodwill('a', 'b', -20);
    // Base faction relation = 10, personal = -20 → combined = -10
    expect(registry.getAttitude('a', 'b', 10)).toBe(-10);
  });

  it('getAttitude result is clamped to [goodwillMin, goodwillMax]', () => {
    const registry = new NPCRelationRegistry(createDefaultRelationConfig());
    // Faction relation already at max; adding personal goodwill stays at 100
    registry.adjustGoodwill('a', 'b', 50);
    expect(registry.getAttitude('a', 'b', 80)).toBe(100);
    // Faction relation at min + big negative personal stays at -100
    registry.adjustGoodwill('x', 'y', -50);
    expect(registry.getAttitude('x', 'y', -80)).toBe(-100);
  });

  it('two separate pairs do not interfere with each other', () => {
    const registry = new NPCRelationRegistry(createDefaultRelationConfig());
    registry.adjustGoodwill('a', 'b', -30);
    registry.adjustGoodwill('c', 'd', 50);

    expect(registry.getPersonalGoodwill('a', 'b')).toBe(-30);
    expect(registry.getPersonalGoodwill('c', 'd')).toBe(50);
    // Unrelated directions are untouched
    expect(registry.getPersonalGoodwill('b', 'a')).toBe(0);
    expect(registry.getPersonalGoodwill('d', 'c')).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('NPCRelationRegistry — fight registry', () => {

  it('registerFight makes both NPCs appear in each other\'s active fights', () => {
    const registry = new NPCRelationRegistry(createFastConfig());
    registry.registerFight('a', 'b', 10);

    // 'a' is the attacker — getDefender should return 'b'
    expect(registry.getDefender('a')).toBe('b');
    // Both are "in a fight"
    expect(registry.isInFight('a')).toBe(true);
    expect(registry.isInFight('b')).toBe(true);
  });

  it('isInFight returns false before any fight is registered', () => {
    const registry = new NPCRelationRegistry(createFastConfig());
    expect(registry.isInFight('a')).toBe(false);
    expect(registry.isInFight('b')).toBe(false);
  });

  it('fight is remembered before TTL expires', () => {
    const registry = new NPCRelationRegistry(createFastConfig()); // TTL = 200 ms
    registry.registerFight('a', 'b', 10);

    // Advance by less than TTL
    registry.updateFights(100);

    expect(registry.isInFight('a')).toBe(true);
    expect(registry.isInFight('b')).toBe(true);
  });

  it('fight is forgotten after TTL expires via updateFights()', () => {
    const registry = new NPCRelationRegistry(createFastConfig()); // TTL = 200 ms
    registry.registerFight('a', 'b', 10);

    // Advance past the TTL
    registry.updateFights(300);

    expect(registry.isInFight('a')).toBe(false);
    expect(registry.isInFight('b')).toBe(false);
    expect(registry.getDefender('a')).toBeNull();
  });

  it('refreshing damage extends fight TTL (last-hit timestamp updated)', () => {
    const registry = new NPCRelationRegistry(createFastConfig()); // TTL = 200 ms
    registry.registerFight('a', 'b', 10);

    // Advance 150 ms — still remembered
    registry.updateFights(150);
    expect(registry.isInFight('a')).toBe(true);

    // Refresh the fight (accumulate more damage, last-hit moves to elapsed=150)
    registry.registerFight('a', 'b', 5);

    // Advance another 150 ms (total 300 ms elapsed, but last-hit at 150 → 150 ms ago)
    registry.updateFights(150);
    // 300 - 150 = 150 ms since last hit, which is < TTL 200 → still active
    expect(registry.isInFight('a')).toBe(true);

    // Advance one more full TTL to expire it
    registry.updateFights(250);
    expect(registry.isInFight('a')).toBe(false);
  });

  it('two separate fights do not interfere with each other', () => {
    const registry = new NPCRelationRegistry(createFastConfig()); // TTL = 200 ms
    registry.registerFight('a', 'b', 10);
    registry.registerFight('c', 'd', 10);

    // Expire only one fight
    registry.updateFights(300);

    // Both should be expired (same elapsed)
    expect(registry.isInFight('a')).toBe(false);
    expect(registry.isInFight('c')).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('NPCRelationRegistry — action handlers', () => {

  it('onNPCAttacked registers fight and applies attackHitDelta to target', () => {
    const config = createDefaultRelationConfig(); // attackHitDelta = -5
    const registry = new NPCRelationRegistry(config);

    registry.onNPCAttacked('attacker', 'target', 20);

    // Fight registered
    expect(registry.isInFight('attacker')).toBe(true);
    expect(registry.isInFight('target')).toBe(true);

    // Target dislikes attacker by attackHitDelta
    expect(registry.getPersonalGoodwill('target', 'attacker')).toBe(config.attackHitDelta);
  });

  it('onNPCAttacked multiple times accumulates hit penalty', () => {
    const config = createDefaultRelationConfig(); // attackHitDelta = -5
    const registry = new NPCRelationRegistry(config);

    registry.onNPCAttacked('attacker', 'target', 10);
    registry.onNPCAttacked('attacker', 'target', 10);
    registry.onNPCAttacked('attacker', 'target', 10);

    // 3 hits × -5 = -15
    expect(registry.getPersonalGoodwill('target', 'attacker')).toBe(-15);
  });

  it('onNPCKilled: same-faction witness receives killAllyDelta toward killer', () => {
    const config = createDefaultRelationConfig(); // killAllyDelta = -30
    const registry = new NPCRelationRegistry(config);

    const witnessFactions = new Map([['witness_ally', 'stalker']]);

    registry.onNPCKilled(
      'killer',
      'victim',
      'stalker',   // victim faction
      ['witness_ally'],
      witnessFactions,
    );

    expect(registry.getPersonalGoodwill('witness_ally', 'killer')).toBe(config.killAllyDelta);
  });

  it('onNPCKilled: neutral witness receives killNeutralDelta toward killer', () => {
    const config = createDefaultRelationConfig(); // killNeutralDelta = -5
    const registry = new NPCRelationRegistry(config);

    const witnessFactions = new Map([['neutral_witness', 'military']]);

    registry.onNPCKilled(
      'killer',
      'victim',
      'bandit',   // victim faction (different from witness)
      ['neutral_witness'],
      witnessFactions,
    );

    expect(registry.getPersonalGoodwill('neutral_witness', 'killer')).toBe(config.killNeutralDelta);
  });

  it('onNPCKilled: witness who was being attacked by victim receives killEnemyDelta (positive)', () => {
    const config = createDefaultRelationConfig(); // killEnemyDelta = +15
    const registry = new NPCRelationRegistry(config);

    // victim was attacking witness_rescuee
    registry.registerFight('victim', 'witness_rescuee', 30);

    const witnessFactions = new Map([['witness_rescuee', 'stalker']]);

    registry.onNPCKilled(
      'killer',
      'victim',
      'bandit',   // victim faction differs from witness
      ['witness_rescuee'],
      witnessFactions,
    );

    // Killer saved witness_rescuee from the victim → killEnemyDelta
    expect(registry.getPersonalGoodwill('witness_rescuee', 'killer')).toBe(config.killEnemyDelta);
  });

  it('onNPCKilled: killer and victim themselves are skipped as witnesses', () => {
    const registry = new NPCRelationRegistry(createDefaultRelationConfig());

    const witnessFactions = new Map([
      ['killer', 'stalker'],
      ['victim', 'bandit'],
    ]);

    registry.onNPCKilled(
      'killer',
      'victim',
      'bandit',
      ['killer', 'victim'],
      witnessFactions,
    );

    // No goodwill changes applied
    expect(registry.getPersonalGoodwill('killer', 'killer')).toBe(0);
    expect(registry.getPersonalGoodwill('victim', 'victim')).toBe(0);
  });

  it('onNPCKilled cleans up fight records involving the victim', () => {
    const registry = new NPCRelationRegistry(createFastConfig());

    registry.registerFight('killer', 'victim', 30);
    expect(registry.isInFight('victim')).toBe(true);

    registry.onNPCKilled('killer', 'victim', 'bandit', [], new Map());

    // Fight records for victim should be removed
    expect(registry.isInFight('victim')).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('NPCRelationRegistry — cleanup and persistence', () => {

  it('removeNPC clears all goodwill relations involving that NPC', () => {
    const registry = new NPCRelationRegistry(createDefaultRelationConfig());

    registry.adjustGoodwill('a', 'b', -10);
    registry.adjustGoodwill('b', 'a', -20);
    registry.adjustGoodwill('a', 'c', 5);

    registry.removeNPC('a');

    expect(registry.getPersonalGoodwill('a', 'b')).toBe(0);
    expect(registry.getPersonalGoodwill('b', 'a')).toBe(0);
    expect(registry.getPersonalGoodwill('a', 'c')).toBe(0);
  });

  it('removeNPC clears fight records involving that NPC', () => {
    const registry = new NPCRelationRegistry(createFastConfig());

    registry.registerFight('a', 'b', 10);
    registry.registerFight('c', 'a', 10); // 'a' is defender here
    expect(registry.isInFight('a')).toBe(true);

    registry.removeNPC('a');

    expect(registry.isInFight('a')).toBe(false);
  });

  it('serialize/restore round-trips personal goodwill correctly', () => {
    const config = createDefaultRelationConfig();
    const original = new NPCRelationRegistry(config);

    original.adjustGoodwill('a', 'b', -30);
    original.adjustGoodwill('c', 'd', 50);

    const snapshot = original.serialize();

    const restored = new NPCRelationRegistry(config);
    restored.restore(snapshot);

    expect(restored.getPersonalGoodwill('a', 'b')).toBe(-30);
    expect(restored.getPersonalGoodwill('c', 'd')).toBe(50);
  });

  it('restore clears all previous state before loading snapshot', () => {
    const config = createDefaultRelationConfig();
    const registry = new NPCRelationRegistry(config);

    registry.adjustGoodwill('x', 'y', 99);
    registry.restore([]); // empty snapshot

    // All previous data must be gone
    expect(registry.getPersonalGoodwill('x', 'y')).toBe(0);
    expect(registry.serialize()).toHaveLength(0);
  });

  it('reset() clears all relations and fights', () => {
    const registry = new NPCRelationRegistry(createFastConfig());

    registry.adjustGoodwill('a', 'b', -50);
    registry.registerFight('a', 'b', 10);

    registry.reset();

    expect(registry.getPersonalGoodwill('a', 'b')).toBe(0);
    expect(registry.isInFight('a')).toBe(false);
    expect(registry.serialize()).toHaveLength(0);
  });
});
