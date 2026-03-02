# `@alife-sdk/ai` — types module

Shared value-object types and enumerations for the online AI subsystem.
All types are pure data — no behavior, no framework coupling.

**Import path:** `@alife-sdk/ai/types`

---

## Cover system (`ICoverPoint.ts`)

| Export | Kind | Description |
|---|---|---|
| `ILoophole` | interface | A firing position within a cover point. Defines a peek offset from cover center and an angular firing arc (`angleMin`/`angleMax` in radians). |
| `ICoverPoint` | interface | A world-space cover position with an `id`, coordinates, `radius`, occupancy tracking (`occupiedBy`), and auto-generated `loopholes`. |
| `IEnemyPosition` | type alias | `Vec2` — minimal enemy position for cover evaluation without entity references. |
| `ICoverEvalContext` | interface | Aggregated input for cover scoring functions: NPC position, enemy positions, and squared search radius. |
| `CoverType` | const enum | Evaluator categories: `CLOSE`, `FAR`, `BALANCED`, `AMBUSH`, `SAFE`. Controls which tactical priority a cover query optimises for. |

---

## Weapon system (`IWeaponTypes.ts`)

| Export | Kind | Description |
|---|---|---|
| `WeaponCategory` | const enum | Weapon categories: `PISTOL`, `SHOTGUN`, `RIFLE`, `SNIPER`, `GRENADE`, `MEDKIT`. Numeric values enable fast switch-case dispatch. |
| `IWeaponRange` | interface | `{ min, max }` — effective engagement range (px) for a weapon type. |
| `IWeaponConfig` | interface | Static weapon definition: category, range, damage, fire rate, default ammo. Used for loadout creation and scoring. |
| `IWeaponSlot` | interface | Runtime state for one carried weapon: category, mutable `ammo`, `maxAmmo`, range, damage, fire rate. |
| `INPCLoadout` | interface | Full NPC inventory: `primary`, `secondary` (nullable `IWeaponSlot`), `grenades`, `medkits`. |

---

## Animation types (`IAnimationTypes.ts`)

| Export | Kind | Description |
|---|---|---|
| `AnimDirectionType` | const enum | Eight cardinal/intercardinal directions (`DOWN`, `UP`, `LEFT`, `RIGHT`, `DOWN_LEFT`, etc.) used in animation key composition. |
| `IAnimKeyResult` | interface | Resolved animation key ready for sprite playback: `key` string, `direction`, and `flipX` flag for mirror logic. |

---

## AI configuration (`IOnlineAIConfig.ts`)

Root configuration tree passed to `AIPlugin`. Every numeric literal in the AI package is sourced from here.

| Export | Description |
|---|---|
| `IOnlineAIConfig` | Root config: aggregates `cover`, `navigation`, `weapon`, `squad`, `monsterAbility`, `perception`, `goap` sections. |
| `ICoverConfig` | Cover search radius, scoring thresholds, evaluator tuning, loophole generation parameters. |
| `INavigationConfig` | Path smoothing (CatmullRom points/segment), Dubins arc parameters, velocity curve multipliers, arrival threshold. |
| `IWeaponScoringFactors` | Per-weapon scoring overrides for multi-enemy and HP-ratio modifiers. |
| `IWeaponSelectionConfig` | Per-category weapon configs, range boundaries, grenade/medkit thresholds. |
| `ISquadTacticsConfig` | Squad outnumber ratio, morale panic threshold, nearby radius. |
| `IMonsterAbilityConfig` | Timing constants for monster specials: charge, stalk, leap, PSI attack. |

---

## Perception & GOAP (`IPerceptionTypes.ts`)

| Export | Kind | Description |
|---|---|---|
| `IPerceivedEntity` | interface | Minimal entity data from the perception provider: `entityId`, `position`, `factionId`, `isAlive`. |
| `IPerceptionConfig` | interface | Sensor ranges: `visionRange`, `visionHalfAngle`, `hearingRange`, `weaponSoundRange`. |
| `IGOAPConfig` | interface | GOAP planner settings: replan interval, elite rank threshold, heal HP threshold, max plan depth, danger memory age. |
| `INPCWorldSnapshot` | interface | Pure read-only snapshot of NPC state used to build the GOAP world-state map (HP ratio, flags for cover, enemies, ammo, etc.). |
| `WorldProperty` | const enum | String keys for world-state properties (`ALIVE`, `SEE_ENEMY`, `IN_COVER`, `DANGER`, etc.). |
| `WorldPropertyKey` | type alias | Union of all `WorldProperty` string values. |
| `GoalPriority` | const enum | Priority bands for goal selection (lower = higher priority): `CRITICALLY_WOUNDED=0` … `DEFAULT=4`. |
| `GoalPriorityLevel` | type alias | Union of all `GoalPriority` numeric values. |

---

## Example

```ts
import type {
  ICoverPoint, ICoverEvalContext, IPerceivedEntity,
  INPCLoadout, IOnlineAIConfig,
} from '@alife-sdk/ai/types';
import { CoverType, WorldProperty, GoalPriority, WeaponCategory } from '@alife-sdk/ai/types';

// Build a cover query context:
const ctx: ICoverEvalContext = {
  npcPosition: { x: 300, y: 400 },
  enemies: enemies.map(e => e.position),
  maxRadiusSq: 500 * 500,
};

// Evaluate urgency via GOAP snapshot flags:
if (snapshot.criticallyWounded) {
  // GoalPriority.CRITICALLY_WOUNDED === 0 — highest priority
  planGoal(WorldProperty.CRITICALLY_WOUNDED, GoalPriority.CRITICALLY_WOUNDED);
}

// Select weapon by category:
const slot = loadout.primary;
if (slot?.category === WeaponCategory.SNIPER && distToEnemy > 600) {
  useWeapon(slot);
}
```
