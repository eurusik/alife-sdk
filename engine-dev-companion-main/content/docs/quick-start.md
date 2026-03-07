# Quick Start

This page has two jobs:

- help you decide whether the SDK fits your game at all
- get one small living-world proof running before you scale the integration

## Start here

Choose the path that matches your situation right now:

1. If you are still qualifying the SDK, open [Is This For Me?](/guides/is-this-for-me)
2. If you want the fastest honest proof, follow **Path A: Evaluate the SDK first**
3. If you already know you are integrating, jump to **Path B: Phaser 3** or **Path C: Custom engine**

## Path A: Evaluate the SDK first

This is the best route for most teams.

You are not trying to finish the whole integration here. You are trying to answer one question:

**Can this runtime produce one believable living-world loop before I wire my game around it?**

### What you will prove

- one terrain exists as world state
- one NPC can be registered cleanly
- one tick advances the runtime
- one event appears in observable output
- the SDK model makes sense before you touch scene code

### Run the headless proof

```bash
pnpm install
pnpm build:sdk
npx tsx --tsconfig examples/tsconfig.json examples/18-full-npc.ts
```

Then open:

- [`examples/18-full-npc.ts`](https://github.com/eurusik/alife-sdk/blob/main/examples/18-full-npc.ts)
- [Examples guide](/examples/)

### What success looks like

- the script runs without bootstrapping errors
- you can follow the NPC lifecycle in code and console output
- the event stream feels like a runtime you could debug in production
- the package split makes sense to your team

If this already feels too heavy, step down to [First Living World](/guides/first-living-world) and prove one smaller in-memory loop first.

## Path B: I use Phaser 3

Use this path when you already know the SDK fits and you want the shortest route into a scene.

### Install the minimum practical stack

```bash
npm install @alife-sdk/core @alife-sdk/simulation @alife-sdk/ai @alife-sdk/social @alife-sdk/phaser
npm install phaser@^3.60.0
```

### Aim for one successful scene first

Your first scene only needs to prove:

- `kernel.init()` succeeds
- `kernel.start()` succeeds
- `kernel.update(delta)` runs every frame
- one terrain exists
- one NPC is registered
- one visible event or handoff can be observed

### Minimal useful setup

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

Use this route when Phaser is not part of your stack and you want the cleanest possible engine boundary.

### Start with the smallest package set

```bash
npm install @alife-sdk/core @alife-sdk/simulation
```

Add `@alife-sdk/ai` only after the online/offline loop is already stable.

### Prove the runtime before the ports

The safest custom-engine flow is:

1. run the headless evaluation path first
2. prove one in-memory world with [First Living World](/guides/first-living-world)
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
- Need the smallest possible proof: [First Living World](/guides/first-living-world)
- Need symptom-based debugging: [Troubleshooting](/guides/troubleshooting)

## Docs commands

```bash
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
```
