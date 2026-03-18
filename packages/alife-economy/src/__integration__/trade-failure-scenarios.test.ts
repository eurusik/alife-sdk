/**
 * Integration test: "Trade failure scenarios".
 *
 * Tests all failure paths across TradeSession (executeBuy/executeSell),
 * PricingEngine (discounts), and OfflineTradeResolver (race conditions,
 * rollback guarantees).
 *
 * All objects are REAL -- zero mocks, zero vi.fn().
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { IRandom } from '@alife-sdk/core';
import { EconomyPlugin } from '../plugin/EconomyPlugin';
import { executeBuy, executeSell, TradeResult } from '../trade/TradeSession';
import { calculateBuyPrice, calculateSellPrice } from '../trade/PricingEngine';
import { createDefaultEconomyConfig } from '../types/IEconomyConfig';
import { resolveNPCTrade } from '../trade/OfflineTradeResolver';
import { TraderInventory } from '../trade/TraderInventory';
import type { IOfflineTradeConfig, ITradeableNPC, IItemCatalogue } from '../trade/OfflineTradeResolver';

// ---------------------------------------------------------------------------
// Stubs — plain objects, no vi.fn()
// ---------------------------------------------------------------------------

const SEEDED_RANDOM: IRandom = {
  next: () => 0.25,
  nextInt: (min: number, max: number) => Math.floor(0.25 * (max - min + 1)) + min,
  nextFloat: (min: number, max: number) => 0.25 * (max - min) + min,
};

function makeConfig() {
  return createDefaultEconomyConfig();
}

function makePlugin() {
  return new EconomyPlugin(SEEDED_RANDOM);
}

function makeOfflineConfig(overrides?: Partial<IOfflineTradeConfig>): IOfflineTradeConfig {
  return {
    tradeIntervalMs: 60_000,
    minAttitudeToTrade: -30,
    maxSpendRatio: 0.5,
    npcPriceMultiplier: 0.8,
    maxTradesPerTick: 10,
    ...overrides,
  };
}

function makeTraders(plugin: EconomyPlugin): TraderInventory {
  return plugin.traders;
}

function makeNPC(id: string, faction = 'stalker', rank = 3): ITradeableNPC {
  return { npcId: id, factionId: faction, terrainId: 'test_terrain', rank };
}

const simpleCatalogue: IItemCatalogue = {
  getBasePrice: (id: string) => {
    const prices: Record<string, number> = {
      medkit: 400,
      ammo_9x19: 10,
      rifle_ak74: 2000,
      bandage: 100,
    };
    return prices[id];
  },
};

const alwaysWantPreference = (_buyer: ITradeableNPC, item: { itemId: string }) =>
  item.itemId === 'medkit' ? 10 : item.itemId === 'ammo_9x19' ? 5 : 1;

// ---------------------------------------------------------------------------
// Tests: TradeSession.executeBuy() failures
// ---------------------------------------------------------------------------

describe('Trade failure scenarios (integration)', () => {
  let plugin: EconomyPlugin;

  beforeEach(() => {
    plugin = makePlugin();
    plugin.traders.register('trader_1', 'loner', 5_000);
    plugin.traders.addStock('trader_1', 'medkit', 5);
    plugin.traders.addStock('trader_1', 'ammo_9x19', 50);
  });

  // -------------------------------------------------------------------------
  // Test 1: executeBuy — insufficient money
  // -------------------------------------------------------------------------
  it('executeBuy: player has insufficient money → INSUFFICIENT_MONEY, inventory unchanged', () => {
    const config = makeConfig();
    const beforeQty = plugin.playerInventory.getQuantity('medkit');

    const { receipt, newPlayerMoney } = executeBuy({
      playerInventory: plugin.playerInventory,
      playerMoney: 1, // far too little (price is 400×1.3 = 520)
      traders: plugin.traders,
      traderId: 'trader_1',
      itemId: 'medkit',
      basePrice: 400,
      factionRelation: 0,
      config: config.trade,
    });

    expect(receipt.result).toBe(TradeResult.INSUFFICIENT_MONEY);
    expect(newPlayerMoney).toBe(1); // unchanged
    expect(plugin.playerInventory.getQuantity('medkit')).toBe(beforeQty); // inventory untouched
    // Trader stock unchanged
    expect(plugin.traders.hasStock('trader_1', 'medkit')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 2: executeBuy — item not in stock
  // -------------------------------------------------------------------------
  it('executeBuy: item not in stock → INSUFFICIENT_STOCK, player money unchanged', () => {
    const config = makeConfig();

    const { receipt, newPlayerMoney } = executeBuy({
      playerInventory: plugin.playerInventory,
      playerMoney: 10_000,
      traders: plugin.traders,
      traderId: 'trader_1',
      itemId: 'rifle_ak74', // not stocked
      basePrice: 2_000,
      factionRelation: 0,
      config: config.trade,
    });

    expect(receipt.result).toBe(TradeResult.INSUFFICIENT_STOCK);
    expect(newPlayerMoney).toBe(10_000); // unchanged
    expect(plugin.playerInventory.has('rifle_ak74')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 3: executeSell — item not in player inventory
  // -------------------------------------------------------------------------
  it('executeSell: player does not have item → INSUFFICIENT_ITEMS, trader money unchanged', () => {
    const config = makeConfig();
    const traderBefore = plugin.traders.getTrader('trader_1')!.money;

    const { receipt, newPlayerMoney } = executeSell({
      playerInventory: plugin.playerInventory,
      playerMoney: 500,
      traders: plugin.traders,
      traderId: 'trader_1',
      itemId: 'rifle_ak74', // not in player inventory
      basePrice: 2_000,
      factionRelation: 0,
      config: config.trade,
    });

    expect(receipt.result).toBe(TradeResult.INSUFFICIENT_ITEMS);
    expect(newPlayerMoney).toBe(500); // player money unchanged
    expect(plugin.traders.getTrader('trader_1')!.money).toBe(traderBefore); // trader money unchanged
  });

  // -------------------------------------------------------------------------
  // Test 4: executeSell — trader has no money (broke)
  // -------------------------------------------------------------------------
  it('executeSell: trader has no money → TRADER_INSUFFICIENT_FUNDS, player inventory unchanged', () => {
    const config = makeConfig();

    // Register a broke trader with 0 money
    plugin.traders.register('broke_trader', 'loner', 0);
    plugin.playerInventory.add('artefact_flame', 1);

    const before = plugin.playerInventory.getQuantity('artefact_flame');

    const { receipt, newPlayerMoney } = executeSell({
      playerInventory: plugin.playerInventory,
      playerMoney: 200,
      traders: plugin.traders,
      traderId: 'broke_trader',
      itemId: 'artefact_flame',
      basePrice: 1_000,
      factionRelation: 0,
      config: config.trade,
    });

    expect(receipt.result).toBe(TradeResult.TRADER_INSUFFICIENT_FUNDS);
    expect(newPlayerMoney).toBe(200); // player money unchanged
    expect(plugin.playerInventory.getQuantity('artefact_flame')).toBe(before); // item still in inventory
  });

  // -------------------------------------------------------------------------
  // Test 5: executeBuy — trader not found
  // -------------------------------------------------------------------------
  it('executeBuy: trader does not exist → TRADER_NOT_FOUND', () => {
    const config = makeConfig();

    const { receipt } = executeBuy({
      playerInventory: plugin.playerInventory,
      playerMoney: 10_000,
      traders: plugin.traders,
      traderId: 'nonexistent_trader',
      itemId: 'medkit',
      basePrice: 400,
      factionRelation: 0,
      config: config.trade,
    });

    expect(receipt.result).toBe(TradeResult.TRADER_NOT_FOUND);
    expect(plugin.playerInventory.has('medkit')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 6: executeBuy — hostile faction (relation below threshold)
  // -------------------------------------------------------------------------
  it('executeBuy: faction relation below minRelationToTrade → RELATION_TOO_LOW', () => {
    const config = makeConfig(); // minRelationToTrade = -30

    const { receipt, newPlayerMoney } = executeBuy({
      playerInventory: plugin.playerInventory,
      playerMoney: 10_000,
      traders: plugin.traders,
      traderId: 'trader_1',
      itemId: 'medkit',
      basePrice: 400,
      factionRelation: -50, // below -30 threshold
      config: config.trade,
    });

    expect(receipt.result).toBe(TradeResult.RELATION_TOO_LOW);
    expect(newPlayerMoney).toBe(10_000);
    expect(plugin.playerInventory.has('medkit')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 7: PricingEngine — ally discount applies correctly
  // -------------------------------------------------------------------------
  it('PricingEngine: ally faction (relation > allyThreshold=50) gets allyDiscount=0.8×', () => {
    const config = makeConfig().trade;
    // ally: buyPriceMultiplier(1.3) × allyDiscount(0.8) = 1.04 → round(400 × 1.04) = 416
    const allyPrice = calculateBuyPrice(400, 60, config);
    // non-ally: buyPriceMultiplier(1.3) → round(400 × 1.3) = 520
    const normalPrice = calculateBuyPrice(400, 0, config);

    expect(allyPrice).toBe(416); // 400 × 1.3 × 0.8 = 416
    expect(normalPrice).toBe(520); // 400 × 1.3 = 520
    expect(allyPrice).toBeLessThan(normalPrice);
  });

  // -------------------------------------------------------------------------
  // Test 8: PricingEngine — sell price is flat (no faction effect)
  // -------------------------------------------------------------------------
  it('PricingEngine: sell price is flat regardless of faction relation', () => {
    const config = makeConfig().trade;
    const sellPriceAlly = calculateSellPrice(1000, 100, config);
    const sellPriceNeutral = calculateSellPrice(1000, 0, config);
    const sellPriceHostile = calculateSellPrice(1000, -100, config);

    // All sell prices should be identical: round(1000 × 0.5) = 500
    expect(sellPriceAlly).toBe(500);
    expect(sellPriceNeutral).toBe(500);
    expect(sellPriceHostile).toBe(500);
  });

  // -------------------------------------------------------------------------
  // Test 9: PricingEngine — ally threshold boundary (exactly at threshold is NOT ally)
  // -------------------------------------------------------------------------
  it('PricingEngine: ally discount applies only strictly above allyThreshold', () => {
    const config = makeConfig().trade; // allyThreshold = 50
    // At exactly the threshold — no discount
    const atThreshold = calculateBuyPrice(400, 50, config);
    // One above threshold — discount applies
    const aboveThreshold = calculateBuyPrice(400, 51, config);

    // At threshold: no discount (condition is > not >=)
    expect(atThreshold).toBe(520); // 400 × 1.3 = 520
    expect(aboveThreshold).toBe(416); // 400 × 1.3 × 0.8 = 416
  });

  // -------------------------------------------------------------------------
  // Test 10: OfflineTradeResolver — attitude too low → trade refused
  // -------------------------------------------------------------------------
  it('resolveNPCTrade: attitude below minAttitudeToTrade → fail: attitude_too_low', () => {
    const config = makeOfflineConfig(); // minAttitudeToTrade = -30

    plugin.traders.register('npc_buyer', 'stalker', 1_000);
    plugin.traders.register('npc_seller', 'bandit', 500);
    plugin.traders.addStock('npc_seller', 'medkit', 5);

    const buyer = makeNPC('npc_buyer', 'stalker');
    const seller = makeNPC('npc_seller', 'bandit');

    const result = resolveNPCTrade(
      buyer,
      seller,
      plugin.traders,
      simpleCatalogue,
      alwaysWantPreference,
      config,
      -50, // below threshold -30
    );

    expect(result.success).toBe(false);
    expect(result.failReason).toBe('attitude_too_low');
    // Stock should be unchanged
    expect(plugin.traders.hasStock('npc_seller', 'medkit')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 11: OfflineTradeResolver — race condition (both want same item, only one gets it)
  // -------------------------------------------------------------------------
  it('resolveNPCTrade: race condition — only one buyer gets the last unit of stock', () => {
    const config = makeOfflineConfig();

    // Seller with exactly 1 medkit
    plugin.traders.register('seller_race', 'loner', 2_000);
    plugin.traders.addStock('seller_race', 'medkit', 1); // exactly 1 unit

    plugin.traders.register('buyer_a', 'stalker', 2_000);
    plugin.traders.register('buyer_b', 'stalker', 2_000);

    const seller = makeNPC('seller_race', 'loner');
    const buyerA = makeNPC('buyer_a', 'stalker');
    const buyerB = makeNPC('buyer_b', 'stalker');

    // First buyer attempts to buy
    const result1 = resolveNPCTrade(
      buyerA,
      seller,
      plugin.traders,
      simpleCatalogue,
      alwaysWantPreference,
      config,
      50, // good attitude
    );

    // Second buyer attempts to buy the same item
    const result2 = resolveNPCTrade(
      buyerB,
      seller,
      plugin.traders,
      simpleCatalogue,
      alwaysWantPreference,
      config,
      50, // same good attitude
    );

    // Exactly one should succeed (first one takes the last unit)
    const successes = [result1.success, result2.success].filter(Boolean).length;
    const failures = [result1.success, result2.success].filter((s) => !s).length;

    expect(successes).toBe(1);
    expect(failures).toBe(1);

    // The failing trade can be either 'stock_depleted' (deductStock fails for concurrent access)
    // or 'nothing_wanted' (item already gone from stock so preference scores 0) —
    // both are valid "second buyer fails" outcomes for sequential execution.
    const failedResult = result1.success ? result2 : result1;
    expect(failedResult.success).toBe(false);
    expect(['stock_depleted', 'nothing_wanted']).toContain(failedResult.failReason);

    // Seller stock is now 0
    expect(plugin.traders.hasStock('seller_race', 'medkit')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 12: Transaction rollback — failed trade leaves no partial state
  // -------------------------------------------------------------------------
  it('executeBuy: failed buy leaves trader stock and player inventory completely unchanged', () => {
    const config = makeConfig();

    const initialTraderStock = plugin.traders.getTrader('trader_1')!.stock.get('medkit')?.quantity ?? 0;
    const initialPlayerQty = plugin.playerInventory.getQuantity('medkit');
    const initialPlayerMoney = 1; // not enough for price of 520

    executeBuy({
      playerInventory: plugin.playerInventory,
      playerMoney: initialPlayerMoney,
      traders: plugin.traders,
      traderId: 'trader_1',
      itemId: 'medkit',
      basePrice: 400,
      factionRelation: 0,
      config: config.trade,
    });

    // Trader stock unchanged
    expect(plugin.traders.getTrader('trader_1')!.stock.get('medkit')?.quantity).toBe(initialTraderStock);
    // Player inventory unchanged
    expect(plugin.playerInventory.getQuantity('medkit')).toBe(initialPlayerQty);
  });

  // -------------------------------------------------------------------------
  // Test 13: resolveNPCTrade — seller has nothing buyer wants → nothing_wanted
  // -------------------------------------------------------------------------
  it('resolveNPCTrade: seller stock has no items buyer wants → fail: nothing_wanted', () => {
    const config = makeOfflineConfig();

    plugin.traders.register('npc_want_nothing_buyer', 'stalker', 5_000);
    plugin.traders.register('npc_want_nothing_seller', 'loner', 500);
    plugin.traders.addStock('npc_want_nothing_seller', 'unknown_item', 5); // item not in catalogue

    const buyer = makeNPC('npc_want_nothing_buyer');
    const seller = makeNPC('npc_want_nothing_seller', 'loner');

    const result = resolveNPCTrade(
      buyer,
      seller,
      plugin.traders,
      simpleCatalogue, // catalogue doesn't have 'unknown_item'
      alwaysWantPreference,
      config,
      50,
    );

    expect(result.success).toBe(false);
    expect(result.failReason).toBe('nothing_wanted');
  });

  // -------------------------------------------------------------------------
  // Test 14: resolveNPCTrade — buyer cannot afford item (maxSpendRatio exceeded)
  // -------------------------------------------------------------------------
  it('resolveNPCTrade: price exceeds buyer maxSpendRatio of wallet → fail: cannot_afford', () => {
    // npcPriceMultiplier=0.8: price = round(400 × 0.8) = 320
    // buyer has 500 money, maxSpendRatio=0.5 → max spend = 250
    // 320 > 250 → cannot_afford
    const config = makeOfflineConfig({ npcPriceMultiplier: 0.8, maxSpendRatio: 0.5 });

    plugin.traders.register('rich_seller', 'loner', 2_000);
    plugin.traders.addStock('rich_seller', 'medkit', 10);

    plugin.traders.register('poor_buyer', 'stalker', 500); // 500 × 0.5 = 250 max

    const buyer = makeNPC('poor_buyer');
    const seller = makeNPC('rich_seller', 'loner');

    const result = resolveNPCTrade(
      buyer,
      seller,
      plugin.traders,
      simpleCatalogue, // medkit basePrice=400, npcPrice=round(400×0.8)=320
      alwaysWantPreference,
      config,
      50,
    );

    expect(result.success).toBe(false);
    expect(result.failReason).toBe('cannot_afford');
    // Stock unchanged
    expect(plugin.traders.hasStock('rich_seller', 'medkit')).toBe(true);
    // Buyer money unchanged
    expect(plugin.traders.getTrader('poor_buyer')!.money).toBe(500);
  });
});
