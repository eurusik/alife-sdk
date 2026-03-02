import type { Vec2 } from '../Vec2';

/**
 * Returns true if the segment from `p1` to `p2` intersects or touches the
 * axis-aligned rectangle defined by its top-left corner `(rx, ry)` and size
 * `(rw, rh)`.
 *
 * Uses the 2-D parametric slab method — O(1), no sqrt, no allocations.
 *
 * @example
 * ```ts
 * // Wall at (100, 200) sized 50×10
 * segmentIntersectsRect({ x: 0, y: 205 }, { x: 200, y: 205 }, 100, 200, 50, 10); // true
 * segmentIntersectsRect({ x: 0, y: 220 }, { x: 200, y: 220 }, 100, 200, 50, 10); // false
 * ```
 */
export function segmentIntersectsRect(
  p1: Vec2,
  p2: Vec2,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): boolean {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  let tmin = 0;
  let tmax = 1;

  // ── X slab ──────────────────────────────────────────────────────────────────
  if (Math.abs(dx) < 1e-10) {
    const xmin = rx < rx + rw ? rx : rx + rw;
    const xmax = rx < rx + rw ? rx + rw : rx;
    if (p1.x < xmin || p1.x > xmax) return false;
  } else {
    const inv = 1 / dx;
    const t1 = (rx - p1.x) * inv;
    const t2 = (rx + rw - p1.x) * inv;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
    if (tmin > tmax) return false;
  }

  // ── Y slab ──────────────────────────────────────────────────────────────────
  if (Math.abs(dy) < 1e-10) {
    const ymin = ry < ry + rh ? ry : ry + rh;
    const ymax = ry < ry + rh ? ry + rh : ry;
    if (p1.y < ymin || p1.y > ymax) return false;
  } else {
    const inv = 1 / dy;
    const t1 = (ry - p1.y) * inv;
    const t2 = (ry + rh - p1.y) * inv;
    tmin = Math.max(tmin, Math.min(t1, t2));
    tmax = Math.min(tmax, Math.max(t1, t2));
    if (tmin > tmax) return false;
  }

  return true;
}

/**
 * Returns true if the segment from `p1` to `p2` intersects or touches the
 * circle at `center` with the given `radius`.
 *
 * Projects the center onto the segment (clamped to [0, 1]) and checks the
 * squared distance — no sqrt needed for the intersection test.
 *
 * @example
 * ```ts
 * // Circular pillar at (150, 150) radius 30
 * segmentIntersectsCircle({ x: 0, y: 150 }, { x: 300, y: 150 }, { x: 150, y: 150 }, 30); // true
 * segmentIntersectsCircle({ x: 0, y: 190 }, { x: 300, y: 190 }, { x: 150, y: 150 }, 30); // false
 * ```
 */
export function segmentIntersectsCircle(
  p1: Vec2,
  p2: Vec2,
  center: Vec2,
  radius: number,
): boolean {
  if (radius <= 0) return false;

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const lenSq = dx * dx + dy * dy;

  let t: number;
  if (lenSq < 1e-10) {
    // Degenerate segment — treat as a point
    t = 0;
  } else {
    t = ((center.x - p1.x) * dx + (center.y - p1.y) * dy) / lenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
  }

  const closestX = p1.x + t * dx;
  const closestY = p1.y + t * dy;
  const ex = center.x - closestX;
  const ey = center.y - closestY;
  return ex * ex + ey * ey <= radius * radius;
}
