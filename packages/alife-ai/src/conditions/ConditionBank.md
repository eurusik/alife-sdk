# ConditionBank

Per-NPC condition state store — intensities for bleeding, radiation, hunger, and any custom effect.

**Source:** [ConditionBank.ts](ConditionBank.ts)

---

## Overview

`ConditionBank` stores up to N condition channels for one NPC. Each channel holds a float
in `[0, maxLevel]` (default `[0, 1]`). The host applies damage, calls `update()` each frame
to decay, and exposes the bank as `IConditionAccess` on `INPCContext`.

**Responsibility split:**

| Who | Operations |
|-----|-----------|
| Host layer | `apply()`, `recover()`, `update()`, `clear()` |
| State handlers | `getLevel()`, `hasCondition()` |

---

## Configuration

```ts
import { ConditionBank, createDefaultConditionBankConfig } from '@alife-sdk/ai/conditions';

// Defaults: defaultDecayRate=0.01, maxLevel=1.0
const bank = new ConditionBank();

// With per-channel decay overrides:
const bank = new ConditionBank({
  defaultDecayRate: 0.01,
  channelDecayRates: {
    radiation: 0.002,  // ~500s to clear (slow)
    bleeding:  0.05,   // ~20s to clear  (fast)
  },
  maxLevel: 1.0,
});
```

### `createDefaultConditionBankConfig(overrides?)`

Returns a config object with production defaults. Useful when you want to
inspect or share the config object separately:

```ts
const cfg = createDefaultConditionBankConfig({ defaultDecayRate: 0.05 });
// cfg.defaultDecayRate === 0.05
// cfg.channelDecayRates === undefined (not set)
// cfg.maxLevel === undefined — the ConditionBank constructor resolves this to 1.0
```

> **Note:** `createDefaultConditionBankConfig` does not fill `maxLevel` — it stays `undefined`
> in the returned object. The `ConditionBank` constructor applies the `1.0` default.
> If you inspect the config before passing it to the constructor, `maxLevel` will appear absent.

### `IConditionBankConfig` fields

| Field | Default | Description |
|-------|:-------:|-------------|
| `defaultDecayRate` | `0.01` | Recovery speed (level/second) for channels without a per-channel override. To clear a fully saturated channel in **T seconds**, set `rate = 1 / T` (e.g. `1/60 ≈ 0.017` for 60s). |
| `channelDecayRates` | `undefined` | Per-channel overrides. Only the channels listed here use their own rate; others fall back to `defaultDecayRate`. |
| `maxLevel` | `1.0` | Upper clamp for `apply()`. Use `100` if your game's condition scale is 0–100. |

---

## `ConditionChannels`

Named string constants for the five built-in channels. Using these avoids magic strings.

```ts
import { ConditionChannels } from '@alife-sdk/ai/conditions';

ConditionChannels.BLEEDING     // 'bleeding'
ConditionChannels.RADIATION    // 'radiation'
ConditionChannels.HUNGER       // 'hunger'
ConditionChannels.STAMINA      // 'stamina'
ConditionChannels.INTOXICATION // 'intoxication'
```

The `ConditionChannel` type is open (`string & {}`), so custom channels work without any registration:

```ts
bank.apply('psi_overload', 0.3);   // custom channel — works out of the box
bank.getLevel('psi_overload');     // → 0.3
```

---

## API reference — write (host only)

### `apply(channel, amount): void`

Increases a channel's intensity. Accumulates on repeated calls, clamped to `maxLevel`.
Negative or NaN values are silently ignored.

```ts
bank.apply(ConditionChannels.RADIATION, 0.1); // +0.1
bank.apply(ConditionChannels.RADIATION, 0.1); // +0.1 again → 0.2
bank.apply(ConditionChannels.RADIATION, 999); // clamped → 1.0
```

### `recover(channel, amount): void`

Instantly decreases a channel's intensity (item-driven recovery). Clamped to `0`.
Removes the channel from the active set when it reaches zero.
Negative or NaN values are silently ignored.

```ts
bank.apply('radiation', 0.8);
bank.recover('radiation', 0.5);   // → 0.3
bank.recover('radiation', 999);   // clamped → 0, channel removed
```

### `update(deltaSec): void`

Time-based decay — call this once per frame with `deltaMs / 1000`. Each channel decays by
`rate × deltaSec`. Channels that reach zero are removed from the active set.
Zero, negative, and NaN values are silently ignored (no accidental level increase).

```ts
// In your game loop:
bank.update(deltaMs / 1000);
```

