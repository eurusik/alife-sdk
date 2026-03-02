# sound

NPC vocalization type registry and per-NPC cooldown tracker.

**No audio playback.** The SDK defines what sound types exist and prevents
spamming — your host maps types to actual audio assets and triggers playback.

```ts
import {
  VocalizationType,
  VocalizationTracker,
  createDefaultVocalizationConfig,
} from '@alife-sdk/ai/sound';
import type { IVocalizationConfig } from '@alife-sdk/ai/sound';
```

---

## How it works

AI state handlers do **not** call `VocalizationTracker` directly. They call
`ctx.emitVocalization(type)` — a method on `INPCContext` that the **host adapter**
implements. The adapter uses `VocalizationTracker` internally to gate playback.

```
AI state handler
        │
        ▼  ctx.emitVocalization('combat')      — state → context seam
        │
        ▼  Host adapter (your code):
           tracker.canPlay(type, gameTimeMs)?
             yes → tracker.markPlayed(...)
                   audioSystem.play(npcId, type)
             no  → skip
```

`VocalizationTracker` is a **host-side utility** — the SDK provides it so your
adapter doesn't need to write cooldown logic from scratch.

---

## VocalizationType

17 predefined sound categories. Use them as keys — your host maps each to
an actual audio clip:

```ts
import { VocalizationType } from '@alife-sdk/ai/sound';

VocalizationType.IDLE            // 'idle'
VocalizationType.ALERT           // 'alert'
VocalizationType.COMBAT          // 'combat'
VocalizationType.WOUNDED         // 'wounded'
VocalizationType.DEATH           // 'death'
VocalizationType.FLEE            // 'flee'
VocalizationType.GRENADE_THROW   // 'grenade_throw'
VocalizationType.GRENADE_WARNING // 'grenade_warning'
VocalizationType.RELOAD          // 'reload'
VocalizationType.SPOTTED_ENEMY   // 'spotted_enemy'
VocalizationType.LOST_TARGET     // 'lost_target'
VocalizationType.KILL_CONFIRMED  // 'kill_confirmed'
VocalizationType.FRIENDLY_FIRE   // 'friendly_fire'
VocalizationType.HELP            // 'help'
VocalizationType.ACKNOWLEDGE     // 'acknowledge'
VocalizationType.REMARK          // 'remark'
VocalizationType.KAMP_SOCIAL     // 'kamp_social'
```

The type alias `VocalizationType` is the union of all these string values:

```ts
type VocalizationType = 'idle' | 'alert' | 'combat' | ... // all 17
```

---

## IVocalizationConfig

Cooldown durations (ms) per vocalization type:

```ts
interface IVocalizationConfig {
  readonly cooldowns: Readonly<Record<VocalizationType, number>>;
}
```

A cooldown of `0` means the type is **always playable** — no rate limiting.
`DEATH` uses `0` because a death sound should always fire regardless of
recent playback.

### createDefaultVocalizationConfig(): IVocalizationConfig

Default production cooldowns:

| Type | Cooldown |
|------|---------|
| `idle` | 15 000 ms |
| `alert` | 5 000 ms |
| `combat` | 3 000 ms |
| `wounded` | 4 000 ms |
| `death` | **0** (always plays) |
| `flee` | 5 000 ms |
| `grenade_throw` | 1 000 ms |
| `grenade_warning` | 2 000 ms |
| `reload` | 3 000 ms |
| `spotted_enemy` | 5 000 ms |
| `lost_target` | 5 000 ms |
| `kill_confirmed` | 3 000 ms |
| `friendly_fire` | 5 000 ms |
| `help` | 4 000 ms |
| `acknowledge` | 2 000 ms |
| `remark` | 10 000 ms |
| `kamp_social` | 8 000 ms |

Override individual cooldowns by spreading over the defaults:

```ts
const config = createDefaultVocalizationConfig();
const custom: IVocalizationConfig = {
  cooldowns: {
    ...config.cooldowns,
    [VocalizationType.COMBAT]: 1_000,   // more frequent combat lines
    [VocalizationType.IDLE]:   30_000,  // less frequent idle chatter
  },
};
```

---

## VocalizationTracker

