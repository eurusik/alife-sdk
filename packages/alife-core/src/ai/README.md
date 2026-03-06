# ai

Core AI primitives for `@alife-sdk/core`: finite state machines, behavior trees,
per-NPC episodic memory, spatial danger awareness, and GOAP planning.

```ts
import {
  StateMachine,
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
  MemoryBank,
  MemoryChannel,
  DangerManager,
  DangerType,
  WorldState,
  GOAPPlanner,
  GOAPAction,
  ActionStatus,
} from '@alife-sdk/core/ai';
import type {
  IStateHandler,
  ITransitionCondition,
  IAIStateDefinition,
  TransitionResult,
  StateTransitionEvent,
  TaskStatus,
  ITreeNode,        // base interface for custom BT nodes
  ParallelPolicy,   // 'require-all' | 'require-one'
  MemoryRecord,
  IMemoryBankConfig,
  IMemoryInput,
  IDangerEntry,
  GOAPActionDef,    // plain-object action definition for registerAction()
  WorldStateValue,  // string | number | boolean
} from '@alife-sdk/core/ai';
```

---

## What the SDK gives you

| Component | What it does |
|-----------|--------------|
| `StateMachine` | Generic FSM — delegates behaviour to `IStateHandler` objects; supports tags, metadata, event subscriptions, and transition history |
| `AIStateRegistry` | State registry with auto-transitions, guards, whitelist, tags, and metadata (`@alife-sdk/core/registry`) |
| `Blackboard<T>` | Typed key-value store shared across all BT nodes during a tick |
| `Sequence` | BT composite — AND gate; fails on first child failure |
| `Selector` | BT composite — OR gate; succeeds on first child success |
| `Parallel` | BT composite — ticks all children; `'require-all'` (fail on any failure) or `'require-one'` (succeed if any succeed) |
| `Inverter` | BT decorator — flips success ↔ failure |
| `AlwaysSucceed` / `AlwaysFail` | BT decorators — force a fixed outcome |
| `Repeater` | BT decorator — repeat child N times |
| `Cooldown` | BT decorator — blocks child while timer is active |
| `Task` | BT leaf — runs an arbitrary action callback |
| `Condition` | BT leaf — wraps a boolean predicate |
| `MemoryBank` | Per-NPC multi-channel memory with confidence decay and eviction |
| `DangerManager` | Spatial danger zones with TTL, threat scoring, and safe-direction computation |
| `WorldState` | GOAP key-value map with `satisfies()`, `applyEffects()`, A* heuristic, and `WorldState.from(record)` factory |
| `GOAPAction` | Abstract base class for GOAP actions — extend for complex multi-frame logic |
| `GOAPActionDef` | Plain-object action definition — preferred for simple actions; pass directly to `registerAction()` |
| `GOAPPlanner` | A\*-based optimal action sequence solver; `registerAction()` accepts both class instances and plain `GOAPActionDef` objects |

---

## Quick start — FSM for a custom NPC

