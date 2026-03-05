# @alife-sdk/economy

Trade, inventory, and quest systems for A-Life SDK.

Engine-agnostic. Depends on [`@alife-sdk/core`](../alife-core/README.md).

```
npm install @alife-sdk/economy
```

---

## What this package does

`@alife-sdk/economy` provides the full player-facing economy layer:

- **Inventory** — slot-based item container with stack limits and overflow handling
- **Trade** — player ↔ NPC buy/sell, item gifting, pricing with faction discounts
- **Offline NPC-NPC trade** — background trader-to-trader exchanges via co-location
- **Quests** — lifecycle FSM with objective tracking, prerequisites, typed events, and terrain effects

The package is engine-agnostic — it never touches the renderer, UI, or event bus.
All integration goes through optional **ports** — typed adapters that are optional registration keys
decoupling the economy plugin from your game's terrain, simulation, and item systems.
Register them via `kernel.portRegistry.provide()` before `kernel.init()`.

---

## Quick start

> `EconomyPlugin` works standalone or inside `ALifeKernel`.
> The example below uses the kernel. For standalone usage skip `kernel.use()` and call methods directly.

```ts
import { ALifeKernel }              from '@alife-sdk/core';
import { SeededRandom }             from '@alife-sdk/core/ports';
import { EconomyPlugin }            from '@alife-sdk/economy/plugin';
import { TradeResult }              from '@alife-sdk/economy/trade';

// 1. Create and install the plugin
const random = new SeededRandom(42);
const econ   = new EconomyPlugin(random);
kernel.use(econ);
await kernel.init();

// 2. Stock a trader
econ.traders.register('sid', 'loner', 5000);
econ.traders.addStock('sid', 'medkit',   10);
econ.traders.addStock('sid', 'ammo_9mm', 200);

// 3. Register quests
econ.quests.registerQuest({
  id: 'q_clear_village',
  name: 'Clear the Village',
  objectives: [
    { id: 'obj_kill', type: 'kill', target: 'bandit', description: 'Kill 5 bandits', count: 5, current: 0, completed: false },
  ],
});

// 4. Subscribe to quest events
econ.quests.on('quest:completed', ({ questId }) => {
  econ.playerInventory.add('reward_artifact', 1);
});

// 5. Player buys a medkit from the trader
const outcome = executeBuy({
  playerInventory: econ.playerInventory,
  playerMoney:     2000,
  traders:         econ.traders,
  traderId:        'sid',
  itemId:          'medkit',
  basePrice:       500,
  factionRelation: 40,
  config:          econ.config.trade,
});
// outcome.receipt.result === TradeResult.SUCCESS

// 6. Quest progress — call per kill event
econ.quests.startQuest('q_clear_village');
econ.quests.updateObjectiveProgress('q_clear_village', 'obj_kill'); // +1 per kill

// 7. Save / load
const save = econ.serialize();
econ.restore(save);
```

---

## Sub-path imports

Each module has its own import path for optimal tree-shaking:

| Import path | What's inside | Module docs |
|-------------|--------------|-------------|
| `@alife-sdk/economy` | Full re-export of all sub-modules | [src/](src/) |
| `@alife-sdk/economy/plugin` | `EconomyPlugin` — kernel plugin entry point | [plugin/](src/plugin/README.md) |
| `@alife-sdk/economy/inventory` | `Inventory` — slot-based item container | [inventory/](src/inventory/README.md) |
| `@alife-sdk/economy/trade` | `TraderInventory`, `executeBuy`, `executeSell`, `executeGift`, `OfflineTradeScheduler` | [trade/](src/trade/README.md) |
| `@alife-sdk/economy/quest` | `QuestEngine`, `QuestStatus`, `QuestEventMap` | [quest/](src/quest/README.md) |
| `@alife-sdk/economy/ports` | `EconomyPorts` — optional integration tokens | [ports/](src/ports/README.md) |
| `@alife-sdk/economy/types` | All interfaces and config types | [types/](src/types/README.md) |

---

## Architecture

```
                ┌────────────────────────────────────────┐
                │              ALifeKernel               │
                │   (from @alife-sdk/core)               │
                └──────────────┬─────────────────────────┘
                               │ kernel.use(econ)
                ┌──────────────▼─────────────────────────┐
                │            EconomyPlugin               │
                │                                        │
                │  playerInventory  ── Inventory         │
                │  traders  ────────── TraderInventory   │
                │  quests   ────────── QuestEngine       │
                │  config   ────────── IEconomyConfig    │
                └──┬─────────────────────────────────────┘
                   │ optional ports (register before init)
       ┌───────────┼──────────────────┐
       │           │                  │
  TerrainLock  CoLocation        ItemCatalogue
  (quest lock)  (NPC-NPC trade)  (offline prices)

Trade functions (stateless, use anywhere):
  executeBuy / executeSell     player ↔ trader
  executeGift                  any inventory ↔ any inventory (no money)
  OfflineTradeScheduler        background NPC-NPC trading
```

---

## Key concepts

### Inventory — slot-based container

