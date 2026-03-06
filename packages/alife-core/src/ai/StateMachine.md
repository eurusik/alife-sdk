# StateMachine

Generic finite state machine. Delegates behaviour to `IStateHandler` objects
registered in `AIStateRegistry`. Engine-agnostic — no Phaser dependency.

```ts
import { StateMachine } from '@alife-sdk/core/ai';
import { AIStateRegistry } from '@alife-sdk/core/registry';
import type { IStateHandler, IAIStateDefinition, ITransitionCondition, TransitionResult, StateTransitionEvent } from '@alife-sdk/core/ai';
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

### Tags and metadata

States can carry categorical tags and arbitrary metadata:

```ts
registry.register('COMBAT', {
  handler: combatHandler,
  tags: ['hostile', 'active'],
  metadata: { animGroup: 'combat', priority: 10 },
});

// Query in any frame:
if (fsm.hasTag('hostile')) { /* NPC is in a hostile state */ }
const anim = fsm.metadata?.['animGroup']; // 'combat'
```

Tags are useful for grouping states (e.g. "is the NPC in any aggressive state?")
without hard-coding state names in consuming systems.

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
    tags: ['active'],
    metadata: { alertSoundId: 'sfx_alert' },
    canEnter: (entity, from) => from !== 'DEAD',
    transitionConditions: [
      { targetState: 'COMBAT', priority: 10, condition: e => (e as MyNpc).getTag('seenEnemy') === true },
      { targetState: 'IDLE',   priority:  5, condition: e => (e as MyNpc).getTag('threatGone') === true },
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
// IEntity does not have getTag/setTag — cast to your concrete entity type
// to access per-NPC mutable state. See Tips section below for the pattern.
interface MyNpc extends IEntity {
  getTag(key: string): unknown;
  setTag(key: string, val: unknown): void;
}

const patrolHandler: IStateHandler = {
  enter(entity) {
    (entity as MyNpc).setTag('speed', (entity as MyNpc).getTag('baseSpeed'));
  },
  update(entity, delta) {
    // advance along patrol route
  },
  exit(entity) {
    (entity as MyNpc).setTag('patrolIndex', 0);
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
| `tags` | `string[]` | no | Categorical labels (e.g. `'hostile'`, `'grounded'`) queryable via `fsm.hasTag()` |
| `metadata` | `Record<string, unknown>` | no | Arbitrary data for tooling/animation hints, readable via `fsm.metadata` |

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

### `fsm.previous`

```ts
get previous(): string | null
```

The state that was active before the last successful transition, or `null` if
no transition has occurred yet.

### `fsm.currentStateDuration`

```ts
get currentStateDuration(): number
```

Milliseconds elapsed since entering the current state. Resets on every successful transition.

### `fsm.hasTag(tag)`

```ts
hasTag(tag: string): boolean
```

Returns `true` if the **current** state's definition includes `tag` in its `tags` array.

```ts
if (fsm.hasTag('combat')) { /* any combat-group state */ }
```

### `fsm.metadata`

```ts
get metadata(): Readonly<Record<string, unknown>> | undefined
```

The `metadata` object from the current state's definition, or `undefined` if none was set.

### `fsm.onEnter(state, callback)`

```ts
onEnter(state: string, callback: (from: string | null) => void): () => void
```

Subscribe to the moment the FSM enters `state`. Returns an unsubscribe function.

```ts
const unsub = fsm.onEnter('COMBAT', (from) => {
  console.log(`Entered COMBAT from ${from}`);
  playSound('combat_music');
});
// later:
unsub();
```

### `fsm.onExit(state, callback)`

```ts
onExit(state: string, callback: (to: string) => void): () => void
```

Subscribe to the moment the FSM exits `state`. Returns an unsubscribe function.

### `fsm.onChange(callback)`

```ts
onChange(callback: (from: string, to: string) => void): () => void
```

Subscribe to **any** state change. Fires after `exit()` and before `enter()`. Returns an unsubscribe function.

```ts
fsm.onChange((from, to) => logger.debug(`FSM: ${from} → ${to}`));
```

### `fsm.getHistory()`

```ts
getHistory(): readonly StateTransitionEvent[]
```

A snapshot of all successful transitions since construction (or last `clearHistory()`), oldest first.

```ts
interface StateTransitionEvent {
  readonly from: string;
  readonly to: string;
  readonly timestamp: number; // Date.now() at transition time
}
```

### `fsm.clearHistory()`

```ts
clearHistory(): void
```

Empties the transition log.

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

On success: calls `exit()` + exit listeners, updates state, fires `onChange` listeners,
calls `enter()` + enter listeners, records to history.

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
import type { IEntity } from '@alife-sdk/core/entity';

// Your concrete entity type — extends IEntity with per-NPC mutable state
interface GuardNpc extends IEntity {
  getTag(key: string): unknown;
  setTag(key: string, val: unknown): void;
}

const tag = (e: IEntity) => e as GuardNpc; // helper to avoid repetition

const SEEN_ENEMY = 'seenEnemy';
const THREAT_GONE = 'threatGone';
const HP = 'hp';

const idleHandler: IStateHandler = {
  enter(e)        { tag(e).setTag('anim', 'idle'); },
  update(e, dt)   { /* occasionally look around */ },
  exit(e)         {}
};

const alertHandler: IStateHandler = {
  enter(e)        { tag(e).setTag('anim', 'alert'); tag(e).setTag('alertTimer', 3); },
  update(e, dt)   { tag(e).setTag('alertTimer', (tag(e).getTag('alertTimer') as number) - dt); },
  exit(e)         { tag(e).setTag(SEEN_ENEMY, false); tag(e).setTag(THREAT_GONE, false); },
};

const combatHandler: IStateHandler = {
  enter(e)        { tag(e).setTag('anim', 'combat'); },
  update(e, dt)   { /* attack logic */ },
  exit(e)         {}
};

const registry = new AIStateRegistry()
  .register('IDLE', {
    handler: idleHandler,
    tags: ['passive'],
    transitionConditions: [
      { targetState: 'ALERT', priority: 10, condition: e => tag(e).getTag(SEEN_ENEMY) === true },
    ],
  })
  .register('ALERT', {
    handler: alertHandler,
    tags: ['active'],
    transitionConditions: [
      { targetState: 'COMBAT',  priority: 20, condition: e => tag(e).getTag(SEEN_ENEMY) === true },
      { targetState: 'IDLE',    priority:  5, condition: e => (tag(e).getTag('alertTimer') as number) <= 0 },
    ],
    canEnter: (e, from) => (tag(e).getTag(HP) as number) > 0,
  })
  .register('COMBAT', {
    handler: combatHandler,
    tags: ['hostile', 'active'],
    transitionConditions: [
      { targetState: 'ALERT', priority: 10, condition: e => tag(e).getTag(THREAT_GONE) === true },
    ],
    canExit: (e, to) => to !== 'IDLE',
  });

const fsm = new StateMachine(npcEntity, registry, 'IDLE');

// Subscribe to combat entry
fsm.onEnter('COMBAT', () => playSound('combat_music'));
fsm.onChange((from, to) => logger.debug(`NPC FSM: ${from} → ${to}`));

// Game loop
function tick(deltaSeconds: number) {
  fsm.update(deltaSeconds);
}
```

