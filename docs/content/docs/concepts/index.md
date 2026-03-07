# Concepts

These pages explain the mental model behind the SDK. Read them when the quick start gets you moving but you still want to understand why the architecture looks the way it does.

## Read these first

<div class="route-grid">
  <a class="route-card" href="/concepts/kernel">
    <strong>Kernel</strong>
    The runtime coordinator that owns lifecycle, ports, plugins, and the core event flow.
  </a>
  <a class="route-card" href="/concepts/ports">
    <strong>Ports</strong>
    The engine boundary that keeps the SDK framework-agnostic.
  </a>
  <a class="route-card" href="/concepts/online-offline">
    <strong>Online vs Offline</strong>
    The most important idea in the whole SDK and the reason the package split exists.
  </a>
  <a class="route-card" href="/concepts/npc-lifecycle">
    <strong>NPC Lifecycle</strong>
    What happens from registration to online handoff, offline resume, and save/load.
  </a>
  <a class="route-card" href="/concepts/smart-terrains">
    <strong>Smart Terrains</strong>
    Why off-screen NPCs feel like they belong to a world instead of wandering randomly.
  </a>
  <a class="route-card" href="/concepts/events">
    <strong>Events</strong>
    How systems talk without directly depending on each other.
  </a>
</div>

## One-screen architecture

```text
Your game engine
      |
      | implements ports
      v
ALifeKernel
      |
      | installs plugins
      v
simulation / ai / social / economy / hazards / persistence
```

## Mental model

- The kernel coordinates runtime ownership and lifecycle.
- Ports isolate engine specifics from SDK logic.
- Plugins keep systems modular instead of collapsing everything into one runtime blob.
- Simulation and AI are complementary layers, not duplicates.
- Smart terrains, factions, and events are the glue that makes the world coherent.

If any word here feels unfamiliar, keep [Glossary](/glossary) open while reading.
