# terrain

Named world areas with capacity, faction rules, job slots, and NPC fitness scoring.

```ts
import { Zone, SmartTerrain, TerrainBuilder } from '@alife-sdk/core/terrain';
import type {
  IZoneBounds, ISmartTerrainConfig, IScoringConfig,
  IJobSlot, IJobPreconditions, ISpawnPoint, IPatrolRouteConfig,
} from '@alife-sdk/core/terrain';
```

---

## Concepts

The terrain module has two classes with a clear hierarchy:

```
Zone              — named rectangle in the world + dangerLevel
  └── SmartTerrain — Zone + capacity + faction rules + jobs + fitness scoring
```

**`Zone`** is a lightweight spatial primitive — just bounds, an ID, and a
danger level. Used as-is for anomaly zones, restricted areas, or any named
region.

**`SmartTerrain`** is where NPCs live and work. The A-Life brain evaluates
all available terrains and picks the one with the best `scoreFitness()` for
each NPC.

**`TerrainBuilder`** is a fluent builder that validates required fields and
constructs an `ISmartTerrainConfig` for passing to `new SmartTerrain(config)`.

---

## Quick start

```ts
import { TerrainBuilder, SmartTerrain } from '@alife-sdk/core/terrain';

const config = new TerrainBuilder('bar_rostok')
  .name('Bar "Rostok"')
  .bounds({ x: 500, y: 200, width: 400, height: 300 })
  .capacity(8)
  .dangerLevel(2)
  .allowFactions(['stalker', 'duty'])
  .shelter(true)
  .tags(['indoor', 'settlement'])
  .addJob({ type: 'guard',  slots: 2, position: { x: 520, y: 220 } })
  .addJob({ type: 'patrol', slots: 3, routeId: 'route_bar_perimeter' })
  .addSpawnPoint({ x: 540, y: 260, factionId: 'stalker' })
  .addPatrolRoute({
    id: 'route_bar_perimeter',
    routeType: 'loop',
    waypoints: [{ x: 510, y: 210 }, { x: 880, y: 210 }, { x: 880, y: 490 }, { x: 510, y: 490 }],
  })
  .build();

const terrain = new SmartTerrain(config);
```

---

## `Zone`

Base class for any named world area.

```ts
const zone = new Zone(
  'danger_zone_01',                            // id
  { x: 100, y: 100, width: 200, height: 200 }, // bounds
  3,                                            // dangerLevel (default 0)
  { label: 'Radioactive ruin' },               // optional metadata
);
```

### `IZoneBounds`

```ts
interface IZoneBounds {
  readonly x:      number; // top-left X (px)
  readonly y:      number; // top-left Y (px)
  readonly width:  number; // px
  readonly height: number; // px
}
```

### API

| Member | Description |
|--------|-------------|
| `zone.id` | Unique string identifier |
| `zone.bounds` | `IZoneBounds` — top-left + dimensions |
| `zone.center` | `Vec2` — geometric centre, cached and frozen |
| `zone.dangerLevel` | Threat rating (0 = safe, higher = more dangerous) |
| `zone.metadata` | `ReadonlyMap<string, unknown>` — optional key-value store |
| `zone.contains(point)` | `true` if point is inside the rectangular bounds |

---

## `SmartTerrain`

Extends `Zone` with everything the A-Life brain needs to assign NPCs:
capacity, faction whitelist, job slots, spawn points, patrol routes, and
a configurable fitness scorer.

### `ISmartTerrainConfig`

```ts
interface ISmartTerrainConfig {
  readonly id:              string;
  readonly name:            string;
  readonly bounds:          IZoneBounds;
  readonly capacity:        number;             // max simultaneous occupants
  readonly dangerLevel?:    number;             // default 0
  readonly allowedFactions?: readonly string[]; // empty = all factions allowed
  readonly isShelter?:      boolean;            // surge shelter → +50 fitness bonus
  readonly tags?:           readonly string[];  // e.g. ['indoor', 'outdoor', 'settlement']
  readonly jobs?:           readonly IJobSlot[];
  readonly spawnPoints?:    readonly ISpawnPoint[];
  readonly patrolRoutes?:   readonly IPatrolRouteConfig[];
  readonly scoring?:        IScoringConfig;
  readonly random?:         IRandom;            // injectable RNG for jitter
}
```

