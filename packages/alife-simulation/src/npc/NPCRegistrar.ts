/**
 * Stateless factory for NPC lifecycle management.
 *
 * Handles brain creation (Human vs Monster), wiring to shared subsystems
 * (movement, squad), and map bookkeeping (npcs, brains). The registrar
 * does not own state — it mutates the maps passed to each method.
 *
 * Source: extracted from game-side ALifeSimulator registerNPC/unregisterNPC.
 */

import type { SmartTerrain, Vec2 } from '@alife-sdk/core';
import type { IBrainConfig, ITerrainSelectorConfig, IJobScoringConfig } from '../types/ISimulationConfig';
import type { INPCRecord, INPCBehaviorConfig } from '../types/INPCRecord';
import { NPCBrain } from '../brain/NPCBrain';
import type { IBrainDeps } from '../brain/NPCBrain';
import { HumanBrain, createDefaultHumanBrainConfig } from '../brain/HumanBrain';
import type { IEquipmentPreference, IHumanBrainConfig } from '../brain/HumanBrain';
import { MonsterBrain, createDefaultMonsterBrainConfig } from '../brain/MonsterBrain';
import type { IMonsterBrainConfig } from '../brain/MonsterBrain';
import { Schedule } from './Schedule';
import type { IWaypoint } from './Schedule';
import type { IMovementSimulator } from '../movement/IMovementSimulator';
import type { SquadManager } from '../squad/SquadManager';
import type { NPCRelationRegistry } from './NPCRelationRegistry';
import type { StoryRegistry } from './StoryRegistry';

// ---------------------------------------------------------------------------
// Registration options
// ---------------------------------------------------------------------------

/** Options for human NPC registration. */
export interface IHumanRegistrationOptions {
  readonly type: 'human';
  readonly equipmentPrefs?: IEquipmentPreference;
  readonly humanBrainConfig?: IHumanBrainConfig;
  readonly initialMoney?: number;
  readonly scheduleWaypoints?: readonly IWaypoint[];
  readonly allowedTerrainTags?: ReadonlySet<string>;
}

/** Options for monster NPC registration. */
export interface IMonsterRegistrationOptions {
  readonly type: 'monster';
  readonly monsterBrainConfig?: IMonsterBrainConfig;
  readonly lairTerrainId?: string;
  readonly allowedTerrainTags?: ReadonlySet<string>;
}

export type INPCRegistrationOptions = IHumanRegistrationOptions | IMonsterRegistrationOptions;

/** Result of a successful NPC registration. */
export interface INPCRegistration {
  readonly record: INPCRecord;
  readonly brain: NPCBrain;
}

// ---------------------------------------------------------------------------
// Params objects
// ---------------------------------------------------------------------------

/** Constructor params for NPCRegistrar. */
export interface INPCRegistrarParams {
  readonly brainConfig: IBrainConfig;
  readonly selectorConfig: ITerrainSelectorConfig;
  readonly jobConfig: IJobScoringConfig;
  readonly deps: IBrainDeps;
  readonly movement: IMovementSimulator;
  readonly squadManager: SquadManager;
  readonly relationRegistry: NPCRelationRegistry;
  readonly storyRegistry: StoryRegistry;
}

/** Data for registering a new NPC. */
export interface INPCRegistrationData {
  readonly entityId: string;
  readonly factionId: string;
  readonly position: Vec2;
  readonly rank: number;
  readonly combatPower: number;
  readonly currentHp: number;
  readonly behaviorConfig: INPCBehaviorConfig;
  readonly options?: INPCRegistrationOptions;
}

// ---------------------------------------------------------------------------
// NPCRegistrar
// ---------------------------------------------------------------------------

export class NPCRegistrar {
  private readonly brainConfig: IBrainConfig;
  private readonly selectorConfig: ITerrainSelectorConfig;
  private readonly jobConfig: IJobScoringConfig;
  private readonly deps: IBrainDeps;
  private readonly movement: IMovementSimulator;
  private readonly squadManager: SquadManager;
  private readonly relationRegistry: NPCRelationRegistry;
  private readonly storyRegistry: StoryRegistry;

  constructor(params: INPCRegistrarParams) {
    this.brainConfig = params.brainConfig;
    this.selectorConfig = params.selectorConfig;
    this.jobConfig = params.jobConfig;
    this.deps = params.deps;
    this.movement = params.movement;
    this.squadManager = params.squadManager;
    this.relationRegistry = params.relationRegistry;
    this.storyRegistry = params.storyRegistry;
  }

  // -------------------------------------------------------------------------
  // Register
  // -------------------------------------------------------------------------

