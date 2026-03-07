# @alife-sdk/simulation

This is the off-screen world layer. It is what makes the SDK feel like a living world instead of a collection of isolated actors.

## Install

```bash
npm install @alife-sdk/simulation @alife-sdk/core
```

## Add it when

- NPCs should keep living while the player is elsewhere
- you need background combat, morale, and terrain behavior
- your world should keep progressing off-screen

## Fastest first step

Use `createInMemoryKernel()` if you want to understand the model before wiring real entities:

```ts
const { kernel, sim, factions } = createInMemoryKernel({ tickIntervalMs: 5_000 });
```

## Start here

1. [Simulation Reference](/docs/reference/simulation/index)
2. [Simulation Brains](/docs/reference/simulation/brains)
3. [Simulation Terrain State](/docs/reference/simulation/terrain-state)

## Most used

- [Online vs Offline](/docs/concepts/online-offline)
- [NPC Lifecycle](/docs/concepts/npc-lifecycle)
- [Custom Engine](/docs/guides/custom-engine)

## Debug this package

- NPCs feel frozen or dead off-screen -> [Simulation Brains](/docs/reference/simulation/brains)
- NPCs choose bad terrains or no jobs -> [Simulation Terrain State](/docs/reference/simulation/terrain-state)
- Ownership handoff feels incoherent -> [Online vs Offline](/docs/concepts/online-offline)

## Production integration contract

The critical seam is `ISimulationBridge`. It answers for the simulation:

- is the entity alive
- how damage is applied
- how effective damage is calculated
- how morale is adjusted

## Package README

- [Package README](https://github.com/eurusik/alife-sdk/blob/main/packages/alife-simulation/README.md)

## Related pages

- [Simulation Reference](/docs/reference/simulation/index)
- [AI package](/docs/packages/ai)
- [Online vs Offline](/docs/concepts/online-offline)
