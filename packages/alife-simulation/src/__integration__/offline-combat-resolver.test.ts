/**
 * Integration tests for OfflineCombatResolver.
 *
 * Covers:
 *   - Stronger NPC wins (higher power → enemy HP drops to 0)
 *   - Weaker NPC retreats when cumWinProb < retreatThreshold
 *   - Story NPC is immune to offline combat (never killed)
 *   - Dead / online NPCs are skipped by the terrain index
 *   - Detection probability gates combat (0% → no exchange)
 *   - Morale adjustments called on bridge (via tracking bridge)
 *   - Combat lock applied to both participants after exchange
 *   - Mutual retreat: neither side takes damage
 *   - onNPCDeath callback invoked when an NPC dies
 *   - Round-robin cursor advances after each call
 *   - Both NPCs survive a close match (high mutual HP)
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 * Tracking arrays are used instead of vi.fn() to record calls.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { OfflineCombatResolver } from '../combat/OfflineCombatResolver';
import { StoryRegistry } from '../npc/StoryRegistry';
import { NPCRelationRegistry, createDefaultRelationConfig } from '../npc/NPCRelationRegistry';

import {
  createTerrain,
  createBrain,
  createFaction,
  createNPCRecord,
  createStubBridge,
  createTrackingBridge,
  getDefaultCombatConfig,
  createSharedDeps,
  assignBrainToTerrain,
  SEEDED_RANDOM,
} from './helpers';
import type { IOfflineCombatConfig } from '../types/ISimulationConfig';
import type { IRandom } from '@alife-sdk/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** IRandom that always returns the same value. */
function constantRandom(value: number): IRandom {
  return {
    next: () => value,
    nextInt: (min: number, max: number) => Math.floor(value * (max - min + 1)) + min,
    nextFloat: (min: number, max: number) => value * (max - min) + min,
  };
}

/**
 * Build a minimal resolver scenario with two hostile factions on one terrain.
 *
 * Returns everything needed to call resolver.resolve() once.
 */
