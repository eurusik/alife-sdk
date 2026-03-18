# GoalSelector

Pure function that selects the current GOAP goal from the NPC's world snapshot.
No side effects — fully deterministic.

```ts
import { selectGoal, DEFAULT_GOAL_RULES } from '@alife-sdk/ai/goap';
import type { IGoalResult, IGoalRule } from '@alife-sdk/ai/goap';
// GoalPriority constants and WorldProperty live in @alife-sdk/ai/types:
import { GoalPriority, WorldProperty } from '@alife-sdk/ai/types';
```

---

## `selectGoal(snapshot, config, rules?): IGoalResult`

Choose the most urgent goal for the current NPC state.

```ts
const result = selectGoal(snapshot, config.goap);
// result.goal     → WorldState the planner should achieve
// result.priority → GoalPriority band (0 = most urgent)
// result.reason   → human-readable explanation (for logging)
```

Rules are evaluated in order — the first rule that returns a non-null result wins.
`DEFAULT_GOAL_RULES` provides the 6-band hierarchy used by `GOAPController`.

`GOAPController` calls this automatically — you only need to call it directly
for custom goal evaluation outside the controller.

---

## IGoalResult

```ts
interface IGoalResult {
  readonly goal: WorldState;          // The desired end state
  readonly priority: GoalPriorityLevel; // 0 = CRITICALLY_WOUNDED, 5 = DEFAULT
  readonly reason: string;            // e.g. "Enemy detected", "HP critical (18%)"
}
```

The `goal` is a partial `WorldState` — only the properties the planner needs to
satisfy. The planner finds a sequence of actions that makes these properties true.

---

## DEFAULT_GOAL_RULES — 6-band priority hierarchy

Six rules evaluated in priority order (lowest number = first checked):

| Priority | Name | Trigger | Goal |
|----------|------|---------|------|
| `0` CRITICALLY_WOUNDED | `critically_wounded` | `hpRatio ≤ config.healHpThreshold` (default 0.3) | `{ criticallyWounded: false, enemyPresent: false }` |
| `1` PANIC_FLEE | `panic_flee` | `snapshot.isPanicking` | `{ isPanicking: false }` |
| `2` ENEMY_PRESENT | `enemy_present` | `snapshot.enemyPresent` | `{ enemyPresent: false }` |
| `3` DANGER | `danger` | `snapshot.hasDanger` | `{ danger: false }` |
| `4` ANOMALY_AVOID | `anomaly_avoid` | `snapshot.nearAnomaly` | `{ nearAnomaly: false }` |
| `5` DEFAULT | `default` | always matches | `{ atTarget: true }` |

```
HP ≤ 30%?  → CRITICALLY_WOUNDED goal  (heal + escape threat)
Panicking? → PANIC_FLEE goal          (flee to safety)
Enemy?     → ENEMY_PRESENT goal       (neutralize enemy)
Danger?    → DANGER goal              (investigate/evade)
Anomaly?   → ANOMALY_AVOID goal       (avoid anomaly)
(else)     → DEFAULT goal             (patrol/idle)
```

**Pre-allocated results:** The default rules reuse the same `IGoalResult` objects
across evaluations — zero heap allocations per tick for the common cases.

---

## IGoalRule interface

Implement this to add custom goals (e.g. "low ammo → resupply"):

```ts
interface IGoalRule {
  readonly priority: number;  // Lower = checked first
  readonly name: string;      // For logging/debugging
  evaluate(
    snapshot: INPCWorldSnapshot,
    config: IGOAPConfig,
  ): IGoalResult | null;      // null = this rule doesn't apply
}
```

---

## GoalPriority constants

```ts
const GoalPriority = {
  CRITICALLY_WOUNDED: 0,
  PANIC_FLEE: 1,
  ENEMY_PRESENT: 2,
  DANGER: 3,
  ANOMALY_AVOID: 4,
  DEFAULT: 5,
} as const;
```

Use these constants when building custom rules to keep priority values consistent
with the default hierarchy.

---

## Custom rules example

```ts
import { selectGoal, DEFAULT_GOAL_RULES } from '@alife-sdk/ai/goap';
import type { IGoalRule, IGoalResult } from '@alife-sdk/ai/goap';
import { WorldProperty, GoalPriority } from '@alife-sdk/ai/types';
import { WorldState } from '@alife-sdk/core';

// Add a "low ammo — resupply" rule between DANGER and DEFAULT:
const resupplyGoal = new WorldState();
resupplyGoal.set(WorldProperty.HAS_AMMO, true);

// Pre-allocated result to avoid per-tick allocation:
const resupplyResult: IGoalResult = {
  goal: resupplyGoal,
  priority: GoalPriority.DEFAULT,  // use an existing band or add your own numeric priority
  reason: 'Out of ammo — seeking resupply',
};

const resupplyRule: IGoalRule = {
  priority: 2.5,  // between DANGER (2) and DEFAULT (3) — IGoalRule.priority is number
  name: 'resupply',
  evaluate(snapshot) {
    if (!snapshot.hasAmmo && !snapshot.enemyPresent) {
      return resupplyResult;
    }
    return null;
  },
};

// Merge with defaults, sorted by priority:
const myRules: IGoalRule[] = [
  ...DEFAULT_GOAL_RULES.filter((r) => r.priority < 3),  // keep up to DANGER
  resupplyRule,
  DEFAULT_GOAL_RULES[DEFAULT_GOAL_RULES.length - 1],    // keep DEFAULT as fallback
].sort((a, b) => a.priority - b.priority);

// Pass rules to selectGoal directly, or subclass GOAPController to inject them:
const result = selectGoal(snapshot, config.goap, myRules);
```

> **DEFAULT always last:** The default rule (`{ atTarget: true }`) always returns
> non-null, so it must be the last rule in your array. If it's missing, `selectGoal`
> falls back to an empty `WorldState` goal — since an empty goal is vacuously satisfied
> by any world state, the controller will produce an empty plan and return
> `handled: false` every frame (NPC falls through to FSM).

---

## Performance note

`DEFAULT_GOAL_RULES` pre-allocates all `WorldState` and `IGoalResult` objects
at module initialization. The common evaluation path (rules 1–3) produces zero
heap allocations. Only the CRITICALLY_WOUNDED rule allocates a new string for
the `reason` field each time it fires (the `(hp%).toFixed(0)` call).

If you implement custom rules for high-frequency NPCs, follow the same pattern:
pre-allocate `WorldState` objects outside the `evaluate` function.
