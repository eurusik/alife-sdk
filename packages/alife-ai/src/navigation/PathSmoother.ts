// navigation/PathSmoother.ts
// Immutable path smoothing pipeline using CatmullRom splines.
// Pure functions + FIFO cache — no framework dependencies.

import type { Vec2, IRandom } from '@alife-sdk/core';
import { catmullRom } from '@alife-sdk/core';
import type { INavigationConfig } from '../types/IOnlineAIConfig';

const MAX_CACHE_ENTRIES = 64;

// Module-level scratch arrays — reused across smoothPath calls (single-threaded)
const _scratchXs: number[] = [];
const _scratchYs: number[] = [];

/**
 * Pad waypoints to meet the CatmullRom minimum of 4 control points.
 * Duplicates endpoints as necessary.
 */
function padWaypoints(pts: readonly Vec2[]): readonly Vec2[] {
  if (pts.length >= 4) return pts;
  if (pts.length === 1) return [pts[0], pts[0], pts[0], pts[0]];
  if (pts.length === 2) return [pts[0], pts[0], pts[1], pts[1]];
  // pts.length === 3
  return [pts[0], pts[0], pts[1], pts[2]];
}

/**
 * Build a cache key from waypoint coordinates.
 * Rounds to 1 decimal to absorb floating-point noise.
 */
function cacheKey(pts: readonly Vec2[]): string {
  let key = '';
  for (const p of pts) {
    key += `${p.x.toFixed(1)},${p.y.toFixed(1)};`;
  }
  return key;
}

/**
 * Generate a smooth path from sparse waypoints using CatmullRom interpolation.
 *
 * Interior points receive deterministic jitter for natural feel.
 * Results are cached (FIFO eviction at 64 entries).
 *
 * @param waypoints - Sparse control points (at least 1).
 * @param config - Navigation tuning (pointsPerSegment, smoothRandomOffset).
 * @param random - Seeded random source for deterministic jitter.
 * @param cache - Optional shared cache instance.
 * @returns Dense smooth path including exact start/end.
 */
export function smoothPath(
  waypoints: readonly Vec2[],
  config: INavigationConfig,
  random: IRandom,
  cache?: Map<string, readonly Vec2[]>,
): readonly Vec2[] {
  if (waypoints.length === 0) return [];
  if (waypoints.length === 1) return [waypoints[0]];

  const key = cacheKey(waypoints);
  if (cache) {
    const cached = cache.get(key);
    if (cached) return cached;
  }

  const padded = padWaypoints(waypoints);
  _scratchXs.length = 0;
  _scratchYs.length = 0;
  for (const p of padded) {
    _scratchXs.push(p.x);
    _scratchYs.push(p.y);
  }
  const xs = _scratchXs;
  const ys = _scratchYs;

  const segmentCount = padded.length - 1;
  const totalSteps = segmentCount * config.smoothPointsPerSegment + 1;
  const points: Vec2[] = [];

  for (let i = 0; i < totalSteps; i++) {
    const t = i / (totalSteps - 1);
    let x = catmullRom(xs, t);
    let y = catmullRom(ys, t);

    // Apply jitter to interior points only.
    if (i > 0 && i < totalSteps - 1 && config.smoothRandomOffset > 0) {
      x += (random.next() - 0.5) * 2 * config.smoothRandomOffset;
      y += (random.next() - 0.5) * 2 * config.smoothRandomOffset;
    }

    points.push({ x, y });
  }

  if (cache) {
    cache.set(key, points);
    if (cache.size > MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
  }

  return points;
}

/**
 * Enhance a smooth path with Dubins-style arcs at sharp turns.
 *
 * Turns exceeding `dubinsMaxInstantTurn` get replaced with circular
 * arc approximations for realistic movement.
 *
 * @param waypoints - Sparse control points.
 * @param config - Navigation tuning.
 * @param random - Seeded random for smooth path generation.
 * @param cache - Optional smooth path cache.
 * @returns Path with arc insertions at sharp turns.
 */
export function smoothPathWithTurning(
  waypoints: readonly Vec2[],
  config: INavigationConfig,
  random: IRandom,
  cache?: Map<string, readonly Vec2[]>,
): readonly Vec2[] {
  const base = smoothPath(waypoints, config, random, cache);
  if (base.length < 3) return base;

  const ARC_SUBDIVISIONS = 6;
  const result: Vec2[] = [base[0]];

  for (let i = 1; i < base.length - 1; i++) {
    const a = base[i - 1];
    const b = base[i];
    const c = base[i + 1];

    // Compute segment vectors and lengths once — shared by both
    // the turn-angle check and the arc construction below.
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;

    const abLen = Math.sqrt(abx * abx + aby * aby);
    const bcLen = Math.sqrt(bcx * bcx + bcy * bcy);

    if (abLen < 1e-6 || bcLen < 1e-6) {
      result.push(b);
      continue;
    }

    // Turn angle (inlined to reuse abLen/bcLen).
    const abNx = abx / abLen;
    const abNy = aby / abLen;
    const bcNx = bcx / bcLen;
    const bcNy = bcy / bcLen;

    const dot = abNx * bcNx + abNy * bcNy;
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));

    if (angle <= config.dubinsMaxInstantTurn) {
      result.push(b);
      continue;
    }

    // Insert arc at sharp turn.
    const halfAngle = angle / 2;
    const sinHalf = Math.sin(halfAngle);
    if (sinHalf < 1e-6) {
      result.push(b);
      continue;
    }

    // Bisector points away from the turn.
    let bisX = abNx + bcNx;
    let bisY = abNy + bcNy;
    const bisLen = Math.sqrt(bisX * bisX + bisY * bisY);
    if (bisLen < 1e-6) {
      result.push(b);
      continue;
    }
    bisX /= bisLen;
    bisY /= bisLen;

    const centerDist = config.dubinsTurningRadius / sinHalf;
    const cx = b.x + bisX * centerDist;
    const cy = b.y + bisY * centerDist;

    // Compute start/end angles of the arc.
    const startAngle = Math.atan2(a.y - cy, a.x - cx);
    const endAngle = Math.atan2(c.y - cy, c.x - cx);

    // Signed sweep from startAngle to endAngle — same formula for both turn directions.
    // Wrap to [-π, π] so the arc always takes the short path across the ±π boundary.
    let sweep = endAngle - startAngle;
    if (sweep > Math.PI) sweep -= 2 * Math.PI;
    if (sweep < -Math.PI) sweep += 2 * Math.PI;

    for (let s = 1; s <= ARC_SUBDIVISIONS; s++) {
      const t = s / (ARC_SUBDIVISIONS + 1);
      const arcAngle = startAngle + sweep * t;
      result.push({
        x: cx + Math.cos(arcAngle) * config.dubinsTurningRadius,
        y: cy + Math.sin(arcAngle) * config.dubinsTurningRadius,
      });
    }
  }

  result.push(base[base.length - 1]);
  return result;
}
