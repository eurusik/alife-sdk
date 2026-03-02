# RestrictedZoneManager

Manages circular zones that constrain or warn about NPC movement.
Instance-based — no global state. Create one per simulation.

```ts
import { RestrictedZoneManager, RestrictionType } from '@alife-sdk/ai/navigation';
import type { IRestrictedZone } from '@alife-sdk/ai/navigation';
```

---

## Zone types

Three restriction types with distinct semantics:

| Type | Value | Meaning |
|------|-------|---------|
| `RestrictionType.IN` | `0` | Hard constraint: NPC **must stay inside** the zone. |
| `RestrictionType.OUT` | `1` | Hard constraint: NPC **cannot enter** the zone (+ safeMargin buffer). |
| `RestrictionType.DANGER` | `2` | Soft avoidance: NPC **prefers to avoid** but can enter. No hard enforcement. |

> **Important:** `accessible()` enforces only `OUT` and `IN` zones. It ignores
> `DANGER` zones. Use `isDangerous()` separately to check for soft danger.

---

## IRestrictedZone

```ts
interface IRestrictedZone {
  readonly id: string;        // Unique identifier for this zone
  readonly type: RestrictionType;
  readonly x: number;         // Zone center X (world space)
  readonly y: number;         // Zone center Y (world space)
  readonly radius: number;    // Zone radius (px)
  active: boolean;            // false = zone exists but is not checked
  readonly metadata?: string; // Optional tag for bulk removal
}
```

`active` is the only mutable field — use `setActive()` to toggle zones without
removing them.

---

## Constructor

```ts
new RestrictedZoneManager(safeMargin: number)
```

| Parameter | Description |
|-----------|-------------|
| `safeMargin` | Extra clearance around `OUT` zones (px). Default from config: `20`. |

The safe margin is only applied to `OUT` zones in `accessible()` and
`getSafeDirection()`. `IN` and `DANGER` zones use their exact radius.

```ts
import { createDefaultAIConfig } from '@alife-sdk/ai/config';
const config = createDefaultAIConfig();
const zones = new RestrictedZoneManager(config.navigation.restrictedZoneSafeMargin);
```

---

## Zone lifecycle

### addZone(zone): void

Register a zone.

```ts
zones.addZone({
  id: 'anomaly_1',
  type: RestrictionType.OUT,
  x: 400, y: 300, radius: 80,
  active: true,
});
```

### removeZone(id): void

Remove a zone by ID.

```ts
zones.removeZone('anomaly_1');
```

### setActive(id, active): void

Toggle a zone without removing it. Inactive zones are skipped in all checks.

```ts
zones.setActive('base_boundary', false); // Temporarily disable
zones.setActive('base_boundary', true);  // Re-enable
```

### removeByMetadata(tag): void

Remove all zones with a matching `metadata` tag. Useful for bulk cleanup:

```ts
// Add surge-related zones with a tag
zones.addZone({ id: 'surge_1', type: RestrictionType.DANGER, ..., metadata: 'surge' });
zones.addZone({ id: 'surge_2', type: RestrictionType.DANGER, ..., metadata: 'surge' });

// Remove all surge zones when the surge ends
zones.removeByMetadata('surge');
```

### getAllZones(): readonly IRestrictedZone[]

Returns all registered zones (active and inactive).

### getZonesAt(x, y): readonly IRestrictedZone[]

Returns all **active** zones whose radius contains the point `(x, y)`,
regardless of zone type. Useful for queries like "what zones is this NPC in?"

```ts
const current = zones.getZonesAt(npc.x, npc.y);
```

### size: number

Number of registered zones (includes inactive).

### clear(): void

Remove all zones.

---

## accessible(x, y): boolean

Check if a position satisfies all hard zone constraints.

```ts
if (!zones.accessible(target.x, target.y)) {
  // Cannot move there — pick a different target
}
```

**Rules:**
- `OUT` zone: position must be outside `zone.radius + safeMargin`.
- `IN` zone: position must be inside `zone.radius`.
- `DANGER` zone: **ignored** (soft avoidance only — does not affect this check).
- Inactive zones are skipped.
- Uses squared-distance for performance. Early-exits on the first violation.

---

## isDangerous(x, y): boolean

Check if a position is inside any active `DANGER` zone.

```ts
if (zones.isDangerous(npc.x, npc.y)) {
  // NPC is in a soft-danger area — consider fleeing
}
```

Does **not** prevent movement. Use this to trigger warning behavior (DANGER
states, flee logic, etc.) without hard-blocking the NPC.

---

## getSafeDirection(x, y): Vec2 | null

Compute a unit vector pointing away from the nearest violated zone.

```ts
const dir = zones.getSafeDirection(npc.x, npc.y);
if (dir) {
  npc.moveInDirection(dir.x, dir.y, speed);
}
```

- Checks `OUT` and `DANGER` zones (not `IN` zones).
- Returns the escape direction from the **nearest** violating zone.
- Returns `null` if the position is already safe (no violations).
- Returns `{ x: 1, y: 0 }` as a fallback if the NPC is exactly at the zone center.

---

## filterAccessibleWaypoints(waypoints): T[]

Filter a list of waypoints to only those that satisfy all hard constraints.

```ts
const safePoints = zones.filterAccessibleWaypoints(patrolRoute.waypoints);
if (safePoints.length === 0) {
  // NPC has no valid waypoints — consider resetting zones
}
```

Generic — preserves the input element type `T extends Vec2`.
Complexity: **O(waypoints × zones)**.

---

## Common patterns

### Surge-driven temporary zones

```ts
// On surge start:
zones.addZone({ id: 'psi_field_1', type: RestrictionType.DANGER, ..., metadata: 'surge' });
zones.addZone({ id: 'collapse_1',  type: RestrictionType.OUT,    ..., metadata: 'surge' });

// On surge end:
zones.removeByMetadata('surge');
```

### Quest-locked area

```ts
// Lock NPC to quest area:
zones.addZone({ id: `quest_${questId}_area`, type: RestrictionType.IN, x: cx, y: cy, radius: 300, active: true });

// Unlock when quest completes:
zones.removeZone(`quest_${questId}_area`);
```

### Anomaly zone exclusion

```ts
for (const anomaly of anomalyManager.getAll()) {
  zones.addZone({
    id: `anomaly_${anomaly.id}`,
    type: RestrictionType.OUT,
    x: anomaly.x, y: anomaly.y,
    radius: anomaly.dangerRadius,
    active: true,
  });
}
```

### Per-frame movement check

```ts
function updateNPC(npc: MyNPC) {
  const target = pathFollower.getCurrentTarget();
  if (!target) return;

  if (!zones.accessible(target.x, target.y)) {
    // Current target is blocked — escape
    const dir = zones.getSafeDirection(npc.x, npc.y);
    if (dir) npc.moveInDirection(dir.x, dir.y, npc.speed);
    return;
  }

  if (zones.isDangerous(npc.x, npc.y)) {
    // NPC is in danger — consider transitioning to FLEE state
    npc.aiState = 'FLEE';
  }

  npc.moveToward(target.x, target.y, npc.speed);
}
```
