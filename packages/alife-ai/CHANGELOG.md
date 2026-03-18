# @alife-sdk/ai

## 0.5.0

### Minor Changes

- 71f8b4d: ### @alife-sdk/ai

  **New features:**

  - `OnlineAIDriver.forceTransition(stateId)` — control FSM transitions from outside state handlers
  - `OnlineAIDriver.onTransition(callback)` — event hook with unsubscribe for state change notifications
  - `INPCOnlineState.custom` — extensible `Record<string, unknown>` bag for game-specific data (GOAP plans, ammo, personality)
  - `IPathfindingAccess` — pluggable pathfinding subsystem interface (A\*, NavMesh, etc.) with `findPath()`, `getNextWaypoint()`, `setPath()`, `isNavigating()`, `clearPath()`
  - `moveAlongPath()` utility — pathfinding-aware movement that falls back to `moveToward()` when no pathfinder is registered
  - `GOAPDirector` — built-in GOAP-to-FSM bridge handler with declarative action handlers, interrupt system, automatic replanning, and empty-plan cooldown
  - `IGOAPPlannerLike` — minimal planner interface for GOAPDirector (accepts GOAPPlanner or custom wrappers without `as unknown` casts)

  **Bug fixes:**

  - `CoverAccessAdapter` now normalizes cover type strings to lowercase (`'CLOSE'` → `'close'`), fixing silent `null` returns from `CombatState.findCover()`

  ### @alife-sdk/phaser

  - `PhaserNPCContext` and `IPhaserNPCSystemBundle` now support the `pathfinding` field from `IPathfindingAccess`

## 0.4.1

### Patch Changes

- 624728d: Fix 94 bugs across all SDK packages, add ~770 regression tests

  **State handlers**: ChargeState timeout, CombatState cover cooldown/targetId/morale guard, RetreatState NaN sentinel/time limit, FleeState safe transition/origin fix, WoundedState medkit cooldown, TakeCoverState field aliasing, IdleState/PatrolState corpse dedup, CampState/SleepState false enemy broadcast, EvadeGrenadeState configurable duration/premature exit, KillWoundedState target refresh

  **GOAP**: fix restore index, remove abort on SUCCESS, fix prevAction abort, freeze goal singletons, remove ENEMY_PRESENT from critical goal

  **Navigation**: PathSmoother arc sweep wrapping, SmoothPathFollower getter mutation, Pathfinder fractional costs, Grid O(1) BFS, NPCGraphMover maxSteps

  **Combat**: GrenadeOpportunityRule conditions, CombatTransitionHandler transition map, LoadoutBuilder maxAmmo, OfflineCombatResolver HP check/pool fix

  **Map generation**: PoissonDisk seed retry, PropsPass bounds/occupation/collider, MapGenerator seed capture, MapScorer Gini/breakdown, ZoneTemplate Y-flip

  **Simulation**: SurgeManager entityId, NPCBrain dispatch/slots, SquadManager destroy, Squad morale, TraderInventory baseline

  **Core**: StateMachine injectable clock/history cap, Clock hour skip, DangerManager escape direction, SuspicionAccumulator threshold, Rng weightedPick/fork, ReactiveQuery swap, SpatialGrid bounds, GOAPPlanner hash

  **Social/Economy**: CampfireFSM stale bubbles/aliasing, ContentPool loop cap, PricingEngine sell price, QuestEngine zero-increment, NPCRelationRegistry safe split

  **Breaking**: renamed `lastSupressiveFireMs` → `lastSuppressiveFireMs`, `stalkUnclockDistance` → `stalkUncloakDistance`, removed dead fields

- Updated dependencies [624728d]
  - @alife-sdk/core@0.4.1

## 0.4.0

### Patch Changes

- Updated dependencies [f9b73d2]
  - @alife-sdk/core@0.4.0

## 0.3.0

### Patch Changes

- Updated dependencies [975b346]
  - @alife-sdk/core@0.3.0

## 0.1.1

### Patch Changes

- d295045: Fix CI lint errors and unused variable warnings in integration tests
- Updated dependencies [d295045]
  - @alife-sdk/core@0.1.1