---

## Tips

**Per-NPC mutable state — extend `IEntity` in your project.**
`IEntity` is read-mostly — it has no `setTag`/`getTag`. Store per-NPC data in
your own entity class or component, then cast inside handlers:

```ts
interface MyNpc extends IEntity {
  getTag(key: string): unknown;
  setTag(key: string, val: unknown): void;
}

const handler: IStateHandler = {
  enter(entity) {
    (entity as MyNpc).setTag('alertTimer', 3);
  },
  // ...
};
```

**One registry, many FSMs.** A single `AIStateRegistry` instance can be shared
across all NPCs of the same type. Each `StateMachine` has its own `currentState`
but reads handlers from the shared registry.

```ts
const guardRegistry = new AIStateRegistry();
guardRegistry.register('IDLE', { handler: idleHandler });

const fsm1 = new StateMachine(npc1, guardRegistry, 'IDLE');
const fsm2 = new StateMachine(npc2, guardRegistry, 'IDLE');
```

**Store state in the entity, not the handler.** Handlers are stateless objects
shared across all FSMs. Any per-NPC state (timers, counters) must live on the
entity.

**Tags for group queries.** Use `hasTag('hostile')` instead of checking
`fsm.state === 'COMBAT' || fsm.state === 'CHASE'` — it survives state renames
and works across different NPC archetypes.

**Priority ties.** When two `transitionConditions` share the same priority and
both fire in the same frame, the one that was registered first wins.
