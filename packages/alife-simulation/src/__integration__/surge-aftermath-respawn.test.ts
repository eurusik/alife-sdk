/**
 * Integration test: "Surge aftermath → respawn pipeline".
 *
 * Verifies the full chain:
 *   SurgeManager AFTERMATH phase → SpawnRegistry.resetAllCooldowns()
 *   → all spawn points become eligible for mass NPC respawn.
 *
 * Scenarios:
 *   1. SpawnRegistry cooldowns active → AFTERMATH fires → all cooldowns zeroed.
 *   2. Full surge cycle INACTIVE → WARNING → ACTIVE → AFTERMATH →
 *      SpawnRegistry.canSpawn() equivalent (getEligiblePoints) returns all entries.
 *   3. surgeCount increments correctly after each complete cycle.
 *   4. SURGE_ENDED (AFTERMATH) event emitted exactly once per cycle.
 *   5. After resetAllCooldowns(), previously blocked points can now spawn.
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect } from 'vitest';
import { SpawnRegistry, EventBus, ALifeEvents } from '@alife-sdk/core';
import type { ALifeEventPayloads, IRandom } from '@alife-sdk/core';
import { SurgeManager } from '../surge/SurgeManager';
import type { ISurgeNPCRecord } from '../surge/SurgeManager';
import { SurgePhase } from '../surge/SurgePhase';
import type { ISurgeConfig } from '../types/ISimulationConfig';
import type { ISimulationBridge } from '../ports/ISimulationBridge';

// ---------------------------------------------------------------------------
// Deterministic random — always returns 0.0 (min interval)
// ---------------------------------------------------------------------------

const FIXED_RANDOM: IRandom = {
  next: () => 0.0,
  nextInt: (min, _max) => min,
  nextFloat: (min, _max) => min,
};

// ---------------------------------------------------------------------------
// Surge config factory — fast timers for test ergonomics
// ---------------------------------------------------------------------------

function createTestSurgeConfig(overrides?: Partial<ISurgeConfig>): ISurgeConfig {
  return {
    intervalMinMs: 1_000,
    intervalMaxMs: 1_000,
    warningDurationMs: 200,
    activeDurationMs: 300,
    aftermathDurationMs: 200,
    damagePerTick: 25,
    damageTickIntervalMs: 500,
    moralePenalty: -0.3,
    moraleRestore: 0.15,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Bridge factory — stub (tests focus on spawn, not damage)
// ---------------------------------------------------------------------------

function createStubBridge(overrides?: Partial<ISimulationBridge>): ISimulationBridge {
  return {
    isAlive: () => true,
    applyDamage: () => false,
    getEffectiveDamage: (_id, raw) => raw,
    adjustMorale: () => {},
    ...overrides,
  };
}

/** Tracking bridge that records all adjustMorale calls. */
function createMoraleTrackingBridge(): {
  bridge: ISimulationBridge;
  moraleAdjustments: Array<{ entityId: string; delta: number; reason: string }>;
} {
  const moraleAdjustments: Array<{ entityId: string; delta: number; reason: string }> = [];
  const bridge: ISimulationBridge = {
    isAlive: () => true,
    applyDamage: () => false,
    getEffectiveDamage: (_id, raw) => raw,
    adjustMorale: (entityId, delta, reason) => {
      moraleAdjustments.push({ entityId, delta, reason });
    },
  };
  return { bridge, moraleAdjustments };
}

// ---------------------------------------------------------------------------
// NPC record factory
// ---------------------------------------------------------------------------

function createSurgeNPC(entityId: string, currentTerrainId: string | null = null): ISurgeNPCRecord {
  return { entityId, currentTerrainId };
}

// ---------------------------------------------------------------------------
// SurgeManager factory
// ---------------------------------------------------------------------------

interface ISurgeContext {
  manager: SurgeManager;
  events: EventBus<ALifeEventPayloads>;
  spawnRegistry: SpawnRegistry;
}

function createSurgeContext(opts?: {
  config?: Partial<ISurgeConfig>;
  bridge?: ISimulationBridge;
  random?: IRandom;
  onSurgeDeath?: (npcId: string) => void;
  spawnCooldownMs?: number;
}): ISurgeContext {
  const events = new EventBus<ALifeEventPayloads>();
  const spawnRegistry = new SpawnRegistry(opts?.spawnCooldownMs ?? 30_000);

  const manager = new SurgeManager({
    config: createTestSurgeConfig(opts?.config),
    events,
    spawnRegistry,
    bridge: opts?.bridge ?? createStubBridge(),
    random: opts?.random ?? FIXED_RANDOM,
    onSurgeDeath: opts?.onSurgeDeath,
  });

  return { manager, events, spawnRegistry };
}

