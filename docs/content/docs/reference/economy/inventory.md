# Inventory

Use this page when you need a deterministic item container for trade, rewards, gifting, loot, or persistence.

`Inventory` keeps its scope narrow. It is a rules object, not a UI grid.

## Import path

```ts
import { Inventory } from "@alife-sdk/economy/inventory";
```

## Minimal usage

```ts
const inventory = new Inventory({
  maxSlots: 30,
  defaultMaxStack: 99,
});

const overflow = inventory.add("medkit", 5);

inventory.has("medkit");
inventory.getQuantity("medkit");
inventory.remove("medkit", 2);

const snapshot = inventory.serialize();
```

## Core contract

The model is slot-based:

- one slot per distinct item
- quantity per slot
- per-slot `maxStack`
- overall capacity measured in occupied slots

Important behaviors:

- `add()` returns overflow instead of throwing
- `remove()` is all-or-nothing
- `getAllSlots()` gives a safe read snapshot
- `serialize()` returns plain JSON-friendly data

## `add()` and `remove()` semantics

`add(itemId, quantity, maxStack?)`

- increments an existing slot up to its stack limit
- creates a new slot if capacity allows
- returns the number of items that did not fit

`remove(itemId, quantity)`

- returns `false` if there are not enough items
- mutates nothing on failure
- removes the slot when quantity reaches zero

That deterministic behavior makes inventory easier to integrate with trade and save/load.

## Per-slot stack rule

`maxStack` lives on the slot, not only in global config.

That lets different sources create the same item with different caps when needed, without introducing a second subsystem.

## Serialization

```ts
const saved = inventory.serialize();

inventory.restore(saved);
```

The serialized form is a plain array of slot records, so it can go directly into your persistence pipeline.

## Practical usage rule

Treat `Inventory` as the source of truth for item rules.

Do not make UI code, trade code, and quest code all mutate slot data separately.

## Failure patterns

- treating inventory like a UI widget instead of a rules container
- assuming `add()` always succeeds and ignoring overflow
- mutating slot objects outside the public API
- storing duplicate item truth in several places instead of reading from the inventory

## Related pages

- [Economy package](/docs/packages/economy)
- [Trade](/docs/reference/economy/trade)
- [Quests](/docs/reference/economy/quests)
