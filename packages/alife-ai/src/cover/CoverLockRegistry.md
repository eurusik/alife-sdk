# CoverLockRegistry

TTL-based reservation system for cover points.

Prevents two NPCs from moving to the same cover point simultaneously.
Locks expire automatically, so you don't need to clean up on NPC death —
but calling `unlockAll(npcId)` immediately frees the spot for others.

```ts
import { CoverLockRegistry, createDefaultCoverLockConfig } from '@alife-sdk/ai/cover';
```

---

## Constructor

```ts
new CoverLockRegistry(
  timeFn: () => number,
  config?: Partial<ICoverLockConfig>,
)
```

| Parameter | Description |
|-----------|-------------|
| `timeFn` | Monotonically non-decreasing time source returning milliseconds. Use `() => Date.now()` or your game clock. |
| `config` | Optional partial config — see `ICoverLockConfig` below. |

```ts
// Simplest setup:
const locks = new CoverLockRegistry(() => Date.now());

// With custom TTL:
const locks = new CoverLockRegistry(() => Date.now(), { defaultTtlMs: 5_000 });
```

Pass the same `locks` instance to `CoverRegistry` and `CoverAccessAdapter` so
they share the same reservation state.

---

## ICoverLockConfig

| Field | Default | Description |
|-------|---------|-------------|
| `defaultTtlMs` | `10_000` | How long a lock lives (ms) before auto-expiry. Refreshed on re-lock. |
| `defaultCapacity` | `1` | Max NPCs that can lock the same point simultaneously. Override per-call with `options.capacity`. |
| `autoPurgeInterval` | `32` | Run `purgeExpired()` every N `tryLock`/`isAvailable` calls. `0` = disabled. |

```ts
import { createDefaultCoverLockConfig } from '@alife-sdk/ai/cover';

const config = createDefaultCoverLockConfig({ defaultTtlMs: 8_000 });
// Throws RangeError if values are invalid (e.g. ttlMs ≤ 0, capacity < 1)
```

---

## Methods

### `tryLock(pointId, npcId, options?): boolean`

Attempt to lock a cover point for an NPC.

```ts
const ok = locks.tryLock('cover_0012', npcId);
if (!ok) {
  // Point is already taken — find another
}

// Custom TTL for this call:
locks.tryLock('cover_0012', npcId, { ttlMs: 15_000 });

// Multi-occupancy point (e.g. large bunker):
locks.tryLock('bunker_01', npcId, { capacity: 3 });
```

**Behavior:**
- If the NPC already holds a lock on this point, the TTL is **refreshed** (idempotent).
- If the point is at capacity with other NPCs, returns `false`.
- Expired locks are pruned inline before checking capacity.

### `unlock(pointId, npcId): void`

Release a specific NPC's lock on a point. No-op if the NPC doesn't hold a lock.

### `unlockAll(npcId): void`

Release **all** locks held by an NPC. Call on NPC death or despawn for immediate
availability of their cover point to others.

O(n) where n = total active locks across all points.

```ts
// In your NPC death handler:
locks.unlockAll(npcId);
```

### `isAvailable(pointId, npcId): boolean`

Check whether an NPC can lock the given point.

Returns `true` when:
- The point has never been locked (no entry for this ID), or
- The NPC already holds a lock on this point (own lock), or
- The point has fewer active locks than its tracked capacity.

```ts
if (locks.isAvailable('cover_0012', npcId)) {
  locks.tryLock('cover_0012', npcId);
}
```

`CoverRegistry.findCover` calls this internally to filter candidates —
you usually don't need to call it directly.

### `purgeExpired(): number`

Remove all expired lock entries. Returns the count of removed entries.

Called automatically at `autoPurgeInterval` cadence. Explicit calls are useful
at natural pause points (scene load, after a surge).

### `clear(): void`

Remove all lock entries. Call on scene teardown.
`CoverRegistry.clear()` calls this automatically if a lock registry was provided.

### `lockedPointCount: number` (readonly)

Approximate count of points with at least one lock entry.
May include points whose locks have all expired but haven't been purged yet.
Call `purgeExpired()` first for an exact count.

---

## Typical integration

```ts
// ── Scene setup ────────────────────────────────────────────────────────────
const locks = new CoverLockRegistry(() => gameTime.nowMs());
const registry = new CoverRegistry(config.cover, myRandom, locks);

// ── TakeCoverState.enter() ─────────────────────────────────────────────────
const cover = registry.findCover(CoverType.BALANCED, npcPos, enemies, npcId);
if (cover) {
  const reserved = locks.tryLock(cover.id, npcId); // or ctx.cover.lockLastFound()
  if (reserved) {
    npc.moveTo(cover.x, cover.y);
  }
}

// ── NPC death / despawn ────────────────────────────────────────────────────
locks.unlockAll(npcId);
// or equivalently: npc.ctx.cover.unlockAll(npcId)

// ── Scene teardown ──────────────────────────────────────────────────────────
registry.clear(); // calls locks.clear() internally
```

---

## Memory profile

At scale: 200 NPCs × 1 lock each ≈ 200 Map entries, ~20 KB.
Locks are stored as `Map<pointId, { capacity, locks: CoverLock[] }>`.
Array sizes are typically 1–3 per point (number of concurrent occupants).

---

## ICoverLockRegistry interface

The registry exposes this public interface, which `CoverRegistry` and `CoverAccessAdapter` depend on:

```ts
interface ICoverLockRegistry {
  tryLock(pointId, npcId, options?): boolean;
  unlock(pointId, npcId): void;
  unlockAll(npcId): void;
  isAvailable(pointId, npcId): boolean;
  purgeExpired(): number;
  clear(): void;
  readonly lockedPointCount: number;
}
```

You can substitute your own implementation of `ICoverLockRegistry` if the
TTL-based approach doesn't fit your game's time model.
