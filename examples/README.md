# ALife SDK — Examples

ALife SDK is a TypeScript toolkit for building living NPC worlds: offline
simulation, online frame-based AI, factions, combat, memory, danger awareness,
GOAP planning, economy, social interaction, and persistence — all engine-agnostic.

All examples run in **Node.js** via [tsx](https://github.com/privatenumber/tsx) — no Phaser, no browser required.

---

## Quick start

**New to the SDK? Run this first — it shows how all AI systems fit together:**

```bash
pnpm install && pnpm build:sdk
npx tsx --tsconfig examples/tsconfig.json examples/18-full-npc.ts
```

Then read the output and open [18-full-npc.ts](18-full-npc.ts) alongside it.
After that, explore the individual system examples below.

---

## Install in your own project

```bash
npm install @alife-sdk/core @alife-sdk/simulation
# optional packages:
npm install @alife-sdk/ai       # online frame-based NPC AI
npm install @alife-sdk/phaser   # Phaser 3 adapters
npm install @alife-sdk/economy  # trade, inventory, quests
npm install @alife-sdk/hazards  # anomaly zones, radiation, artefacts
npm install @alife-sdk/social   # greetings, remarks, campfire stories
npm install @alife-sdk/persistence # save / load
```

---

## Running the examples

The examples live in the monorepo. Build the SDK packages first:

```bash
pnpm install
pnpm build:sdk
```

Then run any example from the monorepo root:

```bash
npx tsx --tsconfig examples/tsconfig.json examples/01-hello-npc.ts
```

> **Shortcut:** Use `createInMemoryKernel()` from `@alife-sdk/simulation` to skip
> all the port wiring in examples 01-02. The verbose versions are intentional —
> they show *why* each piece exists.

---

## Examples

### Where to start

| Goal | Start with |
|------|-----------|
| See the big picture — all systems in one NPC | [18-full-npc.ts](#18-full-npcts--capstone-all-ai-systems-in-one-npc) |
| Build a world with NPCs and factions | [01](#01-hello-npcts--minimal-simulation-loop) → [02](#02-online-offlinets--onlineoffline-switching) → [03](#03-combat-bridgets--realistic-offline-combat) |
| Add AI behavior to your NPC | [11](#11-fsm-tagsts--extended-fsm-tags-events-guards-history) → [12](#12-behavior-treets--behavior-tree) → [17](#17-goap-plannerts--goap-planner) |
| Give your NPC memory and threat awareness | [15](#15-memory-bankts--memory-bank) → [16](#16-danger-managerts--danger-manager) |
| Integrate with Phaser 3 | [09](#09-phaserts--phaser-3-integration-reference-%EF%B8%8F-browser-only) → [phaser/](#phaser--browser-demo-with-phaser-3) |
| Add save/load to your game | [04](#04-persistencets--save--load-game-state) |

---

### 01-hello-npc.ts — Minimal simulation loop

**What it shows:**

- How to build a kernel from scratch without a game engine
- Registering two hostile factions (stalker vs bandit) using `FactionBuilder`
- Adding a `SmartTerrain` with patrol and guard jobs
- Registering two NPCs — one per faction
- Running a simulation loop for 5 ticks (each tick = 5 seconds of game time)
- Listening to events: `TICK`, `NPC_MOVED`, `FACTION_CONFLICT`, `TASK_ASSIGNED`

The kernel requires three port adapters at init time: `EntityAdapter`,
`PlayerPosition`, `EntityFactory`. This example wires them as tiny stubs so all
simulation logic runs correctly without a game engine. To skip this wiring
entirely, use `createInMemoryKernel()` from `@alife-sdk/simulation`.

```bash
npx tsx --tsconfig examples/tsconfig.json examples/01-hello-npc.ts
```

---

### 02-online-offline.ts — Online/offline switching

**What it shows:**

- **Offline** mode: driven by the SDK tick pipeline — cheap, runs even off-screen
- **Online** mode: host engine takes over with real-time physics and AI
- How `sim.setNPCOnline(id, true/false)` switches between modes
- Simulating player proximity: when the player walks near an NPC, it goes online

```bash
npx tsx --tsconfig examples/tsconfig.json examples/02-online-offline.ts
```

---

### 03-combat-bridge.ts — Realistic offline combat

**What it shows:**

- How to implement `ISimulationBridge` with real HP tracking
- Why `createNoOpBridge()` keeps HP frozen — and how to fix that
- Full damage flow: `getEffectiveDamage` → HP mutation → `NPC_DIED` event
- `adjustMorale` tracking (hit penalty, kill bonus, ally death cascade)

```bash
npx tsx --tsconfig examples/tsconfig.json examples/03-combat-bridge.ts
```

---

### 04-persistence.ts — Save / load game state

**What it shows:**

- `PersistencePlugin` wired to a kernel with `MemoryStorageProvider`
- Save the kernel state, run more ticks, load — kernel reverts to the snapshot
- `hasSave()` / `deleteSave()` API, two independent save slots
- How to swap `MemoryStorageProvider` for `localStorage` in the browser

```bash
npx tsx --tsconfig examples/tsconfig.json examples/04-persistence.ts
```

---

### 05-hazards.ts — Anomaly zones, radiation, artefacts

**What it shows:**

- Radiation fields, fire pits, and short-lived surge zones
- Three entities with different immunity profiles
- Damage ticks, artefact spawning and collection

```bash
npx tsx --tsconfig examples/tsconfig.json examples/05-hazards.ts
```

---

### 06-economy.ts — Trade, inventory, quests

**What it shows:**

- `EconomyPlugin` with player inventory and item events
- `executeBuy` / `executeSell` / `executeGift` with faction-based pricing
- `QuestEngine` — register → start → progress → complete lifecycle, quest chains

```bash
npx tsx --tsconfig examples/tsconfig.json examples/06-economy.ts
```

---

### 07-ai.ts — Online frame-based NPC AI

**What it shows:**

- `OnlineAIDriver` — per-NPC FSM driver; call `update(deltaMs)` each frame
- Full human FSM cycle: `IDLE → ALERT → COMBAT → SEARCH → IDLE`
- Monster FSM (bloodsucker) with `STALK` state
- How `SimpleNPCHost` is replaced by `PhaserNPCContext` in production

```bash
npx tsx --tsconfig examples/tsconfig.json examples/07-ai.ts
```

---

### 08-social.ts — NPC social interaction system

**What it shows:**

- `MeetOrchestrator` — greeting bubbles when player approaches NPCs
- `RemarkDispatcher` — ambient NPC remarks
- `CampfireFSM` — auto-managed campfire storytelling sessions
- Serialize / restore — cooldowns survive save/load

```bash
npx tsx --tsconfig examples/tsconfig.json examples/08-social.ts
```

---

### 09-phaser.ts — Phaser 3 integration reference ⚠️ browser-only

> **NOT runnable in Node.js.** Open as a copy-paste template when integrating
> the SDK into your Phaser game. Do not run with `tsx`.

**What it shows:**

- `createPhaserKernel()` — one-call setup that wires all Phaser adapters
- `OnlineOfflineManager.evaluate()` — per-frame proximity streaming
- Full update loop order for a Phaser scene

---

### 10-custom-pathfinder.ts — Custom IMovementSimulator

**What it shows:**

- How to replace the built-in movement simulator with any custom pathfinder
- A minimal grid-based pathfinder written from scratch as a reference
- Where to plug in PathfinderJS, EasyStar, or a navmesh adapter

```bash
npx tsx --tsconfig examples/tsconfig.json examples/10-custom-pathfinder.ts
```

---

### phaser/ — Browser demo with Phaser 3

Full browser integration — real sprites, real game loop, no console.log.

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

- State tags (`'passive'`, `'active'`, `'hostile'`) and `fsm.hasTag()` for group queries
- `onEnter` / `onExit` / `onChange` event subscriptions
- Guards: `canEnter` / `canExit` that veto transitions
- `fsm.previous`, `fsm.currentStateDuration`, `fsm.getHistory()`

```bash
npx tsx --tsconfig examples/tsconfig.json examples/11-fsm-tags.ts
```

---

### 12-behavior-tree.ts — Behavior Tree

**What it shows:**

- `Blackboard<T>` typed shared state passed to every node each tick
- Composites: `Sequence` (AND gate), `Selector` (OR gate), `Parallel`
- Decorators: `Inverter`, `Cooldown`, `Repeater`
- Leaves: `Task`, `Condition`
- How BT fits with FSM: FSM picks the goal, BT executes it step by step

```bash
npx tsx --tsconfig examples/tsconfig.json examples/12-behavior-tree.ts
```

---

### 13-entity-handles.ts — EntityHandleManager

**What it shows:**

- Versioned handles that prevent silent "wrong entity" bugs when slots are reused
- `resolve()` returns `null` for stale or freed handles instead of the new occupant
- `NULL_HANDLE` sentinel for optional handle fields
- A `Squad` class that tracks members safely through death and replacement

```bash
npx tsx --tsconfig examples/tsconfig.json examples/13-entity-handles.ts
```

---

### 14-reactive-query.ts — ReactiveQuery

**What it shows:**

- Entity set that calls `onChange` only when membership changes — not every tick
- `track()` / `untrack()` for special-case membership that bypasses the predicate
- `dispose()` for cleanup when the query is no longer needed

```bash
npx tsx --tsconfig examples/tsconfig.json examples/14-reactive-query.ts
```

---

### 15-memory-bank.ts — MemoryBank

**What it shows:**

- Per-NPC episodic memory: what the NPC has seen, heard, and been hit by
- Three channels with different decay rates: `VISUAL`, `SOUND`, `HIT`
- `getMostConfident()` — who should the NPC focus fire on?
- `serialize()` / `restore()` — memory survives a save/load cycle

```bash
npx tsx --tsconfig examples/tsconfig.json examples/15-memory-bank.ts
```

---

### 16-danger-manager.ts — DangerManager

**What it shows:**

- Spatial threat zones: grenades, anomalies, gunfire — each with TTL
- `isDangerous(position)` — should the NPC flee?
- `getSafeDirection(position)` — normalized flee vector away from all threats
- Custom threshold: `new DangerManager(0.5)` for braver NPCs

```bash
npx tsx --tsconfig examples/tsconfig.json examples/16-danger-manager.ts
```

---

### 17-goap-planner.ts — GOAP Planner

**What it shows:**

- `WorldState` — key-value facts: `isHealthy`, `isLoaded`, `inPosition`, etc.
- `GOAPAction` — define actions with preconditions, effects, and cost
- `planner.plan(state, goal)` — A\* search finds the cheapest action sequence
- Replanning: world changes mid-mission → call `plan()` again → new plan automatically

```bash
npx tsx --tsconfig examples/tsconfig.json examples/17-goap-planner.ts
```

---

### 18-full-npc.ts — Capstone: all AI systems in one NPC

**Start here if you want to understand how the pieces fit together.**

A 10-tick simulation of "Kozak the Veteran Stalker" — one NPC using all five AI
systems at once:

- **FSM** — top-level states: `PATROL → ALERT → COMBAT → PATROL`
- **MemoryBank** — stores enemy sightings; FSM reads confidence to decide when to engage
- **DangerManager** — detects a grenade mid-combat; Kozak repositions automatically
- **GOAPPlanner** — decides the combat strategy each tick
- **BehaviorTree** — executes moment-to-moment decisions inside COMBAT state

```bash
npx tsx --tsconfig examples/tsconfig.json examples/18-full-npc.ts
```

---

## Going further

- **Real port implementations** — implement `IEntityAdapter`, `IEntityFactory`, and
  `IPlayerPositionProvider` backed by your game engine (see `@alife-sdk/phaser` for a reference)
- **More SmartTerrains** — the backbone of a living world; add many with different `jobs`, `capacity`, and `dangerLevel`
- **Squads** — `sim.getSquadManager()` for squad assignments and goals
- **Surge events** — zone-wide danger waves via `ISurgeConfig`
- **Save/load** — `kernel.serialize()` / `kernel.restoreState()`
