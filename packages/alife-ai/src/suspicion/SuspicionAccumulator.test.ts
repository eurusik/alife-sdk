// suspicion/SuspicionAccumulator.test.ts

import { describe, it, expect } from 'vitest';
import {
  SuspicionAccumulator,
  SuspicionStimuli,
  createDefaultSuspicionConfig,
  type ISuspicionConfig,
} from './SuspicionAccumulator';

// ---------------------------------------------------------------------------
// createDefaultSuspicionConfig
// ---------------------------------------------------------------------------

describe('createDefaultSuspicionConfig', () => {
  it('returns defaults when called with no args', () => {
    const cfg = createDefaultSuspicionConfig();
    expect(cfg.decayRate).toBe(0.08);
    expect(cfg.maxLevel).toBeUndefined();
  });

  it('merges decayRate override without affecting other fields', () => {
    const cfg = createDefaultSuspicionConfig({ decayRate: 0.05 });
    expect(cfg.decayRate).toBe(0.05);
  });

  it('accepts both overrides independently', () => {
    const cfg = createDefaultSuspicionConfig({ decayRate: 0.02, maxLevel: 2.0 });
    expect(cfg.decayRate).toBe(0.02);
    expect(cfg.maxLevel).toBe(2.0);
  });
});

// ---------------------------------------------------------------------------
// SuspicionStimuli constants
// ---------------------------------------------------------------------------

describe('SuspicionStimuli', () => {
  it('exports expected named constants', () => {
    expect(SuspicionStimuli.SOUND).toBe('sound');
    expect(SuspicionStimuli.PARTIAL_SIGHT).toBe('partial_sight');
    expect(SuspicionStimuli.FOOTSTEP).toBe('footstep');
    expect(SuspicionStimuli.EXPLOSION).toBe('explosion');
    expect(SuspicionStimuli.BODY_FOUND).toBe('body_found');
  });
});

// ---------------------------------------------------------------------------
// add
// ---------------------------------------------------------------------------

