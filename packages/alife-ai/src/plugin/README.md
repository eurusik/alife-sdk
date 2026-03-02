# plugin

Entry point for the `@alife-sdk/ai` tactical AI subsystem.
`AIPlugin` wires together cover management, movement constraints, and config,
and registers everything with the `ALifeKernel` plugin system.

```ts
import { AIPlugin, createDefaultAIPluginConfig } from '@alife-sdk/ai/plugin';
import type { IAIPluginConfig } from '@alife-sdk/ai/plugin';
```

---

## Quick start

```ts
import { ALifeKernel, SeededRandom } from '@alife-sdk/core';
import { AIPlugin } from '@alife-sdk/ai/plugin';

// 1. Create the plugin (one per scene)
const random = new SeededRandom(42);
const aiPlugin = new AIPlugin(random);

// 2. Register with kernel
const kernel = new ALifeKernel();
kernel.use(aiPlugin);
kernel.init();  // calls aiPlugin.install() then aiPlugin.init()

// 3. Access subsystems
const cover  = aiPlugin.coverRegistry;
const zones  = aiPlugin.restrictedZones;
const config = aiPlugin.getConfig();

// 4. Create per-NPC cover access (one per NPC — do NOT share)
const coverAccess = aiPlugin.createCoverAccess('npc-42');

// 5. On scene shutdown
kernel.destroy();  // calls aiPlugin.destroy()
```

---

## What AIPlugin provides

| Subsystem | Property | Purpose |
|-----------|----------|---------|
| Cover registry | `coverRegistry` | Find and score tactical cover points |
| Cover lock registry | `coverLockRegistry` | Prevent multiple NPCs claiming the same cover (TTL-based) |
| Restricted zones | `restrictedZones` | IN / OUT / DANGER movement constraints |
| Config | `getConfig()` | Full `IOnlineAIConfig` (cover, navigation, weapon, squad, GOAP, etc.) |

---

## Configuration

Pass only the fields you want to override — defaults fill in the rest:

```ts
const aiPlugin = new AIPlugin(random, {
  ai: {
    cover: { searchRadius: 400 },    // override one cover field
    // navigation, weapon, squad, goap etc. keep their defaults
  },
});
```

Full config with cover lock override:

```ts
const aiPlugin = new AIPlugin(
  random,
  {
    ai: createDefaultAIConfig({ cover: { searchRadius: 400 } }),
    coverLock: { defaultTtlMs: 5_000 },  // lock expires in 5 s instead of 10 s
  },
  () => gameTime.nowMs,  // custom time source for lock TTL
);
```

Disable cover locking entirely (e.g. for offline/headless simulation):

```ts
const aiPlugin = new AIPlugin(random, { coverLock: false });
// aiPlugin.coverLockRegistry === null
```

---

## Plugin lifecycle

`AIPlugin` follows the `IALifePlugin` contract:

```
new AIPlugin(random, config?, timeFn?)
        │
        ▼  kernel.use(aiPlugin)
   install(kernel)          — stores kernel reference
        │
        ▼  kernel.init()
   init()                   — auto-populates cover points from ICoverPointSource port (if provided)
        │
        ▼  (scene running)
   coverRegistry / restrictedZones / createCoverAccess() in use
        │
        ▼  kernel.destroy()
   destroy()                — clears all subsystems, releases kernel reference
```

---

## Optional ports

`AIPlugin` works without any ports, but gains extra capabilities when
ports are provided to the kernel before `init()`:

### `AIPorts.CoverPointSource`

Auto-populates `coverRegistry` with cover points from host level data.
If not provided, register points manually with `coverRegistry.addPoint()`.

```ts
import { AIPorts } from '@alife-sdk/ai/ports';

kernel.portRegistry.provide(AIPorts.CoverPointSource, {
  getPoints(bounds) {
    return tilemap.getCoverPoints(bounds);  // returns ICoverPointData[]
  },
});

kernel.use(aiPlugin);
kernel.init();  // cover points are loaded automatically during init()
```

### `AIPorts.PerceptionProvider`

Provides spatial entity queries for the perception system.
`AIPlugin` does **not** consume this port itself — it is read by AI state
handlers (e.g. GOAP, CombatState) that need to query nearby entities. Register
it once and the states will pick it up through the kernel.

```ts
import type { IPerceivedEntity } from '@alife-sdk/ai/types';

kernel.portRegistry.provide(AIPorts.PerceptionProvider, {
  getEntitiesInRadius(center: Vec2, radius: number): readonly IPerceivedEntity[] {
    return spatialGrid.queryRadius(center, radius).map(toPerceivedEntity);
  },
  // Optional — omit if you have no LOS raycasting:
  isLineOfSightClear(from: Vec2, to: Vec2): boolean {
    return !physics.raycast(from, to).hasHit;
  },
});
```

---

## Serialization

`AIPlugin` implements `serialize()` / `restore()` for save/load support.

**What is serialized:** `restrictedZones` — zone definitions (id, type, position, radius, active, metadata).

**What is NOT serialized:** cover locks. Locks are ephemeral TTL reservations
(default 10 s) — persisting them across save/load would permanently block cover
points. NPCs re-acquire locks naturally on their next `TakeCover` or `Retreat`
state entry after loading.

```ts
// Save
const state = aiPlugin.serialize();
saveData.ai = state;

// Load (into a fresh plugin)
const aiPlugin2 = new AIPlugin(random, config, timeFn);
kernel2.use(aiPlugin2);
kernel2.init();
aiPlugin2.restore(saveData.ai);
```

---

## Per-NPC cover access

`createCoverAccess(npcId)` returns an `ICoverAccess` adapter that wraps
`CoverRegistry` + `CoverLockRegistry` with per-NPC state tracking.

```ts
// On NPC spawn:
const coverAccess = aiPlugin.createCoverAccess(npc.id);
// Store coverAccess on the NPC — use it in TakeCoverState / RetreatState.

// On NPC death/despawn — the lock registry expires locks via TTL automatically.
// For immediate release, call unlock via CoverLockRegistry directly if needed.
```

> **One adapter per NPC.** `ICoverAccess` is stateful — it tracks the last
> cover point found so that `lockLastFound?(npcId)` can be called without
> managing point IDs manually. Sharing one adapter across multiple NPCs will
> cause them to overwrite each other's state.

---

## Components

| File | Purpose |
|------|---------|
| [AIPlugin.md](AIPlugin.md) | `AIPlugin` class + `IAIPluginConfig` — full API reference |
