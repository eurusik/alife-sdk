# createDefaultAIConfig

Central configuration factory for the 7 core AI subsystems.

**Source:** [createDefaultAIConfig.ts](createDefaultAIConfig.ts)

---

## Overview

```ts
import { createDefaultAIConfig } from '@alife-sdk/ai/config';

const config = createDefaultAIConfig();           // all defaults
const config = createDefaultAIConfig(overrides);  // partial overrides
```

Returns `IOnlineAIConfig` — a structured object with 7 named sections, one per subsystem.
Every numeric constant in the SDK is sourced from this config object.

**Override semantics:** Each section is merged shallowly with its defaults.
Passing `{ cover: { searchRadius: 500 } }` replaces only `searchRadius`; all other
cover fields keep their defaults. You cannot partially override a nested object
within a section (e.g., `weapon.weapons` must be replaced entirely if changed).

```ts
const config = createDefaultAIConfig({
  cover:           { searchRadius: 500 },           // one field
  navigation:      { arrivalThreshold: 12 },
  weapon:          { shotgunEffectiveMax: 200, grenadeMinEnemies: 3 }, // multiple fields
  monsterAbility:  { chargeWindupMs: 800 },
});
```

---

## Section: `cover` — `ICoverConfig`

Consumed by `@alife-sdk/ai/cover`.

| Field | Default | Description |
|-------|:-------:|-------------|
| `searchRadius` | `400` | Max radius to search for cover points (px) |
| `pointRadius` | `24` | Default protection radius of a cover point (px) |
| `occupyDistance` | `30` | Distance within which NPC is considered "in cover" (px) |
| `minScoreThreshold` | `0.1` | Minimum score — points below this are rejected |
| `closeMaxRange` | `200` | CLOSE evaluator: max acceptable distance (px) |
| `farMaxRange` | `600` | FAR evaluator: max acceptable distance (px) |
| `ambushMinAngle` | `π/3` | AMBUSH: minimum flanking angle (rad, ≈ 60°) |
| `ambushMaxAngle` | `2π/3` | AMBUSH: maximum flanking angle (rad, ≈ 120°) |
| `ambushMinDist` | `100` | AMBUSH: minimum distance from enemy (px) |
| `ambushMaxDist` | `300` | AMBUSH: maximum distance from enemy (px) |
| `recommendHpCritical` | `0.2` | HP below this → use CLOSE cover |
| `recommendHpHealthy` | `0.6` | HP above this → NPC can use AMBUSH cover |
| `recommendMoraleDemoralized` | `-0.5` | Morale below this → use FAR/SAFE cover |
| `recommendOutnumberedCount` | `3` | Enemy count above this → prefer SAFE cover |
| `loopholeFireArc` | `2π/3` | Total angular width of a loophole fire arc (rad) |
| `loopholeMaxPerCover` | `3` | Maximum loopholes generated per cover point |
| `loopholeOffsetDistance` | `16` | Distance from cover center to peek position (px) |

---

## Section: `navigation` — `INavigationConfig`

Consumed by `@alife-sdk/ai/navigation` (`smoothPath`, `SmoothPathFollower`).

| Field | Default | Description |
|-------|:-------:|-------------|
| `smoothPointsPerSegment` | `8` | Catmull-Rom interpolation points per path segment |
| `smoothRandomOffset` | `10` | Max random jitter offset for path smoothing (px) |
| `arrivalThreshold` | `8` | Distance to consider a waypoint reached (px) |
| `dubinsMaxInstantTurn` | `π/4` | Turn angle above which a Dubins arc is inserted (rad, ≈ 45°) |
| `dubinsTurningRadius` | `60` | Turning radius for Dubins arcs (px) |
| `velocityCurveFast` | `1.0` | Velocity multiplier on straight segments |
| `velocityCurveMedium` | `0.7` | Velocity multiplier on moderate turns |
| `velocityCurveSlow` | `0.4` | Velocity multiplier on sharp turns |
| `velocityTransitionRate` | `0.15` | Interpolation rate for velocity transitions per step |
| `restrictedZoneSafeMargin` | `20` | Safety margin around restricted zones (px) |

---

## Section: `weapon` — `IWeaponSelectionConfig`

Consumed by `@alife-sdk/ai/combat` (`selectBestWeapon`, `shouldThrowGrenade`, `shouldUseMedkit`, `createLoadout`).

### Weapon stat defaults (`weapons` map)

| Category | Range (px) | Damage | FireRate | DefaultAmmo |
|----------|:----------:|:------:|:--------:|:-----------:|
| `PISTOL` (0) | 0–250 | 15 | 1.5/s | 15 |
| `SHOTGUN` (1) | 0–150 | 40 | 1.0/s | 8 |
| `RIFLE` (2) | 100–400 | 25 | 2.0/s | 30 |
| `SNIPER` (3) | 300–800 | 60 | 0.5/s | 10 |
| `GRENADE` (4) | 100–400 | 80 | 0.2/s | 1 |
| `MEDKIT` (5) | — | 0 | 0 | 1 |

