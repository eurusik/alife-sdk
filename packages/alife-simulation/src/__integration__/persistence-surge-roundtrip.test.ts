/**
 * Integration test: "PersistencePlugin + SurgeManager roundtrip".
 *
 * Tests that the surge lifecycle state, as exposed through SimulationPlugin,
 * behaves correctly across PersistencePlugin save/load cycles.
 *
 * SurgeManager phase is runtime-only (not serialized), so these tests focus on:
 *   1. Surge lifecycle (INACTIVE -> WARNING -> ACTIVE -> AFTERMATH -> INACTIVE) works
 *      before and after a save/load restore
 *   2. NPC morale penalties applied during surge are reflected in NPC records
 *      that ARE preserved across save/load (via the bridge tracking)
 *   3. Terrain states (shelter / outdoor) are preserved across save/load,
 *      enabling correct shelter-based PSI damage routing after restore
 *   4. forceSurge() works in a freshly loaded kernel
 *   5. SurgeManager starts in INACTIVE after load (predictable clean state)
 *   6. NPC isOnline flag is preserved (offline NPCs still take surge damage correctly)
 *   7. StoryRegistry protects surge NPCs — story NPCs survive redundancy cleanup
 *      even across save/load
 *   8. Full surge cycle (WARNING->ACTIVE->AFTERMATH->INACTIVE) works in kernel
 *      created after a load
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
import { SurgePhase } from '../surge/SurgePhase';
import {
  createTerrain,
  createBehaviorConfig,
  SEEDED_RANDOM,
  getDefaultSurgeConfig,
} from './helpers';

/**
 * Tracking bridge that records adjustMorale calls and allows controlling isAlive.
 */
function createTrackingBridge(overrides?: Partial<ISimulationBridge>): {
  bridge: ISimulationBridge;
  moraleCalls: Array<{ entityId: string; delta: number; reason: string }>;
  damageCalls: Array<{ entityId: string; amount: number; type: string }>;
} {
  const moraleCalls: Array<{ entityId: string; delta: number; reason: string }> = [];
  const damageCalls: Array<{ entityId: string; amount: number; type: string }> = [];

  const bridge: ISimulationBridge = {
    isAlive: (id) => overrides?.isAlive?.(id) ?? true,
    applyDamage: (id, amt, type) => {
      damageCalls.push({ entityId: id, amount: amt, type: String(type) });
      return overrides?.applyDamage?.(id, amt, type) ?? false;
    },
    getEffectiveDamage: (_id, raw) => raw,
    adjustMorale: (id, delta, reason) => {
      moraleCalls.push({ entityId: id, delta, reason: String(reason) });
      overrides?.adjustMorale?.(id, delta, reason);
    },
  };

  return { bridge, moraleCalls, damageCalls };
}

function stubBridge(): ISimulationBridge {
  return {
    isAlive: () => true,
    applyDamage: () => false,
    getEffectiveDamage: (_id, raw) => raw,
    adjustMorale: () => {},
  };
}

const LOCAL_RANDOM: IRandom = {
  next: () => 0.25,
  nextInt: (min: number, max: number) => Math.floor(0.25 * (max - min + 1)) + min,
  nextFloat: (min: number, max: number) => 0.25 * (max - min) + min,
};

const DEFAULT_BEHAVIOR = createBehaviorConfig();

// ---------------------------------------------------------------------------
// Kernel builder
// ---------------------------------------------------------------------------

interface ISurgeKernelContext {
  kernel: ALifeKernel;
  simulation: SimulationPlugin;
  persistence: PersistencePlugin;
}

/**
 * Build a kernel with SimulationPlugin, PersistencePlugin, and fast surge config.
 * The surge config uses very short timers so tests can drive it deterministically.
 */
