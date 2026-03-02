# MoraleStateMachine

3-state NPC morale tracker with configurable thresholds and automatic recovery.

```ts
import { MoraleTracker, MoraleState } from '@alife-sdk/core/combat';
import type { IMoraleConfig } from '@alife-sdk/core/combat';
```

---

## Concepts

### The three states

Morale is a float in `[-1, 1]` (starts at `0`). The current `MoraleState` is
derived automatically from the value and two thresholds:

```
  -1          -0.7          -0.3           0            1
  ├────────────┼─────────────┼─────────────┼────────────┤
  │  PANICKED  │   SHAKEN    │                STABLE    │
```

| State | Default range | Behaviour |
|-------|--------------|-----------|
| `STABLE` | `morale > -0.3` | Normal. Recovers toward 0 slowly (+0.005/s). |
| `SHAKEN` | `-0.7 < morale ≤ -0.3` | Rattled. Recovers toward 0 faster (+0.01/s). |
| `PANICKED` | `morale ≤ -0.7` | Broken. **No recovery** — must be reset externally. |

> **Positive morale** (0 to 1) is STABLE and also drifts back to 0.
> A freshly spawned NPC or one who just killed an enemy sits here.

### Recovery direction

Recovery always moves `morale` **toward 0**, never past it. Both negative
(demoralized) and positive (euphoric) values drift toward the neutral baseline.

---

## `IMoraleConfig`

All thresholds and rates are configurable:

```ts
interface IMoraleConfig {
  shakenThreshold:    number; // default -0.3
  panicThreshold:     number; // default -0.7
  stableRecoveryRate: number; // default 0.005 per second
  shakenRecoveryRate: number; // default 0.01  per second
}
```

Pass a partial config to override only the fields you care about:

```ts
// Cowardly NPC — panics easily, recovers quickly
const coward = new MoraleTracker({
  shakenThreshold: -0.1,
  panicThreshold:  -0.3,
  shakenRecoveryRate: 0.05,
});

// Hardened veteran — hard to shake, almost never panics
const veteran = new MoraleTracker({
  shakenThreshold: -0.5,
  panicThreshold:  -0.9,
});
```

---

## `MoraleTracker` API

### Constructor

```ts
new MoraleTracker(config?: Partial<IMoraleConfig>)
```

Starts at morale `0` (STABLE).

### `morale.state`

```ts
get state(): MoraleState // 'stable' | 'shaken' | 'panicked'
```

The derived state. Re-derived after every `adjust()` and `update()` call —
always consistent with `morale`.

### `morale.morale`

```ts
get morale(): number // [-1, 1]
```

Raw morale value.

### `morale.adjust(delta)`

Apply a morale change. Positive = boost, negative = hit. Result is clamped to
`[-1, 1]`.

```ts
morale.adjust(-0.15); // hit: took damage
morale.adjust(-0.25); // hit: ally died
morale.adjust(-0.40); // hit: squad leader died
morale.adjust(+0.20); // boost: killed an enemy
morale.adjust(-0.30); // hit: surge started
```

These are the values used in Chornobyl — adjust to suit your game's pacing.

### `morale.update(deltaSec)`

Tick recovery. Call once per frame with elapsed seconds.

```ts
morale.update(delta); // delta in seconds, e.g. 0.016 for 60fps
```

Recovery rules:
- `PANICKED` — no recovery (returns immediately)
- `SHAKEN` — moves toward 0 at `shakenRecoveryRate` per second
- `STABLE` — moves toward 0 at `stableRecoveryRate` per second
- Recovery never overshoots 0

### `morale.reset()`

Instantly set morale to `0` (STABLE). Use after a cutscene, respawn,
or triggered event that should fully restore the NPC.

```ts
morale.reset();
// morale.morale === 0, morale.state === 'stable'
```

---

## `MoraleState` values

```ts
MoraleState.STABLE   // 'stable'
MoraleState.SHAKEN   // 'shaken'
MoraleState.PANICKED // 'panicked'
```

---

## FSM integration

`MoraleTracker` does not drive transitions itself — you read `state` and act
on it. A typical pattern in an NPC update loop:

```ts
import { MoraleTracker, MoraleState } from '@alife-sdk/core/combat';

class GuardNPC {
  private morale = new MoraleTracker();

  onHit(damage: number) {
    this.morale.adjust(-0.15);
    this.checkMoraleTransition();
  }

  onAllyDied(wasLeader: boolean) {
    this.morale.adjust(wasLeader ? -0.40 : -0.25);
    this.checkMoraleTransition();
  }

  onEnemyKilled() {
    this.morale.adjust(+0.20);
    // No FSM change — staying in COMBAT is fine
  }

  update(delta: number) {
    this.morale.update(delta);
    this.checkMoraleTransition();
  }

  private checkMoraleTransition() {
    switch (this.morale.state) {
      case MoraleState.PANICKED:
        this.fsm.transition('FLEE');
        break;
      case MoraleState.SHAKEN:
        if (this.fsm.state === 'COMBAT') this.fsm.transition('RETREAT');
        break;
      // STABLE: stay in current state
    }
  }
}
```

---

## Squad cascade

When a squad leader dies, apply a morale hit to every squad member.
The SDK gives you `adjust()` — cascade logic is up to you:

```ts
function onLeaderDied(squad: GuardNPC[]) {
  for (const member of squad) {
    member.morale.adjust(-0.40); // leader died = large hit
  }
}

function onAllyDied(squad: GuardNPC[]) {
  for (const member of squad) {
    member.morale.adjust(-0.25 * 0.5); // regular ally × cascade factor
  }
}
```

---

## Full example — skirmish with morale

```ts
import { MoraleTracker, MoraleState } from '@alife-sdk/core/combat';

const npc = {
  hp: 100,
  morale: new MoraleTracker({ shakenThreshold: -0.25, panicThreshold: -0.6 }),
  fsmState: 'COMBAT' as string,
};

function tickNPC(delta: number) {
  npc.morale.update(delta);

  if (npc.morale.state === MoraleState.PANICKED && npc.fsmState !== 'FLEE') {
    npc.fsmState = 'FLEE';
    console.log('NPC fleeing!');
  }
}

// Simulate a firefight
npc.morale.adjust(-0.15); // took a hit
npc.morale.adjust(-0.25); // saw ally die
console.log(npc.morale.state); // 'shaken' (-0.4 > -0.6 threshold)

npc.morale.adjust(-0.25); // another ally died
console.log(npc.morale.state); // 'panicked' (-0.65 <= -0.6)

tickNPC(0.016); // → "NPC fleeing!"

// After combat ends — healer arrives
npc.morale.reset();
console.log(npc.morale.state); // 'stable'
```

---

## Performance note

`MoraleTracker` is a lightweight object — a float, a cached state string, and a
config reference. No allocations in `adjust()` or `update()`. Safe to create
one per NPC instance.
