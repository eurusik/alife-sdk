/**
 * Integration test: "Патруль з контактом".
 *
 * Verifies the patrol → movement → combat pipeline:
 *   - TaskPositionResolver resolves patrol waypoints from terrain config
 *   - Guard slot resolves to a fixed position
 *   - NPCBrain selects patrol terrain, MovementSimulator dispatches journey
 *   - NPC arrives at terrain with hostile → combat resolves → hostile dies
 *   - Full patrol-contact narrative
 *
 * All objects are REAL -- zero mocks, zero vi.fn().
 */

import { ALifeEvents } from '@alife-sdk/core';
import type { ALifeEventPayloads, PatrolRoute } from '@alife-sdk/core';

import { TaskPositionResolver } from '../terrain/TaskPositionResolver';
import { OfflineCombatResolver } from '../combat/OfflineCombatResolver';
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
  assignBrainToTerrain,
  SEEDED_RANDOM,
} from './helpers';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Patrol contact', () => {
  const militaryFaction = createFaction('military', { bandit: -100 });
  const banditFaction = createFaction('bandit', { military: -100 });
  const factions = new Map([['military', militaryFaction], ['bandit', banditFaction]]);

  it('TaskPositionResolver resolves patrol waypoints from terrain config', () => {
    const route: PatrolRoute = {
      id: 'route_1',
      terrainId: 'patrol_zone',
      routeType: 'loop',
      waypoints: [
        { x: 100, y: 100 },
        { x: 200, y: 200 },
        { x: 300, y: 100 },
      ],
    };

    const result = TaskPositionResolver.resolve(
      { type: 'patrol', slots: 1, routeId: 'route_1' },
      'patrol',
      { x: 0, y: 0, width: 400, height: 400 },
      (id) => id === 'route_1' ? route : null,
      () => null,
      SEEDED_RANDOM,
    );

    // Should resolve to first waypoint with routeId
    expect(result.targetX).toBe(100);
    expect(result.targetY).toBe(100);
    expect(result.routeId).toBe('route_1');
    expect(result.waypointIndex).toBe(0);
  });

  it('guard slot resolves to fixed position', () => {
    const result = TaskPositionResolver.resolve(
      { type: 'guard', slots: 1, position: { x: 250, y: 350 } },
      'guard',
      { x: 0, y: 0, width: 400, height: 400 },
      () => null,
      () => null,
      SEEDED_RANDOM,
    );

    expect(result.targetX).toBe(250);
    expect(result.targetY).toBe(350);
    expect(result.routeId).toBeUndefined();
  });

  it('NPC selects patrol terrain and MovementSimulator dispatches journey', () => {
    const deps = createSharedDeps();
    const patrolZone = createTerrain({
      id: 'patrol_zone',
      capacity: 5,
      bounds: { x: 500, y: 500, width: 200, height: 200 },
      jobs: [{ type: 'patrol', slots: 3 }],
      scoring: { scoringJitter: 0 },
    });

    // NPC starts far from terrain → movement dispatched
    const brain = createBrain(
      'soldier_1', 'military',
      { clock: deps.clock, events: deps.events }, deps.movement,
      { position: { x: 0, y: 0 }, rank: 3 },
    );

    brain.update(0, [patrolZone]);
    deps.events.flush();

    expect(brain.currentTerrainId).toBe('patrol_zone');
    expect(deps.movement.isMoving('soldier_1')).toBe(true);

    // Track NPC_MOVED event
    const movedPayloads: Array<{ npcId: string }> = [];
    deps.events.on(ALifeEvents.NPC_MOVED, (p: ALifeEventPayloads[typeof ALifeEvents.NPC_MOVED]) => {
      movedPayloads.push(p);
    });

    // Advance enough time for journey to complete (distance ~849px at 50px/s ≈ 17s)
    deps.movement.update(18_000);
    deps.events.flush();

    expect(movedPayloads).toHaveLength(1);
    expect(movedPayloads[0].npcId).toBe('soldier_1');
    expect(deps.movement.isMoving('soldier_1')).toBe(false);
  });

  it('NPC arrives at terrain with hostile bandit → combat resolves', () => {
    const deps = createSharedDeps();
    const zone = createTerrain({
      id: 'contested_zone',
      capacity: 10,
      jobs: [{ type: 'guard', slots: 10, position: { x: 100, y: 100 } }],
    });

    // Military: strong
    const soldierBrain = createBrain(
      'soldier_1', 'military',
      { clock: deps.clock, events: deps.events }, deps.movement,
      { rank: 4 },
    );
    // Bandit: weak
    const banditBrain = createBrain(
      'bandit_1', 'bandit',
      { clock: deps.clock, events: deps.events }, deps.movement,
      { rank: 1 },
    );

    assignBrainToTerrain(soldierBrain, zone, deps.events);
    assignBrainToTerrain(banditBrain, zone, deps.events);

    // Soldier attack: round(80 * 1.2 * 0.75) = 72
    // Bandit attack: round(30 * 0.8 * 0.75) = 18
    const records = new Map<string, INPCRecord>([
      ['soldier_1', createNPCRecord({
        entityId: 'soldier_1', factionId: 'military', combatPower: 80, currentHp: 200, rank: 4,
      })],
      ['bandit_1', createNPCRecord({
        entityId: 'bandit_1', factionId: 'bandit', combatPower: 30, currentHp: 50, rank: 1,
      })],
    ]);
    const brains = new Map([['soldier_1', soldierBrain], ['bandit_1', banditBrain]]);

    const resolver = new OfflineCombatResolver(getDefaultCombatConfig(), createStubBridge(), SEEDED_RANDOM);
    const story = new StoryRegistry();
    const relations = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(records, new Map([['contested_zone', zone]]), factions, brains, story, relations, 0);
    deps.events.flush();

    // Bandit dies: 50 HP - 72 damage = -22
    expect(records.get('bandit_1')!.currentHp).toBeLessThanOrEqual(0);
    // Soldier survives: 200 HP - 18 damage = 182
    expect(records.get('soldier_1')!.currentHp).toBeGreaterThan(0);
    expect(zone.hasOccupant('bandit_1')).toBe(false);
    expect(zone.hasOccupant('soldier_1')).toBe(true);
  });

  it('full patrol-contact narrative: select → move → arrive → combat → hostile dies → NPC keeps task', () => {
    const deps = createSharedDeps();
    const patrolZone = createTerrain({
      id: 'patrol_zone',
      capacity: 10,
      bounds: { x: 500, y: 500, width: 200, height: 200 },
      jobs: [{ type: 'patrol', slots: 5 }, { type: 'guard', slots: 5, position: { x: 600, y: 600 } }],
      scoring: { scoringJitter: 0 },
    });

    // --- Step 1: military selects patrol terrain, journey dispatched ---
    const soldierBrain = createBrain(
      'soldier_1', 'military',
      { clock: deps.clock, events: deps.events }, deps.movement,
      { position: { x: 0, y: 0 }, rank: 4 },
    );

    soldierBrain.update(0, [patrolZone]);
    deps.events.flush();

    expect(soldierBrain.currentTerrainId).toBe('patrol_zone');
    expect(deps.movement.isMoving('soldier_1')).toBe(true);
    expect(soldierBrain.currentTask).not.toBeNull();

    // --- Step 2: bandit is already in the zone ---
    const banditBrain = createBrain(
      'bandit_1', 'bandit',
      { clock: deps.clock, events: deps.events }, deps.movement,
      { position: { x: 600, y: 600 }, rank: 1 },
    );
    assignBrainToTerrain(banditBrain, patrolZone, deps.events);

    // --- Step 3: soldier journey completes (~849px at 50px/s ≈ 17s) ---
    deps.movement.update(18_000);
    deps.events.flush();
    expect(deps.movement.isMoving('soldier_1')).toBe(false);

    // --- Step 4: combat resolution → bandit dies ---
    const records = new Map<string, INPCRecord>([
      ['soldier_1', createNPCRecord({
        entityId: 'soldier_1', factionId: 'military', combatPower: 80, currentHp: 200, rank: 4,
      })],
      ['bandit_1', createNPCRecord({
        entityId: 'bandit_1', factionId: 'bandit', combatPower: 30, currentHp: 50, rank: 1,
      })],
    ]);
    const brains = new Map([['soldier_1', soldierBrain], ['bandit_1', banditBrain]]);

    const diedPayloads: Array<{ npcId: string }> = [];
    deps.events.on(ALifeEvents.NPC_DIED, (p: ALifeEventPayloads[typeof ALifeEvents.NPC_DIED]) => {
      diedPayloads.push(p);
    });

    const resolver = new OfflineCombatResolver(getDefaultCombatConfig(), createStubBridge(), SEEDED_RANDOM);
    const story = new StoryRegistry();
    const relations = new NPCRelationRegistry(createDefaultRelationConfig());

    resolver.resolve(records, new Map([['patrol_zone', patrolZone]]), factions, brains, story, relations, 0);
    deps.events.flush();

    expect(records.get('bandit_1')!.currentHp).toBeLessThanOrEqual(0);
    expect(diedPayloads).toHaveLength(1);
    expect(diedPayloads[0].npcId).toBe('bandit_1');

    // --- Step 5: soldier still holds task after combat ---
    expect(soldierBrain.currentTerrainId).toBe('patrol_zone');
    expect(soldierBrain.currentTask).not.toBeNull();
  });
});
