# Guides

This section is for the developer who is seeing the SDK for the first time and wants to get to a working game integration without reading every package README front to back.

## Recommended order

1. [Choose Your Stack](/guides/choose-your-stack)
2. [First Living World](/guides/first-living-world)
3. Pick one integration path:
   [Phaser Integration](/guides/phaser-integration) or [Custom Engine](/guides/custom-engine)
4. Add opt-in systems from [Gameplay Systems](/guides/gameplay-systems)
5. Finish with [Save / Load](/guides/save-load) and keep [Troubleshooting](/guides/troubleshooting) nearby

## Pick the guide that matches your situation

<div class="route-grid">
  <a class="route-card" href="/guides/choose-your-stack">
    <strong>I do not know which packages I need</strong>
    Start here if you need a package map instead of API details.
  </a>
  <a class="route-card" href="/guides/first-living-world">
    <strong>I want one NPC working first</strong>
    Build a minimal living world before integrating rendering and combat polish.
  </a>
  <a class="route-card" href="/guides/phaser-integration">
    <strong>I am building with Phaser 3</strong>
    Use a clear route to a scene with online/offline NPC switching.
  </a>
  <a class="route-card" href="/guides/custom-engine">
    <strong>I have my own engine or ECS</strong>
    Wire the ports and simulation bridge cleanly without depending on Phaser.
  </a>
  <a class="route-card" href="/guides/gameplay-systems">
    <strong>I need hazards, quests, social, or persistence</strong>
    Add the optional systems in the right order and with the right expectations.
  </a>
  <a class="route-card" href="/guides/troubleshooting">
    <strong>Something is not moving or not updating</strong>
    The most common integration mistakes live here.
  </a>
</div>

## What these guides optimize for

- Getting a result quickly, not reading the entire codebase first
- Understanding the runtime split between offline simulation and online AI
- Avoiding the common early mistakes around ports, update loops, and online/offline switching
- Knowing when to stay minimal and when to add more packages

If you want the lower-level vocabulary behind these guides, open [Concepts](/concepts/) or [Glossary](/glossary).
