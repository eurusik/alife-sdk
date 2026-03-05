# ALifeKernel

Central orchestrator and developer entry point for the A-Life SDK.
The kernel owns the event bus, clock, spatial grid, and logger. All
domain-specific functionality is added via plugins.

```ts
import { ALifeKernel, Ports, createPortToken } from '@alife-sdk/core';
import type { IALifeKernelConfig, IALifeKernelState } from '@alife-sdk/core';
```

---

## Lifecycle overview

```
1. new ALifeKernel(options?)   — configure
2. provide(token, impl)        — wire engine adapters (before init)
3. use(plugin)                 — install plugins (before init)
4. registerMigration(v, fn)    — optional: register save migrations
5. init()                      — validate, create subsystems, init plugins
6. start()                     — enable frame updates
7. update(deltaMs)             — each frame
   pause() / resume()          — freeze/unfreeze time
8. serialize() / restoreState()— save/load
9. inspect()                   — devtools snapshot
10. destroy()                  — shutdown
```

---

## Constructor

```ts
new ALifeKernel(options?: IALifeKernelConfig)
```

```ts
interface IALifeKernelConfig {
  config?: Partial<IALifeConfig>;  // override any config section
  logger?: ILoggerConfig;          // log level, namespaces
  clock?: { timeFactor?, startHour?, startDay? };
}
```

All fields are optional — `new ALifeKernel()` works with production defaults.

Override config sections without touching the rest:

```ts
const kernel = new ALifeKernel({
  config: {
    tick:       { intervalMs: 3_000 },
    simulation: { onlineRadius: 400, offlineRadius: 600 },
  },
});
```

---

## Ports — bridging to your engine

Ports are typed adapters that connect the kernel to your game engine.
The SDK defines interfaces; you implement them for Phaser, PixiJS, or any
other engine.

### Engine ports (optional — auto-provided as no-ops)

These ports wire the kernel to your engine's entity system. If you don't
provide them, the kernel auto-provides silent no-op defaults so that
offline simulation, persistence, and AI tests work without any engine setup.

| Port token | Interface | Description |
|------------|-----------|-------------|
| `Ports.EntityAdapter` | `IEntityAdapter` | Read/move/kill entities by ID |
| `Ports.PlayerPosition` | `IPlayerPositionProvider` | Player's current world position |
| `Ports.EntityFactory` | `IEntityFactory` | Create/destroy entities on spawn/despawn |

Provide real implementations when running inside your game engine:

```ts
kernel.provide(Ports.EntityAdapter,  myAdapter);
kernel.provide(Ports.PlayerPosition, { getPlayerPosition: () => ({ x: player.x, y: player.y }) });
kernel.provide(Ports.EntityFactory,  myFactory);
```

Omit them entirely for offline/test scenarios — `new ALifeKernel().init()` works
without any `provide()` calls.

### Other optional ports

| Port token | Interface | Description |
|------------|-----------|-------------|
| `Ports.Random` | `IRandom` | Seeded PRNG — defaults to `Math.random` if not provided |
| `Ports.RuntimeClock` | `IRuntimeClock` | Monotonic real-time ms for cooldowns |

### Custom ports (plugins)

Plugins can declare their own ports. Create a token and provide it the same way:

```ts
import { createPortToken } from '@alife-sdk/core';
import type { IMyPathfinder } from './IMyPathfinder';

// Define once (e.g. in your plugin file)
export const PathfinderPort = createPortToken<IMyPathfinder>('pathfinder', 'A* pathfinding');

// Provide before init
kernel.provide(PathfinderPort, new MyPathfinderImpl());

// Consume in plugin or game code
const pf = kernel.portRegistry.require(PathfinderPort); // typed as IMyPathfinder
```

---

## Plugins

Plugins are the primary extension point. Each plugin encapsulates a domain
(simulation, trade, surge, squads, etc.) and interacts with the kernel via
the event bus, spatial grid, and port registry.

```ts
kernel.use(new SimulationPlugin());
kernel.use(new SurgePlugin());   // may depend on SimulationPlugin
kernel.use(new TradePlugin());
```

### Dependency order

`init()` topologically sorts plugins by their declared `dependencies`.
You don't need to call `use()` in the right order — the kernel resolves it:

```ts
kernel.use(new SurgePlugin());       // declares dependency on 'simulation'
kernel.use(new SimulationPlugin());  // registered second, but init()ed first
```

### Accessing plugins at runtime

```ts
// By typed token (preferred)
const sim = kernel.getPlugin(SimulationPluginToken);

// By name string (less type-safe)
const sim = kernel.getPlugin<SimulationPlugin>('simulation');
```

---

## Lifecycle methods

### `init()`

```ts
init(): DiagnosticsCollector
```

Auto-provides no-op defaults for `EntityAdapter`, `PlayerPosition`, and
`EntityFactory` if the host hasn't supplied real implementations. Validates
plugin dependencies, creates subsystems (Clock, SpatialGrid, Logger), and
calls `plugin.init()` for each plugin in dependency order.

Returns a `DiagnosticsCollector` with all warnings/infos. Throws
`ALifeValidationError` if any errors were found (unresolved plugin dependency,
missing plugin-declared `requiredPorts`).

```ts
try {
  const diag = kernel.init();
  if (diag.warnings.length > 0) console.warn(diag.format());
} catch (e) {
  if (e instanceof ALifeValidationError) {
    console.error(e.message); // lists all problems at once
  }
}
```

### `start()`

Enables frame-based `update()`. Must be called after `init()`.

### `update(deltaMs)`

Advances the simulation by `deltaMs` real milliseconds. Calls
`clock.update()`, then `plugin.update()` for each plugin, then flushes
the event bus. No-op when paused.

