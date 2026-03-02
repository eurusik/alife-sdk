import { EconomyPlugin } from './EconomyPlugin';
import type { ALifeKernel, IRandom } from '@alife-sdk/core';

function mockRandom(): IRandom {
  return {
    next: () => 0.5,
    nextInt: (min: number, max: number) => Math.floor(0.5 * (max - min + 1)) + min,
    nextFloat: (min: number, max: number) => 0.5 * (max - min) + min,
  };
}

function mockKernel(): ALifeKernel {
  return {
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    portRegistry: {
      tryGet: () => undefined,
    },
  } as unknown as ALifeKernel;
}

describe('EconomyPlugin', () => {
  it('has name "economy"', () => {
    const plugin = new EconomyPlugin(mockRandom());
    expect(plugin.name).toBe('economy');
  });

  it('exposes playerInventory, traders, quests', () => {
    const plugin = new EconomyPlugin(mockRandom());
    expect(plugin.playerInventory).toBeDefined();
    expect(plugin.traders).toBeDefined();
    expect(plugin.quests).toBeDefined();
  });

  it('uses default config when none provided', () => {
    const plugin = new EconomyPlugin(mockRandom());
    expect(plugin.config.trade.buyPriceMultiplier).toBe(1.3);
    expect(plugin.config.inventory.maxSlots).toBe(30);
  });

  it('accepts partial config overrides', () => {
    const plugin = new EconomyPlugin(mockRandom(), {
      trade: { buyPriceMultiplier: 2.0, sellPriceMultiplier: 0.5, allyDiscount: 0.8, allyThreshold: 50, minRelationToTrade: -30, restockIntervalMs: 300_000, bonusItemChance: 0.4 },
      inventory: { maxSlots: 50, defaultMaxStack: 99 },
    });
    expect(plugin.config.trade.buyPriceMultiplier).toBe(2.0);
    expect(plugin.config.inventory.maxSlots).toBe(50);
  });

  it('deep merges partial trade config without losing other defaults', () => {
    // Only override one trade field — all other trade and inventory defaults must survive.
    const plugin = new EconomyPlugin(mockRandom(), { trade: { buyPriceMultiplier: 2.0 } });

    // The overridden value should be applied.
    expect(plugin.config.trade.buyPriceMultiplier).toBe(2.0);
    // All other trade defaults must be preserved.
    expect(plugin.config.trade.sellPriceMultiplier).toBe(0.5);
    expect(plugin.config.trade.allyDiscount).toBe(0.8);
    expect(plugin.config.trade.allyThreshold).toBe(50);
    expect(plugin.config.trade.minRelationToTrade).toBe(-30);
    expect(plugin.config.trade.restockIntervalMs).toBe(300_000);
    expect(plugin.config.trade.bonusItemChance).toBe(0.4);
    // Inventory defaults must also be fully preserved.
    expect(plugin.config.inventory.maxSlots).toBe(30);
    expect(plugin.config.inventory.defaultMaxStack).toBe(99);
  });

  it('install stores kernel reference', () => {
    const plugin = new EconomyPlugin(mockRandom());
    const kernel = mockKernel();
    expect(() => plugin.install(kernel)).not.toThrow();
  });

  it('init does not throw', () => {
    const plugin = new EconomyPlugin(mockRandom());
    plugin.install(mockKernel());
    expect(() => plugin.init!()).not.toThrow();
  });

  it('serialize returns state with playerInventory, traders, and quests', () => {
    const plugin = new EconomyPlugin(mockRandom());
    plugin.install(mockKernel());
    plugin.init!();

    const state = plugin.serialize!();
    expect(state).toHaveProperty('playerInventory');
    expect(state).toHaveProperty('traders');
    expect(state).toHaveProperty('quests');
  });

  it('restore does not throw on valid data', () => {
    const plugin = new EconomyPlugin(mockRandom());
    plugin.install(mockKernel());
    plugin.init!();

    const state = plugin.serialize!();
    expect(() => plugin.restore!(state)).not.toThrow();
  });

  it('serialize/restore preserves trader state round-trip', () => {
    const plugin = new EconomyPlugin(mockRandom());
    plugin.install(mockKernel());
    plugin.init!();

    plugin.traders.register('t1', 'loner', 5000);
    plugin.traders.addStock('t1', 'medkit', 10);
    plugin.traders.adjustMoney('t1', -2000);

    const state = plugin.serialize!();

    const plugin2 = new EconomyPlugin(mockRandom());
    plugin2.install(mockKernel());
    plugin2.init!();
    plugin2.restore!(state);

    expect(plugin2.traders.size).toBe(1);
    expect(plugin2.traders.getTrader('t1')?.money).toBe(3000);
    expect(plugin2.traders.hasStock('t1', 'medkit', 10)).toBe(true);
  });

  it('destroy clears resources', () => {
    const plugin = new EconomyPlugin(mockRandom());
    plugin.install(mockKernel());
    plugin.init!();

    expect(() => plugin.destroy!()).not.toThrow();
  });
});
