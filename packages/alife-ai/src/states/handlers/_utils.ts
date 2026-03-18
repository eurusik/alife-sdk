// states/handlers/_utils.ts
// Internal utility helpers shared by state handlers.
// NOT exported from the handlers barrel — internal implementation detail.

import type { INPCContext } from '../INPCContext';
import { computePackSteering, blendWithPrimary, createDefaultSteeringConfig } from '../../navigation/SteeringBehaviors';
import type { ISteeringConfig } from '../../navigation/SteeringBehaviors';

/**
 * Return the Euclidean distance between two world positions.
 */
export function distanceTo(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Return the angle in radians from (ax, ay) toward (bx, by).
 * 0 = right, π/2 = down (screen-space Y is positive downward).
 */
export function angleToward(ax: number, ay: number, bx: number, by: number): number {
  return Math.atan2(by - ay, bx - ax);
}

/** Default steering config for moveToward separation. */
const MOVE_STEERING = createDefaultSteeringConfig({ separationRadius: 48, separationWeight: 1.8 });

/**
 * Set the NPC's velocity so it moves toward (targetX, targetY) at the given
 * speed (px/s). Also updates the NPC's rotation to face the target.
 *
 * Applies separation from nearby allies (via perception) to prevent NPC stacking.
 *
 * If the NPC is already within 0.5 px of the target, velocity is zeroed to
 * avoid jitter; no rotation change is applied.
 */
export function moveToward(
  ctx: INPCContext,
  targetX: number,
  targetY: number,
  speed: number,
): void {
  const dx = targetX - ctx.x;
  const dy = targetY - ctx.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 0.5) {
    ctx.halt();
    return;
  }

  const ndx = dx / dist;
  const ndy = dy / dist;

  // Apply separation from nearby allies to prevent NPC stacking
  const allies = ctx.perception?.getVisibleAllies() ?? [];
  if (allies.length > 0) {
    applyPackSteering(ctx, allies, MOVE_STEERING, ndx, ndy, speed, 0.3);
  } else {
    ctx.setVelocity(ndx * speed, ndy * speed);
    ctx.setRotation(Math.atan2(dy, dx));
  }
}

/**
 * Move an NPC along a pathfinding-computed route, falling back to direct
 * movement if no pathfinding system is available.
 *
 * When `ctx.pathfinding` is present:
 *   1. If not currently navigating, computes a new path to (targetX, targetY).
 *   2. Reads the next waypoint from the path cursor.
 *   3. Moves toward that waypoint using `moveToward()` (which applies steering).
 *
 * When `ctx.pathfinding` is null:
 *   Falls back to `moveToward(ctx, targetX, targetY, speed)` — direct movement.
 *
 * **Path lifecycle:** `findPath()` is called only when `isNavigating()` returns
 * false (path complete or not started). The host's `IPathfindingAccess` implementation
 * is responsible for detecting when the target has moved significantly and invalidating
 * the current path by returning `isNavigating() === false`.
 *
 * Handlers can use this as a drop-in replacement for `moveToward()` to gain
 * obstacle avoidance without changing their logic.
 */
export function moveAlongPath(
  ctx: INPCContext,
  targetX: number,
  targetY: number,
  speed: number,
): void {
  if (ctx.pathfinding) {
    // Start a new path if not currently navigating.
    if (!ctx.pathfinding.isNavigating()) {
      ctx.pathfinding.findPath(targetX, targetY);
    }

    // Follow the next waypoint.
    const wp = ctx.pathfinding.getNextWaypoint();
    if (wp) {
      moveToward(ctx, wp.x, wp.y, speed);
      return;
    }
  }

  // Fallback: direct straight-line movement (existing behavior).
  moveToward(ctx, targetX, targetY, speed);
}

/**
 * Set the NPC's velocity so it moves directly away from (fromX, fromY) at the
 * given speed (px/s). Also updates the NPC's rotation to face away.
 *
 * If the NPC is exactly on top of (fromX, fromY), a default escape direction
 * (positive X) is used instead.
 */
export function awayFrom(
  ctx: INPCContext,
  fromX: number,
  fromY: number,
  speed: number,
): void {
  const dx = ctx.x - fromX;
  const dy = ctx.y - fromY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist < 0.5) {
    // Standing exactly on the threat — escape along positive X by default.
    ctx.setVelocity(speed, 0);
    ctx.setRotation(0);
    return;
  }

  ctx.setVelocity((dx / dist) * speed, (dy / dist) * speed);
  ctx.setRotation(Math.atan2(dy, dx));
}

/**
 * Opt-in convenience helper: computes pack steering (separation + cohesion) from
 * nearby ally positions and blends it with a primary movement direction before
 * calling `ctx.setVelocity()` and `ctx.setRotation()`.
 *
 * State handlers that want group-aware movement call this instead of
 * `moveToward()` when allies are visible.
 *
 * For advanced scenarios (custom forces, alignment, formation) use the
 * composable primitives directly:
 * `computePackSteering() + combineForces() + blendWithPrimary()`
 *
 * @param ctx          - NPC context (provides position and setVelocity/setRotation).
 * @param allies       - Nearby ally positions (e.g. from ctx.perception.getVisibleAllies()).
 * @param config       - Steering configuration.
 * @param primaryVx    - Normalised X component of the desired movement direction.
 * @param primaryVy    - Normalised Y component of the desired movement direction.
 * @param speed        - Base movement speed (px/s).
 * @param weight       - Blend weight for the steering force [0..1]. @default 0.35
 */
export function applyPackSteering(
  ctx: INPCContext,
  allies: ReadonlyArray<{ x: number; y: number }>,
  config: ISteeringConfig,
  primaryVx: number,
  primaryVy: number,
  speed: number,
  weight = 0.35,
): void {
  const self = { x: ctx.x, y: ctx.y };
  const force = computePackSteering(self, allies, config);
  const { vx, vy } = blendWithPrimary(primaryVx, primaryVy, force, speed, weight);
  ctx.setVelocity(vx, vy);
  ctx.setRotation(Math.atan2(vy, vx));
}

// Re-export so handlers can build the config once in their constructor
// without importing directly from '../../navigation/SteeringBehaviors'.
export { createDefaultSteeringConfig };
export type { ISteeringConfig };
