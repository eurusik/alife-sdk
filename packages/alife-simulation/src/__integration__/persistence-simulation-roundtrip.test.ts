/**
 * Integration test: "PersistencePlugin + SimulationPlugin + EconomyPlugin roundtrip".
 *
 * Verifies that PersistencePlugin.save() -> new kernel -> PersistencePlugin.load()
 * correctly preserves full SimulationPlugin state, including:
 *   1. NPC records (factionId, rank) after multiple ticks
 *   2. NPC lastPosition after tick is preserved (not default)
 *   3. StoryRegistry state (storyId -> npcId mapping)
 *   4. Faction relations
 *   5. Tick counter / clock elapsed
 *   6. Additional ticks after load don't crash (brains continue)
 *   7. save() returns true, load() returns true
 *   8. Two save slots with different keys — slot isolation
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect } from 'vitest';
import {
  ALifeKernel,
  FactionsPlugin,
  FactionBuilder,
  Ports,
  SmartTerrain,
} from '@alife-sdk/core';
import type { IRandom } from '@alife-sdk/core';
import { PersistencePlugin, MemoryStorageProvider } from '@alife-sdk/persistence';
import { SimulationPlugin } from '../plugin/SimulationPlugin';
import { SimulationPorts } from '../ports/SimulationPorts';
import type { ISimulationBridge } from '../ports/ISimulationBridge';
import { EconomyPlugin } from '@alife-sdk/economy';
import {
  createTerrain,
  createBehaviorConfig,
  SEEDED_RANDOM,
} from './helpers';

function stubBridge(): ISimulationBridge {
  return {
    isAlive: () => true,
    applyDamage: () => false,
    getEffectiveDamage: (_id, raw) => raw,
    adjustMorale: () => {},
  };
}

const SEEDED_RANDOM_LOCAL: IRandom = {
  next: () => 0.25,
  nextInt: (min: number, max: number) => Math.floor(0.25 * (max - min + 1)) + min,
  nextFloat: (min: number, max: number) => 0.25 * (max - min) + min,
};

const DEFAULT_BEHAVIOR = createBehaviorConfig();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface IKernelWithPersistence {
  kernel: ALifeKernel;
  simulation: SimulationPlugin;
  economy: EconomyPlugin;
  persistence: PersistencePlugin;
  factionsPlugin: FactionsPlugin;
}

function buildKernelWithPersistence(
  backend: MemoryStorageProvider,
  saveKey = 'alife_save',
): IKernelWithPersistence {
  const kernel = new ALifeKernel({ clock: { startHour: 12, timeFactor: 1 } });

  kernel.provide(Ports.Random, SEEDED_RANDOM_LOCAL);

  // Factions.
  const factionsPlugin = new FactionsPlugin();
  kernel.use(factionsPlugin);

  const factions = [
    { id: 'loner', relations: { bandit: -100 } },
    { id: 'duty', relations: { bandit: -100 } },
    { id: 'bandit', relations: { loner: -100, duty: -100 } },
  ];
  for (const f of factions) {
    const builder = new FactionBuilder(f.id).displayName(f.id);
    for (const [otherId, score] of Object.entries(f.relations)) {
      builder.relation(otherId, score);
    }
    factionsPlugin.factions.register(f.id, builder.build());
  }

  // Simulation.
  const simulation = new SimulationPlugin({
    tickIntervalMs: 100,
    maxBrainUpdatesPerTick: 20,
    redundancyCleanupInterval: 3,
  });
  kernel.use(simulation);
  kernel.provide(SimulationPorts.SimulationBridge, stubBridge());

  // Economy.
  const economy = new EconomyPlugin(SEEDED_RANDOM);
  kernel.use(economy);

  // Persistence.
  const persistence = new PersistencePlugin({ backend, saveKey });
  kernel.use(persistence);

  // Terrains.
  simulation.addTerrain(createTerrain({ id: 'terrain_shelter', capacity: 10, isShelter: true }));
  simulation.addTerrain(new SmartTerrain({
    id: 'terrain_outdoor',
    name: 'Outdoor',
    bounds: { x: 0, y: 0, width: 200, height: 200 },
    capacity: 10,
  }));

  kernel.init();
  kernel.start();

  return { kernel, simulation, economy, persistence, factionsPlugin };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PersistencePlugin + SimulationPlugin roundtrip (integration)', () => {
  // -------------------------------------------------------------------------
  // 1. save() returns true, load() returns true
  // -------------------------------------------------------------------------
  it('save() returns true, load() returns true', () => {
    const backend = new MemoryStorageProvider();

    const ctxA = buildKernelWithPersistence(backend);
    ctxA.simulation.registerNPC({
      entityId: 'npc_1',
      factionId: 'loner',
      position: { x: 100, y: 100 },
      rank: 3,
      combatPower: 50,
      currentHp: 100,
      behaviorConfig: DEFAULT_BEHAVIOR,
    });
    ctxA.kernel.update(200);

    const saved = ctxA.persistence.save();
    expect(saved.ok).toBe(true);
    expect(backend.size()).toBe(1);

    const ctxB = buildKernelWithPersistence(backend);
    ctxB.simulation.registerNPC({
      entityId: 'npc_1',
      factionId: 'loner',
      position: { x: 0, y: 0 },
      rank: 3,
      combatPower: 50,
      currentHp: 100,
      behaviorConfig: DEFAULT_BEHAVIOR,
    });

    const loaded = ctxB.persistence.load();
    expect(loaded.ok).toBe(true);

    ctxA.kernel.destroy();
    ctxB.kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 2. 3 NPCs registered, tick x10 -> save -> new kernel -> load -> all 3 records exist
  // -------------------------------------------------------------------------
  it('3 NPCs registered, tick x10 -> save -> load -> all 3 NPC records exist with correct factionId/rank', () => {
    const backend = new MemoryStorageProvider();

    // Setup kernel A.
    // Use 3 loner NPCs (same faction, no hostile combat between them) and mark all as
    // story NPCs to prevent redundancy cleanup regardless.
    const ctxA = buildKernelWithPersistence(backend);

    ctxA.simulation.getStoryRegistry().register('quest_alpha', 'npc_loner_1');
    ctxA.simulation.getStoryRegistry().register('quest_beta', 'npc_loner_2');
    ctxA.simulation.getStoryRegistry().register('quest_gamma', 'npc_loner_3');

    ctxA.simulation.registerNPC({ entityId: 'npc_loner_1', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxA.simulation.registerNPC({ entityId: 'npc_loner_2', factionId: 'loner', position: { x: 150, y: 100 }, rank: 4, combatPower: 60, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxA.simulation.registerNPC({ entityId: 'npc_loner_3', factionId: 'loner', position: { x: 50, y: 150 }, rank: 2, combatPower: 35, currentHp: 70, behaviorConfig: DEFAULT_BEHAVIOR });

    // Tick 10 times.
    for (let i = 0; i < 10; i++) ctxA.kernel.update(200);

    // Save via persistence.
    const saved = ctxA.persistence.save();
    expect(saved.ok).toBe(true);

    // Setup kernel B + load.
    const ctxB = buildKernelWithPersistence(backend);
    ctxB.simulation.registerNPC({ entityId: 'npc_loner_1', factionId: 'loner', position: { x: 0, y: 0 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxB.simulation.registerNPC({ entityId: 'npc_loner_2', factionId: 'loner', position: { x: 0, y: 0 }, rank: 4, combatPower: 60, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxB.simulation.registerNPC({ entityId: 'npc_loner_3', factionId: 'loner', position: { x: 0, y: 0 }, rank: 2, combatPower: 35, currentHp: 70, behaviorConfig: DEFAULT_BEHAVIOR });
    const loaded = ctxB.persistence.load();
    expect(loaded.ok).toBe(true);

    // Assert all 3 NPC records exist with correct data.
    expect(ctxB.simulation.npcs.size).toBe(3);

    const npc1 = ctxB.simulation.getNPCRecord('npc_loner_1');
    expect(npc1).toBeDefined();
    expect(npc1!.factionId).toBe('loner');
    expect(npc1!.rank).toBe(3);

    const npc2 = ctxB.simulation.getNPCRecord('npc_loner_2');
    expect(npc2).toBeDefined();
    expect(npc2!.factionId).toBe('loner');
    expect(npc2!.rank).toBe(4);

    const npc3 = ctxB.simulation.getNPCRecord('npc_loner_3');
    expect(npc3).toBeDefined();
    expect(npc3!.factionId).toBe('loner');
    expect(npc3!.rank).toBe(2);

    ctxA.kernel.destroy();
    ctxB.kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 3. NPC position after tick is preserved across save/load
  // -------------------------------------------------------------------------
  it('NPC lastPosition after tick is preserved (not default position)', () => {
    const backend = new MemoryStorageProvider();

    const ctxA = buildKernelWithPersistence(backend);
    // Register NPC at non-origin position.
    ctxA.simulation.registerNPC({
      entityId: 'npc_mobile',
      factionId: 'loner',
      position: { x: 123, y: 456 },
      rank: 3,
      combatPower: 50,
      currentHp: 100,
      behaviorConfig: DEFAULT_BEHAVIOR,
    });

    // Tick to allow brain to update position.
    for (let i = 0; i < 5; i++) ctxA.kernel.update(200);

    const preSaveRecord = ctxA.simulation.getNPCRecord('npc_mobile');
    expect(preSaveRecord).toBeDefined();
    const savedPosition = { ...preSaveRecord!.lastPosition };

    ctxA.persistence.save();

    // Setup kernel B + load.
    const ctxB = buildKernelWithPersistence(backend);
    ctxB.simulation.registerNPC({
      entityId: 'npc_mobile',
      factionId: 'loner',
      position: { x: 0, y: 0 }, // default position before load
      rank: 3,
      combatPower: 50,
      currentHp: 100,
      behaviorConfig: DEFAULT_BEHAVIOR,
    });
    ctxB.persistence.load();

    const restoredRecord = ctxB.simulation.getNPCRecord('npc_mobile');
    expect(restoredRecord).toBeDefined();
    expect(restoredRecord!.lastPosition.x).toBe(savedPosition.x);
    expect(restoredRecord!.lastPosition.y).toBe(savedPosition.y);

    ctxA.kernel.destroy();
    ctxB.kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 4. StoryRegistry state is preserved across save/load
  // -------------------------------------------------------------------------
  it('StoryRegistry state (storyId -> npcId mapping) is preserved', () => {
    const backend = new MemoryStorageProvider();

    const ctxA = buildKernelWithPersistence(backend);

    // Register story NPC first.
    ctxA.simulation.getStoryRegistry().register('quest_main_story', 'npc_guide');
    ctxA.simulation.getStoryRegistry().register('quest_side_1', 'npc_trader');

    ctxA.simulation.registerNPC({ entityId: 'npc_guide', factionId: 'loner', position: { x: 100, y: 100 }, rank: 5, combatPower: 70, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxA.simulation.registerNPC({ entityId: 'npc_trader', factionId: 'loner', position: { x: 120, y: 100 }, rank: 3, combatPower: 40, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxA.simulation.registerNPC({ entityId: 'npc_regular', factionId: 'duty', position: { x: 200, y: 100 }, rank: 2, combatPower: 30, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });

    ctxA.kernel.update(200);
    ctxA.persistence.save();

    // Setup kernel B.
    const ctxB = buildKernelWithPersistence(backend);
    ctxB.simulation.registerNPC({ entityId: 'npc_guide', factionId: 'loner', position: { x: 0, y: 0 }, rank: 5, combatPower: 70, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxB.simulation.registerNPC({ entityId: 'npc_trader', factionId: 'loner', position: { x: 0, y: 0 }, rank: 3, combatPower: 40, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxB.simulation.registerNPC({ entityId: 'npc_regular', factionId: 'duty', position: { x: 0, y: 0 }, rank: 2, combatPower: 30, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxB.persistence.load();

    // Assert StoryRegistry is restored.
    expect(ctxB.simulation.getStoryRegistry().isStoryNPC('npc_guide')).toBe(true);
    expect(ctxB.simulation.getStoryRegistry().isStoryNPC('npc_trader')).toBe(true);
    expect(ctxB.simulation.getStoryRegistry().isStoryNPC('npc_regular')).toBe(false);
    expect(ctxB.simulation.getStoryRegistry().getStoryId('npc_guide')).toBe('quest_main_story');
    expect(ctxB.simulation.getStoryRegistry().getStoryId('npc_trader')).toBe('quest_side_1');

    ctxA.kernel.destroy();
    ctxB.kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 5. Faction personal goodwill relations preserved
  // -------------------------------------------------------------------------
  it('personal goodwill (NPCRelationRegistry) is preserved across save/load', () => {
    const backend = new MemoryStorageProvider();

    const ctxA = buildKernelWithPersistence(backend);
    ctxA.simulation.registerNPC({ entityId: 'npc_a', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxA.simulation.registerNPC({ entityId: 'npc_b', factionId: 'duty', position: { x: 120, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });

    // Set personal goodwill.
    ctxA.simulation.getRelationRegistry().adjustGoodwill('npc_a', 'npc_b', 30);
    ctxA.simulation.getRelationRegistry().adjustGoodwill('npc_b', 'npc_a', -20);

    ctxA.kernel.update(200);
    ctxA.persistence.save();

    // Restore.
    const ctxB = buildKernelWithPersistence(backend);
    ctxB.simulation.registerNPC({ entityId: 'npc_a', factionId: 'loner', position: { x: 0, y: 0 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxB.simulation.registerNPC({ entityId: 'npc_b', factionId: 'duty', position: { x: 0, y: 0 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxB.persistence.load();

    expect(ctxB.simulation.getRelationRegistry().getPersonalGoodwill('npc_a', 'npc_b')).toBe(30);
    expect(ctxB.simulation.getRelationRegistry().getPersonalGoodwill('npc_b', 'npc_a')).toBe(-20);

    ctxA.kernel.destroy();
    ctxB.kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 6. Tick counter / clock elapsed is preserved
  // -------------------------------------------------------------------------
  it('tick counter and clock elapsed are preserved across save/load', () => {
    const backend = new MemoryStorageProvider();

    const ctxA = buildKernelWithPersistence(backend);
    ctxA.simulation.registerNPC({ entityId: 'npc_1', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });

    // Tick several times to accumulate time.
    for (let i = 0; i < 8; i++) ctxA.kernel.update(200);

    const preTickCount = ctxA.kernel.tick;
    const preClockElapsed = ctxA.kernel.clock.totalGameSeconds;
    expect(preTickCount).toBeGreaterThan(0);
    expect(preClockElapsed).toBeGreaterThan(0);

    ctxA.persistence.save();

    // Setup kernel B + load.
    const ctxB = buildKernelWithPersistence(backend);
    ctxB.simulation.registerNPC({ entityId: 'npc_1', factionId: 'loner', position: { x: 0, y: 0 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxB.persistence.load();

    expect(ctxB.kernel.tick).toBe(preTickCount);
    // Clock should be restored to same elapsed time (within floating point tolerance).
    expect(ctxB.kernel.clock.totalGameSeconds).toBeCloseTo(preClockElapsed, 1);

    ctxA.kernel.destroy();
    ctxB.kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 7. After load, running additional ticks doesn't crash
  // -------------------------------------------------------------------------
  it('after load, running additional ticks does not crash (NPC brains continue functioning)', () => {
    const backend = new MemoryStorageProvider();

    const ctxA = buildKernelWithPersistence(backend);
    ctxA.simulation.registerNPC({ entityId: 'npc_loner_1', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxA.simulation.registerNPC({ entityId: 'npc_duty_1', factionId: 'duty', position: { x: 150, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });

    for (let i = 0; i < 5; i++) ctxA.kernel.update(200);
    ctxA.persistence.save();

    const ctxB = buildKernelWithPersistence(backend);
    ctxB.simulation.registerNPC({ entityId: 'npc_loner_1', factionId: 'loner', position: { x: 0, y: 0 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxB.simulation.registerNPC({ entityId: 'npc_duty_1', factionId: 'duty', position: { x: 0, y: 0 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxB.persistence.load();

    // Additional ticks must not crash.
    expect(() => {
      for (let i = 0; i < 10; i++) ctxB.kernel.update(200);
    }).not.toThrow();

    // NPCs should still be alive and registered.
    expect(ctxB.simulation.getNPCRecord('npc_loner_1')).toBeDefined();
    expect(ctxB.simulation.getNPCRecord('npc_duty_1')).toBeDefined();

    ctxA.kernel.destroy();
    ctxB.kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 8. Two save slots with different keys — slot isolation
  // -------------------------------------------------------------------------
  it('two save slots with different keys — slot isolation', () => {
    const backend = new MemoryStorageProvider();

    // Slot A: 1 NPC at rank 3.
    const ctxSlotA = buildKernelWithPersistence(backend, 'slot_a');
    ctxSlotA.simulation.registerNPC({ entityId: 'npc_slot_a', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxSlotA.simulation.getStoryRegistry().register('quest_a', 'npc_slot_a');
    ctxSlotA.kernel.update(200);
    ctxSlotA.persistence.save();

    // Slot B: different NPC at rank 5.
    const ctxSlotB = buildKernelWithPersistence(backend, 'slot_b');
    ctxSlotB.simulation.registerNPC({ entityId: 'npc_slot_b', factionId: 'duty', position: { x: 200, y: 200 }, rank: 5, combatPower: 80, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxSlotB.kernel.update(200);
    ctxSlotB.persistence.save();

    // Both slots exist independently.
    expect(backend.size()).toBe(2);

    // Load slot A into fresh kernel — should have rank 3 NPC, story quest_a.
    const ctxLoadA = buildKernelWithPersistence(backend, 'slot_a');
    ctxLoadA.simulation.registerNPC({ entityId: 'npc_slot_a', factionId: 'loner', position: { x: 0, y: 0 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxLoadA.persistence.load();
    const recordA = ctxLoadA.simulation.getNPCRecord('npc_slot_a');
    expect(recordA).toBeDefined();
    expect(recordA!.factionId).toBe('loner');
    expect(recordA!.rank).toBe(3);
    expect(ctxLoadA.simulation.getStoryRegistry().isStoryNPC('npc_slot_a')).toBe(true);
    // Should NOT have slot_b NPC.
    expect(ctxLoadA.simulation.getNPCRecord('npc_slot_b')).toBeUndefined();

    // Load slot B into fresh kernel — should have rank 5 NPC, no story quest_a.
    const ctxLoadB = buildKernelWithPersistence(backend, 'slot_b');
    ctxLoadB.simulation.registerNPC({ entityId: 'npc_slot_b', factionId: 'duty', position: { x: 0, y: 0 }, rank: 5, combatPower: 80, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxLoadB.persistence.load();
    const recordB = ctxLoadB.simulation.getNPCRecord('npc_slot_b');
    expect(recordB).toBeDefined();
    expect(recordB!.factionId).toBe('duty');
    expect(recordB!.rank).toBe(5);
    expect(ctxLoadB.simulation.getStoryRegistry().isStoryNPC('npc_slot_b')).toBe(false);
    // Should NOT have slot_a NPC.
    expect(ctxLoadB.simulation.getNPCRecord('npc_slot_a')).toBeUndefined();

    ctxSlotA.kernel.destroy();
    ctxSlotB.kernel.destroy();
    ctxLoadA.kernel.destroy();
    ctxLoadB.kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 9. Economy state (player inventory) is preserved via persistence
  // -------------------------------------------------------------------------
  it('economy player inventory is preserved via PersistencePlugin save/load', () => {
    const backend = new MemoryStorageProvider();

    const ctxA = buildKernelWithPersistence(backend);
    ctxA.economy.playerInventory.add('medkit', 5);
    ctxA.economy.playerInventory.add('ammo_9x19', 30);

    ctxA.kernel.update(200);
    ctxA.persistence.save();

    const ctxB = buildKernelWithPersistence(backend);
    ctxB.persistence.load();

    expect(ctxB.economy.playerInventory.getQuantity('medkit')).toBe(5);
    expect(ctxB.economy.playerInventory.getQuantity('ammo_9x19')).toBe(30);

    ctxA.kernel.destroy();
    ctxB.kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 10. hasSave() / deleteSave() lifecycle
  // -------------------------------------------------------------------------
  it('hasSave() returns false before save, true after save, false after deleteSave()', () => {
    const backend = new MemoryStorageProvider();

    const ctx = buildKernelWithPersistence(backend);

    expect(ctx.persistence.hasSave()).toBe(false);

    ctx.simulation.registerNPC({ entityId: 'npc_1', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctx.kernel.update(200);
    ctx.persistence.save();

    expect(ctx.persistence.hasSave()).toBe(true);

    ctx.persistence.deleteSave();

    expect(ctx.persistence.hasSave()).toBe(false);

    ctx.kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 11. load() returns false when no save exists
  // -------------------------------------------------------------------------
  it('load() returns false when no save exists in backend', () => {
    const backend = new MemoryStorageProvider();

    const ctx = buildKernelWithPersistence(backend);
    ctx.simulation.registerNPC({ entityId: 'npc_1', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });

    const result = ctx.persistence.load();
    expect(result.ok).toBe(false);

    // NPC should still be registered (load failed, no state change).
    expect(ctx.simulation.getNPCRecord('npc_1')).toBeDefined();

    ctx.kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 12. Squad state preserved across save/load via PersistencePlugin
  // -------------------------------------------------------------------------
  it('squad membership is preserved across save/load via PersistencePlugin', () => {
    const backend = new MemoryStorageProvider();

    const ctxA = buildKernelWithPersistence(backend);
    ctxA.simulation.registerNPC({ entityId: 'npc_a', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxA.simulation.registerNPC({ entityId: 'npc_b', factionId: 'loner', position: { x: 110, y: 100 }, rank: 2, combatPower: 40, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });

    const squadA = ctxA.simulation.getSquadManager().getSquadForNPC('npc_a');
    expect(squadA).not.toBeNull();
    const squadIdA = squadA!.id;

    for (let i = 0; i < 3; i++) ctxA.kernel.update(200);
    ctxA.persistence.save();

    const ctxB = buildKernelWithPersistence(backend);
    ctxB.simulation.registerNPC({ entityId: 'npc_a', factionId: 'loner', position: { x: 0, y: 0 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxB.simulation.registerNPC({ entityId: 'npc_b', factionId: 'loner', position: { x: 0, y: 0 }, rank: 2, combatPower: 40, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxB.persistence.load();

    const squadBa = ctxB.simulation.getSquadManager().getSquadForNPC('npc_a');
    const squadBb = ctxB.simulation.getSquadManager().getSquadForNPC('npc_b');
    expect(squadBa).not.toBeNull();
    expect(squadBb).not.toBeNull();
    // Both NPCs should be in the same squad after restore.
    expect(squadBa!.id).toBe(squadBb!.id);
    // Squad id should match the original.
    expect(squadBa!.id).toBe(squadIdA);

    ctxA.kernel.destroy();
    ctxB.kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 13. rebuildBrain after load preserves squads, relations, and story
  // -------------------------------------------------------------------------
  it('rebuildBrain after load preserves squads, relations, and story — does not corrupt restored state', () => {
    const backend = new MemoryStorageProvider();

    const ctxA = buildKernelWithPersistence(backend);

    // Register story NPCs before registerNPC so story survives redundancy cleanup.
    ctxA.simulation.getStoryRegistry().register('quest_wolf', 'npc_wolf');
    ctxA.simulation.getStoryRegistry().register('quest_bear', 'npc_bear');

    ctxA.simulation.registerNPC({ entityId: 'npc_wolf', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxA.simulation.registerNPC({ entityId: 'npc_bear', factionId: 'loner', position: { x: 110, y: 100 }, rank: 2, combatPower: 40, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });

    // Set personal goodwill between the two NPCs.
    ctxA.simulation.getRelationRegistry().adjustGoodwill('npc_wolf', 'npc_bear', 50);
    ctxA.simulation.getRelationRegistry().adjustGoodwill('npc_bear', 'npc_wolf', 30);

    const squadIdA = ctxA.simulation.getSquadManager().getSquadForNPC('npc_wolf')!.id;

    for (let i = 0; i < 3; i++) ctxA.kernel.update(200);
    ctxA.persistence.save();

    // --- Restore in the same kernel (simulate in-game load) ---
    const loadResult = ctxA.persistence.load();
    expect(loadResult.ok).toBe(true);

    // Brains are cleared after load — use rebuildBrain (not unregisterNPC + registerNPC).
    ctxA.simulation.rebuildBrain('npc_wolf', { type: 'human' });
    ctxA.simulation.rebuildBrain('npc_bear', { type: 'human' });

    // Brains must exist.
    expect(ctxA.simulation.getNPCBrain('npc_wolf')).not.toBeNull();
    expect(ctxA.simulation.getNPCBrain('npc_bear')).not.toBeNull();

    // Squad membership must be intact (same squad id).
    const squadAfter = ctxA.simulation.getSquadManager().getSquadForNPC('npc_wolf');
    expect(squadAfter).not.toBeNull();
    expect(squadAfter!.id).toBe(squadIdA);
    expect(ctxA.simulation.getSquadManager().getSquadForNPC('npc_bear')!.id).toBe(squadIdA);

    // Personal goodwill must be intact.
    expect(ctxA.simulation.getRelationRegistry().getPersonalGoodwill('npc_wolf', 'npc_bear')).toBe(50);
    expect(ctxA.simulation.getRelationRegistry().getPersonalGoodwill('npc_bear', 'npc_wolf')).toBe(30);

    // Story registry must be intact.
    expect(ctxA.simulation.getStoryRegistry().isStoryNPC('npc_wolf')).toBe(true);
    expect(ctxA.simulation.getStoryRegistry().isStoryNPC('npc_bear')).toBe(true);
    expect(ctxA.simulation.getStoryRegistry().getStoryId('npc_wolf')).toBe('quest_wolf');

    // Ticks must not crash after brain rebuild.
    expect(() => {
      for (let i = 0; i < 5; i++) ctxA.kernel.update(200);
    }).not.toThrow();

    ctxA.kernel.destroy();
  });
});