---

### Occupant management

NPCs are tracked by their string ID. The terrain enforces `capacity`.

```ts
// Assign NPC to terrain
if (terrain.hasCapacity) {
  const ok = terrain.addOccupant('npc_stalker_42');
  // ok === false if capacity was reached between the check and the add
}

// Release on death or reassignment
terrain.removeOccupant('npc_stalker_42');

// Inspect
terrain.occupantCount;           // number of current occupants
terrain.hasCapacity;             // occupantCount < capacity
terrain.hasOccupant('npc_id');   // boolean
terrain.getOccupants();          // ReadonlySet<string>
```

---

### `scoreFitness(npcFaction, npcPosition, npcRank)`

Returns a numeric fitness score. The A-Life brain picks the terrain with the
highest score across all available terrains.

```
score = (capacity − occupantCount)
      − distance(npcPosition, terrain.center) / 100
      + 50   if isShelter
      + 10   if npcRank >= dangerLevel
      ± jitter   if scoringJitter > 0
      = −Infinity   if faction not allowed
```

```ts
let best: SmartTerrain | null = null;
let bestScore = -Infinity;

for (const terrain of allTerrains) {
  const score = terrain.scoreFitness(npc.faction, npc.position, npc.rank);
  if (score > bestScore) {
    bestScore = score;
    best = terrain;
  }
}
```

### `acceptsFaction(factionId)`

`true` if the terrain's `allowedFactions` set is empty (all factions welcome)
or explicitly contains `factionId`.

---

### `IScoringConfig` — tuning fitness weights

```ts
interface IScoringConfig {
  distancePenaltyDivisor?:   number;  // default 100 — higher = less distance penalty
  shelterBonus?:             number;  // default 50
  rankMatchBonus?:           number;  // default 10
  scoringJitter?:            number;  // default 0 — ± random noise for organic distribution
  useSquaredDistance?:       boolean; // skip Math.sqrt for large NPC counts
  distancePenaltySqDivisor?: number;  // used when useSquaredDistance = true
}
```

```ts
// Perf-sensitive game with 500+ NPCs — skip Math.sqrt
const config = new TerrainBuilder('big_map_base')
  .scoring({ useSquaredDistance: true })
  // ...
  .build();

// Add randomness so NPCs don't all pile into the same terrain
const config = new TerrainBuilder('bar')
  .scoring({ scoringJitter: 5 })
  .build();
```

---

### Job slots — `IJobSlot`

Jobs define what NPCs assigned to this terrain actually do.

```ts
interface IJobSlot {
  readonly type:          string;          // e.g. 'guard', 'patrol', 'camp', 'sleep'
  readonly slots:         number;          // how many NPCs can hold this job simultaneously
  readonly position?:     Vec2;            // fixed world position (stationary jobs)
  readonly routeId?:      string;          // patrol route ID (moving jobs)
  readonly preconditions?: IJobPreconditions;
}

interface IJobPreconditions {
  readonly minRank?:   number;           // NPC rank >= minRank to qualify
  readonly dayOnly?:   boolean;          // only during daytime
  readonly nightOnly?: boolean;          // only during nighttime
  readonly factions?:  readonly string[]; // faction whitelist for this job
}
```

```ts
.addJob({ type: 'guard',  slots: 2, position: { x: 520, y: 220 },
          preconditions: { minRank: 2 } })
.addJob({ type: 'patrol', slots: 3, routeId: 'perimeter_route',
          preconditions: { factions: ['duty'] } })
.addJob({ type: 'sleep',  slots: 4,
          preconditions: { nightOnly: true } })
```