// ---------------------------------------------------------------------------
// Phase advancement helpers
// ---------------------------------------------------------------------------

const EMPTY_NPCS: ReadonlyMap<string, ISurgeNPCRecord> = new Map();
const EMPTY_TERRAINS = [] as const;

/**
 * Advance from INACTIVE to WARNING phase.
 * Uses 1001ms to exceed the 1000ms intervalMin.
 * Pre-condition: manager must be in INACTIVE phase.
 */
function advanceToWarning(ctx: ISurgeContext): void {
  ctx.manager.update(1_001, EMPTY_NPCS, EMPTY_TERRAINS);
  ctx.events.flush();
  // After 1001ms from INACTIVE, cooldown (1000ms) expired → WARNING
}

/**
 * Advance from WARNING to ACTIVE phase.
 * warningDuration = 200ms.
 * Pre-condition: manager must be in WARNING phase.
 */
function warningToActive(ctx: ISurgeContext): void {
  ctx.manager.update(201, EMPTY_NPCS, EMPTY_TERRAINS);
  ctx.events.flush();
}

/**
 * Advance from ACTIVE to AFTERMATH phase.
 * activeDuration = 300ms.
 * Pre-condition: manager must be in ACTIVE phase.
 */
function activeToAftermath(ctx: ISurgeContext): void {
  ctx.manager.update(301, EMPTY_NPCS, EMPTY_TERRAINS);
  ctx.events.flush();
}

/**
 * Advance from INACTIVE through WARNING to ACTIVE.
 */
function advanceToActive(ctx: ISurgeContext): void {
  advanceToWarning(ctx);
  warningToActive(ctx);
}

/**
 * Advance from INACTIVE through WARNING and ACTIVE to AFTERMATH.
 */
function advanceToAftermath(ctx: ISurgeContext): void {
  advanceToWarning(ctx);
  warningToActive(ctx);
  activeToAftermath(ctx);
}

/**
 * Advance from AFTERMATH back to INACTIVE.
 * Fires aftermath effects on first update, then waits out aftermathDuration=200ms.
 */
