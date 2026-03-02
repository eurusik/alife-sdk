# types

Shared value objects and configuration interfaces for the entire simulation
system.

```ts
import { createDefaultSimulationConfig, getRankMultiplier } from '@alife-sdk/simulation/types';
import type { INPCRecord, ISimulationConfig } from '@alife-sdk/simulation/types';
```

---

## What's in this module

| Export | Kind | Used by |
|--------|------|---------|
| `INPCRecord` | interface | `NPCBrain`, `OfflineCombat`, `SimulationPlugin` |
| `INPCBehaviorConfig` | interface | `INPCRecord.config` |
| `INPCJobContext` | interface | `JobSlotSystem` scoring callbacks |
| `RANK_MULTIPLIERS` | const | `getRankMultiplier`, offline combat |
| `getRankMultiplier` | function | Combat power scaling |
| `isNPCRecordAlive` | function | Brain update guards |
| `ISimulationConfig` | interface | `SimulationPlugin`, all subsystems |
| `IBrainConfig` | interface | `ISimulationConfig.brain` |
| `ITerrainStateConfig` | interface | `ISimulationConfig.terrainState` |
| `ITerrainSelectorConfig` | interface | `ISimulationConfig.terrainSelector` |
| `IJobScoringConfig` | interface | `ISimulationConfig.jobScoring` |
| `IOfflineCombatConfig` | interface | `ISimulationConfig.offlineCombat` |
| `ISurgeConfig` | interface | `ISimulationConfig.surge` |
| `IGoodwillConfig` | interface | `ISimulationConfig.goodwill` |
| `createDefaultSimulationConfig` | function | Setup / testing |

---

## Configuration

### `createDefaultSimulationConfig(overrides?)`

Creates a complete `ISimulationConfig` with production defaults. Override any
section selectively:

```ts
import { createDefaultSimulationConfig } from '@alife-sdk/simulation/types';

// All defaults
const config = createDefaultSimulationConfig();

// Override specific sections
const config = createDefaultSimulationConfig({
  brain: {
    moraleFleeThreshold: -0.7,   // NPCs hold longer before fleeing
    dangerTolerance: 5,
  },
  offlineCombat: {
    detectionProbability: 50,    // less frequent offline fights
    maxResolutionsPerTick: 5,
  },
});
```

---

## NPC types

### `INPCRecord`

The authoritative offline record for one NPC. The simulation owns these;
the rendering layer reads them via ports.

```ts
interface INPCRecord {
  readonly entityId:  string;             // matches engine entity id
  readonly factionId: string;
  combatPower:        number;             // mutable — scales with rank
  currentHp:          number;             // mutable — changed by combat
  rank:               number;             // 1–5
  readonly config:    INPCBehaviorConfig; // loaded from data, immutable
  lastPosition:       Vec2;              // mutable — updated each brain tick
  isOnline:           boolean;           // mutable — toggled by OnlineOffline
}
```

### `INPCBehaviorConfig`

Per-NPC tunable parameters, loaded from your data files:

```ts
interface INPCBehaviorConfig {
  retreatThreshold: number;   // HP fraction [0-1] → triggers retreat
  panicThreshold:   number;   // morale [-1, 0] → triggers panic
  searchIntervalMs: number;   // ms between search scans
  dangerTolerance:  number;   // max danger level before fleeing
  aggression:       number;   // [0-1] — higher = more offensive
}
```

### `INPCJobContext`

Lightweight snapshot passed to job scoring callbacks — avoids exposing the
full `INPCRecord`:

```ts
interface INPCJobContext {
  npcId:     string;
  factionId: string;
  rank:      number;
  position:  Vec2;
  weaponType?:      string;
  equipmentPrefs?: {
    aggressiveness: number;
    cautiousness:   number;
  };
}
```

### Rank system

Ranks 1–5 map to combat power multipliers:

```ts
const RANK_MULTIPLIERS = [0.8, 0.9, 1.0, 1.2, 1.5]; // index = rank - 1

getRankMultiplier(1); // → 0.8  (rookie)
getRankMultiplier(3); // → 1.0  (veteran)
getRankMultiplier(5); // → 1.5  (elite)
```

