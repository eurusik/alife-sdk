# inventory

`Inventory` — generic item container with slot capacity and per-item stack limits.

```ts
import { Inventory } from '@alife-sdk/economy/inventory';
```

Pure data structure — no rendering, no framework coupling, no external dependencies.

---

## Quick start

```ts
import { Inventory } from '@alife-sdk/economy/inventory';

const inv = new Inventory({ maxSlots: 30, defaultMaxStack: 99 });

// Add items — returns overflow count (0 = all added)
const overflow = inv.add('medkit', 5);     // → 0
inv.add('ammo_9mm', 200, 150);             // → 50 (capped at maxStack 150)

// Check presence
inv.has('medkit');          // → true
inv.has('medkit', 10);      // → false (only 5)
inv.getQuantity('ammo_9mm'); // → 150

// Remove items
inv.remove('medkit', 2);    // → true  (3 remain)
inv.remove('medkit', 99);   // → false (insufficient, nothing removed)

// Capacity
inv.usedSlots;  // → 2
inv.capacity;   // → 30
inv.isFull;     // → false

// Iterate all occupied slots
for (const slot of inv.getAllSlots()) {
  console.log(slot.itemId, slot.quantity, slot.maxStack);
}
```

---

## `IInventoryConfig`

```ts
interface IInventoryConfig {
  /** Maximum number of distinct item slots. */
  maxSlots: number;

  /** Default max stack when item doesn't pass its own maxStack to add(). */
  defaultMaxStack: number;
}
```

Pass it directly to the constructor or use `createDefaultEconomyConfig()` from
`@alife-sdk/economy/types` which provides both trade and inventory defaults.

---

## API

### `add(itemId, quantity, maxStack?): number`

Adds items to the inventory.

- If the item already has a slot — increments quantity up to `maxStack`.
- If the item is new — creates a slot if `usedSlots < maxSlots`.
- Returns the **overflow** — items that couldn't fit. `0` means everything was added.

```ts
const overflow = inv.add('grenade', 5, 3);
// If inv was empty: adds 3, returns 2 (overflow)
```

`maxStack` is optional — falls back to `config.defaultMaxStack` when omitted.

### `remove(itemId, quantity): boolean`

Removes exactly `quantity` items. Returns `false` if the inventory has fewer —
**nothing is removed** in that case (all-or-nothing).

Automatically deletes the slot when quantity reaches zero.

### `has(itemId, quantity?): boolean`

Returns `true` if the inventory holds at least `quantity` of the item.
Default `quantity` is `1`.

### `getQuantity(itemId): number`

Returns the current quantity of an item, or `0` if the item is not present.

### `getSlot(itemId): Readonly<IInventorySlot> | undefined`

Returns a read-only view of a single slot. Returns `undefined` if the item
is not in the inventory.

> Do not mutate the returned object — use `add` / `remove` instead.

### `getAllSlots(): readonly IInventorySlot[]`

Returns a cached snapshot of all occupied slots. The snapshot is rebuilt only
when the inventory is mutated — safe to call every frame.

### `clear()`

Removes all items.

### `isFull` / `usedSlots` / `capacity`

```ts
inv.isFull;    // usedSlots >= maxSlots
inv.usedSlots; // current number of distinct item types
inv.capacity;  // maxSlots from config
```

---

## Serialisation

```ts
// Save
const state = inv.serialize();
// → [{ itemId: 'medkit', quantity: 3, maxStack: 10 }, ...]

// Load
inv.restore(state); // clears first, then repopulates
```

`serialize()` returns a plain array — safe to put directly into JSON.
`restore()` rebuilds the full slot map from the saved array.

---

## IInventorySlot

```ts
interface IInventorySlot {
  readonly itemId:   string;
  quantity:          number;  // mutable internally — do not write from outside
  readonly maxStack: number;
}
```

`maxStack` is stored per slot so different pickup sources can pass different
caps for the same item type. `getSlot()` returns `Readonly<IInventorySlot>` —
TypeScript enforces the read-only contract at the call site.
