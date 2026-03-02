import { describe, it, expect } from 'vitest';
import { executeGift, GiftResult } from './GiftSession';
import { Inventory } from '../inventory/Inventory';
import { createDefaultEconomyConfig } from '../types/IEconomyConfig';

const { inventory: invConfig } = createDefaultEconomyConfig();

function makeInventory(maxSlots = invConfig.maxSlots): Inventory {
  return new Inventory({ ...invConfig, maxSlots });
}

// ── helpers ──────────────────────────────────────────────────────────────────

function withItems(
  items: Array<{ itemId: string; quantity: number; maxStack?: number }>,
  maxSlots?: number,
): Inventory {
  const inv = makeInventory(maxSlots);
  for (const { itemId, quantity, maxStack } of items) inv.add(itemId, quantity, maxStack);
  return inv;
}

// ── SUCCESS ───────────────────────────────────────────────────────────────────

describe('executeGift — SUCCESS', () => {
  it('transfers a single item', () => {
    const from = withItems([{ itemId: 'medkit', quantity: 1 }]);
    const to = makeInventory();

    const out = executeGift({ from, to, itemId: 'medkit', quantity: 1 });

    expect(out.result).toBe(GiftResult.SUCCESS);
    expect(out.transferred).toBe(1);
    expect(out.overflow).toBe(0);
    expect(from.has('medkit')).toBe(false);
    expect(to.has('medkit')).toBe(true);
  });

  it('transfers multiple items at once', () => {
    const from = withItems([{ itemId: 'ammo', quantity: 30 }]);
    const to = makeInventory();

    const out = executeGift({ from, to, itemId: 'ammo', quantity: 20 });

    expect(out.result).toBe(GiftResult.SUCCESS);
    expect(out.transferred).toBe(20);
    expect(from.getQuantity('ammo')).toBe(10);
    expect(to.getQuantity('ammo')).toBe(20);
  });

  it('succeeds when canGive is omitted (defaults to true)', () => {
    const from = withItems([{ itemId: 'food', quantity: 1 }]);
    const to = makeInventory();

    const out = executeGift({ from, to, itemId: 'food', quantity: 1 });

    expect(out.result).toBe(GiftResult.SUCCESS);
  });

  it('succeeds when canGive is explicitly true', () => {
    const from = withItems([{ itemId: 'food', quantity: 1 }]);
    const to = makeInventory();

    const out = executeGift({ from, to, itemId: 'food', quantity: 1, canGive: true });

    expect(out.result).toBe(GiftResult.SUCCESS);
  });
});

// ── DECLINED ──────────────────────────────────────────────────────────────────

describe('executeGift — DECLINED', () => {
  it('returns DECLINED when canGive is false', () => {
    const from = withItems([{ itemId: 'medkit', quantity: 1 }]);
    const to = makeInventory();

    const out = executeGift({ from, to, itemId: 'medkit', quantity: 1, canGive: false });

    expect(out.result).toBe(GiftResult.DECLINED);
    expect(out.transferred).toBe(0);
  });

  it('does not modify either inventory when declined', () => {
    const from = withItems([{ itemId: 'medkit', quantity: 3 }]);
    const to = makeInventory();

    executeGift({ from, to, itemId: 'medkit', quantity: 3, canGive: false });

    expect(from.getQuantity('medkit')).toBe(3);
    expect(to.has('medkit')).toBe(false);
  });
});

// ── INSUFFICIENT_ITEMS ────────────────────────────────────────────────────────

describe('executeGift — INSUFFICIENT_ITEMS', () => {
  it('returns INSUFFICIENT_ITEMS when source has none', () => {
    const from = makeInventory();
    const to = makeInventory();

    const out = executeGift({ from, to, itemId: 'medkit', quantity: 1 });

    expect(out.result).toBe(GiftResult.INSUFFICIENT_ITEMS);
    expect(out.transferred).toBe(0);
  });

  it('returns INSUFFICIENT_ITEMS when source has fewer than requested', () => {
    const from = withItems([{ itemId: 'medkit', quantity: 2 }]);
    const to = makeInventory();

    const out = executeGift({ from, to, itemId: 'medkit', quantity: 5 });

    expect(out.result).toBe(GiftResult.INSUFFICIENT_ITEMS);
    expect(from.getQuantity('medkit')).toBe(2); // unchanged
    expect(to.has('medkit')).toBe(false);
  });
});

// ── INVENTORY_FULL ────────────────────────────────────────────────────────────

describe('executeGift — INVENTORY_FULL', () => {
  it('returns INVENTORY_FULL when destination has no free slot', () => {
    // 1-slot destination already occupied by a different item
    const from = withItems([{ itemId: 'medkit', quantity: 1 }]);
    const to = withItems([{ itemId: 'ammo', quantity: 1 }], /* maxSlots */ 1);

    const out = executeGift({ from, to, itemId: 'medkit', quantity: 1 });

    expect(out.result).toBe(GiftResult.INVENTORY_FULL);
    expect(out.transferred).toBe(0);
  });

  it('returns source items to from when INVENTORY_FULL', () => {
    const from = withItems([{ itemId: 'medkit', quantity: 1 }]);
    const to = withItems([{ itemId: 'ammo', quantity: 1 }], 1);

    executeGift({ from, to, itemId: 'medkit', quantity: 1 });

    expect(from.getQuantity('medkit')).toBe(1); // fully restored
  });

  it('returns INVENTORY_FULL when destination stack is saturated', () => {
    // Fill to the actual defaultMaxStack (99) so add() returns all as overflow.
    const from = withItems([{ itemId: 'medkit', quantity: 2 }]);
    const to = makeInventory();
    to.add('medkit', 99); // saturate the stack at defaultMaxStack

    const out = executeGift({ from, to, itemId: 'medkit', quantity: 2 });

    expect(out.result).toBe(GiftResult.INVENTORY_FULL);
    expect(from.getQuantity('medkit')).toBe(2); // fully restored
    expect(to.getQuantity('medkit')).toBe(99);  // unchanged
  });
});

// ── PARTIAL ───────────────────────────────────────────────────────────────────

describe('executeGift — PARTIAL', () => {
  it('transfers what fits and returns overflow to source', () => {
    // destination stack: defaultMaxStack=99, already has 97 → room for 2 more
    const from = withItems([{ itemId: 'medkit', quantity: 5 }]);
    const to = makeInventory();
    to.add('medkit', 97);

    const out = executeGift({ from, to, itemId: 'medkit', quantity: 5 });

    expect(out.result).toBe(GiftResult.PARTIAL);
    expect(out.transferred).toBe(2);
    expect(out.overflow).toBe(3);
    expect(to.getQuantity('medkit')).toBe(99);  // saturated
    expect(from.getQuantity('medkit')).toBe(3); // 5 - 2 transferred
  });
});
