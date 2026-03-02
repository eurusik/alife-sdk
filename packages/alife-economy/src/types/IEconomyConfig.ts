// types/IEconomyConfig.ts
// Configuration for all economy subsystems.

/**
 * Trade system configuration.
 */
export interface ITradeConfig {
  /** Buy price multiplier (e.g. 1.3 = 130% of base price). */
  readonly buyPriceMultiplier: number;
  /** Sell price multiplier (e.g. 0.5 = 50% of base price). */
  readonly sellPriceMultiplier: number;
  /** Price multiplier for allied factions (buy only). */
  readonly allyDiscount: number;
  /** Faction relation above which ally discount applies. */
  readonly allyThreshold: number;
  /** Minimum faction relation to allow trading. */
  readonly minRelationToTrade: number;
  /** Trader restock interval (ms). */
  readonly restockIntervalMs: number;
  /** Probability [0-1] of a bonus item appearing during restock. Default 0.4. */
  readonly bonusItemChance: number;
}

/**
 * Inventory system configuration.
 */
export interface IInventoryConfig {
  /** Maximum number of distinct item slots. */
  readonly maxSlots: number;
  /** Default max stack size when item doesn't specify one. */
  readonly defaultMaxStack: number;
}

/**
 * Root economy configuration.
 */
export interface IEconomyConfig {
  readonly trade: ITradeConfig;
  readonly inventory: IInventoryConfig;
}

/** Create production economy config with optional overrides. */
export function createDefaultEconomyConfig(
  overrides?: Partial<{
    trade: Partial<ITradeConfig>;
    inventory: Partial<IInventoryConfig>;
  }>,
): IEconomyConfig {
  return {
    trade: {
      buyPriceMultiplier: 1.3,
      sellPriceMultiplier: 0.5,
      allyDiscount: 0.8,
      allyThreshold: 50,
      minRelationToTrade: -30,
      restockIntervalMs: 300_000,
      bonusItemChance: 0.4,
      ...overrides?.trade,
    },
    inventory: {
      maxSlots: 30,
      defaultMaxStack: 99,
      ...overrides?.inventory,
    },
  };
}
