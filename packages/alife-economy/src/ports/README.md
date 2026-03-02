# ports

`EconomyPorts` — port tokens that connect the economy plugin to your game's
external systems (terrain locking, offline trade data, item prices).

```ts
import { EconomyPorts } from '@alife-sdk/economy/ports';
```

---

## What are ports?

The economy plugin is engine-agnostic — it never calls your simulation layer,
item database, or terrain system directly. Instead, it declares **port tokens**:
typed keys you use to register your own adapters into `kernel.portRegistry`.

During `kernel.init()`, `EconomyPlugin` looks up these tokens and wires the
adapters automatically. If a token is absent, the corresponding feature simply
doesn't activate — the plugin works without it.

---

## Available ports

| Token | Interface | Required? | Activates |
|-------|-----------|-----------|-----------|
| `EconomyPorts.TerrainLock` | `ITerrainLockAdapter` | No | Quest-driven terrain lock/unlock |
| `EconomyPorts.CoLocationSource` | `ICoLocationSource` | No | Offline NPC-NPC trading |
| `EconomyPorts.ItemCatalogue` | `IItemCatalogue` | No | Offline trade price lookup |

---

## How to register a port

Register adapters **before** `kernel.init()`:

```ts
import { EconomyPorts } from '@alife-sdk/economy/ports';

kernel.portRegistry.provide(EconomyPorts.TerrainLock, myTerrainLockAdapter);
kernel.portRegistry.provide(EconomyPorts.CoLocationSource, myCoLocationSource);
kernel.portRegistry.provide(EconomyPorts.ItemCatalogue, myItemCatalogue);

kernel.use(econ);
kernel.init(); // ← EconomyPlugin picks up all three adapters here
```

---

## `EconomyPorts.TerrainLock` — `ITerrainLockAdapter`

Bridges quest events into your terrain system. When a quest objective completes
or fails, `QuestEngine` calls `setLocked(terrainId, locked)` to gate player
access (e.g. lock a gulag while a quest is active).

```ts
interface ITerrainLockAdapter {
  setLocked(terrainId: string, locked: boolean): void;
}
```

**Implementation example:**

```ts
// Your terrain system already tracks locked state — just delegate
const terrainLockAdapter: ITerrainLockAdapter = {
  setLocked(terrainId, locked) {
    terrainManager.setAccessible(terrainId, !locked);
  },
};
kernel.portRegistry.provide(EconomyPorts.TerrainLock, terrainLockAdapter);
```

---

## `EconomyPorts.CoLocationSource` — `ICoLocationSource`

Provides the offline trade engine with information about which NPC traders
share the same terrain. Used to determine if two traders can exchange goods
without the player present.

```ts
interface ICoLocationSource {
  /** Build the current terrain co-location map. Called once per trade tick. */
  getCoLocatedTraders(): ICoLocationMap;  // Map<terrainId, npcId[]>

  /** Faction relation in [-100, +100]. */
  getFactionRelation(factionA: string, factionB: string): number;

  /** Personal goodwill from one NPC toward another in [-100, +100]. 0 if none. */
  getPersonalGoodwill(fromId: string, toId: string): number;
}
```

**Implementation example (using `@alife-sdk/simulation`):**

```ts
const coLocationSource: ICoLocationSource = {
  getCoLocatedTraders() {
    // Ask your simulation layer for current NPC terrain assignments
    const map = new Map<string, string[]>();
    for (const npc of simulationPlugin.getAllNPCs()) {
      const tid = npc.currentTerrainId;
      if (tid) {
        const arr = map.get(tid) ?? [];
        arr.push(npc.id);
        map.set(tid, arr);
      }
    }
    return map;
  },
  getFactionRelation: (a, b) => factionPlugin.getRelation(a, b),
  getPersonalGoodwill: (from, to) => relationRegistry.getGoodwill(from, to),
};
kernel.portRegistry.provide(EconomyPorts.CoLocationSource, coLocationSource);
```

---

## `EconomyPorts.ItemCatalogue` — `IItemCatalogue`

Provides base item prices for the offline trade engine. The SDK has no built-in
item database — you plug in your own.

```ts
interface IItemCatalogue {
  /** Returns the base price for itemId, or undefined if not tradeable. */
  getBasePrice(itemId: string): number | undefined;
}
```

**Implementation example:**

```ts
import ITEM_DB from './data/items.json';

const itemCatalogue: IItemCatalogue = {
  getBasePrice: (id) => ITEM_DB[id]?.basePrice,
};
kernel.portRegistry.provide(EconomyPorts.ItemCatalogue, itemCatalogue);
```

---

## Testing without real adapters

In unit tests, use minimal stubs:

```ts
const stubTerrainLock: ITerrainLockAdapter = {
  setLocked: vi.fn(),
};

const stubCatalogue: IItemCatalogue = {
  getBasePrice: (id) => ({ medkit: 500, ammo_9mm: 5 })[id],
};

kernel.portRegistry.provide(EconomyPorts.TerrainLock, stubTerrainLock);
kernel.portRegistry.provide(EconomyPorts.ItemCatalogue, stubCatalogue);
```
