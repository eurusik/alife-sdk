# @alife-sdk/core

Framework-agnostic A-Life simulation and AI decision-making system.

Zero external dependencies. Works with Phaser, PixiJS, Node.js, or any JavaScript runtime.

```
npm install @alife-sdk/core
```

---

## What this package does

`@alife-sdk/core` provides the complete foundation for a living game world:

- **NPC AI** — finite state machines, GOAP planners, memory and perception systems
- **A-Life simulation** — offline NPC brains, terrain selection, spawn cooldowns, faction diplomacy
- **Game clock** — accelerated in-game time with configurable day/night cycle and time-change callbacks (HOUR_CHANGED, DAY_NIGHT_CHANGED events)
- **World graph** — waypoint graph with A* pathfinding for offline NPC movement
- **Plugin system** — extend the kernel with your own domain features

The package is intentionally engine-agnostic. It never imports Phaser,
renders sprites, or touches the DOM. All engine interaction goes through
**ports** — narrow interfaces you implement once for your engine.

---

## Quick start

> The SDK ships **interfaces only** for engine adapters — `IEntityAdapter`,
> `IEntityFactory`, `IDataLoader`, etc. You implement them once for your engine.
> The example below uses placeholder names; replace them with your own implementations.
> See [`ports/README.md`](src/ports/README.md) for full interface specs and a Phaser example.

```ts
import { ALifeKernel, Ports } from '@alife-sdk/core';
import { fullPreset, Plugins } from '@alife-sdk/core/plugins';

// 1. Create the kernel
const kernel = new ALifeKernel();

// 2. Register engine adapters (optional — kernel auto-provides no-ops if omitted)
//    (MyEntityAdapter / MyEntityFactory — your implementations of
//     IEntityAdapter / IEntityFactory from @alife-sdk/core/ports)
kernel.provide(Ports.EntityAdapter,  new MyEntityAdapter(scene));
kernel.provide(Ports.EntityFactory,  new MyEntityFactory(scene));
kernel.provide(Ports.PlayerPosition, { getPlayerPosition: () => ({ x: player.x, y: player.y }) });
// Ports.RuntimeClock and Ports.Random are also optional (SDK provides defaults)

// 3. Install built-in plugins
fullPreset(kernel);

// 4. Register game data (before init)
// Plugins is a set of typed plugin tokens — alternative to string IDs
// e.g. kernel.getPlugin(Plugins.FACTIONS) is equivalent to kernel.getPlugin('factions')
const factions = kernel.getPlugin(Plugins.FACTIONS).factions;
factions.register('stalker', { name: 'Stalker', baseRelations: { bandit: -80 } });
factions.register('bandit',  { name: 'Bandit',  baseRelations: { stalker: -80 } });

// 5. Init — validates ports, freezes registries, returns DiagnosticsCollector
const diag = kernel.init();

// 6. Start — enables frame-based update()
kernel.start();

// 7. Game loop
function update(deltaMs: number): void {
  kernel.update(deltaMs);
}

// 8. Save / load
const save = kernel.serialize();
kernel.restoreState(save);

// 9. Cleanup
kernel.destroy();
```

---

## Sub-path imports

Each module has its own import path for optimal tree-shaking:

