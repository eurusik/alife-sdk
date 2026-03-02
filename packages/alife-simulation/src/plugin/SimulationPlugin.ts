/**
 * SimulationPlugin — IALifePlugin that orchestrates the full offline A-Life
 * tick pipeline inside the SDK kernel.
 *
 * Responsibilities:
 *   - Owns all state maps (npcs, brains, terrains, factions).
 *   - Creates and wires subsystems (movement, squad, combat, surge, relations, story).
 *   - Runs a 7-step tick pipeline per tick interval.
 *   - Delegates NPC registration to NPCRegistrar.
 *   - Serialize/restore for full save-load round-trips.
 *
 * Source: extracted from game-side ALifeSimulator.ts, cleaned of Phaser deps.
 *
 * ## Design decisions
 *
 * **OnlineOfflineManager is NOT part of this SDK.** Online/offline switching
 * depends on camera position and rendering — concepts that belong to the host
 * engine (Phaser, Pixi, etc.). The host sets `record.isOnline` via
 * {@link setNPCOnline} and this plugin only ticks offline brains.
 *
 * **SpawnRegistry.update() is NOT called in the tick pipeline.** Spawn
 * lifecycle (cooldowns, population caps) is driven externally by SpawnPlugin
 * or the host. This plugin only consumes spawn data through SurgeManager
 * for post-surge mass respawn.
 *
 * **restore() does NOT recreate brains.** Brain instances carry runtime state
 * (terrain reference, movement dispatcher) that cannot be serialized. After
 * calling `restore()`, the caller MUST call {@link rebuildBrain} for every NPC
 * to restore brain instances. Unlike re-registering, {@link rebuildBrain} does
 * not touch squads, relations, or the story registry — keeping the restored
 * state intact.
 *
 * **Morale is owned by the brain, not by NPC records.** The brain is the
 * single source of truth for morale during offline simulation. When an NPC
 * transitions to online, the host should read `brain.morale` and sync it
 * to its own component system.
 */

import type {
  ALifeKernel,
  IALifePlugin,
  LevelGraph,
  PortToken,
  SmartTerrain,
  IRandom,
  EventBus,
  ALifeEventPayloads,
  Clock,
} from '@alife-sdk/core';
import {
  Faction,
  ALifeEvents,
  SpawnRegistry,
  PluginNames,
  Plugins,
  Ports,
} from '@alife-sdk/core';
import type { Vec2 } from '@alife-sdk/core';

import type { ISimulationConfig } from '../types/ISimulationConfig';
import { createDefaultSimulationConfig } from '../types/ISimulationConfig';
import type { INPCRecord, INPCBehaviorConfig } from '../types/INPCRecord';
import type { ISimulationBridge } from '../ports/ISimulationBridge';
import { SimulationPorts } from '../ports/SimulationPorts';
import { NPCBrain } from '../brain/NPCBrain';
import { MovementSimulator } from '../movement/MovementSimulator';
import { GraphMovementSimulator } from '../movement/GraphMovementSimulator';
import type { IMovementSimulator } from '../movement/IMovementSimulator';
import { SquadManager } from '../squad/SquadManager';
import { createDefaultSquadConfig } from '../squad/Squad';
import { OfflineCombatResolver } from '../combat/OfflineCombatResolver';
import { SurgeManager } from '../surge/SurgeManager';
import type { ISurgeNPCRecord, ISurgeManagerState } from '../surge/SurgeManager';
import { SurgePhase } from '../surge/SurgePhase';
import { NPCRelationRegistry, createDefaultRelationConfig } from '../npc/NPCRelationRegistry';
import { StoryRegistry } from '../npc/StoryRegistry';
import { TerrainStateManager, TerrainState } from '../terrain/TerrainStateManager';
import type { ITerrainStateSnapshot } from '../terrain/TerrainStateManager';
import { NPCRegistrar } from '../npc/NPCRegistrar';
import type { INPCRegistration, INPCRegistrationData, INPCRegistrationOptions } from '../npc/NPCRegistrar';
import type { ISquadManagerState } from '../squad/SquadManager';
import type { IGoodwillEntry } from '../npc/NPCRelationRegistry';
import type { IStoryRegistryEntry } from '../npc/StoryRegistry';
import type { IFactionState } from '@alife-sdk/core';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ISimulationPluginConfig {
  /** Interval between tick pipeline executions (ms). */
  readonly tickIntervalMs: number;
  /** Max offline brains updated per tick (round-robin budget). */
  readonly maxBrainUpdatesPerTick: number;
  /** Morale delta per tick toward baseline. */
  readonly moraleRestoreRate: number;
  /** Morale baseline all NPCs restore toward. */
  readonly moraleBaseline: number;
  /** Run redundancy cleanup every N ticks. */
  readonly redundancyCleanupInterval: number;
  /** Morale panic evaluation interval (ms). */
  readonly moraleEvalIntervalMs: number;
  /** Full simulation sub-configs. */
  readonly simulation: ISimulationConfig;
  /**
   * Optional LevelGraph for graph-based NPC movement.
   * When provided, GraphMovementSimulator is used instead of MovementSimulator.
   */
  readonly levelGraph?: LevelGraph;
}