**Decay formula:** `level -= decayRate × deltaSec`

The effective rate per channel:
1. Per-channel override in `channelDecayRates`, if set.
2. `defaultDecayRate` otherwise.

```ts
const bank = new ConditionBank({
  defaultDecayRate: 0.1,
  channelDecayRates: { radiation: 0.01 },
});
bank.apply('radiation', 0.5);
bank.apply('bleeding',  0.5);
bank.update(1);
// radiation: 0.5 - 0.01×1 = 0.49
// bleeding:  0.5 - 0.10×1 = 0.40
```

### `clear(channel?): void`

Instantly resets a channel or all channels. Does not throw if the channel doesn't exist.

```ts
bank.clear('radiation');  // clear one channel
bank.clear();             // clear all channels (e.g. on NPC respawn)
```

---

## API reference — read (state handlers)

### `getLevel(channel): number`

Returns the current intensity in `[0, maxLevel]`. Returns `0` for unknown or cleared channels.

```ts
bank.getLevel(ConditionChannels.RADIATION); // → 0.0 – 1.0
```

### `hasCondition(channel, threshold?): boolean`

Returns `true` when `level > threshold`. Default threshold is `0` — any positive intensity qualifies.
Boundary values do **not** trigger (`0.5 > 0.5` → `false`).

```ts
bank.apply('bleeding', 0.6);

bank.hasCondition('bleeding');        // → true  (0.6 > 0)
bank.hasCondition('bleeding', 0.5);  // → true  (0.6 > 0.5)
bank.hasCondition('bleeding', 0.6);  // → false (0.6 > 0.6 is false)
bank.hasCondition('bleeding', 0.7);  // → false
```

### `getActiveChannels(): ReadonlyArray<{ channel, level }>`

Snapshot of all channels with level > 0. Returns a new array each call —
do not hold references across frames.

```ts
const active = bank.getActiveChannels();
// [{ channel: 'radiation', level: 0.4 }, { channel: 'bleeding', level: 0.2 }]

for (const { channel, level } of active) {
  console.log(`${channel}: ${level.toFixed(2)}`);
}
```

---

## `IConditionAccess` — state handler seam

State handlers access conditions through this interface on `INPCContext`,
not the full `ConditionBank` class. This keeps state handlers framework-agnostic.

```ts
export interface IConditionAccess {
  getLevel(channel: ConditionChannel): number;
  hasCondition(channel: ConditionChannel, threshold?: number): boolean;
  apply(channel: ConditionChannel, amount: number): void;
}
```

> **Why is `apply()` here?** The host also accesses conditions through `ctx.conditions`,
> so `apply()` is on the shared interface for convenience. State handlers must treat it
> as read-only **by convention** — the type system does not enforce this.
> For stricter separation, narrow the type in your state handler signatures:
> `Pick<IConditionAccess, 'getLevel' | 'hasCondition'>`.

**Methods only on `ConditionBank` — not on `IConditionAccess`:**
`update()`, `recover()`, `clear()`, `getActiveChannels()`.
Hold a direct `ConditionBank` reference in your host code for these.

`ConditionBank` satisfies `IConditionAccess` directly — assign it to `ctx.conditions`:

```ts
const bank = new ConditionBank();
const ctx: INPCContext = { ..., conditions: bank };

// State handler:
function shouldFleeDueToRadiation(ctx: INPCContext): boolean {
  return ctx.conditions?.hasCondition(ConditionChannels.RADIATION, 0.7) ?? false;
}
```

If you don't need conditions, set `ctx.conditions = null`:
all `ctx.conditions?.hasCondition(...)` calls safely return `undefined` (falsy).

---

## Full wiring example

```ts
import { ConditionBank, ConditionChannels } from '@alife-sdk/ai/conditions';

// On NPC spawn:
const bank = new ConditionBank({
  channelDecayRates: {
    [ConditionChannels.RADIATION]: 0.002,
    [ConditionChannels.BLEEDING]:  0.05,
  },
});

const ctx: INPCContext = {
  // ...
  conditions: bank,
};

// Game loop (per-frame):
function tick(deltaMs: number) {
  bank.update(deltaMs / 1000);
  stateMachine.tick(ctx);
}

// Game event handlers (host layer only):
onAnomalyDamage(type: string, amount: number) {
  bank.apply(type, amount);
}

onAntiRadUsed() {
  bank.recover(ConditionChannels.RADIATION, 0.5);
}

onNPCRespawned() {
  bank.clear();
}
```
