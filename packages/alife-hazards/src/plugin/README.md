# plugin

`HazardsPlugin` — the entry point for the hazard system. Wraps `HazardManager`,
owns a typed event bus, and integrates with `ALifeKernel` as an optional plugin.

```ts
import { HazardsPlugin, HazardsPluginToken, createDefaultHazardsConfig } from '@alife-sdk/hazards/plugin';
import type { IHazardsPluginConfig } from '@alife-sdk/hazards/plugin';
```

---

## What's in this module

| Export | Kind | What it does |
|--------|------|-------------|
| `HazardsPlugin` | class | Plugin that owns HazardManager + event bus |
| `HazardsPluginToken` | token | Lookup key for `kernel.get()` |
| `IHazardsPluginConfig` | interface | Constructor config |
| `createDefaultHazardsConfig` | function | Config factory with sensible defaults |

---

## Quick start — with ALifeKernel

```ts
import { ALifeKernel, SeededRandom } from '@alife-sdk/core';
import { HazardsPlugin, HazardsPluginToken } from '@alife-sdk/hazards/plugin';
import { HazardEvents } from '@alife-sdk/hazards/events';

const kernel  = new ALifeKernel({ /* … */ });
const random  = new SeededRandom(42);

// 1. Create the plugin
const hazards = new HazardsPlugin(random, {
  zones: anomaliesJson,         // IHazardZoneConfig[] — pre-register from data file
  artefactFactory: {
    create(ev) { scene.spawnPickup(ev.x, ev.y, ev.artefactId); },
  },
});

// 2. Register artefact definitions — BEFORE kernel.use()
hazards.artefacts
  .register({ id: 'soul',     zoneTypes: ['radiation'], weight: 3 })
  .register({ id: 'fireball', zoneTypes: ['fire'],      weight: 2 });

// 3. Register with kernel — creates EventBus + HazardManager + adds zones
kernel.use(hazards);

// 4. Subscribe to events — after kernel.use(), before kernel.init()
hazards.events.on(HazardEvents.HAZARD_DAMAGE, ({ entityId, damage, zoneType }) => {
  entityRegistry.get(entityId)?.takeDamage(damage, zoneType);
});

hazards.events.on(HazardEvents.ARTEFACT_COLLECTED, ({ artefactId, collectorId }) => {
  inventory.of(collectorId).addItem(artefactId, 1);
});

// 5. Init — freezes artefact registry (no more register() after this)
kernel.init();

// 6. Each frame — call manager.tick() manually (update() is a no-op)
function gameLoop(deltaMs: number) {
  kernel.update(deltaMs);
  hazards.manager.tick(deltaMs, world.getLiveEntities());
}

// 7. Retrieve via token anywhere in your code
const hazardPlugin = kernel.get(HazardsPluginToken);
```

> **`plugin.events`** and **`plugin.manager`** are available only after
> `kernel.use(plugin)`. Accessing them before that throws.

---

## IHazardsPluginConfig

```ts
interface IHazardsPluginConfig {
  artefactFactory:      IArtefactFactory;         // required — creates engine objects on spawn
  zones?:               ReadonlyArray<IHazardZoneConfig>; // pre-register from data file
  artefactSelector?:    IArtefactSelector;        // default: WeightedArtefactSelector
  spatialGridCellSize?: number;                   // default: 200 px
}
```

| Field | Required | Default | Notes |
|-------|----------|---------|-------|
| `artefactFactory` | **yes** | — | Your pickup creator; called on each spawn |
| `zones` | no | `[]` | Load from JSON; can also add zones later via `manager.addZone()` |
| `artefactSelector` | no | `WeightedArtefactSelector` | Custom strategy — implement `IArtefactSelector` |
| `spatialGridCellSize` | no | `200` | Tune to ~2× average zone radius |

### `createDefaultHazardsConfig`

Helper that fills in all optional fields — `artefactFactory` is the only
required value:

```ts
import { createDefaultHazardsConfig } from '@alife-sdk/hazards/plugin';

const config = createDefaultHazardsConfig({
  artefactFactory: { create(ev) { scene.spawnPickup(ev); } },
  zones: anomaliesJson,
});

const hazards = new HazardsPlugin(random, config);
```

---

## What the plugin owns

| Property | Type | Available after |
|----------|------|----------------|
| `plugin.artefacts` | `ArtefactRegistry` | Constructor |
| `plugin.events` | `EventBus<HazardEventPayloads>` | `kernel.use(plugin)` |
| `plugin.manager` | `HazardManager` | `kernel.use(plugin)` |

