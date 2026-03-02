/**
 * Integration test: "Zona zhyve" (The Zone is alive).
 *
 * Verifies multi-NPC terrain selection, faction filtering, capacity
 * enforcement, task assignment, and movement completion using real
 * objects end-to-end -- zero mocks.
 */

import { ALifeEvents } from '@alife-sdk/core';
import { createWorld, createTerrain, type IWorld } from './helpers';

// ---------------------------------------------------------------------------
// World setup
// ---------------------------------------------------------------------------

function buildZoneLivesWorld(): IWorld {
  return createWorld({
    clockHour: 12,
    terrains: [
      {
        id: 'bar_100',
        name: 'Бар 100 рентген',
        bounds: { x: 50, y: 50, width: 100, height: 100 },
        capacity: 5,
        isShelter: true,
        allowedFactions: ['stalkers'],
        jobs: [
          { type: 'guard', slots: 2, position: { x: 80, y: 80 } },
          { type: 'camp', slots: 3, position: { x: 100, y: 100 } },
        ],
      },
      {
        id: 'mil_checkpoint',
        name: 'Блокпост',
        bounds: { x: 250, y: 50, width: 100, height: 100 },
        capacity: 3,
        allowedFactions: ['military'],
        jobs: [
          { type: 'guard', slots: 2, position: { x: 280, y: 80 } },
        ],
      },
      {
        id: 'warehouse',
        name: 'Склад',
        bounds: { x: 150, y: 150, width: 100, height: 100 },
        capacity: 4,
        dangerLevel: 2,
        jobs: [
          { type: 'camp', slots: 2, position: { x: 200, y: 200 } },
        ],
      },
    ],
    npcs: [
      { id: 'wolf', faction: 'stalkers', rank: 3, position: { x: 100, y: 100 } },
      { id: 'kuznetsov', faction: 'military', rank: 2, position: { x: 300, y: 100 } },
      { id: 'knife', faction: 'bandits', rank: 1, position: { x: 200, y: 200 } },
    ],
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Zona zhyve -- multi-NPC basic cycle', () => {
  let world: IWorld;

  beforeEach(() => {
    world = buildZoneLivesWorld();
  });

  it('each NPC selects a terrain matching its faction on the first tick', () => {
    world.tick(0);

    const [wolf, kuznetsov, knife] = world.brains;

    // Wolf (stalkers) -> bar_100 (stalkers-only) or warehouse (open)
    // bar_100 is a shelter (+50), so it wins for a stalker near (100,100)
    expect(wolf.currentTerrainId).toBe('bar_100');

    // Kuznetsov (military) -> mil_checkpoint (military-only)
    expect(kuznetsov.currentTerrainId).toBe('mil_checkpoint');

    // Knife (bandits) -> warehouse (no faction filter, the only option)
    expect(knife.currentTerrainId).toBe('warehouse');
  });

  it('emits TASK_ASSIGNED for each NPC after the first tick', () => {
    const taskPayloads: Array<{ npcId: string; terrainId: string; taskType: string }> = [];
    world.events.on(
      ALifeEvents.TASK_ASSIGNED,
      (p) => taskPayloads.push(p as typeof taskPayloads[0]),
    );

    world.tick(0);

    const assignedNpcIds = taskPayloads.map((p) => p.npcId).sort();
    expect(assignedNpcIds).toEqual(['knife', 'kuznetsov', 'wolf']);

    for (const payload of taskPayloads) {
      expect(payload.terrainId).toBeTruthy();
      expect(payload.taskType).toBeTruthy();
    }
  });

  it('wolf cannot be assigned to mil_checkpoint (military-only)', () => {
    // Remove bar_100 and warehouse from the terrain list -- only mil_checkpoint remains
    const milOnly = world.terrains.filter((t) => t.id === 'mil_checkpoint');
    const wolf = world.brains[0];

    wolf.update(0, milOnly);
    world.events.flush();

    // No suitable terrain for stalkers faction
    expect(wolf.currentTerrainId).toBeNull();
  });

  it('capacity-1 terrain fills and subsequent NPC goes elsewhere', () => {
    // Two terrains at the same location. Both NPCs prefer terrain_a
    // (higher capacity score), but after the first NPC fills it,
    // the second NPC is forced to terrain_b.
    const terrainA = createTerrain({
      id: 'terrain_a',
      name: 'Хата А',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      capacity: 1,
      jobs: [{ type: 'camp', slots: 1, position: { x: 50, y: 50 } }],
    });
    const terrainB = createTerrain({
      id: 'terrain_b',
      name: 'Хата Б',
      bounds: { x: 0, y: 0, width: 100, height: 100 },
      capacity: 1,
      jobs: [{ type: 'camp', slots: 1, position: { x: 50, y: 50 } }],
    });

    const narrowWorld = createWorld({
      clockHour: 12,
      terrains: [],
      npcs: [
        { id: 'npc_a', faction: 'stalkers', rank: 1, position: { x: 50, y: 50 } },
        { id: 'npc_b', faction: 'stalkers', rank: 1, position: { x: 50, y: 50 } },
      ],
    });

    // Update brains sequentially with the shared terrain pool.
    // First brain takes one terrain, second must take the other.
    const terrains = [terrainA, terrainB];
    for (const brain of narrowWorld.brains) {
      brain.update(0, terrains);
    }
    narrowWorld.events.flush();

    const [a, b] = narrowWorld.brains;
    const terrainIds = new Set([a.currentTerrainId, b.currentTerrainId]);

    // Both terrains are occupied -- one NPC per terrain
    expect(terrainIds.size).toBe(2);
    expect(terrainIds).toContain('terrain_a');
    expect(terrainIds).toContain('terrain_b');
  });

  it('multiple sequential ticks are stable (no crashes)', () => {
    for (let i = 0; i < 10; i++) {
      world.tick(1_000);
    }

    for (const brain of world.brains) {
      expect(brain.currentTerrainId).not.toBeNull();
      expect(brain.currentTask).not.toBeNull();
    }
  });

  it('NPC_MOVED is emitted when a movement journey completes', () => {
    // Place an NPC far from its best terrain to ensure a real journey.
    const farWorld = createWorld({
      clockHour: 12,
      terrains: [
        {
          id: 'distant_bar',
          name: 'Далекий бар',
          bounds: { x: 500, y: 500, width: 100, height: 100 },
          capacity: 10,
          jobs: [{ type: 'guard', slots: 3, position: { x: 550, y: 550 } }],
        },
      ],
      npcs: [
        // NPC at origin, terrain center at (550,550) -- distance ~778px
        { id: 'traveler', faction: 'stalkers', rank: 2, position: { x: 0, y: 0 } },
      ],
    });

    const movedPayloads: Array<{ npcId: string; fromZone: string; toZone: string }> = [];
    farWorld.events.on(
      ALifeEvents.NPC_MOVED,
      (p) => movedPayloads.push(p as typeof movedPayloads[0]),
    );

    // First tick: brain selects terrain, dispatches movement
    farWorld.tick(0);
    expect(farWorld.movement.activeCount).toBe(1);
    expect(farWorld.movement.isMoving('traveler')).toBe(true);

    // Advance enough time for the journey to complete.
    // Distance ~778px at 50px/s => ~15.6s => 16_000ms to be safe.
    farWorld.tick(16_000);

    expect(movedPayloads).toHaveLength(1);
    expect(movedPayloads[0].npcId).toBe('traveler');
    expect(movedPayloads[0].toZone).toBe('distant_bar');
    expect(farWorld.movement.activeCount).toBe(0);
  });

  it('each NPC holds a task after terrain assignment', () => {
    world.tick(0);

    for (const brain of world.brains) {
      expect(brain.currentTask).not.toBeNull();
      expect(brain.currentTask!.terrainId).toBe(brain.currentTerrainId);
    }
  });
});
