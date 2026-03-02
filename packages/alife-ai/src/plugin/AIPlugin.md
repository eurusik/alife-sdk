# AIPlugin

`IALifePlugin` implementation that registers the tactical AI subsystem
with the `ALifeKernel`.

```ts
import { AIPlugin, createDefaultAIPluginConfig } from '@alife-sdk/ai/plugin';
import type { IAIPluginConfig } from '@alife-sdk/ai/plugin';
```

---

## IAIPluginConfig

```ts
interface IAIPluginConfig {
  readonly ai: IOnlineAIConfig;
  /** Optional cover lock config overrides. Set false to disable locking. */
  readonly coverLock?: Partial<ICoverLockConfig> | false;
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `ai` | `createDefaultAIConfig()` | Full AI config — cover, navigation, weapon, squad, GOAP, etc. |
| `coverLock` | `undefined` (enabled with defaults) | Cover lock TTL config. `false` disables locking entirely. |

### createDefaultAIPluginConfig(): IAIPluginConfig

Returns a valid config with all defaults:

```ts
const config = createDefaultAIPluginConfig();
// { ai: createDefaultAIConfig() }
```

---

## Constructor

```ts
new AIPlugin(random: IRandom, config?: Partial<IAIPluginConfig>, timeFn?: () => number)
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `random` | yes | Deterministic random source used by `CoverRegistry` for jitter |
| `config` | no | Partial config — any missing fields use defaults |
| `timeFn` | no | Time source for cover lock TTL (ms). Defaults to `() => Date.now()`. Pass your game clock for deterministic simulations |

> **Deep merge:** passing `{ ai: { cover: { searchRadius: 400 } } }` merges
> only `cover.searchRadius` — all other cover, navigation, weapon, GOAP fields
> retain their defaults. You never need to specify the full config to override
> a single value.

```ts
// Minimal — all defaults
const plugin = new AIPlugin(random);

// Override one field only
const plugin = new AIPlugin(random, {
  ai: { cover: { searchRadius: 400 } },
});

// Custom time source + cover lock TTL
const plugin = new AIPlugin(
  random,
  { coverLock: { defaultTtlMs: 5_000 } },
  () => gameTime.nowMs,
);

// Disable cover locking
const plugin = new AIPlugin(random, { coverLock: false });
```

---

## Properties

### `name: 'ai'`

Plugin identifier used by the kernel. Always `'ai'`.

### `dependencies: []`

No other plugins required.

### `coverRegistry: CoverRegistry`

Registry of all tactical cover points. Add points manually or via
`AIPorts.CoverPointSource`:

```ts
// Manual registration:
plugin.coverRegistry.addPoint(x, y, radius?);

// Query best cover from a search origin:
const best = plugin.coverRegistry.findBest(
  { x: npc.x, y: npc.y },
  { x: threat.x, y: threat.y },
  plugin.getConfig().cover,
);
```

### `coverLockRegistry: CoverLockRegistry | null`

TTL-based lock registry for cover points. `null` when cover locking is
disabled (`coverLock: false`).

```ts
if (plugin.coverLockRegistry) {
  const acquired = plugin.coverLockRegistry.tryLock(point.id, npc.id);
  if (!acquired) {
    // Point taken — find another
  }
}
```

| ICoverLockConfig field | Default | Description |
|------------------------|---------|-------------|
| `defaultTtlMs` | `10_000` | Lock expiry time in ms |
| `defaultCapacity` | `1` | Max NPCs per cover point |
| `autoPurgeInterval` | `32` | Auto-purge stale locks every N calls |

Lock lifecycle:
- Locks expire automatically after `defaultTtlMs`.
- `tryLock(pointId, npcId)` is **idempotent** — refreshes TTL if the NPC already holds the lock.
- On NPC death or despawn: call `coverLockRegistry.unlockAll(npc.id)` for immediate release (optional — TTL handles cleanup otherwise).

### `restrictedZones: RestrictedZoneManager`

Manages IN / OUT / DANGER movement zones. Survives save/load via `serialize()` / `restore()`.

```ts
// Add a combat danger zone:
plugin.restrictedZones.addZone({
  id: 'combat-z1',
  type: RestrictionType.DANGER,
  x: 500, y: 300,
  radius: 200,
  active: true,
});

// Check before moving:
if (plugin.restrictedZones.isDangerous(target.x, target.y)) {
  // pick a safer waypoint
}
```

See [RestrictedZoneManager.md](../navigation/RestrictedZoneManager.md) for the full API.

---

## Methods

### install(kernel: ALifeKernel): void

Called by `kernel.use(plugin)`. Stores the kernel reference for use in `init()`.
Do not call manually.

