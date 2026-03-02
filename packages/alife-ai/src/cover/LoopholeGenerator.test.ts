import { describe, it, expect } from 'vitest';
import { LoopholeGenerator, findBestLoophole } from './LoopholeGenerator';
import type { ICoverPoint, ILoophole } from '../types/ICoverPoint';
import { createDefaultAIConfig } from '../config/createDefaultAIConfig';

const config = createDefaultAIConfig().cover;

function createSeededRandom(values: number[]) {
  let idx = 0;
  return { next: () => values[idx++ % values.length] };
}

function makeCover(id: string, x = 0, y = 0): ICoverPoint {
  return { id, x, y, radius: 24, occupiedBy: null, loopholes: [] };
}

describe('LoopholeGenerator', () => {
  it('generates at least 1 loophole per cover point', () => {
    const gen = new LoopholeGenerator(config, createSeededRandom([0]));
    const loopholes = gen.getLoopholes(makeCover('c1'));
    expect(loopholes.length).toBeGreaterThanOrEqual(1);
  });

  it('generates at most maxPerCover loopholes', () => {
    const gen = new LoopholeGenerator(config, createSeededRandom([0.99, 0, 0.5, 0.5, 0.5, 0.5]));
    const loopholes = gen.getLoopholes(makeCover('c1'));
    expect(loopholes.length).toBeLessThanOrEqual(config.loopholeMaxPerCover);
  });

  it('caches results for the same cover ID', () => {
    const gen = new LoopholeGenerator(config, createSeededRandom([0.5, 0.3, 0.2]));
    const cover = makeCover('c1');
    const first = gen.getLoopholes(cover);
    const second = gen.getLoopholes(cover);
    expect(first).toBe(second);
  });

  it('generates different results for different cover IDs', () => {
    const gen = new LoopholeGenerator(config, createSeededRandom([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]));
    const a = gen.getLoopholes(makeCover('c1'));
    const b = gen.getLoopholes(makeCover('c2'));
    expect(a).not.toBe(b);
  });

  it('loophole offsets respect configured distance', () => {
    const gen = new LoopholeGenerator(config, createSeededRandom([0.5, 0.5, 0.5]));
    const loopholes = gen.getLoopholes(makeCover('c1'));

    for (const lh of loopholes) {
      const dist = Math.sqrt(lh.offsetX ** 2 + lh.offsetY ** 2);
      expect(dist).toBeCloseTo(config.loopholeOffsetDistance, 5);
    }
  });

  it('fire arcs have correct width', () => {
    const gen = new LoopholeGenerator(config, createSeededRandom([0.5, 0.5, 0.5]));
    const loopholes = gen.getLoopholes(makeCover('c1'));

    for (const lh of loopholes) {
      const arcWidth = lh.angleMax - lh.angleMin;
      expect(arcWidth).toBeCloseTo(config.loopholeFireArc, 5);
    }
  });

  it('clearCache forces regeneration', () => {
    const gen = new LoopholeGenerator(config, createSeededRandom([0.5, 0.3, 0.2, 0.1, 0.4, 0.6]));
    const cover = makeCover('c1');
    const first = gen.getLoopholes(cover);
    gen.clearCache();
    const second = gen.getLoopholes(cover);
    expect(first).not.toBe(second);
  });
});

describe('findBestLoophole', () => {
  it('returns null for empty loopholes', () => {
    expect(findBestLoophole([], 0, 0, 100, 0)).toBeNull();
  });

  it('returns loophole when enemy is within arc', () => {
    const lh: ILoophole = {
      offsetX: 16,
      offsetY: 0,
      angleMin: -Math.PI / 6,
      angleMax: Math.PI / 6,
    };
    // Enemy to the right (angle ~0), within the arc.
    const result = findBestLoophole([lh], 0, 0, 100, 0);
    expect(result).toBe(lh);
  });

  it('returns null when enemy is outside all arcs', () => {
    const lh: ILoophole = {
      offsetX: 16,
      offsetY: 0,
      angleMin: -Math.PI / 12,
      angleMax: Math.PI / 12,
    };
    // Enemy straight up (angle = PI/2), well outside a ±15° arc at angle 0.
    const result = findBestLoophole([lh], 0, 0, 0, 100);
    expect(result).toBeNull();
  });

  it('selects the loophole with arc closest to enemy angle', () => {
    const right: ILoophole = {
      offsetX: 16,
      offsetY: 0,
      angleMin: -Math.PI / 3,
      angleMax: Math.PI / 3,
    };
    const left: ILoophole = {
      offsetX: -16,
      offsetY: 0,
      angleMin: Math.PI - Math.PI / 3,
      angleMax: Math.PI + Math.PI / 3,
    };
    // Enemy to the right — should pick the right loophole.
    const result = findBestLoophole([right, left], 0, 0, 100, 0);
    expect(result).toBe(right);
  });

  it('handles angle wrap-around near ±PI', () => {
    const lh: ILoophole = {
      offsetX: -16,
      offsetY: 0,
      // Arc centered at PI, spanning ±60° — covers angles near ±PI.
      angleMin: Math.PI - Math.PI / 3,
      angleMax: Math.PI + Math.PI / 3,
    };
    // Enemy to the left (angle = PI).
    const result = findBestLoophole([lh], 0, 0, -100, 0);
    expect(result).toBe(lh);
  });
});
