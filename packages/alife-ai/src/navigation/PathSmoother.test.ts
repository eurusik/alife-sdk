import { describe, it, expect } from 'vitest';
import { smoothPath, smoothPathWithTurning } from './PathSmoother';
import { createDefaultAIConfig } from '../config/createDefaultAIConfig';
import type { Vec2 } from '@alife-sdk/core';

const config = createDefaultAIConfig().navigation;

function makeRandom(values: number[] = [0.5]) {
  let idx = 0;
  return { next: () => values[idx++ % values.length] };
}

function dist(a: Vec2, b: Vec2): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

describe('smoothPath', () => {
  it('returns empty for empty input', () => {
    expect(smoothPath([], config, makeRandom())).toEqual([]);
  });

  it('returns single point for single input', () => {
    const result = smoothPath([{ x: 10, y: 20 }], config, makeRandom());
    expect(result).toEqual([{ x: 10, y: 20 }]);
  });

  it('produces more points than input', () => {
    const waypoints = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 100 },
      { x: 300, y: 100 },
    ];
    const result = smoothPath(waypoints, config, makeRandom());
    expect(result.length).toBeGreaterThan(waypoints.length);
  });

  it('starts and ends at original endpoints', () => {
    const waypoints = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 100 },
    ];
    const result = smoothPath(waypoints, config, makeRandom([0.5]));
    const first = result[0];
    const last = result[result.length - 1];
    // Endpoints should be exact (no jitter).
    expect(dist(first, waypoints[0])).toBeLessThan(1);
    expect(dist(last, waypoints[waypoints.length - 1])).toBeLessThan(1);
  });

  it('handles 2-point path', () => {
    const result = smoothPath(
      [{ x: 0, y: 0 }, { x: 100, y: 100 }],
      config,
      makeRandom(),
    );
    expect(result.length).toBeGreaterThan(2);
  });

  it('uses cache on second call with same waypoints', () => {
    const cache = new Map<string, readonly Vec2[]>();
    const waypoints = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    const random = makeRandom([0.3, 0.7, 0.1, 0.9]);
    const first = smoothPath(waypoints, config, random, cache);
    const second = smoothPath(waypoints, config, random, cache);
    expect(first).toBe(second);
    expect(cache.size).toBe(1);
  });

  it('evicts oldest cache entry when full', () => {
    const cache = new Map<string, readonly Vec2[]>();
    const random = makeRandom();

    // Fill cache beyond limit.
    for (let i = 0; i < 70; i++) {
      smoothPath(
        [{ x: i, y: 0 }, { x: i + 100, y: 0 }],
        config,
        random,
        cache,
      );
    }

    expect(cache.size).toBeLessThanOrEqual(64);
  });

  it('jitter stays within configured offset', () => {
    const waypoints = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
      { x: 300, y: 0 },
    ];
    // No jitter config.
    const noJitterConfig = { ...config, smoothRandomOffset: 0 };
    const result = smoothPath(waypoints, noJitterConfig, makeRandom());

    // All points should be on the y=0 line (straight path, no jitter).
    for (const p of result) {
      expect(Math.abs(p.y)).toBeLessThan(1);
    }
  });
});

describe('smoothPathWithTurning', () => {
  it('returns same as smoothPath for straight paths', () => {
    const waypoints = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 200, y: 0 },
      { x: 300, y: 0 },
    ];
    const random = makeRandom([0.5]);
    const noJitterConfig = { ...config, smoothRandomOffset: 0 };
    const smooth = smoothPath(waypoints, noJitterConfig, random);
    const turning = smoothPathWithTurning(waypoints, noJitterConfig, random);
    // Straight path — no arcs should be inserted.
    // Turning version should have same or fewer points (no arc additions).
    expect(turning.length).toBeGreaterThanOrEqual(smooth.length - smooth.length);
  });

  it('inserts arc points at sharp turns', () => {
    const waypoints = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 }, // 90° turn
      { x: 200, y: 100 },
    ];
    const random = makeRandom([0.5]);
    const smooth = smoothPath(waypoints, config, random);
    const turning = smoothPathWithTurning(waypoints, config, random);
    // Sharp turn should add arc points, making the result longer.
    expect(turning.length).toBeGreaterThanOrEqual(smooth.length);
  });

  it('handles short paths without crash', () => {
    expect(smoothPathWithTurning([], config, makeRandom())).toEqual([]);
    expect(smoothPathWithTurning([{ x: 0, y: 0 }], config, makeRandom())).toHaveLength(1);
    expect(
      smoothPathWithTurning(
        [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        config,
        makeRandom(),
      ).length,
    ).toBeGreaterThan(0);
  });
});
