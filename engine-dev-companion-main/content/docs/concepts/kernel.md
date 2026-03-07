# Kernel

`ALifeKernel` is the central coordinator for the SDK. It owns the event bus, game clock, plugin list, and port registry.

Nothing in the SDK needs Phaser or another renderer directly. Everything flows through the kernel.

## What the kernel does

- Registers the ports your game provides
- Installs plugins in dependency order
- Initializes and starts the runtime
- Flushes deferred events on `update()`
- Serializes and restores shared state

## Lifecycle

The normal lifecycle is:

```ts
kernel.provide(...);
kernel.use(...);
kernel.init();
kernel.start();
kernel.update(deltaMs);
kernel.destroy();
```

## Why it matters

The kernel gives every plugin a shared execution model. That means simulation, AI, social, economy, and hazards can cooperate through typed events and shared services instead of importing each other directly.

## Typical setup

```ts
import { ALifeKernel, Ports } from '@alife-sdk/core';

const kernel = new ALifeKernel();

kernel.provide(Ports.EntityAdapter, myEntityAdapter);
kernel.provide(Ports.EntityFactory, myEntityFactory);
kernel.provide(Ports.PlayerPosition, myPlayerPositionProvider);

kernel.use(myPlugin);

kernel.init();
kernel.start();
```

## Kernel responsibilities vs your game

| SDK kernel owns | Your game owns |
|---|---|
| Plugin lifecycle | Actual entities, sprites, physics bodies |
| Typed event dispatch | Rendering, animation playback, input |
| Shared world state | Concrete adapter implementations |
| Serialization hooks | Scene composition and UX |

## When not to overuse it

The kernel is a runtime coordinator, not a dumping ground. Game-specific scene state, UI state, and presentation logic should stay in your game code and only cross the boundary through explicit ports.
