# A-Life SDK

[![CI](https://github.com/eurusik/alife-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/eurusik/alife-sdk/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm scope](https://img.shields.io/badge/npm-%40alife--sdk-blue)](https://www.npmjs.com/search?q=%40alife-sdk)
[![Node.js >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)

**Docs:** [Glossary](docs/glossary.md) · [Changelog](CHANGELOG.md) · [Examples](examples/README.md) · [Contributing](CONTRIBUTING.md)

A modular TypeScript SDK for building living game worlds — NPC state machines, GOAP planning, faction systems, offline world simulation, real-time AI behavior, social interactions, economy, hazard zones, and save/load. All opt-in, zero external dependencies in core.

Works with **Phaser 3** (production-ready adapter included) or any other runtime — **PixiJS, Three.js, Node.js** — by implementing four port interfaces. ESM-only.

---

## Packages

| Package | Description |
|---------|-------------|
| [`@alife-sdk/core`](packages/alife-core/README.md) | Kernel, plugin host, StateMachine, GOAP, MemoryBank, Faction, SmartTerrain, EventBus, ports |
| [`@alife-sdk/simulation`](packages/alife-simulation/README.md) | Offline tick-based world simulation — NPC brains, terrain selection, squad combat, surge events |
| [`@alife-sdk/ai`](packages/alife-ai/README.md) | Online frame-based NPC behavior — 18 AI states, cover system, GOAP, perception, squad tactics |
| [`@alife-sdk/social`](packages/alife-social/README.md) | NPC social layer — proximity greetings, ambient remarks, campfire storytelling |
| [`@alife-sdk/economy`](packages/alife-economy/README.md) | Inventory, trade, quests — buy/sell, NPC-to-NPC trading, quest lifecycle FSM |
| [`@alife-sdk/hazards`](packages/alife-hazards/README.md) | Hazard zones, anomaly damage, artefact spawning, immunity system |
| [`@alife-sdk/persistence`](packages/alife-persistence/README.md) | Save/load pipeline — pluggable storage backends (localStorage, file, memory) |
| [`@alife-sdk/phaser`](packages/alife-phaser/README.md) | Phaser 3 adapter layer — ready-to-use port implementations, `createPhaserKernel` factory |

```
@alife-sdk/core
    ├── @alife-sdk/simulation
    ├── @alife-sdk/ai
    ├── @alife-sdk/social
    ├── @alife-sdk/economy
    ├── @alife-sdk/hazards
    ├── @alife-sdk/persistence
    └── @alife-sdk/phaser  ←  depends on core + simulation + ai + social
```

Each package is independently installable. You only pay for what you use.

---

## Installation

### Phaser 3

```bash
npm install @alife-sdk/core @alife-sdk/simulation @alife-sdk/ai @alife-sdk/social @alife-sdk/phaser
```

### Engine-agnostic

```bash
npm install @alife-sdk/core
# add more packages as needed
npm install @alife-sdk/simulation @alife-sdk/ai
```

See [`examples/`](examples/) for runnable Node.js examples that demonstrate the core concepts without a game engine.

---

## Which packages do I need?

```
Are you building a game with Phaser 3?
├─ YES → npm install @alife-sdk/core @alife-sdk/simulation @alife-sdk/ai @alife-sdk/social @alife-sdk/phaser
│         Then use createPhaserKernel() from '@alife-sdk/phaser' — it wires everything in one call.
│         → See examples/09-phaser.ts (browser template)
│
└─ NO  → Do you want NPCs to behave while off-screen (living world)?
          ├─ YES → npm install @alife-sdk/core @alife-sdk/simulation
          │         Start with examples/01-hello-npc.ts
          │         Add @alife-sdk/ai for real-time AI when NPCs are on screen.
          │
          └─ NO  → npm install @alife-sdk/core
                    Use just the kernel + factions + events.
                    Start with the engine-agnostic Quick start below.

Optional add-ons (install any time):
  @alife-sdk/economy      → trade, inventory, quests
  @alife-sdk/hazards      → anomaly zones, radiation damage
  @alife-sdk/social       → NPC greetings, campfire stories
  @alife-sdk/persistence  → save / load
```

**Just exploring?** Use `createInMemoryKernel()` — no adapter boilerplate needed:

```ts
import { createInMemoryKernel } from '@alife-sdk/simulation';
import { FactionBuilder, SmartTerrain } from '@alife-sdk/core';

const { kernel, sim, factions } = createInMemoryKernel();

factions.factions.register('stalker', new FactionBuilder('stalker').build());
sim.addTerrain(new SmartTerrain({ id: 'camp', name: 'Camp', bounds: { x: 0, y: 0, width: 200, height: 200 }, capacity: 6, jobs: [] }));
sim.registerNPC({ entityId: 'wolf', factionId: 'stalker', position: { x: 50, y: 50 }, rank: 2, combatPower: 50, currentHp: 100, options: { type: 'human' } });

kernel.events.on('alife:tick', ({ tick }) => console.log('tick', tick));
kernel.update(5_001); // advance one tick
```

---

## Core Concepts

```
  Your game engine
       │
       │  implements Ports (IEntityAdapter, IEntityFactory, IPlayerPositionProvider)
       ▼
  ┌─────────────────────────────────┐
  │          ALifeKernel            │  ← central coordinator
  │  clock · events · logger · ports│
  └──────────────┬──────────────────┘
                 │  kernel.use(plugin)
     ┌───────────┼───────────┐
     ▼           ▼           ▼
SimulationPlugin  AIPlugin  SocialPlugin  …more plugins
```

**Kernel** — the central coordinator. Every plugin, port, and event goes through it.
Call `kernel.provide()` → `kernel.use()` → `kernel.init()` → `kernel.start()` in that order.

**Port** — a narrow interface *your* code implements so the SDK can talk to your engine.
The SDK never calls Phaser or any renderer directly. You write once: "here is how to
move a sprite", "here is the player's position". For prototyping, `createInMemoryKernel()`
provides all no-op ports automatically — no adapter code needed.

**Plugin** — a self-contained feature module. Install only what your game needs.
`SimulationPlugin` runs offline NPC brains. `AIPlugin` drives online real-time behavior.
`SocialPlugin` adds greetings and campfire stories. Write your own by implementing `IALifePlugin`.

**Online vs Offline** — your game might have 300 NPCs but only 20 are ever on screen.
Running full per-frame AI for all 300 would destroy performance.
The SDK solves this: NPCs near the player run full frame-based AI (online); distant NPCs are kept alive by a cheap tick every 5 seconds (offline).
You control the switch: `sim.setNPCOnline(npcId, true/false)`.
When an NPC comes back online its brain state (terrain, task, morale) is preserved exactly where the simulation left it.

---

## Quick start

### Phaser 3

The `@alife-sdk/phaser` package provides `createPhaserKernel` — a factory that wires
all adapter ports to your Phaser scene in one call:

```ts
import { createPhaserKernel, PhaserEntityAdapter, PhaserEntityFactory, PhaserSimulationBridge } from '@alife-sdk/phaser';
import { TerrainBuilder, SmartTerrain } from '@alife-sdk/core/terrain';
import { createDefaultBehaviorConfig } from '@alife-sdk/simulation';

class GameScene extends Phaser.Scene {
  create() {
    const player = this.add.sprite(400, 300, 'player');
    const adapter = new PhaserEntityAdapter();
    const bridge = new PhaserSimulationBridge();
    const factory = new PhaserEntityFactory({
      createNPC: (req) => `npc_${req.npcTypeId}`,
      createMonster: (req) => `monster_${req.monsterTypeId}`,
      destroyEntity: (_id) => {},
    });

    const { kernel, simulation } = createPhaserKernel({
      ports: {
        entityAdapter:    adapter,
        playerPosition:   { getPlayerPosition: () => ({ x: player.x, y: player.y }) },
        entityFactory:    factory,
        simulationBridge: bridge,
      },
      data: {
        factions: [
          { id: 'stalker', relations: { bandit: -80 } },
          { id: 'bandit',  relations: { stalker: -80 } },
        ],
        terrains: [
          new SmartTerrain(
            new TerrainBuilder('camp_cordon')
              .name('Cordon Camp')
              .bounds({ x: 100, y: 100, width: 300, height: 300 })
              .capacity(8)
              .shelter(true)
              .allowFactions(['stalker'])
              .build()
          ),
        ],
      },
      config: { preset: 'simulation' },
    });

    kernel.init();
    kernel.start();

    // Register an NPC after init
    simulation?.registerNPC({
      entityId:       'stalker_rookie_1',
      factionId:      'stalker',
      combatPower:    40,
      currentHp:      100,
      rank:           2,
      position:       { x: 150, y: 150 },
      // behaviorConfig controls NPC decision-making thresholds:
      //   retreatThreshold  0.0–1.0   — HP ratio below which NPC attempts retreat (0.3 = retreat at 30% HP)
      //   panicThreshold   -1.0–0.0   — morale below which NPC panics regardless of HP (-0.6 = severe fear)
      //   searchIntervalMs  ms        — time between search-state scans (5000 = scan every 5 s)
      //   dangerTolerance   1–5       — maximum danger level NPC will tolerate before fleeing (higher = braver)
      //   aggression        0.0–1.0   — preference for offensive actions on contact (1.0 = always attacks)
      behaviorConfig: createDefaultBehaviorConfig({ retreatThreshold: 0.3, panicThreshold: -0.6 }),
      options:        { type: 'human' },
    });

    this.kernel = kernel;
  }

  update(_time: number, delta: number) {
    this.kernel.update(delta);
  }
}
```

### Engine-agnostic

Implement four port interfaces once — the kernel never calls engine APIs directly:

```ts
import { ALifeKernel, Ports } from '@alife-sdk/core';
import { FactionsPlugin, SpawnPlugin } from '@alife-sdk/core/plugins';
import { SimulationPlugin, SimulationPorts } from '@alife-sdk/simulation/plugin';
import { createDefaultBehaviorConfig } from '@alife-sdk/simulation';
import { TerrainBuilder, SmartTerrain } from '@alife-sdk/core/terrain';

const kernel = new ALifeKernel();

// Required ports — implement once for your engine
kernel.provide(Ports.EntityAdapter,  new MyEntityAdapter());
kernel.provide(Ports.EntityFactory,  new MyEntityFactory());
kernel.provide(Ports.PlayerPosition, { getPlayerPosition: () => ({ x: player.x, y: player.y }) });

// Simulation bridge — lets the SDK apply damage and check liveness
// `entities` is your engine's entity registry — a Map you maintain, e.g. `const entities = new Map<string, MyEntity>()`
kernel.provide(SimulationPorts.SimulationBridge, {
  isAlive:            (id) => entities.get(id)?.hp > 0,
  applyDamage:        (id, dmg, type) => entities.get(id)?.takeDamage(dmg, type) ?? false,
  getEffectiveDamage: (id, dmg, _type) => dmg,
  adjustMorale:       (id, amount) => { entities.get(id)?.morale.adjust(amount); },
});

// Install plugins
const factionsPlugin = new FactionsPlugin();
factionsPlugin.factions.register('stalker', { name: 'Stalker', baseRelations: { bandit: -80 } });
factionsPlugin.factions.register('bandit',  { name: 'Bandit',  baseRelations: { stalker: -80 } });
kernel.use(factionsPlugin);
kernel.use(new SpawnPlugin());

const sim = new SimulationPlugin({ tickIntervalMs: 5_000 });

// Add terrains before init
sim.addTerrain(new SmartTerrain(
  new TerrainBuilder('camp_cordon')
    .name('Cordon Camp')
    .bounds({ x: 100, y: 100, width: 300, height: 300 })
    .capacity(8)
    .shelter(true)
    .allowFactions(['stalker'])
    .build()
));
kernel.use(sim);

const diag = kernel.init();   // validates ports, freezes registries
if (diag.errors.length > 0) console.error(diag.format());
kernel.start();               // enables frame-based update()

// Register NPCs after init
sim.registerNPC({
  entityId:       'stalker_rookie_1',
  factionId:      'stalker',
  combatPower:    40,
  currentHp:      100,
  rank:           2,
  position:       { x: 150, y: 150 },
  // behaviorConfig controls NPC decision-making thresholds:
  //   retreatThreshold  0.0–1.0   — HP ratio below which NPC attempts retreat (0.3 = retreat at 30% HP)
  //   panicThreshold   -1.0–0.0   — morale below which NPC panics regardless of HP (-0.6 = severe fear)
  //   searchIntervalMs  ms        — time between search-state scans (5000 = scan every 5 s)
  //   dangerTolerance   1–5       — maximum danger level NPC will tolerate before fleeing (higher = braver)
  //   aggression        0.0–1.0   — preference for offensive actions on contact (1.0 = always attacks)
  behaviorConfig: createDefaultBehaviorConfig({ retreatThreshold: 0.3, panicThreshold: -0.6 }),
  options:        { type: 'human' },
});

// Game loop
function update(deltaMs: number) {
  sim.setNPCOnline('stalker_rookie_1', isNearPlayer('stalker_rookie_1'));
  kernel.update(deltaMs);
}

// Save / load
const save = kernel.serialize();
kernel.restoreState(save);
```

---

## How it works

### Ports — engine adapter pattern

`ALifeKernel` never imports Phaser, renders sprites, or touches the DOM.
All engine interaction goes through **ports** — typed interfaces you implement once:

| Port | Interface | Required |
|------|-----------|----------|
| Entity adapter | `IEntityAdapter` | Yes |
| Entity factory | `IEntityFactory` | Yes |
| Player position | `IPlayerPositionProvider` | Yes |
| Runtime clock | `IRuntimeClock` | No (SDK default) |
| Random | `IRandom` | No (SDK default) |

### Plugin system

Every domain feature lives in an opt-in plugin. Install only what your game needs:

```ts
kernel.use(new SimulationPlugin(config));
kernel.use(new AIPlugin(config));
kernel.use(new HazardsPlugin(config));
kernel.use(new PersistencePlugin(config));
```

Write your own by implementing `IALifePlugin`:

```ts
class WeatherPlugin implements IALifePlugin {
  readonly name = 'weather';
  install(kernel: ALifeKernel) { /* register ports, events */ }
  update(deltaMs: number)      { /* per-frame logic */ }
  destroy()                    { /* cleanup */ }
}
```

### Online / offline duality

| Layer | Package | When active |
|-------|---------|-------------|
| Offline simulation | `@alife-sdk/simulation` | Always — tick-based, runs even off-screen |
| Online AI | `@alife-sdk/ai` | When NPC is within player radius — frame-based |

NPCs outside the player's view radius are kept alive by the offline tick.
When a NPC enters range, the online AI driver takes over with full real-time behavior.

### Event bus

38 typed events across 9 categories connect packages without direct coupling:

```ts
kernel.events.on(ALifeEvents.NPC_DIED, ({ npcId, killedBy }) => {
  questSystem.onNpcKilled(npcId);
});
```

Categories: A-Life, AI, Surge, Anomaly, Squad, Faction, Time, Social, Monster.

---

## Events

| Event | Fires when | Key payload fields |
|-------|-----------|-------------------|
| `NPC_DIED` | NPC health reaches zero | `npcId`, `killedBy`, `zoneId` |
| `NPC_MOVED` | Offline NPC changes terrain | `npcId`, `fromZone`, `toZone` |
| `NPC_ONLINE` | NPC transitions to online mode | `npcId`, `position` |
| `NPC_OFFLINE` | NPC transitions to offline mode | `npcId`, `zoneId` |
| `TASK_ASSIGNED` | Brain picks a new job slot | `npcId`, `terrainId`, `taskType` |
| `MORALE_CHANGED` | NPC morale shifts | `npcId`, `morale`, `moraleState` |
| `NPC_PANICKED` | Morale drops below panic threshold | `npcId`, `squadId` |
| `FACTION_CONFLICT` | Two hostile factions meet in a zone | `factionA`, `factionB`, `zoneId` |
| `FACTION_RELATION_CHANGED` | Relation value between factions updates | `factionId`, `targetFactionId`, `newRelation` |
| `STATE_CHANGED` | Online AI FSM transitions state | `npcId`, `oldState`, `newState` |
| `SPOTTED_ENEMY` | AI perception detects an enemy | `npcId`, `enemyId`, `position` |
| `NPC_SHOOT` | NPC fires a weapon | `npcId`, `from`, `target`, `damage` |
| `SURGE_STARTED` | A surge event begins | `surgeNumber` |
| `HOUR_CHANGED` | In-game clock ticks one hour | `hour`, `day`, `isDay` |
| `NPC_SOCIAL_BUBBLE` | NPC says something (remark/greeting) | `npcId`, `text`, `category` |

```ts
import { ALifeEvents } from '@alife-sdk/core';

kernel.events.on(ALifeEvents.NPC_DIED, ({ npcId, killedBy }) => {
  console.log(`${npcId} was killed by ${killedBy}`);
  updateQuestLog(npcId);
});
```

Full payload types are in `ALifeEventPayloads` from `@alife-sdk/core`.

---

## Testing

All packages are designed for isolated unit testing. Use `createInMemoryKernel()` to skip all port wiring:

```ts
import { createInMemoryKernel } from '@alife-sdk/simulation';

const { kernel, sim, factions } = createInMemoryKernel();
// kernel is already init()'d and start()'d — register NPCs and go
```

Or wire ports manually if you need a custom `SeededRandom` or bridge:

```ts
const kernel = new ALifeKernel();
kernel.provide(Ports.EntityAdapter,  mockEntityAdapter());
kernel.provide(Ports.EntityFactory,  mockEntityFactory());
kernel.provide(Ports.PlayerPosition, { getPlayerPosition: () => ({ x: 0, y: 0 }) });
kernel.provide(Ports.Random,         new SeededRandom(42));
```

---

## Development

```bash
pnpm install        # install dependencies
pnpm build:sdk      # build all packages
pnpm test:sdk       # run the full test suite
```

Uses [pnpm workspaces](https://pnpm.io/workspaces) and [Changesets](https://github.com/changesets/changesets) for versioning.

---

## Performance

**How many NPCs can the simulation handle?**
The offline tick pipeline uses a round-robin budget: by default it updates up to
20 NPC brains per tick (`maxBrainUpdatesPerTick: 20`). This means hundreds of
registered NPCs add negligible per-frame cost — only the budgeted batch runs each
tick. Raise or lower the budget to trade simulation fidelity for CPU headroom.

**What is the tick interval for offline NPCs?**
5 seconds by default (`tickIntervalMs: 5_000`). The full 7-step pipeline (terrain
decay, brain round-robin, movement, combat, morale, goodwill decay, cleanup) runs
once per interval. Surge and morale panic evaluation run every frame independently.

**What does each plugin cost?**
- `SimulationPlugin` — O(budget) per tick (default 20 brains) + O(n) morale eval every 2 s
- `AIPlugin` — runs only for online NPCs; one state-machine step per frame per online NPC
- `SocialPlugin` — proximity scan on each tick; cost scales with online NPC count
- `HazardsPlugin` — O(active zones × online NPCs) per frame
- `PersistencePlugin` — cost only at save/load time; zero per-frame overhead

---

## Troubleshooting

### 1. `kernel.init()` throws `ALifeValidationError`

A required port is missing or a plugin dependency is unmet. Inspect the diagnostics:

```ts
try {
  kernel.init();
} catch (e) {
  if (e instanceof ALifeValidationError) {
    console.error(e.diagnostics);  // array of { severity, source, field, message }
    console.error(e.message);      // human-readable summary
  }
}
```

Required ports when wiring manually: `Ports.EntityAdapter`, `Ports.EntityFactory`, and `Ports.PlayerPosition`.
`SimulationPlugin` additionally requires `SimulationPorts.SimulationBridge`.
To skip all of this, use `createInMemoryKernel()` — it provides all no-op ports automatically.

### 2. NPC not moving

Two likely causes:
- **Simulation not ticking** — verify `kernel.start()` was called and `kernel.update(deltaMs)` runs every frame.
- **NPC is online with no AI plugin** — when `isOnline === true` the SDK hands control to `AIPlugin`. If `AIPlugin` is not installed, the NPC stops. Either install `AIPlugin` or call `sim.setNPCOnline(npcId, false)` to keep it in the offline simulation.

### 3. TypeScript errors on imports

The SDK uses sub-path exports. Import from the correct sub-path:

```ts
// Wrong
import { SimulationPlugin } from '@alife-sdk/simulation';

// Correct
import { SimulationPlugin } from '@alife-sdk/simulation/plugin';
import { SmartTerrain, TerrainBuilder } from '@alife-sdk/core/terrain';
import { ALifeEvents } from '@alife-sdk/core/events';
```

### 4. Nothing happens after `registerNPC()`

`kernel.start()` must be called before the game loop begins. `registerNPC()` can be
called at any time, but the simulation only ticks when the kernel is in the `running`
state. Check the call order: `provide` → `use` → `init` → `start` → `update`.

### 5. All NPCs staying in one place

No terrains are registered, so brains have nowhere to navigate to. Add at least one
terrain before or after `kernel.init()`:

```ts
sim.addTerrain(new SmartTerrain(
  new TerrainBuilder('camp_cordon')
    .name('Cordon Camp')
    .bounds({ x: 100, y: 100, width: 400, height: 400 })
    .capacity(10)
    .build()
));
```

Without registered terrains, `brain.selectBestTerrain()` returns `null` every tick
and NPCs remain at their spawn position.

---

## License

MIT
