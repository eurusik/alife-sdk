# WeaponSelector

Pure-function tactical weapon decision-making.
No side effects, no framework dependencies.

**Source:** [WeaponSelector.ts](WeaponSelector.ts)

---

## Overview

Three functions that all accept the **same `IWeaponContext`** object — build it once per tick,
pass it to all three:

```ts
import { selectBestWeapon, shouldThrowGrenade, shouldUseMedkit } from '@alife-sdk/ai/combat';
import { createDefaultAIConfig } from '@alife-sdk/ai/config';

const weaponConfig = createDefaultAIConfig().weapon;  // IWeaponSelectionConfig

const ctx = {
  loadout:         npc.loadout,        // INPCLoadout — see structure below
  distanceToEnemy: npc.distToEnemy,
  enemyCount:      npc.visibleEnemies,
  hpRatio:         npc.hp / npc.maxHp,
  inCombat:        true,
};

const weapon  = selectBestWeapon(ctx, weaponConfig);   // IWeaponSlot | null
const grenade = shouldThrowGrenade(ctx, weaponConfig); // boolean
const medkit  = shouldUseMedkit(ctx, weaponConfig);    // boolean
```

---

## API reference

### `INPCLoadout` + `IWeaponSlot`

The loadout structure held by every armed NPC:

```ts
interface INPCLoadout {
  primary:   IWeaponSlot | null;  // main weapon; null = unarmed
  secondary: IWeaponSlot | null;  // sidearm; null = none
  grenades:  number;
  medkits:   number;
}

interface IWeaponSlot {
  readonly category: WeaponCategory;
  ammo:              number;         // mutable — decremented as NPC fires
  readonly maxAmmo:  number;
  readonly range:    IWeaponRange;
  readonly damage:   number;
  readonly fireRate: number;
}
```

Build a loadout with `LoadoutBuilder` or `createLoadout()` — see [LoadoutBuilder.md](LoadoutBuilder.md).
`ammo` is the only mutable field; decrement it in your firing logic.

---

### `IWeaponContext`

Input snapshot for all three functions:

```ts
interface IWeaponContext {
  readonly loadout:         INPCLoadout;
  readonly distanceToEnemy: number;   // pixels
  readonly enemyCount:      number;   // visible enemies
  readonly hpRatio:         number;   // [0, 1]
  readonly inCombat?:       boolean;  // affects medkit usage; defaults to false
}
```

---

### `selectBestWeapon(ctx, config): IWeaponSlot | null`

Selects the highest-scoring weapon from the NPC's loadout.

**Returns `null`** when the NPC has no ammo at all — signal to flee or retreat.
**Primary wins ties** (evaluated first, secondary must strictly beat it).
Single-pass, zero allocation.

**Scoring formula:** `distanceScore × enemyCountModifier × hpRatioModifier`

#### Distance scoring

| Weapon | Optimal range | Notes |
|--------|:-------------:|-------|
| PISTOL | any | flat 0.4 (always available fallback) |
| SHOTGUN | `< shotgunEffectiveMax × 0.66` | drops to 0 beyond `1.33×` |
| RIFLE | `[rifleEffectiveMin, rifleEffectiveMax]` | partial score outside range |
| SNIPER | `≥ sniperEffectiveMin` | penalty at close range |

#### Enemy count modifiers (default, activates at 3+ enemies)

| Weapon | Modifier |
|--------|:--------:|
| SHOTGUN | 1.5× |
| RIFLE | 1.3× |
| SNIPER | 0.6× |
| PISTOL | 1.0× |

#### HP ratio modifiers (default)

| Condition | Weapon | Modifier |
|-----------|--------|:--------:|
| HP < 30% | SNIPER | 1.3× |
| HP < 30% | RIFLE | 1.2× |
| HP < 30% | SHOTGUN | 0.7× |
| HP > 70% | SHOTGUN | 1.2× |
| HP > 70% | PISTOL | 1.1× |
| HP > 70% | SNIPER | 0.9× |

```ts
// Rifle at mid range, single enemy, healthy HP:
selectBestWeapon({ loadout, distanceToEnemy: 250, enemyCount: 1, hpRatio: 0.8 }, config);
// → rifle slot

// No ammo left:
selectBestWeapon({ loadout: { primary: null, secondary: null, grenades: 0, medkits: 0 }, ... }, config);
// → null  (NPC should flee)
```

#### Custom scoring factors

Override per-weapon modifiers without changing the scoring formula:

```ts
const customConfig = {
  ...config.weapon,
  scoringFactors: {
    [String(WeaponCategory.SHOTGUN)]: {
      baseEffectiveness: 1.0,
      multiEnemyModifier: 0.1,   // penalize shotgun in crowds (was 1.5)
      lowHpModifier:      1.0,
      highHpModifier:     1.0,
    },
  },
};

selectBestWeapon(ctx, customConfig);
// Shotgun now penalized at 3+ enemies — pistol may win at close range
```

Only the categories present in `scoringFactors` are overridden; others use built-in defaults.

---

### `shouldThrowGrenade(ctx, config): boolean`

Returns `true` when **all three conditions** are met:

1. `loadout.grenades > 0`
2. `enemyCount >= config.grenadeMinEnemies`
3. `distanceToEnemy` is in `[config.grenadeMinDistance, config.grenadeMaxDistance]`

```ts
// grenadeMinEnemies=2, grenadeMinDistance=80, grenadeMaxDistance=250 (defaults)
shouldThrowGrenade({ loadout: { grenades: 1, ... }, enemyCount: 2, distanceToEnemy: 150 }, config);
// → true

shouldThrowGrenade({ ..., enemyCount: 1 }, config);  // only 1 enemy → false
shouldThrowGrenade({ ..., distanceToEnemy: 50 }, config);  // too close → false
shouldThrowGrenade({ ..., distanceToEnemy: 500 }, config); // too far → false
```

---

### `shouldUseMedkit(ctx, config): boolean`

Returns `true` when the NPC should heal. Rules in priority order:

1. `loadout.medkits <= 0` → **false** (no medkits)
2. `hpRatio >= config.medkitHpThreshold` → **false** (HP is fine)
3. `hpRatio < config.medkitEmergencyThreshold` → **true** (critical — use even in combat)
4. `!inCombat` → **true** (low HP and safe to heal)
5. Otherwise → **false**

```ts
// Low HP, not in combat → heal
shouldUseMedkit({ ..., hpRatio: 0.3, inCombat: false }, config);  // → true

// Critical HP, even in combat → heal immediately
shouldUseMedkit({ ..., hpRatio: 0.15, inCombat: true }, config);  // → true

// Low HP but still fighting (non-emergency) → wait
shouldUseMedkit({ ..., hpRatio: 0.25, inCombat: true }, config);  // → false
```

---

## Performance notes

- **Single-pass, zero allocation** — `selectBestWeapon` iterates at most 2 weapon slots with no
  intermediate arrays or object creation.
- **Shared context** — all three functions read from the same `IWeaponContext`; no need to
  reconstruct separate inputs per function.
