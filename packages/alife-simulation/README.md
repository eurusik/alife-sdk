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

### Brain hierarchy

```
NPCBrain           — 11-step update, terrain selection, morale, movement dispatch
  HumanBrain       — equipment scoring bonuses, money management
  MonsterBrain     — lair affinity +1000, danger preference, no schedule/surge flee
```

Override `selectBestTerrain()`, `buildJobContext()`, or `buildTerrainQuery()`
to customise selection logic without modifying the brain update loop.

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

// After restore, re-register all NPCs to rebuild brain instances
for (const record of sim.getAllNPCRecords().values()) {
  sim.registerNPC({ entityId: record.entityId, ... });
}
```

Brains cannot be serialised (they hold terrain references and a movement
dispatcher). The restore contract requires the caller to re-register all NPCs.

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

## See also

- [`@alife-sdk/ai`](../alife-ai/README.md) — online frame-based AI for NPCs that come within player range
- [`@alife-sdk/phaser`](../alife-phaser/README.md) — Phaser 3 adapter that wires online/offline transitions automatically
- [`@alife-sdk/persistence`](../alife-persistence/README.md) — save and restore simulation state between sessions
