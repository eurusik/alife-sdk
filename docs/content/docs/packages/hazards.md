# @alife-sdk/hazards

This package adds environmental danger and artefact reward loops.

## Install

```bash
npm install @alife-sdk/hazards @alife-sdk/core
```

## Add it when

- the environment should shape movement and risk
- hazards should affect NPCs and players alike
- dangerous places should also be interesting places

## Integration shape

The package is engine-agnostic because you provide:

- the live entity list each frame
- one artefact creation callback

Typical host loop:

```ts
kernel.update(deltaMs);
hazards.manager.tick(deltaMs, world.getLiveEntities());
```

## Start here

1. [Hazards Reference](/docs/reference/hazards/index)
2. [Hazard Manager](/docs/reference/hazards/manager)
3. [Hazard Zones](/docs/reference/hazards/zones)

## Most used

- [Artefacts](/docs/reference/hazards/artefacts)
- [Gameplay Systems](/docs/guides/gameplay-systems)

## Debug this package

- Hazards never advance -> [Hazard Manager](/docs/reference/hazards/manager)
- Damage cadence or expiry feels wrong -> [Hazard Zones](/docs/reference/hazards/zones)
- Pickups never appear or never reconcile -> [Artefacts](/docs/reference/hazards/artefacts)

## Important note

`HazardsPlugin.update()` is intentionally a no-op. Only your host knows how to fetch live entities, so `manager.tick(...)` stays explicit.

## Package README

- [Package README](https://github.com/eurusik/alife-sdk/blob/main/packages/alife-hazards/README.md)

## Related pages

- [Hazards Reference](/docs/reference/hazards/index)
- [Gameplay Systems](/docs/guides/gameplay-systems)
- [Simulation package](/docs/packages/simulation)
