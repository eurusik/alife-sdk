# ai

Core AI primitives for `@alife-sdk/core`: finite state machines, per-NPC
episodic memory, spatial danger awareness, and GOAP planning.

```ts
import {
  StateMachine,
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
  MemoryRecord,
  IMemoryBankConfig,
  IMemoryInput,
  IDangerEntry,
} from '@alife-sdk/core/ai';
```

---

## What the SDK gives you

| Component | What it does |
|-----------|--------------|
| `StateMachine` | Generic FSM — delegates behaviour to `IStateHandler` objects registered in `AIStateRegistry` |
| `AIStateRegistry` | State registry with auto-transitions, guards, and whitelist enforcement (`@alife-sdk/core/registry`) |
| `MemoryBank` | Per-NPC multi-channel memory with confidence decay and eviction |
| `DangerManager` | Spatial danger zones with TTL, threat scoring, and safe-direction computation |
| `WorldState` | GOAP key-value map with `satisfies()`, `applyEffects()`, and A* heuristic |
| `GOAPAction` | Abstract base class for GOAP actions (preconditions / effects / execute) |
| `GOAPPlanner` | A\*-based optimal action sequence solver with binary min-heap and bitmask fingerprinting |

---

## Quick start — FSM for a custom NPC

```ts
import { StateMachine } from '@alife-sdk/core/ai';
import { AIStateRegistry } from '@alife-sdk/core/registry';
import type { IStateHandler, IAIStateDefinition } from '@alife-sdk/core/ai';
import type { IEntity } from '@alife-sdk/core/entity';

// 1. Define state handlers
const idleHandler: IStateHandler = {
  enter(entity) { console.log('entered IDLE'); },
  update(entity, delta) { /* play idle animation, look around */ },
  exit(entity)  { console.log('leaving IDLE'); },
};

const alertHandler: IStateHandler = {
  enter(entity) { /* raise weapon */ },
  update(entity, delta) { /* scan for threat source */ },
  exit(entity)  { /* lower weapon */ },
};

// 2. Build the registry
const registry = new AIStateRegistry();

registry.register('IDLE', {
  handler: idleHandler,
  allowedTransitions: ['ALERT', 'PATROL'],
  transitionConditions: [
    {
      targetState: 'ALERT',
      priority: 10,
      condition: (entity) => entity.getTag('heardNoise') === true,
    },
  ],
} satisfies IAIStateDefinition);

registry.register('ALERT', {
  handler: alertHandler,
  transitionConditions: [
    {
      targetState: 'IDLE',
      priority: 5,
      condition: (entity) => entity.getTag('threatGone') === true,
    },
  ],
} satisfies IAIStateDefinition);

// 3. Create the FSM (calls enter() on the initial state)
const fsm = new StateMachine(entity, registry, 'IDLE');

// 4. Each frame
function update(delta: number) {
  fsm.update(delta); // runs handler.update() then evaluates auto-transitions
}

// 5. Force transition when needed (e.g. event-driven)
const result = fsm.transition('ALERT');
if (!result.success) {
  console.warn('Transition blocked:', result.reason);
}

// 6. On entity destruction
fsm.destroy(); // calls exit() on the current state
```

---

## Quick start — MemoryBank

```ts
import { MemoryBank, MemoryChannel } from '@alife-sdk/core/ai';

const memory = new MemoryBank({
  timeFn: () => performance.now() / 1000, // game time in seconds
  maxRecords: 16,
  decayRate: 0.05,                         // 0.05 confidence/sec
  channelDecayRates: { [MemoryChannel.SOUND]: 0.2 }, // sounds fade faster
});

// Record a visual sighting
memory.remember({
  sourceId: 'enemy_007',
  channel: MemoryChannel.VISUAL,
  position: { x: 340, y: 210 },
  confidence: 1.0,
});

// Check if the NPC still remembers the enemy
const rec = memory.recall('enemy_007');
console.log(rec?.confidence); // 1.0 initially, decays toward 0

// Decay memories each frame
memory.update(deltaSeconds);

// Query all threats by channel
const threats = memory.getByChannel(MemoryChannel.VISUAL);
```

