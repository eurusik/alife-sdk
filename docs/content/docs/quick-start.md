# Quick Start

Use this page to decide whether A-Life SDK fits your game and to verify one minimal living-world loop before full integration.

## Start here

Choose one route:

1. Still evaluating the SDK: open [Is This For Me?](/guides/is-this-for-me)
2. Need the smallest proof first: follow **Path A: Evaluate the runtime**
3. Integrating into Phaser 3: jump to **Path B: Phaser 3**
4. Integrating into another engine: jump to **Path C: Custom engine**

## Path A: Evaluate the runtime

Use this route to prove one living-world loop before wiring scene code.

### Goal

Confirm that the runtime can advance one world state update cleanly enough to justify deeper integration.

### Run

```bash
pnpm install
pnpm build:sdk
npx tsx --tsconfig examples/tsconfig.json examples/18-full-npc.ts
```

Then open:

- [`examples/18-full-npc.ts`](https://github.com/eurusik/alife-sdk/blob/main/examples/18-full-npc.ts)
- [Examples guide](/examples/)

### Verify

- one terrain exists in world state
- one NPC registers without setup errors
- one tick advances the runtime
- at least one kernel event appears in the console or event log
- you understand which runtime ports your scene will need to provide

### Next

If this route still feels too large, step down to [First Living World](/guides/first-living-world) and verify the smallest in-memory loop first.

## Path B: I use Phaser 3

Use this route when you already know the SDK fits and you want the smallest scene-level integration.

### Goal

Boot one Phaser scene where the kernel starts, one NPC is registered, and one visible runtime signal confirms the scene is alive.

### Install

```bash
npm install @alife-sdk/core @alife-sdk/simulation @alife-sdk/ai @alife-sdk/social @alife-sdk/phaser
npm install phaser@^3.60.0
```

### Verify

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

### Next

Then move directly to [Phaser Integration](/guides/phaser-integration).

## Path C: I use a custom engine

Use this route when Phaser is not part of your stack and you want a direct engine boundary through ports.

### Goal

Prove the runtime headlessly first, then map the required ports to your engine with the smallest possible surface area.

### Install

```bash
npm install @alife-sdk/core @alife-sdk/simulation
```

Add `@alife-sdk/ai` only after the online/offline loop is already stable.

### Run

A low-risk custom-engine sequence is:

1. run the headless evaluation path first
2. verify one in-memory world with [First Living World](/guides/first-living-world)
3. only then implement your real ports and bridges

### Minimal setup

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

### Verify

- the kernel starts without validation errors
- the required runtime ports are clear enough to map to your engine
- your update loop can call `kernel.update(deltaMs)` reliably
- you know where online/offline ownership will be decided

### Next

Then open [Custom Engine](/guides/custom-engine) for the real contract details.

## Before you add more systems

Before adding hazards, social, economy, or save/load, verify these signals:

- the kernel starts without validation errors
- one terrain exists
- one NPC exists
- one tick advances
- one event can be observed

If one of these is missing, do not add hazards, social, economy, or save/load yet.

## Next

- Evaluating fit: [Is This For Me?](/guides/is-this-for-me)
- Need package selection help: [Choose Your Stack](/guides/choose-your-stack)
- Need the smallest runtime proof: [First Living World](/guides/first-living-world)
- Using Phaser 3: [Phaser Integration](/guides/phaser-integration)
- Using another engine: [Custom Engine](/guides/custom-engine)
- Need symptom-based debugging: [Troubleshooting](/guides/troubleshooting)

## Docs commands

```bash
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
```