/** Default production-tuned plugin config. */
export function createDefaultPluginConfig(
  overrides?: Partial<Omit<ISimulationPluginConfig, 'simulation'>> & {
    simulation?: Parameters<typeof createDefaultSimulationConfig>[0];
  },
): ISimulationPluginConfig {
  return {
    tickIntervalMs: overrides?.tickIntervalMs ?? 5_000,
    maxBrainUpdatesPerTick: overrides?.maxBrainUpdatesPerTick ?? 20,
    moraleRestoreRate: overrides?.moraleRestoreRate ?? 0.02,
    moraleBaseline: overrides?.moraleBaseline ?? 0.5,
    redundancyCleanupInterval: overrides?.redundancyCleanupInterval ?? 3,
    moraleEvalIntervalMs: overrides?.moraleEvalIntervalMs ?? 2_000,
    simulation: createDefaultSimulationConfig(overrides?.simulation),
    levelGraph: overrides?.levelGraph,
  };
}

// ---------------------------------------------------------------------------
// Serialized state
// ---------------------------------------------------------------------------

export interface ISimulationPluginState {
  readonly npcs: readonly ISerializedNPC[];
  readonly tickCount: number;
  readonly brainCursor: number;
  readonly combatCursor: number;
  readonly squads: ISquadManagerState;
  readonly relations: readonly IGoodwillEntry[];
  readonly storyEntries: readonly IStoryRegistryEntry[];
  readonly terrainStates: readonly ISerializedTerrainState[];
  /** Optional — absent in saves from before surge serialization was added. */
  readonly surge?: ISurgeManagerState;
  /** Optional — absent in saves from before faction goodwill serialization was added. */
  readonly factionGoodwill?: readonly ISerializedFactionGoodwill[];
}

interface ISerializedFactionGoodwill {
  readonly factionId: string;
  readonly state: IFactionState;
}

interface ISerializedNPC {
  readonly entityId: string;
  readonly factionId: string;
  readonly combatPower: number;
  readonly currentHp: number;
  readonly rank: number;
  readonly behaviorConfig: INPCBehaviorConfig;
  readonly lastPosition: Vec2;
  readonly isOnline: boolean;
}

interface ISerializedTerrainState {
  readonly terrainId: string;
  readonly snapshot: ITerrainStateSnapshot;
}

// ---------------------------------------------------------------------------
// Reusable empty collections (avoid per-frame allocations)
// ---------------------------------------------------------------------------

const EMPTY_SURGE_MAP: ReadonlyMap<string, ISurgeNPCRecord> = new Map();
const EMPTY_TERRAIN_LIST: readonly SmartTerrain[] = [];

// ---------------------------------------------------------------------------
// SimulationPlugin
// ---------------------------------------------------------------------------

