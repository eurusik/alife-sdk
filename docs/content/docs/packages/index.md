# Packages

Use this section when you are deciding which parts of the SDK belong in your game at all.

Package pages answer:

- what a package is for
- when to add it
- what to read first
- where to go when integration starts going wrong

If package boundaries are already clear and you need concrete contracts, jump to [Reference](/docs/reference/index).

## Start here

- [`@alife-sdk/core`](/docs/packages/core) -> you need the runtime shell, ports, plugins, factions, terrains, and events
- [`@alife-sdk/simulation`](/docs/packages/simulation) -> your world should keep living off-screen
- [`@alife-sdk/ai`](/docs/packages/ai) -> nearby NPCs need richer frame-based behavior
- [`@alife-sdk/social`](/docs/packages/social) -> the world should speak and feel inhabited
- [`@alife-sdk/economy`](/docs/packages/economy) -> you need items, trade, and quest progression
- [`@alife-sdk/hazards`](/docs/packages/hazards) -> the environment itself should threaten or reward actors
- [`@alife-sdk/persistence`](/docs/packages/persistence) -> you need durable world state
- [`@alife-sdk/phaser`](/docs/packages/phaser) -> you are shipping on Phaser 3

## Browse by task

- [`@alife-sdk/core`](/docs/packages/core) -> I want the minimal runtime shell
- [`@alife-sdk/simulation`](/docs/packages/simulation) -> I want the world to keep moving off-screen
- [`@alife-sdk/ai`](/docs/packages/ai) -> I want one observed NPC to fight and react properly
- [`@alife-sdk/social`](/docs/packages/social) -> I want ambient chatter and social texture
- [`@alife-sdk/economy`](/docs/packages/economy) -> I want traders, inventory, and quests
- [`@alife-sdk/hazards`](/docs/packages/hazards) -> I want anomaly fields and artefacts
- [`@alife-sdk/persistence`](/docs/packages/persistence) -> I want save/load
- [`@alife-sdk/phaser`](/docs/packages/phaser) -> I want the fastest route into a Phaser scene

## Recommended stacks

### Foundational living-world stack

```bash
npm install @alife-sdk/core @alife-sdk/simulation
```

### Living world plus nearby combat AI

```bash
npm install @alife-sdk/core @alife-sdk/simulation @alife-sdk/ai
```

### Living world plus social texture

```bash
npm install @alife-sdk/core @alife-sdk/simulation @alife-sdk/social
```

### Player-facing progression stack

```bash
npm install @alife-sdk/core @alife-sdk/economy @alife-sdk/persistence
```

### Phaser 3 starter stack

```bash
npm install @alife-sdk/core @alife-sdk/simulation @alife-sdk/ai @alife-sdk/social @alife-sdk/phaser
```

## How to use package pages

Read the package page first when you are choosing architecture.

Then move into the matching reference track when you are integrating the actual contracts:

- [Core Reference](/docs/reference/core/index)
- [Simulation Reference](/docs/reference/simulation/index)
- [AI Reference](/docs/reference/ai/index)
- [Social Reference](/docs/reference/social/index)
- [Economy Reference](/docs/reference/economy/index)
- [Hazards Reference](/docs/reference/hazards/index)
- [Persistence Reference](/docs/reference/persistence/index)
- [Phaser Reference](/docs/reference/phaser/index)

## Related pages

- [Reference](/docs/reference/index)
- [Choose Your Stack](/docs/guides/choose-your-stack)
