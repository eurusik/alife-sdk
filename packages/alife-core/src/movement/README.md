# movement

Two independent primitives for moving entities through the world:
**`PatrolRouteTracker`** — stateful cursor over a waypoint route, and
**`MonsterHome`** — 3-radius lair territory system for mutants.

```ts
import { PatrolRouteTracker, RouteType, MonsterHome } from '@alife-sdk/core/movement';
import type { PatrolRoute, ILairConfig, RouteAdvancer } from '@alife-sdk/core/movement';
```

---

## PatrolRoute + PatrolRouteTracker

### Concept

A **`PatrolRoute`** is a plain data object — an ordered list of world-space waypoints plus a traversal rule. It lives on a SmartTerrain and is shared (immutable) among all NPCs assigned to that terrain.

Each NPC gets its own **`PatrolRouteTracker`** — a lightweight cursor that remembers which waypoint the NPC is heading toward and handles route cycling automatically.

```
SmartTerrain.route  ──(shared, read-only)──►  PatrolRoute
                                                    │
NPC_01.tracker  ──►  PatrolRouteTracker ────────────┘
NPC_02.tracker  ──►  PatrolRouteTracker ────────────┘
```

### Route types

| Constant | String | Behaviour |
|----------|--------|-----------|
| `RouteType.LOOP` | `'loop'` | A→B→C→A→B→C→… cyclic, never ends |
| `RouteType.PING_PONG` | `'ping_pong'` | A→B→C→B→A→B→… reverses at each end |
| `RouteType.ONE_WAY` | `'one_way'` | A→B→C, stops at the last waypoint |

`RouteType` is an open string union — you can pass custom strings and supply a `RouteAdvancer` callback to handle them.

---

### `PatrolRoute` — data shape

```ts
interface PatrolRoute {
  readonly id:        string;                    // unique within the terrain
  readonly terrainId: string;                    // owning SmartTerrain
  readonly waypoints: readonly IPatrolWaypoint[];// at least 1 entry
  readonly routeType: RouteType;
}

interface IPatrolWaypoint {
  readonly x:        number;
  readonly y:        number;
  readonly waitTime?: number; // ms to pause before advancing (optional)
}
```

---

### `PatrolRouteTracker` — API

#### Construction

```ts
const tracker = new PatrolRouteTracker(route);

// With a custom advancement callback (see RouteAdvancer below)
const tracker = new PatrolRouteTracker(route, myAdvancer);
```

#### `tracker.currentWaypoint`

The `IPatrolWaypoint` the NPC is currently heading toward.

```ts
const { x, y } = tracker.currentWaypoint;
npc.moveTo(x, y);
```

#### `tracker.advance()`

Move the cursor to the next waypoint. Handles all three route types automatically (or delegates to a custom `RouteAdvancer`). Initialises the wait timer when the new waypoint has a `waitTime`.

Call this **after** the NPC has arrived at `currentWaypoint`.

```ts
if (arrivedAt(tracker.currentWaypoint)) {
  tracker.advance();
}
```

#### `tracker.tickWait(deltaMs)`

Decrements the wait timer at the current waypoint. Returns `true` when the wait is over — the signal to start moving.

```ts
if (!tracker.tickWait(delta)) {
  return; // still waiting
}
npc.moveTo(tracker.currentWaypoint.x, tracker.currentWaypoint.y);
```

#### `tracker.isComplete`

`true` only for `ONE_WAY` routes once the final waypoint is reached. Always `false` for `LOOP` and `PING_PONG`.

```ts
if (tracker.isComplete) {
  npc.enterState('IDLE');
}
```

#### `tracker.waypointCount`

Total number of waypoints in the underlying route.

#### `tracker.reset()`

Resets the cursor to waypoint 0, clears direction, wait timer, and completion flag.

---

### `RouteAdvancer` — custom route logic

Supply this callback to override the built-in `LOOP / PING_PONG / ONE_WAY` logic with your own:

```ts
type RouteAdvancer = (
  currentIndex:  number,
  waypointCount: number,
  direction:     1 | -1,
) => { index: number; direction: 1 | -1; completed: boolean };
```

Example — random waypoint each step:

```ts
const randomAdvancer: RouteAdvancer = (_i, count, dir) => ({
  index:     Math.floor(Math.random() * count),
  direction: dir,
  completed: false,
});

const tracker = new PatrolRouteTracker(route, randomAdvancer);
```

---

### Full patrol loop example

```ts
import { PatrolRouteTracker, RouteType } from '@alife-sdk/core/movement';
import type { PatrolRoute } from '@alife-sdk/core/movement';

const route: PatrolRoute = {
  id:        'guard_post_a',
  terrainId: 'cordon_checkpoint',
  routeType: RouteType.LOOP,
  waypoints: [
    { x: 100, y: 200 },
    { x: 300, y: 200, waitTime: 2000 }, // pause 2 s at this point
    { x: 300, y: 400 },
    { x: 100, y: 400 },
  ],
};

const tracker = new PatrolRouteTracker(route);

// Each frame:
function updatePatrol(deltaMs: number): void {
  if (!tracker.tickWait(deltaMs)) return; // waiting at waypoint

  const { x, y } = tracker.currentWaypoint;

  if (arrivedAt(x, y)) {
    tracker.advance();
  } else {
    npc.walkToward(x, y, deltaMs);
  }
}
```

