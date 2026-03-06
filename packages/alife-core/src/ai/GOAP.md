# GOAP

Goal-Oriented Action Planning — lets an NPC automatically find the cheapest
sequence of actions that transforms the current world state into a desired goal.

```ts
import { GOAPPlanner, GOAPAction, ActionStatus, WorldState } from '@alife-sdk/core/ai';
import type { GOAPActionDef } from '@alife-sdk/core/ai';
```

---

## Concepts

### What is GOAP?

Classical FSMs hard-code transitions between states. GOAP inverts the problem:
you describe **what the NPC can do** (actions) and **what you want to achieve**
(goal), and the planner figures out the cheapest sequence automatically.

```
Current state:  { hasAmmo: false, inCover: false, enemyDead: false }
Goal:           { enemyDead: true }

Available actions:
  FindAmmo      pre: {}            eff: { hasAmmo: true }      cost: 1
  TakeCover     pre: {}            eff: { inCover: true }      cost: 1
  Shoot         pre: { hasAmmo: true, inCover: true }
                eff: { enemyDead: true }                       cost: 2

Plan found:  [ FindAmmo, TakeCover, Shoot ]
Total cost:  4
```

### WorldState

A `WorldState` is a key → value map used for three purposes:

1. **Current state** — the live snapshot of the world fed to the planner
2. **Goal** — the desired state you want to reach
3. **Preconditions / Effects** — per-action constraints and outcomes

Only keys that have been explicitly `set()` are considered active.
`satisfies(goal)` returns `true` only if every key in `goal` matches
the value in the current state — unrelated keys are ignored.

### GOAPPlanner

Solves the planning problem using A* over a graph of reachable world states:

- Each **node** is a world state reachable by applying a sequence of actions
- Each **edge** is an action whose preconditions are satisfied by the current node
- **g**: accumulated action cost from the start
- **h**: `state.distanceTo(goal)` — count of unsatisfied goal properties (admissible heuristic)
- Returns the action sequence with the lowest total cost, or `null` if no plan exists

The planner uses a **binary min-heap** for the open set and a **bitmask
fingerprint** for the closed set — no map allocations per node for the common
boolean-only case.

---

## `WorldState`

```ts
import { WorldState } from '@alife-sdk/core/ai';
```

### Building a state

Use `WorldState.from()` to construct a state from a plain record — no chained `.set()` calls needed:

```ts
// Preferred — compact factory
const state = WorldState.from({
  hasAmmo:   true,
  inCover:   false,
  ammoCount: 5,       // numeric values are supported
  stance:    'prone', // string values too
});

// Equivalent — manual set()
const state2 = new WorldState();
state2.set('hasAmmo',  true);
state2.set('inCover',  false);
state2.set('ammoCount', 5);
state2.set('stance',  'prone');
```

### `state.get(key)` / `state.has(key)`

```ts
const val = state.get('hasAmmo'); // true | false | number | string | undefined
const known = state.has('inCover'); // false if key was never set
```

### `state.satisfies(goal)`

Returns `true` if every property in `goal` has the same value in `state`.
Properties in `state` that are not in `goal` are irrelevant.

```ts
const current = WorldState.from({ hasAmmo: true, inCover: false });
const goal    = WorldState.from({ hasAmmo: true });

current.satisfies(goal); // true — inCover is not part of the goal
```

### `state.applyEffects(effects)`

Returns a **new** `WorldState` with the effects applied. Does not mutate `state`.

```ts
const afterShooting = current.applyEffects(shootAction.getEffects());
```

### `state.clone()`

Deep copy of the state.

### `state.distanceTo(other)`

Count of properties in `other` that differ from `state`. Used as the A\*
heuristic by the planner.

---

## `GOAPActionDef` — plain-object actions (preferred)

For most actions you don't need a class. Pass a plain object to `registerAction()`:

```ts
planner.registerAction({
  id:   'take_cover',
  cost: 1,
  preconditions: {},
  effects:       { inCover: true },
  isValid:  (entity) => entity.metadata?.get('coverNearby') === true,
  execute:  (_entity, _delta) => 'success',
});
```

| Field | Required | Description |
|-------|----------|-------------|
| `id` | yes | Unique name |
| `cost` | yes | Planner cost — lower = preferred |
| `preconditions` | yes | `Record<string, WorldStateValue>` — must all hold before action runs |
| `effects` | yes | `Record<string, WorldStateValue>` — produced when action succeeds |
| `isValid` | no | `(entity) => boolean` — real-time guard |
| `execute` | no | `(entity, delta) => ActionStatus` |

