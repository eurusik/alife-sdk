// perception/NPCSensors.ts
// NPC vision and hearing sensors — scene-level coordinator.
//
// Uses SpatialGrid for O(k) candidate lookup instead of O(n) full scan.
// Returns IDetectionEvent[] — caller decides what to do (write to MemoryBank, emit events, etc.).
//
// Pure deterministic logic — no side effects, no EventBus dependency.

import type { Vec2 } from '@alife-sdk/core';
import type { SpatialGrid } from '@alife-sdk/core';
import { isInFOV, distanceSq } from './PerceptionQuery';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Entity that can both observe and be observed.
 * Agnostic — callers map their game entities to this interface.
 */
export interface IPerceptibleEntity {
  readonly id: string;
  readonly position: Vec2;
  readonly factionId: string;
  /** Facing direction in radians (0 = right / +X axis). */
  readonly facingAngle: number;
  readonly isAlive: boolean;
  /** Maximum vision distance in world units. */
  readonly visionRange: number;
  /** Half-angle of the FOV cone in radians (e.g. Math.PI/3 = 60° half = 120° total). */
  readonly visionHalfAngle: number;
  /** Maximum hearing range in world units. */
  readonly hearingRange: number;
}

/** Result of a sensor detection — framework-agnostic. */
export interface IDetectionEvent {
  readonly observerId: string;
  readonly targetId: string;
  readonly targetPosition: Vec2;
  readonly channel: 'visual' | 'sound';
  /**
   * Detection confidence in [0, 1].
   * Visual detections always have confidence 1.0.
   * Sound confidence decreases linearly with distance.
   */
  readonly confidence: number;
}

export interface INPCSensorsConfig {
  /**
   * Spatial hash grid for O(k) candidate lookup.
   * Entities must be registered in the grid by the caller.
   */
  spatialGrid: SpatialGrid<{ id: string; position: Vec2 }>;
  /** Returns true if observerFaction is hostile toward targetFaction. */
  isHostile: (observerFaction: string, targetFaction: string) => boolean;
  /**
   * Optional LOS check — called after the FOV cone test.
   * Return `true` if the line from `from` to `to` is unobstructed.
   * When absent, LOS is assumed clear (backward-compatible).
   *
   * @example
   * ```ts
   * isLineOfSightClear(from, to) {
   *   const line = new Phaser.Geom.Line(from.x, from.y, to.x, to.y);
   *   return obstacles.every(r => !Phaser.Geom.Intersects.LineToRectangle(line, r));
   * }
   * ```
   */
  isLineOfSightClear?: (from: Vec2, to: Vec2) => boolean;
}

// ---------------------------------------------------------------------------
// NPCSensors
// ---------------------------------------------------------------------------

/**
 * NPC vision and hearing sensors.
 *
 * Two sensors:
 * - **Vision** (`detectVision`): FOV cone per NPC, hostile-only, O(n×k) via SpatialGrid.
 * - **Sound** (`detectSound`): omnidirectional from a source, all factions hear it, confidence decays with distance.
 *
 * @example
 * ```ts
 * const sensors = new NPCSensors({ spatialGrid, isHostile });
 *
 * // Each frame — who sees who:
 * const visionEvents = sensors.detectVision(onlineNPCs);
 * for (const event of visionEvents) {
 *   memoryBanks.get(event.observerId)?.add({ ... });
 * }
 *
 * // On shot fired — who hears it:
 * const soundEvents = sensors.detectSound(shootPos, 500, shooterId, shooterFaction, onlineNPCs);
 * ```
 */
export class NPCSensors {
  private readonly _grid: SpatialGrid<{ id: string; position: Vec2 }>;
  private readonly _isHostile: (a: string, b: string) => boolean;
  private readonly _isLOSClear: ((from: Vec2, to: Vec2) => boolean) | undefined;

  constructor(config: INPCSensorsConfig) {
    this._grid = config.spatialGrid;
    this._isHostile = config.isHostile;
    this._isLOSClear = config.isLineOfSightClear;
  }

