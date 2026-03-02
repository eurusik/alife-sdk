import { describe, it, expect } from 'vitest';
import { TraderInventory } from './TraderInventory';
import { createDefaultEconomyConfig } from '../types/IEconomyConfig';

const config = createDefaultEconomyConfig().trade;

function makeRandom(values: number[] = [0.5]) {
  let idx = 0;
  const next = () => values[idx++ % values.length];
  return {
    next,
    nextInt: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    nextFloat: (min: number, max: number) => min + next() * (max - min),
  };
}

describe('TraderInventory', () => {
  it('registers a trader', () => {
    const traders = new TraderInventory(config, makeRandom());
    traders.register('t1', 'loner', 5000);
    expect(traders.size).toBe(1);
    expect(traders.getTrader('t1')?.money).toBe(5000);
  });

  it('adds stock', () => {
    const traders = new TraderInventory(config, makeRandom());
    traders.register('t1', 'loner', 5000);
    traders.addStock('t1', 'medkit', 5);
    expect(traders.hasStock('t1', 'medkit', 5)).toBe(true);
  });

  it('deducts stock', () => {
    const traders = new TraderInventory(config, makeRandom());
    traders.register('t1', 'loner', 5000);
    traders.addStock('t1', 'medkit', 5);
    expect(traders.deductStock('t1', 'medkit', 3)).toBe(true);
    expect(traders.hasStock('t1', 'medkit', 3)).toBe(false);
    expect(traders.hasStock('t1', 'medkit', 2)).toBe(true);
  });

  it('deductStock returns false for insufficient stock', () => {
    const traders = new TraderInventory(config, makeRandom());
    traders.register('t1', 'loner', 5000);
    traders.addStock('t1', 'medkit', 2);
    expect(traders.deductStock('t1', 'medkit', 5)).toBe(false);
  });

  it('receiveItem adds to existing stock', () => {
    const traders = new TraderInventory(config, makeRandom());
    traders.register('t1', 'loner', 5000);
    traders.addStock('t1', 'medkit', 3);
    traders.receiveItem('t1', 'medkit', 2);
    expect(traders.hasStock('t1', 'medkit', 5)).toBe(true);
  });

  it('receiveItem creates new entry if absent', () => {
    const traders = new TraderInventory(config, makeRandom());
    traders.register('t1', 'loner', 5000);
    traders.receiveItem('t1', 'bread', 1);
    expect(traders.hasStock('t1', 'bread', 1)).toBe(true);
  });

  describe('restock', () => {
    it('restores baseline stock', () => {
      const traders = new TraderInventory(config, makeRandom([0.5]));
      traders.register('t1', 'loner', 5000);
      traders.addStock('t1', 'medkit', 5);
      traders.deductStock('t1', 'medkit', 3);

      traders.restock(config.restockIntervalMs + 1);
      expect(traders.hasStock('t1', 'medkit', 5)).toBe(true);
    });

    it('restores money', () => {
      const traders = new TraderInventory(config, makeRandom([0.5]));
      traders.register('t1', 'loner', 5000);
      traders.adjustMoney('t1', -4000); // Set to 1000

      traders.restock(config.restockIntervalMs + 1);
      expect(traders.getTrader('t1')!.money).toBe(5000);
    });

    it('skips active traders', () => {
      const traders = new TraderInventory(config, makeRandom([0.5]));
      traders.register('t1', 'loner', 5000);
      traders.addStock('t1', 'medkit', 5);
      traders.deductStock('t1', 'medkit', 5);
      traders.setActive('t1', true);

      traders.restock(config.restockIntervalMs + 1);
      expect(traders.hasStock('t1', 'medkit', 1)).toBe(false);
    });

    it('adds bonus item with 40% chance', () => {
      // Random value 0.3 < 0.4, so bonus should be added.
      const traders = new TraderInventory(config, makeRandom([0.3, 0.1]));
      traders.register('t1', 'loner', 5000);
      traders.setBonusPool([{ itemId: 'vodka', weight: 1 }]);

      traders.restock(config.restockIntervalMs + 1);
      expect(traders.hasStock('t1', 'vodka')).toBe(true);
    });

    it('skips bonus when roll is high', () => {
      // Random value 0.5 >= 0.4, no bonus.
      const traders = new TraderInventory(config, makeRandom([0.5]));
      traders.register('t1', 'loner', 5000);
      traders.setBonusPool([{ itemId: 'vodka', weight: 1 }]);

      traders.restock(config.restockIntervalMs + 1);
      expect(traders.hasStock('t1', 'vodka')).toBe(false);
    });

    it('respects restock interval', () => {
      const traders = new TraderInventory(config, makeRandom([0.5]));
      traders.register('t1', 'loner', 5000);
      traders.addStock('t1', 'medkit', 5);
      traders.deductStock('t1', 'medkit', 5);

      traders.restock(100); // Too early.
      expect(traders.hasStock('t1', 'medkit', 1)).toBe(false);
    });
  });

  it('clear removes all traders', () => {
    const traders = new TraderInventory(config, makeRandom());
    traders.register('t1', 'loner', 5000);
    traders.register('t2', 'bandit', 3000);
    traders.clear();
    expect(traders.size).toBe(0);
  });

  describe('adjustMoney', () => {
    it('adjustMoney with positive delta increases trader money', () => {
      const traders = new TraderInventory(config, makeRandom());
      traders.register('t1', 'loner', 5000);
      traders.adjustMoney('t1', 500);
      const snapshot = traders.getTrader('t1');
      expect(snapshot!.money).toBe(5500);
    });

    it('adjustMoney with negative delta reduces trader money', () => {
      const traders = new TraderInventory(config, makeRandom());
      traders.register('t1', 'loner', 5000);
      traders.adjustMoney('t1', -1000);
      const snapshot = traders.getTrader('t1');
      expect(snapshot!.money).toBe(4000);
    });

    it('adjustMoney returns true when trader exists', () => {
      const traders = new TraderInventory(config, makeRandom());
      traders.register('t1', 'loner', 5000);
      expect(traders.adjustMoney('t1', 100)).toBe(true);
    });

    it('adjustMoney returns false for unknown trader', () => {
      const traders = new TraderInventory(config, makeRandom());
      expect(traders.adjustMoney('ghost', 100)).toBe(false);
    });

    it('adjustMoney clamps money to 0 when delta exceeds current balance', () => {
      const traders = new TraderInventory(config, makeRandom());
      traders.register('t1', 'loner', 500);
      traders.adjustMoney('t1', -99_999);
      expect(traders.getTrader('t1')!.money).toBe(0);
    });

    it('adjustMoney never produces negative balance', () => {
      const traders = new TraderInventory(config, makeRandom());
      traders.register('t1', 'loner', 100);
      traders.adjustMoney('t1', -200);
      expect(traders.getTrader('t1')!.money).toBeGreaterThanOrEqual(0);
    });
  });

  describe('ITraderSnapshot fields', () => {
    it('getTrader returns ITraderSnapshot with correct fields', () => {
      const traders = new TraderInventory(config, makeRandom());
      traders.register('t1', 'loner', 5000);
      traders.addStock('t1', 'medkit', 3);
      const snapshot = traders.getTrader('t1');

      expect(snapshot).toBeDefined();
      expect(snapshot!.traderId).toBe('t1');
      expect(snapshot!.factionId).toBe('loner');
      expect(snapshot!.money).toBe(5000);
      expect(snapshot!.isActive).toBe(false);
      expect(snapshot!.stock).toBeInstanceOf(Map);
      expect(snapshot!.stock.get('medkit')?.quantity).toBe(3);
    });

    it('getTrader returns a defensive copy — mutating stock does not affect internal state', () => {
      const traders = new TraderInventory(config, makeRandom());
      traders.register('t1', 'loner', 5000);
      traders.addStock('t1', 'medkit', 3);

      const snapshot = traders.getTrader('t1')!;
      // Mutate the returned Map directly.
      (snapshot.stock as Map<string, { itemId: string; quantity: number }>).set('ammo', { itemId: 'ammo', quantity: 99 });

      // Internal state must be unaffected.
      expect(traders.hasStock('t1', 'ammo', 1)).toBe(false);
    });

    it('getTrader returns undefined for unknown trader', () => {
      const traders = new TraderInventory(config, makeRandom());
      expect(traders.getTrader('ghost')).toBeUndefined();
    });
  });

  describe('serialize / restore', () => {
    it('serialize captures all trader state', () => {
      const traders = new TraderInventory(config, makeRandom());
      traders.register('t1', 'loner', 5000);
      traders.addStock('t1', 'medkit', 5);
      traders.adjustMoney('t1', -1000);

      const state = traders.serialize();
      expect(state).toHaveProperty('traders');
      const list = state.traders as Array<Record<string, unknown>>;
      expect(list).toHaveLength(1);
      expect(list[0].traderId).toBe('t1');
      expect(list[0].money).toBe(4000);
      expect(Array.isArray(list[0].stock)).toBe(true);
    });

    it('restore rebuilds trader state from serialized data', () => {
      const traders = new TraderInventory(config, makeRandom());
      traders.register('t1', 'loner', 5000);
      traders.addStock('t1', 'medkit', 5);
      traders.adjustMoney('t1', -1000);

      const state = traders.serialize();

      const traders2 = new TraderInventory(config, makeRandom());
      traders2.restore(state);

      expect(traders2.size).toBe(1);
      expect(traders2.getTrader('t1')?.money).toBe(4000);
      expect(traders2.hasStock('t1', 'medkit', 5)).toBe(true);
    });

    it('restore clears existing traders before restoring', () => {
      const traders = new TraderInventory(config, makeRandom());
      traders.register('old_trader', 'bandit', 1000);

      const emptyState = new TraderInventory(config, makeRandom()).serialize();
      traders.restore(emptyState);

      expect(traders.size).toBe(0);
    });

    it('serialize produces JSON-compatible output (no Map objects)', () => {
      const traders = new TraderInventory(config, makeRandom());
      traders.register('t1', 'loner', 5000);
      traders.addStock('t1', 'medkit', 3);

      const state = traders.serialize();
      // Must round-trip through JSON without losing data.
      const json = JSON.stringify(state);
      const parsed = JSON.parse(json) as Record<string, unknown>;

      const traders2 = new TraderInventory(config, makeRandom());
      traders2.restore(parsed);
      expect(traders2.hasStock('t1', 'medkit', 3)).toBe(true);
    });

    it('restore is a no-op when traders array is missing', () => {
      const traders = new TraderInventory(config, makeRandom());
      traders.register('t1', 'loner', 5000);
      traders.restore({});
      expect(traders.size).toBe(0);
    });
  });

  describe('negative quantity validation', () => {
    it('addStock throws on negative quantity', () => {
      const traders = new TraderInventory(config, makeRandom());
      traders.register('t1', 'loner', 5000);
      expect(() => traders.addStock('t1', 'medkit', -1)).toThrow(
        'TraderInventory.addStock: quantity must be >= 0, got -1',
      );
    });

    it('receiveItem throws on negative quantity', () => {
      const traders = new TraderInventory(config, makeRandom());
      traders.register('t1', 'loner', 5000);
      expect(() => traders.receiveItem('t1', 'medkit', -5)).toThrow(
        'TraderInventory.receiveItem: quantity must be >= 0, got -5',
      );
    });

    it('addStock with zero quantity is allowed', () => {
      const traders = new TraderInventory(config, makeRandom());
      traders.register('t1', 'loner', 5000);
      expect(() => traders.addStock('t1', 'medkit', 0)).not.toThrow();
    });

    it('receiveItem with zero quantity is allowed', () => {
      const traders = new TraderInventory(config, makeRandom());
      traders.register('t1', 'loner', 5000);
      expect(() => traders.receiveItem('t1', 'medkit', 0)).not.toThrow();
    });
  });
});
