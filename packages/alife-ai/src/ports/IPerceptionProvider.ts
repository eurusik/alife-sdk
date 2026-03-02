// ports/IPerceptionProvider.ts
// Port interface for entity perception data from the host.

import type { Vec2 } from '@alife-sdk/core';
import type { IPerceivedEntity } from '../types/IPerceptionTypes';

/**
 * Port providing spatial entity queries for perception.
 *
 * The host implements this to bridge between the game's entity storage
 * (e.g. Phaser sprites, ECS, etc.) and the SDK's pure perception queries.
 *
 * @example
 * ```ts
 * // Host implementation using Phaser scene
 * const provider: IPerceptionProvider = {
 *   getEntitiesInRadius(center, radius) {
 *     return scene.physics.overlapCirc(center.x, center.y, radius)
 *       .map(body => ({
 *         entityId: body.gameObject.getData('npcId'),
 *         position: { x: body.x, y: body.y },
 *         factionId: body.gameObject.getData('factionId'),
 *         isAlive: body.gameObject.active,
 *       }));
 *   },
 *   isLineOfSightClear(from, to) {
 *     // Raycast using physics engine
 *     return !scene.physics.world.raycast(from, to).hasHit;
 *   },
 * };
 * ```
 */
export interface IPerceptionProvider {
  /**
   * Get all perceivable entities within a radius.
   * Used for both vision and hearing queries.
   */
  getEntitiesInRadius(center: Vec2, radius: number): readonly IPerceivedEntity[];

  /**
   * Check if there is a clear line of sight between two points.
   * Used to refine vision checks (walls, obstacles).
   * Optional — if not provided, LOS is assumed clear.
   */
  isLineOfSightClear?(from: Vec2, to: Vec2): boolean;
}
