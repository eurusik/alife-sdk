import { Zone } from './Zone';

describe('Zone', () => {
  const bounds = { x: 100, y: 200, width: 300, height: 400 };

  describe('contains', () => {
    it('returns true for a point inside the zone', () => {
      const zone = new Zone('z1', bounds);
      expect(zone.contains({ x: 250, y: 400 })).toBe(true);
    });

    it('returns true for a point on the left edge', () => {
      const zone = new Zone('z1', bounds);
      expect(zone.contains({ x: 100, y: 300 })).toBe(true);
    });

    it('returns true for a point on the right edge', () => {
      const zone = new Zone('z1', bounds);
      expect(zone.contains({ x: 400, y: 300 })).toBe(true);
    });

    it('returns true for a point on the top edge', () => {
      const zone = new Zone('z1', bounds);
      expect(zone.contains({ x: 250, y: 200 })).toBe(true);
    });

    it('returns true for a point on the bottom edge', () => {
      const zone = new Zone('z1', bounds);
      expect(zone.contains({ x: 250, y: 600 })).toBe(true);
    });

    it('returns true for a point on the top-left corner', () => {
      const zone = new Zone('z1', bounds);
      expect(zone.contains({ x: 100, y: 200 })).toBe(true);
    });

    it('returns true for a point on the bottom-right corner', () => {
      const zone = new Zone('z1', bounds);
      expect(zone.contains({ x: 400, y: 600 })).toBe(true);
    });

    it('returns false for a point outside to the left', () => {
      const zone = new Zone('z1', bounds);
      expect(zone.contains({ x: 99, y: 300 })).toBe(false);
    });

    it('returns false for a point outside to the right', () => {
      const zone = new Zone('z1', bounds);
      expect(zone.contains({ x: 401, y: 300 })).toBe(false);
    });

    it('returns false for a point outside above', () => {
      const zone = new Zone('z1', bounds);
      expect(zone.contains({ x: 250, y: 199 })).toBe(false);
    });

    it('returns false for a point outside below', () => {
      const zone = new Zone('z1', bounds);
      expect(zone.contains({ x: 250, y: 601 })).toBe(false);
    });
  });

  describe('center', () => {
    it('calculates the geometric center', () => {
      const zone = new Zone('z1', bounds);
      expect(zone.center).toEqual({ x: 250, y: 400 });
    });

    it('works for zero-origin bounds', () => {
      const zone = new Zone('z2', { x: 0, y: 0, width: 100, height: 50 });
      expect(zone.center).toEqual({ x: 50, y: 25 });
    });
  });

  describe('metadata', () => {
    it('stores metadata as a ReadonlyMap', () => {
      const zone = new Zone('z1', bounds, 0, { biome: 'swamp', level: 5 });
      expect(zone.metadata.get('biome')).toBe('swamp');
      expect(zone.metadata.get('level')).toBe(5);
      expect(zone.metadata.size).toBe(2);
    });

    it('defaults to an empty map when no metadata provided', () => {
      const zone = new Zone('z1', bounds);
      expect(zone.metadata.size).toBe(0);
    });
  });

  describe('constructor properties', () => {
    it('stores id, bounds, and dangerLevel', () => {
      const zone = new Zone('z1', bounds, 7);
      expect(zone.id).toBe('z1');
      expect(zone.bounds).toBe(bounds);
      expect(zone.dangerLevel).toBe(7);
    });

    it('defaults dangerLevel to 0', () => {
      const zone = new Zone('z1', bounds);
      expect(zone.dangerLevel).toBe(0);
    });
  });
});
