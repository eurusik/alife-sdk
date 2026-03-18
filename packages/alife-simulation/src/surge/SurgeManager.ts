/**
 * Periodic catastrophic-event system -- manages zone-wide surge emissions.
 *
 * Framework-free SDK port of the game-side SurgeManager.
 * All engine dependencies are replaced with injected ports:
 *   - EventBus<ALifeEventPayloads> for typed event dispatch
 *   - ISimulationBridge for entity liveness / damage / morale
 *   - IRandom for deterministic testing
 *   - ISurgeConfig for all tuning constants
 *
 * Lifecycle (one full cycle):
 * ```
 * INACTIVE --(cooldown expires)--> WARNING --(timer)--> ACTIVE --(timer)--> AFTERMATH --(timer)--> INACTIVE
 * ```
 *
 * During ACTIVE:
 *   Every config.damageTickIntervalMs ms, all NPCs not in a shelter terrain
 *   take config.damagePerTick PSI damage and lose config.moralePenalty morale.
 *
 * During AFTERMATH:
 *   SpawnRegistry.resetAllCooldowns() fires once (mass-respawn trigger).
 *   All surviving NPCs gain config.moraleRestore morale (relief bonus).
 */

import { EventBus, ALifeEvents, SpawnRegistry } from '@alife-sdk/core';
import type { ALifeEventPayloads, IRandom, SmartTerrain } from '@alife-sdk/core';
import type { ISimulationBridge } from '../ports/ISimulationBridge';
import type { ISurgeConfig } from '../types/ISimulationConfig';
import { SurgePhase } from './SurgePhase';

// ---------------------------------------------------------------------------
// Public NPC record shape
// ---------------------------------------------------------------------------

/**
 * Minimal NPC data that SurgeManager needs per registered NPC.
 * No Entity references -- pure data.
 */
export interface ISurgeNPCRecord {
  /** Unique identifier for the NPC entity. */
  readonly entityId: string;
  /** Current terrain ID as tracked by NPCBrain -- used for shelter detection. */
  readonly currentTerrainId: string | null;
}

// ---------------------------------------------------------------------------
// Serialized state
// ---------------------------------------------------------------------------

export interface ISurgeManagerState {
  readonly phase: SurgePhase;
  readonly phaseTimer: number;
  readonly surgeCooldownTimer: number;
  readonly damageTickAccum: number;
  readonly surgeCount: number;
  readonly aftermathApplied: boolean;
}

// ---------------------------------------------------------------------------
// Constructor params
// ---------------------------------------------------------------------------

/** Constructor params for SurgeManager. */
export interface ISurgeManagerParams {
  readonly config: ISurgeConfig;
  readonly events: EventBus<ALifeEventPayloads>;
  readonly spawnRegistry: SpawnRegistry;
  readonly bridge: ISimulationBridge;
  readonly random: IRandom;
  readonly onSurgeDeath?: (npcId: string) => void;
}

// ---------------------------------------------------------------------------
// SurgeManager
// ---------------------------------------------------------------------------

/**
 * Drives the surge / emission lifecycle for the A-Life world simulation.
 *
 * Pure simulation object -- no framework imports, no singletons.
 * All dependencies are injected via the constructor.
 */
export class SurgeManager {
  // -------------------------------------------------------------------------
  // Phase state
  // -------------------------------------------------------------------------

  /** Current phase of the surge lifecycle. */
  private phase: SurgePhase = SurgePhase.INACTIVE;

  /**
   * Remaining ms in the current phase (WARNING, ACTIVE, or AFTERMATH).
   * Not used during INACTIVE -- the cooldown timer handles that separately.
   */
  private phaseTimer: number = 0;

  /**
   * Remaining ms until the next surge warning begins.
   * Randomised to [intervalMinMs, intervalMaxMs] after each surge cycle.
   */
  private surgeCooldownTimer: number = 0;

