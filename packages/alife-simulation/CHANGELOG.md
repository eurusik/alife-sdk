# @alife-sdk/simulation

## 0.3.0

### Patch Changes

- Updated dependencies [975b346]
  - @alife-sdk/core@0.3.0

## 0.2.0

### Minor Changes

- 1561ac3: Add `movementSimulator` config option to `SimulationPlugin`

  Hosts can now inject any `IMovementSimulator` implementation directly into
  `SimulationPlugin` via the `movementSimulator` field in the config object.
  The custom simulator takes priority over `levelGraph` and the default
  straight-line `MovementSimulator` — no SDK source changes required.

  Use this to plug in PathfinderJS, EasyStar, a navmesh adapter, or any
  grid-based pathfinder without modifying the SDK.

## 0.1.1

### Patch Changes

- d295045: Fix CI lint errors and unused variable warnings in integration tests
- Updated dependencies [d295045]
  - @alife-sdk/core@0.1.1
