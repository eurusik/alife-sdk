# SpatialGrid

Generic spatial hash for fast radius and rectangle queries over any
item type. No engine dependency.

```ts
import { SpatialGrid } from '@alife-sdk/core';
import type { IRect } from '@alife-sdk/core';
```

---

## Why a spatial grid?

A naive "find all NPCs within 600px" implementation iterates every NPC — O(n).
With 200 NPCs that's 200 distance checks per query, per frame.

`SpatialGrid` partitions the world into fixed-size cells. A radius query only
checks the cells that overlap the search circle — typically 4–9 cells, each
holding a small number of items. The result is **O(k)** where k is the number
of items actually near the query point, regardless of total world population.

---

## Concepts

### Cell size

The world is divided into square cells of `cellSize × cellSize` pixels.
Each item lives in exactly one cell, determined by its position.

**Rule of thumb:** set `cellSize ≈ 2 × your most common query radius`.
This ensures a centred radius query never touches more than ~9 cells.

```
cellSize = 200px, queryRadius = 100px → reads at most 9 cells ✓
cellSize = 200px, queryRadius = 500px → reads up to ~49 cells ✗ (too many)
```

### Position function

`SpatialGrid<T>` is generic. You supply a `positionFn` that extracts a
`Vec2` from your item type. The grid never reads `item.x` directly — it
always calls your function.

### Scratch array

`queryRadius()` and `queryRect()` return the same internal `_scratchResults`
array reused between calls. **Copy the result if you need to hold it:**

```ts
const nearby = grid.queryRadius(pos, 300);
const snapshot = [...nearby]; // copy before next query overwrites it
```

---

## Constructor

```ts
new SpatialGrid<T>(cellSize: number, positionFn: (item: T) => Vec2)
```

```ts
interface NPC { id: string; position: Vec2 }

const grid = new SpatialGrid<NPC>(200, (npc) => npc.position);
```

**Throws** `RangeError` if `cellSize <= 0`.

---

## Mutation API

### `grid.insert(item)`

Add an item. If the item is already tracked, behaves like `update()`.

```ts
grid.insert(npc);
```

### `grid.remove(item)`

Remove an item. Returns `true` if found and removed, `false` if not tracked.

```ts
const removed = grid.remove(deadNpc); // true
```

### `grid.update(item)`

Re-hash an item after its position changed. If it hasn't crossed a cell
boundary, this is a no-op. If the item isn't tracked yet, it's inserted.

```ts
// After moving an NPC:
npc.position = { x: newX, y: newY };
grid.update(npc);
```

### `grid.clear()`

Remove all items and cells.

---

## Query API

### `grid.queryRadius(center, radius)`

All items within `radius` world-units of `center`.

```ts
const nearby = grid.queryRadius({ x: 400, y: 300 }, 250);
for (const npc of nearby) {
  npc.react();
}
```

Uses squared-distance math internally — no `Math.sqrt` per item.

### `grid.queryRect(bounds)`

All items whose position lies within the axis-aligned rectangle.

```ts
const inView = grid.queryRect({ x: 0, y: 0, width: 800, height: 600 });
```

```ts
interface IRect {
  x: number;      // left edge
  y: number;      // top edge
  width: number;
  height: number;
}
```

---

## `grid.size`

Current number of tracked items.

```ts
console.log(grid.size); // 142
```

---

## Full example — NPC perception system

```ts
import { SpatialGrid } from '@alife-sdk/core';
import type { Vec2 } from '@alife-sdk/core';

interface NPC {
  id: string;
  position: Vec2;
  faction: string;
}

const grid = new SpatialGrid<NPC>(200, (npc) => npc.position);

// Spawn phase
for (const npc of allNpcs) {
  grid.insert(npc);
}

// Each frame — update moved NPCs
for (const npc of movedNpcs) {
  grid.update(npc);
}

// Perception query — who is near the player?
const PERCEPTION_RADIUS = 600;
const nearPlayer = grid.queryRadius(playerPosition, PERCEPTION_RADIUS);

for (const npc of nearPlayer) {
  if (npc.faction !== playerFaction) {
    npc.goOnline(); // switch to full AI
  }
}

// Despawn
grid.remove(deadNpc);
```

---

## Performance notes

| Operation | Complexity | Notes |
|-----------|-----------|-------|
| `insert` | O(1) | One map set |
| `remove` | O(1) | One map delete |
| `update` | O(1) | No-op when cell unchanged |
| `queryRadius` | O(k) | k = items in touched cells; typically 4–9 cells |
| `queryRect` | O(k) | Same algorithm, rect AABB instead of circle |

Implementation details that keep queries fast:
- Cell keys are packed integers — no string allocation per lookup
- Empty cells are pruned immediately on `remove()` — no memory leak
- Radius check uses `dx*dx + dy*dy <= radiusSq` — avoids `Math.sqrt`
- Query scratch array is reused — zero per-call allocation

**Coordinate range:** supports cell indices in `[-512, +511]`, which means
world coordinates up to `±512 × cellSize` (at default `cellSize: 200` → `±102 400 px`).
If your world is larger, increase `cellSize`.
