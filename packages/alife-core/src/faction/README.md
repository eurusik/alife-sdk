# faction

Faction diplomacy, damage resistance, and loadout preferences for
`@alife-sdk/core`.

```ts
import { Faction, FactionBuilder } from '@alife-sdk/core/faction';
import { createImmunityProfile, applyDamageReduction, getResistance } from '@alife-sdk/core/faction';
import type {
  ImmunityProfile,
  IFactionThresholds,
  IFactionState,
} from '@alife-sdk/core/faction';

// FactionDefinition types live in the registry module
import type {
  IFactionDefinition,
  IEquipmentPreference,
  IFactionSpawnRules,
} from '@alife-sdk/core/registry';
```

> **`ImmunityProfile`** is also used in the damage pipeline — see
> [combat/DamageInstance.md](../combat/DamageInstance.md) for how
> `applyDamageReduction()` integrates with `createDamageInstance()`.

---

## Concepts

### Two-layer relation model

Every faction tracks relations to every other faction on two independent
layers:

```
Effective relation = base + dynamic   (clamped to [-100, 100])

base      — immutable, loaded from config (e.g. stalkers vs bandits: -60)
dynamic   — runtime goodwill, decays toward 0 over time
```

This means the simulation can temporarily shift relations (NPC helped a
player → +20 goodwill toward player faction) without permanently rewriting
the world data.

### Relation scale

```
-100          -50           0           +50          +100
 ├─────────────┼────────────┼────────────┼─────────────┤
 │  HOSTILE    │   neutral  │   neutral  │    ALLY     │
```

Default thresholds: `hostile < -50`, `ally > +50`. Both are configurable.

### Three classification methods

`isHostile()`, `isNeutral()`, `isAlly()` — derived from `getRelation()`
and the configured thresholds. Use these instead of comparing raw numbers.

---

## `FactionBuilder` — defining a faction

The fluent builder validates inputs and produces an `IFactionDefinition`
for registration in `FactionRegistry`.

```ts
import { FactionBuilder } from '@alife-sdk/core/faction';

const stalkersDef = new FactionBuilder('stalkers')
  .displayName('Stalkers')
  .relation('bandits',   -60)   // hostile
  .relation('military',  -30)   // tense
  .relation('scientists', 40)   // friendly
  .relation('monolith', -100)   // war
  .immunity('radiation', 0.2)   // light rad resistance
  .equipmentPreference({
    preferredWeapon:  'rifle',
    aggressiveness:   0.5,
    cautiousness:     0.3,
  })
  .spawn({ targetRatio: 0.30, balanceTolerance: 0.05 })
  .withMetadata('color', '#4a9e4a')
  .build();
```

### Builder methods

| Method | Validates | Description |
|--------|-----------|-------------|
| `.displayName(name)` | non-empty | Human-readable name shown in UI |
| `.relation(factionId, score)` | `[-100, 100]` | Base relation to another faction |
| `.immunity(damageTypeId, factor)` | `[0, 1]` | Resistance to a damage type |
| `.equipmentPreference(prefs)` | — | Weapon/armor/behavior defaults for NPCs |
| `.spawn(rules)` | — | Target population ratio and tolerance |
| `.withMetadata(key, value)` | — | Arbitrary extension data (UI, descriptions) |
| `.build()` | all fields | Returns frozen `IFactionDefinition`; throws on errors |

**Throws** at build time if:
- `displayName` was never set
- any relation score is outside `[-100, 100]`
- any immunity factor is outside `[0, 1]`

---

## `Faction` — runtime faction object

Created by the simulation (via `FactionRegistry`). Wraps an `IFactionDefinition`
and maintains the mutable dynamic goodwill layer.

```ts
import { Faction } from '@alife-sdk/core/faction';

// Usually created by the FactionRegistry plugin — not directly
const faction = new Faction('stalkers', stalkersDef);
```

### `faction.getRelation(otherFactionId)`

Combined relation = base + dynamic, clamped to `[-100, 100]`.

```ts
faction.getRelation('bandits');   // -60 (base only, no goodwill yet)
faction.adjustGoodwill('bandits', 20);
faction.getRelation('bandits');   // -40
```

### `faction.isHostile(otherFactionId)` / `.isAlly()` / `.isNeutral()`

Classification helpers. Use these in AI logic instead of comparing numbers:

