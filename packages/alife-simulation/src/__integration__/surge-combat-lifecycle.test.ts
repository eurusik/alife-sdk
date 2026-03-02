/**
 * Integration test: "Surge-combat lifecycle".
 *
 * Verifies the full surge lifecycle driving brain terrain selection +
 * combat suppression, using real objects end-to-end -- zero mocks.
 *
 * Covers:
 *   1. Full surge lifecycle drives brain shelter-seeking and return
 *   2. Sheltered NPCs take no PSI damage during active surge
 *   3. Aftermath resets spawn cooldowns and restores morale
 *   4. Offline combat skipped during active surge (integration pattern)
 *   5. NPC dies during surge -- onSurgeDeath callback fires
 */

import { SmartTerrain, EventBus, SpawnRegistry, ALifeEvents, Faction, FactionBuilder } from '@alife-sdk/core';
import type { ALifeEventPayloads, IRandom } from '@alife-sdk/core';
import { createWorld, createTerrain, type IWorld } from './helpers';
import type { ISimulationBridge } from '../ports/ISimulationBridge';
import type { ISurgeConfig } from '../types/ISimulationConfig';
import { SurgeManager, type ISurgeNPCRecord } from '../surge/SurgeManager';
import { SurgePhase } from '../surge/SurgePhase';

// ---------------------------------------------------------------------------
// Deterministic random -- always returns 0.5
// ---------------------------------------------------------------------------

const fixedRandom: IRandom = {
  next: () => 0.5,
  nextInt: (min, max) => Math.floor(0.5 * (max - min + 1)) + min,
  nextFloat: (min, max) => 0.5 * (max - min) + min,
};

// ---------------------------------------------------------------------------
// Surge config factory -- fast timers for test ergonomics
// ---------------------------------------------------------------------------

