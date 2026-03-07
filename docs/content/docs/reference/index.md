# Reference

Use this section when package boundaries are already clear and you need the concrete runtime seams.

Package pages explain what each package is for. Reference pages explain what you actually integrate against: events, entities, plugins, offline brains, terrain state, online AI context, perception, cover, hazards, persistence, and Phaser adapters.

## Start here

- [Core Reference](/docs/reference/core/index) -> you are wiring the runtime shell and need the real contracts behind kernel, entities, events, or plugins
- [Simulation Reference](/docs/reference/simulation/index) -> you need to understand how offline brains choose terrains, hold tasks, and survive online/offline handoff
- [AI Reference](/docs/reference/ai/index) -> you are integrating observed NPC behavior and need the driver/context/subsystem model
- [Social Reference](/docs/reference/social/index) -> you want ambient speech and group-social behavior once online NPC discovery is stable
- [Economy Reference](/docs/reference/economy/index) -> you are wiring inventory, trade, and quest progression as runtime rules
- [Hazards Reference](/docs/reference/hazards/index) -> you need environmental damage, zone timing, and artefact rewards
- [Persistence Reference](/docs/reference/persistence/index) -> you are wiring save/load and need explicit failure handling
- [Phaser Reference](/docs/reference/phaser/index) -> you are integrating the SDK into a real Phaser scene

## Browse by task

- "I need to understand the kernel shell" -> [Core Reference](/docs/reference/core/index)
- "I need NPCs to live offline" -> [Simulation Reference](/docs/reference/simulation/index)
- "I need one observed NPC to behave correctly online" -> [AI Reference](/docs/reference/ai/index)
- "I need ambient chatter and campfire behavior" -> [Social Reference](/docs/reference/social/index)
- "I need player-facing item, trade, or quest rules" -> [Economy Reference](/docs/reference/economy/index)
- "I need hazards and artefacts to work in-scene" -> [Hazards Reference](/docs/reference/hazards/index)
- "I need save/load to be predictable" -> [Persistence Reference](/docs/reference/persistence/index)
- "I need Phaser scene wiring and online/offline switching" -> [Phaser Reference](/docs/reference/phaser/index)

## What belongs here

- contract-level docs, not onboarding
- subsystem behavior, not package marketing
- lifecycle and ownership rules
- the pages you reopen while integrating or debugging

## Related pages

- [Packages](/docs/packages/index)
- [Custom Engine](/docs/guides/custom-engine)
- [Phaser Integration](/docs/guides/phaser-integration)