`getRankMultiplier` clamps rank to `[1, 5]` — safe to call with any value.

### `isNPCRecordAlive`

Check NPC liveness via the `IEntityQuery` port (avoids coupling to the engine):

```ts
import { isNPCRecordAlive } from '@alife-sdk/simulation/types';

if (!isNPCRecordAlive(npcRecord, entityQuery)) {
  // skip brain update
}
```

---

## Simulation config reference

### `IBrainConfig` — defaults

| Field | Default | Description |
|-------|---------|-------------|
| `searchIntervalMs` | `5 000` | Ms between search-state scans |
| `schemeCheckIntervalMs` | `3 000` | Ms between condlist re-evaluation |
| `moraleFleeThreshold` | `-0.5` | Morale at which NPC flees |
| `reEvaluateIntervalMs` | `30 000` | Ms between terrain re-selection |
| `dangerTolerance` | `3` | Max danger level tolerated |

### `ITerrainStateConfig` — defaults

| Field | Default | Description |
|-------|---------|-------------|
| `combatDecayMs` | `30 000` | COMBAT → ALERT decay time |
| `alertDecayMs` | `15 000` | ALERT → PEACEFUL decay time |

### `ITerrainSelectorConfig` — defaults

| Field | Default | Description |
|-------|---------|-------------|
| `surgeMultiplier` | `3.0` | Shelter fitness bonus during surge |
| `squadLeaderBonus` | `20` | Bonus for matching squad leader's terrain |
| `moraleDangerPenalty` | `15` | Danger penalty per level when morale < 0 |

### `IJobScoringConfig` — defaults

| Field | Default | Description |
|-------|---------|-------------|
| `rankBonus` | `5` | Score bonus when rank meets job minimum |
| `distancePenalty` | `0.01` | Score penalty per pixel of distance |

### `IOfflineCombatConfig` — defaults

| Field | Default | Description |
|-------|---------|-------------|
| `maxResolutionsPerTick` | `10` | Max combat exchanges per tick |
| `detectionProbability` | `70` | % chance factions detect each other |
| `victoryBase` | `0.5` | Base win probability at equal power |
| `powerJitterMin/Max` | `0.5 / 1.5` | Random damage multiplier range |
| `combatLockMs` | `15 000` | Cool-down after exchange |
| `moraleHitPenalty` | `-0.15` | Morale loss per hit |
| `moraleKillBonus` | `0.1` | Morale gain per kill |
| `moraleAllyDeathPenalty` | `-0.15` | Morale loss when ally dies |
| `victoryProbMin/Max` | `0.05 / 0.95` | Win probability clamps |
| `maxSizeAdvantage` | `2.0` | Max squad-size multiplier |

### `ISurgeConfig` — defaults

| Field | Default | Description |
|-------|---------|-------------|
| `intervalMinMs` | `180 000` | Min time between surges (3 min) |
| `intervalMaxMs` | `360 000` | Max time between surges (6 min) |
| `warningDurationMs` | `30 000` | Warning phase length |
| `activeDurationMs` | `30 000` | Active phase length |
| `aftermathDurationMs` | `10 000` | Aftermath phase length |
| `damagePerTick` | `25` | PSI damage per tick |
| `damageTickIntervalMs` | `1 000` | Tick interval during active phase |
| `moralePenalty` | `-0.3` | Morale loss per damage tick |
| `moraleRestore` | `0.15` | Morale gain per survivor at aftermath |
| `damageTypeId` | `'psi'` | Damage type (open — override freely) |

### `IGoodwillConfig` — defaults

| Field | Default | Description |
|-------|---------|-------------|
| `killPenalty` | `-20` | Relation loss to victim's faction on kill |
| `killEnemyBonus` | `5` | Relation gain to factions hostile to victim |
| `tradeBonus` | `3` | Relation gain per completed trade |
| `questBonus` | `15` | Relation gain per completed quest |
| `decayRatePerHour` | `0.5` | Goodwill decay toward 0 per in-game hour |
