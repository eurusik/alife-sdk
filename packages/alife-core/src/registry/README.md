# registry

Type-safe, freezable, validated content registries for all game data.

```ts
import {
  Registry,
  FactionRegistry,   NPCTypeRegistry,  MonsterRegistry,
  DamageTypeRegistry, AnomalyTypeRegistry,
  AIStateRegistry,   BehaviorSchemeRegistry, TaskTypeRegistry,
} from '@alife-sdk/core/registry';
import type {
  IFactionDefinition, INPCTypeDefinition, IMonsterDefinition,
  IDamageTypeDefinition, IAnomalyTypeDefinition,
  IStateHandler, ITransitionCondition, IAIStateDefinition,
  IBehaviorSchemeDefinition, ITaskTypeDefinition,
} from '@alife-sdk/core/registry';
```

---

## Concepts

All registries share the same pattern:

1. **Register** game data by string ID before `kernel.init()`
2. **Freeze** automatically when the kernel initialises — no more mutations
3. **Look up** data by ID at runtime — throws on missing IDs (fail-fast)
4. **Validate** on register — bad configs are caught at boot, not mid-game

```
boot                              runtime
──────────────────────────────    ────────────────────────────────────
registry.register(id, config)  →  kernel.init() → registry.freeze()
                                  →  registry.get(id)   // read-only
```

---

## `Registry<TId, TConfig>` — base class

All specific registries extend this. You can also extend it directly for
custom game data.

### API

```ts
// Register an entry (throws if frozen, duplicate, or invalid)
registry.register(id, config): this  // chainable

// Retrieve
registry.get(id): TConfig            // throws if not found
registry.tryGet(id): TConfig | undefined  // safe alternative
registry.has(id): boolean

// Iterate
registry.ids(): TId[]
registry.size: number
for (const [id, config] of registry) { ... }  // Symbol.iterator

// Lifecycle
registry.freeze(): void
registry.isFrozen: boolean
```

### Custom registry example

```ts
import { Registry } from '@alife-sdk/core/registry';

interface IWeaponDef {
  name:    string;
  damage:  number;
  rateOfFire: number; // shots/s
}

const weapons = new Registry<string, IWeaponDef>({
  name: 'WeaponRegistry',
  validate: (c) => {
    const errors: string[] = [];
    if (c.damage <= 0)     errors.push('damage must be > 0');
    if (c.rateOfFire <= 0) errors.push('rateOfFire must be > 0');
    return errors;
  },
});

weapons
  .register('ak74', { name: 'AK-74', damage: 45, rateOfFire: 10 })
  .register('mp5',  { name: 'MP-5',  damage: 28, rateOfFire: 15 });

const ak = weapons.get('ak74'); // IWeaponDef
```

---

## `FactionRegistry`

Stores faction diplomatic relations, damage immunities, equipment defaults,
and spawn balance rules.

```ts
const fp = kernel.getPlugin(Plugins.FACTIONS);

fp.factions.register('stalker', {
  name: 'Stalker',
  baseRelations:    { military: -80, bandit: -100, monolith: -100 },
  immunities:       { radiation: 0.2 },  // 20% radiation resistance
  defaultEquipment: { preferredWeapon: 'rifle', aggressiveness: 0.6, cautiousness: 0.4 },
  spawnRules:       { targetRatio: 0.35, balanceTolerance: 0.05 },
  metadata:         { color: '#4a7c59', description: 'Free stalkers' },
});
```

**`IFactionDefinition` fields:**

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Display name |
| `baseRelations` | `Record<factionId, number>` | Immutable starting relations [-100, 100] |
| `immunities` | `Record<damageTypeId, number>` | Resistance factors [0, 1] |
| `defaultEquipment` | `Partial<IEquipmentPreference>` | Loadout defaults for this faction's NPCs |
| `spawnRules` | `IFactionSpawnRules` | `targetRatio` + `balanceTolerance` [0, 1] |
| `metadata?` | `Record<string, unknown>` | Arbitrary extension data |

**Validates:** `baseRelations` in [-100, 100], `immunities` in [0, 1].

---

## `NPCTypeRegistry`

Human NPC archetypes — stat profiles for each NPC variant.

