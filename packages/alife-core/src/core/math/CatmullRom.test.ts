import { describe, it, expect } from 'vitest';
import { catmullRom } from './CatmullRom';

describe('catmullRom', () => {
  it('returns 0 for empty array', () => {
    expect(catmullRom([], 0.5)).toBe(0);
  });

  it('returns the single value for 1-element array', () => {
    expect(catmullRom([42], 0.5)).toBe(42);
  });

  it('passes through first control point at t=0', () => {
    expect(catmullRom([0, 10, 20, 30], 0)).toBeCloseTo(0, 5);
  });

  it('passes through last control point at t=1', () => {
    expect(catmullRom([0, 10, 20, 30], 1)).toBeCloseTo(30, 5);
  });

  it('interpolates smoothly between values', () => {
    const mid = catmullRom([0, 10, 20, 30], 0.5);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(30);
  });

  it('returns exact midpoint for 2-element linear case', () => {
    expect(catmullRom([0, 10], 0.5)).toBeCloseTo(5, 4);
  });

  it('is monotonic for monotonically increasing values', () => {
    const values = [0, 10, 20, 30, 40];
    const v1 = catmullRom(values, 0.25);
    const v2 = catmullRom(values, 0.5);
    const v3 = catmullRom(values, 0.75);
    expect(v1).toBeLessThan(v2);
    expect(v2).toBeLessThan(v3);
  });
});
