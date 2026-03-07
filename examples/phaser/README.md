# ALife SDK — Phaser 3 Example

A browser-based starter showing how to integrate `@alife-sdk` into a Phaser 3 game.

No external assets — all sprites are generated programmatically at runtime.

---

## Fastest Run

From the monorepo root:

```bash
pnpm build:sdk
pnpm example:phaser:install
pnpm example:phaser:dev
```

Then open `http://localhost:5173`.

If you prefer running commands from inside the example folder, the equivalent commands are:

```bash
cd examples/phaser
pnpm install
pnpm dev
```

---

## Architecture Guide

For the "why" behind update order, ownership boundaries, and AI behavior model, see:

- [`ARCHITECTURE.md`](./ARCHITECTURE.md)

---

## New Here? Start With Minimal Integration

If your goal is "connect SDK to Phaser fast", read this file first:

- [`src/minimal/MinimalIntegrationScene.ts`](./src/minimal/MinimalIntegrationScene.ts)

It shows only the core lifecycle:

1. Create adapters/ports.
2. Call `createPhaserKernel(...)`.
3. `kernel.init()` + `kernel.start()`.
4. `simulation.registerNPC(...)`.
5. `kernel.update(delta)` in `update()`.

Expected signals in this minimal scene:

- NPC status flips `offline ↔ online` when you move near/far from it
- `switchDistance` controls the handoff boundary
- player + NPC sprites stay visible while handoff logic changes ownership
- simulation keeps advancing each frame through `kernel.update(delta)`

To run it, switch scene import in [`src/main.ts`](./src/main.ts):

```ts
// import { GameScene } from './GameScene';
// scene: [GameScene],

import { MinimalIntegrationScene } from './minimal/MinimalIntegrationScene';
scene: [MinimalIntegrationScene],
```

---

## What it shows

| What you see | What it demonstrates |
|---|---|
| White circle moving with WASD | Player driving `PhaserPlayerPosition` |
| Blue squares = Stalkers, Red = Bandits | NPCs registered with `PhaserEntityAdapter` |
| NPCs dim ↔ brighten as player moves | `OnlineOfflineManager` + `sim.setNPCOnline()` |
| HP bar shrinks above NPCs | Offline combat via `PhaserSimulationBridge` |
| Blue/red zone rectangles | `SmartTerrain` bounds — NPCs navigate here |
| Cyan circle around player | Online proximity threshold |
| Event log (top right) | `FACTION_CONFLICT`, `NPC_DIED`, `TASK_ASSIGNED` |

---

## Requirements

Build the SDK packages first:

```bash
pnpm build:sdk
```

---

## Common Flow

```bash
pnpm build:sdk
pnpm example:phaser:install
pnpm example:phaser:dev
```

- `pnpm build:sdk` builds the workspace packages used by Vite aliases.
- `pnpm example:phaser:install` installs the demo's own Phaser/Vite dependencies.
- `pnpm example:phaser:dev` starts the browser demo.

To produce a production build for the example:

```bash
pnpm example:phaser:build
```

---

## Controls

- `WASD` or arrow keys: move player
- `G`: throw grenade toward the cursor
- Walk toward NPCs: bring them online
- Watch the top-right log: see AI/simulation events

---

## Key SDK calls in GameScene.ts

```ts
// 1. One-call kernel setup — wires all plugins and adapters
const { kernel, simulation, onlineOffline } = createPhaserKernel({
  ports: { entityAdapter, playerPosition, entityFactory, simulationBridge: bridge },
  data:  { factions: [...], terrains: [factory, bunker] },
  config: { preset: 'simulation' },
});

kernel.init();
kernel.start();

// 2. Register an NPC after init()
simulation.registerNPC({ entityId: 'stalker_wolf', factionId: 'stalker', ... });

// 3. Every frame — advance the simulation and evaluate transitions
kernel.update(delta);                          // drives tick pipeline
const { goOnline, goOffline } = onlineOffline.evaluate(player.x, player.y, records);
for (const id of goOnline)  simulation.setNPCOnline(id, true);
for (const id of goOffline) simulation.setNPCOnline(id, false);
```

Equivalent minimal reference: [`src/minimal/MinimalIntegrationScene.ts`](./src/minimal/MinimalIntegrationScene.ts)

---

## Architecture: what each adapter does

```
Host game (Phaser)          ALife SDK
─────────────────           ─────────────────────────────
PhaserEntityAdapter    ←→   IEntityAdapter   (position, alpha, animation)
PhaserPlayerPosition   ──→  IPlayerPositionProvider (drives online/offline)
PhaserEntityFactory    ←─   IEntityFactory   (called when SDK spawns NPCs)
PhaserSimulationBridge ←→   ISimulationBridge (HP tracking, damage, morale)
OnlineOfflineManager   ──→  sim.setNPCOnline() (proximity-based switching)
```

In a full game you would also add:
- **AIPlugin** — frame-by-frame state machine for online NPCs (attack, patrol, flee)
- **SocialPlugin** — NPC greetings and remarks when online
- **HazardsPlugin** — anomaly zones that damage offline NPCs passing through

---

## Troubleshooting

### The page is blank or imports fail

Run `pnpm build:sdk` from the repo root first. The demo resolves SDK packages to the built `dist/` outputs.

### `pnpm example:phaser:dev` fails on missing dependencies

Run `pnpm example:phaser:install` once from the repo root.

### The demo builds but Vite warns about large chunks

That is expected for this showcase right now. It does not block local development or the example build.