```ts
const np = kernel.getPlugin(Plugins.NPC_TYPES);

np.npcTypes.register('stalker_rookie', {
  name:            'Сталкер-початківець',
  faction:         'stalker',
  hp:              80,
  speed:           75,          // px/s
  damage:          25,
  attackRange:     250,         // px
  detectionRange:  300,         // px
  fov:             120,         // degrees
  rank:            1,           // 1–5, affects GOAP eligibility (≥ 5)
  accuracy:        0.55,        // [0, 1]
  retreatThreshold: 0.25,       // flee when hp < 25%
  equipmentPreference: { preferredWeapon: 'pistol' },
});
```

**`INPCTypeDefinition` key fields:**

| Field | Constraints | Notes |
|-------|------------|-------|
| `hp` | > 0 | Base health |
| `speed` | > 0 | px/s |
| `rank` | 1–5 | ≥ 5 enables GOAP planner |
| `accuracy` | [0, 1] | Hit probability factor |
| `retreatThreshold` | [0, 1] | HP fraction to trigger retreat |

**Validates:** `hp > 0`, `speed > 0`, `rank 1–5`, `accuracy [0, 1]`.

---

## `MonsterRegistry`

Non-human hostile creature archetypes with pack and lair parameters.

```ts
const mp = kernel.getPlugin(Plugins.MONSTERS);

mp.monsters.register('bloodsucker', {
  name:           'Bloodsucker',
  hp:             300,
  speed:          110,
  damage:         60,
  attackRange:    60,           // melee range
  detectionRange: 400,
  fov:            160,
  packSize:       [1, 2],       // [min, max] spawn count
  abilities:      ['stalk'],    // special ability IDs
  lair: { inner: 80, patrol: 250, outer: 600 }, // must: inner < patrol < outer
  rank:           3,
});
```

**`IMonsterDefinition` key fields:**

| Field | Constraints | Notes |
|-------|------------|-------|
| `packSize` | min ≥ 1, min ≤ max | Spawned as a group |
| `abilities` | string[] | Used by monster AI to select special moves |
| `lair.inner` | < lair.patrol | Personal space — immediate attack |
| `lair.patrol` | < lair.outer | Roam annulus for idle movement |
| `lair.outer` | — | Hard pursuit boundary |
| `rank` | 1–5 (configurable) | Threat tier |

**Validates:** all numeric fields > 0, lair ordering, pack size, rank bounds.

**Configurable rank bounds:**
```ts
// Allow only rank 1–3 in this game mode
const reg = new MonsterRegistry({ rankMin: 1, rankMax: 3 });
```

---

## `DamageTypeRegistry`

Damage type table used by the combat pipeline and morale system.

```ts
const dmg = new DamageTypeRegistry();
dmg.registerDefaults(); // registers: physical, fire, radiation, chemical, psi

// Or add custom types:
dmg.register('electric', {
  name:            'Electric',
  defaultImmunity: 0,      // [0, 1] base resistance when faction has no override
  moraleImpact:    -0.2,   // negative = demoralising
});
```

**Built-in types from `registerDefaults()`:**

| ID | `moraleImpact` |
|----|---------------|
| `physical` | -0.15 |
| `fire` | -0.20 |
| `radiation` | -0.10 |
| `chemical` | -0.10 |
| `psi` | -0.25 |

**Validates:** `defaultImmunity` in [0, 1].

---

## `AnomalyTypeRegistry`

Environmental hazard zone archetypes.

```ts
const ap = kernel.getPlugin(Plugins.ANOMALIES);

ap.anomalyTypes.register('psi_field', {
  name:            'PSI Field',
  damageTypeId:    'psi',       // must be registered in DamageTypeRegistry
  damagePerSecond: 15,
  radius:          120,         // px
  artefactChance:  0.3,         // 30% chance per spawn cycle
  maxArtefacts:    2,
});
```

**Validates:** `damagePerSecond > 0`, `radius > 0`, `artefactChance [0, 1]`, `maxArtefacts ≥ 0`.

---

## `AIStateRegistry`

Central table of all AI FSM states — handlers, transition rules, and guards.
Used by `StateMachine` to drive NPC behaviour.

