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
