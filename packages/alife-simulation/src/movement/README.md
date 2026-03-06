# movement

Offline NPC transit between terrain zones — two interchangeable implementations
behind a common interface.

```ts
import { MovementSimulator, GraphMovementSimulator } from '@alife-sdk/simulation/movement';
import type { IMovementSimulator } from '@alife-sdk/simulation/movement';
```

---

## What's in this module

| Export | Kind | What it does |
|--------|------|-------------|
| `IMovementSimulator` | interface | Common contract — both simulators satisfy this |
| `MovementSimulator` | class | Straight-line lerp — simple, zero graph dependency |
| `GraphMovementSimulator` | class | Waypoint graph routing via `LevelGraph` |

Both implement `IMovementDispatcher` from the `brain` module, so they plug
directly into `NPCBrain.setMovementDispatcher()`.

---

## IMovementSimulator

The interface both implementations share. Use it for type annotations and to
keep your code independent of the concrete class:

```ts
interface IMovementSimulator extends IMovementDispatcher {
  update(deltaMs: number): void;
  getPosition(npcId: string): Vec2 | null;
  readonly activeCount: number;
  clear(): void;
}
```

---

## MovementSimulator

Straight-line time-based lerp. Each journey is a direct segment from one
position to another — no pathfinding, no graph.

### Setup

```ts
import { MovementSimulator } from '@alife-sdk/simulation/movement';

const sim = new MovementSimulator(aLifeEventBus);
brain.setMovementDispatcher(sim);
```

### How it works

```ts
// Start a journey (called internally by NPCBrain)
sim.addMovingNPC(
  'npc_1',
  'zone_a',          // from terrain id
  'zone_b',          // to terrain id
  { x: 0, y: 0 },   // from position
  { x: 200, y: 0 }, // to position
  50,                // speed px/s (optional, default 50)
);

// Advance each tick
sim.update(deltaMs);

// Query mid-journey position
const pos = sim.getPosition('npc_1'); // → Vec2 | null (lerped)

// On arrival: NPC_MOVED event emitted, journey removed from active set
sim.isMoving('npc_1');  // → false
sim.activeCount;        // → number of journeys in progress
```

**Travel time** = `distance(from, to) / speed × 1000` ms.
Journeys shorter than 1 px are treated as instant (no entry created).

### Cancellation

```ts
sim.cancelJourney('npc_1'); // remove from active set, no event emitted
sim.clear();                // cancel all journeys silently
```

### Complexity

| Operation | Cost |
|-----------|------|
| `addMovingNPC` | O(1) |
| `update(deltaMs)` | O(n) — n active journeys |
| `getPosition` | O(1) |

---

## GraphMovementSimulator

Drop-in replacement for `MovementSimulator` that routes NPCs through a
`LevelGraph` rather than in a straight line. Use when your world has
corridors, doors, or map topology that matters even for offline simulation.

### Setup

```ts
import { GraphMovementSimulator } from '@alife-sdk/simulation/movement';
import { LevelGraph } from '@alife-sdk/core';

const graph = new LevelGraph();
graph.addVertex('v1', 100, 0);
graph.addVertex('v2', 200, 0);
graph.addVertex('v3', 200, 100);
graph.addEdge('v1', 'v2', 100);
graph.addEdge('v2', 'v3', 100);

const sim = new GraphMovementSimulator(graph, aLifeEventBus, 50 /* default speed */);
brain.setMovementDispatcher(sim);
```

### How it works

1. `addMovingNPC()` snaps `fromPos` and `toPos` to the nearest graph vertices
   (O(V) linear scan).
2. `NPCGraphMover` traverses the shortest path waypoint-by-waypoint.
3. When the mover fires `'completed'`, `NPC_MOVED` is emitted — identical to
   `MovementSimulator`.

### Fallback behaviour

| Condition | Result |
|-----------|--------|
| No vertices in graph | `NPC_MOVED` emitted immediately (instant teleport) |
| No path between vertices | `NPC_MOVED` emitted immediately |
| Start vertex === destination vertex | `NPC_MOVED` emitted immediately |

Fallback makes the graph simulator safe as a direct replacement — existing
journeys always complete.

### Position query

```ts
sim.getPosition('npc_1'); // → Vec2 (world position along graph edges) | null
```

Returns the interpolated world position along the current graph edge while
the NPC is mid-journey.

### Performance note

Nearest-vertex lookup is O(V). For graphs with 500+ vertices, wrap the lookup
with a `SpatialGrid`-backed structure instead.

---

## Custom implementation

Implement `IMovementSimulator` to plug in any pathfinding backend — PathfinderJS,
EasyStar, a navmesh, etc. — without modifying the SDK:

```ts
import type { IMovementSimulator } from '@alife-sdk/simulation/movement';
import { SimulationPlugin } from '@alife-sdk/simulation/plugin';

class PathfinderJSAdapter implements IMovementSimulator {
  addMovingNPC(npcId, fromTerrainId, toTerrainId, fromPos, toPos, speed) { /* ... */ }
  isMoving(npcId) { return false; }
  cancelJourney(npcId) {}
  update(deltaMs) { /* advance grid path, emit NPC_MOVED on arrival */ }
  getPosition(npcId) { return null; }
  get activeCount() { return 0; }
  clear() {}
}

const sim = new SimulationPlugin({
  movementSimulator: new PathfinderJSAdapter(),
});
```

See `examples/10-custom-pathfinder.ts` for a full working example.

---

## Choosing between the three

| | `MovementSimulator` | `GraphMovementSimulator` | Custom |
|---|---|---|---|
| Pathfinding | No — straight line | Yes — LevelGraph A* | Whatever you implement |
| Setup | Minimal (just events) | Requires a built `LevelGraph` | Implement `IMovementSimulator` |
| Position accuracy | Good for open worlds | Better for corridors/rooms | Up to you |
| Perf at 200+ NPCs | O(n) per tick | O(n) per tick + O(V) per start | Up to you |
| Fallback on no path | n/a | Instant teleport | Up to you |

All three are interchangeable via `IMovementSimulator` — switch implementations
without changing brain or simulation code.

---

## Integration with NPCBrain

```ts
// Inject once after creating the simulator
brain.setMovementDispatcher(sim);

// Call in the simulation tick loop
sim.update(deltaMs);
brain.update(deltaMs, terrains, terrainStates);

// Read mid-journey position (e.g. to update offline NPC position on minimap)
const pos = sim.getPosition(npcId);
if (pos) npcRecord.lastPosition = pos;
```
