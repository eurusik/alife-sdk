# quest

`QuestEngine` — quest lifecycle FSM with objective tracking, reactive events,
declarative prerequisites, and terrain effects.

```ts
import { QuestEngine } from '@alife-sdk/economy/quest';
```

Pure state management — no rendering, no framework coupling.

---

## Quick start

```ts
import { QuestEngine } from '@alife-sdk/economy/quest';

const engine = new QuestEngine();

// 1. React to events (wire up rewards, UI, quest chains)
engine.on('quest:completed', ({ questId }) => {
  inventory.add(rewardMap[questId]);
});
engine.on('objective:progress', ({ questId, objectiveId, current, total }) => {
  ui.updateProgressBar(questId, objectiveId, current / total);
});

// 2. Register quest definitions (once, at boot)
engine.registerQuest({
  id: 'q_first_steps',
  name: 'First Steps',
  description: 'Reach the village and eliminate the bandits.',
  objectives: [
    { id: 'obj_reach', type: 'reach_zone', target: 'village', description: 'Reach the village', count: 1, current: 0, completed: false },
    { id: 'obj_kill',  type: 'kill',       target: 'bandit',  description: 'Kill 5 bandits',    count: 5, current: 0, completed: false },
  ],
  terrainEffects: [
    { terrainId: 'gulag_01', action: 'lock',   trigger: 'on_start'    },
    { terrainId: 'gulag_01', action: 'unlock', trigger: 'on_complete' },
  ],
});

// Quest chain: q_second requires q_first_steps to be completed
engine.registerQuest({
  id: 'q_second',
  name: 'Second Step',
  requires: ['q_first_steps'],   // blocked until q_first_steps is COMPLETED
  objectives: [...],
});

// 3. Start the quest
engine.startQuest('q_first_steps');           // AVAILABLE → ACTIVE

// 4. Track progress
engine.completeObjective('q_first_steps', 'obj_reach');         // zone reached
engine.updateObjectiveProgress('q_first_steps', 'obj_kill', 3); // +3 kills
engine.updateObjectiveProgress('q_first_steps', 'obj_kill', 2); // +2 → auto-completes
// → 'quest:completed' fires → q_second is now startable

// 5. Query state
engine.getActiveQuests();    // → []
engine.getCompletedQuests(); // → [{ id: 'q_first_steps', status: 'completed', ... }]
```

---

## Quest lifecycle

```
registerQuest()
      ↓
  AVAILABLE  ──startQuest()──►  ACTIVE  ──all objectives done──►  COMPLETED
  (requires            (requires met)         │
   must be met)                           failQuest()
                                              ↓
                                           FAILED
```

- `startQuest()` — transitions `AVAILABLE → ACTIVE`. Fails if `requires` are unmet.
  Applies `on_start` terrain effects. Emits `quest:started`.
- `completeObjective()` / `updateObjectiveProgress()` — track per-objective progress.
  When **all** objectives are done, auto-completes (`ACTIVE → COMPLETED`).
  Applies `on_complete` terrain effects. Emits `quest:completed`.
- `failQuest()` — transitions `ACTIVE → FAILED`.
  Applies `on_fail` terrain effects. Emits `quest:failed`.

---

## Registering quests

```ts
interface IQuestDefinition {
  id:             string;
  name:           string;
  description:    string;
  objectives:     IQuestObjective[];
  terrainEffects?: ITerrainEffect[];   // optional
  requires?:      string[];            // optional — quest IDs that must be COMPLETED first
}
```

Call `registerQuest()` before `startQuest()`. Re-registering an existing quest
is a no-op if the quest already has runtime state (safe to call at boot every time).

---

## Events

```ts
engine.on('quest:started',       ({ questId }) => { ... });
engine.on('quest:completed',     ({ questId }) => { ... });
engine.on('quest:failed',        ({ questId }) => { ... });
engine.on('objective:completed', ({ questId, objectiveId }) => { ... });
engine.on('objective:progress',  ({ questId, objectiveId, current, total }) => { ... });

// Remove a listener (pass the same callback reference)
engine.off('quest:completed', myCallback);
```

Full event payload types are available as `QuestEventMap`:

```ts
import type { QuestEventMap } from '@alife-sdk/economy/quest';
```

> **Kernel event forwarding**: When using `QuestEngine` through `EconomyPlugin`, quest events are
> also forwarded to the kernel's event bus. External systems can subscribe via
> `kernel.events.on('quest:completed', handler)` without a direct reference to the engine.

Typical use cases:

| Event | Use for |
|---|---|
| `quest:started` | Play dialogue, show notification |
| `quest:completed` | Give rewards (XP, items, money) |
| `quest:failed` | Restore world state, retry logic |
| `objective:progress` | Update HUD progress bar |
| `objective:completed` | Play sound, highlight next objective |

---

## Prerequisites (quest chains)

Use `requires` to declare that a quest can only start after other quests are COMPLETED:

