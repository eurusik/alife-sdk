/**
 * Offline NPC decision-maker -- the core brain for A-Life simulation.
 *
 * Responsibilities:
 *   - Select the best SmartTerrain for the NPC (surge, morale, squad, tags).
 *   - Pick and cycle through job slots within the current terrain.
 *   - Manage day/night schedule transitions via BrainScheduleManager.
 *   - Evaluate scheme overrides (condition-list resolution).
 *   - Respect combat locks, morale flee thresholds, and surge shelter-seeking.
 *
 * Design:
 *   - Pure simulation logic, zero rendering dependency.
 *   - All configs injected via constructor, no global state.
 *   - Protected hooks for subclass overrides (HumanBrain, MonsterBrain).
 *   - Deterministic given identical inputs and configs.
 */

import type { SmartTerrain, Vec2 } from '@alife-sdk/core';
import { EventBus, ALifeEvents, ZERO } from '@alife-sdk/core';
import type { ALifeEventPayloads } from '@alife-sdk/core';
import type { Clock } from '@alife-sdk/core';
import type { IBrainConfig, ITerrainSelectorConfig, IJobScoringConfig } from '../types/ISimulationConfig';
import type { INPCJobContext } from '../types/INPCRecord';
import type { ISchemeParams, ISchemeConditionConfig } from '../terrain/SchemeResolver';
import type { IJobSlotRuntime } from '../terrain/JobSlotSystem';
import type { TerrainState } from '../terrain/TerrainStateManager';
import type { Schedule } from '../npc/Schedule';
import type { IMovementDispatcher } from './BrainScheduleManager';
import { resolve as resolveScheme } from '../terrain/SchemeResolver';
import { TerrainSelector } from '../terrain/TerrainSelector';
import type { ITerrainQuery } from '../terrain/TerrainSelector';
import { JobSlotSystem } from '../terrain/JobSlotSystem';
import { BrainScheduleManager } from './BrainScheduleManager';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** External dependencies injected into the brain. */
export interface IBrainDeps {
  readonly clock: Clock;
  readonly events: EventBus<ALifeEventPayloads>;
}

/** Params-object for NPCBrain construction. */
export interface INPCBrainParams {
  readonly npcId: string;
  readonly factionId: string;
  readonly config: IBrainConfig;
  readonly selectorConfig: ITerrainSelectorConfig;
  readonly jobConfig: IJobScoringConfig;
  readonly deps: IBrainDeps;
}

/** Active task assigned to the NPC from a terrain's job slot. */
export interface IBrainTask {
  readonly terrainId: string;
  readonly slotType: string;
  readonly targetPosition: Vec2;
  readonly scheme: string;
  readonly params: ISchemeParams | null;
  remainingMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default task duration when a job slot has no explicit timing (ms). */
export const DEFAULT_TASK_DURATION_MS = 60_000;

/** Default scheme name applied when no state override is active. */
export const DEFAULT_SCHEME = 'idle';

// ---------------------------------------------------------------------------
// NPCBrain
// ---------------------------------------------------------------------------

export class NPCBrain {
  // -----------------------------------------------------------------------
  // Identity (readonly after construction)
  // -----------------------------------------------------------------------

  private readonly _npcId: string;
  private readonly _factionId: string;
  private readonly _config: IBrainConfig;
  private readonly _selectorConfig: ITerrainSelectorConfig;
  private readonly _jobConfig: IJobScoringConfig;
  private readonly _deps: IBrainDeps;
  private readonly _scheduleManager: BrainScheduleManager;

  // -----------------------------------------------------------------------
  // Mutable state
  // -----------------------------------------------------------------------

  private _currentTask: IBrainTask | null = null;
  private _currentTerrainId: string | null = null;
  private _currentTerrain: SmartTerrain | null = null;
  private _currentSlots: IJobSlotRuntime[] = [];

  private _morale = 0;
  private _rank = 1;
  private _surgeActive = false;
  private _squadLeaderTerrainId: string | null = null;
  private _squadGoalTerrainId: string | null = null;
  private _lastPosition: Vec2 = ZERO;
  private _allowedTerrainTags: ReadonlySet<string> | null = null;
  private _combatLockRemainingMs = 0;
  private _dispatcher: IMovementDispatcher | null = null;

  private _reEvaluateTimerMs = 0;
  private _schemeTimerMs = 0;
  private _schemeConditions: readonly ISchemeConditionConfig[] | null = null;
  private _dead = false;

