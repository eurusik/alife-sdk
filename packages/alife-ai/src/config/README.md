# config

Central configuration for the 7 core AI subsystems of `@alife-sdk/ai`.

`createDefaultAIConfig()` returns a fully populated `IOnlineAIConfig` with
battle-tested defaults. Pass a partial override object to tune individual values
without touching the rest.

> **Note:** Some classes have their own separate config factories not included here:
> `ConditionBank` → `createDefaultConditionBankConfig()`,
> `CombatTransitionChain` → `createDefaultCombatTransitionConfig()`.
> See the respective module docs for details.

## Modules

| File | Purpose |
|------|---------|
| [createDefaultAIConfig.md](createDefaultAIConfig.md) | Full defaults reference — all 7 sections with every field |

---

## Quick start

```ts
import { createDefaultAIConfig } from '@alife-sdk/ai/config';

// Use production defaults as-is:
const config = createDefaultAIConfig();

// Or tune specific values:
const config = createDefaultAIConfig({
  cover:      { searchRadius: 500 },
  navigation: { arrivalThreshold: 12 },
  weapon:     { shotgunEffectiveMax: 200 },
});
```

Overrides are **per-section and shallow** — only the keys you provide are replaced;
all other values in that section keep their defaults.

---

## Config sections and consumers

| Section | Type | Consumed by |
|---------|------|-------------|
| `config.cover` | `ICoverConfig` | `@alife-sdk/ai/cover` |
| `config.navigation` | `INavigationConfig` | `@alife-sdk/ai/navigation` |
| `config.weapon` | `IWeaponSelectionConfig` | `@alife-sdk/ai/combat` |
| `config.squad` | `ISquadTacticsConfig` | `@alife-sdk/ai/squad` |
| `config.monsterAbility` | `IMonsterAbilityConfig` | Monster state machine (host layer) |
| `config.perception` | `IPerceptionConfig` | `@alife-sdk/ai/perception` |
| `config.goap` | `IGOAPConfig` | `@alife-sdk/ai/goap` |

---

## Typical usage pattern

Create the config once and pass the relevant section to each subsystem:

```ts
import { createDefaultAIConfig } from '@alife-sdk/ai/config';
import { selectBestWeapon } from '@alife-sdk/ai/combat';
import { smoothPath } from '@alife-sdk/ai/navigation';

const config = createDefaultAIConfig();

const weapon = selectBestWeapon(ctx, config.weapon);
const path   = smoothPath(waypoints, config.navigation, rng);
```

See [createDefaultAIConfig.md](createDefaultAIConfig.md) for the complete list of all defaults.
