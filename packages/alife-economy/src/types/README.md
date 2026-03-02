# types

Shared value objects and configuration interfaces for the entire economy system.

```ts
import { QuestStatus, ObjectiveType, createDefaultEconomyConfig } from '@alife-sdk/economy/types';
import type { IQuestDefinition, IEconomyConfig, ITradeConfig } from '@alife-sdk/economy/types';
```

---

## What's in this module

| Export | Kind | Used by |
|--------|------|---------|
| `IItemDefinition` | interface | Your item catalogue / data loader |
| `IInventorySlot` | interface | `Inventory`, `inventory/` |
| `ITraderStockEntry` | interface | `TraderInventory`, `trade/` |
| `QuestStatus` | const + type | `QuestEngine`, `quest/` |
| `ObjectiveType` | const + type | `IQuestObjective` |
| `IQuestObjective` | interface | `IQuestDefinition`, `QuestEngine` |
| `ITerrainEffect` | interface | `IQuestDefinition`, `QuestEngine` |
| `IQuestDefinition` | interface | `QuestEngine.registerQuest()` |
| `IQuestState` | interface | `QuestEngine.getQuestState()` |
| `ITradeConfig` | interface | `TraderInventory`, `PricingEngine`, `TradeSession` |
| `IInventoryConfig` | interface | `Inventory` |
| `IEconomyConfig` | interface | `EconomyPlugin` |
| `createDefaultEconomyConfig` | function | Setup / testing |

---

## Configuration

### `createDefaultEconomyConfig(overrides?)`

Creates a complete `IEconomyConfig` with production defaults. Pass partial
overrides to change specific values:

```ts
import { createDefaultEconomyConfig } from '@alife-sdk/economy/types';

// Default config (no overrides)
const config = createDefaultEconomyConfig();

// Custom overrides
const config = createDefaultEconomyConfig({
  trade: {
    buyPriceMultiplier:  1.5,   // more expensive traders
    restockIntervalMs:   60_000, // restock every minute
  },
  inventory: {
    maxSlots: 50,
  },
});
```

### `ITradeConfig` — default values

| Field | Default | Description |
|-------|---------|-------------|
| `buyPriceMultiplier` | `1.3` | Player pays 130% of base price |
| `sellPriceMultiplier` | `0.5` | Player receives 50% of base price |
| `allyDiscount` | `0.8` | 20% buy discount for allied factions |
| `allyThreshold` | `50` | Relation > 50 → ally discount applies |
| `minRelationToTrade` | `-30` | Block trade below −30 |
| `restockIntervalMs` | `300_000` | Restock every 5 min (real time) |
| `bonusItemChance` | `0.4` | 40% chance of bonus item on restock |

### `IInventoryConfig` — default values

| Field | Default | Description |
|-------|---------|-------------|
| `maxSlots` | `30` | Max distinct item types in inventory |
| `defaultMaxStack` | `99` | Default stack size per item |

---

## Quest types

### `QuestStatus`

```ts
QuestStatus.AVAILABLE  // 'available' — registered, not yet started
QuestStatus.ACTIVE     // 'active'    — in progress
QuestStatus.COMPLETED  // 'completed' — all objectives done
QuestStatus.FAILED     // 'failed'    — explicitly failed
```

### `ObjectiveType`

Built-in presets (open enum — any string is also valid):

```ts
ObjectiveType.REACH_ZONE  // 'reach_zone'
ObjectiveType.KILL        // 'kill'
```

### `IQuestDefinition`

The static description of a quest — register it once at boot:

```ts
interface IQuestDefinition {
  id:           string;
  name:         string;
  description:  string;
  objectives:   IQuestObjective[];
  terrainEffects?: ITerrainEffect[];  // optional lock/unlock on triggers
  requires?:    string[];             // quest IDs that must be COMPLETED first
}
```

### `IQuestObjective`

```ts
interface IQuestObjective {
  id:          string;
  type:        ObjectiveType | (string & {});  // open — any string valid
  target:      string;      // zone id, enemy type, item id, NPC id, …
  description: string;
  count:       number;      // target count (1 = instant, N = progress)
  current:     number;      // mutable — current progress
  completed:   boolean;     // mutable — set by QuestEngine
}
```

### `ITerrainEffect`

```ts
interface ITerrainEffect {
  terrainId: string;
  action:    'lock' | 'unlock';
  trigger:   'on_start' | 'on_complete' | 'on_fail';
}
```

### `IQuestState`

Runtime state returned by `QuestEngine.getQuestState()`:

```ts
interface IQuestState {
  readonly id: string;
  status:      QuestStatus;      // mutable by QuestEngine
  objectives:  IQuestObjective[]; // mutable by QuestEngine
}
```

---

## Item and trader types

### `IItemDefinition`

Your item catalogue shape — the SDK doesn't ship a built-in item DB,
you define and load your own:

```ts
interface IItemDefinition {
  id:        string;
  name:      string;
  type:      string;
  basePrice: number;  // used by PricingEngine
  category:  string;
  weight:    number;
  maxStack:  number;  // passed as maxStack to Inventory.add()
}
```

### `IInventorySlot`

```ts
interface IInventorySlot {
  readonly itemId:   string;
  quantity:          number;   // mutable internally — read via Inventory.getSlot()
  readonly maxStack: number;
}
```

### `ITraderStockEntry`

```ts
interface ITraderStockEntry {
  readonly itemId: string;
  quantity:        number;  // mutable — decremented on buy, incremented on sell/restock
}
```
