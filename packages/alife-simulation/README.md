# @alife-sdk/simulation

Offline tick-based A-Life world simulation — NPC brains, terrain management,
squad grouping, probabilistic combat, and zone-wide surge events.
Framework-free: all engine operations go through injected ports.

```
npm install @alife-sdk/simulation
```

---

## Quick start

### `createInMemoryKernel` — no adapters needed

> **Note:** `createInMemoryKernel` uses no-op adapters — entities always stay
> alive (`isAlive` returns `true`), damage is ignored (`applyDamage` returns
> `false`, effective damage is `0`). Suitable for testing and CLI tools.
> For production use, wire a real `ISimulationBridge` (see Full wiring below).

```ts
import { createInMemoryKernel } from '@alife-sdk/simulation';
import { FactionBuilder, SmartTerrain } from '@alife-sdk/core';

// Kernel is already init()'d and start()'d — no port wiring required.
const { kernel, sim, factions } = createInMemoryKernel({ tickIntervalMs: 5_000 });

factions.factions.register('stalker', new FactionBuilder('stalker').build());
sim.addTerrain(new SmartTerrain({ id: 'camp', name: 'Camp',
  bounds: { x: 0, y: 0, width: 200, height: 200 }, capacity: 6, jobs: [] }));
sim.registerNPC({ entityId: 'wolf', factionId: 'stalker',
  position: { x: 50, y: 50 }, rank: 2, combatPower: 50, currentHp: 100,
  options: { type: 'human' } });

kernel.events.on('alife:tick', ({ tick }) => console.log('tick', tick));
kernel.update(5_001); // advance one tick
kernel.destroy();
```

### Full wiring (production / real engine)

```ts
import { ALifeKernel, FactionsPlugin } from '@alife-sdk/core';
import { SimulationPlugin, createDefaultPluginConfig } from '@alife-sdk/simulation/plugin';
import { SimulationPorts } from '@alife-sdk/simulation/ports';

// 1. Build the kernel
const kernel = new ALifeKernel();

// 2. Register your engine bridge (required port)
kernel.provide(SimulationPorts.SimulationBridge, {
  isAlive:            (id) => entities.get(id)?.health > 0,
  applyDamage:        (id, dmg, type) => entities.get(id)?.takeDamage(dmg, type) ?? false,
  getEffectiveDamage: (id, dmg, type) => dmg * (immunities.get(id)?.[type] ?? 1),
  adjustMorale:       (id, delta) => { entities.get(id)?.morale.adjust(delta); },
});

// 3. Register required plugins
kernel.use(new FactionsPlugin({ factions: myFactionDefs }));
kernel.use(new SimulationPlugin({
  tickIntervalMs: 5_000,
  simulation: {
    brain: { moraleFleeThreshold: -0.6 },
  },
}));

// 4. Add terrains before or after init
const sim = kernel.getPlugin<SimulationPlugin>('simulation');
sim.addTerrain(mySmartTerrain);

// 5. Initialize
kernel.init();

// 6. Register NPCs
sim.registerNPC({
  entityId:       'npc_soldier_1',
  factionId:      'military',
  combatPower:    60,
  currentHp:      100,
  rank:           3,
  position:       { x: 400, y: 300 },
  behaviorConfig: { retreatThreshold: 0.2, panicThreshold: -0.7 },
  options:        { type: 'human' },
});

// 7. Drive the simulation — call every frame
function gameLoop(deltaMs: number) {
  sim.setNPCOnline('npc_soldier_1', playerIsNear);
  kernel.update(deltaMs);
}
```

---

## Sub-paths