  /** Scratch terrain query object — reused across buildTerrainQuery() calls to avoid per-tick allocations. */
  private readonly _terrainQuery: {
    terrains: readonly SmartTerrain[];
    npcFaction: string;
    npcPos: Vec2;
    npcRank: number;
    morale: number;
    surgeActive: boolean;
    leaderTerrainId: string | null;
    allowedTags: ReadonlySet<string> | null;
    config: ITerrainSelectorConfig;
    occupantId: string;
  };

  // -----------------------------------------------------------------------
  // Construction
  // -----------------------------------------------------------------------

  constructor(params: INPCBrainParams) {
    this._npcId = params.npcId;
    this._factionId = params.factionId;
    this._config = params.config;
    this._selectorConfig = params.selectorConfig;
    this._jobConfig = params.jobConfig;
    this._deps = params.deps;
    this._scheduleManager = new BrainScheduleManager();
    this._reEvaluateTimerMs = params.config.reEvaluateIntervalMs;

    this._terrainQuery = {
      terrains: [],
      npcFaction: params.factionId,
      npcPos: ZERO,
      npcRank: params.config.dangerTolerance, // placeholder, overwritten each call
      morale: 0,
      surgeActive: false,
      leaderTerrainId: null,
      allowedTags: null,
      config: params.selectorConfig,
      occupantId: params.npcId,
    };
  }

  // -----------------------------------------------------------------------
  // Public getters
  // -----------------------------------------------------------------------

  get npcId(): string { return this._npcId; }
  get factionId(): string { return this._factionId; }
  get morale(): number { return this._morale; }
  get rank(): number { return this._rank; }
  get lastPosition(): Vec2 { return this._lastPosition; }
  get isCombatLocked(): boolean { return this._combatLockRemainingMs > 0; }
  get currentTask(): IBrainTask | null { return this._currentTask; }
  get currentTerrainId(): string | null { return this._currentTerrainId; }

  /** Danger tolerance from the brain config (for external queries). */
  get dangerTolerance(): number { return this._config.dangerTolerance; }

  // -----------------------------------------------------------------------
  // Protected getters (for subclass overrides: HumanBrain, MonsterBrain)
  // -----------------------------------------------------------------------

  protected get surgeActive(): boolean { return this._surgeActive; }
  protected get allowedTerrainTags(): ReadonlySet<string> | null { return this._allowedTerrainTags; }
  protected get squadLeaderTerrainId(): string | null { return this._squadLeaderTerrainId; }
  protected get selectorConfig(): ITerrainSelectorConfig { return this._selectorConfig; }
  protected get currentTerrain(): SmartTerrain | null { return this._currentTerrain; }

  // -----------------------------------------------------------------------
  // Setters
  // -----------------------------------------------------------------------

  setMorale(value: number): void { this._morale = value; }
  setRank(value: number): void { this._rank = value; }
  setSurgeActive(value: boolean): void { this._surgeActive = value; }
  setSquadLeaderTerrainId(terrainId: string | null): void { this._squadLeaderTerrainId = terrainId; }
  /**
   * Set the terrain bias from the squad's active goal.
   * Overrides squad leader terrain when non-null.
   */
  setSquadGoalTerrainId(terrainId: string | null): void { this._squadGoalTerrainId = terrainId; }
  get squadGoalTerrainId(): string | null { return this._squadGoalTerrainId; }
  setLastPosition(pos: Vec2): void { this._lastPosition = pos; }
  setAllowedTerrainTags(tags: ReadonlySet<string> | null): void { this._allowedTerrainTags = tags; }
  /**
   * Lock brain updates for the given duration.
   * Overlapping locks extend to the longest remaining time.
   * Pass 0 to unlock immediately.
   */
  setCombatLock(durationMs: number): void {
    this._combatLockRemainingMs = Math.max(this._combatLockRemainingMs, durationMs);
  }
  setMovementDispatcher(d: IMovementDispatcher): void { this._dispatcher = d; }

  /** Set scheme conditions for behavior resolution. */
  setConditions(conditions: readonly ISchemeConditionConfig[]): void {
    this._schemeConditions = conditions;
  }

  // -----------------------------------------------------------------------
  // Schedule delegation
  // -----------------------------------------------------------------------

  setSchedule(schedule: Schedule): void {
    this._scheduleManager.setSchedule(schedule);
  }

  hasSchedule(): boolean {
    return this._scheduleManager.hasSchedule();
  }

  // -----------------------------------------------------------------------
  // Core update loop
  // -----------------------------------------------------------------------

