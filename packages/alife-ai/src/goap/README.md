# goap

Goal-Oriented Action Planning (GOAP) for `@alife-sdk/ai`.

GOAP is an alternative to hand-coded FSMs: instead of hardwiring which state leads
to which state, you describe **what the NPC wants** (goal) and **what actions are
available** (behaviors with preconditions and effects). The planner finds the
cheapest sequence of actions that transforms the current world state into the
goal state.

```
Current state:  { enemyPresent: true, inCover: false }
Goal:           { enemyPresent: false }

→ Plan: [TakeCoverAction, EngageAction]
```

```ts
import {
  GOAPController,
  buildWorldState,
  selectGoal,
  DEFAULT_WORLD_PROPERTY_BUILDERS,
  DEFAULT_GOAL_RULES,
} from '@alife-sdk/ai/goap';
```

---

## What the SDK gives you vs what you write

| SDK provides | You provide |
|-------------|-------------|
| `GOAPController` — orchestration | `GOAPAction` subclasses (your behaviors) |
| `buildWorldState()` — perception → world state | `INPCWorldSnapshot` — snapshot of NPC data |
| `selectGoal()` — world state → goal | Custom `IGoalRule[]` (optional) |
| `GOAPPlanner` (from `@alife-sdk/core`) — A* search | Custom `IWorldPropertyBuilder[]` (optional) |

You must write at least one `GOAPAction` — without actions there is nothing to plan.

---

## Components

| File | Purpose |
|------|---------|
| [GOAPController.md](GOAPController.md) | Per-NPC orchestrator — runs the pipeline every frame |
| [WorldStateBuilder.md](WorldStateBuilder.md) | `buildWorldState()`, 16 world properties, `INPCWorldSnapshot` |
| [GoalSelector.md](GoalSelector.md) | `selectGoal()`, 4-band priority rules, `IGoalRule` Strategy pattern |

---

## Quick start

```ts
import { GOAPPlanner, GOAPAction, ActionStatus, WorldState } from '@alife-sdk/core';
import { GOAPController } from '@alife-sdk/ai/goap';
import { createDefaultAIConfig } from '@alife-sdk/ai/config';
import type { INPCWorldSnapshot } from '@alife-sdk/ai/types';

// ── Step 1: Write your actions ────────────────────────────────────────────

class IdleAction extends GOAPAction {
  readonly id = 'idle';
  readonly cost = 1;

  getPreconditions() { return new WorldState(); }
  getEffects() {
    const ws = new WorldState();
    ws.set('atTarget', true);
    return ws;
  }
  isValid() { return true; }
  execute(_entity: IEntity, _deltaMs: number) {
    // Your idle logic here
    return ActionStatus.RUNNING;
  }
}

class TakeCoverAction extends GOAPAction {
  readonly id = 'take_cover';
  readonly cost = 2;

  getPreconditions() {
    const ws = new WorldState();
    ws.set('enemyPresent', true);
    return ws;
  }
  getEffects() {
    const ws = new WorldState();
    ws.set('inCover', true);
    return ws;
  }
  isValid(_entity: IEntity) { return true; /* check ammo, cover availability, etc */ }
  execute(_entity: IEntity, _deltaMs: number) {
    // Move to cover, return RUNNING until arrived
    return ActionStatus.RUNNING;
  }
}

// ── Step 2: Create the planner and register actions ───────────────────────

const planner = new GOAPPlanner();
planner.registerAction(new IdleAction());
planner.registerAction(new TakeCoverAction());
// ... register more actions

// ── Step 3: Create a GOAPController per NPC ───────────────────────────────

const config = createDefaultAIConfig();
const controller = new GOAPController(planner, config.goap);

// ── Step 4: Call update() every frame ─────────────────────────────────────

function onFrame(deltaMs: number, entity: IEntity, npcData: MyNPCData) {
  const snapshot: INPCWorldSnapshot = {
    isAlive:        npcData.isAlive,
    hpRatio:        npcData.hp / npcData.maxHp,
    hasWeapon:      npcData.weapon !== null,
    hasAmmo:        npcData.ammo > 0,
    inCover:        npcData.inCover,
    seeEnemy:       npcData.visibleEnemies.length > 0,
    enemyPresent:   npcData.knownEnemies.length > 0,
    enemyInRange:   npcData.nearestEnemyDist < npcData.weaponRange,
    hasDanger:      npcData.dangerLevel > 0,
    hasDangerGrenade: npcData.grenadeNearby,
    enemyWounded:   (npcData.nearestEnemy?.hp ?? Infinity) < 30,
  };

  const result = controller.update(deltaMs, entity, snapshot);

  if (!result.handled) {
    // GOAP had nothing to do — fall through to FSM or idle
  }
}
```

---

## GOAP pipeline

Every replan, the controller runs this pipeline:

```
INPCWorldSnapshot
      │
      ▼  buildWorldState()
 WorldState (16 boolean properties)
      │
      ▼  selectGoal()
 IGoalResult { goal: WorldState, priority, reason }
      │
      ▼  controller pre-checks worldState.satisfies(goal)
         → if satisfied: plan = [] (skip planner)
      ▼  planner.plan(worldState, goal, maxPlanDepth)
 GOAPAction[]  — ordered action sequence (null if no path found)
      │
      ▼  controller.update() — execute actions frame by frame
 IGOAPUpdateResult { handled, currentActionId, replanned }
```

Replanning is triggered by:
- Periodic timer (`config.goap.replanIntervalMs`, default 5 s)
- `controller.invalidatePlan()` — call on significant world changes
- Plan completion (all actions succeeded)
- Action failure or `isValid()` returning false

---

## GOAPAction lifecycle

Each action in the plan goes through three stages:

```
1. isValid(entity)   → false = abort (plan invalidated)
                       true  → proceed
2. execute(entity, deltaMs) every frame:
   → RUNNING   = keep executing
   → SUCCESS   = advance to next action (or replan if last)
   → FAILURE   = abort (plan invalidated)
3. abort(entity)     → cleanup when interrupted OR when SUCCESS (called on every terminal transition)
```

> **delta units:** `GOAPController` passes `deltaMs` to `execute()`.
> Despite the `GOAPAction` base class JSDoc saying "seconds", the controller
> passes **milliseconds**. Design your timing logic accordingly.

---

## Relationship to FSM

GOAP and FSM can coexist. The recommended pattern:

```ts
const result = controller.update(deltaMs, entity, snapshot);
if (!result.handled) {
  fsm.update(deltaMs, entity, ctx);  // FSM handles when GOAP has no plan
}
```

GOAP is best for complex multi-step behaviors (seek cover → aim → engage).
FSM is best for simple reactive states (DEAD, SLEEP, IDLE).
