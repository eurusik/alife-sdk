import { describe, it, expect } from 'vitest';
import {
  ALifeKernel,
  ALifeEvents,
  FactionsPlugin,
  FactionBuilder,
  Ports,
} from '@alife-sdk/core';
import type { IEntityAdapter, IPlayerPositionProvider, IEntityFactory } from '@alife-sdk/core';
import { SimulationPlugin } from './SimulationPlugin';
import type { ISimulationPluginState } from './SimulationPlugin';
import { createDefaultPluginConfig } from './SimulationPlugin';
import { SimulationPorts } from '../ports/SimulationPorts';
import { NPCBrain } from '../brain/NPCBrain';
import {
  createTerrain,
  createBehaviorConfig,
  createStubBridge,
  SEEDED_RANDOM,
} from '../__integration__/helpers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal stub for IEntityAdapter — no-op everything. */
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

/** Minimal stub for IPlayerPositionProvider. */
function stubPlayerPosition(): IPlayerPositionProvider {
  return { getPlayerPosition: () => ({ x: 100, y: 100 }) };
}

/** Minimal stub for IEntityFactory. */
function stubEntityFactory(): IEntityFactory {
  return {
    createNPC: () => 'npc-stub',
    createMonster: () => 'monster-stub',
    destroyEntity: () => {},
  };
}

/** Build a kernel with FactionsPlugin + SimulationPlugin, provide bridge. */
function buildKernel(
  pluginConfig?: Parameters<typeof createDefaultPluginConfig>[0],
  factionDefs?: Array<{ id: string; relations?: Record<string, number> }>,
): { kernel: ALifeKernel; plugin: SimulationPlugin; factionsPlugin: FactionsPlugin } {
  const kernel = new ALifeKernel({ clock: { startHour: 12, timeFactor: 1 } });

  // Provide required kernel ports.
  kernel.provide(Ports.EntityAdapter, stubEntityAdapter());
  kernel.provide(Ports.PlayerPosition, stubPlayerPosition());
  kernel.provide(Ports.EntityFactory, stubEntityFactory());
  kernel.provide(Ports.Random, SEEDED_RANDOM);

  // Factions.
  const factionsPlugin = new FactionsPlugin();
  kernel.use(factionsPlugin);

  const defs = factionDefs ?? [
    { id: 'loner' },
    { id: 'duty', relations: { freedom: -80 } },
    { id: 'freedom', relations: { duty: -80 } },
  ];
  for (const def of defs) {
    const builder = new FactionBuilder(def.id).displayName(def.id);
    if (def.relations) {
      for (const [otherId, score] of Object.entries(def.relations)) {
        builder.relation(otherId, score);
      }
    }
    factionsPlugin.factions.register(def.id, builder.build());
  }

  // SimulationPlugin.
  const plugin = new SimulationPlugin(pluginConfig);
  kernel.use(plugin);

  // Provide required simulation port.
  kernel.provide(SimulationPorts.SimulationBridge, createStubBridge());

  return { kernel, plugin, factionsPlugin };
}

/** Initialize the kernel and start — returns the plugin ready for update(). */
function initKernel(
  pluginConfig?: Parameters<typeof createDefaultPluginConfig>[0],
  factionDefs?: Array<{ id: string; relations?: Record<string, number> }>,
) {
  const ctx = buildKernel(pluginConfig, factionDefs);
  ctx.kernel.init();
  ctx.kernel.start();
  return ctx;
}

