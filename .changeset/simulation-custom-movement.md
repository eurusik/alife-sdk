---
"@alife-sdk/simulation": minor
---

Add `movementSimulator` config option to `SimulationPlugin`

Hosts can now inject any `IMovementSimulator` implementation directly into
`SimulationPlugin` via the `movementSimulator` field in the config object.
The custom simulator takes priority over `levelGraph` and the default
straight-line `MovementSimulator` — no SDK source changes required.

Use this to plug in PathfinderJS, EasyStar, a navmesh adapter, or any
grid-based pathfinder without modifying the SDK.
