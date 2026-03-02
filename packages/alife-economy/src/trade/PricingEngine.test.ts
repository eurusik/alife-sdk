import { describe, it, expect, vi } from 'vitest';
import { calculateBuyPrice, calculateSellPrice, canTrade } from './PricingEngine';
import type { IPriceModifier } from './PricingEngine';
import { createDefaultEconomyConfig } from '../types/IEconomyConfig';

const config = createDefaultEconomyConfig().trade;

describe('calculateBuyPrice', () => {
  it('applies markup to base price', () => {
    const price = calculateBuyPrice(100, 0, config);
    expect(price).toBe(Math.round(100 * config.buyPriceMultiplier));
  });

  it('applies ally discount above threshold', () => {
    const normal = calculateBuyPrice(100, 0, config);
    const ally = calculateBuyPrice(100, 60, config);
    expect(ally).toBeLessThan(normal);
    expect(ally).toBe(Math.round(100 * config.buyPriceMultiplier * config.allyDiscount));
  });

  it('no discount below ally threshold', () => {
    const price = calculateBuyPrice(100, 40, config);
    expect(price).toBe(Math.round(100 * config.buyPriceMultiplier));
  });

  it('returns at least 1', () => {
    const price = calculateBuyPrice(0, 0, config);
    expect(price).toBeGreaterThanOrEqual(1);
  });

  it('returns integer', () => {
    const price = calculateBuyPrice(77, 30, config);
    expect(price).toBe(Math.round(price));
  });
});

describe('calculateSellPrice', () => {
  it('applies sell markup', () => {
    const price = calculateSellPrice(100, config);
    expect(price).toBe(Math.round(100 * config.sellPriceMultiplier));
  });

  it('no ally bonus on sell', () => {
    const price = calculateSellPrice(100, config);
    // Always flat markup.
    expect(price).toBe(Math.round(100 * config.sellPriceMultiplier));
  });

  it('returns at least 1', () => {
    expect(calculateSellPrice(0, config)).toBeGreaterThanOrEqual(1);
  });
});

describe('calculateBuyPrice modifier', () => {
  it('applies modifier after formula', () => {
    const half: IPriceModifier = (price) => price * 0.5;
    const base = calculateBuyPrice(100, 0, config);
    const discounted = calculateBuyPrice(100, 0, config, half);
    expect(discounted).toBe(Math.round(base * 0.5));
  });

  it('passes correct context to modifier', () => {
    const spy = vi.fn((price: number) => price);
    calculateBuyPrice(100, 60, config, spy);
    expect(spy).toHaveBeenCalledOnce();
    const [, ctx] = spy.mock.calls[0];
    expect(ctx.basePrice).toBe(100);
    expect(ctx.factionRelation).toBe(60);
  });

  it('clamps modifier result to minimum 1', () => {
    const zero: IPriceModifier = () => 0;
    expect(calculateBuyPrice(100, 0, config, zero)).toBe(1);
  });

  it('returns integer after modifier', () => {
    const frac: IPriceModifier = (price) => price * 0.33;
    const result = calculateBuyPrice(100, 0, config, frac);
    expect(result).toBe(Math.round(result));
  });

  it('no modifier = same result as before', () => {
    expect(calculateBuyPrice(100, 0, config)).toBe(
      calculateBuyPrice(100, 0, config, undefined),
    );
  });
});

describe('calculateSellPrice modifier', () => {
  it('applies modifier after formula', () => {
    const double: IPriceModifier = (price) => price * 2;
    const base = calculateSellPrice(100, config);
    const boosted = calculateSellPrice(100, config, double);
    expect(boosted).toBe(Math.round(base * 2));
  });

  it('passes basePrice in context (factionRelation=0 for sell)', () => {
    const spy = vi.fn((price: number) => price);
    calculateSellPrice(50, config, spy);
    const [, ctx] = spy.mock.calls[0];
    expect(ctx.basePrice).toBe(50);
    expect(ctx.factionRelation).toBe(0);
  });

  it('clamps modifier result to minimum 1', () => {
    const zero: IPriceModifier = () => -10;
    expect(calculateSellPrice(100, config, zero)).toBe(1);
  });
});

describe('canTrade', () => {
  it('allows trade above minimum relation', () => {
    expect(canTrade(0, config)).toBe(true);
  });

  it('allows trade at exact threshold', () => {
    expect(canTrade(config.minRelationToTrade, config)).toBe(true);
  });

  it('blocks trade below minimum relation', () => {
    expect(canTrade(-50, config)).toBe(false);
  });
});