### `plugin.artefacts`

Direct access to the `ArtefactRegistry`. Register all definitions before
`kernel.init()` — `init()` calls `artefacts.freeze()`:

```ts
// Chain registrations before kernel.use() or kernel.init()
hazards.artefacts
  .register({ id: 'soul',      zoneTypes: ['radiation'],        weight: 3 })
  .register({ id: 'jellyfish', zoneTypes: ['radiation', 'psi'], weight: 1 })
  .register({ id: 'fireball',  zoneTypes: ['fire'],             weight: 2 });

kernel.use(hazards);
kernel.init(); // ← artefacts.freeze() is called here
```

### `plugin.events`

Typed `EventBus<HazardEventPayloads>` — separate from the kernel's core bus.
Subscribe after `kernel.use()` and before `kernel.init()`:

```ts
kernel.use(hazards);

// subscribe before init to avoid missing early events
hazards.events.on(HazardEvents.HAZARD_DAMAGE,      onDamage);
hazards.events.on(HazardEvents.ARTEFACT_SPAWNED,   onSpawn);
hazards.events.on(HazardEvents.ARTEFACT_COLLECTED, onCollect);

kernel.init();
```

### `plugin.manager`

Direct access to `HazardManager` for zone management and queries:

```ts
// Add a zone at runtime (e.g. quest-triggered)
hazards.manager.addZone({ id: 'psi_storm', type: 'psi', x: 600, y: 400, … });

// Spatial query for NPC scoring
const nearby = hazards.manager.getZonesInRadius(npc.x, npc.y, 200);

// Player collects an artefact
hazards.manager.notifyArtefactCollected(zoneId, instanceId, artefactId, player.id);
```

---

## Lifecycle

```
new HazardsPlugin(random, config)
  │  artefacts registry is ready — register definitions here
  │
  ▼
kernel.use(hazards)          ← install() called internally
  │  EventBus created
  │  HazardManager created
  │  zones from config.zones registered in manager
  │  plugin.events and plugin.manager now accessible
  │
  ├─ subscribe to hazards.events here
  │
  ▼
kernel.init()                ← init() called internally
  │  artefacts.freeze() — no more register() allowed
  │
  ▼
game loop:
  kernel.update(deltaMs)     ← update() is a no-op in HazardsPlugin
  hazards.manager.tick(deltaMs, entities)   ← call this manually
  │
  ▼
kernel.destroy() / hazards.destroy()
  │  HazardManager.destroy()
  │  EventBus.destroy()
```

### Why is `update()` a no-op?

`HazardManager.tick()` requires the live entity list from your world. The SDK
cannot know how to get that list — your host code does. Call `manager.tick()`
manually each frame, right after `kernel.update()`.

---

## HazardsPluginToken

A typed lookup token — retrieve the plugin anywhere that has kernel access:

```ts
import { HazardsPluginToken } from '@alife-sdk/hazards/plugin';

// In any system that holds a kernel reference:
const hazards = kernel.get(HazardsPluginToken);
hazards.manager.getZoneAtPoint(x, y);
```

---

## Standalone (without kernel)

If you don't use `ALifeKernel`, use `HazardManager` directly — the plugin is
just a thin wrapper:

```ts
import { HazardManager } from '@alife-sdk/hazards/manager';

const manager = new HazardManager(bus, registry, { artefactFactory, random });
manager.addZone(config);
manager.tick(deltaMs, entities);
```

See [`manager/README.md`](../manager/README.md).

---

## Testing tips

```ts
import { HazardsPlugin } from '@alife-sdk/hazards/plugin';
import { HazardEvents }  from '@alife-sdk/hazards/events';

const random  = { next: () => 0 };
const factory = { create: vi.fn() };
const plugin  = new HazardsPlugin(random, { artefactFactory: factory });

// install() replaces kernel.use() in tests
plugin.install({} as ALifeKernel);
plugin.init();

const received: unknown[] = [];
plugin.events.on(HazardEvents.HAZARD_DAMAGE, (p) => received.push(p));

plugin.manager.addZone({
  id: 'test', type: 'fire', x: 0, y: 0, radius: 50,
  damagePerSecond: 10, damageTickIntervalMs: 500,
  artefactChance: 0, artefactSpawnCycleMs: 999_999, maxArtefacts: 0,
});

plugin.manager.tick(500, [{ id: 'e1', position: { x: 0, y: 0 } }]);

expect(received).toHaveLength(1);
```
