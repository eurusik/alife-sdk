# DangerManager

Spatial danger zone registry with TTL decay, threat scoring, and safe-direction
vector computation.

```ts
import { DangerManager, DangerType } from '@alife-sdk/core/ai';
import type { IDangerEntry } from '@alife-sdk/core/ai';
```

---

## Concepts

### Danger entries

A danger is a circular zone in world space. Each entry has:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier — used to replace or remove the entry |
| `type` | `DangerType` | Category of threat |
| `position` | `Vec2` | Centre of the danger zone |
| `radius` | `number` | Radius in world units |
| `threatScore` | `number [0, 1]` | Urgency — higher = more threatening |
| `remainingMs` | `number` | Milliseconds until the danger expires |

### Built-in danger types

```ts
DangerType.GRENADE      // 'grenade'
DangerType.GUNFIRE      // 'gunfire'
DangerType.EXPLOSION    // 'explosion'
DangerType.CORPSE       // 'corpse'
DangerType.ANOMALY      // 'anomaly'
DangerType.ATTACK_SOUND // 'attack_sound'
```

The type is open (`string & {}`), so you can add your own without casting:

```ts
dangers.addDanger({ ..., type: 'psi_field' });
```

### TTL

Every danger has a `remainingMs` countdown. Call `update(deltaMs)` each frame
to advance the clock; expired entries are removed automatically.

---

## `DangerManager` API

### Constructor

```ts
new DangerManager(defaultThreshold?: number)
```

`defaultThreshold` — the threat level used by `isDangerous()` when no explicit
threshold is given. Default: `0.1`.

### `addDanger(entry)`

Register a danger zone. If an entry with the same `id` already exists it is
replaced.

```ts
dangers.addDanger({
  id: 'nade_01',
  type: DangerType.GRENADE,
  position: { x: 400, y: 250 },
  radius: 120,
  threatScore: 1.0,
  remainingMs: 4000,
});
```

### `removeDanger(id)`

Immediately remove a danger by ID (e.g. grenade was picked up).

```ts
dangers.removeDanger('nade_01');
```

### `update(deltaMs)`

Tick: subtract `deltaMs` from every danger's `remainingMs`, remove entries
that have expired.

```ts
// Each frame, deltaMs in milliseconds
dangers.update(deltaMs);
```

### `getThreatAt(position)`

Sum of `threatScore` for all dangers whose radius covers `position`.
Result is **not** clamped — can exceed 1.0 when multiple dangers overlap.

```ts
const threat = dangers.getThreatAt({ x: npc.x, y: npc.y });
// threat > 1.0 means the NPC is inside multiple overlapping danger zones
```

### `isDangerous(position, threshold?)`

```ts
isDangerous(position: Vec2, threshold?: number): boolean
```

Returns `true` if `getThreatAt(position) >= threshold`.
Short-circuits as soon as the threshold is reached — faster than `getThreatAt`
when you only need a yes/no answer.

```ts
if (dangers.isDangerous(npc.position)) {
  // flee
}

// Override threshold per decision
if (dangers.isDangerous(npc.position, 0.5)) {
  // only react to serious threats
}
```

### `getDangersNear(position, radius)`

All active danger entries whose centre is within `radius` of `position`.
Useful when the NPC needs to inspect individual threat types.

```ts
const nearby = dangers.getDangersNear({ x: npc.x, y: npc.y }, 300);
const grenades = nearby.filter(d => d.type === DangerType.GRENADE);
if (grenades.length > 0) npc.transition('EVADE_GRENADE');
```

### `getSafeDirection(position)`

Compute a unit vector pointing **away** from all active dangers that cover
`position`. Returns `{ x: 0, y: 0 }` if no dangers are active.

Each danger contributes a repulsion force weighted by its `threatScore` and
inversely proportional to distance — closer and more threatening dangers pull
the vector harder.

```ts
const safe = dangers.getSafeDirection({ x: npc.x, y: npc.y });
if (safe.x !== 0 || safe.y !== 0) {
  npc.setVelocity(safe.x * npc.speed, safe.y * npc.speed);
}
```

### `activeDangerCount`

```ts
get activeDangerCount(): number
```

Number of currently active (non-expired) danger entries.

---

## Serialisation

```ts
// Save
const snapshot = dangers.serialize(); // IDangerEntry[]

// Restore
dangers.restore(snapshot);
```

`restore()` replaces all current entries. Note that `remainingMs` is stored
as-is — if you restore a save made 5 seconds ago, the TTLs will still reflect
that old snapshot.

---

## Full example — grenade reaction system

```ts
import { DangerManager, DangerType } from '@alife-sdk/core/ai';

const dangers = new DangerManager(0.15);
let nextGrenadeId = 0;

// When a grenade lands on the map
function onGrenadeLanded(x: number, y: number) {
  dangers.addDanger({
    id: `nade_${nextGrenadeId++}`,
    type: DangerType.GRENADE,
    position: { x, y },
    radius: 180,        // blast radius
    threatScore: 1.0,
    remainingMs: 3500,  // fuse time
  });
}

// When a building catches fire
function onFireStarted(id: string, x: number, y: number) {
  dangers.addDanger({
    id: `fire_${id}`,
    type: DangerType.EXPLOSION,
    position: { x, y },
    radius: 250,
    threatScore: 0.7,
    remainingMs: 15000,
  });
}

// NPC update loop
function updateNPC(npc: MyNPC, deltaMs: number) {
  dangers.update(deltaMs);

  const pos = { x: npc.x, y: npc.y };

  if (dangers.isDangerous(pos, 0.8)) {
    // Critical danger — drop everything and flee
    const dir = dangers.getSafeDirection(pos);
    npc.setVelocity(dir.x * npc.maxSpeed, dir.y * npc.maxSpeed);
    npc.fsm.transition('FLEE');
    return;
  }

  if (dangers.isDangerous(pos)) {
    // Mild threat — divert path but keep current task
    const dir = dangers.getSafeDirection(pos);
    npc.nudge(dir.x * 80, dir.y * 80); // softer push
  }
}
```

---

## Tips

**Reuse IDs.** Updating a persistent threat (e.g. an ongoing fire) is cheaper
than removing and re-adding it. Call `addDanger()` with the same ID to update
position, radius, or TTL in-place.

**Combine with `MemoryBank`.** `DangerManager` tracks live world-space threats;
`MemoryBank` stores what the NPC *perceived*. A good pattern:

```ts
// When the NPC witnesses an explosion:
dangers.addDanger({ id: 'exp_01', type: DangerType.EXPLOSION, ... });   // world
memory.remember({ sourceId: 'exp_01', channel: MemoryChannel.DANGER, ... }); // per-NPC
```

**Threat accumulation.** `getThreatAt` sums scores from overlapping zones.
Design `threatScore` values that make sense when added together. For example,
two medium threats (0.5 + 0.5 = 1.0) should feel as dangerous as one critical
threat (1.0).

**Performance.** All spatial queries iterate all active dangers — O(n). For
typical game scenarios (< 50 simultaneous dangers) this is negligible. If you
expect hundreds of persistent danger zones, consider partitioning them with
`SpatialGrid` from `@alife-sdk/core`.