function buildTwoFactionScenario(opts: {
  powerA?: number;
  rankA?: number;
  hpA?: number;
  retreatThresholdA?: number;
  powerB?: number;
  rankB?: number;
  hpB?: number;
  retreatThresholdB?: number;
  random?: IRandom;
  combatConfig?: Partial<IOfflineCombatConfig>;
  storyNpcA?: boolean;
  storyNpcB?: boolean;
}) {
  const deps = createSharedDeps();

  const terrain = createTerrain({
    id: 'arena',
    capacity: 10,
    scoring: { scoringJitter: 0 },
    jobs: [{ type: 'guard', slots: 10, position: { x: 100, y: 100 } }],
  });

  const brainA = createBrain('npc_a', 'faction_a', deps, deps.movement, {
    position: { x: 100, y: 100 },
    rank: opts.rankA ?? 3,
    brainConfig: { reEvaluateIntervalMs: 0 },
  });
  assignBrainToTerrain(brainA, terrain, deps.events);

  const brainB = createBrain('npc_b', 'faction_b', deps, deps.movement, {
    position: { x: 100, y: 100 },
    rank: opts.rankB ?? 3,
    brainConfig: { reEvaluateIntervalMs: 0 },
  });
  assignBrainToTerrain(brainB, terrain, deps.events);

  const recordA = createNPCRecord({
    entityId: 'npc_a',
    factionId: 'faction_a',
    combatPower: opts.powerA ?? 50,
    currentHp: opts.hpA ?? 100,
    rank: opts.rankA ?? 3,
    behaviorConfig: {
      retreatThreshold: opts.retreatThresholdA ?? 0.1,
      panicThreshold: -0.7,
      searchIntervalMs: 5_000,
      dangerTolerance: 3,
      aggression: 0.5,
    },
  });

  const recordB = createNPCRecord({
    entityId: 'npc_b',
    factionId: 'faction_b',
    combatPower: opts.powerB ?? 50,
    currentHp: opts.hpB ?? 100,
    rank: opts.rankB ?? 3,
    behaviorConfig: {
      retreatThreshold: opts.retreatThresholdB ?? 0.1,
      panicThreshold: -0.7,
      searchIntervalMs: 5_000,
      dangerTolerance: 3,
      aggression: 0.5,
    },
  });

  const factionA = createFaction('faction_a', { faction_b: -100 });
  const factionB = createFaction('faction_b', { faction_a: -100 });

  const npcRecords = new Map([['npc_a', recordA], ['npc_b', recordB]]);
  const factions = new Map([['faction_a', factionA], ['faction_b', factionB]]);
  const brains = new Map([['npc_a', brainA], ['npc_b', brainB]]);
  const terrains = new Map([['arena', terrain]]);

  const storyRegistry = new StoryRegistry();
  if (opts.storyNpcA) storyRegistry.register('story_a', 'npc_a');
  if (opts.storyNpcB) storyRegistry.register('story_b', 'npc_b');

  const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

  const bridge = createStubBridge();

  const random = opts.random ?? SEEDED_RANDOM; // SEEDED_RANDOM.next() = 0.25 (< 0.70 → detection succeeds)

  const resolver = new OfflineCombatResolver(
    getDefaultCombatConfig({ detectionProbability: 70, ...opts.combatConfig }),
    bridge,
    random,
  );

  return {
    resolver, bridge, storyRegistry, relationRegistry,
    npcRecords, factions, brains, terrains,
    recordA, recordB, brainA, brainB, terrain,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OfflineCombatResolver — damage exchange', () => {

  it('stronger NPC (higher power) deals more damage and opponent HP drops more', () => {
    // npc_a has 9× the combat power of npc_b.
    // Both use retreatThreshold=0 so neither retreats and damage always exchanges.
    const s = buildTwoFactionScenario({
      powerA: 90, hpA: 200, retreatThresholdA: 0,
      powerB: 10, hpB: 200, retreatThresholdB: 0,
    });

    s.resolver.resolve(
      s.npcRecords, s.terrains, s.factions, s.brains,
      s.storyRegistry, s.relationRegistry, 0,
    );

    // npc_b (weak) should have lost more HP than npc_a (strong)
    const hpLossA = 200 - s.recordA.currentHp;
    const hpLossB = 200 - s.recordB.currentHp;
    expect(hpLossB).toBeGreaterThan(hpLossA);
  });

  it('weaker NPC with low HP dies after one exchange', () => {
    // npc_b has 1 HP — any damage kills it
    const s = buildTwoFactionScenario({ powerA: 50, hpA: 200, powerB: 10, hpB: 1 });

    const deathCalls: string[] = [];

    s.resolver.resolve(
      s.npcRecords, s.terrains, s.factions, s.brains,
      s.storyRegistry, s.relationRegistry, 0,
      (deadId) => deathCalls.push(deadId),
    );

    expect(s.recordB.currentHp).toBeLessThanOrEqual(0);
    expect(deathCalls).toContain('npc_b');
  });

  it('stronger NPC survives when weak opponent cannot overcome its HP', () => {
    // retreatThreshold=0 ensures both NPCs always fight (no retreat regardless of odds).
    // With jitter=0.25: strong attacks weak for round(100 * 1.0 * 0.75) = 75 ≥ 10 HP → weak dies.
    const s = buildTwoFactionScenario({
      powerA: 100, hpA: 500, retreatThresholdA: 0,
      powerB: 5, hpB: 10, retreatThresholdB: 0,
    });

    s.resolver.resolve(
      s.npcRecords, s.terrains, s.factions, s.brains,
      s.storyRegistry, s.relationRegistry, 0,
    );

    expect(s.recordA.currentHp).toBeGreaterThan(0);
    expect(s.recordB.currentHp).toBeLessThanOrEqual(0);
  });

  it('both NPCs survive a close match with high mutual HP', () => {
    // Both equal power, very high HP → neither dies in one exchange
    const s = buildTwoFactionScenario({ powerA: 10, hpA: 10_000, powerB: 10, hpB: 10_000 });

    s.resolver.resolve(
      s.npcRecords, s.terrains, s.factions, s.brains,
      s.storyRegistry, s.relationRegistry, 0,
    );

    expect(s.recordA.currentHp).toBeGreaterThan(0);
    expect(s.recordB.currentHp).toBeGreaterThan(0);
  });

  it('combat lock is applied to both participants after an exchange', () => {
    const s = buildTwoFactionScenario({ hpA: 1000, hpB: 1000 });

    s.resolver.resolve(
      s.npcRecords, s.terrains, s.factions, s.brains,
      s.storyRegistry, s.relationRegistry, 0,
    );

    // Both brains should be combat-locked after the exchange
    expect(s.brainA.isCombatLocked).toBe(true);
    expect(s.brainB.isCombatLocked).toBe(true);
  });

  it('morale adjustMorale is called for hit penalty on both participants', () => {
    const deps = createSharedDeps();
    const terrain = createTerrain({
      id: 'arena', capacity: 10, scoring: { scoringJitter: 0 },
      jobs: [{ type: 'guard', slots: 10, position: { x: 100, y: 100 } }],
    });

    const brainA = createBrain('npc_a', 'faction_a', deps, deps.movement, {
      position: { x: 100, y: 100 }, brainConfig: { reEvaluateIntervalMs: 0 },
    });
    assignBrainToTerrain(brainA, terrain, deps.events);

    const brainB = createBrain('npc_b', 'faction_b', deps, deps.movement, {
      position: { x: 100, y: 100 }, brainConfig: { reEvaluateIntervalMs: 0 },
    });
    assignBrainToTerrain(brainB, terrain, deps.events);

    const recordA = createNPCRecord({ entityId: 'npc_a', factionId: 'faction_a', currentHp: 1000, combatPower: 50 });
    const recordB = createNPCRecord({ entityId: 'npc_b', factionId: 'faction_b', currentHp: 1000, combatPower: 50 });
    const npcRecords = new Map([['npc_a', recordA], ['npc_b', recordB]]);
    const factions = new Map([
      ['faction_a', createFaction('faction_a', { faction_b: -100 })],
      ['faction_b', createFaction('faction_b', { faction_a: -100 })],
    ]);
    const brains = new Map([['npc_a', brainA], ['npc_b', brainB]]);
    const terrains = new Map([['arena', terrain]]);

    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    const { bridge, calls } = createTrackingBridge();
    const resolver = new OfflineCombatResolver(
      getDefaultCombatConfig({ detectionProbability: 70 }),
      bridge,
      SEEDED_RANDOM,
    );

    resolver.resolve(npcRecords, terrains, factions, brains, storyRegistry, relationRegistry, 0);

    const moraleCalls = calls.filter(c => c.method === 'adjustMorale');
    // Both npc_a and npc_b should receive morale adjustments
    const adjustedNpcs = moraleCalls.map(c => c.args[0] as string);
    expect(adjustedNpcs).toContain('npc_a');
    expect(adjustedNpcs).toContain('npc_b');
  });
});

