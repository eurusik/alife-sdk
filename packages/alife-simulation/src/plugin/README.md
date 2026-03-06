# plugin

`SimulationPlugin` — the single `IALifePlugin` that wires all offline A-Life
subsystems into the SDK kernel and runs the 7-step tick pipeline.

```ts
import { SimulationPlugin, createDefaultPluginConfig } from '@alife-sdk/simulation/plugin';
import type { ISimulationPluginConfig, ISimulationPluginState } from '@alife-sdk/simulation/plugin';
```

---

## What's in this module

| Export | Kind | What it does |
|--------|------|-------------|
| `SimulationPlugin` | class | Main plugin — owns all state, wires subsystems, runs the tick |
| `createDefaultPluginConfig` | function | Creates `ISimulationPluginConfig` with production-tuned defaults |
| `ISimulationPluginConfig` | interface | Top-level plugin config (tick budget, morale, sub-configs) |
| `ISimulationPluginState` | interface | Full serialised state for save/restore |

---

## Quick start

```ts
import { SimulationPlugin }          from '@alife-sdk/simulation/plugin';
import { SimulationPorts }           from '@alife-sdk/simulation/ports';

// 1. Implement ISimulationBridge (connects simulation to your engine)
const bridge = {
  isAlive(entityId) { return myEntities.get(entityId)?.hp > 0; },
  applyDamage(entityId, amount, damageTypeId) {
    const entity = myEntities.get(entityId)!;
    entity.hp -= applyResistances(entity, amount, damageTypeId);
    return entity.hp <= 0; // true = entity just died
  },
  getEffectiveDamage(entityId, raw, damageTypeId) {
    return raw * (1 - getResistance(entityId, damageTypeId));
  },
  adjustMorale(entityId, delta, reason) { /* sync to your AI component */ },
};

// 2. Register the port before kernel.init()
kernel.provide(SimulationPorts.SimulationBridge, bridge);

// 3. Register plugins (FactionsPlugin first — SimulationPlugin depends on it)
kernel.use(factionsPlugin);
kernel.use(new SimulationPlugin());
kernel.init();
kernel.start();
```

> `createNoOpBridge()` from `@alife-sdk/simulation/ports` is a zero-dependency
> stub for unit tests (all entities alive, no damage applied).

**Required plugin dependency**: `FactionsPlugin` must be registered before
`SimulationPlugin` — the simulation reads the faction registry on `init()`.

