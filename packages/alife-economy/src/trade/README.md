# trade

Player ↔ trader buy/sell transactions, item gifting, pricing, and offline
NPC-NPC trading.

```ts
import { TraderInventory, executeBuy, executeSell, TradeResult } from '@alife-sdk/economy/trade';
```

Pure logic — no rendering, no event emission (host handles events).

---

## What's in this module

| Export | What it does |
|--------|-------------|
| `TraderInventory` | Per-trader stock, money, and restock lifecycle |
| `executeBuy` / `executeSell` | Execute a player ↔ trader transaction |
| `TradeResult` | Result codes for buy/sell outcomes |
| `executeGift` | Transfer items without money (quest rewards, NPC handoffs) |
| `GiftResult` | Result codes for gift outcomes |
| `calculateBuyPrice` / `calculateSellPrice` | Pure pricing functions |
| `canTrade` | Check if faction relation allows trading |
| `OfflineTradeScheduler` | Periodic background NPC-NPC trading |

---

## Quick start — player buys from a trader

```ts
import { TraderInventory, executeBuy, TradeResult } from '@alife-sdk/economy/trade';
import { Inventory }                                from '@alife-sdk/economy/inventory';
import { SeededRandom }                             from '@alife-sdk/core/ports';
import { createDefaultEconomyConfig }               from '@alife-sdk/economy/types';

const config  = createDefaultEconomyConfig();
const random  = new SeededRandom(42);
const traders = new TraderInventory(config.trade, random);

// Register and stock a trader
traders.register('sid', 'loner', 5000);
traders.addStock('sid', 'medkit',   10);
traders.addStock('sid', 'ammo_9mm', 200);

// Player wants to buy a medkit
const playerInventory = new Inventory(config.inventory);
const outcome = executeBuy({
  playerInventory,
  playerMoney:    2000,
  traders,
  traderId:       'sid',
  itemId:         'medkit',
  basePrice:      500,
  factionRelation: 40,   // player's relation with 'loner' faction
  config:         config.trade,
});

if (outcome.receipt.result === TradeResult.SUCCESS) {
  const newMoney = outcome.newPlayerMoney; // deducted buy price
}
```

---

## TraderInventory

Manages all NPC traders — their stock, money, and restock timers.

### Setup

```ts
const traders = new TraderInventory(config.trade, random);

// Register a trader with initial money
traders.register('sid',      'loner',   5000);
traders.register('barman',   'freedom', 8000);

// Stock traders at boot
traders.addStock('sid', 'medkit',   10);
traders.addStock('sid', 'ammo_9mm', 200);
```

`addStock()` also records the **restock baseline** — the quantity the trader
returns to after each restock cycle.

### Restock

```ts
// Call periodically (e.g. every in-game hour)
traders.restock(currentTimeMs);
```

Restock:
- Skips traders in an active trade session (`isActive = true`)
- Restores stock to baseline quantities
- Resets money to `initialMoney`
- Has a configurable chance (`bonusItemChance`, default 40%) to add one
  random bonus item from the bonus pool

```ts
// Optional bonus pool — rare/random items that appear on restock
traders.setBonusPool([
  { itemId: 'artifact_jellyfish', weight: 1 },
  { itemId: 'artifact_soul',      weight: 3 },
]);
```

### Active session guard

```ts
traders.setActive('sid', true);   // open trade UI — suppresses restock
traders.setActive('sid', false);  // close trade UI
```

### Read trader state

```ts
const snapshot = traders.getTrader('sid');
// → { traderId, factionId, money, stock: ReadonlyMap, isActive }

traders.hasStock('sid', 'medkit');      // → true
traders.getTraderIds();                 // → ['sid', 'barman']
traders.size;                           // → 2
```

---

## Pricing

```ts
import { calculateBuyPrice, calculateSellPrice, canTrade } from '@alife-sdk/economy/trade';
```

**Buy price formula:**
```
buyPrice = round(basePrice × buyPriceMultiplier × allyModifier)
```
Ally discount (`allyModifier = allyDiscount < 1.0`) applies when
`factionRelation > allyThreshold`.

**Sell price formula:**
```
sellPrice = round(basePrice × sellPriceMultiplier)
```
No ally bonus on sell — flat rate regardless of relation.

**Trade gate:**
```ts
canTrade(factionRelation, config); // false if relation < minRelationToTrade
```

### Default config values

| Field | Default | Meaning |
|-------|---------|---------|
| `buyPriceMultiplier` | `1.3` | Player pays 130% of base price |
| `sellPriceMultiplier` | `0.5` | Player receives 50% of base price |
| `allyDiscount` | `0.8` | 20% discount for allied factions |
| `allyThreshold` | `50` | Relation > 50 → ally discount |
| `minRelationToTrade` | `-30` | Block trade below −30 |
| `restockIntervalMs` | `300_000` | Restock every 5 min real time |
| `bonusItemChance` | `0.4` | 40% chance of bonus item on restock |

