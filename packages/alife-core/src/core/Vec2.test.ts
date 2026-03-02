import {
  ZERO,
  distanceSq,
  distance,
  lerp,
  subtract,
  magnitude,
  normalize,
  add,
  scale,
  dot,
  angle,
} from './Vec2';

describe('Vec2', () => {
  // ---------------------------------------------------------------------------
  // distanceSq / distance
  // ---------------------------------------------------------------------------
  describe('distanceSq', () => {
    it('returns 0 for the same point', () => {
      const p = { x: 5, y: 10 };
      expect(distanceSq(p, p)).toBe(0);
    });

    it('returns squared Euclidean distance for a 3-4-5 triangle', () => {
      const a = { x: 0, y: 0 };
      const b = { x: 3, y: 4 };
      expect(distanceSq(a, b)).toBe(25);
    });

    it('is symmetric', () => {
      const a = { x: 1, y: 2 };
      const b = { x: 4, y: 6 };
      expect(distanceSq(a, b)).toBe(distanceSq(b, a));
    });
  });

  describe('distance', () => {
    it('returns 0 for the same point', () => {
      expect(distance({ x: 7, y: 3 }, { x: 7, y: 3 })).toBe(0);
    });

    it('returns exact Euclidean distance for a 3-4-5 triangle', () => {
      expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    });

    it('handles negative coordinates', () => {
      expect(distance({ x: -1, y: -1 }, { x: 2, y: 3 })).toBe(5);
    });

    it('equals sqrt of distanceSq', () => {
      const a = { x: 10, y: 20 };
      const b = { x: 13, y: 24 };
      expect(distance(a, b)).toBeCloseTo(Math.sqrt(distanceSq(a, b)));
    });
  });

  // ---------------------------------------------------------------------------
  // lerp
  // ---------------------------------------------------------------------------
  describe('lerp', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 20 };

    it('returns a at t=0', () => {
      const result = lerp(a, b, 0);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });

    it('returns b at t=1', () => {
      const result = lerp(a, b, 1);
      expect(result.x).toBe(10);
      expect(result.y).toBe(20);
    });

    it('returns midpoint at t=0.5', () => {
      const result = lerp(a, b, 0.5);
      expect(result.x).toBe(5);
      expect(result.y).toBe(10);
    });

    it('works with non-origin starting point', () => {
      const from = { x: 2, y: 4 };
      const to = { x: 6, y: 8 };
      const result = lerp(from, to, 0.25);
      expect(result.x).toBe(3);
      expect(result.y).toBe(5);
    });
  });

  // ---------------------------------------------------------------------------
  // subtract
  // ---------------------------------------------------------------------------
  describe('subtract', () => {
    it('computes component-wise subtraction', () => {
      const result = subtract({ x: 10, y: 20 }, { x: 3, y: 7 });
      expect(result.x).toBe(7);
      expect(result.y).toBe(13);
    });

    it('subtracting a point from itself yields zero', () => {
      const p = { x: 5, y: 5 };
      const result = subtract(p, p);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });

    it('handles negative results', () => {
      const result = subtract({ x: 1, y: 2 }, { x: 5, y: 10 });
      expect(result.x).toBe(-4);
      expect(result.y).toBe(-8);
    });
  });

  // ---------------------------------------------------------------------------
  // magnitude
  // ---------------------------------------------------------------------------
  describe('magnitude', () => {
    it('returns 0 for the zero vector', () => {
      expect(magnitude(ZERO)).toBe(0);
    });

    it('returns correct length for a 3-4-5 vector', () => {
      expect(magnitude({ x: 3, y: 4 })).toBe(5);
    });

    it('returns 1 for axis-aligned unit vector', () => {
      expect(magnitude({ x: 1, y: 0 })).toBe(1);
      expect(magnitude({ x: 0, y: 1 })).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // normalize
  // ---------------------------------------------------------------------------
  describe('normalize', () => {
    it('returns ZERO for zero-length input', () => {
      const result = normalize(ZERO);
      expect(result).toBe(ZERO);
    });

    it('returns a unit vector', () => {
      const result = normalize({ x: 3, y: 4 });
      expect(magnitude(result)).toBeCloseTo(1);
    });

    it('preserves direction', () => {
      const v = { x: 6, y: 8 };
      const result = normalize(v);
      expect(result.x).toBeCloseTo(0.6);
      expect(result.y).toBeCloseTo(0.8);
    });

    it('normalizing a unit vector returns a unit vector', () => {
      const unit = { x: 1, y: 0 };
      const result = normalize(unit);
      expect(result.x).toBeCloseTo(1);
      expect(result.y).toBeCloseTo(0);
    });

    it('handles negative components', () => {
      const result = normalize({ x: -3, y: -4 });
      expect(result.x).toBeCloseTo(-0.6);
      expect(result.y).toBeCloseTo(-0.8);
      expect(magnitude(result)).toBeCloseTo(1);
    });
  });

  // ---------------------------------------------------------------------------
  // add
  // ---------------------------------------------------------------------------
  describe('add', () => {
    it('sums components', () => {
      expect(add({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 });
    });

    it('adding ZERO is identity', () => {
      const p = { x: 5, y: 7 };
      expect(add(p, ZERO)).toEqual(p);
    });

    it('is commutative', () => {
      const a = { x: 2, y: -3 };
      const b = { x: -1, y: 5 };
      expect(add(a, b)).toEqual(add(b, a));
    });
  });

  // ---------------------------------------------------------------------------
  // scale
  // ---------------------------------------------------------------------------
  describe('scale', () => {
    it('multiplies each component', () => {
      expect(scale({ x: 3, y: 4 }, 2)).toEqual({ x: 6, y: 8 });
    });

    it('scale by 0 returns zero vector', () => {
      const result = scale({ x: 100, y: 200 }, 0);
      expect(result.x).toBe(0);
      expect(result.y).toBe(0);
    });

    it('scale by -1 negates', () => {
      expect(scale({ x: 3, y: -5 }, -1)).toEqual({ x: -3, y: 5 });
    });
  });

  // ---------------------------------------------------------------------------
  // dot
  // ---------------------------------------------------------------------------
  describe('dot', () => {
    it('is 0 for perpendicular vectors', () => {
      expect(dot({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(0);
    });

    it('equals product of magnitudes for parallel vectors', () => {
      expect(dot({ x: 3, y: 0 }, { x: 5, y: 0 })).toBe(15);
    });

    it('is commutative', () => {
      const a = { x: 2, y: 3 };
      const b = { x: 4, y: 5 };
      expect(dot(a, b)).toBe(dot(b, a));
    });

    it('handles negative components', () => {
      expect(dot({ x: -1, y: 2 }, { x: 3, y: -4 })).toBe(-11);
    });
  });

  // ---------------------------------------------------------------------------
  // angle
  // ---------------------------------------------------------------------------
  describe('angle', () => {
    it('returns 0 for +X direction', () => {
      expect(angle({ x: 1, y: 0 })).toBeCloseTo(0);
    });

    it('returns π/2 for +Y (screen-down)', () => {
      expect(angle({ x: 0, y: 1 })).toBeCloseTo(Math.PI / 2);
    });

    it('returns π for -X', () => {
      expect(angle({ x: -1, y: 0 })).toBeCloseTo(Math.PI);
    });

    it('returns -π/2 for -Y', () => {
      expect(angle({ x: 0, y: -1 })).toBeCloseTo(-Math.PI / 2);
    });

    it('returns 0 for zero vector', () => {
      expect(angle(ZERO)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // ZERO constant
  // ---------------------------------------------------------------------------
  describe('ZERO', () => {
    it('is frozen', () => {
      expect(Object.isFrozen(ZERO)).toBe(true);
    });

    it('has x=0 and y=0', () => {
      expect(ZERO.x).toBe(0);
      expect(ZERO.y).toBe(0);
    });
  });
});
