# Core Plugins Reference

Use this page when you are deciding what should live in the kernel runtime and what should stay in scene or UI code.

Plugins are where the kernel starts owning domain state. The kernel itself stays narrow and focused on runtime coordination.

## Import path

```ts
import type { IALifePlugin } from "@alife-sdk/core/plugins";
import {
  FactionsPlugin,
  NPCTypesPlugin,
  CombatSchemaPlugin,
  SpawnPlugin,
  MonstersPlugin,
  AnomaliesPlugin,
  Plugins,
  fullPreset,
  minimalPreset,
} from "@alife-sdk/core/plugins";
```

## What plugins own

The kernel owns:

- lifecycle
- event bus
- clock
- ports

Plugins own domain runtime state such as:

- faction tables
- NPC type registries
- combat schema
- spawn cooldown state
- monster registries
- anomaly definitions

That boundary is the main reason the plugin system exists.

## Minimal setup

```ts
const kernel = new ALifeKernel();

minimalPreset(kernel);

kernel.init();
kernel.start();
```

Or install individual plugins:

```ts
kernel.use(new FactionsPlugin());
kernel.use(new NPCTypesPlugin());
kernel.use(new SpawnPlugin(30_000));

const factions = kernel.getPlugin(Plugins.FACTIONS);
factions.factions.register("stalker", {
  name: "Stalker",
  baseRelations: { military: -80, bandit: -100 },
});
```

## Plugin lifecycle

Every plugin follows the same high-level flow:

1. `install`
2. `init`
3. `update`
4. `destroy`

Practical rule:

register the plugin before `kernel.init()`, and register upfront data before init when that plugin expects definitions to exist from the start.

## Built-in presets

| Preset | What it installs |
|---|---|
| `minimalPreset` | factions, npc types, combat schema, spawn |
| `fullPreset` | minimal preset plus monsters and anomalies |

Presets are only setup shortcuts. They do not change how the plugin model works.

## Built-in plugins

| Plugin | Owns |
|---|---|
| `FactionsPlugin` | faction definitions and relations |
| `NPCTypesPlugin` | human NPC archetypes |
| `CombatSchemaPlugin` | damage and immunity schema |
| `SpawnPlugin` | spawn point cooldowns |
| `MonstersPlugin` | monster definitions |
| `AnomaliesPlugin` | anomaly type definitions |

## `kernel.getPlugin()` rule

Use typed plugin tokens from `Plugins` instead of magic strings:

```ts
const factions = kernel.getPlugin(Plugins.FACTIONS);
const spawn = kernel.getPlugin(Plugins.SPAWN);
```

This keeps the return type precise and avoids unsafe casts.

## When to write your own plugin

Write a custom plugin when the subsystem:

- owns state across frames
- needs clean `init` / `update` / `destroy` hooks
- belongs in headless runtime tests, not only in rendered scenes
- should be accessible as a kernel capability

Do not write a plugin for:

- HUD rendering
- one-off scene helpers
- input handlers
- thin UI glue

## Minimal custom plugin

```ts
class WeatherPlugin implements IALifePlugin {
  readonly name = "weather";

  install(kernel: ALifeKernel): void {
    this.kernel = kernel;
  }

  init(): void {
    this.unsubscribe = this.kernel.events.on(ALifeEvents.HOUR_CHANGED, ({ isDay }) => {
      this.rainIntensity = isDay ? 0 : 0.4;
    });
  }

  update(deltaMs: number): void {
    if (this.rainIntensity > 0) {
      this.simulateRain(deltaMs);
    }
  }

  destroy(): void {
    this.unsubscribe?.();
  }
}
```

## Failure patterns

- putting runtime ownership into scene code that should be a plugin
- putting scene presentation into a plugin that should stay host-side
- installing plugins after `kernel.init()`
- retrieving plugins by string and losing type safety
- forgetting cleanup in `destroy()`

## Related pages

- [Core package](/docs/packages/core)
- [Core Events](/docs/reference/core/events)
