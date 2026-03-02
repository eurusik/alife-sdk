import { describe, it, expect, vi } from 'vitest';
import { Inventory } from './Inventory';
import { createDefaultEconomyConfig } from '../types/IEconomyConfig';

const config = createDefaultEconomyConfig().inventory;

function makeInventory() {
  return new Inventory(config);
}

describe('Inventory', () => {
  describe('add', () => {
    it('adds a new item', () => {
      const inv = makeInventory();
      const overflow = inv.add('medkit', 3);
      expect(overflow).toBe(0);
      expect(inv.getQuantity('medkit')).toBe(3);
    });

    it('stacks onto existing item', () => {
      const inv = makeInventory();
      inv.add('medkit', 3);
      inv.add('medkit', 2);
      expect(inv.getQuantity('medkit')).toBe(5);
    });

    it('returns overflow when stack is full', () => {
      const inv = makeInventory();
      inv.add('medkit', 8, 10);
      const overflow = inv.add('medkit', 5, 10);
      expect(overflow).toBe(3);
      expect(inv.getQuantity('medkit')).toBe(10);
    });

    it('returns all as overflow when inventory is full', () => {
      const inv = new Inventory({ maxSlots: 2, defaultMaxStack: 99 });
      inv.add('item_1', 1);
      inv.add('item_2', 1);
      const overflow = inv.add('item_3', 5);
      expect(overflow).toBe(5);
    });

    it('allows stacking into existing slot when full', () => {
      const inv = new Inventory({ maxSlots: 1, defaultMaxStack: 99 });
      inv.add('item_1', 5);
      const overflow = inv.add('item_1', 3);
      expect(overflow).toBe(0);
      expect(inv.getQuantity('item_1')).toBe(8);
    });

    it('uses default maxStack from config', () => {
      const inv = new Inventory({ maxSlots: 30, defaultMaxStack: 5 });
      const overflow = inv.add('item_1', 10);
      expect(overflow).toBe(5);
      expect(inv.getQuantity('item_1')).toBe(5);
    });
  });

  describe('remove', () => {
    it('removes items', () => {
      const inv = makeInventory();
      inv.add('medkit', 5);
      expect(inv.remove('medkit', 3)).toBe(true);
      expect(inv.getQuantity('medkit')).toBe(2);
    });

    it('deletes slot when quantity reaches 0', () => {
      const inv = makeInventory();
      inv.add('medkit', 1);
      inv.remove('medkit', 1);
      expect(inv.usedSlots).toBe(0);
    });

    it('returns false for nonexistent item', () => {
      const inv = makeInventory();
      expect(inv.remove('nope', 1)).toBe(false);
    });

    it('returns false for insufficient quantity', () => {
      const inv = makeInventory();
      inv.add('medkit', 2);
      expect(inv.remove('medkit', 5)).toBe(false);
    });
  });

  describe('has', () => {
    it('returns true when item exists with enough quantity', () => {
      const inv = makeInventory();
      inv.add('medkit', 3);
      expect(inv.has('medkit', 2)).toBe(true);
    });

    it('returns false when quantity insufficient', () => {
      const inv = makeInventory();
      inv.add('medkit', 1);
      expect(inv.has('medkit', 5)).toBe(false);
    });

    it('returns false for absent item', () => {
      const inv = makeInventory();
      expect(inv.has('medkit')).toBe(false);
    });
  });

  describe('properties', () => {
    it('isFull returns true at capacity', () => {
      const inv = new Inventory({ maxSlots: 2, defaultMaxStack: 99 });
      inv.add('a', 1);
      inv.add('b', 1);
      expect(inv.isFull).toBe(true);
    });

    it('usedSlots tracks count', () => {
      const inv = makeInventory();
      expect(inv.usedSlots).toBe(0);
      inv.add('a', 1);
      expect(inv.usedSlots).toBe(1);
    });

    it('capacity matches config', () => {
      const inv = makeInventory();
      expect(inv.capacity).toBe(config.maxSlots);
    });
  });

  describe('serialize/restore', () => {
    it('round-trips inventory data', () => {
      const inv = makeInventory();
      inv.add('medkit', 5, 10);
      inv.add('bread', 3);

      const data = inv.serialize();
      const inv2 = makeInventory();
      inv2.restore(data);

      expect(inv2.getQuantity('medkit')).toBe(5);
      expect(inv2.getQuantity('bread')).toBe(3);
      expect(inv2.usedSlots).toBe(2);
    });
  });

  describe('clear', () => {
    it('removes all items', () => {
      const inv = makeInventory();
      inv.add('a', 1);
      inv.add('b', 2);
      inv.clear();
      expect(inv.usedSlots).toBe(0);
    });
  });

  describe('getAllSlots', () => {
    it('returns snapshot of all slots', () => {
      const inv = makeInventory();
      inv.add('a', 1);
      inv.add('b', 2);
      const slots = inv.getAllSlots();
      expect(slots).toHaveLength(2);
    });
  });

  describe('events', () => {
    it('emits item:added on new item', () => {
      const inv = makeInventory();
      const cb = vi.fn();
      inv.on('item:added', cb);
      inv.add('medkit', 3);
      expect(cb).toHaveBeenCalledOnce();
      expect(cb).toHaveBeenCalledWith({ itemId: 'medkit', quantity: 3, newTotal: 3 });
    });

    it('emits item:added on stack increment', () => {
      const inv = makeInventory();
      inv.add('medkit', 3);
      const cb = vi.fn();
      inv.on('item:added', cb);
      inv.add('medkit', 2);
      expect(cb).toHaveBeenCalledWith({ itemId: 'medkit', quantity: 2, newTotal: 5 });
    });

    it('does NOT emit item:added when full overflow (no slot created)', () => {
      const inv = new Inventory({ maxSlots: 1, defaultMaxStack: 99 });
      inv.add('item_1', 1);
      const cb = vi.fn();
      inv.on('item:added', cb);
      inv.add('item_2', 5); // inventory full — slot not created
      expect(cb).not.toHaveBeenCalled();
    });

    it('does NOT emit item:added when stack overflow adds 0', () => {
      const inv = makeInventory();
      inv.add('medkit', 10, 10);
      const cb = vi.fn();
      inv.on('item:added', cb);
      inv.add('medkit', 3, 10); // already at max — toAdd = 0
      expect(cb).not.toHaveBeenCalled();
    });

    it('emits item:removed with correct newTotal', () => {
      const inv = makeInventory();
      inv.add('medkit', 5);
      const cb = vi.fn();
      inv.on('item:removed', cb);
      inv.remove('medkit', 2);
      expect(cb).toHaveBeenCalledWith({ itemId: 'medkit', quantity: 2, newTotal: 3 });
    });

    it('emits item:removed with newTotal 0 when slot deleted', () => {
      const inv = makeInventory();
      inv.add('medkit', 1);
      const cb = vi.fn();
      inv.on('item:removed', cb);
      inv.remove('medkit', 1);
      expect(cb).toHaveBeenCalledWith({ itemId: 'medkit', quantity: 1, newTotal: 0 });
    });

    it('does NOT emit item:removed on failed remove', () => {
      const inv = makeInventory();
      const cb = vi.fn();
      inv.on('item:removed', cb);
      inv.remove('nope', 1);
      expect(cb).not.toHaveBeenCalled();
    });

    it('emits inventory:cleared on clear()', () => {
      const inv = makeInventory();
      inv.add('a', 1);
      const cb = vi.fn();
      inv.on('inventory:cleared', cb);
      inv.clear();
      expect(cb).toHaveBeenCalledOnce();
    });

    it('off() stops receiving events', () => {
      const inv = makeInventory();
      const cb = vi.fn();
      inv.on('item:added', cb);
      inv.add('a', 1);
      inv.off('item:added', cb);
      inv.add('b', 1);
      expect(cb).toHaveBeenCalledOnce();
    });

    it('supports multiple listeners on same event', () => {
      const inv = makeInventory();
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      inv.on('item:added', cb1);
      inv.on('item:added', cb2);
      inv.add('a', 1);
      expect(cb1).toHaveBeenCalledOnce();
      expect(cb2).toHaveBeenCalledOnce();
    });

    it('restore() does NOT emit inventory:cleared', () => {
      const inv = makeInventory();
      inv.add('a', 1);
      const data = inv.serialize();
      const cb = vi.fn();
      inv.on('inventory:cleared', cb);
      inv.restore(data);
      expect(cb).not.toHaveBeenCalled();
      expect(inv.getQuantity('a')).toBe(1);
    });
  });
});
