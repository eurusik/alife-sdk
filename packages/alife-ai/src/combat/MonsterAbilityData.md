# MonsterAbilityData

Monster ability phase state, activation logic, and flee detection.

**Source:** [MonsterAbilityData.ts](MonsterAbilityData.ts)

---

## Overview

This module provides two things:

1. **Phase data factories** — mutable state objects consumed by the host's state machine
   while an ability animation is playing (`windup → charging → impact`, etc.).
2. **Decision functions** — `selectMonsterAbility()` to choose which ability triggers,
   and `shouldMonsterFlee()` for the universal flee condition.

---

## API reference

### `MonsterAbility`

String constants for the four built-in ability IDs (reference defaults for S.T.A.L.K.E.R.-style games).
The type is open (`string & {}`), so you can define custom ability IDs without this enum.

```ts
MonsterAbility.CHARGE     // 'charge'
MonsterAbility.STALK      // 'stalk'
MonsterAbility.LEAP       // 'leap'
MonsterAbility.PSI_ATTACK // 'psi_attack'
```

---

### Phase data factories

Each factory creates the **initial state** for one ability execution pattern.
The host state machine mutates `phase` and `timer` each tick.

#### `createLinearChargeData` — windup → charge toward target → impact

```ts
import { createLinearChargeData } from '@alife-sdk/ai/combat';

const charge = createLinearChargeData(
  monster.x, monster.y,   // start position
  target.x,  target.y,    // target position
  600,                     // windupMs
);
// charge.phase === 'windup'
// charge.timer === 600

// Host state machine tick:
// 'windup'   → count down timer → transition to 'charging'
// 'charging' → lerp toward target → on arrival: 'impact'
// 'impact'   → deal damage, end ability
```

**`ILinearChargeData` fields:**

```ts
interface ILinearChargeData {
  phase:   'windup' | 'charging' | 'impact';
  timer:   number;   // ms remaining in current phase
  startX:  number;
  startY:  number;
  targetX: number;
  targetY: number;
}
```

---

#### `createApproachData` — move invisibly toward target → uncloak

```ts
import { createApproachData } from '@alife-sdk/ai/combat';

const approach = createApproachData(target.x, target.y);
// approach.phase === 'approach'

// Host state machine tick:
// 'approach' → move with reduced visibility toward target
// on close enough → transition to 'uncloak' → normal attack
```

**`IApproachData` fields:**

```ts
interface IApproachData {
  phase:   'approach' | 'uncloak';
  targetX: number;
  targetY: number;
}
```

---

#### `createLeapData` — windup → airborne arc → land

```ts
import { createLeapData } from '@alife-sdk/ai/combat';

const leap = createLeapData(
  monster.x, monster.y,
  target.x,  target.y,
  400,   // windupMs
);
// leap.phase === 'windup'

// Host state machine tick:
// 'windup'   → 400ms crouch animation
// 'airborne' → lerp start→target in ~350ms
// 'land'     → deal damage on arrival
```

**`ILeapData` fields:**

```ts
interface ILeapData {
  phase:   'windup' | 'airborne' | 'land';
  timer:   number;
  startX:  number;
  startY:  number;
  targetX: number;
  targetY: number;
}
```

---

#### `createChannelAbilityData` — channel for a duration → fire/release

```ts
import { createChannelAbilityData } from '@alife-sdk/ai/combat';

const channel = createChannelAbilityData(target.x, target.y, 2000);  // channelMs
// channel.phase === 'channel'

// Host state machine tick:
// 'channel' → 2000ms beam/cast animation
// 'fire'    → apply ability effect to target
```

**`IChannelAbilityData` fields:**

```ts
interface IChannelAbilityData {
  phase:   'channel' | 'fire';
  timer:   number;
  targetX: number;
  targetY: number;
}
```

---

### `selectMonsterAbility(ctx, rules?): string | null`

Determines which ability a monster should use, if any.

**Returns `null`** if:
- Melee cooldown has not expired (`meleeCooldownRemaining > 0`)
- No rule matches for the monster type
- Monster type is unknown

```ts
import { selectMonsterAbility, MonsterAbility } from '@alife-sdk/ai/combat';

const ctx = {
  monsterType:            'boar',
  distanceToEnemy:        100,
  attackRange:            40,
  meleeCooldownRemaining: 0,
  hpRatio:                0.8,
  moraleValue:            0,
};

selectMonsterAbility(ctx);               // 'charge'  (distance > attackRange)
selectMonsterAbility({ ...ctx, distanceToEnemy: 30 }); // null  (in melee range)
```

#### `IMonsterAbilityContext`

```ts
interface IMonsterAbilityContext {
  readonly monsterType:            string;
  readonly distanceToEnemy:        number;  // px
  readonly attackRange:            number;  // px
  readonly meleeCooldownRemaining: number;  // ms (0 = ready)
  readonly hpRatio:                number;  // [0, 1]
  readonly moraleValue:            number;  // [-1, 1]
}
```

#### Built-in rules (`DEFAULT_ABILITY_RULES`)

These are game-specific reference defaults — feel free to replace them entirely with your own rules.

| Monster | Ability | Condition |
|---------|---------|-----------|
| `boar` | `charge` | `distance > attackRange` |
| `bloodsucker` | `stalk` | `distance > attackRange × 2` |
| `snork` | `leap` | `distance > attackRange` AND `distance <= attackRange × 3` |
| `controller` | `psi_attack` | `distance > attackRange` |
| `dog` | — | no special ability |

#### Custom ability rules

Add new monster types or override built-in ones without forking:

```ts
import { selectMonsterAbility } from '@alife-sdk/ai/combat';
import type { IMonsterAbilityRule } from '@alife-sdk/ai/combat';

const customRules = {
  chimera: [
    {
      abilityId: 'teleport',
      shouldTrigger: (ctx) => ctx.distanceToEnemy > ctx.attackRange * 5,
    },
    {
      abilityId: 'claw_swipe',
      shouldTrigger: (ctx) => ctx.distanceToEnemy > ctx.attackRange,
    },
  ],
};

// Rules evaluated in array order — first match wins:
selectMonsterAbility({ monsterType: 'chimera', distanceToEnemy: 300, attackRange: 40, ... }, customRules);
// → 'teleport'

selectMonsterAbility({ monsterType: 'chimera', distanceToEnemy: 80, attackRange: 40, ... }, customRules);
// → 'claw_swipe'
```

> **Important:** `meleeCooldownRemaining > 0` always blocks custom rules too — the guard runs
> before any rule evaluation.

---

### `shouldMonsterFlee(hpRatio, moraleValue, config?): boolean`

Universal flee check — same logic across all monster types.
Returns `true` only when **both** conditions are met:
- `hpRatio < config.hpThreshold` (default `0.2`)
- `moraleValue < config.moraleThreshold` (default `-0.3`)

```ts
import { shouldMonsterFlee } from '@alife-sdk/ai/combat';

shouldMonsterFlee(0.15, -0.5);  // → true  (low HP + bad morale)
shouldMonsterFlee(0.5,  -0.5);  // → false (HP is fine)
shouldMonsterFlee(0.15,  0.0);  // → false (morale is fine)
shouldMonsterFlee(0.2,  -0.3);  // → false (exact thresholds don't trigger)
```

**Custom thresholds:**

```ts
import { shouldMonsterFlee, DEFAULT_MONSTER_FLEE_CONFIG } from '@alife-sdk/ai/combat';

shouldMonsterFlee(0.25, -0.4, { hpThreshold: 0.3, moraleThreshold: -0.2 });
// → true (0.25 < 0.3 AND -0.4 < -0.2)
```
