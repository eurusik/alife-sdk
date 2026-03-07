# A-Life SDK

The world keeps living when the player leaves.

Build 2D games where distant camps keep moving, patrols keep travelling, hazards keep changing, and nearby encounters inherit real world state instead of spawning empty.

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

## First proof

Run the runtime in Node before you wire it into a scene:

```bash
pnpm install
pnpm build:sdk
npx tsx --tsconfig examples/tsconfig.json examples/18-full-npc.ts
```

Once that model clicks, integrating it into Phaser or your own engine becomes much easier to reason about.