```ts
import { StateMachine } from '@alife-sdk/core/ai';
import { AIStateRegistry } from '@alife-sdk/core/registry';
import type { IStateHandler, IAIStateDefinition } from '@alife-sdk/core/ai';
import type { IEntity } from '@alife-sdk/core/entity';

const idleHandler: IStateHandler = {
  enter(entity) { console.log('entered IDLE'); },
  update(entity, delta) { /* look around */ },
  exit(entity)  { console.log('leaving IDLE'); },
};

const alertHandler: IStateHandler = {
  enter(entity) { /* raise weapon */ },
  update(entity, delta) { /* scan for threat */ },
  exit(entity)  { /* lower weapon */ },
};

const registry = new AIStateRegistry();

// IEntity does not have getTag/setTag — cast to your concrete entity type
// or read from entity.metadata (read-only KV store on IEntity).
// See example 11-fsm-tags.ts for a complete typed pattern.
registry.register('IDLE', {
  handler: idleHandler,
  tags: ['passive'],
  allowedTransitions: ['ALERT', 'PATROL'],
  transitionConditions: [
    { targetState: 'ALERT', priority: 10, condition: (e) => e.metadata?.get('heardNoise') === true },
  ],
} satisfies IAIStateDefinition);

registry.register('ALERT', {
  handler: alertHandler,
  tags: ['active'],
  transitionConditions: [
    { targetState: 'IDLE', priority: 5, condition: (e) => e.metadata?.get('threatGone') === true },
  ],
} satisfies IAIStateDefinition);

const fsm = new StateMachine(entity, registry, 'IDLE');

// Event subscription
fsm.onEnter('ALERT', (from) => console.log(`Alert! was in ${from}`));
fsm.onChange((from, to) => logger.debug(`${from} → ${to}`));

// Tag query
if (fsm.hasTag('active')) { /* in any 'active'-tagged state */ }

// Each frame
function update(delta: number) {
  fsm.update(delta);
}

// Force transition
const result = fsm.transition('ALERT');
if (!result.success) console.warn('Blocked:', result.reason);

// On entity destruction
fsm.destroy();
```

---

## Quick start — Behavior Tree

Behavior Trees compose well with GOAP: GOAP decides *what* goal to pursue,
the BT decides *how* to execute it step by step.

```ts
import {
  Blackboard, Selector, Sequence, Condition, Task, Cooldown, Inverter,
} from '@alife-sdk/core/ai';

// 1. Define shared state
type NpcBB = { canSeeTarget: boolean; ammo: number; inCover: boolean };
const bb = new Blackboard<NpcBB>({ canSeeTarget: false, ammo: 10, inCover: false });

// 2. Compose the tree
const tree = new Selector([
  // Attack branch — engage if visible and armed
  new Sequence([
    new Condition((b) => !!b.get('canSeeTarget')),
    new Condition((b) => (b.get('ammo') ?? 0) > 0),
    new Cooldown(
      new Task((b) => {
        shoot();
        b.set('ammo', (b.get('ammo') ?? 0) - 1);
        return 'success';
      }),
      1500, // 1.5 s between shots
    ),
  ]),

  // Fallback — take cover
  new Sequence([
    new Inverter(new Condition((b) => !!b.get('inCover'))),
    new Task(() => { moveToCover(); return 'running'; }),
  ]),
]);

// 3. Tick each frame (shoot / moveToCover are your game functions)
bb.set('canSeeTarget', perception.canSeePlayer());
const status = tree.tick(bb); // 'success' | 'failure' | 'running'
```

---

## Quick start — MemoryBank

```ts
import { MemoryBank, MemoryChannel } from '@alife-sdk/core/ai';

const memory = new MemoryBank({
  timeFn: () => performance.now() / 1000,
  maxRecords: 16,
  decayRate: 0.05,
  channelDecayRates: { [MemoryChannel.SOUND]: 0.2 },
});

memory.remember({
  sourceId: 'enemy_007',
  channel: MemoryChannel.VISUAL,
  position: { x: 340, y: 210 },
  confidence: 1.0,
});

const rec = memory.recall('enemy_007');
memory.update(deltaSeconds);
```

---

## Quick start — DangerManager

```ts
import { DangerManager, DangerType } from '@alife-sdk/core/ai';

const dangers = new DangerManager();
dangers.addDanger({
  id: 'grenade_01', type: DangerType.GRENADE,
  position: { x: 500, y: 300 }, radius: 150,
  threatScore: 0.9, remainingMs: 3000,
});
dangers.update(deltaMs);

if (dangers.isDangerous({ x: npc.x, y: npc.y })) {
  const safeDir = dangers.getSafeDirection({ x: npc.x, y: npc.y });
  npc.flee(safeDir.x, safeDir.y);
}
```

---

## Quick start — GOAP planner

Use `registerAction` with a plain object — no subclassing required:

