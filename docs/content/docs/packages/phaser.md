# @alife-sdk/phaser

This package provides the Phaser-specific adapters and bootstrap helpers.

## Install

```bash
npm install @alife-sdk/phaser @alife-sdk/core @alife-sdk/simulation @alife-sdk/ai @alife-sdk/social
npm install phaser@^3.60.0
```

## Add it when

- you are building on Phaser 3
- you want prebuilt adapters
- you want to wire one scene instead of building every port from scratch

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

- Scene bootstrap is failing or incomplete -> [createPhaserKernel](/docs/reference/phaser/create-phaser-kernel)
- Sprites or HP records are desynced -> [Phaser Adapters](/docs/reference/phaser/adapters)
- NPCs never switch ownership correctly -> [OnlineOfflineManager](/docs/reference/phaser/online-offline-manager)

## Default first preset

`preset: "simulation"` is a good default for a first integration. It lets you verify the world loop without adding AI and social packages immediately.

## Package README

- [Package README](https://github.com/eurusik/alife-sdk/blob/main/packages/alife-phaser/README.md)

## Related pages

- [Phaser Reference](/docs/reference/phaser/index)
- [Phaser Integration](/docs/guides/phaser-integration)
- [AI package](/docs/packages/ai)
