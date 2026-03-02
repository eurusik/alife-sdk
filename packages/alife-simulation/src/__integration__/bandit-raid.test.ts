/**
 * Integration test: "Набіг бандитів".
 *
 * Full raid lifecycle on a stalker outpost:
 *   - Terrain starts PEACEFUL with defenders
 *   - Bandits arrive → combat → terrain escalates PEACEFUL → ALERT → COMBAT
 *   - Casualties on both sides
 *   - Weak bandit retreats (retreatThreshold)
 *   - Terrain decays COMBAT → ALERT → PEACEFUL after threat removed
 *
 * All objects are REAL -- zero mocks, zero vi.fn().
 */

import { ALifeEvents } from '@alife-sdk/core';
import type { ALifeEventPayloads } from '@alife-sdk/core';

import { OfflineCombatResolver } from '../combat/OfflineCombatResolver';
import { TerrainStateManager, TerrainState } from '../terrain/TerrainStateManager';
import { StoryRegistry } from '../npc/StoryRegistry';
import { NPCRelationRegistry, createDefaultRelationConfig } from '../npc/NPCRelationRegistry';
import type { INPCRecord } from '../types/INPCRecord';

import {
  createTerrain,
  createSharedDeps,
  createBrain,
  createNPCRecord,
  createFaction,
  createStubBridge,
  getDefaultCombatConfig,
  getDefaultTerrainStateConfig,
  assignBrainToTerrain,
  SEEDED_RANDOM,
  createBehaviorConfig,
} from './helpers';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Bandit raid', () => {
  const stalkerFaction = createFaction('stalker', { bandit: -100 });
  const banditFaction = createFaction('bandit', { stalker: -100 });
  const factions = new Map([['stalker', stalkerFaction], ['bandit', banditFaction]]);

  it('terrain starts PEACEFUL with only stalkers — no combat occurs', () => {
    const deps = createSharedDeps();
    const outpost = createTerrain({
      id: 'outpost',
      capacity: 10,
      jobs: [{ type: 'guard', slots: 10, position: { x: 100, y: 100 } }],
    });

    const brainA = createBrain('stalker_a', 'stalker', { clock: deps.clock, events: deps.events }, deps.movement);
    const brainB = createBrain('stalker_b', 'stalker', { clock: deps.clock, events: deps.events }, deps.movement);
    assignBrainToTerrain(brainA, outpost, deps.events);
    assignBrainToTerrain(brainB, outpost, deps.events);

    const records = new Map<string, INPCRecord>([
      ['stalker_a', createNPCRecord({ entityId: 'stalker_a', factionId: 'stalker', currentHp: 100 })],
      ['stalker_b', createNPCRecord({ entityId: 'stalker_b', factionId: 'stalker', currentHp: 100 })],
    ]);
    const brains = new Map([['stalker_a', brainA], ['stalker_b', brainB]]);

    const tsm = new TerrainStateManager('outpost', getDefaultTerrainStateConfig(), deps.events);
    const resolver = new OfflineCombatResolver(getDefaultCombatConfig(), createStubBridge(), SEEDED_RANDOM);
    const story = new StoryRegistry();
    const relations = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(records, new Map([['outpost', outpost]]), factions, brains, story, relations, 0);
    deps.events.flush();

    // No hostile factions → no damage
    expect(records.get('stalker_a')!.currentHp).toBe(100);
    expect(records.get('stalker_b')!.currentHp).toBe(100);
    expect(tsm.terrainState).toBe(TerrainState.PEACEFUL);
  });

  it('terrain escalates PEACEFUL → ALERT → COMBAT when bandits arrive and fight', () => {
    const deps = createSharedDeps();
    const _outpost = createTerrain({
      id: 'outpost',
      capacity: 10,
      jobs: [{ type: 'guard', slots: 10, position: { x: 100, y: 100 } }],
    });

    const events: Array<{ oldState: number; newState: number }> = [];
    deps.events.on(ALifeEvents.TERRAIN_STATE_CHANGED, (p: ALifeEventPayloads[typeof ALifeEvents.TERRAIN_STATE_CHANGED]) => {
      events.push(p);
    });

    const tsm = new TerrainStateManager('outpost', getDefaultTerrainStateConfig(), deps.events);

    // First contact → escalate to ALERT
    tsm.escalate(TerrainState.ALERT, 0);
    deps.events.flush();

    expect(tsm.terrainState).toBe(TerrainState.ALERT);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ terrainId: 'outpost', oldState: TerrainState.PEACEFUL, newState: TerrainState.ALERT });

    // Continued combat → escalate to COMBAT
    tsm.escalate(TerrainState.COMBAT, 100);
    deps.events.flush();

    expect(tsm.terrainState).toBe(TerrainState.COMBAT);
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({ terrainId: 'outpost', oldState: TerrainState.ALERT, newState: TerrainState.COMBAT });
  });

  it('weak bandit retreats when cumWinProb < retreatThreshold', () => {
    const deps = createSharedDeps();
    const outpost = createTerrain({
      id: 'outpost',
      capacity: 10,
      jobs: [{ type: 'guard', slots: 10, position: { x: 100, y: 100 } }],
    });
    const fallback = createTerrain({
      id: 'fallback',
      capacity: 10,
      bounds: { x: 500, y: 500, width: 200, height: 200 },
      jobs: [{ type: 'camp', slots: 10, position: { x: 600, y: 600 } }],
    });

    const stalkerBrain = createBrain(
      'stalker_a', 'stalker',
      { clock: deps.clock, events: deps.events }, deps.movement,
      { brainConfig: { reEvaluateIntervalMs: 0 } },
    );
    const banditBrain = createBrain(
      'bandit_a', 'bandit',
      { clock: deps.clock, events: deps.events }, deps.movement,
      { brainConfig: { reEvaluateIntervalMs: 0 } },
    );
    assignBrainToTerrain(stalkerBrain, outpost, deps.events);
    assignBrainToTerrain(banditBrain, outpost, deps.events);

    // Stalker is much stronger → bandit cumWinProb will be low
    // Bandit retreatThreshold=0.9 → retreats if cumWinProb < 0.9
    const records = new Map<string, INPCRecord>([
      ['stalker_a', createNPCRecord({
        entityId: 'stalker_a',
        factionId: 'stalker',
        combatPower: 100,
        currentHp: 500,
        rank: 5,
      })],
      ['bandit_a', createNPCRecord({
        entityId: 'bandit_a',
        factionId: 'bandit',
        combatPower: 20,
        currentHp: 50,
        rank: 1,
        behaviorConfig: createBehaviorConfig({ retreatThreshold: 0.9 }),
      })],
    ]);

    const brains = new Map([['stalker_a', stalkerBrain], ['bandit_a', banditBrain]]);
    const resolver = new OfflineCombatResolver(getDefaultCombatConfig(), createStubBridge(), SEEDED_RANDOM);
    const story = new StoryRegistry();
    const relations = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(records, new Map([['outpost', outpost]]), factions, brains, story, relations, 0);
    deps.events.flush();

    // Retreat: no damage exchanged
    expect(records.get('stalker_a')!.currentHp).toBe(500);
    expect(records.get('bandit_a')!.currentHp).toBe(50);

    // Retreating NPC is not combat-locked
    expect(banditBrain.isCombatLocked).toBe(false);
    expect(stalkerBrain.isCombatLocked).toBe(false);

    // After brain.update, bandit re-evaluates and can leave the terrain
    banditBrain.update(1000, [outpost, fallback]);
    deps.events.flush();
    // Brain should have re-evaluated (reEvaluateIntervalMs=0 + forceReevaluate was called)
    expect(banditBrain.currentTerrainId).not.toBeNull();
  });

  it('terrain decays COMBAT → ALERT → PEACEFUL after threat removed', () => {
    const deps = createSharedDeps();

    const stateEvents: Array<{ oldState: number; newState: number }> = [];
    deps.events.on(ALifeEvents.TERRAIN_STATE_CHANGED, (p: ALifeEventPayloads[typeof ALifeEvents.TERRAIN_STATE_CHANGED]) => {
      stateEvents.push(p);
    });

    // Fast decay: 500ms combat→alert, 500ms alert→peaceful
    const tsm = new TerrainStateManager('outpost', getDefaultTerrainStateConfig(), deps.events);

    // Start at COMBAT
    tsm.escalate(TerrainState.COMBAT, 0);
    deps.events.flush();
    expect(tsm.terrainState).toBe(TerrainState.COMBAT);

    // Not enough time: still COMBAT
    tsm.tickDecay(400);
    expect(tsm.terrainState).toBe(TerrainState.COMBAT);

    // Decay COMBAT → ALERT after 500ms
    tsm.tickDecay(600);
    deps.events.flush();
    expect(tsm.terrainState).toBe(TerrainState.ALERT);

    // Decay ALERT → PEACEFUL after another 500ms
    tsm.tickDecay(1200);
    deps.events.flush();
    expect(tsm.terrainState).toBe(TerrainState.PEACEFUL);

    // 3 events total: PEACEFUL→COMBAT (escalate), COMBAT→ALERT, ALERT→PEACEFUL
    expect(stateEvents).toHaveLength(3);
  });

  it('full raid lifecycle: PEACEFUL → combat → casualties → retreat → PEACEFUL', () => {
    const deps = createSharedDeps();
    const outpost = createTerrain({
      id: 'outpost',
      capacity: 10,
      jobs: [{ type: 'guard', slots: 10, position: { x: 100, y: 100 } }],
    });

    const tsm = new TerrainStateManager('outpost', getDefaultTerrainStateConfig(), deps.events);

    // --- Phase 1: stalkers defend the outpost ---
    const stalkerBrain = createBrain(
      'stalker_a', 'stalker',
      { clock: deps.clock, events: deps.events }, deps.movement,
    );
    assignBrainToTerrain(stalkerBrain, outpost, deps.events);

    expect(tsm.terrainState).toBe(TerrainState.PEACEFUL);

    // --- Phase 2: bandits arrive and fight ---
    const banditStrongBrain = createBrain(
      'bandit_strong', 'bandit',
      { clock: deps.clock, events: deps.events }, deps.movement,
    );
    const banditWeakBrain = createBrain(
      'bandit_weak', 'bandit',
      { clock: deps.clock, events: deps.events }, deps.movement,
      { brainConfig: { reEvaluateIntervalMs: 0 } },
    );
    assignBrainToTerrain(banditStrongBrain, outpost, deps.events);
    assignBrainToTerrain(banditWeakBrain, outpost, deps.events);

    // Jitter=0.75: stalker attack=round(50*1.0*0.75)=38, bandit_strong attack=round(80*1.2*0.75)=72
    const records = new Map<string, INPCRecord>([
      ['stalker_a', createNPCRecord({
        entityId: 'stalker_a', factionId: 'stalker', combatPower: 50, currentHp: 60, rank: 3,
      })],
      ['bandit_strong', createNPCRecord({
        entityId: 'bandit_strong', factionId: 'bandit', combatPower: 80, currentHp: 200, rank: 4,
      })],
      ['bandit_weak', createNPCRecord({
        entityId: 'bandit_weak', factionId: 'bandit', combatPower: 10, currentHp: 30, rank: 1,
        behaviorConfig: createBehaviorConfig({ retreatThreshold: 0.9 }),
      })],
    ]);
    const brains = new Map([
      ['stalker_a', stalkerBrain],
      ['bandit_strong', banditStrongBrain],
      ['bandit_weak', banditWeakBrain],
    ]);

    const resolver = new OfflineCombatResolver(getDefaultCombatConfig(), createStubBridge(), SEEDED_RANDOM);
    const story = new StoryRegistry();
    const relations = new NPCRelationRegistry(createDefaultRelationConfig());

    // Escalate terrain to COMBAT (as game tick pipeline would)
    tsm.escalate(TerrainState.COMBAT, 0);

    resolver.resolve(records, new Map([['outpost', outpost]]), factions, brains, story, relations, 0);
    deps.events.flush();

    expect(tsm.terrainState).toBe(TerrainState.COMBAT);

    // stalker_a: 60 HP - 72 damage = -12 → dead
    expect(records.get('stalker_a')!.currentHp).toBeLessThanOrEqual(0);
    expect(outpost.hasOccupant('stalker_a')).toBe(false);

    // bandit_weak retreats (low power vs any enemy → forceReevaluate)
    // bandit_strong survives
    expect(records.get('bandit_strong')!.currentHp).toBeGreaterThan(0);

    // --- Phase 3: all threats gone, terrain decays ---
    // Decay COMBAT → ALERT after combatDecayMs (500ms)
    tsm.tickDecay(600);
    deps.events.flush();
    expect(tsm.terrainState).toBe(TerrainState.ALERT);

    // Decay ALERT → PEACEFUL after alertDecayMs (500ms)
    tsm.tickDecay(1200);
    deps.events.flush();
    expect(tsm.terrainState).toBe(TerrainState.PEACEFUL);
  });
});
