# BehaviorTree

Code-first composable behavior trees. Engine-agnostic — no Phaser dependency.

```ts
import {
  Blackboard,
  Task,
  Condition,
  Sequence,
  Selector,
  Parallel,
  Inverter,
  AlwaysSucceed,
  AlwaysFail,
  Repeater,
  Cooldown,
} from '@alife-sdk/core/ai';
import type { TaskStatus, ITreeNode, ParallelPolicy } from '@alife-sdk/core/ai';
```

---

## Concepts

### The three statuses

Every node returns one of three values each tick:

| Status | Meaning |
|--------|---------|
| `'success'` | The node completed its goal |
| `'failure'` | The node could not complete its goal |
| `'running'` | The node is still in progress (e.g. moving to a waypoint) |

### Composites vs decorators vs leaves

```
Selector / Sequence / Parallel   ← composites: control flow, have children
Inverter / Cooldown / Repeater   ← decorators: wrap one child, modify its result
Task / Condition                 ← leaves: do actual work, no children
```

### Blackboard

`Blackboard<T>` is the shared state passed to every node on each tick.
Nodes read and write it to communicate — no global variables needed.

### Tick

Call `tree.tick(bb)` once per game frame. The tree walks its nodes and
returns the aggregate status. The caller decides what to do with the result.

---

## `Blackboard<T>`

```ts
const bb = new Blackboard<{ hp: number; inCover: boolean }>({
  hp: 100,
  inCover: false,
});

bb.get('hp');           // 100 | undefined
bb.getOr('hp', 0);     // 100  — returns defaultValue if key is unset
bb.set('hp', 80);
bb.has('inCover');      // true
bb.delete('inCover');
```

| Method | Returns | Notes |
|--------|---------|-------|
| `get(key)` | `T[K] \| undefined` | `undefined` if key was never set |
| `getOr(key, default)` | `NonNullable<T[K]>` | Returns `default` when key is unset or null — eliminates `?? 0` boilerplate |
| `set(key, value)` | `void` | |
| `has(key)` | `boolean` | |
| `delete(key)` | `void` | |

The type parameter `T` enforces valid keys at compile time.

---

## Leaf nodes

### `Task<TBB>`

Runs an arbitrary action. Return the appropriate status.

```ts
const moveToTarget = new Task<MyBB>((bb) => {
  const dist = distanceTo(bb.get('targetPos'));
  if (dist < 5) return 'success';   // arrived
  moveToward(bb.get('targetPos'));
  return 'running';                 // still moving
});
```

### `Condition<TBB>`

Wraps a boolean predicate. Returns `'success'` if true, `'failure'` if false.

```ts
const canSeeTarget = new Condition<MyBB>((bb) => !!bb.get('hasLineOfSight'));
const hasAmmo      = new Condition<MyBB>((bb) => bb.getOr('ammo', 0) > 0);
```

---

## Composites

### `Sequence<TBB>` — AND gate

Ticks children left-to-right. **Fails on the first failure**; returns `'running'`
if a child is running; succeeds only when **all** children succeed.

```ts
// "If I see a target AND have ammo → shoot"
const attackBranch = new Sequence([
  canSeeTarget,
  hasAmmo,
  shootTask,
]);
```

### `Selector<TBB>` — OR gate

Ticks children left-to-right. **Succeeds on the first success**; returns `'running'`
if a child is running; fails only when **all** children fail.

```ts
// "Try attack; if that fails, take cover; if that fails, retreat"
const rootTree = new Selector([
  attackBranch,
  takeCoverBranch,
  retreatBranch,
]);
```

### `Parallel<TBB>` — tick all children simultaneously

Ticks **all** children every tick regardless of individual results.
The policy controls when the Parallel itself succeeds or fails:

| `ParallelPolicy` | Succeeds when | Fails when |
|-----------------|---------------|------------|
| `'require-all'` | **all** children succeed | **any** child fails |
| `'require-one'` | **any** child succeeds | **all** children fail |

```ts
// Scan for enemies WHILE patrolling — both must complete
const scoutBehavior = new Parallel(
  [scanTask, patrolTask],
  'require-all',
);

// Move toward target OR take cover — succeed if either works
const escapeBehavior = new Parallel(
  [moveTask, coverTask],
  'require-one',
);
```

---

## Decorators

Decorators wrap exactly **one** child and modify its result or execution.

### `Inverter<TBB>`

Flips `'success'` ↔ `'failure'`. Passes `'running'` through unchanged.

```ts
// "Succeed when NOT in cover"
const notInCover = new Inverter(new Condition((bb) => !!bb.get('inCover')));
```

### `AlwaysSucceed<TBB>` / `AlwaysFail<TBB>`

Force a fixed outcome regardless of what the child returns.
Useful to make optional branches that never block a Sequence.

```ts
// Patrol is optional — even if it fails, don't block the root Selector
const optionalPatrol = new AlwaysSucceed(patrolBranch);
```

