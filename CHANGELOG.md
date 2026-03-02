# Changelog

All notable changes to this project will be documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- `createInMemoryKernel()` factory in `@alife-sdk/simulation` — zero-boilerplate kernel setup for prototyping and unit testing. Wires all required ports with no-op adapters and returns a ready-to-use `{ kernel, sim, factions }` bundle.
- "Which packages do I need?" decision tree in README — guides new developers to the correct package set for their use case.
- `docs/glossary.md` — terminology reference for Port, Adapter, Plugin, SmartTerrain, Online/Offline, and other SDK-specific terms.
- `09-phaser.ts` listed in `examples/README.md` with clear browser-only notice.

---

## [0.1.0] — 2025-01-01

Initial release.

### Packages

- `@alife-sdk/core` — kernel, plugin host, port system, faction registry, SmartTerrain, EventBus, GOAP planner, StateMachine
- `@alife-sdk/simulation` — offline tick-based NPC simulation: brains, terrain selection, squad combat, surge events
- `@alife-sdk/ai` — online frame-based NPC AI: 18 states, cover system, perception, squad tactics
- `@alife-sdk/social` — proximity greetings, ambient remarks, campfire storytelling FSM
- `@alife-sdk/economy` — inventory, trade sessions, quest lifecycle FSM
- `@alife-sdk/hazards` — hazard zones, anomaly damage, artefact spawning, immunity profiles
- `@alife-sdk/persistence` — save/load pipeline with pluggable storage backends
- `@alife-sdk/phaser` — Phaser 3 adapter layer: `createPhaserKernel`, `PhaserEntityAdapter`, `OnlineOfflineManager`

### Key features

- Online/offline NPC duality: cheap tick-based simulation for off-screen NPCs, full frame-based AI for on-screen NPCs
- Plugin system with topological dependency resolution
- Port adapter pattern — zero engine imports in core; Phaser, Pixi, Three.js all work via adapters
- 38 typed events across 9 categories
- Full serialize/restore for save-game support
- Round-robin brain budget — hundreds of NPCs at negligible per-frame cost
