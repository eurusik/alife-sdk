/**
 * Shared factories for integration tests.
 *
 * Every object is REAL -- zero mocks, zero vi.fn().
 * Tests exercise the full NPCBrain -> TerrainSelector -> JobSlotSystem ->
 * MovementSimulator -> EventBus pipeline end-to-end.
 */

import { SmartTerrain, Clock, EventBus, Faction, FactionBuilder } from '@alife-sdk/core';
import type { ALifeEventPayloads, ISmartTerrainConfig, Vec2, IRandom } from '@alife-sdk/core';
import { NPCBrain } from '../brain/NPCBrain';
import type { IBrainDeps } from '../brain/NPCBrain';
import type {
  IBrainConfig,
  ITerrainSelectorConfig,
  IJobScoringConfig,
  IOfflineCombatConfig,
  ISurgeConfig,
  ITerrainStateConfig,
} from '../types/ISimulationConfig';
import { createDefaultSimulationConfig } from '../types/ISimulationConfig';
import type { INPCRecord, INPCBehaviorConfig } from '../types/INPCRecord';
import type { ISimulationBridge } from '../ports/ISimulationBridge';
import { MovementSimulator } from '../movement/MovementSimulator';

// ---------------------------------------------------------------------------
// SmartTerrain factory
// ---------------------------------------------------------------------------

