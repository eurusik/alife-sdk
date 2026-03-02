/**
 * Integration test: "Inventory encumbrance / capacity system".
 *
 * The Inventory class manages items via SLOT capacity (not raw weight kg),
 * because IInventoryConfig exposes `maxSlots` and `defaultMaxStack` — there
 * is no per-item weight field on IInventorySlot or IInventoryConfig.
 *
 * These tests exercise the full capacity / stacking / slot-exhaustion lifecycle
 * that is functionally equivalent to a weight-based encumbrance system:
 *
 *   1.  addItem (slot) → usedSlots increases
 *   2.  Add new item that would exceed maxSlots → returns non-zero overflow (add blocked)
 *   3.  Remove item → usedSlots decreases
 *   4.  getQuantity() returns sum for a given item
 *   5.  canAdd equivalent: isFull → false when space remains, true when at limit
 *   6.  Multiple distinct items → cumulative slot usage
 *   7.  Stack of same item → quantity multiplied, single slot occupied
 *   8.  maxSlots limit changes when using a new Inventory with higher capacity
 *   9.  Items with unlimited stack (maxStack=99999) — always addable to existing slot
 *  10.  isEncumbered equivalent: isFull → true when at/over slot limit
 *  11.  Partial overflow scenario — item partially added when stack is nearly full
 *  12.  Empty inventory → usedSlots = 0, getAllSlots() returns empty array
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect } from 'vitest';
import { Inventory } from '../inventory/Inventory';
import { createDefaultEconomyConfig } from '../types/IEconomyConfig';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = createDefaultEconomyConfig().inventory;
// maxSlots = 30, defaultMaxStack = 99

function makeInventory(): Inventory {
  return new Inventory(DEFAULT_CONFIG);
}

function smallInventory(maxSlots: number, defaultMaxStack = 99): Inventory {
  return new Inventory({ maxSlots, defaultMaxStack });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Inventory encumbrance / capacity (integration)', () => {
  // -------------------------------------------------------------------------
  // Test 1: Adding an item increases usedSlots
  // -------------------------------------------------------------------------

  it('adding a new item increases usedSlots by 1', () => {
    const inv = makeInventory();
    expect(inv.usedSlots).toBe(0);

    inv.add('medkit', 3);
    expect(inv.usedSlots).toBe(1);

    inv.add('bandage', 5);
    expect(inv.usedSlots).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Test 2: Adding to a full inventory is blocked (overflow returned)
  // -------------------------------------------------------------------------

  it('adding a NEW item when inventory is full returns the full quantity as overflow (add is blocked)', () => {
    const inv = smallInventory(2);

    // Fill all slots.
    inv.add('item_a', 1);
    inv.add('item_b', 1);
    expect(inv.isFull).toBe(true);

    // Attempt to add a third distinct item — blocked.
    const overflow = inv.add('item_c', 5);
    expect(overflow).toBe(5);          // all 5 returned as overflow
    expect(inv.usedSlots).toBe(2);     // slot count unchanged
    expect(inv.has('item_c')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 3: Removing an item decreases usedSlots
  // -------------------------------------------------------------------------

  it('removing all of an item removes its slot and decreases usedSlots', () => {
    const inv = makeInventory();
    inv.add('medkit', 3);
    inv.add('bandage', 2);
    expect(inv.usedSlots).toBe(2);

    inv.remove('medkit', 3);
    expect(inv.usedSlots).toBe(1);
    expect(inv.has('medkit')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 4: getQuantity() returns the correct running total for an item
  // -------------------------------------------------------------------------

  it('getQuantity() returns the correct quantity after successive additions', () => {
    const inv = makeInventory();
    expect(inv.getQuantity('ammo')).toBe(0);

    inv.add('ammo', 20);
    expect(inv.getQuantity('ammo')).toBe(20);

    inv.add('ammo', 10);
    expect(inv.getQuantity('ammo')).toBe(30);

    inv.remove('ammo', 5);
    expect(inv.getQuantity('ammo')).toBe(25);
  });

  // -------------------------------------------------------------------------
  // Test 5: isFull is false when space remains, true when all slots occupied
  // -------------------------------------------------------------------------

  it('isFull returns false while space is available, true once capacity is reached', () => {
    const inv = smallInventory(3);

    expect(inv.isFull).toBe(false);

    inv.add('a', 1);
    expect(inv.isFull).toBe(false);

    inv.add('b', 1);
    expect(inv.isFull).toBe(false);

    inv.add('c', 1);
    expect(inv.isFull).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 6: Multiple distinct items accumulate slot usage correctly
  // -------------------------------------------------------------------------

  it('adding 5 distinct items uses 5 slots', () => {
    const inv = makeInventory();

    const itemIds = ['medkit', 'bandage', 'ammo_9x19', 'bread', 'vodka'];
    for (const id of itemIds) {
      inv.add(id, 1);
    }

    expect(inv.usedSlots).toBe(5);

    // All items are present.
    for (const id of itemIds) {
      expect(inv.has(id)).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // Test 7: Stack of same item multiplies quantity, occupies one slot
  // -------------------------------------------------------------------------

  it('stacking same item multiplies quantity while keeping exactly one slot', () => {
    const inv = makeInventory();

    inv.add('ammo', 20, 100);
    inv.add('ammo', 30, 100);
    inv.add('ammo', 10, 100);

    expect(inv.usedSlots).toBe(1);
    expect(inv.getQuantity('ammo')).toBe(60);
  });

  // -------------------------------------------------------------------------
  // Test 8: Using a new Inventory with higher maxSlots changes limit
  // -------------------------------------------------------------------------

  it('two inventories with different maxSlots have independent slot limits', () => {
    const small = smallInventory(2);
    const large = smallInventory(50);

    // Fill small inventory.
    small.add('x', 1);
    small.add('y', 1);
    expect(small.isFull).toBe(true);

    // Large inventory is not full.
    large.add('x', 1);
    large.add('y', 1);
    expect(large.isFull).toBe(false);
    expect(large.capacity).toBe(50);

    // Can add many more to large.
    for (let i = 0; i < 48; i++) {
      large.add(`item_${i}`, 1);
    }
    expect(large.isFull).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 9: Items with effectively unlimited stack — always stackable
  // -------------------------------------------------------------------------

  it('item with very large maxStack can always have more added to existing slot', () => {
    const inv = smallInventory(1); // only 1 slot allowed
    const HUGE_STACK = 999_999;

    // Add first batch — creates the slot.
    const overflow1 = inv.add('quest_item', 100, HUGE_STACK);
    expect(overflow1).toBe(0);
    expect(inv.usedSlots).toBe(1);
    expect(inv.isFull).toBe(true);

    // Even though inventory is "full" (maxSlots=1), the existing slot can grow.
    const overflow2 = inv.add('quest_item', 500, HUGE_STACK);
    expect(overflow2).toBe(0);
    expect(inv.getQuantity('quest_item')).toBe(600);
    expect(inv.usedSlots).toBe(1); // still one slot
  });

  // -------------------------------------------------------------------------
  // Test 10: isFull (isEncumbered equivalent) — true when at slot limit
  // -------------------------------------------------------------------------

  it('isFull (encumbrance indicator) is true when usedSlots equals capacity', () => {
    const inv = smallInventory(5);

    for (let i = 0; i < 5; i++) {
      expect(inv.isFull).toBe(false);
      inv.add(`item_${i}`, 1);
    }

    expect(inv.isFull).toBe(true);
    expect(inv.usedSlots).toBe(inv.capacity);

    // Removing one item restores "not encumbered".
    inv.remove('item_0', 1);
    expect(inv.isFull).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Test 11: Partial overflow — stack nearly full, only part of new batch fits
  // -------------------------------------------------------------------------

  it('partial overflow when stack is nearly full — partial quantity added, rest returned', () => {
    const inv = makeInventory();

    // Stack limit = 10; add 8, then try to add 5 more.
    inv.add('grenade', 8, 10);
    expect(inv.getQuantity('grenade')).toBe(8);

    const overflow = inv.add('grenade', 5, 10);

    // Stack can only hold 2 more (10 - 8 = 2), so 3 are returned.
    expect(overflow).toBe(3);
    expect(inv.getQuantity('grenade')).toBe(10);
  });

  // -------------------------------------------------------------------------
  // Test 12: Empty inventory baseline — usedSlots = 0, getAllSlots is empty
  // -------------------------------------------------------------------------

  it('empty inventory: usedSlots = 0, getQuantity returns 0, getAllSlots returns []', () => {
    const inv = makeInventory();

    expect(inv.usedSlots).toBe(0);
    expect(inv.isFull).toBe(false);
    expect(inv.getQuantity('medkit')).toBe(0);
    expect(inv.has('medkit')).toBe(false);
    expect(inv.getAllSlots()).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Additional: serialize → restore round-trip preserves slot count
  // -------------------------------------------------------------------------

  it('serialize/restore preserves slot count and quantities (encumbrance state)', () => {
    const inv = smallInventory(10);
    inv.add('medkit', 3, 10);
    inv.add('ammo', 50);
    inv.add('bread', 2);

    expect(inv.usedSlots).toBe(3);

    const snapshot = inv.serialize();

    const inv2 = smallInventory(10);
    inv2.restore(snapshot);

    expect(inv2.usedSlots).toBe(3);
    expect(inv2.getQuantity('medkit')).toBe(3);
    expect(inv2.getQuantity('ammo')).toBe(50);
    expect(inv2.getQuantity('bread')).toBe(2);
  });
});
