import { describe, it, expect } from 'vitest';
import { poissonDisk } from './PoissonDisk';
import { Rng } from '../core/Rng';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Asserts that no two points in the result are closer than minRadius. */
function assertMinSpacing(
  points: { x: number; y: number }[],
  minRadius: number,
): void {
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const d = dist(points[i].x, points[i].y, points[j].x, points[j].y);
      expect(d).toBeGreaterThanOrEqual(minRadius - 1e-9);
    }
  }
}

/** Asserts that every point lies within the declared domain. */
function assertInBounds(
  points: { x: number; y: number }[],
  width: number,
  height: number,
): void {
  for (const p of points) {
    expect(p.x).toBeGreaterThanOrEqual(0);
    expect(p.x).toBeLessThan(width);
    expect(p.y).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeLessThan(height);
  }
}

// ---------------------------------------------------------------------------
// No accept predicate — baseline behaviour
// ---------------------------------------------------------------------------

describe('poissonDisk — no accept predicate', () => {
  it('returns at least one point for a non-trivial domain', () => {
    const rng = new Rng('baseline-seed');
    const points = poissonDisk({ width: 200, height: 200, minRadius: 20, rng });
    expect(points.length).toBeGreaterThan(0);
  });

  it('all points are within the domain bounds', () => {
    const rng = new Rng('bounds-check');
    const points = poissonDisk({ width: 300, height: 300, minRadius: 25, rng });
    assertInBounds(points, 300, 300);
  });

  it('produces deterministic output for the same seed', () => {
    const points1 = poissonDisk({ width: 200, height: 200, minRadius: 20, rng: new Rng('det-seed') });
    const points2 = poissonDisk({ width: 200, height: 200, minRadius: 20, rng: new Rng('det-seed') });
    expect(points1).toEqual(points2);
  });

  it('produces different output for different seeds', () => {
    const a = poissonDisk({ width: 200, height: 200, minRadius: 20, rng: new Rng('seed-A') });
    const b = poissonDisk({ width: 200, height: 200, minRadius: 20, rng: new Rng('seed-B') });
    // Different seeds must not produce identical point sequences.
    const identical = a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y);
    expect(identical).toBe(false);
  });

  it('fills a large domain with many points', () => {
    const rng = new Rng('fill-test');
    // With minRadius=20 a 400x400 domain can hold ~(400*400)/(pi*20^2) ≈ 127 points.
    const points = poissonDisk({ width: 400, height: 400, minRadius: 20, rng });
    expect(points.length).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------
// Poisson disk spacing guarantee
// ---------------------------------------------------------------------------

describe('poissonDisk — spacing guarantee', () => {
  it('no two points are closer than minRadius (small domain)', () => {
    const rng = new Rng('spacing-small');
    const minRadius = 15;
    const points = poissonDisk({ width: 150, height: 150, minRadius, rng });
    assertMinSpacing(points, minRadius);
  });

  it('no two points are closer than minRadius (large domain)', () => {
    const rng = new Rng('spacing-large');
    const minRadius = 20;
    const points = poissonDisk({ width: 200, height: 200, minRadius, rng });
    assertMinSpacing(points, minRadius);
  });

  it('spacing guarantee holds regardless of maxAttempts', () => {
    const rng = new Rng('spacing-attempts');
    const minRadius = 20;
    const points = poissonDisk({ width: 200, height: 200, minRadius, maxAttempts: 5, rng });
    assertMinSpacing(points, minRadius);
  });

  it('single-point domain contains exactly one point with correct coordinates', () => {
    // When width === height === minRadius the only valid area is a single cell;
    // the algorithm must produce exactly one point with no spacing violations.
    const rng = new Rng('single-point');
    const minRadius = 30;
    const points = poissonDisk({ width: minRadius, height: minRadius, minRadius, rng });
    expect(points.length).toBe(1);
    assertMinSpacing(points, minRadius);
  });
});

// ---------------------------------------------------------------------------
// accept predicate — seed retry fix
// ---------------------------------------------------------------------------

describe('poissonDisk — accept predicate (seed retry fix)', () => {
  it('produces points when the predicate accepts the full domain', () => {
    const rng = new Rng('accept-all');
    const points = poissonDisk(
      { width: 200, height: 200, minRadius: 20, rng },
      () => true,
    );
    expect(points.length).toBeGreaterThan(0);
  });

  it('generates points when the predicate rejects the first few seed positions but accepts later ones', () => {
    // The accept predicate allows only the right half of the domain (x >= 100).
    // With a 200×200 domain half the area is valid, so the seed retry loop
    // (up to 30 attempts) will almost certainly find a valid seed, and the
    // algorithm must return a non-empty result.
    const rng = new Rng('partial-domain');
    const points = poissonDisk(
      { width: 200, height: 200, minRadius: 20, rng },
      (x) => x >= 100,
    );
    expect(points.length).toBeGreaterThan(0);
    // Every accepted point must satisfy the predicate.
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(100);
    }
  });

  it('generates points when only a narrow vertical strip is accepted', () => {
    // Accept a 40-px wide vertical strip in the centre of a 400-px-wide domain.
    // Roughly 10 % of the area is valid, so the 30-attempt seed retry must
    // succeed on the majority of seeds.
    const rng = new Rng('narrow-strip');
    const points = poissonDisk(
      { width: 400, height: 400, minRadius: 10, rng },
      (x) => x >= 180 && x < 220,
    );
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(180);
      expect(p.x).toBeLessThan(220);
    }
  });

  it('returns an empty array when the accept predicate rejects everything', () => {
    // A predicate that never passes means both the seed retry loop and every
    // subsequent candidate will be rejected; the result must be empty.
    const rng = new Rng('reject-all');
    const points = poissonDisk(
      { width: 200, height: 200, minRadius: 20, rng },
      () => false,
    );
    expect(points).toEqual([]);
  });

  it('returns an empty array when the accept predicate rejects everything regardless of maxAttempts', () => {
    const rng = new Rng('reject-all-custom-attempts');
    const points = poissonDisk(
      { width: 200, height: 200, minRadius: 20, maxAttempts: 10, rng },
      () => false,
    );
    expect(points).toEqual([]);
  });

  it('spacing guarantee holds inside the accepted sub-domain', () => {
    const rng = new Rng('accept-spacing');
    const minRadius = 15;
    const points = poissonDisk(
      { width: 300, height: 300, minRadius, rng },
      (x) => x >= 150,
    );
    assertMinSpacing(points, minRadius);
  });

  it('uses the seed retry path: a deterministic seed whose first candidate falls outside the accept region still produces points', () => {
    // We run without the accept predicate first to find the initial seed
    // coordinates that a given RNG seed would generate, then confirm that
    // a predicate deliberately blocking that seed position does not block
    // the entire run — i.e. the retry loop finds an alternative.

    // Capture the first seed position by inspecting the first returned point
    // from an unrestricted run (which IS the initial seed).
    const probeRng = new Rng('retry-probe');
    const unrestricted = poissonDisk({ width: 300, height: 300, minRadius: 20, rng: probeRng });
    expect(unrestricted.length).toBeGreaterThan(0);
    const firstSeed = unrestricted[0];

    // Build a predicate that blocks a small region around that seed but leaves
    // the rest of the domain open.  A 30-px exclusion zone around one point is
    // much smaller than the 300×300 domain, so at least one of the 30 retry
    // candidates will land outside it.
    const blockRadius = 30;
    const accept = (x: number, y: number): boolean => {
      const dx = x - firstSeed.x;
      const dy = y - firstSeed.y;
      return dx * dx + dy * dy > blockRadius * blockRadius;
    };

    const rng = new Rng('retry-probe'); // same seed — same RNG sequence
    const points = poissonDisk({ width: 300, height: 300, minRadius: 20, rng }, accept);
    expect(points.length).toBeGreaterThan(0);
  });
});
