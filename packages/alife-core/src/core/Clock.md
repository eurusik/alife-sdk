# Clock

Accelerated in-game time with day/night cycle detection and optional
hour/transition callbacks.

```ts
import { Clock } from '@alife-sdk/core';
import type { IClockConfig, IClockState } from '@alife-sdk/core';
```

> **Note:** When using `ALifeKernel`, you do not create a `Clock` directly —
> the kernel owns one. Access it via `kernel.clock` after `init()`.
> Use `Clock` directly only in standalone code or tests.

---

## Concepts

### Time factor

The clock converts real milliseconds into accelerated in-game seconds.

```
game seconds per frame = (deltaMs / 1000) × timeFactor
```

At the default `timeFactor: 10`:
- 1 real second = 10 in-game seconds
- 1 real minute = 10 in-game minutes
- 1 real hour = 10 in-game hours (a full day takes ~144 real minutes)

### Single source of truth

All time values (`hour`, `minute`, `day`, `isDay`) are derived from a
single accumulator: `totalGameSeconds`. Nothing is stored separately —
changing the accumulator immediately changes all derived values.

### Day/night boundaries

```
  0    6    ...    21    24
  ├────┼─────────────┼────┤
  night    daytime    night
         ↑dayStart  ↑dayEnd
```

`isDay` returns `true` when `hour >= dayStartHour && hour < dayEndHour`.

---

## Constructor

```ts
new Clock(config?: IClockConfig)
```

```ts
interface IClockConfig {
  timeFactor?:        number;   // default 10
  startHour?:         number;   // 0-23, default 8 (08:00)
  startDay?:          number;   // 1-based, default 1
  dayStartHour?:      number;   // default 6
  dayEndHour?:        number;   // default 21
  onHourChanged?:     (hour: number, day: number) => void;
  onDayNightChanged?: (isDay: boolean) => void;
}
```

```ts
const clock = new Clock({
  timeFactor: 10,
  startHour: 20,
  onHourChanged:     (h, d) => console.log(`Day ${d}, ${h}:00`),
  onDayNightChanged: (isDay) => renderer.setAmbientLight(isDay ? 'day' : 'night'),
});
```

**Throws** `RangeError` if:
- `timeFactor <= 0`
- `startHour` outside `[0, 23]`
- `startDay < 1`

---

## Accessors

| Property | Type | Description |
|----------|------|-------------|
| `clock.hour` | `number` | Current in-game hour (0–23) |
| `clock.minute` | `number` | Current in-game minute (0–59) |
| `clock.day` | `number` | Current in-game day (1-based) |
| `clock.isDay` | `boolean` | True during `[dayStartHour, dayEndHour)` |
| `clock.isNight` | `boolean` | `!isDay` |
| `clock.timeFactor` | `number` | Current acceleration factor |
| `clock.isPaused` | `boolean` | Whether the clock is paused |
| `clock.totalGameSeconds` | `number` | Total elapsed game-seconds since epoch |

---

## `clock.update(deltaMs)`

Advance time. Call once per frame with real elapsed milliseconds.

```ts
// In your game loop:
clock.update(deltaMs);
```

After each call, `hour` and `isDay` are re-derived. If they changed since
the last call, the appropriate callbacks fire:

- `onHourChanged(hour, day)` — when the hour number increments
- `onDayNightChanged(isDay)` — when crossing `dayStartHour` or `dayEndHour`

Both callbacks fire at most once per `update()` call.

---

## `clock.setTime(hour, minute?)`

Jump to a specific time on the current day. Does **not** fire callbacks —
the next `update()` will detect the transition naturally.

```ts
clock.setTime(6);     // jump to 06:00
clock.setTime(21, 30); // jump to 21:30
```

Use for cutscenes, time-skip mechanics, or test setup.

---

## `clock.pause()` / `clock.resume()`

Freeze/unfreeze time. While paused, `update()` is a no-op and all
accessors return the frozen values.

```ts
clock.pause();
// ... menu open ...
clock.resume();
```

---

## Serialisation

```ts
// Save
const state: IClockState = clock.serialize();
// { totalGameSeconds: 432000, timeFactor: 10 }

// Restore (callbacks must be re-supplied — functions aren't serialisable)
const restored = Clock.fromState(state, {
  onHourChanged:     (h, d) => console.log(`Day ${d}, ${h}:00`),
  onDayNightChanged: (day) => console.log(day ? 'Dawn' : 'Dusk'),
});
```

`Clock.fromState()` throws if `totalGameSeconds` is not a finite
non-negative number (guards against corrupted saves).

---

## Usage in tests

```ts
import { Clock } from '@alife-sdk/core';

it('transitions to night at hour 21', () => {
  let isDay: boolean | undefined;
  const clock = new Clock({
    startHour: 20,
    timeFactor: 1,
    onDayNightChanged: (d) => { isDay = d; },
  });

  // Advance past the 21:00 boundary
  // 1 real second = 1 game second (timeFactor: 1), so 3601 ms = 1 game hour
  clock.update(3_601_000);

  expect(clock.hour).toBe(21);
  expect(isDay).toBe(false);
});
```

---

## Integration with NPC schedules

```ts
kernel.events.on('time:hour_changed', ({ hour, isDay }) => {
  for (const npc of npcs) {
    if (!isDay && npc.schedule === 'day') {
      npc.goToShelter();
    }
    if (isDay && npc.schedule === 'night') {
      npc.resumePatrol();
    }
  }
});
```

The `ALifeKernel` emits `time:hour_changed` and `time:day_night_changed`
events from the clock's callbacks automatically.
