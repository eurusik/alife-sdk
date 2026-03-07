# Simulation Brains

Use this page when you need to understand the authoritative offline runtime for one NPC.

If an NPC is not currently being driven by expensive real-time behavior, its brain is the thing that keeps it alive in the world model.

## Import path

```ts
import {
  NPCBrain,
  HumanBrain,
  MonsterBrain,
  BrainScheduleManager,
} from "@alife-sdk/simulation/brain";
```

## What a brain owns

One simulation record has one brain.

That brain owns or influences:

- current terrain
- current task
- morale pressure
- schedule handling
- terrain re-evaluation
- movement dispatch requests
- some state that must survive online/offline handoff

## Class hierarchy

| Class | Use it for |
|---|---|
| `NPCBrain` | common offline decision loop |
| `HumanBrain` | schedule-aware, equipment-aware humanoid NPCs |
| `MonsterBrain` | lair-driven monsters with different terrain preferences |

## What you create

In most production usage, the plugin creates and rebuilds brains for you through NPC registration.

You care about this page because you still need to understand:

- what state the brain owns
- what data must stay coherent across handoff
- which extension hooks exist
- what the update loop is actually doing

## Minimal setup

Direct construction looks like this:

```ts
const brain = new NPCBrain({
  npcId: "npc_sid",
  factionId: "loner",
  config: config.brain,
  selectorConfig: config.terrainSelector,
  jobConfig: config.jobScoring,
  deps: {
    clock: gameTimeManager,
    events: aLifeEventBus,
  },
});
```

### What you still need to inject

The brain also needs a movement seam if it should actually dispatch travel:

```ts
brain.setMovementDispatcher(movementDispatcher);
```

That dispatcher is the bridge between offline decisions and whatever world-position update model your simulation uses.

## Minimal lifecycle

At a high level the brain lifecycle is:

1. construct or rebuild the brain
2. attach movement dispatcher if needed
3. let the simulation tick call `brain.update(...)`
4. read brain-owned state during online handoff
5. write host-owned state back before returning offline
6. rebuild after restore when required

## Update loop

The important offline loop is:

1. skip dead or combat-locked records
2. process day/night schedule logic
3. evaluate scheme conditions
4. re-score terrains when timers or pressure demand it
5. react to surge and morale conditions
6. keep or replace the current task
7. dispatch movement toward the chosen destination

That means brain bugs usually show up as:

- terrain churn
- no task assignment
- bad handoff state
- NPCs that “exist” but do not progress

## State you should treat as authoritative

When an NPC goes online, these brain fields are often the ones you want to read:

- `currentTerrainId`
- `currentTask`
- `morale`
- `lastPosition`
- `rank`
- `dangerTolerance`

When an NPC goes offline again, the minimum state you usually need to write back is:

- current live position
- coherent HP through the simulation bridge
- coherent morale through the simulation bridge or explicit sync

## Key API you will actually care about

| Member | Why you care |
|---|---|
| `update(deltaMs, terrains, terrainStates)` | advances one offline tick |
| `currentTask` | current job slot assignment |
| `currentTerrainId` | current terrain ownership |
| `setMorale()` | external morale correction or sync |
| `setLastPosition()` | sync live position back before going offline |
| `setSurgeActive()` | lets world events alter offline behavior |
| `setMovementDispatcher()` | gives the brain a path to dispatch travel |
| `forceReevaluate()` | useful when external state invalidates current terrain choice |
| `releaseFromTerrain()` | detach from current terrain and task |
| `onDeath()` | terminal cleanup and death signaling |

## Save / restore rule

Brains themselves are not the durable artifact you should think of as “the save”.

The restore flow typically looks like this:

1. restore NPC records and simulation state
2. rebuild brains from restored records
3. reattach any runtime-only references like dispatchers

If a team skips step 2, the restore may look superficially correct while the actual offline runtime is broken.

## Extension hooks

The intended extension points are not “fork the entire update loop”.

The main hooks are:

- terrain selection customization
- job context customization

That is how you add special preferences without rewriting the whole decision machine.

## Failure patterns

- no terrains registered, so the brain has nowhere meaningful to go
- online NPC state is synced into the host, but the host position is never written back before going offline
- restore rebuilds records but not brains
- re-evaluation timers are too aggressive, causing terrain thrash
- movement dispatcher is missing, so decisions exist but movement never manifests

## Related pages

- [Simulation package](/docs/packages/simulation)
- [Simulation Terrain State](/docs/reference/simulation/terrain-state)
- [Online vs Offline](/docs/concepts/online-offline)
- [NPC Lifecycle](/docs/concepts/npc-lifecycle)
