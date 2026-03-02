# artefact

Artefact catalogue, weighted zone-based selection, and spawn logic.

```ts
import { ArtefactRegistry, ArtefactSpawner, WeightedArtefactSelector } from '@alife-sdk/hazards/artefact';
import type { IArtefactDefinition, IArtefactSelector } from '@alife-sdk/hazards/artefact';
```

---

## What's in this module

| Export | Kind | What it does |
|--------|------|-------------|
| `IArtefactDefinition` | interface | Static definition of one artefact type |
| `IArtefactSelector` | interface | Port — custom selection strategy |
| `WeightedArtefactSelector` | class | Built-in weighted-random selection |
| `ArtefactRegistry` | class | Catalogue of all artefact definitions |
| `ArtefactSpawner` | class | Tries to spawn an artefact inside a zone |

---

## Quick start

```ts
import { ArtefactRegistry, ArtefactSpawner, WeightedArtefactSelector } from '@alife-sdk/hazards/artefact';
import { SeededRandom } from '@alife-sdk/core/ports';

// 1. Build the catalogue (do this once at boot)
const random   = new SeededRandom(42);
const selector = new WeightedArtefactSelector(random);
const registry = new ArtefactRegistry(selector);

registry
  .register({ id: 'soul',      zoneTypes: ['radiation'], weight: 3 })
  .register({ id: 'jellyfish', zoneTypes: ['radiation', 'psi'], weight: 1 })
  .register({ id: 'fireball',  zoneTypes: ['fire'], weight: 2 })
  .freeze(); // lock after boot — mutations throw

// 2. Create the spawner
const spawner = new ArtefactSpawner(
  registry,
  {
    // IArtefactFactory — you implement this once (creates your engine's game objects)
    create(event) {
      scene.add.sprite(event.x, event.y, event.artefactId);
    },
  },
  random,
);

// 3. Call trySpawn once per zone per tick (e.g. every in-game hour)
for (const zone of hazardPlugin.zones()) {
  spawner.trySpawn(zone);
}
```

> **`create(event)`** is the only thing you write. The SDK handles the lottery,
> zone-capacity check, and position sampling.

---

## IArtefactDefinition

The static description of one artefact type — register it once at boot:

```ts
interface IArtefactDefinition {
  id:        string;                         // unique artefact identifier
  zoneTypes: HazardZoneType[];               // which zone types can spawn this
  weight:    number;                         // relative probability (higher = more common)
  custom?:   Record<string, unknown>;        // your extra data (grade, stats, name, …)
}
```

`HazardZoneType` is an open enum:

```ts
// built-in
'fire' | 'radiation' | 'chemical' | 'psi'

// extend freely — any string is valid
registry.register({ id: 'crystal', zoneTypes: ['gravity'], weight: 2 });
```

---

## ArtefactRegistry

Central catalogue — acts as an immutable store after `freeze()`.

### Registering artefacts

```ts
const selector = new WeightedArtefactSelector(random);
const registry = new ArtefactRegistry(selector);

// chained registration
registry
  .register({ id: 'soul',     zoneTypes: ['radiation'],        weight: 3 })
  .register({ id: 'fireball', zoneTypes: ['fire'],             weight: 2 })
  .register({ id: 'battery',  zoneTypes: ['chemical', 'psi'], weight: 1 });
```

### Freeze pattern

Call `freeze()` once all definitions are loaded. After that, `register()` throws.
This prevents runtime mutation and makes the registry safe to share:

```ts
registry.freeze();
registry.isFrozen; // → true

registry.register(def); // throws — catalogue is closed
```

### Reading the catalogue

```ts
registry.size;               // → number of registered definitions
registry.get('soul');        // → IArtefactDefinition | undefined
registry.all();              // → IterableIterator<IArtefactDefinition>

// Pick one artefact for a specific zone type (uses the selector)
registry.pickForZone('radiation');  // → IArtefactDefinition | null
```

`pickForZone` filters candidates whose `zoneTypes` includes the given type and
delegates selection to the `IArtefactSelector` provided at construction.
Returns `null` when no candidates exist for the zone type.

