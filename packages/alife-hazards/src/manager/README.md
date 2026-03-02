# manager

Central orchestrator for all hazard zones — damage ticks, artefact spawning,
spatial queries, and event emission.

```ts
import { HazardManager } from '@alife-sdk/hazards/manager';
import type { IHazardEntity, IHazardManagerConfig } from '@alife-sdk/hazards/manager';
```

---

## What's in this module

| Export | Kind | What it does |
|--------|------|-------------|
| `HazardManager` | class | Main simulation manager — tick, query, notify |
| `IHazardEntity` | interface | Shape for entities that can take hazard damage |
| `IHazardManagerConfig` | interface | Constructor config |

---

## Quick start

```ts
import { HazardManager }        from '@alife-sdk/hazards/manager';
import { ArtefactRegistry, WeightedArtefactSelector } from '@alife-sdk/hazards/artefact';
import { EventBus, SeededRandom } from '@alife-sdk/core';
import type { HazardEventPayloads } from '@alife-sdk/hazards/events';

// 1. Build dependencies
const bus      = new EventBus<HazardEventPayloads>();
const random   = new SeededRandom(42);
const registry = new ArtefactRegistry(new WeightedArtefactSelector(random));

registry
  .register({ id: 'soul',     zoneTypes: ['radiation'], weight: 3 })
  .register({ id: 'fireball', zoneTypes: ['fire'],      weight: 2 })
  .freeze();

// 2. Create the manager
const manager = new HazardManager(bus, registry, {
  artefactFactory: {
    // You implement this — create your engine's pickup object
    create(event) { scene.spawnArtefact(event.x, event.y, event.artefactId); },
  },
  random,
});

// 3. Register zones (once at boot or on map load)
manager.addZone({
  id: 'rad_lake', type: 'radiation',
  x: 400, y: 300, radius: 80,
  damagePerSecond: 8,
  damageTickIntervalMs: 500,
  artefactChance: 0.15,
  artefactSpawnCycleMs: 60_000,
  maxArtefacts: 3,
});

// 4. Call tick() every frame (or fixed step)
function update(deltaMs: number) {
  const entities = world.getLiveEntities(); // your IHazardEntity[]
  manager.tick(deltaMs, entities);
}

// 5. When a player picks up an artefact — tell the manager
manager.notifyArtefactCollected(zoneId, instanceId, artefactId, collectorId);
```

> **What `tick()` does** — advances all zone timers, fires damage events for
> entities inside active zones, triggers artefact spawn attempts, then flushes
> all queued events in one batch.

---

## IHazardManagerConfig

```ts
interface IHazardManagerConfig {
  artefactFactory:      IArtefactFactory;  // your engine's pickup creator
  random:               { next(): number }; // deterministic random (e.g. SeededRandom)
  spatialGridCellSize?: number;            // default 200 — tune to your zone sizes
}
```

`spatialGridCellSize` controls the internal `SpatialGrid` bucket size.
A good rule: set it to ~2× the average zone radius.

---

## IHazardEntity

Every entity you pass to `tick()` must implement this interface:

```ts
interface IHazardEntity {
  readonly id:       string;
  readonly position: Vec2;
  readonly immunity?: ReadonlyMap<string, number>;  // resistance per damage type
}
```

### Immunity (resistance)

`immunity` is a map of **damageTypeId → resistance factor [0–1]**:

```ts
// Entity with partial radiation resistance and full fire immunity
const immunity = new Map([
  ['radiation', 0.5],  // takes 50% radiation damage
  ['fire',      1.0],  // immune to fire
]);
const entity: IHazardEntity = { id: 'armored_stalker', position, immunity };
```

`damageTypeId` matches the zone's `type` string. When absent, resistance is `0`
(full damage).

---

## Managing zones

### `addZone(config)`

Register a new hazard zone. Returns the created `HazardZone` instance.
Throws if a zone with the same `id` is already registered:

```ts
const zone = manager.addZone({
  id: 'fire_pit', type: 'fire',
  x: 200, y: 150, radius: 60,
  damagePerSecond: 15,
  damageTickIntervalMs: 1000,
  artefactChance: 0.2,
  artefactSpawnCycleMs: 120_000,
  maxArtefacts: 2,
});
```

See [`zone/README.md`](../zone/README.md) for `IHazardZoneConfig` fields.

### `removeZone(id)`

