/**
 * Typed danger system with spatial awareness.
 *
 * DangerManager maintains a set of active danger zones in the world.
 * Each danger has a type, position, radius, threat score, and time-to-live.
 * NPCs query this manager to find nearby threats and compute safe
 * movement directions.
 *
 * All spatial queries use squared-distance math for performance.
 */

import type { Vec2 } from '../core/Vec2';
import { distanceSq, ZERO } from '../core/Vec2';

// ---------------------------------------------------------------------------
// Danger type
// ---------------------------------------------------------------------------

export const DangerType = {
  GRENADE: 'grenade',
  GUNFIRE: 'gunfire',
  EXPLOSION: 'explosion',
  CORPSE: 'corpse',
  ANOMALY: 'anomaly',
  ATTACK_SOUND: 'attack_sound',
} as const;

export type DangerType = (typeof DangerType)[keyof typeof DangerType] | (string & {});

// ---------------------------------------------------------------------------
// Danger entry
// ---------------------------------------------------------------------------

export interface IDangerEntry {
  readonly id: string;
  readonly type: DangerType;
  readonly position: Vec2;
  readonly radius: number;
  /** Urgency score in [0, 1]. Higher = more threatening. */
  readonly threatScore: number;
  /** Milliseconds remaining before this danger expires. */
  readonly remainingMs: number;
}

// ---------------------------------------------------------------------------
// Internal mutable representation for TTL tracking
// ---------------------------------------------------------------------------

/** Internal mutable representation for TTL tracking. */
interface MutableDangerEntry {
  readonly id: string;
  readonly type: DangerType;
  readonly position: Vec2;
  readonly radius: number;
  readonly threatScore: number;
  remainingMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_THREAT_THRESHOLD = 0.1;

// ---------------------------------------------------------------------------
// DangerManager
// ---------------------------------------------------------------------------

export class DangerManager {
  private readonly dangers = new Map<string, MutableDangerEntry>();
  private readonly defaultThreshold: number;

  constructor(defaultThreshold: number = DEFAULT_THREAT_THRESHOLD) {
    this.defaultThreshold = defaultThreshold;
  }

  // -----------------------------------------------------------------------
  // Mutation
  // -----------------------------------------------------------------------

  /** Register a danger zone. Replaces an existing danger with the same ID. */
  addDanger(entry: IDangerEntry): void {
    this.dangers.set(entry.id, { ...entry });
  }

  /** Remove a danger by ID. */
  removeDanger(id: string): void {
    this.dangers.delete(id);
  }

  // -----------------------------------------------------------------------
  // Spatial queries
  // -----------------------------------------------------------------------

  /**
   * Get total threat score at a position.
   *
   * Sums the threat scores of all dangers whose radius covers the position.
   * Result is not clamped -- may exceed 1.0 when multiple dangers overlap.
   */
  getThreatAt(position: Vec2): number {
    let totalThreat = 0;

    for (const danger of this.dangers.values()) {
      const dsq = distanceSq(position, danger.position);
      const rSq = danger.radius * danger.radius;
      if (dsq <= rSq) {
        totalThreat += danger.threatScore;
      }
    }

    return totalThreat;
  }

  /** Get all dangers within the given radius of a position. */
  getDangersNear(position: Vec2, radius: number): IDangerEntry[] {
    const result: IDangerEntry[] = [];
    const searchRadiusSq = radius * radius;

    for (const danger of this.dangers.values()) {
      const dsq = distanceSq(position, danger.position);
      if (dsq <= searchRadiusSq) {
        result.push(danger);
      }
    }

    return result;
  }

  /**
   * Find the safest direction to move (away from threats).
   *
   * Computes a weighted repulsion vector from all nearby dangers.
   * Each danger contributes a repulsion force inversely proportional to
   * its distance and proportional to its threat score.
   *
   * Returns ZERO if no dangers are active.
   */
  getSafeDirection(position: Vec2): Vec2 {
    let repulsionX = 0;
    let repulsionY = 0;
    let hasDangers = false;

    for (const danger of this.dangers.values()) {
      const dsq = distanceSq(position, danger.position);
      const rSq = danger.radius * danger.radius;

      if (dsq > rSq) continue;

      hasDangers = true;

      const dist = Math.sqrt(dsq);

      if (dist < 1) {
        // Directly on top of danger -- derive a direction that varies per NPC
        // by mixing both the danger position and the NPC's own position into
        // the hash.  Without the NPC position, every NPC on the same danger
        // shared an identical escape angle.
        const angle =
          ((danger.position.x * 73 + danger.position.y * 37 +
            position.x * 17 + position.y * 53) % 360) *
          (Math.PI / 180);
        repulsionX += Math.cos(angle) * danger.threatScore;
        repulsionY += Math.sin(angle) * danger.threatScore;
        continue;
      }

      // Direction from danger to position (away from danger), inlined.
      const dx = position.x - danger.position.x;
      const dy = position.y - danger.position.y;

      // Weight by threat score and inverse distance.
      const weight = danger.threatScore / dist;
      repulsionX += dx * weight;
      repulsionY += dy * weight;
    }

    if (!hasDangers) return ZERO;

    // Inline normalize — avoid allocating intermediate {x, y}.
    const mag = Math.sqrt(repulsionX * repulsionX + repulsionY * repulsionY);
    if (mag === 0) return ZERO;
    return { x: repulsionX / mag, y: repulsionY / mag };
  }

  // -----------------------------------------------------------------------
  // Update
  // -----------------------------------------------------------------------

  /** Tick: decay danger durations, remove expired entries. */
  update(deltaMs: number): void {
    const toDelete: string[] = [];
    for (const [id, danger] of this.dangers) {
      danger.remainingMs -= deltaMs;
      if (danger.remainingMs <= 0) {
        toDelete.push(id);
      }
    }
    for (const id of toDelete) {
      this.dangers.delete(id);
    }
  }

  // -----------------------------------------------------------------------
  // Convenience checks
  // -----------------------------------------------------------------------

  /**
   * Check if a position is dangerous (total threat exceeds threshold).
   *
   * @param position  - World-space position to test.
   * @param threshold - Minimum threat level to consider dangerous.
   */
  isDangerous(
    position: Vec2,
    threshold: number = this.defaultThreshold,
  ): boolean {
    let totalThreat = 0;

    for (const danger of this.dangers.values()) {
      const dsq = distanceSq(position, danger.position);
      const rSq = danger.radius * danger.radius;
      if (dsq <= rSq) {
        totalThreat += danger.threatScore;
        if (totalThreat >= threshold) return true;
      }
    }

    return false;
  }

  get activeDangerCount(): number {
    return this.dangers.size;
  }

  // -----------------------------------------------------------------------
  // Serialisation
  // -----------------------------------------------------------------------

  serialize(): IDangerEntry[] {
    return [...this.dangers.values()];
  }

  restore(entries: IDangerEntry[]): void {
    this.dangers.clear();
    for (const entry of entries) {
      this.dangers.set(entry.id, { ...entry });
    }
  }
}
