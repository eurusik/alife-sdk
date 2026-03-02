# ports

Narrow interfaces the simulation SDK calls into your game engine. You implement
them once; the simulation layer never imports Phaser, PixiJS, or any component
system.

```ts
import { SimulationPorts, createNoOpBridge } from '@alife-sdk/simulation/ports';
import type { ISimulationBridge } from '@alife-sdk/simulation/ports';
```

---

## What's in this module

| Export | Kind | What it does |
|--------|------|-------------|
| `ISimulationBridge` | interface | **You implement** — bridge to engine's health/morale systems |
| `SimulationPorts` | const | Port tokens for `kernel.provide()` |
| `createNoOpBridge` | function | Safe no-op implementation for tests and prototyping |

---

## ISimulationBridge

The only port the simulation needs. It connects the offline simulation loop
(combat, surge damage, morale) to your engine's entity components:

```ts
interface ISimulationBridge {
  isAlive(entityId: string): boolean;

  applyDamage(entityId: string, amount: number, damageTypeId: string): boolean;
  // returns true if the entity died from this hit

  getEffectiveDamage(entityId: string, rawDamage: number, damageTypeId: string): number;
  // immunity-adjusted damage — used to pre-compute before HP mutation

  adjustMorale(entityId: string, delta: number, reason: string): void;
}
```

### Who calls it

| Caller | Method used |
|--------|------------|
| `OfflineCombatResolver` | `isAlive`, `applyDamage`, `getEffectiveDamage`, `adjustMorale` |
| `SurgeManager` | `applyDamage`, `adjustMorale` |
| `NPCBrain` (liveness guard) | `isAlive` via `isNPCRecordAlive` |

---

## Implementing the port

### Phaser + ECS example

```ts
import type { ISimulationBridge } from '@alife-sdk/simulation/ports';

class PhaserSimulationBridge implements ISimulationBridge {
  constructor(
    private readonly entities: EntityRegistry,
    private readonly immunity: ImmunitySystem,
  ) {}

  isAlive(entityId: string): boolean {
    return this.entities.get(entityId)?.health.isAlive ?? false;
  }

  applyDamage(entityId: string, amount: number, damageTypeId: string): boolean {
    const entity = this.entities.get(entityId);
    if (!entity) return false;
    const effective = this.immunity.reduce(entity, amount, damageTypeId);
    entity.health.applyDamage(effective);
    return !entity.health.isAlive;
  }

  getEffectiveDamage(entityId: string, rawDamage: number, damageTypeId: string): number {
    const entity = this.entities.get(entityId);
    if (!entity) return 0;
    return this.immunity.reduce(entity, rawDamage, damageTypeId);
  }

  adjustMorale(entityId: string, delta: number, _reason: string): void {
    this.entities.get(entityId)?.alife.adjustMorale(delta);
  }
}
```

### Registering with the kernel

```ts
import { SimulationPorts } from '@alife-sdk/simulation/ports';

kernel.provide(
  SimulationPorts.SimulationBridge,
  new PhaserSimulationBridge(entityRegistry, immunitySystem),
);
```

The kernel validates that all required ports are provided at `kernel.init()` —
missing ports throw immediately with a clear error.

---

## SimulationPorts

A const object of typed port tokens — use them for `kernel.provide()` and
`kernel.resolve()`:

```ts
import { SimulationPorts } from '@alife-sdk/simulation/ports';

// Register implementation
kernel.provide(SimulationPorts.SimulationBridge, myBridge);

// Resolve anywhere that has kernel access
const bridge = kernel.resolve(SimulationPorts.SimulationBridge);
```

---

## createNoOpBridge

A safe no-op bridge for unit tests and prototyping — all entities considered
alive, no damage applied, no morale changed:

```ts
import { createNoOpBridge } from '@alife-sdk/simulation/ports';

const bridge = createNoOpBridge();
// isAlive()            → true
// applyDamage()        → false (no death)
// getEffectiveDamage() → 0
// adjustMorale()       → no-op
```

### Use in tests

```ts
import { OfflineCombatResolver }  from '@alife-sdk/simulation/combat';
import { createNoOpBridge }       from '@alife-sdk/simulation/ports';

const resolver = new OfflineCombatResolver(
  createDefaultSimulationConfig().offlineCombat,
  createNoOpBridge(),
  { next: () => 0.5 },
);
// test resolver logic without a full engine
```

### Use in rapid prototyping

Wire the plugin before your engine adapter is ready:

```ts
import { SimulationPorts, createNoOpBridge } from '@alife-sdk/simulation/ports';

kernel.provide(SimulationPorts.SimulationBridge, createNoOpBridge());
kernel.use(simulationPlugin);
kernel.init(); // passes — port is satisfied
```

Replace with the real implementation when your adapter is ready — no other
code changes required.
