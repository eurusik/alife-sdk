# suspicion

Per-NPC suspicion accumulator — tracks cumulative threat intensity from
indirect stimuli (sounds, glimpses, corpses) and drives IDLE/PATROL → ALERT
transitions.

```ts
import {
  SuspicionAccumulator,
  SuspicionStimuli,
  createDefaultSuspicionConfig,
} from '@alife-sdk/ai/suspicion';
import type {
  SuspicionStimulus,
  ISuspicionConfig,
} from '@alife-sdk/ai/suspicion';
```

---

## How it connects to AI states

State handlers use `ctx.suspicion` — an `ISuspicionAccess` object that the
**host adapter** implements. `SuspicionAccumulator` structurally satisfies
`ISuspicionAccess` so you can assign it directly.

```
Host code (game events)
      │
      ▼  suspicion.add(SuspicionStimuli.SOUND, 0.4, x, y)   — host writes
      │  suspicion.update(deltaMs / 1000)                    — host, each frame
      │
      ▼  INPCContext.suspicion = suspicion  — state handlers:
            ctx.suspicion?.add(BODY_FOUND, ...)              — PatrolState/IdleState (corpses)
            ctx.suspicion?.hasReachedAlert(threshold)        — check → ALERT transition
            ctx.suspicion?.getLastKnownPosition()            — navigate toward threat
            ctx.suspicion?.clear()                           — after ALERT fires
```

> `update()` is **not** on `ISuspicionAccess`. Call it on the accumulator instance
> directly each frame — state handlers never call it.

States that check suspicion: **IdleState**, **PatrolState**, **InvestigateState**.
Threshold comes from `IStateConfig.suspicionAlertThreshold` (default `0.7`).

Setting `ctx.suspicion = null` disables the system entirely — all checks
silently no-op via optional chaining.

---

## SuspicionStimuli

Five named stimulus constants:

```ts
SuspicionStimuli.SOUND         // 'sound'         — gunshot, explosion heard
SuspicionStimuli.PARTIAL_SIGHT // 'partial_sight' — enemy glimpsed briefly
SuspicionStimuli.FOOTSTEP      // 'footstep'       — footstep sounds
SuspicionStimuli.EXPLOSION     // 'explosion'      — explosion in vicinity
SuspicionStimuli.BODY_FOUND    // 'body_found'     — dead ally discovered
```

`SuspicionStimulus` is an open string union — you can pass any string for
game-specific stimuli without touching the SDK:

```ts
accumulator.add('psi_interference', 0.3);
accumulator.add(SuspicionStimuli.SOUND, 0.4, gunX, gunY);
```

The stimulus label is semantic only — the accumulator stores a single
aggregate level, not per-stimulus counters.

---

## SuspicionAccumulator

Per-NPC accumulator. One instance per NPC.

```ts
new SuspicionAccumulator(config?: Partial<ISuspicionConfig>)
```

### add(stimulus, amount, x?, y?): void

Adds suspicion. Primarily called by the **host** (game events), but state
handlers also call it for corpse detection — `PatrolState` and `IdleState`
call `add(BODY_FOUND, cfg.corpseFoundSuspicion, x, y)` for every corpse
returned by `ctx.getVisibleCorpses?.()`.

- Negative values and `NaN` are silently ignored.
- Level is clamped to `[0, maxLevel]`.
- If both `x` and `y` are provided, they become the new `lastKnownPosition`.
  If either is omitted, the position is **not** updated.

```ts
// Gunshot event:
suspicion.add(SuspicionStimuli.SOUND, 0.4, shot.x, shot.y);

// Partial sight — no position (enemy glimpsed, can't pinpoint):
suspicion.add(SuspicionStimuli.PARTIAL_SIGHT, 0.2);

// Body found — has a position:
suspicion.add(SuspicionStimuli.BODY_FOUND, 0.5, corpse.x, corpse.y);
```

### update(deltaSec): void

Applies time-based decay. **Call once per frame**, before the state machine tick.

```ts
// In your game loop / scene update:
suspicion.update(deltaMs / 1000);
```

- Decays by `decayRate × deltaSec` each call.
- Clamps at `0` — never goes negative.
- Ignores zero, negative, and `NaN` values (level unchanged, no corruption).

With the default `decayRate: 0.08`, a fully saturated accumulator (`level = 1.0`)
takes ~12.5 s to reach zero with no new stimuli.

### hasReachedAlert(threshold?): boolean

Returns `true` if `level > threshold` (strict greater-than).

```ts
// State handlers call this using IStateConfig.suspicionAlertThreshold (default 0.7):
if (ctx.suspicion?.hasReachedAlert(0.7)) {
  // transition to ALERT
}
```

