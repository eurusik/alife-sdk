// trade/OfflineTradeResolver.test.ts

import { describe, it, expect } from 'vitest';
import { TraderInventory } from './TraderInventory';
import { resolveNPCTrade, selectTradePair } from './OfflineTradeResolver';
import { createDefaultOfflineTradeConfig } from './OfflineTradeTypes';
import { createDefaultEconomyConfig } from '../types/IEconomyConfig';
import type {
  ITradeableNPC,
  IItemCatalogue,
  ITradePreference,
} from './OfflineTradeTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRandom(value = 0.0) {
  return {
    next:      () => value,
    nextInt:   (min: number, _max: number) => min,
    nextFloat: (min: number, max: number) => min + value * (max - min),
  };
}

const tradeConfig = createDefaultEconomyConfig().trade;

function makeTraders() {
  return new TraderInventory(tradeConfig, makeRandom());
}

function makeNPC(npcId: string, factionId = 'loner', rank = 1): ITradeableNPC {
  return { npcId, factionId, terrainId: 'terrain_a', rank };
}

const defaultCatalogue: IItemCatalogue = {
  getBasePrice: (id) => ({ medkit: 400, bandage: 100, rifle: 2000 }[id]),
};

const defaultPreference: ITradePreference = (_buyer, item) => {
  if (item.itemId === 'medkit') return 10;
  if (item.itemId === 'bandage') return 5;
  if (item.itemId === 'rifle') return 20;
  return 0;
};

const cfg = createDefaultOfflineTradeConfig();

// ---------------------------------------------------------------------------
// resolveNPCTrade
// ---------------------------------------------------------------------------

