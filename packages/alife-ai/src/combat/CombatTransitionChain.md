# CombatTransitionChain

Chain-of-Responsibility pattern for NPC combat state transitions.
Each rule is a pure, stateless function evaluated in priority order.

**Source:** [CombatTransitionChain.ts](CombatTransitionChain.ts)

---

## Overview

`evaluateTransitions()` runs through a list of `ITransitionRule` objects in order.
The first rule that returns a non-null state string wins. If no rule triggers, returns `null`
(NPC stays in COMBAT).

```ts
import {
  evaluateTransitions,
  DEFAULT_COMBAT_RULES,
  createDefaultCombatTransitionConfig,
} from '@alife-sdk/ai/combat';

const cfg = createDefaultCombatTransitionConfig();

// Each combat tick:
const nextState = evaluateTransitions(DEFAULT_COMBAT_RULES, combatCtx, cfg);
if (nextState) stateMachine.transition(nextState);
```

---

## API reference

### `ICombatContext`

Snapshot of NPC combat state — framework-agnostic plain data object.
Build one per tick from your entity state.

```ts
interface ICombatContext {
  readonly hpRatio:              number;   // [0, 1]
  readonly moraleValue:          number;   // [-1, 1]
  readonly isPanicked:           boolean;
  readonly lostSightMs:          number;   // ms since last visual contact
  readonly distanceToEnemy:      number;   // px to nearest known enemy
  readonly visibleEnemyCount:    number;
  readonly loadout:              INPCLoadout;
  readonly canSwitchTarget:      boolean;  // false = inertia-locked
  readonly timeSinceWoundedMs:   number;   // Infinity if never wounded
  readonly hasExplosiveDanger:   boolean;
  readonly hasAmmo:              boolean;
}
```

---

### `ICombatTransitionConfig`

Threshold configuration. Create with `createDefaultCombatTransitionConfig(overrides?)`:

```ts
import { createDefaultCombatTransitionConfig } from '@alife-sdk/ai/combat';

const cfg = createDefaultCombatTransitionConfig();                 // all defaults
const cfg = createDefaultCombatTransitionConfig({ woundedHpThreshold: 0.3 }); // override one
```

| Field | Default | Description |
|-------|:-------:|-------------|
| `woundedHpThreshold` | `0.2` | HP below which → WOUNDED |
| `woundedReentryCooldownMs` | `10000` | Min ms before re-entering WOUNDED |
| `retreatMoraleThreshold` | `-0.3` | Morale below which → RETREAT |
| `grenadeLostSightMs` | `2000` | Lost sight ≥ this → consider grenade |
| `lostSightThresholdMs` | `3000` | Lost sight ≥ this → SEARCH |
| `grenadeMinEnemies` | `2` | Min visible enemies for grenade |
| `grenadeMinDistance` | `80` | Min px for grenade throw |
| `grenadeMaxDistance` | `250` | Max px for grenade throw |

---

### Built-in rules

Six rules in `DEFAULT_COMBAT_RULES`, evaluated in priority order:

| Priority | Rule | Triggers | Output |
|:--------:|------|----------|--------|
| 1 | `WoundedRule` | `hpRatio < threshold` AND cooldown expired | `'WOUNDED'` |
| 2 | `NoAmmoRule` | `!hasAmmo` | `'RETREAT'` |
| 3 | `EvadeDangerRule` | `hasExplosiveDanger` | `'EVADE_GRENADE'` |
| 4 | `MoraleRule` | `isPanicked` → FLEE; `moraleValue < threshold` + `canSwitchTarget` → RETREAT | `'FLEE'` / `'RETREAT'` |
| 5 | `GrenadeOpportunityRule` | Lost sight window + grenades + enemy count + range | `'GRENADE'` |
| 6 | `SearchRule` | `lostSightMs >= lostSightThresholdMs` | `'SEARCH'` |

**Priority matters:** WOUNDED (1) always beats FLEE (4) even if the NPC is panicked.

