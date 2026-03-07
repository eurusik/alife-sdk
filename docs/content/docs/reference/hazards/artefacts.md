# Artefacts

Use this page when hazards should produce collectible rewards instead of only damage.

The artefact subsystem is intentionally separate from zone logic: hazards decide when a spawn attempt happens, while the artefact layer decides what can spawn and how it is selected.

## Import path

```ts
import {
  ArtefactRegistry,
  ArtefactSpawner,
  WeightedArtefactSelector,
} from "@alife-sdk/hazards/artefact";
import type {
  IArtefactDefinition,
  IArtefactSelector,
} from "@alife-sdk/hazards/artefact";
```

## Minimal usage

```ts
const selector = new WeightedArtefactSelector(random);
const registry = new ArtefactRegistry(selector);

registry
  .register({ id: "soul", zoneTypes: ["radiation"], weight: 3 })
  .register({ id: "jellyfish", zoneTypes: ["radiation", "psi"], weight: 1 })
  .freeze();

const spawner = new ArtefactSpawner(
  registry,
  {
    create(event) {
      scene.spawnArtefact(event.artefactId, event.x, event.y);
    },
  },
  random,
);
```

## What each piece owns

| Piece | Responsibility |
|---|---|
| `ArtefactRegistry` | catalogue of all artefact definitions |
| selector | choose one valid candidate for a zone type |
| `ArtefactSpawner` | apply chance, capacity, and spawn-position rules |
| `IArtefactFactory` | your engine-side pickup creation |

## Registry rule

The registry is usually loaded once at boot and then frozen.

That matters because runtime mutation of the artefact catalogue is usually a source of inconsistency, not flexibility.

## Spawn rule

A spawn succeeds only if:

- the zone is not at artefact capacity
- the zone's artefact chance roll passes
- the registry has a valid candidate for the zone type

Only then does the factory create the actual pickup in your engine.

## Why the factory seam matters

The SDK should decide spawn logic.

Your game should decide:

- what pickup object is created
- how it is rendered
- how collection is represented in the engine

That boundary keeps hazards testable and renderer-agnostic.

## Practical usage rule

Keep the zone type strings consistent across:

- hazard zones
- artefact definitions
- any immunity or damage-type logic that also keys by type

If those strings drift, artefact spawning looks randomly broken when the real issue is simple key mismatch.

## Failure patterns

- registry is never frozen, so artefact content mutates unexpectedly at runtime
- zone type strings and artefact `zoneTypes` compatibility do not match
- pickup creation works visually but collection is never reported back to the hazard manager
- teams debug spawn chance when the real issue is that no compatible artefact exists for the zone type

## Related pages

- [Hazards package](/docs/packages/hazards)
- [Hazard Manager](/docs/reference/hazards/manager)
- [Hazard Zones](/docs/reference/hazards/zones)