**Optional plugin dependency**: `SpawnPlugin` — when present, surge aftermath
uses its `SpawnRegistry` to reset all cooldowns. When absent, a local
`SpawnRegistry` is used (surge respawn won't affect the host spawn system).

---

## Terrains

Terrains can be registered before or after `kernel.init()`:

```ts
sim.addTerrain(smartTerrain);    // triggers TerrainStateManager creation if already initialized
sim.removeTerrain(terrainId);    // releases occupants, removes state manager
sim.getTerrain(id);              // → SmartTerrain | undefined
sim.getAllTerrains();            // → ReadonlyMap<string, SmartTerrain>
```

---

## NPC lifecycle

```ts
// Register — creates NPC record + brain, assigns squad, initial terrain
const { record, brain } = sim.registerNPC({
  entityId:     'npc_1',
  factionId:    'military',
  combatPower:  50,
  currentHp:    100,
  rank:         3,           // 1–5, affects offline combat multiplier
  position:     { x: 400, y: 300 },
  behaviorConfig: {
    retreatThreshold: 0.2,  // retreat when win probability < 0.2
    panicThreshold:   -0.7, // emit NPC_PANICKED when morale drops here
    dangerTolerance:  3,    // ignore terrains with dangerLevel > this
    aggression:       0.6,
  },
  options: { type: 'human' }, // 'human' | 'monster' | omit for base NPCBrain
});

// Online/offline flag — set by your engine's OnlineOfflineManager
sim.setNPCOnline('npc_1', true);   // engine takes over combat
sim.setNPCOnline('npc_1', false);  // SDK tick pipeline resumes

// Remove completely
sim.unregisterNPC('npc_1');

// Queries
sim.getNPCRecord('npc_1');    // → INPCRecord | undefined
sim.getNPCBrain('npc_1');     // → NPCBrain | null
sim.getAllNPCRecords();       // → ReadonlyMap<string, INPCRecord>
```

> **Online/offline switching is host-owned.** The SDK never reads camera
> position — the host calls `setNPCOnline()` based on player proximity.
> Only offline NPCs (`isOnline === false`) are ticked by the brain pipeline.

---

## Tick loop

Call `kernel.update(deltaMs)` every frame — the plugin handles internal timing:

```ts
// Game loop
function gameLoop(deltaMs: number) {
  kernel.update(deltaMs); // drives sim.update(deltaMs) internally
}
```

`sim.update()` runs two cadences:

| What | Cadence |
|------|---------|
| `SurgeManager.update()` | Every frame (smooth phase transitions + damage tick accumulator) |
| Morale panic evaluation | Every `moraleEvalIntervalMs` (default 2 s) |
| 7-step tick pipeline | Every `tickIntervalMs` (default 5 s) |

---

## 7-step tick pipeline

Runs once every `tickIntervalMs`:

```
Step 1 │ relation fight decay + terrain state (PEACEFUL/ALERT/COMBAT) decay
Step 2 │ offline brain ticks — round-robin, max maxBrainUpdatesPerTick per tick
Step 3 │ movement simulator update (advances lerp journeys, fires NPC_MOVED)
Step 4 │ factional conflict detection → FACTION_CONFLICT events
Step 5 │ offline combat resolution (skipped during active surge)
Step 6 │ morale restore + faction goodwill decay + redundancy cleanup (every N ticks)
Step 7 │ TICK heartbeat event
```

---

## Subsystem access

```ts
sim.getSquadManager();        // SquadManager
sim.getStoryRegistry();       // StoryRegistry
sim.getRelationRegistry();    // NPCRelationRegistry
sim.getMovementSimulator();   // IMovementSimulator
sim.getSurgeManager();        // SurgeManager
```

---

## ISimulationPluginConfig

| Field | Default | Description |
|-------|---------|-------------|
| `tickIntervalMs` | `5_000` | Tick pipeline interval |
| `maxBrainUpdatesPerTick` | `20` | Brain round-robin budget |
| `moraleRestoreRate` | `0.02` | Morale step toward baseline per tick |
| `moraleBaseline` | `0.5` | Morale target all NPCs restore toward |
| `redundancyCleanupInterval` | `3` | Run dead-NPC cleanup every N ticks |
| `moraleEvalIntervalMs` | `2_000` | Panic evaluation cadence |
| `simulation` | (see types/README) | Full `ISimulationConfig` sub-configs |
| `levelGraph?` | `undefined` | When set, uses `GraphMovementSimulator` |
| `movementSimulator?` | `undefined` | Custom `IMovementSimulator` — takes priority over `levelGraph` |

```ts
import { createDefaultPluginConfig } from '@alife-sdk/simulation/plugin';

const config = createDefaultPluginConfig({
  tickIntervalMs: 3_000,
  maxBrainUpdatesPerTick: 30,
  simulation: {
    offlineCombat: { detectionProbability: 80 },
  },
});
```

---

## Serialisation

`SimulationPlugin` is usually serialised through `PersistencePlugin` / `kernel.serialize()`.
If you access the state directly:

```ts
const state = sim.serialize(); // plain JSON-serialisable object
sim.restore(state);
```

**Brains are NOT serialised.** After `restore()`, NPC records are back in
memory but all brain instances are gone. You must re-register every NPC to
rebuild them:

```ts
// 1. Terrains must be added before restore()
sim.addTerrain(terrain_a);
sim.addTerrain(terrain_b);

// 2. Restore state (via PersistencePlugin or directly)
persistence.load(); // or: sim.restore(rawState)

// 3. Rebuild brains from the restored records
//    Keep your own map of options (brain type, equipment, etc.)
for (const record of sim.getAllNPCRecords().values()) {
  sim.registerNPC({
    entityId:       record.entityId,
    factionId:      record.factionId,
    position:       record.lastPosition,
    rank:           record.rank,
    combatPower:    record.combatPower,
    currentHp:      record.currentHp,
    behaviorConfig: record.behaviorConfig,
    options:        myNPCOptionsMap.get(record.entityId),
  });
}
```

Story registry, squads, relations, terrain states, and surge phase are all
restored automatically — only brains need manual rebuilding.

`restore()` throws with a descriptive message on invalid shape, and is
backward-compatible with saves that predate surge serialisation.

---

## Design notes

- **No Phaser / engine imports** — all engine operations go through `ISimulationBridge`.
- **Online/offline switching is host-owned** — SDK never reads camera or viewport.
- **Morale is owned by `NPCBrain`** — when an NPC goes online, read `brain.morale`
  and sync it to your component system.
- **SpawnRegistry.update() is not called** — spawn lifecycle is driven by
  `SpawnPlugin` or the host. The SDK only calls `resetAllCooldowns()` during surge aftermath.
