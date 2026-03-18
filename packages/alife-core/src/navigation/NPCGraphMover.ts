// navigation/NPCGraphMover.ts
// Per-NPC cursor for offline graph-based movement.
//
// Stores (currentVertexId, walkedDistance) and advances along edges each tick.
// worldPosition is linearly interpolated along the current edge.
//
// Usage:
//   const mover = new NPCGraphMover(graph, 'spawn_point', 80);
//   mover.moveTo('base_camp');
//   mover.update(deltaMs);
//   const { x, y } = mover.worldPosition;

import { LevelGraph } from './LevelGraph';
import type { TerrainFilter } from './LevelGraph';
import type { ISerializable } from '../core/ISerializable';

export type GraphMoverEvent =
  | { readonly type: 'arrived';   readonly vertexId: string }   // reached next vertex in path
  | { readonly type: 'completed'; readonly vertexId: string }   // reached final destination
  | { readonly type: 'no_path';   readonly from: string; readonly to: string }; // pathfinding failed

// ---------------------------------------------------------------------------
// Serializable state shape
// ---------------------------------------------------------------------------

export interface INPCGraphMoverState {
  currentVertexId: string;
  nextVertexId: string | null;
  remainingPath: string[];
  pathCursor: number;
  walkedDistance: number;
  speed: number;
  timeFactor: number;
}

// ---------------------------------------------------------------------------
// NPCGraphMover
// ---------------------------------------------------------------------------

export class NPCGraphMover implements ISerializable<INPCGraphMoverState> {
  private readonly _graph: LevelGraph;

  /** Current vertex the NPC is AT (or moving away from) */
  private _currentVertexId: string;
  /** Next vertex in current path segment (null = idle) */
  private _nextVertexId: string | null = null;
  /** Remaining path after _nextVertexId (from index 0 = next after next) */
  private _remainingPath: string[] = [];
  /** Cursor index into _remainingPath — avoids O(n) shift() */
  private _pathCursor = 0;
  /** Distance walked along current edge [0, edgeWeight] */
  private _walkedDistance = 0;
  /** Current edge total weight (cached) */
  private _currentEdgeWeight = 0;
  /** Events emitted during last update() */
  private _pendingEvents: GraphMoverEvent[] = [];
  /** Movement speed in world units per second */
  private _speed: number;
  /** Time scale factor */
  private _timeFactor: number;

  /**
   * @param graph         - The level graph used for pathfinding.
   * @param startVertexId - Initial vertex ID for this NPC.
   * @param speed         - Movement speed in world units per second.
   * @param timeFactor    - Optional time scale factor (default 1.0).
   */
  constructor(graph: LevelGraph, startVertexId: string, speed: number, timeFactor = 1) {
    this._graph = graph;
    this._currentVertexId = startVertexId;
    this._speed = speed;
    this._timeFactor = timeFactor;
  }

  // -------------------------------------------------------------------------
  // Speed control
  // -------------------------------------------------------------------------

  /** Change movement speed at runtime. */
  setSpeed(speed: number): void {
    this._speed = speed;
  }

  /** Current movement speed in world units per second. */
  get speed(): number { return this._speed; }

  // -------------------------------------------------------------------------
  // Path control
  // -------------------------------------------------------------------------

  /**
   * Request movement to a destination vertex.
   * Computes A* path immediately. Returns false if no path found.
   *
   * @param destinationId - Target vertex ID.
   * @param filter        - Optional terrain filter for path finding.
   */
  moveTo(destinationId: string, filter?: TerrainFilter): boolean {
    if (destinationId === this._currentVertexId) {
      this._nextVertexId = null;
      this._remainingPath = [];
      this._pathCursor = 0;
      this._walkedDistance = 0;
      this._currentEdgeWeight = 0;
      return true;
    }

    const path = this._graph.findPath(this._currentVertexId, destinationId, filter);
    if (!path || path.length < 2) {
      this._pendingEvents.push({ type: 'no_path', from: this._currentVertexId, to: destinationId });
      return false;
    }

    // path[0] = current, path[1] = next, path[2..] = remaining
    this._nextVertexId = path[1];
    this._remainingPath = path.slice(2);
    this._pathCursor = 0;
    this._walkedDistance = 0;
    this._currentEdgeWeight = this._graph.edgeWeight(this._currentVertexId, this._nextVertexId);
    return true;
  }

  // -------------------------------------------------------------------------
  // Simulation tick
  // -------------------------------------------------------------------------

