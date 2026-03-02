# A-Life SDK — packages

This directory contains 7 packages of the A-Life SDK — a framework-agnostic
simulation and AI system extracted from Chornobyl: The Lost Zone. Each package
is a standalone unit with its own tests and no platform dependencies.

---

## Dependency graph

```
@alife-sdk/core
    ├── @alife-sdk/simulation
    ├── @alife-sdk/ai
    ├── @alife-sdk/social
    ├── @alife-sdk/economy
    ├── @alife-sdk/hazards
    ├── @alife-sdk/persistence
    └── @alife-sdk/phaser  ←  depends on core + simulation + ai + social
```

All arrows point downward. No package depends on anything above it in this tree.
`@alife-sdk/core` has zero external dependencies.

---

## Packages

| Package | Description | When to use |
|---------|-------------|-------------|
| [`@alife-sdk/core`](alife-core/README.md) | Framework-agnostic A-Life simulation and AI decision-making foundation — StateMachine, GOAP, MemoryBank, Faction, SmartTerrain, ALifeKernel plugin host | Always — every other package depends on it |
| [`@alife-sdk/simulation`](alife-simulation/README.md) | Offline tick-based A-Life world simulation — NPC brains, terrain management, squad grouping, probabilistic combat, and surge events | When NPCs need autonomous offline behavior between simulation ticks |
| [`@alife-sdk/ai`](alife-ai/README.md) | Online frame-based NPC behavior — OnlineAIDriver, 18 AI states, cover system, GOAP controller, perception, squad tactics, path smoothing | When NPCs are within player range and need real-time AI |
| [`@alife-sdk/social`](alife-social/README.md) | NPC social interaction — proximity greetings, ambient idle remarks, and campfire group storytelling sessions | When NPCs should react to the player or each other with spoken lines |
| [`@alife-sdk/economy`](alife-economy/README.md) | Trade, inventory, and quest systems — buy/sell, item gifting, offline NPC-NPC trading, quest lifecycle FSM | When the game needs a player-facing economy or quest progression |
| [`@alife-sdk/hazards`](alife-hazards/README.md) | Hazard zones, anomaly damage, and artefact spawning — circular damage zones, weighted loot, immunity system | When the world needs environmental hazards with collectible rewards |
| [`@alife-sdk/persistence`](alife-persistence/README.md) | Save/load pipeline for ALifeKernel — pluggable storage backends, typed error codes, zero platform dependencies | When you need save slots (localStorage, file system, memory) |
| [`@alife-sdk/phaser`](alife-phaser/README.md) | Phaser 3 adapter layer — duck-typed interfaces, ready-to-use adapters, and a one-call kernel factory via `createPhaserKernel` | When building a Phaser 3 game — wires all SDK ports automatically |

---

## Where to start

### Engine-agnostic game (no Phaser)

1. Install `@alife-sdk/core` and implement the 3 required ports
   (`IEntityAdapter`, `IEntityFactory`, `IPlayerPositionProvider`).
2. Add `@alife-sdk/simulation` for offline NPC ticks.
3. Add `@alife-sdk/ai` for real-time online NPC behavior.
4. Add `@alife-sdk/social`, `@alife-sdk/economy`, `@alife-sdk/hazards`, or
   `@alife-sdk/persistence` as your game requires — each is opt-in.

Start here: [`alife-core/README.md`](alife-core/README.md)

### Phaser 3 game

Use `@alife-sdk/phaser`. It ships all adapter implementations and a
`createPhaserKernel()` factory that wires core, simulation, ai, and social
in a single call.

Start here: [`alife-phaser/README.md`](alife-phaser/README.md)

### Testing or standalone algorithm use

Every package works independently — none of them have singletons or global
state. Inject a `SeededRandom`, a frozen `IRuntimeClock`, and stub port
implementations to run any subsystem (StateMachine, QuestEngine, HazardManager,
etc.) in isolation without a kernel.

---

## Package README links

- [alife-core/README.md](alife-core/README.md)
- [alife-simulation/README.md](alife-simulation/README.md)
- [alife-ai/README.md](alife-ai/README.md)
- [alife-social/README.md](alife-social/README.md)
- [alife-economy/README.md](alife-economy/README.md)
- [alife-hazards/README.md](alife-hazards/README.md)
- [alife-persistence/README.md](alife-persistence/README.md)
- [alife-phaser/README.md](alife-phaser/README.md)
