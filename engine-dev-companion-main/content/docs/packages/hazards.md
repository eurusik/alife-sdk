# @alife-sdk/hazards

This package adds environmental danger and artefact reward loops.

It is for the part of your world that should matter even when no enemy is actively shooting: anomaly fields, radiation pockets, fire zones, or any other dangerous space that should change movement, tactics, and reward.

## Install

```bash
npm install @alife-sdk/hazards @alife-sdk/core
```

## What it gives you

- circular hazard zones
- periodic damage application
- immunity-aware damage handling
- artefact spawn logic and hazard events

## Add it when

- the environment should shape movement and risk
- hazards should affect NPCs and players alike
- dangerous places should also be interesting places

## The integration shape

The package is engine-agnostic because you provide:

- the live entity list each frame
- one artefact creation callback

Typical loop:

```ts
kernel.update(deltaMs);
hazards.manager.tick(deltaMs, world.getLiveEntities());
```

## A minimal setup

```ts
const hazards = new HazardsPlugin(random, createDefaultHazardsConfig({
  zones: anomaliesJson,
  artefactFactory: {
    create(ev) {
      world.spawnPickup(ev.artefactId, ev.x, ev.y);
    },
  },
}));

kernel.use(hazards);
kernel.init();

hazards.events.on(HazardEvents.HAZARD_DAMAGE, ({ entityId, damage, zoneType }) => {
  world.getEntity(entityId)?.takeDamage(damage, zoneType);
});
```

## Important note

`HazardsPlugin.update()` is intentionally a no-op. Only your host code knows how to fetch the live entities, so you call `manager.tick(...)` manually.

## What your entities need

The manager consumes a minimal shape:

- an ID
- a world position
- optional immunity data
- optional liveness check

That keeps the package decoupled from any specific engine or ECS model.

## What to listen to

- hazard damage events
- artefact spawn events
- artefact collected events
- zone expiry events

## What your game still owns

- actual damage presentation
- hazard visuals and VFX
- pickup rendering and collection UX
- authored meaning of each artefact

## Common first-time mistakes

### Forgetting `manager.tick(...)`

The plugin does not advance hazards automatically from the kernel alone.

### Expecting hazard rendering out of the box

This package owns logic and events, not zone visuals.

### Adding hazards before damage and immunity are meaningful

Hazards are much more useful once HP and resistance handling already make sense in your game.

## Read next

- [Gameplay Systems](/guides/gameplay-systems)
- [Package README](https://github.com/eurusik/alife-sdk/blob/main/packages/alife-hazards/README.md)
