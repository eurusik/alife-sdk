// trade sub-path barrel
export { calculateBuyPrice, calculateSellPrice, canTrade } from './PricingEngine';
export type { IPriceContext, IPriceModifier } from './PricingEngine';
export { TraderInventory } from './TraderInventory';
export type { ITraderRecord, ITraderSnapshot, IBonusItem } from './TraderInventory';
export { executeBuy, executeSell, TradeResult } from './TradeSession';
export type { ITradeContext, ITradeOutcome, ITradeReceipt } from './TradeSession';
export { executeGift, GiftResult } from './GiftSession';
export type { IGiftContext, IGiftOutcome } from './GiftSession';

// Offline NPC-NPC trading (opt-in)
export type {
  ITradeableNPC,
  ICoLocationMap,
  ICoLocationSource,
  IItemCatalogue,
  IAvailableItem,
  ITradePreference,
  IOfflineTradeResult,
  IOfflineTradeConfig,
} from './OfflineTradeTypes';
export { createDefaultOfflineTradeConfig } from './OfflineTradeTypes';
export { resolveNPCTrade } from './OfflineTradeResolver';
export { OfflineTradeScheduler } from './OfflineTradeScheduler';
export type { IOfflineTradeSchedulerDeps } from './OfflineTradeScheduler';
