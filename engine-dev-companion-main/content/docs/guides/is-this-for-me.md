# Is This For Me?

Use this page before you commit to the integration.

The SDK is opinionated about one thing: **living-world runtime state for 2D JavaScript and TypeScript games**.

## Good fit

- you are building a 2D JavaScript or TypeScript game
- you need NPCs to keep living off-screen instead of respawning empty
- you want Phaser 3 support or a custom engine boundary through ports
- you prefer modular adoption instead of replacing your renderer or scene model
- you are comfortable integrating a headless runtime into your own game code

## Usually not a fit

- you need Unity, Godot, or Unreal-specific tooling
- you want a visual authoring workflow before touching code
- you need authoritative networking or MMO-scale replication out of the box
- you are looking for a renderer, physics engine, animation system, or ECS framework
- your team does not want to own engine-side adapters and scene wiring

## Supported today

- 2D JavaScript and TypeScript games
- Phaser 3 through `@alife-sdk/phaser`
- custom engines through typed ports
- modular package adoption
- headless evaluation through examples and in-memory runtime setup
- ESM-only environments on Node.js `>= 20`

## Best-fit game shapes

- survival sandboxes with patrols, camps, hazards, and faction pressure
- action games where nearby NPCs should become richer only when observed
- RPG layers that need quests, economy, hazards, or social texture on top of a living world
- games where off-screen continuity matters more than cinematic scripting alone

## Team prerequisites

You do not need a huge team, but you do need a few things:

- someone comfortable reading TypeScript integration code
- willingness to own adapters between the SDK and your engine
- a debug mindset around events, ticks, and runtime state
- discipline to prove one small loop before installing every optional package

## Adopt it when

- your world needs continuity outside the camera
- you already know that simple spawn/despawn tricks are not enough
- you want to keep engine ownership in your game code
- your team can integrate a runtime library without expecting a full editor-driven platform

## Skip it when

- a handcrafted finite set of scripted encounters is enough
- your game does not benefit from off-screen world progression
- your team mainly wants drop-in prefabs, not runtime seams
- the engine boundary is still unstable and changing weekly

## Best next page

- Need the shortest proof first: [Quick Start](/quick-start)
- Need package guidance: [Choose Your Stack](/guides/choose-your-stack)
- Need one small milestone: [First Living World](/guides/first-living-world)
