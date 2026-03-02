// trade/TradeSession.ts
// Validates and executes buy/sell transactions.
// Pure logic — no rendering, no event emission (host handles events).

import type { ITradeConfig } from '../types/IEconomyConfig';
import { Inventory } from '../inventory/Inventory';
import { TraderInventory } from './TraderInventory';
import { calculateBuyPrice, calculateSellPrice, canTrade } from './PricingEngine';

/**
 * Context for executing a trade operation.
 */
export interface ITradeContext {
  readonly playerInventory: Inventory;
  readonly playerMoney: number;
  readonly traders: TraderInventory;
  readonly traderId: string;
  readonly itemId: string;
  readonly basePrice: number;
  readonly factionRelation: number;
  readonly config: ITradeConfig;
}

/**
 * Outcome of a trade operation.
 */
export interface ITradeOutcome {
  readonly receipt: ITradeReceipt;
  readonly newPlayerMoney: number;
}

/**
 * Result of a trade attempt.
 */
export const TradeResult = {
  SUCCESS: 'success',
  TRADER_NOT_FOUND: 'trader_not_found',
  RELATION_TOO_LOW: 'relation_too_low',
  INSUFFICIENT_STOCK: 'insufficient_stock',
  INSUFFICIENT_MONEY: 'insufficient_money',
  TRADER_INSUFFICIENT_FUNDS: 'trader_insufficient_funds',
  INSUFFICIENT_ITEMS: 'insufficient_items',
  INVENTORY_FULL: 'inventory_full',
} as const;

export type TradeResult = (typeof TradeResult)[keyof typeof TradeResult];

/**
 * A completed trade operation's details.
 */
export interface ITradeReceipt {
  readonly result: TradeResult;
  readonly itemId: string;
  readonly quantity: number;
  readonly totalPrice: number;
}

/**
 * Execute a buy transaction (player buys from trader).
 *
 * @param ctx - Trade context with all required parameters.
 * @returns Trade outcome with receipt and updated player money.
 */
export function executeBuy(ctx: ITradeContext): ITradeOutcome {
  const { playerInventory, playerMoney, traders, traderId, itemId, basePrice, factionRelation, config } = ctx;
  const trader = traders.getTrader(traderId);
  if (!trader) {
    return {
      receipt: { result: TradeResult.TRADER_NOT_FOUND, itemId, quantity: 0, totalPrice: 0 },
      newPlayerMoney: playerMoney,
    };
  }

  if (!canTrade(factionRelation, config)) {
    return {
      receipt: { result: TradeResult.RELATION_TOO_LOW, itemId, quantity: 0, totalPrice: 0 },
      newPlayerMoney: playerMoney,
    };
  }

  if (!traders.hasStock(traderId, itemId)) {
    return {
      receipt: { result: TradeResult.INSUFFICIENT_STOCK, itemId, quantity: 0, totalPrice: 0 },
      newPlayerMoney: playerMoney,
    };
  }

  const price = calculateBuyPrice(basePrice, factionRelation, config);
  if (playerMoney < price) {
    return {
      receipt: { result: TradeResult.INSUFFICIENT_MONEY, itemId, quantity: 1, totalPrice: price },
      newPlayerMoney: playerMoney,
    };
  }

  const existingSlot = playerInventory.getSlot(itemId);
  const stackFull = existingSlot !== undefined && existingSlot.quantity >= existingSlot.maxStack;
  if (stackFull || (playerInventory.isFull && !existingSlot)) {
    return {
      receipt: { result: TradeResult.INVENTORY_FULL, itemId, quantity: 1, totalPrice: price },
      newPlayerMoney: playerMoney,
    };
  }

  // Execute transaction.
  traders.deductStock(traderId, itemId, 1);
  traders.adjustMoney(traderId, price);
  playerInventory.add(itemId, 1);

  return {
    receipt: { result: TradeResult.SUCCESS, itemId, quantity: 1, totalPrice: price },
    newPlayerMoney: playerMoney - price,
  };
}

/**
 * Execute a sell transaction (player sells to trader).
 *
 * @param ctx - Trade context with all required parameters.
 * @returns Trade outcome with receipt and updated player money.
 */
export function executeSell(ctx: ITradeContext): ITradeOutcome {
  const { playerInventory, playerMoney, traders, traderId, itemId, basePrice, factionRelation, config } = ctx;
  const trader = traders.getTrader(traderId);
  if (!trader) {
    return {
      receipt: { result: TradeResult.TRADER_NOT_FOUND, itemId, quantity: 0, totalPrice: 0 },
      newPlayerMoney: playerMoney,
    };
  }

  if (!canTrade(factionRelation, config)) {
    return {
      receipt: { result: TradeResult.RELATION_TOO_LOW, itemId, quantity: 0, totalPrice: 0 },
      newPlayerMoney: playerMoney,
    };
  }

  if (!playerInventory.has(itemId)) {
    return {
      receipt: { result: TradeResult.INSUFFICIENT_ITEMS, itemId, quantity: 0, totalPrice: 0 },
      newPlayerMoney: playerMoney,
    };
  }

  const price = calculateSellPrice(basePrice, config);
  if (trader.money < price) {
    return {
      receipt: { result: TradeResult.TRADER_INSUFFICIENT_FUNDS, itemId, quantity: 1, totalPrice: price },
      newPlayerMoney: playerMoney,
    };
  }

  // Execute transaction.
  playerInventory.remove(itemId, 1);
  traders.receiveItem(traderId, itemId, 1);
  traders.adjustMoney(traderId, -price);

  return {
    receipt: { result: TradeResult.SUCCESS, itemId, quantity: 1, totalPrice: price },
    newPlayerMoney: playerMoney + price,
  };
}
