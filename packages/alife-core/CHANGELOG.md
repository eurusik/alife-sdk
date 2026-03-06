# @alife-sdk/core

## 0.4.0

### Minor Changes

- f9b73d2: DX ergonomics improvements

  **`@alife-sdk/core`**

  - `Blackboard.getOr(key, defaultValue)` — typed helper that returns `defaultValue` when the key is absent or null (does not treat `0` or `false` as absent)
  - `WorldState.from(record)` — preferred factory for building world state from a plain object
  - `GOAPActionDef` plain-object interface — use `planner.registerAction({...})` without subclassing `GOAPAction`
  - `createDefaultBehaviorConfig()` — factory for NPC behavior config with sensible defaults

  **`@alife-sdk/phaser`**

  - Fix: clear GOAP plan on COMBAT state exit so stale plans are not replayed after returning to patrol

## 0.3.0

### Minor Changes

- 975b346: Add BehaviorTree, EntityHandles, ReactiveQuery, and extended FSM API

  **BehaviorTree** — composable behavior execution system with 10 node types:

  - Composites: `Sequence` (AND gate), `Selector` (OR gate), `Parallel` (`require-all` / `require-one` policies)
  - Decorators: `Inverter`, `AlwaysSucceed`, `AlwaysFail`, `Repeater`, `Cooldown`
  - Leaves: `Task`, `Condition`
  - `Blackboard<T>` typed shared state passed to every node on each tick
  - `ITreeNode<T>` interface for custom nodes

  **EntityHandleManager** — versioned handle system that eliminates use-after-free bugs:

  - Bit-packed handles (20-bit slot index + 28-bit generation counter)
  - `resolve()` returns `null` for stale or freed handles
  - Slot reuse detection via generation bumps
  - `NULL_HANDLE` sentinel for optional handle fields
  - Exported from `@alife-sdk/core/entity`

  **ReactiveQuery<T>** — predicate-based entity set observer:

  - `onChange` fires only when entities enter or exit the matched set (O(change), not O(n))
  - Manual `track()` / `untrack()` for special-case membership
  - `has()`, `size`, `current` for inspection
  - `dispose()` for cleanup
  - Exported from `@alife-sdk/core`

  **StateMachine extended API** (additive, no breaking changes):

  - `tags` and `metadata` on state definitions, queryable via `fsm.hasTag()` and `fsm.metadata`
  - Event subscriptions: `onEnter(state, cb)`, `onExit(state, cb)`, `onChange(cb)` — all return unsubscribe functions
  - `fsm.previous` — state before the last successful transition
  - `fsm.currentStateDuration` — milliseconds in the current state
  - `fsm.getHistory()` / `fsm.clearHistory()` — full transition log
  - `TransitionResult` now includes typed `reason`: `'not_allowed' | 'exit_guard' | 'enter_guard'`

## 0.1.1

### Patch Changes

- d295045: Fix CI lint errors and unused variable warnings in integration tests
