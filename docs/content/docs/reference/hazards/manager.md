# Hazard Manager

Use this page when you need to wire the actual hazard runtime into your update loop.

`HazardManager` is the central runtime orchestrator for zones, damage ticks, artefact spawns, spatial queries, and hazard events.

## Import path

```ts
import { HazardManager } from "@alife-sdk/hazards/manager";
import type { IHazardEntity, IHazardManagerConfig } from "@alife-sdk/hazards/manager";
```

## What you create

In a normal hazards integration you create:

1. one `HazardManager`
2. one artefact registry and selector
3. one host-side artefact factory
4. one live entity list per update
5. one manual call to `manager.tick(deltaMs, entities)`

## Minimal working example

```ts
const manager = new HazardManager(bus, registry, {
  artefactFactory: {
    create(event) {
      world.spawnArtefact(event.artefactId, event.x, event.y);
    },
  },
  random,
});

manager.addZone({
  id: "rad_lake",
  type: "radiation",
  x: 400,
  y: 300,
  radius: 80,
  damagePerSecond: 8,
  damageTickIntervalMs: 500,
  artefactChance: 0.15,
  artefactSpawnCycleMs: 60_000,
  maxArtefacts: 3,
});

function update(deltaMs: number) {
  manager.tick(deltaMs, world.getLiveEntities());
}
```

## Important ownership rule

`HazardsPlugin.update()` is not the full runtime loop.

Your host code must call `manager.tick(...)` because only your game can answer:

- which entities are live
- where they are
- which map/scene state is currently loaded

## `IHazardEntity` contract

Every entity you pass into `tick()` must expose:

```ts
interface IHazardEntity {
  readonly id: string;
  readonly position: Vec2;
  readonly immunity?: ReadonlyMap<string, number>;
}
```

That is intentionally narrow:

- stable ID
- world position
- optional resistance map

## What `tick()` actually does

At a high level:

1. advance all zone timers
2. process any ready damage ticks
3. calculate resistance-adjusted damage
4. process any ready artefact spawn cycles
5. batch and flush hazard events

This means a hazard scene can keep updating even if no rendering code knows anything about anomaly logic.

## Large delta rule

If one frame spans multiple intervals, the manager processes all missed ticks in that frame with carry-over preserved.

That matters for determinism and for scenes that do not run at a perfect fixed timestep.

## Events you will care about

The manager is most useful when something is listening to:

- hazard damage
- artefact spawned
- artefact collected
- zone expired

Those events are the clean bridge into:

- damage feedback
- pickup creation
- HUD updates
- cleanup of temporary anomalies

## Artefact collection rule

Spawning is automatic through the manager.

Collection is not.

When a pickup is collected, your game must notify the manager so it can:

- decrement zone artefact count
- emit the collected event
- keep zone capacity coherent

## Failure patterns

- forgetting to call `tick()`
- passing stale or incomplete live entity lists
- creating visual pickups on spawn but never notifying collection back to the manager
- mixing rendering logic into the manager integration instead of keeping it in event reactions
- assuming one huge `deltaMs` should behave like one tiny tick

## Related pages

- [Hazards package](/docs/packages/hazards)
- [Hazard Zones](/docs/reference/hazards/zones)
- [Artefacts](/docs/reference/hazards/artefacts)
