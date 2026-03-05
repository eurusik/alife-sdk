# @alife-sdk/hazards

Hazard zones, anomaly damage, and artefact spawning for A-Life simulations.

Depends on @alife-sdk/core

```ts
import { HazardsPlugin, createDefaultHazardsConfig } from '@alife-sdk/hazards/plugin';
import { HazardEvents } from '@alife-sdk/hazards/events';
```

Engine-agnostic. Works with Phaser, PixiJS, Node.js, or any other runtime.
Zero rendering dependencies — all output goes through your event bus and one
factory callback.

```
npm install @alife-sdk/hazards
```

---

## Quick start (7 steps)

```ts
import { ALifeKernel, SeededRandom }                             from '@alife-sdk/core';
import { HazardsPlugin, createDefaultHazardsConfig }             from '@alife-sdk/hazards/plugin';
import { HazardEvents }                                          from '@alife-sdk/hazards/events';

// 1. Create the plugin
const random  = new SeededRandom(42);
const hazards = new HazardsPlugin(random, createDefaultHazardsConfig({
  zones: anomaliesJson,            // IHazardZoneConfig[] loaded from your data file
  artefactFactory: {
    // Only callback you must implement — create a pickup object in your engine
    create(ev) { scene.spawnPickup(ev.x, ev.y, ev.artefactId); },
  },
}));

// 2. Register artefact definitions
hazards.artefacts
  .register({ id: 'soul',     zoneTypes: ['radiation'],        weight: 3 })
  .register({ id: 'fireball', zoneTypes: ['fire'],             weight: 2 })
  .register({ id: 'jellyfish', zoneTypes: ['radiation', 'psi'], weight: 1 });

// 3. Register with kernel
const kernel = new ALifeKernel({ /* … */ });
kernel.use(hazards);

// 4. Subscribe to hazard events
hazards.events.on(HazardEvents.HAZARD_DAMAGE, ({ entityId, damage, zoneType }) => {
  world.getEntity(entityId)?.takeDamage(damage, zoneType);
});
hazards.events.on(HazardEvents.ARTEFACT_COLLECTED, ({ artefactId, collectorId }) => {
  inventory.of(collectorId).addItem(artefactId, 1);
});

// 5. Init (freezes artefact registry)
kernel.init();

// 6. Each frame — tick with live entities
function update(deltaMs: number) {
  kernel.update(deltaMs);
  hazards.manager.tick(deltaMs, world.getLiveEntities());
}

// 7. When a player collects an artefact
hazards.manager.notifyArtefactCollected(zoneId, instanceId, artefactId, player.id);
```

> **Why manual tick?** `HazardsPlugin.update()` is a no-op because only your host code knows how to fetch the live entity list. Call `manager.tick()` each frame right after `kernel.update()`.

---

## Sub-path imports

| Import | What you get |
|--------|-------------|
| `@alife-sdk/hazards/plugin` | `HazardsPlugin`, `HazardsPluginToken`, `createDefaultHazardsConfig` |
| `@alife-sdk/hazards/zone` | `HazardZone`, `IHazardZoneConfig`, `HazardZoneType` |
| `@alife-sdk/hazards/artefact` | `ArtefactRegistry`, `WeightedArtefactSelector`, `IArtefactDefinition` |
| `@alife-sdk/hazards/manager` | `HazardManager`, `IHazardEntity`, `IHazardManagerConfig` |
| `@alife-sdk/hazards/events` | `HazardEvents`, `HazardEventKey`, `HazardEventPayloads` |
| `@alife-sdk/hazards/ports` | `IArtefactFactory`, `IArtefactSpawnEvent` |

---

## Architecture

```
                        ┌─────────────────────────────────────────┐
                        │             HazardsPlugin                │
                        │  artefacts  │  events  │  manager        │
                        └─────────────┼──────────┼─────────────────┘
                                      │          │
              ┌───────────────────────┘          │
              ▼                                  ▼
   ┌──────────────────────┐          ┌─────────────────────────────┐
   │   ArtefactRegistry   │          │       HazardManager         │
   │  register / freeze   │          │  addZone / tick / queries   │
   │  pickForZone()       │          │  SpatialGrid (O(k) lookup)  │
   └──────────┬───────────┘          └──────────┬──────────────────┘
              │                                  │
              ▼                                  ▼
   ┌──────────────────────┐          ┌─────────────────────────────┐
   │  WeightedArtefact    │          │        HazardZone           │
   │    Selector          │          │  advance / isDamageReady    │
   └──────────────────────┘          │  containsPoint / getDmg     │
                                     └─────────────────────────────┘
                      │ spawn event
                      ▼
            ┌──────────────────┐
            │ IArtefactFactory │  ← you implement
            │   create(event)  │
            └──────────────────┘
```

---

## Key concepts

### IHazardEntity

The minimal shape your entity objects must satisfy when passed to `manager.tick()`.
Imported from `@alife-sdk/hazards/manager`.

```ts
interface IHazardEntity {
  readonly id: string;                         // unique entity identifier
  readonly position: Vec2;                     // current world-space position { x, y }
  readonly immunity?: ReadonlyMap<string, number>; // optional per-type resistance (see Immunity system below)
  isAlive?(): boolean;                         // optional — entities returning false are skipped during damage ticks
}
```

Your full entity class does not need to extend this — TypeScript structural typing means any
object with the required fields is accepted.

---

### HazardZone

A circular area defined by centre `(x, y)` and `radius`. Maintains two
independent timers:

- **Damage timer** — fires every `damageTickIntervalMs` (default 500 ms), applies
  `damagePerSecond × interval / 1000` to every entity inside the zone.
