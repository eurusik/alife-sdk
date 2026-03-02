# navigation

NPC movement pipeline for `@alife-sdk/ai`: path smoothing, path following,
zone-based movement constraints, and flocking/steering behaviors.

```ts
import {
  smoothPath,
  smoothPathWithTurning,
  SmoothPathFollower,
  RestrictedZoneManager,
  RestrictionType,
  computePackSteering,
  createDefaultSteeringConfig,
} from '@alife-sdk/ai/navigation';
```

---

## What the SDK gives you

| Component | What it does |
|-----------|--------------|
| `smoothPath()` | Converts sparse waypoints → dense smooth path via Catmull-Rom splines |
| `smoothPathWithTurning()` | Same as above, plus Dubins arc insertions at sharp turns |
| `SmoothPathFollower` | Per-NPC cursor that advances through the dense path with curvature-based velocity |
| `RestrictedZoneManager` | Circular zones: hard constraints (IN/OUT) + soft danger avoidance |
| Steering behaviors | Pure functions for separation, cohesion, alignment, and pack movement |

---

## Quick start — single NPC patrolling

```ts
import { smoothPath, SmoothPathFollower } from '@alife-sdk/ai/navigation';
import { createDefaultAIConfig } from '@alife-sdk/ai/config';
import { SeededRandom } from '@alife-sdk/core';
import type { Vec2 } from '@alife-sdk/core';
import type { INavigationConfig } from '@alife-sdk/ai/types';

const config = createDefaultAIConfig();
const navConfig: INavigationConfig = config.navigation;
const rng = new SeededRandom(42); // deterministic jitter

// Step 1: Build a sparse waypoint list from your map data
const waypoints = [
  { x: 100, y: 100 },
  { x: 300, y: 120 },
  { x: 500, y: 200 },
];

// Step 2: Smooth the path (pass a shared cache for multiple NPCs on the same route)
const pathCache = new Map<string, readonly Vec2[]>();
const densePoints = smoothPath(waypoints, navConfig, rng, pathCache);

// Step 3: Create a follower per NPC
const follower = new SmoothPathFollower(densePoints, navConfig);

// Step 4: Each frame
function updateNPC(npc: MyNPC, deltaMs: number) {
  follower.updatePosition(npc.x, npc.y);

  const target = follower.getCurrentTarget();
  if (!target) {
    // Path complete — pick next patrol segment
    return;
  }

  const speed = npc.baseSpeed * follower.getCurrentVelocityMultiplier();
  npc.moveToward(target.x, target.y, speed, deltaMs);
}
```

---

## Quick start — squad flocking

```ts
import {
  computePackSteering,
  blendWithPrimary,
  createDefaultSteeringConfig,
} from '@alife-sdk/ai/navigation';

const steeringConfig = createDefaultSteeringConfig();

function updateSquadMember(self: MyNPC, allies: MyNPC[], target: { x: number; y: number }) {
  const neighborPositions = allies.map((a) => ({ x: a.x, y: a.y }));
  const steeringForce = computePackSteering(
    { x: self.x, y: self.y },
    neighborPositions,
    steeringConfig,
  );

  const dx = target.x - self.x;
  const dy = target.y - self.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const { vx, vy } = blendWithPrimary(dx / dist, dy / dist, steeringForce, self.speed, 0.4);

  self.setVelocity(vx, vy);
}
```

---

## Quick start — restricted zones

```ts
import { RestrictedZoneManager, RestrictionType } from '@alife-sdk/ai/navigation';

const zones = new RestrictedZoneManager(20); // 20px safety margin

// Register zones
zones.addZone({ id: 'anomaly_1', type: RestrictionType.OUT,    x: 400, y: 300, radius: 80,  active: true });
zones.addZone({ id: 'base_1',   type: RestrictionType.IN,     x: 200, y: 200, radius: 300, active: true });
zones.addZone({ id: 'sniper_1', type: RestrictionType.DANGER, x: 600, y: 150, radius: 200, active: true, metadata: 'surge' });

// Before choosing a waypoint:
if (!zones.accessible(npc.nextWaypoint.x, npc.nextWaypoint.y)) {
  const safeDir = zones.getSafeDirection(npc.x, npc.y);
  if (safeDir) npc.flee(safeDir.x, safeDir.y);
}

// Filter an entire list:
const safePts = zones.filterAccessibleWaypoints(patrolRoute.waypoints);

// Remove all surge-tagged zones after surge ends:
zones.removeByMetadata('surge');
```

---

## Navigation pipeline

The typical per-NPC movement pipeline:

```
Sparse waypoints (map data)
       │
       ▼  smoothPath() or smoothPathWithTurning()
Dense Vec2[] (smooth curve with optional arc turns)
       │
       ▼  new SmoothPathFollower(densePoints, config)
Per-NPC cursor + velocity profile
       │
       ▼  Each frame: follower.updatePosition(x, y)
              → getCurrentTarget() → move NPC
              → getCurrentVelocityMultiplier() × baseSpeed
       │
       ▼  (optional) computePackSteering() → blendWithPrimary()
Steering correction for squads / packs
       │
       ▼  (optional) zones.accessible(x, y)
Zone constraint enforcement
```

---

## Components

| File | Purpose |
|------|---------|
| [PathSmoother.md](PathSmoother.md) | `smoothPath()` and `smoothPathWithTurning()` — Catmull-Rom + Dubins arcs |
| [SmoothPathFollower.md](SmoothPathFollower.md) | `SmoothPathFollower` — per-NPC dense-path cursor with velocity profiles |
| [RestrictedZoneManager.md](RestrictedZoneManager.md) | `RestrictedZoneManager` — hard IN/OUT zones + soft DANGER zones |
| [SteeringBehaviors.md](SteeringBehaviors.md) | Separation, cohesion, alignment, pack steering, force blending |

---

## INavigationConfig

All navigation parameters live in `config.navigation` (from `createDefaultAIConfig()`):

| Field | Default | Description |
|-------|---------|-------------|
| `smoothPointsPerSegment` | `8` | Catmull-Rom interpolation density |
| `smoothRandomOffset` | `10` px | Max jitter on interior path points |
| `arrivalThreshold` | `8` px | Distance to consider a waypoint reached |
| `dubinsMaxInstantTurn` | `π/4` (45°) | Turn angle above which an arc is inserted |
| `dubinsTurningRadius` | `60` px | Arc radius for Dubins turns |
| `velocityCurveFast` | `1.0` | Multiplier on straight segments |
| `velocityCurveMedium` | `0.7` | Multiplier on moderate turns |
| `velocityCurveSlow` | `0.4` | Multiplier on sharp turns |
| `velocityTransitionRate` | `0.15` | Per-step lerp rate between speed bands |
| `restrictedZoneSafeMargin` | `20` px | Extra clearance around OUT zones |

Override individual fields:

```ts
const config = createDefaultAIConfig({
  navigation: { arrivalThreshold: 12, smoothRandomOffset: 5 },
});
```