```ts
engine.registerQuest({ id: 'q1', ... });
engine.registerQuest({ id: 'q2', requires: ['q1'], ... });
engine.registerQuest({ id: 'q3', requires: ['q1', 'q2'], ... }); // all must be done

engine.startQuest('q2'); // → false (q1 not completed yet)
engine.startQuest('q1');
engine.completeObjective('q1', 'obj_1');
engine.startQuest('q2'); // → true (q1 is now COMPLETED)
```

`startQuest()` returns `false` if any required quest is not in `COMPLETED` status.

---

## Objectives

```ts
interface IQuestObjective {
  id:          string;
  type:        ObjectiveType | (string & {});  // open — use any string
  target:      string;                         // zone id, enemy type, item id, …
  description: string;
  count:       number;   // target count (1 for instant, N for progress)
  current:     number;   // current progress
  completed:   boolean;
}
```

`type` is an **open enum** — `'reach_zone'` and `'kill'` are built-in presets,
but any string is valid. The engine never reads `type` itself; it is metadata
for your game logic and UI. All objectives are driven by the same two methods
regardless of type.

Built-in presets and recommended completion method:

| Type | Completion method |
|------|------------------|
| `reach_zone` | `completeObjective(questId, objId)` when player enters the zone |
| `kill` | `updateObjectiveProgress(questId, objId, n)` per kill |
| `collect`, `talk_to`, `deliver`, … | Your choice — use either method |

---

## Terrain effects

Terrain effects are **declarative** — you describe what should happen, the engine
calls `ITerrainLockAdapter.setLocked()` at the right moment automatically.

```ts
interface ITerrainEffect {
  terrainId: string;
  action:    'lock' | 'unlock';
  trigger:   'on_start' | 'on_complete' | 'on_fail';
}
```

| Trigger | When |
|---|---|
| `on_start` | `startQuest()` is called |
| `on_complete` | All objectives completed |
| `on_fail` | `failQuest()` is called |

To actually lock/unlock terrain in your game, provide an `ITerrainLockAdapter`
(see [ports/README.md](../ports/README.md)):

```ts
// Standalone (adapter in constructor)
const engine = new QuestEngine(myTerrainLockAdapter);

// Kernel-wired (via EconomyPlugin + EconomyPorts.TerrainLock)
// — adapter is injected automatically during kernel.init()
```

If no adapter is provided, terrain effects are silently skipped.

---

## API

### `on(event, cb)` / `off(event, cb)`

Subscribe/unsubscribe to quest events. Multiple listeners per event are supported.
Pass the same callback reference to `off()` to remove it.

### `isQuestStartable(questId): boolean`

Returns `true` if the quest is `AVAILABLE` **and** all `requires` prerequisites are `COMPLETED`.
Use this to power UI (show/hide "Accept" button) without side effects.

```ts
// Filter truly startable quests for UI display
const startable = engine.getAvailableQuests().filter(q => engine.isQuestStartable(q.id));

// Show padlock icon on locked quests
for (const quest of engine.getAvailableQuests()) {
  ui.renderQuest(quest, { locked: !engine.isQuestStartable(quest.id) });
}
```

Note: `getAvailableQuests()` returns **all** AVAILABLE quests (including locked ones) —
useful for showing a full quest log with locked entries. Use `isQuestStartable()` to
distinguish what the player can actually accept right now.

### `registerQuest(def)`

Register a quest definition. Creates runtime state with status `AVAILABLE`.
Must be called before any other method for that quest.

### `startQuest(questId): boolean`

Transition `AVAILABLE → ACTIVE`. Returns `false` if the quest is not available
or if any `requires` prerequisites are not yet COMPLETED.
Applies `on_start` terrain effects. Emits `quest:started`.

### `completeObjective(questId, objectiveId): boolean`

Mark a single objective as completed. If this was the last objective,
auto-completes the quest. Returns `false` if quest is not active or
objective is already completed.

### `updateObjectiveProgress(questId, objectiveId, increment?): boolean`

Add `increment` (default `1`) to the objective's `current` counter.
When `current >= count`, calls `completeObjective()` automatically.
Useful for kill-count objectives — call once per kill event.

### `failQuest(questId): boolean`

Transition `ACTIVE → FAILED`. Applies `on_fail` terrain effects. Emits `quest:failed`.

### `getQuestState(questId): IQuestState | undefined`

Returns the full runtime state for one quest (status + objectives array).

### `getActiveQuests() / getCompletedQuests() / getAvailableQuests()`

Return cached arrays, rebuilt only on status mutation — safe to call every frame.

---

## Serialisation

```ts
// Save
const snapshot = engine.serialize();
// → [{ id, status, objectives: [{ id, current, completed }] }]

// Load — definitions must already be registered before restore()
engine.restore(snapshot);
```

`restore()` merges saved progress into existing runtime state — it does NOT
clear definitions. Always call `registerQuest()` for all quests before `restore()`.

---

## Using outside EconomyPlugin

`QuestEngine` is a standalone class — no kernel required:

```ts
const engine = new QuestEngine(terrainAdapter);
engine.on('quest:completed', ({ questId }) => giveReward(questId));
engine.registerQuest({ ... });
engine.startQuest('q1');
```

Use `EconomyPlugin` when you need all economy systems in one kernel plugin.
Use `QuestEngine` directly for simpler setups or testing.
