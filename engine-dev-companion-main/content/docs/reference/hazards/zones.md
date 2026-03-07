# Hazard Zones

Use this page when you need to understand what one anomaly zone actually owns at runtime.

`HazardZone` is not a decorative map marker. It is a stateful object with damage cadence, artefact cadence, capacity, and optional expiry.

## Import path

```ts
import { HazardZone } from "@alife-sdk/hazards/zone";
import type { HazardZoneType, IHazardZoneConfig } from "@alife-sdk/hazards/zone";
```

## What you usually do

Most games do not construct zones directly.

The common path is:

1. author `IHazardZoneConfig`
2. pass it to `HazardManager.addZone()`
3. let the manager drive timers and event emission

Direct `HazardZone` usage matters when you need to understand timer behavior or build a custom manager loop.

## `IHazardZoneConfig` in practice

The fields that define runtime behavior are:

- `id`
- `type`
- `x`, `y`, `radius`
- `damagePerSecond`
- `damageTickIntervalMs`
- `artefactChance`
- `artefactSpawnCycleMs`
- `maxArtefacts`
- optional `entityFilter`
- optional `expiresAtMs`

Defaults that matter:

- `damageTickIntervalMs` defaults to `500`
- `artefactSpawnCycleMs` defaults to `60_000`

## Minimal setup

### Zone example

```ts
manager.addZone({
  id: "rad_lake",
  type: "radiation",
  x: 400,
  y: 300,
  radius: 80,
  damagePerSecond: 8,
  damageTickIntervalMs: 500,
  artefactChance: 0.15,
  artefactSpawnCycleMs: 60_000,
  maxArtefacts: 3,
});
```

### Temporary zone example

```ts
manager.addZone({
  id: "psi_burst",
  type: "psi",
  x: 300,
  y: 300,
  radius: 100,
  damagePerSecond: 15,
  artefactChance: 0,
  maxArtefacts: 0,
  expiresAtMs: 5_000,
  entityFilter: (entity) => entity.id !== "robot_01",
});
```

## What the zone owns

One zone owns:

- world-space circle
- resolved damage-per-tick amount
- internal damage timer
- internal artefact timer
- current artefact count
- capacity check
- optional expiry cutoff

That is why zones behave like runtime actors, not just config blobs.

## Timer model

Zones use carry-over timers.

If a frame spans multiple intervals, the zone can process multiple damage or spawn cycles without losing the remainder. This is the key rule that keeps hazards deterministic when `deltaMs` is uneven.

## Validation rules

The constructor fails fast on invalid config:

- `radius <= 0`
- `damagePerSecond < 0`
- `artefactChance` outside `[0, 1]`
- `maxArtefacts < 0`

That means bad zone data should fail at boot time, not halfway through gameplay.

## Direct API you will care about

If you ever use `HazardZone` directly, the important methods are:

- `advance(deltaMs)`
- `isDamageTickReady()`
- `consumeDamageTick()`
- `getDamagePerTick()`
- `isArtefactSpawnReady()`
- `consumeArtefactCycle()`
- `containsPoint(x, y)`
- `notifyArtefactAdded()`
- `notifyArtefactRemoved()`

## Failure patterns

- authoring zones like static decoration and never testing their runtime cadence
- choosing radius, damage, and interval values that make the zone effectively invisible or unfair
- assuming expiry is only visual even though it changes the runtime loop
- forgetting that the zone type string also becomes the damage type used by immunity logic

## Related pages

- [Hazards package](/docs/packages/hazards)
- [Hazard Manager](/docs/reference/hazards/manager)
- [Artefacts](/docs/reference/hazards/artefacts)
