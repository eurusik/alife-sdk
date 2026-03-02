# WorldStateBuilder

Pure function that converts an NPC data snapshot into a GOAP `WorldState`.

No side effects — same input always produces the same output. The snapshot
decouples the planner from live entity state.

```ts
import { buildWorldState, DEFAULT_WORLD_PROPERTY_BUILDERS } from '@alife-sdk/ai/goap';
import type { IWorldPropertyBuilder } from '@alife-sdk/ai/goap';
// WorldProperty constants and INPCWorldSnapshot live in @alife-sdk/ai/types:
import { WorldProperty } from '@alife-sdk/ai/types';
import type { INPCWorldSnapshot } from '@alife-sdk/ai/types';
```

---

## `buildWorldState(snapshot, builders?): WorldState`

Convert an `INPCWorldSnapshot` into a `WorldState` for the planner.

```ts
const worldState = buildWorldState(snapshot);
// worldState.get('enemyPresent') === true / false
// worldState.get('inCover')      === true / false
// ...
```

- `builders` is optional — defaults to `DEFAULT_WORLD_PROPERTY_BUILDERS` (16 properties).
- Pass a custom `builders` array to add, remove, or replace properties.
- The returned `WorldState` is a new object every call (safe to mutate if needed).

`GOAPController` calls this automatically on each replan — you only need to call
it directly if you're building custom goal evaluation logic.

---

## INPCWorldSnapshot

The input snapshot you provide to the controller each frame.
It captures all NPC data relevant for planning at a single moment in time.

```ts
interface INPCWorldSnapshot {
  readonly isAlive: boolean;
  readonly hpRatio: number;          // [0, 1]
  readonly hasWeapon: boolean;
  readonly hasAmmo: boolean;
  readonly inCover: boolean;
  readonly seeEnemy: boolean;        // enemy visible right now
  readonly enemyPresent: boolean;    // enemy known (memory, not just visual)
  readonly enemyInRange: boolean;    // enemy within weapon range
  readonly hasDanger: boolean;       // any danger signal (explosion, gunfire, etc.)
  readonly hasDangerGrenade: boolean;
  readonly enemyWounded: boolean;
}
```

Build the snapshot from your NPC data before calling `controller.update()`:

```ts
const snapshot: INPCWorldSnapshot = {
  isAlive:          npc.isAlive,
  hpRatio:          npc.hp / npc.maxHp,
  hasWeapon:        npc.weapon !== null,
  hasAmmo:          npc.ammo > 0,
  inCover:          coverRegistry.isInCover({ x: npc.x, y: npc.y }) !== null,
  seeEnemy:         npc.visibleEnemies.length > 0,
  enemyPresent:     npc.knownEnemies.length > 0,
  enemyInRange:     nearestEnemyDist < npc.weaponEffectiveRange,
  hasDanger:        dangerManager.getHighestThreat(npc.id) > 0,
  hasDangerGrenade: dangerManager.hasDanger(npc.id, 'grenade'),
  enemyWounded:     nearestEnemy?.hp < nearestEnemy?.maxHp * 0.3,
};
```

---

## WorldProperty keys

All 16 boolean properties registered by `DEFAULT_WORLD_PROPERTY_BUILDERS`:

