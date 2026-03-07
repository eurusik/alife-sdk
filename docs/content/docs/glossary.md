# ALife SDK — Glossary

Quick reference for SDK-specific terminology. If you're new to the SDK, read this before the examples.

---

## Core concepts

### Kernel (`ALifeKernel`)

The central coordinator. Owns the event bus, game clock, port registry, and plugin list.
Nothing in the SDK imports Phaser or any renderer — the kernel is always engine-agnostic.

Lifecycle order: `provide()` → `use()` → `init()` → `start()` → `update()` → `destroy()`

```ts
const kernel = new ALifeKernel();
```

---

### Port

A narrow TypeScript interface that **your code implements** so the SDK can talk to your engine.
Think of it as a socket — the SDK defines the shape, you plug in the wire.

Three ports are required at `kernel.init()`:

| Port token | Interface | What it does |
|---|---|---|
| `Ports.EntityAdapter` | `IEntityAdapter` | Read/write entity position, components, visibility |
| `Ports.EntityFactory` | `IEntityFactory` | Create and destroy game entities |
| `Ports.PlayerPosition` | `IPlayerPositionProvider` | Returns the player's current world position |

Additional ports are declared by plugins (e.g. `SimulationPorts.SimulationBridge`).

Register a port: `kernel.provide(Ports.EntityAdapter, myImpl)`

---

### Adapter

A concrete class that **implements a Port** interface and delegates to your engine.
Example: `PhaserEntityAdapter` implements `IEntityAdapter` by wrapping Phaser sprites.

The terms **Port** (the interface token) and **Adapter** (the implementation) are related but distinct:
- Port = the contract (`PortToken<IEntityAdapter>`)
- Adapter = the object that fulfills the contract (`new PhaserEntityAdapter()`)

---

### Provider

A read-only adapter — an adapter that only reads data and never mutates it.
Example: `IPlayerPositionProvider` only exposes `getPlayerPosition()`.

> Rule of thumb: if the interface name ends in `Provider`, it's read-only.

---

### Plugin (`IALifePlugin`)

A self-contained feature module installed into the kernel.
Plugins declare dependencies on each other (resolved topologically) and on ports.

```ts
kernel.use(new SimulationPlugin({ tickIntervalMs: 5_000 }));
```

Lifecycle hooks: `install()` → `init()` → `update(delta)` → `destroy()`

Write your own by implementing `IALifePlugin`.

---

### SmartTerrain

A named zone with **capacity** and **jobs**. NPCs choose terrains by scoring fitness
(distance, danger level, available job slots). Inspired by S.T.A.L.K.E.R. A-Life zones.

Equivalent to: a "point of interest" or "activity zone" in other AI frameworks.

```ts
new SmartTerrain({
  id: 'abandoned_factory',
  name: 'Abandoned Factory',
  bounds: { x: 400, y: 400, width: 200, height: 200 },
  capacity: 6,
  jobs: [
    { type: 'patrol', slots: 3 },
    { type: 'guard', slots: 3, position: { x: 450, y: 450 } },
  ],
})
```

---

### NPC record (`INPCRecord`)

The **offline simulation's view** of an NPC — position, HP, morale, faction, squad,
and the online/offline flag. Updated by the tick pipeline and by the host engine.

Not the same as a game-engine entity or sprite. The record exists even when the NPC
is off-screen; the sprite may not.

---

### NPC brain (`INPCBrain`)

The offline decision-maker. Selects terrain, picks job slots, and tracks morale.
Created by `sim.registerNPC()`, rebuilt by `sim.rebuildBrain()` after restore.

The brain runs **inside the SDK** during offline ticks.
When the NPC goes online, the host engine's `OnlineAIDriver` takes over.

---

### Online / Offline duality

NPCs exist in one of two modes at any time:

| Mode | Who drives it | Cost | Active when |
|---|---|---|---|
| **Offline** | SDK tick pipeline (every ~5 s) | Very low | NPC is far from player |
| **Online** | Host engine frame-by-frame AI | Higher | NPC is within player radius |

Switch: `sim.setNPCOnline(npcId, true/false)`

When an NPC returns online its brain state (terrain, task, morale) is preserved from where the simulation left it.

---

### Tick

One execution of the **offline simulation pipeline** — fires every `tickIntervalMs` (default 5 000 ms).
The 7 steps: terrain decay → brain round-robin → movement → conflict detection → combat → morale restore → `TICK` event.

Not the same as a game frame. Ticks are time-budget driven; frames run every ~16 ms.

---

### Event bus

The `kernel.events` object. 38 typed events across 9 categories connect plugins without direct coupling.

Events are **deferred**: `emit()` queues them, `flush()` delivers them. `kernel.update()` calls `flush()` automatically.

```ts
kernel.events.on(ALifeEvents.NPC_DIED, ({ npcId, killedBy }) => { ... });
```

---

### GOAP planner

**Goal-Oriented Action Planning** — the AI decision algorithm used for online NPCs.
The planner searches a graph of actions to find the cheapest path from current world state to a goal.

Used internally by `OnlineAIDriver`. You do not interact with it directly unless writing custom AI states.

---

### Round-robin budget

The offline tick pipeline updates at most `maxBrainUpdatesPerTick` brains per tick (default: 20).
This means 500 registered NPCs add negligible per-frame cost — only 20 brains run per tick.

Raise the budget to increase simulation fidelity. Lower it to save CPU.

---

## Common confusions

| Question | Answer |
|---|---|
| Port vs Adapter | Port = the interface token. Adapter = your implementation of that interface. |
| NPC record vs entity | Record = SDK's internal simulation data. Entity = your engine's game object (sprite, etc.). |
| Online vs Offline | Two different pipelines. Offline = SDK tick. Online = your engine's frame loop. |
| SmartTerrain vs Zone | Same thing. "SmartTerrain" is the S.T.A.L.K.E.R.-originated name; think "activity zone". |
| Provider vs Adapter | Provider = read-only port. Adapter = read-write port. Both are "ports" conceptually. |
| Brain vs record | Brain = decision logic (terrain choice, morale). Record = data snapshot (HP, position, online flag). |