  /**
   * Advance the brain by `deltaMs` milliseconds of game time.
   *
   * Update order:
   *   1. Skip if combat-locked or dead.
   *   2. Check day/night mode transitions.
   *   3. If night + schedule -> delegate to schedule manager.
   *   4. Check condition-list for scheme overrides.
   *   5. Count down re-evaluation timer -> search for better terrain.
   *   6. If surge + no shelter -> flee to shelter.
   *   7. If low morale + high danger -> flee.
   *   8. If no terrain -> select best, dispatch movement.
   *   9. If task active -> countdown remaining time.
   *  10. If task expired -> pick new job from current terrain.
   *  11. If no task available -> re-evaluate terrain.
   *
   * @example
   * ```ts
   * // Called each simulation tick (typically every 5 000 ms):
   * brain.update(deltaMs, allTerrains, terrainStateMap);
   * const task = brain.currentTask; // current job slot assignment
   * ```
   */
  update(
    deltaMs: number,
    terrains: readonly SmartTerrain[],
    terrainStates?: Map<string, TerrainState>,
  ): void {
    if (this._dead) return;

    if (this._combatLockRemainingMs > 0) {
      this._combatLockRemainingMs = Math.max(0, this._combatLockRemainingMs - deltaMs);
      if (this._combatLockRemainingMs > 0) return;
    }

    const modeResult = this._scheduleManager.checkModeTransition(this._deps.clock);

    if (this.shouldDelegateToSchedule(modeResult.isNight)) {
      this.delegateToNightSchedule(deltaMs);
      return;
    }

    this.tickSchemeEvaluation(deltaMs, modeResult.isNight, terrainStates);
    this.tickReEvaluation(deltaMs, terrains, terrainStates);
    this.tickSurgeFlee(terrains);
    this.tickMoraleFlee();
    this.tickTerrainAssignment(terrains, terrainStates);
    this.tickTask(deltaMs, modeResult.isNight, terrainStates);
  }

  // -----------------------------------------------------------------------
  // Public actions
  // -----------------------------------------------------------------------

  /** Force an immediate terrain re-evaluation on the next update. */
  forceReevaluate(): void {
    this._reEvaluateTimerMs = 0;
  }

  /** Release NPC from current terrain and clear task. */
  releaseFromTerrain(): void {
    this.clearCurrentTask();
    this._currentSlots = [];

    if (this._currentTerrainId !== null) {
      this._currentTerrain?.removeOccupant(this._npcId);

      this._deps.events.emit(ALifeEvents.NPC_RELEASED, {
        npcId: this._npcId,
        terrainId: this._currentTerrainId,
      });
    }

    this._currentTerrainId = null;
    this._currentTerrain = null;
  }

  /** Handle NPC death: cancel movement, release terrain, emit event. */
  onDeath(killedBy = ''): void {
    if (this._dead) return;
    this._dead = true;

    const lastTerrainId = this._currentTerrainId ?? '';

    this.cancelMovement();
    this.releaseFromTerrain();

    this._deps.events.emit(ALifeEvents.NPC_DIED, {
      npcId: this._npcId,
      killedBy,
      zoneId: lastTerrainId,
    });
  }

  // -----------------------------------------------------------------------
  // Protected hooks (for subclass overrides)
  // -----------------------------------------------------------------------

  /** Build a job context snapshot for the current NPC state. */
  protected buildJobContext(): INPCJobContext {
    return {
      npcId: this._npcId,
      factionId: this._factionId,
      rank: this._rank,
      position: this._lastPosition,
    };
  }

  /** Build a terrain query from the current brain state. Override in subclasses. */
  protected buildTerrainQuery(terrains: readonly SmartTerrain[]): ITerrainQuery {
    const q = this._terrainQuery;
    q.terrains = terrains;
    q.npcFaction = this._factionId;
    q.npcPos = this._lastPosition;
    q.npcRank = this._rank;
    q.morale = this._morale;
    q.surgeActive = this._surgeActive;
    q.leaderTerrainId = this._squadGoalTerrainId ?? this._squadLeaderTerrainId;
    q.allowedTags = this._allowedTerrainTags;
    q.config = this._selectorConfig;
    q.occupantId = this._npcId;
    return q;
  }

  /** Select the best terrain. Override in subclasses for custom scoring. */
  protected selectBestTerrain(
    terrains: readonly SmartTerrain[],
    _terrainStates?: Map<string, TerrainState>,
  ): SmartTerrain | null {
    return TerrainSelector.selectBest(this.buildTerrainQuery(terrains));
  }