```ts
import type { IAIStateDefinition, IStateHandler } from '@alife-sdk/core/registry';

const idleHandler: IStateHandler = {
  enter(entity)         { /* play idle anim */ },
  update(entity, delta) { /* scan for threats */ },
  exit(entity)          { /* cleanup */ },
};

stateRegistry.register('IDLE', {
  handler: idleHandler,

  // Optional: whitelist of valid next states
  allowedTransitions: ['PATROL', 'ALERT', 'COMBAT'],

  // Optional: auto-evaluated rules (sorted by priority desc at register time)
  transitionConditions: [
    {
      targetState: 'COMBAT',
      priority:    100,
      condition:   (entity) => entity.memory?.hasEnemy() ?? false,
    },
    {
      targetState: 'PATROL',
      priority:    10,
      condition:   (entity) => entity.idleTime > 5,
    },
  ],

  // Optional guards
  canEnter: (entity, fromState) => entity.isAlive,
  canExit:  (entity, toState)   => toState !== 'DEAD' || entity.hp <= 0,
});
```

### `evaluateTransitions(currentState, entity)`

Evaluates all `transitionConditions` for `currentState` in priority order.
Returns the first matching `targetState`, or `null`.
Called automatically by `StateMachine` each frame.

```ts
const next = stateRegistry.evaluateTransitions('IDLE', entity);
if (next) fsm.transition(next);
```

**`IAIStateDefinition` fields:**

| Field | Required | Description |
|-------|----------|-------------|
| `handler` | ✓ | `enter / update / exit` lifecycle |
| `allowedTransitions` | — | Whitelist of valid next state IDs |
| `transitionConditions` | — | Auto-evaluated rules (priority sorted) |
| `canEnter` | — | Guard: veto entry from a specific source state |
| `canExit` | — | Guard: veto exit to a specific target state |

---

## `BehaviorSchemeRegistry`

Named NPC behavior modes used by SmartTerrain job scheduling.

```ts
const schemes = new BehaviorSchemeRegistry();
schemes.registerDefaults(); // guard, patrol, camp, sleep, camper, wander

// Custom scheme:
schemes.register('ambush', {
  name:         'Ambush',
  isStationary: true,
  requiresRoute: false,
  nightOnly:    true,   // only active at night
  dayOnly:      false,
});
```

**Built-in schemes from `registerDefaults()`:**

| ID | Stationary | Requires route | Time restriction |
|----|-----------|---------------|-----------------|
| `guard` | No | No | Any |
| `patrol` | No | Yes | Any |
| `camp` | Yes | No | Any |
| `sleep` | Yes | No | Night only |
| `camper` | Yes | No | Any |
| `wander` | No | No | Any |

**Validates:** `nightOnly` and `dayOnly` cannot both be `true`.

---

## `TaskTypeRegistry`

Task types assigned to NPCs by SmartTerrain job slots.

```ts
const tasks = new TaskTypeRegistry();
tasks.registerDefaults(); // patrol (10), guard (20), camp (5), wander (1)

// Custom type:
tasks.register('snipe', {
  name:            'Snipe',
  defaultBehavior: 'guard',  // BehaviorScheme ID activated for this task
  priority:        30,       // higher = assigned first when competing
});
```

**Built-in tasks from `registerDefaults()`:**

| ID | Default behavior | Priority |
|----|-----------------|---------|
| `patrol` | `patrol` | 10 |
| `guard` | `guard` | 20 |
| `camp` | `camp` | 5 |
| `wander` | `wander` | 1 |

---

## Tips

**Register everything before `kernel.init()`.**
Calling `register()` on a frozen registry throws immediately.
Group all `register()` calls in your boot sequence:

```ts
const kernel = new ALifeKernel();
fullPreset(kernel);

// All registrations here, before init
const fp = kernel.getPlugin(Plugins.FACTIONS);
fp.factions.register('stalker', { ... });
fp.factions.register('military', { ... });

kernel.init(); // freezes all registries
```

**Use `tryGet()` when an ID might be absent.**
`get()` throws on missing IDs — great for required data, risky for optional
lookups. Use `tryGet()` + null check when the absence is a valid state:

```ts
const def = registry.tryGet(npcTypeId);
if (!def) {
  logger.warn('npc_brain', `Unknown NPC type: ${npcTypeId}`);
  return;
}
```

**Iterate with `for...of` when you need all entries.**
All registries are iterable over `[id, config]` pairs:

```ts
for (const [factionId, def] of factionRegistry) {
  console.log(`${factionId}: ${def.name}`);
}
```

**`AIStateRegistry` auto-sorts transition conditions.**
You don't need to order `transitionConditions` by priority yourself — the
registry sorts them descending on `register()`. The first matching condition
in the sorted list wins every frame.