Per-NPC cooldown tracker. Create one instance per NPC — each NPC has
its own independent cooldown state.

```ts
new VocalizationTracker(config: IVocalizationConfig)
```

### canPlay(type, currentTimeMs): boolean

Returns `true` if the NPC may play this vocalization now:
- First call for any type → always `true`.
- Cooldown `0` → always `true`.
- Otherwise: `currentTimeMs - lastPlayedMs >= cooldown`.

```ts
if (tracker.canPlay(VocalizationType.COMBAT, gameTimeMs)) {
  tracker.markPlayed(VocalizationType.COMBAT, gameTimeMs);
  audioSystem.play(npc.id, VocalizationType.COMBAT);
}
```

> **Always call `markPlayed` immediately after `canPlay` returns `true`**,
> before triggering audio. Otherwise a second `canPlay` in the same frame
> will also return `true` and cause double playback.

### markPlayed(type, currentTimeMs): void

Records the current time as the last-played timestamp for this type.
Call this right after deciding to play the sound.

### reset(): void

Clears all recorded timestamps — all types become available again immediately.
Use on NPC respawn to avoid carrying over stale cooldowns:

```ts
// On NPC respawn:
tracker.reset();
```

---

## Full integration example

The typical pattern: your `INPCContext` implementation wraps `VocalizationTracker`
and routes `emitVocalization()` calls through it.

```ts
import {
  VocalizationType,
  VocalizationTracker,
  createDefaultVocalizationConfig,
} from '@alife-sdk/ai/sound';
import type { INPCContext } from '@alife-sdk/ai/states';

// --- Setup (once per scene) ---

const vocConfig = createDefaultVocalizationConfig();

// --- Host adapter (implements INPCContext) ---

class PhaserNPCContext implements INPCContext {
  private readonly vocTracker: VocalizationTracker;

  constructor(private readonly npcId: string) {
    this.vocTracker = new VocalizationTracker(vocConfig);
    // ... other context fields
  }

  // INPCContext.emitVocalization — called by AI state handlers:
  emitVocalization(type: string): void {
    const gameTimeMs = gameTime.nowMs;
    if (!this.vocTracker.canPlay(type as VocalizationType, gameTimeMs)) return;
    this.vocTracker.markPlayed(type as VocalizationType, gameTimeMs);
    audioSystem.play(this.npcId, type);  // actual audio call
  }

  onRespawn(): void {
    this.vocTracker.reset();  // clear cooldowns between lives
  }

  // ... other INPCContext methods
}

// --- AI state handlers (SDK code) simply call: ---

// CombatState.update():
//   ctx.emitVocalization(VocalizationType.COMBAT);

// AlertState.enter():
//   ctx.emitVocalization(VocalizationType.SPOTTED_ENEMY);

// DeadState.enter():
//   ctx.emitVocalization(VocalizationType.DEATH);  // always fires — cooldown 0
```

---

## Using VocalizationType as open string union

`VocalizationType` is exported as both a const object and a type. You can
use the string values directly in host audio asset maps:

```ts
import type { VocalizationType } from '@alife-sdk/ai/sound';

// Map SDK types to your audio asset keys:
const audioMap: Record<VocalizationType, string> = {
  idle:            'npc_idle_01',
  alert:           'npc_alert_01',
  combat:          'npc_combat_01',
  wounded:         'npc_wounded_01',
  death:           'npc_death_01',
  flee:            'npc_flee_01',
  grenade_throw:   'npc_grenade_throw_01',
  grenade_warning: 'npc_grenade_warning_01',
  reload:          'npc_reload_01',
  spotted_enemy:   'npc_spotted_01',
  lost_target:     'npc_lost_target_01',
  kill_confirmed:  'npc_kill_01',
  friendly_fire:   'npc_friendly_fire_01',
  help:            'npc_help_01',
  acknowledge:     'npc_ack_01',
  remark:          'npc_remark_01',
  kamp_social:     'npc_kamp_01',
};

function playNPCSound(npcId: string, type: VocalizationType): void {
  const assetKey = audioMap[type];
  audioManager.play(assetKey, { at: npcPositions.get(npcId) });
}
```
