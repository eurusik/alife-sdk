# Social Content

Use this page when you need to author or load the text layer behind `@alife-sdk/social`.

`ContentPool` does not decide when NPCs speak. It decides what line is available once a social subsystem has already decided that a line should fire.

## Import path

```ts
import { ContentPool, loadSocialData } from "@alife-sdk/social/content";
```

## What you create

In the usual flow you create:

1. one `ContentPool`
2. load authored `ISocialData` into it with `loadSocialData()`
3. give that pool to meet, remark, and campfire systems

## Minimal working example

```ts
const pool = new ContentPool(random);

loadSocialData(pool, {
  greetings: {
    friendly: ["Hello.", "Good to see you."],
    neutral: ["Yeah?", "Need something?"],
    evening: ["Late hour.", "Quiet night."],
  },
  remarks: {
    zone: ["This place feels wrong."],
    weather: ["Storm is coming."],
    gossip: {
      military: ["Military passed through here again."],
    },
  },
  campfire: {
    stories: ["Once we crossed the Red Forest at night..."],
    jokes: ["That rookie called this a safe route."],
    reactions: {
      laughter: ["Ha!", "Good one."],
      story_react: ["No way.", "I heard that too."],
      eating: ["Pass the bread.", "Still better than rations."],
    },
  },
});
```

## What the pool actually owns

The pool groups lines by category:

- greetings
- remarks
- faction gossip
- campfire stories
- campfire jokes
- campfire reactions
- custom categories

The important runtime guarantee:

- categories with 2+ lines never repeat the same line twice in a row
- categories with 1 line always return that line

## Category mapping

`loadSocialData()` maps authored JSON into runtime keys.

The key mappings you will care about most are:

| Authored data | Runtime category |
|---|---|
| `greetings.friendly` | `greeting_friendly` |
| `greetings.neutral` | `greeting_neutral` |
| `greetings.evening` | `greeting_evening` |
| `remarks.zone` | `remark_zone` |
| `remarks.weather` | `remark_weather` |
| `remarks.gossip[faction]` | `remark_gossip:{faction}` |
| `campfire.stories` | `campfire_story` |
| `campfire.jokes` | `campfire_joke` |

## Faction gossip rule

Faction gossip uses a compound key.

Do not build it manually. Use the helper:

```ts
const key = ContentPool.gossipKey("military");
pool.getRandomLine(key);
```

## Authoring guidance

- categories that fire often should have several lines
- keep tone coherent inside one category
- do not treat gossip as generic filler
- keep authored content separate from timing/cooldown logic

## Failure patterns

- high-frequency categories contain only one line
- authored JSON leaves key categories empty and nobody notices
- teams try to solve pacing problems by adding more text instead of tuning orchestrators
- faction gossip exists in logic but not in content, so that branch always feels dead

## Related pages

- [Social package](/docs/packages/social)
- [Meet System](/docs/reference/social/meet)
- [Remark System](/docs/reference/social/remark)
- [Campfire System](/docs/reference/social/campfire)
