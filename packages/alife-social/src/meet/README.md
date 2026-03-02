# meet

NPC greeting system — detects when an NPC is close enough to the player
(or any target position) and emits a greeting bubble.

```ts
import { MeetOrchestrator, isMeetEligible, selectGreetingCategory, DEFAULT_GREETING_STATE_MAP } from '@alife-sdk/social/meet';
import type { IMeetEligibilityContext, IMeetUpdateContext } from '@alife-sdk/social/meet';
```

---

## What's in this module

| Export | Kind | What it does |
|--------|------|-------------|
| `MeetOrchestrator` | class | Timed greeting check — returns `IBubbleRequest[]` each interval |
| `isMeetEligible` | function | Pure predicate — all 4 eligibility checks |
| `selectGreetingCategory` | function | Picks greeting category based on NPC state and faction |
| `DEFAULT_GREETING_STATE_MAP` | const | `{ camp: 'greeting_evening', sleep: 'greeting_evening' }` |
| `IMeetEligibilityContext` | interface | Context for `isMeetEligible` |
| `IMeetUpdateContext` | interface | Context for `MeetOrchestrator.update()` |

---

## MeetOrchestrator

Runs on a timer (`meetCheckIntervalMs`). Every interval it scans online NPCs
near the target position and emits a greeting bubble for each eligible one.

```ts
import { MeetOrchestrator } from '@alife-sdk/social/meet';

const meet = new MeetOrchestrator(contentPool, random, config.meet);

// Each frame:
const bubbles = meet.update({
  deltaMs,
  targetX:        player.x,
  targetY:        player.y,
  currentTime:    clock.now(),
  npcs:           provider.getOnlineNPCs(),
  isHostile:      (a, b) => factions.isHostile(a, b),
  isAlly:         (a, b) => factions.isAlly(a, b),
  targetFactionId: 'loner',
});

for (const bubble of bubbles) {
  presenter.showBubble(bubble.npcId, bubble.text, bubble.durationMs);
}
```

Each eligible NPC gets a per-NPC cooldown of `meetCooldownMs` (default 60 s).
Expired cooldowns are pruned automatically to prevent Map growth.

### Clearing

```ts
meet.clear(); // reset all cooldowns and the check timer
```

---

## Eligibility rules

All 4 checks must pass for an NPC to greet:

| Check | Detail |
|-------|--------|
| Not dead | `npc.state !== 'dead'` |
| In range | `dist² ≤ meetDistance²` (no `sqrt`) |
| Cooldown expired | per-NPC expiry timestamp |
| Not hostile | `!isHostile(npc.factionId, targetFactionId)` |

---

## Greeting category selection

Priority (first match wins):

1. `stateGreetingMap[npcState]` → use mapped category
   Default map: `{ camp: 'greeting_evening', sleep: 'greeting_evening' }`
2. Same faction or ally → `greeting_friendly`
3. Fallback → `greeting_neutral`

```ts
import { selectGreetingCategory } from '@alife-sdk/social/meet';

const category = selectGreetingCategory(
  npc.state,
  npc.factionId,
  playerFactionId,
  (a, b) => factions.isAlly(a, b),
  // Optional: override the default state map
  { sleep: 'greeting_evening', guard: 'greeting_neutral' },
);
```

---

## Using isMeetEligible standalone

The pure predicate can be used outside `MeetOrchestrator` — for example, to
evaluate whether a player should initiate a dialogue:

```ts
import { isMeetEligible } from '@alife-sdk/social/meet';

const eligible = isMeetEligible(npc, {
  targetPos:      { x: player.x, y: player.y },
  cooldowns:      meetCooldowns,
  currentTime:    Date.now(),
  isHostile:      (a, b) => factions.isHostile(a, b),
  targetFactionId: 'loner',
}, config.meet);
```