describe('SuspicionAccumulator.add', () => {
  it('getLevel() returns 0 initially', () => {
    const acc = new SuspicionAccumulator();
    expect(acc.getLevel()).toBe(0);
  });

  it('add() increases level', () => {
    const acc = new SuspicionAccumulator();
    acc.add(SuspicionStimuli.SOUND, 0.3);
    expect(acc.getLevel()).toBe(0.3);
  });

  it('add() accumulates across multiple calls', () => {
    const acc = new SuspicionAccumulator();
    acc.add(SuspicionStimuli.SOUND, 0.2);
    acc.add(SuspicionStimuli.FOOTSTEP, 0.3);
    expect(acc.getLevel()).toBeCloseTo(0.5, 5);
  });

  it('add() clamps to maxLevel (default 1.0)', () => {
    const acc = new SuspicionAccumulator();
    acc.add(SuspicionStimuli.EXPLOSION, 0.7);
    acc.add(SuspicionStimuli.EXPLOSION, 0.7); // would be 1.4
    expect(acc.getLevel()).toBe(1.0);
  });

  it('add() clamps to custom maxLevel', () => {
    const acc = new SuspicionAccumulator({ maxLevel: 2.0 });
    acc.add(SuspicionStimuli.BODY_FOUND, 1.5);
    acc.add(SuspicionStimuli.BODY_FOUND, 1.5);
    expect(acc.getLevel()).toBe(2.0);
  });

  it('add() with negative amount is ignored', () => {
    const acc = new SuspicionAccumulator();
    acc.add(SuspicionStimuli.SOUND, -0.5);
    expect(acc.getLevel()).toBe(0);
  });

  it('add() with zero amount is ignored', () => {
    const acc = new SuspicionAccumulator();
    acc.add(SuspicionStimuli.SOUND, 0);
    expect(acc.getLevel()).toBe(0);
  });

  it('add() with NaN amount is ignored (no corruption)', () => {
    const acc = new SuspicionAccumulator();
    acc.add(SuspicionStimuli.SOUND, 0.3);
    acc.add(SuspicionStimuli.SOUND, NaN);
    expect(acc.getLevel()).toBe(0.3); // unchanged, not NaN
  });

  it('add() with x/y updates lastKnownPosition', () => {
    const acc = new SuspicionAccumulator();
    acc.add(SuspicionStimuli.SOUND, 0.3, 100, 200);
    expect(acc.getLastKnownPosition()).toEqual({ x: 100, y: 200 });
  });

  it('add() without x/y does NOT update lastKnownPosition', () => {
    const acc = new SuspicionAccumulator();
    acc.add(SuspicionStimuli.SOUND, 0.3);
    expect(acc.getLastKnownPosition()).toBeNull();
  });

  it('add() with x but no y does NOT update lastKnownPosition', () => {
    const acc = new SuspicionAccumulator();
    acc.add(SuspicionStimuli.SOUND, 0.3, 100 /* y omitted */);
    expect(acc.getLastKnownPosition()).toBeNull();
    expect(acc.getLevel()).toBe(0.3); // level still accumulates
  });

  it('add() updates lastKnownPosition with most recent call', () => {
    const acc = new SuspicionAccumulator();
    acc.add(SuspicionStimuli.SOUND, 0.2, 10, 20);
    acc.add(SuspicionStimuli.EXPLOSION, 0.4, 50, 60);
    expect(acc.getLastKnownPosition()).toEqual({ x: 50, y: 60 });
  });

  it('custom stimulus string works like built-in constants', () => {
    const acc = new SuspicionAccumulator();
    acc.add('psi_interference', 0.5);
    expect(acc.getLevel()).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// hasReachedAlert
// ---------------------------------------------------------------------------

describe('SuspicionAccumulator.hasReachedAlert', () => {
  it('returns false initially', () => {
    const acc = new SuspicionAccumulator();
    expect(acc.hasReachedAlert(0.7)).toBe(false);
  });

  it('returns true when level strictly above threshold', () => {
    const acc = new SuspicionAccumulator();
    acc.add(SuspicionStimuli.BODY_FOUND, 0.8);
    expect(acc.hasReachedAlert(0.7)).toBe(true);
  });

  it('returns false when level equals threshold (strict >)', () => {
    const acc = new SuspicionAccumulator();
    acc.add(SuspicionStimuli.SOUND, 0.7);
    expect(acc.hasReachedAlert(0.7)).toBe(false);
  });

  // -------------------------------------------------------------------------
  // hasReachedAlert no-arg default fix (round-4):
  //   Old default: maxLevel   (meant only a fully-saturated accumulator triggered)
  //   New default: 0.7 * maxLevel  (matches IStateConfig suspicionAlertThreshold)
  // -------------------------------------------------------------------------

  it('no-arg hasReachedAlert returns true when level > 0.7 * maxLevel', () => {
    // With default maxLevel = 1.0, the implicit threshold is 0.7.
    // Adding 0.8 puts the level above the threshold.
    const acc = new SuspicionAccumulator({ maxLevel: 1.0 });
    acc.add(SuspicionStimuli.EXPLOSION, 0.8);
    expect(acc.hasReachedAlert()).toBe(true); // 0.8 > 0.7
  });

  it('no-arg hasReachedAlert returns false when level equals 0.7 * maxLevel (strict >)', () => {
    const acc = new SuspicionAccumulator({ maxLevel: 1.0 });
    acc.add(SuspicionStimuli.EXPLOSION, 0.7); // level === threshold → not triggered
    expect(acc.hasReachedAlert()).toBe(false); // 0.7 > 0.7 is false
  });

  it('no-arg hasReachedAlert returns false when level is below 0.7 * maxLevel', () => {
    const acc = new SuspicionAccumulator({ maxLevel: 1.0 });
    acc.add(SuspicionStimuli.SOUND, 0.5);
    expect(acc.hasReachedAlert()).toBe(false); // 0.5 > 0.7 is false
  });

  it('no-arg hasReachedAlert respects a custom maxLevel for the 0.7 fraction', () => {
    // With maxLevel = 2.0, the implicit threshold is 0.7 * 2.0 = 1.4.
    const acc = new SuspicionAccumulator({ maxLevel: 2.0 });
    acc.add(SuspicionStimuli.EXPLOSION, 1.5);
    expect(acc.hasReachedAlert()).toBe(true);  // 1.5 > 1.4

    const acc2 = new SuspicionAccumulator({ maxLevel: 2.0 });
    acc2.add(SuspicionStimuli.SOUND, 1.3);
    expect(acc2.hasReachedAlert()).toBe(false); // 1.3 > 1.4 is false
  });

  it('explicit threshold is used as-is, not scaled (regression)', () => {
    // Callers that pass an explicit threshold must not be affected by the
    // no-arg default change — they should still get exact threshold comparison.
    const acc = new SuspicionAccumulator({ maxLevel: 1.0 });
    acc.add(SuspicionStimuli.BODY_FOUND, 0.8);
    expect(acc.hasReachedAlert(0.7)).toBe(true);  // 0.8 > 0.7
    expect(acc.hasReachedAlert(0.9)).toBe(false); // 0.8 > 0.9 is false
    expect(acc.hasReachedAlert(1.0)).toBe(false); // 0.8 > 1.0 is false
  });
});

// ---------------------------------------------------------------------------
// update (decay)
// ---------------------------------------------------------------------------

describe('SuspicionAccumulator.update', () => {
  it('decays level by decayRate × deltaSec', () => {
    const acc = new SuspicionAccumulator({ decayRate: 0.1 });
    acc.add(SuspicionStimuli.SOUND, 0.5);
    acc.update(1); // 1s → decay 0.1
    expect(acc.getLevel()).toBeCloseTo(0.4, 5);
  });

  it('clamps to 0 — never goes negative', () => {
    const acc = new SuspicionAccumulator({ decayRate: 0.5 });
    acc.add(SuspicionStimuli.SOUND, 0.3);
    acc.update(5); // 5s × 0.5 = 2.5 > 0.3
    expect(acc.getLevel()).toBe(0);
  });

  it('decays to exactly 0 when decay equals current level', () => {
    const acc = new SuspicionAccumulator({ decayRate: 0.5 });
    acc.add(SuspicionStimuli.SOUND, 0.5);
    acc.update(1); // 0.5 - 0.5 = 0
    expect(acc.getLevel()).toBe(0);
  });

  it('does nothing when level is already 0', () => {
    const acc = new SuspicionAccumulator();
    acc.update(10);
    expect(acc.getLevel()).toBe(0);
  });

  it('update() with negative deltaSec is a no-op (does not increase level)', () => {
    const acc = new SuspicionAccumulator({ decayRate: 0.1 });
    acc.add(SuspicionStimuli.SOUND, 0.5);
    acc.update(-1);
    expect(acc.getLevel()).toBe(0.5); // unchanged
  });

  it('update() with NaN deltaSec is a no-op (no corruption)', () => {
    const acc = new SuspicionAccumulator({ decayRate: 0.1 });
    acc.add(SuspicionStimuli.SOUND, 0.5);
    acc.update(NaN);
    expect(acc.getLevel()).toBe(0.5); // unchanged, not NaN
  });

  it('update() with zero deltaSec is a no-op', () => {
    const acc = new SuspicionAccumulator({ decayRate: 0.1 });
    acc.add(SuspicionStimuli.SOUND, 0.5);
    acc.update(0);
    expect(acc.getLevel()).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// clear and clearPosition
// ---------------------------------------------------------------------------

describe('SuspicionAccumulator.clear', () => {
  it('clear() resets level to 0', () => {
    const acc = new SuspicionAccumulator();
    acc.add(SuspicionStimuli.SOUND, 0.8);
    acc.clear();
    expect(acc.getLevel()).toBe(0);
  });

  it('clear() resets lastKnownPosition to null', () => {
    const acc = new SuspicionAccumulator();
    acc.add(SuspicionStimuli.SOUND, 0.4, 100, 200);
    acc.clear();
    expect(acc.getLastKnownPosition()).toBeNull();
  });

  it('clearPosition() resets position but NOT level', () => {
    const acc = new SuspicionAccumulator();
    acc.add(SuspicionStimuli.SOUND, 0.5, 50, 75);
    acc.clearPosition();
    expect(acc.getLastKnownPosition()).toBeNull();
    expect(acc.getLevel()).toBe(0.5); // unchanged
  });

  it('clear() on empty accumulator is a no-op', () => {
    const acc = new SuspicionAccumulator();
    expect(() => acc.clear()).not.toThrow();
    expect(acc.getLevel()).toBe(0);
  });
});
