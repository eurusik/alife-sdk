# Smart Terrains

`SmartTerrain` is the SDK's activity-zone model.

If you come from another AI framework, think of it as a point of interest with rules: bounds, capacity, job slots, and desirability.

## What a smart terrain contains

- an `id` and human-readable `name`
- world-space `bounds`
- `capacity` for concurrent occupants
- `jobs` such as patrol, guard, or work slots

## Why it matters

Smart terrains are one of the main reasons offline simulation feels coherent. NPCs do not just drift randomly; they choose destinations that fit faction, danger, and available jobs.

## Example

```ts
new SmartTerrain({
  id: 'abandoned_factory',
  name: 'Abandoned Factory',
  bounds: { x: 400, y: 400, width: 200, height: 200 },
  capacity: 6,
  jobs: [
    { type: 'patrol', slots: 3 },
    { type: 'guard', slots: 3, position: { x: 450, y: 450 } },
  ],
});
```

## Design advice

- Model areas the player can understand: camp, outpost, checkpoint, lair, workshop
- Use capacity to create pressure and movement between zones
- Use jobs to imply behavior instead of scripting every NPC manually

## Related docs

- [Simulation package](/packages/simulation)
- [Glossary](/glossary)
