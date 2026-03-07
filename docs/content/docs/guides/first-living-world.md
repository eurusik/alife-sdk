# First Living World

This is the first milestone that matters: one terrain, one faction setup, one NPC, one tick, one observable event.

Do this before you worry about rendering, combat feel, or save slots.

## What you are building

By the end of this guide you should have:

- a kernel that starts cleanly
- at least one `SmartTerrain`
- at least one registered NPC
- a tick loop that advances the simulation
- an event subscription proving the world is alive

## Start with the in-memory world

```ts
import { createInMemoryKernel } from '@alife-sdk/simulation';
import { FactionBuilder, SmartTerrain } from '@alife-sdk/core';

const { kernel, sim, factions } = createInMemoryKernel({ tickIntervalMs: 5_000 });

factions.factions.register('stalker', new FactionBuilder('stalker').build());

sim.addTerrain(new SmartTerrain({
  id: 'camp',
  name: 'Camp',
  bounds: { x: 0, y: 0, width: 200, height: 200 },
  capacity: 6,
  jobs: [{ type: 'patrol', slots: 3 }],
}));

sim.registerNPC({
  entityId: 'wolf',
  factionId: 'stalker',
  position: { x: 50, y: 50 },
  rank: 2,
  combatPower: 50,
  currentHp: 100,
  options: { type: 'human' },
});

kernel.events.on('alife:tick', ({ tick }) => console.log('tick', tick));
kernel.update(5_001);
```

## Why this path works

`createInMemoryKernel()` removes the early integration noise:

- no engine adapters to implement yet
- no rendering layer to debug
- no `ISimulationBridge` setup yet
- no scene lifecycle issues

It lets you learn the real model: factions, terrains, NPC records, brains, ticks, and events.

## Then move to the real integration

Once the minimal loop works, move in this order:

1. Replace no-op ports with your real engine adapters
2. Add a real `ISimulationBridge` so damage and liveness map to your entities
3. Decide when NPCs are online vs offline
4. Add `@alife-sdk/ai` only when online NPCs need richer per-frame behavior

## First checklist

Before moving on, verify all of these:

- `kernel.start()` is called before your loop
- `kernel.update(deltaMs)` runs repeatedly
- at least one terrain is registered
- at least one NPC is registered after initialization
- you can observe `TICK`, `NPC_MOVED`, or `TASK_ASSIGNED`

## Common mistake at this stage

If the NPC does nothing, the problem is usually not “AI is broken”. It is one of these:

- no terrain exists, so the brain has nowhere to go
- the kernel never started
- the update loop is not running
- the NPC was marked online but no online AI is driving it

## Next pages

- [Quick Start](/quick-start)
- [Online vs Offline](/concepts/online-offline)
- [Phaser Integration](/guides/phaser-integration)
- [Custom Engine](/guides/custom-engine)
