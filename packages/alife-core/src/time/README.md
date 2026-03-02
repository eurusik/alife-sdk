# time

`TimeManager` — a thin wrapper around `Clock` that wires time events to the `EventBus`.

```ts
import { TimeManager } from '@alife-sdk/core/time';
import type { ITimeManagerConfig } from '@alife-sdk/core/time';
```

> **Inside the kernel you don't use `TimeManager` directly.**
> `kernel.clock` gives you the `Clock` instance, and time events are already
> wired by the kernel internally.
>
> Use `TimeManager` only when you need a self-contained game clock
> **outside** of `ALifeKernel` — for example, in a standalone tool, a
> map editor, or a game that doesn't use the full kernel.

---

## `TimeManager` vs `Clock`

| | `Clock` | `TimeManager` |
|-|---------|---------------|
| Location | `@alife-sdk/core/core` | `@alife-sdk/core/time` |
| Event bus | No — uses raw callbacks | Yes — emits `HOUR_CHANGED` + `DAY_NIGHT_CHANGED` to `EventBus` |
| Kernel required | No | No |
| Use case | Inside kernel, tests | Standalone game loop outside kernel |

`TimeManager` owns a `Clock` and manages its `onHourChanged` /
`onDayNightChanged` callbacks internally — you don't set those yourself.

---

## Quick start

```ts
import { TimeManager } from '@alife-sdk/core/time';
import { EventBus } from '@alife-sdk/core/events';
import { ALifeEvents } from '@alife-sdk/core/events';
import type { ALifeEventPayloads } from '@alife-sdk/core/events';

const events = new EventBus<ALifeEventPayloads>();
const time   = new TimeManager({
  events,
  clockConfig: {
    timeFactor: 10,       // game runs 10× faster than real time
    startHour:  6,        // start at 06:00
    dayStart:   6,        // day begins at 6h
    dayEnd:     22,       // night begins at 22h
  },
});

// React to time events
events.on(ALifeEvents.HOUR_CHANGED, ({ hour, day, isDay }) => {
  console.log(`Day ${day}, ${hour}:00 — ${isDay ? 'day' : 'night'}`);
});

// Game loop
function update(deltaMs: number): void {
  time.update(deltaMs);
  events.flush();
}
```

---

## `ITimeManagerConfig`

```ts
interface ITimeManagerConfig {
  /** EventBus to emit 'time:hour_changed' and 'time:day_night_changed'. */
  events?: EventBus<ALifeEventPayloads>;

  /** Clock configuration. Do NOT set onHourChanged/onDayNightChanged here —
   *  TimeManager manages those callbacks internally. */
  clockConfig?: Omit<IClockConfig, 'onHourChanged' | 'onDayNightChanged'>;
}
```

All fields are optional — `new TimeManager()` creates a default clock with
no event bus and `timeFactor: 1`.

---

## API

### `time.update(deltaMs)`

Advance the game clock by `deltaMs` real milliseconds. Call once per frame.
Internally calls `clock.update(deltaMs)`, which fires hour/day-night callbacks
when thresholds are crossed — those callbacks emit to the event bus.

```ts
time.update(16); // ~60 fps frame
```

### `time.clock`

Access the underlying `Clock` for all time queries:

```ts
const { hour, day, isDay, gameTimeMs } = time.clock;

// Check time of day
if (time.clock.isDay) { /* daytime logic */ }

// Jump to a specific time
time.clock.setTime(20, 0); // 20:00
```

See [`core/Clock.md`](../core/Clock.md) for the full `Clock` API.

---

## Events emitted

When an `EventBus` is provided, `TimeManager` emits two events automatically:

| Event constant | When fired | Payload |
|---------------|-----------|---------|
| `ALifeEvents.HOUR_CHANGED` | Every in-game hour | `{ hour, day, isDay }` |
| `ALifeEvents.DAY_NIGHT_CHANGED` | When day/night boundary is crossed | `{ isDay }` |

```ts
events.on(ALifeEvents.HOUR_CHANGED, ({ hour, day, isDay }) => {
  npcScheduler.onHourChanged(hour, isDay);
});

events.on(ALifeEvents.DAY_NIGHT_CHANGED, ({ isDay }) => {
  renderer.setAmbientLight(isDay ? 1.0 : 0.3);
});
```

---

## Serialisation

`TimeManager` serialises and restores the full `Clock` state —
elapsed game time, current hour, day counter, and day/night flag:

```ts
// Save
const state = time.serialize(); // IClockState

// Load — TimeManager rewires its callbacks automatically
time.restore(state);
```

`restore()` rebuilds the internal `Clock` from the saved state and reattaches
the event bus callbacks — no manual re-wiring needed.

---

## Without an event bus

If you only need the game clock and don't need events, omit `events`:

```ts
const time = new TimeManager({
  clockConfig: { timeFactor: 5, startHour: 12 },
});

// Poll directly instead of subscribing to events
time.update(delta);
const { hour, isDay } = time.clock;
```

---

## Tips

**Always call `events.flush()` after `time.update()`.**
`TimeManager` calls `events.emit()` (queued), not immediate dispatch.
If you don't flush, listeners never fire:

```ts
time.update(deltaMs);
events.flush(); // ← required
```

**Use `time.clock.setTime()` to skip to a time of day in tests.**
No need to simulate thousands of real ticks to reach midnight:

```ts
time.clock.setTime(22, 0); // instantly 22:00
time.update(1);             // trigger the DAY_NIGHT_CHANGED event
events.flush();
```

**`TimeManager` is unnecessary inside `ALifeKernel`.**
The kernel owns `kernel.clock` directly and wires its own time callbacks.
Only create `TimeManager` for code that runs without the kernel.
