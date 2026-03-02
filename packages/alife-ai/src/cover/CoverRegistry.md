# CoverRegistry

Central registry for world-space cover points.
Handles registration, evaluator-based search, occupancy tracking, and loophole queries.

**Create one instance per scene.** It is not a singleton — inject it wherever needed.

```ts
import { CoverRegistry } from '@alife-sdk/ai/cover';

const registry = new CoverRegistry(config.cover, myRandom);
// or with TTL lock support:
const registry = new CoverRegistry(config.cover, myRandom, lockRegistry);
```

---

## Constructor

```ts
new CoverRegistry(
  config: ICoverConfig,
  random: IRandom,
  lockRegistry?: ICoverLockRegistry,
)
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `config` | `ICoverConfig` | Evaluator tuning — radii, thresholds, loophole settings. From `createDefaultAIConfig().cover`. |
| `random` | `IRandom` | Seeded random source for deterministic loophole generation. |
| `lockRegistry` | `ICoverLockRegistry` (optional) | TTL reservation system. When provided, `findCover` uses `isAvailable()` for the occupancy filter. When omitted, the legacy `occupiedBy` mutable flag is used instead. |

---

## Registration

### `addPoint(x, y, radius?): ICoverPoint`

Add a single cover point. Returns the created point with an auto-generated ID (`"cover_0000"`, `"cover_0001"`, …).

```ts
const point = registry.addPoint(120, 340);
// point.id === 'cover_0000'
// point.radius === config.cover.pointRadius (default 24)

const bigPoint = registry.addPoint(560, 200, 48); // custom radius
```

### `addPoints(data): void`

Bulk-register points from coordinate data.

```ts
registry.addPoints([
  { x: 100, y: 200 },
  { x: 300, y: 400, radius: 32 },
]);
```

### `removePoint(pointId): boolean`

Remove a point by ID. Returns `true` if the point existed.

### `getSize(): number`

Total registered cover points.

### `getAll(): readonly ICoverPoint[]`

All points (lazy-rebuilt cache, invalidated on add/remove).

---

## Cover search

### `findCover(type, npcPosition, enemies, npcId, maxRadius?): ICoverPoint | null`

Find the highest-scoring available cover point using the specified evaluator.

```ts
const cover = registry.findCover(
  CoverType.BALANCED,
  { x: npc.x, y: npc.y },
  [{ x: enemy.x, y: enemy.y }],
  npcId,
);

if (cover) {
  registry.occupy(cover.id, npcId);
  npc.moveTo(cover.x, cover.y);
}
```

**Filtering pipeline:**
1. If `lockRegistry` is set — skip points where `isAvailable(id, npcId)` is false.
   Otherwise — skip points with `occupiedBy !== null && occupiedBy !== npcId`.
2. Skip points beyond `maxRadius` (default `config.searchRadius`).
3. Score all remaining candidates with the evaluator.
4. Return the point with the highest score above `config.minScoreThreshold`.

Returns `null` if no point qualifies.

### `findRecommendedCover(situation, npcPosition, enemies, npcId): ICoverPoint | null`

Convenience: calls `recommendCoverType(situation, config)` then `findCover`.
Use this when you want automatic type selection from the NPC's current state.

```ts
const cover = registry.findRecommendedCover(
  { hpRatio: 0.15, morale: -0.2, enemyCount: 2, hasAmmo: true },
  npcPos,
  enemies,
  npcId,
);
// hpRatio 0.15 ≤ 0.2 critical → type = CLOSE
```

---

## Spatial query

### `isInCover(position): ICoverPoint | null`

Check whether a position is inside any cover point's protection radius.
Returns the closest matching point, or `null`.

```ts
const inCover = registry.isInCover({ x: npc.x, y: npc.y });
if (inCover) {
  // NPC has reached their cover point
}
```

Uses `max(config.occupyDistance², point.radius²)` as the effective threshold,
so larger custom-radius points remain valid even for larger NPCs.

---

## Occupancy (legacy)

These methods manage the mutable `occupiedBy` field on `ICoverPoint`.
They are available even when a `lockRegistry` is provided, but prefer
`lockRegistry.tryLock` / `unlockAll` for new integrations.

### `occupy(pointId, npcId): void`

Mark a cover point as occupied by an NPC.

### `release(pointId, npcId?): void`

Release a point. If `npcId` is given, only releases if that NPC holds it.

### `releaseAll(npcId): void`

Release all points held by a specific NPC. Call on NPC death or despawn.

---

## Loopholes

### `getLoopholes(cover): readonly ILoophole[]`

Get peek-fire positions for a cover point. Generated lazily on first call
and cached for the lifetime of the registry.

```ts
const loopholes = registry.getLoopholes(coverPoint);
// → ILoophole[] with offsetX, offsetY, angleMin, angleMax
```

### `findBestLoophole(cover, enemyX, enemyY): ILoophole | null`

Find the loophole whose firing arc best covers the angle to an enemy.
Returns `null` if no loophole can engage the given direction.

```ts
const lh = registry.findBestLoophole(cover, enemy.x, enemy.y);
if (lh) {
  const peekX = cover.x + lh.offsetX;
  const peekY = cover.y + lh.offsetY;
  // Move NPC to (peekX, peekY) to fire
}
```

---

## Lifecycle

### `clear(): void`

Remove all points, invalidate the loophole cache, and clear the lock registry
(if one was provided). Call on scene teardown.

```ts
// In your scene's shutdown handler:
coverRegistry.clear();
```

---

## ICoverPoint shape

```ts
interface ICoverPoint {
  readonly id: string;       // 'cover_0000', 'cover_0001', …
  readonly x: number;        // World X
  readonly y: number;        // World Y
  readonly radius: number;   // Protection radius (px)
  occupiedBy: string | null; // NPC ID, or null if free
  loopholes: readonly ILoophole[];
}
```

Points are **mutable** — `occupiedBy` and `loopholes` can be written.
IDs are stable for the lifetime of the registry instance.
