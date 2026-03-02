# StateMachine

Generic finite state machine. Delegates behaviour to `IStateHandler` objects
registered in `AIStateRegistry`. Engine-agnostic — no Phaser dependency.

```ts
import { StateMachine } from '@alife-sdk/core/ai';
import { AIStateRegistry } from '@alife-sdk/core/registry';
import type { IStateHandler, IAIStateDefinition, ITransitionCondition, TransitionResult } from '@alife-sdk/core/ai';
```

---

## Concepts

### State lifecycle

Every state goes through three hooks, called in order:

```
transition into state → enter(entity)
every frame           → update(entity, delta)
transition out        → exit(entity)
```

If you transition to the **same** state you are already in, `exit` + `enter`
are still called — this gives "reset" semantics for free.

### Auto-transitions

`IAIStateDefinition.transitionConditions` is a list of rules evaluated every
frame after `update()`. The first rule whose `condition(entity)` returns `true`
fires a transition. Rules are sorted by `priority` (highest first) at
registration time, so you never need to worry about evaluation order.

### Guards

Two optional callbacks let a state veto a transition:

| Callback | Veto direction |
|----------|---------------|
| `canExit(entity, toState)` | Current state blocks leaving |
| `canEnter(entity, fromState)` | Target state blocks entering |

### Whitelist

`allowedTransitions?: string[]` — if set, `transition()` rejects any target
state not in the list before consulting guards.

---

## `AIStateRegistry`

Located in `@alife-sdk/core/registry`. Holds all state definitions for one FSM.

```ts
import { AIStateRegistry } from '@alife-sdk/core/registry';

const registry = new AIStateRegistry();
```

### `registry.register(id, definition)`

Register a state. Returns `this` for chaining.

```ts
registry
  .register('IDLE', { handler: idleHandler })
  .register('PATROL', { handler: patrolHandler, allowedTransitions: ['IDLE', 'ALERT'] })
  .register('ALERT', {
    handler: alertHandler,
    canEnter: (entity, from) => from !== 'DEAD',
    transitionConditions: [
      { targetState: 'COMBAT', priority: 10, condition: e => e.getTag('seenEnemy') === true },
      { targetState: 'IDLE',   priority:  5, condition: e => e.getTag('threatGone') === true },
    ],
  });
```

### `registry.evaluateTransitions(currentState, entity)`

Returns the first matching target state ID, or `null`. Called internally by
`StateMachine.update()` — you rarely need this directly.

---

## `IStateHandler`

The interface every state behaviour must implement:

```ts
interface IStateHandler {
  enter(entity: IEntity): void;
  update(entity: IEntity, delta: number): void; // delta in seconds
  exit(entity: IEntity): void;
}
```

Minimal example:

```ts
const patrolHandler: IStateHandler = {
  enter(entity) {
    entity.setTag('speed', entity.getTag('baseSpeed'));
  },
  update(entity, delta) {
    // advance along patrol route
  },
  exit(entity) {
    entity.setTag('patrolIndex', 0);
  },
};
```

---

## `IAIStateDefinition`

Full definition object passed to `registry.register()`:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `handler` | `IStateHandler` | yes | Lifecycle callbacks |
| `allowedTransitions` | `string[]` | no | Whitelist of valid target state IDs |
| `transitionConditions` | `ITransitionCondition[]` | no | Auto-transition rules (sorted by priority at registration) |
| `canEnter` | `(entity, fromState) => boolean` | no | Guard that blocks entering this state |
| `canExit` | `(entity, toState) => boolean` | no | Guard that blocks leaving this state |

---

## `ITransitionCondition`

```ts
interface ITransitionCondition {
  readonly targetState: string;
  readonly condition: (entity: IEntity) => boolean;
  readonly priority: number; // higher = evaluated first
}
```

---

## `StateMachine`

### Constructor

```ts
new StateMachine(entity: IEntity, registry: AIStateRegistry, initialState: string)
```

Calls `enter()` on the initial state immediately.

### `fsm.state`

```ts
get state(): string
```

Current active state ID.

### `fsm.transition(newState)`

```ts
transition(newState: string): TransitionResult
```

Attempt a manual transition. Returns:

