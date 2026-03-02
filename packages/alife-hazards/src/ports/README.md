# ports

Narrow interfaces the hazard SDK calls into your engine. You implement them once;
the SDK never imports Phaser, PixiJS, or any other runtime.

```ts
import type { IArtefactFactory, IArtefactSpawnEvent } from '@alife-sdk/hazards/ports';
```

---

## What's in this module

| Export | Kind | Implemented by |
|--------|------|----------------|
| `IArtefactFactory` | interface | **You** — creates game objects when artefacts spawn |
| `IArtefactSpawnEvent` | interface | SDK — passed to `IArtefactFactory.create()` |

---

## IArtefactFactory

The only port in this module. The SDK decides **when** and **where** to spawn an
artefact; you decide **how** to materialise it in your game world:

```ts
interface IArtefactFactory {
  create(event: IArtefactSpawnEvent): void;
}
```

Pass your implementation when creating `HazardsPlugin` or `HazardManager`:

```ts
const hazards = new HazardsPlugin(random, {
  artefactFactory: {
    create(event) {
      // your code here — create a pickup, sprite, entity, etc.
    },
  },
});
```

### `IArtefactSpawnEvent` — what you receive

```ts
interface IArtefactSpawnEvent {
  artefactId: string;          // matches IArtefactDefinition.id
  zoneId:     string;          // which zone triggered the spawn
  zoneType:   HazardZoneType;  // 'fire' | 'radiation' | 'chemical' | 'psi' | …
  x:          number;          // world position x (60–95% of zone radius from centre)
  y:          number;          // world position y
}
```

---

## Implementing the port

### Phaser example

```ts
import type { IArtefactFactory, IArtefactSpawnEvent } from '@alife-sdk/hazards/ports';

class PhaserArtefactFactory implements IArtefactFactory {
  private readonly pickups = new Map<string, Phaser.GameObjects.Sprite>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly onCollect: (instanceId: string, event: IArtefactSpawnEvent) => void,
  ) {}

  create(event: IArtefactSpawnEvent): void {
    const instanceId = crypto.randomUUID();
    const sprite = this.scene.physics.add.sprite(event.x, event.y, event.artefactId);

    sprite.setData('instanceId', instanceId);
    sprite.setData('artefactId', event.artefactId);
    sprite.setData('zoneId',     event.zoneId);

    this.pickups.set(instanceId, sprite);

    // When the player overlaps, destroy sprite and notify the manager
    this.scene.physics.add.overlap(this.scene.player, sprite, () => {
      sprite.destroy();
      this.pickups.delete(instanceId);
      this.onCollect(instanceId, event);
    });
  }
}
```

Wire the collect callback back into the manager:

```ts
const factory = new PhaserArtefactFactory(scene, (instanceId, ev) => {
  hazards.manager.notifyArtefactCollected(
    ev.zoneId,
    instanceId,
    ev.artefactId,
    player.id,
  );
});
```

### Plain-object example (Node.js / testing)

```ts
const spawnedArtefacts: IArtefactSpawnEvent[] = [];

const factory: IArtefactFactory = {
  create(event) {
    spawnedArtefacts.push(event);
  },
};
```

---

## Responsibility boundary

```
SDK (ArtefactSpawner)                     You (IArtefactFactory)
─────────────────────────────────────────────────────────────────
trySpawn(zone)
  ├─ capacity + lottery check
  ├─ pick artefact definition
  ├─ sample position (60–95% radius)
  └─ factory.create(event)  ──────────────→  create game object
                                              track instanceId

Player collects pickup  ←───────────────────  your pickup logic
                                              call notifyArtefactCollected()
                         ──────────────────→  manager decrements zone counter
                                              emits hazard:artefact_collected
```

The SDK never tracks individual artefact instances in the world — that is your
engine's concern. The `instanceId` you choose is opaque to the SDK; it is echoed
back in the `hazard:artefact_collected` event so you can cross-reference it.
