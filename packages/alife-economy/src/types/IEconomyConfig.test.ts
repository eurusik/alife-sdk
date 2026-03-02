import { createDefaultEconomyConfig } from './IEconomyConfig';

describe('createDefaultEconomyConfig', () => {
  it('returns complete config with no overrides', () => {
    const config = createDefaultEconomyConfig();

    expect(config.trade).toBeDefined();
    expect(config.inventory).toBeDefined();
  });

  it('has sensible trade defaults', () => {
    const config = createDefaultEconomyConfig();
    expect(config.trade.buyPriceMultiplier).toBe(1.3);
    expect(config.trade.sellPriceMultiplier).toBe(0.5);
    expect(config.trade.allyDiscount).toBe(0.8);
    expect(config.trade.allyThreshold).toBe(50);
    expect(config.trade.minRelationToTrade).toBe(-30);
    expect(config.trade.restockIntervalMs).toBe(300_000);
    expect(config.trade.bonusItemChance).toBe(0.4);
  });

  it('has sensible inventory defaults', () => {
    const config = createDefaultEconomyConfig();
    expect(config.inventory.maxSlots).toBe(30);
    expect(config.inventory.defaultMaxStack).toBe(99);
  });

  it('buy price > sell price (traders profit)', () => {
    const config = createDefaultEconomyConfig();
    expect(config.trade.buyPriceMultiplier).toBeGreaterThan(config.trade.sellPriceMultiplier);
  });

  it('merges partial trade overrides', () => {
    const config = createDefaultEconomyConfig({
      trade: { buyPriceMultiplier: 2.0 },
    });
    expect(config.trade.buyPriceMultiplier).toBe(2.0);
    expect(config.trade.sellPriceMultiplier).toBe(0.5); // preserved
  });

  it('merges partial inventory overrides', () => {
    const config = createDefaultEconomyConfig({
      inventory: { maxSlots: 50 },
    });
    expect(config.inventory.maxSlots).toBe(50);
    expect(config.inventory.defaultMaxStack).toBe(99); // preserved
  });
});
