# plugin

`EconomyPlugin` — A-Life kernel plugin that wires the full economy system:
player inventory, trader management, and quest engine.

```ts
import { EconomyPlugin } from '@alife-sdk/economy/plugin';
```

---

## Quick start

```ts
import { ALifeKernel }  from '@alife-sdk/core';
import { SeededRandom } from '@alife-sdk/core/ports';
import { EconomyPlugin } from '@alife-sdk/economy/plugin';

const random = new SeededRandom(42);
const econ = new EconomyPlugin(random);

kernel.use(econ);
kernel.init();

// Player inventory
econ.playerInventory.add('medkit', 3);
econ.playerInventory.has('medkit');      // → true

// Traders
econ.traders.register('trader_sidorovich', 'loner', 5000);
econ.traders.addStock('trader_sidorovich', 'medkit',   10);
econ.traders.addStock('trader_sidorovich', 'ammo_9mm', 200);

// Quests
econ.quests.startQuest('q_first_steps');
econ.quests.getActiveQuests(); // → [{ questId: 'q_first_steps', ... }]
```

---

## What EconomyPlugin owns

| Property | Type | What it is |
|----------|------|------------|
| `econ.playerInventory` | `Inventory` | Player's item container |
| `econ.traders` | `TraderInventory` | All NPC trader stocks + buy/sell logic |
| `econ.quests` | `QuestEngine` | Active quests, objectives, terrain effects |
| `econ.config` | `IEconomyConfig` | Resolved config (trade + inventory settings) |

All three subsystems are instantiated in the constructor and accessible
immediately — before `kernel.init()`.

---

## Constructor

```ts
new EconomyPlugin(random: IRandom, config?: Partial<IEconomyConfig>)
```

- `random` — used by `TraderInventory` for price variance and restocking.
  Pass `SeededRandom` for deterministic results in tests.
- `config` — optional overrides for trade and inventory defaults.
  See `createDefaultEconomyConfig()` in `@alife-sdk/economy/types`.

```ts
// Custom config example
const econ = new EconomyPlugin(random, {
  trade: { buyPriceMultiplier: 1.5, sellPriceMultiplier: 0.4, restockIntervalMs: 120_000 },
  inventory: { maxSlots: 50, defaultMaxStack: 99 },
});
```

---

## Lifecycle

```
kernel.use(econ)   ← econ.install() — stores kernel reference
  ↓
kernel.init()      ← econ.init() — validates config, wires optional ports:
                       EconomyPorts.TerrainLock → QuestEngine.setTerrainAdapter()
  ↓
kernel.update()    ← EconomyPlugin has no per-frame update. If using OfflineTradeScheduler,
                       wire `scheduler.update(deltaMs, currentGameTimeMs)` into your update loop separately.
  ↓
kernel.destroy()   ← econ.destroy() — clears inventory + traders, releases kernel ref
```

`init()` emits warnings via `kernel.logger` if the config looks suspicious
(e.g. `sellPriceMultiplier >= buyPriceMultiplier` — traders would lose money).

---

## Optional ports

Register these into `kernel.portRegistry` **before** `kernel.init()` to
unlock additional features:

| Port token | Interface | Purpose |
|-----------|-----------|---------|
| `EconomyPorts.TerrainLock` | `ITerrainLockAdapter` | Quest-driven terrain lock/unlock (e.g. block access to a gulag during a quest) |
| `EconomyPorts.CoLocationSource` | `ICoLocationSource` | NPC co-location data for offline NPC-NPC trading |
| `EconomyPorts.ItemCatalogue` | `IItemCatalogue` | Base price lookup for offline trade catalogue |

```ts
import { EconomyPorts } from '@alife-sdk/economy/ports';

// Example: wire terrain lock adapter before init
kernel.portRegistry.provide(EconomyPorts.TerrainLock, myTerrainLockAdapter);
kernel.use(econ);
kernel.init(); // ← EconomyPlugin picks up the adapter here
```

If a port is absent, the corresponding feature simply doesn't activate —
the plugin works without it.

---

## Serialisation

```ts
// Save
const state = econ.serialize();
// → { playerInventory: [...], traders: {...}, quests: [...] }

// Load
econ.restore(state);
```

`serialize()` / `restore()` delegate to each subsystem:
- `playerInventory.serialize()` / `.restore()`
- `traders.serialize()` / `.restore()`
- `quests.serialize()` / `.restore()`

Each subsystem's format is documented in its own `README.md`.

---

## Subsystem docs

- [`inventory/README.md`](../inventory/README.md) — `Inventory` API
- [`trade/README.md`](../trade/README.md) — `TraderInventory` + buy/sell API
- [`quest/README.md`](../quest/README.md) — `QuestEngine` API
- [`ports/`](../ports/) — `EconomyPorts` tokens + adapter interfaces
- [`types/`](../types/) — `IEconomyConfig`, `createDefaultEconomyConfig`
