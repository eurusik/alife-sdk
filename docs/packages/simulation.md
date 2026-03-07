# @alife-sdk/simulation

This is the off-screen world layer. It is what makes the SDK feel like a living world instead of a collection of isolated actors.

## Install

```bash
npm install @alife-sdk/simulation @alife-sdk/core
```

## What it owns

- offline tick pipeline
- NPC records and brains
- terrain choice and task assignment
- low-cost movement and conflict resolution
- morale changes and surge-style world events
- `createInMemoryKernel()` for learning and tests

## Use it when

- NPCs should keep living while the player is elsewhere
- you need background combat, morale, and terrain behavior
- your game world should progress even off-screen

## A good first way to explore it

Use `createInMemoryKernel()` first if you want to understand the model before wiring real entities:

```ts
const { kernel, sim, factions } = createInMemoryKernel({ tickIntervalMs: 5_000 });
```

That gives you an already initialized and started runtime with no-op adapters.

## Production integration contract

The critical integration point is `ISimulationBridge`.

It answers four questions for the simulation:

- is this entity alive?
- how do I apply damage?
- how much effective damage would this be?
- how do I adjust morale?

## Minimal production sketch

```ts
kernel.provide(SimulationPorts.SimulationBridge, {
  isAlive: (id) => entities.get(id)?.health > 0,
  applyDamage: (id, dmg, type) => entities.get(id)?.takeDamage(dmg, type) ?? false,
  getEffectiveDamage: (id, dmg, type) => entities.get(id)?.getEffectiveDamage(dmg, type) ?? 0,
  adjustMorale: (id, delta) => { entities.get(id)?.morale.adjust(delta); },
});

kernel.use(new SimulationPlugin({ tickIntervalMs: 5_000 }));
kernel.init();
kernel.start();
```

## Core mental model

This package ticks only offline NPCs. When an NPC goes online, the host takes over.

```ts
sim.setNPCOnline(npcId, true);   // host owns moment-to-moment behavior
sim.setNPCOnline(npcId, false);  // simulation owns background progression again
```

## Online/offline handoff checklist

### When an NPC goes online

- sync any authoritative brain state you need into the live entity
- switch ownership with `sim.setNPCOnline(id, true)`

### When an NPC goes offline

- write the live position back into the record
- keep HP and morale coherent through the bridge
- call `sim.setNPCOnline(id, false)`

## Important behavior to remember

- offline NPCs are the ones the simulation actively ticks
- online NPCs are skipped by the tick pipeline
- if an NPC is marked online and nothing else drives it, it will appear frozen

## Performance knobs that matter most

| Knob | Why it matters |
|---|---|
| `tickIntervalMs` | How often the full background tick runs |
| `maxBrainUpdatesPerTick` | Caps how many brains update per tick |
| `reEvaluateIntervalMs` | Reduces terrain-churn cost in larger worlds |
| offline combat resolution limits | Keeps large hostile populations manageable |

## Practical scaling guidance

| World size | Starting point |
|---|---|
| ~50 NPCs | Defaults are usually fine |
| ~150 NPCs | Raise `tickIntervalMs` a bit |
| ~300 NPCs | Raise interval and brain budget together |
| ~500 NPCs | Increase interval again and lower some combat budgets |

## Common gotchas

- no terrains registered means brains have nowhere to go
- forgetting that offline mode is still active simulation, not pause
- manual low-level restore without rebuilding brains
- setting NPCs online before any host-side system is ready to drive them

## Read next

- [Online vs Offline](/concepts/online-offline)
- [NPC Lifecycle](/concepts/npc-lifecycle)
- [Custom Engine](/guides/custom-engine)
- [Package README](https://github.com/eurusik/alife-sdk/blob/main/packages/alife-simulation/README.md)