---

## Quick start — DangerManager

```ts
import { DangerManager, DangerType } from '@alife-sdk/core/ai';

const dangers = new DangerManager();

// Register a grenade landing
dangers.addDanger({
  id: 'grenade_01',
  type: DangerType.GRENADE,
  position: { x: 500, y: 300 },
  radius: 150,
  threatScore: 0.9,
  remainingMs: 3000,
});

// Each frame
dangers.update(deltaMs); // decays TTL, removes expired entries

// NPC decision-making
if (dangers.isDangerous({ x: npc.x, y: npc.y })) {
  const safeDir = dangers.getSafeDirection({ x: npc.x, y: npc.y });
  npc.flee(safeDir.x, safeDir.y);
}
```

---

## Quick start — GOAP planner

```ts
import { GOAPPlanner, GOAPAction, ActionStatus, WorldState } from '@alife-sdk/core/ai';
import type { IEntity } from '@alife-sdk/core/entity';

// 1. Define an action
class HealSelf extends GOAPAction {
  readonly id = 'heal_self';
  readonly cost = 2;

  getPreconditions() {
    const p = new WorldState();
    p.set('hasMedkit', true);
    return p;
  }

  getEffects() {
    const e = new WorldState();
    e.set('isHealthy', true);
    e.set('hasMedkit', false);
    return e;
  }

  isValid(entity: IEntity) {
    return entity.getTag('medkitCount') > 0;
  }

  execute(entity: IEntity, delta: number): ActionStatus {
    // ... apply healing logic
    return ActionStatus.SUCCESS;
  }
}

// 2. Set up planner
const planner = new GOAPPlanner();
planner.registerAction(new HealSelf());
planner.registerAction(new FindMedkit()); // another action

// 3. Build current + goal states
const current = new WorldState();
current.set('isHealthy', false);
current.set('hasMedkit', false);

const goal = new WorldState();
goal.set('isHealthy', true);

// 4. Find the plan
const plan = planner.plan(current, goal);
// plan = [FindMedkit, HealSelf] — ordered by execution
```

---

## System relationships

```
AIStateRegistry  ←  defines state definitions (handlers, guards, conditions)
       │
       ▼  registered into
StateMachine  ←  owns current state + drives lifecycle
       │
       ▼  calls each frame
IStateHandler.update()
       │
       ├── reads MemoryBank  →  "what have I seen/heard recently?"
       ├── reads DangerManager  →  "is my position safe?"
       └── if GOAP: GOAPPlanner.plan()
               │
               ▼
           GOAPAction.execute()  →  drives NPC behaviour
```

---

## Components

| File | Purpose |
|------|---------|
| [StateMachine.md](StateMachine.md) | `StateMachine` + `AIStateRegistry` — FSM lifecycle, guards, auto-transitions |
| [MemorySystem.md](MemorySystem.md) | `MemoryBank` — per-NPC episodic memory with confidence decay |
| [DangerManager.md](DangerManager.md) | `DangerManager` — spatial danger zones with TTL and safe-direction vector |
| [GOAP.md](GOAP.md) | `WorldState` + `GOAPAction` + `GOAPPlanner` — A\* goal-oriented planning |

---

## When to use what

| Scenario | Tool |
|----------|------|
| NPC with a fixed set of behaviors (idle, patrol, combat) | `StateMachine` |
| NPC needs to remember where it last saw the player | `MemoryBank` |
| NPC needs to avoid grenade blast radius or anomaly fields | `DangerManager` |
| Elite NPC that dynamically selects multi-step strategies | `GOAPPlanner` |
| Mix: elite NPC with memory-aware GOAP | All four, composed |
