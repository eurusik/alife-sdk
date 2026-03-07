# Phaser Reference

Use this track when you are integrating the SDK into a real Phaser scene and need to know which layer owns what.

The Phaser package is not a separate runtime model. It is the adapter layer that connects scene objects, player position, spawn/despawn callbacks, and online/offline switching to the core SDK runtime.

## Start here

- [createPhaserKernel](/docs/reference/phaser/create-phaser-kernel) -> wire the kernel shell and return the scene-facing runtime objects
- [Phaser Adapters](/docs/reference/phaser/adapters) -> understand how sprites, HP records, social presenters, and player position bridge into SDK ports
- [OnlineOfflineManager](/docs/reference/phaser/online-offline-manager) -> manage ownership switching for observed NPCs

That order matches the actual integration flow:

1. wire the kernel shell
2. provide concrete scene adapters
3. manage ownership switching for observed NPCs

## Browse by task

- "How do I wire the scene fast?" -> [createPhaserKernel](/docs/reference/phaser/create-phaser-kernel)
- "How do sprites and HP records talk to the SDK?" -> [Phaser Adapters](/docs/reference/phaser/adapters)
- "How do NPCs switch between offline and observed behavior?" -> [OnlineOfflineManager](/docs/reference/phaser/online-offline-manager)

## What this track covers

- one-call scene wiring through `createPhaserKernel`
- adapter responsibilities and runtime boundaries
- online/offline switching in a Phaser-hosted scene
- where Phaser-specific code stops and core SDK runtime begins

## What belongs to your scene

Your game still owns:

- sprite creation and destruction
- scene-specific animation and presentation
- player sprite or player position source
- when ownership switching is evaluated
- any extra UI, FX, or input code

The SDK owns:

- kernel lifecycle
- plugin runtime
- offline simulation logic
- event flow
- the online AI contract once you provide a valid host/context seam

## Related pages

- [Phaser package](/docs/packages/phaser)
- [Phaser Integration guide](/docs/guides/phaser-integration)
- [Examples](/docs/examples/index)