| Import path | What it contains |
|-------------|-----------------|
| `@alife-sdk/simulation/plugin` | `SimulationPlugin` — kernel entry point, owns all state |
| `@alife-sdk/simulation/types` | `INPCRecord`, `ISimulationConfig` and 7 sub-configs |
| `@alife-sdk/simulation/ports` | `ISimulationBridge`, `SimulationPorts` token |
| `@alife-sdk/simulation/brain` | `NPCBrain`, `HumanBrain`, `MonsterBrain`, `BrainScheduleManager` |
| `@alife-sdk/simulation/terrain` | `TerrainStateManager`, `TerrainSelector`, `JobSlotSystem`, `resolveScheme` |
| `@alife-sdk/simulation/npc` | `NPCRegistrar`, `StoryRegistry`, `Schedule`, `NPCRelationRegistry` |
| `@alife-sdk/simulation/movement` | `MovementSimulator`, `GraphMovementSimulator` |
| `@alife-sdk/simulation/combat` | `OfflineCombatResolver` |
| `@alife-sdk/simulation/squad` | `Squad`, `SquadManager` |
| `@alife-sdk/simulation/surge` | `SurgeManager`, `SurgePhase` |

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│                      SimulationPlugin                      │
│  (IALifePlugin — registered in ALifeKernel)                │
│                                                            │
│  7-step tick pipeline (every tickIntervalMs)               │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐  │
│  │ Terrain  │ Brains   │ Movement │ Combat   │ Morale   │  │
│  │ states   │ round-   │simulator │ resolver │ restore  │  │
│  │ decay    │ robin    │ update   │(offline) │ + decay  │  │
│  │          │          │          │SKIPPED   │          │  │
│  │          │          │          │during    │          │  │
│  │          │          │          │ACTIVE    │          │  │
│  │          │          │          │surge     │          │  │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘  │
│                                                            │
│  Every frame (smooth):                                     │
│  ┌──────────────────────────┬───────────────────────────┐  │
│  │  SurgeManager.update()   │  Morale panic eval        │  │
│  └──────────────────────────┴───────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
          │ ports                        │ events
          ▼                              ▼
┌────────────────────────┐  ┌────────────────────────┐
│  ISimulationBridge     │  │  EventBus<ALifeEvents>  │
│    (host owns)         │  │    TICK, NPC_MOVED      │
│    isAlive             │  │    FACTION_CONFLICT     │
│    applyDamage         │  │    NPC_PANICKED         │
│    adjustMorale        │  │    SURGE_*              │
│    getEffectiveDamage  │  │    SQUAD_*              │
└────────────────────────┘  │    TERRAIN_STATE_*      │
                            └────────────────────────┘
```

---

## Key concepts

### Online / offline split

The SDK ticks **only offline NPCs** (`isOnline === false`). When a player
approaches an NPC, the host switches it online and takes over with its own
physics and combat system. The SDK never reads camera or viewport data.

```ts
sim.setNPCOnline(npcId, true);   // host engine drives this NPC now
sim.setNPCOnline(npcId, false);  // SDK tick pipeline resumes
```

**Concrete sync workflow:**

```ts
// NPC enters render range — sync offline brain state to live entity, then
// hand control to the host engine.
const brain = sim.getNPCBrain(npcId);
if (brain) {
  myEntity.morale = brain.morale; // read authoritative morale from the brain
}
sim.setNPCOnline(npcId, true);    // SDK stops ticking this NPC

// NPC leaves render range — sync live position back to the record, then
// return control to the SDK.
const record = sim.getNPCRecord(npcId);
if (record) {
  record.lastPosition = myEntity.position; // write current world position
}
sim.setNPCOnline(npcId, false);   // SDK tick pipeline resumes
```

### Brain hierarchy

```
NPCBrain           — 11-step update, terrain selection, morale, movement dispatch
  HumanBrain       — equipment scoring bonuses, money management
  MonsterBrain     — lair affinity +1000, danger preference, no schedule/surge flee
```

Override `selectBestTerrain()`, `buildJobContext()`, or `buildTerrainQuery()`
to customise selection logic without modifying the brain update loop.

See [brain/README.md](src/brain/README.md) for detailed brain extension examples.

### Terrain threat FSM

Each `SmartTerrain` gets a `TerrainStateManager` that escalates threat level
when hostile NPCs share the terrain:

```
PEACEFUL → ALERT → COMBAT  (escalate on detection)
COMBAT → ALERT → PEACEFUL  (decay after combatDecayMs / alertDecayMs)
```

Brains read the threat level to select behavior schemes (patrol → guard → combat_patrol).

### Surge lifecycle

```
INACTIVE → WARNING → ACTIVE → AFTERMATH → INACTIVE
```

During **ACTIVE**: every unsheltered NPC takes PSI damage every
`damageTickIntervalMs`. During **AFTERMATH**: all spawn cooldowns reset
(mass repopulation wave) and survivors get a morale bonus.

### Story NPC protection

NPCs registered in `StoryRegistry` are immune to offline combat death and
redundancy cleanup — quest NPCs always survive.

```ts
sim.getStoryRegistry().register('main_quest_act1', npcId);
```

---

## Serialisation

```ts
// Save — JSON-serialisable snapshot
const state = sim.serialize();

