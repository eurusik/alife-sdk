// trade/OfflineTradeScheduler.test.ts

import { describe, it, expect, vi } from 'vitest';
import { TraderInventory } from './TraderInventory';
import { OfflineTradeScheduler } from './OfflineTradeScheduler';
import { createDefaultOfflineTradeConfig } from './OfflineTradeTypes';
import { createDefaultEconomyConfig } from '../types/IEconomyConfig';
import type {
  ICoLocationSource,
  ICoLocationMap,
  IItemCatalogue,
  ITradePreference,
  ITradeableNPC,
  IOfflineTradeResult,
} from './OfflineTradeTypes';
import type { IOfflineTradeSchedulerDeps } from './OfflineTradeScheduler';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRandom() {
  return {
    next:      () => 0.0,
    nextInt:   (min: number) => min,
    nextFloat: (min: number) => min,
  };
}

const tradeConfig = createDefaultEconomyConfig().trade;

function makeTraders(): TraderInventory {
  return new TraderInventory(tradeConfig, makeRandom());
}

function makeNPC(npcId: string, terrainId = 'terrain_a', factionId = 'loner', rank = 1): ITradeableNPC {
  return { npcId, factionId, terrainId, rank };
}

function makeCoLocation(map: Record<string, ITradeableNPC[]>): ICoLocationSource {
  return {
    getCoLocatedTraders: vi.fn().mockReturnValue(new Map(Object.entries(map))),
    getFactionRelation:  vi.fn().mockReturnValue(50),
    getPersonalGoodwill: vi.fn().mockReturnValue(0),
  };
}

const catalogue: IItemCatalogue = {
  getBasePrice: (id) => ({ medkit: 400 }[id]),
};

const preference: ITradePreference = (_buyer, item) =>
  item.itemId === 'medkit' ? 10 : 0;

const INTERVAL = 1_000;  // short interval for tests

function makeDeps(coLocation: ICoLocationSource, traders = makeTraders()): IOfflineTradeSchedulerDeps {
  return { traders, coLocation, catalogue, preference, random: makeRandom() };
}

function makeDepsNoRandom(coLocation: ICoLocationSource, traders = makeTraders()): IOfflineTradeSchedulerDeps {
  return { traders, coLocation, catalogue, preference };
}

// ---------------------------------------------------------------------------
// update — accumulator / tick gating
// ---------------------------------------------------------------------------

