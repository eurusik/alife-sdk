# LoadoutBuilder

Fluent builder and rank-based factory for NPC weapon loadouts.

**Source:** [LoadoutBuilder.ts](LoadoutBuilder.ts)

---

## Overview

Two ways to create an `INPCLoadout`:

1. **`LoadoutBuilder`** — fluent API for manual construction (scripted quests, bosses, tests).
2. **`createLoadout(rank, faction, config)`** — automatic rank-based generation for spawned NPCs.

Both resolve weapon stats (ammo, range, damage, fireRate) from `IWeaponSelectionConfig`
so the loadout is always consistent with tuning config.

---

## Configuration

Both `LoadoutBuilder` and `createLoadout` require an `IWeaponSelectionConfig` object.
Get one from `createDefaultAIConfig()`:

```ts
import { createDefaultAIConfig } from '@alife-sdk/ai/config';

const weaponConfig = createDefaultAIConfig().weapon;
// weaponConfig.weapons[WeaponCategory.RIFLE] → { defaultAmmo, range, damage, fireRate }
```

You can override specific values:

```ts
const weaponConfig = createDefaultAIConfig({
  weapon: { shotgunEffectiveMax: 120 },
}).weapon;
```

---

## API reference

### `LoadoutBuilder`

Fluent builder. Each method returns `this` for chaining. Call `.build()` to get the final `INPCLoadout`.

```ts
import { LoadoutBuilder } from '@alife-sdk/ai/combat';
import { WeaponCategory } from '@alife-sdk/ai/types';
import { createDefaultAIConfig } from '@alife-sdk/ai/config';

const weaponConfig = createDefaultAIConfig().weapon;

const loadout = new LoadoutBuilder(config.weapon)
  .withPrimary(WeaponCategory.RIFLE)
  .withSecondary(WeaponCategory.PISTOL)
  .withGrenades(2)
  .withMedkits(1)
  .build();

// loadout.primary.category  === WeaponCategory.RIFLE
// loadout.primary.ammo      === config.weapon.weapons[RIFLE].defaultAmmo
// loadout.grenades          === 2
```

#### Methods

| Method | Description |
|--------|-------------|
| `withPrimary(category, ammo?)` | Set primary weapon. `ammo` defaults to `config.weapons[category].defaultAmmo`. |
| `withSecondary(category, ammo?)` | Set secondary weapon. |
| `withGrenades(count)` | Set grenade count. Clamped to `≥ 0`. |
| `withMedkits(count)` | Set medkit count. Clamped to `≥ 0`. |
| `build()` | Returns `INPCLoadout`. Unset slots default to `null`. |

**Custom ammo:**

```ts
const loadout = new LoadoutBuilder(config.weapon)
  .withPrimary(WeaponCategory.RIFLE, 5)   // 5 rounds instead of default
  .build();
```

**Throws** if the weapon category is not registered in `config.weapons`:

```
[LoadoutBuilder] Unknown weapon category: 99. Register it in IWeaponSelectionConfig.weapons.
```

---

### `createLoadout(rank, factionPreference, config, recipes?)`

Creates a rank-appropriate loadout automatically.
`factionPreference` influences weapon choice at mid ranks (3–4) where multiple options are viable.

```ts
import { createLoadout, FactionWeaponPreference } from '@alife-sdk/ai/combat';

const loadout = createLoadout(3, FactionWeaponPreference.rifle, config.weapon);
```

#### Default rank table

| Rank | Primary | Secondary | Grenades | Medkits | Notes |
|------|---------|-----------|:--------:|:-------:|-------|
| 1 | PISTOL | — | 0 | 0 | rookie |
| 2 | PISTOL | — | 0 | 1 | |
| 3 | *faction* | PISTOL | 0 | 1 | sniper preference → rifle |
| 4 | *faction* | PISTOL | 1 | 2 | sniper preference → rifle |
| 5 | RIFLE | SHOTGUN | 1 | 2 | |
| 6 | RIFLE | SHOTGUN | 2 | 2 | sniper faction → SNIPER primary |
| 7+ | SNIPER | RIFLE | min(rank-4, 3) | 3 | elite |

> **Note:** At ranks 3–4, `FactionWeaponPreference.sniper` falls back to `rifle` — snipers are
> too advanced for rookies.

**`FactionWeaponPreference` values:**

`FactionWeaponPreference` is a named alias — its values **are** `WeaponCategory` numeric constants.
You can pass either interchangeably:

```ts
// These are identical — both equal WeaponCategory.RIFLE (= 2):
createLoadout(3, FactionWeaponPreference.rifle,  config);
createLoadout(3, WeaponCategory.RIFLE,           config);

// Named constants are more readable for faction-level tuning:
FactionWeaponPreference.rifle   // 2  (WeaponCategory.RIFLE)
FactionWeaponPreference.shotgun // 1  (WeaponCategory.SHOTGUN)
FactionWeaponPreference.pistol  // 0  (WeaponCategory.PISTOL)
FactionWeaponPreference.sniper  // 3  (WeaponCategory.SNIPER)
```

---

### `ILoadoutRecipe` + `DEFAULT_LOADOUT_RECIPES`

A recipe describes a complete loadout for a given rank, used with custom `recipes` parameter.

```ts
interface ILoadoutRecipe {
  readonly primary: WeaponCategory;
  readonly secondary?: WeaponCategory | null;
  readonly grenades: number;
  readonly medkits: number;
  readonly useFactionPreference?: boolean; // if true, primary resolves via faction preference
}
```

`DEFAULT_LOADOUT_RECIPES` contains the built-in recipes for ranks 1–6 (exported for inspection or merging).

---

### Custom recipes

Pass a custom `recipes` map to override rank-based loadouts without forking the function.

**Lookup behaviour:** exact rank match → highest rank key `<= current rank` → built-in default logic.

```ts
import { createLoadout } from '@alife-sdk/ai/combat';
import { WeaponCategory } from '@alife-sdk/ai/types';

const myRecipes = {
  1: { primary: WeaponCategory.SHOTGUN, grenades: 1, medkits: 1 },
  3: { primary: WeaponCategory.SNIPER, secondary: WeaponCategory.RIFLE, grenades: 2, medkits: 3 },
};

createLoadout(1, faction, config, myRecipes);  // SHOTGUN primary
createLoadout(2, faction, config, myRecipes);  // rank 2 not in map → uses rank 1 recipe → SHOTGUN
createLoadout(5, faction, config, myRecipes);  // rank 5 not in map → uses rank 3 recipe → SNIPER
createLoadout(1, faction, config, undefined);  // no recipes → built-in default → PISTOL
```

**With faction preference in recipe:**

```ts
const factionRecipes = {
  1: { primary: WeaponCategory.PISTOL, grenades: 0, medkits: 0, useFactionPreference: true },
};

// shotgun faction → primary becomes SHOTGUN (via resolveMidRankPrimary)
createLoadout(1, FactionWeaponPreference.shotgun, config, factionRecipes);
```

**Extending defaults:**

```ts
import { DEFAULT_LOADOUT_RECIPES } from '@alife-sdk/ai/combat';

const extendedRecipes = {
  ...DEFAULT_LOADOUT_RECIPES,
  8: { primary: WeaponCategory.SNIPER, secondary: WeaponCategory.RIFLE, grenades: 3, medkits: 3 },
};
```
