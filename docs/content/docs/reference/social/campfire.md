# Campfire System

Use this page when you want structured group ambience instead of isolated one-line NPC remarks.

Campfire is the most stateful part of `@alife-sdk/social`: one terrain-level session, a rotating director, and a small FSM for storytelling, jokes, reactions, and eating.

## Import path

```ts
import { CampfireFSM, CampfireParticipants } from "@alife-sdk/social/campfire";
import type { IGatheringFSM, ICampfireParticipant } from "@alife-sdk/social/campfire";
```

## Minimal usage

```ts
const fsm = new CampfireFSM(
  "terrain_camp_1",
  contentPool,
  random,
  socialConfig.campfire,
);

fsm.setParticipants(["npc1", "npc2", "npc3"]);

const bubbles = fsm.update(deltaMs);

for (const bubble of bubbles) {
  presenter.showBubble(bubble.npcId, bubble.text, bubble.durationMs);
}
```

## What the FSM owns

`CampfireFSM` owns:

- one session per terrain
- current session state
- who the current director is
- when audience reactions happen
- activity transitions between story, joke, eating, and reaction beats

`CampfireParticipants` owns:

- who is in the session
- who the director is
- who counts as audience
- rotation of the director role

## State model

The runtime moves between:

- `IDLE`
- `STORY`
- `JOKE`
- `EATING`
- `REACTING`

That is enough structure to feel authored without turning the system into a full dialogue engine.

## Participant rule

Group membership must stay current.

If participants drop below the required minimum, the session should end instead of pretending the group is still there.

That is why stale participant lists create some of the ugliest campfire bugs.

## When to customize

Use the built-in `CampfireFSM` when you want campfire-style downtime.

Implement your own `IGatheringFSM` when the group behavior should follow a different pattern, such as:

- tavern banter
- squad downtime
- ritual gathering
- scripted staging behavior

## Minimal custom seam

```ts
class TavernFSM implements IGatheringFSM {
  update(deltaMs: number): IBubbleRequest[] {
    return [];
  }

  setParticipants(npcIds: readonly string[]): boolean {
    return npcIds.length >= 2;
  }

  clear(): void {}
}
```

## Lifecycle

The recommended pattern is:

1. detect when one terrain has enough participants
2. create or reuse one FSM for that terrain
3. refresh participants regularly
4. call `update()` every frame or social tick
5. clear the session when participation drops below the required minimum

## Failure patterns

- participant lists are not refreshed, so absent NPCs keep speaking
- director rotation breaks because group membership is unstable
- content exists for stories but not for reactions, so the flow has no visible follow-up
- the session is kept active after the terrain no longer has enough participants

## Related pages

- [Social package](/docs/packages/social)
- [Social Content](/docs/reference/social/content)
- [Remark System](/docs/reference/social/remark)
