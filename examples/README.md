# ALife SDK — Examples

These examples show the SDK from the perspective of a developer who spent a day learning it.
They are deliberately concise and heavily commented so you can understand *why* each line exists,
not just *what* it does.

All examples run in Node.js via [tsx](https://github.com/privatenumber/tsx) — no Phaser, no DOM.

> **Just want to run something right now?** Use `createInMemoryKernel()` from `@alife-sdk/simulation` — it skips all the port wiring and returns a ready kernel. The examples below are intentionally verbose so you understand *why* each piece exists.

---

## Requirements

The examples live in the monorepo. Build the SDK packages first so the workspace symlinks resolve:

```bash
pnpm install
pnpm build:sdk
```

Then run any example with tsx (from the monorepo root):

```bash
npx tsx --tsconfig examples/tsconfig.json examples/01-hello-npc.ts
npx tsx --tsconfig examples/tsconfig.json examples/02-online-offline.ts
```

If you prefer to install tsx globally once:

```bash
npm install -g tsx
tsx --tsconfig examples/tsconfig.json examples/01-hello-npc.ts
```

---

## Examples

### 01-hello-npc.ts — Minimal simulation loop

**What it shows:**

- How to build a kernel from scratch without a game engine
- Registering two hostile factions (stalker vs bandit) using `FactionBuilder`
- Adding a `SmartTerrain` with patrol and guard jobs
- Registering two NPCs — one per faction
- Running a simulation loop for 5 ticks (each tick = 5 seconds of game time)
- Listening to events: `TICK`, `NPC_MOVED`, `FACTION_CONFLICT`, `TASK_ASSIGNED`

The key thing to understand: the kernel needs three required ports (`EntityAdapter`,
`PlayerPosition`, `EntityFactory`) to pass validation at `init()`. In a real game engine
these are non-trivial adapters. In a Node.js example they are tiny stubs that return safe
defaults so all simulation logic still runs correctly.

**Run:**

```bash
npx tsx --tsconfig examples/tsconfig.json examples/01-hello-npc.ts
```

---

### 02-online-offline.ts — Online/offline switching

**What it shows:**

- The core design concept: NPCs exist in two modes
  - **Offline**: driven by the SDK tick pipeline — cheap, runs even off-screen
  - **Online**: host engine takes over with real-time physics and AI
- How `sim.setNPCOnline(id, true/false)` switches between modes
- Simulating player proximity: when the player walks near an NPC, it goes online
- What actually changes when mode flips: the tick pipeline skips online NPCs
- How to read `record.isOnline` and `brain.currentTerrainId` to observe the difference

This example extends example 01 — all the setup is the same, the new content begins
after "ONLINE/OFFLINE DEMONSTRATION".

**Run:**

```bash
npx tsx --tsconfig examples/tsconfig.json examples/02-online-offline.ts
```

---

### 03-combat-bridge.ts — Realistic offline combat

**What it shows:**

- How to implement `ISimulationBridge` with real state tracking (no noOp stubs)
- Why `createNoOpBridge()` keeps HP frozen — and how to fix that
- Full damage flow: `getEffectiveDamage` → HP mutation → `NPC_DIED` event
- `adjustMorale` tracking (hit penalty, kill bonus, ally death cascade)
- HP bar visualization and early-exit when one faction is wiped out

The key insight: `OfflineCombatResolver` mutates `record.currentHp` directly —
the bridge only needs `getEffectiveDamage` to return a non-zero value for damage
to actually land. Everything else (HP tracking, morale state) lives in
`InMemoryBridge` — a ~50-line class you replace with your engine's component
system when you integrate for real.

**Run:**

```bash
npx tsx --tsconfig examples/tsconfig.json examples/03-combat-bridge.ts
```


---

### 09-phaser.ts — Phaser 3 integration reference ⚠️ browser-only

> **NOT runnable in Node.js** — requires a live Phaser 3 context (browser + WebGL/Canvas).
> Open as a **copy-paste template** when integrating the SDK into your Phaser game.
> Do not run with `tsx`.

**What it shows:**

- `createPhaserKernel()` — one-call setup that wires all Phaser adapters
- `PhaserEntityAdapter`, `PhaserPlayerPosition`, `PhaserEntityFactory`, `PhaserSimulationBridge`
- `PhaserSocialPresenter`, `PhaserNPCSocialProvider` — social system integration
- `IPhaserNPCHost` / `PhaserNPCContext` — per-NPC bridge for the online AI driver
- `OnlineOfflineManager.evaluate()` — per-frame proximity streaming
- Full update loop order: `onlineOffline.evaluate()` → `kernel.update()` → `driver.update()` → `meetOrchestrator.update()`
- Save / load via `kernel.serialize()` / `kernel.restoreState()`

For a **live visual demo** (real sprites, HP bars, terrain zones) see the browser playground below.

---

### phaser/ — Browser demo with Phaser 3

**What it shows:**

- Full browser integration — real sprites, real game loop, no console.log
- `createPhaserKernel()` — one call to wire all adapters (replaces ~80 lines of boilerplate)
- `PhaserEntityAdapter`, `PhaserPlayerPosition`, `PhaserEntityFactory`, `PhaserSimulationBridge`
- `OnlineOfflineManager` — proximity-based online/offline switching every frame
- Visual feedback: NPCs dim when offline, brighten when online, HP bars update after combat
- Terrain zone rectangles and event log visible in real time

**Run (from `examples/phaser/`):**

```bash
cd examples/phaser
npm install
npm run dev
# open http://localhost:5173
```

Controls: **WASD** or arrow keys. Walk toward NPCs (cyan circle = proximity radius) to bring them online.

---

## Going further

Once you are comfortable with these examples, the natural next steps are:

- **Add real port implementations** — implement `IEntityAdapter`, `IEntityFactory`, and
  `IPlayerPositionProvider` backed by your game engine (see `@alife-sdk/phaser` for a reference).
- **Add AI plugin** — install `AIPlugin` (from `@alife-sdk/ai`) for frame-based NPC behavior
  when they are online.
- **Add more terrains** — `SmartTerrain` instances are the backbone of the living world;
  add many of them with different `jobs`, `capacity`, and `dangerLevel` values.
- **Squads** — use `sim.getSquadManager()` to read squad assignments and set squad goals.
- **Surge events** — configure `ISurgeConfig` to trigger zone-wide danger waves.
- **Save/load** — call `kernel.serialize()` / `kernel.restoreState()` then re-register NPCs.
