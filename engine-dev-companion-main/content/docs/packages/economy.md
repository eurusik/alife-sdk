# @alife-sdk/economy

This package is the player-facing progression layer: inventory, trade, and quests.

Use it when your living world also needs reasons for the player to care about what the world contains, who controls it, and what progress means.

## Install

```bash
npm install @alife-sdk/economy @alife-sdk/core
```

## What it gives you

- slot-based inventory
- trader inventories and buy/sell helpers
- NPC-to-NPC background trade
- `QuestEngine` with lifecycle, objectives, and events

## Add it when

- your game needs merchants, items, or quest progression
- the world simulation should connect to player-facing systems
- you want quests and trade to live in the same runtime stack as the rest of the world

## The three main subsystems

| Subsystem | Role |
|---|---|
| `Inventory` | Item ownership, stack limits, capacity rules |
| Trade helpers | Buy, sell, and gift flows |
| `QuestEngine` | Quest states, objective progress, and quest events |

## A minimal setup

```ts
import { EconomyPlugin } from '@alife-sdk/economy/plugin';
import { executeBuy } from '@alife-sdk/economy/trade';
import { SeededRandom } from '@alife-sdk/core/ports';

const econ = new EconomyPlugin(new SeededRandom(42));
kernel.use(econ);
kernel.init();

econ.traders.register('sid', 'loner', 5000);
econ.traders.addStock('sid', 'medkit', 10);

econ.quests.registerQuest({
  id: 'q_clear_village',
  name: 'Clear the Village',
  objectives: [
    { id: 'obj_kill', type: 'kill', target: 'bandit', description: 'Kill 5 bandits', count: 5, current: 0, completed: false },
  ],
});

const result = executeBuy({
  playerInventory: econ.playerInventory,
  playerMoney: 2000,
  traders: econ.traders,
  traderId: 'sid',
  itemId: 'medkit',
  basePrice: 500,
  factionRelation: 40,
  config: econ.config.trade,
});
```

## What your game still owns

- UI and shop presentation
- item visuals and authored item meaning
- quest presentation and player journal
- how rewards are shown and narrated

This package gives you the gameplay rules and state transitions, not the front-end experience.

## Optional ports

The package can also integrate with:

- terrain locking
- co-location sources for offline trading
- item catalogues for pricing

These are optional. The package remains useful without them.

## A good first use

A very good first proof is:

1. register one trader
2. add a few stock items
3. register one quest
4. listen for one quest completion event

That is enough to confirm the package belongs in your game before scaling the content layer.

## Common first-time mistakes

### Treating it like a UI package

It is not. It owns rules and state, not menus or presentation.

### Adding it before the core world loop is stable

If your simulation/event flow is still moving under your feet, the quest and trade layer becomes harder to reason about.

### Trying to use every subsystem at once

You can start with inventory only, or one trader only, or quests only. You do not have to adopt the entire package surface on day one.

## Read next

- [Gameplay Systems](/guides/gameplay-systems)
- [Package README](https://github.com/eurusik/alife-sdk/blob/main/packages/alife-economy/README.md)
