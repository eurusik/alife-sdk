# perception

NPC sense system for `@alife-sdk/ai`: vision cone detection, hearing, faction
filtering, and squad intel sharing.

```ts
import {
  // Low-level pure math:
  isInFOV,
  scanForEnemies,
  filterVisibleEntities,
  filterHearingEntities,
  filterHostileEntities,
  filterFriendlyEntities,
  distanceSq,
  findClosest,
  // Scene-level coordinator:
  NPCSensors,
  filterFreshIntel,
} from '@alife-sdk/ai/perception';
```

---

## Two-level architecture

The module is split into two layers:

| Layer | File | What it is |
|-------|------|-----------|
| **Pure math** | `PerceptionQuery` | Stateless functions — FOV tests, distance, filtering |
| **Scene coordinator** | `NPCSensors` | Stateful class — uses SpatialGrid, returns `IDetectionEvent[]` |

Use `NPCSensors` when you have a full scene with many NPCs.
Use `PerceptionQuery` functions directly when you need a single point query,
custom filtering, or are building GOAP world state from your own perception data.

---

## Quick start — scene perception

```ts
import { NPCSensors } from '@alife-sdk/ai/perception';
import { SpatialGrid } from '@alife-sdk/core';

// Step 1: Create spatial grid (shared with other systems)
// positionFn tells the grid how to extract a Vec2 from your items:
const grid = new SpatialGrid<{ id: string; position: Vec2 }>(
  200,                    // cell size (px) — ~2× max query radius is a good default
  (item) => item.position,
);

// Step 2: Create sensors once per scene
const sensors = new NPCSensors({
  spatialGrid: grid,
  isHostile: (a, b) => factionRegistry.areHostile(a, b),
  // Optional — wire up when you have obstacle/wall data:
  // isLineOfSightClear: (from, to) =>
  //   walls.every(w => !segmentIntersectsRect(from, to, w.x, w.y, w.w, w.h)),
});

// Step 3: Keep grid in sync — update positions each frame
function syncGrid(npc: MyNPC) {
  grid.update({ id: npc.id, position: { x: npc.x, y: npc.y } });
}

// Step 4: Each frame — detect who sees who
const visionEvents = sensors.detectVision(onlineNPCs);
for (const event of visionEvents) {
  memoryBank.get(event.observerId)?.record({
    channel: event.channel,   // 'visual'
    targetId: event.targetId,
    position: event.targetPosition,
    confidence: event.confidence,  // always 1.0 for vision
  });
}

// Step 5: On shot fired — detect who hears it
const soundEvents = sensors.detectSound(
  { x: shooter.x, y: shooter.y },  // sound origin
  600,                              // propagation radius (px)
  shooter.id,
  shooter.factionId,
  onlineNPCs,
);
for (const event of soundEvents) {
  memoryBank.get(event.observerId)?.record({
    channel: 'sound',
    targetId: event.targetId,
    confidence: event.confidence,  // 0..1, decays with distance
  });
}
```

---

## Quick start — single NPC FOV query

When you need to check one NPC (e.g. for GOAP world state):

```ts
import { scanForEnemies, filterFriendlyEntities, findClosest } from '@alife-sdk/ai/perception';
import type { IPerceivedEntity, IPerceptionConfig } from '@alife-sdk/ai/types';

const config: IPerceptionConfig = aiConfig.perception;

// Returns a fresh array (safe to hold):
const visibleEnemies = scanForEnemies(
  { x: npc.x, y: npc.y },
  npc.facingAngle,
  allCandidates,      // IPerceivedEntity[] from your data layer
  npc.factionId,
  isHostile,
  config,
);

const seeEnemy = visibleEnemies.length > 0;
// scanForEnemies does NOT sort by distance — use findClosest for the nearest:
const nearestEnemy = findClosest({ x: npc.x, y: npc.y }, visibleEnemies);
```

---

## Perception pipeline

```
All entities in scene (your data)
          │
          ▼  NPCSensors.detectVision(observers)
             For each NPC observer:
               SpatialGrid.queryRadius(pos, visionRange)      → O(k) candidates
               isHostile check                                 → filter friendlies
               isInFOV(pos, angle, target, range, halfAngle)  → FOV cone check
               isLineOfSightClear?(from, to)                  → obstacle check (optional)
          │
          ▼  IDetectionEvent[] { observerId, targetId, channel: 'visual', confidence: 1.0 }
          │
          ▼  Your code: write to MemoryBank, emit events, update GOAP snapshot

Sound event (shot/explosion):
          │
          ▼  NPCSensors.detectSound(sourcePos, soundRange, ...)
             For each hearer: dist ≤ min(soundRange, hearingRange)
             confidence = 1.0 - dist / soundRange (linear decay)
          │
          ▼  IDetectionEvent[] { channel: 'sound', confidence: 0..1 }
```

---

## IPerceptionConfig defaults

```ts
import type { IPerceptionConfig } from '@alife-sdk/ai/types';
import { createDefaultAIConfig } from '@alife-sdk/ai/config';

const config = createDefaultAIConfig();
const perception: IPerceptionConfig = config.perception;
// perception.visionRange      === 300  px
// perception.visionHalfAngle  === Math.PI / 3  (60° half = 120° total FOV)
// perception.hearingRange     === 500  px
// perception.weaponSoundRange === 600  px
```

Override at construction:

```ts
const config = createDefaultAIConfig({
  perception: { visionRange: 400, visionHalfAngle: Math.PI / 4 },
});
```

---

## Components

| File | Purpose |
|------|---------|
| [PerceptionQuery.md](PerceptionQuery.md) | 8 pure functions — FOV, distance, filtering, `scanForEnemies` |
| [NPCSensors.md](NPCSensors.md) | `NPCSensors` class + `filterFreshIntel` — scene-level coordinator |

---

## Key types

Two entity interfaces exist — choose the right one for your context:

| Interface | From | Used by | Has |
|-----------|------|---------|-----|
| `IPerceivedEntity` | `@alife-sdk/ai/types` | `PerceptionQuery` functions | `entityId`, `position`, `factionId`, `isAlive` |
| `IPerceptibleEntity` | `@alife-sdk/ai/perception` | `NPCSensors` | `id`, `position`, `factionId`, `facingAngle`, `isAlive`, `visionRange`, `visionHalfAngle`, `hearingRange` |

`IPerceptibleEntity` carries the per-NPC sensor parameters (ranges, FOV angle)
so `NPCSensors` can query each NPC's own vision/hearing capabilities without
a separate config lookup.