### init(): void

Called by `kernel.init()` after all plugins are installed.

If `AIPorts.CoverPointSource` is registered in the kernel's port registry,
`init()` queries it with infinite bounds and loads all returned points into
`coverRegistry`.

```ts
// The plugin calls this automatically — no action needed on your part.
// Just provide the port before kernel.init():
kernel.portRegistry.provide(AIPorts.CoverPointSource, myLevelSource);
kernel.init();  // cover points loaded here
```

### destroy(): void

Called by `kernel.destroy()`. Clears `coverRegistry`, `coverLockRegistry`,
and `restrictedZones`. Releases the kernel reference.

Do not call manually — use `kernel.destroy()`.

### createCoverAccess(npcId: string): ICoverAccess

Create a per-NPC `ICoverAccess` adapter. The adapter wraps both registries and
tracks the last cover point found to simplify the lock → use → release flow
in AI states.

```ts
// On NPC spawn:
const coverAccess = plugin.createCoverAccess(npc.id);
// Pass coverAccess to TakeCoverState / RetreatState via INPCContext.

// Inside a state:
const point = coverAccess.findCover(npc.x, npc.y, threat.x, threat.y);
if (point) {
  coverAccess.lockLastFound?.(npc.id);  // optional method — pass NPC id for the lock
  npc.moveTo(point.x, point.y);         // point is { x, y }
}
```

> **One adapter per NPC.** `ICoverAccess` is stateful — it tracks the last
> found cover point. Sharing it across NPCs will corrupt that state.

### getConfig(): IOnlineAIConfig

Returns the merged AI configuration:

```ts
const cfg = plugin.getConfig();
// cfg.cover.searchRadius
// cfg.navigation.arrivalThreshold
// cfg.weapon.shotgunEffectiveMax
// cfg.squad.nearbyRadius
// cfg.goap.replanIntervalMs
// cfg.monsterAbility.chargeWindupMs
// cfg.perception.visionRange
```

### serialize(): Record\<string, unknown\>

Returns serializable state containing `restrictedZones` definitions.
Cover locks are **not** serialized (ephemeral TTL — see note below).

```ts
const saved = plugin.serialize();
// { zones: [{ id, type, x, y, radius, active, metadata }, ...] }
```

> Cover locks are intentionally omitted from serialization. They are
> short-lived TTL reservations (default 10 s). Restoring stale locks would
> permanently block cover points with no recovery path. NPCs re-acquire
> locks on their next `TakeCover` or `Retreat` state entry after loading.

### restore(state: Record\<string, unknown\>): void

Restores `restrictedZones` from serialized state. Clears existing zones first.

```ts
// On load:
const plugin = new AIPlugin(random, config, timeFn);
kernel.use(plugin);
kernel.init();           // cover points auto-populated if port is provided
plugin.restore(savedState.ai);  // zones restored
```

---

## Full setup example

```ts
import { ALifeKernel, SeededRandom } from '@alife-sdk/core';
import { AIPlugin } from '@alife-sdk/ai/plugin';
import { AIPorts } from '@alife-sdk/ai/ports';
import { RestrictionType } from '@alife-sdk/ai/navigation';

// --- Scene setup ---

const kernel = new ALifeKernel();
const random = new SeededRandom(sceneSeed);

const aiPlugin = new AIPlugin(
  random,
  {
    ai: { cover: { searchRadius: 350 } },
    coverLock: { defaultTtlMs: 8_000 },
  },
  () => gameTime.nowMs,
);

// Optional: provide cover point source from level data
kernel.portRegistry.provide(AIPorts.CoverPointSource, {
  getPoints: (bounds) => level.getCoverPoints(bounds),
});

kernel.use(aiPlugin);
kernel.init();  // cover points auto-loaded

// Add surge danger zones during events:
surgeManager.on('started', () => {
  aiPlugin.restrictedZones.addZone({
    id: 'surge-open-field',
    type: RestrictionType.DANGER,
    x: 0, y: 0, radius: 1000,
    active: true,
    metadata: 'surge',
  });
});

// --- Per-NPC setup ---

function spawnNPC(npcId: string) {
  const coverAccess = aiPlugin.createCoverAccess(npcId);
  // Store coverAccess in NPC's INPCContext
}

// --- Serialization ---

function saveGame() {
  return { ai: aiPlugin.serialize() };
}

function loadGame(data: ReturnType<typeof saveGame>) {
  const plugin = new AIPlugin(random, config, () => gameTime.nowMs);
  const k = new ALifeKernel();
  k.use(plugin);
  k.init();
  plugin.restore(data.ai);
  return plugin;
}

// --- Teardown ---

kernel.destroy();
```
