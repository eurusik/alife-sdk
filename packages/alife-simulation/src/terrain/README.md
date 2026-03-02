# terrain

Smart terrain systems — threat state FSM, NPC terrain selection, job slots,
behavior scheme resolution, and task position calculation.

```ts
import {
  TerrainStateManager, TerrainState,
  TerrainSelector,
  resolveScheme,
  JobSlotSystem,
  TaskPositionResolver,
} from '@alife-sdk/simulation/terrain';
```

---

## What's in this module

| Export | Kind | What it does |
|--------|------|-------------|
| `TerrainState` | const object | Numeric state values (PEACEFUL=0, ALERT=1, COMBAT=2) |
| `TerrainStateManager` | class | Per-terrain threat FSM with configurable decay timers |
| `TerrainSelector` | class (static) | Scores terrains and picks the best fit for an NPC |
| `resolveScheme` | function | Condition-list evaluator for NPC behavior schemes |
| `JobSlotSystem` | class (static) | Build, score, assign, and release NPC job slots |
| `TaskPositionResolver` | class (static) | Resolves initial target position from slot/route/random |
| `ITerrainStateSnapshot` | interface | Serialised TerrainStateManager state |
| `ITerrainQuery` | interface | Input to `TerrainSelector.selectBest()` |
| `IJobSlotRuntime` | interface | Job slot with `assignedNPCs` tracking |
| `ISchemeConditionConfig` | interface | One entry in a condition list |
| `ISchemeContext` | interface | Runtime context passed to `customPredicate` |
| `ISchemeOverride` | interface | Return value of `resolveScheme()` |
| `IResolvedTaskPosition` | interface | Return value of `TaskPositionResolver.resolve()` |

---

## TerrainStateManager

Per-terrain Gulag FSM: `PEACEFUL → ALERT → COMBAT`.

Escalation is one-directional (only upward). Decay steps down one level at a
time with configurable timers.

```ts
import { TerrainStateManager, TerrainState } from '@alife-sdk/simulation/terrain';

const manager = new TerrainStateManager(
  'military_base',
  config.terrainState,   // { combatDecayMs: 30_000, alertDecayMs: 15_000 }
  events,
);

// Escalate on combat detection
manager.escalate(TerrainState.COMBAT, gameTimeMs);

// Tick decay every A-Life update
manager.tickDecay(gameTimeMs);

manager.terrainState; // → TerrainState (0/1/2)
```

**State transitions:**

```
         escalate(ALERT)       escalate(COMBAT)
PEACEFUL ─────────────→ ALERT ──────────────→ COMBAT
         ←────────────        ←──────────────
         after alertDecayMs    after combatDecayMs
```

Emits `ALifeEvents.TERRAIN_STATE_CHANGED` on every transition.

### Serialisation

```ts
const snap = manager.serialize(); // { state, lastThreatTimeMs }
manager.restore(snap.state, snap.lastThreatTimeMs);
```

---

## TerrainSelector

Static utility — scores all candidate terrains and returns the best one for
a given NPC. Returns `null` if no terrain is suitable.

```ts
import { TerrainSelector } from '@alife-sdk/simulation/terrain';

const best = TerrainSelector.selectBest({
  terrains:       allTerrains,
  npcFaction:     'loner',
  npcPos:         { x: 400, y: 300 },
  npcRank:        3,
  morale:         0.2,       // positive → no danger penalty
  surgeActive:    false,
  leaderTerrainId: null,     // or squadLeader's terrain id
  allowedTags:    null,      // or ReadonlySet<string> — tag whitelist
  config:         config.terrainSelector,
  // Optional: HumanBrain uses this for equipment affinity bonuses
  scoreModifier: (terrain, score) => {
    if (terrain.tags.has('sniper') && npc.weaponType === 'sniper') score += 10;
    return score;
  },
  occupantId: npcId,  // pass to allow re-selecting current terrain when at capacity
});
```

**Scoring pipeline per terrain:**

```
base score  = terrain.scoreFitness(faction, pos, rank)
× surgeMultiplier  if surgeActive && terrain.isShelter
+ squadLeaderBonus if terrain.id === leaderTerrainId
- dangerLevel × moraleDangerPenalty  if morale < 0
→ scoreModifier(terrain, score)  if provided
```

**Hard filters (terrain skipped if any fail):**

