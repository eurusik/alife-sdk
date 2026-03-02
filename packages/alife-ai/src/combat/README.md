# combat

Pure-function NPC combat decision layer for `@alife-sdk/ai`.

Covers four concerns: **loadout construction**, **tactical weapon selection**,
**combat state transitions**, and **monster ability logic**.
No framework dependencies — all inputs are plain data objects.

## Modules


| File                                                 | Purpose                                                                 |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| [LoadoutBuilder.md](LoadoutBuilder.md)               | Fluent builder + rank-based `createLoadout()` factory                   |
| [WeaponSelector.md](WeaponSelector.md)               | `selectBestWeapon`, `shouldThrowGrenade`, `shouldUseMedkit`             |
| [CombatTransitionChain.md](CombatTransitionChain.md) | Chain-of-Responsibility rules → combat state transitions                |
| [MonsterAbilityData.md](MonsterAbilityData.md)       | Monster ability phase data, `selectMonsterAbility`, `shouldMonsterFlee` |


## Quick example — full NPC combat tick

```ts
import { createDefaultAIConfig } from '@alife-sdk/ai/config';
import { createLoadout, FactionWeaponPreference } from '@alife-sdk/ai/combat';
import { selectBestWeapon, shouldThrowGrenade, shouldUseMedkit } from '@alife-sdk/ai/combat';
import { evaluateTransitions, DEFAULT_COMBAT_RULES, createDefaultCombatTransitionConfig } from '@alife-sdk/ai/combat';

// Get config once (singleton or per-scene):
const weaponConfig  = createDefaultAIConfig().weapon;
const transitionCfg = createDefaultCombatTransitionConfig();

// On NPC spawn — create rank-appropriate loadout:
const loadout = createLoadout(npc.rank, FactionWeaponPreference.rifle, weaponConfig);

// Each combat tick — decide weapon + consumables:
const ctx = {
  loadout,
  distanceToEnemy: npc.distToEnemy,
  enemyCount:      npc.visibleEnemies,
  hpRatio:         npc.hp / npc.maxHp,
  inCombat:        true,
};

const weapon   = selectBestWeapon(ctx, weaponConfig);   // IWeaponSlot | null
const grenade  = shouldThrowGrenade(ctx, weaponConfig); // boolean
const medkit   = shouldUseMedkit(ctx, weaponConfig);    // boolean

// Decide whether to change combat state:
const combatCtx = { ...npc.combatSnapshot };
const nextState = evaluateTransitions(DEFAULT_COMBAT_RULES, combatCtx, transitionCfg);
if (nextState) npc.stateMachine.transition(nextState);
```

## Data flow

```
rank + faction
      │
      ▼
  createLoadout() / LoadoutBuilder
  → INPCLoadout { primary, secondary, grenades, medkits }
      │
      ▼
  IWeaponContext
  ┌──────────────────────────────────┐
  │ selectBestWeapon()   → slot|null │
  │ shouldThrowGrenade() → boolean   │
  │ shouldUseMedkit()    → boolean   │
  └──────────────────────────────────┘

  ICombatContext
  ┌──────────────────────────────────────┐
  │ evaluateTransitions()                │
  │   WoundedRule     → WOUNDED          │
  │   NoAmmoRule      → RETREAT          │
  │   EvadeDangerRule → EVADE_GRENADE    │
  │   MoraleRule      → FLEE / RETREAT   │
  │   GrenadeRule     → GRENADE          │
  │   SearchRule      → SEARCH           │
  └──────────────────────────────────────┘
  → string state key | null

  IMonsterAbilityContext
  ┌──────────────────────────────────┐
  │ selectMonsterAbility() → id|null │
  │ shouldMonsterFlee()    → boolean │
  └──────────────────────────────────┘
```

## Design notes

- **No side effects** — every function is a pure transformation: same input → same output.
- **Extensible** — custom `recipes` for loadouts, custom `scoringFactors` for weapon scoring,
custom `rules` for transition chain, custom `abilityRules` for monsters. All via optional params.
- **Shared context** — one `IWeaponContext` object is accepted by all three weapon functions
(`selectBestWeapon`, `shouldThrowGrenade`, `shouldUseMedkit`) — build it once per tick.