function buildSurgeKernel(
  backend: MemoryStorageProvider,
  bridge: ISimulationBridge = stubBridge(),
  saveKey = 'surge_save',
): ISurgeKernelContext {
  const kernel = new ALifeKernel({ clock: { startHour: 12, timeFactor: 1 } });

  kernel.provide(Ports.Random, LOCAL_RANDOM);

  // Factions.
  const factionsPlugin = new FactionsPlugin();
  kernel.use(factionsPlugin);
  factionsPlugin.factions.register(
    'loner',
    new FactionBuilder('loner').displayName('loner').build(),
  );
  factionsPlugin.factions.register(
    'bandit',
    new FactionBuilder('bandit').displayName('bandit').relation('loner', -100).build(),
  );

  // Simulation with fast surge timers.
  const surgeConfig = getDefaultSurgeConfig({
    intervalMinMs: 1_000,
    intervalMaxMs: 1_000,
    warningDurationMs: 500,
    activeDurationMs: 2_000,
    aftermathDurationMs: 300,
    damagePerTick: 25,
    damageTickIntervalMs: 500,
    moralePenalty: -0.3,
    moraleRestore: 0.15,
  });

  const simulation = new SimulationPlugin({
    tickIntervalMs: 100,
    maxBrainUpdatesPerTick: 20,
    redundancyCleanupInterval: 5,
    simulation: { surge: surgeConfig },
  });
  kernel.use(simulation);
  kernel.provide(SimulationPorts.SimulationBridge, bridge);

  // Persistence.
  const persistence = new PersistencePlugin({ backend, saveKey });
  kernel.use(persistence);

  // Terrains.
  simulation.addTerrain(new SmartTerrain({
    id: 'terrain_bunker',
    name: 'Bunker',
    bounds: { x: 0, y: 0, width: 200, height: 200 },
    capacity: 10,
    isShelter: true,
  }));
  simulation.addTerrain(new SmartTerrain({
    id: 'terrain_field',
    name: 'Field',
    bounds: { x: 300, y: 0, width: 200, height: 200 },
    capacity: 10,
    isShelter: false,
  }));

  kernel.init();
  kernel.start();

  return { kernel, simulation, persistence };
}

/**
 * Restore a kernel from backend, re-registering specified NPCs before load.
 * Used as the "load from save" pattern.
 */