---

## `GOAPAction`

Abstract base class for actions requiring complex multi-frame logic. Subclass when a plain `GOAPActionDef` isn't enough.

```ts
import { GOAPAction, ActionStatus } from '@alife-sdk/core/ai';
import type { IEntity } from '@alife-sdk/core/entity';

class TakeCoverAction extends GOAPAction {
  readonly id = 'take_cover';
  readonly cost = 1;

  getPreconditions() {
    const p = new WorldState();
    // No preconditions — always available
    return p;
  }

  getEffects() {
    const e = new WorldState();
    e.set('inCover', true);
    return e;
  }

  isValid(entity: IEntity): boolean {
    // Real-time guard: only valid if a cover point exists nearby
    return entity.getTag('nearestCoverDist') < 200;
  }

  execute(entity: IEntity, delta: number): ActionStatus {
    const cover = entity.getTag('nearestCover') as { x: number; y: number };
    const dist = Math.hypot(cover.x - entity.x, cover.y - entity.y);
    if (dist < 10) {
      entity.setTag('inCover', true);
      return ActionStatus.SUCCESS;
    }
    // Move toward cover
    entity.moveToward(cover.x, cover.y, delta);
    return ActionStatus.RUNNING;
  }

  abort(entity: IEntity) {
    entity.setTag('inCover', false);
  }
}
```

### Required members

| Member | Description |
|--------|-------------|
| `id: string` | Unique name for logging and plan inspection |
| `cost: number` | Planner cost — lower = preferred |
| `getPreconditions(): WorldState` | Properties that must hold before this action runs |
| `getEffects(): WorldState` | Properties this action produces when it succeeds |
| `isValid(entity): boolean` | Real-time guard — can return `false` when conditions stale |
| `execute(entity, delta): ActionStatus` | One tick of execution. Returns `RUNNING`, `SUCCESS`, or `FAILURE` |

### Optional

| Member | Description |
|--------|-------------|
| `abort(entity): void` | Called when the action is interrupted. Default no-op. |

### `ActionStatus`

```ts
ActionStatus.RUNNING  // Action is still executing — call again next frame
ActionStatus.SUCCESS  // Action completed — advance to next action in plan
ActionStatus.FAILURE  // Action failed — replan or give up
```

---

## `GOAPPlanner`

### Constructor

```ts
const planner = new GOAPPlanner(maxDepth?: number);
// maxDepth default: 10
```

### `planner.registerAction(action)`

Add an action to the planner's repertoire. Accepts either a plain `GOAPActionDef` object
or a `GOAPAction` class instance. Call once per action type, not once per NPC.

```ts
// Plain-object (preferred for simple actions)
planner.registerAction({ id: 'find_ammo', cost: 3, preconditions: {}, effects: { hasAmmo: true } });
planner.registerAction({ id: 'take_cover', cost: 1, preconditions: {}, effects: { inCover: true } });

// Class instance (for complex multi-frame logic)
planner.registerAction(new ShootAction());
planner.registerAction(new HealSelfAction());

// Both styles work together in the same planner
```

### `planner.plan(currentState, goal, maxDepth?)`

```ts
plan(currentState: WorldState, goal: WorldState, maxDepth?: number): GOAPAction[] | null
```

Returns an ordered action array (index 0 = first action to execute), or `null`
if no plan was found within the depth limit.

```ts
const plan = planner.plan(current, goal);
if (plan === null) {
  npc.fallbackToFSM();
} else {
  npc.executePlan(plan);
}
```

---

## Integrating GOAP with `StateMachine`

GOAP and FSM are complementary. A common pattern is to have one FSM state
(`GOAP`) that hands off control to the planner:

```ts
import { StateMachine } from '@alife-sdk/core/ai';
import { AIStateRegistry } from '@alife-sdk/core/registry';
import { GOAPPlanner, ActionStatus, WorldState } from '@alife-sdk/core/ai';

const planner = new GOAPPlanner();
planner.registerAction({ id: 'find_ammo', cost: 3, preconditions: {}, effects: { hasAmmo: true } });
planner.registerAction({ id: 'take_cover', cost: 1, preconditions: {}, effects: { inCover: true } });
planner.registerAction(new ShootAction()); // complex multi-frame action

let currentPlan: GOAPAction[] | null = null;
let planIndex = 0;
let replanTimer = 0;

const goapHandler: IStateHandler = {
  enter(entity) {
    currentPlan = null;
    planIndex = 0;
    replanTimer = 0;
  },

  update(entity, delta) {
    replanTimer -= delta;

    // Replan every 5 seconds or when the current plan is exhausted
    if (currentPlan === null || replanTimer <= 0) {
      const current = buildWorldState(entity);  // your function
      const goal    = buildGoal(entity);         // your function
      currentPlan = planner.plan(current, goal);
      planIndex = 0;
      replanTimer = 5;

      if (currentPlan === null) {
        entity.fsm.transition('IDLE'); // no plan — fall back
        return;
      }
    }

    if (planIndex >= currentPlan.length) {
      // Plan complete
      entity.fsm.transition('IDLE');
      return;
    }

    const action = currentPlan[planIndex];

    if (!action.isValid(entity)) {
      // Action became invalid — force replan
      replanTimer = 0;
      return;
    }

    const status = action.execute(entity, delta * 1000); // ms

    if (status === ActionStatus.SUCCESS) {
      planIndex++;
    } else if (status === ActionStatus.FAILURE) {
      action.abort(entity);
      replanTimer = 0; // replan immediately
    }
  },

  exit(entity) {
    if (currentPlan && planIndex < currentPlan.length) {
      currentPlan[planIndex].abort(entity);
    }
    currentPlan = null;
  },
};
```

---

## Full example — combat planner

```ts
import { GOAPPlanner, GOAPAction, ActionStatus, WorldState } from '@alife-sdk/core/ai';
import type { IEntity } from '@alife-sdk/core/entity';

// --- Planner setup (once per archetype) ---

const elitePlanner = new GOAPPlanner(8); // max plan depth 8

// Simple actions — plain-object style (preferred)
elitePlanner.registerAction({
  id:   'find_ammo',
  cost: 3,
  preconditions: {},
  effects:       { hasAmmo: true },
  isValid: (e) => e.getTag('ammoPickupNearby') === true,
});

elitePlanner.registerAction({
  id:   'take_cover',
  cost: 1,
  preconditions: {},
  effects:       { inCover: true },
  isValid: (e) => e.getTag('coverNearby') === true,
});

// Complex multi-frame action — class style
class ShootAction extends GOAPAction {
  readonly id = 'shoot';
  readonly cost = 1;

  getPreconditions() { return WorldState.from({ hasAmmo: true, inCover: true }); }
  getEffects()       { return WorldState.from({ enemyDead: true }); }
  isValid(e: IEntity) { return e.getTag('targetVisible') === true; }

  execute(e: IEntity, _delta: number): ActionStatus {
    e.fireWeapon();
    return e.getTag('enemyDead') ? ActionStatus.SUCCESS : ActionStatus.RUNNING;
  }
}

elitePlanner.registerAction(new ShootAction());

// --- Per-NPC use ---

function buildCurrentState(npc: MyNPC): WorldState {
  return WorldState.from({
    hasAmmo:   npc.ammo > 0,
    inCover:   npc.isInCover,
    enemyDead: npc.target === null,
  });
}

const goal = WorldState.from({ enemyDead: true });
const plan = elitePlanner.plan(buildCurrentState(npc), goal);
// plan = ['find_ammo', 'take_cover', ShootAction]
```

---

## Performance notes

**Planner is designed to be called at low frequency.** Replanning every 3-5
seconds is typical. Calling `plan()` every frame for many NPCs is wasteful —
cache the plan and execute it action-by-action.

**Complexity.** `O(b^d)` where `b = number of registered actions` and
`d = maxDepth`. With 8 actions and depth 6 the worst case is 8^6 = 262 144
nodes, but the A* heuristic prunes most branches in practice. Keep action sets
small (< 15) and depth short (< 10) for frame-budget safety.

**Fingerprinting.** For boolean-only world states (the common case) the planner
encodes visited states as a 31-bit bitmask — zero allocations. It falls back to
a djb2 hash automatically when states contain numeric/string values or more than
31 distinct keys.

**One planner per archetype.** `GOAPPlanner` is stateless between `plan()` calls
(scratch fields are cleared at the start). A single instance can safely serve
all NPCs of the same archetype sequentially.