export class SimulationPlugin implements IALifePlugin {
  readonly name = 'simulation';
  readonly dependencies = [PluginNames.FACTIONS] as const;
  readonly optionalDependencies = [PluginNames.SPAWN] as const;
  readonly requiredPorts: readonly PortToken<unknown>[] = [
    SimulationPorts.SimulationBridge,
  ];

  // -- Config ---------------------------------------------------------------

  private readonly pluginConfig: ISimulationPluginConfig;

  // -- Kernel reference -----------------------------------------------------

  private kernel!: ALifeKernel;
  private events!: EventBus<ALifeEventPayloads>;
  private clock!: Clock;

  // -- State maps -----------------------------------------------------------

  readonly npcs = new Map<string, INPCRecord>();
  readonly brains = new Map<string, NPCBrain>();
  private readonly terrains = new Map<string, SmartTerrain>();
  private terrainsListCache: SmartTerrain[] = [];
  private factions = new Map<string, Faction>();
  private terrainStates = new Map<string, TerrainStateManager>();

  // -- Subsystems -----------------------------------------------------------

  private bridge!: ISimulationBridge;
  private random!: IRandom;
  private movement!: IMovementSimulator;
  private squadManager!: SquadManager;
  private combatResolver!: OfflineCombatResolver;
  private surgeManager!: SurgeManager;
  private relationRegistry!: NPCRelationRegistry;
  private storyRegistry!: StoryRegistry;
  private registrar!: NPCRegistrar;

  // -- Tick state -----------------------------------------------------------

  private tickTimer = 0;
  private tickCount = 0;
  private combatCursor = 0;
  private brainCursor = 0;
  private moraleEvalAccum = 0;

  // -- Scratch fields (reused to avoid per-tick/per-frame allocations) ------

  private readonly _surgeNPCMapView = new Map<string, ISurgeNPCRecord>();
  private readonly _surgeRecordPool = new Map<string, { entityId: string; currentTerrainId: string | null }>();
  private readonly _terrainStateMapCache = new Map<string, TerrainState>();
  private _terrainStateMapDirty = true;
  private readonly _offlineIds: string[] = [];
  private readonly _terrainFactionsMap = new Map<string, Set<string>>();
  private readonly _presentFactionIds: string[] = [];

  // -------------------------------------------------------------------------
  // Constructor
  // -------------------------------------------------------------------------

  /**
   * Create a SimulationPlugin with optional config overrides.
   *
   * @example
   * ```ts
   * const sim = new SimulationPlugin({
   *   tickIntervalMs: 3_000,
   *   simulation: {
   *     brain: { moraleFleeThreshold: -0.6 },
   *     terrainSelector: { surgeMultiplier: 5.0 },
   *   },
   * });
   * kernel.use(sim);
   * ```
   */
  constructor(config?: Parameters<typeof createDefaultPluginConfig>[0]) {
    this.pluginConfig = createDefaultPluginConfig(config);
  }

  // -------------------------------------------------------------------------
  // Terrain management (before or after init)
  // -------------------------------------------------------------------------

  addTerrain(terrain: SmartTerrain): void {
    this.terrains.set(terrain.id, terrain);
    this.terrainsListCache = [...this.terrains.values()];
    this._terrainStateMapDirty = true;

    // If already initialized, create a terrain state manager immediately.
    if (this.events) {
      const simConfig = this.pluginConfig.simulation;
      this.terrainStates.set(
        terrain.id,
        new TerrainStateManager(terrain.id, simConfig.terrainState, this.events),
      );
    }
  }

  removeTerrain(terrainId: string): void {
    this.terrains.delete(terrainId);
    this.terrainStates.delete(terrainId);
    this.terrainsListCache = [...this.terrains.values()];
    this._terrainStateMapDirty = true;

    for (const brain of this.brains.values()) {
      if (brain.currentTerrainId === terrainId) {
        brain.releaseFromTerrain();
      }
    }
  }

  // -------------------------------------------------------------------------
  // IALifePlugin — lifecycle
  // -------------------------------------------------------------------------

  install(kernel: ALifeKernel): void {
    this.kernel = kernel;
  }

