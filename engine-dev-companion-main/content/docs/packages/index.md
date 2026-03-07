# Packages

The SDK is split into installable packages so you can start small and grow toward a richer living-world stack.

## Dependency picture

```text
@alife-sdk/core
    -> @alife-sdk/simulation
    -> @alife-sdk/ai
    -> @alife-sdk/social
    -> @alife-sdk/economy
    -> @alife-sdk/hazards
    -> @alife-sdk/persistence
    -> @alife-sdk/phaser
```

`@alife-sdk/core` is the foundation. Everything else is a layer or integration on top.

## Package matrix

| Package | What it owns | Reach for it when |
|---|---|---|
| [`@alife-sdk/core`](/packages/core) | Kernel, ports, plugins, factions, smart terrains, events, AI primitives | Every project |
| [`@alife-sdk/simulation`](/packages/simulation) | Offline tick simulation, NPC records, brains, terrain selection, conflict loops | Your world must keep living off-screen |
| [`@alife-sdk/ai`](/packages/ai) | Real-time online NPC behavior, perception, cover, GOAP, squad tactics | Nearby NPCs need frame-based combat behavior |
| [`@alife-sdk/social`](/packages/social) | Greetings, remarks, campfire stories | NPCs should speak and react socially |
| [`@alife-sdk/economy`](/packages/economy) | Inventory, trade, quests | You need player-facing systems around items and progression |
| [`@alife-sdk/hazards`](/packages/hazards) | Anomalies, damage zones, artefacts | The environment itself should threaten or reward actors |
| [`@alife-sdk/persistence`](/packages/persistence) | Save/load pipeline and storage providers | You need durable world state |
| [`@alife-sdk/phaser`](/packages/phaser) | Phaser adapters and one-call scene wiring | You are shipping on Phaser 3 |

## Recommended bundles

### Foundational living-world stack

```bash
npm install @alife-sdk/core @alife-sdk/simulation
```

### Living world plus nearby combat AI

```bash
npm install @alife-sdk/core @alife-sdk/simulation @alife-sdk/ai
```

### Phaser 3 starter stack

```bash
npm install @alife-sdk/core @alife-sdk/simulation @alife-sdk/ai @alife-sdk/social @alife-sdk/phaser
```

## How to read the package pages

Each package page answers four things:

1. What problem this package solves
2. When to add it
3. What the integration surface looks like
4. What usually goes wrong the first time

If you are still unsure which page to open first, use [Choose Your Stack](/guides/choose-your-stack).
