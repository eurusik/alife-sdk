# createPhaserKernel

Use this page when you want to go from a Phaser scene setup to a working SDK runtime.

`createPhaserKernel()` is the high-level factory for wiring the common ports, plugins, and startup data in one call.

## Import path

```ts
import { createPhaserKernel } from "@alife-sdk/phaser/scene";
import type {
  IPhaserKernelConfig,
  IPhaserKernelResult,
  IFactionDef,
  KernelPreset,
} from "@alife-sdk/phaser/scene";
```

## What you create

You call `createPhaserKernel()` once per scene setup and get back:

- `kernel`
- `simulation`
- `onlineOffline`

That is the intended Phaser ownership model:

- the kernel remains your runtime coordinator
- simulation may be present depending on preset
- online/offline switching stays explicit scene logic

## What you still implement

The factory does not remove the need to provide real scene bridges:

- entity adapter
- entity factory
- player position
- simulation bridge for simulation/full presets

You still decide:

- when to call `kernel.init()`
- when to call `kernel.start()`
- when to register NPCs
- when to run `kernel.update(delta)`
- when to run `onlineOffline.evaluate(...)`

## Required ports

At minimum, a scene setup needs:

- `entityAdapter`
- `entityFactory`
- `playerPosition`

Add `simulationBridge` whenever you expect simulation or full presets to own offline HP and damage behavior.

## Minimal working example

```ts
const { kernel, simulation, onlineOffline } = createPhaserKernel({
  ports: {
    entityAdapter: adapter,
    playerPosition: playerPos,
    entityFactory: factory,
    simulationBridge: bridge,
  },
  data: {
    factions: [{ id: "stalker" }],
    terrains: loadedTerrains,
  },
  config: {
    preset: "simulation",
  },
});

kernel.init();
kernel.start();

simulation?.registerNPC({
  entityId: "stalker_1",
  factionId: "stalker",
  position: { x: 300, y: 280 },
  rank: 2,
  combatPower: 40,
  currentHp: 100,
  behaviorConfig: createDefaultBehaviorConfig(),
  options: { type: "human" },
});

function update(_time: number, delta: number) {
  kernel.update(delta);

  const { goOnline, goOffline } = onlineOffline.evaluate(player.x, player.y, records);

  for (const id of goOnline) simulation?.setNPCOnline(id, true);
  for (const id of goOffline) simulation?.setNPCOnline(id, false);
}
```

## Preset matrix

| Preset | What you get | Use it when |
|---|---|---|
| `minimal` | shell wiring only | you are still assembling the runtime shell |
| `simulation` | + simulation plugin | you want the living-world loop first |
| `full` | + AI and social plugins | your scene shell is already stable |

Default is `simulation`.

## `IPhaserKernelConfig` in practice

The config has four logical groups:

| Group | What belongs there |
|---|---|
| `ports` | scene bridges and adapters |
| `data` | initial factions and terrains |
| `plugins` | plugin-level config overrides |
| `config` | preset, kernel, and online/offline settings |

The most important runtime rule is:

`simulationBridge` is required if you expect simulation/full presets to own offline HP and damage behavior.

## Minimal valid config

```ts
createPhaserKernel({
  ports: {
    entityAdapter,
    entityFactory,
    playerPosition,
    simulationBridge,
  },
  config: {
    preset: "simulation",
  },
});
```

## Common invalid config

- `preset: "simulation"` without `simulationBridge` when you expect offline HP
- calling `kernel.update(time)` instead of `kernel.update(delta)`
- assuming `createPhaserKernel()` will call `init()` or `start()` for you
- registering NPCs before the adapter can resolve their sprites

## `IPhaserKernelResult` in practice

| Field | Meaning |
|---|---|
| `kernel` | the runtime coordinator you must init/start/update |
| `simulation` | direct simulation access, or `null` for `minimal` |
| `onlineOffline` | the switching evaluator you call from scene logic |

## Scene lifecycle

The recommended order is:

1. create adapters and scene-owned bridges
2. call `createPhaserKernel()`
3. call `kernel.init()`
4. register NPCs and world data that depend on init
5. call `kernel.start()`
6. in `Scene.update`, call `kernel.update(delta)`
7. on a sensible cadence, call `onlineOffline.evaluate(...)`

## Failure patterns

- expecting the factory to call `init()` or `start()` for you
- using `full` before the scene shell is stable
- omitting `simulationBridge` while expecting offline HP or combat to work
- passing Phaser `time` instead of `delta` into `kernel.update`
- never applying the `goOnline` / `goOffline` results

## Related pages

- [Phaser package](/docs/packages/phaser)
- [Phaser Adapters](/docs/reference/phaser/adapters)
- [OnlineOfflineManager](/docs/reference/phaser/online-offline-manager)
- [Phaser Integration](/docs/guides/phaser-integration)