// Load
sim.restore(state);

// After restore, rebuild brain instances. Two options:

// Option 1: registerNPC() — full re-registration.
// Rebuilds the brain AND re-runs squad assignment, relation tracking, and
// story registry wiring. Use this when the NPC record may have changed
// (e.g. faction swap, rank change) or when you are loading a fresh scene.
for (const record of sim.getAllNPCRecords().values()) {
  sim.registerNPC({ entityId: record.entityId, factionId: record.factionId, ... });
}

// Option 2: rebuildBrain(npcId) — faster, brain-only rebuild.
// Recreates the brain instance from the existing NPC record without touching
// squads, relations, or the story registry. Preserves the restored state
// exactly as serialized. Preferred after a save/load round-trip.
for (const record of sim.getAllNPCRecords().values()) {
  sim.rebuildBrain(record.entityId);
}
```

Brains cannot be serialised (they hold terrain references and a movement
dispatcher). The restore contract requires the caller to rebuild brain instances
via one of the two options above.

---

## Testing

The package has **793 tests** (vitest). Run them:

```
pnpm --filter @alife-sdk/simulation test
```

All subsystems are pure — no kernel needed for unit tests. Brains can be
instantiated directly and bridges can be mocked:

```ts
import { HumanBrain } from '@alife-sdk/simulation/brain';

// Instantiate a brain directly — no kernel required
const brain = new HumanBrain({ /* config */ });

// Mock ISimulationBridge for unit tests
const mockBridge = {
  isAlive:            (id: string) => true,
  applyDamage:        (id: string, dmg: number, type: string) => true,
  getEffectiveDamage: (id: string, dmg: number, type: string) => dmg,
  adjustMorale:       (id: string, delta: number) => {},
};
```

---

## Events emitted

All events flow through `kernel.events` (an `EventBus<ALifeEventPayloads>`).
Subscribe with:

```ts
kernel.events.on('alife:tick', ({ tick, delta }) => { /* ... */ });
```

The table below lists every event the simulation package emits. Events from
other packages (AI perception, anomaly, social, monster) are not included.

| Event | String key | Payload | When |
|-------|-----------|---------|------|
| `TICK` | `'alife:tick'` | `{ tick: number; delta: number }` | End of every tick pipeline execution (every `tickIntervalMs`) |
| `NPC_MOVED` | `'alife:npc_moved'` | `{ npcId: string; fromZone: string; toZone: string }` | NPC moves between terrain zones (movement simulator) |
| `NPC_DIED` | `'alife:npc_died'` | `{ npcId: string; killedBy: string; zoneId: string }` | NPC HP reaches zero (offline combat or surge damage) |
| `NPC_RELEASED` | `'alife:npc_released'` | `{ npcId: string; terrainId: string }` | NPC leaves a terrain/job slot |
| `TASK_ASSIGNED` | `'alife:task_assigned'` | `{ npcId: string; terrainId: string; taskType: string }` | Brain assigns NPC to a terrain job |
| `FACTION_CONFLICT` | `'alife:faction_conflict'` | `{ factionA: string; factionB: string; zoneId: string }` | Two hostile factions share a terrain zone (once per tick per pair) |
| `NPC_PANICKED` | `'ai:npc_panicked'` | `{ npcId: string; squadId: string \| null }` | NPC morale drops below `panicThreshold` |
| `TERRAIN_STATE_CHANGED` | `'alife:terrain_state_changed'` | `{ terrainId: string; oldState: number; newState: number }` | Terrain FSM transitions (PEACEFUL↔ALERT↔COMBAT) |
| `SURGE_WARNING` | `'surge:warning'` | `{ timeUntilSurge: number }` | Surge enters WARNING phase |
| `SURGE_STARTED` | `'surge:started'` | `{ surgeNumber: number }` | Surge enters ACTIVE phase |
| `SURGE_ENDED` | `'surge:ended'` | `{ surgeNumber: number }` | Surge enters AFTERMATH phase |
| `SURGE_DAMAGE` | `'surge:damage'` | `{ npcId: string; damage: number }` | PSI damage tick applied to an unsheltered NPC |
| `SQUAD_FORMED` | `'squad:formed'` | `{ squadId: string; factionId: string; memberIds: string[] }` | New squad created from faction members |
| `SQUAD_DISBANDED` | `'squad:disbanded'` | `{ squadId: string }` | Squad dissolved (leader died or last member left) |
| `SQUAD_MEMBER_ADDED` | `'squad:member_added'` | `{ squadId: string; npcId: string }` | NPC joined an existing squad |
| `SQUAD_MEMBER_REMOVED` | `'squad:member_removed'` | `{ squadId: string; npcId: string }` | NPC left or was removed from a squad |
| `SQUAD_GOAL_SET` | `'squad:goal_set'` | `{ squadId: string; goalType: string; terrainId: string \| null; priority: number }` | Squad receives a new movement/combat goal |
| `SQUAD_GOAL_CLEARED` | `'squad:goal_cleared'` | `{ squadId: string; previousGoalType: string }` | Squad goal removed or completed |

---

## Porting to your engine

The simulation package is engine-agnostic. The only integration point is
`ISimulationBridge` — a four-method interface your engine implements once.

### Step 1 — Implement ISimulationBridge

```ts
import type { ISimulationBridge } from '@alife-sdk/simulation/ports';

