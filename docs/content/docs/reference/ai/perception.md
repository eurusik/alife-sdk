# AI Perception

Use this page when you need to answer what an NPC can detect right now.

Perception is not memory and not decision-making. It is the input layer that turns positions, facing, hostility, and sound into detection facts.

## Import path

```ts
import {
  isInFOV,
  scanForEnemies,
  filterVisibleEntities,
  filterHearingEntities,
  filterHostileEntities,
  filterFriendlyEntities,
  distanceSq,
  findClosest,
  NPCSensors,
  filterFreshIntel,
} from "@alife-sdk/ai/perception";
```

## Two ways to use the module

| Layer | Use it when |
|---|---|
| `PerceptionQuery` functions | one NPC or custom point queries |
| `NPCSensors` | a scene with many online observers |

That split is the main architectural choice in this module.

## Minimal setup

```ts
const grid = new SpatialGrid<{ id: string; position: Vec2 }>(
  200,
  (item) => item.position,
);

const sensors = new NPCSensors({
  spatialGrid: grid,
  isHostile: (a, b) => factions.areHostile(a, b),
});

for (const npc of onlineNPCs) {
  grid.update({ id: npc.id, position: npc.position });
}

const visionEvents = sensors.detectVision(onlineNPCs);
const soundEvents = sensors.detectSound(
  { x: shot.x, y: shot.y },
  600,
  shot.shooterId,
  shot.factionId,
  onlineNPCs,
);
```

## Minimal one-NPC query

```ts
const visibleEnemies = scanForEnemies(
  { x: npc.x, y: npc.y },
  npc.facingAngle,
  allCandidates,
  npc.factionId,
  isHostile,
  aiConfig.perception,
);

const nearestEnemy = findClosest({ x: npc.x, y: npc.y }, visibleEnemies);
```

## Key types

There are two entity shapes depending on the usage level:

| Type | Used by |
|---|---|
| `IPerceivedEntity` | pure query helpers |
| `IPerceptibleEntity` | `NPCSensors` |

The practical difference is:

- low-level queries need candidate identity, faction, alive state, and position
- `NPCSensors` also needs per-observer sensor parameters like facing angle, vision range, and hearing range

## Detection pipeline

With `NPCSensors`, the usual runtime flow is:

1. keep the spatial grid synchronized with live positions
2. run vision detection for online observers
3. run sound detection on notable events like shots or explosions
4. feed resulting intel into memory, targeting, or state transitions

This is why stale spatial data usually looks like broken AI even when the state machine is fine.

## Important tuning knobs

The highest-impact parameters are:

- `visionRange`
- `visionHalfAngle`
- `hearingRange`
- `weaponSoundRange`
- spatial grid cell size
- optional line-of-sight policy

Bad tuning here often masquerades as “combat AI is dumb” when the real issue is bad perception input.

## Practical usage rule

Keep the layers separate:

- perception answers what is detectable now
- memory answers what the NPC still believes
- state logic decides what to do with that information

If those layers collapse into one, debugging AI becomes much harder.

## Failure patterns

- stale positions in the spatial grid
- giant ranges or cell sizes that make everything effectively visible
- skipping line-of-sight checks in maps where walls matter
- using perception results as if they were already persistent memory
- querying many observers from ad hoc scene scans instead of using a spatial structure

## Related pages

- [AI package](/docs/packages/ai)
- [AI States and Driver](/docs/reference/ai/states)
- [AI Cover](/docs/reference/ai/cover)