  init(): void {
    this.events = this.kernel.events;
    this.clock = this.kernel.clock;

    // Config validation
    const logger = this.kernel.logger;
    const pc = this.pluginConfig;
    if (pc.tickIntervalMs <= 0) logger.warn('simulation', 'tickIntervalMs must be > 0');
    if (pc.maxBrainUpdatesPerTick <= 0) logger.warn('simulation', 'maxBrainUpdatesPerTick must be > 0');
    const oc = pc.simulation.offlineCombat;
    if (oc.victoryBase <= 0) logger.warn('simulation', 'offlineCombat.victoryBase must be > 0');

    this.bridge = this.kernel.portRegistry.require(SimulationPorts.SimulationBridge);
    this.random = this.kernel.portRegistry.tryGet(Ports.Random)
      ?? {
        next: Math.random,
        nextInt: (a: number, b: number) => Math.floor(Math.random() * (b - a + 1)) + a,
        nextFloat: (a: number, b: number) => Math.random() * (b - a) + a,
      };

    // Build faction map from FactionsPlugin registry.
    const factionsPlugin = this.kernel.getPlugin(Plugins.FACTIONS);
    for (const [id, def] of factionsPlugin.factions) {
      this.factions.set(id, new Faction(id, def));
    }

    // Create subsystems.
    const simConfig = this.pluginConfig.simulation;

    this.movement = this.pluginConfig.levelGraph
      ? new GraphMovementSimulator(this.pluginConfig.levelGraph, this.events)
      : new MovementSimulator(this.events);
    this.squadManager = new SquadManager(
      createDefaultSquadConfig({
        moraleAllyDeathPenalty: simConfig.offlineCombat.moraleAllyDeathPenalty,
        moraleKillBonus: simConfig.offlineCombat.moraleKillBonus,
      }),
      this.events,
    );
    this.relationRegistry = new NPCRelationRegistry(createDefaultRelationConfig());
    this.storyRegistry = new StoryRegistry();

    this.combatResolver = new OfflineCombatResolver(
      simConfig.offlineCombat,
      this.bridge,
      this.random,
    );

    // SpawnPlugin is an optional dependency — surge respawns may not be wired.
    const spawnPlugin = this.kernel.hasPlugin(PluginNames.SPAWN)
      ? this.kernel.getPlugin(Plugins.SPAWN)
      : null;
    const spawnRegistry = spawnPlugin?.spawns ?? new SpawnRegistry(30_000);

    this.surgeManager = new SurgeManager({
      config: simConfig.surge,
      events: this.events,
      spawnRegistry,
      bridge: this.bridge,
      random: this.random,
      onSurgeDeath: (npcId) => this.onNPCDeath(npcId, ''),
    });
    this.surgeManager.init();

    this.registrar = new NPCRegistrar({
      brainConfig: simConfig.brain,
      selectorConfig: simConfig.terrainSelector,
      jobConfig: simConfig.jobScoring,
      deps: { clock: this.clock, events: this.events },
      movement: this.movement,
      squadManager: this.squadManager,
      relationRegistry: this.relationRegistry,
      storyRegistry: this.storyRegistry,
    });

    // Build terrain state managers for pre-added terrains.
    for (const terrain of this.terrains.values()) {
      if (!this.terrainStates.has(terrain.id)) {
        this.terrainStates.set(
          terrain.id,
          new TerrainStateManager(terrain.id, simConfig.terrainState, this.events),
        );
      }
    }

    this.terrainsListCache = [...this.terrains.values()];
  }