  /**
   * Create an NPC brain, wire it to shared subsystems, and add to maps.
   *
   * @param data     - NPC identity, position, stats, and optional type-specific options.
   * @param terrains - Available terrains for initial assignment.
   * @param npcs     - NPC record map (mutated: new record added).
   * @param brains   - Brain map (mutated: new brain added).
   */
  registerNPC(
    data: INPCRegistrationData,
    terrains: readonly SmartTerrain[],
    npcs: Map<string, INPCRecord>,
    brains: Map<string, NPCBrain>,
  ): INPCRegistration {
    const { entityId, factionId, position, rank, combatPower, currentHp, behaviorConfig, options } = data;

    if (npcs.has(entityId)) {
      throw new Error(
        `[NPCRegistrar.registerNPC] NPC "${entityId}" already registered. Call unregisterNPC() first.`,
      );
    }

    const brain = this.createBrain(entityId, factionId, options);

    brain.setMovementDispatcher(this.movement);
    brain.setLastPosition(position);
    brain.setRank(rank);

    if (options?.allowedTerrainTags) {
      brain.setAllowedTerrainTags(options.allowedTerrainTags);
    }

    if (options?.type === 'human' && options.scheduleWaypoints && options.scheduleWaypoints.length > 0) {
      brain.setSchedule(new Schedule([...options.scheduleWaypoints]));
    }

    const record: INPCRecord = {
      entityId,
      factionId,
      combatPower,
      currentHp,
      rank,
      behaviorConfig,
      lastPosition: position,
      isOnline: false,
    };

    npcs.set(entityId, record);
    brains.set(entityId, brain);

    this.squadManager.autoAssign(entityId, factionId);

    brain.forceReevaluate();
    if (terrains.length > 0) {
      brain.update(0, terrains);
      this.deps.events.flush();
    }

    return { record, brain };
  }

  // -------------------------------------------------------------------------
  // Unregister
  // -------------------------------------------------------------------------

  /**
   * Remove an NPC from all subsystems and maps.
   *
   * @param npcId  - Entity to remove.
   * @param npcs   - NPC record map (mutated: record removed).
   * @param brains - Brain map (mutated: brain removed).
   */
  unregisterNPC(
    npcId: string,
    npcs: Map<string, INPCRecord>,
    brains: Map<string, NPCBrain>,
  ): void {
    const brain = brains.get(npcId);
    if (brain) {
      brain.releaseFromTerrain();
    }

    this.squadManager.removeFromSquad(npcId);
    this.relationRegistry.removeNPC(npcId);
    this.storyRegistry.removeByNpcId(npcId);

    brains.delete(npcId);
    npcs.delete(npcId);
  }

  // -------------------------------------------------------------------------
  // Brain rebuild (post-restore)
  // -------------------------------------------------------------------------

  /**
   * Create a fresh brain for an already-restored NPC record.
   *
   * Used after persistence.load(): NPC records are in the npcs map but the
   * brains map was cleared. This method instantiates the brain and wires it
   * to shared subsystems without touching squads, relations, or the story
   * registry — so the state restored by SimulationPlugin.restore() remains
   * intact.
   *
   * @throws if the NPC record is not found in the npcs map.
   */
  rebuildBrain(
    npcId: string,
    npcs: Map<string, INPCRecord>,
    terrains: readonly SmartTerrain[],
    brains: Map<string, NPCBrain>,
    options?: INPCRegistrationOptions,
  ): NPCBrain {
    const record = npcs.get(npcId);
    if (!record) {
      throw new Error(
        `[NPCRegistrar.rebuildBrain] NPC "${npcId}" not found in npcs map. ` +
        `Call persistence.load() before rebuildBrain().`,
      );
    }

    const brain = this.createBrain(npcId, record.factionId, options);

    brain.setMovementDispatcher(this.movement);
    brain.setLastPosition(record.lastPosition);
    brain.setRank(record.rank);

    if (options?.allowedTerrainTags) {
      brain.setAllowedTerrainTags(options.allowedTerrainTags);
    }

    if (options?.type === 'human' && options.scheduleWaypoints && options.scheduleWaypoints.length > 0) {
      brain.setSchedule(new Schedule([...options.scheduleWaypoints]));
    }

    brains.set(npcId, brain);

    brain.forceReevaluate();
    if (terrains.length > 0) {
      brain.update(0, terrains);
      this.deps.events.flush();
    }

    return brain;
  }

  // -------------------------------------------------------------------------
  // Brain factory (private)
  // -------------------------------------------------------------------------

  private createBrain(
    npcId: string,
    factionId: string,
    options?: INPCRegistrationOptions,
  ): NPCBrain {
    const base = {
      npcId,
      factionId,
      config: this.brainConfig,
      selectorConfig: this.selectorConfig,
      jobConfig: this.jobConfig,
      deps: this.deps,
    };

    if (options?.type === 'monster') {
      return new MonsterBrain({
        ...base,
        monsterConfig: options.monsterBrainConfig ?? createDefaultMonsterBrainConfig(),
        lairTerrainId: options.lairTerrainId,
      });
    }

    if (options?.type === 'human') {
      return new HumanBrain({
        ...base,
        humanConfig: options.humanBrainConfig ?? createDefaultHumanBrainConfig(),
        equipment: options.equipmentPrefs ?? {
          preferredWeaponType: 'rifle',
          preferredArmor: 'medium',
          aggressiveness: 0.5,
          cautiousness: 0.5,
        },
        initialMoney: options.initialMoney ?? 0,
      });
    }

    return new NPCBrain(base);
  }
}