  /**
   * Vision sensor — for each living NPC: query nearby candidates via SpatialGrid,
   * apply FOV cone check, emit detection events for visible hostile targets.
   *
   * Builds an id→entity index once at O(n), then candidate lookup is O(1).
   * Overall complexity: O(n * k) where n = observers, k = avg candidates per vision radius.
   *
   * NOTE: SpatialGrid.queryRadius() returns a scratch array that is reused between
   * calls. Results are copied per observer to avoid aliasing issues.
   */
  detectVision(observers: readonly IPerceptibleEntity[]): IDetectionEvent[] {
    const results: IDetectionEvent[] = [];

    // Build id→entity index once — O(n), gives O(1) candidate lookup
    const entityMap = new Map<string, IPerceptibleEntity>();
    for (const e of observers) entityMap.set(e.id, e);

    for (const observer of observers) {
      if (!observer.isAlive) continue;

      // queryRadius returns a scratch array — copy immediately to avoid aliasing
      const candidates = [...this._grid.queryRadius(observer.position, observer.visionRange)];

      for (const cell of candidates) {
        if (cell.id === observer.id) continue;

        const target = entityMap.get(cell.id);
        if (!target || !target.isAlive) continue;
        if (!this._isHostile(observer.factionId, target.factionId)) continue;

        if (!isInFOV(
          observer.position,
          observer.facingAngle,
          target.position,
          observer.visionRange,
          observer.visionHalfAngle,
        )) continue;

        // LOS obstacle check — optional, skipped when not configured
        if (this._isLOSClear && !this._isLOSClear(observer.position, target.position)) continue;

        results.push({
          observerId: observer.id,
          targetId: target.id,
          targetPosition: target.position,
          channel: 'visual',
          confidence: 1.0,
        });
      }
    }

    return results;
  }

  /**
   * Sound sensor — detect all NPCs that hear a sound event.
   *
   * Sound is omnidirectional (no FOV cone). Confidence decays linearly with distance.
   * Both hostile and friendly entities can hear the sound.
   *
   * O(h) where h = hearer count.
   *
   * @param sourcePos        - World-space origin of the sound.
   * @param soundRange       - Maximum propagation range in world units.
   * @param sourceId         - Entity id of the sound source (excluded from results).
   * @param _sourceFactionId - Faction of the sound source (unused — sound is omnidirectional).
   * @param hearers          - Candidate entities that may hear the sound.
   */
  detectSound(
    sourcePos: Vec2,
    soundRange: number,
    sourceId: string,
    _sourceFactionId: string,
    hearers: readonly IPerceptibleEntity[],
  ): IDetectionEvent[] {
    if (soundRange <= 0) return [];

    const results: IDetectionEvent[] = [];
    const soundRangeSq = soundRange * soundRange;

    for (const hearer of hearers) {
      if (!hearer.isAlive) continue;
      if (hearer.id === sourceId) continue;

      const dSq = distanceSq(hearer.position, sourcePos);
      const hearRangeSq = hearer.hearingRange * hearer.hearingRange;

      // Must be within both sound propagation range AND hearer's hearing range
      if (dSq > soundRangeSq || dSq > hearRangeSq) continue;

      // Linear confidence decay: 1.0 at source, 0.0 at soundRange
      const dist = Math.sqrt(dSq);
      const confidence = Math.max(0, 1.0 - dist / soundRange);

      results.push({
        observerId: hearer.id,
        targetId: sourceId,
        targetPosition: sourcePos,
        channel: 'sound',
        confidence,
      });
    }

    return results;
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Filter squad-shared target intel by freshness.
 * Returns only targets seen within `freshnessMs` milliseconds.
 *
 * @param sharedTargets - Targets shared by squad members.
 * @param currentTimeMs - Current game time in ms.
 * @param freshnessMs   - Max age of intel (default: 5000ms).
 */
export function filterFreshIntel(
  sharedTargets: ReadonlyArray<{ id: string; position: Vec2; lastSeenMs: number }>,
  currentTimeMs: number,
  freshnessMs = 5000,
): ReadonlyArray<{ id: string; position: Vec2 }> {
  const result: Array<{ id: string; position: Vec2 }> = [];
  for (const t of sharedTargets) {
    if (currentTimeMs - t.lastSeenMs <= freshnessMs) {
      result.push({ id: t.id, position: t.position });
    }
  }
  return result;
}
