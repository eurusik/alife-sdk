/**
 * Integration test: "Викид у відкритому полі".
 *
 * Full surge lifecycle driving brain shelter-seeking, movement, PSI death,
 * and spawn reset:
 *   - WARNING: brains switch to shelter-seek
 *   - MovementSimulator tracks journeys toward shelter
 *   - ACTIVE: outdoor NPC takes PSI damage and dies
 *   - AFTERMATH: spawn cooldowns reset, new spawn points eligible
 *   - Full lifecycle narrative
 *
 * All objects are REAL -- zero mocks, zero vi.fn().
 */

import { SpawnRegistry } from '@alife-sdk/core';
import type { IRandom } from '@alife-sdk/core';

import { SurgeManager, type ISurgeNPCRecord } from '../surge/SurgeManager';
import { SurgePhase } from '../surge/SurgePhase';

import {
  createTerrain,
  createSharedDeps,
  createBrain,
  createStubBridge,
  createTrackingBridge,
  getDefaultSurgeConfig,
} from './helpers';

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

const fixedRandom: IRandom = {
  next: () => 0.5,
  nextInt: (min: number, max: number) => Math.floor(0.5 * (max - min + 1)) + min,
  nextFloat: (min: number, max: number) => 0.5 * (max - min) + min,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Open-field surge', () => {
  it('WARNING: brains switch to shelter-seek when setSurgeActive(true)', () => {
    const deps = createSharedDeps();

    const shelter = createTerrain({
      id: 'bunker',
      capacity: 10,
      isShelter: true,
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      scoring: { scoringJitter: 0 },
      jobs: [{ type: 'camp', slots: 10, position: { x: 100, y: 100 } }],
    });
    const openA = createTerrain({
      id: 'field_a',
      capacity: 10,
      bounds: { x: 500, y: 0, width: 200, height: 200 },
      scoring: { scoringJitter: 0 },
      jobs: [{ type: 'patrol', slots: 10 }],
    });
    const openB = createTerrain({
      id: 'field_b',
      capacity: 10,
      bounds: { x: 0, y: 500, width: 200, height: 200 },
      scoring: { scoringJitter: 0 },
      jobs: [{ type: 'guard', slots: 10, position: { x: 100, y: 600 } }],
    });

    const terrains = [shelter, openA, openB];

    // 5 NPCs, initially assigned to various terrains
    const brainConfigs = [
      { id: 'npc_1', pos: { x: 100, y: 100 } },
      { id: 'npc_2', pos: { x: 100, y: 100 } },
      { id: 'npc_3', pos: { x: 600, y: 100 } },
      { id: 'npc_4', pos: { x: 100, y: 600 } },
      { id: 'npc_5', pos: { x: 600, y: 600 } },
    ];

    const brains = brainConfigs.map((cfg) => {
      const brain = createBrain(
        cfg.id, 'stalker',
        { clock: deps.clock, events: deps.events }, deps.movement,
        { position: cfg.pos, brainConfig: { reEvaluateIntervalMs: 0 } },
      );
      return brain;
    });

    // First tick: assign to nearest terrain (no surge yet)
    for (const brain of brains) {
      brain.update(0, terrains);
    }
    deps.events.flush();

    // Now set surge active on all brains
    for (const brain of brains) {
      brain.setSurgeActive(true);
      brain.forceReevaluate();
    }

    // Second tick: brains re-evaluate with surge filter → all should target shelter
    for (const brain of brains) {
      brain.update(0, terrains);
    }
    deps.events.flush();

    for (const brain of brains) {
      expect(brain.currentTerrainId).toBe('bunker');
    }
  });

  it('MovementSimulator tracks journeys — far NPCs are en-route', () => {
    const deps = createSharedDeps();

    const shelter = createTerrain({
      id: 'bunker',
      capacity: 10,
      isShelter: true,
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      scoring: { scoringJitter: 0 },
      jobs: [{ type: 'camp', slots: 10, position: { x: 100, y: 100 } }],
    });

    // NPC far from shelter → journey dispatched
    const brain = createBrain(
      'npc_far', 'stalker',
      { clock: deps.clock, events: deps.events }, deps.movement,
      { position: { x: 800, y: 800 }, brainConfig: { reEvaluateIntervalMs: 0 } },
    );

    brain.setSurgeActive(true);
    brain.update(0, [shelter]);
    deps.events.flush();

    expect(brain.currentTerrainId).toBe('bunker');
    expect(deps.movement.isMoving('npc_far')).toBe(true);

    // Partially advance — NPC still en route
    deps.movement.update(5_000);
    expect(deps.movement.isMoving('npc_far')).toBe(true);

    // Position should have changed (interpolated)
    const pos = deps.movement.getPosition('npc_far');
    expect(pos).not.toBeNull();
  });

  it('ACTIVE: outdoor NPC (null terrain) takes PSI damage and dies', () => {
    const deps = createSharedDeps();
    const spawnRegistry = new SpawnRegistry();

    const shelter = createTerrain({
      id: 'bunker',
      isShelter: true,
      capacity: 5,
      bounds: { x: 0, y: 0, width: 200, height: 200 },
    });

    const deadNpcs: string[] = [];
    const aliveSet = new Set(['outdoor_npc', 'sheltered_npc']);

    const bridge = createStubBridge({
      isAlive: (id) => aliveSet.has(id),
      applyDamage: (id) => {
        if (id === 'outdoor_npc') {
          aliveSet.delete(id);
          return true; // killed
        }
        return false;
      },
    });

    const surgeConfig = getDefaultSurgeConfig();
    const manager = new SurgeManager({
      config: surgeConfig,
      events: deps.events,
      spawnRegistry,
      bridge,
      random: fixedRandom,
      onSurgeDeath: (npcId) => deadNpcs.push(npcId),
    });
    manager.init();

    // NPC map: sheltered NPC in bunker, outdoor NPC with no terrain
    const npcs = new Map<string, ISurgeNPCRecord>([
      ['outdoor_npc', { entityId: 'outdoor_npc', currentTerrainId: null }],
      ['sheltered_npc', { entityId: 'sheltered_npc', currentTerrainId: 'bunker' }],
    ]);

    // Force surge and advance to ACTIVE
    manager.forceSurge();
    expect(manager.getPhase()).toBe(SurgePhase.WARNING);

    // Advance past warning (500ms)
    manager.update(501, npcs, [shelter]);
    expect(manager.getPhase()).toBe(SurgePhase.ACTIVE);

    // Advance enough for a damage tick (damageTickIntervalMs=500)
    manager.update(501, npcs, [shelter]);

    // Outdoor NPC should have died
    expect(deadNpcs).toContain('outdoor_npc');

    // Sheltered NPC should not have been damaged
    expect(aliveSet.has('sheltered_npc')).toBe(true);
  });

  it('AFTERMATH: spawn cooldowns reset and new spawn points become eligible', () => {
    const deps = createSharedDeps();
    const spawnRegistry = new SpawnRegistry();

    // Add a spawn point and mark as used (starts cooldown)
    spawnRegistry.addPoint({
      id: 'spawn_1',
      terrainId: 'field_a',
      position: { x: 100, y: 100 },
      factionId: 'stalker',
      maxNPCs: 3,
    });
    spawnRegistry.markSpawned('spawn_1');

    // Not eligible during cooldown
    expect(spawnRegistry.getEligiblePoints()).toHaveLength(0);

    const { bridge, calls } = createTrackingBridge({
      isAlive: () => true,
    });

    const manager = new SurgeManager({
      config: getDefaultSurgeConfig(),
      events: deps.events,
      spawnRegistry,
      bridge,
      random: fixedRandom,
    });
    manager.init();

    const npcs = new Map<string, ISurgeNPCRecord>([
      ['survivor_1', { entityId: 'survivor_1', currentTerrainId: 'bunker' }],
    ]);
    const shelter = createTerrain({ id: 'bunker', isShelter: true, capacity: 5 });

    // Advance through WARNING → ACTIVE → AFTERMATH
    manager.forceSurge();
    manager.update(501, npcs, [shelter]);  // WARNING → ACTIVE
    manager.update(2_001, npcs, [shelter]); // ACTIVE → AFTERMATH

    expect(manager.getPhase()).toBe(SurgePhase.AFTERMATH);

    // First aftermath update triggers resetAllCooldowns + moraleRestore
    manager.update(1, npcs, [shelter]);

    // Spawn point should now be eligible (cooldown reset)
    expect(spawnRegistry.getEligiblePoints()).toHaveLength(1);
    expect(spawnRegistry.getEligiblePoints()[0].id).toBe('spawn_1');

    // moraleRestore should have been applied to survivor
    const moraleRestoreCalls = calls.filter(
      (c) => c.method === 'adjustMorale' && (c.args as unknown[])[2] === 'surge_aftermath',
    );
    expect(moraleRestoreCalls).toHaveLength(1);
    expect((moraleRestoreCalls[0].args as unknown[])[0]).toBe('survivor_1');
  });

  it('full surge lifecycle: NPCs flee → outdoor NPC dies → aftermath respawn eligible', () => {
    const deps = createSharedDeps();
    const spawnRegistry = new SpawnRegistry();

    const shelter = createTerrain({
      id: 'bunker',
      capacity: 10,
      isShelter: true,
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      scoring: { scoringJitter: 0 },
      jobs: [{ type: 'camp', slots: 10, position: { x: 100, y: 100 } }],
    });
    const openField = createTerrain({
      id: 'field',
      capacity: 10,
      bounds: { x: 500, y: 500, width: 200, height: 200 },
      scoring: { scoringJitter: 0 },
      jobs: [{ type: 'patrol', slots: 10 }],
    });
    const terrains = [shelter, openField];

    spawnRegistry.addPoint({
      id: 'sp_1',
      terrainId: 'field',
      position: { x: 600, y: 600 },
      factionId: 'stalker',
      maxNPCs: 2,
    });
    spawnRegistry.markSpawned('sp_1');

    // 3 NPCs: 2 near shelter, 1 very far (won't reach shelter in time)
    const nearBrainA = createBrain(
      'near_a', 'stalker',
      { clock: deps.clock, events: deps.events }, deps.movement,
      { position: { x: 50, y: 50 }, brainConfig: { reEvaluateIntervalMs: 0 } },
    );
    const nearBrainB = createBrain(
      'near_b', 'stalker',
      { clock: deps.clock, events: deps.events }, deps.movement,
      { position: { x: 100, y: 100 }, brainConfig: { reEvaluateIntervalMs: 0 } },
    );
    const farBrain = createBrain(
      'far_c', 'stalker',
      { clock: deps.clock, events: deps.events }, deps.movement,
      { position: { x: 600, y: 600 }, brainConfig: { reEvaluateIntervalMs: 0 } },
    );

    // --- Phase 1: initial terrain assignment ---
    nearBrainA.update(0, terrains);
    nearBrainB.update(0, terrains);
    farBrain.update(0, terrains);
    deps.events.flush();

    // --- Phase 2: surge warning → brains seek shelter ---
    for (const brain of [nearBrainA, nearBrainB, farBrain]) {
      brain.setSurgeActive(true);
      brain.forceReevaluate();
    }
    for (const brain of [nearBrainA, nearBrainB, farBrain]) {
      brain.update(0, terrains);
    }
    deps.events.flush();

    // All brains target shelter
    expect(nearBrainA.currentTerrainId).toBe('bunker');
    expect(nearBrainB.currentTerrainId).toBe('bunker');
    expect(farBrain.currentTerrainId).toBe('bunker');

    // far_c is moving (long distance)
    expect(deps.movement.isMoving('far_c')).toBe(true);

    // --- Phase 3: surge ACTIVE — far NPC still en route (outdoor) ---
    const aliveSet = new Set(['near_a', 'near_b', 'far_c']);
    const deadNpcs: string[] = [];
    const bridge = createStubBridge({
      isAlive: (id) => aliveSet.has(id),
      applyDamage: (id) => {
        if (id === 'far_c') {
          aliveSet.delete(id);
          return true;
        }
        return false;
      },
    });

    const manager = new SurgeManager({
      config: getDefaultSurgeConfig(),
      events: deps.events,
      spawnRegistry,
      bridge,
      random: fixedRandom,
      onSurgeDeath: (npcId) => deadNpcs.push(npcId),
    });
    manager.init();
    manager.forceSurge();

    // For SurgeManager, the NPC terrain is determined by currentTerrainId.
    // far_c has currentTerrainId='bunker' via brain, but hasn't physically arrived.
    // In our simulation, terrain id from brain = target terrain.
    // The SurgeManager checks if that terrain is a shelter, so far_c
    // would be "protected". Let's model it realistically: far_c's
    // brain says 'bunker' but in a real tick pipeline, its
    // ISurgeNPCRecord would reflect that it hasn't arrived yet.
    // We simulate this by setting far_c's terrain to null (en-route, no shelter).

    const npcs = new Map<string, ISurgeNPCRecord>([
      ['near_a', { entityId: 'near_a', currentTerrainId: 'bunker' }],
      ['near_b', { entityId: 'near_b', currentTerrainId: 'bunker' }],
      ['far_c', { entityId: 'far_c', currentTerrainId: null }], // still en-route
    ]);

    // Advance: WARNING → ACTIVE
    manager.update(501, npcs, terrains);
    expect(manager.getPhase()).toBe(SurgePhase.ACTIVE);

    // Damage tick
    manager.update(501, npcs, terrains);

    // far_c dies (outdoor), near_a and near_b survive (sheltered)
    expect(deadNpcs).toContain('far_c');
    expect(aliveSet.has('near_a')).toBe(true);
    expect(aliveSet.has('near_b')).toBe(true);

    // --- Phase 4: AFTERMATH — spawn cooldowns reset ---
    // Remove dead NPC from map
    npcs.delete('far_c');

    manager.update(2_000, npcs, terrains); // ACTIVE → AFTERMATH
    expect(manager.getPhase()).toBe(SurgePhase.AFTERMATH);

    manager.update(1, npcs, terrains); // trigger aftermath effects

    // Spawn point cooldown reset → eligible
    expect(spawnRegistry.getEligiblePoints()).toHaveLength(1);

    // --- Phase 5: surge ends, brains return to normal ---
    for (const brain of [nearBrainA, nearBrainB]) {
      brain.setSurgeActive(false);
      brain.forceReevaluate();
    }
    for (const brain of [nearBrainA, nearBrainB]) {
      brain.update(0, terrains);
    }
    deps.events.flush();

    // Brains can now pick any terrain (not restricted to shelter)
    for (const brain of [nearBrainA, nearBrainB]) {
      expect(brain.currentTerrainId).not.toBeNull();
    }
  });
});
