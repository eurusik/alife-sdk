# Examples

The examples are the most honest way to understand how this SDK behaves.

Most top-level examples run in Node.js, which makes them a much better learning surface than a game scene when you are still trying to understand the world model.

## Recommended first routes

If you want the shortest path, start with one of these:

1. **Understand the loop** -> run `18-full-npc.ts`
2. **See Phaser integration** -> open the Phaser demo route below
3. **See save/load and systems** -> jump to the gameplay systems examples

## If you only open one example first

Run the capstone example:

```bash
pnpm install
pnpm build:sdk
npx tsx --tsconfig examples/tsconfig.json examples/18-full-npc.ts
```

Then open:

- [`18-full-npc.ts`](https://github.com/eurusik/alife-sdk/blob/main/examples/18-full-npc.ts)
- [Examples README](https://github.com/eurusik/alife-sdk/blob/main/examples/README.md)

Open the file beside the console output. That is the quickest way to see how the major systems fit into one NPC lifecycle.

### Expected output

- console events that show the runtime is alive
- readable transitions in the NPC lifecycle
- enough signal to decide whether the model fits your game

## What runs where

- Most top-level `examples/*.ts` files are Node-based learning examples
- `examples/09-phaser.ts` is a browser integration reference, not the real browser demo
- `examples/phaser/` is the full Phaser demo if you want to see the systems live on screen

## Choose the path that matches what you need to understand

<div class="route-grid">
  <a class="route-card" href="#i-want-the-full-world-loop-in-one-place">
    <strong>I want the full world loop in one place</strong>
    Start with one example that shows how the pieces talk to each other before you go narrower.
  </a>
  <a class="route-card" href="#i-want-to-understand-off-screen-npc-life">
    <strong>I want to understand off-screen NPC life</strong>
    Focus on simulation, online/offline switching, and the bridge between both modes.
  </a>
  <a class="route-card" href="#i-want-real-time-combat-behavior">
    <strong>I want real-time combat behavior</strong>
    Read the online AI examples when the simulation model already makes sense to you.
  </a>
  <a class="route-card" href="#i-want-phaser-integration-and-on-screen-proof">
    <strong>I want Phaser integration and on-screen proof</strong>
    Use the browser demo when you are ready to see the handoff working inside a scene.
  </a>
</div>

### I want the full world loop in one place

1. [`18-full-npc.ts`](https://github.com/eurusik/alife-sdk/blob/main/examples/18-full-npc.ts)
2. [`01-hello-npc.ts`](https://github.com/eurusik/alife-sdk/blob/main/examples/01-hello-npc.ts)
3. [`02-online-offline.ts`](https://github.com/eurusik/alife-sdk/blob/main/examples/02-online-offline.ts)
4. [`07-ai.ts`](https://github.com/eurusik/alife-sdk/blob/main/examples/07-ai.ts)

### I want to understand off-screen NPC life

1. [`01-hello-npc.ts`](https://github.com/eurusik/alife-sdk/blob/main/examples/01-hello-npc.ts)
2. [`02-online-offline.ts`](https://github.com/eurusik/alife-sdk/blob/main/examples/02-online-offline.ts)
3. [`03-combat-bridge.ts`](https://github.com/eurusik/alife-sdk/blob/main/examples/03-combat-bridge.ts)
4. [`10-custom-pathfinder.ts`](https://github.com/eurusik/alife-sdk/blob/main/examples/10-custom-pathfinder.ts)

### I want real-time combat behavior

1. [`07-ai.ts`](https://github.com/eurusik/alife-sdk/blob/main/examples/07-ai.ts)
2. [`11-fsm-tags.ts`](https://github.com/eurusik/alife-sdk/blob/main/examples/11-fsm-tags.ts)
3. [`12-behavior-tree.ts`](https://github.com/eurusik/alife-sdk/blob/main/examples/12-behavior-tree.ts)
4. [`17-goap-planner.ts`](https://github.com/eurusik/alife-sdk/blob/main/examples/17-goap-planner.ts)

### I want gameplay systems around the core loop

1. [`04-persistence.ts`](https://github.com/eurusik/alife-sdk/blob/main/examples/04-persistence.ts)
2. [`05-hazards.ts`](https://github.com/eurusik/alife-sdk/blob/main/examples/05-hazards.ts)
3. [`06-economy.ts`](https://github.com/eurusik/alife-sdk/blob/main/examples/06-economy.ts)
4. [`08-social.ts`](https://github.com/eurusik/alife-sdk/blob/main/examples/08-social.ts)

### I want Phaser integration and on-screen proof

1. [`09-phaser.ts`](https://github.com/eurusik/alife-sdk/blob/main/examples/09-phaser.ts)
2. [Phaser demo README](https://github.com/eurusik/alife-sdk/blob/main/examples/phaser/README.md)
3. [`MinimalIntegrationScene.ts`](https://github.com/eurusik/alife-sdk/blob/main/examples/phaser/src/minimal/MinimalIntegrationScene.ts)
4. [`GameScene.ts`](https://github.com/eurusik/alife-sdk/blob/main/examples/phaser/src/GameScene.ts)
5. [`main.ts`](https://github.com/eurusik/alife-sdk/blob/main/examples/phaser/src/main.ts)

## What to notice while you run the examples

<div class="zone-grid">
  <div class="zone-panel">
    <strong>Events are part of the API surface</strong>
    Read the emitted events as carefully as the code. They are one of the main ways you observe the world while integrating.
  </div>
  <div class="zone-panel">
    <strong>Online and offline are two modes of one NPC</strong>
    The same actor can move between both without becoming a separate system or losing its world context.
  </div>
  <div class="zone-panel">
    <strong>Ports define the engine boundary</strong>
    Pay attention to where the examples use adapters and where the SDK stays pure TypeScript.
  </div>
</div>

## Browser demo

Run the Phaser demo when you want to see the online/offline handoff on screen:

```bash
pnpm build:sdk
pnpm example:phaser:install
pnpm example:phaser:dev
```

Open the local Vite URL shown in the terminal.

## What to watch for in the demo

- player position driving online/offline switching
- blue and red NPC factions sharing one world
- smart terrain movement and conflict
- event log proving the background simulation is alive
- one runtime handoff instead of two separate NPC systems

## Related pages

- [Quick Start](/quick-start)
- [Phaser Integration](/guides/phaser-integration)
- [Packages](/packages/)