```ts
if (factionA.isHostile(factionB.id)) {
  npc.engageCombat(target);
} else if (factionA.isAlly(factionB.id)) {
  npc.greet(target);
}
```

### `faction.adjustGoodwill(otherFactionId, delta)`

Modify the dynamic layer. Positive = improve relations, negative = damage them.
Entries that reach 0 are automatically removed (no memory leak).

```ts
// Player helped stalkers → improve goodwill toward player faction
faction.adjustGoodwill('player', +15);

// NPC was attacked by bandits → temporary hostility boost
faction.adjustGoodwill('bandits', -10);
```

### `faction.decayGoodwill(rate)`

Move all goodwill values toward 0 by `rate`. Call in your simulation tick
to make temporary relation shifts fade over time.

```ts
// Called each A-Life tick
for (const faction of allFactions) {
  faction.decayGoodwill(2); // each tick, goodwill moves 2 points toward 0
}
```

### `faction.resetGoodwill()`

Immediately clear all dynamic goodwill. Use after a major story event or
faction reset.

---

## `IFactionDefinition` — full schema

```ts
interface IFactionDefinition {
  name:             string;                        // display name
  baseRelations:    Record<string, number>;        // factionId → [-100, 100]
  immunities:       Record<string, number>;        // damageTypeId → [0, 1]
  defaultEquipment: Partial<IEquipmentPreference>; // weapon/armor/behavior
  spawnRules:       IFactionSpawnRules;            // population balance
  metadata?:        Record<string, unknown>;       // UI color, description, etc.
}

interface IEquipmentPreference {
  preferredWeapon:  string;  // 'rifle' | 'shotgun' | ...
  preferredArmor:   string;  // armor tier string
  aggressiveness:   number;  // [0, 1] — higher = more PATROL/ATTACK
  cautiousness:     number;  // [0, 1] — higher = more CAMP/GUARD
}

interface IFactionSpawnRules {
  targetRatio:       number; // [0, 1] target share of total NPC population
  balanceTolerance:  number; // [0, 1] allowed deviation before rebalancing
}
```

---

## Registering factions

Define all factions at startup and register them in `FactionRegistry`:

```ts
import { FactionBuilder } from '@alife-sdk/core/faction';
import { FactionRegistry } from '@alife-sdk/core/registry';

const registry = new FactionRegistry();

registry.register('stalkers', new FactionBuilder('stalkers')
  .displayName('Stalkers')
  .relation('bandits', -60)
  .relation('military', -30)
  .immunity('radiation', 0.2)
  .spawn({ targetRatio: 0.30, balanceTolerance: 0.05 })
  .build(),
);

registry.register('bandits', new FactionBuilder('bandits')
  .displayName('Bandits')
  .relation('stalkers', -60)
  .relation('military', -70)
  .equipmentPreference({ aggressiveness: 0.8 })
  .spawn({ targetRatio: 0.20, balanceTolerance: 0.1 })
  .build(),
);
```

---

## Serialisation

`Faction.serialize()` saves only the dynamic goodwill layer — base relations
come from config and don't need to be stored:

```ts
// Save
const state = faction.serialize();
// { dynamicGoodwill: { 'bandits': -10, 'player': 15 } }

// Restore
faction.restore(state);
```

---

## Full example — faction conflict in AI

```ts
import { Faction } from '@alife-sdk/core/faction';

function shouldAttack(attacker: Faction, target: Faction): boolean {
  return attacker.isHostile(target.id);
}

function onPlayerHelped(playerFaction: Faction, npcFaction: Faction) {
  // Player saved an NPC → improve goodwill temporarily
  npcFaction.adjustGoodwill(playerFaction.id, +20);
  console.log(
    `Relation now: ${npcFaction.getRelation(playerFaction.id)}`,
    `— allied: ${npcFaction.isAlly(playerFaction.id)}`,
  );
}

function onSimulationTick(factions: Faction[]) {
  // Relations drift back to base over time
  for (const f of factions) {
    f.decayGoodwill(1);
  }
}
```

---

## Custom hostility thresholds

Override per-faction if your game has a different diplomacy scale:

```ts
const monolith = new Faction('monolith', monolithDef, {
  hostile: -20,  // monolith is hostile even to mild opponents
  ally:    90,   // almost never allied with anyone
});
```
