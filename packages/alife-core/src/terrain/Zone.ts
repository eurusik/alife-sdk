/**
 * Base zone -- a named rectangular area in the world.
 *
 * Used as the foundation for SmartTerrain and other spatial constructs.
 */

import type { Vec2 } from '../core/Vec2';

export interface IZoneBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export class Zone {
  readonly id: string;
  readonly bounds: IZoneBounds;
  readonly dangerLevel: number;
  readonly metadata: ReadonlyMap<string, unknown>;
  private readonly _center: Vec2;

  constructor(
    id: string,
    bounds: IZoneBounds,
    dangerLevel = 0,
    metadata?: Record<string, unknown>,
  ) {
    this.id = id;
    this.bounds = bounds;
    this.dangerLevel = dangerLevel;
    this.metadata = new Map(Object.entries(metadata ?? {}));
    this._center = Object.freeze({
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
    });
  }

  /** Check whether a point lies within this zone's bounds. */
  contains(point: Vec2): boolean {
    return (
      point.x >= this.bounds.x &&
      point.x <= this.bounds.x + this.bounds.width &&
      point.y >= this.bounds.y &&
      point.y <= this.bounds.y + this.bounds.height
    );
  }

  /** The geometric center of the zone (cached, frozen). */
  get center(): Vec2 {
    return this._center;
  }
}
