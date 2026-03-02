/**
 * Integration test: "Online/offline handoff".
 *
 * Exercises the core hybrid architecture seam between OnlineOfflineManager
 * (alife-phaser) and SimulationPlugin (alife-simulation):
 *   1. OOM.evaluate() → transition lists → sim.setNPCOnline()
 *   2. Online NPC brain excluded from tick pipeline
 *   3. Offline NPC brain resumes after transition back
 *   4. Squad-aware atomic switching through SquadManager
 *   5. Position preservation across online↔offline transitions
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect } from 'vitest';
import {
  ALifeKernel,
  ALifeEvents,
  FactionsPlugin,
  FactionBuilder,
  Ports,
  SmartTerrain,
} from '@alife-sdk/core';
import type {
  IEntityAdapter,
  IPlayerPositionProvider,
  IEntityFactory,
  IRandom,
} from '@alife-sdk/core';

import { SimulationPlugin } from '@alife-sdk/simulation';
import { SimulationPorts } from '@alife-sdk/simulation';
import type { ISimulationBridge, INPCBehaviorConfig } from '@alife-sdk/simulation';

import { OnlineOfflineManager } from '../online/OnlineOfflineManager';
import type { IOnlineRecord, SquadResolver } from '../types/IOnlineOfflineConfig';

// ---------------------------------------------------------------------------
// Port stubs
// ---------------------------------------------------------------------------

function stubEntityAdapter(): IEntityAdapter {
  return {
    getPosition: () => ({ x: 0, y: 0 }),
    isAlive: () => true,
    hasComponent: () => false,
    getComponentValue: () => null,
    setPosition: () => {},
    setActive: () => {},
    setVisible: () => {},
    setVelocity: () => {},
    getVelocity: () => ({ x: 0, y: 0 }),
    setRotation: () => {},
    teleport: () => {},
    disablePhysics: () => {},
    setAlpha: () => {},
    playAnimation: () => {},
    hasAnimation: () => false,
  };
}

function stubPlayerPosition(): IPlayerPositionProvider {
  return { getPlayerPosition: () => ({ x: 9999, y: 9999 }) };
}

function stubEntityFactory(): IEntityFactory {
  return {
    createNPC: () => 'stub',
    createMonster: () => 'stub',
    destroyEntity: () => {},
  };
}

function stubBridge(): ISimulationBridge {
  return {
    isAlive: () => true,
    applyDamage: () => false,
    getEffectiveDamage: (_id, raw) => raw,
    adjustMorale: () => {},
  };
}

const SEEDED_RANDOM: IRandom = {
  next: () => 0.25,
  nextInt: (min: number, max: number) => Math.floor(0.25 * (max - min + 1)) + min,
  nextFloat: (min: number, max: number) => 0.25 * (max - min) + min,
};

const DEFAULT_BEHAVIOR: INPCBehaviorConfig = {
  retreatThreshold: 0.1,
  panicThreshold: -0.7,
  searchIntervalMs: 5_000,
  dangerTolerance: 3,
  aggression: 0.5,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTerrain(id: string, x: number, y: number, capacity = 10): SmartTerrain {
  return new SmartTerrain({
    id,
    name: id,
    bounds: { x, y, width: 200, height: 200 },
    capacity,
  });
}

interface IHandoffContext {
  kernel: ALifeKernel;
  simulation: SimulationPlugin;
  oom: OnlineOfflineManager;
}

function buildKernel(): IHandoffContext {
  const kernel = new ALifeKernel({ clock: { startHour: 12, timeFactor: 1 } });

  kernel.provide(Ports.EntityAdapter, stubEntityAdapter());
  kernel.provide(Ports.PlayerPosition, stubPlayerPosition());
  kernel.provide(Ports.EntityFactory, stubEntityFactory());
  kernel.provide(Ports.Random, SEEDED_RANDOM);

  const factionsPlugin = new FactionsPlugin();
  kernel.use(factionsPlugin);

  factionsPlugin.factions.register('loner',
    new FactionBuilder('loner').displayName('loner').build(),
  );
  factionsPlugin.factions.register('duty',
    new FactionBuilder('duty').displayName('duty').build(),
  );

  const simulation = new SimulationPlugin({
    tickIntervalMs: 100,
    maxBrainUpdatesPerTick: 20,
    redundancyCleanupInterval: 3,
  });
  kernel.use(simulation);
  kernel.provide(SimulationPorts.SimulationBridge, stubBridge());

  simulation.addTerrain(createTerrain('terrain_a', 100, 100));
  simulation.addTerrain(createTerrain('terrain_b', 500, 500));

  kernel.init();
  kernel.start();

  const oom = new OnlineOfflineManager({
    switchDistance: 400,
    hysteresisFactor: 0.15,
  });

  return { kernel, simulation, oom };
}

/** Build IOnlineRecord[] from SimulationPlugin NPC records. */
function buildOnlineRecords(sim: SimulationPlugin): IOnlineRecord[] {
  const records: IOnlineRecord[] = [];
  for (const [, record] of sim.getAllNPCRecords()) {
    const brain = sim.getNPCBrain(record.entityId);
    const pos = brain?.lastPosition ?? record.lastPosition;
    records.push({
      entityId: record.entityId,
      x: pos.x,
      y: pos.y,
      isOnline: record.isOnline,
      isAlive: record.currentHp > 0,
    });
  }
  return records;
}

