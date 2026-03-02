# navigation

Offline NPC navigation built on a weighted waypoint graph with A* pathfinding.

```ts
import { LevelGraph, NPCGraphMover } from '@alife-sdk/core/navigation';
import type { IGraphVertex, IGraphEdge, TerrainFilter, GraphMoverEvent } from '@alife-sdk/core/navigation';
```

---

## Concepts

### Why a waypoint graph?

Online NPCs use tile-based pathfinding (Phaser + navmesh). Offline NPCs —
those outside the player's view radius — don't need pixel-perfect paths.
A lightweight waypoint graph is enough: it finds routes between named
locations in milliseconds and moves NPCs with linear interpolation.

```
SmartTerrain nodes (e.g. "bar_base", "cordon_checkpoint")
           │
           ▼
       LevelGraph  ──→  A* findPath()  ──→  ["bar_base", "bridge_01", "cordon_checkpoint"]
                                                          │
                                                          ▼
                                                  NPCGraphMover.moveTo()
                                                  NPCGraphMover.update(deltaMs)
                                                  NPCGraphMover.worldPosition  ──→  npc.x, npc.y
```

### Two classes, two responsibilities

| Class | Role |
|-------|------|
| `LevelGraph` | Shared, static map — vertices + directed edges, A* pathfinding |
| `NPCGraphMover` | Per-NPC cursor — walks along a computed path, emits events, interpolates world position |

One `LevelGraph` per level. One `NPCGraphMover` per offline NPC.

---

## Quick start

```ts
import { LevelGraph, NPCGraphMover } from '@alife-sdk/core/navigation';

// 1. Build the level graph once (e.g. from map data)
const graph = new LevelGraph();

graph
  .addVertex('spawn_01',   100, 500, ['outdoor'])
  .addVertex('bridge_n',   400, 500, ['outdoor'])
  .addVertex('bar_base',   800, 300, ['settlement', 'indoor'])
  .addUndirectedEdge('spawn_01', 'bridge_n')
  .addUndirectedEdge('bridge_n', 'bar_base');

// 2. Create a mover for each offline NPC
const mover = new NPCGraphMover(graph, 'spawn_01', /* speed px/s */ 80);

// 3. Send it somewhere
mover.moveTo('bar_base');

// 4. Tick each A-Life frame
function tick(deltaMs: number): void {
  mover.update(deltaMs);

  // Apply world position to NPC data
  const { x, y } = mover.worldPosition;
  npcRecord.x = x;
  npcRecord.y = y;

  // React to events
  for (const evt of mover.events) {
    if (evt.type === 'completed') console.log(`NPC arrived at ${evt.vertexId}`);
    if (evt.type === 'no_path')   console.warn(`No path ${evt.from} → ${evt.to}`);
  }
}
```

---

## `LevelGraph`

### Building the graph

#### `graph.addVertex(id, x, y, tags?)`

Add a named waypoint. `tags` are arbitrary strings used by `TerrainFilter`.
Returns `this` for chaining.

```ts
graph.addVertex('checkpoint_south', 200, 800, ['outdoor', 'danger']);
```

#### `graph.addEdge(from, to, weight?)`

Add a **directed** edge. If `weight` is omitted, Euclidean distance between
the two vertices is used automatically.

```ts
graph.addEdge('checkpoint_south', 'cordon_gate'); // weight auto-calculated
graph.addEdge('cordon_gate', 'checkpoint_south', 300); // explicit weight
```

#### `graph.addUndirectedEdge(a, b, weight?)`

Shorthand for two symmetric `addEdge` calls.

```ts
graph.addUndirectedEdge('cordon_gate', 'bar_entrance');
```

#### `graph.removeVertex(id)`

Removes the vertex and all its outgoing and incoming edges.

---

### Querying

```ts
graph.hasVertex('bar_base');               // boolean
graph.getVertex('bar_base');               // IGraphVertex | undefined
graph.getEdges('bar_base');               // ReadonlyArray<IGraphEdge>
graph.edgeWeight('spawn_01', 'bridge_n'); // number (Infinity if no direct edge)
graph.vertexCount;                         // number
graph.edgeCount;                           // number
graph.vertexIds();                         // IterableIterator<string>
graph.vertices();                          // IterableIterator<IGraphVertex>
```

---

### `graph.findPath(startId, goalId, filter?)`

A* pathfinding using a binary min-heap. Returns an array of vertex IDs from
`startId` to `goalId` (both inclusive), or `null` if no path exists.

```ts
const path = graph.findPath('spawn_01', 'bar_base');
// ['spawn_01', 'bridge_n', 'bar_base']  or  null
```

**`filter?: TerrainFilter`** — a predicate `(vertex: IGraphVertex) => boolean`.
Vertices where the predicate returns `false` are skipped.
The start and goal vertices are **never filtered out**.

```ts
type TerrainFilter = (vertex: IGraphVertex) => boolean;

// Avoid dangerous zones
const safeOnly: TerrainFilter = (v) => !v.tags.includes('danger');
const path = graph.findPath('spawn_01', 'bar_base', safeOnly);
```

---

### `graph.interpolatePosition(fromId, toId, t)`

Linear interpolation of world position along an edge. `t = 0` → `fromId`
position, `t = 1` → `toId` position. Used internally by `NPCGraphMover`.