| Import path | What's inside | Module docs |
|-------------|--------------|-------------|
| `@alife-sdk/core` | `ALifeKernel`, `Clock`, `SpatialGrid`, `Ports`, `PortRegistry`, `Vec2`, `createPortToken` | [core/](src/core/) |
| `@alife-sdk/core/ai` | `StateMachine`, `MemoryBank`, `DangerManager`, `GOAPPlanner` | [ai/](src/ai/README.md) |
| `@alife-sdk/core/combat` | `DamageInstance`, `MoraleTracker`, `ImmunityProfile` | [combat/](src/combat/README.md) |
| `@alife-sdk/core/config` | `createDefaultConfig`, `IALifeConfig` | [config/](src/config/README.md) |
| `@alife-sdk/core/entity` | `IEntity`, `IComponent` | [entity/](src/entity/README.md) |
| `@alife-sdk/core/events` | `EventBus`, `ALifeEvents`, `ALifeEventPayloads` | [events/](src/events/README.md) |
| `@alife-sdk/core/faction` | `Faction`, `FactionBuilder` | [faction/](src/faction/README.md) |
| `@alife-sdk/core/logger` | `Logger`, `LogLevel`, `LogChannel` | [logger/](src/logger/README.md) |
| `@alife-sdk/core/movement` | `PatrolRouteTracker`, `MonsterHome` | [movement/](src/movement/README.md) |
| `@alife-sdk/core/navigation` | `LevelGraph`, `NPCGraphMover` | [navigation/](src/navigation/README.md) |
| `@alife-sdk/core/plugins` | `IALifePlugin`, built-in plugins, `Plugins` tokens | [plugins/](src/plugins/README.md) |
| `@alife-sdk/core/ports` | `IEntityAdapter`, `IDataLoader`, `IRandom`, … | [ports/](src/ports/README.md) |
| `@alife-sdk/core/registry` | `Registry`, `FactionRegistry`, `AIStateRegistry`, … | [registry/](src/registry/README.md) |
| `@alife-sdk/core/schema` | `validateMonsterDefinition`, assertion helpers | [schema/](src/schema/README.md) |
| `@alife-sdk/core/spawn` | `SpawnRegistry` | [spawn/](src/spawn/README.md) |
| `@alife-sdk/core/terrain` | `Zone`, `SmartTerrain`, `TerrainBuilder` | [terrain/](src/terrain/README.md) |
| `@alife-sdk/core/time` | `TimeManager` | [time/](src/time/README.md) |

---

## Architecture

```
                        ┌─────────────────────────────────┐
                        │         ALifeKernel              │
                        │  clock · events · logger · ports │
                        └──────────────┬──────────────────┘
                                       │ kernel.use(plugin)
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
      FactionsPlugin           NPCTypesPlugin            SpawnPlugin
      FactionRegistry          NPCTypeRegistry            SpawnRegistry
              │                        │                        │
              └────────────────────────┼────────────────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
         StateMachine            MemoryBank              GOAPPlanner
        (18 AI states)        (4 channels, decay)       (A* on WorldState)
              │                        │                        │
              └────────────────────────┼────────────────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
          LevelGraph             SmartTerrain              Faction
        (A* pathfinding)     (capacity + fitness)      (two-layer relations)
```

---

## Key concepts

### Ports — engine adapter pattern

The kernel never calls Phaser or any engine API directly. Instead, it calls
**ports** — interfaces you implement to bridge the SDK to your engine.

All ports are optional — the kernel auto-provides silent no-op defaults for
engine ports if you don't supply real implementations. This means
`new ALifeKernel().init()` works with zero configuration for offline
simulation, persistence, and unit tests.

| Port | Interface | Default | Purpose |
|------|-----------|---------|---------|
| Entity adapter | `IEntityAdapter` | no-op | Read/write entity position, visibility, components |
| Entity factory | `IEntityFactory` | no-op | Create and destroy game objects |
| Player position | `IPlayerPositionProvider` | `{x:0,y:0}` | Online/offline radius check each tick |
| Runtime clock | `IRuntimeClock` | `Date.now()` | Real-time ms for cooldown timers |
| Random | `IRandom` | `Math.random()` | PRNG for simulation randomness |

See [`ports/README.md`](src/ports/README.md) for implementation examples.

### Plugin system

The kernel is minimal by design. All domain features live in plugins that
you install with `kernel.use(plugin)`. Built-in plugins cover factions,
NPC types, combat schemas, spawning, monsters, and anomalies.

Write your own plugin by implementing `IALifePlugin`:

```ts
class WeatherPlugin implements IALifePlugin {
  readonly name = 'weather';
  install(kernel: ALifeKernel): void { ... }
  update(deltaMs: number): void { ... }
  destroy(): void { ... }
}
kernel.use(new WeatherPlugin());
```

See [`plugins/README.md`](src/plugins/README.md).

### Event bus

All simulation events are delivered via a deferred `EventBus`.
`emit()` queues an event; `flush()` delivers it — called automatically by
`kernel.update()` at the end of each frame.

```ts
kernel.events.on(ALifeEvents.NPC_DIED, ({ npcId, killedBy }) => {
  questSystem.onNpcKilled(npcId);
});
```

41 typed events across 9 categories: A-Life, AI, Surge, Anomaly, Squad,
Faction, Time, Social, Monster. See [`events/README.md`](src/events/README.md).

### AI — StateMachine + GOAP

Every online NPC runs a `StateMachine` over states registered in `AIStateRegistry`.
Each state has `enter / update / exit` handlers and optional auto-transition rules.

