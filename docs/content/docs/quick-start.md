# Quick Start

This page helps you do two things:

- help you decide whether the SDK fits your game at all
- run one small living-world check before you scale the integration

## Start here

Choose the path that matches your situation right now:

1. If you are still qualifying the SDK, open [Is This For Me?](/guides/is-this-for-me)
2. If you want the smallest evaluation flow, follow **Path A: Evaluate the SDK first**
3. If you already know you are integrating, jump to **Path B: Phaser 3** or **Path C: Custom engine**

## Path A: Evaluate the SDK first

Start here if you want to evaluate the runtime before wiring scene code.

You are not trying to finish the whole integration here. You are trying to answer one question:

**Can this runtime produce one working living-world loop before I wire my game around it?**

### What you should verify

Before you touch scene code, you should be able to confirm that:

- one terrain exists in world state
- one NPC registers without setup errors
- one tick advances the runtime
- one event appears in observable output
- the SDK model is clear enough to wire into your scene

### Run the headless check

```bash
pnpm install
pnpm build:sdk
npx tsx --tsconfig examples/tsconfig.json examples/18-full-npc.ts
```

Then open:

- [`examples/18-full-npc.ts`](https://github.com/eurusik/alife-sdk/blob/main/examples/18-full-npc.ts)
- [Examples guide](/examples/)

### What to look for

- the script runs without bootstrapping errors
- you can follow the NPC lifecycle in code and console output
- the event stream is detailed enough to debug runtime state
- the package split makes sense for your integration

If this is still too much at once, step down to [First Living World](/guides/first-living-world) and verify one smaller in-memory loop first.

## Path B: I use Phaser 3

Use this path when you already know the SDK fits and you want a minimal path into a scene.

### Install the minimum stack

```bash
npm install @alife-sdk/core @alife-sdk/simulation @alife-sdk/ai @alife-sdk/social @alife-sdk/phaser
npm install phaser@^3.60.0
```

### First scene goal

Your first scene only needs to confirm:

- `kernel.init()` succeeds
- `kernel.start()` succeeds
- `kernel.update(delta)` runs every frame
- one terrain exists
- one NPC is registered
- one visible event or handoff can be observed

### Minimal setup

```ts
import {
  createPhaserKernel,
  PhaserEntityAdapter,
  PhaserEntityFactory,
  PhaserPlayerPosition,
  PhaserSimulationBridge,
} from "@alife-sdk/phaser";

const adapter = new PhaserEntityAdapter();
const factory = new PhaserEntityFactory({ createNPC, createMonster, destroyEntity });
const playerPosition = new PhaserPlayerPosition(playerSprite);
const bridge = new PhaserSimulationBridge();

const { kernel, simulation } = createPhaserKernel({
  ports: {
    entityAdapter: adapter,
    entityFactory: factory,
    playerPosition,
    simulationBridge: bridge,
  },
  config: { preset: "simulation" },
});

kernel.init();
kernel.start();
```

Then move directly to [Phaser Integration](/guides/phaser-integration).

## Path C: I use a custom engine

Use this route when Phaser is not part of your stack and you want a direct engine boundary.

### Start with the smallest package set

```bash
npm install @alife-sdk/core @alife-sdk/simulation
```

Add `@alife-sdk/ai` only after the online/offline loop is already stable.

### Prove the runtime before the ports

A low-risk custom-engine flow is:

1. run the headless evaluation path first
2. verify one in-memory world with [First Living World](/guides/first-living-world)
3. only then implement your real ports and bridges

### Minimal engine boundary

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

Then open [Custom Engine](/guides/custom-engine) for the real contract details.

## Before you add more systems

Stop and verify these signals first:

- the kernel starts without validation errors
- one terrain exists
- one NPC exists
- one tick advances
- one event can be observed

If one of these is missing, do not add hazards, social, economy, or save/load yet.

## If you are still unsure

- Need a fit check first: [Is This For Me?](/guides/is-this-for-me)
- Need package selection help: [Choose Your Stack](/guides/choose-your-stack)
- Need the smallest runtime check: [First Living World](/guides/first-living-world)
- Need symptom-based debugging: [Troubleshooting](/guides/troubleshooting)

## Docs commands

```bash
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
```