class MyEngineBridge implements ISimulationBridge {
  isAlive(entityId: string): boolean {
    // Return false when the entity has been destroyed or HP ≤ 0
    return this.entityRegistry.get(entityId)?.health.isAlive ?? false;
  }

  applyDamage(entityId: string, amount: number, damageTypeId: string): boolean {
    const entity = this.entityRegistry.get(entityId);
    if (!entity) return false;
    const effective = this.immunitySystem.reduce(entity, amount, damageTypeId);
    entity.health.applyDamage(effective);
    return !entity.health.isAlive; // true = entity just died
  }

  getEffectiveDamage(entityId: string, rawDamage: number, damageTypeId: string): number {
    // Apply immunity/resistance multipliers WITHOUT mutating HP
    const entity = this.entityRegistry.get(entityId);
    return entity ? this.immunitySystem.reduce(entity, rawDamage, damageTypeId) : 0;
  }

  adjustMorale(entityId: string, delta: number, _reason: string): void {
    // Write the delta to your morale component — the brain is authoritative
    // while offline; sync back to brain.morale when the NPC goes online.
    this.entityRegistry.get(entityId)?.alife.adjustMorale(delta);
  }
}
```

The `damageTypeId` values used by the simulation are `'physical'` (offline
combat) and `'psi'` (surge damage) unless overridden in config.

### Step 2 — Register the bridge before kernel.init()

```ts
import { SimulationPorts } from '@alife-sdk/simulation/ports';

kernel.provide(
  SimulationPorts.SimulationBridge,
  new MyEngineBridge(entityRegistry, immunitySystem),
);
// kernel.init() validates all required ports — missing bridge throws immediately.
kernel.init();
```

### Step 3 — Sync brain state when an NPC goes online

When a player enters render range the SDK stops ticking that NPC. Read the
authoritative morale from the brain before handing off to the host engine:

```ts
const brain = sim.getNPCBrain(npcId);
if (brain) {
  myEntity.morale = brain.morale;
  myEntity.position = brain.lastPosition ?? myEntity.position;
}
sim.setNPCOnline(npcId, true); // SDK tick pipeline skips this NPC
```

When the NPC leaves render range, write the current position back before
returning control to the SDK:

```ts
const record = sim.getNPCRecord(npcId);
if (record) {
  record.lastPosition = myEntity.position;
}
sim.setNPCOnline(npcId, false); // SDK tick pipeline resumes
```

### Step 4 — Call kernel.update(deltaMs) in your game loop

The kernel's `update` call drives surge (every frame) and the tick pipeline
(gated by `tickIntervalMs`):

```ts
function gameLoop(deltaMs: number) {
  // Toggle online/offline before update so the current tick sees the right state
  sim.setNPCOnline('npc_soldier_1', playerIsNear('npc_soldier_1'));
  kernel.update(deltaMs);
}
```

### Step 5 — Handle events

React to simulation outcomes without polling:

```ts
// Spawn a death effect
kernel.events.on('alife:npc_died', ({ npcId, killedBy, zoneId }) => {
  vfx.playDeathEffect(npcId, worldMap.getZoneCenter(zoneId));
});

