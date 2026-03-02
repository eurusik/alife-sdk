import { describe, it, expect } from 'vitest';
import { executeBuy, executeSell, TradeResult } from './TradeSession';
import { Inventory } from '../inventory/Inventory';
import { TraderInventory } from './TraderInventory';
import { createDefaultEconomyConfig } from '../types/IEconomyConfig';

const economyConfig = createDefaultEconomyConfig();
const tradeConfig = economyConfig.trade;

function makeRandom() {
  return {
    next: () => 0.5,
    nextInt: (min: number, max: number) => min + Math.floor(0.5 * (max - min + 1)),
    nextFloat: (min: number, max: number) => min + 0.5 * (max - min),
  };
}

function setup() {
  const playerInv = new Inventory(economyConfig.inventory);
  const traders = new TraderInventory(tradeConfig, makeRandom());
  traders.register('t1', 'loner', 5000);
  traders.addStock('t1', 'medkit', 10);
  return { playerInv, traders };
}

describe('executeBuy', () => {
  it('succeeds when all conditions met', () => {
    const { playerInv, traders } = setup();
    const { receipt, newPlayerMoney } = executeBuy({
      playerInventory: playerInv, playerMoney: 10000, traders, traderId: 't1',
      itemId: 'medkit', basePrice: 400, factionRelation: 0, config: tradeConfig,
    });
    expect(receipt.result).toBe(TradeResult.SUCCESS);
    expect(receipt.totalPrice).toBeGreaterThan(0);
    expect(newPlayerMoney).toBeLessThan(10000);
    expect(playerInv.has('medkit')).toBe(true);
  });

  it('fails for unknown trader', () => {
    const { playerInv } = setup();
    const traders = new TraderInventory(tradeConfig, makeRandom());
    const { receipt } = executeBuy({
      playerInventory: playerInv, playerMoney: 10000, traders, traderId: 'unknown',
      itemId: 'medkit', basePrice: 400, factionRelation: 0, config: tradeConfig,
    });
    expect(receipt.result).toBe(TradeResult.TRADER_NOT_FOUND);
  });

  it('fails when relation too low', () => {
    const { playerInv, traders } = setup();
    const { receipt } = executeBuy({
      playerInventory: playerInv, playerMoney: 10000, traders, traderId: 't1',
      itemId: 'medkit', basePrice: 400, factionRelation: -50, config: tradeConfig,
    });
    expect(receipt.result).toBe(TradeResult.RELATION_TOO_LOW);
  });

  it('fails when insufficient stock', () => {
    const { playerInv, traders } = setup();
    const { receipt } = executeBuy({
      playerInventory: playerInv, playerMoney: 10000, traders, traderId: 't1',
      itemId: 'bread', basePrice: 30, factionRelation: 0, config: tradeConfig,
    });
    expect(receipt.result).toBe(TradeResult.INSUFFICIENT_STOCK);
  });

  it('fails when insufficient money', () => {
    const { playerInv, traders } = setup();
    const { receipt } = executeBuy({
      playerInventory: playerInv, playerMoney: 1, traders, traderId: 't1',
      itemId: 'medkit', basePrice: 400, factionRelation: 0, config: tradeConfig,
    });
    expect(receipt.result).toBe(TradeResult.INSUFFICIENT_MONEY);
  });

  it('fails when inventory full', () => {
    const playerInv = new Inventory({ maxSlots: 0, defaultMaxStack: 99 });
    const { traders } = setup();
    const { receipt } = executeBuy({
      playerInventory: playerInv, playerMoney: 10000, traders, traderId: 't1',
      itemId: 'medkit', basePrice: 400, factionRelation: 0, config: tradeConfig,
    });
    expect(receipt.result).toBe(TradeResult.INVENTORY_FULL);
  });

  it('applies ally discount', () => {
    const { playerInv, traders } = setup();
    const { receipt: normal } = executeBuy({
      playerInventory: playerInv, playerMoney: 10000, traders, traderId: 't1',
      itemId: 'medkit', basePrice: 400, factionRelation: 0, config: tradeConfig,
    });
    traders.addStock('t1', 'medkit', 1); // Restock for ally test.
    const { receipt: ally } = executeBuy({
      playerInventory: playerInv, playerMoney: 10000, traders, traderId: 't1',
      itemId: 'medkit', basePrice: 400, factionRelation: 60, config: tradeConfig,
    });
    expect(ally.totalPrice).toBeLessThan(normal.totalPrice);
  });
});

describe('executeSell', () => {
  it('succeeds when all conditions met', () => {
    const { playerInv, traders } = setup();
    playerInv.add('medkit', 3);
    const { receipt, newPlayerMoney } = executeSell({
      playerInventory: playerInv, playerMoney: 1000, traders, traderId: 't1',
      itemId: 'medkit', basePrice: 400, factionRelation: 0, config: tradeConfig,
    });
    expect(receipt.result).toBe(TradeResult.SUCCESS);
    expect(newPlayerMoney).toBeGreaterThan(1000);
    expect(playerInv.getQuantity('medkit')).toBe(2);
  });

  it('fails when player has no item', () => {
    const { playerInv, traders } = setup();
    const { receipt } = executeSell({
      playerInventory: playerInv, playerMoney: 1000, traders, traderId: 't1',
      itemId: 'bread', basePrice: 30, factionRelation: 0, config: tradeConfig,
    });
    expect(receipt.result).toBe(TradeResult.INSUFFICIENT_ITEMS);
  });

  it('fails when trader has no money', () => {
    const { playerInv, traders } = setup();
    playerInv.add('medkit', 1);
    traders.adjustMoney('t1', -traders.getTrader('t1')!.money); // Set to 0
    const { receipt } = executeSell({
      playerInventory: playerInv, playerMoney: 1000, traders, traderId: 't1',
      itemId: 'medkit', basePrice: 400, factionRelation: 0, config: tradeConfig,
    });
    expect(receipt.result).toBe(TradeResult.TRADER_INSUFFICIENT_FUNDS);
  });

  it('fails for unknown trader', () => {
    const { playerInv } = setup();
    playerInv.add('medkit', 1);
    const traders = new TraderInventory(tradeConfig, makeRandom());
    const { receipt } = executeSell({
      playerInventory: playerInv, playerMoney: 1000, traders, traderId: 'unknown',
      itemId: 'medkit', basePrice: 400, factionRelation: 0, config: tradeConfig,
    });
    expect(receipt.result).toBe(TradeResult.TRADER_NOT_FOUND);
  });

  it('transfers item to trader stock', () => {
    const { playerInv, traders } = setup();
    playerInv.add('bread', 1);
    executeSell({
      playerInventory: playerInv, playerMoney: 1000, traders, traderId: 't1',
      itemId: 'bread', basePrice: 30, factionRelation: 0, config: tradeConfig,
    });
    expect(traders.hasStock('t1', 'bread')).toBe(true);
  });
});
