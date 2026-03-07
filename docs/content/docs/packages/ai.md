# @alife-sdk/ai

This package is the online behavior layer for NPCs that currently matter on screen.

## Install

```bash
npm install @alife-sdk/ai @alife-sdk/core
```

## Add it when

- the player can observe the NPC moment to moment
- nearby NPCs need more detailed combat behavior than offline simulation alone
- your online/offline ownership model already basically works

## Integration shape

1. install `AIPlugin`
2. build one shared handler map
3. create one `OnlineAIDriver` per online NPC
4. call `driver.update(deltaMs)` every frame

## Start here

1. [AI Reference](/docs/reference/ai/index)
2. [AI States and Driver](/docs/reference/ai/states)
3. [AI Perception](/docs/reference/ai/perception)

## Most used

- [AI Cover](/docs/reference/ai/cover)
- [Online vs Offline](/docs/concepts/online-offline)
- [Phaser Integration](/docs/guides/phaser-integration)

## Debug this package

- Drivers exist but NPCs do nothing -> [AI States and Driver](/docs/reference/ai/states)
- NPCs do not detect threats correctly -> [AI Perception](/docs/reference/ai/perception)
- NPCs take bad cover or pile into one point -> [AI Cover](/docs/reference/ai/cover)

## Suggested adoption order

1. prove offline simulation first
2. add online/offline switching
3. add one human handler map
4. drive one online NPC with `OnlineAIDriver`

## Package README

- [Package README](https://github.com/eurusik/alife-sdk/blob/main/packages/alife-ai/README.md)

## Related pages

- [AI Reference](/docs/reference/ai/index)
- [Simulation package](/docs/packages/simulation)
- [Phaser Integration](/docs/guides/phaser-integration)