---

## ArtefactSpawner

Attempts to spawn one artefact inside a zone. Returns the spawn event on success,
`null` when the spawn is skipped.

### `trySpawn(zone)`

```
┌─ isAtCapacity? ──→ null (zone full)
│
├─ random() > artefactChance? ──→ null (lottery miss)
│
├─ registry.pickForZone(zone.type) → null? ──→ null (no candidates)
│
├─ sample position (60–95% of zone radius from centre)
│
├─ factory.create(event)
│
└─ return IArtefactSpawnEvent
```

Position is sampled on the **perimeter band** (60–95% of the zone radius) — artefacts
appear near the edge of anomaly zones, not dead-centre.

### `IArtefactSpawnEvent` payload

```ts
interface IArtefactSpawnEvent {
  artefactId: string;       // which artefact spawned
  zoneId:     string;       // which zone it spawned in
  zoneType:   string;       // zone's HazardZoneType
  x:          number;       // world x position
  y:          number;       // world y position
}
```

---

## IArtefactFactory — port you implement

`ArtefactSpawner` calls `factory.create(event)` each time a spawn succeeds.
You implement this interface once for your engine:

```ts
import type { IArtefactSpawnEvent } from '@alife-sdk/hazards/artefact';

class PhaserArtefactFactory implements IArtefactFactory {
  constructor(private scene: Phaser.Scene) {}

  create(event: IArtefactSpawnEvent): void {
    const sprite = this.scene.physics.add.sprite(event.x, event.y, event.artefactId);
    sprite.setData('artefactId', event.artefactId);
    sprite.setData('zoneId', event.zoneId);
  }
}
```

---

## Selection strategy

### Built-in: `WeightedArtefactSelector`

Picks one definition by weight — higher weight = higher probability:

```ts
const selector = new WeightedArtefactSelector(new SeededRandom(0));
```

With weights `{ soul: 3, jellyfish: 1 }` in a radiation zone:
- `soul` → 75% chance
- `jellyfish` → 25% chance

### Custom: `IArtefactSelector`

Replace with any selection logic by implementing the port:

```ts
interface IArtefactSelector {
  select(
    candidates: IArtefactDefinition[],
    zoneType: string,
  ): IArtefactDefinition | null;
}

// Example: always pick rarest (lowest weight)
class RarestSelector implements IArtefactSelector {
  select(candidates: IArtefactDefinition[]) {
    return candidates.reduce((a, b) => a.weight < b.weight ? a : b, candidates[0]) ?? null;
  }
}
```

---

## Capacity and chance

Both are controlled by the zone's config (set when registering the zone):

```ts
hazardPlugin.register({
  id: 'rad_lake',
  type: 'radiation',
  x: 400, y: 300, radius: 120,
  damage: 5,
  artefactChance: 0.3,   // 30% chance per trySpawn call
  maxArtefacts:   3,     // no spawn when zone already has 3 artefacts
});
```

When `maxArtefacts` is reached, `trySpawn` returns `null` immediately without
touching the random seed — deterministic behaviour is preserved.

---

## Testing tips

No kernel or engine needed:

```ts
import { ArtefactRegistry, ArtefactSpawner, WeightedArtefactSelector } from '@alife-sdk/hazards/artefact';
import { SeededRandom } from '@alife-sdk/core/ports';

const rng      = new SeededRandom(0);
const selector = new WeightedArtefactSelector(rng);
const registry = new ArtefactRegistry(selector);
registry.register({ id: 'soul', zoneTypes: ['radiation'], weight: 1 }).freeze();

const spawned: IArtefactSpawnEvent[] = [];
const spawner = new ArtefactSpawner(
  registry,
  { create: (e) => spawned.push(e) },
  rng,
);

// Mock zone — always spawns (chance = 1.0, not at capacity)
const zone = mockZone({ type: 'radiation', artefactChance: 1.0, atCapacity: false });
spawner.trySpawn(zone);

expect(spawned[0].artefactId).toBe('soul');
```
