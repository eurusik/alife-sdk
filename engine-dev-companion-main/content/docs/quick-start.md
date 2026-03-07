# Quick Start

Treat this page as your first field test with the SDK.

The goal is not to install every package at once. The goal is to prove one living-world loop, understand what the SDK owns, and only then bring it into your game.

## Before you wire the SDK into your game

- Node.js `>= 20`
- `pnpm` recommended for this repository
- ESM-compatible project setup
- `phaser` installed only if you use `@alife-sdk/phaser`

## Decide what you need to prove first

1. Pick the smallest package set that matches your immediate problem
2. Run one path that gives you visible proof the world is alive
3. Verify one terrain, one NPC, one tick, and one event before adding optional systems

## Choose the package set that fits your game today

| Goal | Install |
|---|---|
| Engine-agnostic kernel only | `@alife-sdk/core` |
| Living off-screen NPCs | `@alife-sdk/core` + `@alife-sdk/simulation` |
| Real-time combat AI for nearby NPCs | add `@alife-sdk/ai` |
| Phaser 3 integration | add `@alife-sdk/phaser` |
| Quests, hazards, social, save/load | add the corresponding opt-in packages |

Need help choosing? Read [Choose Your Stack](/guides/choose-your-stack).

## Install only the layer you need right now

### Phaser 3

```bash
npm install @alife-sdk/core @alife-sdk/simulation @alife-sdk/ai @alife-sdk/social @alife-sdk/phaser
npm install phaser@^3.60.0
```

### Engine-agnostic

```bash
npm install @alife-sdk/core
npm install @alife-sdk/simulation @alife-sdk/ai
```

If you are still exploring, avoid installing optional packages just because they exist. Add them when the base loop is already stable.

## Field test A: build a small world in memory

For most teams, this is the best place to begin.

Use `createInMemoryKernel()` before wiring a real engine:

```ts
import { createInMemoryKernel } from '@alife-sdk/simulation';
import { FactionBuilder, SmartTerrain } from '@alife-sdk/core';

const { kernel, sim, factions } = createInMemoryKernel({ tickIntervalMs: 5_000 });

factions.factions.register('stalker', new FactionBuilder('stalker').build());

sim.addTerrain(new SmartTerrain({
  id: 'camp',
  name: 'Camp',
  bounds: { x: 0, y: 0, width: 200, height: 200 },
  capacity: 6,
  jobs: [{ type: 'patrol', slots: 3 }],
}));

sim.registerNPC({
  entityId: 'wolf',
  factionId: 'stalker',
  position: { x: 50, y: 50 },
  rank: 2,
  combatPower: 50,
  currentHp: 100,
  options: { type: 'human' },
});

kernel.events.on('alife:tick', ({ tick }) => console.log('tick', tick));
kernel.update(5_001);
```

Why this is such a good first step:

- no engine adapters yet
- no rendering layer yet
- no `ISimulationBridge` yet
- you learn the real runtime model immediately

What you should pay attention to while this runs:

- the kernel advances time
- the terrain exists as shared world state, not as a visual-only object
- the NPC is registered into that world state cleanly
- events give you a way to debug and observe the simulation before you build tools around it

If this path makes sense to you, the next good stop is [First Living World](/guides/first-living-world).

## Field test B: inspect the full NPC scenario

If you want to see the broader shape of the SDK before wiring anything into your game, run the capstone example:

```bash
pnpm install
pnpm build:sdk
npx tsx --tsconfig examples/tsconfig.json examples/18-full-npc.ts
```

Then open:

- [`examples/18-full-npc.ts`](https://github.com/eurusik/alife-sdk/blob/main/examples/18-full-npc.ts)
- [Examples guide](/examples/)

That route is broader, but it is also heavier. If it starts to feel like too much at once, go back to Field test A and return here after the model clicks.

## When you are ready to bring it into a Phaser scene

If you are already using Phaser 3, start with `createPhaserKernel()` instead of wiring every port by hand:

```ts
import {
  createPhaserKernel,
  PhaserEntityAdapter,
  PhaserEntityFactory,
  PhaserPlayerPosition,
  PhaserSimulationBridge,
} from '@alife-sdk/phaser';

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
  config: { preset: 'simulation' },
});

kernel.init();
kernel.start();
```

This is the moment where the SDK starts talking to your actual runtime. The goal here is not feature completeness. The goal is one scene, one player position provider, one entity bridge, and one clean kernel start.

## Stop here and verify these signals before adding more systems

Before you move deeper into the SDK, verify all of these:

- the kernel starts without validation errors
- at least one terrain exists
- at least one NPC is registered
- `kernel.update(deltaMs)` runs repeatedly
- you can observe one event such as `TICK`, `NPC_MOVED`, or `TASK_ASSIGNED`

If one of these is missing, do not add more packages yet.

## If something already feels confusing

Open one of these next:

- [First Living World](/guides/first-living-world)
- [Phaser Integration](/guides/phaser-integration)
- [Custom Engine](/guides/custom-engine)
- [Troubleshooting](/guides/troubleshooting)

## Docs commands

```bash
pnpm docs:dev
pnpm docs:build
pnpm docs:preview
```
