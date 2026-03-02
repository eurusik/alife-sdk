/**
 * Integration test: "Concurrent NPCBrain scenarios".
 *
 * Tests contention, idempotency, and faction conflict resolution
 * when multiple NPCBrains run simultaneously:
 *
 *   1. Job slot contention — only one NPC wins a single slot
 *   2. Terrain capacity enforcement — no over-subscription
 *   3. Multiple update()s per tick — idempotent result
 *   4. Brain death mid-cycle — sibling brain continues safely
 *   5. Faction conflict — hostile brains on the same terrain diverge
 *
 * All objects are REAL -- zero mocks, zero vi.fn().
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ALifeEvents } from '@alife-sdk/core';
import { NPCBrain } from '../brain/NPCBrain';
import {
  createTerrain,
  createSharedDeps,
  createBrain,
  createFaction,
  assignBrainToTerrain,
} from './helpers';
import type { IWorld } from './helpers';
import { createWorld } from './helpers';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Concurrent NPCBrain scenarios (integration)', () => {

  // -------------------------------------------------------------------------
  // Test 1: 3 brains on terrain with 3 capacity — all get on, each gets own job
  // -------------------------------------------------------------------------
  it('3 NPCBrains assigned to terrain with capacity 3 — all occupy it, each holds a task', () => {
    const deps = createSharedDeps();

    // Terrain with capacity 3 and 3 job slots (enough for all 3 brains)
    const terrain = createTerrain({
      id: 'contested',
      capacity: 3,
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      jobs: [{ type: 'guard', slots: 3, position: { x: 100, y: 100 } }],
    });

    const brains = [
      createBrain('npc_a', 'stalker', deps, deps.movement, { position: { x: 100, y: 100 }, brainConfig: { reEvaluateIntervalMs: 0 } }),
      createBrain('npc_b', 'stalker', deps, deps.movement, { position: { x: 100, y: 100 }, brainConfig: { reEvaluateIntervalMs: 0 } }),
      createBrain('npc_c', 'stalker', deps, deps.movement, { position: { x: 100, y: 100 }, brainConfig: { reEvaluateIntervalMs: 0 } }),
    ];

    // All brains update sequentially
    for (const brain of brains) {
      brain.update(0, [terrain]);
    }
    deps.events.flush();

    // All 3 get assigned (capacity = 3)
    const onTerrain = brains.filter((b) => b.currentTerrainId === 'contested').length;
    expect(onTerrain).toBe(3);

    // All 3 get tasks (3 slots available)
    const withTask = brains.filter((b) => b.currentTask !== null).length;
    expect(withTask).toBe(3);

    // 4th brain would be rejected by capacity
    const fourthBrain = createBrain('npc_d', 'stalker', deps, deps.movement, {
      position: { x: 100, y: 100 },
      brainConfig: { reEvaluateIntervalMs: 0 },
    });
    fourthBrain.update(0, [terrain]);
    deps.events.flush();

    // No capacity left for 4th NPC
    expect(fourthBrain.currentTerrainId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 2: 2 brains on terrain with capacity 1 — only one gets in
  // -------------------------------------------------------------------------
  it('terrain with capacity 1 — only first brain gets assigned', () => {
    const deps = createSharedDeps();

    const terrain = createTerrain({
      id: 'tiny',
      capacity: 1,
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      jobs: [{ type: 'guard', slots: 2, position: { x: 100, y: 100 } }],
    });

    const brainA = createBrain('npc_x', 'stalker', deps, deps.movement, {
      position: { x: 100, y: 100 },
      brainConfig: { reEvaluateIntervalMs: 0 },
    });
    const brainB = createBrain('npc_y', 'stalker', deps, deps.movement, {
      position: { x: 100, y: 100 },
      brainConfig: { reEvaluateIntervalMs: 0 },
    });

    brainA.update(0, [terrain]);
    deps.events.flush();
    brainB.update(0, [terrain]);
    deps.events.flush();

    // Terrain is at capacity — exactly 1 should be inside
    const assigned = [brainA, brainB].filter((b) => b.currentTerrainId === 'tiny').length;
    expect(assigned).toBe(1);

    // The other should have no terrain
    const unassigned = [brainA, brainB].filter((b) => b.currentTerrainId === null).length;
    expect(unassigned).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Test 3: NPCBrain.update() called multiple times — idempotent result
  // -------------------------------------------------------------------------
  it('calling brain.update() multiple times in one tick is idempotent', () => {
    const deps = createSharedDeps();

    const terrain = createTerrain({
      id: 'outpost',
      capacity: 5,
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      jobs: [{ type: 'guard', slots: 5, position: { x: 100, y: 100 } }],
    });

    const brain = createBrain('npc_idem', 'stalker', deps, deps.movement, {
      position: { x: 100, y: 100 },
      brainConfig: { reEvaluateIntervalMs: 0 },
    });

    // First update: should assign terrain + job
    brain.update(0, [terrain]);
    deps.events.flush();

    const terrainAfterFirst = brain.currentTerrainId;
    const taskAfterFirst = brain.currentTask?.slotType;

    // Subsequent updates with delta=0 must not change state
    brain.update(0, [terrain]);
    brain.update(0, [terrain]);
    deps.events.flush();

    expect(brain.currentTerrainId).toBe(terrainAfterFirst);
    expect(brain.currentTask?.slotType).toBe(taskAfterFirst);
  });

  // -------------------------------------------------------------------------
  // Test 4: Brain A dies during tick while Brain B updates — B does not crash
  // -------------------------------------------------------------------------
  it('brain A dies mid-cycle — brain B continues updating without error', () => {
    const deps = createSharedDeps();

    const terrain = createTerrain({
      id: 'outpost',
      capacity: 5,
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      jobs: [{ type: 'guard', slots: 5, position: { x: 100, y: 100 } }],
    });

    const brainA = createBrain('npc_dying', 'stalker', deps, deps.movement, {
      position: { x: 100, y: 100 },
      brainConfig: { reEvaluateIntervalMs: 0 },
    });
    const brainB = createBrain('npc_alive', 'stalker', deps, deps.movement, {
      position: { x: 100, y: 100 },
      brainConfig: { reEvaluateIntervalMs: 0 },
    });

    // Both brains get assigned to terrain
    brainA.update(0, [terrain]);
    brainB.update(0, [terrain]);
    deps.events.flush();

    expect(brainA.currentTerrainId).toBe('outpost');
    expect(brainB.currentTerrainId).toBe('outpost');

    // Kill brain A mid-session
    brainA.onDeath();
    deps.events.flush();

    // Brain A is now dead — currentTerrainId should be null
    expect(brainA.currentTerrainId).toBeNull();

    // Brain B should continue updating without throwing
    expect(() => {
      brainB.update(1_000, [terrain]);
      deps.events.flush();
    }).not.toThrow();

    // Brain B is still alive and assigned
    expect(brainB.currentTerrainId).toBe('outpost');
  });

  // -------------------------------------------------------------------------
  // Test 5: NPC_DIED event emitted when brain dies
  // -------------------------------------------------------------------------
  it('onDeath() emits NPC_DIED event and clears terrain assignment', () => {
    const deps = createSharedDeps();

    const terrain = createTerrain({
      id: 'arena',
      capacity: 5,
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      jobs: [{ type: 'guard', slots: 5, position: { x: 100, y: 100 } }],
    });

    const brain = createBrain('npc_dead', 'stalker', deps, deps.movement, {
      position: { x: 100, y: 100 },
      brainConfig: { reEvaluateIntervalMs: 0 },
    });

    brain.update(0, [terrain]);
    deps.events.flush();

    expect(brain.currentTerrainId).toBe('arena');

    const diedEvents: string[] = [];
    deps.events.on(ALifeEvents.NPC_DIED, (p) => diedEvents.push((p as { npcId: string }).npcId));

    brain.onDeath();
    deps.events.flush();

    expect(diedEvents).toContain('npc_dead');
    expect(brain.currentTerrainId).toBeNull();
    expect(brain.currentTask).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 6: Faction conflict — stalker and bandit on same terrain
  //         Both brains can occupy the terrain (A-Life allows it),
  //         but we verify they both update without conflict errors
  // -------------------------------------------------------------------------
  it('stalker brain and bandit brain on same terrain — no crash, both update cleanly', () => {
    const deps = createSharedDeps();

    const terrain = createTerrain({
      id: 'crossroads',
      capacity: 10,
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      jobs: [{ type: 'patrol', slots: 10, position: { x: 100, y: 100 } }],
    });

    const stalkerBrain = createBrain('stalker_1', 'stalker', deps, deps.movement, {
      position: { x: 100, y: 100 },
      brainConfig: { reEvaluateIntervalMs: 0 },
    });
    const banditBrain = createBrain('bandit_1', 'bandit', deps, deps.movement, {
      position: { x: 100, y: 100 },
      brainConfig: { reEvaluateIntervalMs: 0 },
    });

    expect(() => {
      stalkerBrain.update(0, [terrain]);
      banditBrain.update(0, [terrain]);
      deps.events.flush();
    }).not.toThrow();

    // Both can co-locate on a high-capacity terrain
    expect(stalkerBrain.currentTerrainId).toBe('crossroads');
    expect(banditBrain.currentTerrainId).toBe('crossroads');
  });

  // -------------------------------------------------------------------------
  // Test 7: Faction conflict — bandit brain excluded from stalker-only terrain
  // -------------------------------------------------------------------------
  it('faction-restricted terrain: bandit excluded from stalker-only terrain (allowedFactions)', () => {
    const deps = createSharedDeps();

    // Terrain that only allows stalker faction (ISmartTerrainConfig uses allowedFactions)
    const stalkerBase = createTerrain({
      id: 'stalker_base',
      capacity: 5,
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      allowedFactions: ['stalker'], // only stalkers allowed
      jobs: [{ type: 'guard', slots: 5, position: { x: 100, y: 100 } }],
    });

    const stalkerBrain = createBrain('stalker_2', 'stalker', deps, deps.movement, {
      position: { x: 100, y: 100 },
      brainConfig: { reEvaluateIntervalMs: 0 },
    });
    const banditBrain = createBrain('bandit_2', 'bandit', deps, deps.movement, {
      position: { x: 100, y: 100 },
      brainConfig: { reEvaluateIntervalMs: 0 },
    });

    stalkerBrain.update(0, [stalkerBase]);
    banditBrain.update(0, [stalkerBase]);
    deps.events.flush();

    // Stalker gets in, bandit does not (allowedFactions blocks it)
    expect(stalkerBrain.currentTerrainId).toBe('stalker_base');
    expect(banditBrain.currentTerrainId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Test 8: Combat lock — brain does not update while combat-locked
  // -------------------------------------------------------------------------
  it('brain does not switch terrain while combat-locked', () => {
    const deps = createSharedDeps();

    const terrain1 = createTerrain({
      id: 'terrain_1',
      capacity: 5,
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      jobs: [{ type: 'guard', slots: 5, position: { x: 100, y: 100 } }],
    });
    const terrain2 = createTerrain({
      id: 'terrain_2',
      capacity: 5,
      bounds: { x: 500, y: 0, width: 200, height: 200 },
      jobs: [{ type: 'camp', slots: 5, position: { x: 600, y: 100 } }],
    });

    const brain = createBrain('npc_locked', 'stalker', deps, deps.movement, {
      position: { x: 100, y: 100 },
      brainConfig: { reEvaluateIntervalMs: 0 },
    });

    // Assign to terrain_1
    brain.update(0, [terrain1]);
    deps.events.flush();
    expect(brain.currentTerrainId).toBe('terrain_1');

    // Lock in combat
    brain.setCombatLock(15_000); // 15 second lock
    expect(brain.isCombatLocked).toBe(true);

    // Try to update — combat lock blocks terrain switch
    brain.update(1_000, [terrain1, terrain2]);
    deps.events.flush();

    // Should still be on terrain_1 (locked)
    expect(brain.currentTerrainId).toBe('terrain_1');
    expect(brain.isCombatLocked).toBe(true);

    // After lock expires, brain can update normally
    brain.update(15_000, [terrain1, terrain2]);
    deps.events.flush();
    expect(brain.isCombatLocked).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 9: Multiple brains update in series — terrain occupancy is consistent
  // -------------------------------------------------------------------------
  it('5 brains update in series — terrain occupancy never exceeds capacity', () => {
    const deps = createSharedDeps();

    const terrain = createTerrain({
      id: 'camp',
      capacity: 3, // only 3 can fit
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      jobs: [{ type: 'camp', slots: 5, position: { x: 100, y: 100 } }],
    });

    const brains: NPCBrain[] = [];
    for (let i = 0; i < 5; i++) {
      brains.push(createBrain(`npc_${i}`, 'stalker', deps, deps.movement, {
        position: { x: 100, y: 100 },
        brainConfig: { reEvaluateIntervalMs: 0 },
      }));
    }

    // All 5 brains try to get into the terrain
    for (const brain of brains) {
      brain.update(0, [terrain]);
    }
    deps.events.flush();

    const onTerrain = brains.filter((b) => b.currentTerrainId === 'camp').length;
    expect(onTerrain).toBeLessThanOrEqual(3); // capacity enforcement
    expect(onTerrain).toBeGreaterThanOrEqual(1); // at least one got in
  });

  // -------------------------------------------------------------------------
  // Test 10: surge flee — brains flee to shelter when surge is active
  // -------------------------------------------------------------------------
  it('surge active — brains flee to shelter terrain (non-shelters skipped by TerrainSelector)', () => {
    const deps = createSharedDeps();

    // Only danger_zone available initially (no shelter)
    const dangerZone = createTerrain({
      id: 'danger_zone',
      capacity: 5,
      bounds: { x: 0, y: 0, width: 200, height: 200 },
      isShelter: false,
      jobs: [{ type: 'guard', slots: 5, position: { x: 100, y: 100 } }],
    });
    const bunker = createTerrain({
      id: 'bunker',
      capacity: 10,
      bounds: { x: 500, y: 0, width: 200, height: 200 },
      isShelter: true,
      jobs: [{ type: 'camp', slots: 10, position: { x: 600, y: 100 } }],
    });

    const brain1 = createBrain('npc_surge_1', 'stalker', deps, deps.movement, {
      position: { x: 100, y: 100 },
      brainConfig: { reEvaluateIntervalMs: 0 },
    });
    const brain2 = createBrain('npc_surge_2', 'stalker', deps, deps.movement, {
      position: { x: 100, y: 100 },
      brainConfig: { reEvaluateIntervalMs: 0 },
    });

    // First: settle into danger_zone (only terrain provided, no surge)
    brain1.update(0, [dangerZone]);
    brain2.update(0, [dangerZone]);
    deps.events.flush();

    expect(brain1.currentTerrainId).toBe('danger_zone');
    expect(brain2.currentTerrainId).toBe('danger_zone');

    // Activate surge
    brain1.setSurgeActive(true);
    brain2.setSurgeActive(true);

    // Update with both terrains — surge flee should skip danger_zone, pick bunker
    brain1.update(0, [dangerZone, bunker]);
    brain2.update(0, [dangerZone, bunker]);
    deps.events.flush();

    // Both brains must have fled to the shelter
    expect(brain1.currentTerrainId).toBe('bunker');
    expect(brain2.currentTerrainId).toBe('bunker');
  });
});
