/**
 * Time-based linear interpolation movement system for offline NPC transit.
 *
 * Each journey is a straight-line segment from one terrain center to another.
 * The simulator advances elapsed time each tick; once a journey's travel time
 * is reached the NPC is considered arrived and an NPC_MOVED event is emitted.
 *
 * Implements {@link IMovementDispatcher} so it can be injected into NPCBrain
 * and BrainScheduleManager without those modules knowing the concrete class.
 */

import { type Vec2, distance, lerp, EventBus, ALifeEvents } from '@alife-sdk/core';
import type { ALifeEventPayloads } from '@alife-sdk/core';
import type { IMovementSimulator } from './IMovementSimulator';

// ---------------------------------------------------------------------------
// Journey record
// ---------------------------------------------------------------------------

/** Internal bookkeeping for a single NPC transit. */
interface IJourneyRecord {
  readonly npcId: string;
  readonly fromTerrainId: string;
  readonly toTerrainId: string;
  readonly fromPos: Vec2;
  readonly toPos: Vec2;
  /** Total transit duration derived from distance / speed (ms). */
  readonly travelTimeMs: number;
  /** Milliseconds elapsed since the journey started. */
  elapsedMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default NPC walking speed when no explicit value is supplied (px/s). */
export const DEFAULT_MOVEMENT_SPEED = 50;

/** Journeys shorter than this distance (px) are treated as instant no-ops. */
const MIN_JOURNEY_DISTANCE = 1;

// ---------------------------------------------------------------------------
// MovementSimulator
// ---------------------------------------------------------------------------

/**
 * Manages offline NPC movement via time-based linear interpolation.
 *
 * **Tick cost**: O(n) where n = active journey count.
 * **Memory**: ~112 bytes per journey record (7 fields, 3 Vec2 refs).
 *
 * @example
 * ```ts
 * const sim = new MovementSimulator(events);
 * sim.addMovingNPC('npc_1', 'zone_a', 'zone_b', {x:0,y:0}, {x:100,y:0});
 * sim.update(2_000); // 2 seconds elapsed
 * const pos = sim.getPosition('npc_1'); // interpolated ~{x:100, y:0} at default 50px/s
 * ```
 */
export class MovementSimulator implements IMovementSimulator {
  private readonly _journeys = new Map<string, IJourneyRecord>();
  private readonly _events: EventBus<ALifeEventPayloads>;

  constructor(events: EventBus<ALifeEventPayloads>) {
    this._events = events;
  }

  // -------------------------------------------------------------------------
  // IMovementDispatcher
  // -------------------------------------------------------------------------

  /** @inheritdoc */
  addMovingNPC(
    npcId: string,
    fromTerrainId: string,
    toTerrainId: string,
    fromPos: Vec2,
    toPos: Vec2,
    speed?: number,
  ): void {
    const dist = distance(fromPos, toPos);
    if (dist < MIN_JOURNEY_DISTANCE) return;

    const effectiveSpeed = Math.max(1, speed ?? DEFAULT_MOVEMENT_SPEED);
    const travelTimeMs = (dist / effectiveSpeed) * 1_000;

    this._journeys.set(npcId, {
      npcId,
      fromTerrainId,
      toTerrainId,
      fromPos,
      toPos,
      travelTimeMs,
      elapsedMs: 0,
    });
  }

  /** @inheritdoc */
  isMoving(npcId: string): boolean {
    return this._journeys.has(npcId);
  }

  /** @inheritdoc */
  cancelJourney(npcId: string): void {
    this._journeys.delete(npcId);
  }

  // -------------------------------------------------------------------------
  // Tick progression
  // -------------------------------------------------------------------------

  /**
   * Advance all active journeys by `deltaMs` milliseconds.
   *
   * Journeys whose elapsed time meets or exceeds the total travel time are
   * completed: removed from the active set and an {@link ALifeEvents.NPC_MOVED}
   * event is queued on the EventBus.
   *
   * **Complexity**: O(n) where n = active journeys.
   */
  update(deltaMs: number): void {
    const completed: string[] = [];

    for (const [npcId, journey] of this._journeys) {
      journey.elapsedMs += deltaMs;
      if (journey.elapsedMs >= journey.travelTimeMs) {
        completed.push(npcId);
      }
    }

    for (const npcId of completed) {
      const journey = this._journeys.get(npcId)!;
      this._journeys.delete(npcId);

      this._events.emit(ALifeEvents.NPC_MOVED, {
        npcId,
        fromZone: journey.fromTerrainId,
        toZone: journey.toTerrainId,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  /**
   * Current interpolated position for an NPC in transit.
   *
   * Returns `null` when the NPC has no active journey (either finished or
   * never started). The returned Vec2 is a new object each call (no aliasing).
   *
   * **Complexity**: O(1).
   */
  getPosition(npcId: string): Vec2 | null {
    const journey = this._journeys.get(npcId);
    if (!journey) return null;

    const t = Math.min(journey.elapsedMs / journey.travelTimeMs, 1);
    return lerp(journey.fromPos, journey.toPos, t);
  }

  /** Number of NPCs currently in transit. */
  get activeCount(): number {
    return this._journeys.size;
  }

  /** Remove all active journeys without emitting events. */
  clear(): void {
    this._journeys.clear();
  }
}
