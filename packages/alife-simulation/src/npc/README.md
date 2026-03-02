# npc

NPC lifecycle, daily schedules, personal relations, and quest-NPC protection.

```ts
import { NPCRegistrar, StoryRegistry, Schedule, NPCRelationRegistry } from '@alife-sdk/simulation/npc';
```

---

## What's in this module

| Export | Kind | What it does |
|--------|------|-------------|
| `NPCRegistrar` | class | Spawns/despawns NPCs, wires brain + subsystems |
| `StoryRegistry` | class | Protects quest-critical NPCs from death and cleanup |
| `Schedule` | class | Cyclic waypoint list for NPC daily routines |
| `NPCRelationRegistry` | class | Personal NPC-to-NPC goodwill + fight tracker |
| `createDefaultRelationConfig` | function | Default config for NPCRelationRegistry |
| `INPCRegistration` | interface | Return value of `registerNPC()` |
| `INPCRegistrationData` | interface | Input data for `registerNPC()` |
| `IHumanRegistrationOptions` | interface | Human-specific registration options |
| `IMonsterRegistrationOptions` | interface | Monster-specific registration options |
| `IWaypoint` | interface | Single step in a Schedule |
| `INPCRelationConfig` | interface | Config for NPCRelationRegistry |
| `IGoodwillEntry` | interface | Serialised goodwill entry |
| `IStoryRegistryEntry` | interface | Serialised story↔NPC mapping |

---

## NPCRegistrar

Stateless factory that creates NPC records and brains, wires them to shared
subsystems (movement, squad, relations), and adds them to the simulation maps.

### Setup

```ts
import { NPCRegistrar } from '@alife-sdk/simulation/npc';

const registrar = new NPCRegistrar({
  brainConfig:      config.brain,
  selectorConfig:   config.terrainSelector,
  jobConfig:        config.jobScoring,
  deps:             brainDeps,        // IBrainDeps — events, terrainManager, etc.
  movement:         movementSim,
  squadManager,
  relationRegistry,
  storyRegistry,
});
```

### Registering an NPC

```ts
const { record, brain } = registrar.registerNPC(
  {
    npcId:          'npc_sid',
    factionId:      'loner',
    position:       { x: 400, y: 300 },
    rank:           3,
    combatPower:    100,
    currentHp:      100,
    behaviorConfig: {
      retreatThreshold: 0.3,
      panicThreshold:   -0.7,
      searchIntervalMs: 5000,
      dangerTolerance:  3,
      aggression:       0.5,
    },
    options: {
      type: 'human',
      equipmentPrefs: {
        preferredWeaponType: 'rifle',
        preferredArmor:      'medium',
        aggressiveness:      0.6,
        cautiousness:        0.4,
      },
      scheduleWaypoints: [
        { zoneId: 'camp_a', position: { x: 400, y: 300 }, durationMs: 8 * 3_600_000 },
        { zoneId: 'patrol_1', position: { x: 600, y: 400 }, durationMs: 4 * 3_600_000 },
      ],
    },
  },
  allTerrains,  // SmartTerrain[] — available for initial assignment
  npcs,         // Map<string, INPCRecord> — mutated
  brains,       // Map<string, NPCBrain> — mutated
);
```

**`options.type`** selects the brain class:

| `type` | Brain created | Extra options |
|--------|--------------|---------------|
| `'human'` | `HumanBrain` | `equipmentPrefs`, `humanBrainConfig`, `initialMoney`, `scheduleWaypoints` |
| `'monster'` | `MonsterBrain` | `monsterBrainConfig`, `lairTerrainId` |
| omitted | `NPCBrain` (base) | — |

Throws if the `npcId` is already registered.

### Unregistering an NPC

```ts
registrar.unregisterNPC('npc_sid', npcs, brains);
// removes from: squad, relation registry, story registry, npcs map, brains map
```

---

## StoryRegistry

Bi-directional map `storyId ↔ npcId`. Quest-critical NPCs registered here are
protected by the simulation from offline combat death and redundancy cleanup.

