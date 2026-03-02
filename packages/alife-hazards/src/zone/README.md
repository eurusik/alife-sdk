# zone

`HazardZone` — stateful circular anomaly zone with independent damage and
artefact spawn timers.

```ts
import { HazardZone } from '@alife-sdk/hazards/zone';
import type { HazardZoneType, IHazardZoneConfig } from '@alife-sdk/hazards/zone';
```

In most cases you never construct `HazardZone` directly — pass `IHazardZoneConfig`
to `HazardManager.addZone()` or `HazardsPlugin` config and it handles creation.
This module is documented for cases where you need direct zone access.

---

## What's in this module

| Export | Kind | What it does |
|--------|------|-------------|
| `HazardZone` | class | Circular anomaly zone with timers and artefact counter |
| `IHazardZoneConfig` | interface | Static zone definition |
| `HazardZoneType` | type | Open enum — built-in zone type strings |

---

## IHazardZoneConfig

All fields you set when registering a zone:

```ts
interface IHazardZoneConfig {
  id:                   string;          // unique zone identifier
  type:                 HazardZoneType;  // 'fire' | 'radiation' | 'chemical' | 'psi' | …
  x:                    number;          // world centre x
  y:                    number;          // world centre y
  radius:               number;          // zone radius in world units (must be > 0)
  damagePerSecond:      number;          // DPS — converted to per-tick amount internally
  damageTickIntervalMs?: number;         // default 500 ms
  artefactChance:       number;          // [0, 1] — probability of spawn per cycle
  artefactSpawnCycleMs?: number;         // default 60 000 ms (1 in-game minute)
  maxArtefacts:         number;          // spawn blocked when zone reaches this count
  entityFilter?:        (entity: IHazardEntity) => boolean;  // optional — filters which entities receive damage
  expiresAtMs?:         number;          // optional — zone auto-removes when manager's elapsedMs >= this value
}
```

### Default values

| Field | Default |
|-------|---------|
| `damageTickIntervalMs` | `500` ms |
| `artefactSpawnCycleMs` | `60 000` ms |
| `entityFilter` | `undefined` — all entities affected |
| `expiresAtMs` | `undefined` — zone lives indefinitely |

### `entityFilter` — per-zone entity filtering

When set, only entities for which the predicate returns `true` receive damage from this zone. Entities that don't pass the filter are skipped entirely (not even an immunity check runs):

```ts
// PSI zone that only affects biological entities
manager.addZone({
  id: 'psi_burst', type: 'psi', x: 300, y: 300, radius: 100,
  damagePerSecond: 15, artefactChance: 0, maxArtefacts: 0,
  entityFilter: (e) => e.id !== 'robot_01',  // robots immune to PSI
});
```

### `expiresAtMs` — temporary zones

Zones with `expiresAtMs` are automatically removed by `HazardManager.tick()` when the accumulated `elapsedMs` reaches the threshold. The zone is removed before the regular damage/spawn processing, so no damage fires in the expiry tick.

`hazard:zone_expired` is emitted on expiry (batched with other events at end of tick).

```ts
// Explosion anomaly — lasts 5 seconds of game time
manager.addZone({
  id: 'blast_zone', type: 'fire', x: 200, y: 400, radius: 120,
  damagePerSecond: 50, artefactChance: 0, maxArtefacts: 0,
  expiresAtMs: 5_000,
});

bus.on(HazardEvents.ZONE_EXPIRED, ({ zoneId, zoneType }) => {
  ui.removeZoneMarker(zoneId);
});
```

> **Note:** `expiresAtMs` is measured from the start of the first `manager.tick()` call (accumulated `deltaMs`). After save/load, re-register zones with an adjusted `expiresAtMs` relative to the restored elapsed time.

### `HazardZoneType` — open enum

Built-in types have IDE autocomplete. Any string is also valid for custom zones:

```ts
type HazardZoneType = 'fire' | 'radiation' | 'chemical' | 'psi' | (string & {});

// custom type — no SDK changes needed
{ id: 'gravity_well', type: 'gravity', … }
```

