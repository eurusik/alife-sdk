---
"@alife-sdk/core": minor
"@alife-sdk/phaser": patch
---

DX ergonomics improvements

**`@alife-sdk/core`**

- `Blackboard.getOr(key, defaultValue)` — typed helper that returns `defaultValue` when the key is absent or null (does not treat `0` or `false` as absent)
- `WorldState.from(record)` — preferred factory for building world state from a plain object
- `GOAPActionDef` plain-object interface — use `planner.registerAction({...})` without subclassing `GOAPAction`
- `createDefaultBehaviorConfig()` — factory for NPC behavior config with sensible defaults

**`@alife-sdk/phaser`**

- Fix: clear GOAP plan on COMBAT state exit so stale plans are not replayed after returning to patrol
