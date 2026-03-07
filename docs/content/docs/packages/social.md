# @alife-sdk/social

This package adds greetings, remarks, and campfire behavior for online NPCs.

## Install

```bash
npm install @alife-sdk/social @alife-sdk/core
```

## Add it when

- online NPC discovery already works
- faction relationships already matter
- terrains are already part of your world logic
- you want atmosphere outside combat

## The three social systems

| System | Trigger | Typical result |
|---|---|---|
| Meet | NPC gets close enough to the player or another target | greeting bubble or line |
| Remark | timed ambient check | one-off line in a terrain |
| Campfire | eligible group sharing a terrain | story or joke sequence |

## Start here

1. [Social Reference](/docs/reference/social/index)
2. [Social Content](/docs/reference/social/content)
3. [Meet System](/docs/reference/social/meet)

## Most used

- [Remark System](/docs/reference/social/remark)
- [Campfire System](/docs/reference/social/campfire)
- [Gameplay Systems](/docs/guides/gameplay-systems)

## Debug this package

- NPCs never greet or speak -> [Meet System](/docs/reference/social/meet)
- Ambient chatter is too frequent or absent -> [Remark System](/docs/reference/social/remark)
- Group downtime behavior does not trigger correctly -> [Campfire System](/docs/reference/social/campfire)
- Content seems missing -> [Social Content](/docs/reference/social/content)

## Minimal requirement

Your game implements two ports:

- `INPCSocialProvider`
- `ISocialPresenter`

## Package README

- [Package README](https://github.com/eurusik/alife-sdk/blob/main/packages/alife-social/README.md)

## Related pages

- [Social Reference](/docs/reference/social/index)
- [Gameplay Systems](/docs/guides/gameplay-systems)
- [AI package](/docs/packages/ai)
