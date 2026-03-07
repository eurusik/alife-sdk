# @alife-sdk/core

This is the foundation package. Every other package builds on top of it.

## Install

```bash
npm install @alife-sdk/core
```

## Add it when

- you need the kernel and typed event system
- you want factions, smart terrains, or ports before adding heavier runtime layers
- you are building on a custom engine and want engine-agnostic contracts

## What this package does not do

- it does not give you off-screen living NPC simulation by itself
- it does not render sprites or own your scene graph
- it does not replace your engine adapters
- it does not give you full online combat AI without the higher packages

## Minimal kernel setup

```ts
import { ALifeKernel, Ports } from "@alife-sdk/core";

const kernel = new ALifeKernel();

kernel.provide(Ports.EntityAdapter, myEntityAdapter);
kernel.provide(Ports.EntityFactory, myEntityFactory);
kernel.provide(Ports.PlayerPosition, myPlayerPositionProvider);

kernel.init();
kernel.start();

function update(deltaMs: number): void {
  kernel.update(deltaMs);
}
```

## Start here

1. [Core Reference](/docs/reference/core/index)
2. [Kernel](/docs/concepts/kernel)
3. [Ports](/docs/concepts/ports)

## Most used

- [Core Events Reference](/docs/reference/core/events)
- [Core Plugins Reference](/docs/reference/core/plugins)
- [Core Entities Reference](/docs/reference/core/entities)

## Debug this package

- Event delivery feels wrong -> [Core Events Reference](/docs/reference/core/events)
- Runtime ownership is blurry -> [Core Plugins Reference](/docs/reference/core/plugins)
- Scene objects do not map cleanly into the SDK -> [Core Entities Reference](/docs/reference/core/entities)

## What you usually add next

| If you need... | Add... |
|---|---|
| Off-screen living NPCs | [`@alife-sdk/simulation`](/docs/packages/simulation) |
| Real-time nearby combat AI | [`@alife-sdk/ai`](/docs/packages/ai) |
| Phaser integration | [`@alife-sdk/phaser`](/docs/packages/phaser) |

## Package README

- [Package README](https://github.com/eurusik/alife-sdk/blob/main/packages/alife-core/README.md)

## Related pages

- [Core Reference](/docs/reference/core/index)
- [Simulation package](/docs/packages/simulation)
- [Ports](/docs/concepts/ports)
