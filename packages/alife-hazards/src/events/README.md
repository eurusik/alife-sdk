# events

Typed event constants and payload interfaces for the hazard system.

```ts
import { HazardEvents } from '@alife-sdk/hazards/events';
import type { HazardEventKey, HazardEventPayloads } from '@alife-sdk/hazards/events';
```

---

## What's in this module

| Export | Kind | What it does |
|--------|------|-------------|
| `HazardEvents` | const object | String constants for all hazard event names |
| `HazardEventKey` | type | Union of all valid event key strings |
| `HazardEventPayloads` | interface | Payload types keyed by event name |

---

## Event constants

```ts
HazardEvents.HAZARD_DAMAGE       // 'hazard:damage'
HazardEvents.ARTEFACT_SPAWNED    // 'hazard:artefact_spawned'
HazardEvents.ARTEFACT_COLLECTED  // 'hazard:artefact_collected'
HazardEvents.ZONE_EXPIRED        // 'hazard:zone_expired'
```

Use these constants instead of raw strings — refactoring is safe and the compiler
catches typos:

```ts
// ✓ correct
bus.emit(HazardEvents.HAZARD_DAMAGE, payload);

// ✗ avoid — silent typo, no compile error
bus.emit('hazard:dmage', payload);
```

---

## Payload shapes

### `hazard:damage`

Fired when a hazard zone deals damage to an entity:

```ts
{
  entityId:    string;   // the entity that took damage
  zoneId:      string;   // which zone caused the damage
  zoneType:    string;   // HazardZoneType — 'fire' | 'radiation' | …
  damage:      number;   // final damage amount applied
  damageTypeId: string;  // maps to your damage system (e.g. 'radiation', 'fire')
}
```

### `hazard:artefact_spawned`

Fired when `ArtefactSpawner.trySpawn()` successfully creates an artefact:

```ts
{
  artefactId: string;   // artefact definition id (matches IArtefactDefinition.id)
  zoneId:     string;   // zone where it spawned
  x:          number;   // world position x
  y:          number;   // world position y
}
```

### `hazard:artefact_collected`

Fired when a player or NPC collects an artefact:

```ts
{
  artefactId:  string;  // which artefact type was collected
  instanceId:  string;  // unique id of this artefact instance in the world
  zoneId:      string;  // zone it was in when collected
  collectorId: string;  // entity id of the collector
}
```

### `hazard:zone_expired`

Fired when a zone with `expiresAtMs` is auto-removed by `HazardManager.tick()`:

```ts
{
  zoneId:   string;  // the zone that was removed
  zoneType: string;  // its HazardZoneType
}
```

Useful to clean up UI markers, quest state, or spawned artefacts associated with that zone.

---

## Subscribing with your EventBus

The SDK does not ship a built-in event bus — pass it in at the `HazardPlugin`
level (see [`plugin/README.md`](../plugin/README.md)). Once wired, listen anywhere:

```ts
import { HazardEvents } from '@alife-sdk/hazards/events';
import type { HazardEventPayloads } from '@alife-sdk/hazards/events';

// Typed helper (example — adapts to whatever bus you use)
bus.on(HazardEvents.HAZARD_DAMAGE, (payload: HazardEventPayloads['hazard:damage']) => {
  console.log(`${payload.entityId} took ${payload.damage} ${payload.damageTypeId} damage`);
});

bus.on(HazardEvents.ARTEFACT_SPAWNED, (payload: HazardEventPayloads['hazard:artefact_spawned']) => {
  console.log(`artefact ${payload.artefactId} at (${payload.x}, ${payload.y})`);
});

bus.on(HazardEvents.ARTEFACT_COLLECTED, (payload: HazardEventPayloads['hazard:artefact_collected']) => {
  console.log(`${payload.collectorId} collected ${payload.artefactId}`);
});

bus.on(HazardEvents.ZONE_EXPIRED, (payload: HazardEventPayloads['hazard:zone_expired']) => {
  console.log(`zone ${payload.zoneId} (${payload.zoneType}) expired`);
});
```

---

## Using `HazardEventKey` for generic helpers

`HazardEventKey` is the union of all valid event name strings:

```ts
type HazardEventKey = 'hazard:damage' | 'hazard:artefact_spawned' | 'hazard:artefact_collected' | 'hazard:zone_expired';
```

Useful for generic bus adapters or logging middleware:

```ts
import type { HazardEventKey, HazardEventPayloads } from '@alife-sdk/hazards/events';

function logHazardEvent<K extends HazardEventKey>(
  event: K,
  payload: HazardEventPayloads[K],
): void {
  console.log(`[hazard] ${event}`, payload);
}
```
