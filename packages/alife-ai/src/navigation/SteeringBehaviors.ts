// navigation/SteeringBehaviors.ts
// Pure functions for Craig Reynolds-style flocking / pack movement.
//
// Design principles:
//   • All functions are pure (no side effects, no ctx dependency).
//   • All accept and return Vec2 — no mutable state.
//   • combineForces() is the extensibility escape-hatch for custom force composition.
//   • Nothing is hardcoded — every threshold lives in ISteeringConfig.

import type { Vec2 } from '@alife-sdk/core';
import { ZERO, normalize, magnitude, subtract } from '@alife-sdk/core';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Tuning parameters for steering / flocking behaviors.
 * All fields have sensible defaults via {@link createDefaultSteeringConfig}.
 */
export interface ISteeringConfig {
  /** Minimum distance between agents before separation force kicks in (px). @default 40 */
  readonly separationRadius: number;

  /** Weight of the separation repulsion force. @default 1.5 */
  readonly separationWeight: number;

  /** Radius within which neighbors are considered for cohesion (px). @default 150 */
  readonly neighborRadius: number;

  /** Weight of the cohesion attraction force. @default 0.5 */
  readonly cohesionWeight: number;

  /** Weight of the alignment direction force (applied by caller via combineForces). @default 0.3 */
  readonly alignmentWeight: number;

  /** Maximum magnitude of the final combined steering force (px/s). @default 80 */
  readonly maxSteeringForce: number;
}

/**
 * Create an {@link ISteeringConfig} with production defaults.
 * Pass a partial override object to tune individual values without touching the rest.
 *
 * @example
 * const cfg = createDefaultSteeringConfig({ separationRadius: 60 });
 */