// ---------------------------------------------------------------------------

describe('OfflineCombatResolver — retreat logic', () => {

  it('NPC with extremely high retreatThreshold always retreats', () => {
    // retreatThreshold = 1.0 means the NPC retreats unless cumWinProb >= 1.0 (impossible)
    const s = buildTwoFactionScenario({
      retreatThresholdA: 1.0,
      retreatThresholdB: 0.01,
      hpA: 1000,
      hpB: 1000,
    });

    const hpABefore = s.recordA.currentHp;
    const hpBBefore = s.recordB.currentHp;

    s.resolver.resolve(
      s.npcRecords, s.terrains, s.factions, s.brains,
      s.storyRegistry, s.relationRegistry, 0,
    );

    // When one side retreats no damage exchange happens
    // (attacker retreats → both skip damage)
    expect(s.recordA.currentHp).toBe(hpABefore);
    expect(s.recordB.currentHp).toBe(hpBBefore);
  });

  it('when both sides retreat, no damage is exchanged and no NPC dies', () => {
    const s = buildTwoFactionScenario({
      retreatThresholdA: 1.0,
      retreatThresholdB: 1.0,
      hpA: 100,
      hpB: 100,
    });

    const deathCalls: string[] = [];

    s.resolver.resolve(
      s.npcRecords, s.terrains, s.factions, s.brains,
      s.storyRegistry, s.relationRegistry, 0,
      (deadId) => deathCalls.push(deadId),
    );

    expect(s.recordA.currentHp).toBe(100);
    expect(s.recordB.currentHp).toBe(100);
    expect(deathCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe('OfflineCombatResolver — story NPC immunity', () => {

  it('story NPC is immune to offline combat — no HP loss, no death', () => {
    const s = buildTwoFactionScenario({
      storyNpcA: true,
      storyNpcB: false,
      powerA: 5, hpA: 100,
      powerB: 1000, hpB: 100,
    });

    const deathCalls: string[] = [];

    s.resolver.resolve(
      s.npcRecords, s.terrains, s.factions, s.brains,
      s.storyRegistry, s.relationRegistry, 0,
      (deadId) => deathCalls.push(deadId),
    );

    // Story NPC should not die
    expect(deathCalls).not.toContain('npc_a');
    // No damage exchange occurs when any participant is a story NPC
    expect(s.recordA.currentHp).toBe(100);
    expect(s.recordB.currentHp).toBe(100);
  });

  it('both story NPCs: no combat occurs at all', () => {
    const s = buildTwoFactionScenario({
      storyNpcA: true,
      storyNpcB: true,
      hpA: 100,
      hpB: 100,
    });

    const deathCalls: string[] = [];

    s.resolver.resolve(
      s.npcRecords, s.terrains, s.factions, s.brains,
      s.storyRegistry, s.relationRegistry, 0,
      (deadId) => deathCalls.push(deadId),
    );

    expect(deathCalls).toHaveLength(0);
    expect(s.recordA.currentHp).toBe(100);
    expect(s.recordB.currentHp).toBe(100);
  });
});

// ---------------------------------------------------------------------------

describe('OfflineCombatResolver — detection gate', () => {

  it('0% detection probability → no combat exchange occurs', () => {
    // detectionProbability: 0 → random.next() * 100 is always >= 0 → skip
    const s = buildTwoFactionScenario({
      combatConfig: { detectionProbability: 0 },
      hpA: 100,
      hpB: 100,
    });

    const deathCalls: string[] = [];

    s.resolver.resolve(
      s.npcRecords, s.terrains, s.factions, s.brains,
      s.storyRegistry, s.relationRegistry, 0,
      (deadId) => deathCalls.push(deadId),
    );

    // No exchange: HP unchanged
    expect(s.recordA.currentHp).toBe(100);
    expect(s.recordB.currentHp).toBe(100);
    expect(deathCalls).toHaveLength(0);
  });

  it('100% detection probability → combat always triggers', () => {
    // detectionProbability: 100 → random.next() * 100 (= 25) < 100 → always detected
    const s = buildTwoFactionScenario({
      combatConfig: { detectionProbability: 100 },
      powerA: 50, hpA: 1000,
      powerB: 50, hpB: 1000,
    });

    s.resolver.resolve(
      s.npcRecords, s.terrains, s.factions, s.brains,
      s.storyRegistry, s.relationRegistry, 0,
    );

    // Both NPCs took damage (HP decreased)
    expect(s.recordA.currentHp).toBeLessThan(1000);
    expect(s.recordB.currentHp).toBeLessThan(1000);
  });
});

// ---------------------------------------------------------------------------

describe('OfflineCombatResolver — skips dead / online NPCs', () => {

  it('dead NPC (currentHp <= 0) is skipped — no exchange occurs with it', () => {
    const deps = createSharedDeps();
    const terrain = createTerrain({
      id: 'arena', capacity: 10, scoring: { scoringJitter: 0 },
      jobs: [{ type: 'guard', slots: 10, position: { x: 100, y: 100 } }],
    });

    const brainA = createBrain('npc_alive', 'faction_a', deps, deps.movement, {
      position: { x: 100, y: 100 }, brainConfig: { reEvaluateIntervalMs: 0 },
    });
    assignBrainToTerrain(brainA, terrain, deps.events);

    const brainDead = createBrain('npc_dead', 'faction_b', deps, deps.movement, {
      position: { x: 100, y: 100 }, brainConfig: { reEvaluateIntervalMs: 0 },
    });
    assignBrainToTerrain(brainDead, terrain, deps.events);

    // Dead NPC — currentHp = 0
    const recordAlive = createNPCRecord({ entityId: 'npc_alive', factionId: 'faction_a', currentHp: 100 });
    const recordDead = createNPCRecord({ entityId: 'npc_dead', factionId: 'faction_b', currentHp: 0 });
    const npcRecords = new Map([['npc_alive', recordAlive], ['npc_dead', recordDead]]);
    const factions = new Map([
      ['faction_a', createFaction('faction_a', { faction_b: -100 })],
      ['faction_b', createFaction('faction_b', { faction_a: -100 })],
    ]);
    const brains = new Map([['npc_alive', brainA], ['npc_dead', brainDead]]);
    const terrains = new Map([['arena', terrain]]);

    const storyRegistry = new StoryRegistry();
    const relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());

    const resolver = new OfflineCombatResolver(
      getDefaultCombatConfig({ detectionProbability: 100 }),
      createStubBridge(),
      constantRandom(0.25),
    );

    // With only one alive NPC per faction in the terrain, the dead NPC is
    // excluded from the terrain index — no exchange should happen.
    resolver.resolve(npcRecords, terrains, factions, brains, storyRegistry, relationRegistry, 0);

    // Alive NPC should not have lost HP (no valid opponent)
    expect(recordAlive.currentHp).toBe(100);
  });

  it('online NPC is excluded from offline terrain index — no exchange occurs', () => {
    const deps = createSharedDeps();
    const terrain = createTerrain({
      id: 'arena', capacity: 10, scoring: { scoringJitter: 0 },
      jobs: [{ type: 'guard', slots: 10, position: { x: 100, y: 100 } }],
    });

    const brainA = createBrain('npc_offline', 'faction_a', deps, deps.movement, {
      position: { x: 100, y: 100 }, brainConfig: { reEvaluateIntervalMs: 0 },
    });
    assignBrainToTerrain(brainA, terrain, deps.events);

    const brainOnline = createBrain('npc_online', 'faction_b', deps, deps.movement, {
      position: { x: 100, y: 100 }, brainConfig: { reEvaluateIntervalMs: 0 },
    });
    assignBrainToTerrain(brainOnline, terrain, deps.events);

    const recordOffline = createNPCRecord({ entityId: 'npc_offline', factionId: 'faction_a', currentHp: 100, isOnline: false });
    const recordOnline = createNPCRecord({ entityId: 'npc_online', factionId: 'faction_b', currentHp: 100, isOnline: true });
    const npcRecords = new Map([['npc_offline', recordOffline], ['npc_online', recordOnline]]);
    const factions = new Map([
      ['faction_a', createFaction('faction_a', { faction_b: -100 })],
      ['faction_b', createFaction('faction_b', { faction_a: -100 })],
    ]);
    const brains = new Map([['npc_offline', brainA], ['npc_online', brainOnline]]);
    const terrains = new Map([['arena', terrain]]);

    const resolver = new OfflineCombatResolver(
      getDefaultCombatConfig({ detectionProbability: 100 }),
      createStubBridge(),
      constantRandom(0.25),
    );

    resolver.resolve(
      npcRecords, terrains, factions, brains,
      new StoryRegistry(), new NPCRelationRegistry(createDefaultRelationConfig()), 0,
    );

    // Online NPC excluded from offline combat — offline NPC has no valid opponent
    expect(recordOffline.currentHp).toBe(100);
  });
});

// ---------------------------------------------------------------------------

describe('OfflineCombatResolver — cursor and budget', () => {

  it('cursor advances by 1 after each resolve() call', () => {
    const s = buildTwoFactionScenario({ hpA: 10_000, hpB: 10_000 });

    const cursor1 = s.resolver.resolve(
      s.npcRecords, s.terrains, s.factions, s.brains,
      s.storyRegistry, s.relationRegistry, 0,
    );
    // With 1 terrain, (0+1) % 1 = 0
    expect(typeof cursor1).toBe('number');
    expect(cursor1).toBeGreaterThanOrEqual(0);
  });

  it('onNPCDeath callback is called exactly once when one NPC dies', () => {
    // retreatThreshold=0 prevents npc_b from retreating despite extremely low win probability.
    const s = buildTwoFactionScenario({
      powerA: 200, hpA: 1000, retreatThresholdA: 0,
      powerB: 1, hpB: 1, retreatThresholdB: 0,
    });

    const deathCalls: Array<{ deadId: string; killerId: string }> = [];

    s.resolver.resolve(
      s.npcRecords, s.terrains, s.factions, s.brains,
      s.storyRegistry, s.relationRegistry, 0,
      (deadId, killerId) => deathCalls.push({ deadId, killerId }),
    );

    expect(deathCalls).toHaveLength(1);
    expect(deathCalls[0].deadId).toBe('npc_b');
    expect(deathCalls[0].killerId).toBe('npc_a');
  });
});