describe('resolveNPCTrade', () => {
  it('succeeds and transfers item + money', () => {
    const traders = makeTraders();
    traders.register('buyer', 'loner', 5000);
    traders.register('seller', 'loner', 0);
    traders.addStock('seller', 'medkit', 3);

    const buyer  = makeNPC('buyer');
    const seller = makeNPC('seller');

    const result = resolveNPCTrade(buyer, seller, traders, defaultCatalogue, defaultPreference, cfg, 50);

    expect(result.success).toBe(true);
    expect(result.itemId).toBe('medkit');
    expect(result.price).toBe(Math.max(1, Math.round(400 * cfg.npcPriceMultiplier)));

    // Buyer received medkit, seller lost one.
    expect(traders.hasStock('buyer', 'medkit')).toBe(true);
    expect(traders.hasStock('seller', 'medkit', 3)).toBe(false);

    // Money transferred.
    const buyerSnap  = traders.getTrader('buyer')!;
    const sellerSnap = traders.getTrader('seller')!;
    expect(buyerSnap.money).toBe(5000 - result.price);
    expect(sellerSnap.money).toBe(result.price);
  });

  it('picks highest-scored item when multiple available', () => {
    const traders = makeTraders();
    traders.register('buyer', 'loner', 5000);
    traders.register('seller', 'loner', 0);
    traders.addStock('seller', 'bandage', 5);
    traders.addStock('seller', 'rifle', 1);   // highest preference score = 20
    traders.addStock('seller', 'medkit', 2);  // score = 10

    const result = resolveNPCTrade(
      makeNPC('buyer'), makeNPC('seller'),
      traders, defaultCatalogue, defaultPreference, cfg, 50,
    );

    expect(result.success).toBe(true);
    expect(result.itemId).toBe('rifle');
  });

  it('returns attitude_too_low when attitude < minAttitudeToTrade', () => {
    const traders = makeTraders();
    traders.register('buyer', 'loner', 5000);
    traders.register('seller', 'bandit', 0);
    traders.addStock('seller', 'medkit', 1);

    const result = resolveNPCTrade(
      makeNPC('buyer', 'loner'), makeNPC('seller', 'bandit'),
      traders, defaultCatalogue, defaultPreference,
      createDefaultOfflineTradeConfig({ minAttitudeToTrade: 0 }),
      -50,  // hostile
    );

    expect(result.success).toBe(false);
    expect(result.failReason).toBe('attitude_too_low');
  });

  it('returns trader_not_registered when buyer or seller missing', () => {
    const traders = makeTraders();
    traders.register('seller', 'loner', 0);
    traders.addStock('seller', 'medkit', 1);

    const result = resolveNPCTrade(
      makeNPC('ghost_buyer'), makeNPC('seller'),
      traders, defaultCatalogue, defaultPreference, cfg, 50,
    );

    expect(result.success).toBe(false);
    expect(result.failReason).toBe('trader_not_registered');
  });

  it('returns nothing_wanted when all item scores are 0', () => {
    const traders = makeTraders();
    traders.register('buyer', 'loner', 5000);
    traders.register('seller', 'loner', 0);
    traders.addStock('seller', 'rock', 5);  // unknown item → price undefined → skipped

    const result = resolveNPCTrade(
      makeNPC('buyer'), makeNPC('seller'),
      traders, defaultCatalogue, (_buyer, _item) => 0, cfg, 50,
    );

    expect(result.success).toBe(false);
    expect(result.failReason).toBe('nothing_wanted');
  });

  it('returns nothing_wanted when catalogue has no price for items', () => {
    const traders = makeTraders();
    traders.register('buyer', 'loner', 5000);
    traders.register('seller', 'loner', 0);
    traders.addStock('seller', 'unknown_item', 1);

    const emptyCatalogue: IItemCatalogue = { getBasePrice: () => undefined };

    const result = resolveNPCTrade(
      makeNPC('buyer'), makeNPC('seller'),
      traders, emptyCatalogue, defaultPreference, cfg, 50,
    );

    expect(result.success).toBe(false);
    expect(result.failReason).toBe('nothing_wanted');
  });

  it('returns insufficient_money when buyer has less money than price', () => {
    const traders = makeTraders();
    traders.register('buyer', 'loner', 1);  // almost broke
    traders.register('seller', 'loner', 0);
    traders.addStock('seller', 'rifle', 1);  // price = round(2000*0.8) = 1600

    const result = resolveNPCTrade(
      makeNPC('buyer'), makeNPC('seller'),
      traders, defaultCatalogue, defaultPreference, cfg, 50,
    );

    expect(result.success).toBe(false);
    expect(result.failReason).toBe('insufficient_money');
  });

  it('returns cannot_afford when price > money * maxSpendRatio', () => {
    // maxSpendRatio=0.5; buyer has 400; medkit price = round(400*0.8)=320
    // 400 >= 320 (not insufficient_money), but 320 > 400*0.5=200 → cannot_afford
    const traders = makeTraders();
    traders.register('buyer', 'loner', 400);
    traders.register('seller', 'loner', 0);
    traders.addStock('seller', 'medkit', 1);

    const result = resolveNPCTrade(
      makeNPC('buyer'), makeNPC('seller'),
      traders, defaultCatalogue, defaultPreference,
      createDefaultOfflineTradeConfig({ maxSpendRatio: 0.5 }),
      50,
    );

    expect(result.success).toBe(false);
    expect(result.failReason).toBe('cannot_afford');
  });

  it('returns stock_depleted when deductStock fails after all checks pass', () => {
    // Simulate deductStock returning false via a custom TraderInventory wrapper.
    const traders = makeTraders();
    traders.register('buyer', 'loner', 5000);
    traders.register('seller', 'loner', 0);
    traders.addStock('seller', 'medkit', 1);

    // Monkey-patch deductStock to return false (simulates external depletion).
    const original = traders.deductStock.bind(traders);
    traders.deductStock = (_traderId: string, _itemId: string, _qty: number) => false;

    const result = resolveNPCTrade(
      makeNPC('buyer'), makeNPC('seller'),
      traders, defaultCatalogue, defaultPreference, cfg, 50,
    );

    traders.deductStock = original;  // restore

    expect(result.success).toBe(false);
    expect(result.failReason).toBe('stock_depleted');
    // Buyer should NOT have received the item (no partial mutation).
    expect(traders.hasStock('buyer', 'medkit')).toBe(false);
  });

  it('skips out-of-stock items (quantity 0)', () => {
    const traders = makeTraders();
    traders.register('buyer', 'loner', 5000);
    traders.register('seller', 'loner', 0);
    traders.addStock('seller', 'medkit', 0);  // explicitly 0

    const result = resolveNPCTrade(
      makeNPC('buyer'), makeNPC('seller'),
      traders, defaultCatalogue, defaultPreference, cfg, 50,
    );

    // medkit has qty 0 — skipped. No other items → nothing_wanted.
    expect(result.success).toBe(false);
    expect(result.failReason).toBe('nothing_wanted');
  });

  it('price is minimum 1 even if basePrice * multiplier rounds to 0', () => {
    const traders = makeTraders();
    traders.register('buyer', 'loner', 5000);
    traders.register('seller', 'loner', 0);
    traders.addStock('seller', 'cheap', 1);

    const zeroPriceCatalogue: IItemCatalogue = { getBasePrice: () => 0 };
    const wantAnything: ITradePreference = () => 1;

    const result = resolveNPCTrade(
      makeNPC('buyer'), makeNPC('seller'),
      traders, zeroPriceCatalogue, wantAnything,
      createDefaultOfflineTradeConfig({ maxSpendRatio: 1.0 }),
      50,
    );

    expect(result.success).toBe(true);
    expect(result.price).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// selectTradePair
// ---------------------------------------------------------------------------

describe('selectTradePair', () => {
  const now = 1_000;

  it('returns null when fewer than 2 NPCs', () => {
    const npcs = [makeNPC('a')];
    expect(selectTradePair(npcs, new Map(), now, makeRandom())).toBeNull();
  });

  it('returns null when empty array', () => {
    expect(selectTradePair([], new Map(), now, makeRandom())).toBeNull();
  });

  it('returns null when all NPCs are on cooldown', () => {
    const npcs = [makeNPC('a'), makeNPC('b')];
    const cooldowns = new Map([['a', now + 60_000], ['b', now + 60_000]]);
    expect(selectTradePair(npcs, cooldowns, now, makeRandom())).toBeNull();
  });

  it('returns null when only 1 NPC is off-cooldown', () => {
    const npcs = [makeNPC('a'), makeNPC('b')];
    const cooldowns = new Map([['b', now + 60_000]]);  // b on cooldown, only a eligible
    expect(selectTradePair(npcs, cooldowns, now, makeRandom())).toBeNull();
  });

  it('returns a [buyer, seller] pair from eligible NPCs', () => {
    const npcs = [makeNPC('a'), makeNPC('b'), makeNPC('c')];
    const result = selectTradePair(npcs, new Map(), now, makeRandom());

    expect(result).not.toBeNull();
    const [buyer, seller] = result!;
    expect(buyer.npcId).not.toBe(seller.npcId);
  });

  it('buyer and seller are always different NPCs', () => {
    const npcs = [makeNPC('a'), makeNPC('b')];
    const result = selectTradePair(npcs, new Map(), now, makeRandom(0.0));
    expect(result).not.toBeNull();
    expect(result![0].npcId).not.toBe(result![1].npcId);
  });

  it('excludes NPCs on cooldown from eligibility', () => {
    const npcs = [makeNPC('a'), makeNPC('b'), makeNPC('c')];
    // a is on cooldown — eligible = [b, c]
    const cooldowns = new Map([['a', now + 60_000]]);
    const result = selectTradePair(npcs, cooldowns, now, makeRandom());

    expect(result).not.toBeNull();
    const ids = [result![0].npcId, result![1].npcId];
    expect(ids).not.toContain('a');
  });

  it('treats 0 or missing cooldown as eligible', () => {
    const npcs = [makeNPC('a'), makeNPC('b')];
    // No cooldowns (defaults to 0 < now)
    const result = selectTradePair(npcs, new Map(), now, makeRandom());
    expect(result).not.toBeNull();
  });
});
