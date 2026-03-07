# Meet System

Use this page when you want nearby online NPCs to greet the player or another target in a deterministic way.

`MeetOrchestrator` is intentionally narrow: it decides who is eligible to greet right now and returns bubble requests. Presentation still belongs to your game.

## Import path

```ts
import {
  MeetOrchestrator,
  isMeetEligible,
  selectGreetingCategory,
  DEFAULT_GREETING_STATE_MAP,
} from "@alife-sdk/social/meet";
import type {
  IMeetEligibilityContext,
  IMeetUpdateContext,
} from "@alife-sdk/social/meet";
```

## Minimal usage

```ts
const meet = new MeetOrchestrator(contentPool, random, socialConfig.meet);

const bubbles = meet.update({
  deltaMs,
  targetX: player.x,
  targetY: player.y,
  currentTime: clock.now(),
  npcs: socialProvider.getOnlineNPCs(),
  isHostile: (a, b) => factions.isHostile(a, b),
  isAlly: (a, b) => factions.isAlly(a, b),
  targetFactionId: "stalker",
});

for (const bubble of bubbles) {
  presenter.showBubble(bubble.npcId, bubble.text, bubble.durationMs);
}
```

## What the orchestrator owns

`MeetOrchestrator` owns:

- interval-based eligibility checks
- per-NPC cooldown tracking
- greeting category selection
- bubble request generation

Your game still owns:

- online NPC discovery
- target position
- faction hostility/alliance rules
- bubble rendering or voice playback

## Eligibility model

An NPC can greet only if all of these are true:

- not dead
- within meet range
- not on per-NPC cooldown
- not hostile to the target

That small rule set makes meet a good first social subsystem to integrate.

## Greeting selection rule

Greeting category priority is:

1. state-specific greeting override
2. friendly/ally greeting
3. neutral fallback

The default state map is carried by `DEFAULT_GREETING_STATE_MAP`.

Use `selectGreetingCategory()` directly when you need the same greeting logic outside the orchestrator.

## Standalone eligibility check

If you need the pure predicate without the timer wrapper:

```ts
const eligible = isMeetEligible(npc, {
  targetPos: { x: player.x, y: player.y },
  cooldowns: meetCooldowns,
  currentTime: Date.now(),
  isHostile: (a, b) => factions.isHostile(a, b),
  targetFactionId: "stalker",
}, socialConfig.meet);
```

## Lifecycle

The recommended pattern is:

1. create one `MeetOrchestrator` for the social runtime
2. keep it allocated across frames so cooldowns stay stable
3. call `update()` from your social update loop
4. feed returned bubble requests into the presenter layer
5. call `clear()` only when you intentionally reset the social runtime

## Failure patterns

- recreating the orchestrator too often, which resets cooldowns
- unstable online NPC discovery, so the same NPC appears and disappears between checks
- faction friendliness/hostility rules that do not match the rest of the game
- expecting meet to handle presentation instead of returning bubble requests

## Related pages

- [Social package](/docs/packages/social)
- [Social Content](/docs/reference/social/content)
- [Remark System](/docs/reference/social/remark)
