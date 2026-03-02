import { describe, it, expect } from 'vitest';
import { segmentIntersectsRect, segmentIntersectsCircle } from './intersects';

// ─────────────────────────────────────────────────────────────────────────────
// segmentIntersectsRect
// ─────────────────────────────────────────────────────────────────────────────

describe('segmentIntersectsRect', () => {
  // rect: top-left (100, 200), size 50×10  →  x∈[100,150], y∈[200,210]

  describe('horizontal segment crossing the rect', () => {
    it('hits rect when passing through center', () => {
      expect(segmentIntersectsRect({ x: 0, y: 205 }, { x: 300, y: 205 }, 100, 200, 50, 10)).toBe(true);
    });

    it('misses rect above', () => {
      expect(segmentIntersectsRect({ x: 0, y: 190 }, { x: 300, y: 190 }, 100, 200, 50, 10)).toBe(false);
    });

    it('misses rect below', () => {
      expect(segmentIntersectsRect({ x: 0, y: 220 }, { x: 300, y: 220 }, 100, 200, 50, 10)).toBe(false);
    });
  });

  describe('vertical segment crossing the rect', () => {
    it('hits rect when passing through center column', () => {
      expect(segmentIntersectsRect({ x: 125, y: 0 }, { x: 125, y: 300 }, 100, 200, 50, 10)).toBe(true);
    });

    it('misses rect to the left', () => {
      expect(segmentIntersectsRect({ x: 90, y: 0 }, { x: 90, y: 300 }, 100, 200, 50, 10)).toBe(false);
    });

    it('misses rect to the right', () => {
      expect(segmentIntersectsRect({ x: 160, y: 0 }, { x: 160, y: 300 }, 100, 200, 50, 10)).toBe(false);
    });
  });

  describe('diagonal segment', () => {
    it('hits when segment clearly crosses the rect', () => {
      expect(segmentIntersectsRect({ x: 50, y: 150 }, { x: 200, y: 260 }, 100, 200, 50, 10)).toBe(true);
    });

    it('misses when segment ends before reaching the rect', () => {
      expect(segmentIntersectsRect({ x: 0, y: 0 }, { x: 50, y: 100 }, 100, 200, 50, 10)).toBe(false);
    });
  });

  describe('edge and corner cases', () => {
    it('grazes top edge (y = 200)', () => {
      expect(segmentIntersectsRect({ x: 0, y: 200 }, { x: 300, y: 200 }, 100, 200, 50, 10)).toBe(true);
    });

    it('grazes left edge (x = 100)', () => {
      expect(segmentIntersectsRect({ x: 100, y: 0 }, { x: 100, y: 400 }, 100, 200, 50, 10)).toBe(true);
    });

    it('segment fully inside rect', () => {
      expect(segmentIntersectsRect({ x: 110, y: 203 }, { x: 140, y: 207 }, 100, 200, 50, 10)).toBe(true);
    });

    it('degenerate segment (point) inside rect', () => {
      expect(segmentIntersectsRect({ x: 125, y: 205 }, { x: 125, y: 205 }, 100, 200, 50, 10)).toBe(true);
    });

    it('degenerate segment (point) outside rect', () => {
      expect(segmentIntersectsRect({ x: 50, y: 50 }, { x: 50, y: 50 }, 100, 200, 50, 10)).toBe(false);
    });

    it('reversed segment (p1/p2 swapped) — commutativity', () => {
      const p1 = { x: 0, y: 205 };
      const p2 = { x: 300, y: 205 };
      const r = segmentIntersectsRect(p1, p2, 100, 200, 50, 10);
      const rSwapped = segmentIntersectsRect(p2, p1, 100, 200, 50, 10);
      expect(r).toBe(rSwapped);
    });

    it('negative rw — rect spans [50, 100] on x axis', () => {
      // rx=100, rw=-50 → x ∈ [50, 100]; ry=200, rh=10 → y ∈ [200, 210]
      expect(segmentIntersectsRect({ x: 0, y: 205 }, { x: 300, y: 205 }, 100, 200, -50, 10)).toBe(true);
    });

    it('negative rh — rect spans [200, 210] on y axis', () => {
      // ry=210, rh=-10 → y ∈ [200, 210]
      expect(segmentIntersectsRect({ x: 125, y: 0 }, { x: 125, y: 300 }, 100, 210, 50, -10)).toBe(true);
    });

    it('zero-width rect (rw=0) — segment through the line hits', () => {
      // A zero-width rect is a vertical line segment; horizontal crossing at x=100 should hit
      expect(segmentIntersectsRect({ x: 0, y: 205 }, { x: 300, y: 205 }, 100, 200, 0, 10)).toBe(true);
    });

    it('zero-height rect (rh=0) — segment through the line hits', () => {
      expect(segmentIntersectsRect({ x: 125, y: 0 }, { x: 125, y: 300 }, 100, 200, 50, 0)).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// segmentIntersectsCircle
// ─────────────────────────────────────────────────────────────────────────────

describe('segmentIntersectsCircle', () => {
  // circle: center (150, 150), radius 30

  describe('horizontal segment', () => {
    it('hits when passing through center', () => {
      expect(segmentIntersectsCircle({ x: 0, y: 150 }, { x: 300, y: 150 }, { x: 150, y: 150 }, 30)).toBe(true);
    });

    it('hits when passing through the edge (y = 180)', () => {
      expect(segmentIntersectsCircle({ x: 0, y: 180 }, { x: 300, y: 180 }, { x: 150, y: 150 }, 30)).toBe(true);
    });

    it('misses when just outside the radius', () => {
      expect(segmentIntersectsCircle({ x: 0, y: 181 }, { x: 300, y: 181 }, { x: 150, y: 150 }, 30)).toBe(false);
    });
  });

  describe('segment that starts and ends before the circle', () => {
    it('misses when segment ends before circle', () => {
      expect(segmentIntersectsCircle({ x: 0, y: 150 }, { x: 100, y: 150 }, { x: 150, y: 150 }, 30)).toBe(false);
    });

    it('misses when segment starts after circle', () => {
      expect(segmentIntersectsCircle({ x: 200, y: 150 }, { x: 300, y: 150 }, { x: 150, y: 150 }, 30)).toBe(false);
    });
  });

  describe('segment passing close but not touching', () => {
    it('misses circle with large clearance', () => {
      // Goes from (0,0) to (300,0) — circle center is at y=150, far above
      expect(segmentIntersectsCircle({ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 150, y: 150 }, 30)).toBe(false);
    });
  });

  describe('degenerate segment (point)', () => {
    it('point inside circle returns true', () => {
      expect(segmentIntersectsCircle({ x: 150, y: 150 }, { x: 150, y: 150 }, { x: 150, y: 150 }, 30)).toBe(true);
    });

    it('point on circle edge returns true', () => {
      expect(segmentIntersectsCircle({ x: 180, y: 150 }, { x: 180, y: 150 }, { x: 150, y: 150 }, 30)).toBe(true);
    });

    it('point outside circle returns false', () => {
      expect(segmentIntersectsCircle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 150, y: 150 }, 30)).toBe(false);
    });
  });

  describe('diagonal segment', () => {
    it('diagonal through circle center hits', () => {
      expect(segmentIntersectsCircle({ x: 0, y: 0 }, { x: 300, y: 300 }, { x: 150, y: 150 }, 30)).toBe(true);
    });

    it('diagonal far from circle misses', () => {
      expect(segmentIntersectsCircle({ x: 0, y: 0 }, { x: 300, y: 300 }, { x: 300, y: 0 }, 30)).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('reversed segment (p1/p2 swapped) — commutativity', () => {
      const p1 = { x: 0, y: 150 };
      const p2 = { x: 300, y: 150 };
      const r = segmentIntersectsCircle(p1, p2, { x: 150, y: 150 }, 30);
      const rSwapped = segmentIntersectsCircle(p2, p1, { x: 150, y: 150 }, 30);
      expect(r).toBe(rSwapped);
    });

    it('tangent segment (dist exactly = radius) returns true', () => {
      // Horizontal segment at y=180, circle center (150,150) r=30 → dist to segment = 30 exactly
      expect(segmentIntersectsCircle({ x: 0, y: 180 }, { x: 300, y: 180 }, { x: 150, y: 150 }, 30)).toBe(true);
    });

    it('negative radius returns false', () => {
      expect(segmentIntersectsCircle({ x: 0, y: 150 }, { x: 300, y: 150 }, { x: 150, y: 150 }, -30)).toBe(false);
    });

    it('zero radius returns false', () => {
      expect(segmentIntersectsCircle({ x: 0, y: 150 }, { x: 300, y: 150 }, { x: 150, y: 150 }, 0)).toBe(false);
    });
  });
});
