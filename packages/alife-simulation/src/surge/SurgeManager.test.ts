import { EventBus, ALifeEvents, SpawnRegistry, SmartTerrain } from '@alife-sdk/core';
import type { ALifeEventPayloads, IRandom, ISmartTerrainConfig } from '@alife-sdk/core';
import type { ISimulationBridge } from '../ports/ISimulationBridge';
import type { ISurgeConfig } from '../types/ISimulationConfig';
import { SurgeManager, type ISurgeNPCRecord } from './SurgeManager';
import { SurgePhase } from './SurgePhase';

// ---------------------------------------------------------------------------
// Test helpers -- real objects, zero mocks
// ---------------------------------------------------------------------------

/** Deterministic random that always returns 0.5. */
const fixedRandom: IRandom = {
  next: () => 0.5,
  nextInt: (min, max) => Math.floor(0.5 * (max - min + 1)) + min,
  nextFloat: (min, max) => 0.5 * (max - min) + min,
};

/** Fast surge config: short timers for test ergonomics. */
function createTestSurgeConfig(overrides?: Partial<ISurgeConfig>): ISurgeConfig {
  return {
    intervalMinMs: 1_000,
    intervalMaxMs: 1_000, // deterministic: always 1000ms cooldown
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

/** Stub bridge that records nothing and reports all entities alive. */
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

/** Create a real SmartTerrain with test defaults. */
function createTerrain(overrides?: Partial<ISmartTerrainConfig>): SmartTerrain {
  return new SmartTerrain({
    id: 'terrain_default',
    name: 'Default',
    bounds: { x: 0, y: 0, width: 200, height: 200 },
    capacity: 5,
    ...overrides,
  });
}

/** Create a minimal NPC record for SurgeManager. */
function createNPC(
  entityId: string,
  currentTerrainId: string | null = null,
): ISurgeNPCRecord {
  return { entityId, currentTerrainId };
}

/** Build a manager with standard wiring, returning all parts for assertions. */
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
// Helpers for advancing through phases
// ---------------------------------------------------------------------------

/**
 * Advance the manager past the cooldown into WARNING.
 * With default test config (intervalMin=Max=1000, random=0.5), cooldown = 1000ms.
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SurgeManager', () => {
  const emptyNpcs = new Map<string, ISurgeNPCRecord>();
  const emptyTerrains: SmartTerrain[] = [];

  // -----------------------------------------------------------------------
  // 1. Full lifecycle
  // -----------------------------------------------------------------------
  describe('full lifecycle', () => {
    it('progresses INACTIVE -> WARNING -> ACTIVE -> AFTERMATH -> INACTIVE', () => {
      const { manager, events } = createSurge();
      manager.init();

      expect(manager.getPhase()).toBe(SurgePhase.INACTIVE);

      // Advance past cooldown -> WARNING
      manager.update(1_001, emptyNpcs, emptyTerrains);
      events.flush();
      expect(manager.getPhase()).toBe(SurgePhase.WARNING);

      // Advance past warning -> ACTIVE
      manager.update(501, emptyNpcs, emptyTerrains);
      events.flush();
      expect(manager.getPhase()).toBe(SurgePhase.ACTIVE);
      expect(manager.getSurgeCount()).toBe(1);

      // Advance past active -> AFTERMATH
      manager.update(2_001, emptyNpcs, emptyTerrains);
      events.flush();
      expect(manager.getPhase()).toBe(SurgePhase.AFTERMATH);

      // Advance past aftermath -> INACTIVE
      manager.update(301, emptyNpcs, emptyTerrains);
      events.flush();
      expect(manager.getPhase()).toBe(SurgePhase.INACTIVE);
    });

    it('increments surgeCount each cycle', () => {
      const { manager, events } = createSurge();
      manager.init();

      expect(manager.getSurgeCount()).toBe(0);

      // First cycle
      advanceToActive(manager, emptyNpcs, emptyTerrains, events);
      expect(manager.getSurgeCount()).toBe(1);

      // Complete first cycle
      manager.update(2_001, emptyNpcs, emptyTerrains);
      events.flush();
      manager.update(301, emptyNpcs, emptyTerrains);
      events.flush();

      // Second cycle
      advanceToActive(manager, emptyNpcs, emptyTerrains, events);
      expect(manager.getSurgeCount()).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Events emitted
  // -----------------------------------------------------------------------
  describe('events emitted', () => {
    it('emits SURGE_WARNING when entering WARNING phase', () => {
      const { manager, events } = createSurge();
      manager.init();

      const received: unknown[] = [];
      events.on(ALifeEvents.SURGE_WARNING, (p) => received.push(p));

      manager.update(1_001, emptyNpcs, emptyTerrains);
      events.flush();

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ timeUntilSurge: 500 });
    });

    it('emits SURGE_STARTED when entering ACTIVE phase', () => {
      const { manager, events } = createSurge();
      manager.init();

      const received: unknown[] = [];
      events.on(ALifeEvents.SURGE_STARTED, (p) => received.push(p));

      advanceToActive(manager, emptyNpcs, emptyTerrains, events);

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ surgeNumber: 1 });
    });

    it('emits SURGE_ENDED when entering AFTERMATH phase', () => {
      const { manager, events } = createSurge();
      manager.init();

      const received: unknown[] = [];
      events.on(ALifeEvents.SURGE_ENDED, (p) => received.push(p));

      advanceToAftermath(manager, emptyNpcs, emptyTerrains, events);

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual({ surgeNumber: 1 });
    });

    it('emits SURGE_DAMAGE for each outdoor NPC per damage tick', () => {
      const npcs = new Map<string, ISurgeNPCRecord>([
        ['npc_1', createNPC('ent_1')],
        ['npc_2', createNPC('ent_2')],
      ]);
      const { manager, events } = createSurge();
      manager.init();

      const received: unknown[] = [];
      events.on(ALifeEvents.SURGE_DAMAGE, (p) => received.push(p));

      advanceToActive(manager, npcs, emptyTerrains, events);

      // After entering ACTIVE, advance 500ms to trigger one damage tick
      manager.update(500, npcs, emptyTerrains);
      events.flush();

      expect(received).toHaveLength(2);
      expect(received[0]).toEqual({ npcId: 'npc_1', damage: 25 });
      expect(received[1]).toEqual({ npcId: 'npc_2', damage: 25 });
    });
  });

  // -----------------------------------------------------------------------
  // 3. Shelter protection
  // -----------------------------------------------------------------------
  describe('shelter protection', () => {
    it('does not apply damage to NPCs in shelter terrains', () => {
      const shelterTerrain = createTerrain({
        id: 'bunker_1',
        isShelter: true,
      });
      const npcs = new Map<string, ISurgeNPCRecord>([
        ['npc_sheltered', createNPC('ent_sheltered', 'bunker_1')],
      ]);

      const { bridge, calls } = createTrackingBridge();
      const { manager, events } = createSurge({ bridge });
      manager.init();

      advanceToActive(manager, npcs, [shelterTerrain], events);
      manager.update(500, npcs, [shelterTerrain]);
      events.flush();

      // applyDamage should NOT have been called -- NPC is sheltered
      const damageCalls = calls.filter((c) => c.method === 'applyDamage');
      expect(damageCalls).toHaveLength(0);
    });

    it('applies damage to NPCs in non-shelter terrains', () => {
      const outdoorTerrain = createTerrain({
        id: 'field_1',
        isShelter: false,
      });
      const npcs = new Map<string, ISurgeNPCRecord>([
        ['npc_outdoor', createNPC('ent_outdoor', 'field_1')],
      ]);

      const { bridge, calls } = createTrackingBridge();
      const { manager, events } = createSurge({ bridge });
      manager.init();

      advanceToActive(manager, npcs, [outdoorTerrain], events);
      manager.update(500, npcs, [outdoorTerrain]);
      events.flush();

      const damageCalls = calls.filter((c) => c.method === 'applyDamage');
      expect(damageCalls).toHaveLength(1);
      expect(damageCalls[0]!.args).toEqual(['ent_outdoor', 25, 'psi']);
    });
  });

  // -----------------------------------------------------------------------
  // 4. Outdoor damage
  // -----------------------------------------------------------------------
  describe('outdoor damage', () => {
    it('applies damage to NPCs with no terrain assigned', () => {
      const npcs = new Map<string, ISurgeNPCRecord>([
        ['npc_no_terrain', createNPC('ent_1', null)],
      ]);

      const { bridge, calls } = createTrackingBridge();
      const { manager, events } = createSurge({ bridge });
      manager.init();

      advanceToActive(manager, npcs, emptyTerrains, events);
      manager.update(500, npcs, emptyTerrains);
      events.flush();

      const damageCalls = calls.filter((c) => c.method === 'applyDamage');
      expect(damageCalls).toHaveLength(1);
      expect(damageCalls[0]!.args).toEqual(['ent_1', 25, 'psi']);
    });

    it('adjusts morale for surviving NPCs after damage', () => {
      const npcs = new Map<string, ISurgeNPCRecord>([
        ['npc_1', createNPC('ent_1', null)],
      ]);

      const { bridge, calls } = createTrackingBridge();
      const { manager, events } = createSurge({ bridge });
      manager.init();

      advanceToActive(manager, npcs, emptyTerrains, events);
      manager.update(500, npcs, emptyTerrains);
      events.flush();

      const moraleCalls = calls.filter(
        (c) => c.method === 'adjustMorale' && c.args[2] === 'surge',
      );
      expect(moraleCalls).toHaveLength(1);
      expect(moraleCalls[0]!.args).toEqual(['ent_1', -0.3, 'surge']);
    });
  });

  // -----------------------------------------------------------------------
  // 5. Death during surge
  // -----------------------------------------------------------------------
  describe('death during surge', () => {
    it('calls onSurgeDeath when applyDamage returns true', () => {
      const npcs = new Map<string, ISurgeNPCRecord>([
        ['npc_doomed', createNPC('ent_doomed', null)],
      ]);

      const deadIds: string[] = [];
      const bridge = createStubBridge({
        applyDamage: () => true, // always fatal
      });

      const { manager, events } = createSurge({
        bridge,
        onSurgeDeath: (id) => deadIds.push(id),
      });
      manager.init();

      advanceToActive(manager, npcs, emptyTerrains, events);
      manager.update(500, npcs, emptyTerrains);
      events.flush();

      expect(deadIds).toEqual(['npc_doomed']);
    });

    it('does not adjust morale for dead NPCs', () => {
      const npcs = new Map<string, ISurgeNPCRecord>([
        ['npc_dead', createNPC('ent_dead', null)],
      ]);

      const { bridge, calls } = createTrackingBridge({
        applyDamage: () => true, // kills the NPC
      });

      const { manager, events } = createSurge({ bridge });
      manager.init();

      advanceToActive(manager, npcs, emptyTerrains, events);
      manager.update(500, npcs, emptyTerrains);
      events.flush();

      // adjustMorale should NOT be called with reason 'surge' since NPC died
      const surgeMoraleCalls = calls.filter(
        (c) => c.method === 'adjustMorale' && c.args[2] === 'surge',
      );
      expect(surgeMoraleCalls).toHaveLength(0);
    });

    it('does not emit SURGE_DAMAGE for dead NPCs', () => {
      const npcs = new Map<string, ISurgeNPCRecord>([
        ['npc_dead', createNPC('ent_dead', null)],
      ]);

      const bridge = createStubBridge({
        applyDamage: () => true,
      });

      const received: unknown[] = [];
      const { manager, events } = createSurge({ bridge });
      manager.init();

      events.on(ALifeEvents.SURGE_DAMAGE, (p) => received.push(p));

      advanceToActive(manager, npcs, emptyTerrains, events);
      manager.update(500, npcs, emptyTerrains);
      events.flush();

      expect(received).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // 6. Aftermath effects
  // -----------------------------------------------------------------------
  describe('aftermath effects', () => {
    it('resets spawn cooldowns on aftermath entry', () => {
      const { manager, events, spawnRegistry } = createSurge();
      manager.init();

      // Add a spawn point and mark it spawned so it has a cooldown.
      spawnRegistry.addPoint({
        id: 'sp_1',
        terrainId: 'terrain_1',
        position: { x: 0, y: 0 },
        factionId: 'loners',
        maxNPCs: 3,
      });
      spawnRegistry.markSpawned('sp_1');

      // Before surge, cooldown is active -> not eligible
      const beforeEligible = spawnRegistry.getEligiblePoints();
      expect(beforeEligible).toHaveLength(0);

      // Advance to aftermath
      advanceToAftermath(manager, emptyNpcs, emptyTerrains, events);

      // First aftermath update triggers resetAllCooldowns
      manager.update(1, emptyNpcs, emptyTerrains);
      events.flush();

      // Now the spawn point should be eligible (cooldown reset, but active count=1 < max=3)
      // Actually, markSpawned sets cooldown AND increments active. After reset, cooldown=0
      // but active=1 < max=3, so it IS eligible.
      const afterEligible = spawnRegistry.getEligiblePoints();
      expect(afterEligible).toHaveLength(1);
    });

    it('restores morale for all surviving NPCs during aftermath', () => {
      const npcs = new Map<string, ISurgeNPCRecord>([
        ['npc_1', createNPC('ent_1')],
        ['npc_2', createNPC('ent_2')],
      ]);

      const { bridge, calls } = createTrackingBridge();
      const { manager, events } = createSurge({ bridge });
      manager.init();

      advanceToAftermath(manager, npcs, emptyTerrains, events);

      // First aftermath update
      manager.update(1, npcs, emptyTerrains);
      events.flush();

      const aftermathMoraleCalls = calls.filter(
        (c) => c.method === 'adjustMorale' && c.args[2] === 'surge_aftermath',
      );
      expect(aftermathMoraleCalls).toHaveLength(2);
      expect(aftermathMoraleCalls[0]!.args).toEqual(['ent_1', 0.15, 'surge_aftermath']);
      expect(aftermathMoraleCalls[1]!.args).toEqual(['ent_2', 0.15, 'surge_aftermath']);
    });

    it('applies aftermath effects only once', () => {
      const npcs = new Map<string, ISurgeNPCRecord>([
        ['npc_1', createNPC('ent_1')],
      ]);

      const { bridge, calls } = createTrackingBridge();
      const { manager, events } = createSurge({ bridge });
      manager.init();

      advanceToAftermath(manager, npcs, emptyTerrains, events);

      // Multiple aftermath updates
      manager.update(1, npcs, emptyTerrains);
      events.flush();
      manager.update(1, npcs, emptyTerrains);
      events.flush();
      manager.update(1, npcs, emptyTerrains);
      events.flush();

      const aftermathMoraleCalls = calls.filter(
        (c) => c.method === 'adjustMorale' && c.args[2] === 'surge_aftermath',
      );
      // Only once, despite three updates
      expect(aftermathMoraleCalls).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // 7. forceSurge()
  // -----------------------------------------------------------------------
  describe('forceSurge()', () => {
    it('skips cooldown and goes to WARNING immediately', () => {
      const { manager, events } = createSurge();
      manager.init();

      expect(manager.getPhase()).toBe(SurgePhase.INACTIVE);

      manager.forceSurge();
      events.flush();

      expect(manager.getPhase()).toBe(SurgePhase.WARNING);
    });

    it('emits SURGE_WARNING when forced', () => {
      const { manager, events } = createSurge();
      manager.init();

      const received: unknown[] = [];
      events.on(ALifeEvents.SURGE_WARNING, (p) => received.push(p));

      manager.forceSurge();
      events.flush();

      expect(received).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // 8. forceSurge() ignored during active surge
  // -----------------------------------------------------------------------
  describe('forceSurge() ignored during active surge', () => {
    it('is ignored during WARNING phase', () => {
      const { manager, events } = createSurge();
      manager.init();

      advanceToWarning(manager, emptyNpcs, emptyTerrains, events);
      expect(manager.getPhase()).toBe(SurgePhase.WARNING);

      manager.forceSurge();
      events.flush();

      expect(manager.getPhase()).toBe(SurgePhase.WARNING);
    });

    it('is ignored during ACTIVE phase', () => {
      const { manager, events } = createSurge();
      manager.init();

      advanceToActive(manager, emptyNpcs, emptyTerrains, events);
      expect(manager.getPhase()).toBe(SurgePhase.ACTIVE);

      manager.forceSurge();
      events.flush();

      expect(manager.getPhase()).toBe(SurgePhase.ACTIVE);
    });

    it('is ignored during AFTERMATH phase', () => {
      const { manager, events } = createSurge();
      manager.init();

      advanceToAftermath(manager, emptyNpcs, emptyTerrains, events);
      expect(manager.getPhase()).toBe(SurgePhase.AFTERMATH);

      manager.forceSurge();
      events.flush();

      expect(manager.getPhase()).toBe(SurgePhase.AFTERMATH);
    });
  });

  // -----------------------------------------------------------------------
  // 9. Dead NPC skipped
  // -----------------------------------------------------------------------
  describe('dead NPC skipped', () => {
    it('does not apply damage to dead NPCs', () => {
      const npcs = new Map<string, ISurgeNPCRecord>([
        ['npc_dead', createNPC('ent_dead', null)],
        ['npc_alive', createNPC('ent_alive', null)],
      ]);

      const { bridge, calls } = createTrackingBridge({
        isAlive: (id) => id !== 'ent_dead',
      });

      const { manager, events } = createSurge({ bridge });
      manager.init();

      advanceToActive(manager, npcs, emptyTerrains, events);
      manager.update(500, npcs, emptyTerrains);
      events.flush();

      const damageCalls = calls.filter((c) => c.method === 'applyDamage');
      expect(damageCalls).toHaveLength(1);
      expect(damageCalls[0]!.args[0]).toBe('ent_alive');
    });
  });

  // -----------------------------------------------------------------------
  // 10. isSafe / isActive / isSurgeIncoming queries
  // -----------------------------------------------------------------------
  describe('query methods per phase', () => {
    it('INACTIVE: isSafe=true, isActive=false, isSurgeIncoming=false', () => {
      const { manager } = createSurge();
      manager.init();

      expect(manager.isSafe()).toBe(true);
      expect(manager.isActive()).toBe(false);
      expect(manager.isSurgeIncoming()).toBe(false);
    });

    it('WARNING: isSafe=false, isActive=false, isSurgeIncoming=true', () => {
      const { manager, events } = createSurge();
      manager.init();

      advanceToWarning(manager, emptyNpcs, emptyTerrains, events);

      expect(manager.isSafe()).toBe(false);
      expect(manager.isActive()).toBe(false);
      expect(manager.isSurgeIncoming()).toBe(true);
    });

    it('ACTIVE: isSafe=false, isActive=true, isSurgeIncoming=true', () => {
      const { manager, events } = createSurge();
      manager.init();

      advanceToActive(manager, emptyNpcs, emptyTerrains, events);

      expect(manager.isSafe()).toBe(false);
      expect(manager.isActive()).toBe(true);
      expect(manager.isSurgeIncoming()).toBe(true);
    });

    it('AFTERMATH: isSafe=false, isActive=false, isSurgeIncoming=false', () => {
      const { manager, events } = createSurge();
      manager.init();

      advanceToAftermath(manager, emptyNpcs, emptyTerrains, events);

      expect(manager.isSafe()).toBe(false);
      expect(manager.isActive()).toBe(false);
      expect(manager.isSurgeIncoming()).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe('edge cases', () => {
    it('multiple damage ticks fire when delta covers multiple intervals', () => {
      const npcs = new Map<string, ISurgeNPCRecord>([
        ['npc_1', createNPC('ent_1', null)],
      ]);

      const { bridge, calls } = createTrackingBridge();
      const { manager, events } = createSurge({ bridge });
      manager.init();

      advanceToActive(manager, npcs, emptyTerrains, events);

      // Advance 1500ms -- should fire 3 damage ticks (500ms interval)
      manager.update(1_500, npcs, emptyTerrains);
      events.flush();

      const damageCalls = calls.filter((c) => c.method === 'applyDamage');
      expect(damageCalls).toHaveLength(3);
    });

    it('destroy() resets to INACTIVE', () => {
      const { manager, events } = createSurge();
      manager.init();

      advanceToActive(manager, emptyNpcs, emptyTerrains, events);
      expect(manager.isActive()).toBe(true);

      manager.destroy();

      expect(manager.getPhase()).toBe(SurgePhase.INACTIVE);
    });

    it('shelter vs outdoor mixed NPCs: only outdoor ones take damage', () => {
      const shelter = createTerrain({ id: 'bunker_2', isShelter: true });
      const field = createTerrain({ id: 'field_2', isShelter: false });

      const npcs = new Map<string, ISurgeNPCRecord>([
        ['npc_safe', createNPC('ent_safe', 'bunker_2')],
        ['npc_exposed', createNPC('ent_exposed', 'field_2')],
        ['npc_unassigned', createNPC('ent_unassigned', null)],
      ]);

      const { bridge, calls } = createTrackingBridge();
      const { manager, events } = createSurge({ bridge });
      manager.init();

      advanceToActive(manager, npcs, [shelter, field], events);
      manager.update(500, npcs, [shelter, field]);
      events.flush();

      const damageCalls = calls.filter((c) => c.method === 'applyDamage');
      expect(damageCalls).toHaveLength(2);

      const damagedIds = damageCalls.map((c) => c.args[0]);
      expect(damagedIds).toContain('ent_exposed');
      expect(damagedIds).toContain('ent_unassigned');
      expect(damagedIds).not.toContain('ent_safe');
    });
  });
});
