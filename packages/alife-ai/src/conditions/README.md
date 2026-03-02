# conditions

Per-NPC condition state for `@alife-sdk/ai` — bleeding, radiation, hunger, and any custom effects.

Conditions are **HP-independent intensities** that decay over time.
They are driven by the host layer (anomaly damage, item use, game events)
and consumed by state handlers via a thin `IConditionAccess` seam on `INPCContext`.

## Modules

| File | Purpose |
|------|---------|
| [ConditionBank.md](ConditionBank.md) | `ConditionBank` class, `ConditionChannels`, config, `IConditionAccess` |

---

## Quick integration

Three steps to wire conditions into your NPC:

```ts
import { ConditionBank, ConditionChannels } from '@alife-sdk/ai/conditions';

// Step 1 — allocate one bank per NPC on spawn
const bank = new ConditionBank({
  channelDecayRates: {
    [ConditionChannels.RADIATION]: 0.002,   // slow — ~500s to clear
    [ConditionChannels.BLEEDING]:  0.05,    // fast  — ~20s to clear
  },
});

// Step 2 — expose it on INPCContext (ConditionBank satisfies IConditionAccess)
const ctx: INPCContext = {
  // ...other fields...
  conditions: bank,
};

// Step 3 — call update every frame (before the state machine tick)
function onUpdate(deltaMs: number) {
  bank.update(deltaMs / 1000);
}
```

Then from your game event handlers:

```ts
// Host drives writes — state handlers only read
onRadiationDamage(npcId: string) {
  bankFor(npcId).apply(ConditionChannels.RADIATION, 0.02);
}

onAntiRadItem(npcId: string) {
  bankFor(npcId).recover(ConditionChannels.RADIATION, 0.5);
}
```

And from a state handler:

```ts
// State handlers read via ctx.conditions — never write
function evaluateRadiationFlee(ctx: INPCContext): boolean {
  return ctx.conditions?.hasCondition(ConditionChannels.RADIATION, 0.7) ?? false;
}
```

---

## Opt-in / opt-out

| `ctx.conditions` | Effect |
|---|---|
| `ConditionBank` instance | Full feature — all reads and writes work |
| `null` | Disabled — `ctx.conditions?.hasCondition(...)` silently returns `undefined` (falsy) |

Setting `ctx.conditions = null` is a clean way to exclude conditions from NPCs that don't need them (e.g. simple monsters).

---

## Data flow

```
Game events (anomaly damage, item use, etc.)
        │
        ▼  bank.apply(channel, amount)
  ConditionBank
  ┌──────────────────────────────────────┐
  │  Map<channel, level>                 │
  │                                      │
  │  update(deltaSec)  → time-based decay│
  │  recover(channel)  → instant drop    │
  └──────────────────────────────────────┘
        │
        ▼  ctx.conditions (IConditionAccess)
  State handlers
  ┌──────────────────────────────────────┐
  │  getLevel('radiation')  → 0.0–1.0    │
  │  hasCondition('bleeding', 0.5) → bool│
  └──────────────────────────────────────┘
```

---

## Design notes

- **No side effects** — `ConditionBank` has no external dependencies.
- **Open channels** — any string is a valid channel; `ConditionChannels` constants are convenience, not required.
- **Two decay modes** — `update()` for continuous time-based recovery, `recover()` for instant item-driven recovery.
- **Host/handler boundary** — `apply()` is for the host only; state handlers call `hasCondition()` / `getLevel()` exclusively.
