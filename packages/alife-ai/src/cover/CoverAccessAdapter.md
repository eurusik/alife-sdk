# CoverAccessAdapter

SDK-provided bridge between `CoverRegistry` and `INPCContext.cover`.

State handlers access cover through the thin `ICoverAccess` seam on `INPCContext`.
`CoverAccessAdapter` implements that seam and translates flat `(x, y)` calls
into the typed `CoverRegistry` + `CoverLockRegistry` API.

```ts
import { CoverAccessAdapter } from '@alife-sdk/ai/cover';
```

---

## Why it exists

State handlers only know `ctx.cover.findCover(x, y, enemyX, enemyY, type?)`.
They don't know about `CoverRegistry`, point IDs, or lock registries.
`CoverAccessAdapter` hides that complexity:

```
State handler               CoverAccessAdapter         CoverRegistry
──────────────────────────────────────────────────────────────────────
ctx.cover.findCover(...)  → registry.findCover(type, pos, enemies, npcId)
ctx.cover.lockLastFound() → locks.tryLock(_lastFoundId, npcId)
ctx.cover.unlockAll()     → locks.unlockAll(npcId)
```

---

## Constructor

```ts
new CoverAccessAdapter(
  registry: CoverRegistry,
  lockRegistry: ICoverLockRegistry | null,
  npcId: string,
)
```

| Parameter | Description |
|-----------|-------------|
| `registry` | Scene-level cover registry (shared). |
| `lockRegistry` | TTL lock registry, or `null` to disable locking. |
| `npcId` | The NPC this adapter serves. Used as requester ID in `findCover` and lock calls. |

**Create one adapter per NPC.** The adapter is stateful — it stores the ID of
the last successfully found cover point for `lockLastFound()`. Do NOT share it
across multiple NPCs.

```ts
// Phaser bridge (PhaserNPCContext):
const coverAccess = new CoverAccessAdapter(coverRegistry, lockRegistry, npcId);
npc.ctx.cover = coverAccess;
```

---

## Methods

### `findCover(x, y, enemyX, enemyY, type?): { x, y } | null`

Find a cover point from the NPC's position against a single threat.

```ts
const result = ctx.cover.findCover(npc.x, npc.y, enemy.x, enemy.y);
// or with explicit type:
const result = ctx.cover.findCover(npc.x, npc.y, enemy.x, enemy.y, 'close');
```

- `type` is optional — defaults to `'balanced'` when omitted.
- Internally calls `registry.findCover(type, {x,y}, [{x:enemyX, y:enemyY}], npcId)`.
- Stores the found point's ID internally for `lockLastFound()`.
- Returns `{ x, y }` if a point was found, `null` otherwise.

> **Multi-enemy limitation:** this method passes a single enemy position.
> For multi-enemy scenarios use `CoverRegistry.findCover` / `findRecommendedCover`
> directly (they accept `readonly Vec2[]`).

### `lockLastFound(npcId, ttlMs?): boolean`

Acquire a TTL lock on the most recently returned cover point.

Call this immediately after a successful `findCover` to reserve the point
before the NPC starts moving.

```ts
const result = ctx.cover.findCover(npc.x, npc.y, enemy.x, enemy.y);
if (result) {
  const reserved = ctx.cover.lockLastFound(npcId);
  if (reserved) {
    npc.moveTo(result.x, result.y);
  } else {
    // Lost the race — find another point
  }
}
```

Returns `true` (vacuous success) when:
- `findCover` was not called yet, or returned `null`.
- No `lockRegistry` was provided at construction time.

Returns `false` when the point is already locked at capacity by other NPCs.

### `unlockAll(npcId): void`

Release all TTL locks held by the NPC. Call on NPC death or despawn.

```ts
// In your NPC death handler:
npc.ctx.cover.unlockAll(npcId);
```

No-op if no lock registry was provided.

---

## Without a lock registry

Passing `null` as `lockRegistry` disables locking entirely:

```ts
// Simple setup — no reservation, NPCs can compete for the same cover
const coverAccess = new CoverAccessAdapter(coverRegistry, null, npcId);
```

`lockLastFound` will always return `true`. Useful for prototyping or
for NPCs that don't need exclusive cover (e.g. simple monsters that
don't use cover at all, or when `CoverRegistry` is constructed without
a lock registry).

---

## ICoverAccess interface

The interface `CoverAccessAdapter` implements (from `INPCContext`):

```ts
interface ICoverAccess {
  findCover(
    x: number, y: number,
    enemyX: number, enemyY: number,
    type?: string,
  ): { x: number; y: number } | null;

  // Optional — state handlers call via optional chaining: ctx.cover?.lockLastFound?.(npcId)
  lockLastFound?(npcId: string, ttlMs?: number): boolean;
  unlockAll?(npcId: string): void;
}
```

`lockLastFound` and `unlockAll` are **optional** on the interface.
State handlers call them with optional chaining (`?.`) — if your custom
implementation omits them, those calls silently no-op.

You can provide your own implementation of `ICoverAccess` in `INPCContext.cover`
if the adapter doesn't fit your use case (e.g. a stub for unit tests).