### `Repeater<TBB>`

Ticks the child up to `n` times. Returns `'success'` after `n` completions,
`'running'` while still repeating, `'failure'` if the child fails.

```ts
// Patrol 3 full loops before returning success
const patrolThrice = new Repeater(patrolOnce, 3);
```

### `Cooldown<TBB>`

Blocks the child for `durationMs` milliseconds after it last returned
`'success'`. Returns `'failure'` while the timer is active.

```ts
// Fire at most once per 1.5 seconds
const controlledShot = new Cooldown(shootTask, 1500);
```

An optional clock function can be injected for testing:

```ts
let now = 0;
const shot = new Cooldown(shootTask, 1000, () => now);
```

---

## `ITreeNode<TBB>` — write custom nodes

Implement this interface to create your own composites or decorators:

```ts
interface ITreeNode<TBB> {
  tick(bb: TBB): TaskStatus;
}
```

Example — a node that logs every tick result:

```ts
class LogNode<TBB> implements ITreeNode<TBB> {
  constructor(private child: ITreeNode<TBB>, private label: string) {}

  tick(bb: TBB): TaskStatus {
    const result = this.child.tick(bb);
    console.log(`[${this.label}] → ${result}`);
    return result;
  }
}

const debuggedAttack = new LogNode(attackBranch, 'attack');
```

---

## Full example — guard NPC combat tree

```ts
import {
  Blackboard, Selector, Sequence, Condition, Task, Inverter, Cooldown, Repeater,
} from '@alife-sdk/core/ai';

type GuardBB = {
  canSeeTarget: boolean;
  ammo:         number;
  hp:           number;
  maxHp:        number;
  inCover:      boolean;
  hasMedkit:    boolean;
  waypointIdx:  number;
  waypointCount: number;
};

const bb = new Blackboard<GuardBB>({
  canSeeTarget: false, ammo: 10, hp: 100, maxHp: 100,
  inCover: false, hasMedkit: true, waypointIdx: 0, waypointCount: 4,
});

// --- Leaves ---
const canSeeTarget  = new Condition<GuardBB>((b) => !!b.get('canSeeTarget'));
const hasAmmo       = new Condition<GuardBB>((b) => (b.get('ammo') ?? 0) > 0);
const isHealthy     = new Condition<GuardBB>((b) => (b.get('hp') ?? 0) / (b.get('maxHp') ?? 1) >= 0.5);

const shootTask = new Cooldown(
  new Task<GuardBB>((b) => {
    b.set('ammo', (b.get('ammo') ?? 0) - 1);
    return 'success';
  }),
  1000, // 1 shot/second
);

const reloadTask = new Task<GuardBB>((b) => {
  b.set('ammo', 10);
  return 'success';
});

const healTask = new Task<GuardBB>((b) => {
  if (!b.get('hasMedkit')) return 'failure';
  b.set('hp', b.get('maxHp') ?? 100);
  b.set('hasMedkit', false);
  return 'success';
});

const moveToCoverTask = new Task<GuardBB>((b) => {
  b.set('inCover', true);
  return 'running'; // movement takes time
});

const patrolStep = new Sequence<GuardBB>([
  new Task((b) => { /* move to waypoint */ return 'running'; }),
  new Task((b) => { /* wait */            return 'success'; }),
  new Task((b) => {
    b.set('waypointIdx', ((b.get('waypointIdx') ?? 0) + 1) % (b.get('waypointCount') ?? 1));
    return 'success';
  }),
]);

// --- Tree ---
const tree = new Selector<GuardBB>([
  // 1. Heal if wounded
  new Sequence([new Inverter(isHealthy), healTask]),

  // 2. Reload if out of ammo
  new Sequence([new Inverter(hasAmmo), reloadTask]),

  // 3. Attack if target visible and armed
  new Sequence([canSeeTarget, hasAmmo, shootTask]),

  // 4. Take cover if not already in cover
  new Sequence([new Inverter(new Condition((b) => !!b.get('inCover'))), moveToCoverTask]),

  // 5. Patrol as fallback — repeat 4 loops
  new Repeater(patrolStep, 4),
]);

// Game loop
function update(): void {
  // update perception on the blackboard before ticking
  bb.set('canSeeTarget', /* perception system result */ false);
  tree.tick(bb);
}
```

---

## When to use BT vs FSM

| Need | Use |
|------|-----|
| Fixed high-level states (idle / patrol / combat) | `StateMachine` |
| Multi-step execution logic *within* a state | `BehaviorTree` |
| Dynamic goal selection across many actions | `GOAPPlanner` |
| GOAP picks the goal, BT executes the steps | `GOAPPlanner` → `BehaviorTree` |

A common pattern: the FSM transitions between `IDLE`, `PATROL`, `COMBAT`.
Inside `COMBAT`, the state handler ticks a BT that decides whether to
shoot, reload, take cover, or retreat — all in one composable tree.