---

## MonsterHome

### Concept

`MonsterHome` models the territory of a mutant as **three concentric circles** around an anchor point:

```
        ┌─────────────────────────────────────────┐  outer radius
        │   ┌─────────────────────────────┐        │  patrol radius (roam zone)
        │   │   ┌───────────────┐         │        │  inner radius (personal space)
        │   │   │    anchor     │         │        │
        │   │   └───────────────┘         │        │
        │   └─────────────────────────────┘        │
        └─────────────────────────────────────────┘
```

| Zone | When triggered |
|------|----------------|
| **inner** | Intruder too close → immediate attack |
| **patrol annulus** (between inner and patrol) | Monster roams here when idle |
| **outer** | Hard pursuit boundary — monster breaks off chase if prey goes beyond it |

`MonsterHome` enforces the hierarchy at construction: `inner < patrol < outer` (minimum 1 px gap each).

All zone checks use **squared distance** — no `Math.sqrt` in the hot path.

---

### `ILairConfig`

```ts
interface ILairConfig {
  readonly anchor:       Vec2;
  readonly innerRadius:  number;  // personal space radius (px)
  readonly patrolRadius: number;  // roam zone outer edge (px)
  readonly outerRadius:  number;  // pursuit boundary (px)
}
```

---

### Construction

```ts
import { MonsterHome } from '@alife-sdk/core/movement';

const home = new MonsterHome({
  anchor:       { x: 512, y: 512 },
  innerRadius:  80,
  patrolRadius: 250,
  outerRadius:  600,
});

// With deterministic random (for tests)
import { SeededRandom } from '@alife-sdk/core/ports';
const home = new MonsterHome(config, new SeededRandom(42));
```

---

### Zone checks

```ts
// Intruder is right on top of the monster — attack immediately
if (home.isInInnerZone(player)) {
  monster.attack(player);
}

// Monster is idle — send it to a patrol point
if (home.isInPatrolZone(monster)) {
  const target = home.getRandomPatrolPoint();
  monster.walkTo(target.x, target.y);
}

// Monster chasing — give up if prey escapes outer boundary
if (home.isOutOfTerritory(prey)) {
  monster.returnToLair();
}
```

| Method | Returns `true` when… |
|--------|-----------------------|
| `isInInnerZone(point)` | point ≤ innerRadius from anchor |
| `isInPatrolZone(point)` | innerRadius < point ≤ patrolRadius |
| `isInOuterZone(point)` | point ≤ outerRadius from anchor |
| `isOutOfTerritory(point)` | point > outerRadius from anchor |

---

### `home.getRandomPatrolPoint()`

Returns a random `Vec2` inside the **patrol annulus** (between `innerRadius` and `patrolRadius`). Uses polar sampling for a uniform distribution — no clustering near the centre.

```ts
const wanderTarget = home.getRandomPatrolPoint();
monster.walkTo(wanderTarget.x, wanderTarget.y);
```

---

### `home.distanceFromAnchorSq(point)`

Squared Euclidean distance from the anchor to `point`. Use this when you need the raw distance value for custom threshold checks without paying for a `Math.sqrt`:

```ts
const dsq = home.distanceFromAnchorSq(entity);
if (dsq < AGGRO_RADIUS * AGGRO_RADIUS) { ... }
```

---

### Typical monster AI cycle

```ts
function updateMonster(monster: IMonsterEntity, deltaMs: number): void {
  const home  = monster.monsterHome;
  const pos   = { x: monster.x, y: monster.y };
  const enemy = findNearestEnemy(monster);

  if (!enemy) {
    // No threat — roam within patrol zone
    if (!monster.hasPatrolTarget || arrivedAt(monster.patrolTarget)) {
      monster.patrolTarget = home.getRandomPatrolPoint();
    }
    monster.walkTo(monster.patrolTarget, deltaMs);
    return;
  }

  const enemyPos = { x: enemy.x, y: enemy.y };

  if (home.isInInnerZone(enemyPos)) {
    monster.attack(enemy);            // always attack inner intruders
  } else if (home.isOutOfTerritory(enemyPos)) {
    monster.returnToLair();           // give up chase
  } else {
    monster.chaseAndAttack(enemy);    // pursue inside outer zone
  }
}
```

---

## Tips

**One `PatrolRoute`, many trackers.**
The route data is immutable and shared — creating one route object per terrain is correct. Each NPC allocates only its tracker (3 primitive fields + 1 object reference).

**`ONE_WAY` + `isComplete` for triggered movement.**
Useful for scripted patrol escorts or quest-driven paths. Check `isComplete` each frame and transition the NPC to another state when done.

**`waitTime` for natural behaviour.**
Add a 1-3 second `waitTime` to key waypoints (doors, windows, corners) to make guards look like they're scanning rather than mechanically pacing.

**Radius hierarchy is enforced automatically.**
`MonsterHome` will silently clamp radii so `inner < patrol < outer`. Still, set sensible values — a patrol zone barely larger than the inner zone leaves almost no room to roam.

**Inject `IRandom` for deterministic tests.**
Both `MonsterHome` and any system that samples patrol points should accept an `IRandom` port so tests can seed the RNG and get repeatable results.
