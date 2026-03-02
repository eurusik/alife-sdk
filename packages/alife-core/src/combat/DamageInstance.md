# DamageInstance

Immutable value object representing a single damage event, plus resistance
utilities from `ImmunityProfile`.

```ts
import { createDamageInstance } from '@alife-sdk/core/combat';
import type { IDamageInstance } from '@alife-sdk/core/combat';

import { createImmunityProfile, applyDamageReduction, getResistance } from '@alife-sdk/core/faction';
import type { ImmunityProfile } from '@alife-sdk/core/faction';
```

---

## `IDamageInstance`

Readonly value object passed through the damage pipeline.

| Field | Type | Description |
|-------|------|-------------|
| `amount` | `number` | Raw damage amount. Always positive. |
| `damageTypeId` | `string` | Identifies the damage type (e.g. `'fire'`, `'radiation'`). |
| `sourceId` | `string` | ID of the entity or object that caused the damage. |
| `sourceType` | `'entity' \| 'anomaly' \| 'surge'` | Category of the damage source. |

---

## `createDamageInstance(params)`

Factory that creates a validated `IDamageInstance`.

```ts
const hit = createDamageInstance({
  amount: 45,
  damageTypeId: 'physical',
  sourceId: 'npc_bandit_03',
  sourceType: 'entity',
});
```

**Throws** `Error` if `amount <= 0`:

```ts
createDamageInstance({ amount: 0, ... });   // throws
createDamageInstance({ amount: -10, ... }); // throws
```

Use this factory — never construct `IDamageInstance` literals directly.
The validation guard ensures invalid damage never reaches the health system.

### `sourceType` values

| Value | When to use |
|-------|-------------|
| `'entity'` | Another NPC, player, or game object fired the shot |
| `'anomaly'` | Damage comes from an anomaly zone (fire, radiation, chemical, PSI field) |
| `'surge'` | Damage is global PSI surge damage |

`sourceType` lets your health system or kill-credit system know *who* to
attribute the damage to without coupling to the entity system.

---

## `ImmunityProfile`

A `ReadonlyMap<string, number>` mapping `damageTypeId → resistance [0, 1]`.

- **0** — no resistance (full damage)
- **1** — full immunity (zero damage)
- Missing entry — treated as 0 (no resistance)

### `createImmunityProfile(entries?)`

```ts
import { createImmunityProfile } from '@alife-sdk/core/faction';

const immunity = createImmunityProfile({
  fire:      0.5,   // takes 50% fire damage
  radiation: 0.8,   // takes 20% radiation damage
  psi:       1.0,   // immune to PSI
});
```

Values are clamped to `[0, 1]` automatically — passing `2.0` becomes `1.0`.

An empty profile (no arguments) means no resistance to anything:

```ts
const noResistance = createImmunityProfile(); // all resistance = 0
```

### `getResistance(profile, damageTypeId)`

```ts
import { getResistance } from '@alife-sdk/core/faction';

const r = getResistance(immunity, 'fire');      // 0.5
const r2 = getResistance(immunity, 'chemical'); // 0 — not in profile
```

### `applyDamageReduction(baseDamage, profile, damageTypeId)`

```ts
import { applyDamageReduction } from '@alife-sdk/core/faction';

const actual = applyDamageReduction(60, immunity, 'fire');
// 60 × (1 - 0.5) = 30
```

Formula: `baseDamage × (1 − resistance)`.
Does not clamp the result — if `baseDamage` is negative for some reason,
the result will also be negative (but `createDamageInstance` prevents
negative amounts from entering the pipeline).

---

## Full damage resolution example

```ts
import { createDamageInstance } from '@alife-sdk/core/combat';
import { createImmunityProfile, applyDamageReduction } from '@alife-sdk/core/faction';

// Defined once per entity archetype
const monolithImmunity = createImmunityProfile({
  psi:       1.0,
  radiation: 0.9,
  physical:  0.2,
});

// Called when an entity takes a hit
function resolveDamage(
  hit: { amount: number; damageTypeId: string; sourceId: string },
  immunity: ImmunityProfile,
): number {
  const event = createDamageInstance({
    amount:       hit.amount,
    damageTypeId: hit.damageTypeId,
    sourceId:     hit.sourceId,
    sourceType:   'entity',
  });

  return applyDamageReduction(event.amount, immunity, event.damageTypeId);
}

const damage = resolveDamage({ amount: 100, damageTypeId: 'psi', sourceId: 'controller_01' }, monolithImmunity);
// 100 × (1 - 1.0) = 0  — Monolith is immune to PSI

const damage2 = resolveDamage({ amount: 100, damageTypeId: 'physical', sourceId: 'bandit_05' }, monolithImmunity);
// 100 × (1 - 0.2) = 80
```

---

## Tips

**Define damage type IDs once.** Since `damageTypeId` is a plain string, create
a constants object in your game and import it everywhere to avoid typos:

```ts
export const DamageTypes = {
  PHYSICAL: 'physical', FIRE: 'fire', RADIATION: 'radiation',
  CHEMICAL: 'chemical', PSI: 'psi',
} as const;
```

**One profile per archetype, not per instance.** `ImmunityProfile` is a
`ReadonlyMap` — it's safe to share across all NPCs of the same faction/type.
No need to create a new profile per NPC.

```ts
// Created once
const BANDIT_IMMUNITY = createImmunityProfile({ physical: 0.1 });

// Shared by all bandits
const npc1 = new BanditNPC(BANDIT_IMMUNITY);
const npc2 = new BanditNPC(BANDIT_IMMUNITY);
```
