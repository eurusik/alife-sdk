/**
 * Route types and tracker for NPC patrol movement.
 *
 * Three route types are supported:
 *   LOOP      -- A->B->C->A->B->C->...  (cyclic, infinite)
 *   PING_PONG -- A->B->C->B->A->B->...  (reverse at each end, infinite)
 *   ONE_WAY   -- A->B->C (stop at final waypoint, finite)
 *
 * PatrolRoute is a plain data object with zero runtime dependencies.
 * PatrolRouteTracker is a lightweight stateful cursor over a PatrolRoute.
 */

// ---------------------------------------------------------------------------
// Route type
// ---------------------------------------------------------------------------

export const RouteType = {
  LOOP: 'loop',
  PING_PONG: 'ping_pong',
  ONE_WAY: 'one_way',
} as const;

export type RouteType = (typeof RouteType)[keyof typeof RouteType] | (string & {});

// ---------------------------------------------------------------------------
// Waypoint
// ---------------------------------------------------------------------------

/** A single world-space position in a patrol route. */
export interface IPatrolWaypoint {
  readonly x: number;
  readonly y: number;
  /** Milliseconds to pause at this waypoint before advancing. */
  readonly waitTime?: number;
}

// ---------------------------------------------------------------------------
// PatrolRoute (data object)
// ---------------------------------------------------------------------------

/**
 * An ordered sequence of waypoints defining a patrol path.
 *
 * PatrolRoute instances are stored on SmartTerrain and shared among all
 * NPCs assigned to that terrain -- they are treated as immutable. Each NPC
 * holds its own PatrolRouteTracker (a mutable cursor over the shared route).
 */
export interface PatrolRoute {
  /** Unique route identifier within the terrain. */
  readonly id: string;
  /** ID of the SmartTerrain this route belongs to. */
  readonly terrainId: string;
  /** Ordered list of world-space positions. Must have at least 1 entry. */
  readonly waypoints: readonly IPatrolWaypoint[];
  /** How the NPC cycles through the waypoints. */
  readonly routeType: RouteType;
}

// ---------------------------------------------------------------------------
// RouteAdvancer callback
// ---------------------------------------------------------------------------

/**
 * Custom route advancement function.
 *
 * Called by PatrolRouteTracker.advance() when a custom advancer is provided.
 * Should return the new index, direction, and whether the route is completed.
 */
export type RouteAdvancer = (
  currentIndex: number,
  waypointCount: number,
  direction: 1 | -1,
) => { index: number; direction: 1 | -1; completed: boolean };

// ---------------------------------------------------------------------------
// PatrolRouteTracker (stateful cursor)
// ---------------------------------------------------------------------------

/**
 * Tracks an NPC's position along a PatrolRoute.
 *
 * One tracker is created per (NPC, route) pair. The tracker is stored on
 * the entity in online AI and in offline data structures. Memory footprint
 * is minimal: three primitive fields plus one object reference.
 */
export class PatrolRouteTracker {
  private currentIndex: number;
  /** +1 = forward, -1 = backward (used by PING_PONG). */
  private direction: 1 | -1 = 1;
  /** Remaining wait time at current waypoint in milliseconds. */
  private waitRemaining = 0;
  /** True when a ONE_WAY route has delivered its final waypoint. */
  private completed = false;
  /** Optional custom advancer that overrides built-in route type logic. */
  private readonly customAdvancer?: RouteAdvancer;

  constructor(route: PatrolRoute, customAdvancer?: RouteAdvancer);
  constructor(private readonly route: PatrolRoute, customAdvancer?: RouteAdvancer) {
    this.currentIndex = 0;
    this.customAdvancer = customAdvancer;
  }

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------

  /** The waypoint the NPC is currently heading toward. */
  get currentWaypoint(): IPatrolWaypoint {
    return this.route.waypoints[this.currentIndex];
  }

  /**
   * True only for ONE_WAY routes once the final waypoint has been delivered.
   * Always false for LOOP and PING_PONG routes.
   */
  get isComplete(): boolean {
    return this.completed;
  }

  /** Total number of waypoints in the underlying route. */
  get waypointCount(): number {
    return this.route.waypoints.length;
  }

  // -----------------------------------------------------------------------
  // Mutation API
  // -----------------------------------------------------------------------

  /**
   * Advance to the next waypoint. Handles LOOP / PING_PONG / ONE_WAY.
   *
   * If the current waypoint has a waitTime, the wait timer is initialised.
   * For ONE_WAY routes that have already completed, this is a no-op.
   */
  advance(): void {
    if (this.completed) return;

    const len = this.route.waypoints.length;

    if (len <= 1) {
      if (this.route.routeType === RouteType.ONE_WAY) {
        this.completed = true;
      }
      return;
    }

    if (this.customAdvancer) {
      const result = this.customAdvancer(this.currentIndex, len, this.direction);
      this.currentIndex = Math.max(0, Math.min(result.index, len - 1));
      this.direction = result.direction;
      this.completed = result.completed;
    } else {
      switch (this.route.routeType) {
        case RouteType.LOOP:
          this.currentIndex = (this.currentIndex + 1) % len;
          break;

        case RouteType.PING_PONG: {
          const next = this.currentIndex + this.direction;
          if (next >= len) {
            this.direction = -1;
            this.currentIndex = len - 2;
          } else if (next < 0) {
            this.direction = 1;
            this.currentIndex = 1;
          } else {
            this.currentIndex = next;
          }
          break;
        }

        case RouteType.ONE_WAY:
          if (this.currentIndex < len - 1) {
            this.currentIndex += 1;
          } else {
            this.completed = true;
          }
          break;
      }
    }

    const wp = this.route.waypoints[this.currentIndex];
    if (wp.waitTime !== undefined && wp.waitTime > 0) {
      this.waitRemaining = wp.waitTime;
    }
  }

  /**
   * Tick the wait timer. Returns true when the wait is over (or if there
   * was no wait to begin with), signalling that the NPC may start moving
   * to the next waypoint.
   *
   * @param deltaMs - Milliseconds elapsed since the last tick.
   */
  tickWait(deltaMs: number): boolean {
    if (this.waitRemaining <= 0) return true;

    this.waitRemaining -= deltaMs;
    return this.waitRemaining <= 0;
  }

  /** Reset the tracker to the first waypoint and clear completion state. */
  reset(): void {
    this.currentIndex = 0;
    this.direction = 1;
    this.waitRemaining = 0;
    this.completed = false;
  }
}