```ts
type TransitionResult =
  | { success: true }
  | { success: false; reason: 'not_allowed' | 'exit_guard' | 'enter_guard' }
```

| `reason` | Cause |
|----------|-------|
| `not_allowed` | Target not in `allowedTransitions` |
| `exit_guard` | `canExit()` on the current state returned `false` |
| `enter_guard` | `canEnter()` on the target state returned `false` |

On success: calls `exit()` on the current state, updates `this.state`, calls
`enter()` on the new state.

### `fsm.update(delta)`

```ts
update(delta: number): void
```

Runs one tick:

1. `currentHandler.update(entity, delta)`
2. `registry.evaluateTransitions(currentState, entity)`
3. If a condition fired → `this.transition(targetState)`

### `fsm.destroy()`

```ts
destroy(): void
```

Calls `exit()` on the current state. Call this when the entity is removed from
the scene to avoid leaking handler state.

---

## Full example — 3-state guard NPC

```ts
import { StateMachine } from '@alife-sdk/core/ai';
import { AIStateRegistry } from '@alife-sdk/core/registry';
import type { IStateHandler } from '@alife-sdk/core/ai';

// Tags the FSM reads from / writes to the entity
const SEEN_ENEMY = 'seenEnemy';
const THREAT_GONE = 'threatGone';
const HP = 'hp';

const idleHandler: IStateHandler = {
  enter(e)        { e.setTag('anim', 'idle'); },
  update(e, dt)   { /* occasionally look around */ },
  exit(e)         {}
};

const alertHandler: IStateHandler = {
  enter(e)        { e.setTag('anim', 'alert'); e.setTag('alertTimer', 3); },
  update(e, dt)   { e.setTag('alertTimer', (e.getTag('alertTimer') as number) - dt); },
  exit(e)         { e.setTag(SEEN_ENEMY, false); e.setTag(THREAT_GONE, false); },
};

const combatHandler: IStateHandler = {
  enter(e)        { e.setTag('anim', 'combat'); },
  update(e, dt)   { /* attack logic */ },
  exit(e)         {}
};

const registry = new AIStateRegistry()
  .register('IDLE', {
    handler: idleHandler,
    transitionConditions: [
      { targetState: 'ALERT', priority: 10, condition: e => e.getTag(SEEN_ENEMY) === true },
    ],
  })
  .register('ALERT', {
    handler: alertHandler,
    transitionConditions: [
      { targetState: 'COMBAT',  priority: 20, condition: e => e.getTag(SEEN_ENEMY) === true },
      { targetState: 'IDLE',    priority:  5, condition: e => (e.getTag('alertTimer') as number) <= 0 },
    ],
    canEnter: (e, from) => (e.getTag(HP) as number) > 0,
  })
  .register('COMBAT', {
    handler: combatHandler,
    transitionConditions: [
      { targetState: 'ALERT', priority: 10, condition: e => e.getTag(THREAT_GONE) === true },
    ],
    canExit: (e, to) => to !== 'IDLE', // must pass through ALERT, never jump to IDLE
  });

const fsm = new StateMachine(npcEntity, registry, 'IDLE');

// Game loop
function tick(deltaSeconds: number) {
  fsm.update(deltaSeconds);
}
```

---

## Tips

**One registry, many FSMs.** A single `AIStateRegistry` instance can be shared
across all NPCs of the same type. Each `StateMachine` has its own `currentState`
but reads handlers from the shared registry.

```ts
// Created once per NPC archetype, not per NPC instance
const guardRegistry = new AIStateRegistry();
guardRegistry.register('IDLE', { handler: idleHandler });
// ...

// One FSM per NPC instance
const fsm1 = new StateMachine(npc1, guardRegistry, 'IDLE');
const fsm2 = new StateMachine(npc2, guardRegistry, 'IDLE');
```

**Store state in the entity, not the handler.** Handlers are stateless objects
shared across all FSMs. Any per-NPC state (timers, counters) must live on the
entity (via `setTag` / `getTag` or a component attached to the entity).

**Priority ties.** When two `transitionConditions` share the same priority and
both fire in the same frame, the one that was registered first wins. Assign
distinct priorities to avoid ambiguity.
