# `@alife-sdk/core` — math utilities

Pure, framework-free math primitives used throughout the SDK.
All functions are stateless, allocation-minimal, and tree-shakeable.

**Import path:** `@alife-sdk/core/math`

---

## Vec2

`Vec2` is the immutable 2D point/vector type used for every position and direction in the SDK.

```ts
import type { Vec2 } from '@alife-sdk/core/math';
```

| Export | Description |
|---|---|
| `Vec2` | Interface `{ readonly x: number; readonly y: number }` |
| `ZERO` | Frozen sentinel `{ x: 0, y: 0 }` — safe as a default or no-op value |

### Vec2 operations

| Function | Signature | Description |
|---|---|---|
| `distance` | `(a, b) => number` | Euclidean distance between two points |
| `distanceSq` | `(a, b) => number` | Squared distance — avoids `sqrt`, prefer in hot loops |
| `lerp` | `(a, b, t) => Vec2` | Linear interpolation; `t=0` returns `a`, `t=1` returns `b` |
| `subtract` | `(a, b) => Vec2` | Component-wise subtraction `a − b` |
| `add` | `(a, b) => Vec2` | Component-wise addition |
| `scale` | `(v, s) => Vec2` | Scalar multiplication |
| `magnitude` | `(v) => number` | Vector length (distance from origin) |
| `normalize` | `(v) => Vec2` | Unit vector; returns `ZERO` for zero-length input |
| `dot` | `(a, b) => number` | Dot product |
| `angle` | `(v) => number` | Angle from +X axis in radians `(-π, +π]` |

---

## Spline interpolation

| Export | Description |
|---|---|
| `catmullRom(values, t)` | Evaluates a Catmull-Rom spline at normalised `t ∈ [0, 1]`. Call separately for X and Y axes. Numerically compatible with `Phaser.Math.Interpolation.CatmullRom`. |

---

## Scalar utilities

| Export | Description |
|---|---|
| `clamp(value, min, max)` | Clamps a number to `[min, max]` |
| `moveTowardZero(value, amount)` | Reduces magnitude toward zero without overshooting — useful for drag/friction |

---

## Intersection tests

| Export | Description |
|---|---|
| `segmentIntersectsRect(p1, p2, rx, ry, rw, rh)` | Returns `true` if the segment `p1→p2` intersects the AABB. Uses the slab method — O(1), no `sqrt`. |
| `segmentIntersectsCircle(p1, p2, center, radius)` | Returns `true` if the segment intersects the circle. Projects center onto segment, squared-distance check. |

---

## Example

```ts
import {
  distance, distanceSq, normalize, subtract,
  segmentIntersectsRect, catmullRom, clamp,
} from '@alife-sdk/core/math';
import type { Vec2 } from '@alife-sdk/core/math';

const npc: Vec2   = { x: 100, y: 200 };
const target: Vec2 = { x: 400, y: 200 };

// Euclidean distance (prefer distanceSq in tight loops):
console.log(distance(npc, target)); // 300

// Direction toward target:
const dir = normalize(subtract(target, npc)); // { x: 1, y: 0 }

// Line-of-sight blocked by a wall at (200, 180) sized 10×40?
const blocked = segmentIntersectsRect(npc, target, 200, 180, 10, 40); // true

// Smooth a patrol path with Catmull-Rom:
const xs = waypoints.map(p => p.x);
const ys = waypoints.map(p => p.y);
const smoothed: Vec2 = { x: catmullRom(xs, 0.5), y: catmullRom(ys, 0.5) };

// Clamp HP ratio:
const ratio = clamp(hp / maxHp, 0, 1);
```
