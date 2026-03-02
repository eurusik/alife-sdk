# config

Central configuration for the A-Life simulation. All tunable constants live
in one `IALifeConfig` object, grouped by domain.

```ts
import { createDefaultConfig } from '@alife-sdk/core/config';
import type { IALifeConfig } from '@alife-sdk/core/config';
```

---

## Quick start

```ts
import { createDefaultConfig } from '@alife-sdk/core/config';

// Get production defaults (tuned for Chornobyl: The Lost Zone)
const config = createDefaultConfig();

// Pass the relevant slice to each system
const kernel = new ALifeKernel({ config });
const memory = new MemoryBank({ timeFn, decayRate: config.memory.visualDecayRate });
const morale = new MoraleTracker({
  shakenThreshold: config.morale.shakenThreshold,
  panicThreshold:  config.morale.panicThreshold,
});
```

### Overriding individual fields

`createDefaultConfig()` returns a plain object — override any field by spreading:

```ts
const config: IALifeConfig = {
  ...createDefaultConfig(),
  tick: {
    ...createDefaultConfig().tick,
    intervalMs: 3_000, // faster ticks for testing
  },
  simulation: {
    ...createDefaultConfig().simulation,
    onlineRadius: 400,
    offlineRadius: 600,
  },
};
```

---

## How config flows through the SDK

`IALifeConfig` is the single source of truth. Each sub-interface feeds a
specific system — you never hardcode constants inside your game code.

```
createDefaultConfig()
        │
        ├─ config.tick       → ALifeKernel tick scheduler + budget warnings
        ├─ config.simulation → OnlineOfflineManager (hysteresis radii) + SpatialGrid
        ├─ config.time       → TimeManager (time factor, day/night hours)
        ├─ config.combat     → CombatState (melee cooldown, target inertia)
        ├─ config.morale     → MoraleTracker (thresholds, recovery, event deltas)
        ├─ config.spawn      → SpawnRegistry (default cooldown)
        ├─ config.memory     → MemoryBank (decay rates per channel, max entries)
        ├─ config.surge      → SurgeManager (phase durations, PSI damage)
        ├─ config.monster    → Monster AI states (windup times, special constants)
        └─ config.trade      → TradeManager (interaction radius, discount, restock)
```

---

## Full reference

### `config.tick` — simulation loop budget

Controls how often the A-Life world ticks and how much work it does per tick.

| Field | Default | Description |
|-------|---------|-------------|
| `intervalMs` | `5 000` ms | Gap between A-Life ticks. Lower = more responsive world, higher CPU cost. |
| `maxBrainUpdatesPerTick` | `20` | Max offline NPC brains updated per tick (round-robin). Prevents tick spikes with hundreds of NPCs. |
| `maxCombatResolutionsPerTick` | `10` | Max offline faction-vs-faction combat resolutions per tick. |
| `budgetWarningMs` | `50` ms | If a tick takes longer than this, a warning is logged. Tune to your target frame time. |
| `redundancyCleanupInterval` | `3` ticks | Run dead-NPC cleanup every N ticks (not every tick). |
| `redundancyCleanupDelayMs` | `30 000` ms | Game-time delay after death before an offline NPC is purged. |

---

### `config.simulation` — online/offline spatial system

Controls the hysteresis zone that switches NPCs between detailed (online) and
lightweight (offline) simulation.

| Field | Default | Description |
|-------|---------|-------------|
| `onlineRadius` | `600` px | NPCs closer than this become **online** (full AI, visible). |
| `offlineRadius` | `800` px | NPCs farther than this become **offline** (brain-only simulation). |
| `spatialGridCellSize` | `200` px | Cell size for the internal spatial hash. Smaller = faster radius queries, more memory. |

> **Hysteresis rule:** `offlineRadius` must be greater than `onlineRadius`.
> This prevents NPCs on the boundary from flickering between states every tick.

---

### `config.time` — game clock

| Field | Default | Description |
|-------|---------|-------------|
| `timeFactor` | `10` | 1 real second = 10 in-game seconds. At `timeFactor: 10`, a full 24-hour day passes in 144 real minutes. |
| `startHour` | `8` | In-game hour when a new session begins (0–23). |
| `dayStartHour` | `6` | First hour considered daytime. Affects NPC schedules. |
| `dayEndHour` | `21` | Last hour considered daytime (exclusive). After this, night schedules apply. |

---

### `config.combat` — combat timing

| Field | Default | Description |
|-------|---------|-------------|
| `meleeCooldownMs` | `1 000` ms | Minimum delay between consecutive melee hits from the same NPC. |
| `enemyInertiaMs` | `3 000` ms | How long an NPC keeps targeting its current enemy before it can switch. Prevents frantic target-swapping in group fights. |

---

### `config.morale` — morale events and recovery

All morale values use the `[-1, 1]` range. See [MoraleStateMachine.md](../combat/MoraleStateMachine.md).