// Show surge HUD warning
kernel.events.on('surge:warning', ({ timeUntilSurge }) => {
  hud.showSurgeCountdown(timeUntilSurge);
});

// React to offline panic — maybe play a distant scream
kernel.events.on('ai:npc_panicked', ({ npcId }) => {
  audio.playDistantScream(npcId);
});
```

---

## Performance tuning

All knobs live in `ISimulationPluginConfig` (plugin-level) and
`ISimulationConfig` sub-sections (simulation-level). Pass overrides to
`SimulationPlugin` or `createInMemoryKernel`.

### Plugin-level knobs

| Knob | Default | Effect |
|------|---------|--------|
| `tickIntervalMs` | `5000` ms | How often the full tick pipeline runs. Increase to 10 000 ms for 200+ NPCs; decrease to 2 000 ms for a more reactive world. |
| `maxBrainUpdatesPerTick` | `20` | Round-robin budget: at most this many offline brains are updated per tick. Raise for faster NPC reactions; lower to spread CPU across more frames. |
| `moraleRestoreRate` | `0.02` | Morale delta per tick toward baseline. Higher values = NPCs recover from fear faster. |
| `moraleBaseline` | `0.5` | Morale target all NPCs drift toward over time. |
| `moraleEvalIntervalMs` | `2000` ms | How often panic threshold is evaluated (runs every frame, gated by this interval). |
| `redundancyCleanupInterval` | `3` ticks | Dead NPCs are unregistered every N ticks. Lower = faster memory recovery; higher = less per-tick overhead. |

### Simulation sub-config knobs

| Knob | Path | Default | Effect |
|------|------|---------|--------|
| `combatDecayMs` | `terrainState.combatDecayMs` | `30 000` ms | Time for terrain COMBAT → ALERT decay. |
| `alertDecayMs` | `terrainState.alertDecayMs` | `15 000` ms | Time for terrain ALERT → PEACEFUL decay. |
| `maxResolutionsPerTick` | `offlineCombat.maxResolutionsPerTick` | `10` | Max faction-pair combat exchanges per tick. Reduce for lower CPU cost with many hostile pairs. |
| `detectionProbability` | `offlineCombat.detectionProbability` | `70` (%) | Chance two co-located hostile factions detect each other per tick. Lower for sparser fights. |
| `combatLockMs` | `offlineCombat.combatLockMs` | `15 000` ms | Cooldown between exchanges for the same pair. Raise to throttle combat frequency. |
| `reEvaluateIntervalMs` | `brain.reEvaluateIntervalMs` | `30 000` ms | How often a brain reconsiders its terrain assignment. Raise to reduce terrain churn CPU. |

### Practical guidance by NPC count

| Scale | Recommended settings |
|-------|---------------------|
| **50 NPCs** | Defaults work well. `tickIntervalMs: 5_000`, `maxBrainUpdatesPerTick: 20`. All NPCs updated every tick. |
| **150 NPCs** | Raise `tickIntervalMs` to `8_000`. Keep `maxBrainUpdatesPerTick` at `20` — each brain gets a turn every ~2 ticks. |
| **300 NPCs** | `tickIntervalMs: 10_000`, `maxBrainUpdatesPerTick: 30`. Each brain updated roughly every ~2 ticks. Raise `reEvaluateIntervalMs` to `60_000` to reduce terrain selection churn. |
| **500 NPCs** | `tickIntervalMs: 15_000`, `maxBrainUpdatesPerTick: 40`, `maxResolutionsPerTick: 5`. Consider disabling graph movement (`levelGraph: undefined`) if not needed. |

```ts
// Example: tuning for ~300 offline NPCs
const kernel = new ALifeKernel();
kernel.use(new SimulationPlugin({
  tickIntervalMs:          10_000,
  maxBrainUpdatesPerTick:  30,
  moraleEvalIntervalMs:     3_000,
  redundancyCleanupInterval: 5,
  simulation: {
    brain:        { reEvaluateIntervalMs: 60_000 },
    offlineCombat: { maxResolutionsPerTick: 5 },
  },
}));
```

---

## See also

- [`@alife-sdk/ai`](../alife-ai/README.md) — online frame-based AI for NPCs that come within player range
- [`@alife-sdk/phaser`](../alife-phaser/README.md) — Phaser 3 adapter that wires online/offline transitions automatically
- [`@alife-sdk/persistence`](../alife-persistence/README.md) — save and restore simulation state between sessions
