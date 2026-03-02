# surge

Periodic catastrophic-event system — drives the zone-wide surge lifecycle,
PSI damage ticks for outdoor NPCs, and post-surge mass respawn.

```ts
import { SurgeManager, SurgePhase } from '@alife-sdk/simulation/surge';
import type { ISurgeNPCRecord, ISurgeManagerState } from '@alife-sdk/simulation/surge';
```

---

## What's in this module

| Export | Kind | What it does |
|--------|------|-------------|
| `SurgeManager` | class | Drives the full surge lifecycle FSM |
| `SurgePhase` | const object | Phase constants: `INACTIVE`, `WARNING`, `ACTIVE`, `AFTERMATH` |
| `ISurgeNPCRecord` | interface | Minimal NPC data needed by `SurgeManager.update()` |
| `ISurgeManagerParams` | interface | Constructor parameters |
| `ISurgeManagerState` | interface | Serialised state for save/restore |

---

## SurgePhase

String-valued phase enum — safe to persist and compare without numeric magic:

```ts
import { SurgePhase } from '@alife-sdk/simulation/surge';

SurgePhase.INACTIVE   // 'inactive'  — normal gameplay, no surge imminent
SurgePhase.WARNING    // 'warning'   — NPCs flee to shelter, impact imminent
SurgePhase.ACTIVE     // 'active'    — outdoor NPCs take PSI damage every tick
SurgePhase.AFTERMATH  // 'aftermath' — cooldown, mass respawn, morale recovery
```

---

## Lifecycle

```
          cooldown expires       warningDurationMs     activeDurationMs      aftermathDurationMs
INACTIVE ─────────────────→ WARNING ──────────────→ ACTIVE ─────────────→ AFTERMATH ─────────────→ INACTIVE
                                ↑ SURGE_WARNING          ↑ SURGE_STARTED         ↑ SURGE_ENDED
```

Each full cycle takes:
`intervalMin…intervalMax` (cooldown) + `warningDuration` + `activeDuration` + `aftermathDuration`.

The cooldown interval is randomised each cycle from `[intervalMinMs, intervalMaxMs]`.

---

## Setup

```ts
import { SurgeManager } from '@alife-sdk/simulation/surge';

const surgeManager = new SurgeManager({
  config:        config.surge,    // ISurgeConfig
  events:        eventBus,
  spawnRegistry: spawnRegistry,   // SpawnRegistry from @alife-sdk/core
  bridge:        bridge,          // ISimulationBridge
  random:        random,          // IRandom

  // Optional: called for each NPC that dies from surge PSI damage
  onSurgeDeath: (npcId) => {
    npcs.delete(npcId);
    scene.destroyNPCEntity(npcId);
  },
});

surgeManager.init(); // arm the first cooldown timer — call once before the tick loop
```

---

## Tick loop

`update()` must be called **every frame** (not gated behind an A-Life tick) so
phase transitions are smooth and damage ticks are millisecond-accurate:

```ts
// In your game loop / scene update
surgeManager.update(
  deltaMs,
  npcRecords,  // ReadonlyMap<string, ISurgeNPCRecord>
  terrains,    // readonly SmartTerrain[]
);
```

`ISurgeNPCRecord` is minimal — only two fields are needed:

```ts
interface ISurgeNPCRecord {
  readonly entityId: string;
  readonly currentTerrainId: string | null; // from NPCBrain.currentTerrainId
}
```

---

## Queries

```ts
surgeManager.getPhase();        // → SurgePhase
surgeManager.isActive();        // → true during ACTIVE (damage phase)
surgeManager.isSafe();          // → true during INACTIVE only
surgeManager.isSurgeIncoming(); // → true during WARNING or ACTIVE
surgeManager.getSurgeCount();   // → total surges completed this session
```

Typical uses:

| Query | Use case |
|-------|----------|
| `isSurgeIncoming()` | `NPCBrain` restricts terrain selection to shelters |
| `isActive()` | `ALifeSimulator` skips offline combat during the wave |
| `isSafe()` | UI "Zone is quiet" status |

---

## Damage ticks (ACTIVE phase)

Every `damageTickIntervalMs`, all NPCs without a shelter terrain receive:

1. `bridge.applyDamage(entityId, damagePerTick, damageTypeId)` — PSI damage
2. `bridge.adjustMorale(entityId, moralePenalty, 'surge')` — terror penalty
3. `SURGE_DAMAGE` event emitted

A terrain is a shelter when `SmartTerrain.isShelter === true`. The set of
shelter IDs is built once per surge wave (lazy, O(S) where S = shelter count)
and reused for all damage ticks within that wave.

If `applyDamage` returns `true` (NPC died), `onSurgeDeath?.(npcId)` is called
and the NPC is skipped for the morale step.

---

## Aftermath effects

Fired exactly once when entering AFTERMATH:

1. `spawnRegistry.resetAllCooldowns()` — all spawn points become available
   immediately, triggering a mass world-repopulation wave.
2. `bridge.adjustMorale(entityId, moraleRestore, 'surge_aftermath')` — relief
   bonus for every surviving NPC.

---

## Force a surge (testing / scripted events)

```ts
surgeManager.forceSurge(); // bypasses cooldown, jumps straight to WARNING
```

No-op if a surge is already in progress.

---

## ISurgeConfig

| Field | Description | Typical value |
|-------|-------------|--------------|
| `intervalMinMs` | Min cooldown between surges | `180_000` (3 min) |
| `intervalMaxMs` | Max cooldown between surges | `600_000` (10 min) |
| `warningDurationMs` | Duration of WARNING phase | `30_000` |
| `activeDurationMs` | Duration of ACTIVE (damage) phase | `60_000` |
| `aftermathDurationMs` | Duration of AFTERMATH phase | `30_000` |
| `damagePerTick` | PSI damage per outdoor NPC per tick | `20` |
| `damageTickIntervalMs` | Interval between damage ticks | `5_000` |
| `moralePenalty` | Morale delta per damage tick | `-0.3` |
| `moraleRestore` | Morale delta for survivors at aftermath | `+0.4` |
| `damageTypeId?` | Damage category; defaults to `'psi'` | `'psi'` |

---

## Serialisation

```ts
const state = surgeManager.serialize();

// On load — no need to call init() after restore()
surgeManager.restore(state);
```

The restored state includes the exact phase, all timers, the damage tick
accumulator, and the `aftermathApplied` flag so aftermath effects never fire
twice even if the save happened mid-aftermath.

---

## Events emitted

| Event | When | Payload |
|-------|------|---------|
| `SURGE_WARNING` | Entering WARNING | `{ timeUntilSurge: ms }` |
| `SURGE_STARTED` | Entering ACTIVE | `{ surgeNumber: n }` |
| `SURGE_ENDED` | Entering AFTERMATH | `{ surgeNumber: n }` |
| `SURGE_DAMAGE` | Each outdoor NPC hit | `{ npcId, damage }` |