Elite NPCs (rank ≥ 5) additionally run a `GOAPPlanner` — an A* planner over
a `WorldState` that picks the optimal action sequence to achieve a goal.

Actions are registered as plain objects — no subclassing required:

```ts
import { GOAPPlanner, WorldState } from '@alife-sdk/core/ai';

const planner = new GOAPPlanner();

planner.registerAction({
  id: 'heal_self', cost: 2,
  preconditions: { hasMedkit: true, isHealthy: false },
  effects:       { hasMedkit: false, isHealthy: true },
});

const current = WorldState.from({ isHealthy: false, hasMedkit: true });
const goal    = WorldState.from({ isHealthy: true });
const plan    = planner.plan(current, goal); // ['heal_self']
```

See [`ai/README.md`](src/ai/README.md) for the full API including class-based `GOAPAction` for complex multi-frame logic.

### Offline simulation — LevelGraph + SmartTerrain

NPCs outside the player's view radius move through a `LevelGraph` (waypoint
graph with A*) without needing a full physics update. Each offline NPC gets
a `NPCGraphMover` cursor that interpolates world position along graph edges.

NPCs choose destinations by scoring all `SmartTerrain` instances via
`scoreFitness()` — a function of distance, capacity, shelter bonus, and
danger-vs-rank match.

---

## Lifecycle

```
kernel.provide(port)   ← register port adapters
  ↓
kernel.use(plugin)     ← register plugins
  ↓
kernel.init()          ← validate ports, freeze registries, call plugin.init()
  ↓
kernel.start()         ← enable frame-based update()
  ↓
kernel.update(delta)   ← each frame: tick plugins → flush events
  ↓
kernel.serialize()     ← capture state for save
kernel.restoreState()  ← restore from save
  ↓
kernel.destroy()       ← cleanup, call plugin.destroy() in reverse order
```

### Save versioning and migrations

The kernel supports versioned saves. When a save file was created by an older
version of your game, you can register migration functions to transform the
state forward. Migrations are applied automatically during `restoreState()`.

```ts
// Register a migration that upgrades state from version 0 → 1
kernel.registerMigration(0, (state) => {
  // transform state as needed
  return { ...state, version: 1, newField: 'default' };
});

// Later, restoreState() applies all needed migrations automatically
kernel.restoreState(oldSave);
```

---

## Testing

```
pnpm test --filter @alife-sdk/core
```

The SDK is designed to be test-friendly:
- Engine ports (`EntityAdapter`, `PlayerPosition`, `EntityFactory`) auto-provide
  no-ops — no boilerplate needed for offline/persistence tests
- `IRandom` port → inject `SeededRandom` for deterministic results
- `IRuntimeClock` port → inject a frozen clock

```ts
// Minimal test kernel — no provide() needed
const kernel = new ALifeKernel();
kernel.init();
kernel.step(10);

// Override only what your test actually needs
const kernel = new ALifeKernel();
kernel.provide(Ports.Random, new SeededRandom(42));
kernel.init();
```

---

## Module map

```
src/
├── core/           ALifeKernel, Clock, SpatialGrid, Vec2, PortRegistry, Diagnostics
├── ai/             StateMachine, MemorySystem, DangerManager, GOAPPlanner/Action/WorldState
├── combat/         DamageInstance, ImmunityProfile, MoraleTracker
├── config/         IALifeConfig, createDefaultConfig
├── entity/         IEntity, IComponent (interfaces only)
├── events/         EventBus, ALifeEvents, ALifeEventPayloads
├── faction/        Faction, FactionBuilder, IFactionState
├── logger/         Logger, LogLevel, LogChannel, ILogEntry
├── movement/       PatrolRouteTracker, RouteType, MonsterHome
├── navigation/     LevelGraph, NPCGraphMover
├── plugins/        IALifePlugin, built-in plugins, PluginToken, presets
├── ports/          IEntityAdapter, IEntityFactory, IRandom, IRuntimeClock, IDataLoader, ILogger
├── registry/       Registry, FactionRegistry, NPCTypeRegistry, MonsterRegistry, AIStateRegistry, …
├── schema/         validateMonsterDefinition, validateFactionDefinition, assertion helpers
├── spawn/          SpawnRegistry
├── terrain/        Zone, SmartTerrain, TerrainBuilder
└── time/           TimeManager
```