The `type` string is used as the `damageTypeId` in `hazard:damage` events, so it
must match the damage-type id your entity immunity map uses.

---

## HazardZone

### Constructor validation

`HazardZone` throws on invalid config — fail fast at boot, not at runtime:

| Constraint | Error |
|-----------|-------|
| `radius <= 0` | throws |
| `damagePerSecond < 0` | throws |
| `artefactChance` outside `[0, 1]` | throws |
| `maxArtefacts < 0` | throws |

### Reading zone state

```ts
zone.config                  // Readonly<IHazardZoneConfig> — immutable after construction
zone.damageTickIntervalMs    // resolved interval (config value or 500)
zone.artefactSpawnCycleMs    // resolved cycle (config value or 60 000)
zone.artefactCount           // current number of artefacts in this zone
zone.isAtCapacity            // true when artefactCount >= config.maxArtefacts
```

### Timer API

`HazardManager` drives these methods — you don't call them directly unless
building a custom tick loop:

```ts
// Advance both timers by deltaMs
zone.advance(deltaMs);

// Damage tick
zone.isDamageTickReady();   // true when damage timer >= damageTickIntervalMs
zone.consumeDamageTick();   // subtracts interval — carry-over preserved

// Artefact spawn cycle
zone.isArtefactSpawnReady();  // true when artefact timer >= artefactSpawnCycleMs
zone.consumeArtefactCycle();  // subtracts cycle — carry-over preserved
```

**Carry-over** — `consume*()` subtracts the interval rather than resetting to
zero. A large `deltaMs` spanning multiple intervals fires multiple ticks in the
same frame without losing the remainder:

```
deltaMs = 1200, damageTickIntervalMs = 500
├─ advance(1200)          → _damageTimer = 1200
├─ isDamageTickReady()    → true (1200 >= 500)
├─ consumeDamageTick()    → _damageTimer = 700
├─ isDamageTickReady()    → true (700 >= 500)
├─ consumeDamageTick()    → _damageTimer = 200
└─ isDamageTickReady()    → false — 200ms carries to next frame
```

### Damage calculation

```ts
zone.getDamagePerTick(): number
// = damagePerSecond × damageTickIntervalMs / 1000
// e.g. 10 dps × 500 ms / 1000 = 5 damage per tick
```

### Spatial check

```ts
zone.containsPoint(x: number, y: number): boolean
// squared-distance check — no sqrt, O(1)
```

### Artefact counter

`HazardManager` calls these automatically. If you build a custom manager, call
them yourself:

```ts
zone.notifyArtefactAdded();    // increment — called on successful spawn
zone.notifyArtefactRemoved();  // decrement — clamped to 0; called on collect
```

---

## Example — custom tick loop (without HazardManager)

If you manage zones directly:

```ts
import { HazardZone } from '@alife-sdk/hazards/zone';

const zone = new HazardZone({
  id: 'rad_lake', type: 'radiation',
  x: 400, y: 300, radius: 80,
  damagePerSecond: 8,
  damageTickIntervalMs: 500,
  artefactChance: 0.15,
  artefactSpawnCycleMs: 60_000,
  maxArtefacts: 3,
});

function tick(deltaMs: number, entities: IHazardEntity[]) {
  zone.advance(deltaMs);

  while (zone.isDamageTickReady()) {
    zone.consumeDamageTick();
    const dmg = zone.getDamagePerTick();
    for (const e of entities) {
      if (zone.containsPoint(e.position.x, e.position.y)) {
        e.takeDamage(dmg, zone.config.type);
      }
    }
  }

  while (zone.isArtefactSpawnReady()) {
    zone.consumeArtefactCycle();
    if (!zone.isAtCapacity) {
      // your spawn logic
    }
  }
}
```

For production use, prefer `HazardManager` — it handles the spatial grid,
artefact spawner, and event emission for you.