describe('OfflineTradeScheduler.update', () => {
  it('does not tick before tradeIntervalMs elapses', () => {
    const coLocation = makeCoLocation({
      terrain_a: [makeNPC('buyer'), makeNPC('seller')],
    });
    const sched = new OfflineTradeScheduler(makeDeps(coLocation), { tradeIntervalMs: INTERVAL });

    sched.update(INTERVAL - 1, 0);

    expect(coLocation.getCoLocatedTraders).not.toHaveBeenCalled();
  });

  it('ticks once when exactly tradeIntervalMs has elapsed', () => {
    const coLocation = makeCoLocation({});
    const sched = new OfflineTradeScheduler(makeDeps(coLocation), { tradeIntervalMs: INTERVAL });

    sched.update(INTERVAL, 0);

    expect(coLocation.getCoLocatedTraders).toHaveBeenCalledOnce();
  });

  it('accumulates fractional deltas across multiple calls', () => {
    const coLocation = makeCoLocation({});
    const sched = new OfflineTradeScheduler(makeDeps(coLocation), { tradeIntervalMs: INTERVAL });

    sched.update(400, 0);
    sched.update(400, 400);
    sched.update(400, 800);  // total = 1200 → 1 tick, remainder 200

    expect(coLocation.getCoLocatedTraders).toHaveBeenCalledTimes(1);
  });

  it('fires multiple ticks if many intervals elapse at once', () => {
    const coLocation = makeCoLocation({});
    const sched = new OfflineTradeScheduler(makeDeps(coLocation), { tradeIntervalMs: INTERVAL });

    // Fires 3 ticks via 3 update calls
    sched.update(INTERVAL, 0);
    sched.update(INTERVAL, INTERVAL);
    sched.update(INTERVAL, INTERVAL * 2);

    expect(coLocation.getCoLocatedTraders).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// tick — trade resolution
// ---------------------------------------------------------------------------

describe('OfflineTradeScheduler.tick', () => {
  it('does nothing when co-location map is empty', () => {
    const traders = makeTraders();
    const coLocation = makeCoLocation({});
    const sched = new OfflineTradeScheduler(makeDeps(coLocation, traders));

    sched.tick(0);

    expect(sched.getLastResults()).toHaveLength(0);
  });

  it('skips terrains with fewer than 2 NPCs', () => {
    const traders = makeTraders();
    traders.register('solo', 'loner', 1000);
    const coLocation = makeCoLocation({ terrain_a: [makeNPC('solo')] });
    const sched = new OfflineTradeScheduler(makeDeps(coLocation, traders));

    sched.tick(0);

    expect(sched.getLastResults()).toHaveLength(0);
  });

  it('resolves a trade between two co-located traders', () => {
    const traders = makeTraders();
    traders.register('buyer', 'loner', 5000);
    traders.register('seller', 'loner', 0);
    traders.addStock('seller', 'medkit', 3);

    const coLocation = makeCoLocation({
      terrain_a: [makeNPC('buyer'), makeNPC('seller')],
    });
    const sched = new OfflineTradeScheduler(makeDeps(coLocation, traders), { tradeIntervalMs: INTERVAL });

    sched.tick(0);

    const results = sched.getLastResults();
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].itemId).toBe('medkit');
  });

  it('applies cooldowns to both participants after a successful trade', () => {
    const traders = makeTraders();
    traders.register('buyer', 'loner', 5000);
    traders.register('seller', 'loner', 0);
    traders.addStock('seller', 'medkit', 3);

    const coLocation = makeCoLocation({
      terrain_a: [makeNPC('buyer'), makeNPC('seller')],
    });
    const sched = new OfflineTradeScheduler(makeDeps(coLocation, traders), {
      tradeIntervalMs: INTERVAL,
      maxTradesPerTick: 5,
    });

    sched.tick(0);
    expect(sched.getLastResults()[0].success).toBe(true);

    // Second tick at t=0 — both NPCs are on cooldown until t=INTERVAL.
    sched.tick(0);
    // No new successful trades (both cooldowns active).
    const secondResults = sched.getLastResults();
    const anySuccess = secondResults.some(r => r.success);
    expect(anySuccess).toBe(false);
  });

  it('respects maxTradesPerTick budget across terrains', () => {
    const traders = makeTraders();
    // Set up 5 terrains each with 2 traders.
    for (let t = 0; t < 5; t++) {
      const buyerId  = `buyer_${t}`;
      const sellerId = `seller_${t}`;
      traders.register(buyerId,  'loner', 5000);
      traders.register(sellerId, 'loner', 0);
      traders.addStock(sellerId, 'medkit', 10);
    }

    const groups: Record<string, ITradeableNPC[]> = {};
    for (let t = 0; t < 5; t++) {
      groups[`terrain_${t}`] = [
        makeNPC(`buyer_${t}`,  `terrain_${t}`),
        makeNPC(`seller_${t}`, `terrain_${t}`),
      ];
    }
    const coLocation = makeCoLocation(groups);

    const sched = new OfflineTradeScheduler(makeDeps(coLocation, traders), {
      tradeIntervalMs: INTERVAL,
      maxTradesPerTick: 3,  // only 3 trades allowed per tick
    });

    sched.tick(0);

    const successful = sched.getLastResults().filter(r => r.success);
    expect(successful.length).toBeLessThanOrEqual(3);
  });

  it('records failed trade results in getLastResults', () => {
    const traders = makeTraders();
    traders.register('buyer', 'loner', 5000);
    traders.register('seller', 'loner', 0);
    // No stock → nothing_wanted

    const coLocation = makeCoLocation({
      terrain_a: [makeNPC('buyer'), makeNPC('seller')],
    });
    const sched = new OfflineTradeScheduler(makeDeps(coLocation, traders));

    sched.tick(0);

    const results = sched.getLastResults();
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(r => !r.success)).toBe(true);
  });

  it('consults getFactionRelation and getPersonalGoodwill for attitude', () => {
    const traders = makeTraders();
    traders.register('buyer', 'loner', 5000);
    traders.register('seller', 'bandit', 0);
    traders.addStock('seller', 'medkit', 1);

    const coLocation: ICoLocationSource = {
      getCoLocatedTraders: vi.fn().mockReturnValue(
        new Map([['terrain_a', [makeNPC('buyer', 'terrain_a', 'loner'), makeNPC('seller', 'terrain_a', 'bandit')]]]),
      ),
      getFactionRelation:  vi.fn().mockReturnValue(-80),  // hostile factions
      getPersonalGoodwill: vi.fn().mockReturnValue(0),
    };

    const sched = new OfflineTradeScheduler(makeDeps(coLocation, traders), {
      tradeIntervalMs: INTERVAL,
      minAttitudeToTrade: -30,
    });

    sched.tick(0);

    // attitude = -80 + 0 = -80 < -30 → trade blocked
    expect(sched.getLastResults()[0]?.failReason).toBe('attitude_too_low');
  });
});

// ---------------------------------------------------------------------------
// resetCooldowns
// ---------------------------------------------------------------------------

describe('OfflineTradeScheduler.resetCooldowns', () => {
  it('clears all cooldowns so NPCs can trade again immediately', () => {
    const traders = makeTraders();
    traders.register('buyer', 'loner', 5000);
    traders.register('seller', 'loner', 0);
    traders.addStock('seller', 'medkit', 10);

    const coLocation = makeCoLocation({
      terrain_a: [makeNPC('buyer'), makeNPC('seller')],
    });
    const sched = new OfflineTradeScheduler(makeDeps(coLocation, traders), {
      tradeIntervalMs: INTERVAL,
    });

    sched.tick(0);  // sets cooldowns
    expect(sched.getLastResults()[0].success).toBe(true);

    sched.resetCooldowns();

    sched.tick(0);  // should trade again immediately
    expect(sched.getLastResults()[0].success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// serialize / restore
// ---------------------------------------------------------------------------

describe('OfflineTradeScheduler.serialize / restore', () => {
  it('round-trips cooldowns, cursor, and accumulator', () => {
    const traders = makeTraders();
    traders.register('buyer', 'loner', 5000);
    traders.register('seller', 'loner', 0);
    traders.addStock('seller', 'medkit', 10);

    const coLocation = makeCoLocation({
      terrain_a: [makeNPC('buyer'), makeNPC('seller')],
    });
    const sched = new OfflineTradeScheduler(makeDeps(coLocation, traders), {
      tradeIntervalMs: INTERVAL,
    });

    // Advance accumulator partway and trigger a tick to populate cooldowns.
    sched.update(500, 0);
    sched.tick(500);

    const saved = sched.serialize();

    // Restore into a fresh scheduler.
    const traders2 = makeTraders();
    traders2.register('buyer', 'loner', 5000);
    traders2.register('seller', 'loner', 0);
    traders2.addStock('seller', 'medkit', 10);

    const coLocation2 = makeCoLocation({
      terrain_a: [makeNPC('buyer'), makeNPC('seller')],
    });
    const sched2 = new OfflineTradeScheduler(makeDeps(coLocation2, traders2), {
      tradeIntervalMs: INTERVAL,
    });
    sched2.restore(saved);

    // Cooldowns should be restored: NPCs still on cooldown at t=500.
    sched2.tick(500);
    const anySuccess = sched2.getLastResults().some(r => r.success);
    expect(anySuccess).toBe(false);
  });

  it('restore is safe with empty/partial state', () => {
    const sched = new OfflineTradeScheduler(makeDeps(makeCoLocation({})));
    expect(() => sched.restore({})).not.toThrow();
    expect(() => sched.restore({ cooldowns: null, terrainCursor: 'bad' })).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// random optional — DefaultRandom fallback
// ---------------------------------------------------------------------------

describe('OfflineTradeScheduler — optional random', () => {
  it('works without explicit random (DefaultRandom fallback)', () => {
    const traders = makeTraders();
    traders.register('buyer', 'loner', 5000);
    traders.register('seller', 'loner', 0);
    traders.addStock('seller', 'medkit', 10);

    const coLocation = makeCoLocation({
      terrain_a: [makeNPC('buyer'), makeNPC('seller')],
    });
    const sched = new OfflineTradeScheduler(makeDepsNoRandom(coLocation, traders));

    expect(() => sched.tick(0)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// onTradeResult callback
// ---------------------------------------------------------------------------

describe('OfflineTradeScheduler — onTradeResult', () => {
  it('fires callback for every trade result in a tick', () => {
    const traders = makeTraders();
    traders.register('buyer', 'loner', 5000);
    traders.register('seller', 'loner', 0);
    traders.addStock('seller', 'medkit', 3);

    const coLocation = makeCoLocation({
      terrain_a: [makeNPC('buyer'), makeNPC('seller')],
    });

    const fired: IOfflineTradeResult[] = [];
    const sched = new OfflineTradeScheduler({
      ...makeDeps(coLocation, traders),
      onTradeResult: (r) => fired.push(r),
    });

    sched.tick(0);

    expect(fired.length).toBeGreaterThan(0);
    expect(fired).toEqual(sched.getLastResults());
  });

  it('callback receives failed trades too', () => {
    const traders = makeTraders();
    traders.register('buyer', 'loner', 5000);
    traders.register('seller', 'loner', 0);
    // No stock → nothing_wanted

    const coLocation = makeCoLocation({
      terrain_a: [makeNPC('buyer'), makeNPC('seller')],
    });

    const fired: boolean[] = [];
    const sched = new OfflineTradeScheduler({
      ...makeDeps(coLocation, traders),
      onTradeResult: (r) => fired.push(r.success),
    });

    sched.tick(0);

    expect(fired.length).toBeGreaterThan(0);
    expect(fired.every(s => !s)).toBe(true);
  });
});