| Property key | String value | Derived from |
|-------------|-------------|--------------|
| `WorldProperty.ALIVE` | `'alive'` | `snapshot.isAlive` |
| `WorldProperty.CRITICALLY_WOUNDED` | `'criticallyWounded'` | `snapshot.hpRatio <= 0.3` |
| `WorldProperty.HAS_WEAPON` | `'hasWeapon'` | `snapshot.hasWeapon` |
| `WorldProperty.HAS_AMMO` | `'hasAmmo'` | `snapshot.hasAmmo` |
| `WorldProperty.IN_COVER` | `'inCover'` | `snapshot.inCover` |
| `WorldProperty.SEE_ENEMY` | `'seeEnemy'` | `snapshot.seeEnemy` |
| `WorldProperty.ENEMY_PRESENT` | `'enemyPresent'` | `snapshot.enemyPresent` |
| `WorldProperty.ENEMY_IN_RANGE` | `'enemyInRange'` | `snapshot.enemyInRange` |
| `WorldProperty.DANGER` | `'danger'` | `snapshot.hasDanger` |
| `WorldProperty.DANGER_GRENADE` | `'dangerGrenade'` | `snapshot.hasDangerGrenade` |
| `WorldProperty.ENEMY_WOUNDED` | `'enemyWounded'` | `snapshot.enemyWounded` |
| `WorldProperty.ENEMY_SEE_ME` | `'enemySeeMe'` | `snapshot.seeEnemy` ¹ |
| `WorldProperty.READY_TO_KILL` | `'readyToKill'` | `hasWeapon && hasAmmo && seeEnemy && enemyInRange` |
| `WorldProperty.POSITION_HELD` | `'positionHeld'` | `inCover && !seeEnemy` |
| `WorldProperty.LOOKED_OUT` | `'lookedOut'` | always `false` ² |
| `WorldProperty.AT_TARGET` | `'atTarget'` | `!enemyPresent && !hasDanger` |

¹ `ENEMY_SEE_ME` is mapped from `seeEnemy` (same source) — distinct semantic intent.
² `LOOKED_OUT` starts `false` every frame; actions set it `true` via effects.

> **Threshold mismatch warning:** `CRITICALLY_WOUNDED` is hardcoded at `hpRatio <= 0.3`.
> The `GoalSelector`'s CRITICALLY_WOUNDED rule uses `config.healHpThreshold` (default `0.3`,
> configurable). If you change `healHpThreshold` (e.g. to `0.5`), the goal selector will
> fire at 50% HP but the world state property will still only be `true` at 30%.
> Keep both in sync, or replace the `CRITICALLY_WOUNDED` builder with a custom one that
> reads from the same threshold.

Use `WorldProperty.*` constants in your action preconditions/effects — never raw strings:

```ts
// Good:
ws.set(WorldProperty.IN_COVER, true);
ws.set(WorldProperty.ENEMY_PRESENT, false);

// Avoid:
ws.set('inCover', true);  // typo-prone
```

---

## IWorldPropertyBuilder

Strategy interface for property computation:

```ts
interface IWorldPropertyBuilder {
  readonly key: string;
  build(snapshot: INPCWorldSnapshot): boolean;
}
```

---

## DEFAULT_WORLD_PROPERTY_BUILDERS

The array of 16 builders used by default. Import and inspect it to understand
the full property derivation or use it as a base for customization:

```ts
import { DEFAULT_WORLD_PROPERTY_BUILDERS } from '@alife-sdk/ai/goap';

// Add a custom property on top of the defaults:
const myBuilders: IWorldPropertyBuilder[] = [
  ...DEFAULT_WORLD_PROPERTY_BUILDERS,
  {
    key: 'lowAmmo',
    build: (s) => s.hasAmmo && s.hpRatio < 0.5,
  },
];

const worldState = buildWorldState(snapshot, myBuilders);
// worldState.get('lowAmmo') === true / false
```

To replace a single default, filter and replace:

```ts
const myBuilders = DEFAULT_WORLD_PROPERTY_BUILDERS.map((b) =>
  b.key === WorldProperty.CRITICALLY_WOUNDED
    ? { key: b.key, build: (s: INPCWorldSnapshot) => s.hpRatio <= 0.15 } // stricter threshold
    : b,
);
```

> **Important:** `GOAPController` calls `buildWorldState(snapshot)` internally
> without a builders argument — it always uses `DEFAULT_WORLD_PROPERTY_BUILDERS`.
> Custom builders passed to `buildWorldState()` directly are **not picked up** by
> the controller automatically. To use custom builders with `GOAPController`, you
> must subclass it and override the replan logic, or call `buildWorldState()` yourself
> outside the controller.