export function createDefaultSteeringConfig(
  overrides?: Partial<ISteeringConfig>,
): ISteeringConfig {
  return {
    separationRadius:  40,
    separationWeight:  1.5,
    neighborRadius:   150,
    cohesionWeight:    0.5,
    alignmentWeight:   0.3,
    maxSteeringForce:  80,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Primitive steering forces
// ---------------------------------------------------------------------------

/**
 * Compute the separation steering force — repulsion away from any neighbor
 * that is closer than {@link ISteeringConfig.separationRadius}.
 *
 * The force is inversely proportional to distance: the closer the neighbor,
 * the stronger the push.  Neighbors outside the radius are ignored.
 * Returns {@link ZERO} when `neighbors` is empty or none are within radius.
 *
 * @param self      - Position of the NPC computing the force.
 * @param neighbors - Positions of nearby agents (e.g. from getVisibleAllies()).
 * @param config    - Steering configuration.
 */
export function separation(
  self: Vec2,
  neighbors: readonly Vec2[],
  config: ISteeringConfig,
): Vec2 {
  let fx = 0;
  let fy = 0;
  const rSq = config.separationRadius * config.separationRadius;

  for (const n of neighbors) {
    const dx = self.x - n.x;
    const dy = self.y - n.y;
    const distSq = dx * dx + dy * dy;

    // Compare squared first to avoid sqrt for out-of-range neighbors.
    if (distSq === 0 || distSq >= rSq) continue;

    const dist = Math.sqrt(distSq);

    // Inverse-distance weighting: closer → stronger push
    const strength = 1 - dist / config.separationRadius;
    fx += (dx / dist) * strength;
    fy += (dy / dist) * strength;
  }

  if (fx === 0 && fy === 0) return ZERO;

  return normalize({ x: fx, y: fy });
}

/**
 * Compute the cohesion steering force — attraction toward the average position
 * (center of mass) of neighbors within {@link ISteeringConfig.neighborRadius}.
 *
 * Returns {@link ZERO} when `neighbors` is empty or none are within the radius.
 *
 * @param self      - Position of the NPC computing the force.
 * @param neighbors - Positions of nearby agents.
 * @param config    - Steering configuration.
 */
export function cohesion(
  self: Vec2,
  neighbors: readonly Vec2[],
  config: ISteeringConfig,
): Vec2 {
  let cx = 0;
  let cy = 0;
  let count = 0;

  const rSq = config.neighborRadius * config.neighborRadius;
  for (const n of neighbors) {
    const dx = n.x - self.x;
    const dy = n.y - self.y;
    if (dx * dx + dy * dy > rSq) continue;
    cx += n.x;
    cy += n.y;
    count++;
  }

  if (count === 0) return ZERO;

  const center: Vec2 = { x: cx / count, y: cy / count };
  const toCenter = subtract(center, self);
  const mag = magnitude(toCenter);
  return mag < 0.001 ? ZERO : normalize(toCenter);
}

/**
 * Compute the alignment steering force — the average of all provided desired
 * directions (normalized).
 *
 * **API note:** `self` is intentionally absent — alignment depends only on
 * neighbor directions, not on the caller's own position.  The caller is
 * responsible for computing `neighborDirections`
 * (e.g. `normalize(target − npcPos)` for each neighbor's target vector).
 *
 * The `alignmentWeight` from config is applied by the caller via
 * {@link combineForces}, consistent with how separation / cohesion weights work.
 *
 * Returns {@link ZERO} when `neighborDirections` is empty.
 *
 * @param neighborDirections - Desired movement directions of nearby agents.
 */
export function alignment(
  neighborDirections: readonly Vec2[],
): Vec2 {
  if (neighborDirections.length === 0) return ZERO;

  let ax = 0;
  let ay = 0;
  for (const d of neighborDirections) {
    ax += d.x;
    ay += d.y;
  }

  const avg: Vec2 = { x: ax / neighborDirections.length, y: ay / neighborDirections.length };
  const mag = magnitude(avg);
  return mag < 0.001 ? ZERO : normalize(avg);
}

/**
 * Compute a weighted sum of arbitrary steering forces, clamped to `maxMagnitude`.
 *
 * This is the **extensibility escape-hatch**: SDK users can compose any mix of
 * built-in forces (separation, cohesion, alignment) with their own custom forces
 * without modifying the SDK.
 *
 * @example
 * const combined = combineForces([
 *   { force: sep,         weight: cfg.separationWeight },
 *   { force: coh,         weight: cfg.cohesionWeight   },
 *   { force: myFormation, weight: 2.0                  },
 * ], cfg.maxSteeringForce);
 *
 * @param forces       - Array of `{ force, weight }` entries to blend.
 * @param maxMagnitude - Maximum allowed magnitude of the result (px/s).
 */
export function combineForces(
  forces: ReadonlyArray<{ force: Vec2; weight: number }>,
  maxMagnitude: number,
): Vec2 {
  let fx = 0;
  let fy = 0;

  for (const { force, weight } of forces) {
    fx += force.x * weight;
    fy += force.y * weight;
  }

  if (fx === 0 && fy === 0) return ZERO;

  const mag = Math.sqrt(fx * fx + fy * fy);
  if (mag <= maxMagnitude) return { x: fx, y: fy };

  const ratio = maxMagnitude / mag;
  return { x: fx * ratio, y: fy * ratio };
}

// ---------------------------------------------------------------------------
// Convenience combinations
// ---------------------------------------------------------------------------

/**
 * Compute the combined separation + cohesion steering force, clamped to
 * {@link ISteeringConfig.maxSteeringForce}.
 *
 * Does **not** include alignment — alignment requires caller-supplied desired
 * directions (see {@link alignment}).  Use {@link combineForces} to add it.
 *
 * Returns {@link ZERO} when `neighbors` is empty.
 *
 * @param self      - Position of the NPC.
 * @param neighbors - Positions of nearby agents.
 * @param config    - Steering configuration.
 */
export function computePackSteering(
  self: Vec2,
  neighbors: readonly Vec2[],
  config: ISteeringConfig,
): Vec2 {
  if (neighbors.length === 0) return ZERO;

  const sep = separation(self, neighbors, config);
  const coh = cohesion(self, neighbors, config);

  return combineForces(
    [
      { force: sep, weight: config.separationWeight },
      { force: coh, weight: config.cohesionWeight   },
    ],
    config.maxSteeringForce,
  );
}

/**
 * Blend a normalised primary movement direction with a computed steering force.
 *
 * Returns `{ vx, vy }` ready for `ctx.setVelocity()` — consistent with the
 * positional-tuple style used by `moveToward` / `awayFrom` in `_utils.ts`.
 *
 * The result is re-normalised to `speed` so the final magnitude is always
 * consistent regardless of the blend ratio.
 *
 * @param primaryVx    - Normalised X component of the desired direction (toward target, etc.).
 * @param primaryVy    - Normalised Y component of the desired direction.
 * @param steeringForce - Steering correction force (e.g. from computePackSteering).
 * @param speed         - Base movement speed (px/s).
 * @param weight        - Blend weight: 0 = pure primary × speed, 1 = pure steering.
 */
export function blendWithPrimary(
  primaryVx: number,
  primaryVy: number,
  steeringForce: Vec2,
  speed: number,
  weight: number,
): { vx: number; vy: number } {
  // Normalise steering to a unit direction so `weight` controls directional split
  // independently of the force magnitude (0..maxSteeringForce).
  const smag = Math.sqrt(steeringForce.x * steeringForce.x + steeringForce.y * steeringForce.y);
  const sdx = smag < 0.001 ? primaryVx : steeringForce.x / smag;
  const sdy = smag < 0.001 ? primaryVy : steeringForce.y / smag;

  // Blend normalised directions. primaryVx/Vy are expected to be normalised by the caller.
  const rx = primaryVx * (1 - weight) + sdx * weight;
  const ry = primaryVy * (1 - weight) + sdy * weight;
  const mag = Math.sqrt(rx * rx + ry * ry);

  if (mag < 0.001) return { vx: 0, vy: 0 };

  return { vx: (rx / mag) * speed, vy: (ry / mag) * speed };
}
