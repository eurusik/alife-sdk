# NPCSensors

Scene-level NPC perception coordinator.
Uses `SpatialGrid` for O(k) candidate lookup — scales to many NPCs without
full O(n²) scans.

```ts
import { NPCSensors, filterFreshIntel } from '@alife-sdk/ai/perception';
import type { IPerceptibleEntity, IDetectionEvent, INPCSensorsConfig } from '@alife-sdk/ai/perception';
```

---

## IPerceptibleEntity

Entity interface used by `NPCSensors`. Each NPC carries its own sensor
parameters — no global config needed.

```ts
interface IPerceptibleEntity {
  readonly id: string;               // Entity ID (used in IDetectionEvent)
  readonly position: Vec2;
  readonly factionId: string;
  readonly facingAngle: number;      // Radians. 0 = facing right (+X axis)
  readonly isAlive: boolean;
  readonly visionRange: number;      // Max vision distance (px)
  readonly visionHalfAngle: number;  // Half-angle of FOV cone (radians)
  readonly hearingRange: number;     // Max hearing distance (px)
}
```

Build it from your entity data:

```ts
const perceptible: IPerceptibleEntity = {
  id:               npc.id,
  position:         { x: npc.x, y: npc.y },
  factionId:        npc.faction,
  facingAngle:      npc.angle,
  isAlive:          npc.hp > 0,
  visionRange:      300,
  visionHalfAngle:  Math.PI / 3,    // 120° total FOV
  hearingRange:     500,
};
```

> **Note:** `IPerceptibleEntity` is distinct from `IPerceivedEntity` (from
> `@alife-sdk/ai/types`). The former is used as both observer and observable
> in `NPCSensors`; the latter is used by the pure `PerceptionQuery` functions.
> Key difference: `IPerceptibleEntity.id` vs `IPerceivedEntity.entityId`.

---

## IDetectionEvent

Output event from both sensors:

```ts
interface IDetectionEvent {
  readonly observerId: string;       // Who detected
  readonly targetId: string;         // Who was detected
  readonly targetPosition: Vec2;     // Target's position at time of detection
  readonly channel: 'visual' | 'sound';
  readonly confidence: number;       // [0, 1]
}
```

| Channel | Confidence |
|---------|-----------|
| `'visual'` | Always `1.0` — visual detections are certain |
| `'sound'` | Linear decay: `1.0 - dist / soundRange` (0..1) |

---

## Constructor

```ts
new NPCSensors(config: INPCSensorsConfig)
```

```ts
interface INPCSensorsConfig {
  spatialGrid: SpatialGrid<{ id: string; position: Vec2 }>;
  isHostile: (observerFaction: string, targetFaction: string) => boolean;
  /**
   * Optional LOS check — called after the FOV cone test.
   * Return `true` if the line from `from` to `to` is unobstructed.
   * When absent, LOS is assumed clear (backward-compatible).
   */
  isLineOfSightClear?: (from: Vec2, to: Vec2) => boolean;
}
```

```ts
import { NPCSensors } from '@alife-sdk/ai/perception';
import { SpatialGrid } from '@alife-sdk/core';
import { segmentIntersectsRect } from '@alife-sdk/core/math';

const grid = new SpatialGrid<{ id: string; position: Vec2 }>(
  200,
  (item) => item.position,
);
const sensors = new NPCSensors({
  spatialGrid: grid,
  isHostile: (a, b) => factionRegistry.areHostile(a, b),
  // Optional — omit if your world has no obstacles
  isLineOfSightClear: (from, to) =>
    walls.every(w => !segmentIntersectsRect(from, to, w.x, w.y, w.width, w.height)),
});
```

> **Grid ownership:** `NPCSensors` does not own the grid — you manage it.
> Insert/update entities in the grid each frame before calling `detectVision`.

---

## detectVision(observers): IDetectionEvent[]

Vision sensor — detect all hostile entities visible to each living observer.

```ts
const events = sensors.detectVision(onlineNPCs);
```

### What it does

1. Builds an `id → IPerceptibleEntity` map once — **O(n)**.
2. For each living observer:
   - `SpatialGrid.queryRadius(position, visionRange)` → candidates — **O(k)**.
   - Skips self, dead targets, non-hostile factions.
   - `isInFOV(pos, angle, target, range, halfAngle)` — dot-product cone test.
   - `isLineOfSightClear(observer.position, target.position)` — obstacle check (only if configured).
3. Returns `IDetectionEvent[]` for all visible hostile pairs.

**Overall complexity:** O(n × k) where n = observers, k = avg candidates per vision radius.

### Important: SpatialGrid scratch array

`SpatialGrid.queryRadius()` returns a **reused scratch array**. `NPCSensors`
copies the result immediately (`[...grid.queryRadius(...)]`) to avoid aliasing.
Your grid must contain the same entities as `observers` for detection to work.

### Grid sync pattern

```ts
// Before each detectVision() call, keep grid in sync:
for (const npc of onlineNPCs) {
  grid.update({ id: npc.id, position: { x: npc.x, y: npc.y } });
}

const events = sensors.detectVision(onlineNPCs);
```

---

## detectSound(sourcePos, soundRange, sourceId, sourceFactionId, hearers): IDetectionEvent[]

