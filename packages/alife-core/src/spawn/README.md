# spawn

Cooldown-based spawn point registry. Tracks which points are ready to spawn,
how many NPCs are currently alive from each point, and resets for surge events.

```ts
import { SpawnRegistry } from '@alife-sdk/core/spawn';
import type { ISpawnPointConfig, ISpawnRegistryState } from '@alife-sdk/core/spawn';
```

> **Most of the time you don't use `SpawnRegistry` directly.**
> It is owned and ticked by `SpawnPlugin`. Access it via:
> ```ts
> const sp = kernel.getPlugin(Plugins.SPAWN);
> sp.spawns.addPoint({ ... });
> ```

---

## Concepts

`SpawnRegistry` is a **pure simulation object** — it never creates game
entities itself. Its only job is to track state and answer one question:

> *"Is this spawn point ready to produce a new NPC right now?"*

A point is **eligible** when both conditions hold:
1. Cooldown has expired (default **30 seconds** after the last spawn)
2. Active NPC count is below `maxNPCs`

The external spawn system (A-Life brain / kernel tick) queries eligible
points, picks one, calls `IEntityFactory.createNPC()`, then calls
`markSpawned()` to start the cooldown.
When an NPC dies, the caller calls `markDespawned()` to free a slot.

```
addPoint()      — register a spawn location
    │
kernel.update() → SpawnPlugin.update(delta) → registry.update(delta)
                                                 ↓ countdown timers
    │
getEligiblePoints()  → pick one
IEntityFactory.createNPC(...)  → entity created in engine
markSpawned(id)  → cooldown starts, active++
    │
NPC dies
markDespawned(id)  → active--
```

---

## Quick start

```ts
import { SpawnRegistry } from '@alife-sdk/core/spawn';

// Standalone (outside kernel)
const spawns = new SpawnRegistry(/* defaultCooldownMs */ 30_000);

spawns.addPoint({
  id:        'sp_cordon_01',
  terrainId: 'cordon_checkpoint',
  position:  { x: 200, y: 300 },
  factionId: 'stalker',
  maxNPCs:   3,
});

// Tick each frame
spawns.update(deltaMs);

// Check what's ready and spawn
for (const point of spawns.getEligiblePoints()) {
  const entityId = factory.createNPC({
    npcTypeId: 'stalker_grunt',
    factionId: point.factionId,
    x: point.position.x,
    y: point.position.y,
    rank: 1,
  });

  spawns.markSpawned(point.id);
  npcRecord.spawnPointId = point.id; // store for markDespawned later
}
```

---

## `ISpawnPointConfig`

```ts
interface ISpawnPointConfig {
  readonly id:        string;  // unique spawn point ID
  readonly terrainId: string;  // owning SmartTerrain ID
  readonly position:  Vec2;    // world coordinates (px)
  readonly factionId: string;  // which faction spawns here
  readonly maxNPCs:   number;  // capacity cap for this point
}
```

---

## API

### `addPoint(config)`

Register a spawn point. Initialises its cooldown to 0 (ready immediately)
and active count to 0.

```ts
spawns.addPoint({
  id: 'sp_bar_south',
  terrainId: 'bar_base',
  position: { x: 800, y: 400 },
  factionId: 'stalker',
  maxNPCs: 4,
});
```

### `removePoint(id)`

Unregister a spawn point and clear its state. Use when a terrain is
permanently destroyed or a quest locks down an area.

### `getPoint(id)`

Returns `ISpawnPointConfig | undefined` — safe lookup by ID.

---

### `getEligiblePoints()`

Returns all spawn points where **cooldown = 0** and **active < maxNPCs**.

```ts
const ready = spawns.getEligiblePoints();
// Filter further if needed:
const stalkerPoints = ready.filter(p => p.factionId === 'stalker');
```

### `getPointsByFaction(factionId)`

Returns all registered points for a faction regardless of eligibility.
Useful for population balance checks.

```ts
const stalkerPoints = spawns.getPointsByFaction('stalker');
console.log(`Stalkers have ${stalkerPoints.length} spawn points`);
```

### `totalPoints`

Total number of registered points (eligible or not).

---

### `markSpawned(spawnPointId)`

Call after successfully creating an NPC from this point.
Starts the cooldown timer and increments the active count.

```ts
const entityId = factory.createNPC({ ... });
spawns.markSpawned(point.id);
```

### `markDespawned(spawnPointId)`

Call when an NPC from this point dies or is removed.
Decrements the active count (floor 0), freeing a slot for the next spawn.

```ts
kernel.events.on(ALifeEvents.NPC_DIED, ({ npcId }) => {
  const spawnPointId = npcRecord.spawnPointId;
  if (spawnPointId) spawns.markDespawned(spawnPointId);
});
```

---

### `update(deltaMs)`

Tick all cooldown timers. Called automatically by `SpawnPlugin` each frame —
you only need this if using `SpawnRegistry` standalone.

```ts
spawns.update(delta); // countdown toward 0
```

---

### `resetAllCooldowns()`

Set every cooldown to 0, making all points immediately eligible.
Used after a psi-surge for a mass respawn wave.

```ts
kernel.events.on(ALifeEvents.SURGE_ENDED, () => {
  spawns.resetAllCooldowns();
});
```

---

## Serialisation

`SpawnRegistry` stores two pieces of mutable state: cooldown timers and
active counts. Both are captured in `ISpawnRegistryState` for save/load.

```ts
interface ISpawnRegistryState {
  readonly cooldowns:     Readonly<Record<string, number>>; // ms remaining per point
  readonly activeCounts:  Readonly<Record<string, number>>; // live NPCs per point
}
```

`SpawnPlugin` handles serialisation automatically via `kernel.serialize()`.
For standalone use:

```ts
// Save
const state = spawns.serialize();

// Load — point configs must be re-registered first
spawns.addPoint(config1);
spawns.addPoint(config2);
spawns.restore(state); // restores cooldowns + active counts
```

> `restore()` only updates points that are already registered — it silently
> ignores IDs not present in the current point list. Always `addPoint()`
> before `restore()`.

---

## Tips

**Store `spawnPointId` on each NPC record.**
`markDespawned()` requires the point ID. The easiest pattern is to store it
alongside the NPC data when the entity is created:

```ts
const entityId = factory.createNPC({ ... });
spawns.markSpawned(point.id);
npcRecord.spawnPointId = point.id; // ← save this
```

**Use `getPointsByFaction()` for population balance.**
Before picking a point to spawn from, check whether the faction already has
enough live NPCs relative to its `spawnRules.targetRatio` in `FactionRegistry`.
Only spawn if the faction is below its target.

**`resetAllCooldowns()` is for surge respawn only.**
Resetting cooldowns mid-session outside of a surge will flood the map with
NPCs instantly. Use it only in response to `SURGE_ENDED`.

**`maxNPCs` is per-point, not per-terrain.**
If a terrain has three spawn points with `maxNPCs: 2` each, it can host
up to 6 live NPCs. Tune `maxNPCs` to match the terrain's job slot capacity.
