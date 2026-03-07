# @alife-sdk/economy

This package is the player-facing progression layer: inventory, trade, and quests.

## Install

```bash
npm install @alife-sdk/economy @alife-sdk/core
```

## Add it when

- your game needs merchants, items, or quest progression
- the world simulation should connect to player-facing systems
- you want these rules to live in the same runtime stack as the rest of the world

## The main subsystems

| Subsystem | Role |
|---|---|
| `Inventory` | item ownership, stack limits, capacity rules |
| Trade helpers | buy, sell, and gift flows |
| `QuestEngine` | quest states, objective progress, and quest events |

## Start here

1. [Economy Reference](/docs/reference/economy/index)
2. [Inventory](/docs/reference/economy/inventory)
3. [Trade](/docs/reference/economy/trade)

## Most used

- [Quests](/docs/reference/economy/quests)
- [Gameplay Systems](/docs/guides/gameplay-systems)

## Debug this package

- Item ownership feels inconsistent -> [Inventory](/docs/reference/economy/inventory)
- Buy/sell flow returns confusing results -> [Trade](/docs/reference/economy/trade)
- Quest state or restore flow feels wrong -> [Quests](/docs/reference/economy/quests)

## Good first proof

1. register one trader
2. add a few stock items
3. register one quest
4. listen for one quest completion event

## Package README

- [Package README](https://github.com/eurusik/alife-sdk/blob/main/packages/alife-economy/README.md)

## Related pages

- [Economy Reference](/docs/reference/economy/index)
- [Persistence package](/docs/packages/persistence)
- [Gameplay Systems](/docs/guides/gameplay-systems)
