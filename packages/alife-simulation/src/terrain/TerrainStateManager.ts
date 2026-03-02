/**
 * Per-terrain Gulag state machine: PEACEFUL -> ALERT -> COMBAT.
 *
 * Escalation is one-directional (only up). Decay is stepwise with
 * configurable timers: COMBAT -> ALERT -> PEACEFUL.
 */

import { EventBus, ALifeEvents } from '@alife-sdk/core';
import type { ALifeEventPayloads } from '@alife-sdk/core';
import type { ITerrainStateConfig } from '../types/ISimulationConfig';

// ---------------------------------------------------------------------------
// State enum (object-literal const for value-level use)
// ---------------------------------------------------------------------------

export const TerrainState = {
  PEACEFUL: 0,
  ALERT: 1,
  COMBAT: 2,
} as const;

export type TerrainState = (typeof TerrainState)[keyof typeof TerrainState];

// ---------------------------------------------------------------------------
// Serialized shape
// ---------------------------------------------------------------------------

export interface ITerrainStateSnapshot {
  readonly state: TerrainState;
  readonly lastThreatTimeMs: number;
}

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class TerrainStateManager {
  private readonly terrainId: string;
  private readonly config: ITerrainStateConfig;
  private readonly events: EventBus<ALifeEventPayloads>;
  private state: TerrainState = TerrainState.PEACEFUL;
  private lastThreatTimeMs = 0;

  constructor(
    terrainId: string,
    config: ITerrainStateConfig,
    events: EventBus<ALifeEventPayloads>,
  ) {
    this.terrainId = terrainId;
    this.config = config;
    this.events = events;
  }

  /** Current terrain state. */
  get terrainState(): TerrainState {
    return this.state;
  }

  /**
   * Escalate to the given level. Only transitions upward are applied.
   * Records the game time as the last threat timestamp.
   */
  escalate(level: TerrainState, gameTimeMs: number): void {
    if (level <= this.state) return;

    const oldState = this.state;
    this.state = level;
    this.lastThreatTimeMs = gameTimeMs;
    this.emitChange(oldState);
  }

  /**
   * Tick the decay timer. Steps down one level at a time:
   * COMBAT -> ALERT after combatDecayMs, ALERT -> PEACEFUL after alertDecayMs.
   */
  tickDecay(gameTimeMs: number): void {
    if (this.state === TerrainState.PEACEFUL) return;

    const elapsed = gameTimeMs - this.lastThreatTimeMs;
    const threshold = this.decayThreshold();

    if (elapsed < threshold) return;

    const oldState = this.state;
    this.state = (this.state - 1) as TerrainState;
    this.lastThreatTimeMs = gameTimeMs;
    this.emitChange(oldState);
  }

  /** Serialize to a plain snapshot. */
  serialize(): ITerrainStateSnapshot {
    return {
      state: this.state,
      lastThreatTimeMs: this.lastThreatTimeMs,
    };
  }

  /** Restore from a snapshot. */
  restore(state: TerrainState, lastThreatTimeMs: number): void {
    this.state = state;
    this.lastThreatTimeMs = lastThreatTimeMs;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private decayThreshold(): number {
    return this.state === TerrainState.COMBAT
      ? this.config.combatDecayMs
      : this.config.alertDecayMs;
  }

  private emitChange(oldState: TerrainState): void {
    this.events.emit(ALifeEvents.TERRAIN_STATE_CHANGED, {
      terrainId: this.terrainId,
      oldState,
      newState: this.state,
    });
  }
}
