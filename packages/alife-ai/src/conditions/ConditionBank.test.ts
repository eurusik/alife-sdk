// conditions/ConditionBank.test.ts

import { describe, it, expect } from 'vitest';
import {
  ConditionBank,
  ConditionChannels,
  createDefaultConditionBankConfig,
  type IConditionBankConfig,
} from './ConditionBank';

// ---------------------------------------------------------------------------
// createDefaultConditionBankConfig
// ---------------------------------------------------------------------------

describe('createDefaultConditionBankConfig', () => {
  it('returns defaults when called with no args', () => {
    const cfg = createDefaultConditionBankConfig();
    expect(cfg.defaultDecayRate).toBe(0.01);
    expect(cfg.channelDecayRates).toBeUndefined();
    expect(cfg.maxLevel).toBeUndefined();
  });

  it('merges overrides without affecting other fields', () => {
    const cfg = createDefaultConditionBankConfig({ defaultDecayRate: 0.05 });
    expect(cfg.defaultDecayRate).toBe(0.05);
    expect(cfg.channelDecayRates).toBeUndefined(); // unchanged
  });

  it('accepts both overrides independently', () => {
    const cfg = createDefaultConditionBankConfig({
      defaultDecayRate: 0.02,
      channelDecayRates: { radiation: 0.005 },
      maxLevel: 100,
    });
    expect(cfg.defaultDecayRate).toBe(0.02);
    expect(cfg.channelDecayRates?.radiation).toBe(0.005);
    expect(cfg.maxLevel).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// ConditionChannels constants
// ---------------------------------------------------------------------------

describe('ConditionChannels', () => {
  it('exports expected named constants', () => {
    expect(ConditionChannels.BLEEDING).toBe('bleeding');
    expect(ConditionChannels.RADIATION).toBe('radiation');
    expect(ConditionChannels.HUNGER).toBe('hunger');
    expect(ConditionChannels.STAMINA).toBe('stamina');
    expect(ConditionChannels.INTOXICATION).toBe('intoxication');
  });
});

// ---------------------------------------------------------------------------
// apply
// ---------------------------------------------------------------------------

describe('ConditionBank.apply', () => {
  it('returns 0 for a channel that has never been applied', () => {
    const bank = new ConditionBank();
    expect(bank.getLevel('radiation')).toBe(0);
  });

  it('sets the channel level after a single apply call', () => {
    const bank = new ConditionBank();
    bank.apply('radiation', 0.3);
    expect(bank.getLevel('radiation')).toBe(0.3);
  });

  it('accumulates across multiple apply calls', () => {
    const bank = new ConditionBank();
    bank.apply('radiation', 0.2);
    bank.apply('radiation', 0.3);
    expect(bank.getLevel('radiation')).toBeCloseTo(0.5, 5);
  });

  it('clamps to maxLevel (default 1.0)', () => {
    const bank = new ConditionBank();
    bank.apply('radiation', 0.8);
    bank.apply('radiation', 0.8); // would be 1.6 without clamp
    expect(bank.getLevel('radiation')).toBe(1.0);
  });

  it('clamps to custom maxLevel', () => {
    const bank = new ConditionBank({ maxLevel: 100 });
    bank.apply('radiation', 80);
    bank.apply('radiation', 80);
    expect(bank.getLevel('radiation')).toBe(100);
  });

  it('custom channel string works like built-in channels', () => {
    const bank = new ConditionBank();
    bank.apply('psi_overload', 0.4);
    expect(bank.getLevel('psi_overload')).toBe(0.4);
  });
});

// ---------------------------------------------------------------------------
// recover
// ---------------------------------------------------------------------------

describe('ConditionBank.recover', () => {
  it('reduces the channel level', () => {
    const bank = new ConditionBank();
    bank.apply('bleeding', 0.6);
    bank.recover('bleeding', 0.2);
    expect(bank.getLevel('bleeding')).toBeCloseTo(0.4, 5);
  });

  it('clamps to 0 and removes channel from store', () => {
    const bank = new ConditionBank();
    bank.apply('bleeding', 0.3);
    bank.recover('bleeding', 1.0); // over-recover
    expect(bank.getLevel('bleeding')).toBe(0);
    expect(bank.getActiveChannels()).toHaveLength(0);
  });

  it('is a no-op for a channel that is already at 0', () => {
    const bank = new ConditionBank();
    expect(() => bank.recover('radiation', 0.5)).not.toThrow();
    expect(bank.getLevel('radiation')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// hasCondition
// ---------------------------------------------------------------------------

describe('ConditionBank.hasCondition', () => {
  it('returns false for unknown channel (default threshold)', () => {
    const bank = new ConditionBank();
    expect(bank.hasCondition('radiation')).toBe(false);
  });

  it('returns true when level is strictly above threshold', () => {
    const bank = new ConditionBank();
    bank.apply('stamina', 0.9);
    expect(bank.hasCondition('stamina', 0.8)).toBe(true);
  });

  it('returns false when level equals threshold (strict >)', () => {
    const bank = new ConditionBank();
    bank.apply('stamina', 0.8);
    expect(bank.hasCondition('stamina', 0.8)).toBe(false);
  });

  it('default threshold 0: true when any intensity exists', () => {
    const bank = new ConditionBank();
    bank.apply('hunger', 0.01);
    expect(bank.hasCondition('hunger')).toBe(true);
  });

  it('returns false after channel is cleared', () => {
    const bank = new ConditionBank();
    bank.apply('radiation', 0.5);
    bank.clear('radiation');
    expect(bank.hasCondition('radiation')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// update (time-based decay)
// ---------------------------------------------------------------------------

describe('ConditionBank.update', () => {
  it('decays all active channels by defaultDecayRate × deltaSec', () => {
    const bank = new ConditionBank({ defaultDecayRate: 0.1 });
    bank.apply('radiation', 0.5);
    bank.update(1); // 1 second → decay 0.1
    expect(bank.getLevel('radiation')).toBeCloseTo(0.4, 5);
  });

  it('uses per-channel override decay rate', () => {
    const bank = new ConditionBank({
      defaultDecayRate: 0.1,
      channelDecayRates: { radiation: 0.01 },
    });
    bank.apply('radiation', 0.5);
    bank.apply('bleeding', 0.5);
    bank.update(1); // radiation decays at 0.01, bleeding at 0.1
    expect(bank.getLevel('radiation')).toBeCloseTo(0.49, 4);
    expect(bank.getLevel('bleeding')).toBeCloseTo(0.4, 4);
  });

  it('clamps to 0 — never goes negative', () => {
    const bank = new ConditionBank({ defaultDecayRate: 0.5 });
    bank.apply('bleeding', 0.3);
    bank.update(2); // 2s × 0.5 = 1.0 > 0.3
    expect(bank.getLevel('bleeding')).toBe(0);
  });

  it('removes fully decayed channel from activeChannels', () => {
    const bank = new ConditionBank({ defaultDecayRate: 1.0 });
    bank.apply('bleeding', 0.5);
    bank.update(1);
    expect(bank.getActiveChannels()).toHaveLength(0);
  });

  it('does not affect channels that are already at 0', () => {
    const bank = new ConditionBank({ defaultDecayRate: 0.1 });
    bank.update(10); // nothing to decay
    expect(bank.getActiveChannels()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

describe('ConditionBank.clear', () => {
  it('clear(channel) resets a single channel to 0', () => {
    const bank = new ConditionBank();
    bank.apply('radiation', 0.5);
    bank.apply('bleeding', 0.3);
    bank.clear('radiation');
    expect(bank.getLevel('radiation')).toBe(0);
    expect(bank.getLevel('bleeding')).toBe(0.3); // unchanged
  });

  it('clear() with no argument resets all channels', () => {
    const bank = new ConditionBank();
    bank.apply('radiation', 0.5);
    bank.apply('bleeding', 0.3);
    bank.clear();
    expect(bank.getActiveChannels()).toHaveLength(0);
  });

  it('clear() on empty bank is a no-op', () => {
    const bank = new ConditionBank();
    expect(() => bank.clear()).not.toThrow();
    expect(bank.getActiveChannels()).toHaveLength(0);
  });

  it('clear(unknown channel) is a no-op', () => {
    const bank = new ConditionBank();
    expect(() => bank.clear('nonexistent')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getActiveChannels
// ---------------------------------------------------------------------------

describe('ConditionBank.getActiveChannels', () => {
  it('returns empty array when no conditions are active', () => {
    const bank = new ConditionBank();
    expect(bank.getActiveChannels()).toHaveLength(0);
  });

  it('returns all channels with level > 0', () => {
    const bank = new ConditionBank();
    bank.apply('radiation', 0.3);
    bank.apply('bleeding', 0.5);
    const active = bank.getActiveChannels();
    expect(active).toHaveLength(2);
    const channels = active.map(a => a.channel);
    expect(channels).toContain('radiation');
    expect(channels).toContain('bleeding');
  });

  it('does NOT include channels cleared to 0', () => {
    const bank = new ConditionBank();
    bank.apply('radiation', 0.3);
    bank.clear('radiation');
    expect(bank.getActiveChannels()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Multi-channel independence
// ---------------------------------------------------------------------------

describe('ConditionBank — channel independence', () => {
  it('channels are stored and decayed independently', () => {
    const bank = new ConditionBank({
      channelDecayRates: { radiation: 0.1, bleeding: 0.5 },
    });
    bank.apply('radiation', 0.8);
    bank.apply('bleeding', 0.8);
    bank.update(1);
    expect(bank.getLevel('radiation')).toBeCloseTo(0.7, 4);
    expect(bank.getLevel('bleeding')).toBeCloseTo(0.3, 4);
  });

  it('applying to one channel does not affect another', () => {
    const bank = new ConditionBank();
    bank.apply('radiation', 0.5);
    expect(bank.getLevel('bleeding')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Negative amount guards
// ---------------------------------------------------------------------------

describe('ConditionBank — negative amount guards', () => {
  it('apply: negative amount is ignored (channel stays at 0)', () => {
    const bank = new ConditionBank();
    bank.apply('radiation', -0.5);
    expect(bank.getLevel('radiation')).toBe(0);
    expect(bank.getActiveChannels()).toHaveLength(0);
  });

  it('apply: negative amount does not reduce an existing level', () => {
    const bank = new ConditionBank();
    bank.apply('radiation', 0.5);
    bank.apply('radiation', -0.3);
    expect(bank.getLevel('radiation')).toBe(0.5); // unchanged
  });

  it('recover: negative amount is ignored (channel stays unchanged)', () => {
    const bank = new ConditionBank();
    bank.apply('bleeding', 0.6);
    bank.recover('bleeding', -0.3);
    expect(bank.getLevel('bleeding')).toBe(0.6); // unchanged, not increased
  });

  it('recover: zero amount is a no-op', () => {
    const bank = new ConditionBank();
    bank.apply('bleeding', 0.6);
    bank.recover('bleeding', 0);
    expect(bank.getLevel('bleeding')).toBe(0.6);
  });

  it('apply: NaN amount is ignored (no corruption)', () => {
    const bank = new ConditionBank();
    bank.apply('radiation', 0.4);
    bank.apply('radiation', NaN);
    expect(bank.getLevel('radiation')).toBe(0.4); // unchanged, not NaN
  });

  it('recover: NaN amount is ignored (channel unchanged)', () => {
    const bank = new ConditionBank();
    bank.apply('bleeding', 0.6);
    bank.recover('bleeding', NaN);
    expect(bank.getLevel('bleeding')).toBe(0.6); // unchanged
  });
});

// ---------------------------------------------------------------------------
// update — NaN and negative deltaSec guards
// ---------------------------------------------------------------------------

describe('ConditionBank.update — invalid deltaSec', () => {
  it('update() with negative deltaSec is a no-op (does not increase levels)', () => {
    const bank = new ConditionBank({ defaultDecayRate: 0.1 });
    bank.apply('radiation', 0.5);
    bank.update(-1);
    expect(bank.getLevel('radiation')).toBe(0.5); // unchanged
  });

  it('update() with NaN deltaSec is a no-op (no corruption)', () => {
    const bank = new ConditionBank({ defaultDecayRate: 0.1 });
    bank.apply('radiation', 0.5);
    bank.update(NaN);
    expect(bank.getLevel('radiation')).toBe(0.5); // unchanged, not NaN
  });

  it('update() with zero deltaSec is a no-op', () => {
    const bank = new ConditionBank({ defaultDecayRate: 0.1 });
    bank.apply('radiation', 0.5);
    bank.update(0);
    expect(bank.getLevel('radiation')).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Multi-channel update with partial expiry
// ---------------------------------------------------------------------------

describe('ConditionBank.update — partial expiry', () => {
  it('removes expired channels while preserving surviving ones', () => {
    // 3 channels: radiation survives, bleeding and stamina expire in one tick
    const bank = new ConditionBank({
      channelDecayRates: { radiation: 0.01, bleeding: 1.0, stamina: 1.0 },
    });
    bank.apply('radiation', 0.8);
    bank.apply('bleeding', 0.3);
    bank.apply('stamina', 0.2);

    bank.update(1); // bleeding (0.3 - 1.0 ≤ 0) and stamina (0.2 - 1.0 ≤ 0) expire

    expect(bank.getLevel('radiation')).toBeCloseTo(0.79, 4);
    expect(bank.getLevel('bleeding')).toBe(0);
    expect(bank.getLevel('stamina')).toBe(0);
    expect(bank.getActiveChannels()).toHaveLength(1);
    expect(bank.getActiveChannels()[0].channel).toBe('radiation');
  });
});