```ts
// NPC: 10% HP, panicked, has explosive danger nearby
evaluateTransitions(DEFAULT_COMBAT_RULES, {
  hpRatio: 0.1, isPanicked: true, hasExplosiveDanger: true, timeSinceWoundedMs: Infinity, ...
}, cfg);
// → 'WOUNDED'  (priority 1 wins over FLEE and EVADE_GRENADE)
```

#### `WoundedRule` — re-entry cooldown

Once wounded, the NPC can't re-enter WOUNDED for `woundedReentryCooldownMs` (default 10s).
Track `timeSinceWoundedMs` in your entity: start at `Infinity`, reset to `0` on exiting WOUNDED,
increment each tick.

```ts
// hpRatio=0.15 but wounded 5s ago — rule passes (cooldown not expired):
WoundedRule.evaluate({ hpRatio: 0.15, timeSinceWoundedMs: 5000, ... }, cfg);
// → null

// hpRatio=0.15, never been wounded:
WoundedRule.evaluate({ hpRatio: 0.15, timeSinceWoundedMs: Infinity, ... }, cfg);
// → 'WOUNDED'
```

#### `GrenadeOpportunityRule` — timing window

Triggers only in a **time window** between `grenadeLostSightMs` and `lostSightThresholdMs`:

```
  0ms ─── still tracking enemy ─── 2s ─── grenade window ─── 3s ─── SEARCH
                                           ↑ throws grenade
```

---

### `evaluateTransitions(rules, context, config): string | null`

Runs all rules in order, returns first non-null result.

```ts
evaluateTransitions(DEFAULT_COMBAT_RULES, ctx, cfg);  // → 'WOUNDED' | 'FLEE' | null | ...
```

---

## Custom rules

### Add a rule to the chain

```ts
import {
  DEFAULT_COMBAT_RULES,
  evaluateTransitions,
  createDefaultCombatTransitionConfig,
} from '@alife-sdk/ai/combat';
import type { ITransitionRule, ICombatContext, ICombatTransitionConfig } from '@alife-sdk/ai/combat';

const TakeCoverRule: ITransitionRule = {
  name:     'takeCover',
  priority: 3.5,   // between EvadeDangerRule(3) and MoraleRule(4)
  evaluate(ctx: ICombatContext): string | null {
    // Take cover when outnumbered 3:1 and not already retreating
    return ctx.visibleEnemyCount >= 3 && ctx.hpRatio > 0.5 ? 'TAKE_COVER' : null;
  },
};

const myRules = [TakeCoverRule, ...DEFAULT_COMBAT_RULES]
  .sort((a, b) => a.priority - b.priority);

evaluateTransitions(myRules, ctx, cfg);
```

### Replace the entire chain

```ts
const minimalistRules: ITransitionRule[] = [
  { name: 'flee', priority: 1, evaluate: (ctx) => ctx.hpRatio < 0.2 ? 'FLEE' : null },
  { name: 'search', priority: 2, evaluate: (ctx) => ctx.lostSightMs > 2000 ? 'SEARCH' : null },
];

evaluateTransitions(minimalistRules, ctx, cfg);
```

### Override config thresholds

```ts
// More aggressive NPC — retreats only at very low morale
const aggressiveCfg = createDefaultCombatTransitionConfig({
  retreatMoraleThreshold: -0.8,
  woundedHpThreshold:     0.1,
});
```

---

## Decision table

| Scenario | Result |
|----------|--------|
| HP < 20%, cooldown expired | `'WOUNDED'` |
| HP < 20%, cooldown active | continues chain |
| No ammo | `'RETREAT'` |
| Explosive danger nearby | `'EVADE_GRENADE'` |
| Panicked | `'FLEE'` |
| Low morale + can switch target | `'RETREAT'` |
| Lost sight 2–3s + grenades + 2+ enemies in range | `'GRENADE'` |
| Lost sight > 3s | `'SEARCH'` |
| All conditions normal | `null` (stay in COMBAT) |
