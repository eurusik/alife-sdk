# Guides

This section is for the developer who wants a working result without reading every package README front to back.

## Recommended order

1. [Is This For Me?](/guides/is-this-for-me)
2. [Choose Your Stack](/guides/choose-your-stack)
3. [First Living World](/guides/first-living-world)
4. Pick one integration path:
   [Phaser Integration](/guides/phaser-integration) or [Custom Engine](/guides/custom-engine)
5. Add opt-in systems from [Gameplay Systems](/guides/gameplay-systems)
6. Keep [Troubleshooting](/guides/troubleshooting) nearby when the first scene starts fighting back

## Pick the guide that matches your situation

<div class="route-grid">
  <a class="route-card" href="/guides/is-this-for-me">
    <strong>I need to know if this SDK fits my game</strong>
    Check supported engines, genre fit, team prerequisites, and honest non-fit cases.
  </a>
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
  <a class="route-card" href="/guides/troubleshooting">
    <strong>Something is not moving or not updating</strong>
    Follow the symptom-based checks before you add more systems.
  </a>
</div>

## What these guides optimize for

- getting a result quickly, not reading the entire codebase first
- understanding the runtime split between offline simulation and online AI
- avoiding the common early mistakes around ports, update loops, and online/offline switching
- knowing when to stay minimal and when to add more packages

If you want the lower-level vocabulary behind these guides, open [Concepts](/concepts/) or [Glossary](/glossary).