Unregisters a zone and removes it from the spatial grid. Safe to call with an
unknown id (no-op):

```ts
manager.removeZone('fire_pit');
```

---

## tick(deltaMs, entities)

The main update method — call it once per frame or fixed step:

```ts
manager.tick(16, entities);
```

**What happens inside:**

```
For each zone:
  ├─ zone.advance(deltaMs)            — advance internal timers
  │
  ├─ While damage tick ready:
  │    zone.consumeDamageTick()
  │    For each entity inside zone:
  │      damage = rawDamage × (1 − resistance)
  │      if damage > 0 → queue hazard:damage event
  │
  └─ While artefact spawn cycle ready:
       zone.consumeArtefactCycle()
       if not at capacity:
         spawner.trySpawn(zone) → maybe queue hazard:artefact_spawned event

Flush all queued events  ← single batch after all zones
```

**Large deltaMs handling** — if `deltaMs` covers multiple tick intervals, all
ticks fire in the same frame. Example: `deltaMs=1200`, `damageTickIntervalMs=500`
→ damage fires twice (at 500ms and 1000ms), 200ms carry-over into next frame.

---

## Spatial queries

### `getZoneAtPoint(x, y)`

Returns the first zone whose radius contains the point, or `null` if outside all zones:

```ts
const zone = manager.getZoneAtPoint(player.x, player.y);
if (zone) {
  console.log(`Player is inside ${zone.config.type} anomaly`);
}
```

### `getZonesInRadius(x, y, radius)`

Returns all zones within `radius` distance of a point (includes zones whose area
overlaps the query radius — not just zones whose centre is within it):

```ts
// NPC terrain scoring — penalise terrains near hazard zones
const nearbyZones = manager.getZonesInRadius(npc.x, npc.y, 150);
for (const zone of nearbyZones) {
  score -= zone.config.damagePerSecond * 2;
}
```

Both queries use the internal `SpatialGrid` — O(k) per query, not O(n zones).

### Reading zone state directly

```ts
manager.getZone('rad_lake');   // → HazardZone | undefined
manager.getAllZones();          // → readonly HazardZone[]
manager.size;                  // → number of registered zones
```

---

## Artefact lifecycle

### Spawn (automatic)

`tick()` calls `ArtefactSpawner.trySpawn()` on each artefact cycle. On success:
1. `zone.notifyArtefactAdded()` increments the zone's artefact counter
2. `hazard:artefact_spawned` is emitted with position + artefact id
3. Your `IArtefactFactory.create()` is called — you create the game object

### Collect (manual notification)

When a player or NPC picks up an artefact, notify the manager so it can
decrement the zone counter and emit the event:

```ts
// In your pickup handler:
manager.notifyArtefactCollected(
  'rad_lake',          // zoneId
  pickup.instanceId,   // unique id of this pickup instance in the world
  pickup.artefactId,   // artefact definition id
  player.id,           // who collected it
);
// Emits hazard:artefact_collected and decrements zone.artefactCount
```

---

## Cleanup

Call `destroy()` when the map is unloaded — clears all zones, the spatial grid,
and tears down the event bus:

```ts
manager.destroy();
```

---

## Testing tips

No Phaser or engine needed — the manager is pure logic:

```ts
import { HazardManager } from '@alife-sdk/hazards/manager';
import { ArtefactRegistry, WeightedArtefactSelector } from '@alife-sdk/hazards/artefact';
import { EventBus } from '@alife-sdk/core';
import { HazardEvents } from '@alife-sdk/hazards/events';

const bus      = new EventBus<HazardEventPayloads>();
const random   = { next: () => 0 };
const registry = new ArtefactRegistry(new WeightedArtefactSelector(random));

const manager  = new HazardManager(bus, registry, {
  artefactFactory: { create: vi.fn() },
  random,
});

manager.addZone({
  id: 'test_zone', type: 'radiation',
  x: 0, y: 0, radius: 50,
  damagePerSecond: 10, damageTickIntervalMs: 500,
  artefactChance: 0, artefactSpawnCycleMs: 999_999, maxArtefacts: 0,
});

const received: number[] = [];
bus.on(HazardEvents.HAZARD_DAMAGE, (p) => received.push(p.damage));

manager.tick(500, [{ id: 'e1', position: { x: 0, y: 0 } }]);

expect(received).toHaveLength(1);  // one damage tick
expect(received[0]).toBe(5);       // 10 dps × 500ms / 1000
```