  // -------------------------------------------------------------------------
  // Damage tick accumulator
  // -------------------------------------------------------------------------

  /**
   * Accumulated real-time ms since the last damage tick during the ACTIVE phase.
   * Fires tickSurgeDamage() every config.damageTickIntervalMs ms.
   */
  private damageTickAccum: number = 0;

  // -------------------------------------------------------------------------
  // Session state
  // -------------------------------------------------------------------------

  /** Total surges completed this session. */
  private surgeCount: number = 0;

  /**
   * Guards aftermath effects so they fire exactly once per aftermath entry,
   * even if update() is called multiple times before the phase advances.
   */
  private aftermathApplied: boolean = false;

  // -------------------------------------------------------------------------
  // Injected dependencies
  // -------------------------------------------------------------------------

  private readonly config: ISurgeConfig;
  private readonly events: EventBus<ALifeEventPayloads>;
  private readonly spawnRegistry: SpawnRegistry;
  private readonly bridge: ISimulationBridge;
  private readonly random: IRandom;
  private readonly onSurgeDeath: ((npcId: string) => void) | undefined;
  private readonly damageTypeId: string;
  private readonly _shelterIdSet = new Set<string>();
  private _shelterIdsDirty = true;

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  constructor(params: ISurgeManagerParams) {
    this.config = params.config;
    this.events = params.events;
    this.spawnRegistry = params.spawnRegistry;
    this.bridge = params.bridge;
    this.random = params.random;
    this.onSurgeDeath = params.onSurgeDeath;
    this.damageTypeId = params.config.damageTypeId ?? 'psi';
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Reset state and arm the first surge cooldown timer.
   * Call once after construction, before the first update().
   */
  init(): void {
    this.phase = SurgePhase.INACTIVE;
    this.phaseTimer = 0;
    this.damageTickAccum = 0;
    this.surgeCount = 0;
    this.aftermathApplied = false;
    this.surgeCooldownTimer = this.randomInterval();
  }

  /**
   * Advance the surge state machine by one frame.
   *
   * Must be called every frame -- NOT gated behind a tick interval --
   * so phase transitions are smooth and damage ticks are millisecond-accurate.
   *
   * @param deltaMs  - Real-time ms since the last frame.
   * @param npcs     - All currently registered NPC records (read-only view).
   * @param terrains - All active SmartTerrains (used for shelter detection).
   */
  update(
    deltaMs: number,
    npcs: ReadonlyMap<string, ISurgeNPCRecord>,
    terrains: readonly SmartTerrain[],
  ): void {
    switch (this.phase) {
      case SurgePhase.INACTIVE:
        this.updateInactive(deltaMs);
        break;

      case SurgePhase.WARNING:
        this.updateWarning(deltaMs);
        break;

      case SurgePhase.ACTIVE:
        this.updateActive(deltaMs, npcs, terrains);
        break;

      case SurgePhase.AFTERMATH:
        this.updateAftermath(deltaMs, npcs);
        break;
    }
  }

  /** Release all internal state. */
  destroy(): void {
    this.phase = SurgePhase.INACTIVE;
    this.phaseTimer = 0;
    this.surgeCooldownTimer = 0;
    this.damageTickAccum = 0;
    this.aftermathApplied = false;
  }

  // -------------------------------------------------------------------------
  // Public API -- queries
  // -------------------------------------------------------------------------

  /** Returns the current surge lifecycle phase. */
  getPhase(): SurgePhase {
    return this.phase;
  }

  /**
   * True when the surge wave is physically active (NPCs taking damage).
   * ALifeSimulator uses this to skip offline combat during the wave.
   */
  isActive(): boolean {
    return this.phase === SurgePhase.ACTIVE;
  }

  /**
   * True when no surge event is occurring or imminent.
   * UI systems can use this to show the "Zone is quiet" status.
   */
  isSafe(): boolean {
    return this.phase === SurgePhase.INACTIVE;
  }

  /**
   * True during WARNING or ACTIVE -- NPCBrain should restrict terrain
   * selection to shelter candidates during this window.
   */
  isSurgeIncoming(): boolean {
    return this.phase === SurgePhase.WARNING || this.phase === SurgePhase.ACTIVE;
  }

  /** Returns the total number of surges that have completed this session. */
  getSurgeCount(): number {
    return this.surgeCount;
  }

  // -------------------------------------------------------------------------
  // Public API -- commands
  // -------------------------------------------------------------------------

  /**
   * Force an immediate surge, bypassing the cooldown timer.
   * Safe to call in any phase -- if a surge is already in progress it is ignored.
   */
  forceSurge(): void {
    if (this.phase !== SurgePhase.INACTIVE) {
      return;
    }
    this.surgeCooldownTimer = 0;
    this.startWarning();
  }

  // -------------------------------------------------------------------------
  // Private -- phase update methods
  // -------------------------------------------------------------------------

  /** Count down the inter-surge cooldown; start the warning when it expires. */
  private updateInactive(deltaMs: number): void {
    this.surgeCooldownTimer -= deltaMs;
    if (this.surgeCooldownTimer <= 0) {
      this.startWarning();
    }
  }

  /** Count down the warning phase; start the active wave when it expires. */
  private updateWarning(deltaMs: number): void {
    this.phaseTimer -= deltaMs;
    if (this.phaseTimer <= 0) {
      this.startSurge();
    }
  }

  /**
   * Count down the active phase; fire damage ticks; start aftermath when done.
   * Damage ticks are accumulated independently so short frames don't skip ticks.
   */
  private updateActive(
    deltaMs: number,
    npcs: ReadonlyMap<string, ISurgeNPCRecord>,
    terrains: readonly SmartTerrain[],
  ): void {
    this.phaseTimer -= deltaMs;
    this.damageTickAccum += deltaMs;

    while (this.damageTickAccum >= this.config.damageTickIntervalMs) {
      this.damageTickAccum -= this.config.damageTickIntervalMs;
      this.tickSurgeDamage(npcs, terrains);
    }

    if (this.phaseTimer <= 0) {
      this.endSurge();
    }
  }

  /** Count down the aftermath phase; trigger respawn + morale restore; then go idle. */
  private updateAftermath(
    deltaMs: number,
    npcs: ReadonlyMap<string, ISurgeNPCRecord>,
  ): void {
    // Apply aftermath effects exactly once when we enter the phase.
    if (!this.aftermathApplied) {
      this.aftermathApplied = true;
      this.applyAftermathEffects(npcs);
    }

    this.phaseTimer -= deltaMs;
    if (this.phaseTimer <= 0) {
      this.phase = SurgePhase.INACTIVE;
      this.surgeCooldownTimer = this.randomInterval();
    }
  }

  // -------------------------------------------------------------------------
  // Private -- phase transitions
  // -------------------------------------------------------------------------

  /** Transition to WARNING phase and emit SURGE_WARNING. */
  private startWarning(): void {
    this.phase = SurgePhase.WARNING;
    this.phaseTimer = this.config.warningDurationMs;

    this.events.emit(ALifeEvents.SURGE_WARNING, {
      timeUntilSurge: this.config.warningDurationMs,
    });
  }

  /** Transition to ACTIVE phase and emit SURGE_STARTED. */
  private startSurge(): void {
    this.surgeCount++;
    this.phase = SurgePhase.ACTIVE;
    this.phaseTimer = this.config.activeDurationMs;
    this.damageTickAccum = 0;
    this._shelterIdsDirty = true;

    this.events.emit(ALifeEvents.SURGE_STARTED, {
      surgeNumber: this.surgeCount,
    });
  }

  /** Transition to AFTERMATH phase and emit SURGE_ENDED. */
  private endSurge(): void {
    this.phase = SurgePhase.AFTERMATH;
    this.phaseTimer = this.config.aftermathDurationMs;
    this.aftermathApplied = false;

    this.events.emit(ALifeEvents.SURGE_ENDED, {
      surgeNumber: this.surgeCount,
    });
  }

  // -------------------------------------------------------------------------
  // Private -- surge effects
  // -------------------------------------------------------------------------

  /**
   * Apply one tick of PSI damage to every outdoor NPC.
   *
   * An NPC is "outdoors" when its current terrain is NOT a shelter
   * or when it has no assigned terrain at all.
   */
  private tickSurgeDamage(
    npcs: ReadonlyMap<string, ISurgeNPCRecord>,
    terrains: readonly SmartTerrain[],
  ): void {
    // Build a shelter terrain ID set once per surge for O(1) membership tests.
    if (this._shelterIdsDirty) {
      this._shelterIdSet.clear();
      for (const terrain of terrains) {
        if (terrain.isShelter) this._shelterIdSet.add(terrain.id);
      }
      this._shelterIdsDirty = false;
    }

    for (const [_npcId, record] of npcs) {
      if (!this.bridge.isAlive(record.entityId)) continue;

      // Determine if the NPC is sheltered.
      const isSheltered =
        record.currentTerrainId !== null &&
        this._shelterIdSet.has(record.currentTerrainId);

      if (isSheltered) continue;

      // Apply surge damage via the bridge.
      const died = this.bridge.applyDamage(
        record.entityId,
        this.config.damagePerTick,
        this.damageTypeId,
      );

      if (died) {
        this.onSurgeDeath?.(record.entityId);
        continue; // skip morale penalty -- NPC is dead
      }

      // Penalise morale -- terrified NPCs will prioritise shelter next brain tick.
      this.bridge.adjustMorale(
        record.entityId,
        this.config.moralePenalty,
        'surge',
      );

      this.events.emit(ALifeEvents.SURGE_DAMAGE, {
        npcId: record.entityId,
        damage: this.config.damagePerTick,
      });
    }
  }

  /**
   * Post-surge aftermath effects -- called once when the AFTERMATH phase starts.
   *
   * 1. Reset all SpawnRegistry cooldowns so the world can repopulate quickly.
   * 2. Apply moraleRestore to every surviving NPC as a relief bonus.
   */
  private applyAftermathEffects(
    npcs: ReadonlyMap<string, ISurgeNPCRecord>,
  ): void {
    this.spawnRegistry.resetAllCooldowns();

    for (const record of npcs.values()) {
      if (!this.bridge.isAlive(record.entityId)) continue;

      this.bridge.adjustMorale(
        record.entityId,
        this.config.moraleRestore,
        'surge_aftermath',
      );
    }
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  serialize(): ISurgeManagerState {
    return {
      phase: this.phase,
      phaseTimer: this.phaseTimer,
      surgeCooldownTimer: this.surgeCooldownTimer,
      damageTickAccum: this.damageTickAccum,
      surgeCount: this.surgeCount,
      aftermathApplied: this.aftermathApplied,
    };
  }

  restore(state: ISurgeManagerState): void {
    this.phase = state.phase;
    this.phaseTimer = state.phaseTimer;
    this.surgeCooldownTimer = state.surgeCooldownTimer;
    this.damageTickAccum = state.damageTickAccum;
    this.surgeCount = state.surgeCount;
    this.aftermathApplied = state.aftermathApplied;
    this._shelterIdsDirty = true;
  }

  // -------------------------------------------------------------------------
  // Private -- helpers
  // -------------------------------------------------------------------------

  /**
   * Return a random interval in [intervalMinMs, intervalMaxMs] ms.
   * Uses the injected IRandom for deterministic testing.
   */
  private randomInterval(): number {
    return (
      this.config.intervalMinMs +
      this.random.next() * (this.config.intervalMaxMs - this.config.intervalMinMs)
    );
  }
}
