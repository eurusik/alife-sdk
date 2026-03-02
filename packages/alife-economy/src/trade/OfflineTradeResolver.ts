// trade/OfflineTradeResolver.ts
// Pure functions for NPC-NPC offline trade resolution.
//
// No side effects except TraderInventory mutations on success.
// All randomness is injected via IRandom.

import type { IRandom } from '@alife-sdk/core';
import type { TraderInventory } from './TraderInventory';
import type {
  ICoLocationSource,
  IItemCatalogue,
  ITradeableNPC,
  IAvailableItem,
  IOfflineTradeResult,
  IOfflineTradeConfig,
  ITradePreference,
} from './OfflineTradeTypes';

// ---------------------------------------------------------------------------
// resolveNPCTrade
// ---------------------------------------------------------------------------

/**
 * Attempt a single NPC-NPC trade: buyer tries to purchase one item from seller.
 *
 * Algorithm:
 *   1. Combined attitude check (factionRelation + personalGoodwill).
 *   2. Both traders must be registered in `traders`.
 *   3. Score seller's stock via `preference`; pick highest-scoring item.
 *   4. Calculate price: `basePrice × npcPriceMultiplier` (minimum 1).
 *   5. Buyer affordability check: price ≤ `buyer.money × maxSpendRatio`.
 *   6. Execute: deductStock, receiveItem, adjustMoney for both parties.
 *
 * **Pure with side effects**: reads are pure; mutations go through
 * `TraderInventory` methods only (no direct object mutation).
 *
 * Time complexity: O(S) where S = number of distinct items in seller's stock.
 *
 * @param buyer      The purchasing NPC.
 * @param seller     The selling NPC.
 * @param traders    The shared trader inventory manager.
 * @param catalogue  Host-provided base price lookup.
 * @param preference Buyer scoring callback — determines which item to buy.
 * @param config     Scheduler config (price multiplier, attitude threshold, etc.).
 * @param attitude   Pre-computed combined attitude (factionRelation + goodwill),
 *                   clamped to [-100, 100] by the caller.
 */
export function resolveNPCTrade(
  buyer: ITradeableNPC,
  seller: ITradeableNPC,
  traders: TraderInventory,
  catalogue: IItemCatalogue,
  preference: ITradePreference,
  config: IOfflineTradeConfig,
  attitude: number,
): IOfflineTradeResult {
  const fail = (failReason: string, itemId = '', price = 0): IOfflineTradeResult => ({
    buyerId: buyer.npcId,
    sellerId: seller.npcId,
    itemId,
    price,
    success: false,
    failReason,
  });

  // 1. Attitude gate
  if (attitude < config.minAttitudeToTrade) {
    return fail('attitude_too_low');
  }

  // 2. Both traders must exist
  const sellerSnap = traders.getTrader(seller.npcId);
  const buyerSnap  = traders.getTrader(buyer.npcId);
  if (!sellerSnap || !buyerSnap) {
    return fail('trader_not_registered');
  }

  // 3. Score all seller items via the preference callback
  let bestItem: IAvailableItem | null = null;
  let bestScore = 0;

  for (const [itemId, entry] of sellerSnap.stock) {
    if (entry.quantity <= 0) continue;

    const basePrice = catalogue.getBasePrice(itemId);
    if (basePrice === undefined) continue;

    const available: IAvailableItem = { itemId, quantity: entry.quantity, basePrice };
    const score = preference(buyer, available);

    if (score > bestScore) {
      bestScore = score;
      bestItem = available;
    }
  }

  if (!bestItem) {
    return fail('nothing_wanted');
  }

  // 4. NPC-NPC price (wholesale, minimum 1 monetary unit)
  const price = Math.max(1, Math.round(bestItem.basePrice * config.npcPriceMultiplier));

  // 5. Affordability: don't let buyer spend more than maxSpendRatio of wallet
  if (buyerSnap.money < price) {
    return fail('insufficient_money', bestItem.itemId, price);
  }
  if (price > buyerSnap.money * config.maxSpendRatio) {
    return fail('cannot_afford', bestItem.itemId, price);
  }

  // 6. Execute transaction — guard against concurrent depletion (defensive)
  if (!traders.deductStock(seller.npcId, bestItem.itemId, 1)) {
    return fail('stock_depleted', bestItem.itemId, price);
  }
  traders.receiveItem(buyer.npcId, bestItem.itemId, 1);
  traders.adjustMoney(buyer.npcId, -price);
  traders.adjustMoney(seller.npcId, price);

  return {
    buyerId: buyer.npcId,
    sellerId: seller.npcId,
    itemId: bestItem.itemId,
    price,
    success: true,
  };
}

// ---------------------------------------------------------------------------
// selectTradePair
// ---------------------------------------------------------------------------

/**
 * Select a (buyer, seller) pair from a group of co-located NPCs.
 *
 * Picks a random buyer from off-cooldown NPCs, then a random seller
 * (also off-cooldown) different from the buyer.
 *
 * Returns `null` if fewer than 2 eligible NPCs are available.
 *
 * Time complexity: O(G) where G = group size. Typically 2-6 NPCs per terrain.
 *
 * @param npcs          NPCs sharing a terrain.
 * @param cooldowns     npcId → earliest next eligible trade time (ms).
 * @param currentTimeMs Current simulation game time.
 * @param random        Seeded PRNG.
 */
export function selectTradePair(
  npcs: readonly ITradeableNPC[],
  cooldowns: ReadonlyMap<string, number>,
  currentTimeMs: number,
  random: IRandom,
): [ITradeableNPC, ITradeableNPC] | null {
  // Build eligible (off-cooldown) list
  const eligible: ITradeableNPC[] = [];
  for (const npc of npcs) {
    const nextTime = cooldowns.get(npc.npcId) ?? 0;
    if (currentTimeMs >= nextTime) {
      eligible.push(npc);
    }
  }

  if (eligible.length < 2) return null;

  // Random buyer
  const buyerIdx = random.nextInt(0, eligible.length - 1);
  const buyer = eligible[buyerIdx];

  // Build seller candidates (anyone except buyer)
  const sellers: ITradeableNPC[] = [];
  for (let i = 0; i < eligible.length; i++) {
    if (i !== buyerIdx) sellers.push(eligible[i]);
  }

  const sellerIdx = random.nextInt(0, sellers.length - 1);
  return [buyer, sellers[sellerIdx]];
}

// Re-export so callers can import everything from this file if needed.
export type {
  ICoLocationSource,
  IItemCatalogue,
  ITradeableNPC,
  IAvailableItem,
  IOfflineTradeResult,
  IOfflineTradeConfig,
  ITradePreference,
};