### `step(count?)`

```ts
step(count: number = 1): void
```

Deterministic alternative to `update()`. Advances by `count` full ticks at
`config.tick.intervalMs` each. Does **not** require `start()` — ideal for
unit tests:

```ts
kernel.init();
kernel.step(10); // run 10 ticks without starting the real-time loop
```

### `pause()` / `resume()`

Freeze/unfreeze the clock and all plugin updates. `update()` becomes a no-op
while paused.

### `destroy()`

Destroys plugins in reverse dependency order, clears the event bus and
spatial grid. Call when the scene is destroyed.

---

## Kernel accessors (available after `init()`)

| Accessor | Type | Description |
|----------|------|-------------|
| `kernel.clock` | `Clock` | In-game time |
| `kernel.logger` | `ILogger` | Structured logger |
| `kernel.spatialGrid` | `SpatialGrid` | World-space spatial index |
| `kernel.events` | `EventBus` | Typed event bus |
| `kernel.entityAdapter` | `IEntityAdapter` | Shorthand for `portRegistry.require(Ports.EntityAdapter)` |
| `kernel.playerPosition` | `IPlayerPositionProvider` | Shorthand for player position port |
| `kernel.entityFactory` | `IEntityFactory` | Shorthand for entity factory port |
| `kernel.currentConfig` | `IALifeConfig` | Resolved (merged) config |
| `kernel.tick` | `number` | Total tick count since `init()` |
| `kernel.isRunning` | `boolean` | Whether `start()` has been called |
| `kernel.isPaused` | `boolean` | Whether the kernel is paused |

---

## Save / Load

### `kernel.serialize()`

```ts
serialize(): IALifeKernelState
```

Captures clock state, tick count, and per-plugin state:

```ts
const saved = kernel.serialize();
localStorage.setItem('save', JSON.stringify(saved));
```

### `kernel.restoreState(state)`

```ts
restoreState(state: IALifeKernelState): void
```

Restores clock state, then calls `plugin.restore()` for each plugin that
has serialised state. Runs registered migrations automatically when the
save version is older than the current kernel version.

```ts
const saved = JSON.parse(localStorage.getItem('save')!);
kernel.restoreState(saved);
```

### State migrations

Register a migration function to upgrade old saves:

```ts
kernel.registerMigration(1, (state) => {
  // upgrade from v1 to v2
  return { ...state, version: 2 };
});
```

Migrations run automatically during `restoreState()` when the save
version is behind `KERNEL_STATE_VERSION`.

---

## DevTools — `kernel.inspect()`

```ts
inspect(config?: IDevToolsConfig): IDevToolsSnapshot
```

Returns a plain JSON-serialisable snapshot of the current kernel state
for debug overlays or monitoring tools:

```ts
const snap = kernel.inspect();
console.log(`Tick ${snap.tick}, Hour ${snap.clock.gameHour}, Running: ${snap.running}`);
console.log('Plugins:', snap.pluginNames);
console.log('Grid entities:', snap.spatialGrid?.entityCount);
```

Control what's included:

```ts
const snap = kernel.inspect({
  includePlugins:     true,  // per-plugin inspect() data
  includeSpatialGrid: true,  // entity count + cell size
  includePorts:       false, // omit port list
});
```

---

## Writing a plugin

Implement `IALifePlugin` to extend the kernel:

```ts
import type { IALifePlugin } from '@alife-sdk/core/plugins';
import type { ALifeKernel } from '@alife-sdk/core';

export class MyPlugin implements IALifePlugin {
  readonly name = 'myPlugin';

  // Declare what this plugin needs
  readonly dependencies = ['simulation'];         // hard dep
  readonly optionalDependencies = ['trade'];      // soft dep
  readonly requiredPorts = [PathfinderPort];      // port dep

  private kernel!: ALifeKernel;

  install(kernel: ALifeKernel): void {
    this.kernel = kernel;
    // Register event listeners, extend registries, etc.
  }

  init(): void {
    // Called after all plugins are installed, subsystems ready
    // Access kernel.clock, kernel.spatialGrid, etc. here
  }

  update(deltaMs: number): void {
    // Called every frame when kernel is running and not paused
  }

  destroy(): void {
    // Called on kernel.destroy() — clean up subscriptions
  }

  // Optional: save/load
  serialize(): Record<string, unknown> {
    return { myState: 42 };
  }

  restore(state: Record<string, unknown>): void {
    // restore from saved state
  }

  // Optional: devtools
  inspect(): Record<string, unknown> {
    return { entityCount: 100 };
  }
}
```

---

## Full example — test setup

Engine ports (`EntityAdapter`, `PlayerPosition`, `EntityFactory`) are
auto-provided as no-ops, so test kernels need zero boilerplate:

```ts
import { ALifeKernel } from '@alife-sdk/core';

function buildKernel() {
  const kernel = new ALifeKernel({
    config: { tick: { intervalMs: 100 } },
  });
  kernel.init(); // no provide() calls needed
  return kernel;
}

const kernel = buildKernel();
kernel.step(5);
console.log(kernel.tick); // 5
kernel.destroy();
```

In production (Phaser, PixiJS, etc.) supply real adapters before `init()`:

```ts
import { ALifeKernel, Ports } from '@alife-sdk/core';

const kernel = new ALifeKernel();
kernel.provide(Ports.EntityAdapter,  new PhaserEntityAdapter(scene));
kernel.provide(Ports.PlayerPosition, { getPlayerPosition: () => ({ x: player.x, y: player.y }) });
kernel.provide(Ports.EntityFactory,  new PhaserEntityFactory(scene));
kernel.init();
```
