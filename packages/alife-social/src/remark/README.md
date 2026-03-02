# remark

Ambient idle remark system — NPCs in eligible states occasionally say
something about the zone, weather, or faction gossip.

```ts
import { RemarkDispatcher, DEFAULT_REMARK_ELIGIBLE_STATES } from '@alife-sdk/social/remark';
```

---

## What's in this module

| Export | Kind | What it does |
|--------|------|-------------|
| `RemarkDispatcher` | class | Timed ambient remark emitter |
| `DEFAULT_REMARK_ELIGIBLE_STATES` | const | `['idle', 'patrol', 'camp']` |

---

## RemarkDispatcher

Runs on a timer (`remarkCheckIntervalMs`, default 5 s). Each check scans
online NPCs and emits at most one remark bubble per pass.

```ts
import { RemarkDispatcher } from '@alife-sdk/social/remark';

const dispatcher = new RemarkDispatcher(contentPool, random, config.remark);

// Each frame:
const bubbles = dispatcher.update(
  deltaMs,
  provider.getOnlineNPCs(),
  (npcId) => provider.getNPCTerrainId(npcId),
);

for (const bubble of bubbles) {
  presenter.showBubble(bubble.npcId, bubble.text, bubble.durationMs);
}
```

### Conditions per NPC (all must pass)

| Check | Detail |
|-------|--------|
| Eligible state | `npc.state ∈ eligibleStates` (default: idle / patrol / camp) |
| Per-NPC cooldown | Random `[remarkCooldownMinMs, remarkCooldownMaxMs]`, default 30–60 s |
| Terrain lock | One speaker per terrain at a time, lock expires after `terrainLockDurationMs` (default 10 s) |
| Random chance | `random() < remarkChance` (default 0.3) |

Only one NPC per check pass will speak, even if multiple are eligible.

### Clearing

```ts
dispatcher.clear(); // reset all cooldowns, terrain locks, check timer
```

---

## Category selection

Categories are selected by weighted random using **cumulative thresholds**:

```
random r ∈ [0, 1)
  r < weightZone (0.4)              → remark_zone
  r < weightWeatherCumulative (0.7) → remark_weather
  else                              → remark_gossip:{npc.factionId}
                                      (silently skipped if no content)
```

To add a new category to the rotation, either:
- Adjust the weights in `IRemarkConfig` so the thresholds cover your range
- Or call `dispatcher.update()` with a custom `getTerrainId` that drives separate logic

---

## Custom eligible states

Override which NPC states can deliver remarks via `IRemarkConfig.eligibleStates`:

```ts
const config = createDefaultSocialConfig({
  remark: {
    eligibleStates: ['idle', 'patrol', 'camp', 'guard', 'sleep'],
  },
});
```

Defaults to `DEFAULT_REMARK_ELIGIBLE_STATES = ['idle', 'patrol', 'camp']`.