> **Warning:** Calling with no argument uses `maxLevel` as the default threshold.
> Since `level` is clamped to `maxLevel`, `level > maxLevel` is always `false`.
> **Always pass an explicit threshold.** Use `IStateConfig.suspicionAlertThreshold`.

### getLevel(): number

Returns the current suspicion level in `[0, maxLevel]`. Use for debug display
or custom threshold logic.

### getLastKnownPosition(): { x: number; y: number } | null

Returns the position from the last `add()` call that included coordinates,
or `null` if no position has been provided. States use this to navigate toward
the threat source when transitioning to ALERT or INVESTIGATE.

### clearPosition(): void

Clears the stored position without touching the suspicion level.
Use when the position becomes stale but you want to keep the accumulated level.

### clear(): void

Resets both `level` and `lastKnownPosition` to zero/null.
State handlers call this after triggering an ALERT transition so the NPC starts
fresh in the new state rather than re-triggering immediately on re-entry
to PATROL/IDLE.

---

## ISuspicionConfig

```ts
interface ISuspicionConfig {
  readonly decayRate: number;   // default: 0.08 (level/second)
  readonly maxLevel?: number;   // default: 1.0
}
```

`maxLevel` is optional in the config object — the accumulator defaults to `1.0`
internally when omitted.

Override via the factory:

```ts
const cfg = createDefaultSuspicionConfig({ decayRate: 0.03 }); // slower decay
const cfg = createDefaultSuspicionConfig({ decayRate: 0.05, maxLevel: 2.0 });
```

---

## ISuspicionAccess (what states read)

`ISuspicionAccess` is defined in `@alife-sdk/ai/states`. It exposes all
`SuspicionAccumulator` methods **except `update()`** — that must be called
on the accumulator instance directly, not through the context.

`SuspicionAccumulator` structurally satisfies `ISuspicionAccess`, so you can
assign it directly without any wrapper:

```ts
import type { ISuspicionAccess } from '@alife-sdk/ai/states';
import type { INPCContext } from '@alife-sdk/ai/states';

const suspicion = new SuspicionAccumulator({ decayRate: 0.05 });

const ctx: INPCContext = {
  // ...
  suspicion,  // satisfies ISuspicionAccess — direct assignment, no wrapper
};

// update() is NOT on ISuspicionAccess — call on the instance directly:
suspicion.update(deltaMs / 1000);
```

---

## Full integration example

```ts
import {
  SuspicionAccumulator,
  SuspicionStimuli,
} from '@alife-sdk/ai/suspicion';

// --- One accumulator per NPC (created when the NPC spawns) ---

const suspicion = new SuspicionAccumulator({ decayRate: 0.05 });

// Assign to context so state handlers can read it:
npcContext.suspicion = suspicion;

// --- Per-frame update (game loop) ---

scene.update(time, delta) {
  suspicion.update(delta / 1000);  // decay — call before FSM tick
  npcFSM.update(context, delta);
}

// --- Game event handlers (host drives all writes) ---

onGunshot(x: number, y: number) {
  suspicion.add(SuspicionStimuli.SOUND, 0.4, x, y);
}

onEnemyGlimpsed() {
  // No position — enemy was visible only briefly
  suspicion.add(SuspicionStimuli.PARTIAL_SIGHT, 0.2);
}

onCorpseFound(corpse: { x: number; y: number }) {
  // PatrolState / IdleState also calls this internally when getVisibleCorpses()
  // returns new entries. Deduplicate by corpse ID to prevent re-triggering.
  suspicion.add(SuspicionStimuli.BODY_FOUND, 0.5, corpse.x, corpse.y);
}

// suspicion.clear() is called by the state handler after ALERT fires — no host action needed here.
```

---

## Corpse detection — deduplication is your responsibility

When `ctx.getVisibleCorpses?.()` returns entries, **PatrolState** and **IdleState**
call `suspicion.add(BODY_FOUND, ...)` for every corpse returned, every frame.

If the same corpse stays visible across multiple PATROL re-entries, the NPC will
keep triggering ALERT. **Prevent this** by filtering out corpses the NPC has
already reacted to:

```ts
const reactedCorpses = new Set<string>();

getVisibleCorpses() {
  return visibleCorpses.filter(c => !reactedCorpses.has(c.id));
}

// Mark as reacted when suspicion triggers ALERT:
onNPCAlerted(npcId: string) {
  const pos = suspicion.getLastKnownPosition();
  suspicion.clear();                      // state handler calls this too
  reactedCorpses.add(lastSeenCorpseId);   // prevent re-trigger
}
```
