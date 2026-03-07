# Custom Engine

If you are not using Phaser, the SDK still fits cleanly. The integration boundary is the port layer.

## What you implement

At minimum, most real integrations provide:

| Port | Why the SDK needs it |
|---|---|
| `IEntityAdapter` | Read and write entity position, visibility, and other narrow engine operations |
| `IEntityFactory` | Spawn and destroy entities when the SDK requests it |
| `IPlayerPositionProvider` | Decide which NPCs should be considered close to the player |
| `ISimulationBridge` | Let offline simulation query liveness, apply damage, and adjust morale |

## Skeleton setup

```ts
kernel.provide(Ports.EntityAdapter, myEntityAdapter);
kernel.provide(Ports.EntityFactory, myEntityFactory);
kernel.provide(Ports.PlayerPosition, myPlayerPositionProvider);
kernel.provide(SimulationPorts.SimulationBridge, mySimulationBridge);

kernel.use(new FactionsPlugin());
kernel.use(new SimulationPlugin({ tickIntervalMs: 5_000 }));

kernel.init();
kernel.start();
```

## `ISimulationBridge` is the critical piece

This is the one bridge the simulation package truly depends on for real gameplay state.

```ts
class MyEngineBridge implements ISimulationBridge {
  isAlive(entityId: string): boolean {
    return this.entities.get(entityId)?.health.isAlive ?? false;
  }

  applyDamage(entityId: string, amount: number, damageTypeId: string): boolean {
    const entity = this.entities.get(entityId);
    if (!entity) return false;
    entity.health.applyDamage(this.immunity.reduce(entity, amount, damageTypeId));
    return !entity.health.isAlive;
  }

  getEffectiveDamage(entityId: string, rawDamage: number, damageTypeId: string): number {
    const entity = this.entities.get(entityId);
    return entity ? this.immunity.reduce(entity, rawDamage, damageTypeId) : 0;
  }

  adjustMorale(entityId: string, delta: number): void {
    this.entities.get(entityId)?.alife.adjustMorale(delta);
  }
}
```

## Online/offline handoff

This is where many custom integrations get muddy. Keep it explicit.

### When an NPC goes online

- read the authoritative brain state you care about
- sync morale and position into the live entity
- call `sim.setNPCOnline(id, true)`

### When an NPC goes offline

- write the live entity position back into the record
- call `sim.setNPCOnline(id, false)`

## Game-loop contract

```ts
function gameLoop(deltaMs: number) {
  sim.setNPCOnline('npc_soldier_1', playerIsNear('npc_soldier_1'));
  kernel.update(deltaMs);
}
```

Do the online/offline decision before `kernel.update(deltaMs)` so the current frame sees the right ownership model.

## Event-first integration

Do not poll the world for everything. React to the SDK:

```ts
kernel.events.on('alife:npc_died', ({ npcId }) => vfx.playDeathEffect(npcId));
kernel.events.on('surge:warning', ({ timeUntilSurge }) => hud.showSurgeCountdown(timeUntilSurge));
kernel.events.on('ai:npc_panicked', ({ npcId }) => audio.playDistantScream(npcId));
```

## Performance tuning for bigger worlds

| Scale | Suggested settings |
|---|---|
| ~50 NPCs | Defaults are usually fine |
| ~150 NPCs | Raise `tickIntervalMs` to about `8_000` |
| ~300 NPCs | `tickIntervalMs: 10_000`, `maxBrainUpdatesPerTick: 30` |
| ~500 NPCs | Increase interval again and lower combat resolution budgets |

The important mental model is that offline CPU cost is budgeted. You do not pay full AI cost for every NPC every frame.

## Related next pages

- [Ports](/concepts/ports)
- [Simulation package](/packages/simulation)
- [Troubleshooting](/guides/troubleshooting)
