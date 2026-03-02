/** Immutable 2D point / vector. All positions and directions in the SDK use this type. */
export interface Vec2 {
  /** Horizontal coordinate (px, rightward positive). */
  readonly x: number;
  /** Vertical coordinate (px, downward positive). */
  readonly y: number;
}

/** Frozen origin vector `{ x: 0, y: 0 }`. Safe to use as a default or sentinel. */
export const ZERO: Vec2 = Object.freeze({ x: 0, y: 0 });

/** Squared Euclidean distance. Prefer over distance() in hot loops to avoid sqrt. */
export function distanceSq(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/** Euclidean distance between two points. */
export function distance(a: Vec2, b: Vec2): number {
  return Math.sqrt(distanceSq(a, b));
}

/** Linear interpolation. t = 0 returns `a`, t = 1 returns `b`. */
export function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Component-wise subtraction (a − b). */
export function subtract(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** Length of the vector (distance from origin). */
export function magnitude(v: Vec2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

/** Unit vector in the same direction. Returns ZERO for zero-length input. */
export function normalize(v: Vec2): Vec2 {
  const mag = magnitude(v);
  if (mag === 0) return ZERO;
  return { x: v.x / mag, y: v.y / mag };
}

/** Component-wise addition. Returns a new Vec2. */
export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** Scalar multiplication. Returns a new Vec2. */
export function scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

/** Dot product of two vectors. */
export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * Angle of vector from +X axis in radians (-π, +π].
 * Returns 0 for the zero vector.
 * Replaces `Math.atan2(dy, dx)` pattern in state handlers.
 */
export function angle(v: Vec2): number {
  return Math.atan2(v.y, v.x);
}
