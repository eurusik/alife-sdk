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

The key thing to understand: in a real game engine you must provide three ports —
`EntityAdapter`, `PlayerPosition`, `EntityFactory` — before calling `init()`.
This example wires them as tiny stubs so all simulation logic still runs correctly.
If you just want to skip this wiring entirely, use `createInMemoryKernel()` from
`@alife-sdk/simulation` — it provides all no-op adapters automatically.

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

### 04-persistence.ts — Save / load game state

**What it shows:**

- `PersistencePlugin` wired to a kernel with `MemoryStorageProvider`
- Run offline ticks, then `SAVE` the kernel state (NPC HP, rank, position, game clock, tick counter)
- Run more ticks (state drifts), then `LOAD` the save — kernel reverts to the snapshot
- Verify restored state matches what was saved
- `hasSave()` / `deleteSave()` API
- Two independent save slots (autosave + manual)
- Error handling: load before save, corrupted data
- How to swap `MemoryStorageProvider` for `localStorage` in the browser

**Run:**

```bash
npx tsx --tsconfig examples/tsconfig.json examples/04-persistence.ts
```

---

### 05-hazards.ts — Anomaly zones, radiation, artefacts

**What it shows:**

- Two hazard zones: a radiation field and a fire pit
- Three artefacts with different zone-type affinities and weights
- Three entities: unprotected stalker, radiation-resistant scientist, fire-immune player
- Damage ticks, immunity reduction, artefact spawning and collection
- A short-lived surge zone that auto-expires
- Why `HazardsPlugin.update()` is a no-op — and how to drive `hazards.manager.tick(deltaMs, entities)` yourself

**Run:**

```bash
npx tsx --tsconfig examples/tsconfig.json examples/05-hazards.ts
```

---

### 06-economy.ts — Trade, inventory, quests

**What it shows:**

- `EconomyPlugin` with player inventory and item events
- A trader with item lines and a configurable restock cycle
- `executeBuy` — neutral relation price, ally discount, failure cases
- `executeSell` — flat sell multiplier
- `executeGift` — item transfer without money (quest reward)
- `QuestEngine` — register → start → progress → complete lifecycle
- Quest chains: first quest unlocks the next; quest failure path

**Run:**

```bash
npx tsx --tsconfig examples/tsconfig.json examples/06-economy.ts
```

---

### 07-ai.ts — Online frame-based NPC AI

**What it shows:**

- `SimpleNPCHost` — minimal host contract every NPC must satisfy
- `OnlineAIDriver` — per-NPC FSM driver; call `update(deltaMs)` each frame
- Full human FSM cycle: `IDLE → ALERT → COMBAT → SEARCH → IDLE`
- `CombatState` firing shots and transitioning to `TAKE_COVER`
- `COMBAT → FLEE` when morale reaches `PANICKED`
- Monster FSM (bloodsucker) using `buildChornobylMonsterHandlerMap → STALK`
- `AIPlugin` + `RestrictedZoneManager` for movement constraints
- How `SimpleNPCHost` is replaced by `PhaserNPCContext` in production without touching state handlers

**Run:**

```bash
npx tsx --tsconfig examples/tsconfig.json examples/07-ai.ts
```

---

### 08-social.ts — NPC social interaction system

**What it shows:**

- `ContentPool` — text pool by category; `addLines` / `loadSocialData`
- `MeetOrchestrator` — greeting bubbles when player approaches NPCs
- `RemarkDispatcher` — ambient NPC remarks driven by `plugin.update()`
- `CampfireFSM` — auto-managed campfire sessions (`IDLE → STORY/JOKE → REACTING`, or `EATING → IDLE`)
- `SocialPlugin` + kernel — wiring `ISocialPresenter` and `INPCSocialProvider`
- Serialize / restore — cooldowns survive save/load

**Run:**