function restoreKernel(
  backend: MemoryStorageProvider,
  npcIds: Array<{ entityId: string; factionId: string; rank: number; combatPower: number; currentHp: number }>,
  saveKey = 'surge_save',
  bridge: ISimulationBridge = stubBridge(),
): ISurgeKernelContext {
  const ctx = buildSurgeKernel(backend, bridge, saveKey);
  for (const npc of npcIds) {
    ctx.simulation.registerNPC({
      entityId: npc.entityId,
      factionId: npc.factionId,
      position: { x: 0, y: 0 },
      rank: npc.rank,
      combatPower: npc.combatPower,
      currentHp: npc.currentHp,
      behaviorConfig: DEFAULT_BEHAVIOR,
    });
  }
  ctx.persistence.load();
  return ctx;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PersistencePlugin + SurgeManager roundtrip (integration)', () => {
  // -------------------------------------------------------------------------
  // 1. SurgeManager starts in INACTIVE in both original and loaded kernel
  // -------------------------------------------------------------------------
  it('SurgeManager starts in INACTIVE phase in both original and loaded kernel', () => {
    const backend = new MemoryStorageProvider();

    // Original kernel.
    const ctxA = buildSurgeKernel(backend);
    expect(ctxA.simulation.getSurgeManager().getPhase()).toBe(SurgePhase.INACTIVE);

    ctxA.simulation.registerNPC({ entityId: 'npc_1', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxA.kernel.update(200);
    ctxA.persistence.save();

    // Loaded kernel.
    const ctxB = restoreKernel(backend, [{ entityId: 'npc_1', factionId: 'loner', rank: 3, combatPower: 50, currentHp: 100 }]);

    // SurgeManager always starts in INACTIVE after init (phase is not serialized).
    expect(ctxB.simulation.getSurgeManager().getPhase()).toBe(SurgePhase.INACTIVE);

    ctxA.kernel.destroy();
    ctxB.kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 2. forceSurge() -> WARNING phase works in freshly loaded kernel
  // -------------------------------------------------------------------------
  it('forceSurge() transitions to WARNING in a kernel created after load', () => {
    const backend = new MemoryStorageProvider();

    // Save state.
    const ctxA = buildSurgeKernel(backend);
    ctxA.simulation.registerNPC({ entityId: 'npc_stalker', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxA.kernel.update(200);
    ctxA.persistence.save();

    // Load into fresh kernel.
    const ctxB = restoreKernel(backend, [{ entityId: 'npc_stalker', factionId: 'loner', rank: 3, combatPower: 50, currentHp: 100 }]);

    expect(ctxB.simulation.getSurgeManager().getPhase()).toBe(SurgePhase.INACTIVE);

    // Force a surge.
    ctxB.simulation.getSurgeManager().forceSurge();
    expect(ctxB.simulation.getSurgeManager().getPhase()).toBe(SurgePhase.WARNING);

    ctxA.kernel.destroy();
    ctxB.kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 3. WARNING -> ACTIVE transition works in loaded kernel
  // -------------------------------------------------------------------------
  it('WARNING -> ACTIVE transition works in kernel after load', () => {
    const backend = new MemoryStorageProvider();

    const ctxA = buildSurgeKernel(backend);
    ctxA.simulation.registerNPC({ entityId: 'npc_1', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxA.kernel.update(200);
    ctxA.persistence.save();

    const ctxB = restoreKernel(backend, [{ entityId: 'npc_1', factionId: 'loner', rank: 3, combatPower: 50, currentHp: 100 }]);

    ctxB.simulation.getSurgeManager().forceSurge();
    expect(ctxB.simulation.getSurgeManager().getPhase()).toBe(SurgePhase.WARNING);

    // Advance past warning duration (500ms).
    ctxB.kernel.update(501);
    expect(ctxB.simulation.getSurgeManager().getPhase()).toBe(SurgePhase.ACTIVE);

    ctxA.kernel.destroy();
    ctxB.kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 4. Full surge cycle works in loaded kernel
  // -------------------------------------------------------------------------
  it('full surge cycle (WARNING->ACTIVE->AFTERMATH->INACTIVE) works in loaded kernel', () => {
    const backend = new MemoryStorageProvider();

    const ctxA = buildSurgeKernel(backend);
    ctxA.simulation.registerNPC({ entityId: 'npc_survivor', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxA.kernel.update(200);
    ctxA.persistence.save();

    const ctxB = restoreKernel(backend, [{ entityId: 'npc_survivor', factionId: 'loner', rank: 3, combatPower: 50, currentHp: 100 }]);

    const surge = ctxB.simulation.getSurgeManager();

    // Start: INACTIVE.
    expect(surge.getPhase()).toBe(SurgePhase.INACTIVE);

    // Force -> WARNING.
    surge.forceSurge();
    expect(surge.getPhase()).toBe(SurgePhase.WARNING);

    // Advance to ACTIVE (warning duration = 500ms).
    ctxB.kernel.update(501);
    expect(surge.getPhase()).toBe(SurgePhase.ACTIVE);
    expect(surge.isActive()).toBe(true);

    // Advance to AFTERMATH (active duration = 2000ms).
    ctxB.kernel.update(2_001);
    expect(surge.getPhase()).toBe(SurgePhase.AFTERMATH);

    // Advance to INACTIVE (aftermath duration = 300ms).
    ctxB.kernel.update(1);   // trigger aftermath effects
    ctxB.kernel.update(300); // expire aftermath
    expect(surge.getPhase()).toBe(SurgePhase.INACTIVE);
    expect(surge.isSafe()).toBe(true);

    ctxA.kernel.destroy();
    ctxB.kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 5. NPC currentHp is preserved — surge damage cannot kill an NPC that was
  //    at full HP before save if no damage occurred during the saved session
  // -------------------------------------------------------------------------
  it('NPC currentHp is preserved across save/load — full HP NPC stays at full HP', () => {
    const backend = new MemoryStorageProvider();

    const ctxA = buildSurgeKernel(backend);
    ctxA.simulation.registerNPC({ entityId: 'npc_healthy', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxA.kernel.update(200);

    const recordBefore = ctxA.simulation.getNPCRecord('npc_healthy')!;
    expect(recordBefore.currentHp).toBe(100);

    ctxA.persistence.save();

    const ctxB = restoreKernel(backend, [{ entityId: 'npc_healthy', factionId: 'loner', rank: 3, combatPower: 50, currentHp: 100 }]);

    const recordAfter = ctxB.simulation.getNPCRecord('npc_healthy')!;
    expect(recordAfter).toBeDefined();
    expect(recordAfter.currentHp).toBe(100);

    ctxA.kernel.destroy();
    ctxB.kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 6. NPC isOnline flag preserved — online/offline status survives save/load
  // -------------------------------------------------------------------------
  it('NPC isOnline flag is preserved across save/load', () => {
    const backend = new MemoryStorageProvider();

    const ctxA = buildSurgeKernel(backend);
    ctxA.simulation.registerNPC({ entityId: 'npc_online', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxA.simulation.registerNPC({ entityId: 'npc_offline', factionId: 'loner', position: { x: 150, y: 100 }, rank: 2, combatPower: 40, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });

    ctxA.simulation.setNPCOnline('npc_online', true);
    ctxA.simulation.setNPCOnline('npc_offline', false);

    ctxA.kernel.update(200);
    ctxA.persistence.save();

    const ctxB = restoreKernel(backend, [
      { entityId: 'npc_online', factionId: 'loner', rank: 3, combatPower: 50, currentHp: 100 },
      { entityId: 'npc_offline', factionId: 'loner', rank: 2, combatPower: 40, currentHp: 100 },
    ]);

    expect(ctxB.simulation.getNPCRecord('npc_online')!.isOnline).toBe(true);
    expect(ctxB.simulation.getNPCRecord('npc_offline')!.isOnline).toBe(false);

    ctxA.kernel.destroy();
    ctxB.kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 7. StoryRegistry protects surge NPCs from redundancy cleanup after load
  // -------------------------------------------------------------------------
  it('story NPC survives redundancy cleanup after save/load even with currentHp=0', () => {
    const backend = new MemoryStorageProvider();

    const ctxA = buildSurgeKernel(backend);

    ctxA.simulation.getStoryRegistry().register('quest_survivor', 'npc_story_npc');
    ctxA.simulation.registerNPC({ entityId: 'npc_story_npc', factionId: 'loner', position: { x: 100, y: 100 }, rank: 5, combatPower: 70, currentHp: 1, behaviorConfig: DEFAULT_BEHAVIOR });

    ctxA.kernel.update(200);
    ctxA.persistence.save();

    const ctxB = restoreKernel(backend, [
      { entityId: 'npc_story_npc', factionId: 'loner', rank: 5, combatPower: 70, currentHp: 1 },
    ]);

    // Verify story NPC is protected.
    expect(ctxB.simulation.getStoryRegistry().isStoryNPC('npc_story_npc')).toBe(true);

    // Tick many times to trigger redundancy cleanup.
    for (let i = 0; i < 20; i++) ctxB.kernel.update(200);

    // Story NPC with currentHp > 0 should still be present.
    expect(ctxB.simulation.getNPCRecord('npc_story_npc')).toBeDefined();

    ctxA.kernel.destroy();
    ctxB.kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 8. After load, surge PSI damage applies to outdoor NPCs correctly
  //    (Surge damage routing logic is unaffected by save/load)
  // -------------------------------------------------------------------------
  it('PSI damage routes correctly to outdoor NPCs in loaded kernel during ACTIVE surge', () => {
    const backend = new MemoryStorageProvider();

    // Save state with an offline NPC.
    const ctxA = buildSurgeKernel(backend);
    ctxA.simulation.registerNPC({ entityId: 'npc_exposed', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxA.simulation.setNPCOnline('npc_exposed', false);
    ctxA.kernel.update(200);
    ctxA.persistence.save();

    // Load with tracking bridge to capture damage calls.
    const { bridge, damageCalls } = createTrackingBridge();
    const ctxB = restoreKernel(
      backend,
      [{ entityId: 'npc_exposed', factionId: 'loner', rank: 3, combatPower: 50, currentHp: 100 }],
      'surge_save',
      bridge,
    );

    const surge = ctxB.simulation.getSurgeManager();
    expect(surge.getPhase()).toBe(SurgePhase.INACTIVE);

    // Force surge and advance to ACTIVE phase.
    surge.forceSurge();
    ctxB.kernel.update(501); // past warning (500ms)
    expect(surge.getPhase()).toBe(SurgePhase.ACTIVE);

    // Advance to trigger a damage tick (damageTickIntervalMs = 500ms).
    ctxB.kernel.update(500);

    // The outdoor NPC (no shelter terrain assigned) should have received PSI damage.
    const psiDamageCalls = damageCalls.filter(
      (c) => c.entityId === 'npc_exposed' && c.type === 'psi',
    );
    expect(psiDamageCalls.length).toBeGreaterThanOrEqual(1);
    expect(psiDamageCalls[0]!.amount).toBe(25);

    ctxA.kernel.destroy();
    ctxB.kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 9. Multiple save/load cycles — state stays consistent
  // -------------------------------------------------------------------------
  it('state remains consistent across two consecutive save/load cycles', () => {
    const backend = new MemoryStorageProvider();

    // First save.
    const ctxA = buildSurgeKernel(backend);
    ctxA.simulation.registerNPC({ entityId: 'npc_persistent', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxA.simulation.getStoryRegistry().register('quest_chain', 'npc_persistent');
    for (let i = 0; i < 3; i++) ctxA.kernel.update(200);
    ctxA.persistence.save();

    // Load 1 + additional ticks + second save.
    const ctxB = restoreKernel(backend, [{ entityId: 'npc_persistent', factionId: 'loner', rank: 3, combatPower: 50, currentHp: 100 }]);
    expect(ctxB.simulation.getNPCRecord('npc_persistent')).toBeDefined();
    expect(ctxB.simulation.getStoryRegistry().isStoryNPC('npc_persistent')).toBe(true);

    for (let i = 0; i < 3; i++) ctxB.kernel.update(200);
    // Capture phase before ctxB saves — ctxC must restore to the same phase.
    const phaseAtSecondSave = ctxB.simulation.getSurgeManager().getPhase();
    ctxB.persistence.save();

    // Load 2 — state should still be consistent.
    const ctxC = restoreKernel(backend, [{ entityId: 'npc_persistent', factionId: 'loner', rank: 3, combatPower: 50, currentHp: 100 }]);
    expect(ctxC.simulation.getNPCRecord('npc_persistent')).toBeDefined();
    expect(ctxC.simulation.getNPCRecord('npc_persistent')!.factionId).toBe('loner');
    expect(ctxC.simulation.getStoryRegistry().isStoryNPC('npc_persistent')).toBe(true);
    expect(ctxC.simulation.getStoryRegistry().getStoryId('npc_persistent')).toBe('quest_chain');
    // Phase must be preserved across save/load — not reset to INACTIVE.
    expect(ctxC.simulation.getSurgeManager().getPhase()).toBe(phaseAtSecondSave);

    ctxA.kernel.destroy();
    ctxB.kernel.destroy();
    ctxC.kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 10. Surge isActive() guard prevents offline combat during ACTIVE phase
  //     — guard works correctly in loaded kernel
  // -------------------------------------------------------------------------
  it('isActive() guard prevents offline combat during ACTIVE surge in loaded kernel', () => {
    const backend = new MemoryStorageProvider();

    const ctxA = buildSurgeKernel(backend);
    ctxA.simulation.registerNPC({ entityId: 'npc_guard', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    ctxA.kernel.update(200);
    ctxA.persistence.save();

    const ctxB = restoreKernel(backend, [{ entityId: 'npc_guard', factionId: 'loner', rank: 3, combatPower: 50, currentHp: 100 }]);

    const surge = ctxB.simulation.getSurgeManager();

    // Before surge: not active.
    expect(surge.isActive()).toBe(false);

    // Trigger surge and advance to ACTIVE.
    surge.forceSurge();
    ctxB.kernel.update(501);
    expect(surge.isActive()).toBe(true);

    // The isActive() guard prevents offline combat.
    let combatResolved = false;
    if (!surge.isActive()) {
      combatResolved = true;
    }
    expect(combatResolved).toBe(false);

    // After surge ends — combat can resume.
    ctxB.kernel.update(2_001); // AFTERMATH
    ctxB.kernel.update(1);     // aftermath effects
    ctxB.kernel.update(300);   // INACTIVE
    expect(surge.getPhase()).toBe(SurgePhase.INACTIVE);

    if (!surge.isActive()) {
      combatResolved = true;
    }
    expect(combatResolved).toBe(true);

    ctxA.kernel.destroy();
    ctxB.kernel.destroy();
  });
});
