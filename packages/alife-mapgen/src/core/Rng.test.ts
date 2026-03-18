// src/core/Rng.test.ts
// Unit tests for Rng.weightedPick — guards the fix that throws RangeError
// when total weight is zero instead of silently returning undefined.
// Also covers the fork() determinism fix: child seeds derive from _seed
// (original string) rather than mutable this.state.

import { describe, it, expect } from 'vitest';
import { Rng } from './Rng';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fresh Rng with a fixed seed so all tests are deterministic. */
function rng(): Rng {
  return new Rng('test-seed');
}

// ---------------------------------------------------------------------------
// weightedPick — normal operation
// ---------------------------------------------------------------------------

describe('Rng.weightedPick — normal weights', () => {
  it('returns a key that exists in the weights map', () => {
    const r = rng();
    const result = r.weightedPick({ a: 1, b: 2, c: 3 });
    expect(['a', 'b', 'c']).toContain(result);
  });

  it('always returns the sole key when only one key has positive weight', () => {
    const r = rng();
    // Run several times to confirm it never deviates.
    for (let i = 0; i < 20; i++) {
      expect(r.weightedPick({ only: 5 })).toBe('only');
    }
  });

  it('never returns a key whose weight is zero when other keys have positive weight', () => {
    const r = rng();
    const weights = { never: 0, always: 100 };
    for (let i = 0; i < 50; i++) {
      expect(r.weightedPick(weights)).toBe('always');
    }
  });

  it('produces deterministic results for the same seed', () => {
    const sequence1: string[] = [];
    const sequence2: string[] = [];
    const weights = { x: 1, y: 2, z: 3 };

    const r1 = new Rng('determinism-seed');
    const r2 = new Rng('determinism-seed');

    for (let i = 0; i < 30; i++) {
      sequence1.push(r1.weightedPick(weights));
      sequence2.push(r2.weightedPick(weights));
    }

    expect(sequence1).toEqual(sequence2);
  });

  it('higher-weight keys are sampled more often over many draws', () => {
    // Weight ratio 1:9 → 'rare' should appear ~10% of the time.
    const r = new Rng('distribution-seed');
    const counts: Record<string, number> = { rare: 0, common: 0 };
    const draws = 10_000;

    for (let i = 0; i < draws; i++) {
      counts[r.weightedPick({ rare: 1, common: 9 })]++;
    }

    // With 10 000 draws, expect rare ~ 1000 ± 200 (very generous band).
    expect(counts.rare).toBeGreaterThan(700);
    expect(counts.rare).toBeLessThan(1300);
    expect(counts.common).toBeGreaterThan(8700);
  });

  it('accepts fractional weights', () => {
    const r = rng();
    const result = r.weightedPick({ a: 0.1, b: 0.9 });
    expect(['a', 'b']).toContain(result);
  });

  it('weights need not sum to 1 — relative proportions are what matter', () => {
    // { a:100, b:900 } and { a:1, b:9 } should produce the same distribution.
    const draws = 5_000;

    const r1 = new Rng('scale-test');
    let countA1 = 0;
    for (let i = 0; i < draws; i++) {
      if (r1.weightedPick({ a: 1, b: 9 }) === 'a') countA1++;
    }

    const r2 = new Rng('scale-test');
    let countA2 = 0;
    for (let i = 0; i < draws; i++) {
      if (r2.weightedPick({ a: 100, b: 900 }) === 'a') countA2++;
    }

    // Both RNGs use the same seed so results are identical draw-for-draw.
    expect(countA1).toBe(countA2);
  });
});

// ---------------------------------------------------------------------------
// weightedPick — zero-weight error guard (the fix under test)
// ---------------------------------------------------------------------------

describe('Rng.weightedPick — zero total weight throws RangeError', () => {
  it('throws RangeError when all weights are explicitly zero', () => {
    const r = rng();
    expect(() => r.weightedPick({ a: 0, b: 0, c: 0 })).toThrowError(RangeError);
  });

  it('RangeError message mentions "total weight"', () => {
    const r = rng();
    expect(() => r.weightedPick({ x: 0 })).toThrowError(/total weight/i);
  });

  it('throws RangeError for an empty weights object', () => {
    const r = rng();
    // {} has no entries → reduce returns 0 → same code path.
    expect(() => r.weightedPick({})).toThrowError(RangeError);
  });

  it('RangeError message mentions "positive weight" hint for empty object', () => {
    const r = rng();
    expect(() => r.weightedPick({})).toThrowError(/positive weight/i);
  });

  it('does not throw when at least one weight is positive', () => {
    const r = rng();
    expect(() => r.weightedPick({ a: 0, b: 0, c: 1 })).not.toThrow();
  });

  it('throws RangeError and does not consume PRNG state before the guard', () => {
    // State should be unchanged after a guarded throw so subsequent calls
    // remain on the expected sequence.
    const r1 = new Rng('state-test');
    const r2 = new Rng('state-test');

    // Advance r1 through a guarded throw.
    expect(() => r1.weightedPick({ a: 0 })).toThrowError(RangeError);

    // Both RNGs should produce the same next float because weightedPick
    // throws before calling this.next().
    expect(r1.next()).toBe(r2.next());
  });
});

// ---------------------------------------------------------------------------
// fork() — determinism fix
// Child seed is derived from _seed (original string), not mutable this.state,
// so child sequences are stable regardless of how much the parent has advanced.
// ---------------------------------------------------------------------------

