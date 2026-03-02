/**
 * Cyclic waypoint schedule for NPC daily routines.
 *
 * An NPC advances through waypoints sequentially, wrapping around
 * at the end. Each waypoint specifies a zone, position, and dwell duration.
 */

import type { Vec2 } from '@alife-sdk/core';

// ---------------------------------------------------------------------------
// Waypoint
// ---------------------------------------------------------------------------

export interface IWaypoint {
  readonly zoneId: string;
  readonly position: Vec2;
  readonly durationMs: number;
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

export class Schedule {
  private readonly waypoints: readonly IWaypoint[];
  private currentIndex = 0;

  constructor(waypoints: IWaypoint[]) {
    if (waypoints.length === 0) {
      throw new Error('Schedule requires at least one waypoint');
    }
    this.waypoints = Object.freeze([...waypoints]);
  }

  /** The waypoint the NPC should currently be heading toward. */
  getCurrentWaypoint(): IWaypoint {
    return this.waypoints[this.currentIndex]!;
  }

  /** Move to the next waypoint, wrapping to 0 at the end. */
  advance(): void {
    this.currentIndex = (this.currentIndex + 1) % this.waypoints.length;
  }

  /** Reset to the first waypoint. */
  reset(): void {
    this.currentIndex = 0;
  }

  /** Total number of waypoints. */
  get length(): number {
    return this.waypoints.length;
  }

  /** Current waypoint index (0-based). */
  get index(): number {
    return this.currentIndex;
  }
}