---

## executeBuy / executeSell

Pure stateless functions that validate and execute a single trade step.

```ts
interface ITradeContext {
  playerInventory: Inventory;
  playerMoney:     number;
  traders:         TraderInventory;
  traderId:        string;
  itemId:          string;
  basePrice:       number;
  factionRelation: number;  // [-100, 100]
  config:          ITradeConfig;
}
```

Both return `ITradeOutcome`:

```ts
interface ITradeOutcome {
  receipt:        ITradeReceipt;  // result code + item + price
  newPlayerMoney: number;         // unchanged on failure
}
```

### TradeResult codes

| Code | When |
|------|------|
| `SUCCESS` | Transaction completed |
| `TRADER_NOT_FOUND` | `traderId` not registered |
| `RELATION_TOO_LOW` | Faction relation below `minRelationToTrade` |
| `INSUFFICIENT_STOCK` | Trader has 0 of the item |
| `INSUFFICIENT_MONEY` | Player can't afford buy price |
| `TRADER_INSUFFICIENT_FUNDS` | Trader can't pay sell price |
| `INSUFFICIENT_ITEMS` | Player doesn't have the item |
| `INVENTORY_FULL` | Player inventory full or item stack full |

On any non-SUCCESS result, **no state is mutated** — safe to show an error
message and retry.

---

## executeGift

Transfer items without money — quest rewards, NPC handoffs, container looting.

```ts
import { executeGift, GiftResult } from '@alife-sdk/economy/trade';

const outcome = executeGift({
  from:     npcInventory,
  to:       playerInventory,
  itemId:   'medkit',
  quantity: 2,
  canGive:  questCompleted && npcRelation > 0,  // your pre-evaluated condition
});
```

Works between **any two `Inventory` instances** — player↔NPC, NPC↔NPC,
chest↔player. No money, faction, or player concepts involved.

### Overflow handling

If the destination has room for only some of the items, the remainder is
returned to the source:

```ts
outcome.result;      // GiftResult.PARTIAL
outcome.transferred; // items that moved
outcome.overflow;    // items returned to source
```

### GiftResult codes

| Code | Meaning |
|------|---------|
| `SUCCESS` | All items transferred |
| `DECLINED` | `canGive` was `false` |
| `INSUFFICIENT_ITEMS` | Source doesn't have enough |
| `INVENTORY_FULL` | Destination has no space at all |
| `PARTIAL` | Some transferred, rest returned to source |

---

## Offline NPC-NPC trading

`OfflineTradeScheduler` runs periodic background trades between co-located
NPC traders — no player involvement.

```ts
import { OfflineTradeScheduler } from '@alife-sdk/economy/trade';

const scheduler = new OfflineTradeScheduler(
  {
    traders,                          // your TraderInventory
    coLocation:  myCoLocationSource,  // ICoLocationSource port
    catalogue:   myItemCatalogue,     // IItemCatalogue port
    preference:  myTradePreference,   // ITradePreference — item scoring
    onTradeResult: (r) => {
      if (r.success) events.emit('NPC_TRADE', r);
    },
  },
  { tradeIntervalMs: 30_000, maxTradesPerTick: 5 },
);

// In your update loop
scheduler.update(deltaMs, kernel.clock.gameTimeMs);
```

**How it works:**
1. Accumulates real time; fires one tick per `tradeIntervalMs`
2. Per tick: iterates terrains in round-robin order, resolves up to
   `maxTradesPerTick` trades
3. After each trade, both participants enter a per-NPC cooldown
4. `coLocation.getCoLocatedTraders()` is called once per tick

For port interfaces (`ICoLocationSource`, `IItemCatalogue`) see
[`ports/README.md`](../ports/README.md).

---

## Serialisation

```ts
// TraderInventory — save stock + money + restock timers
const tradersState = traders.serialize();
traders.restore(tradersState);

// OfflineTradeScheduler — save cooldowns + cursor + accumulator
const schedulerState = scheduler.serialize();
scheduler.restore(schedulerState);
```

---

## Testing tips

All trade functions are pure — no kernel needed:

```ts
import { executeBuy, TradeResult } from '@alife-sdk/economy/trade';

const traders = new TraderInventory(config.trade, new SeededRandom(0));
traders.register('test_trader', 'loner', 9999);
traders.addStock('test_trader', 'medkit', 5);

const outcome = executeBuy({
  playerInventory: new Inventory({ maxSlots: 10, defaultMaxStack: 99 }),
  playerMoney: 0,
  traders,
  traderId: 'test_trader',
  itemId: 'medkit',
  basePrice: 100,
  factionRelation: 0,
  config: createDefaultEconomyConfig().trade,
});

expect(outcome.receipt.result).toBe(TradeResult.INSUFFICIENT_MONEY);
```
