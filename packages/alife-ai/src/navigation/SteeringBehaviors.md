# SteeringBehaviors

Craig Reynolds-style flocking and pack movement for NPC groups.
All functions are pure — no side effects, no mutable state.

```ts
import {
  separation,
  cohesion,
  alignment,
  combineForces,
  computePackSteering,
  blendWithPrimary,
  createDefaultSteeringConfig,
} from '@alife-sdk/ai/navigation';
import type { ISteeringConfig } from '@alife-sdk/ai/navigation';
```

---

## ISteeringConfig

Tuning parameters for all steering behaviors.

```ts
interface ISteeringConfig {
  separationRadius:  number;  // Min distance before repulsion kicks in (px). Default: 40
  separationWeight:  number;  // Weight of separation force. Default: 1.5
  neighborRadius:    number;  // Radius for cohesion neighbors (px). Default: 150
  cohesionWeight:    number;  // Weight of cohesion force. Default: 0.5
  alignmentWeight:   number;  // Weight of alignment force. Default: 0.3
  maxSteeringForce:  number;  // Max combined force magnitude (px/s). Default: 80
}
```

### createDefaultSteeringConfig(overrides?): ISteeringConfig

Create a config with production defaults. Pass a partial override object to
tune individual values:

```ts
const cfg = createDefaultSteeringConfig();
// or:
const cfg = createDefaultSteeringConfig({ separationRadius: 60, maxSteeringForce: 120 });
```

---

## Primitive steering forces

### separation(self, neighbors, config): Vec2

Repulsion force — pushes the NPC away from neighbors that are too close.

```ts
const repulsion = separation({ x: npc.x, y: npc.y }, allyPositions, cfg);
```

- Only neighbors within `separationRadius` contribute.
- Force strength is linear: `strength = 1 - dist / separationRadius`.
  At the edge of the radius the strength is 0; at zero distance it is 1.
  Neighbors closer to the NPC contribute a proportionally stronger push.
- Returns a normalized unit vector (direction only, not scaled by `separationWeight`).
- Returns `ZERO` when no neighbors are within radius.

### cohesion(self, neighbors, config): Vec2

Attraction force — pulls the NPC toward the average position of nearby neighbors.

```ts
const attraction = cohesion({ x: npc.x, y: npc.y }, allyPositions, cfg);
```

- Only neighbors within `neighborRadius` contribute.
- Returns a normalized unit vector pointing toward the group's center of mass.
- Returns `ZERO` when no neighbors are within radius.

### alignment(neighborDirections): Vec2

Direction-matching force — steers the NPC toward the average movement direction
of its neighbors.

```ts
// Build desired-direction vectors for each neighbor:
const dirs = allies.map((a) => {
  const dx = a.target.x - a.x;
  const dy = a.target.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  return len > 0.001 ? { x: dx / len, y: dy / len } : { x: 0, y: 0 };
});

const aligned = alignment(dirs);
```

> **Note:** `alignment` takes desired directions of **neighbors** — not positions.
> There is intentionally no `self` parameter. The caller is responsible for
> building the `neighborDirections` array (e.g. `normalize(neighborTarget − neighborPos)`
> for each neighbor).

- Returns a normalized unit vector (the average direction).
- Returns `ZERO` when the input array is empty.
- The `alignmentWeight` from config is applied by the caller via `combineForces`.

---

## combineForces(forces, maxMagnitude): Vec2

Weighted sum of arbitrary forces, clamped to `maxMagnitude`.

This is the **extensibility escape-hatch**: compose any mix of built-in forces
with your own custom forces without modifying the SDK.

```ts
const combined = combineForces([
  { force: sep,         weight: cfg.separationWeight },
  { force: coh,         weight: cfg.cohesionWeight   },
  { force: aligned,     weight: cfg.alignmentWeight  },
  { force: formationVec, weight: 2.0 },  // custom formation force
], cfg.maxSteeringForce);
```

| Parameter | Description |
|-----------|-------------|
| `forces` | Array of `{ force: Vec2, weight: number }` entries. |
| `maxMagnitude` | Maximum allowed result magnitude (px/s). |

- Returns the weighted vector sum, scaled down if it exceeds `maxMagnitude`.
- Returns `ZERO` when all forces are zero.

---

## Convenience helpers

### computePackSteering(self, neighbors, config): Vec2

Combined separation + cohesion force, clamped to `maxSteeringForce`.

```ts
const steering = computePackSteering(
  { x: npc.x, y: npc.y },
  allyPositions,
  cfg,
);
```

- **Does not include alignment** — alignment requires caller-supplied desired
  directions. Use `combineForces` to add it.
- Returns `ZERO` when `neighbors` is empty.

Equivalent to:

```ts
combineForces([
  { force: separation(self, neighbors, config), weight: config.separationWeight },
  { force: cohesion(self, neighbors, config),   weight: config.cohesionWeight   },
], config.maxSteeringForce);
```

