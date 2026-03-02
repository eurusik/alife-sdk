# brain

Offline NPC decision-makers — terrain selection, job slots, daily schedules,
and day/night mode transitions.

```ts
import { NPCBrain, HumanBrain, MonsterBrain, BrainScheduleManager } from '@alife-sdk/simulation/brain';
```

---

## What's in this module

| Export | Kind | What it does |
|--------|------|-------------|
| `NPCBrain` | class | Base offline decision-maker — all NPC types |
| `HumanBrain` | class | Extends NPCBrain — equipment bonuses, money |
| `MonsterBrain` | class | Extends NPCBrain — lair affinity, danger preference |
| `BrainScheduleManager` | class | Day/night transitions + night waypoint scheduling |
| `createDefaultHumanBrainConfig` | function | Default config for HumanBrain |
| `createDefaultMonsterBrainConfig` | function | Default config for MonsterBrain |
| `IMovementDispatcher` | interface | Port — dispatches NPC movement |
| `IBrainDeps` | interface | External dependencies injected into every brain |
| `IBrainTask` | interface | Active job slot assignment |
| `INPCBrainParams` | interface | Constructor params for NPCBrain |
| `IHumanBrainParams` | interface | Constructor params for HumanBrain |
| `IMonsterBrainParams` | interface | Constructor params for MonsterBrain |
| `IHumanBrainConfig` | interface | Equipment bonus weights for HumanBrain |
| `IMonsterBrainConfig` | interface | Lair + danger scoring weights for MonsterBrain |

---

## Class hierarchy

```
NPCBrain
  ├── HumanBrain    — equipment-aware terrain scoring, money tracking
  └── MonsterBrain  — lair affinity, danger preference, no schedule/surge
```

All three use the same `update()` loop. Subclasses customise behaviour by
overriding two protected hooks: `selectBestTerrain()` and `buildJobContext()`.

---

## NPCBrain

The core offline decision-maker. Every NPC in the simulation has exactly one
brain — even monsters.

### Construction

```ts
import { NPCBrain } from '@alife-sdk/simulation/brain';

const brain = new NPCBrain({
  npcId:          'npc_sid',
  factionId:      'loner',
  config:         config.brain,          // IBrainConfig
  selectorConfig: config.terrainSelector,// ITerrainSelectorConfig
  jobConfig:      config.jobScoring,     // IJobScoringConfig
  deps: {
    clock:  gameTimeManager,  // Clock — isNight, currentTimeMs
    events: aLifeEventBus,    // EventBus<ALifeEventPayloads>
  },
});
```

### Main update loop

Call once per A-Life tick (typically every 5 000 ms of game time):

```ts
brain.update(deltaMs, allTerrains, terrainStateMap);
```

**Update order:**

```
1. Skip if dead
2. Tick combat lock (return early if still locked)
3. Check day/night transition (BrainScheduleManager)
4. If night + has schedule → delegate to night schedule, return
5. Evaluate scheme condition-list (every schemeCheckIntervalMs)
6. Count down re-evaluation timer → find better terrain
7. If surge + not in shelter → flee to shelter
8. If morale < threshold + terrain is dangerous → force re-evaluate
9. If no terrain assigned → select best, dispatch movement
10. If task active → countdown remainingMs
11. If task expired → pick next job slot from current terrain
```

### Reading brain state

```ts
brain.currentTask;        // IBrainTask | null — active job assignment
brain.currentTerrainId;   // string | null
brain.morale;             // number [-1, 1]
brain.rank;               // number 1-5
brain.lastPosition;       // Vec2
brain.isCombatLocked;     // boolean
brain.dangerTolerance;    // number — from config
```

### Setters

```ts
brain.setMorale(-0.4);
brain.setRank(3);
brain.setSurgeActive(true);
brain.setSquadLeaderTerrainId('military_base');
brain.setSquadGoalTerrainId('attack_point');    // overrides leader bonus
brain.setLastPosition({ x: 400, y: 300 });
brain.setAllowedTerrainTags(new Set(['outdoor', 'patrol']));
brain.setConditions(schemeConditionList);        // for scheme resolution
brain.setMovementDispatcher(movementSim);
```

### Combat lock

Pause the brain for the duration of an offline combat exchange:

```ts
brain.setCombatLock(config.offlineCombat.combatLockMs);
// Overlapping locks extend to the longest: safe to call multiple times
brain.isCombatLocked; // → true until expired
```

### Actions

```ts
brain.forceReevaluate();     // immediate terrain re-evaluation next tick
brain.releaseFromTerrain();  // detach from terrain + cancel task
brain.onDeath();             // mark dead, cancel movement, emit NPC_DIED
```

### `IBrainTask`

What the brain is currently doing:

```ts
interface IBrainTask {
  readonly terrainId:      string;   // terrain the NPC is assigned to
  readonly slotType:       string;   // job type: 'guard' | 'patrol' | 'camp' | …
  readonly targetPosition: Vec2;     // where to go for this job
  readonly scheme:         string;   // behavior scheme: 'idle' | 'combat_patrol' | …
  readonly params:         ISchemeParams | null;
  remainingMs:             number;   // mutable — counts down to 0
}
```

