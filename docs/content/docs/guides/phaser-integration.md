# Phaser Integration

If you are integrating with Phaser 3, use `@alife-sdk/phaser`. It provides the adapters and bootstrap helpers for a scene-level integration.

## What this package gives you

- `createPhaserKernel()` to wire common packages in one call
- `PhaserEntityAdapter` for sprite access and mutation
- `PhaserEntityFactory` for entity creation and cleanup
- `PhaserSimulationBridge` for HP and offline damage plumbing
- `PhaserPlayerPosition` for online/offline distance checks
- `OnlineOfflineManager` for pure transition decisions

## Recommended flow

1. Create the player sprite
2. Create the four adapters
3. Call `createPhaserKernel()`
4. Register terrains and factions
5. Register NPCs
6. Call `kernel.update(delta)` every frame
7. Periodically run `onlineOffline.evaluate(...)` and apply `sim.setNPCOnline()`

## Minimal scene

```ts
import { createDefaultBehaviorConfig } from '@alife-sdk/simulation';

const result = createPhaserKernel({
  ports: {
    entityAdapter: adapter,
    entityFactory: factory,
    playerPosition: new PhaserPlayerPosition(player),
    simulationBridge: bridge,
  },
  data: {
    factions: [{ id: 'stalker', displayName: 'Stalker' }],
    terrains: [campTerrain],
  },
  config: { preset: 'simulation' },
});

const { kernel, simulation, onlineOffline } = result;

kernel.init();

simulation!.registerNPC({
  entityId: 'stalker_1',
  factionId: 'stalker',
  position: { x: 300, y: 280 },
  rank: 3,
  combatPower: 50,
  currentHp: 100,
  behaviorConfig: createDefaultBehaviorConfig({
    retreatThreshold: 0.3,
    panicThreshold: -0.6,
  }),
  options: { type: 'human' },
});

kernel.start();
```

`createDefaultBehaviorConfig` comes from `@alife-sdk/simulation`.

## Presets

| Preset | Includes | Use it when |
|---|---|---|
| `minimal` | Core factions and spawn wiring | You are still assembling the scene shell |
| `simulation` | Adds `SimulationPlugin` | You want offline NPC behavior first |
| `full` | Adds AI and social plugins | You need AI and social systems in the same scene |

## Online/offline handoff in Phaser

`OnlineOfflineManager` is intentionally pure. It does not mutate anything by itself.

```ts
const { goOnline, goOffline } = onlineOffline.evaluate(player.x, player.y, records);

for (const id of goOnline) simulation!.setNPCOnline(id, true);
for (const id of goOffline) simulation!.setNPCOnline(id, false);
```

That design keeps the handoff explicit: you control when to evaluate, how often to evaluate, and what extra scene-side sync runs around the handoff.

## Common mistakes in Phaser projects

### 1. Forgetting `kernel.update(delta)`

Without it, the kernel clock and plugins do not advance.

### 2. Passing `time` instead of `delta`

Use Phaser's second `update(_time, delta)` argument, not the absolute running time.

### 3. Registering NPCs before the adapter knows the sprite

Make sure the sprite is registered with `PhaserEntityAdapter` before the simulation tries to drive it.

### 4. Never calling `onlineOffline.evaluate()`

The manager does not schedule itself. If you never evaluate it, NPCs stay in whatever state they started in.

### 5. Omitting `behaviorConfig` on NPC registration

Always pass `behaviorConfig` (for example via `createDefaultBehaviorConfig(...)`) when calling `registerNPC(...)`.

## When to leave Phaser docs and read package docs

- Need the adapter details: [Phaser package](/packages/phaser)
- Need the real-time AI layer: [AI package](/packages/ai)
- Need the background world loop: [Simulation package](/packages/simulation)
- Need a runnable browser reference: [Examples](/examples/)
