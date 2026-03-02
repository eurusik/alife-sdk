# SmoothPathFollower

Per-NPC cursor that tracks progress along a dense smooth path with
curvature-based velocity profiles.

**Create one follower per NPC.** The follower is stateful — it owns the current
cursor index and the smoothed velocity multiplier.

```ts
import { SmoothPathFollower } from '@alife-sdk/ai/navigation';
import type { INavigationConfig } from '@alife-sdk/ai/types';
```

---

## Constructor

```ts
new SmoothPathFollower(points: readonly Vec2[], config: INavigationConfig)
```

| Parameter | Description |
|-----------|-------------|
| `points` | Dense path from `smoothPath()` or `smoothPathWithTurning()`. |
| `config` | Navigation config (`config.navigation`). |

The constructor pre-computes a velocity multiplier for every point in the path
based on local curvature (see [Velocity profile](#velocity-profile)).

```ts
const densePoints = smoothPathWithTurning(waypoints, nav, rng, cache);
const follower = new SmoothPathFollower(densePoints, nav);
```

---

## updatePosition(x, y): boolean

Advance the cursor when the NPC is close enough to the current target.

```ts
const advanced = follower.updatePosition(npc.x, npc.y);
```

- **Returns `true`** if the cursor advanced to the next point this call.
- **Returns `false`** if not yet arrived (or path is already complete).
- Uses squared-distance comparison against `arrivalThreshold²` — no `Math.sqrt`.

> Call this **before** reading `getCurrentTarget()` or
> `getCurrentVelocityMultiplier()` each frame so the cursor is up to date.

---

## getCurrentTarget(): Vec2 | null

The next point the NPC should move toward.

```ts
const target = follower.getCurrentTarget();
if (target) {
  npc.moveToward(target.x, target.y);
} else {
  // Path complete
}
```

Returns `null` when `isComplete()` is true.

---

## isComplete(): boolean

Whether the NPC has reached the last point on the path.

```ts
if (follower.isComplete()) {
  // Pick next patrol segment, trigger idle, etc.
}
```

---

## getCurrentVelocityMultiplier(): number

Smoothed velocity multiplier for the current path position.

```ts
const speed = npc.baseSpeed * follower.getCurrentVelocityMultiplier();
npc.moveToward(target.x, target.y, speed, deltaMs);
```

- Returns a value in approximately `[velocityCurveSlow, velocityCurveFast]`.
- The value transitions **gradually** between speed bands each call
  (lerp rate = `velocityTransitionRate`).
- Returns `1.0` when the path is complete.

The multiplier is based on local curvature of the dense path — sharp turns
slow the NPC down, straight segments let it run at full speed.

---

## reset(): void

Reset the cursor to the start of the path (useful for looping patrols).

```ts
follower.reset();
// NPC will start from the beginning again
```

Also resets the velocity multiplier to the first point's profile value.

---

## getProgress(): number

Normalized progress along the path — `0.0` at the start, `1.0` at the end.

```ts
const pct = (follower.getProgress() * 100).toFixed(0);
console.log(`Path: ${pct}% complete`);
```

---

## getPointCount(): number

Total number of dense points in the path.

```ts
console.log(`Smooth path has ${follower.getPointCount()} points`);
```

---

## Velocity profile

The follower pre-computes a speed multiplier for each point at construction
time based on local path curvature (θ / arc-length):

| Curvature (κ) | Speed band | Multiplier (default) |
|---------------|------------|---------------------|
| κ > `0.04` | Sharp turn | `velocityCurveSlow` = `0.4` |
| κ > `0.015` | Moderate turn | `velocityCurveMedium` = `0.7` |
| κ ≤ `0.015` | Straight | `velocityCurveFast` = `1.0` |

Endpoints inherit the value of the nearest interior point.

The actual multiplier returned by `getCurrentVelocityMultiplier()` transitions
between these values gradually:

```
currentMultiplier += (targetMultiplier - currentMultiplier) * velocityTransitionRate
```

With the default `velocityTransitionRate = 0.15`, the speed change is smooth
rather than instantaneous.

---

## INavigationConfig fields used

| Field | Default | Used by |
|-------|---------|---------|
| `arrivalThreshold` | `8` px | `updatePosition()` — cursor-advance distance |
| `velocityCurveFast` | `1.0` | Fast-segment multiplier |
| `velocityCurveMedium` | `0.7` | Medium-turn multiplier |
| `velocityCurveSlow` | `0.4` | Sharp-turn multiplier |
| `velocityTransitionRate` | `0.15` | Lerp rate per `getCurrentVelocityMultiplier()` call |

---

## Full example

```ts
import { smoothPathWithTurning, SmoothPathFollower } from '@alife-sdk/ai/navigation';
import { createDefaultAIConfig } from '@alife-sdk/ai/config';

const config = createDefaultAIConfig();
const nav = config.navigation;

const waypointCache = new Map<string, readonly Vec2[]>();
const densePoints = smoothPathWithTurning(patrolRoute, nav, rng, waypointCache);
const follower = new SmoothPathFollower(densePoints, nav);

function updateNPC(npc: MyNPC, deltaMs: number) {
  follower.updatePosition(npc.x, npc.y);

  let target = follower.getCurrentTarget();
  if (!target) {
    if (looping) {
      follower.reset();
      target = follower.getCurrentTarget(); // re-read after reset
    }
    if (!target) return; // arrived at destination or empty path
  }

  const speed = npc.baseSpeed * follower.getCurrentVelocityMultiplier();
  // Move NPC toward target at computed speed...
}
```

---

## Pattern: path replacement

When an NPC receives a new path (e.g. after a replan), discard the old
follower and create a new one:

```ts
// Old follower can be garbage collected — no cleanup needed
follower = new SmoothPathFollower(newDensePath, nav);
```

There is no `setPath()` method by design — replacing the follower is safer
than mutating its internal path.
