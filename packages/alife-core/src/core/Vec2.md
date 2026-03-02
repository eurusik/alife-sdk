# Vec2

Immutable 2D point/vector — the universal coordinate type across the entire
SDK. Every position, direction, and offset uses `Vec2`.

```ts
import {
  ZERO,
  distanceSq, distance,
  lerp, subtract, add, scale,
  normalize, magnitude,
  dot, angle,
} from '@alife-sdk/core';
import type { Vec2 } from '@alife-sdk/core';
```

---

## `Vec2` interface

```ts
interface Vec2 {
  readonly x: number; // horizontal (rightward positive)
  readonly y: number; // vertical (downward positive, screen coordinates)
}
```

`Vec2` is a plain structural interface — any object `{ x, y }` satisfies it.
There is no class to construct; use object literals:

```ts
const pos: Vec2 = { x: 100, y: 200 };
const dir: Vec2 = { x: 0, y: -1 }; // pointing up
```

All utility functions return **new** `Vec2` objects — no mutation.

---

## `ZERO`

```ts
const ZERO: Vec2 // Object.freeze({ x: 0, y: 0 })
```

A frozen sentinel for "no position / no direction". Safe to share and compare by
reference:

```ts
const dir = getSafeDirection(pos);
if (dir === ZERO) {
  // no threats nearby — no safe direction computed
}
```

---

## Distance

### `distanceSq(a, b)`

Squared Euclidean distance. **Prefer this in hot loops** — avoids `Math.sqrt`.

```ts
const sq = distanceSq(npc.position, player.position);
if (sq <= 600 * 600) {
  npc.goOnline();
}
```

### `distance(a, b)`

Exact Euclidean distance. Use when you need the actual pixel value (e.g. for
UI display or one-time checks outside the hot path).

```ts
const dist = distance(a, b); // Math.sqrt(distanceSq(a, b))
```

---

## Arithmetic

### `add(a, b)`

Component-wise addition: `{ x: a.x + b.x, y: a.y + b.y }`.

```ts
const moved = add(npc.position, velocity);
```

### `subtract(a, b)`

Component-wise subtraction (a − b): `{ x: a.x - b.x, y: a.y - b.y }`.

```ts
const toTarget = subtract(target, npc.position); // direction vector (un-normalized)
```

### `scale(v, s)`

Scalar multiplication: `{ x: v.x * s, y: v.y * s }`.

```ts
const halfSpeed = scale(velocity, 0.5);
const reversed  = scale(direction, -1);
```

### `lerp(a, b, t)`

Linear interpolation. `t = 0` returns `a`, `t = 1` returns `b`.

```ts
const midpoint   = lerp(a, b, 0.5);
const smoothStep = lerp(current, target, 0.1 * deltaSeconds);
```

---

## Direction

### `magnitude(v)`

Length of the vector from the origin.

```ts
const speed = magnitude(velocity); // current speed in px/s
```

### `normalize(v)`

Unit vector in the same direction. Returns `ZERO` for the zero vector.

```ts
const dir = normalize(subtract(target, position));
npc.setVelocity(dir.x * speed, dir.y * speed);
```

### `dot(a, b)`

Dot product: `a.x * b.x + a.y * b.y`.

Useful for checking whether two directions are aligned:

```ts
// Is the enemy in front of the NPC?
const facing = normalize({ x: Math.cos(npc.rotation), y: Math.sin(npc.rotation) });
const toEnemy = normalize(subtract(enemy.position, npc.position));
if (dot(facing, toEnemy) > 0.7) {  // cos(45°) ≈ 0.7
  npc.canSeeEnemy = true;
}
```

### `angle(v)`

Angle of the vector from the +X axis in radians (range `(-π, +π]`).
Returns `0` for the zero vector.

```ts
const dir = subtract(target, position);
const radians = angle(dir);           // e.g. -Math.PI/2 for pointing up
const degrees = radians * 180 / Math.PI;
```

---

## `catmullRom(values, t)`

Pure Catmull-Rom spline interpolation on a 1D array of control points.
Engine-agnostic replacement for Phaser's `CatmullRom` interpolation.

```ts
import { catmullRom } from '@alife-sdk/core/math';

// Evaluate X and Y separately
const smoothX = catmullRom(waypoints.map(p => p.x), t);
const smoothY = catmullRom(waypoints.map(p => p.y), t);
const point: Vec2 = { x: smoothX, y: smoothY };
```

| Parameter | Description |
|-----------|-------------|
| `values` | 1D control points (call separately for X and Y) |
| `t` | Normalised position along the spline, in `[0, 1]` |

Returns the interpolated value at `t`. Returns `0` for empty input,
`values[0]` for a single-point input.

---

## Math utilities (`@alife-sdk/core/math`)

Two small helpers used internally, also available for consumer code:

### `clamp(value, min, max)`

Clamp a number to `[min, max]`:

```ts
import { clamp } from '@alife-sdk/core/math';

const hp = clamp(currentHp - damage, 0, maxHp);
```

### `moveTowardZero(value, amount)`

Move a value toward 0 by `amount`. Never overshoots:

```ts
import { moveTowardZero } from '@alife-sdk/core/math';

morale = moveTowardZero(morale, recoveryRate * delta);
// morale: -0.001, amount: 0.01 → result: 0 (not +0.009)
```

### `segmentIntersectsRect(p1, p2, rx, ry, rw, rh)`

Returns `true` if the line segment `p1 → p2` intersects or touches the
axis-aligned rectangle defined by corner `(rx, ry)` and size `(rw × rh)`.

Uses the parametric slab method — O(1), no `sqrt`, no allocations. Handles
negative `rw`/`rh` (normalized internally) and degenerate point-segments.

```ts
import { segmentIntersectsRect } from '@alife-sdk/core/math';

// Wall at (100, 200), 50 px wide, 10 px tall
const blocked = segmentIntersectsRect(observer, target, 100, 200, 50, 10);
```

Primary use: LOS obstacle checks — test a sight-line against each wall rect.

### `segmentIntersectsCircle(p1, p2, center, radius)`

Returns `true` if the line segment `p1 → p2` intersects or touches the circle
at `center` with the given `radius`. Returns `false` for `radius ≤ 0`.

Projects the circle center onto the nearest point of the segment (clamped to
`[0, 1]`) and checks squared distance — no `sqrt` needed for the test itself.

```ts
import { segmentIntersectsCircle } from '@alife-sdk/core/math';

// Circular pillar at (150, 150), radius 30
const blocked = segmentIntersectsCircle(observer, target, { x: 150, y: 150 }, 30);
```

---

## Common patterns

**Direction from A to B:**

```ts
const dir = normalize(subtract(b, a));
```

**Move NPC toward target:**

```ts
const dir = normalize(subtract(target, npc.position));
npc.position = add(npc.position, scale(dir, speed * delta));
```

**Check if within range (avoid sqrt):**

```ts
if (distanceSq(a, b) <= range * range) { /* in range */ }
```

**Midpoint:**

```ts
const mid = lerp(a, b, 0.5);
```

**Angle between two directions:**

```ts
const cosA = dot(normalize(dir1), normalize(dir2));
const angleRad = Math.acos(Math.max(-1, Math.min(1, cosA)));
```
