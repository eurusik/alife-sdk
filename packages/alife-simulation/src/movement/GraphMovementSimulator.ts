/**
 * Graph-based offline NPC movement system.
 *
 * A drop-in replacement for MovementSimulator that routes journeys through
 * a LevelGraph instead of straight-line interpolation.
 *
 * Each addMovingNPC() call snaps the NPC to the nearest graph vertex for
 * both the start and destination positions, then delegates to NPCGraphMover
 * for waypoint-by-waypoint traversal. When the mover fires a 'completed'
 * event, an NPC_MOVED event is emitted on the EventBus — identical to the
 * contract MovementSimulator follows.
 *
 * Fallback behavior:
 *   - No vertices in graph: NPC_MOVED emitted immediately (instant teleport).
 *   - No path between vertices: NPC_MOVED emitted immediately.
 *   - Same nearest vertex for start and dest: NPC_MOVED emitted immediately.
 *
 * Usage:
 *   const sim = new GraphMovementSimulator(levelGraph, events);
 *   sim.addMovingNPC('npc_1', 'zone_a', 'zone_b', fromPos, toPos);
 *   sim.update(deltaMs);
 *   const pos = sim.getPosition('npc_1'); // Vec2 | null
 */

import { LevelGraph, NPCGraphMover, EventBus, ALifeEvents } from '@alife-sdk/core';
import type { IGraphVertex, ALifeEventPayloads, Vec2 } from '@alife-sdk/core';
import type { IMovementSimulator } from './IMovementSimulator';

// ---------------------------------------------------------------------------

const DEFAULT_SPEED = 50;

interface IJourneyMeta {
  readonly fromZone: string;
  readonly toZone: string;
}

// ---------------------------------------------------------------------------

export class GraphMovementSimulator implements IMovementSimulator {
  private readonly _graph: LevelGraph;
  private readonly _events: EventBus<ALifeEventPayloads>;
  private readonly _defaultSpeed: number;
  private readonly _movers = new Map<string, NPCGraphMover>();
  private readonly _meta = new Map<string, IJourneyMeta>();

  constructor(
    graph: LevelGraph,
    events: EventBus<ALifeEventPayloads>,
    defaultSpeed = DEFAULT_SPEED,
  ) {
    this._graph = graph;
    this._events = events;
    this._defaultSpeed = defaultSpeed;
  }

  // -------------------------------------------------------------------------
  // IMovementDispatcher
  // -------------------------------------------------------------------------

  /**
   * Start or replace a graph-routed journey for the given NPC.
   *
   * If the NPC already has an active journey it is silently cancelled and
   * replaced — no cancellation event is emitted, consistent with
   * MovementSimulator behavior.
   *
   * Positions are snapped to the nearest graph vertex. When no path exists or
   * vertices coincide, NPC_MOVED is emitted immediately (instant teleport).
   */
  addMovingNPC(
    npcId: string,
    fromTerrainId: string,
    toTerrainId: string,
    fromPos: Vec2,
    toPos: Vec2,
    speed?: number,
  ): void {
    const fromVertex = this._nearestVertex(fromPos);
    const toVertex   = this._nearestVertex(toPos);

    if (!fromVertex || !toVertex) {
      this._completeImmediately(npcId, fromTerrainId, toTerrainId);
      return;
    }

    const effectiveSpeed = speed ?? this._defaultSpeed;
    const existing = this._movers.get(npcId);

    if (existing) {
      existing.teleport(fromVertex.id);
      existing.setSpeed(effectiveSpeed);
    } else {
      this._movers.set(npcId, new NPCGraphMover(this._graph, fromVertex.id, effectiveSpeed));
    }

    const mover = this._movers.get(npcId)!;
    const found = mover.moveTo(toVertex.id);

    if (!found || !mover.isMoving) {
      this._movers.delete(npcId);
      this._meta.delete(npcId);
      this._completeImmediately(npcId, fromTerrainId, toTerrainId);
      return;
    }

    this._meta.set(npcId, { fromZone: fromTerrainId, toZone: toTerrainId });
  }

  isMoving(npcId: string): boolean {
    return this._movers.get(npcId)?.isMoving ?? false;
  }

  cancelJourney(npcId: string): void {
    this._movers.delete(npcId);
    this._meta.delete(npcId);
  }

  // -------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------

  update(deltaMs: number): void {
    const completed: string[] = [];

    for (const [npcId, mover] of this._movers) {
      mover.update(deltaMs);
      for (const ev of mover.events) {
        if (ev.type === 'completed') {
          completed.push(npcId);
          break;
        }
      }
    }

    for (const npcId of completed) {
      const meta = this._meta.get(npcId);
      this._movers.delete(npcId);
      this._meta.delete(npcId);
      this._events.emit(ALifeEvents.NPC_MOVED, {
        npcId,
        fromZone: meta?.fromZone ?? '',
        toZone:   meta?.toZone   ?? '',
      });
    }
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  getPosition(npcId: string): Vec2 | null {
    const mover = this._movers.get(npcId);
    if (!mover || !mover.isMoving) return null;
    return mover.worldPosition;
  }

  get activeCount(): number { return this._movers.size; }

  clear(): void {
    this._movers.clear();
    this._meta.clear();
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * Find the graph vertex closest to `pos` using Euclidean squared distance.
   *
   * **Performance note:** O(V) linear scan over all graph vertices.
   * For graphs with 500+ vertices, wrap with a SpatialGrid-backed lookup
   * by passing a `nearestVertex` callback to the constructor instead.
   */
  private _nearestVertex(pos: Vec2): IGraphVertex | undefined {
    let best: IGraphVertex | undefined;
    let bestSq = Infinity;
    for (const v of this._graph.vertices()) {
      const dx = v.x - pos.x;
      const dy = v.y - pos.y;
      const sq = dx * dx + dy * dy;
      if (sq < bestSq) { bestSq = sq; best = v; }
    }
    return best;
  }

  private _completeImmediately(npcId: string, fromZone: string, toZone: string): void {
    this._events.emit(ALifeEvents.NPC_MOVED, { npcId, fromZone, toZone });
  }
}
