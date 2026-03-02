# combat

Probabilistic offline combat resolution — faction-pair exchanges for NPCs
that are away from the player and not handled by the live physics engine.

```ts
import { OfflineCombatResolver } from '@alife-sdk/simulation/combat';
```

---

## What's in this module

| Export | Kind | What it does |
|--------|------|-------------|
| `OfflineCombatResolver` | class | Resolves round-robin offline combat per terrain per tick |

---

## OfflineCombatResolver

Processes offline NPC vs NPC combat: for each terrain that holds NPCs from
two mutually hostile factions, one representative exchange is resolved per
faction pair per tick. No game-engine types are touched — everything goes
through `ISimulationBridge` and `IRandom`.

### Construction

```ts
import { OfflineCombatResolver } from '@alife-sdk/simulation/combat';

const resolver = new OfflineCombatResolver(
  config.offlineCombat, // IOfflineCombatConfig
  bridge,              // ISimulationBridge
  random,              // IRandom
);
```

### Running a combat pass

```ts
// In your A-Life tick loop:
const nextCursor = resolver.resolve(
  npcRecords,       // ReadonlyMap<string, INPCRecord>
  terrains,         // ReadonlyMap<string, SmartTerrain>
  factions,         // ReadonlyMap<string, Faction>
  brains,           // ReadonlyMap<string, NPCBrain>
  storyRegistry,    // StoryRegistry
  relationRegistry, // NPCRelationRegistry
  combatCursor,     // current round-robin terrain cursor

  // Optional: called for each NPC that dies (game-specific cleanup)
  (deadId, killerId) => {
    npcs.delete(deadId);
    scene.destroyNPCEntity(deadId);
  },
);

combatCursor = nextCursor; // persist across ticks
```

The cursor implements a **round-robin** over all terrains so each terrain
gets an equal share of the per-tick budget even when there are hundreds of
terrains.

---

## Resolution pipeline (per faction pair)

For each terrain with 2+ occupied factions, each hostile pair goes through
5 steps:

```
A: Detection gate
   random() × 100 ≥ detectionProbability  →  skip (no encounter this tick)

B: Pick representatives
   One surviving NPC from each faction bucket.

C: Victory probability
   powerA = combatPower × rankMultiplier
   vpA = clamp(powerA / powerB × victoryBase, victoryProbMin, victoryProbMax)
   × size advantage (capped at maxSizeAdvantage)

D: Retreat check
   vpA < record.retreatThreshold  →  brain.forceReevaluate() for all in faction A
   Both sides retreat  →  no damage exchange this tick

E: Damage exchange
   rawDamage = combatPower × rankMultiplier × jitter(powerJitterMin..powerJitterMax)
   effectiveDamage = bridge.getEffectiveDamage(targetId, rawDamage, damageTypeId)
   Simultaneous hit: both sides take damage
   bridge.adjustMorale(id, moraleHitPenalty, 'hit')
   brain.setCombatLock(combatLockMs)

Death handling (if currentHp ≤ 0):
   bridge.adjustMorale(killerId, moraleKillBonus, 'kill')
   bridge.adjustMorale(allyId, moraleAllyDeathPenalty, 'ally_died')  for each ally
   brain.onDeath()
   terrain.removeOccupant(deadId)
   relationRegistry.onNPCKilled(...)
   onNPCDeath?(deadId, killerId)                                      your callback
```

**Story NPCs** (registered in `StoryRegistry`) are never killed by offline
combat — the exchange is skipped at Step E.

---

## IOfflineCombatConfig

All tunable knobs in one flat config object:

| Field | Description | Typical value |
|-------|-------------|--------------|
| `maxResolutionsPerTick` | Budget cap — max faction-pair exchanges per tick | `10` |
| `detectionProbability` | Encounter chance [0–100] per faction pair per tick | `70` |
| `victoryBase` | Base victory-probability factor at equal power | `0.5` |
| `victoryProbMin` | Lower clamp on win probability | `0.05` |
| `victoryProbMax` | Upper clamp on win probability | `0.95` |
| `maxSizeAdvantage` | Max squad-size multiplier on win probability | `2.0` |
| `powerJitterMin` | Min random multiplier on raw damage | `0.8` |
| `powerJitterMax` | Max random multiplier on raw damage | `1.2` |
| `combatLockMs` | Duration of brain combat lock after an exchange | `5000` |
| `moraleHitPenalty` | Morale delta on taking damage | `-0.15` |
| `moraleKillBonus` | Morale delta on scoring a kill | `+0.2` |
| `moraleAllyDeathPenalty` | Morale delta to allies on ally death | `-0.25` |
| `damageTypeId?` | Damage category passed to the bridge | `'physical'` |

Set in `ISimulationConfig.offlineCombat` and passed via `createDefaultSimulationConfig()`.

---

## Story NPC protection

NPCs registered in `StoryRegistry` skip the damage-exchange step entirely:

```ts
// Register during quest setup
storyRegistry.register('quest_baron_npc', npcId);

// The resolver checks automatically — no extra config needed
const isProtected = storyRegistry.isStoryNPC(npcId); // true → no death
```

Quest NPCs still participate in morale bookkeeping and can trigger retreat,
but they cannot be killed by offline combat.

---

## Performance

| Detail | Note |
|--------|------|
| Allocations | Zero per-tick — all scratch arrays and Maps are pre-allocated and reused |
| Per-tick cost | O(T × F²) where T = terrains processed, F = distinct factions in terrain |
| Budget control | `maxResolutionsPerTick` caps F² inner iterations across all terrains |
| Round-robin | Ensures no terrain is permanently starved even at low budget settings |
