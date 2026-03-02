# MemorySystem

Per-NPC episodic memory bank with multi-channel storage, confidence decay,
and automatic eviction.

```ts
import { MemoryBank, MemoryChannel } from '@alife-sdk/core/ai';
import type { MemoryRecord, IMemoryBankConfig, IMemoryInput } from '@alife-sdk/core/ai';
```

---

## Concepts

### Channels

Memories are tagged by channel. The SDK ships four built-in channels:

| Channel | Typical source | Default decay |
|---------|---------------|---------------|
| `MemoryChannel.VISUAL` | Line-of-sight observations | 0.1 / sec |
| `MemoryChannel.SOUND` | Gunshots, footsteps, voices | 0.1 / sec |
| `MemoryChannel.HIT` | Received damage events | 0.1 / sec |
| `MemoryChannel.DANGER` | Grenade landings, explosions | 0.1 / sec |

The type is open: `(string & {})` means you can add your own channels without
casting:

```ts
memory.remember({ sourceId: 'door_3', channel: 'patrol_marker', position: { x: 0, y: 0 } });
```

### Confidence

Every record has a `confidence` value in `[0, 1]`:

- **1.0** — freshly observed (default when not specified)
- Decays by `decayRate` per second (or the channel-specific rate)
- Records below `minConfidence` are automatically pruned in `update()`

When the same `sourceId` is observed again, confidence resets to the new value
and position/timestamp are updated. The record is never duplicated.

### Eviction

When the bank reaches `maxRecords`, the record with the lowest confidence is
removed to make room for the new one.

---

## `IMemoryBankConfig`

```ts
interface IMemoryBankConfig {
  timeFn: () => number;              // required — seconds provider
  maxRecords?: number;               // default 32
  decayRate?: number;                // default 0.1 confidence/sec
  minConfidence?: number;            // default 0.05 — pruning threshold
  channelDecayRates?: Record<string, number>; // per-channel overrides
}
```

Pass a time function that returns **seconds** (not ms). Use game time, not wall
clock, so the simulation remains reproducible at any speed:

```ts
const memory = new MemoryBank({
  timeFn: () => gameTime.nowSeconds,
});
```

Override per-channel decay to make sounds fade faster than sightings:

```ts
const memory = new MemoryBank({
  timeFn: () => gameTime.nowSeconds,
  channelDecayRates: {
    [MemoryChannel.SOUND]: 0.3,   // sounds forgotten in ~3 sec
    [MemoryChannel.VISUAL]: 0.05, // sightings last ~20 sec
  },
});
```

---

## `MemoryBank` API

### `remember(input)`

Add or update a memory.

```ts
memory.remember({
  sourceId: 'player',
  channel: MemoryChannel.VISUAL,
  position: { x: 340, y: 210 },
  confidence: 0.9,         // optional, default 1.0
});
```

| Behaviour | Rule |
|-----------|------|
| Existing record for `sourceId` | Position, confidence, and timestamp are updated in-place |
| Channel changed | Record migrates to the new channel index |
| Bank at capacity | Lowest-confidence record is evicted first |

### `recall(sourceId)`

Retrieve a specific record, or `undefined` if not in memory.

```ts
const mem = memory.recall('player');
if (mem && mem.confidence > 0.5) {
  npc.investigateLastKnownPosition(mem.position);
}
```

### `getByChannel(channel)`

All records on a specific channel, in arbitrary order.

```ts
const threats = memory.getByChannel(MemoryChannel.VISUAL);
const loudest = memory.getByChannel(MemoryChannel.SOUND);
```

### `getMostConfident()`

The record with the highest confidence across all channels. Returns `undefined`
if the bank is empty.

```ts
const best = memory.getMostConfident();
if (best) npc.focusOn(best.sourceId);
```

### `update(deltaSec)`

Decay all records and prune those below `minConfidence`. Call once per frame.

```ts
// In your NPC update loop:
memory.update(delta); // delta in seconds
```

### `forget(sourceId)`

Immediately remove a record.

```ts
memory.forget('ally_02'); // NPC no longer "knows" about this entity
```

### `clear()`

Wipe all memories at once (e.g. after a surge knock-out).

### `size`

```ts
get size(): number
```

Current number of records in the bank.

---

## `MemoryRecord` shape

```ts
interface MemoryRecord {
  readonly sourceId: string;
  readonly channel: MemoryChannel;
  readonly position: Vec2;
  readonly confidence: number;   // [0, 1]
  readonly timestamp: number;    // seconds from timeFn at time of last update
}
```

Records returned by `recall()` and `getByChannel()` are live references —
do not mutate them. If you need to store one for later, copy it:

```ts
const snapshot = { ...memory.recall('player') };
```

---

## Serialisation

```ts
// Save
const saved = memory.serialize(); // MemoryRecord[]

// Restore
memory.restore(saved);
```

`restore()` replaces all current records with the provided snapshot. Confidence
values are stored as-is — no decay is applied during restore.

---

## Full example — perception integration

```ts
import { MemoryBank, MemoryChannel } from '@alife-sdk/core/ai';

class GuardNPC {
  private memory = new MemoryBank({
    timeFn: () => this.scene.gameTime,
    maxRecords: 24,
    channelDecayRates: {
      [MemoryChannel.SOUND]: 0.25,
      [MemoryChannel.HIT]:   0.5,
    },
  });

  onSeenEntity(id: string, x: number, y: number) {
    this.memory.remember({ sourceId: id, channel: MemoryChannel.VISUAL, position: { x, y } });
  }

  onHeardGunshot(x: number, y: number) {
    this.memory.remember({
      sourceId: `shot_${x}_${y}`,
      channel: MemoryChannel.SOUND,
      position: { x, y },
      confidence: 0.7,
    });
  }

  onHitByBullet(attackerId: string, fromX: number, fromY: number) {
    this.memory.remember({
      sourceId: attackerId,
      channel: MemoryChannel.HIT,
      position: { x: fromX, y: fromY },
      confidence: 1.0,
    });
  }

  update(delta: number) {
    this.memory.update(delta);

    // Best threat to focus on
    const visual = this.memory.getByChannel(MemoryChannel.VISUAL);
    const target = visual.sort((a, b) => b.confidence - a.confidence)[0];
    if (target && target.confidence > 0.3) {
      this.moveTo(target.position);
    }
  }
}
```

---

## Performance notes

- Storage is a `Map<sourceId, record>` for O(1) read/write per source.
- A secondary `Map<channel, Set<record>>` index enables O(k) `getByChannel()` without scanning all records, where k is the number of records on that channel.
- `update()` reuses a scratch array (`_toDelete`) across calls — no per-frame allocations.
- Eviction scans all records once (O(n)) only when the bank is full.
