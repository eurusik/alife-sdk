# A-Life SDK

Keep world state advancing when the player leaves an area.

Use it in 2D games where camps, patrols, hazards, and nearby encounters should all read from the same runtime state instead of resetting off-screen.

## What this SDK is for

- off-screen NPC simulation
- online NPC behavior near the player
- ports-based integration into Phaser or a custom engine
- modular adoption by package instead of whole-engine replacement

## Runtime loop

- Far away -> off-screen simulation
- In range -> online AI takes over
- Combat starts -> local context matters
- Player leaves -> world keeps its state

## Start here

- [Quick Start](/quick-start)
- [Examples](/examples/)
- [Packages](/packages/)

## First check

Run the runtime in Node before you wire it into a scene:

```bash
pnpm install
pnpm build:sdk
npx tsx --tsconfig examples/tsconfig.json examples/18-full-npc.ts
```

Once you can follow that runtime in Node, it becomes easier to integrate it into Phaser or your own engine.
