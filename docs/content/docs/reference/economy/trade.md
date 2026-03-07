# Trade

Use this page when you need to wire buying, selling, gifting, or trader stock into your game.

The trade layer owns transaction rules and trader runtime state. It does not own menus, item presentation, or UI.

## Import path

```ts
import {
  TraderInventory,
  executeBuy,
  executeSell,
  executeGift,
  TradeResult,
  GiftResult,
  calculateBuyPrice,
  calculateSellPrice,
  canTrade,
  OfflineTradeScheduler,
} from "@alife-sdk/economy/trade";
```

## What you create

In a normal economy integration you create:

1. one `TraderInventory`
2. player `Inventory`
3. buy/sell flows with `executeBuy` / `executeSell`
4. optional no-money flow with `executeGift`
5. optional background economy with `OfflineTradeScheduler`

## Minimal setup

### Buy flow

```ts
const traders = new TraderInventory(config.trade, random);
traders.register("sid", "loner", 5000);
traders.addStock("sid", "medkit", 10);

const outcome = executeBuy({
  playerInventory,
  playerMoney: 2000,
  traders,
  traderId: "sid",
  itemId: "medkit",
  basePrice: 500,
  factionRelation: 40,
  config: config.trade,
});

if (outcome.receipt.result === TradeResult.SUCCESS) {
  playerMoney = outcome.newPlayerMoney;
}
```

## Important transaction rule

`executeBuy()` and `executeSell()` are stateless and safe on failure:

- validation happens first
- if validation fails, no state is mutated
- the result object tells you why the trade failed

That is the main reason this layer is UI-friendly.

## Core contracts you actually care about

### Trader runtime

`TraderInventory` owns:

- stock
- money
- restock baseline
- active-session guard
- optional bonus pool items

### Transaction input

Every buy/sell call depends on:

- player inventory
- player money
- trader inventory
- item and base price
- faction relation
- trade config

### Transaction output

Buy/sell returns:

- `receipt`
- `newPlayerMoney`

So the call tells you both:

- what happened
- what the player's new money value should be

## Result semantics

The important `TradeResult` values are:

| Code | Meaning |
|---|---|
| `SUCCESS` | transaction completed |
| `TRADER_NOT_FOUND` | invalid trader ID |
| `RELATION_TOO_LOW` | trade blocked by faction relation |
| `INSUFFICIENT_STOCK` | trader has no item available |
| `INSUFFICIENT_MONEY` | player cannot afford buy |
| `TRADER_INSUFFICIENT_FUNDS` | trader cannot afford sell |
| `INSUFFICIENT_ITEMS` | player does not have item to sell |
| `INVENTORY_FULL` | destination inventory cannot fit the result |

## Pricing model

Pricing depends on:

- base price
- buy/sell multipliers
- faction relation gate
- optional ally discount on buy

That means faction alignment can influence trade without turning the subsystem into a narrative system.

## Gift flow

Use `executeGift()` when money should not be involved:

- quest rewards
- NPC handoffs
- container looting

It supports partial transfer and explicit overflow reporting, so it is still deterministic even when capacity is tight.

## Background trade

`OfflineTradeScheduler` is the bridge between economy rules and a living world.

Use it when traders should exchange goods off-screen through:

- co-location data
- item catalogue data
- a capped number of background trades per tick

## Failure patterns

- mutating trader stock directly instead of going through the subsystem
- assuming relation affects buy and sell in the same way
- forgetting to suppress restock while a trade session is open
- ignoring non-success result codes and treating every failure the same
- mixing presentation concerns into the trade layer itself

## Related pages

- [Economy package](/docs/packages/economy)
- [Inventory](/docs/reference/economy/inventory)
- [Quests](/docs/reference/economy/quests)