```ts
import { GOAPPlanner, WorldState } from '@alife-sdk/core/ai';
import type { GOAPActionDef } from '@alife-sdk/core/ai';

const planner = new GOAPPlanner();

// Plain-object action definition — preferred API
planner.registerAction({
  id:   'find_medkit',
  cost: 3,
  preconditions: { hasMedkit: false },
  effects:       { hasMedkit: true },
});

planner.registerAction({
  id:   'heal_self',
  cost: 2,
  preconditions: { hasMedkit: true,  isHealthy: false },
  effects:       { hasMedkit: false, isHealthy: true },
  isValid:  (entity) => (entity.metadata?.get('medkitCount') as number ?? 0) > 0,
  execute:  (_entity, _delta) => 'success',
});

// WorldState.from() — compact factory instead of chained .set() calls
const current = WorldState.from({ isHealthy: false, hasMedkit: false });
const goal    = WorldState.from({ isHealthy: true });

const plan = planner.plan(current, goal); // ['find_medkit', 'heal_self']
```

You can still extend `GOAPAction` for complex logic that doesn't fit a plain object,
and mix both styles in the same planner.

```ts
import { GOAPPlanner, GOAPAction, ActionStatus, WorldState } from '@alife-sdk/core/ai';

class PatrolAction extends GOAPAction {
  readonly id = 'patrol';
  readonly cost = 1;
  getPreconditions() { return WorldState.from({ isIdle: true }); }
  getEffects()       { return WorldState.from({ isPatrolling: true }); }
  execute(entity, delta) {
    // complex multi-frame logic here
    return ActionStatus.RUNNING;
  }
}

const planner = new GOAPPlanner();
planner.registerAction(new PatrolAction()); // class instance
planner.registerAction({ id: 'rest', cost: 1, preconditions: { isPatrolling: true }, effects: { isIdle: true } }); // plain object
```

---

## System relationships

```
AIStateRegistry  ←  defines state definitions (handlers, guards, conditions, tags)
       │
       ▼  registered into
StateMachine  ←  owns current state + drives lifecycle
       │           └── onEnter/onExit/onChange subscriptions
       ▼  calls each frame
IStateHandler.update()
       │
       ├── reads MemoryBank     →  "what have I seen/heard recently?"
       ├── reads DangerManager  →  "is my position safe?"
       ├── ticks BehaviorTree   →  "how do I execute this goal?"
       └── if GOAP: GOAPPlanner.plan()
               │
               ▼
           GOAPAction.execute()  →  drives NPC behaviour
```

---

## Components

| File | Purpose |
|------|---------|
| [StateMachine.md](StateMachine.md) | `StateMachine` + `AIStateRegistry` — FSM lifecycle, guards, tags, event subscriptions, history |
| [BehaviorTree.md](BehaviorTree.md) | `Blackboard`, composites, decorators, `Parallel` policies — full BT API |
| [MemorySystem.md](MemorySystem.md) | `MemoryBank` — per-NPC episodic memory with confidence decay |
| [DangerManager.md](DangerManager.md) | `DangerManager` — spatial danger zones with TTL and safe-direction vector |
| [GOAP.md](GOAP.md) | `WorldState` + `GOAPAction` + `GOAPPlanner` — A\* goal-oriented planning |

---

## When to use what

| Scenario | Tool |
|----------|------|
| NPC with a fixed set of behaviors (idle, patrol, combat) | `StateMachine` |
| Complex multi-step behavior within a state | `BehaviorTree` + `Blackboard` |
| GOAP selects a goal; BT executes it | `GOAPPlanner` → `BehaviorTree` |
| NPC needs to remember where it last saw the player | `MemoryBank` |
| NPC needs to avoid grenade blast radius or anomaly fields | `DangerManager` |
| Elite NPC that dynamically selects multi-step strategies | `GOAPPlanner` |
| Mix: elite NPC with memory-aware GOAP + BT execution | All four, composed |