---

### Serialisation

```ts
// Save
const state = graph.serialize(); // ILevelGraphState

// Load — static factory
const graph = LevelGraph.restore(state);
```

`ILevelGraphState` is a plain JSON-compatible object — store it alongside
other save data.

---

## `NPCGraphMover`

### Construction

```ts
const mover = new NPCGraphMover(
  graph,        // LevelGraph
  'spawn_01',   // starting vertex ID
  80,           // speed in world units per second
  10,           // timeFactor (optional, default 1.0) — multiplies speed
                // set to match kernel.clock.timeFactor for game-speed parity
);
```

`timeFactor > 1` means the NPC moves faster in simulation time than real time.
Match it to your `Clock.timeFactor` so offline movement stays in sync with
the game world.

---

### Path control

#### `mover.moveTo(destinationId, filter?)`

Compute A* path and start moving. Returns `true` on success, `false` if no
path found (a `'no_path'` event is also queued).

```ts
const ok = mover.moveTo('bar_base');
// or with terrain filter:
const ok = mover.moveTo('bar_base', v => !v.tags.includes('danger'));
```

Calling `moveTo` while already moving **replaces** the current path immediately.

#### `mover.teleport(vertexId)`

Instantly place the NPC at a vertex and clear all movement state. Use on
spawn or save-load.

```ts
mover.teleport('bar_base');
```

#### `mover.setSpeed(speed)`

Change speed at runtime (e.g. when NPC switches from walk to sprint).

---

### `mover.update(deltaMs)`

Advance movement by `deltaMs` milliseconds. Call this every A-Life tick.

The mover walks along the pre-computed path, segment by segment, until the
time budget (`deltaMs`) is exhausted or the destination is reached.

```ts
mover.update(delta);
```

After `update()`, read results via accessors and `events`.

---

### Accessors

| Property | Type | Description |
|----------|------|-------------|
| `worldPosition` | `{ x, y }` | Interpolated world position along current edge |
| `currentVertexId` | `string` | Vertex the NPC is at or moving away from |
| `nextVertexId` | `string \| null` | Next vertex in path (`null` when idle) |
| `isMoving` | `boolean` | `true` while a path is active |
| `walkedDistance` | `number` | Distance walked along current edge |
| `speed` | `number` | Current speed (world units/s) |
| `events` | `ReadonlyArray<GraphMoverEvent>` | Events from the last `update()` call |

---

### `GraphMoverEvent`

Events are produced during `update()` and available via `mover.events`
until the next `update()` call.

```ts
type GraphMoverEvent =
  | { type: 'arrived';   vertexId: string }          // passed through an intermediate vertex
  | { type: 'completed'; vertexId: string }          // reached final destination
  | { type: 'no_path';   from: string; to: string }; // A* found no path
```

```ts
for (const evt of mover.events) {
  switch (evt.type) {
    case 'arrived':
      // NPC is passing through evt.vertexId — trigger area logic
      break;
    case 'completed':
      // NPC reached destination — assign next task
      brain.onArrived(evt.vertexId);
      break;
    case 'no_path':
      // Destination unreachable — pick another terrain
      brain.onNoPath(evt.from, evt.to);
      break;
  }
}
```

---

### Serialisation

`NPCGraphMover` implements `ISerializable<INPCGraphMoverState>`:

```ts
// Save
const state = mover.serialize(); // INPCGraphMoverState

// Load
mover.restore(state);
// Edge weight is recalculated from the graph, so the graph must be restored first.
```

---

## `IGraphVertex` and `IGraphEdge`

```ts
interface IGraphVertex {
  readonly id:   string;
  readonly x:    number;
  readonly y:    number;
  readonly tags: ReadonlyArray<string>; // e.g. ['outdoor', 'indoor', 'danger', 'shelter']
}

interface IGraphEdge {
  readonly to:     string; // destination vertex ID
  readonly weight: number; // edge cost (usually Euclidean distance)
}
```

---

## Tips

**Build the graph from terrain data, not by hand.**
In practice you derive vertices from `SmartTerrain` positions and edges from
adjacency rules defined in your map config:

```ts
for (const terrain of terrainRegistry.all()) {
  graph.addVertex(terrain.id, terrain.x, terrain.y, terrain.tags);
}
for (const [a, b] of adjacencyList) {
  graph.addUndirectedEdge(a, b);
}
```

**Match `timeFactor` to `Clock.timeFactor`.**
If the game clock runs at 10× real time, pass `timeFactor: 10` so offline
NPCs cover the right simulated distance each real-world millisecond.

**Use `TerrainFilter` for dynamic routing.**
Tag vertices with `'danger'`, `'surge_unsafe'`, `'locked'` and pass a filter
to `moveTo()` so NPCs automatically avoid restricted areas without rebuilding
the graph.

```ts
const filter: TerrainFilter = (v) =>
  !v.tags.includes('danger') && !v.tags.includes('locked');

mover.moveTo(targetId, filter);
```

**`arrived` vs `completed`.**
`arrived` fires at every intermediate vertex along the route — good for
triggering area-specific logic (e.g. emitting a sound, updating faction
presence). `completed` fires once at the final destination.

**Always `teleport()` on load before `restore()`.**
The graph must already exist and the mover must have a valid starting vertex
before `restore()` recalculates the cached edge weight.
