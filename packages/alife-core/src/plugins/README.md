# plugins

The plugin system that extends the A-Life kernel with domain features.

```ts
import type { IALifePlugin } from '@alife-sdk/core/plugins';
import {
  FactionsPlugin, NPCTypesPlugin, CombatSchemaPlugin,
  SpawnPlugin, MonstersPlugin, AnomaliesPlugin,
  Plugins, PluginNames,
  createPluginToken,
  fullPreset, minimalPreset,
} from '@alife-sdk/core/plugins';
```

---

## Concepts

The kernel is intentionally minimal — it manages the lifecycle and event bus,
but owns no game data by itself. **Plugins** add the domain-specific pieces:
faction tables, NPC type definitions, spawn cooldowns, monster registries, etc.

```
ALifeKernel  (lifecycle, events, clock)
     │
     ├── FactionsPlugin    → FactionRegistry
     ├── NPCTypesPlugin    → NPCTypeRegistry
     ├── CombatSchemaPlugin → ImmunityProfile table
     ├── SpawnPlugin       → SpawnRegistry (cooldowns)
     ├── MonstersPlugin    → MonsterRegistry
     └── AnomaliesPlugin   → AnomalyTypeRegistry
```

Each plugin has a **name**, optional **dependencies**, and a four-hook
lifecycle: `install → init → update (per frame) → destroy`.

---

## Quick start — built-in presets

The fastest way to configure the kernel is with a **preset**:

```ts
import { ALifeKernel } from '@alife-sdk/core';
import { fullPreset } from '@alife-sdk/core/plugins';

const kernel = new ALifeKernel();
fullPreset(kernel);   // installs all 6 built-in plugins
kernel.init();
kernel.start();
```

Or pick individual plugins for lighter setups:

```ts
import { minimalPreset } from '@alife-sdk/core/plugins';

const kernel = new ALifeKernel();
minimalPreset(kernel); // factions + npcTypes + combatSchema + spawn only
kernel.init();
kernel.start();
```

| Preset | Plugins included |
|--------|-----------------|
| `fullPreset` | Factions, NPCTypes, CombatSchema, Spawn, Monsters, Anomalies |
| `minimalPreset` | Factions, NPCTypes, CombatSchema, Spawn |

---

## Built-in plugins

### `FactionsPlugin`

Owns faction definitions and inter-faction relations.

```ts
kernel.use(new FactionsPlugin());

// After use(), before init() — register your factions:
const fp = kernel.getPlugin(Plugins.FACTIONS);
fp.factions.register('stalker', {
  name: 'Stalker',
  baseRelations: { military: -80, bandit: -100 },
});
```

**Exposes:** `fp.factions` — `FactionRegistry`

---

### `NPCTypesPlugin`

Human NPC archetypes: HP, speed, equipment profile, rank scaling.

```ts
kernel.use(new NPCTypesPlugin());

const np = kernel.getPlugin(Plugins.NPC_TYPES);
np.npcTypes.register('stalker_grunt', {
  name: 'Сталкер',
  hp: 100,
  speed: 80,
  // ...
});
```

**Exposes:** `np.npcTypes` — `NPCTypeRegistry`

---

### `CombatSchemaPlugin`

Damage type / immunity profile table for NPCs and factions.

```ts
kernel.use(new CombatSchemaPlugin());

const cp = kernel.getPlugin(Plugins.COMBAT_SCHEMA);
// Register per-faction immunity profiles
```

**Exposes:** plugin-specific combat schema registry.

---

### `SpawnPlugin`

Tracks spawn point cooldowns. Call `update(deltaMs)` is handled automatically.

```ts
kernel.use(new SpawnPlugin(/* defaultCooldownMs */ 30_000));

const sp = kernel.getPlugin(Plugins.SPAWN);
sp.spawns.register('sp_cordon_01', { terrainId: 'cordon', position: { x: 200, y: 300 } });

// Check and consume a spawn:
if (sp.spawns.canSpawn('sp_cordon_01')) {
  sp.spawns.markSpawned('sp_cordon_01');
  // ... create entity
}
```

**Exposes:** `sp.spawns` — `SpawnRegistry`
**Implements:** `update`, `serialize`, `restore`

---

### `MonstersPlugin`

Monster type definitions: HP, abilities, lair radii.

```ts
kernel.use(new MonstersPlugin());

const mp = kernel.getPlugin(Plugins.MONSTERS);
mp.monsters.register('bloodsucker', {
  name: 'Bloodsucker',
  hp: 300,
  // ...
});
```

**Exposes:** `mp.monsters` — `MonsterRegistry`

---

### `AnomaliesPlugin`

Anomaly zone type definitions: damage type, rate, artefact table.

```ts
kernel.use(new AnomaliesPlugin());

const ap = kernel.getPlugin(Plugins.ANOMALIES);
ap.anomalyTypes.register('fire_vortex', {
  name: 'Fire Vortex',
  damageType: 'fire',
  damagePerSecond: 40,
});
```

**Exposes:** `ap.anomalyTypes` — `AnomalyTypeRegistry`

---

## Retrieving plugins — `kernel.getPlugin()`

Always use **typed tokens** from `Plugins` — never magic strings:

```ts
// ✓ typed — no cast needed
const fp = kernel.getPlugin(Plugins.FACTIONS);   // typed as FactionsPlugin
const sp = kernel.getPlugin(Plugins.SPAWN);       // typed as SpawnPlugin

// ✗ magic string — payload is typed as unknown IALifePlugin
const fp = kernel.getPlugin('factions');
```

### `Plugins` tokens

