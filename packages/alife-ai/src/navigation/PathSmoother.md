# PathSmoother

Pure functions for converting sparse waypoints into smooth, dense paths.
No side effects — same inputs always produce the same output.

```ts
import { smoothPath, smoothPathWithTurning } from '@alife-sdk/ai/navigation';
import type { INavigationConfig } from '@alife-sdk/ai/types';
```

---

## `smoothPath(waypoints, config, random, cache?): readonly Vec2[]`

Convert sparse waypoints into a dense smooth path using Catmull-Rom spline
interpolation.

```ts
const densePoints = smoothPath(waypoints, config.navigation, myRandom, cache);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `waypoints` | `readonly Vec2[]` | Sparse control points. Minimum 1. |
| `config` | `INavigationConfig` | Navigation tuning. |
| `random` | `IRandom` | Seeded random source for deterministic jitter. |
| `cache` | `Map<string, readonly Vec2[]>` _(optional)_ | Shared cache — reuse for multiple NPCs on the same route. |

**Returns:** Dense `Vec2[]` including exact start and end points.

- Returns `[]` for empty input.
- Returns `[waypoints[0]]` for a single-point input (no smoothing needed).

### What it does

1. **Pads** the waypoint list to the minimum 4 control points required by
   Catmull-Rom (by duplicating endpoints).
2. **Interpolates** `smoothPointsPerSegment` points per segment along the spline.
3. **Applies jitter** to interior points only — start and end are exact.
   Jitter amount: `±smoothRandomOffset` px per axis.
4. **Caches** the result keyed by waypoint coordinates (rounded to 1 decimal
   to absorb floating-point noise). Cache evicts oldest entry when size
   exceeds 64 entries (FIFO).

### Config fields used

| Field | Default | Effect |
|-------|---------|--------|
| `smoothPointsPerSegment` | `8` | Dense point count per segment. Higher = smoother but more memory. |
| `smoothRandomOffset` | `10` px | Max per-axis jitter on interior points. Set `0` for zero jitter. |

### Caching

The cache is external — you own it, which means you control its lifetime:

```ts
// One cache shared by all NPCs using the same patrol routes:
const sharedCache = new Map<string, readonly Vec2[]>();

const path1 = smoothPath(route1, config, rng, sharedCache);
const path2 = smoothPath(route1, config, rng, sharedCache); // cache hit — same object
const path3 = smoothPath(route2, config, rng, sharedCache); // cache miss — new path

// Invalidate when map changes:
sharedCache.clear();
```

If you pass no cache, every call allocates a new path array.

> **Jitter and caching:** The jitter is baked into the cached result. Two NPCs
> using the same route with the same shared cache will follow exactly the same
> dense path (same object). The `random` source is NOT part of the cache key —
> if you call `smoothPath` with different `random` instances on the same waypoints,
> the cached result from the first call is still returned.
> If you need different jitter per NPC on the same route, use separate cache
> instances (or omit the cache entirely).

---

## `smoothPathWithTurning(waypoints, config, random, cache?): readonly Vec2[]`

Enhance a smooth path with Dubins-style circular arc insertions at sharp turns.

```ts
const path = smoothPathWithTurning(waypoints, config.navigation, myRandom, cache);
```

Parameters are identical to `smoothPath`.

### What it does

1. Calls `smoothPath(...)` first to get the base dense path (benefits from cache).
2. Scans every interior point for a turn angle exceeding `dubinsMaxInstantTurn`.
3. At each sharp turn, replaces the vertex with **6 arc subdivision points**
   computed from a circular arc of radius `dubinsTurningRadius`.
4. Start and end points are always preserved exactly.

> **Caching note:** The cache applies only to the inner `smoothPath()` step. The
> arc insertion pass runs on every call and produces a new array. If you need to
> cache the final arc-enhanced path, manage that externally (e.g. store the result
> after the first call per route and reuse it).

### Config fields used

| Field | Default | Effect |
|-------|---------|--------|
| `dubinsMaxInstantTurn` | `π/4` (45°) | Turns beyond this angle get arc treatment. |
| `dubinsTurningRadius` | `60` px | Arc radius at each turn. |

### When to use which

| Scenario | Function |
|----------|----------|
| Straight corridors, patrol routes | `smoothPath` |
| Open terrain with sharp direction changes | `smoothPathWithTurning` |
| Vehicles / monsters that can't turn instantly | `smoothPathWithTurning` |
| Maximum performance (fewer points) | `smoothPath` |

---

## INavigationConfig reference (path smoothing fields)

```ts
import type { INavigationConfig } from '@alife-sdk/ai/types';
import { createDefaultAIConfig } from '@alife-sdk/ai/config';

const config = createDefaultAIConfig();
const nav: INavigationConfig = config.navigation;
// nav.smoothPointsPerSegment === 8
// nav.smoothRandomOffset     === 10
// nav.dubinsMaxInstantTurn   === Math.PI / 4
// nav.dubinsTurningRadius    === 60
```

---

## Full example

```ts
import { smoothPathWithTurning, SmoothPathFollower } from '@alife-sdk/ai/navigation';
import { createDefaultAIConfig } from '@alife-sdk/ai/config';
import { SeededRandom } from '@alife-sdk/core';
import type { Vec2 } from '@alife-sdk/core';

const config = createDefaultAIConfig();
const nav = config.navigation;
const rng = new SeededRandom(42);

// Shared cache — the CatmullRom step is cached per-route
const cache = new Map<string, readonly Vec2[]>();

const waypoints = [{ x: 0, y: 0 }, { x: 200, y: 150 }, { x: 400, y: 0 }];

// First call: smoothPath runs + cache stores, then arc pass runs → new array
const npc1Path = smoothPathWithTurning(waypoints, nav, rng, cache);
// Second call: smoothPath cache hit, but arc pass still runs → new array
const npc2Path = smoothPathWithTurning(waypoints, nav, rng, cache);
// npc1Path !== npc2Path (different arrays), but npc2Path benefits from cache on the inner step

const follower1 = new SmoothPathFollower(npc1Path, nav);
const follower2 = new SmoothPathFollower(npc2Path, nav);
// Each NPC has its own cursor position — followers are independent
```

---

## Performance note

`smoothPath` uses module-level scratch arrays (`_scratchXs`, `_scratchYs`)
reused across calls — zero extra allocations for the coordinate arrays per call.
The returned `Vec2[]` is allocated fresh each call (unless the cache returns
an existing array).

With a warm cache, `smoothPath` is effectively zero-allocation — it returns
the cached `readonly Vec2[]` directly.