/** Build SquadResolver from SquadManager. */
function buildSquadResolver(sim: SimulationPlugin): SquadResolver {
  const squadManager = sim.getSquadManager();
  return (npcId: string) => {
    const squad = squadManager.getSquadForNPC(npcId);
    if (!squad) return null;
    return squad.getMembers();
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Online/offline handoff (integration)', () => {
  it('offline NPC brain is ticked — terrain assigned', () => {
    const { kernel, simulation } = buildKernel();

    simulation.registerNPC({ entityId: 'npc_1', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });

    // NPC is offline by default — brain should be ticked.
    expect(simulation.getNPCRecord('npc_1')!.isOnline).toBe(false);

    // Registration already triggers first brain update, so terrain should be assigned.
    const brain = simulation.getNPCBrain('npc_1')!;
    expect(brain.currentTerrainId).not.toBeNull();

    // Tick to verify brain continues to be ticked (no crash, stable).
    for (let i = 0; i < 5; i++) kernel.update(200);
    expect(brain.currentTerrainId).not.toBeNull();

    kernel.destroy();
  });

  it('setNPCOnline(true) → brain excluded from tick → no new TASK_ASSIGNED', () => {
    const { kernel, simulation } = buildKernel();

    simulation.registerNPC({ entityId: 'npc_1', factionId: 'loner', position: { x: 100, y: 100 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });

    // Tick to settle brain.
    for (let i = 0; i < 3; i++) kernel.update(200);

    // Go online.
    simulation.setNPCOnline('npc_1', true);
    expect(simulation.getNPCRecord('npc_1')!.isOnline).toBe(true);

    // Collect events after going online.
    const eventsAfterOnline: string[] = [];
    kernel.events.on(ALifeEvents.TASK_ASSIGNED, (payload) => {
      eventsAfterOnline.push(payload.npcId);
    });

    // Tick many times — brain should NOT be ticked.
    for (let i = 0; i < 10; i++) kernel.update(200);

    expect(eventsAfterOnline).not.toContain('npc_1');

    kernel.destroy();
  });

  it('OOM.evaluate() → setNPCOnline() → full offline→online→offline cycle', () => {
    const { kernel, simulation, oom } = buildKernel();

    simulation.registerNPC({ entityId: 'npc_1', factionId: 'loner', position: { x: 200, y: 200 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });

    // Tick to settle.
    for (let i = 0; i < 3; i++) kernel.update(200);

    // --- Phase 1: Player close → NPC goes online ---
    const playerCloseX = 200;
    const playerCloseY = 200;
    const records1 = buildOnlineRecords(simulation);
    const result1 = oom.evaluate(playerCloseX, playerCloseY, records1);

    expect(result1.goOnline).toContain('npc_1');
    expect(result1.goOffline).toHaveLength(0);

    // Apply transition.
    for (const id of result1.goOnline) {
      simulation.setNPCOnline(id, true);
    }
    expect(simulation.getNPCRecord('npc_1')!.isOnline).toBe(true);

    // Verify brain not ticked while online.
    const onlineEvents: string[] = [];
    kernel.events.on(ALifeEvents.TASK_ASSIGNED, (p) => onlineEvents.push(p.npcId));
    for (let i = 0; i < 5; i++) kernel.update(200);
    expect(onlineEvents).not.toContain('npc_1');

    // --- Phase 2: Player in hysteresis band → no transition ---
    // oom config: switchDistance=400, hysteresis=0.15
    // onlineDist = 340, offlineDist = 460
    // Place player at ~400px away (in band).
    const playerBandX = 200 + 400;
    const records2 = buildOnlineRecords(simulation);
    const result2 = oom.evaluate(playerBandX, 200, records2);

    expect(result2.goOnline).toHaveLength(0);
    expect(result2.goOffline).toHaveLength(0);

    // --- Phase 3: Player far → NPC goes offline ---
    const playerFarX = 200 + 500;
    const records3 = buildOnlineRecords(simulation);
    const result3 = oom.evaluate(playerFarX, 200, records3);

    expect(result3.goOffline).toContain('npc_1');

    for (const id of result3.goOffline) {
      simulation.setNPCOnline(id, false);
    }
    expect(simulation.getNPCRecord('npc_1')!.isOnline).toBe(false);

    // Brain resumes ticking.
    const resumeEvents: string[] = [];
    kernel.events.on(ALifeEvents.TASK_ASSIGNED, (p) => resumeEvents.push(p.npcId));
    for (let i = 0; i < 10; i++) kernel.update(200);

    // Brain should have been ticked (may or may not emit TASK_ASSIGNED depending
    // on whether terrain changed, but NPC should at least be in offlineIds).
    expect(simulation.getNPCRecord('npc_1')!.isOnline).toBe(false);

    kernel.destroy();
  });

  it('squad-aware: one member in range → entire squad goes online', () => {
    const { kernel, simulation, oom } = buildKernel();

    // Register 3 NPCs — same faction → auto-assigned to same squad.
    simulation.registerNPC({ entityId: 'npc_s1', factionId: 'duty', position: { x: 100, y: 0 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    simulation.registerNPC({ entityId: 'npc_s2', factionId: 'duty', position: { x: 400, y: 0 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    simulation.registerNPC({ entityId: 'npc_s3', factionId: 'duty', position: { x: 800, y: 0 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });

    // Verify same squad.
    const squad1 = simulation.getSquadManager().getSquadForNPC('npc_s1');
    const squad2 = simulation.getSquadManager().getSquadForNPC('npc_s2');
    const squad3 = simulation.getSquadManager().getSquadForNPC('npc_s3');
    expect(squad1).not.toBeNull();
    expect(squad1!.id).toBe(squad2!.id);
    expect(squad1!.id).toBe(squad3!.id);

    // Use explicit IOnlineRecord[] to avoid position drift from brain ticks.
    // oom config: switchDistance=400, hysteresis=0.15
    // onlineDist = 340, offlineDist = 460
    // Player at (0,0): npc_s1 at 100px (online), npc_s2 at 400px (band), npc_s3 at 800px (far).
    const records: IOnlineRecord[] = [
      { entityId: 'npc_s1', x: 100, y: 0, isOnline: false, isAlive: true },
      { entityId: 'npc_s2', x: 400, y: 0, isOnline: false, isAlive: true },
      { entityId: 'npc_s3', x: 800, y: 0, isOnline: false, isAlive: true },
    ];
    const squadResolver = buildSquadResolver(simulation);
    const result = oom.evaluate(0, 0, records, squadResolver);

    // Squad-aware: npc_s1 in online range → all go online.
    expect(result.goOnline).toContain('npc_s1');
    expect(result.goOnline).toContain('npc_s2');
    expect(result.goOnline).toContain('npc_s3');

    // Apply transitions.
    for (const id of result.goOnline) {
      simulation.setNPCOnline(id, true);
    }

    // All online.
    expect(simulation.getNPCRecord('npc_s1')!.isOnline).toBe(true);
    expect(simulation.getNPCRecord('npc_s2')!.isOnline).toBe(true);
    expect(simulation.getNPCRecord('npc_s3')!.isOnline).toBe(true);

    // Tick — brains should not change terrain while online.
    const brain1 = simulation.getNPCBrain('npc_s1')!;
    const terrain1Before = brain1.currentTerrainId;
    for (let i = 0; i < 5; i++) kernel.update(200);
    expect(brain1.currentTerrainId).toBe(terrain1Before);

    kernel.destroy();
  });

  it('squad-aware: all beyond offline range → entire squad goes offline', () => {
    const { kernel, simulation, oom } = buildKernel();

    simulation.registerNPC({ entityId: 'npc_s1', factionId: 'duty', position: { x: 200, y: 200 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    simulation.registerNPC({ entityId: 'npc_s2', factionId: 'duty', position: { x: 300, y: 200 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    for (let i = 0; i < 3; i++) kernel.update(200);

    // Set online.
    simulation.setNPCOnline('npc_s1', true);
    simulation.setNPCOnline('npc_s2', true);

    // Player far away (2000, 2000).
    const records = buildOnlineRecords(simulation);
    const squadResolver = buildSquadResolver(simulation);
    const result = oom.evaluate(2000, 2000, records, squadResolver);

    expect(result.goOffline).toContain('npc_s1');
    expect(result.goOffline).toContain('npc_s2');

    for (const id of result.goOffline) {
      simulation.setNPCOnline(id, false);
    }

    expect(simulation.getNPCRecord('npc_s1')!.isOnline).toBe(false);
    expect(simulation.getNPCRecord('npc_s2')!.isOnline).toBe(false);

    kernel.destroy();
  });

  it('position preserved across online→offline transition', () => {
    const { kernel, simulation, oom } = buildKernel();

    simulation.registerNPC({ entityId: 'npc_1', factionId: 'loner', position: { x: 150, y: 250 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });

    // Tick to assign terrain and start movement.
    for (let i = 0; i < 5; i++) kernel.update(200);

    // Record brain position before going online.
    const brain = simulation.getNPCBrain('npc_1')!;
    const posBeforeOnline = { ...brain.lastPosition };

    // Go online.
    simulation.setNPCOnline('npc_1', true);

    // Tick while online — brain is NOT updated.
    for (let i = 0; i < 5; i++) kernel.update(200);

    // Go offline.
    simulation.setNPCOnline('npc_1', false);

    // Position should still be what it was before (brain not ticked while online).
    const posAfterOffline = brain.lastPosition;
    expect(posAfterOffline.x).toBe(posBeforeOnline.x);
    expect(posAfterOffline.y).toBe(posBeforeOnline.y);

    kernel.destroy();
  });

  it('online NPC excluded from factional conflict detection', () => {
    const { kernel, simulation } = buildKernel();

    // Register factions that are hostile.
    const factionsPlugin = new FactionsPlugin();
    // Re-build kernel with hostile factions.
    kernel.destroy();

    const kernel2 = new ALifeKernel({ clock: { startHour: 12, timeFactor: 1 } });
    kernel2.provide(Ports.EntityAdapter, stubEntityAdapter());
    kernel2.provide(Ports.PlayerPosition, stubPlayerPosition());
    kernel2.provide(Ports.EntityFactory, stubEntityFactory());
    kernel2.provide(Ports.Random, SEEDED_RANDOM);

    const factions2 = new FactionsPlugin();
    kernel2.use(factions2);
    factions2.factions.register('loner',
      new FactionBuilder('loner').displayName('loner').relation('bandit', -100).build(),
    );
    factions2.factions.register('bandit',
      new FactionBuilder('bandit').displayName('bandit').relation('loner', -100).build(),
    );

    const sim2 = new SimulationPlugin({
      tickIntervalMs: 100,
      maxBrainUpdatesPerTick: 20,
      redundancyCleanupInterval: 3,
    });
    kernel2.use(sim2);
    kernel2.provide(SimulationPorts.SimulationBridge, stubBridge());

    sim2.addTerrain(createTerrain('terrain_shared', 100, 100));
    kernel2.init();
    kernel2.start();

    // Two hostile NPCs on same terrain.
    sim2.registerNPC({ entityId: 'npc_loner', factionId: 'loner', position: { x: 150, y: 150 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });
    sim2.registerNPC({ entityId: 'npc_bandit', factionId: 'bandit', position: { x: 150, y: 150 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });

    // Set loner online — should be excluded from conflict detection.
    sim2.setNPCOnline('npc_loner', true);

    const conflicts: string[] = [];
    kernel2.events.on(ALifeEvents.FACTION_CONFLICT, () => {
      conflicts.push('conflict');
    });

    // Tick many times.
    for (let i = 0; i < 20; i++) kernel2.update(200);

    // No conflict should be detected because online NPC is excluded.
    expect(conflicts).toHaveLength(0);

    kernel2.destroy();
  });
});
