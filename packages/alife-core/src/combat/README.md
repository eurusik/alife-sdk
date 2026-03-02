# combat

Damage events and NPC morale for `@alife-sdk/core`.

```ts
import {
  createDamageInstance,
  MoraleTracker,
  MoraleState,
} from '@alife-sdk/core/combat';
import type {
  IDamageInstance,
  IDamageInstanceParams,
  IMoraleConfig,
} from '@alife-sdk/core/combat';

// Damage resistance lives in the faction module
import {
  createImmunityProfile,
  applyDamageReduction,
  getResistance,
} from '@alife-sdk/core/faction';
import type { ImmunityProfile } from '@alife-sdk/core/faction';
```

---

## What the SDK gives you

| Component | What it does |
|-----------|--------------|
| `createDamageInstance()` | Factory for a validated, immutable damage event value object |
| `ImmunityProfile` | Per-entity resistance map: damage type → factor `[0, 1]` |
| `applyDamageReduction()` | Apply resistance: `baseDamage × (1 − resistance)` |
| `MoraleTracker` | 3-state morale machine (STABLE / SHAKEN / PANICKED) with recovery |

---

## Damage pipeline

The full lifecycle of a hit:

```
1. createDamageInstance()   — build the event (amount, type, source)
         │
         ▼
2. applyDamageReduction()   — reduce by target's resistance (ImmunityProfile)
         │
         ▼
3. entity.applyDamage()     — subtract HP (your health system)
         │
         ▼
4. morale.adjust(-0.15)     — update morale on hit
         │
         ▼
5. morale.state             — STABLE / SHAKEN / PANICKED → drives FSM
```

### Quick example

```ts
import { createDamageInstance } from '@alife-sdk/core/combat';
import { createImmunityProfile, applyDamageReduction } from '@alife-sdk/core/faction';
import { MoraleTracker, MoraleState } from '@alife-sdk/core/combat';

// Entity setup
const immunity = createImmunityProfile({
  fire:      0.5,  // 50% fire resistance
  radiation: 0.8,  // 80% radiation resistance
});

const morale = new MoraleTracker();

// Incoming hit
const hit = createDamageInstance({
  amount: 60,
  damageTypeId: 'fire',
  sourceId: 'molotov_01',
  sourceType: 'anomaly',
});

// Apply resistance
const actualDamage = applyDamageReduction(hit.amount, immunity, hit.damageTypeId);
// 60 × (1 - 0.5) = 30

// Apply to health (your system)
entity.hp -= actualDamage;

// React to being hit
morale.adjust(-0.15);

// Check morale state
if (morale.state === MoraleState.PANICKED) {
  npc.fsm.transition('FLEE');
} else if (morale.state === MoraleState.SHAKEN) {
  npc.fsm.transition('RETREAT');
}
```

---

## Components

| File | Purpose |
|------|---------|
| [DamageInstance.md](DamageInstance.md) | `createDamageInstance` + `ImmunityProfile` — building and resolving damage events |
| [MoraleStateMachine.md](MoraleStateMachine.md) | `MoraleTracker` — STABLE / SHAKEN / PANICKED with configurable thresholds and recovery |

---

## Damage type IDs

`damageTypeId` is a plain string — the SDK ships no built-in types.
Define your own in one place and reuse them everywhere:

```ts
// your-game/src/constants/DamageTypes.ts
export const DamageTypes = {
  PHYSICAL:  'physical',
  FIRE:      'fire',
  RADIATION: 'radiation',
  CHEMICAL:  'chemical',
  PSI:       'psi',
} as const;
```

Then build faction immunity profiles against the same IDs:

```ts
import { DamageTypes } from '../constants/DamageTypes';

const militaryImmunity = createImmunityProfile({
  [DamageTypes.PHYSICAL]: 0.3,
});

const scientistImmunity = createImmunityProfile({
  [DamageTypes.RADIATION]: 0.7,
  [DamageTypes.CHEMICAL]:  0.5,
});
```
