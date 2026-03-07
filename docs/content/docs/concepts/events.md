# Events

Events are how the SDK keeps systems decoupled.

Instead of plugins importing each other directly, they publish outcomes and react to typed payloads.

## Deferred delivery

The kernel event bus is deferred:

- `emit()` queues the event
- `flush()` delivers it
- `kernel.update()` calls `flush()` automatically

That matters because systems can emit events during their own update without re-entering each other in unpredictable ways.

## Common event categories

| Category | Examples |
|---|---|
| A-Life | `NPC_MOVED`, `NPC_DIED`, `TASK_ASSIGNED` |
| AI | `STATE_CHANGED`, `SPOTTED_ENEMY`, `NPC_PANICKED` |
| Faction | `FACTION_CONFLICT`, `FACTION_RELATION_CHANGED` |
| Time | `HOUR_CHANGED`, `DAY_NIGHT_CHANGED` |
| Social | speech and presentation events |
| Hazards | zone damage and artefact events through the hazards plugin bus |

## Events worth listening to early

| Event | Why it is useful |
|---|---|
| `NPC_DIED` | Remove, respawn, reward, or react in quests |
| `NPC_MOVED` | Debug background world movement |
| `TASK_ASSIGNED` | Verify that brains are making decisions |
| `FACTION_CONFLICT` | Drive encounter logic, audio, or telemetry |
| `STATE_CHANGED` | Debug the online AI FSM |
| `HOUR_CHANGED` | Hook time-of-day systems |

## Example

```ts
kernel.events.on(ALifeEvents.NPC_DIED, ({ npcId, killedBy }) => {
  questSystem.onNpcKilled(npcId, killedBy);
});
```

## Core bus vs package-local buses

Most runtime-wide events come through `kernel.events`. Some packages also expose their own focused buses.

Example:

- `HazardsPlugin` owns a dedicated hazard event bus
- social systems can emit presentation-oriented output through their own plugin flow

Use the kernel bus for game-wide reactions. Use package-local buses when the subsystem has its own event model.

## Why this matters for game code

Events let you keep quest logic, UI, audio, telemetry, and gameplay reactions outside the SDK while still reacting to what the SDK is doing.