| Field | Default | Description |
|-------|---------|-------------|
| `hitPenalty` | `-0.15` | Morale hit when the NPC takes damage. |
| `allyDiedPenalty` | `-0.25` | Morale hit when a squad member dies. |
| `leaderDiedPenalty` | `-0.40` | Morale hit when the squad leader dies. Replaces `allyDiedPenalty`. |
| `enemyKilledBonus` | `+0.20` | Morale boost when the NPC kills an enemy. |
| `surgePenalty` | `-0.30` | Morale hit applied during an active surge. |
| `shakenThreshold` | `-0.30` | Below this value → SHAKEN state. |
| `panicThreshold` | `-0.70` | At or below this value → PANICKED state. |
| `stableRecoveryRate` | `0.005` /s | Passive recovery per second in STABLE state (toward 0). |
| `shakenRecoveryRate` | `0.010` /s | Passive recovery per second in SHAKEN state (toward 0). |

---

### `config.spawn` — spawn points

| Field | Default | Description |
|-------|---------|-------------|
| `defaultCooldownMs` | `30 000` ms | After spawning, a point cannot spawn again for this long. Overridable per-point. |

---

### `config.memory` — NPC memory decay

Controls how fast memories fade per channel. Rates are in confidence units **per millisecond**.
See [MemorySystem.md](../ai/MemorySystem.md).

| Field | Default | What decays |
|-------|---------|-------------|
| `visualDecayRate` | `0.001` /ms | Sightings — full decay in ~1 000 ms at confidence 1.0 |
| `soundDecayRate` | `0.003` /ms | Gunshots, footsteps — fade 3× faster than visual |
| `hitDecayRate` | `0.0005` /ms | Remembered attacker position — fades slowly (~2 000 ms) |
| `dangerDecayRate` | `0.002` /ms | Danger zone memories — decay in ~500 ms |
| `maxEntriesPerChannel` | `20` | Max records per channel per NPC. Oldest entries are evicted first. |
| `confidenceThreshold` | `0.1` | Records below this confidence are pruned on next `update()`. |

> **Note:** The `MemoryBank` constructor takes `decayRate` in confidence **per second**.
> Convert: `decayRatePerSec = config.memory.visualDecayRate * 1000`.

---

### `config.surge` — surge event phases

A surge cycles through four phases: `INACTIVE → WARNING → ACTIVE → AFTERMATH`.

| Field | Default | Description |
|-------|---------|-------------|
| `warningDurationMs` | `30 000` ms | How long the warning siren plays before PSI damage begins. |
| `activeDurationMs` | `60 000` ms | Duration of the PSI damage phase. |
| `aftermathDurationMs` | `15 000` ms | Cooldown after the surge ends before the next can start. |
| `psiDamagePerSecond` | `5` HP/s | PSI damage per second to NPCs caught outdoors during the active phase. |

---

### `config.monster` — monster ability timing

Special ability constants for the five monster types.

| Field | Default | Used by |
|-------|---------|---------|
| `chargeWindupMs` | `600` ms | Boar — wind-up animation before charge releases. |
| `chargeDamageMult` | `2×` | Boar — charge damage multiplier on impact. |
| `stalkApproachDist` | `80` px | Bloodsucker — distance at which stealth breaks and attack begins. |
| `stalkAlphaInvisible` | `0.08` | Bloodsucker — sprite alpha while fully invisible. |
| `leapWindupMs` | `400` ms | Snork — wind-up before leap launches. |
| `leapAirtimeMs` | `350` ms | Snork — time the snork is airborne. |
| `psiChannelMs` | `2 000` ms | Controller — channel duration before PSI damage is applied. |

---

### `config.trade` — trading system

| Field | Default | Description |
|-------|---------|-------------|
| `interactionRadius` | `150` px | Player must be within this distance to open a trade dialog. |
| `allyDiscount` | `0.8` | Price multiplier for allied faction traders (0.8 = 20% discount). |
| `restockIntervalMs` | `300 000` ms | How often trader inventories refresh (default: 5 minutes). |

---

## Tips

**Never import constants directly from game source.**
Always thread config through your systems as a constructor/init parameter.
This makes testing trivial — pass a modified config and every system
respects it without touching any constants file.

```ts
// Good — testable, configurable
const config = { ...createDefaultConfig(), tick: { ...createDefaultConfig().tick, intervalMs: 100 } };
const kernel = new ALifeKernel({ config });

// Bad — hardcoded, breaks in tests
const kernel = new ALifeKernel(); // internally uses constant 5000
```

**`createDefaultConfig()` returns a new object each call.**
The returned object is a plain, non-frozen literal — you can spread and
override it safely. No singleton, no shared mutable state.

**Validate invariants after overriding.**
Some fields have implicit contracts the SDK relies on:

| Invariant | Why |
|-----------|-----|
| `offlineRadius > onlineRadius` | Hysteresis prevents online/offline flickering |
| `panicThreshold < shakenThreshold` | State machine assumes this ordering |
| `dayStartHour < dayEndHour` | TimeManager day/night schedule |