Sound sensor — detect all NPCs that hear a sound event.

```ts
// On NPC fires weapon:
const events = sensors.detectSound(
  { x: shooter.x, y: shooter.y },  // sound origin
  600,                              // propagation range (px)
  shooter.id,                       // excluded from results
  shooter.factionId,                // ignored internally (sound is omnidirectional)
  onlineNPCs,                       // candidate hearers
);
```

### What it does

1. Returns immediately if `soundRange <= 0`.
2. For each living hearer (excluding the source):
   - Checks `dist ≤ min(soundRange, hearer.hearingRange)`.
   - Computes linear confidence: `max(0, 1.0 - dist / soundRange)`.
3. Returns `IDetectionEvent[]` for all hearers.

**Complexity:** O(n) where n = length of the `hearers` input array.

> **`sourceFactionId` is unused.** Sound propagates to all factions equally —
> the parameter is present for API consistency but has no effect.

> **Both ranges must be satisfied:** a hearer is only detected if it is within
> BOTH the sound's propagation range AND its own `hearingRange`.

### Confidence values

| Distance from source | Confidence |
|---------------------|-----------|
| 0 (at source) | `1.0` |
| soundRange / 2 | `0.5` |
| soundRange | `0.0` |

> **Zero-confidence events are emitted.** Entities at exactly `soundRange`
> distance pass the range check and receive `confidence = 0.0`. Filter them
> if your MemoryBank should ignore zero-confidence events:
> `if (event.confidence > 0) memoryBank.record(event)`.

Feed `confidence` into your `MemoryBank` to represent how clearly the sound was heard:

```ts
for (const event of soundEvents) {
  memoryBank.get(event.observerId)?.add({
    channel: 'sound',
    targetId: event.targetId,
    position: event.targetPosition,
    confidence: event.confidence,
    timestamp: now,
  });
}
```

---

## filterFreshIntel(sharedTargets, currentTimeMs, freshnessMs?): ReadonlyArray\<{ id, position }\>

Filter squad-shared target intel by age. Returns only entries seen within
`freshnessMs` milliseconds.

```ts
import { filterFreshIntel } from '@alife-sdk/ai/perception';

const freshTargets = filterFreshIntel(
  squad.sharedIntel,   // Array<{ id, position, lastSeenMs }>
  gameTimeMs,
  5000,                // default: 5000 ms
);
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `sharedTargets` | — | Array of `{ id, position, lastSeenMs }` |
| `currentTimeMs` | — | Current game time in milliseconds |
| `freshnessMs` | `5000` | Max age of valid intel in ms |

Returns `ReadonlyArray<{ id: string; position: Vec2 }>` — strips the
`lastSeenMs` timestamp from results.

### Squad intel sharing pattern

```ts
// Leader shares its detection events with squad members:
for (const event of visionEvents) {
  if (event.observerId === leader.id) {
    squad.sharedIntel.push({
      id: event.targetId,
      position: event.targetPosition,
      lastSeenMs: gameTimeMs,
    });
  }
}

// Squad members use fresh intel to update their known-enemy list:
const validTargets = filterFreshIntel(squad.sharedIntel, gameTimeMs);
for (const t of validTargets) {
  if (!npc.knownEnemies.includes(t.id)) {
    npc.knownEnemies.push(t.id);
  }
}
```

---

## Full integration example

```ts
import { NPCSensors } from '@alife-sdk/ai/perception';
import { SpatialGrid } from '@alife-sdk/core';
import type { IPerceptibleEntity } from '@alife-sdk/ai/perception';

// --- Setup (once per scene) ---

const grid = new SpatialGrid<{ id: string; position: Vec2 }>(
  200,
  (item) => item.position,
);
const sensors = new NPCSensors({
  spatialGrid: grid,
  isHostile: (a, b) => factionRegistry.areHostile(a, b),
  // Optional LOS — omit if no obstacle data
  isLineOfSightClear: (from, to) =>
    walls.every(w => !segmentIntersectsRect(from, to, w.x, w.y, w.width, w.height)),
});

// --- Each frame ---

function perceptionTick(onlineNPCs: MyNPC[], gameTimeMs: number) {
  // 1. Sync grid with current NPC positions
  for (const npc of onlineNPCs) {
    grid.update({ id: npc.id, position: { x: npc.x, y: npc.y } });
  }

  // 2. Build IPerceptibleEntity array
  const observers: IPerceptibleEntity[] = onlineNPCs.map((npc) => ({
    id:              npc.id,
    position:        { x: npc.x, y: npc.y },
    factionId:       npc.faction,
    facingAngle:     npc.angle,
    isAlive:         npc.hp > 0,
    visionRange:     aiConfig.perception.visionRange,
    visionHalfAngle: aiConfig.perception.visionHalfAngle,
    hearingRange:    aiConfig.perception.hearingRange,
  }));

  // 3. Vision pass
  for (const event of sensors.detectVision(observers)) {
    memoryBanks.get(event.observerId)?.record(event, gameTimeMs);
  }

  // 4. Sound events are triggered elsewhere (on shot, explosion, etc.)
  //    Call sensors.detectSound() from your weapon/explosion handler.
}
```
