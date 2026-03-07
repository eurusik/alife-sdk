# @alife-sdk/social

This package makes the world feel inhabited instead of mechanically simulated.

It is not about combat strength or world progression. It is about the player hearing that the world has a voice: greetings, ambient remarks, and small group storytelling moments.

## Install

```bash
npm install @alife-sdk/social @alife-sdk/core
```

## What it gives you

- meet greetings near the player
- ambient remarks in active terrains
- campfire storytelling loops
- configurable content pools, cooldowns, and social timing

## Add it when

- your online NPC discovery already works
- faction relationships are already meaningful
- terrains are already part of your world logic
- you want atmosphere and faction identity outside combat

This package becomes much more useful after the world loop is already stable.

## The three social systems

| System | Trigger | Typical result |
|---|---|---|
| Meet | NPC gets close enough to the player or another target | Greeting bubble or line |
| Remark | Timed ambient check | One-off line in a terrain |
| Campfire | Eligible group sharing a terrain | Story or joke sequence |

## What your game implements

Two ports:

- `INPCSocialProvider`
- `ISocialPresenter`

The package decides who should speak and when. Your game decides:

- how to discover eligible NPCs
- how to resolve faction friendliness/hostility
- how to show the line in your UI or scene

## A minimal setup

```ts
kernel.portRegistry.register(SocialPorts.SocialPresenter, {
  showBubble(npcId, text, durationMs) {
    ui.showNpcBubble(npcId, text, durationMs);
  },
});

kernel.portRegistry.register(SocialPorts.NPCSocialProvider, {
  getOnlineNPCs() {
    return world.getOnlineNPCs().map(npc => ({
      id: npc.id,
      position: { x: npc.x, y: npc.y },
      factionId: npc.factionId,
      state: npc.state,
    }));
  },
  areFactionsFriendly(a, b) { return factions.getRelation(a, b) > 0; },
  areFactionsHostile(a, b) { return factions.getRelation(a, b) < -30; },
  getNPCTerrainId(id) { return sim.getNPCBrain(id)?.currentTerrainId ?? null; },
});

kernel.use(new SocialPlugin(random, { data: socialJson }));
kernel.init();
```

## What content you provide

The package expects structured social content such as:

- greetings
- remarks
- campfire stories and jokes

You are effectively supplying the voice of the world, while the package supplies the timing and selection logic.

## What your game still owns

- bubble rendering and presentation style
- localization strategy
- which NPCs are currently considered online and socially eligible
- how social lines fit into scene tone and pacing

## Common first-time mistakes

### Adding social before online NPC discovery is reliable

If your provider cannot return stable online NPC data, the system feels random or dead.

### Expecting the package to render anything by itself

It does not render UI. That is what `ISocialPresenter` is for.

### Missing faction logic

Without meaningful faction relations, greetings and interactions lose context quickly.

### Treating it like a dialogue tree system

This package is for ambient social texture, not for authored branching conversations.

## A good first use

Start small:

1. one faction-friendly greeting pool
2. one hostile/neutral pool
3. one remark category
4. one simple bubble presenter

That is enough to feel whether the package belongs in your game.

## Read next

- [Gameplay Systems](/guides/gameplay-systems)
- [Package README](https://github.com/eurusik/alife-sdk/blob/main/packages/alife-social/README.md)
