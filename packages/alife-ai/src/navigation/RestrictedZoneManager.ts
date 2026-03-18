// navigation/RestrictedZoneManager.ts
// Instance-based restricted zone management.
// Handles hard constraints (IN/OUT) and soft danger avoidance.

import type { Vec2 } from '@alife-sdk/core';

/**
 * Zone restriction types.
 * - IN: NPC must stay inside the zone.
 * - OUT: NPC cannot enter the zone.
 * - DANGER: Soft avoidance — NPC prefers to avoid but can enter.
 */
export const RestrictionType = {
  IN: 0,
  OUT: 1,
  DANGER: 2,
} as const;

export type RestrictionType = (typeof RestrictionType)[keyof typeof RestrictionType];

/**
 * A circular restricted zone in world space.
 */
export interface IRestrictedZone {
  readonly id: string;
  readonly type: RestrictionType;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  active: boolean;
  readonly metadata?: string;
}

/**
 * Manages circular no-go and soft-avoidance zones for NPC movement.
 *
 * Instance-based — create one per simulation. No global state.
 *
 * @example
 * ```ts
 * const zones = new RestrictedZoneManager(20); // 20px safety margin
 * zones.addZone({ id: 'rad_1', type: RestrictionType.OUT, x: 100, y: 100, radius: 50, active: true });
 *
 * if (!zones.isAccessible(110, 110)) {
 *   const safe = zones.getSafeDirection(110, 110);
 *   // Move NPC along safe.dx, safe.dy
 * }
 * ```
 */
export class RestrictedZoneManager {
  private readonly zones = new Map<string, IRestrictedZone>();
  private readonly safeMargin: number;

  constructor(safeMargin: number) {
    this.safeMargin = safeMargin;
  }

  // -----------------------------------------------------------------
  // Zone Lifecycle
  // -----------------------------------------------------------------

  addZone(zone: IRestrictedZone): void {
    this.zones.set(zone.id, zone);
  }

  removeZone(id: string): void {
    this.zones.delete(id);
  }

  setActive(id: string, active: boolean): void {
    const zone = this.zones.get(id);
    if (zone) zone.active = active;
  }

  removeByMetadata(tag: string): void {
    const toDelete: string[] = [];
    for (const [id, zone] of this.zones) {
      if (zone.metadata === tag) toDelete.push(id);
    }
    for (const id of toDelete) this.zones.delete(id);
  }

  getAllZones(): readonly IRestrictedZone[] {
    return [...this.zones.values()];
  }

  getZonesAt(x: number, y: number): readonly IRestrictedZone[] {
    const result: IRestrictedZone[] = [];
    for (const zone of this.zones.values()) {
      if (!zone.active) continue;
      const dx = x - zone.x;
      const dy = y - zone.y;
      if (dx * dx + dy * dy <= zone.radius * zone.radius) {
        result.push(zone);
      }
    }
    return result;
  }

  get size(): number {
    return this.zones.size;
  }

  clear(): void {
    this.zones.clear();
  }

  // -----------------------------------------------------------------
  // Hard Constraint Check
  // -----------------------------------------------------------------

  /**
   * Check if a position satisfies all hard zone constraints.
   *
   * - OUT zones: position must be outside (radius + safeMargin).
   * - IN zones: position must be inside zone radius.
   * - DANGER zones: ignored (soft avoidance only).
   *
   * Uses squared-distance for performance. Early-exit on first violation.
   *
   * Implements {@link IRestrictedZoneAccess.isAccessible}.
   */
  isAccessible(x: number, y: number): boolean {
    for (const zone of this.zones.values()) {
      if (!zone.active) continue;

      const dx = x - zone.x;
      const dy = y - zone.y;
      const distSq = dx * dx + dy * dy;

      if (zone.type === RestrictionType.OUT) {
        const effectiveR = zone.radius + this.safeMargin;
        if (distSq < effectiveR * effectiveR) return false;
      } else if (zone.type === RestrictionType.IN) {
        if (distSq > zone.radius * zone.radius) return false;
      }
    }

    return true;
  }

  /**
   * @deprecated Use {@link isAccessible} instead.
   *
   * Alias kept for backwards compatibility with existing call sites.
   * Will be removed in a future major version.
   */
  accessible(x: number, y: number): boolean {
    return this.isAccessible(x, y);
  }

  // -----------------------------------------------------------------
  // Soft Danger Check
  // -----------------------------------------------------------------

  /**
   * Check if a position is inside any active DANGER zone.
   * Does not prevent movement — used to trigger escape behavior.
   */
  isDangerous(x: number, y: number): boolean {
    for (const zone of this.zones.values()) {
      if (!zone.active || zone.type !== RestrictionType.DANGER) continue;

      const dx = x - zone.x;
      const dy = y - zone.y;
      if (dx * dx + dy * dy <= zone.radius * zone.radius) return true;
    }

    return false;
  }

  // -----------------------------------------------------------------
  // Escape Direction
  // -----------------------------------------------------------------

  /**
   * Compute a normalized direction vector to move away from the nearest
   * active OUT or DANGER zone that contains this point.
   *
   * @returns Unit vector `{x, y}` pointing away from the zone center,
   *          or null if the position is already safe.
   */
  getSafeDirection(x: number, y: number): Vec2 | null {
    let nearest: IRestrictedZone | null = null;
    let nearestDistSq = Infinity;

    for (const zone of this.zones.values()) {
      if (!zone.active) continue;
      if (zone.type !== RestrictionType.OUT && zone.type !== RestrictionType.DANGER)
        continue;

      const dx = x - zone.x;
      const dy = y - zone.y;
      const distSq = dx * dx + dy * dy;

      const effectiveR =
        zone.type === RestrictionType.OUT
          ? zone.radius + this.safeMargin
          : zone.radius;

      if (distSq < effectiveR * effectiveR && distSq < nearestDistSq) {
        nearestDistSq = distSq;
        nearest = zone;
      }
    }

    if (!nearest) return null;

    const dx = x - nearest.x;
    const dy = y - nearest.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < 1e-6) return { x: 1, y: 0 };

    return { x: dx / dist, y: dy / dist };
  }

  // -----------------------------------------------------------------
  // Waypoint Filtering
  // -----------------------------------------------------------------

  /**
   * Filter a list of waypoints to only those in accessible positions.
   * O(waypoints × zones).
   */
  filterAccessibleWaypoints<T extends Vec2>(waypoints: readonly T[]): T[] {
    return waypoints.filter((wp) => this.isAccessible(wp.x, wp.y));
  }
}