`Inventory` stores items as `(itemId → quantity)` slots with configurable
capacity and per-item stack limits. `add()` returns overflow — items that
didn't fit. `remove()` is all-or-nothing.

```ts
const inv = new Inventory({ maxSlots: 30, defaultMaxStack: 99 });
const overflow = inv.add('medkit', 5, 10); // → 0 (all fit, maxStack 10)
inv.remove('medkit', 2);                   // → true
inv.has('medkit', 3);                      // → true
```

See [`inventory/README.md`](src/inventory/README.md).

### Trade — buy, sell, gift

Three pure functions handle all item movement:

- **`executeBuy`** — player buys 1 item from a trader; validates relation,
  stock, money, inventory space; returns `ITradeOutcome` with a result code
- **`executeSell`** — player sells 1 item to a trader; validates relation,
  player stock, trader funds
- **`executeGift`** — moves items between any two `Inventory` instances with
  no money involved; supports partial overflow; use for quest rewards,
  NPC handoffs, loot containers

All three are **stateless** — no state is mutated on failure.

See [`trade/README.md`](src/trade/README.md).

### QuestEngine — lifecycle FSM with events

`QuestEngine` tracks quest state through `AVAILABLE → ACTIVE → COMPLETED / FAILED`.
Key features:

- **Prerequisites** — `requires: ['q_prev']` gates `startQuest()` until prior quests complete
- **Typed events** — subscribe with `engine.on('quest:completed', cb)` instead of polling
- **Terrain effects** — declarative `lock/unlock` actions on `on_start`, `on_complete`, `on_fail`
- **Open objective types** — any string valid; engine drives all via `completeObjective()` / `updateObjectiveProgress()`

`startQuest()` returns `false` if prerequisites are unmet or the quest is already active (not in `AVAILABLE` status).

```ts
engine.on('quest:completed', ({ questId }) => giveReward(questId));
engine.on('objective:progress', ({ current, total }) => ui.setProgress(current / total));
```

See [`quest/README.md`](src/quest/README.md).

### Optional ports

Register adapters before `kernel.init()` to unlock optional features:

| Port | Activates |
|------|-----------|
| `EconomyPorts.TerrainLock` | Quest-driven terrain lock/unlock |
| `EconomyPorts.CoLocationSource` | Offline NPC-NPC trading |
| `EconomyPorts.ItemCatalogue` | Offline trade price lookup |

All ports are optional — `EconomyPlugin` works without them.
See [`ports/README.md`](src/ports/README.md).

---

## Lifecycle

```
kernel.use(econ)       ← install plugin
  ↓
kernel.init()          ← validate config, wire optional ports
  ↓
boot time:
  traders.register()   ← register NPC traders
  traders.addStock()   ← set initial stock (also sets restock baseline)
  quests.registerQuest() ← define all quests
  ↓
game loop:
  traders.restock(now) ← call periodically (every in-game hour or timer)
  quests events fire automatically on state transitions
  ↓
save / load:
  econ.serialize()     ← inventory + traders + quests
  econ.restore(state)  ← re-register quests first, then restore
  ↓
kernel.destroy()       ← clears inventory + traders, releases kernel ref
```

> **Important**: Call `quests.registerQuest()` for ALL quest definitions BEFORE calling `econ.restore()`.
> The plugin merges saved progress into registered definitions — quests not registered before restore are silently skipped.

---

## Testing

The package has **228 tests** (vitest). Run them:

```
pnpm test --filter @alife-sdk/economy
```

All subsystems are pure — no kernel needed for unit tests:

```ts
import { Inventory }                from '@alife-sdk/economy/inventory';
import { executeBuy, TradeResult }  from '@alife-sdk/economy/trade';
import { QuestEngine }              from '@alife-sdk/economy/quest';
import { createDefaultEconomyConfig } from '@alife-sdk/economy/types';
import { SeededRandom }             from '@alife-sdk/core/ports';

const config  = createDefaultEconomyConfig();
const traders = new TraderInventory(config.trade, new SeededRandom(0));
traders.register('t1', 'loner', 9999);
traders.addStock('t1', 'medkit', 5);

const outcome = executeBuy({
  playerInventory: new Inventory(config.inventory),
  playerMoney: 0,
  traders, traderId: 't1', itemId: 'medkit',
  basePrice: 100, factionRelation: 0, config: config.trade,
});
expect(outcome.receipt.result).toBe(TradeResult.INSUFFICIENT_MONEY);
```

---

## Module map

```
src/
├── plugin/     EconomyPlugin (IALifePlugin — owns inventory + traders + quests)
├── inventory/  Inventory (slot container, stack limits, serialize/restore)
├── trade/      TraderInventory, executeBuy, executeSell, executeGift,
│               PricingEngine, OfflineTradeScheduler
├── quest/      QuestEngine (FSM, events, prerequisites, terrain effects)
├── ports/      EconomyPorts tokens (TerrainLock / CoLocationSource / ItemCatalogue)
└── types/      IEconomyConfig, ITradeConfig, IInventoryConfig,
                IQuestDefinition, IQuestObjective, QuestStatus, ObjectiveType, …
```
