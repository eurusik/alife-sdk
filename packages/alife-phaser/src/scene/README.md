# scene

One-call kernel factory that wires all SDK plugins into a running `ALifeKernel`.

```ts
import { createPhaserKernel } from '@alife-sdk/phaser/scene';
import type {
  IPhaserKernelConfig,
  IPhaserKernelResult,
  IFactionDef,
  KernelPreset,
} from '@alife-sdk/phaser/scene';
```

---

## What's in this module

| Export | Kind | What it does |
|--------|------|-------------|
| `createPhaserKernel` | function | Wires adapters + plugins into a kernel in one call |
| `IPhaserKernelConfig` | interface | Full configuration for the factory |
| `IPhaserKernelResult` | interface | `{ kernel, simulation, onlineOffline }` |
| `IFactionDef` | interface | Faction definition (id, displayName, relations) |
| `KernelPreset` | type | `'minimal' \| 'simulation' \| 'full'` |

---

## createPhaserKernel

```ts
const { kernel, simulation, onlineOffline } = createPhaserKernel({
  ports: {
    entityAdapter:    adapter,
    playerPosition:   playerPos,
    entityFactory:    factory,
    simulationBridge: bridge,   // required for simulation / full presets
    random:           myRandom, // optional; deterministic seeding
  },
  data: {
    factions: [
      { id: 'stalker', relations: { bandit: -60, military: -20 } },
      { id: 'bandit',  relations: { stalker: -60, military: -40 } },
      { id: 'military' },
    ],
    terrains: loadedTerrains,
  },
  config: {
    preset: 'full',
  },
});

kernel.start();

// In your Phaser scene update():
function update(time: number, delta: number) {
  kernel.update(delta);
}
```

---

## Presets

| Preset | Plugins included |
|--------|-----------------|
| `minimal` | FactionsPlugin, SpawnPlugin |
| `simulation` | + SimulationPlugin (default) |
| `full` | + AIPlugin, SocialPlugin |

The default preset is `'simulation'`.

---

## IPhaserKernelConfig

The config is split into four sections:

### `ports` (required)

| Field | Type | Notes |
|-------|------|-------|
| `entityAdapter` | `IEntityAdapter` | e.g. `PhaserEntityAdapter` |
| `playerPosition` | `IPlayerPositionProvider` | e.g. `PhaserPlayerPosition` |
| `entityFactory` | `IEntityFactory` | e.g. `PhaserEntityFactory` |
| `simulationBridge` | `ISimulationBridge?` | required for simulation/full |
| `random` | `IRandom?` | omit to use `Math.random()` |

### `data` (optional)

| Field | Type | Notes |
|-------|------|-------|
| `factions` | `IFactionDef[]?` | registered into `FactionsPlugin` |
| `terrains` | `SmartTerrain[]?` | registered into `SimulationPlugin` |

### `plugins` (optional overrides)

| Field | Type |
|-------|------|
| `simulation` | `createDefaultPluginConfig` overrides |
| `ai` | `Partial<IAIPluginConfig>` |
| `social` | `Partial<ISocialPluginConfig>` |

### `config` (optional)

| Field | Type | Notes |
|-------|------|-------|
| `preset` | `KernelPreset` | default `'simulation'` |
| `kernel` | `Partial<IALifeKernelConfig>` | kernel-level settings |
| `onlineOffline` | `Partial<IOnlineOfflineConfig>` | hysteresis config |
| `spawnCooldownMs` | `number?` | spawn point cooldown, default 30 000 ms |

---

## IPhaserKernelResult

```ts
interface IPhaserKernelResult {
  readonly kernel:        ALifeKernel;
  readonly simulation:    SimulationPlugin | null;  // null for 'minimal' preset
  readonly onlineOffline: OnlineOfflineManager;
}
```

### kernel

The configured `ALifeKernel`. Call `kernel.start()` once the scene is ready,
then `kernel.update(deltaMs)` every frame.

### simulation

Direct access to `SimulationPlugin` for terrain management, NPC brain
registration, serialization, and subsystem access. `null` when `preset` is
`'minimal'`.

### onlineOffline

The `OnlineOfflineManager` configured with `config.onlineOffline` thresholds.
Call `evaluate()` in your simulation tick (not every frame) to determine which
NPCs should go online or offline.

---

## IFactionDef

```ts
interface IFactionDef {
  readonly id: string;
  readonly displayName?: string;          // defaults to id
  readonly relations?: Record<string, number>; // score: -100 to 100
}
```

Relations with no entry default to neutral (0). Scores below a configured
hostility threshold (typically negative) make factions hostile to each other.