- `terrain.hasCapacity` (or NPC already occupies it)
- `terrain.acceptsFaction(npcFaction)`
- `allowedTags` — terrain must share at least one tag
- `terrain.isShelter` — required when `surgeActive`

### Tag filter helper

```ts
TerrainSelector.passesTagFilter(terrain, new Set(['outdoor', 'patrol']));
// → true if terrain has any matching tag
```

---

## resolveScheme

Evaluates an ordered condition list and returns the first matching scheme.
Used by `NPCBrain` to select what behavior to run based on time of day and
terrain threat level.

```ts
import { resolveScheme } from '@alife-sdk/simulation/terrain';

const result = resolveScheme(
  [
    { when: 'combat',  scheme: 'combat_patrol' },
    { when: 'night',   scheme: 'sleep' },
    { when: 'day',     scheme: 'guard', params: { scanArc: 180, engageRange: 300 } },
  ],
  isNight,      // boolean
  terrainState, // TerrainState
);
// → { scheme: 'guard', params: { scanArc: 180, engageRange: 300 } }
// → null if no condition matched
```

### Built-in `ConditionKind` values

| `when` | Matches when |
|--------|-------------|
| `'day'` | `!isNight` |
| `'night'` | `isNight` |
| `'peaceful'` | state === `PEACEFUL` |
| `'alert'` | state >= `ALERT` (includes COMBAT) |
| `'combat'` | state === `COMBAT` |

### Custom predicate

Add a `customPredicate` for logic beyond the built-in conditions. Both the
`when` check **and** the predicate must pass (logical AND):

```ts
{
  when: 'day',
  scheme: 'sniper_guard',
  customPredicate: (ctx) =>
    ctx.terrainState === TerrainState.PEACEFUL && !ctx.isNight,
}
```

---

## JobSlotSystem

Static class that manages job slot lifecycle — creation, scoring, assignment,
and release.

### Build slots from a terrain

```ts
import { JobSlotSystem } from '@alife-sdk/simulation/terrain';

const slots = JobSlotSystem.buildSlots(terrain);
// → IJobSlotRuntime[] — each has assignedNPCs: Set<string>
```

### Pick best slot for an NPC

```ts
const slot = JobSlotSystem.pickBestSlot(
  slots,
  {
    npcId:     'npc_1',
    factionId: 'military',
    rank:       4,
    position:  { x: 300, y: 200 },
    weaponType: 'sniper',
  },
  isNight,
  terrainState,
  config.jobScoring,  // { rankBonus: 5, distancePenalty: 0.01 }
);
// → IJobSlotRuntime | null
```

**Precondition checks** (slot is skipped if any fail):

| Precondition | Condition |
|-------------|-----------|
| `minRank` | `npc.rank >= slot.preconditions.minRank` |
| `dayOnly` | `!isNight` |
| `nightOnly` | `isNight` |
| `factions` | `factions.includes(npc.factionId)` |

**Scoring:** `rankBonus` (rank meets minimum) − `distance × distancePenalty`

### Assign / release

```ts
JobSlotSystem.assignNPC(slot, 'npc_1'); // → true if assigned, false if full
JobSlotSystem.releaseNPC(slot, 'npc_1');
JobSlotSystem.clearSlots(slots);        // release all assignments
```

---

## TaskPositionResolver

Stateless resolver — determines where an NPC should move when assigned a task.
Priority: slot position (guard/camp) → patrol route waypoint → random in bounds.

```ts
import { TaskPositionResolver } from '@alife-sdk/simulation/terrain';

const pos = TaskPositionResolver.resolve(
  slot,           // IJobSlot | null
  'patrol',       // task type string
  terrain.bounds, // IZoneBounds { x, y, width, height }
  (id) => routeMap.get(id) ?? null,   // findRouteById
  (idx) => terrain.routes[idx] ?? null, // getRouteByIdx
  random,
  0, // defaultRouteIndex
);
// → { targetX, targetY, routeId?, waypointIndex? }
```

**Resolution order:**

```
taskType === 'guard' | 'camp'  AND  slot has position
  → { targetX: slot.position.x, targetY: slot.position.y }

taskType === 'patrol'  AND  route found
  → first waypoint of the route + { routeId, waypointIndex: 0 }

fallback
  → random point within terrain bounds
```