  // -----------------------------------------------------------------------
  // Update sub-steps (private)
  // -----------------------------------------------------------------------

  /** Check whether night schedule should take over. */
  private shouldDelegateToSchedule(isNight: boolean): boolean {
    return isNight && this._scheduleManager.hasSchedule();
  }

  /** Run the night schedule manager for this tick. */
  private delegateToNightSchedule(deltaMs: number): void {
    if (this._dispatcher === null) return;

    this._scheduleManager.updateNightSchedule(
      deltaMs,
      this._npcId,
      this._currentTerrainId,
      this._lastPosition,
      this._dispatcher,
    );
  }

  /** Evaluate scheme conditions and apply overrides to the task. */
  private tickSchemeEvaluation(
    deltaMs: number,
    isNight: boolean,
    terrainStates?: Map<string, TerrainState>,
  ): void {
    if (this._schemeConditions === null) return;

    this._schemeTimerMs += deltaMs;
    if (this._schemeTimerMs < this._config.schemeCheckIntervalMs) return;
    this._schemeTimerMs = 0;

    const terrainState = this.getTerrainState(terrainStates);
    const override = resolveScheme(this._schemeConditions, isNight, terrainState);

    if (override !== null) {
      this.applySchemeOverride(override.scheme, override.params);
    }
  }

  /** Count down re-evaluation timer and search for a better terrain. */
  private tickReEvaluation(
    deltaMs: number,
    terrains: readonly SmartTerrain[],
    terrainStates?: Map<string, TerrainState>,
  ): void {
    this._reEvaluateTimerMs -= deltaMs;
    if (this._reEvaluateTimerMs > 0) return;

    this._reEvaluateTimerMs = this._config.reEvaluateIntervalMs;
    this.evaluateTerrainSwitch(terrains, terrainStates);
  }

  /** If surge is active and current terrain is not a shelter, flee. */
  private tickSurgeFlee(terrains: readonly SmartTerrain[]): void {
    if (!this._surgeActive) return;

    const needsFlee = this._currentTerrainId === null || !this.isCurrentTerrainShelter();
    if (!needsFlee) return;

    this.fleeToShelter(terrains);
  }

  /** If morale is below threshold and danger is too high, force re-evaluation. */
  private tickMoraleFlee(): void {
    if (this._morale >= this._config.moraleFleeThreshold) return;

    const currentDanger = this.getCurrentTerrainDanger();
    if (currentDanger <= 0) return;

    // Force re-evaluation on next tickReEvaluation pass (throttled).
    this._reEvaluateTimerMs = 0;
  }

  /** If no terrain is assigned, find one and dispatch movement. */
  private tickTerrainAssignment(
    terrains: readonly SmartTerrain[],
    terrainStates?: Map<string, TerrainState>,
  ): void {
    if (this._currentTerrainId !== null) return;

    const terrain = this.selectBestTerrain(terrains, terrainStates);
    if (terrain === null) return;

    this.assignToTerrain(terrain);
  }

  /** Tick the active task timer and renew/re-evaluate when expired. */
  private tickTask(
    deltaMs: number,
    isNight: boolean,
    terrainStates?: Map<string, TerrainState>,
  ): void {
    if (this._currentTerrainId === null) return;

    if (this._currentTask !== null) {
      this._currentTask.remainingMs -= deltaMs;

      if (this._currentTask.remainingMs > 0) return;

      this.clearCurrentTask();
    }

    this.pickNewJob(isNight, terrainStates);
  }

  // -----------------------------------------------------------------------
  // Terrain management
  // -----------------------------------------------------------------------

  /** Score terrains and switch if a better one is found. */
  private evaluateTerrainSwitch(
    terrains: readonly SmartTerrain[],
    terrainStates?: Map<string, TerrainState>,
  ): void {
    // During surge, committed to a shelter — don't shop for a better one.
    if (this._surgeActive && this.isCurrentTerrainShelter()) return;

    const best = this.selectBestTerrain(terrains, terrainStates);
    if (best === null) return;

    if (best.id === this._currentTerrainId) return;

    this.switchTerrain(best);
  }

  /** Find the best shelter terrain and switch to it during a surge. */
  private fleeToShelter(terrains: readonly SmartTerrain[]): void {
    const query = this.buildTerrainQuery(terrains);
    const prevSurge = this._terrainQuery.surgeActive;
    this._terrainQuery.surgeActive = true;

    const shelter = TerrainSelector.selectBest(query);

    this._terrainQuery.surgeActive = prevSurge;

    if (shelter === null || shelter.id === this._currentTerrainId) return;

    this.switchTerrain(shelter);
  }