  update(deltaMs: number): void {
    // Surge runs every frame (not gated by tick).
    const surgePhase = this.surgeManager.getPhase();
    if (surgePhase === SurgePhase.ACTIVE || surgePhase === SurgePhase.AFTERMATH) {
      // ACTIVE uses NPC map + terrains for shelter-based damage ticks.
      // AFTERMATH uses NPC map for morale restoration of survivors.
      this.surgeManager.update(
        deltaMs,
        this.buildSurgeNPCMap(),
        this.terrainsListCache,
      );
    } else {
      // INACTIVE and WARNING only count down timers — no NPC data needed.
      this.surgeManager.update(deltaMs, EMPTY_SURGE_MAP, EMPTY_TERRAIN_LIST);
    }

    // Morale panic evaluation (separate cadence).
    this.moraleEvalAccum += deltaMs;
    if (this.moraleEvalAccum >= this.pluginConfig.moraleEvalIntervalMs) {
      this.moraleEvalAccum -= this.pluginConfig.moraleEvalIntervalMs;
      this.evaluateMoralePanic();
    }

    // Tick gate.
    this.tickTimer += deltaMs;
    if (this.tickTimer >= this.pluginConfig.tickIntervalMs) {
      this.tickTimer -= this.pluginConfig.tickIntervalMs;
      this.tick();
    }
  }

  destroy(): void {
    this.npcs.clear();
    this.brains.clear();
    this.terrains.clear();
    this.factions.clear();
    this.terrainStates.clear();
    this.movement?.clear();
    this._surgeRecordPool.clear();
    this._surgeNPCMapView.clear();
    this._terrainStateMapCache.clear();
    this._terrainFactionsMap.clear();
  }

  // -------------------------------------------------------------------------
  // IALifePlugin — serialization
  // -------------------------------------------------------------------------

  serialize(): Record<string, unknown> {
    const npcList: ISerializedNPC[] = [];
    for (const [, record] of this.npcs) {
      npcList.push({
        entityId: record.entityId,
        factionId: record.factionId,
        combatPower: record.combatPower,
        currentHp: record.currentHp,
        rank: record.rank,
        behaviorConfig: record.behaviorConfig,
        lastPosition: record.lastPosition,
        isOnline: record.isOnline,
      });
    }

    const terrainStateList: ISerializedTerrainState[] = [];
    for (const [terrainId, tsm] of this.terrainStates) {
      terrainStateList.push({ terrainId, snapshot: tsm.serialize() });
    }

    const factionGoodwillList: ISerializedFactionGoodwill[] = [];
    for (const [factionId, faction] of this.factions) {
      factionGoodwillList.push({ factionId, state: faction.serialize() });
    }

    const state: ISimulationPluginState = {
      npcs: npcList,
      tickCount: this.tickCount,
      brainCursor: this.brainCursor,
      combatCursor: this.combatCursor,
      squads: this.squadManager.serialize(),
      relations: this.relationRegistry.serialize(),
      storyEntries: this.storyRegistry.serialize(),
      terrainStates: terrainStateList,
      surge: this.surgeManager.serialize(),
      factionGoodwill: factionGoodwillList,
    };

    return state as unknown as Record<string, unknown>;
  }

