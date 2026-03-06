# @alife-sdk/phaser

## 0.4.0

### Patch Changes

- f9b73d2: DX ergonomics improvements

  **`@alife-sdk/core`**

  - `Blackboard.getOr(key, defaultValue)` — typed helper that returns `defaultValue` when the key is absent or null (does not treat `0` or `false` as absent)
  - `WorldState.from(record)` — preferred factory for building world state from a plain object
  - `GOAPActionDef` plain-object interface — use `planner.registerAction({...})` without subclassing `GOAPAction`
  - `createDefaultBehaviorConfig()` — factory for NPC behavior config with sensible defaults

  **`@alife-sdk/phaser`**

  - Fix: clear GOAP plan on COMBAT state exit so stale plans are not replayed after returning to patrol

- Updated dependencies [f9b73d2]
  - @alife-sdk/core@0.4.0
  - @alife-sdk/ai@0.4.0
  - @alife-sdk/simulation@0.4.0
  - @alife-sdk/social@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [975b346]
  - @alife-sdk/core@0.3.0
  - @alife-sdk/ai@0.3.0
  - @alife-sdk/simulation@0.3.0
  - @alife-sdk/social@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [1561ac3]
  - @alife-sdk/simulation@0.2.0

## 0.1.1

### Patch Changes

- d295045: Fix CI lint errors and unused variable warnings in integration tests
- Updated dependencies [d295045]
  - @alife-sdk/ai@0.1.1
  - @alife-sdk/core@0.1.1
  - @alife-sdk/simulation@0.1.1
  - @alife-sdk/social@0.1.1
