# Core Events Reference

Use this page when you need to observe runtime facts without coupling systems directly to each other.

`kernel.events` is the main integration seam for UI reactions, quest hooks, debugging overlays, analytics, and scene-side runtime feedback.

## Import path

```ts
import { EventBus, ALifeEvents } from "@alife-sdk/core/events";
import type { ALifeEventPayloads } from "@alife-sdk/core/events";
```

Most of the time you do not construct your own bus for SDK runtime events. You subscribe to `kernel.events`, which is already typed as `EventBus<ALifeEventPayloads>`.

## Minimal usage

```ts
const unsubscribe = kernel.events.on(ALifeEvents.NPC_DIED, ({ npcId, killedBy }) => {
  hud.showDeathNotice(npcId, killedBy);
});

kernel.events.on(ALifeEvents.STATE_CHANGED, ({ npcId, oldState, newState }) => {
  debugPanel.trackState(npcId, oldState, newState);
});

// later
unsubscribe();
```

## Deferred dispatch rule

The bus is deferred:

- `emit()` queues an event
- `flush()` delivers queued events
- `kernel.update()` calls `flush()` automatically at the end of the frame

That means:

- producers do not invoke listeners immediately
- listeners run at a stable point in the frame
- re-entrant emits stay safe because they are queued

## Core API you actually use

| Method | What it does |
|---|---|
| `on(event, fn)` | subscribe and get an unsubscribe function back |
| `once(event, fn)` | subscribe for one delivery |
| `off(event, fn)` | manual unsubscribe path |
| `emit(event, payload)` | queue an event |
| `flush()` | deliver queued events |
| `destroy()` | clear listeners and queue |

Practical rule:

prefer the unsubscribe function returned by `on()` over manual `off()`.

## High-signal events to wire first

If you are bringing up a game integration, these events usually pay off first:

| Event | Why it helps early |
|---|---|
| `alife:tick` | confirms the runtime is advancing |
| `alife:npc_online` / `alife:npc_offline` | confirms ownership handoff is working |
| `alife:task_assigned` | confirms brains are selecting work instead of stalling |
| `alife:npc_died` | confirms high-impact lifecycle transitions |
| `alife:terrain_state_changed` | confirms smart-terrain threat logic is updating |
| `ai:state_changed` | high-signal event for online AI debugging |
| `time:hour_changed` | useful for schedule and ambience updates |

## Event families

| Family | Prefix |
|---|---|
| A-Life core | `alife:*` |
| AI | `ai:*` |
| Surge | `surge:*` |
| Anomaly / hazards | `anomaly:*` |
| Squad | `squad:*` |
| Faction | `faction:*` |
| Time | `time:*` |
| Social | `social:*` |
| Monster | `monster:*` |

## Example: custom bus outside the kernel

Use your own `EventBus<T>` only when the events belong to your game layer rather than to SDK runtime ownership.

```ts
interface UIEvents {
  "hud:update": { hp: number; radiation: number };
  "dialog:opened": { npcId: string; text: string };
}

const uiBus = new EventBus<UIEvents>();

uiBus.on("hud:update", ({ hp, radiation }) => {
  hud.setValues(hp, radiation);
});

uiBus.emit("hud:update", { hp: 90, radiation: 0.2 });
uiBus.flush();
```

Important rule:

if the bus is not driven by `kernel.update()`, you must flush it yourself.

## Lifecycle

The recommended pattern is:

1. subscribe in plugin `install()` / `init()` or scene setup
2. react in listeners without owning the underlying runtime fact
3. unsubscribe in plugin `destroy()` or scene teardown

## Failure patterns

- expecting `emit()` to deliver immediately
- subscribing in temporary code paths and never unsubscribing
- treating events as the place to store authority instead of to observe authority
- forgetting to call `flush()` on custom buses not owned by the kernel
- wiring too many systems straight to scene objects instead of listening to runtime events

## Related pages

- [Core package](/docs/packages/core)
- [Core Plugins](/docs/reference/core/plugins)
- [Simulation Reference](/docs/reference/simulation/index)
- [AI Reference](/docs/reference/ai/index)