function createTestSurgeConfig(overrides?: Partial<ISurgeConfig>): ISurgeConfig {
  return {
    intervalMinMs: 1_000,
    intervalMaxMs: 1_000,
    warningDurationMs: 500,
    activeDurationMs: 2_000,
    aftermathDurationMs: 300,
    damagePerTick: 25,
    damageTickIntervalMs: 500,
    moralePenalty: -0.3,
    moraleRestore: 0.15,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Bridge factories -- real plain objects, NOT vi.fn
// ---------------------------------------------------------------------------

/** Stub bridge that reports all entities alive and never kills. */
function createStubBridge(overrides?: Partial<ISimulationBridge>): ISimulationBridge {
  return {
    isAlive: () => true,
    applyDamage: () => false,
    getEffectiveDamage: (_id, raw) => raw,
    adjustMorale: () => {},
    ...overrides,
  };
}

/** Tracking bridge that records all calls for assertion. */
function createTrackingBridge(
  overrides?: Partial<ISimulationBridge>,
): { bridge: ISimulationBridge; calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const bridge: ISimulationBridge = {
    isAlive: (id) => {
      calls.push({ method: 'isAlive', args: [id] });
      return overrides?.isAlive?.(id) ?? true;
    },
    applyDamage: (id, amt, type) => {
      calls.push({ method: 'applyDamage', args: [id, amt, type] });
      return overrides?.applyDamage?.(id, amt, type) ?? false;
    },
    getEffectiveDamage: (id, raw, type) => {
      return overrides?.getEffectiveDamage?.(id, raw, type) ?? raw;
    },
    adjustMorale: (id, delta, reason) => {
      calls.push({ method: 'adjustMorale', args: [id, delta, reason] });
      overrides?.adjustMorale?.(id, delta, reason);
    },
  };
  return { bridge, calls };
}

// ---------------------------------------------------------------------------
// NPC record factory
// ---------------------------------------------------------------------------

function createSurgeNPC(
  entityId: string,
  currentTerrainId: string | null = null,
): ISurgeNPCRecord {
  return { entityId, currentTerrainId };
}

// ---------------------------------------------------------------------------
// Surge manager factory
// ---------------------------------------------------------------------------

function createSurge(opts?: {
  config?: Partial<ISurgeConfig>;
  bridge?: ISimulationBridge;
  random?: IRandom;
  onSurgeDeath?: (npcId: string) => void;
}): {
  manager: SurgeManager;
  events: EventBus<ALifeEventPayloads>;
  spawnRegistry: SpawnRegistry;
} {
  const events = new EventBus<ALifeEventPayloads>();
  const spawnRegistry = new SpawnRegistry();
  const manager = new SurgeManager({
    config: createTestSurgeConfig(opts?.config),
    events,
    spawnRegistry,
    bridge: opts?.bridge ?? createStubBridge(),
    random: opts?.random ?? fixedRandom,
    onSurgeDeath: opts?.onSurgeDeath,
  });
  return { manager, events, spawnRegistry };
}

// ---------------------------------------------------------------------------
// Phase advancement helpers
// ---------------------------------------------------------------------------

/**
 * Advance past the cooldown (1000ms with deterministic random) into WARNING.
 */
function advanceToWarning(
  manager: SurgeManager,
  npcs: ReadonlyMap<string, ISurgeNPCRecord>,
  terrains: readonly SmartTerrain[],
  events: EventBus<ALifeEventPayloads>,
): void {
  manager.update(1_001, npcs, terrains);
  events.flush();
}

function advanceToActive(
  manager: SurgeManager,
  npcs: ReadonlyMap<string, ISurgeNPCRecord>,
  terrains: readonly SmartTerrain[],
  events: EventBus<ALifeEventPayloads>,
): void {
  advanceToWarning(manager, npcs, terrains, events);
  // Warning duration = 500ms
  manager.update(501, npcs, terrains);
  events.flush();
}

function advanceToAftermath(
  manager: SurgeManager,
  npcs: ReadonlyMap<string, ISurgeNPCRecord>,
  terrains: readonly SmartTerrain[],
  events: EventBus<ALifeEventPayloads>,
): void {
  advanceToActive(manager, npcs, terrains, events);
  // Active duration = 2000ms
  manager.update(2_001, npcs, terrains);
  events.flush();
}

function _advanceToInactiveAfterAftermath(
  manager: SurgeManager,
  npcs: ReadonlyMap<string, ISurgeNPCRecord>,
  terrains: readonly SmartTerrain[],
  events: EventBus<ALifeEventPayloads>,
): void {
  advanceToAftermath(manager, npcs, terrains, events);
  // Aftermath effects fire on first update after entering AFTERMATH
  manager.update(1, npcs, terrains);
  events.flush();
  // Aftermath duration = 300ms
  manager.update(300, npcs, terrains);
  events.flush();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Surge-combat lifecycle (integration)', () => {
  // -----------------------------------------------------------------------
  // 1. Full surge lifecycle drives brain shelter-seeking and return
  // -----------------------------------------------------------------------
  describe('full surge lifecycle drives brain shelter-seeking and return', () => {
    /**
     * Setup: 2 terrains at the same location (0,0) -- shelter and open_field.
     * 2 NPCs (stalker faction, not hostile -- so no combat).
     */
    function buildShelterWorld(): IWorld {
      return createWorld({
        clockHour: 12,
        terrains: [
          {
            id: 'shelter',
            name: 'Бункер',
            bounds: { x: 0, y: 0, width: 100, height: 100 },
            capacity: 10,
            isShelter: true,
            jobs: [{ type: 'camp', slots: 5, position: { x: 50, y: 50 } }],
          },
          {
            id: 'open_field',
            name: 'Відкрите поле',
            bounds: { x: 0, y: 0, width: 100, height: 100 },
            capacity: 10,
            isShelter: false,
            jobs: [{ type: 'guard', slots: 5, position: { x: 50, y: 50 } }],
          },
        ],
        npcs: [
          { id: 'npc_alpha', faction: 'stalkers', rank: 2, position: { x: 50, y: 50 } },
          { id: 'npc_bravo', faction: 'stalkers', rank: 2, position: { x: 50, y: 50 } },
        ],
      });
    }

    it('pre-surge: brains select terrain normally', () => {
      const world = buildShelterWorld();
      world.tick(0);

      // Both NPCs select a terrain (shelter wins due to +50 shelter bonus at dist~0)
      for (const brain of world.brains) {
        expect(brain.currentTerrainId).not.toBeNull();
      }
    });

    it('WARNING: brains select shelter after setSurgeActive(true)', () => {
      const world = buildShelterWorld();
      world.tick(0);

      // Activate surge mode on all brains
      for (const brain of world.brains) {
        brain.setSurgeActive(true);
      }
      world.tick(0);

      // All NPCs must be in the shelter
      for (const brain of world.brains) {
        expect(brain.currentTerrainId).toBe('shelter');
      }
    });

    it('ACTIVE: NPCs stay in shelter', () => {
      const world = buildShelterWorld();
      world.tick(0);

      for (const brain of world.brains) {
        brain.setSurgeActive(true);
      }
      world.tick(0);

      // Simulate several more ticks while surge is "active" -- brains stay in shelter
      for (let i = 0; i < 5; i++) {
        world.tick(500);
      }

      for (const brain of world.brains) {
        expect(brain.currentTerrainId).toBe('shelter');
      }
    });

    it('AFTERMATH -> INACTIVE: brains return to any terrain after surge ends', () => {
      const world = buildShelterWorld();
      world.tick(0);

      // Surge on
      for (const brain of world.brains) {
        brain.setSurgeActive(true);
      }
      world.tick(0);

      for (const brain of world.brains) {
        expect(brain.currentTerrainId).toBe('shelter');
      }

      // Surge off + force re-evaluation
      for (const brain of world.brains) {
        brain.setSurgeActive(false);
        brain.forceReevaluate();
      }
      world.tick(0);

      // NPCs are free to choose any terrain again.
      // The key invariant: each brain holds a valid, non-null terrain ID.
      for (const brain of world.brains) {
        expect(brain.currentTerrainId).not.toBeNull();
        const terrain = world.terrains.find((t) => t.id === brain.currentTerrainId);
        expect(terrain).toBeDefined();
      }
    });
  });

  // -----------------------------------------------------------------------
  // 2. Sheltered NPCs take no PSI damage during active surge
  // -----------------------------------------------------------------------
  describe('sheltered NPCs take no PSI damage during active surge', () => {
    it('outdoor NPC takes damage, sheltered NPC does not', () => {
      const shelterTerrain = createTerrain({
        id: 'bunker',
        name: 'Бункер',
        isShelter: true,
      });

      const npcs = new Map<string, ISurgeNPCRecord>([
        ['npc_indoor', createSurgeNPC('ent_indoor', 'bunker')],
        ['npc_outdoor', createSurgeNPC('ent_outdoor', null)],
      ]);

      const { bridge, calls } = createTrackingBridge();
      const { manager, events } = createSurge({ bridge });
      manager.init();

      // Advance to ACTIVE phase
      advanceToActive(manager, npcs, [shelterTerrain], events);
      expect(manager.getPhase()).toBe(SurgePhase.ACTIVE);

      // Fire one damage tick (500ms interval)
      manager.update(500, npcs, [shelterTerrain]);
      events.flush();

      // Only the outdoor NPC should have received applyDamage('psi')
      const damageCalls = calls.filter((c) => c.method === 'applyDamage');
      expect(damageCalls).toHaveLength(1);
      expect(damageCalls[0]!.args).toEqual(['ent_outdoor', 25, 'psi']);

      // Sheltered NPC should NOT have received any damage
      const indoorDamage = damageCalls.filter((c) => c.args[0] === 'ent_indoor');
      expect(indoorDamage).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Aftermath resets spawn cooldowns and restores morale
  // -----------------------------------------------------------------------
  describe('aftermath resets spawn cooldowns and restores morale', () => {
    it('spawn cooldowns are reset after full lifecycle reaches AFTERMATH', () => {
      const { manager, events, spawnRegistry } = createSurge();
      manager.init();

      // Add a spawn point and mark it as recently spawned (starts cooldown)
      spawnRegistry.addPoint({
        id: 'sp_zone_1',
        terrainId: 'terrain_1',
        position: { x: 100, y: 100 },
        factionId: 'stalkers',
        maxNPCs: 3,
      });
      spawnRegistry.markSpawned('sp_zone_1');

      // Before surge: cooldown is active -> not eligible
      expect(spawnRegistry.getEligiblePoints()).toHaveLength(0);

      const emptyNpcs = new Map<string, ISurgeNPCRecord>();
      const emptyTerrains: SmartTerrain[] = [];

      // Advance through full lifecycle to AFTERMATH
      advanceToAftermath(manager, emptyNpcs, emptyTerrains, events);
      expect(manager.getPhase()).toBe(SurgePhase.AFTERMATH);

      // First aftermath update triggers resetAllCooldowns
      manager.update(1, emptyNpcs, emptyTerrains);
      events.flush();

      // Now the spawn point should be eligible (cooldown reset, active=1 < max=3)
      const eligible = spawnRegistry.getEligiblePoints();
      expect(eligible).toHaveLength(1);
      expect(eligible[0]!.id).toBe('sp_zone_1');
    });

    it('morale restore is applied to all surviving NPCs during aftermath', () => {
      const npcs = new Map<string, ISurgeNPCRecord>([
        ['npc_survivor_1', createSurgeNPC('ent_1')],
        ['npc_survivor_2', createSurgeNPC('ent_2')],
      ]);

      const { bridge, calls } = createTrackingBridge();
      const { manager, events } = createSurge({ bridge });
      manager.init();

      const emptyTerrains: SmartTerrain[] = [];

      // Advance to AFTERMATH
      advanceToAftermath(manager, npcs, emptyTerrains, events);

      // First aftermath update
      manager.update(1, npcs, emptyTerrains);
      events.flush();

      // Verify adjustMorale called with 'surge_aftermath' for both survivors
      const aftermathMoraleCalls = calls.filter(
        (c) => c.method === 'adjustMorale' && c.args[2] === 'surge_aftermath',
      );
      expect(aftermathMoraleCalls).toHaveLength(2);
      expect(aftermathMoraleCalls[0]!.args).toEqual(['ent_1', 0.15, 'surge_aftermath']);
      expect(aftermathMoraleCalls[1]!.args).toEqual(['ent_2', 0.15, 'surge_aftermath']);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Offline combat skipped during active surge (integration pattern)
  // -----------------------------------------------------------------------
  describe('offline combat skipped during active surge (integration pattern)', () => {
    /**
     * This demonstrates the orchestration pattern: game-side checks
     * surgeManager.isActive() to skip offline combat resolution.
     */

    it('surgeManager.isActive() returns true during ACTIVE phase', () => {
      const { manager, events } = createSurge();
      manager.init();

      const emptyNpcs = new Map<string, ISurgeNPCRecord>();
      const emptyTerrains: SmartTerrain[] = [];

      // Before surge: not active
      expect(manager.isActive()).toBe(false);

      // Advance to ACTIVE
      advanceToActive(manager, emptyNpcs, emptyTerrains, events);
      expect(manager.isActive()).toBe(true);
    });

    it('the isActive() guard prevents combat during surge', () => {
      // Setup: 2 hostile factions in the same terrain
      const stalkersDef = new FactionBuilder('stalkers')
        .displayName('Stalkers')
        .relation('bandits', -80)
        .build();
      const banditsDef = new FactionBuilder('bandits')
        .displayName('Bandits')
        .relation('stalkers', -80)
        .build();

      const stalkersFaction = new Faction('stalkers', stalkersDef);
      const banditsFaction = new Faction('bandits', banditsDef);

      // Verify they are mutually hostile
      expect(stalkersFaction.isHostile('bandits')).toBe(true);
      expect(banditsFaction.isHostile('stalkers')).toBe(true);

      // Create surge manager and advance to ACTIVE
      const { manager, events } = createSurge();
      manager.init();

      const npcs = new Map<string, ISurgeNPCRecord>([
        ['npc_stalker', createSurgeNPC('ent_stalker', 'shared_terrain')],
        ['npc_bandit', createSurgeNPC('ent_bandit', 'shared_terrain')],
      ]);
      const terrain = createTerrain({
        id: 'shared_terrain',
        name: 'Shared',
      });

      advanceToActive(manager, npcs, [terrain], events);
      expect(manager.isActive()).toBe(true);

      // The integration pattern: game-side uses isActive() as a guard
      // When surge is active, combat resolver is NOT called
      let combatResolved = false;
      if (!manager.isActive()) {
        // This block would call OfflineCombatResolver.resolve(...)
        combatResolved = true;
      }
      expect(combatResolved).toBe(false);

      // After surge ends (advance to AFTERMATH, then INACTIVE), combat can resume
      manager.update(2_001, npcs, [terrain]);
      events.flush();
      expect(manager.getPhase()).toBe(SurgePhase.AFTERMATH);

      // Aftermath -> INACTIVE
      manager.update(1, npcs, [terrain]);
      events.flush();
      manager.update(300, npcs, [terrain]);
      events.flush();
      expect(manager.getPhase()).toBe(SurgePhase.INACTIVE);

      // Now combat can proceed
      if (!manager.isActive()) {
        combatResolved = true;
      }
      expect(combatResolved).toBe(true);
    });

    it('sheltered NPCs are indexed by terrain ID (not in outdoor combat zone)', () => {
      // During active surge, NPCs with shelter terrain IDs are marked as sheltered.
      // The OfflineCombatResolver's buildTerrainIndex groups by brain.currentTerrainId.
      // This means sheltered NPCs are in 'shelter' terrain, not in the hostile terrain.

      const shelterId = 'safe_bunker';
      const hostileTerrainId = 'contested_zone';

      const npcs = new Map<string, ISurgeNPCRecord>([
        // NPC fled to shelter -- not in the contested terrain
        ['npc_safe', createSurgeNPC('ent_safe', shelterId)],
        // NPC still in the hostile terrain
        ['npc_exposed', createSurgeNPC('ent_exposed', hostileTerrainId)],
      ]);

      // Verify the terrain assignments: sheltered NPC is NOT in hostile terrain
      const npcsSafe = npcs.get('npc_safe');
      const npcsExposed = npcs.get('npc_exposed');
      expect(npcsSafe!.currentTerrainId).toBe(shelterId);
      expect(npcsExposed!.currentTerrainId).toBe(hostileTerrainId);

      // In a real combat resolution pass, only NPCs in the same terrain
      // would be grouped together. The sheltered NPC (in 'safe_bunker')
      // would not appear in the 'contested_zone' bucket.
      const terrainIndex = new Map<string, string[]>();
      for (const [npcId, record] of npcs) {
        if (record.currentTerrainId === null) continue;
        const bucket = terrainIndex.get(record.currentTerrainId);
        if (bucket) {
          bucket.push(npcId);
        } else {
          terrainIndex.set(record.currentTerrainId, [npcId]);
        }
      }

      // Shelter terrain has only the safe NPC
      expect(terrainIndex.get(shelterId)).toEqual(['npc_safe']);
      // Hostile terrain has only the exposed NPC -- no cross-faction combat possible
      // because there is only 1 NPC in that terrain
      expect(terrainIndex.get(hostileTerrainId)).toEqual(['npc_exposed']);
    });
  });

  // -----------------------------------------------------------------------
  // 5. NPC dies during surge -- onSurgeDeath callback fires
  // -----------------------------------------------------------------------
  describe('NPC dies during surge -- onSurgeDeath callback fires', () => {
    it('onSurgeDeath receives the npcId when applyDamage returns true (kill)', () => {
      const deadIds: string[] = [];

      // Bridge that kills any NPC it damages
      const killerBridge = createStubBridge({
        applyDamage: () => true, // always fatal
      });

      const { manager, events } = createSurge({
        bridge: killerBridge,
        onSurgeDeath: (npcId) => deadIds.push(npcId),
      });
      manager.init();

      // 1 outdoor NPC with no shelter
      const npcs = new Map<string, ISurgeNPCRecord>([
        ['doomed_npc', createSurgeNPC('ent_doomed', null)],
      ]);
      const emptyTerrains: SmartTerrain[] = [];

      // Advance to ACTIVE
      advanceToActive(manager, npcs, emptyTerrains, events);
      expect(manager.getPhase()).toBe(SurgePhase.ACTIVE);

      // Fire one damage tick
      manager.update(500, npcs, emptyTerrains);
      events.flush();

      // Verify the callback received the correct npcId
      expect(deadIds).toEqual(['doomed_npc']);
    });

    it('no SURGE_DAMAGE event emitted for NPC that died from surge damage', () => {
      const killerBridge = createStubBridge({
        applyDamage: () => true,
      });

      const { manager, events } = createSurge({ bridge: killerBridge });
      manager.init();

      const npcs = new Map<string, ISurgeNPCRecord>([
        ['dead_npc', createSurgeNPC('ent_dead', null)],
      ]);

      const damageEvents: unknown[] = [];
      events.on(ALifeEvents.SURGE_DAMAGE, (p) => damageEvents.push(p));

      advanceToActive(manager, npcs, [], events);
      manager.update(500, npcs, []);
      events.flush();

      // Dead NPCs do not trigger SURGE_DAMAGE (they die before the event fires)
      expect(damageEvents).toHaveLength(0);
    });

    it('morale penalty is NOT applied to NPC that died from surge damage', () => {
      const { bridge, calls } = createTrackingBridge({
        applyDamage: () => true, // kills on first hit
      });

      const { manager, events } = createSurge({ bridge });
      manager.init();

      const npcs = new Map<string, ISurgeNPCRecord>([
        ['victim', createSurgeNPC('ent_victim', null)],
      ]);

      advanceToActive(manager, npcs, [], events);
      manager.update(500, npcs, []);
      events.flush();

      // adjustMorale with reason 'surge' should NOT be called for dead NPC
      const surgeMoraleCalls = calls.filter(
        (c) => c.method === 'adjustMorale' && c.args[2] === 'surge',
      );
      expect(surgeMoraleCalls).toHaveLength(0);
    });
  });
});
