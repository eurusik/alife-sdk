import { describe, it, expect } from 'vitest';
import { RestrictedZoneManager, RestrictionType } from './RestrictedZoneManager';
import type { IRestrictedZone } from './RestrictedZoneManager';

function makeZone(overrides?: Partial<IRestrictedZone>): IRestrictedZone {
  return {
    id: 'zone_1',
    type: RestrictionType.OUT,
    x: 100,
    y: 100,
    radius: 50,
    active: true,
    ...overrides,
  };
}

const MARGIN = 20;

describe('RestrictedZoneManager', () => {
  // -------------------------------------------------------------------
  // Zone Lifecycle
  // -------------------------------------------------------------------
  describe('lifecycle', () => {
    it('adds and retrieves zones', () => {
      const mgr = new RestrictedZoneManager(MARGIN);
      mgr.addZone(makeZone());
      expect(mgr.size).toBe(1);
    });

    it('removes zone by ID', () => {
      const mgr = new RestrictedZoneManager(MARGIN);
      mgr.addZone(makeZone());
      mgr.removeZone('zone_1');
      expect(mgr.size).toBe(0);
    });

    it('toggles zone active state', () => {
      const mgr = new RestrictedZoneManager(MARGIN);
      mgr.addZone(makeZone());
      mgr.setActive('zone_1', false);
      // Inactive zone should not block access.
      expect(mgr.accessible(100, 100)).toBe(true);
    });

    it('removes zones by metadata', () => {
      const mgr = new RestrictedZoneManager(MARGIN);
      mgr.addZone(makeZone({ id: 'z1', metadata: 'surge' }));
      mgr.addZone(makeZone({ id: 'z2', metadata: 'surge' }));
      mgr.addZone(makeZone({ id: 'z3', metadata: 'quest' }));
      mgr.removeByMetadata('surge');
      expect(mgr.size).toBe(1);
    });

    it('getZonesAt returns overlapping zones', () => {
      const mgr = new RestrictedZoneManager(MARGIN);
      mgr.addZone(makeZone({ id: 'z1', x: 0, y: 0, radius: 100 }));
      mgr.addZone(makeZone({ id: 'z2', x: 500, y: 500, radius: 10 }));
      const at = mgr.getZonesAt(10, 10);
      expect(at).toHaveLength(1);
      expect(at[0].id).toBe('z1');
    });

    it('clear removes everything', () => {
      const mgr = new RestrictedZoneManager(MARGIN);
      mgr.addZone(makeZone({ id: 'z1' }));
      mgr.addZone(makeZone({ id: 'z2' }));
      mgr.clear();
      expect(mgr.size).toBe(0);
    });
  });

  // -------------------------------------------------------------------
  // accessible()
  // -------------------------------------------------------------------
  describe('accessible', () => {
    it('blocks points inside OUT zone', () => {
      const mgr = new RestrictedZoneManager(MARGIN);
      mgr.addZone(makeZone({ type: RestrictionType.OUT, x: 100, y: 100, radius: 50 }));
      expect(mgr.accessible(100, 100)).toBe(false);
    });

    it('blocks points within safety margin of OUT zone', () => {
      const mgr = new RestrictedZoneManager(MARGIN);
      mgr.addZone(makeZone({ type: RestrictionType.OUT, x: 0, y: 0, radius: 50 }));
      // 60px from center — inside (50 + 20) margin.
      expect(mgr.accessible(60, 0)).toBe(false);
    });

    it('allows points outside OUT zone + margin', () => {
      const mgr = new RestrictedZoneManager(MARGIN);
      mgr.addZone(makeZone({ type: RestrictionType.OUT, x: 0, y: 0, radius: 50 }));
      expect(mgr.accessible(80, 0)).toBe(true);
    });

    it('blocks points outside IN zone', () => {
      const mgr = new RestrictedZoneManager(MARGIN);
      mgr.addZone(makeZone({ type: RestrictionType.IN, x: 0, y: 0, radius: 50 }));
      expect(mgr.accessible(100, 0)).toBe(false);
    });

    it('allows points inside IN zone', () => {
      const mgr = new RestrictedZoneManager(MARGIN);
      mgr.addZone(makeZone({ type: RestrictionType.IN, x: 0, y: 0, radius: 50 }));
      expect(mgr.accessible(10, 10)).toBe(true);
    });

    it('ignores DANGER zones for hard check', () => {
      const mgr = new RestrictedZoneManager(MARGIN);
      mgr.addZone(makeZone({ type: RestrictionType.DANGER, x: 0, y: 0, radius: 50 }));
      expect(mgr.accessible(0, 0)).toBe(true);
    });

    it('ignores inactive zones', () => {
      const mgr = new RestrictedZoneManager(MARGIN);
      mgr.addZone(makeZone({ type: RestrictionType.OUT, active: false }));
      expect(mgr.accessible(100, 100)).toBe(true);
    });

    it('returns true when no zones exist', () => {
      const mgr = new RestrictedZoneManager(MARGIN);
      expect(mgr.accessible(0, 0)).toBe(true);
    });
  });

  // -------------------------------------------------------------------
  // isDangerous()
  // -------------------------------------------------------------------
  describe('isDangerous', () => {
    it('returns true inside DANGER zone', () => {
      const mgr = new RestrictedZoneManager(MARGIN);
      mgr.addZone(makeZone({ type: RestrictionType.DANGER, x: 0, y: 0, radius: 50 }));
      expect(mgr.isDangerous(10, 10)).toBe(true);
    });

    it('returns false outside DANGER zone', () => {
      const mgr = new RestrictedZoneManager(MARGIN);
      mgr.addZone(makeZone({ type: RestrictionType.DANGER, x: 0, y: 0, radius: 50 }));
      expect(mgr.isDangerous(100, 100)).toBe(false);
    });

    it('ignores OUT zones', () => {
      const mgr = new RestrictedZoneManager(MARGIN);
      mgr.addZone(makeZone({ type: RestrictionType.OUT, x: 0, y: 0, radius: 50 }));
      expect(mgr.isDangerous(0, 0)).toBe(false);
    });
  });

  // -------------------------------------------------------------------
  // getSafeDirection()
  // -------------------------------------------------------------------
  describe('getSafeDirection', () => {
    it('returns null when position is safe', () => {
      const mgr = new RestrictedZoneManager(MARGIN);
      mgr.addZone(makeZone({ type: RestrictionType.OUT, x: 0, y: 0, radius: 50 }));
      expect(mgr.getSafeDirection(200, 200)).toBeNull();
    });

    it('returns unit vector pointing away from OUT zone', () => {
      const mgr = new RestrictedZoneManager(MARGIN);
      mgr.addZone(makeZone({ type: RestrictionType.OUT, x: 0, y: 0, radius: 100 }));
      const dir = mgr.getSafeDirection(50, 0);
      expect(dir).not.toBeNull();
      expect(dir!.x).toBeGreaterThan(0); // Pointing right (away from center).
      expect(Math.abs(dir!.y)).toBeLessThan(0.01);
    });

    it('returns unit vector pointing away from DANGER zone', () => {
      const mgr = new RestrictedZoneManager(MARGIN);
      mgr.addZone(makeZone({ type: RestrictionType.DANGER, x: 0, y: 0, radius: 100 }));
      const dir = mgr.getSafeDirection(0, 50);
      expect(dir).not.toBeNull();
      expect(dir!.y).toBeGreaterThan(0); // Pointing up (away from center).
    });

    it('returns default direction at zone center', () => {
      const mgr = new RestrictedZoneManager(MARGIN);
      mgr.addZone(makeZone({ type: RestrictionType.OUT, x: 0, y: 0, radius: 100 }));
      const dir = mgr.getSafeDirection(0, 0);
      expect(dir).toEqual({ x: 1, y: 0 });
    });

    it('picks nearest zone when multiple overlap', () => {
      const mgr = new RestrictedZoneManager(MARGIN);
      mgr.addZone(makeZone({ id: 'z1', type: RestrictionType.OUT, x: 0, y: 0, radius: 200 }));
      mgr.addZone(makeZone({ id: 'z2', type: RestrictionType.OUT, x: 50, y: 0, radius: 200 }));
      // At (40, 0), z2 center is closer (dist 10) than z1 center (dist 40).
      const dir = mgr.getSafeDirection(40, 0);
      expect(dir).not.toBeNull();
      expect(dir!.x).toBeLessThan(0); // Pointing left (away from z2 at x=50).
    });
  });

  // -------------------------------------------------------------------
  // filterAccessibleWaypoints()
  // -------------------------------------------------------------------
  describe('filterAccessibleWaypoints', () => {
    it('filters out waypoints inside OUT zones', () => {
      const mgr = new RestrictedZoneManager(MARGIN);
      mgr.addZone(makeZone({ type: RestrictionType.OUT, x: 100, y: 100, radius: 50 }));
      const waypoints = [
        { x: 0, y: 0 },
        { x: 100, y: 100 }, // blocked
        { x: 300, y: 300 },
      ];
      const result = mgr.filterAccessibleWaypoints(waypoints);
      expect(result).toHaveLength(2);
      expect(result[0].x).toBe(0);
      expect(result[1].x).toBe(300);
    });

    it('returns all waypoints when no zones', () => {
      const mgr = new RestrictedZoneManager(MARGIN);
      const waypoints = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
      expect(mgr.filterAccessibleWaypoints(waypoints)).toHaveLength(2);
    });

    it('returns empty when all blocked', () => {
      const mgr = new RestrictedZoneManager(MARGIN);
      mgr.addZone(makeZone({ type: RestrictionType.OUT, x: 0, y: 0, radius: 1000 }));
      const waypoints = [{ x: 10, y: 10 }, { x: 20, y: 20 }];
      expect(mgr.filterAccessibleWaypoints(waypoints)).toHaveLength(0);
    });
  });
});