---

## HumanBrain

Extends `NPCBrain` with equipment-aware terrain scoring and money tracking.

```ts
import { HumanBrain, createDefaultHumanBrainConfig } from '@alife-sdk/simulation/brain';

const brain = new HumanBrain({
  npcId: 'npc_sniper', factionId: 'military',
  config: config.brain, selectorConfig: config.terrainSelector,
  jobConfig: config.jobScoring, deps,
  humanConfig: createDefaultHumanBrainConfig(),
  equipment: {
    preferredWeaponType: 'sniper',
    preferredArmor:      'heavy',
    aggressiveness:      0.3,
    cautiousness:        0.8,
  },
  initialMoney: 500,
});
```

### Equipment bonuses added to terrain score

| Condition | Bonus added | Default |
|-----------|------------|---------|
| `weaponType === 'sniper'` + terrain has `'guard'` tag | `guardTerrainBonus` | `+15` |
| `aggressiveness > threshold` + terrain has `'patrol'` tag | `patrolTerrainBonus` | `+10` |
| `cautiousness > threshold` + terrain has `'camp'` tag | `campTerrainBonus` | `+10` |
| `weaponType === 'shotgun'` + `terrain.dangerLevel <= threshold` | `shotgunLowDangerBonus` | `+10` |

All terrain tags and weapon types are configurable via `IHumanBrainConfig` —
no hardcoded strings in the brain.

### Equipment queries

```ts
const h = brain as HumanBrain;
h.getEquipment();       // → IEquipmentPreference
h.getPreferredWeapon(); // → WeaponType
h.isAggressive();       // → boolean
h.isCautious();         // → boolean
```

### Money management

Abstract currency — not tied to a real item system. Used for future
trade and loot calculations:

```ts
h.getMoney();         // → number
h.setMoney(1000);
h.addMoney(-150);     // deduct, clamped to 0
```

---

## MonsterBrain

Extends `NPCBrain` with lair-centric territory and danger-seeking behaviour.

```ts
import { MonsterBrain, createDefaultMonsterBrainConfig } from '@alife-sdk/simulation/brain';

const brain = new MonsterBrain({
  npcId: 'bloodsucker_1', factionId: 'monster',
  config: config.brain, selectorConfig: config.terrainSelector,
  jobConfig: config.jobScoring, deps,
  monsterConfig: createDefaultMonsterBrainConfig(),
  lairTerrainId: 'lair_lab_x18',
});
```

### Differences from NPCBrain / HumanBrain

| Feature | NPCBrain / HumanBrain | MonsterBrain |
|---------|----------------------|--------------|
| Night schedule | Yes | **No** — 24/7 active |
| Surge shelter | Flees to shelter | **Ignores surge** |
| Squad leader bonus | Applied | **Not applied** |
| Terrain danger | Penalty when morale < 0 | **Bonus** (danger = prey) |
| Lair terrain | — | **+1 000 bonus** |

### Terrain scoring formula

```
score = base score (TerrainSelector)
      + dangerLevel × dangerAffinity   (default: +2 per level)
      + lairTerrainBonus if terrain === lair  (default: +1 000)
```

The lair bonus is intentionally large — the monster always returns home
unless the lair is full or rejects the faction.

### Lair management

```ts
const m = brain as MonsterBrain;
m.getLairTerrainId();         // → string | null
m.setLairTerrainId('new_lair'); // change at runtime
m.setLairTerrainId(null);      // clear lair assignment
```

---

## BrainScheduleManager

Internal component owned by every `NPCBrain`. Handles two concerns:

1. **Day/night detection** — calls `clock.isNight` each tick, emits transition.
2. **Night schedule execution** — advances waypoints with linger timers.

You don't construct this directly — `NPCBrain` owns it internally.

### `IMovementDispatcher` — port you implement

The brain needs to dispatch movement without importing your engine:

```ts
interface IMovementDispatcher {
  addMovingNPC(npcId, fromTerrainId, toTerrainId, fromPos, toPos, speed?): void;
  isMoving(npcId: string): boolean;
  cancelJourney(npcId: string): void;
}
```

Pass your implementation via `brain.setMovementDispatcher(dispatcher)`.

---

## Protected extension hooks

Override these in subclasses (or your own `NPCBrain` subclass) to customise
decision-making without touching the update loop:

```ts
class MyBrain extends NPCBrain {
  // Customise terrain scoring
  protected override selectBestTerrain(terrains, terrainStates?) {
    return TerrainSelector.selectBest({
      ...this.buildTerrainQuery(terrains),
      scoreModifier: (terrain, score) => score + myBonus(terrain),
    });
  }

  // Inject extra data into job slot evaluation
  protected override buildJobContext(): INPCJobContext {
    return { ...super.buildJobContext(), weaponType: 'rifle' };
  }
}
```

---

## `IBrainDeps`

Two dependencies injected into every brain:

```ts
interface IBrainDeps {
  clock:  Clock;                         // isNight, currentTimeMs
  events: EventBus<ALifeEventPayloads>;  // NPC_DIED, TASK_ASSIGNED, NPC_RELEASED
}
```

One `IBrainDeps` object is typically shared across all brains in a simulation.
