# Phaser Adapters

Use this page when you are wiring Phaser scene objects into SDK ports.

The adapters are not extra gameplay systems. They are bridge objects between package contracts and your scene runtime.

## Import path

```ts
import {
  PhaserEntityAdapter,
  PhaserEntityFactory,
  PhaserSimulationBridge,
  PhaserNPCSocialProvider,
  PhaserSocialPresenter,
  PhaserPlayerPosition,
} from "@alife-sdk/phaser/adapters";
import type {
  IHPRecord,
  ImmunityLookup,
  MoraleCallback,
  IPositionSource,
} from "@alife-sdk/phaser/adapters";
```

## What you create

In a normal Phaser integration you create only the adapters your preset actually needs:

1. `PhaserEntityAdapter` for entity lookup and mutation
2. `PhaserEntityFactory` for spawn/despawn callbacks
3. `PhaserSimulationBridge` when offline HP and damage matter
4. `PhaserNPCSocialProvider` when social systems need online NPC discovery
5. `PhaserSocialPresenter` when NPC lines must become scene UI
6. `PhaserPlayerPosition` for live player coordinates

## Minimal setup

```ts
const entityAdapter = new PhaserEntityAdapter(kernel.logger);
const simulationBridge = new PhaserSimulationBridge(kernel.logger);

const entityFactory = new PhaserEntityFactory({
  createNPC: (request) => {
    const sprite = scene.physics.add.sprite(request.x, request.y, "npc");
    entityAdapter.register(request.entityId, sprite);
    simulationBridge.register(request.entityId, { currentHp: 100, maxHp: 100 });

    return request.entityId;
  },
  createMonster: (request) => {
    const sprite = scene.physics.add.sprite(request.x, request.y, "monster");
    entityAdapter.register(request.entityId, sprite);

    return request.entityId;
  },
  destroyEntity: (entityId) => {
    entityAdapter.getSprite(entityId)?.destroy();
    entityAdapter.unregister(entityId);
    simulationBridge.unregister(entityId);
  },
});

const playerPosition = new PhaserPlayerPosition(playerSprite);
```

## Adapter map

| Adapter | SDK seam |
|---|---|
| `PhaserEntityAdapter` | `IEntityAdapter` |
| `PhaserEntityFactory` | `IEntityFactory` |
| `PhaserSimulationBridge` | `ISimulationBridge` |
| `PhaserNPCSocialProvider` | `INPCSocialProvider` |
| `PhaserSocialPresenter` | `ISocialPresenter` |
| `PhaserPlayerPosition` | `IPlayerPositionProvider` |

## What each adapter owns

### `PhaserEntityAdapter`

Use it as the registry of scene objects by SDK entity ID.

The important operations are:

- `register(id, sprite)`
- `unregister(id)`
- `has(id)`
- `getSprite(id)`
- mutation calls such as `setPosition`, `setVisible`, `playAnimation`

Runtime rule:

every SDK mutation reaches the scene through entity ID, not through direct sprite references stored all over the codebase.

### `PhaserEntityFactory`

Use it when the SDK asks the host to spawn or destroy something.

You provide:

- `createNPC`
- `createMonster`
- `destroyEntity`

That keeps texture keys, prefab decisions, and scene construction inside your game layer.

### `PhaserSimulationBridge`

Use it when offline combat or hazard damage must touch HP owned by the scene.

The important rule from the module contract:

`IHPRecord.currentHp` is mutated in place, so point it at the same health data your scene logic reads.

Optional hooks:

- `setImmunityLookup()`
- `setMoraleCallback()`

### `PhaserNPCSocialProvider`

Use it when social systems need a filtered view of online NPCs plus faction relations and terrain lookups.

### `PhaserSocialPresenter`

Use it when SDK social output must become bubbles, subtitles, or scene events.

### `PhaserPlayerPosition`

Use it when the player source is a sprite or any object exposing readonly `x` and `y`.

You can hot-swap the source after scene restart with `setSource(...)`.

## Lifecycle

The healthy order is:

1. create adapters before kernel wiring
2. register sprites and HP records when entities spawn
3. unregister both when entities despawn
4. keep player position source current after scene reloads
5. keep higher-level game logic outside adapter classes

## Failure patterns

- registering NPCs in simulation before their sprites are known to `PhaserEntityAdapter`
- destroying sprites without unregistering adapter and bridge state
- keeping HP only in scene objects while `PhaserSimulationBridge` points at stale records
- stuffing gameplay decisions into factory callbacks instead of leaving them as spawn/despawn seams
- treating adapters like a second gameplay service layer instead of a narrow bridge

## Related pages

- [Phaser package](/docs/packages/phaser)
- [createPhaserKernel](/docs/reference/phaser/create-phaser-kernel)
- [OnlineOfflineManager](/docs/reference/phaser/online-offline-manager)
