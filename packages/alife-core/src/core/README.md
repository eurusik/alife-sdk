# core

The heart of `@alife-sdk/core`. Contains the kernel (main entry point),
game clock, spatial indexing, math utilities, ports system, and diagnostics.

```ts
import {
  ALifeKernel,
  Clock,
  SpatialGrid,
} from '@alife-sdk/core';

import {
  Ports,
  PortRegistry,
  createPortToken,
} from '@alife-sdk/core';

import {
  distance, distanceSq, lerp, normalize, subtract,
  add, scale, dot, angle, ZERO,
} from '@alife-sdk/core';

import type { Vec2, IRect, ISerializable } from '@alife-sdk/core';
```

---

## What the SDK gives you

| Component | What it does |
|-----------|--------------|
| `ALifeKernel` | Central orchestrator — owns clock, grid, event bus. Entry point for the whole SDK. |
| `Clock` | Accelerated in-game time with configurable day/night cycle and hour callbacks |
| `SpatialGrid<T>` | Spatial hash for O(1) insert/update + O(k) radius and rect queries |
| `Vec2` | Immutable 2D point interface + 10 pure utility functions |
| `Ports` / `PortRegistry` | Type-safe token-based adapter registry (engine bridge layer) |
| `DiagnosticsCollector` | Structured error/warning accumulator returned by `kernel.init()` |
| `ISerializable<T>` | Common `serialize()` / `restore()` contract for save/load |
| `catmullRom()` | Pure Catmull-Rom spline interpolation (used by path smoother) |

---

## Quick start — minimal kernel setup

```ts
import { ALifeKernel, Ports } from '@alife-sdk/core';

// 1. Create kernel (optional config overrides)
const kernel = new ALifeKernel({
  config: { tick: { intervalMs: 3_000 } },
});

// 2. Provide required engine adapters
kernel.provide(Ports.EntityAdapter,  myEntityAdapter);
kernel.provide(Ports.PlayerPosition, myPlayerPosition);
kernel.provide(Ports.EntityFactory,  myEntityFactory);

// 3. Install plugins
kernel.use(new SimulationPlugin());
kernel.use(new SurgePlugin());

// 4. Initialize (validates ports + deps, creates subsystems)
const diag = kernel.init();
if (diag.warnings.length > 0) {
  console.warn(diag.format());
}

// 5. Start
kernel.start();

// 6. Each frame
function gameLoop(deltaMs: number) {
  kernel.update(deltaMs);
}

// 7. On shutdown
kernel.destroy();
```

---

## Kernel lifecycle

```
new ALifeKernel(options?)
        │
        ▼  provide() × 3 required ports
        │  use() plugins
        │
        ▼  init()
           ├── validates ports (errors block startup)
           ├── validates plugin deps (topological sort)
           ├── creates Clock, SpatialGrid, Logger
           └── calls plugin.init() in dependency order
        │
        ▼  start()
        │
        ▼  update(deltaMs)  ← called each frame
           ├── clock.update()
           └── plugin.update() for each plugin
        │
        ├── pause() / resume()
        ├── serialize() / restoreState()
        └── destroy()
```

---

## Components

| File | Purpose |
|------|---------|
| [ALifeKernel.md](ALifeKernel.md) | Full kernel API — lifecycle, ports, plugins, save/load, devtools |
| [Clock.md](Clock.md) | In-game time acceleration, day/night cycle, serialisation |
| [SpatialGrid.md](SpatialGrid.md) | Generic spatial hash — insert/update/remove/queryRadius/queryRect |
| [Vec2.md](Vec2.md) | `Vec2` interface + all math utilities + `catmullRom()` |

---

## `ISerializable<TState>`

Common interface for any subsystem that supports save/load:

```ts
interface ISerializable<TState> {
  serialize(): TState;   // capture state as plain JSON-safe object
  restore(state: TState): void; // overwrite internal state from snapshot
}
```

`Clock`, plugins, and other SDK systems implement this interface.
When you call `kernel.serialize()`, it collects `serialize()` from all
installed plugins automatically.

---

## `DiagnosticsCollector`

Returned by `kernel.init()`. Contains all validation messages gathered
during startup. Errors throw automatically; warnings and infos are
available for inspection:

```ts
const diag = kernel.init(); // throws ALifeValidationError on missing ports

console.log(diag.errors);   // IDiagnostic[] — should be empty after success
console.log(diag.warnings); // IDiagnostic[] — optional dependencies, config quirks
console.log(diag.format()); // human-readable multiline string
```

Each `IDiagnostic` has `source`, `path`, `message`, and an optional `hint`
for how to fix the problem.

---

## `ReactiveQuery<T>` — observe entity set changes

`ReactiveQuery` maintains a stable "matched" set and fires change notifications
only when entities enter or exit the query — not every tick of every entity.

```ts
import { ReactiveQuery } from '@alife-sdk/core';
import type { QueryChanges, QueryChangeListener } from '@alife-sdk/core';
```

### When to use it

Instead of polling the entity set every frame:
```ts
// polling — O(n) work every tick even when nothing changed
function update() {
  const hostiles = allEntities.filter(e => e.alive && e.hostile);
  combatSystem.setTargets(hostiles);
}
```

Use a reactive query:
```ts
// reactive — fires only when the set changes
const hostileQuery = new ReactiveQuery<Entity>(
  (e) => e.isAlive && e.hasComponent('hostile')
);

hostileQuery.onChange(({ added, removed }) => {
  added.forEach(e => combatSystem.track(e));
  removed.forEach(e => combatSystem.untrack(e));
});

// Each tick — cheap: only notifies if membership changed
hostileQuery.update(world.entities());
```

### API

```ts
const q = new ReactiveQuery<T>(predicate: (e: T) => boolean);

// Re-evaluate predicate; fires onChange if set changed
q.update(allEntities: Iterable<T>): void

// Subscribe to changes — returns unsubscribe function
q.onChange(listener: QueryChangeListener<T>): () => void

// Current matched set (snapshot)
q.current: readonly T[]
q.size: number
q.has(entity: T): boolean

// Manual control (bypasses predicate, still fires listeners)
q.track(entity: T): void
q.untrack(entity: T): void

// Cleanup
q.dispose(): void
```

### `QueryChanges<T>`

```ts
interface QueryChanges<T> {
  readonly added:   readonly T[]; // newly matched this update
  readonly removed: readonly T[]; // no longer matching this update
  readonly current: readonly T[]; // full matched set after this update
}
```

### Example — faction combat tracking

```ts
const militaryQuery = new ReactiveQuery<IEntity>(
  (e) => e.isAlive && e.entityType === 'soldier' && e.getComponent('faction').id === 'military'
);

militaryQuery.onChange(({ added, removed }) => {
  added.forEach(e => {
    squadManager.register(e);
    combatAI.beginTracking(e);
  });
  removed.forEach(e => {
    squadManager.unregister(e);
    combatAI.stopTracking(e);
  });
});

// In game loop:
militaryQuery.update(kernel.entityAdapter.getAll());
```