  /** Release the old terrain and assign to the new one. */
  private switchTerrain(terrain: SmartTerrain): void {
    this.releaseFromTerrain();
    this.assignToTerrain(terrain);
  }

  /** Register with a terrain and dispatch movement. */
  private assignToTerrain(terrain: SmartTerrain): void {
    if (!terrain.addOccupant(this._npcId)) {
      this._reEvaluateTimerMs = 0;
      return;
    }
    this._currentTerrainId = terrain.id;
    this._currentTerrain = terrain;
    this._currentSlots = JobSlotSystem.buildSlots(terrain);

    this.dispatchMovementToTerrain(terrain);
    this._scheduleManager.resetWaypointTimer();
  }

  /** Dispatch movement toward the terrain center. */
  private dispatchMovementToTerrain(terrain: SmartTerrain): void {
    if (this._dispatcher === null) return;

    this._dispatcher.addMovingNPC(
      this._npcId,
      this._currentTerrainId ?? '',
      terrain.id,
      this._lastPosition,
      terrain.center,
    );
  }

  // -----------------------------------------------------------------------
  // Job management
  // -----------------------------------------------------------------------

  /** Pick a new job slot from the current terrain. */
  private pickNewJob(
    isNight: boolean,
    terrainStates?: Map<string, TerrainState>,
  ): void {
    if (this._currentTerrainId === null) return;
    if (this._currentSlots.length === 0) return;

    const ctx = this.buildJobContext();
    const terrainState = this.getTerrainState(terrainStates);

    const slot = JobSlotSystem.pickBestSlot(
      this._currentSlots,
      ctx,
      isNight,
      terrainState,
      this._jobConfig,
    );

    if (slot === null) {
      this._reEvaluateTimerMs = 0;
      return;
    }

    JobSlotSystem.assignNPC(slot, this._npcId);
    this.createTaskFromSlot(slot, this._currentTerrainId);
  }

  /** Build a brain task from a job slot. */
  private createTaskFromSlot(slot: IJobSlotRuntime, terrainId: string): void {
    this._currentTask = {
      terrainId,
      slotType: slot.type,
      targetPosition: slot.position ?? this._lastPosition,
      scheme: DEFAULT_SCHEME,
      params: null,
      remainingMs: DEFAULT_TASK_DURATION_MS,
    };

    this._deps.events.emit(ALifeEvents.TASK_ASSIGNED, {
      npcId: this._npcId,
      terrainId,
      taskType: slot.type,
    });
  }

  /** Clear the current task and release from the slot. */
  private clearCurrentTask(): void {
    if (this._currentTask === null) return;

    for (const slot of this._currentSlots) {
      if (slot.assignedNPCs.has(this._npcId)) {
        JobSlotSystem.releaseNPC(slot, this._npcId);
      }
    }

    this._currentTask = null;
  }

  /** Apply a scheme override to the current task. */
  private applySchemeOverride(scheme: string, params: ISchemeParams | null): void {
    if (this._currentTask === null) return;

    // Reconstruct task with updated scheme/params (IBrainTask has readonly fields).
    this._currentTask = {
      terrainId: this._currentTask.terrainId,
      slotType: this._currentTask.slotType,
      targetPosition: this._currentTask.targetPosition,
      scheme,
      params,
      remainingMs: this._currentTask.remainingMs,
    };
  }

  // -----------------------------------------------------------------------
  // Utility helpers
  // -----------------------------------------------------------------------

  /** Get the terrain state for the current terrain from the state map. */
  private getTerrainState(
    terrainStates?: Map<string, TerrainState>,
  ): TerrainState {
    if (terrainStates === undefined || this._currentTerrainId === null) {
      return 0; // TerrainState.PEACEFUL
    }
    return terrainStates.get(this._currentTerrainId) ?? 0;
  }

  /** Check if current terrain is a shelter (O(1) via cached reference). */
  private isCurrentTerrainShelter(): boolean {
    return this._currentTerrain?.isShelter ?? false;
  }

  /** Get the danger level of the current terrain (O(1) via cached reference). */
  private getCurrentTerrainDanger(): number {
    return this._currentTerrain?.dangerLevel ?? 0;
  }

  private cancelMovement(): void {
    if (this._dispatcher === null) return;
    this._dispatcher.cancelJourney(this._npcId);
  }
}