- **Artefact timer** — fires every `artefactSpawnCycleMs` (default 60 s), runs
  a lottery (`artefactChance`) to attempt a spawn if `maxArtefacts` not reached.

Additional config options:

- `entityFilter?: (entity: IHazardEntity) => boolean` — per-zone entity predicate; only entities for which this returns `true` receive damage. If omitted, all entities inside the zone are affected.
- `expiresAtMs?: number` — auto-expiration timestamp in accumulated elapsed ms. When the manager's internal elapsed time reaches this value, the zone is removed and `hazard:zone_expired` is emitted. If omitted, the zone lives indefinitely.

Zone type is an **open enum** — use built-ins or add your own:

```ts
type HazardZoneType = 'fire' | 'radiation' | 'chemical' | 'psi' | (string & {});
```

### Spatial queries

`HazardManager` provides two O(k) spatial query methods backed by an internal `SpatialGrid`:

```ts
// Returns the first zone whose circle contains the point, or null if none.
const zone = manager.getZoneAtPoint(npc.x, npc.y);
if (zone) console.log(`NPC is inside zone: ${zone.config.id}`);

// Returns all zones whose circles overlap a search radius around the point.
// Useful for NPC terrain scoring — find nearby hazards before moving.
const nearby = manager.getZonesInRadius(npc.x, npc.y, 150);
for (const z of nearby) {
  ai.avoidPoint(z.config.x, z.config.y, z.config.radius);
}
```

---

### Immunity system

Each entity can carry per-type resistance factors `[0–1]`:

```ts
const immunity = new Map([
  // Resistance fraction [0–1]: damage = rawDamage × (1 - resistance)
  // 1.0 = full immunity — no damage dealt and no hazard:damage event fired.
  ['radiation', 0.5],   // 50% resistance → entity takes rawDamage × 0.5
  ['fire',      1.0],   // fully immune to fire — no damage, no event
]);
```

The resistance key matches the zone's `type` string. No resistance = full damage.

### Artefact spawning

Spawn position is sampled on the **perimeter band** (60–95% of zone radius from
centre) — artefacts appear near the edge, not dead-centre.

`WeightedArtefactSelector` picks by weight. Override with any `IArtefactSelector`
for custom logic (rarest-first, quest-specific pools, etc.).

### Event bus

`HazardsPlugin` owns a **dedicated** `EventBus<HazardEventPayloads>` — separate
from the kernel's core bus. Events are flushed in a single batch after all zones
are processed each tick:

| Event | When |
|-------|------|
| `hazard:damage` | Entity inside zone when damage tick fires |
| `hazard:artefact_spawned` | Artefact spawned successfully |
| `hazard:artefact_collected` | `notifyArtefactCollected()` called |
| `hazard:zone_expired` | Zone auto-removes when elapsed time reaches `expiresAtMs` |

---

## Lifecycle

```
HazardsPlugin constructor
  └─ register artefact definitions (plugin.artefacts)

kernel.use(hazards)          — install(): creates EventBus + HazardManager
  └─ subscribe to plugin.events here

kernel.init()                — init(): freezes artefact registry

game loop:
  hazards.manager.tick(deltaMs, entities)

dynamic zone removal:
  hazards.manager.removeZone(id)   // removes zone immediately; does NOT emit hazard:zone_expired

player collects artefact:
  hazards.manager.notifyArtefactCollected(…)

kernel.destroy()             — cleans up manager + event bus
```

---

## Save/Load

`HazardManager` (and `HazardsPlugin`) expose `serialize()` / `restore()` for save-game integration.

**What is serialized:** timer state (damage timer, artefact timer) and artefact counts for each zone, plus the manager's accumulated `elapsedMs`.

**What is NOT serialized:** zone configs. You must re-add all zones via `addZone()` (or the `zones` constructor option) before calling `restore()`.

```ts
// On save
const snapshot = hazards.serialize();
saveFile.write('hazards', snapshot);

// On load — zones must be re-registered first
const kernel2 = new ALifeKernel({ /* … */ });
kernel2.use(hazards2);   // install() re-creates manager and re-adds config zones
kernel2.init();
hazards2.restore(saveFile.read('hazards'));
```

---

## Tests

58 tests, 0 failures:

```
pnpm --filter @alife-sdk/hazards test
```

Covers: zone timers (advance/consume/carry-over), damage with immunity, artefact
spawn lottery, spatial queries, plugin lifecycle, registry freeze/duplicate guards,
and 4 integration scenarios.

---

## Module map

| Module | README |
|--------|--------|
| `plugin/` | [`plugin/README.md`](src/plugin/README.md) — entry point, kernel integration |
| `manager/` | [`manager/README.md`](src/manager/README.md) — tick, spatial queries, zone lifecycle |
| `zone/` | [`zone/README.md`](src/zone/README.md) — HazardZone timers, config reference |
| `artefact/` | [`artefact/README.md`](src/artefact/README.md) — registry, weighted selection, spawner |
| `events/` | [`events/README.md`](src/events/README.md) — event constants and payload types |
| `ports/` | [`ports/README.md`](src/ports/README.md) — IArtefactFactory (the one callback you implement) |

## See also

- [`@alife-sdk/simulation`](../alife-simulation/README.md) — surge events in simulation trigger hazard zone behaviour
- [`@alife-sdk/economy`](../alife-economy/README.md) — artefacts spawned by hazard zones can be collected and traded
- [`@alife-sdk/persistence`](../alife-persistence/README.md) — hazard zone state and artefact positions are included in save data