Access jobs at runtime:
```ts
for (const job of terrain.jobs) {
  console.log(`${job.type} × ${job.slots}`);
}
```

---

### Patrol routes — `IPatrolRouteConfig`

Patrol routes referenced by job slots live on the terrain config and are
accessible by ID at runtime.

```ts
interface IPatrolRouteConfig {
  readonly id:        string;
  readonly routeType: 'loop' | 'ping_pong' | 'one_way';
  readonly waypoints: readonly Vec2[];
}
```

```ts
const route = terrain.patrolRoutes.get('perimeter_route');
// → IPatrolRouteConfig | undefined
```

---

### Spawn points — `ISpawnPoint`

Faction-tagged world positions where new NPCs appear.

```ts
interface ISpawnPoint {
  readonly x:        number;
  readonly y:        number;
  readonly factionId: string;
}
```

```ts
for (const sp of terrain.spawnPoints) {
  if (sp.factionId === 'stalker') {
    factory.createNPC({ x: sp.x, y: sp.y, ... });
  }
}
```

---

## `TerrainBuilder`

Fluent builder with validation on `build()`.

```ts
new TerrainBuilder(id)
  .name(string)
  .bounds(IZoneBounds)           // required
  .capacity(number)              // required, > 0
  .dangerLevel(number)           // default 0
  .allowFactions(string[])       // empty = all factions
  .shelter(boolean)              // default false
  .tags(string[])
  .addJob(IJobSlot)              // chainable, can call multiple times
  .addSpawnPoint(ISpawnPoint)    // chainable
  .addPatrolRoute(IPatrolRouteConfig) // chainable
  .build()                       // → ISmartTerrainConfig, throws if invalid
```

`build()` throws if any of these are missing or invalid:
- `name` — non-empty string
- `bounds` — must be set
- `capacity` — must be > 0

---

## Loading terrains from JSON

The typical workflow loads terrain configs from `IDataLoader.loadTerrains()`
and passes them directly to `new SmartTerrain()`:

```ts
const terrainData = await dataLoader.loadTerrains();
// terrainData: Record<string, ISmartTerrainConfig>

const terrains = new Map<string, SmartTerrain>();
for (const [id, config] of Object.entries(terrainData)) {
  terrains.set(id, new SmartTerrain(config));
}
```

Or use `TerrainBuilder` when constructing terrains programmatically
(procedural maps, test fixtures, level editors):

```ts
const terrain = new SmartTerrain(
  new TerrainBuilder('test_base')
    .name('Test Base')
    .bounds({ x: 0, y: 0, width: 500, height: 500 })
    .capacity(5)
    .build()
);
```

---

## Tips

**`allowedFactions` empty = unrestricted.**
Omitting `allowedFactions` (or passing an empty array) means any faction can
use the terrain. Explicitly list factions only when you need to restrict access
(e.g. a military-only checkpoint, a monster lair).

**`isShelter` flips NPC behaviour during surges.**
NPCs with a flee-during-surge goal will score shelter terrains dramatically
higher (+50 by default). Mark underground bunkers, buildings, and tunnels as
shelters.

**Use `tags` for brain filtering.**
The NPC brain can filter candidate terrains by tag before scoring. Tag terrains
as `'outdoor'`, `'indoor'`, `'settlement'`, `'dangerous'` so different NPC
archetypes prefer appropriate locations.

**`scoringJitter` prevents clustering.**
Without jitter, every NPC of the same rank and faction will pick the same
terrain. A small jitter (5–15) spreads them organically across nearby options
without breaking the rank/shelter priority.

**`useSquaredDistance` for large worlds.**
For 200+ NPCs evaluating 30+ terrains each tick, skipping `Math.sqrt` can
save measurable CPU. The quadratic penalty curve slightly over-favours nearby
terrains — tune `distancePenaltySqDivisor` to compensate if needed.
