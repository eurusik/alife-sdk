# squad

Offline squad management — grouping NPCs into factions, shared morale
cascade, squad goals, and serialisation.

```ts
import { Squad, SquadManager, SquadGoalTypes, createDefaultSquadConfig } from '@alife-sdk/simulation/squad';
import type { ISquadConfig, ISquadGoal, MoraleLookup } from '@alife-sdk/simulation/squad';
```

---

## What's in this module

| Export | Kind | What it does |
|--------|------|-------------|
| `Squad` | class | Single faction group — membership, leadership, morale, goals |
| `SquadManager` | class | Owns all squads, reverse index, delegation, serialisation |
| `SquadGoalTypes` | const | Default goal type constants (`PATROL`, `ASSAULT`, `DEFEND`, `FLEE`) |
| `createDefaultSquadConfig` | function | Creates `ISquadConfig` with sensible defaults |
| `ISquadConfig` | interface | Tunable squad parameters |
| `ISquadGoal` | interface | Persistent squad-level objective |
| `ISquadGoalState` | interface | Serialised form of `ISquadGoal` |
| `ISquadManagerState` | interface | Full serialised state for save/restore |
| `SquadGoalType` | type | Open string union for goal types |
| `MoraleLookup` | type | Callback that resolves live morale adjuster for an NPC |

---

## SquadManager

The single entry point for all squad operations. Create one instance per
simulation and inject it wherever squad data is needed.

### Setup

```ts
import { SquadManager, createDefaultSquadConfig } from '@alife-sdk/simulation/squad';

const squadManager = new SquadManager(
  createDefaultSquadConfig(),
  eventBus,

  // Optional: return an object with adjustMorale() for cascade events.
  // Return null if the NPC has no live entity (offline NPCs are fine to skip).
  (npcId) => liveEntities.get(npcId) ?? null,
);
```

### Creating and disbanding squads

```ts
// Create a squad with initial members
const squad = squadManager.createSquad('military', ['npc_1', 'npc_2']);
// → emits SQUAD_FORMED

// Disband when all members are dead or reassigned
squadManager.disbandSquad(squad.id);
// → emits SQUAD_DISBANDED
```

### Auto-assignment

The simplest way to group NPCs on registration:

```ts
// Finds the first non-full same-faction squad, or creates one
const squad = squadManager.autoAssign('npc_3', 'military');
```

Auto-disband is automatic: `removeFromSquad` and `onNPCDeath` both check if
the resulting squad is empty and disband it with a `SQUAD_DISBANDED` event.

### Manual assignment

```ts
squadManager.assignToSquad('npc_4', squad.id); // → true if added, false if full/missing
squadManager.removeFromSquad('npc_4');
```

### Queries

```ts
const squad = squadManager.getSquadForNPC('npc_1');   // Squad | null
const squadId = squadManager.getSquadId('npc_1');     // string | null
const byFaction = squadManager.getSquadsByFaction('military'); // Squad[]
const all = squadManager.getAllSquads();               // Squad[]
```

---

## Squad goals

A squad goal is a persistent objective that member brains can read during
terrain selection (e.g. bias toward a specific terrain for an assault).

```ts
squad.setGoal({
  type: SquadGoalTypes.ASSAULT,
  terrainId: 'military_base',
  priority: 10,
  meta: { commanderId: 'npc_commander' },
});
// → emits SQUAD_GOAL_SET

squad.currentGoal; // → ISquadGoal (frozen) | null
squad.clearGoal();  // → emits SQUAD_GOAL_CLEARED
```

`SquadGoalType` is an open union — extend with your own goal types:

```ts
type SquadGoalType = 'patrol' | 'assault' | 'defend' | 'flee' | (string & {});

squad.setGoal({ type: 'escort', terrainId: 'safe_house' });
```

---

## Morale cascade

### On death (offline combat)

```ts
// Called by OfflineCombatResolver after NPC death
squadManager.onNPCDeath('npc_1');
// → removes from squad
// → applies moraleAllyDeathPenalty to surviving members
// → auto-disbands if squad becomes empty
```

### On kill

```ts
squadManager.onNPCKill('npc_2');
// → applies moraleKillBonus to all squad members
```

### Cascade (online events)

For live online events (morale shock from a state machine transition):

```ts
// Leader cascade × moraleCascadeLeaderFactor
// Regular member cascade × moraleCascadeFactor
squadManager.cascadeMorale(squadId, sourceNpcId, -0.3);
```

---

## ISquadConfig

| Field | Default | Description |
|-------|---------|-------------|
| `maxSize` | `4` | Maximum members per squad |
| `moraleAllyDeathPenalty` | `-0.15` | Morale delta to survivors on member death |
| `moraleKillBonus` | `+0.1` | Morale delta to all members on a kill |
| `moraleCascadeFactor` | `0.5` | Fraction of delta propagated from a regular member |
| `moraleCascadeLeaderFactor` | `0.8` | Fraction of delta propagated from the leader |

```ts
import { createDefaultSquadConfig } from '@alife-sdk/simulation/squad';

const config = createDefaultSquadConfig({
  maxSize: 6,
  moraleAllyDeathPenalty: -0.25,
});
```

---

## Serialisation

```ts
// Save
const state = squadManager.serialize();

// Load — clears all current squads first
squadManager.restore(state);
```

The restore path is event-free (no SQUAD_FORMED / SQUAD_MEMBER_ADDED emitted)
and reconstructs the monotonic ID counter from the restored squad IDs so new
squads created after restore never collide.

---

## MoraleLookup

The optional `MoraleLookup` callback bridges the squad module to your live
entity layer without creating a hard dependency:

```ts
export type MoraleLookup = (
  npcId: string,
) => { adjustMorale(delta: number): void } | null;
```

Return `null` for offline NPCs — cascade is silently skipped.
Only online NPCs that have a live morale component need to return an adjuster.