```bash
npx tsx --tsconfig examples/tsconfig.json examples/08-social.ts
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

### 10-custom-pathfinder.ts — Custom IMovementSimulator

**What it shows:**

- How to replace the built-in movement simulator with any custom implementation
- `GridMovementSimulator` — a minimal grid-based pathfinder (no external deps)
  written from scratch to show exactly what `IMovementSimulator` requires
- Passing it via `movementSimulator` in `SimulationPlugin` config — one field,
  no SDK changes needed
- Priority order: `movementSimulator` → `levelGraph` → straight-line default
- Where to plug in PathfinderJS / EasyStar / navmesh in a real project

Use this as the starting point when your game's world is a tile map and you
need wall avoidance that the default waypoint graph doesn't provide.

**Run:**

```bash
npx tsx --tsconfig examples/tsconfig.json examples/10-custom-pathfinder.ts
```

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

### 11-fsm-tags.ts — Extended FSM: tags, events, guards, history

**What it shows:**

- Tags on state definitions (`'passive'`, `'active'`, `'hostile'`) and `fsm.hasTag()` for group queries
- Metadata on states (animation hints, priority) readable via `fsm.metadata`
- Event subscriptions: `onEnter`, `onExit`, `onChange` — all return unsubscribe functions
- Guards: `canEnter` / `canExit` that veto transitions
- `fsm.previous`, `fsm.currentStateDuration`, `fsm.getHistory()`
- 4-state guard NPC: `IDLE → ALERT → COMBAT → RETREAT`

**Run:**

```bash
npx tsx --tsconfig examples/tsconfig.json examples/11-fsm-tags.ts
```

---

### 12-behavior-tree.ts — Behavior Tree

**What it shows:**

- `Blackboard<T>` typed shared state passed to every node each tick
- Composites: `Sequence` (AND gate), `Selector` (OR gate), `Parallel` (`require-all` / `require-one`)
- Decorators: `Inverter`, `Cooldown`, `Repeater`
- Leaves: `Task` (arbitrary action), `Condition` (boolean predicate)
- `ITreeNode<T>` interface for writing custom nodes
- How BT fits with FSM: FSM picks the goal, BT executes it step by step

**Run:**

```bash
npx tsx --tsconfig examples/tsconfig.json examples/12-behavior-tree.ts
```

---

### 13-entity-handles.ts — EntityHandleManager

**What it shows:**

- Versioned handles that make use-after-free bugs impossible
- Bit-packed handle encoding: 20-bit slot index + 28-bit generation counter
- `resolve()` returns `null` for stale or freed handles — no silent wrong-entity bugs
- Slot reuse: when a slot is freed and reallocated, old handles stay stale
- `NULL_HANDLE` sentinel for optional handle fields
- A `Squad` class that tracks members safely through death and replacement

**Run:**

```bash
npx tsx --tsconfig examples/tsconfig.json examples/13-entity-handles.ts
```

---

### 14-reactive-query.ts — ReactiveQuery

**What it shows:**

- Predicate-based entity set observer: `onChange` fires only when membership changes (O(change), not O(n))
- No-op update: when nothing changes, no callbacks fire
- Reactive to mutations: mutate an entity, call `update()`, the query reacts automatically
- Manual `track()` / `untrack()` for special-case membership (bypass the predicate)
- `has()`, `size`, `current` for inspection
- `dispose()` for cleanup

**Run:**

```bash
npx tsx --tsconfig examples/tsconfig.json examples/14-reactive-query.ts
```

---

### 15-memory-bank.ts — MemoryBank

**What it shows:**

- Per-NPC episodic memory with channel-based confidence decay
- Three channels: `VISUAL` (medium decay), `SOUND` (fast decay), `HIT` (slow decay)
- `remember()` — add or update a memory; same `sourceId` upgrades the record
- `recall()`, `getByChannel()`, `getMostConfident()` for querying
- `update(deltaSec)` — automatic confidence decay and pruning below threshold
- `forget()` — manual instant removal
- `serialize()` / `restore()` — save game support

**Run:**

```bash
npx tsx --tsconfig examples/tsconfig.json examples/15-memory-bank.ts
```

---

### 16-danger-manager.ts — DangerManager

**What it shows:**

- Spatial danger zones with TTL and weighted threat scoring
- `isDangerous(position)` — should the NPC flee?
- `getThreatAt(position)` — accumulated threat from all overlapping zones
- `getSafeDirection(position)` — normalized flee vector away from all threats
- `getDangersNear(position, radius)` — situational awareness (what and how far)
- `update(deltaMs)` — TTL decay and auto-expiry
- Custom threshold: `new DangerManager(0.5)` for braver NPCs

**Run:**

```bash
npx tsx --tsconfig examples/tsconfig.json examples/16-danger-manager.ts
```

---

### 17-goap-planner.ts — GOAPPlanner

**What it shows:**

- `WorldState` — key-value map of planning facts (`isHealthy`, `isLoaded`, etc.)
- `GOAPAction` abstract class — `id`, `cost`, `getPreconditions()`, `getEffects()`, `execute()`
- `planner.plan(currentState, goal)` — A\* search returns an ordered action list or `null`
- 4 scenarios: short plan (2 steps), full chain (6 steps), unreachable goal (`null`), mid-execution replanning
- How replanning works: world state changes mid-mission → call `plan()` again → new plan adapts automatically

**Run:**

```bash
npx tsx --tsconfig examples/tsconfig.json examples/17-goap-planner.ts
```

---

### 18-full-npc.ts — Capstone: all AI systems in one NPC ★

**What it shows:**

How StateMachine, MemoryBank, DangerManager, GOAPPlanner, and BehaviorTree
work **together** in a single realistic NPC — "Kozak the Veteran Stalker".

- **FSM** drives top-level state: `PATROL → ALERT → COMBAT → PATROL`
- **MemoryBank** stores enemy sightings; FSM reads confidence to decide when to go alert / engage
- **DangerManager** detects a grenade mid-combat; Kozak repositions using `getSafeDirection()`
- **GOAPPlanner** decides the combat strategy each tick (heal? find cover? attack?)
- **BehaviorTree** executes moment-to-moment decisions inside COMBAT state

**Start here if you want to see the big picture before reading individual system examples.**

**Run:**

```bash
npx tsx --tsconfig examples/tsconfig.json examples/18-full-npc.ts
```

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
