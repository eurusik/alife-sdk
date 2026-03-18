// src/zones/ZoneTemplate.test.ts
// Unit tests for applyFlipCover — focusing on the Y-flip facingAngle fix:
// when flipY is true, facingAngle is negated (-a).
// when both flipX and flipY are true, both transforms are applied in order
// (first flipX: a = π - a, then flipY: a = -a), yielding -(π - angle).

import { describe, it, expect } from 'vitest';
import { applyFlipCover } from './ZoneTemplate';
import type { CoverOp } from './ZoneTemplate';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PI = Math.PI;

/**
 * Build a single CoverOp with the given angle.
 * rx/ry are set to a representative interior position so mirroring tests
 * have a non-trivial value to verify.
 */
function coverOp(facingAngle: number, rx = 4, ry = 3): CoverOp {
  return { rx, ry, facingAngle, radius: 32 };
}

/** Extract just the facingAngle values from a result array. */
function angles(ops: CoverOp[]): number[] {
  return ops.map((op) => op.facingAngle);
}

// ---------------------------------------------------------------------------
// No flip — identity
// ---------------------------------------------------------------------------

describe('applyFlipCover — no flip (identity)', () => {
  it('returns the same array reference when neither flip is set', () => {
    const ops = [coverOp(PI / 4)];
    const result = applyFlipCover(ops, false, false, 10, 10);
    expect(result).toBe(ops);
  });

  it('leaves facingAngle unchanged for a positive angle', () => {
    const ops = [coverOp(PI / 4)];
    const result = applyFlipCover(ops, false, false, 10, 10);
    expect(result[0].facingAngle).toBeCloseTo(PI / 4);
  });

  it('leaves facingAngle unchanged for a negative angle', () => {
    const ops = [coverOp(-PI / 4)];
    const result = applyFlipCover(ops, false, false, 10, 10);
    expect(result[0].facingAngle).toBeCloseTo(-PI / 4);
  });

  it('leaves rx and ry unchanged', () => {
    const ops = [coverOp(PI / 4, 3, 7)];
    const result = applyFlipCover(ops, false, false, 10, 10);
    expect(result[0].rx).toBe(3);
    expect(result[0].ry).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// flipX only — regression: angle = π - angle
// ---------------------------------------------------------------------------

describe('applyFlipCover — flipX only', () => {
  it('maps π/4 → 3π/4', () => {
    const result = applyFlipCover([coverOp(PI / 4)], true, false, 10, 10);
    expect(result[0].facingAngle).toBeCloseTo(PI * 3 / 4);
  });

  it('maps 3π/4 → π/4', () => {
    const result = applyFlipCover([coverOp(PI * 3 / 4)], true, false, 10, 10);
    expect(result[0].facingAngle).toBeCloseTo(PI / 4);
  });

  it('maps -π/4 → 5π/4 (= π - (-π/4) = 5π/4)', () => {
    const result = applyFlipCover([coverOp(-PI / 4)], true, false, 10, 10);
    expect(result[0].facingAngle).toBeCloseTo(PI - (-PI / 4));
  });

  it('maps -3π/4 → 7π/4 (= π - (-3π/4))', () => {
    const result = applyFlipCover([coverOp(-PI * 3 / 4)], true, false, 10, 10);
    expect(result[0].facingAngle).toBeCloseTo(PI - (-PI * 3 / 4));
  });

  it('mirrors rx across the width boundary (width - 1 - rx)', () => {
    const result = applyFlipCover([coverOp(PI / 4, 3, 5)], true, false, 10, 8);
    expect(result[0].rx).toBe(10 - 1 - 3); // 6
    expect(result[0].ry).toBe(5);           // unchanged
  });

  it('leaves ry unchanged', () => {
    const result = applyFlipCover([coverOp(PI / 4, 2, 6)], true, false, 10, 10);
    expect(result[0].ry).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// flipY only — the new fix: angle = -angle
// ---------------------------------------------------------------------------

describe('applyFlipCover — flipY only (Y-flip fix)', () => {
  it('maps π/4 → -π/4', () => {
    const result = applyFlipCover([coverOp(PI / 4)], false, true, 10, 10);
    expect(result[0].facingAngle).toBeCloseTo(-PI / 4);
  });

  it('maps -π/4 → π/4 (double negation)', () => {
    const result = applyFlipCover([coverOp(-PI / 4)], false, true, 10, 10);
    expect(result[0].facingAngle).toBeCloseTo(PI / 4);
  });

  it('maps 3π/4 → -3π/4', () => {
    const result = applyFlipCover([coverOp(PI * 3 / 4)], false, true, 10, 10);
    expect(result[0].facingAngle).toBeCloseTo(-PI * 3 / 4);
  });

  it('maps -3π/4 → 3π/4', () => {
    const result = applyFlipCover([coverOp(-PI * 3 / 4)], false, true, 10, 10);
    expect(result[0].facingAngle).toBeCloseTo(PI * 3 / 4);
  });

  it('maps 0 → 0 (zero angle is a fixed point under negation)', () => {
    const result = applyFlipCover([coverOp(0)], false, true, 10, 10);
    expect(result[0].facingAngle).toBeCloseTo(0);
  });

  it('maps π → -π (equivalent to π, but sign is applied)', () => {
    const result = applyFlipCover([coverOp(PI)], false, true, 10, 10);
    expect(result[0].facingAngle).toBeCloseTo(-PI);
  });

  it('mirrors ry across the height boundary (height - 1 - ry)', () => {
    const result = applyFlipCover([coverOp(PI / 4, 2, 3)], false, true, 10, 8);
    expect(result[0].rx).toBe(2);           // unchanged
    expect(result[0].ry).toBe(8 - 1 - 3);  // 4
  });

  it('leaves rx unchanged', () => {
    const result = applyFlipCover([coverOp(PI / 4, 5, 2)], false, true, 10, 10);
    expect(result[0].rx).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Both flipX and flipY — combined transform: a = -(π - angle)
// ---------------------------------------------------------------------------

describe('applyFlipCover — flipX and flipY combined', () => {
  it('maps π/4 → -(π - π/4) = -3π/4', () => {
    const result = applyFlipCover([coverOp(PI / 4)], true, true, 10, 10);
    expect(result[0].facingAngle).toBeCloseTo(-(PI - PI / 4));
  });

  it('maps 3π/4 → -(π - 3π/4) = -π/4', () => {
    const result = applyFlipCover([coverOp(PI * 3 / 4)], true, true, 10, 10);
    expect(result[0].facingAngle).toBeCloseTo(-(PI - PI * 3 / 4));
  });

  it('maps -π/4 → -(π - (-π/4)) = -5π/4', () => {
    const result = applyFlipCover([coverOp(-PI / 4)], true, true, 10, 10);
    expect(result[0].facingAngle).toBeCloseTo(-(PI - (-PI / 4)));
  });

  it('maps -3π/4 → -(π - (-3π/4)) = -7π/4', () => {
    const result = applyFlipCover([coverOp(-PI * 3 / 4)], true, true, 10, 10);
    expect(result[0].facingAngle).toBeCloseTo(-(PI - (-PI * 3 / 4)));
  });

  it('mirrors both rx and ry', () => {
    const result = applyFlipCover([coverOp(PI / 4, 2, 3)], true, true, 10, 8);
    expect(result[0].rx).toBe(10 - 1 - 2); // 7
    expect(result[0].ry).toBe(8  - 1 - 3); // 4
  });

  it('combining flipX then flipY is not the same as flipX alone', () => {
    const flipXOnly  = applyFlipCover([coverOp(PI / 4)], true,  false, 10, 10);
    const flipBoth   = applyFlipCover([coverOp(PI / 4)], true,  true,  10, 10);
    expect(flipBoth[0].facingAngle).not.toBeCloseTo(flipXOnly[0].facingAngle);
  });

  it('combining flipX then flipY is not the same as flipY alone', () => {
    const flipYOnly  = applyFlipCover([coverOp(PI / 4)], false, true,  10, 10);
    const flipBoth   = applyFlipCover([coverOp(PI / 4)], true,  true,  10, 10);
    expect(flipBoth[0].facingAngle).not.toBeCloseTo(flipYOnly[0].facingAngle);
  });
});

// ---------------------------------------------------------------------------
// Multiple cover ops — all ops in the array are transformed correctly
// ---------------------------------------------------------------------------

describe('applyFlipCover — multiple ops are all transformed', () => {
  it('flipY: every angle in a multi-op array is negated', () => {
    const ops = [
      coverOp(PI / 4,      1, 1),
      coverOp(PI * 3 / 4,  2, 2),
      coverOp(-PI / 4,     3, 3),
      coverOp(-PI * 3 / 4, 4, 4),
    ];
    const result = applyFlipCover(ops, false, true, 10, 10);

    expect(angles(result)).toEqual(
      expect.arrayContaining([
        expect.closeTo(-PI / 4,       8),
        expect.closeTo(-PI * 3 / 4,   8),
        expect.closeTo(PI / 4,        8),
        expect.closeTo(PI * 3 / 4,    8),
      ]),
    );
  });

  it('flipX: every angle in a multi-op array is remapped to π - a', () => {
    const ops = [
      coverOp(PI / 4,      1, 1),
      coverOp(PI * 3 / 4,  2, 2),
      coverOp(-PI / 4,     3, 3),
      coverOp(-PI * 3 / 4, 4, 4),
    ];
    const result = applyFlipCover(ops, true, false, 10, 10);
    const expected = ops.map((op) => PI - op.facingAngle);

    result.forEach((op, i) => {
      expect(op.facingAngle).toBeCloseTo(expected[i]);
    });
  });

  it('flipY: every ry in a multi-op array is mirrored', () => {
    const height = 8;
    const ops = [
      coverOp(PI / 4, 1, 1),
      coverOp(PI / 4, 2, 3),
      coverOp(PI / 4, 3, 6),
    ];
    const result = applyFlipCover(ops, false, true, 10, height);

    result.forEach((op, i) => {
      expect(op.ry).toBe(height - 1 - ops[i].ry);
    });
  });

  it('flipX: every rx in a multi-op array is mirrored', () => {
    const width = 10;
    const ops = [
      coverOp(PI / 4, 1, 1),
      coverOp(PI / 4, 4, 2),
      coverOp(PI / 4, 7, 3),
    ];
    const result = applyFlipCover(ops, true, false, width, 10);

    result.forEach((op, i) => {
      expect(op.rx).toBe(width - 1 - ops[i].rx);
    });
  });

  it('both flips: all four standard building-corner angles are remapped correctly', () => {
    // buildingCoverOps emits these four angles for every building corner.
    const ops = [
      coverOp(PI / 4),       // top-left  → SE
      coverOp(PI * 3 / 4),   // top-right → SW
      coverOp(-PI / 4),      // bot-left  → NE
      coverOp(-PI * 3 / 4),  // bot-right → NW
    ];
    const result = applyFlipCover(ops, true, true, 10, 10);
    const expected = ops.map((op) => -(PI - op.facingAngle));

    result.forEach((op, i) => {
      expect(op.facingAngle).toBeCloseTo(expected[i]);
    });
  });
});

// ---------------------------------------------------------------------------
// radius and other fields are preserved unchanged
// ---------------------------------------------------------------------------

describe('applyFlipCover — non-positional fields are preserved', () => {
  it('flipX: radius is unchanged', () => {
    const op = { rx: 3, ry: 3, facingAngle: PI / 4, radius: 48 };
    const result = applyFlipCover([op], true, false, 10, 10);
    expect(result[0].radius).toBe(48);
  });

  it('flipY: radius is unchanged', () => {
    const op = { rx: 3, ry: 3, facingAngle: PI / 4, radius: 64 };
    const result = applyFlipCover([op], false, true, 10, 10);
    expect(result[0].radius).toBe(64);
  });

  it('both flips: radius is unchanged', () => {
    const op = { rx: 3, ry: 3, facingAngle: PI / 4, radius: 96 };
    const result = applyFlipCover([op], true, true, 10, 10);
    expect(result[0].radius).toBe(96);
  });
});
