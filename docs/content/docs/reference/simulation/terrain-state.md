# Simulation Terrain State

Use this page when NPCs look aimless, terrains are not affecting behavior as expected, or smart-terrain jobs are not producing stable offline behavior.

This module combines three runtime layers:

- terrain threat state
- terrain selection
- job slot assignment

## Import path

```ts
import {
  TerrainStateManager,
  TerrainState,
  TerrainSelector,
  resolveScheme,
  JobSlotSystem,
  TaskPositionResolver,
} from "@alife-sdk/simulation/terrain";
```

## Minimal setup

```ts
const state = new TerrainStateManager(
  "military_base",
  config.terrainState,
  kernel.events,
);

state.escalate(TerrainState.COMBAT, gameTimeMs);
state.tickDecay(gameTimeMs);
```

That gives one terrain a threat FSM:

- `PEACEFUL`
- `ALERT`
- `COMBAT`

It also emits `alife:terrain_state_changed` on transitions.

## Minimal terrain selection

```ts
const best = TerrainSelector.selectBest({
  terrains: allTerrains,
  npcFaction: "loner",
  npcPos: npc.position,
  npcRank: npc.rank,
  morale: npc.morale,
  surgeActive: surge.isActive,
  leaderTerrainId: squadLeaderTerrainId,
  allowedTags: null,
  config: simulationConfig.terrainSelector,
  occupantId: npc.id,
});
```

This is the scoring seam that decides where an offline NPC should want to be.

## Minimal job-slot flow

```ts
const slots = JobSlotSystem.buildSlots(terrain);

const slot = JobSlotSystem.pickBestSlot(
  slots,
  {
    npcId: npc.id,
    factionId: npc.factionId,
    rank: npc.rank,
    position: npc.position,
    weaponType: npc.weaponType,
  },
  isNight,
  terrainState,
  simulationConfig.jobScoring,
);

if (slot) {
  JobSlotSystem.assignNPC(slot, npc.id);
}
```

## What each layer owns

### `TerrainStateManager`

Owns one terrain's escalation and decay state.

Use it when hostile presence, recent combat, or elapsed time should change how the terrain is treated by brains.

### `TerrainSelector`

Owns candidate scoring across terrains.

It is where faction fit, distance, morale pressure, surge shelter needs, and leader preference are combined into one terrain choice.

### `resolveScheme`

Owns conditional scheme resolution such as day/night or peaceful/combat behavior variants.

### `JobSlotSystem`

Owns slot building, scoring, assignment, release, and capacity checks inside the chosen terrain.

### `TaskPositionResolver`

Owns where the NPC should move once a job or route is chosen.

## Practical debugging rule

Terrain bugs often look like AI bugs.

If an NPC never settles into stable behavior, check in this order:

1. is a valid terrain being selected
2. is the terrain in the expected threat state
3. is there a reachable job slot for that terrain
4. did task position resolution return something sensible

## Failure patterns

- all terrains score too low, so NPCs never settle anywhere meaningful
- no shelter terrain exists when surge logic expects one
- jobs exist in data but their slot preconditions make them effectively unreachable
- terrain state never escalates or never decays, so brains read stale danger context
- task positions resolve to bad routes or unusable coordinates

## Related pages

- [Simulation package](/docs/packages/simulation)
- [Simulation Brains](/docs/reference/simulation/brains)
