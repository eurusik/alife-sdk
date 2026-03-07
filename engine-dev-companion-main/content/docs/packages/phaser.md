# @alife-sdk/phaser

This is the cleanest route from the SDK to a visible Phaser 3 scene.

## Install

```bash
npm install @alife-sdk/phaser @alife-sdk/core @alife-sdk/simulation @alife-sdk/ai @alife-sdk/social
npm install phaser@^3.60.0
```

## Add it when

- you are building on Phaser 3
- you want a batteries-included adapter layer
- you would rather wire one scene cleanly than build every port from scratch

## Typical scene setup

1. create the player sprite
2. instantiate the adapters
3. call `createPhaserKernel()`
4. register terrains, factions, and NPCs
5. call `kernel.update(delta)` every frame
6. evaluate online/offline transitions on a cadence that fits the scene

## Start here

1. [Phaser Reference](/docs/reference/phaser/index)
2. [createPhaserKernel](/docs/reference/phaser/create-phaser-kernel)
3. [Phaser Adapters](/docs/reference/phaser/adapters)

## Most used

- [OnlineOfflineManager](/docs/reference/phaser/online-offline-manager)
- [Phaser Integration](/docs/guides/phaser-integration)
- [Examples](/docs/examples/index)

## Debug this package

- Scene shell is not wiring cleanly -> [createPhaserKernel](/docs/reference/phaser/create-phaser-kernel)
- Sprites or HP records are desynced -> [Phaser Adapters](/docs/reference/phaser/adapters)
- NPCs never switch ownership correctly -> [OnlineOfflineManager](/docs/reference/phaser/online-offline-manager)

## Recommended starting preset

`preset: "simulation"` is the most practical default for first-time adoption. It proves the world loop without forcing the full stack immediately.

## Package README

- [Package README](https://github.com/eurusik/alife-sdk/blob/main/packages/alife-phaser/README.md)

## Related pages

- [Phaser Reference](/docs/reference/phaser/index)
- [Phaser Integration](/docs/guides/phaser-integration)
- [AI package](/docs/packages/ai)
