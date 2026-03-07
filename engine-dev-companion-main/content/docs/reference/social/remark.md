# Remark System

Use this page when you want low-frequency ambient speech that makes online spaces feel inhabited without turning into spam.

`RemarkDispatcher` runs on a timer and emits at most one remark bubble per check pass.

## Import path

```ts
import {
  RemarkDispatcher,
  DEFAULT_REMARK_ELIGIBLE_STATES,
} from "@alife-sdk/social/remark";
```

## Minimal usage

```ts
const remarks = new RemarkDispatcher(contentPool, random, socialConfig.remark);

const bubbles = remarks.update(
  deltaMs,
  socialProvider.getOnlineNPCs(),
  (npcId) => socialProvider.getNPCTerrainId(npcId),
);

for (const bubble of bubbles) {
  presenter.showBubble(bubble.npcId, bubble.text, bubble.durationMs);
}
```

## What the dispatcher owns

`RemarkDispatcher` owns:

- interval-based scan timing
- per-NPC cooldown tracking
- terrain-level speaker locking
- random chance gate
- weighted category selection

Your game still owns:

- online NPC discovery
- terrain ID resolution
- text presentation

## Firing model

A remark can fire only if all gates pass:

- NPC state is eligible
- per-NPC cooldown expired
- terrain lock is available
- random chance succeeds

Only one NPC per pass will speak, even if several are eligible.

That cap is one of the main reasons the subsystem feels ambient instead of noisy.

## Category model

Remarks are drawn from weighted categories such as:

- zone commentary
- weather commentary
- faction gossip

If a category has no content, it is skipped instead of breaking the whole pass.

## Eligible states

By default, the dispatcher uses `DEFAULT_REMARK_ELIGIBLE_STATES`, which are tuned for ambient idle behavior.

Override this in config when your game wants guards, sleepers, or other states to be remark-capable.

## Lifecycle

The healthy pattern is:

1. create one dispatcher for the running social runtime
2. keep it alive so cooldowns and terrain locks remain coherent
3. call `update()` from the social loop
4. route returned bubbles into your presenter
5. call `clear()` only when you intentionally reset the runtime

## Failure patterns

- remark-eligible states are too broad, so everybody talks constantly
- terrain ID resolution is unstable, so locks do not work correctly
- gossip logic exists but no faction-specific content was authored
- recreating the dispatcher resets cooldowns and lock state too often

## Related pages

- [Social package](/docs/packages/social)
- [Social Content](/docs/reference/social/content)
- [Campfire System](/docs/reference/social/campfire)