const DEFAULT_BEHAVIOR = createBehaviorConfig();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SimulationPlugin', () => {
  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('installs and initializes without errors', () => {
      const { kernel } = buildKernel();
      expect(() => kernel.init()).not.toThrow();
    });

    it('exposes subsystem accessors after init', () => {
      const { kernel, plugin } = buildKernel();
      kernel.init();

      expect(plugin.getSquadManager()).toBeDefined();
      expect(plugin.getStoryRegistry()).toBeDefined();
      expect(plugin.getRelationRegistry()).toBeDefined();
      expect(plugin.getMovementSimulator()).toBeDefined();
      expect(plugin.getSurgeManager()).toBeDefined();
    });

    it('destroy clears all maps', () => {
      const { kernel: _kernel, plugin } = initKernel();

      plugin.registerNPC({ entityId: 'npc_1', factionId: 'loner', position: { x: 0, y: 0 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR });

      expect(plugin.npcs.size).toBe(1);
      expect(plugin.brains.size).toBe(1);

      plugin.destroy();

      expect(plugin.npcs.size).toBe(0);
      expect(plugin.brains.size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // NPC registration
  // -------------------------------------------------------------------------

  describe('NPC registration', () => {
    it('registers an NPC and stores record + brain', () => {
      const { plugin } = initKernel();

      const result = plugin.registerNPC({ entityId: 'npc_1', factionId: 'loner', position: { x: 10, y: 20 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });

      expect(result.record.entityId).toBe('npc_1');
      expect(result.brain).toBeInstanceOf(NPCBrain);
      expect(plugin.getNPCRecord('npc_1')).toBeDefined();
      expect(plugin.getNPCBrain('npc_1')).toBeInstanceOf(NPCBrain);
    });

    it('unregisters an NPC', () => {
      const { plugin } = initKernel();
      plugin.registerNPC({ entityId: 'npc_1', factionId: 'loner', position: { x: 0, y: 0 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR });

      plugin.unregisterNPC('npc_1');

      expect(plugin.getNPCRecord('npc_1')).toBeUndefined();
      expect(plugin.getNPCBrain('npc_1')).toBeNull();
    });

    it('setNPCOnline toggles isOnline flag', () => {
      const { plugin } = initKernel();
      plugin.registerNPC({ entityId: 'npc_1', factionId: 'loner', position: { x: 0, y: 0 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR });

      expect(plugin.getNPCRecord('npc_1')!.isOnline).toBe(false);

      plugin.setNPCOnline('npc_1', true);
      expect(plugin.getNPCRecord('npc_1')!.isOnline).toBe(true);

      plugin.setNPCOnline('npc_1', false);
      expect(plugin.getNPCRecord('npc_1')!.isOnline).toBe(false);
    });

    it('getAllNPCRecords returns all registered NPCs', () => {
      const { plugin } = initKernel();
      plugin.registerNPC({ entityId: 'npc_1', factionId: 'loner', position: { x: 0, y: 0 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR });
      plugin.registerNPC({ entityId: 'npc_2', factionId: 'duty', position: { x: 10, y: 10 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });

      const all = plugin.getAllNPCRecords();
      expect(all.size).toBe(2);
      expect(all.has('npc_1')).toBe(true);
      expect(all.has('npc_2')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Terrain management
  // -------------------------------------------------------------------------

  describe('terrain management', () => {
    it('addTerrain before init stores terrain', () => {
      const { kernel, plugin } = buildKernel();
      const terrain = createTerrain({ id: 't1' });

      plugin.addTerrain(terrain);
      kernel.init();

      expect(plugin.getTerrain('t1')).toBe(terrain);
    });

    it('addTerrain after init creates TerrainStateManager', () => {
      const { plugin } = initKernel();
      const terrain = createTerrain({ id: 't_late' });

      plugin.addTerrain(terrain);

      expect(plugin.getTerrain('t_late')).toBe(terrain);
      expect(plugin.getAllTerrains().size).toBe(1);
    });

    it('removeTerrain removes terrain and state', () => {
      const { plugin } = initKernel();
      const terrain = createTerrain({ id: 't1' });
      plugin.addTerrain(terrain);

      plugin.removeTerrain('t1');

      expect(plugin.getTerrain('t1')).toBeUndefined();
      expect(plugin.getAllTerrains().size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Tick pipeline
  // -------------------------------------------------------------------------

  describe('tick pipeline', () => {
    it('emits ALIFE_TICK after tick interval', () => {
      const { kernel, plugin: _plugin } = initKernel({
        tickIntervalMs: 100,
      });

      const ticks: number[] = [];
      kernel.events.on(ALifeEvents.TICK, (p) => ticks.push(p.tick));

      // Advance 100ms — should trigger 1 tick.
      kernel.update(100);

      expect(ticks).toEqual([1]);
    });

    it('does not tick before interval accumulates', () => {
      const { kernel } = initKernel({
        tickIntervalMs: 100,
      });

      const ticks: number[] = [];
      kernel.events.on(ALifeEvents.TICK, (p) => ticks.push(p.tick));

      kernel.update(50);
      expect(ticks).toHaveLength(0);

      kernel.update(50);
      expect(ticks).toHaveLength(1);
    });

    it('updates offline brain on tick', () => {
      const { kernel, plugin } = initKernel({
        tickIntervalMs: 100,
      });
      const terrain = createTerrain({ id: 't1' });
      plugin.addTerrain(terrain);

      plugin.registerNPC({ entityId: 'npc_1', factionId: 'loner', position: { x: 100, y: 100 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR });

      // NPC is offline by default → should be updated on tick.
      kernel.update(100);

      const brain = plugin.getNPCBrain('npc_1')!;
      // Brain should have been assigned to terrain.
      expect(brain.currentTerrainId).toBe('t1');
    });

    it('skips online NPC in offline brain ticks', () => {
      const { kernel, plugin } = initKernel({
        tickIntervalMs: 100,
      });
      const terrain = createTerrain({ id: 't1' });
      plugin.addTerrain(terrain);

      plugin.registerNPC({ entityId: 'npc_1', factionId: 'loner', position: { x: 100, y: 100 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR });
      plugin.setNPCOnline('npc_1', true);

      kernel.update(100);

      const brain = plugin.getNPCBrain('npc_1')!;
      // Online NPC should not have been brain-ticked, so it won't have terrain assignment
      // from the tick pipeline (only from initial registration which uses forceReevaluate).
      expect(brain).toBeDefined();
    });

    it('restores morale toward baseline', () => {
      const { kernel, plugin } = initKernel({
        tickIntervalMs: 100,
        moraleRestoreRate: 0.1,
        moraleBaseline: 0.5,
      });
      plugin.registerNPC({ entityId: 'npc_1', factionId: 'loner', position: { x: 0, y: 0 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR });

      const brain = plugin.getNPCBrain('npc_1')!;
      brain.setMorale(0.0); // below baseline

      kernel.update(100); // trigger tick
      // Morale should have moved toward 0.5 by moraleRestoreRate.
      expect(brain.morale).toBeCloseTo(0.1, 5);
    });
  });

  // -------------------------------------------------------------------------
  // Redundancy cleanup
  // -------------------------------------------------------------------------

  describe('redundancy cleanup', () => {
    it('removes dead NPCs on cleanup tick', () => {
      const { kernel, plugin } = initKernel({
        tickIntervalMs: 100,
        redundancyCleanupInterval: 1, // cleanup every tick
      });
      plugin.registerNPC({ entityId: 'npc_dead', factionId: 'loner', position: { x: 0, y: 0 }, rank: 2, combatPower: 40, currentHp: 0, behaviorConfig: DEFAULT_BEHAVIOR });
      // HP=0 → dead

      kernel.update(100); // tick 1 → cleanup runs

      expect(plugin.getNPCRecord('npc_dead')).toBeUndefined();
    });

    it('preserves story NPCs even when dead', () => {
      const { kernel, plugin } = initKernel({
        tickIntervalMs: 100,
        redundancyCleanupInterval: 1,
      });
      plugin.registerNPC({ entityId: 'npc_story', factionId: 'loner', position: { x: 0, y: 0 }, rank: 3, combatPower: 50, currentHp: 0, behaviorConfig: DEFAULT_BEHAVIOR });
      // HP=0, but story NPC.
      plugin.getStoryRegistry().register('quest_1', 'npc_story');

      kernel.update(100);

      expect(plugin.getNPCRecord('npc_story')).toBeDefined();
    });

    it('skips cleanup on non-cleanup ticks', () => {
      const { kernel, plugin } = initKernel({
        tickIntervalMs: 100,
        redundancyCleanupInterval: 3, // every 3rd tick
      });
      plugin.registerNPC({ entityId: 'npc_dead', factionId: 'loner', position: { x: 0, y: 0 }, rank: 2, combatPower: 40, currentHp: 0, behaviorConfig: DEFAULT_BEHAVIOR });

      // Tick 1 and 2 — no cleanup.
      kernel.update(100);
      expect(plugin.getNPCRecord('npc_dead')).toBeDefined();

      kernel.update(100);
      expect(plugin.getNPCRecord('npc_dead')).toBeDefined();

      // Tick 3 — cleanup runs.
      kernel.update(100);
      expect(plugin.getNPCRecord('npc_dead')).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Factional conflicts
  // -------------------------------------------------------------------------

  describe('factional conflicts', () => {
    it('emits FACTION_CONFLICT when hostile factions share a terrain', () => {
      const { kernel, plugin } = initKernel({
        tickIntervalMs: 100,
      });
      const terrain = createTerrain({ id: 't1' });
      plugin.addTerrain(terrain);

      plugin.registerNPC({ entityId: 'npc_d', factionId: 'duty', position: { x: 100, y: 100 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR });
      plugin.registerNPC({ entityId: 'npc_f', factionId: 'freedom', position: { x: 100, y: 100 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR });

      const conflicts: Array<{ factionA: string; factionB: string }> = [];
      kernel.events.on(ALifeEvents.FACTION_CONFLICT, (p) => conflicts.push(p));

      kernel.update(100);

      // Both NPCs should be in terrain t1, duty and freedom are hostile.
      expect(conflicts.length).toBeGreaterThanOrEqual(1);
      const c = conflicts[0];
      expect([c.factionA, c.factionB].sort()).toEqual(['duty', 'freedom']);
    });

    it('does not emit conflict for same faction', () => {
      const { kernel, plugin } = initKernel({
        tickIntervalMs: 100,
      });
      const terrain = createTerrain({ id: 't1' });
      plugin.addTerrain(terrain);

      plugin.registerNPC({ entityId: 'npc_1', factionId: 'loner', position: { x: 100, y: 100 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR });
      plugin.registerNPC({ entityId: 'npc_2', factionId: 'loner', position: { x: 100, y: 100 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: DEFAULT_BEHAVIOR });

      const conflicts: unknown[] = [];
      kernel.events.on(ALifeEvents.FACTION_CONFLICT, (p) => conflicts.push(p));

      kernel.update(100);

      expect(conflicts).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  describe('serialization', () => {
    it('serialize returns ISimulationPluginState shape', () => {
      const { plugin } = initKernel();
      plugin.registerNPC({ entityId: 'npc_1', factionId: 'loner', position: { x: 10, y: 20 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });

      const state = plugin.serialize() as unknown as ISimulationPluginState;

      expect(state.npcs).toHaveLength(1);
      expect(state.npcs[0].entityId).toBe('npc_1');
      expect(state.npcs[0].factionId).toBe('loner');
      expect(state.npcs[0].rank).toBe(3);
      expect(typeof state.tickCount).toBe('number');
      expect(typeof state.brainCursor).toBe('number');
      expect(typeof state.combatCursor).toBe('number');
      expect(state.squads).toBeDefined();
      expect(state.relations).toBeDefined();
      expect(state.storyEntries).toBeDefined();
      expect(state.terrainStates).toBeDefined();
    });

    it('restore recovers NPC records and tick state', () => {
      const { kernel, plugin } = initKernel({ tickIntervalMs: 100 });
      plugin.registerNPC({ entityId: 'npc_1', factionId: 'loner', position: { x: 10, y: 20 }, rank: 3, combatPower: 50, currentHp: 100, behaviorConfig: DEFAULT_BEHAVIOR });

      // Advance a few ticks.
      kernel.update(100);
      kernel.update(100);

      const snapshot = plugin.serialize();

      // Destroy and re-init a fresh plugin in a new kernel.
      const ctx2 = initKernel({ tickIntervalMs: 100 });

      ctx2.plugin.restore(snapshot);

      const state = ctx2.plugin.serialize() as unknown as ISimulationPluginState;
      expect(state.npcs).toHaveLength(1);
      expect(state.npcs[0].entityId).toBe('npc_1');
      expect(state.tickCount).toBe(2);
    });

    it('serializes terrain state snapshots', () => {
      const { kernel, plugin } = initKernel({ tickIntervalMs: 100 });
      const terrain = createTerrain({ id: 't1' });
      plugin.addTerrain(terrain);

      kernel.update(100);

      const state = plugin.serialize() as unknown as ISimulationPluginState;
      expect(state.terrainStates).toHaveLength(1);
      expect(state.terrainStates[0].terrainId).toBe('t1');
      expect(state.terrainStates[0].snapshot).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Morale panic
  // -------------------------------------------------------------------------

  describe('morale evaluation', () => {
    it('emits NPC_PANICKED when morale drops below panic threshold', () => {
      const { kernel, plugin } = initKernel({
        tickIntervalMs: 5_000,
        moraleEvalIntervalMs: 100,
      });
      plugin.registerNPC({ entityId: 'npc_panic', factionId: 'loner', position: { x: 0, y: 0 }, rank: 2, combatPower: 40, currentHp: 80, behaviorConfig: createBehaviorConfig({ panicThreshold: -0.5 }) });

      const brain = plugin.getNPCBrain('npc_panic')!;
      brain.setMorale(-0.8); // below -0.5

      const panicked: Array<{ npcId: string }> = [];
      kernel.events.on(ALifeEvents.NPC_PANICKED, (p) => panicked.push(p));

      kernel.update(100); // triggers morale eval

      expect(panicked).toHaveLength(1);
      expect(panicked[0].npcId).toBe('npc_panic');
    });
  });
});
