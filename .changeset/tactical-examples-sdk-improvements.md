---
"@alife-sdk/ai": minor
"@alife-sdk/phaser": patch
---

### @alife-sdk/ai

**New features:**

- `OnlineAIDriver.forceTransition(stateId)` — control FSM transitions from outside state handlers
- `OnlineAIDriver.onTransition(callback)` — event hook with unsubscribe for state change notifications
- `INPCOnlineState.custom` — extensible `Record<string, unknown>` bag for game-specific data (GOAP plans, ammo, personality)
- `IPathfindingAccess` — pluggable pathfinding subsystem interface (A*, NavMesh, etc.) with `findPath()`, `getNextWaypoint()`, `setPath()`, `isNavigating()`, `clearPath()`
- `moveAlongPath()` utility — pathfinding-aware movement that falls back to `moveToward()` when no pathfinder is registered
- `GOAPDirector` — built-in GOAP-to-FSM bridge handler with declarative action handlers, interrupt system, automatic replanning, and empty-plan cooldown
- `IGOAPPlannerLike` — minimal planner interface for GOAPDirector (accepts GOAPPlanner or custom wrappers without `as unknown` casts)

**Bug fixes:**

- `CoverAccessAdapter` now normalizes cover type strings to lowercase (`'CLOSE'` → `'close'`), fixing silent `null` returns from `CombatState.findCover()`

### @alife-sdk/phaser

- `PhaserNPCContext` and `IPhaserNPCSystemBundle` now support the `pathfinding` field from `IPathfindingAccess`