/** Create a real SmartTerrain with sensible defaults. */
export function createTerrain(overrides?: Partial<ISmartTerrainConfig>): SmartTerrain {
  return new SmartTerrain({
    id: 'terrain_default',
    name: 'Default',
    bounds: { x: 0, y: 0, width: 200, height: 200 },
    capacity: 5,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Config factories
// ---------------------------------------------------------------------------

export function createBrainConfig(overrides?: Partial<IBrainConfig>): IBrainConfig {
  return {
    searchIntervalMs: 5_000,
    schemeCheckIntervalMs: 3_000,
    moraleFleeThreshold: -0.5,
    reEvaluateIntervalMs: 30_000,
    dangerTolerance: 3,
    ...overrides,
  };
}

export function createSelectorConfig(overrides?: Partial<ITerrainSelectorConfig>): ITerrainSelectorConfig {
  return {
    surgeMultiplier: 3.0,
    squadLeaderBonus: 20,
    moraleDangerPenalty: 15,
    ...overrides,
  };
}

export function createJobConfig(overrides?: Partial<IJobScoringConfig>): IJobScoringConfig {
  return {
    rankBonus: 5,
    distancePenalty: 0.01,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// World builder
// ---------------------------------------------------------------------------

/** Descriptor for an NPC to be created inside a World. */
export interface INPCDescriptor {
  readonly id: string;
  readonly faction: string;
  readonly rank?: number;
  readonly position?: Vec2;
  readonly brainConfig?: Partial<IBrainConfig>;
}

export interface IWorldConfig {
  readonly clockHour?: number;
  readonly timeFactor?: number;
  readonly terrains: Array<Partial<ISmartTerrainConfig>>;
  readonly npcs: readonly INPCDescriptor[];
}

/** A fully-wired simulation world with real objects, zero mocks. */
export interface IWorld {
  readonly clock: Clock;
  /** Typed EventBus shared across all brains and MovementSimulator. */
  readonly events: EventBus<ALifeEventPayloads>;
  readonly movement: MovementSimulator;
  readonly terrains: SmartTerrain[];
  readonly brains: NPCBrain[];

  /**
   * Advance the whole world by `deltaMs`:
   *   1. Clock
   *   2. MovementSimulator
   *   3. Every brain
   *   4. EventBus flush
   */
  tick(deltaMs: number): void;
}

/**
 * Construct a self-contained simulation world.
 *
 * Clock, EventBus, and MovementSimulator are shared across all brains.
 * Each NPC gets a real NPCBrain wired to the shared MovementSimulator.
 */
export function createWorld(config: IWorldConfig): IWorld {
  const clock = new Clock({
    startHour: config.clockHour ?? 12,
    timeFactor: config.timeFactor ?? 1,
  });
  const events = new EventBus<ALifeEventPayloads>();
  const movement = new MovementSimulator(events);

  const terrains = config.terrains.map((t) => createTerrain(t));

  const brains = config.npcs.map((npc) => {
    const brain = new NPCBrain({
      npcId: npc.id,
      factionId: npc.faction,
      config: createBrainConfig(npc.brainConfig),
      selectorConfig: createSelectorConfig(),
      jobConfig: createJobConfig(),
      deps: { clock, events },
    });
    brain.setMovementDispatcher(movement);
    brain.setLastPosition(npc.position ?? { x: 100, y: 100 });
    brain.setRank(npc.rank ?? 2);
    return brain;
  });

  return {
    clock,
    events,
    movement,
    terrains,
    brains,
    tick(deltaMs: number) {
      clock.update(deltaMs);
      movement.update(deltaMs);
      for (const brain of brains) {
        brain.update(deltaMs, terrains);
      }
      events.flush();
    },
  };
}

// ---------------------------------------------------------------------------
// Combat / Surge shared factories
// ---------------------------------------------------------------------------

/** Deterministic random that always returns 0.25 (well below the 70% detection gate). */
export const SEEDED_RANDOM: IRandom = {
  next: () => 0.25,
  nextInt: (min: number, max: number) => Math.floor(0.25 * (max - min + 1)) + min,
  nextFloat: (min: number, max: number) => 0.25 * (max - min) + min,
};

/** INPCBehaviorConfig with sensible defaults. */
export function createBehaviorConfig(overrides?: Partial<INPCBehaviorConfig>): INPCBehaviorConfig {
  return {
    retreatThreshold: 0.1,
    panicThreshold: -0.7,
    searchIntervalMs: 5_000,
    dangerTolerance: 3,
    aggression: 0.5,
    ...overrides,
  };
}

/** INPCRecord with sensible defaults (offline, alive, rank 3). */
export function createNPCRecord(overrides?: Partial<INPCRecord>): INPCRecord {
  return {
    entityId: 'npc_default',
    factionId: 'stalker',
    combatPower: 50,
    currentHp: 100,
    rank: 3,
    behaviorConfig: createBehaviorConfig(),
    lastPosition: { x: 100, y: 100 },
    isOnline: false,
    ...overrides,
  };
}

/** Faction with optional bilateral relations. */
export function createFaction(id: string, relations: Record<string, number> = {}): Faction {
  const def = new FactionBuilder(id).displayName(id);
  for (const [otherId, score] of Object.entries(relations)) {
    def.relation(otherId, score);
  }
  return new Faction(id, def.build());
}

/** Minimal ISimulationBridge stub — no damage, always alive. */
export function createStubBridge(overrides?: Partial<ISimulationBridge>): ISimulationBridge {
  return {
    isAlive: () => true,
    applyDamage: () => false,
    getEffectiveDamage: (_id, raw) => raw,
    adjustMorale: () => {},
    ...overrides,
  };
}

/** Bridge that records every call into a `calls` array for assertion. */
export function createTrackingBridge(
  overrides?: Partial<ISimulationBridge>,
): { bridge: ISimulationBridge; calls: Array<{ method: string; args: unknown[] }> } {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const base = createStubBridge();
  const bridge: ISimulationBridge = {
    isAlive(...args) {
      calls.push({ method: 'isAlive', args });
      return (overrides?.isAlive ?? base.isAlive)(...args);
    },
    applyDamage(...args) {
      calls.push({ method: 'applyDamage', args });
      return (overrides?.applyDamage ?? base.applyDamage)(...args);
    },
    getEffectiveDamage(...args) {
      calls.push({ method: 'getEffectiveDamage', args });
      return (overrides?.getEffectiveDamage ?? base.getEffectiveDamage)(...args);
    },
    adjustMorale(...args) {
      calls.push({ method: 'adjustMorale', args });
      (overrides?.adjustMorale ?? base.adjustMorale)(...args);
    },
  };
  return { bridge, calls };
}

/** Shared infrastructure: Clock + EventBus + MovementSimulator. */
export function createSharedDeps(clockHour = 12) {
  const clock = new Clock({ startHour: clockHour, timeFactor: 1 });
  const events = new EventBus<ALifeEventPayloads>();
  const movement = new MovementSimulator(events);
  return { clock, events, movement };
}

/** Create an NPCBrain wired to shared deps. */
export function createBrain(
  npcId: string,
  factionId: string,
  deps: IBrainDeps,
  movement: MovementSimulator,
  opts?: { rank?: number; position?: Vec2; brainConfig?: Partial<IBrainConfig> },
): NPCBrain {
  const brain = new NPCBrain({
    npcId,
    factionId,
    config: createBrainConfig(opts?.brainConfig),
    selectorConfig: createSelectorConfig(),
    jobConfig: createJobConfig(),
    deps,
  });
  brain.setMovementDispatcher(movement);
  brain.setLastPosition(opts?.position ?? { x: 100, y: 100 });
  brain.setRank(opts?.rank ?? 3);
  return brain;
}

/** Place an NPC into a terrain by running one brain update + flush. */
export function assignBrainToTerrain(
  brain: NPCBrain,
  terrain: SmartTerrain,
  events: EventBus<ALifeEventPayloads>,
): void {
  brain.update(0, [terrain]);
  events.flush();
}

/** IOfflineCombatConfig from production defaults with optional overrides. */
export function getDefaultCombatConfig(overrides?: Partial<IOfflineCombatConfig>): IOfflineCombatConfig {
  const base = createDefaultSimulationConfig();
  return { ...base.offlineCombat, ...overrides };
}

/** ISurgeConfig with fast timers for integration tests. */
export function getDefaultSurgeConfig(overrides?: Partial<ISurgeConfig>): ISurgeConfig {
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

/** ITerrainStateConfig with fast decay timers for integration tests. */
export function getDefaultTerrainStateConfig(
  overrides?: Partial<ITerrainStateConfig>,
): ITerrainStateConfig {
  return {
    combatDecayMs: 500,
    alertDecayMs: 500,
    ...overrides,
  };
}
