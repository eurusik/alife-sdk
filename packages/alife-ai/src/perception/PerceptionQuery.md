# PerceptionQuery

Pure math functions for spatial perception queries.
No state, no side effects — same inputs always produce the same output.

```ts
import {
  isInFOV,
  filterVisibleEntities,
  filterHearingEntities,
  filterHostileEntities,
  filterFriendlyEntities,
  distanceSq,
  findClosest,
  scanForEnemies,
} from '@alife-sdk/ai/perception';
import type { IPerceivedEntity, IPerceptionConfig } from '@alife-sdk/ai/types';
```

---

## ⚠️ Scratch array warning

`filterVisibleEntities`, `filterHearingEntities`, `filterHostileEntities`, and
`filterFriendlyEntities` each use their own **module-level scratch array** that
is reused on every call to **that same function**.

```ts
// SAFE — each function has its own scratch array:
const visible = filterVisibleEntities(posA, angleA, candidates, config);
const enemies = filterHostileEntities(visible, factionId, isHostile);
// 'visible' is still valid here — filterHostileEntities uses a different array.

// WRONG — calling the SAME function twice reuses the same array:
const visibleA = filterVisibleEntities(posA, angleA, candidates, config);
const visibleB = filterVisibleEntities(posB, angleB, candidates, config);
// visibleA === visibleB (same array!) — visibleA now contains posB results.

// CORRECT when calling the same function multiple times:
const visibleA = [...filterVisibleEntities(posA, angleA, candidates, config)];
const visibleB = filterVisibleEntities(posB, angleB, candidates, config);
```

`scanForEnemies`, `findClosest`, and `distanceSq` allocate fresh results
and are safe to hold across calls.

---

## IPerceivedEntity

Input type for all `PerceptionQuery` functions:

```ts
// From @alife-sdk/ai/types
interface IPerceivedEntity {
  readonly entityId: string;
  readonly position: Vec2;
  readonly factionId: string;
  readonly isAlive: boolean;
}
```

Build it from your game entity data:

```ts
const candidates: IPerceivedEntity[] = scene.getEntitiesNear(npc.x, npc.y, 400).map(e => ({
  entityId: e.id,
  position:  { x: e.x, y: e.y },
  factionId: e.faction,
  isAlive:   e.hp > 0,
}));
```

---

## isInFOV(origin, facingAngle, target, visionRange, visionHalfAngle): boolean

Check if a single target point is inside a vision cone.

```ts
const canSee = isInFOV(
  { x: npc.x, y: npc.y },
  npc.facingAngle,          // radians, 0 = facing right (+X)
  { x: enemy.x, y: enemy.y },
  300,                      // vision range (px)
  Math.PI / 3,              // half-angle (60° = 120° total FOV)
);
```

Returns `true` if the target is:
1. Within `visionRange` (squared-distance check, no `Math.sqrt`).
2. Within the cone defined by `facingAngle ± visionHalfAngle`.

**Edge case:** Returns `true` if target is at exactly the same position as
origin (`dSq === 0`).

Uses dot-product cone test — avoids `Math.atan2` and angle normalization.

---

## filterVisibleEntities(origin, facingAngle, candidates, config): IPerceivedEntity[]

Filter candidates to those visible from a single observer position.

```ts
// ⚠️ Returns scratch array — copy if you need to keep it!
const visible = filterVisibleEntities(
  { x: npc.x, y: npc.y },
  npc.facingAngle,
  candidateList,
  config.perception,
);
```

- Filters by `isAlive` before the FOV test (dead entities are never visible).
- Uses config `visionRange` and `visionHalfAngle`.
- Precomputes `cos(facingAngle)` / `sin(facingAngle)` once for all candidates.
- Complexity: **O(n)** where n = candidate count.

---

## filterHearingEntities(source, soundRange, entities, hearingRange?): IPerceivedEntity[]

Filter entities that can hear a sound from a source position.

```ts
// ⚠️ Returns scratch array — copy if you need to keep it!
const hearers = filterHearingEntities(
  { x: explosion.x, y: explosion.y },
  400,        // sound propagation range (px)
  allEntities,
  npc.hearingRange,  // optional: clamps effective range to min(soundRange, hearingRange)
);
```

- Sound is omnidirectional — no FOV cone.
- Effective range = `min(soundRange, hearingRange)` if `hearingRange` is provided.
  This parameter applies a **single** limit to all entities — not per-entity.
  For per-entity hearing ranges, use `NPCSensors.detectSound()` instead.
- Filters by `isAlive`.
- Complexity: **O(n)**.

---