  /**
   * Advance movement by deltaMs milliseconds using stored speed and timeFactor.
   *
   * @param deltaMs - Time elapsed since last tick (milliseconds).
   */
  update(deltaMs: number): void {
    this._pendingEvents = [];
    if (this._nextVertexId === null) return;
    if (this._speed <= 0 || this._timeFactor <= 0) return;

    // Fix C2: timeFactor multiplies (not divides) — larger factor = more movement per real ms
    let remaining = (deltaMs / 1000) * this._timeFactor * this._speed;

    // Fix C1: bound iterations by number of path vertices to prevent infinite loop
    // on consecutive zero-weight edges (distToNext=0, remaining never decreases).
    const maxSteps = Math.max(2, this._remainingPath.length - this._pathCursor + 2);
    let steps = 0;

    while (remaining > 0 && this._nextVertexId !== null && steps++ < maxSteps) {
      const distToNext = this._currentEdgeWeight - this._walkedDistance;

      if (remaining < distToNext) {
        this._walkedDistance += remaining;
        break;
      }

      // Reached next vertex
      remaining -= distToNext;
      this._currentVertexId = this._nextVertexId;
      this._walkedDistance = 0;

      // Fix P4: use cursor index instead of shift() (O(1) vs O(n))
      if (this._pathCursor >= this._remainingPath.length) {
        // Arrived at final destination
        this._nextVertexId = null;
        this._currentEdgeWeight = 0;
        this._pendingEvents.push({ type: 'completed', vertexId: this._currentVertexId });
        break;
      }

      // Advance to next segment
      const nextInPath = this._remainingPath[this._pathCursor++];
      this._pendingEvents.push({ type: 'arrived', vertexId: this._currentVertexId });
      this._nextVertexId = nextInPath;
      this._currentEdgeWeight = this._graph.edgeWeight(this._currentVertexId, this._nextVertexId);
    }
  }

  // -------------------------------------------------------------------------
  // World position
  // -------------------------------------------------------------------------

  /** Current world position (interpolated along current edge). */
  get worldPosition(): { x: number; y: number } {
    if (this._nextVertexId === null || this._currentEdgeWeight === 0) {
      const v = this._graph.getVertex(this._currentVertexId);
      return v ? { x: v.x, y: v.y } : { x: 0, y: 0 };
    }
    const t = this._walkedDistance / this._currentEdgeWeight;
    return this._graph.interpolatePosition(this._currentVertexId, this._nextVertexId, t);
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  get currentVertexId(): string { return this._currentVertexId; }
  get nextVertexId(): string | null { return this._nextVertexId; }
  get isMoving(): boolean { return this._nextVertexId !== null; }
  get walkedDistance(): number { return this._walkedDistance; }

  /** Events from the last update() call. */
  get events(): ReadonlyArray<GraphMoverEvent> { return this._pendingEvents; }

  // -------------------------------------------------------------------------
  // Teleport
  // -------------------------------------------------------------------------

  /** Teleport NPC to a vertex (e.g. on spawn/load). Clears all movement state. */
  teleport(vertexId: string): void {
    this._currentVertexId = vertexId;
    this._nextVertexId = null;
    this._remainingPath = [];
    this._pathCursor = 0;
    this._walkedDistance = 0;
    this._currentEdgeWeight = 0;
    this._pendingEvents = [];
  }

  // -------------------------------------------------------------------------
  // Serialization — implements ISerializable<INPCGraphMoverState>
  // -------------------------------------------------------------------------

  /** Serialize for save/load. */
  serialize(): INPCGraphMoverState {
    return {
      currentVertexId: this._currentVertexId,
      nextVertexId: this._nextVertexId,
      remainingPath: [...this._remainingPath],
      pathCursor: this._pathCursor,
      walkedDistance: this._walkedDistance,
      speed: this._speed,
      timeFactor: this._timeFactor,
    };
  }

  /** Restore from serialized state. */
  restore(state: INPCGraphMoverState): void {
    this._currentVertexId = state.currentVertexId;
    this._nextVertexId = state.nextVertexId;
    this._remainingPath = [...state.remainingPath];
    this._pathCursor = state.pathCursor;
    this._walkedDistance = state.walkedDistance;
    this._speed = state.speed;
    this._timeFactor = state.timeFactor;
    this._pendingEvents = [];

    if (this._nextVertexId !== null) {
      this._currentEdgeWeight = this._graph.edgeWeight(this._currentVertexId, this._nextVertexId);
    } else {
      this._currentEdgeWeight = 0;
    }
  }
}
