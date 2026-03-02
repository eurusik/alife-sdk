# GOAPController

Per-NPC mediator that orchestrates the full GOAP pipeline:
WorldStateBuilder → GoalSelector → GOAPPlanner → action execution.

**Create one controller per NPC.** The controller is stateful — it owns the current
plan and replan timer.

```ts
import { GOAPController } from '@alife-sdk/ai/goap';
import { GOAPPlanner } from '@alife-sdk/core';
```

---

## Constructor

```ts
new GOAPController(planner: GOAPPlanner, config: IGOAPConfig)
```

| Parameter | Description |
|-----------|-------------|
| `planner` | Shared or per-NPC `GOAPPlanner` with registered actions. The controller does not own the action pool — register actions externally via `planner.registerAction()`. |
| `config` | GOAP configuration. Use `createDefaultAIConfig().goap`. |

> **Sharing planners:** A single `GOAPPlanner` with registered actions can be
> shared across all NPCs of the same type — it has no per-NPC state. The
> `GOAPController` itself is per-NPC.

```ts
// One planner, many controllers:
const planner = new GOAPPlanner();
planner.registerAction(new IdleAction());
planner.registerAction(new PatrolAction());
planner.registerAction(new EngageAction());

const npc1Controller = new GOAPController(planner, config.goap);
const npc2Controller = new GOAPController(planner, config.goap);
```

---

## update(deltaMs, entity, snapshot): IGOAPUpdateResult

The core method — call once per frame per NPC.

```ts
const result = controller.update(deltaMs, entity, snapshot);
```

**What it does:**
1. Advances the replan timer by `deltaMs`.
2. If a replan is needed: builds world state, selects goal, calls planner.
3. Executes the current action for this frame.
4. Returns a result describing what happened.

### IGOAPUpdateResult

```ts
interface IGOAPUpdateResult {
  readonly handled: boolean;         // true = GOAP ran an action this frame
  readonly currentActionId: string | null; // ID of the action being executed
  readonly replanned: boolean;       // true = a replan occurred this frame
}
```

| Field | Value | Meaning |
|-------|-------|---------|
| `handled` | `true` | An action is running — suppress FSM |
| `handled` | `false` | No active plan — hand off to FSM or idle |
| `currentActionId` | string | The action being executed (useful for logging) |
| `replanned` | `true` | A replan just happened — plan may have changed |

`handled` is `false` in three cases:
- No plan exists (first frame, plan search failed, or all actions done)
- `isValid()` returned `false` mid-execution (plan invalidated, replan next frame)
- Action returned `ActionStatus.FAILURE`

---

## Replan triggers

The controller replans when any of these are true:

| Trigger | When |
|---------|------|
| Timer | Every `config.replanIntervalMs` ms (default 5 000 ms) |
| `invalidatePlan()` | Manual call, e.g. on hit, new enemy spotted |
| Plan complete | All actions in the plan succeeded |
| `isValid()` false | Current action reports it can no longer proceed |

---

## invalidatePlan(): void

Force a replan on the next `update()` call.

Call this when significant world changes mean the current plan is stale:

```ts
// On taking damage:
controller.invalidatePlan();

// On spotting a new enemy:
controller.invalidatePlan();
```

The current action is aborted (`abort(entity)` called) during the next `update()`.

---

## Debug methods

### `getLastGoalResult(): IGoalResult | null`

Returns the goal selection result from the last replan — includes the goal
`WorldState`, priority band, and reason string.

```ts
const goal = controller.getLastGoalResult();
console.log(`GOAP goal: ${goal?.reason} (priority ${goal?.priority})`);
// e.g. "Enemy detected (priority 1)"
```

### `getCurrentPlanIds(): string[]`

Returns action IDs for the current plan in execution order.

```ts
console.log('Plan:', controller.getCurrentPlanIds().join(' → '));
// "take_cover → peek → engage"
```

### `getCurrentIndex(): number`

Index of the currently executing action within the plan.

### `hasPlan(): boolean`

Whether there is a valid plan with remaining actions.

---

## reset(entity): void

Clear the current plan, abort the current action, and force a full replan on
the next `update()`. Call when the NPC respawns or changes context entirely.

```ts
// On NPC respawn:
controller.reset(entity);
```

---

## IGOAPConfig

Config fields used by `GOAPController`:

| Field | Default | Used by |
|-------|---------|---------|
| `replanIntervalMs` | `5000` ms | Periodic replan timer |
| `maxPlanDepth` | `10` | Passed to `planner.plan()` |
| `healHpThreshold` | `0.3` | Used by `GoalSelector` (CRITICALLY_WOUNDED rule) |
| `eliteRankThreshold` | `5` | Host-side only — the GOAP module never checks rank |
| `dangerMemoryMaxAge` | `5000` ms | Host-side only — the GOAP module never uses it |

> `eliteRankThreshold` and `dangerMemoryMaxAge` exist in `IGOAPConfig` for host
> convenience — all GOAP-related tuning lives in one config block. The controller
> itself ignores them. The host uses `eliteRankThreshold` to decide which NPCs
> get a `GOAPController` at all.

---

## Plan execution lifecycle

```
controller.update(deltaMs, entity, snapshot)
        │
        ├── needsReplan() ?
        │       ├── planInvalid = true (invalidatePlan / first frame / action failed)
        │       ├── currentPlan.length === 0
        │       └── replanTimer >= replanIntervalMs
        │
        ├── replan():
        │       buildWorldState(snapshot) → WorldState
        │       selectGoal(snapshot, config) → IGoalResult
        │       if worldState.satisfies(goal) → plan = [] (already done)
        │       else planner.plan(worldState, goal, maxPlanDepth) → GOAPAction[]
        │
        └── execute action at currentIndex:
                isValid(entity) → false  → abort → planInvalid = true
                execute(entity, deltaMs):
                  RUNNING  → handled: true
                  SUCCESS  → abort() called, advance index; if last → planInvalid = true
                  FAILURE  → abort() called → planInvalid = true → handled: false
                // Note: abort() is called on SUCCESS too, not only on interruption
```

---

## Full integration example

```ts
const planner = new GOAPPlanner();
planner.registerAction(new IdleAction());
planner.registerAction(new TakeCoverAction());
planner.registerAction(new EngageAction());

const controller = new GOAPController(planner, config.goap);

// In entity update loop:
function updateNPC(deltaMs: number, entity: IEntity, npcData: MyNPCData) {
  const snapshot = buildSnapshotFromNPCData(npcData); // your adapter

  const result = controller.update(deltaMs, entity, snapshot);

  if (result.replanned) {
    const goal = controller.getLastGoalResult();
    logger.debug(`[${entity.id}] GOAP replanned: ${goal?.reason}`);
  }

  if (!result.handled) {
    fsm.update(deltaMs, entity, ctx); // fallback
  }
}
```