  /**
   * Restore plugin state from a serialized snapshot.
   *
   * NPC records are restored but brains are NOT — the caller MUST
   * re-register all NPCs via registerNPC() before calling kernel.update().
   */
  restore(state: Record<string, unknown>): void {
    if (!state || typeof state !== 'object') {
      throw new Error('SimulationPlugin.restore: invalid state — expected object');
    }
    const s = state as unknown as ISimulationPluginState;
    if (!Array.isArray(s.npcs) || !Array.isArray(s.relations)) {
      throw new Error(
        'SimulationPlugin.restore: invalid state shape — missing required arrays (npcs, relations)',
      );
    }
    if (!s.squads || typeof s.squads !== 'object' || !Array.isArray((s.squads as ISquadManagerState).squads)) {
      throw new Error(
        'SimulationPlugin.restore: invalid state shape — missing required object (squads)',
      );
    }
    if (!Array.isArray(s.storyEntries) || !Array.isArray(s.terrainStates)) {
      throw new Error(
        'SimulationPlugin.restore: invalid state shape — missing required arrays (storyEntries, terrainStates)',
      );
    }

    // Restore NPC records (brains are NOT serialized — caller re-registers).
    this.npcs.clear();
    this.brains.clear();
    for (const npc of s.npcs) {
      this.npcs.set(npc.entityId, { ...npc });
    }

    this.tickCount = s.tickCount;
    this.brainCursor = s.brainCursor;
    this.combatCursor = s.combatCursor;
    this.tickTimer = 0;
    this.moraleEvalAccum = 0;

    this.squadManager.restore(s.squads);
    this.relationRegistry.restore(s.relations);
    this.storyRegistry.restore(s.storyEntries);

    // Restore terrain states.
    for (const ts of s.terrainStates) {
      const tsm = this.terrainStates.get(ts.terrainId);
      if (tsm) {
        tsm.restore(ts.snapshot.state, ts.snapshot.lastThreatTimeMs);
      }
    }

    // Restore surge state — optional field for backward compatibility with old saves.
    if (s.surge) {
      this.surgeManager.restore(s.surge);
    }

    // Restore faction goodwill — optional for backward compatibility with old saves.
    if (s.factionGoodwill) {
      for (const entry of s.factionGoodwill) {
        const faction = this.factions.get(entry.factionId);
        if (faction) {
          faction.restore(entry.state);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Public API — NPC lifecycle
  // -------------------------------------------------------------------------

  registerNPC(data: INPCRegistrationData): INPCRegistration {
    return this.registrar.registerNPC(
      data,
      this.terrainsListCache,
      this.npcs,
      this.brains,
    );
  }

  unregisterNPC(npcId: string): void {
    this.registrar.unregisterNPC(npcId, this.npcs, this.brains);
    this._surgeRecordPool.delete(npcId);
  }

  /**
   * Rebuild the brain for a restored NPC without affecting squads, relations,
   * or the story registry.
   *
   * Call this for each NPC after persistence.load() to restore AI behaviour.
   * NPC records (HP, rank, position) are already in place from the load;
   * only the brain instance needs to be recreated.
   *
   * @throws if the NPC record is not in the npcs map.
   */
  rebuildBrain(npcId: string, options?: INPCRegistrationOptions): NPCBrain {
    return this.registrar.rebuildBrain(
      npcId,
      this.npcs,
      this.terrainsListCache,
      this.brains,
      options,
    );
  }

  setNPCOnline(npcId: string, online: boolean): void {
    const record = this.npcs.get(npcId);
    if (record) {
      record.isOnline = online;
    }
  }

  // -------------------------------------------------------------------------
  // Public API — queries
  // -------------------------------------------------------------------------

  getNPCRecord(npcId: string): INPCRecord | undefined {
    return this.npcs.get(npcId);
  }

  getNPCBrain(npcId: string): NPCBrain | null {
    return this.brains.get(npcId) ?? null;
  }

  getAllNPCRecords(): ReadonlyMap<string, INPCRecord> {
    return this.npcs;
  }

  getTerrain(id: string): SmartTerrain | undefined {
    return this.terrains.get(id);
  }

  getAllTerrains(): ReadonlyMap<string, SmartTerrain> {
    return this.terrains;
  }

  // -------------------------------------------------------------------------
  // Public API — subsystem access
  // -------------------------------------------------------------------------

  getSquadManager(): SquadManager { return this.squadManager; }
  getStoryRegistry(): StoryRegistry { return this.storyRegistry; }
  getRelationRegistry(): NPCRelationRegistry { return this.relationRegistry; }
  getMovementSimulator(): IMovementSimulator { return this.movement; }
  getSurgeManager(): SurgeManager { return this.surgeManager; }

  // -------------------------------------------------------------------------
  // Tick pipeline (private)
  // -------------------------------------------------------------------------

  private tick(): void {
    this.tickCount++;
    this._terrainStateMapDirty = true;
    const tickInterval = this.pluginConfig.tickIntervalMs;
    const terrainsList = this.terrainsListCache;

    // Step 1: Relation fight decay + terrain state updates.
    this.relationRegistry.updateFights(tickInterval);
    this.updateTerrainStates(tickInterval);

    // Step 2: Offline brain ticks (round-robin).
    this.tickOfflineBrains(tickInterval, terrainsList);

    // Step 3: Movement simulator.
    this.movement.update(tickInterval);

    // Step 4: Detect factional conflicts.
    this.resolveFactionalConflicts();

    // Step 5: Offline combat (skip during active surge).
    if (this.surgeManager.getPhase() !== SurgePhase.ACTIVE) {
      this.combatCursor = this.combatResolver.resolve(
        this.npcs,
        this.terrains,
        this.factions,
        this.brains,
        this.storyRegistry,
        this.relationRegistry,
        this.combatCursor,
        (deadId, killerId) => this.onNPCDeath(deadId, killerId),
      );
    }

    // Step 6a: Restore morale.
    this.restoreMorale();

    // Step 6b: Decay faction goodwill.
    this.decayFactionGoodwill(tickInterval);

    // Step 6c: Redundancy cleanup (every N ticks).
    if (this.tickCount % this.pluginConfig.redundancyCleanupInterval === 0) {
      this.cleanupRedundantNPCs();
    }

    // Step 7: Emit tick heartbeat.
    this.events.emit(ALifeEvents.TICK, {
      tick: this.tickCount,
      delta: tickInterval,
    });
  }

  private updateTerrainStates(_deltaMs: number): void {
    const gameTimeMs = this.clock.totalGameSeconds * 1000;
    for (const tsm of this.terrainStates.values()) {
      tsm.tickDecay(gameTimeMs);
    }
  }

  private tickOfflineBrains(
    tickInterval: number,
    terrainsList: readonly SmartTerrain[],
  ): void {
    this._offlineIds.length = 0;
    for (const [id, record] of this.npcs) {
      if (record.currentHp > 0 && !record.isOnline) {
        this._offlineIds.push(id);
      }
    }

    const totalOffline = this._offlineIds.length;
    if (totalOffline === 0) return;

    const batchSize = Math.min(totalOffline, this.pluginConfig.maxBrainUpdatesPerTick);

    if (this.brainCursor >= totalOffline) {
      this.brainCursor = 0;
    }

    const terrainStateMap = this.buildTerrainStateMap();
    const surgeIncoming = this.surgeManager.getPhase() !== SurgePhase.INACTIVE;

    for (let i = 0; i < batchSize; i++) {
      const index = (this.brainCursor + i) % totalOffline;
      const npcId = this._offlineIds[index];

      const brain = this.brains.get(npcId);
      if (!brain) continue;

      const record = this.npcs.get(npcId);
      if (record) {
        const movingPos = this.movement.getPosition(npcId);
        brain.setLastPosition(movingPos ?? record.lastPosition);
        brain.setRank(record.rank);
      }

      // Sync squad goal terrain so ISquadGoal.terrainId drives brain terrain selection.
      const squad = this.squadManager.getSquadForNPC(npcId);
      brain.setSquadGoalTerrainId(squad?.currentGoal?.terrainId ?? null);

      brain.setSurgeActive(surgeIncoming);

      brain.update(tickInterval, terrainsList, terrainStateMap);
    }

    this.brainCursor = (this.brainCursor + batchSize) % totalOffline;
  }

  private resolveFactionalConflicts(): void {
    // Build reverse map: terrainId → Set<factionId> from living offline NPCs.
    // Clear each reusable Set (keep instances alive across ticks)
    for (const set of this._terrainFactionsMap.values()) {
      set.clear();
    }

    for (const [npcId, record] of this.npcs) {
      if (record.currentHp <= 0 || record.isOnline) continue;

      const brain = this.brains.get(npcId);
      const terrainId = brain?.currentTerrainId;
      if (!terrainId) continue;

      let factionSet = this._terrainFactionsMap.get(terrainId);
      if (!factionSet) {
        factionSet = new Set();
        this._terrainFactionsMap.set(terrainId, factionSet);
      }
      factionSet.add(record.factionId);
    }

    // Check for hostile pairs in each terrain.
    for (const [terrainId, factionSet] of this._terrainFactionsMap) {
      if (factionSet.size < 2) continue;

      this._presentFactionIds.length = 0;
      for (const id of factionSet) this._presentFactionIds.push(id);
      for (let i = 0; i < this._presentFactionIds.length; i++) {
        for (let j = i + 1; j < this._presentFactionIds.length; j++) {
          const factionA = this.factions.get(this._presentFactionIds[i]);
          const factionB = this.factions.get(this._presentFactionIds[j]);

          if (!factionA || !factionB) continue;

          if (factionA.isHostile(factionB.id) && factionB.isHostile(factionA.id)) {
            this.events.emit(ALifeEvents.FACTION_CONFLICT, {
              factionA: factionA.id,
              factionB: factionB.id,
              zoneId: terrainId,
            });
          }
        }
      }
    }
  }

  private restoreMorale(): void {
    const { moraleBaseline, moraleRestoreRate } = this.pluginConfig;

    for (const [npcId, record] of this.npcs) {
      if (record.currentHp <= 0) continue;

      const brain = this.brains.get(npcId);
      if (!brain) continue;

      const current = brain.morale;
      const diff = moraleBaseline - current;
      if (Math.abs(diff) < 0.001) continue;

      const step = Math.sign(diff) * Math.min(Math.abs(diff), moraleRestoreRate);
      brain.setMorale(current + step);
    }
  }

  private decayFactionGoodwill(tickIntervalMs: number): void {
    const goodwillCfg = this.pluginConfig.simulation.goodwill;
    const gameHoursElapsed =
      (tickIntervalMs * (this.clock.timeFactor ?? 1)) / 3_600_000;
    const decayAmount = goodwillCfg.decayRatePerHour * gameHoursElapsed;

    if (decayAmount <= 0) return;

    for (const faction of this.factions.values()) {
      faction.decayGoodwill(decayAmount);
    }
  }

  private cleanupRedundantNPCs(): void {
    const toRemove: string[] = [];

    for (const [npcId, record] of this.npcs) {
      if (record.currentHp > 0) continue;
      if (this.storyRegistry.isStoryNPC(npcId)) continue;
      toRemove.push(npcId);
    }

    for (const npcId of toRemove) {
      this.unregisterNPC(npcId);
    }
  }

  private evaluateMoralePanic(): void {
    for (const [npcId, record] of this.npcs) {
      if (record.currentHp <= 0) continue;

      const brain = this.brains.get(npcId);
      if (!brain) continue;

      if (brain.morale <= record.behaviorConfig.panicThreshold) {
        const squad = this.squadManager.getSquadForNPC(npcId);
        this.events.emit(ALifeEvents.NPC_PANICKED, {
          npcId,
          squadId: squad?.id ?? null,
        });
      }
    }
  }

  private onNPCDeath(deadId: string, killerId: string): void {
    const record = this.npcs.get(deadId);
    if (!record) return;

    record.currentHp = 0;

    const brain = this.brains.get(deadId);
    if (brain) {
      brain.onDeath(killerId);
    }

    this.squadManager.onNPCDeath(deadId);
    this.relationRegistry.removeNPC(deadId);
    this._surgeRecordPool.delete(deadId);

    if (killerId) {
      this.squadManager.onNPCKill(killerId);
    }
  }

  private buildSurgeNPCMap(): ReadonlyMap<string, ISurgeNPCRecord> {
    this._surgeNPCMapView.clear();
    for (const [id, record] of this.npcs) {
      if (record.currentHp <= 0) continue;
      const brain = this.brains.get(id);
      let entry = this._surgeRecordPool.get(id);
      if (!entry) {
        entry = { entityId: id, currentTerrainId: null };
        this._surgeRecordPool.set(id, entry);
      }
      entry.currentTerrainId = brain?.currentTerrainId ?? null;
      this._surgeNPCMapView.set(id, entry);
    }
    return this._surgeNPCMapView;
  }

  private buildTerrainStateMap(): Map<string, TerrainState> {
    if (!this._terrainStateMapDirty) return this._terrainStateMapCache;
    this._terrainStateMapCache.clear();
    for (const [id, tsm] of this.terrainStates) {
      this._terrainStateMapCache.set(id, tsm.terrainState);
    }
    this._terrainStateMapDirty = false;
    return this._terrainStateMapCache;
  }
}
