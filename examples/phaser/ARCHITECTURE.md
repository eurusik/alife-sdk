# Phaser Showcase Architecture

This example is intentionally split into small setup modules so a new developer can read it top-down.

## Entry Point

- Scene orchestrator: `examples/phaser/src/GameScene.ts`
- Rule of thumb: scene coordinates systems; setup modules build systems.
- Minimal first-read: `examples/phaser/src/minimal/MinimalIntegrationScene.ts`

## Integration in 5 Steps

Use this order when integrating into your own Phaser scene:

1. Build Phaser ports (`PhaserEntityAdapter`, `PhaserSimulationBridge`, `PhaserEntityFactory`, `PhaserPlayerPosition`).
2. Call `createPhaserKernel(...)` (or `setupKernel.ts` in this example).
3. Start lifecycle with `kernel.init()` then `kernel.start()`.
4. Register NPC records through `simulation.registerNPC(...)`.
5. Call `kernel.update(delta)` every frame in Phaser `update()`.

If you only need this path, stop there. Everything else in the showcase is optional.

## Module Map

### Static setup (create-time)

- `examples/phaser/src/scene/setupTextures.ts`
  - Registers all sprite textures used by the demo.
- `examples/phaser/src/scene/worldLayer.ts`
  - Draws background/zones and returns terrain + spawn positions.
- `examples/phaser/src/scene/setupInput.ts`
  - Creates keyboard bindings (`WASD`, arrows, `G`, `H`).
- `examples/phaser/src/scene/setupKernel.ts`
  - Boots `createPhaserKernel` and returns kernel/simulation/ports.
- `examples/phaser/src/scene/registerNpcData.ts`
  - Registers NPCs in render + simulation layers.
- `examples/phaser/src/scene/setupGoapPlanner.ts`
  - Creates shared GOAP planner and actions.
- `examples/phaser/src/scene/setupNpcAiBundles.ts`
  - Creates per-NPC state machine + memory bundle + labels.
- `examples/phaser/src/scene/hudLayer.ts`
  - Builds static HUD widgets and returns references.
- `examples/phaser/src/scene/setupCombat.ts`
  - Builds combat system + click-to-shoot binding.
- `examples/phaser/src/scene/setupSceneEvents.ts`
  - Wires kernel events to scene callbacks.

### Runtime services (frame-time)

- `examples/phaser/src/scene/services/SimulationOwnershipService.ts`
  - Online/offline handoff, offline wandering, simulation->HP sync.
- `examples/phaser/src/scene/services/HudRuntime.ts`
  - Draws dynamic overlays and drives ticker/event log.

## SDK to Phaser Responsibility Map

| SDK/Adapter | Phaser-side responsibility |
|---|---|
| `ALifeKernel` | Main simulation lifecycle (`init`, `start`, `update`) |
| `SimulationPlugin` | NPC registration and data queries |
| `PhaserEntityAdapter` | Resolve Phaser sprites by entity id |
| `PhaserSimulationBridge` | Mirror HP/state between simulation and render systems |
| `PhaserPlayerPosition` | Expose player coordinates to online/offline logic |
| `OnlineOfflineManager` | Decide which NPCs should be online each frame |

## Frame Flow (`update`)

1. Player movement input.
2. Kernel update.
3. Offline NPC visual movement.
4. Online/offline ownership swap.
5. Danger decay.
6. Grenade throw trigger.
7. Grenade runtime update.
8. NPC AI runtime update.
9. Bullet hit checks.
10. HUD overlays draw.
11. Player label positioning.
12. Status ticker refresh.

This order is important because AI decisions should consume already-updated simulation and danger state.

## Why This Split

- New contributors can inspect one concern per file.
- Behavior changes are localized (combat, events, hud, ownership).
- Scene code stays readable and acts like a high-level tutorial.

## Extension Points

- Add new AI actions: `setupGoapPlanner.ts`
- Add new world zones/spawns: `worldLayer.ts`
- Add new HUD blocks: `hudLayer.ts` + `HudRuntime.ts`
- Add new event reactions: `setupSceneEvents.ts`

## Optional Layers

- Combat loop: `setupCombat.ts` + `systems/CombatSystem.ts`
- Grenade hazards: `systems/GrenadeSystem.ts`
- Online AI behavior/GOAP: `setupGoapPlanner.ts`, `setupNpcAiBundles.ts`, `systems/NpcAiSystem.ts`
- Showcase HUD: `hudLayer.ts` + `services/HudRuntime.ts`

Remove these layers for a production "first integration" prototype and add them incrementally.
