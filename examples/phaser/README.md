# ALife SDK — Phaser 3 Example

A browser-based demo showing how to integrate `@alife-sdk` into a Phaser 3 game.

No external assets — all sprites are generated programmatically at runtime.

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

Build the SDK packages first (from the monorepo root):

```bash
pnpm build:sdk
```

---

## Run

```bash
cd examples/phaser
npm install
npm run dev
```

Then open `http://localhost:5173` in your browser.

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
