import { clamp, moveTowardZero } from './utils';

describe('clamp', () => {
  it('returns value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('clamps below min', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it('clamps above max', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('returns min when value equals min', () => {
    expect(clamp(0, 0, 10)).toBe(0);
  });

  it('returns max when value equals max', () => {
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it('works with negative ranges', () => {
    expect(clamp(0, -10, -5)).toBe(-5);
  });
});

describe('moveTowardZero', () => {
  it('moves positive value toward zero', () => {
    expect(moveTowardZero(10, 3)).toBe(7);
  });

  it('moves negative value toward zero', () => {
    expect(moveTowardZero(-10, 3)).toBe(-7);
  });

  it('does not overshoot past zero (positive)', () => {
    expect(moveTowardZero(2, 5)).toBe(0);
  });

  it('does not overshoot past zero (negative)', () => {
    expect(moveTowardZero(-2, 5)).toBe(0);
  });

  it('returns 0 when already 0', () => {
    expect(moveTowardZero(0, 5)).toBe(0);
  });

  it('exact amount reaches zero', () => {
    expect(moveTowardZero(3, 3)).toBe(0);
    expect(moveTowardZero(-3, 3)).toBe(0);
  });
});