function advanceFromAftermathToInactive(
  ctx: ISurgeContext,
  npcs: ReadonlyMap<string, ISurgeNPCRecord> = EMPTY_NPCS,
): void {
  // First update fires applyAftermathEffects() exactly once.
  ctx.manager.update(1, npcs, EMPTY_TERRAINS);
  ctx.events.flush();
  // Wait out the remainder of the aftermath phase (aftermathDuration=200ms).
  ctx.manager.update(200, npcs, EMPTY_TERRAINS);
  ctx.events.flush();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Surge aftermath → SpawnRegistry respawn pipeline (integration)', () => {
  // -----------------------------------------------------------------------
  // 1. SpawnRegistry cooldowns active → AFTERMATH fires → all cooldowns zeroed
  // -----------------------------------------------------------------------
  describe('SpawnRegistry cooldowns reset on AFTERMATH', () => {
    it('all active cooldowns are zeroed after AFTERMATH entry', () => {
      const { manager, events, spawnRegistry } = createSurgeContext();
      manager.init();

      // Add multiple spawn points and mark them all as recently spawned.
      const spawnPoints = [
        { id: 'sp_a', terrainId: 'terrain_1', position: { x: 100, y: 100 }, factionId: 'stalkers', maxNPCs: 3 },
        { id: 'sp_b', terrainId: 'terrain_2', position: { x: 200, y: 200 }, factionId: 'bandits', maxNPCs: 2 },
        { id: 'sp_c', terrainId: 'terrain_3', position: { x: 300, y: 300 }, factionId: 'duty', maxNPCs: 5 },
      ];

      for (const sp of spawnPoints) {
        spawnRegistry.addPoint(sp);
        spawnRegistry.markSpawned(sp.id);
      }

      // All spawn points should have active cooldowns (30s default).
      expect(spawnRegistry.getEligiblePoints()).toHaveLength(0);

      // Advance to AFTERMATH.
      advanceToAftermath({ manager, events, spawnRegistry });
      expect(manager.getPhase()).toBe(SurgePhase.AFTERMATH);

      // Fire the first aftermath update → applyAftermathEffects() → resetAllCooldowns().
      manager.update(1, EMPTY_NPCS, EMPTY_TERRAINS);
      events.flush();

      // All cooldowns zeroed → all spawn points eligible (activeCounts=1 < maxNPCs).
      const eligible = spawnRegistry.getEligiblePoints();
      expect(eligible).toHaveLength(3);

      const eligibleIds = eligible.map((e) => e.id).sort();
      expect(eligibleIds).toEqual(['sp_a', 'sp_b', 'sp_c']);
    });

    it('resetAllCooldowns is idempotent — calling update again does not duplicate effects', () => {
      const { manager, events, spawnRegistry } = createSurgeContext();
      manager.init();

      spawnRegistry.addPoint({
        id: 'sp_only',
        terrainId: 'terrain_x',
        position: { x: 50, y: 50 },
        factionId: 'stalkers',
        maxNPCs: 3,
      });
      spawnRegistry.markSpawned('sp_only');

      advanceToAftermath({ manager, events, spawnRegistry });

      // First aftermath update resets cooldowns.
      manager.update(1, EMPTY_NPCS, EMPTY_TERRAINS);
      events.flush();
      expect(spawnRegistry.getEligiblePoints()).toHaveLength(1);

      // Second aftermath update — aftermathApplied guard prevents double-reset.
      manager.update(50, EMPTY_NPCS, EMPTY_TERRAINS);
      events.flush();

      // Still eligible (cooldowns remain at 0, not re-set or re-applied).
      expect(spawnRegistry.getEligiblePoints()).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Full cycle INACTIVE → WARNING → ACTIVE → AFTERMATH → canSpawn
  // -----------------------------------------------------------------------
  describe('full surge cycle makes all spawn points eligible', () => {
    it('all spawn points are eligible after a complete surge cycle', () => {
      const { manager, events, spawnRegistry } = createSurgeContext();
      manager.init();

      // Five spawn points all on cooldown.
      const factions = ['stalkers', 'bandits', 'duty', 'freedom', 'loner'];
      for (let i = 0; i < 5; i++) {
        spawnRegistry.addPoint({
          id: `sp_${i}`,
          terrainId: `terrain_${i}`,
          position: { x: i * 100, y: 0 },
          factionId: factions[i]!,
          maxNPCs: 4,
        });
        spawnRegistry.markSpawned(`sp_${i}`);
      }

      // All on cooldown → none eligible.
      expect(spawnRegistry.getEligiblePoints()).toHaveLength(0);

      // Verify phases in sequence.
      expect(manager.getPhase()).toBe(SurgePhase.INACTIVE);

      const ctx = { manager, events, spawnRegistry };

      advanceToWarning(ctx);
      expect(manager.getPhase()).toBe(SurgePhase.WARNING);

      warningToActive(ctx);
      expect(manager.getPhase()).toBe(SurgePhase.ACTIVE);

      activeToAftermath(ctx);
      expect(manager.getPhase()).toBe(SurgePhase.AFTERMATH);

      // Fire aftermath effects.
      manager.update(1, EMPTY_NPCS, EMPTY_TERRAINS);
      events.flush();

      // All 5 spawn points are now eligible.
      expect(spawnRegistry.getEligiblePoints()).toHaveLength(5);
    });

    it('forceSurge() drives the same cycle when cooldown has not expired', () => {
      const { manager, events, spawnRegistry } = createSurgeContext({
        config: { intervalMinMs: 999_999, intervalMaxMs: 999_999 }, // very long cooldown
      });
      manager.init();

      spawnRegistry.addPoint({
        id: 'sp_force',
        terrainId: 'terrain_force',
        position: { x: 0, y: 0 },
        factionId: 'stalkers',
        maxNPCs: 2,
      });
      spawnRegistry.markSpawned('sp_force');

      // Cooldown active.
      expect(spawnRegistry.getEligiblePoints()).toHaveLength(0);

      // Force surge.
      manager.forceSurge();
      expect(manager.getPhase()).toBe(SurgePhase.WARNING);

      // Advance through warning (200ms) and active (300ms) to aftermath.
      manager.update(201, EMPTY_NPCS, EMPTY_TERRAINS);
      events.flush();
      expect(manager.getPhase()).toBe(SurgePhase.ACTIVE);

      manager.update(301, EMPTY_NPCS, EMPTY_TERRAINS);
      events.flush();
      expect(manager.getPhase()).toBe(SurgePhase.AFTERMATH);

      // Aftermath effects fire.
      manager.update(1, EMPTY_NPCS, EMPTY_TERRAINS);
      events.flush();

      // Spawn point is now eligible.
      expect(spawnRegistry.getEligiblePoints()).toHaveLength(1);
    });
  });

  // -----------------------------------------------------------------------
  // 3. surgeCount increments after full cycle
  // -----------------------------------------------------------------------
  describe('surgeCount increments correctly', () => {
    it('surgeCount starts at 0 and increments to 1 after first complete cycle', () => {
      const ctx = createSurgeContext();
      ctx.manager.init();

      expect(ctx.manager.getSurgeCount()).toBe(0);

      // Advance to ACTIVE (where surgeCount++ happens).
      advanceToActive(ctx);

      expect(ctx.manager.getSurgeCount()).toBe(1);
    });

    it('surgeCount is 2 after two full cycles', () => {
      const ctx = createSurgeContext();
      ctx.manager.init();

      // First cycle.
      advanceToActive(ctx);
      expect(ctx.manager.getSurgeCount()).toBe(1);

      // ctx is now in ACTIVE — advance to AFTERMATH from ACTIVE.
      activeToAftermath(ctx);
      advanceFromAftermathToInactive(ctx);
      expect(ctx.manager.getPhase()).toBe(SurgePhase.INACTIVE);

      // Second cycle — forceSurge to bypass the long cooldown timer.
      ctx.manager.forceSurge();
      ctx.manager.update(201, EMPTY_NPCS, EMPTY_TERRAINS); // warning → active
      ctx.events.flush();
      expect(ctx.manager.getSurgeCount()).toBe(2);
    });

    it('surgeCount is only incremented during ACTIVE phase transition, not during AFTERMATH', () => {
      const ctx = createSurgeContext();
      ctx.manager.init();

      advanceToWarning(ctx);
      expect(ctx.manager.getSurgeCount()).toBe(0); // not yet in ACTIVE

      // ctx is now in WARNING — advance to ACTIVE from WARNING.
      warningToActive(ctx);
      expect(ctx.manager.getSurgeCount()).toBe(1); // incremented on ACTIVE entry

      // ctx is now in ACTIVE — advance to AFTERMATH from ACTIVE.
      activeToAftermath(ctx);
      expect(ctx.manager.getSurgeCount()).toBe(1); // no change during AFTERMATH
    });
  });

  // -----------------------------------------------------------------------
  // 4. SURGE_ENDED event emitted exactly once per cycle
  // -----------------------------------------------------------------------
  describe('SURGE_ENDED event emitted exactly once per cycle', () => {
    it('SURGE_ENDED fires exactly once when transitioning from ACTIVE to AFTERMATH', () => {
      const { manager, events, spawnRegistry } = createSurgeContext();
      manager.init();

      const surgeEndedEvents: Array<{ surgeNumber: number }> = [];
      events.on(ALifeEvents.SURGE_ENDED, (payload) => {
        surgeEndedEvents.push(payload);
      });

      // Advance to AFTERMATH (triggers SURGE_ENDED).
      advanceToAftermath({ manager, events, spawnRegistry });
      events.flush();

      expect(surgeEndedEvents).toHaveLength(1);
      expect(surgeEndedEvents[0]!.surgeNumber).toBe(1);
    });

    it('SURGE_ENDED fires once per cycle across multiple cycles', () => {
      const ctx = createSurgeContext();
      ctx.manager.init();

      const endedEvents: number[] = [];
      ctx.events.on(ALifeEvents.SURGE_ENDED, (p) => endedEvents.push(p.surgeNumber));

      // First cycle.
      advanceToAftermath(ctx);
      ctx.events.flush();
      expect(endedEvents).toEqual([1]);

      // Complete first cycle.
      advanceFromAftermathToInactive(ctx);

      // Second cycle via forceSurge.
      ctx.manager.forceSurge();
      ctx.manager.update(201, EMPTY_NPCS, EMPTY_TERRAINS); // warning → active
      ctx.events.flush();
      ctx.manager.update(301, EMPTY_NPCS, EMPTY_TERRAINS); // active → aftermath
      ctx.events.flush();
      expect(endedEvents).toEqual([1, 2]);
    });

    it('SURGE_WARNING fires once per cycle before SURGE_STARTED', () => {
      const ctx = createSurgeContext();
      ctx.manager.init();

      const warningEvents: number[] = [];
      const startedEvents: number[] = [];

      ctx.events.on(ALifeEvents.SURGE_WARNING, (p) => warningEvents.push(p.timeUntilSurge));
      ctx.events.on(ALifeEvents.SURGE_STARTED, (p) => startedEvents.push(p.surgeNumber));

      advanceToActive(ctx);
      ctx.events.flush();

      expect(warningEvents).toHaveLength(1);
      expect(startedEvents).toHaveLength(1);
      expect(startedEvents[0]).toBe(1);
    });
  });

  // -----------------------------------------------------------------------
  // 5. After resetAllCooldowns(), blocked points can now spawn
  // -----------------------------------------------------------------------
  describe('post-aftermath spawn eligibility', () => {
    it('spawn points that were on cooldown can now spawn after resetAllCooldowns()', () => {
      const { manager, events, spawnRegistry } = createSurgeContext();
      manager.init();

      // Three spawn points with different max capacities.
      spawnRegistry.addPoint({ id: 'alpha', terrainId: 't1', position: { x: 0, y: 0 }, factionId: 'stalkers', maxNPCs: 3 });
      spawnRegistry.addPoint({ id: 'beta',  terrainId: 't2', position: { x: 100, y: 0 }, factionId: 'duty', maxNPCs: 1 });
      spawnRegistry.addPoint({ id: 'gamma', terrainId: 't3', position: { x: 200, y: 0 }, factionId: 'bandits', maxNPCs: 5 });

      // Mark 'alpha' and 'gamma' as spawned (on cooldown).
      spawnRegistry.markSpawned('alpha');
      spawnRegistry.markSpawned('gamma');

      // Only 'beta' is eligible (not spawned yet).
      expect(spawnRegistry.getEligiblePoints().map((p) => p.id)).toEqual(['beta']);

      // Run full surge lifecycle.
      advanceToAftermath({ manager, events, spawnRegistry });
      manager.update(1, EMPTY_NPCS, EMPTY_TERRAINS); // triggers aftermath effects
      events.flush();

      // All three are now eligible (cooldowns reset, active counts within max).
      const eligible = spawnRegistry.getEligiblePoints();
      expect(eligible).toHaveLength(3);
    });

    it('spawn points at max capacity remain ineligible even after cooldown reset', () => {
      const { manager, events, spawnRegistry } = createSurgeContext();
      manager.init();

      // Spawn point at max capacity (maxNPCs=2, activeCounts=2).
      spawnRegistry.addPoint({
        id: 'full_sp',
        terrainId: 't_full',
        position: { x: 0, y: 0 },
        factionId: 'stalkers',
        maxNPCs: 2,
      });

      // Mark spawned twice (reaches max capacity).
      spawnRegistry.markSpawned('full_sp');
      spawnRegistry.markSpawned('full_sp');

      // On cooldown AND at capacity.
      expect(spawnRegistry.getEligiblePoints()).toHaveLength(0);

      // Run full surge lifecycle.
      advanceToAftermath({ manager, events, spawnRegistry });
      manager.update(1, EMPTY_NPCS, EMPTY_TERRAINS);
      events.flush();

      // Cooldown is reset, but still at capacity → remains ineligible.
      expect(spawnRegistry.getEligiblePoints()).toHaveLength(0);
    });

    it('spawn points added after surge start get cooldowns reset too', () => {
      const { manager, events, spawnRegistry } = createSurgeContext();
      manager.init();

      spawnRegistry.addPoint({
        id: 'early_sp',
        terrainId: 't_early',
        position: { x: 0, y: 0 },
        factionId: 'stalkers',
        maxNPCs: 3,
      });
      spawnRegistry.markSpawned('early_sp');

      advanceToWarning({ manager, events, spawnRegistry });

      // Add a new spawn point during WARNING phase.
      spawnRegistry.addPoint({
        id: 'late_sp',
        terrainId: 't_late',
        position: { x: 100, y: 0 },
        factionId: 'duty',
        maxNPCs: 3,
      });
      spawnRegistry.markSpawned('late_sp');

      // Both on cooldown.
      expect(spawnRegistry.getEligiblePoints()).toHaveLength(0);

      // Advance to AFTERMATH.
      manager.update(201, EMPTY_NPCS, EMPTY_TERRAINS); // warning → active
      events.flush();
      manager.update(301, EMPTY_NPCS, EMPTY_TERRAINS); // active → aftermath
      events.flush();

      // Fire aftermath effects.
      manager.update(1, EMPTY_NPCS, EMPTY_TERRAINS);
      events.flush();

      // Both spawn points eligible after reset.
      expect(spawnRegistry.getEligiblePoints()).toHaveLength(2);
    });

    it('aftermath morale restore is applied to all surviving NPCs with correct reason', () => {
      const { bridge, moraleAdjustments } = createMoraleTrackingBridge();
      const { manager, events, spawnRegistry } = createSurgeContext({ bridge });
      manager.init();

      const survivors = new Map<string, ISurgeNPCRecord>([
        ['npc_s1', createSurgeNPC('ent_s1', null)],
        ['npc_s2', createSurgeNPC('ent_s2', null)],
        ['npc_s3', createSurgeNPC('ent_s3', null)],
      ]);

      advanceToAftermath({ manager, events, spawnRegistry });

      // Fire aftermath with the survivor NPCs.
      manager.update(1, survivors, EMPTY_TERRAINS);
      events.flush();

      // moraleRestore=0.15 applied to each survivor with reason 'surge_aftermath'.
      const aftermathCalls = moraleAdjustments.filter((c) => c.reason === 'surge_aftermath');
      expect(aftermathCalls).toHaveLength(3);
      for (const call of aftermathCalls) {
        expect(call.delta).toBe(0.15);
      }

      const entityIds = aftermathCalls.map((c) => c.entityId).sort();
      expect(entityIds).toEqual(['ent_s1', 'ent_s2', 'ent_s3']);
    });
  });

  // -----------------------------------------------------------------------
  // 6. serialize / restore preserves surge state including surgeCount
  // -----------------------------------------------------------------------
  describe('serialize / restore preserves surge state', () => {
    it('restored surge manager has correct surgeCount after full cycle', () => {
      const ctx = createSurgeContext();
      ctx.manager.init();

      // Complete one full cycle.
      advanceToAftermath(ctx);
      advanceFromAftermathToInactive(ctx);

      expect(ctx.manager.getSurgeCount()).toBe(1);
      expect(ctx.manager.getPhase()).toBe(SurgePhase.INACTIVE);

      // Serialize.
      const state = ctx.manager.serialize();
      expect(state.surgeCount).toBe(1);

      // Restore into a new manager.
      const ctx2 = createSurgeContext();
      ctx2.manager.init();
      ctx2.manager.restore(state);

      expect(ctx2.manager.getSurgeCount()).toBe(1);
      expect(ctx2.manager.getPhase()).toBe(SurgePhase.INACTIVE);
    });

    it('restored manager in AFTERMATH phase still fires aftermath effects on first update', () => {
      const ctx = createSurgeContext();
      ctx.manager.init();

      // Advance to AFTERMATH but do NOT fire effects yet.
      advanceToAftermath(ctx);
      expect(ctx.manager.getPhase()).toBe(SurgePhase.AFTERMATH);

      // Serialize while in AFTERMATH (aftermathApplied=false).
      const state = ctx.manager.serialize();
      expect(state.phase).toBe(SurgePhase.AFTERMATH);
      expect(state.aftermathApplied).toBe(false);

      // Restore into new manager with a spawn point on cooldown.
      const ctx2 = createSurgeContext();
      ctx2.manager.init();
      ctx2.spawnRegistry.addPoint({
        id: 'sp_restore',
        terrainId: 't_restore',
        position: { x: 0, y: 0 },
        factionId: 'stalkers',
        maxNPCs: 3,
      });
      ctx2.spawnRegistry.markSpawned('sp_restore');

      ctx2.manager.restore(state);

      // Still in AFTERMATH — no effects fired yet.
      expect(ctx2.spawnRegistry.getEligiblePoints()).toHaveLength(0);

      // Fire the first aftermath update.
      ctx2.manager.update(1, EMPTY_NPCS, EMPTY_TERRAINS);
      ctx2.events.flush();

      // Cooldowns reset — spawn point is now eligible.
      expect(ctx2.spawnRegistry.getEligiblePoints()).toHaveLength(1);
    });
  });
});
