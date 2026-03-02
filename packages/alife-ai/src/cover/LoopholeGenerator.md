# LoopholeGenerator

Generates and caches peek-fire positions (loopholes) for cover points.

A **loophole** is an offset position around a cover center from which an NPC
can expose themselves briefly to fire, then retreat back behind cover.
Each loophole has a **firing arc** — the angular range the NPC can engage
enemies from that position.

```ts
import { LoopholeGenerator, findBestLoophole } from '@alife-sdk/ai/cover';
```

---

## ILoophole shape

```ts
interface ILoophole {
  offsetX: number;   // X offset from cover center to peek position (px)
  offsetY: number;   // Y offset from cover center to peek position (px)
  angleMin: number;  // Start of firing arc (radians, 0 = right, CCW)
  angleMax: number;  // End of firing arc (radians)
}
```

To get the peek world position:

```ts
const peekX = cover.x + loophole.offsetX;
const peekY = cover.y + loophole.offsetY;
```

The firing arc `[angleMin, angleMax]` tells you which direction the NPC
can shoot from this peek position. Use `findBestLoophole` to pick the one
that covers the angle to a specific enemy.

---

## LoopholeGenerator

### Constructor

```ts
new LoopholeGenerator(config: ICoverConfig, random: IRandom)
```

| Config key | Default | Description |
|-----------|---------|-------------|
| `loopholeOffsetDistance` | `16` px | Distance from cover center to peek position. |
| `loopholeFireArc` | `2π/3` (120°) | Total angular width of each loophole's firing arc. |
| `loopholeMaxPerCover` | `3` | Maximum loopholes generated per point. Actual count is random in `[1, max]`. |

`random` must be an `IRandom` port for deterministic generation. Passing a seeded
instance gives consistent loopholes across saves and replays.

> `LoopholeGenerator` is created internally by `CoverRegistry`.
> You only need to instantiate it directly if you're building a custom registry.

### `getLoopholes(cover): readonly ILoophole[]`

Get loopholes for a cover point. Generated lazily on first access, then cached
by `cover.id` for the lifetime of the generator.

```ts
const loopholes = gen.getLoopholes(coverPoint);
```

### `clearCache(): void`

Invalidate all cached loopholes. Called by `CoverRegistry.clear()` on scene teardown.

---

## `findBestLoophole()` (standalone)

```ts
function findBestLoophole(
  loopholes: readonly ILoophole[],
  coverX: number,
  coverY: number,
  enemyX: number,
  enemyY: number,
): ILoophole | null
```

Finds the loophole whose firing arc best covers the direction to a given enemy.

```ts
const lh = findBestLoophole(loopholes, cover.x, cover.y, enemy.x, enemy.y);

if (lh) {
  // Peek position
  const peekX = cover.x + lh.offsetX;
  const peekY = cover.y + lh.offsetY;
  // Move NPC here to engage the enemy
} else {
  // No loophole covers this direction — NPC must move to a different cover
}
```

Returns `null` if no loophole's arc contains the angle to the enemy.

**Algorithm:**
1. Compute the angle from cover center to enemy (`atan2`).
2. For each loophole, compute `|angle - arcCenter|` (normalized to `[-π, π]`).
3. Return the loophole with the smallest deviation that is within `halfArc`.

`CoverRegistry.findBestLoophole(cover, enemyX, enemyY)` wraps this — prefer
that in most cases.

---

## Generation algorithm

```
count = 1 + floor(random.next() × maxPerCover)
startAngle = random.next() × 2π

for i in 0..count:
  jitter = (random.next() - 0.5) × angleStep × 0.3
  angle = startAngle + i × (2π / count) + jitter

  offsetX = cos(angle) × offsetDistance
  offsetY = sin(angle) × offsetDistance

  loophole = { offsetX, offsetY,
               angleMin: angle - fireArc/2,
               angleMax: angle + fireArc/2 }
```

Loopholes are evenly distributed around the cover center with ±15% angular jitter
for a natural, non-uniform look.

---

## TakeCoverState peek cycle example

```ts
// 1. NPC arrives at cover point
const loopholes = ctx.cover && registry.getLoopholes(activeCoverPoint);

// 2. Pick the loophole facing the enemy
const lh = registry.findBestLoophole(activeCoverPoint, enemy.x, enemy.y);

// 3. PEEK phase — move to loophole peek position
if (lh) {
  npc.moveTo(activeCoverPoint.x + lh.offsetX, activeCoverPoint.y + lh.offsetY);
}

// 4. FIRE phase — shoot while peeking

// 5. RETURN phase — move back to cover center
npc.moveTo(activeCoverPoint.x, activeCoverPoint.y);
```