## filterHostileEntities(entities, observerFactionId, isHostile): IPerceivedEntity[]

Filter entities that are hostile to the observer's faction.

```ts
// ⚠️ Returns scratch array — copy if you need to keep it!
const enemies = filterHostileEntities(
  candidates,
  npc.factionId,
  (a, b) => factionRegistry.areHostile(a, b),
);
```

- Excludes entities of the **same faction** regardless of `isHostile` result.
- Uses the `isHostile` callback for cross-faction checks.

---

## filterFriendlyEntities(entities, observerFactionId, isHostile): IPerceivedEntity[]

Filter entities that are friendly (same faction OR non-hostile).

```ts
// ⚠️ Returns scratch array — copy if you need to keep it!
const allies = filterFriendlyEntities(
  candidates,
  npc.factionId,
  (a, b) => factionRegistry.areHostile(a, b),
);
```

- Includes same-faction entities unconditionally.
- Includes cross-faction entities where `isHostile(observerFaction, entityFaction)` is `false`.

---

## distanceSq(a, b): number

Squared Euclidean distance between two points.
Use for comparisons — avoids `Math.sqrt`.

```ts
const dSq = distanceSq({ x: npc.x, y: npc.y }, { x: enemy.x, y: enemy.y });
if (dSq < 200 * 200) {
  // enemy is within 200px
}
```

---

## findClosest(origin, entities): IPerceivedEntity | null

Find the nearest entity to a position.

```ts
const nearest = findClosest({ x: npc.x, y: npc.y }, visibleEnemies);
if (nearest) {
  npc.target = nearest.entityId;
}
```

- Returns `null` if the array is empty.
- Uses squared-distance internally — no `Math.sqrt`.
- Returns a direct reference from the input array (does not use a scratch array — safe to hold across calls).

---

## scanForEnemies(origin, facingAngle, candidates, observerFactionId, isHostile, config): IPerceivedEntity[]

Combined FOV + faction filter in a single pass.
**This is the primary function used by GOAP world state building.**

```ts
// Returns a fresh array — safe to hold:
const visibleEnemies = scanForEnemies(
  { x: npc.x, y: npc.y },
  npc.facingAngle,
  allCandidates,
  npc.factionId,
  (a, b) => factionRegistry.areHostile(a, b),
  config.perception,
);

// Use directly in GOAP snapshot:
const snapshot: INPCWorldSnapshot = {
  seeEnemy:     visibleEnemies.length > 0,
  enemyInRange: visibleEnemies.some(e =>
    distanceSq({ x: npc.x, y: npc.y }, e.position) < npc.weaponRangeSq
  ),
  // ...
};
```

- Performs all checks (alive, faction, FOV) in a **single loop** — more
  efficient than chaining `filterVisibleEntities` + `filterHostileEntities`.
- Precomputes observer trig values once.
- Returns a **new array** — safe to hold across calls.

---

## Typical GOAP world state adapter

```ts
import { scanForEnemies, distanceSq, findClosest } from '@alife-sdk/ai/perception';
import type { IPerceivedEntity, IPerceptionConfig } from '@alife-sdk/ai/types';
import type { INPCWorldSnapshot } from '@alife-sdk/ai/types';

function buildSnapshot(
  npc: MyNPC,
  candidates: IPerceivedEntity[],
  config: IPerceptionConfig,
  isHostile: (a: string, b: string) => boolean,
): INPCWorldSnapshot {
  const enemies = scanForEnemies(
    { x: npc.x, y: npc.y },
    npc.facingAngle,
    candidates,
    npc.factionId,
    isHostile,
    config,
  );

  // scanForEnemies already filters dead entities — use findClosest for the nearest:
  const nearest = findClosest({ x: npc.x, y: npc.y }, enemies);
  const nearestEnemyDist = nearest
    ? Math.sqrt(distanceSq({ x: npc.x, y: npc.y }, nearest.position))
    : Infinity;

  return {
    isAlive:         npc.hp > 0,
    hpRatio:         npc.hp / npc.maxHp,
    hasWeapon:       npc.weapon !== null,
    hasAmmo:         npc.ammo > 0,
    inCover:         npc.inCover,
    seeEnemy:        enemies.length > 0,
    enemyPresent:    npc.knownEnemies.length > 0,
    enemyInRange:    nearestEnemyDist < npc.weaponRange,
    hasDanger:       npc.dangerLevel > 0,
    hasDangerGrenade: npc.grenadeNearby,
    enemyWounded:    nearest !== null && npc.lastKnownEnemyHp < 0.3,
  };
}
```