describe('Rng.fork — child sequence is independent of parent consumption', () => {
  it('fork produces the same sequence before and after parent advances', () => {
    const fresh = new Rng('fork-seed');
    const advanced = new Rng('fork-seed');

    // Advance the second parent by varying amounts before forking.
    for (let i = 0; i < 50; i++) advanced.next();

    const childFresh = fresh.fork('ns');
    const childAdvanced = advanced.fork('ns');

    const seq1: number[] = [];
    const seq2: number[] = [];
    for (let i = 0; i < 20; i++) {
      seq1.push(childFresh.next());
      seq2.push(childAdvanced.next());
    }

    expect(seq1).toEqual(seq2);
  });

  it('child sequence is unaffected even after heavy parent consumption', () => {
    const light = new Rng('heavy-test');
    const heavy = new Rng('heavy-test');

    // Drive heavy parent through thousands of calls.
    for (let i = 0; i < 10_000; i++) heavy.next();

    const childLight = light.fork('sub');
    const childHeavy = heavy.fork('sub');

    const seq1: number[] = [];
    const seq2: number[] = [];
    for (let i = 0; i < 20; i++) {
      seq1.push(childLight.next());
      seq2.push(childHeavy.next());
    }

    expect(seq1).toEqual(seq2);
  });
});

describe('Rng.fork — different namespaces produce different sequences', () => {
  it('fork("x") and fork("y") yield different first values', () => {
    const r = new Rng('ns-test');
    const childX = r.fork('x');
    const childY = r.fork('y');
    // Two independent namespace hashes — sequences must diverge.
    expect(childX.next()).not.toBe(childY.next());
  });

  it('fork("x") and fork("y") sequences are distinct over many draws', () => {
    const r = new Rng('ns-diverge');
    const childX = r.fork('x');
    const childY = r.fork('y');

    const seqX: number[] = [];
    const seqY: number[] = [];
    for (let i = 0; i < 20; i++) {
      seqX.push(childX.next());
      seqY.push(childY.next());
    }

    expect(seqX).not.toEqual(seqY);
  });

  it('several distinct namespaces each produce a unique sequence', () => {
    const r = new Rng('multi-ns');
    const namespaces = ['terrain', 'props', 'npcs', 'weather', 'loot'];
    const sequences = namespaces.map((ns) => {
      const child = r.fork(ns);
      return Array.from({ length: 10 }, () => child.next());
    });

    // Every pair of sequences should differ.
    for (let i = 0; i < sequences.length; i++) {
      for (let j = i + 1; j < sequences.length; j++) {
        expect(sequences[i]).not.toEqual(sequences[j]);
      }
    }
  });
});

describe('Rng.fork — two parents with same seed produce identical fork results', () => {
  it('sibling parents yield identical child sequences for the same namespace', () => {
    const parent1 = new Rng('shared-seed');
    const parent2 = new Rng('shared-seed');

    const child1 = parent1.fork('level');
    const child2 = parent2.fork('level');

    const seq1: number[] = [];
    const seq2: number[] = [];
    for (let i = 0; i < 20; i++) {
      seq1.push(child1.next());
      seq2.push(child2.next());
    }

    expect(seq1).toEqual(seq2);
  });

  it('same-seed parents diverged by different consumption still agree on fork output', () => {
    const parent1 = new Rng('parity-seed');
    const parent2 = new Rng('parity-seed');

    // Consume parent1 and parent2 differently before forking.
    for (let i = 0; i < 7; i++) parent1.next();
    for (let i = 0; i < 99; i++) parent2.next();

    const child1 = parent1.fork('zone');
    const child2 = parent2.fork('zone');

    const seq1: number[] = [];
    const seq2: number[] = [];
    for (let i = 0; i < 20; i++) {
      seq1.push(child1.next());
      seq2.push(child2.next());
    }

    expect(seq1).toEqual(seq2);
  });
});

describe('Rng.fork — same seed + same namespace always yields same child sequence', () => {
  it('repeated fork calls on the same parent reproduce identical sequences', () => {
    const parent = new Rng('repro-seed');

    const child1 = parent.fork('room');
    // Advance parent between forks — must not change outcome.
    parent.next();
    parent.next();
    const child2 = parent.fork('room');

    const seq1: number[] = [];
    const seq2: number[] = [];
    for (let i = 0; i < 20; i++) {
      seq1.push(child1.next());
      seq2.push(child2.next());
    }

    expect(seq1).toEqual(seq2);
  });

  it('fork result is fully reproducible across separate Rng instances', () => {
    // Simulate two runs of the same map generation — results must match.
    const runA = new Rng('world-42').fork('chunk-3');
    const runB = new Rng('world-42').fork('chunk-3');

    const seqA: number[] = [];
    const seqB: number[] = [];
    for (let i = 0; i < 30; i++) {
      seqA.push(runA.next());
      seqB.push(runB.next());
    }

    expect(seqA).toEqual(seqB);
  });

  it('grandchild fork is also deterministic and parent-consumption-independent', () => {
    // Fork chains must be stable at every depth level.
    const light = new Rng('grandparent');
    const heavy = new Rng('grandparent');

    for (let i = 0; i < 200; i++) heavy.next();

    const gcLight = light.fork('child').fork('grandchild');
    const gcHeavy = heavy.fork('child').fork('grandchild');

    const seqLight: number[] = [];
    const seqHeavy: number[] = [];
    for (let i = 0; i < 20; i++) {
      seqLight.push(gcLight.next());
      seqHeavy.push(gcHeavy.next());
    }

    expect(seqLight).toEqual(seqHeavy);
  });
});
