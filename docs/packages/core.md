# @alife-sdk/core

This is the foundation package. Every other package builds on top of it.

## Install

```bash
npm install @alife-sdk/core
```

## What it gives you

| Area | What you get |
|---|---|
| Runtime shell | `ALifeKernel`, lifecycle, plugin host |
| Engine boundary | ports, tokens, adapter contracts |
| Shared world model | factions, smart terrains, events, time, navigation |
| AI primitives | state machine, memory bank, GOAP planner, danger tracking |
| Infrastructure | registries, schema helpers, logger, diagnostics |

## Use it when

- you want the kernel and event system
- you need factions, smart terrains, or typed events even before adding simulation
- you want to build on a custom engine without dragging in renderer-specific code
- you want AI utilities like FSM or GOAP even outside the full living-world stack

## A minimal kernel setup

```ts
import { ALifeKernel, Ports } from '@alife-sdk/core';

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

## What you usually add next

| If you need... | Add... |
|---|---|
| Off-screen living NPCs | [`@alife-sdk/simulation`](/packages/simulation) |
| Real-time nearby combat AI | [`@alife-sdk/ai`](/packages/ai) |
| Phaser integration | [`@alife-sdk/phaser`](/packages/phaser) |

## Required vs optional ports

| Port | Typical status |
|---|---|
| `Ports.EntityAdapter` | Usually required in real integrations |
| `Ports.EntityFactory` | Usually required in real integrations |
| `Ports.PlayerPosition` | Usually required in real integrations |
| `Ports.RuntimeClock` | Optional, SDK provides a default |
| `Ports.Random` | Optional, SDK provides a default |

If you only want to explore the model first, the simulation package's `createInMemoryKernel()` is a better learning entry point than wiring all ports on day one.

## Most useful subpaths

| Import path | Reach for it when |
|---|---|
| `@alife-sdk/core` | Kernel, ports, runtime types |
| `@alife-sdk/core/ai` | FSM, memory, GOAP, danger helpers |
| `@alife-sdk/core/events` | Typed event definitions |
| `@alife-sdk/core/terrain` | Smart terrains and zones |
| `@alife-sdk/core/faction` | Faction setup |
| `@alife-sdk/core/plugins` | Built-in and custom plugins |

## What `core` does not do by itself

- It does not run the off-screen NPC world loop
- It does not provide the ready-to-use online AI driver layer
- It does not know about Phaser

That separation is intentional. Many games need the kernel, events, factions, or AI primitives before they need the full runtime stack.

## What to verify early

- kernel initializes cleanly
- update loop is running
- events can be subscribed to
- factions or terrains can be registered without engine-specific code leaking into the runtime layer

## Common first-time mistakes

- treating the kernel like a giant service locator instead of a runtime coordinator
- pushing scene/UI logic into plugins that should stay in game code
- wiring engine behavior directly into core logic instead of isolating it in adapters

## Read next

- [Kernel](/concepts/kernel)
- [Ports](/concepts/ports)
- [Simulation package](/packages/simulation)
- [Package README](https://github.com/eurusik/alife-sdk/blob/main/packages/alife-core/README.md)