### blendWithPrimary(primaryVx, primaryVy, steeringForce, speed, weight): { vx, vy }

Blend a desired movement direction with a steering correction force, returning
a velocity vector ready for `entity.setVelocity()`.

```ts
// Primary direction: toward patrol target
const dx = target.x - npc.x;
const dy = target.y - npc.y;
const dist = Math.sqrt(dx * dx + dy * dy);

const steering = computePackSteering({ x: npc.x, y: npc.y }, allyPositions, cfg);

const { vx, vy } = blendWithPrimary(
  dx / dist,      // normalized X toward target
  dy / dist,      // normalized Y toward target
  steering,       // flocking correction
  npc.speed,      // final velocity magnitude
  0.4,            // 40% steering, 60% primary direction
);

npc.setVelocity(vx, vy);
```

| Parameter | Description |
|-----------|-------------|
| `primaryVx, primaryVy` | **Normalized** desired direction. Caller must normalize beforehand. |
| `steeringForce` | Output of `computePackSteering()` or `combineForces()`. |
| `speed` | Base movement speed in px/s. The result is always this magnitude. |
| `weight` | Blend: `0.0` = pure primary direction × speed, `1.0` = pure steering. |

**Result magnitude is `speed`** in the normal case — the blended direction
is re-normalized to `speed` internally. Exception: returns `{ vx: 0, vy: 0 }`
if the blended direction has magnitude < 0.001 (e.g. when primary direction
and steering force cancel each other out perfectly).

> **Force magnitude is discarded:** `blendWithPrimary` normalizes the
> steering force to a unit vector before blending. Only the direction of the
> steering force matters; its magnitude is ignored. The `weight` parameter
> controls the directional split, not a force-strength ratio.

---

## Typical squad update

```ts
import {
  computePackSteering,
  alignment,
  combineForces,
  blendWithPrimary,
  createDefaultSteeringConfig,
} from '@alife-sdk/ai/navigation';

const cfg = createDefaultSteeringConfig();

function updateSquadMember(self: MyNPC, squad: MyNPC[], primaryTarget: Vec2) {
  const allyPositions = squad
    .filter((a) => a.id !== self.id)
    .map((a) => ({ x: a.x, y: a.y }));

  // Separation + cohesion:
  const packForce = computePackSteering({ x: self.x, y: self.y }, allyPositions, cfg);

  // Alignment (optional):
  const allyDirs = squad
    .filter((a) => a.id !== self.id && a.target)
    .map((a) => {
      const dx = a.target!.x - a.x;
      const dy = a.target!.y - a.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      return len > 0.001 ? { x: dx / len, y: dy / len } : { x: 0, y: 0 };
    });
  const alignForce = alignment(allyDirs);

  // Combine with alignment:
  const steeringForce = combineForces([
    { force: packForce,  weight: 1.0 },
    { force: alignForce, weight: cfg.alignmentWeight },
  ], cfg.maxSteeringForce);

  // Blend with primary movement:
  const dx = primaryTarget.x - self.x;
  const dy = primaryTarget.y - self.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.001) return;

  const { vx, vy } = blendWithPrimary(dx / dist, dy / dist, steeringForce, self.speed, 0.35);
  self.setVelocity(vx, vy);
}
```

---

## Custom forces via combineForces

`combineForces` lets you add any game-specific forces without touching the SDK:

```ts
// Formation force: push NPC toward assigned squad slot
const formationOffset = squadFormation.getSlotPosition(self.squadSlot);
const formDx = formationOffset.x - self.x;
const formDy = formationOffset.y - self.y;
const formLen = Math.sqrt(formDx * formDx + formDy * formDy);
const formationForce = formLen > 0.001
  ? { x: formDx / formLen, y: formDy / formLen }
  : ZERO;

const combined = combineForces([
  { force: packForce,     weight: cfg.separationWeight },
  { force: formationForce, weight: 2.0 },
], cfg.maxSteeringForce);
```

---

## Known limitations

**Co-located agents:** When two NPCs are at exactly the same world position,
`separation()` skips them (`distSq === 0` check). Similarly, `cohesion()`
returns `ZERO` when the center of mass coincides with the NPC's own position.
The result is zero steering force — co-located NPCs will not push apart.

Mitigation: ensure NPCs spawn with small position offsets (even 1px is enough),
or add a startup jitter pass before the first steering update.

---

## Performance note

All functions accept and return plain `Vec2` objects. The primitive functions
(`separation`, `cohesion`, `alignment`) return a new `Vec2` or the shared
`ZERO` constant (imported from `@alife-sdk/core`) — `ZERO` is returned when
the result is the zero vector, avoiding allocation.

`combineForces` and `computePackSteering` always allocate a new `Vec2` for
non-zero results.
