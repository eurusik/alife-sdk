import { describe, it, expect } from 'vitest';
import { DefaultRandom, SeededRandom } from './IRandom';

// ---------------------------------------------------------------------------
// DefaultRandom
// ---------------------------------------------------------------------------

describe('DefaultRandom', () => {
  const rng = new DefaultRandom();

  it('next() returns value in [0, 1)', () => {
    for (let i = 0; i < 100; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt(1, 6) returns integers in [1, 6]', () => {
    for (let i = 0; i < 100; i++) {
      const v = rng.nextInt(1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('nextFloat(0, 10) returns floats in [0, 10)', () => {
    for (let i = 0; i < 100; i++) {
      const v = rng.nextFloat(0, 10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
  });
});

// ---------------------------------------------------------------------------
// SeededRandom
// ---------------------------------------------------------------------------

describe('SeededRandom', () => {
  it('same seed produces same sequence', () => {
    const a = new SeededRandom(42);
    const b = new SeededRandom(42);

    for (let i = 0; i < 20; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it('different seeds produce different sequences', () => {
    const a = new SeededRandom(1);
    const b = new SeededRandom(2);

    // Collect first 10 values from each
    const seqA: number[] = [];
    const seqB: number[] = [];
    for (let i = 0; i < 10; i++) {
      seqA.push(a.next());
      seqB.push(b.next());
    }

    // At least one value must differ
    const allSame = seqA.every((v, i) => v === seqB[i]);
    expect(allSame).toBe(false);
  });

  it('next() returns value in [0, 1)', () => {
    const rng = new SeededRandom(123);
    for (let i = 0; i < 100; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt(1, 6) returns integers in [1, 6]', () => {
    const rng = new SeededRandom(456);
    for (let i = 0; i < 100; i++) {
      const v = rng.nextInt(1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
  });

  it('nextInt returns actual integers', () => {
    const rng = new SeededRandom(789);
    for (let i = 0; i < 100; i++) {
      expect(Number.isInteger(rng.nextInt(0, 100))).toBe(true);
    }
  });

  it('nextFloat(0, 10) returns floats in [0, 10)', () => {
    const rng = new SeededRandom(101);
    for (let i = 0; i < 100; i++) {
      const v = rng.nextFloat(0, 10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
    }
  });

  it('seed 0 works', () => {
    const rng = new SeededRandom(0);
    const v = rng.next();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);

    // Produces a valid sequence (not stuck at 0)
    const values = new Set<number>();
    for (let i = 0; i < 20; i++) {
      values.add(rng.next());
    }
    expect(values.size).toBeGreaterThan(1);
  });

  it('negative seed works', () => {
    const rng = new SeededRandom(-999);
    for (let i = 0; i < 100; i++) {
      const v = rng.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('sequence is reproducible across multiple calls', () => {
    const seed = 314159;
    const rng1 = new SeededRandom(seed);

    // Generate a mixed sequence of next/nextInt/nextFloat
    const seq1 = [
      rng1.next(),
      rng1.nextInt(0, 100),
      rng1.nextFloat(-5, 5),
      rng1.next(),
      rng1.nextInt(1, 6),
      rng1.nextFloat(0, 1),
    ];

    // Same seed, same call order → identical values
    const rng2 = new SeededRandom(seed);
    const seq2 = [
      rng2.next(),
      rng2.nextInt(0, 100),
      rng2.nextFloat(-5, 5),
      rng2.next(),
      rng2.nextInt(1, 6),
      rng2.nextFloat(0, 1),
    ];

    expect(seq1).toEqual(seq2);
  });
});
