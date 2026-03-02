/**
 * Evaluate a Catmull-Rom spline at normalised parameter `t`.
 *
 * Pure replacement for `Phaser.Math.Interpolation.CatmullRom`.
 * Uses identical cubic basis coefficients — numerically compatible.
 *
 * @param values  1-D control points (call separately for X and Y).
 * @param t       Position along the spline, normalised to [0, 1].
 * @returns       Interpolated value at `t`.
 *
 * @example
 * ```ts
 * const xs = waypoints.map(p => p.x);
 * const ys = waypoints.map(p => p.y);
 * const smoothX = catmullRom(xs, 0.5);
 * const smoothY = catmullRom(ys, 0.5);
 * ```
 */
export function catmullRom(values: readonly number[], t: number): number {
  const n = values.length;
  if (n === 0) return 0;
  if (n === 1) return values[0];

  const last = n - 1;
  const k = Math.floor(t >= 1 ? last - 1 : t * last);

  const p0 = values[Math.max(0, k - 1)];
  const p1 = values[k];
  const p2 = values[Math.min(last, k + 1)];
  const p3 = values[Math.min(last, k + 2)];

  const u = t * last - k;

  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * u +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u +
    (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u
  );
}
