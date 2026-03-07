# @alife-sdk/phaser

This is the cleanest route from the SDK to a visible Phaser 3 scene.

## Install

```bash
npm install @alife-sdk/phaser @alife-sdk/core @alife-sdk/simulation @alife-sdk/ai @alife-sdk/social
npm install phaser@^3.60.0
```

## What it gives you

- `createPhaserKernel()`
- `PhaserEntityAdapter`
- `PhaserEntityFactory`
- `PhaserSimulationBridge`
- `PhaserPlayerPosition`
- `OnlineOfflineManager`

## Use it when

- you are building on Phaser 3
- you want a batteries-included adapter layer
- you would rather wire one scene cleanly than build every port from scratch

## A minimal useful scene

```ts
import { createDefaultBehaviorConfig } from '@alife-sdk/simulation';

const result = createPhaserKernel({
  ports: {
    entityAdapter: adapter,
    entityFactory: factory,
    playerPosition: new PhaserPlayerPosition(player),
    simulationBridge: bridge,
  },
  data: {
    factions: [{ id: 'stalker', displayName: 'Stalker' }],
    terrains: [campTerrain],
  },
  config: { preset: 'simulation' },
});

const { kernel, simulation } = result;
kernel.init();
kernel.start();

simulation!.registerNPC({
  entityId: 'stalker_1',
  factionId: 'stalker',
  position: { x: 300, y: 280 },
  rank: 2,
  combatPower: 40,
  currentHp: 100,
  behaviorConfig: createDefaultBehaviorConfig({
    retreatThreshold: 0.3,
    panicThreshold: -0.6,
  }),
  options: { type: 'human' },
});
```

## Presets

| Preset | Includes | Use it when |
|---|---|---|
| `minimal` | Basic kernel-side setup | You are still assembling the shell |
| `simulation` | Adds simulation | Best first preset for most teams |
| `full` | Adds AI and social plugins | You want a richer playable slice |

## Typical scene setup

1. Create the player sprite
2. Instantiate the adapters
3. Call `createPhaserKernel()`
4. Register terrains, factions, and NPCs
5. Call `kernel.update(delta)` every frame
6. Evaluate online/offline transitions on a cadence that fits your scene

## What each adapter is for

| Adapter | Purpose |
|---|---|
| `PhaserEntityAdapter` | Sprite registry and entity mutation bridge |
| `PhaserEntityFactory` | Spawn/destroy entities through callbacks |
| `PhaserSimulationBridge` | HP and offline-damage bridge |
| `PhaserPlayerPosition` | Live player world position |
| `OnlineOfflineManager` | Pure online/offline transition decisions |

## Required habits in your scene

### Always drive the kernel

```ts
update(_time: number, delta: number): void {
  kernel.update(delta);
}
```

### Evaluate online/offline transitions explicitly

```ts
const { goOnline, goOffline } = onlineOffline.evaluate(player.x, player.y, records);

for (const id of goOnline) simulation!.setNPCOnline(id, true);
for (const id of goOffline) simulation!.setNPCOnline(id, false);
```

## Common mistakes

- forgetting `kernel.update(delta)` in `Scene.update()`
- passing Phaser's `time` instead of `delta`
- never calling `OnlineOfflineManager.evaluate()`
- registering an NPC before the sprite is known to the adapter
- omitting `behaviorConfig` in `registerNPC(...)`
- starting with `preset: 'full'` before the scene shell is stable

## Recommended starting preset

`preset: 'simulation'` is the most practical default for first-time adoption. It proves the world loop without forcing the full stack immediately.

## Read next

- [Phaser Integration](/guides/phaser-integration)
- [Examples](/examples/)
- [Package README](https://github.com/eurusik/alife-sdk/blob/main/packages/alife-phaser/README.md)
