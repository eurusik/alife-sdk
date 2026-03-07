# Quests

Use this page when you need progression state, objective tracking, and quest events without coupling them to UI or authored narrative presentation.

`QuestEngine` is the progression-state subsystem of `@alife-sdk/economy`.

## Import path

```ts
import { QuestEngine } from "@alife-sdk/economy/quest";
```

## Minimal usage

```ts
const quests = new QuestEngine();

quests.on("quest:completed", ({ questId }) => {
  rewards.grantForQuest(questId);
});

quests.registerQuest({
  id: "q_first_steps",
  name: "First Steps",
  description: "Reach the village and eliminate the bandits.",
  objectives: [
    { id: "obj_reach", type: "reach_zone", target: "village", description: "Reach the village", count: 1, current: 0, completed: false },
    { id: "obj_kill", type: "kill", target: "bandit", description: "Kill 5 bandits", count: 5, current: 0, completed: false },
  ],
});

quests.startQuest("q_first_steps");
quests.completeObjective("q_first_steps", "obj_reach");
quests.updateObjectiveProgress("q_first_steps", "obj_kill", 5);
```

## Quest lifecycle

The lifecycle is intentionally small:

- `AVAILABLE`
- `ACTIVE`
- `COMPLETED`
- `FAILED`

That is enough for straightforward quest chains and event-driven progression without dragging in a giant quest framework.

## What the engine owns

`QuestEngine` owns:

- quest lifecycle
- objective progress
- prerequisite checks
- quest events
- optional terrain effects

It does not own:

- quest UI
- authored dialogue
- reward presentation
- narrative scripting

## Why events matter

Quest systems get messy when rewards, UI, audio, and world state are tightly coupled.

The event layer keeps those reactions separate:

- UI can react to progress
- rewards can react to completion
- world logic can react to fail/start/complete

without embedding all of that inside the quest engine.

## Prerequisites and chains

The `requires` field is the main quest-chain seam.

It lets you express:

- quest is visible but locked
- quest cannot start until others are completed

Practical rule:

`getAvailableQuests()` does not necessarily mean "currently startable". Use explicit startability checks when the UI must distinguish visible from unlocked.

## Terrain effects

Terrain effects let quest state influence world access through declarative lock/unlock actions.

If no terrain lock adapter is present, those effects are skipped instead of crashing the quest flow.

## Serialization rule

Register all quest definitions before restoring saved quest state.

This is one of the highest-signal integration rules in the subsystem. If restore runs before definitions exist, the engine cannot merge saved progress back into valid runtime quests.

## Failure patterns

- restoring quest state before registering all quest definitions
- mixing authored quest text with progression logic in one layer
- expecting `getAvailableQuests()` to mean "startable right now"
- wiring rewards directly into quest internals instead of reacting to events

## Related pages

- [Economy package](/docs/packages/economy)
- [Inventory](/docs/reference/economy/inventory)
- [Trade](/docs/reference/economy/trade)
