/**
 * Day/night mode transitions and night schedule management for NPC brains.
 *
 * Tracks whether the clock has transitioned between day and night,
 * and during nighttime manages waypoint-based schedule advancement
 * with linger timers and movement dispatch.
 */

import type { Vec2 } from '@alife-sdk/core';
import type { Clock } from '@alife-sdk/core';
import type { Schedule } from '../npc/Schedule';

// ---------------------------------------------------------------------------
// Movement dispatcher port (defined here -- clients own their interfaces)
// ---------------------------------------------------------------------------

/** Adapter for dispatching NPC movement between terrains/positions. */
export interface IMovementDispatcher {
  /** Queue movement from one terrain/position to another. */
  addMovingNPC(
    npcId: string,
    fromTerrainId: string,
    toTerrainId: string,
    fromPos: Vec2,
    toPos: Vec2,
    speed?: number,
  ): void;

  /** Check whether an NPC is currently in transit. */
  isMoving(npcId: string): boolean;

  /** Cancel an ongoing journey. */
  cancelJourney(npcId: string): void;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/** Outcome of a day/night transition check. */
export interface IModeTransitionResult {
  /** True when a day/night boundary was crossed this tick. */
  readonly transitioned: boolean;
  /** Current night state after the check. */
  readonly isNight: boolean;
}

// ---------------------------------------------------------------------------
// BrainScheduleManager
// ---------------------------------------------------------------------------

/**
 * Manages day/night mode awareness and night-time schedule execution.
 *
 * Each NPCBrain owns one instance. The manager:
 * 1. Detects day-to-night and night-to-day transitions via Clock.
 * 2. During night, counts down a linger timer at the current waypoint.
 * 3. When the linger expires, advances the schedule and dispatches movement.
 * 4. On night-to-day transition, resets the schedule to the first waypoint.
 */
export class BrainScheduleManager {
  private _schedule: Schedule | null = null;
  private _wasNight = false;
  private _waypointTimerMs = 0;
  private _initialized = false;

  // -----------------------------------------------------------------------
  // Schedule access
  // -----------------------------------------------------------------------

  /** Assign a night schedule. Resets any active timer. */
  setSchedule(schedule: Schedule): void {
    this._schedule = schedule;
    this._waypointTimerMs = 0;
  }

  /** True if a schedule is assigned. */
  hasSchedule(): boolean {
    return this._schedule !== null;
  }

  /**
   * Set the initial night state without triggering a transition.
   * Must be called once before the first `checkModeTransition`.
   */
  seedNightState(isNight: boolean): void {
    this._wasNight = isNight;
    this._initialized = true;
  }

  /** Reset the current waypoint linger timer to zero. */
  resetWaypointTimer(): void {
    this._waypointTimerMs = 0;
  }

  // -----------------------------------------------------------------------
  // Mode transition detection
  // -----------------------------------------------------------------------

  /**
   * Compare the clock's night state against the last known state.
   * Returns whether a transition occurred and the current night state.
   *
   * Side-effect: when transitioning night-to-day, the schedule resets.
   */
  checkModeTransition(clock: Clock): IModeTransitionResult {
    const isNight = clock.isNight;

    if (!this._initialized) {
      this._wasNight = isNight;
      this._initialized = true;
      return { transitioned: false, isNight };
    }

    const transitioned = isNight !== this._wasNight;
    this._wasNight = isNight;

    if (transitioned && !isNight) {
      this.onNightToDay();
    }

    return { transitioned, isNight };
  }

  // -----------------------------------------------------------------------
  // Night schedule tick
  // -----------------------------------------------------------------------

  /**
   * Advance the night-time schedule by `deltaMs`.
   *
   * If the NPC is mid-journey (dispatcher.isMoving), the linger timer
   * is suppressed. Otherwise the timer counts down and, on expiry,
   * the schedule advances and movement is dispatched.
   */
  updateNightSchedule(
    deltaMs: number,
    npcId: string,
    currentTerrainId: string | null,
    lastPosition: Vec2,
    dispatcher: IMovementDispatcher,
  ): void {
    if (this._schedule === null) return;
    if (this._schedule.length === 0) return;

    if (dispatcher.isMoving(npcId)) return;

    const waypoint = this._schedule.getCurrentWaypoint();
    this._waypointTimerMs += deltaMs;

    if (this._waypointTimerMs < waypoint.durationMs) return;

    this.advanceAndDispatch(npcId, currentTerrainId, lastPosition, dispatcher);
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /** Reset schedule to the beginning when night ends. */
  private onNightToDay(): void {
    if (this._schedule === null) return;
    this._schedule.reset();
    this._waypointTimerMs = 0;
  }

  /** Advance to the next waypoint and dispatch movement. */
  private advanceAndDispatch(
    npcId: string,
    currentTerrainId: string | null,
    lastPosition: Vec2,
    dispatcher: IMovementDispatcher,
  ): void {
    if (this._schedule === null) return;

    this._schedule.advance();
    this._waypointTimerMs = 0;

    const next = this._schedule.getCurrentWaypoint();
    const fromTerrainId = currentTerrainId ?? '';
    const toTerrainId = next.zoneId;

    dispatcher.addMovingNPC(
      npcId,
      fromTerrainId,
      toTerrainId,
      lastPosition,
      next.position,
    );
  }
}
