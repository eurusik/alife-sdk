# ports

Host-facing adapter contracts for the `@alife-sdk/ai` subsystem.

**Ports** are interfaces your host (game engine, Phaser scene, ECS) implements
to plug its data into the SDK. Think of them as sockets on the SDK side — the
SDK defines the shape, you provide the implementation.

```ts
import { AIPorts } from '@alife-sdk/ai/ports';
import type { ICoverPointSource, ICoverPointData } from '@alife-sdk/ai/ports';
import type { IPerceptionProvider } from '@alife-sdk/ai/ports';
```

---

## Both ports are optional

`AIPlugin` works without any ports. Ports add capabilities:

| Token | Interface | Who reads it | Without it |
|-------|-----------|--------------|------------|
| `AIPorts.CoverPointSource` | `ICoverPointSource` | `AIPlugin.init()` | Register cover points manually via `coverRegistry.addPoint()` |
| `AIPorts.PerceptionProvider` | `IPerceptionProvider` | Your custom code via `kernel.portRegistry.tryGet()` | Entity queries unavailable to any code that reads this port |

---

## How to register ports

Provide implementations **before** `kernel.init()`:

```ts
import { AIPorts } from '@alife-sdk/ai/ports';

// Register before kernel.init()
kernel.portRegistry.provide(AIPorts.CoverPointSource, myCoverSource);
kernel.portRegistry.provide(AIPorts.PerceptionProvider, myPerceptionProvider);

kernel.use(aiPlugin);
kernel.init();   // AIPlugin reads CoverPointSource here
```

> **Duplicate registration throws.** Each port token must be provided exactly
> once per kernel instance. Calling `provide()` twice with the same token
> throws immediately to surface wiring mistakes early.

---

## AIPorts

```ts
import { AIPorts } from '@alife-sdk/ai/ports';

AIPorts.CoverPointSource   // PortToken<ICoverPointSource>, id: 'coverPointSource'
AIPorts.PerceptionProvider // PortToken<IPerceptionProvider>, id: 'perceptionProvider'
```

Each entry is a `PortToken<T>` — an opaque object with `id` and `description`
fields. Pass it directly to `kernel.portRegistry.provide()` / `kernel.portRegistry.tryGet()`.
TypeScript infers the correct implementation type from the token's generic.

---

## ICoverPointSource

Provides cover point positions from host level data. `AIPlugin.init()` calls
`getPoints()` once with infinite bounds to load all cover points at startup.

```ts
interface ICoverPointSource {
  getPoints(bounds: {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
  }): readonly ICoverPointData[];
}

interface ICoverPointData {
  readonly x: number;
  readonly y: number;
  readonly radius?: number;  // defaults to CoverRegistry config value if omitted
}
```

### When to use

Use this when you have cover point positions in level data (tilemap metadata,
level editor, procedural generation). The SDK converts `ICoverPointData` to
full `ICoverPoint` objects internally.

If you don't provide this port, register points manually:

```ts
aiPlugin.coverRegistry.addPoint(100, 200);
aiPlugin.coverRegistry.addPoint(300, 400, 50);  // with custom radius
```

### Implementation examples

**Static array:**

```ts
kernel.portRegistry.provide(AIPorts.CoverPointSource, {
  getPoints(_bounds) {
    return [
      { x: 100, y: 200 },
      { x: 300, y: 400, radius: 40 },
    ];
  },
});
```

**From Phaser tilemap object layer:**

```ts
kernel.portRegistry.provide(AIPorts.CoverPointSource, {
  getPoints(_bounds) {
    return tilemap
      .getObjectLayer('CoverPoints')!
      .objects.map((obj) => ({
        x: obj.x!,
        y: obj.y!,
        radius: obj.properties?.find((p: any) => p.name === 'radius')?.value,
      }));
  },
});
```

**Bounds-filtered (for large levels):**

```ts
kernel.portRegistry.provide(AIPorts.CoverPointSource, {
  getPoints(bounds) {
    return levelData.coverPoints.filter(
      (p) => p.x >= bounds.minX && p.x <= bounds.maxX &&
             p.y >= bounds.minY && p.y <= bounds.maxY,
    );
  },
});
```

> **`bounds` passed by `AIPlugin.init()` are always `±Infinity`.**
> The bounds parameter exists for future streaming/chunked levels where you
> might load only a region. For now, filtering by bounds is optional.

---

## IPerceptionProvider

Provides spatial entity queries for AI state handlers. Used by states that
need to find nearby NPCs (e.g. GOAP world-state building, CombatState target
selection).

```ts
interface IPerceptionProvider {
  /**
   * Get all perceivable entities within a radius.
   * Used for both vision and hearing queries.
   */
  getEntitiesInRadius(center: Vec2, radius: number): readonly IPerceivedEntity[];

  /**
   * Check if there is a clear line of sight between two points.
   * Optional — if not provided, LOS is assumed clear for all checks.
   */
  isLineOfSightClear?(from: Vec2, to: Vec2): boolean;
}
```

`IPerceivedEntity` (from `@alife-sdk/ai/types`):

```ts
interface IPerceivedEntity {
  readonly entityId: string;
  readonly position: Vec2;
  readonly factionId: string;
  readonly isAlive: boolean;
}
```

### When to use

Provide this when your custom AI code (or a Phaser bridge layer) needs a
central place to query nearby entities. The port is a shared service slot —
any code with access to the kernel can retrieve it via
`kernel.portRegistry.tryGet(AIPorts.PerceptionProvider)`.

> **No SDK code automatically consumes this port.** The `AIPlugin` and built-in
> state handlers do not read `PerceptionProvider` internally. Register it to
> make the implementation available to your own host code or a Phaser bridge
> layer that calls `kernel.portRegistry.tryGet()` to fetch it.

### Implementation examples

**Backed by `SpatialGrid` (recommended):**

```ts
import { SpatialGrid } from '@alife-sdk/core';

const grid = new SpatialGrid<IPerceivedEntity>(200, (e) => e.position);

// Keep grid in sync each frame:
for (const npc of onlineNPCs) {
  grid.update({
    entityId: npc.id,
    position: { x: npc.x, y: npc.y },
    factionId: npc.faction,
    isAlive: npc.hp > 0,
  });
}

kernel.portRegistry.provide(AIPorts.PerceptionProvider, {
  getEntitiesInRadius(center, radius) {
    // queryRadius() returns a reused scratch array — copy before returning!
    return [...grid.queryRadius(center, radius)];
  },
});
```

**With line-of-sight (Phaser arcade physics):**

```ts
kernel.portRegistry.provide(AIPorts.PerceptionProvider, {
  getEntitiesInRadius(center, radius) {
    return scene.physics
      .overlapCirc(center.x, center.y, radius)
      .map((body) => ({
        entityId: body.gameObject.getData('npcId') as string,
        position: { x: body.x, y: body.y },
        factionId: body.gameObject.getData('factionId') as string,
        isAlive: body.gameObject.active,
      }));
  },
  isLineOfSightClear(from, to) {
    // Return true if there are no blocking tiles between from and to.
    return !scene.physics.world.raycast(from, to).hasHit;
  },
});
```

---

## Checking port availability at runtime

If you write custom AI logic that depends on a port:

```ts
import { AIPorts } from '@alife-sdk/ai/ports';

// Safe — returns undefined if not provided:
const provider = kernel.portRegistry.tryGet(AIPorts.PerceptionProvider);
if (provider) {
  const nearby = provider.getEntitiesInRadius(npcPos, 300);
}

// Throws if not provided — use only when the port is truly required:
const source = kernel.portRegistry.require(AIPorts.CoverPointSource);
```