> **Note:** Replacing `weapons` requires providing all 6 categories — it is not merged field-by-field.
> Because `WeaponCategory` is an open enum, TypeScript will not catch missing built-in categories.
> To add a custom category without losing the defaults, spread first:
> ```ts
> weapon: {
>   weapons: {
>     ...createDefaultAIConfig().weapon.weapons,
>     MY_WEAPON: { category: 'my_weapon', range: { min: 0, max: 200 }, damage: 30, fireRate: 1, defaultAmmo: 20 },
>   },
> }
> ```

### Scoring and grenade thresholds

| Field | Default | Description |
|-------|:-------:|-------------|
| `shotgunEffectiveMax` | `150` | Shotgun effective range ceiling (px) |
| `rifleEffectiveMin` | `100` | Rifle effective range floor (px) |
| `rifleEffectiveMax` | `400` | Rifle effective range ceiling (px) |
| `sniperEffectiveMin` | `300` | Sniper effective range floor (px) |
| `grenadeMinDistance` | `100` | Minimum throw distance (px) |
| `grenadeMaxDistance` | `400` | Maximum throw distance (px) |
| `grenadeMinEnemies` | `2` | Minimum visible enemies to justify a throw |
| `medkitHpThreshold` | `0.5` | HP below which medkit is considered |
| `medkitEmergencyThreshold` | `0.2` | HP below which medkit is used even in combat |

> **Optional — `scoringFactors`:** When omitted (the default), built-in distance-based scoring is used.
> Provide this only to override per-category enemy-count and HP-ratio modifiers.
> See [WeaponSelector.md](../combat/WeaponSelector.md) for details.

---

## Section: `squad` — `ISquadTacticsConfig`

Consumed by `@alife-sdk/ai/squad` (`evaluateSituation`).

| Field | Default | Description |
|-------|:-------:|-------------|
| `outnumberRatio` | `1.5` | Enemy-to-ally ratio above which squad is outnumbered |
| `moralePanickedThreshold` | `-0.7` | Morale value at which NPC is considered panicked |
| `nearbyRadius` | `200` | Distance within which squad members are "nearby" (px) |

---

## Section: `monsterAbility` — `IMonsterAbilityConfig`

Consumed by the host's monster state machine. Pass values to the ability data factories
from `@alife-sdk/ai/combat`:

```ts
import { createLinearChargeData, createLeapData, createChannelAbilityData } from '@alife-sdk/ai/combat';

const c = config.monsterAbility;
const charge  = createLinearChargeData(mx, my, tx, ty, c.chargeWindupMs);
const leap    = createLeapData(mx, my, tx, ty, c.leapWindupMs);
const channel = createChannelAbilityData(tx, ty, c.psiChannelMs);
```

| Field | Default | Description |
|-------|:-------:|-------------|
| `chargeWindupMs` | `600` | Windup duration before charge starts (ms) |
| `chargeDamageMult` | `2.0` | Damage multiplier on charge impact |
| `chargeSpeedMult` | `2.0` | Speed multiplier during charge |
| `stalkApproachDist` | `80` | Distance at which stalk transitions to attack (px) |
| `stalkAlphaInvisible` | `0.08` | Sprite alpha while stalking (≈ invisible) |
| `stalkUncloakDist` | `50` | Distance at which uncloak triggers (px) |
| `leapWindupMs` | `400` | Windup crouch duration before leap (ms) |
| `leapAirtimeMs` | `350` | Airborne lerp duration (ms) |
| `leapDamageMult` | `1.5` | Damage multiplier on leap landing |
| `psiChannelMs` | `2000` | Channel duration before PSI fire (ms) |
| `psiRadius` | `200` | PSI attack effect radius (px) |
| `psiDamagePerTick` | `15` | PSI damage dealt per tick |

---

## Section: `perception` — `IPerceptionConfig`

Consumed by `@alife-sdk/ai/perception`.

| Field | Default | Description |
|-------|:-------:|-------------|
| `visionRange` | `300` | Maximum vision distance (px) |
| `visionHalfAngle` | `π/3` | Vision cone half-angle (rad). Full FOV = 2× this = 120° |
| `hearingRange` | `500` | Maximum hearing range for ambient sounds (px) |
| `weaponSoundRange` | `600` | Gunshot propagation radius (px) |

---

## Section: `goap` — `IGOAPConfig`

Consumed by `@alife-sdk/ai/goap`.

| Field | Default | Description |
|-------|:-------:|-------------|
| `replanIntervalMs` | `5000` | Time between periodic replans (ms) |
| `eliteRankThreshold` | `5` | Threshold the **host** uses to decide whether to activate GOAP for an NPC. The GOAP module itself does not check rank — this is a convenience value for your spawn/init logic. |
| `healHpThreshold` | `0.3` | HP ratio below which healing goal is prioritized |
| `maxPlanDepth` | `10` | Maximum action search depth |
| `dangerMemoryMaxAge` | `5000` | Age after which danger memories are stale (ms) |
