# A-Life SDK

Keep world state advancing when the player leaves an area.

Use it when your 2D game needs one continuous world state for off-screen simulation and near-player behavior, instead of resetting NPCs and encounters when they leave the screen.

This page helps you do two things:

- understand whether the SDK fits your game
- run one minimal living-world check before deeper integration

## What this SDK is for

### Runtime

- off-screen NPC simulation
- online NPC behavior near the player
- one shared world state across camps, patrols, hazards, and encounters

### Integration

- ports-based integration into Phaser or a custom engine
- modular adoption by package instead of whole-engine replacement

## Runtime loop

- Far away -> off-screen simulation
- In range -> online AI takes over
- Combat starts -> local context matters
- Player leaves -> world keeps its state

## Start here

<div class="route-grid">
  <a class="route-card" href="/quick-start">
    <strong>Quick Start</strong>
    Decide fit, run one minimal world check, and choose the right integration path.
  </a>
  <a class="route-card" href="/examples/">
    <strong>Examples</strong>
    See runtime behavior before wiring the SDK into your game.
  </a>
  <a class="route-card" href="/packages/">
    <strong>Packages</strong>
    Choose the smallest package set that matches your game.
  </a>
  <a class="route-card" href="/concepts/">
    <strong>Concepts</strong>
    Learn the kernel, ports, online/offline handoff, and runtime model.
  </a>
</div>

## First check

Run the runtime in Node before you wire it into a scene:

```bash
pnpm install
pnpm build:sdk
npx tsx --tsconfig examples/tsconfig.json examples/18-full-npc.ts
```

What success looks like:

- the example runs without boot errors
- one NPC advances through the runtime
- events are visible in output
- the world loop is understandable before scene integration

Once that works in Node, it becomes much easier to map the runtime into Phaser or your own engine.