```ts
const story = new StoryRegistry();

// Register on quest start
story.register('quest_find_artifact', 'npc_guide');

// Check protection before culling
if (story.isStoryNPC(npcId)) return; // skip

// Cross-reference in both directions
story.getNpcId('quest_find_artifact'); // → 'npc_guide'
story.getStoryId('npc_guide');         // → 'quest_find_artifact'

// Remove on quest end / NPC death
story.unregister('quest_find_artifact');
story.removeByNpcId('npc_guide');      // same, by NPC id

story.size; // → number of protected NPCs
```

### Serialisation

```ts
const saved = story.serialize();   // IStoryRegistryEntry[]
story.restore(saved);              // clears + restores
```

---

## Schedule

Cyclic waypoint list for NPC daily routines. The brain calls `advance()` when
the NPC reaches a waypoint and its dwell time expires.

```ts
import { Schedule } from '@alife-sdk/simulation/npc';
import type { IWaypoint } from '@alife-sdk/simulation/npc';

const schedule = new Schedule([
  { zoneId: 'barracks',  position: { x: 100, y: 200 }, durationMs: 6 * 3_600_000 },
  { zoneId: 'canteen',   position: { x: 150, y: 220 }, durationMs: 1 * 3_600_000 },
  { zoneId: 'patrol_1',  position: { x: 300, y: 400 }, durationMs: 4 * 3_600_000 },
]);

schedule.getCurrentWaypoint(); // → first IWaypoint
schedule.advance();             // move to next (wraps at end)
schedule.reset();               // back to index 0

schedule.length; // → 3
schedule.index;  // → current index (0-based)
```

Throws if constructed with an empty array.

---

## NPCRelationRegistry

Two independent subsystems in one class:

1. **Personal goodwill** — persistent `Map<"from→to", number>`, serialisable.
   Overlaid on top of faction relations for the final attitude score.
2. **Fight registry** — transient, auto-forgotten after `fightRememberTimeMs`.
   Never serialised.

```
attitude = clamp(factionRelation + personalGoodwill, min, max)
```

### Setup

```ts
import { NPCRelationRegistry, createDefaultRelationConfig } from '@alife-sdk/simulation/npc';

const relations = new NPCRelationRegistry(createDefaultRelationConfig());
```

### Personal goodwill

```ts
// Adjust directly
relations.adjustGoodwill('npc_a', 'npc_b', -10);

// Read combined attitude (you resolve faction relation yourself)
const factionRel = factions.getRelation('loner', 'bandit'); // → number
const attitude   = relations.getAttitude('npc_a', 'npc_b', factionRel);

// Raw personal value only
relations.getPersonalGoodwill('npc_a', 'npc_b'); // → 0 if no entry
```

### Action handlers

Call these from your combat / event system:

```ts
// NPC was hit
relations.onNPCAttacked(attackerId, targetId, damage);
// → registers fight, target loses goodwill toward attacker

// NPC was killed
relations.onNPCKilled(killerId, victimId, victimFaction, witnessIds, witnessFactions);
// → adjusts goodwill for each witness based on their relation to victim
```

Witness goodwill delta rules:

| Witness relation to victim | Delta applied to killer |
|---------------------------|------------------------|
| Same faction as victim | `killAllyDelta` (default −30) |
| Victim was attacking this witness | `killEnemyDelta` (default +15) |
| Otherwise | `killNeutralDelta` (default −5) |

### Fight registry

```ts
relations.isInFight('npc_a');         // → boolean
relations.getDefender('npc_a');       // → string | null

// Advance time + purge expired fights — call every tick
relations.updateFights(deltaMs);
```

### Config defaults

| Field | Default | Description |
|-------|---------|-------------|
| `killAllyDelta` | `-30` | Goodwill loss when killer kills your ally |
| `killNeutralDelta` | `-5` | Goodwill loss for neutral kill |
| `killEnemyDelta` | `+15` | Goodwill gain when killer kills your attacker |
| `attackHitDelta` | `-5` | Goodwill loss per hit (target → attacker) |
| `fightRememberTimeMs` | `60 000` | Fight record TTL |
| `goodwillMin/Max` | `−100 / +100` | Goodwill clamp bounds |

### Serialisation

```ts
const saved = relations.serialize();  // IGoodwillEntry[] — only non-zero entries
relations.restore(saved);             // clears all state, then restores goodwill

relations.reset();                    // full teardown (new game)

// Remove all data for a despawned NPC
relations.removeNPC('npc_a');
```
