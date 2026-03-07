# Choose Your Stack

The SDK is modular on purpose. Most teams should start with fewer packages than they think they need.

## Start from the game you are actually making

The right starting stack depends less on the engine name and more on what behavior you need in the world right now.

| Your current need | Start with | Why this is the right first layer |
|---|---|---|
| You need the architecture foundation: kernel, events, factions, terrains, ports | `@alife-sdk/core` | It gives you the shared runtime model without forcing the whole living-world stack immediately |
| You want off-screen NPCs to keep living, moving, and reacting | `@alife-sdk/core` + `@alife-sdk/simulation` | This is the real heart of the “living world” idea |
| You want nearby NPCs to fight and react with richer real-time behavior | add `@alife-sdk/ai` | This complements the simulation instead of replacing it |
| You are building in Phaser 3 and want the cleanest practical setup | add `@alife-sdk/phaser` | It removes the repetitive adapter work and gives you a clean scene entry point |

If you are unsure, the safest default is still:

1. Start with `core + simulation`
2. Prove one living NPC loop
3. Add `ai` only when nearby NPCs need more moment-to-moment behavior
4. Add social, hazards, economy, and persistence only when they solve a real design problem

## Recommended stacks

| Your goal | Install | Why |
|---|---|---|
| Kernel, factions, events, smart terrains | `@alife-sdk/core` | The minimum engine-agnostic foundation |
| Living world with off-screen NPCs | `@alife-sdk/core` + `@alife-sdk/simulation` | Adds brains, terrain choice, morale, and offline combat |
| Living world + nearby combat AI | add `@alife-sdk/ai` | Gives online frame-based behavior when NPCs matter on screen |
| Phaser 3 game | `@alife-sdk/core` + `@alife-sdk/simulation` + `@alife-sdk/ai` + `@alife-sdk/social` + `@alife-sdk/phaser` | The most direct path to a real scene |
| Trade, inventory, quests | add `@alife-sdk/economy` | Player-facing progression layer |
| Anomalies and artefacts | add `@alife-sdk/hazards` | Environmental danger and reward loops |
| Save / load | add `@alife-sdk/persistence` | Snapshot and restore kernel state |

## Rule of thumb

Start with the package set that proves the world loop without adding extra moving parts too early:

1. Kernel boots
2. One terrain exists
3. One NPC can be registered
4. One tick advances
5. One event can be observed

Only after that add online AI, hazards, economy, social, and save/load.

## Typical package bundles

### Custom engine, simulation-heavy game

```bash
npm install @alife-sdk/core @alife-sdk/simulation @alife-sdk/ai
```

### Phaser 3 action game

```bash
npm install @alife-sdk/core @alife-sdk/simulation @alife-sdk/ai @alife-sdk/social @alife-sdk/phaser
```

### Quest- and economy-heavy RPG layer

```bash
npm install @alife-sdk/core @alife-sdk/simulation @alife-sdk/economy @alife-sdk/persistence
```

## What each optional package really adds

| Package | Adds | Do not add it first if... |
|---|---|---|
| `@alife-sdk/ai` | Per-frame online behavior, cover, perception, GOAP, squad tactics | You do not yet have online/offline switching working |
| `@alife-sdk/social` | Greetings, remarks, campfire storytelling | You do not yet have stable online NPC discovery and factions |
| `@alife-sdk/economy` | Inventory, trade, quests | Your world loop and event wiring are still unstable |
| `@alife-sdk/hazards` | Zone damage, anomaly logic, artefacts | You do not yet have a good entity damage story |
| `@alife-sdk/persistence` | Save/load snapshots | The runtime state is still changing every hour |
| `@alife-sdk/phaser` | Adapters + one-call scene wiring | You are not using Phaser |

## Continue with

- Want the first working world loop: [First Living World](/guides/first-living-world)
- Building with Phaser: [Phaser Integration](/guides/phaser-integration)
- Building with your own engine: [Custom Engine](/guides/custom-engine)