| Token | Plugin class | Name string |
|-------|-------------|-------------|
| `Plugins.FACTIONS` | `FactionsPlugin` | `'factions'` |
| `Plugins.NPC_TYPES` | `NPCTypesPlugin` | `'npcTypes'` |
| `Plugins.COMBAT_SCHEMA` | `CombatSchemaPlugin` | `'combatSchema'` |
| `Plugins.SPAWN` | `SpawnPlugin` | `'spawn'` |
| `Plugins.MONSTERS` | `MonstersPlugin` | `'monsters'` |
| `Plugins.ANOMALIES` | `AnomaliesPlugin` | `'anomalies'` |
| `Plugins.SURGE` | `SurgePlugin` | `'surge'` |
| `Plugins.SQUAD` | `SquadPlugin` | `'squad'` |
| `Plugins.SOCIAL` | `SocialPlugin` | `'social'` |
| `Plugins.TRADE` | `TradePlugin` | `'trade'` |

---

## Writing your own plugin

Implement `IALifePlugin` — only `name` and `install` are required:

```ts
import type { IALifePlugin } from '@alife-sdk/core/plugins';
import type { ALifeKernel } from '@alife-sdk/core';
import { ALifeEvents } from '@alife-sdk/core/events';

export class WeatherPlugin implements IALifePlugin {
  readonly name = 'weather';

  // Declare hard dependencies — init() will fail if these are missing
  readonly dependencies = ['factions'] as const;

  private kernel!: ALifeKernel;
  private unsub?: () => void;
  private rainIntensity = 0;

  install(kernel: ALifeKernel): void {
    this.kernel = kernel;
  }

  init(): void {
    // Runs after all plugins are installed and registries are frozen.
    // Safe to read from other plugins here.
    this.unsub = this.kernel.events.on(ALifeEvents.HOUR_CHANGED, ({ isDay }) => {
      this.rainIntensity = isDay ? 0 : 0.4;
    });
    this.kernel.logger.info('weather', 'WeatherPlugin ready');
  }

  update(deltaMs: number): void {
    // Called every frame — keep this fast
    if (this.rainIntensity > 0) {
      this.simulateRain(deltaMs);
    }
  }

  destroy(): void {
    this.unsub?.();
  }

  serialize(): Record<string, unknown> {
    return { rainIntensity: this.rainIntensity };
  }

  restore(state: Record<string, unknown>): void {
    this.rainIntensity = (state.rainIntensity as number) ?? 0;
  }

  inspect(): Record<string, unknown> {
    return { rainIntensity: this.rainIntensity };
  }

  private simulateRain(deltaMs: number): void { /* ... */ }
}
```

Install it alongside built-in plugins:

```ts
fullPreset(kernel);
kernel.use(new WeatherPlugin());
kernel.init();
kernel.start();
```

---

## `IALifePlugin` — full interface

```ts
interface IALifePlugin {
  readonly name: string;

  // Dependencies (checked at init time)
  readonly dependencies?:         readonly string[]; // hard — init fails if missing
  readonly optionalDependencies?: readonly string[]; // soft — warning only
  readonly requiredPorts?:        readonly PortToken<unknown>[]; // port check

  // Lifecycle hooks
  install(kernel: ALifeKernel): void;        // called on kernel.use()
  init?(): void;                              // called on kernel.init(), registries frozen
  update?(deltaMs: number): void;            // called every frame
  destroy?(): void;                           // called on kernel.destroy(), reverse order

  // Save / load
  serialize?(): Record<string, unknown>;
  restore?(state: Record<string, unknown>): void;
  migrateState?(state: Record<string, unknown>, fromVersion: number): Record<string, unknown>;

  // Dev tooling
  inspect?(): Record<string, unknown>;
}
```

### Lifecycle order

```
kernel.use(pluginA)  → pluginA.install()
kernel.use(pluginB)  → pluginB.install()
kernel.init()        → pluginA.init() → pluginB.init()
                                         (registries are frozen after install, before init)
kernel.update(delta) → pluginA.update(delta) → pluginB.update(delta)
kernel.destroy()     → pluginB.destroy() → pluginA.destroy()  ← reverse order
```

---

## `PluginToken` + `createPluginToken`

Create a typed token for your own plugin so callers don't need string casts:

```ts
import { createPluginToken } from '@alife-sdk/core/plugins';
import type { WeatherPlugin } from './WeatherPlugin';

export const WEATHER_PLUGIN = createPluginToken<WeatherPlugin>('weather');

// Consumer — no type assertion needed
const wp = kernel.getPlugin(WEATHER_PLUGIN); // typed as WeatherPlugin
```

---

## Tips

**Register data between `use()` and `init()`.**
Registries are mutable after `kernel.use()` and frozen after `kernel.init()`.
All `register()` calls must happen in that window — typically in your boot
or scene `create()` before calling `kernel.init()`.

```ts
kernel.use(new FactionsPlugin());
// ✓ register here
kernel.getPlugin(Plugins.FACTIONS).factions.register('loners', { ... });
kernel.init(); // freezes registries
```

**Use `dependencies` to guard against missing plugins.**
If your plugin reads `kernel.getPlugin(Plugins.FACTIONS)` in `init()`, declare
`dependencies: ['factions']` — the kernel will emit a diagnostic error if it's
missing, rather than throwing a cryptic runtime error.

**Keep `update()` as short as possible.**
It runs every frame. Avoid allocations, `Map` resizes, or heavy iteration.
Defer expensive work to the event bus when possible.

**Always unsubscribe in `destroy()`.**
Store the `() => void` returned by `kernel.events.on()` and call it in
`destroy()`. Stale listeners fire long after the plugin is gone.
