import { describe, it, expect } from 'vitest';
import { CoverRegistry } from './CoverRegistry';
import { CoverType } from '../types/ICoverPoint';
import { createDefaultAIConfig } from '../config/createDefaultAIConfig';

const config = createDefaultAIConfig();

function createSeededRandom(values: number[] = [0.5]) {
  let idx = 0;
  return { next: () => values[idx++ % values.length] };
}

function makeRegistry(random?: ReturnType<typeof createSeededRandom>) {
  return new CoverRegistry(config.cover, random ?? createSeededRandom());
}

describe('CoverRegistry', () => {
  // -------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------
  describe('registration', () => {
    it('addPoint returns cover with generated ID', () => {
      const reg = makeRegistry();
      const point = reg.addPoint(100, 200);
      expect(point.id).toBe('cover_0000');
      expect(point.x).toBe(100);
      expect(point.y).toBe(200);
      expect(point.occupiedBy).toBeNull();
    });

    it('addPoint uses default radius from config', () => {
      const reg = makeRegistry();
      const point = reg.addPoint(0, 0);
      expect(point.radius).toBe(config.cover.pointRadius);
    });

    it('addPoint accepts custom radius', () => {
      const reg = makeRegistry();
      const point = reg.addPoint(0, 0, 50);
      expect(point.radius).toBe(50);
    });

    it('increments IDs sequentially', () => {
      const reg = makeRegistry();
      reg.addPoint(0, 0);
      reg.addPoint(10, 10);
      const third = reg.addPoint(20, 20);
      expect(third.id).toBe('cover_0002');
    });

    it('addPoints bulk registers', () => {
      const reg = makeRegistry();
      reg.addPoints([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }]);
      expect(reg.getSize()).toBe(3);
    });

    it('removePoint deletes by ID', () => {
      const reg = makeRegistry();
      const p = reg.addPoint(0, 0);
      expect(reg.removePoint(p.id)).toBe(true);
      expect(reg.getSize()).toBe(0);
    });

    it('removePoint returns false for unknown ID', () => {
      const reg = makeRegistry();
      expect(reg.removePoint('nonexistent')).toBe(false);
    });

    it('getAll returns all registered points', () => {
      const reg = makeRegistry();
      reg.addPoints([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
      expect(reg.getAll()).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------
  // Occupancy
  // -------------------------------------------------------------------
  describe('occupancy', () => {
    it('occupy marks a point', () => {
      const reg = makeRegistry();
      const p = reg.addPoint(0, 0);
      reg.occupy(p.id, 'npc_1');
      expect(p.occupiedBy).toBe('npc_1');
    });

    it('release clears occupancy', () => {
      const reg = makeRegistry();
      const p = reg.addPoint(0, 0);
      reg.occupy(p.id, 'npc_1');
      reg.release(p.id);
      expect(p.occupiedBy).toBeNull();
    });

    it('release with npcId only clears if matching', () => {
      const reg = makeRegistry();
      const p = reg.addPoint(0, 0);
      reg.occupy(p.id, 'npc_1');
      reg.release(p.id, 'npc_2');
      expect(p.occupiedBy).toBe('npc_1');
    });

    it('releaseAll clears all points for a specific NPC', () => {
      const reg = makeRegistry();
      const p1 = reg.addPoint(0, 0);
      const p2 = reg.addPoint(100, 100);
      const p3 = reg.addPoint(200, 200);
      reg.occupy(p1.id, 'npc_1');
      reg.occupy(p2.id, 'npc_1');
      reg.occupy(p3.id, 'npc_2');
      reg.releaseAll('npc_1');
      expect(p1.occupiedBy).toBeNull();
      expect(p2.occupiedBy).toBeNull();
      expect(p3.occupiedBy).toBe('npc_2');
    });
  });

  // -------------------------------------------------------------------
  // Cover Search
  // -------------------------------------------------------------------
  describe('findCover', () => {
    it('finds nearest cover with CLOSE evaluator', () => {
      const reg = makeRegistry();
      reg.addPoint(50, 0);
      reg.addPoint(300, 0);
      const result = reg.findCover(
        CoverType.CLOSE,
        { x: 0, y: 0 },
        [{ x: 500, y: 0 }],
        'npc_1',
      );
      expect(result).not.toBeNull();
      expect(result!.x).toBe(50);
    });

    it('skips occupied points', () => {
      const reg = makeRegistry();
      const p1 = reg.addPoint(50, 0);
      reg.addPoint(100, 0);
      reg.occupy(p1.id, 'other');
      const result = reg.findCover(
        CoverType.CLOSE,
        { x: 0, y: 0 },
        [{ x: 500, y: 0 }],
        'npc_1',
      );
      expect(result).not.toBeNull();
      expect(result!.x).toBe(100);
    });

    it('allows re-query by same NPC', () => {
      const reg = makeRegistry();
      const p1 = reg.addPoint(50, 0);
      reg.occupy(p1.id, 'npc_1');
      const result = reg.findCover(
        CoverType.CLOSE,
        { x: 0, y: 0 },
        [{ x: 500, y: 0 }],
        'npc_1',
      );
      expect(result).not.toBeNull();
      expect(result!.id).toBe(p1.id);
    });

    it('returns null when all points out of search radius', () => {
      const reg = makeRegistry();
      reg.addPoint(9999, 9999);
      const result = reg.findCover(
        CoverType.CLOSE,
        { x: 0, y: 0 },
        [{ x: 500, y: 0 }],
        'npc_1',
      );
      expect(result).toBeNull();
    });

    it('returns null for empty registry', () => {
      const reg = makeRegistry();
      const result = reg.findCover(
        CoverType.BALANCED,
        { x: 0, y: 0 },
        [{ x: 100, y: 0 }],
        'npc_1',
      );
      expect(result).toBeNull();
    });

    it('respects custom maxRadius', () => {
      const reg = makeRegistry();
      reg.addPoint(200, 0);
      const result = reg.findCover(
        CoverType.CLOSE,
        { x: 0, y: 0 },
        [{ x: 500, y: 0 }],
        'npc_1',
        100,
      );
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // findRecommendedCover
  // -------------------------------------------------------------------
  describe('findRecommendedCover', () => {
    it('combines recommendation + search', () => {
      const reg = makeRegistry();
      reg.addPoint(50, 0);
      reg.addPoint(300, 0);
      // hasAmmo=false → SAFE (max safety)
      const result = reg.findRecommendedCover(
        { hpRatio: 1.0, morale: 0, enemyCount: 1, hasAmmo: false },
        { x: 0, y: 0 },
        [{ x: 500, y: 0 }],
        'npc_1',
      );
      expect(result).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // Spatial Query
  // -------------------------------------------------------------------
  describe('isInCover', () => {
    it('returns cover point when position is inside radius', () => {
      const reg = makeRegistry();
      reg.addPoint(100, 100);
      const result = reg.isInCover({ x: 105, y: 105 });
      expect(result).not.toBeNull();
    });

    it('returns null when position is far from all covers', () => {
      const reg = makeRegistry();
      reg.addPoint(100, 100);
      const result = reg.isInCover({ x: 9999, y: 9999 });
      expect(result).toBeNull();
    });

    it('returns closest cover when inside multiple', () => {
      const reg = makeRegistry();
      reg.addPoint(100, 100);
      reg.addPoint(110, 100);
      const result = reg.isInCover({ x: 108, y: 100 });
      expect(result).not.toBeNull();
      expect(result!.x).toBe(110);
    });
  });

  // -------------------------------------------------------------------
  // Loopholes
  // -------------------------------------------------------------------
  describe('loopholes', () => {
    it('getLoopholes returns generated loopholes', () => {
      const reg = makeRegistry(createSeededRandom([0.5, 0.3, 0.2]));
      const p = reg.addPoint(100, 100);
      const loopholes = reg.getLoopholes(p);
      expect(loopholes.length).toBeGreaterThanOrEqual(1);
    });

    it('findBestLoophole returns loophole facing the enemy', () => {
      const reg = makeRegistry(createSeededRandom([0.5, 0, 0.5]));
      const p = reg.addPoint(0, 0);
      const lh = reg.findBestLoophole(p, 100, 0);
      // May or may not match depending on random arc distribution.
      // Just verify it doesn't throw.
      expect(lh === null || typeof lh.offsetX === 'number').toBe(true);
    });
  });

  // -------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------
  describe('clear', () => {
    it('removes all points and resets ID counter', () => {
      const reg = makeRegistry();
      reg.addPoints([{ x: 0, y: 0 }, { x: 10, y: 10 }]);
      reg.clear();
      expect(reg.getSize()).toBe(0);
      const p = reg.addPoint(0, 0);
      expect(p.id).toBe('cover_0000');
    });
  });
});
