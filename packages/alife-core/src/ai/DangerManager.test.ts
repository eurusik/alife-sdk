import { DangerManager, DangerType } from './DangerManager';
import type { IDangerEntry } from './DangerManager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDanger(overrides: Partial<IDangerEntry> = {}): IDangerEntry {
  return {
    id: 'danger-1',
    type: DangerType.GRENADE,
    position: { x: 0, y: 0 },
    radius: 100,
    threatScore: 0.8,
    remainingMs: 5000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DangerManager', () => {
  // -------------------------------------------------------------------------
  // addDanger + getThreatAt
  // -------------------------------------------------------------------------

  describe('addDanger / getThreatAt', () => {
    it('returns 0 when no dangers exist', () => {
      const dm = new DangerManager();
      expect(dm.getThreatAt({ x: 50, y: 50 })).toBe(0);
    });

    it('returns threat score when position is inside danger radius', () => {
      const dm = new DangerManager();
      dm.addDanger(makeDanger({ position: { x: 0, y: 0 }, radius: 100, threatScore: 0.7 }));

      // position (10, 10) is well within radius 100
      expect(dm.getThreatAt({ x: 10, y: 10 })).toBeCloseTo(0.7);
    });

    it('returns 0 when position is outside danger radius', () => {
      const dm = new DangerManager();
      dm.addDanger(makeDanger({ position: { x: 0, y: 0 }, radius: 10, threatScore: 0.9 }));

      // position (100, 100) is far outside radius 10
      expect(dm.getThreatAt({ x: 100, y: 100 })).toBe(0);
    });

    it('sums threat scores of overlapping dangers', () => {
      const dm = new DangerManager();
      dm.addDanger(makeDanger({ id: 'd1', position: { x: 0, y: 0 }, radius: 200, threatScore: 0.3 }));
      dm.addDanger(makeDanger({ id: 'd2', position: { x: 10, y: 10 }, radius: 200, threatScore: 0.5 }));

      const threat = dm.getThreatAt({ x: 5, y: 5 });
      expect(threat).toBeCloseTo(0.8);
    });

    it('replaces existing danger with the same id', () => {
      const dm = new DangerManager();
      dm.addDanger(makeDanger({ id: 'd1', threatScore: 0.3 }));
      dm.addDanger(makeDanger({ id: 'd1', threatScore: 0.9 }));

      expect(dm.activeDangerCount).toBe(1);
      expect(dm.getThreatAt({ x: 0, y: 0 })).toBeCloseTo(0.9);
    });
  });

  // -------------------------------------------------------------------------
  // update() — expired dangers removal
  // -------------------------------------------------------------------------

  describe('update', () => {
    it('removes dangers whose remainingMs reaches 0', () => {
      const dm = new DangerManager();
      dm.addDanger(makeDanger({ id: 'd1', remainingMs: 1000 }));
      dm.addDanger(makeDanger({ id: 'd2', remainingMs: 3000 }));

      dm.update(1000); // d1: 0ms → removed, d2: 2000ms → kept

      expect(dm.activeDangerCount).toBe(1);
      expect(dm.getThreatAt({ x: 0, y: 0 })).toBeGreaterThan(0);
    });

    it('removes dangers that go negative on remainingMs', () => {
      const dm = new DangerManager();
      dm.addDanger(makeDanger({ id: 'd1', remainingMs: 500 }));

      dm.update(1000); // 500 - 1000 = -500 → removed

      expect(dm.activeDangerCount).toBe(0);
    });

    it('keeps dangers with remaining time', () => {
      const dm = new DangerManager();
      dm.addDanger(makeDanger({ id: 'd1', remainingMs: 5000 }));

      dm.update(1000); // 5000 - 1000 = 4000 → kept

      expect(dm.activeDangerCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // getDangersNear — radius filter
  // -------------------------------------------------------------------------

  describe('getDangersNear', () => {
    it('returns dangers within search radius', () => {
      const dm = new DangerManager();
      dm.addDanger(makeDanger({ id: 'd1', position: { x: 10, y: 0 } }));
      dm.addDanger(makeDanger({ id: 'd2', position: { x: 500, y: 500 } }));

      const nearby = dm.getDangersNear({ x: 0, y: 0 }, 50);

      expect(nearby).toHaveLength(1);
      expect(nearby[0].id).toBe('d1');
    });

    it('returns empty array when nothing is nearby', () => {
      const dm = new DangerManager();
      dm.addDanger(makeDanger({ id: 'd1', position: { x: 1000, y: 1000 } }));

      const nearby = dm.getDangersNear({ x: 0, y: 0 }, 100);
      expect(nearby).toHaveLength(0);
    });

    it('returns multiple dangers within radius', () => {
      const dm = new DangerManager();
      dm.addDanger(makeDanger({ id: 'd1', position: { x: 5, y: 5 } }));
      dm.addDanger(makeDanger({ id: 'd2', position: { x: 10, y: 10 } }));
      dm.addDanger(makeDanger({ id: 'd3', position: { x: 15, y: 15 } }));

      const nearby = dm.getDangersNear({ x: 0, y: 0 }, 50);
      expect(nearby).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------------
  // getSafeDirection
  // -------------------------------------------------------------------------

  describe('getSafeDirection', () => {
    it('returns ZERO when no dangers exist', () => {
      const dm = new DangerManager();
      const dir = dm.getSafeDirection({ x: 50, y: 50 });
      expect(dir.x).toBe(0);
      expect(dir.y).toBe(0);
    });

    it('returns ZERO when position is outside all danger radii', () => {
      const dm = new DangerManager();
      dm.addDanger(makeDanger({ position: { x: 0, y: 0 }, radius: 10 }));

      const dir = dm.getSafeDirection({ x: 500, y: 500 });
      expect(dir.x).toBe(0);
      expect(dir.y).toBe(0);
    });

    it('points away from a single danger', () => {
      const dm = new DangerManager();
      dm.addDanger(
        makeDanger({ position: { x: 0, y: 0 }, radius: 200, threatScore: 1.0 }),
      );

      // Position is at (50, 0) — should push rightward (positive x)
      const dir = dm.getSafeDirection({ x: 50, y: 0 });
      expect(dir.x).toBeGreaterThan(0);
      expect(dir.y).toBeCloseTo(0, 5);
    });

    it('returns a normalized vector', () => {
      const dm = new DangerManager();
      dm.addDanger(
        makeDanger({ position: { x: 0, y: 0 }, radius: 200, threatScore: 1.0 }),
      );

      const dir = dm.getSafeDirection({ x: 30, y: 40 });
      const mag = Math.sqrt(dir.x * dir.x + dir.y * dir.y);
      expect(mag).toBeCloseTo(1.0, 5);
    });
  });

  // -------------------------------------------------------------------------
  // isDangerous
  // -------------------------------------------------------------------------

  describe('isDangerous', () => {
    it('returns true when threat exceeds default threshold', () => {
      const dm = new DangerManager(0.1);
      dm.addDanger(makeDanger({ position: { x: 0, y: 0 }, radius: 100, threatScore: 0.5 }));

      expect(dm.isDangerous({ x: 0, y: 0 })).toBe(true);
    });

    it('returns false when threat is below default threshold', () => {
      const dm = new DangerManager(0.5);
      dm.addDanger(makeDanger({ position: { x: 0, y: 0 }, radius: 100, threatScore: 0.3 }));

      expect(dm.isDangerous({ x: 0, y: 0 })).toBe(false);
    });

    it('returns false when position is outside all dangers', () => {
      const dm = new DangerManager(0.1);
      dm.addDanger(makeDanger({ position: { x: 0, y: 0 }, radius: 10 }));

      expect(dm.isDangerous({ x: 500, y: 500 })).toBe(false);
    });

    it('respects custom threshold parameter', () => {
      const dm = new DangerManager(0.1);
      dm.addDanger(makeDanger({ position: { x: 0, y: 0 }, radius: 100, threatScore: 0.4 }));

      expect(dm.isDangerous({ x: 0, y: 0 }, 0.5)).toBe(false);
      expect(dm.isDangerous({ x: 0, y: 0 }, 0.3)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // removeDanger
  // -------------------------------------------------------------------------

  describe('removeDanger', () => {
    it('removes a danger by id', () => {
      const dm = new DangerManager();
      dm.addDanger(makeDanger({ id: 'd1' }));

      dm.removeDanger('d1');
      expect(dm.activeDangerCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // serialize / restore
  // -------------------------------------------------------------------------

  describe('serialize / restore', () => {
    it('round-trips all danger entries', () => {
      const dm = new DangerManager();
      dm.addDanger(makeDanger({ id: 'd1', type: DangerType.GRENADE, position: { x: 10, y: 20 }, radius: 50, threatScore: 0.6, remainingMs: 3000 }));
      dm.addDanger(makeDanger({ id: 'd2', type: DangerType.ANOMALY, position: { x: 30, y: 40 }, radius: 80, threatScore: 0.9, remainingMs: 7000 }));

      const serialized = dm.serialize();
      expect(serialized).toHaveLength(2);

      const dm2 = new DangerManager();
      dm2.restore(serialized);

      expect(dm2.activeDangerCount).toBe(2);
      // d1 at (10,20) r=50, d2 at (30,40) r=80 — position (10,20) is inside BOTH radii
      // dist to d2 = sqrt((30-10)^2 + (40-20)^2) = sqrt(800) ≈ 28.3 < 80
      // so total = 0.6 + 0.9 = 1.5
      expect(dm2.getThreatAt({ x: 10, y: 20 })).toBeCloseTo(1.5);
    });

    it('restore clears previous entries', () => {
      const dm = new DangerManager();
      dm.addDanger(makeDanger({ id: 'old' }));

      dm.restore([makeDanger({ id: 'new' })]);

      expect(dm.activeDangerCount).toBe(1);
      const nearby = dm.getDangersNear({ x: 0, y: 0 }, 200);
      expect(nearby[0].id).toBe('new');
    });
  });
});
