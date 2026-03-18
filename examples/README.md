# ALife SDK — Examples

This folder is the fastest way to understand how the SDK feels in practice.
Most examples run in plain Node.js via [tsx](https://github.com/privatenumber/tsx), so you can inspect the systems without wiring a renderer first.

Use this README as a guided path, not just a file list.

---

## Start Here

If you only run one example first, run the capstone:

```bash
pnpm install
pnpm build:sdk
npx tsx --tsconfig examples/tsconfig.json examples/18-full-npc.ts
```

Then open [18-full-npc.ts](18-full-npc.ts) alongside the console output.
It shows how the major systems fit together in one NPC lifecycle.

---

## What Runs Where

- Most top-level `examples/*.ts` files are **Node.js-only teaching examples**.
- [`09-phaser.ts`](09-phaser.ts) is a **browser integration reference**, not a runnable Node script.
- [`phaser/`](phaser/) is the **real browser demo** if you want sprites, a game loop, and movement on screen.

---

## Recommended Learning Paths

### 1. I want to understand the SDK fast

Run these in order:

1. [18-full-npc.ts](18-full-npc.ts)
2. [01-hello-npc.ts](01-hello-npc.ts)
3. [02-online-offline.ts](02-online-offline.ts)
4. [07-ai.ts](07-ai.ts)

### 2. I want a living world with off-screen NPCs

Run these in order:

1. [01-hello-npc.ts](01-hello-npc.ts)
2. [02-online-offline.ts](02-online-offline.ts)
3. [03-combat-bridge.ts](03-combat-bridge.ts)
4. [10-custom-pathfinder.ts](10-custom-pathfinder.ts)

### 3. I want on-screen combat AI

Run these in order:

1. [07-ai.ts](07-ai.ts)
2. [11-fsm-tags.ts](11-fsm-tags.ts)
3. [12-behavior-tree.ts](12-behavior-tree.ts)
4. [17-goap-planner.ts](17-goap-planner.ts)

### 4. I want the gameplay systems

Run these in order:

1. [04-persistence.ts](04-persistence.ts)
2. [05-hazards.ts](05-hazards.ts)
3. [06-economy.ts](06-economy.ts)
4. [08-social.ts](08-social.ts)

### 5. I want tactical combat AI

Run these in order:

1. [19-simple-duel.ts](19-simple-duel.ts)
2. [20-tactical-firefight.ts](20-tactical-firefight.ts)
3. [21-squad-assault.ts](21-squad-assault.ts)

### 6. I want Phaser integration

Open in this order:

1. [09-phaser.ts](09-phaser.ts)
2. [phaser/README.md](phaser/README.md)
3. [phaser/src/minimal/MinimalIntegrationScene.ts](phaser/src/minimal/MinimalIntegrationScene.ts)
4. [phaser/src/GameScene.ts](phaser/src/GameScene.ts)
5. [phaser/src/main.ts](phaser/src/main.ts)

---

## Running the Examples

Build the workspace first:

```bash
pnpm install
pnpm build:sdk
```

Then run any Node example from the repo root:

```bash
npx tsx --tsconfig examples/tsconfig.json examples/01-hello-npc.ts
```

Shortcut:
Use `createInMemoryKernel()` from `@alife-sdk/simulation` when you want to skip port wiring and focus on system behavior.

---

## Browser Demo

The Phaser demo lives in [`phaser/`](phaser/).
Run it when you want a real on-screen integration instead of console output:

```bash
cd examples/phaser
npm install
npm run dev
```

Open `http://localhost:5173`.

Controls: **WASD** or arrow keys. Press **G** to throw a grenade toward the cursor. Walk toward NPCs to bring them online.

---

## Install in Your Own Project

```bash
npm install @alife-sdk/core @alife-sdk/simulation
npm install @alife-sdk/ai       # online frame-based NPC AI
npm install @alife-sdk/phaser   # Phaser 3 adapters
npm install @alife-sdk/economy  # trade, inventory, quests
npm install @alife-sdk/hazards  # anomaly zones, radiation, artefacts
npm install @alife-sdk/social   # greetings, remarks, campfire stories
npm install @alife-sdk/persistence # save / load
```

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
| Build tactical NPC combat | [19](#19-simple-duelts--simple-duel) → [20](#20-tactical-firefightts--tactical-firefight-with-grenades) → [21](#21-squad-assaultts--squad-assault-with-goap-and-flanking) |

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

### 19-simple-duel.ts — Simple duel

**What it shows:**

- Two NPCs (stalker vs bandit) in a firefight with the online AI system
- Full FSM lifecycle: `IDLE → ALERT → COMBAT → TAKE_COVER` (peek-fire cycle)
- Cover system with `AIPlugin.coverRegistry` and `createCoverAccess()`
- Morale-driven transitions: `COMBAT → RETREAT → FLEE`
- Damage processing, HP tracking, and death handling

```bash
npx tsx --tsconfig examples/tsconfig.json examples/19-simple-duel.ts
```

---

### 20-tactical-firefight.ts — Tactical firefight with grenades

**What it shows:**

- Grenade throwing (`GrenadeState`) and evasion (`EvadeGrenadeState`)
- `DangerManager` integration via `IDangerAccess` adapter
- `TacticalCombatHandler` — composite pattern wrapping `CombatState` + `CombatTransitionHandler`
- Medkit healing in `WoundedState` (crawl + heal + return to combat)
- Full morale lifecycle: `STABLE → SHAKEN → PANICKED` → `RETREAT` / `FLEE`

```bash
npx tsx --tsconfig examples/tsconfig.json examples/20-tactical-firefight.ts
```

---

### 21-squad-assault.ts — Squad assault with GOAP and flanking

**What it shows:**

- 2v2 squad battle with `SquadSharedTargetTable` for target coordination
- `GOAPPlanner` — strategic planning (TakeCover → Suppress → Flank → Attack)
- `AMBUSH` cover evaluator for flanking positions (60–120° off enemy line)
- `evaluateSituation()` — squad-level tactical commands (ATTACK / HOLD / RETREAT)
- All systems from examples 19–20 combined in a multi-NPC scenario

```bash
npx tsx --tsconfig examples/tsconfig.json examples/21-squad-assault.ts
```

---

## Going further

- **Real port implementations** — implement `IEntityAdapter`, `IEntityFactory`, and
  `IPlayerPositionProvider` backed by your game engine (see `@alife-sdk/phaser` for a reference)
- **More SmartTerrains** — the backbone of a living world; add many with different `jobs`, `capacity`, and `dangerLevel`
- **Squads** — `sim.getSquadManager()` for squad assignments and goals
- **Surge events** — zone-wide danger waves via `ISurgeConfig`
- **Save/load** — `kernel.serialize()` / `kernel.restoreState()`
