# entity

Contracts for entities and components. No implementation — only interfaces.

```ts
import type { IEntity, IComponent } from '@alife-sdk/core/entity';
```

---

## Why interfaces, not classes?

The SDK is engine-agnostic. It never creates, renders, or owns game objects.
Instead, it defines the **minimum slice** of an entity it needs to do its work:

```
Your Phaser.Sprite (or Pixi.js DisplayObject, or plain object)
           │
           ▼
    implements IEntity
           │
           ▼
   SDK sees IEntity  ← AI states, GOAP actions, FSM all consume this
```

You write one adapter per entity class, once. After that, the entire SDK
works with any engine.

---

## `IEntity`

The simulation's view of a game object.

```ts
interface IEntity {
  readonly id:         string;   // globally unique ("npc_stalker_01")
  readonly entityType: string;   // discriminator ("npc" | "monster" | "player")
  readonly isAlive:    boolean;  // false once killed/destroyed
  readonly metadata?:  ReadonlyMap<string, unknown>; // optional cross-system KV store
  x:      number;                // world X position (px), mutable
  y:      number;                // world Y position (px), mutable
  active: boolean;               // participates in physics + AI updates

  setPosition(x: number, y: number): void;
  setActive(value: boolean): this;
  setVisible(value: boolean): this;
  hasComponent(name: string): boolean;
  getComponent<T>(name: string): T;   // throws if not found
}
```

### What each field means

| Member | Description |
|--------|-------------|
| `id` | Unique string — used in `MemoryBank`, `DangerManager`, event payloads, etc. |
| `entityType` | Lets the SDK distinguish NPCs from monsters from the player without importing game classes. |
| `isAlive` | When `false`, the SDK skips AI updates and marks the entity for cleanup. |
| `x` / `y` | World-space position. The SDK reads these directly in spatial queries. |
| `active` | Inactive entities are skipped in physics and AI ticks. |
| `metadata` | Optional read-only key-value store for cross-system data (see below). |
| `setPosition()` | Called by `MovementSimulator` and path following when moving the entity. |
| `setActive()` | Called during online/offline switching. |
| `setVisible()` | Called when an NPC goes offline — hidden from the renderer. |
| `hasComponent()` | Guards component access before `getComponent()`. |
| `getComponent<T>()` | Retrieves an attached component by name. Throws if absent. |

---

## Implementing `IEntity` for your engine

### Phaser example

```ts
import type { IEntity, IComponent } from '@alife-sdk/core/entity';

export class PhaserNPC extends Phaser.GameObjects.Sprite implements IEntity {
  readonly id: string;
  readonly entityType = 'npc';
  private readonly _components = new Map<string, IComponent>();

  constructor(scene: Phaser.Scene, id: string, x: number, y: number) {
    super(scene, x, y, 'npc_atlas');
    this.id = id;
  }

  get isAlive(): boolean {
    return this.active;
  }

  setPosition(x: number, y: number): this {
    super.setPosition(x, y);
    return this;
  }

  addComponent(component: IComponent): void {
    component.init();
    this._components.set(component.name, component);
  }

  hasComponent(name: string): boolean {
    return this._components.has(name);
  }

  getComponent<T>(name: string): T {
    const c = this._components.get(name);
    if (!c) throw new Error(`Component "${name}" not found on entity "${this.id}"`);
    return c as T;
  }
}
```

### Plain object example (for tests or non-Phaser engines)

```ts
import type { IEntity } from '@alife-sdk/core/entity';

function createMockEntity(id: string, x = 0, y = 0): IEntity {
  const components = new Map<string, unknown>();
  return {
    id,
    entityType: 'npc',
    isAlive: true,
    x, y,
    active: true,
    setPosition(nx, ny) { this.x = nx; this.y = ny; },
    setActive(v) { this.active = v; return this; },
    setVisible(_v) { return this; },
    hasComponent: (name) => components.has(name),
    getComponent: <T>(name: string) => {
      const c = components.get(name);
      if (!c) throw new Error(`Component "${name}" not found`);
      return c as T;
    },
  };
}
```

---

## `IComponent`

Lifecycle contract for a single-concern behaviour attached to an entity.

```ts
interface IComponent {
  readonly name: string;  // unique key used in hasComponent() / getComponent()
  init():                 void; // called once when attached
  update(delta: number):  void; // called every frame (delta in seconds)
  destroy():              void; // called when entity or component is removed
}
```

### Writing a component

```ts
import type { IComponent, IEntity } from '@alife-sdk/core/entity';

export class HealthComponent implements IComponent {
  readonly name = 'health';
  private hp: number;
  private readonly maxHp: number;

  constructor(private readonly entity: IEntity, maxHp: number) {
    this.maxHp = maxHp;
    this.hp = maxHp;
  }

  init(): void {
    // setup subscriptions, initial state
  }

  update(delta: number): void {
    // passive regen, status effects, etc.
  }

  destroy(): void {
    // unsubscribe from events, release references
  }

  takeDamage(amount: number): void {
    this.hp = Math.max(0, this.hp - amount);
    if (this.hp === 0) {
      this.entity.setActive(false);
    }
  }

  get current() { return this.hp; }
  get max()     { return this.maxHp; }
}
```

### Using components from AI code

```ts
// In an IStateHandler or GOAPAction:
update(entity: IEntity, delta: number): void {
  if (!entity.hasComponent('health')) return;

  const health = entity.getComponent<HealthComponent>('health');
  if (health.current / health.max < 0.2) {
    // HP below 20% — transition to WOUNDED state
    entity.fsm?.transition('WOUNDED');
  }
}
```

---

## `metadata` — lightweight cross-system data

`metadata` is an optional `ReadonlyMap<string, unknown>` for tagging entities
with data that doesn't warrant a full component:

```ts
// Producer: tag the entity (e.g. in your factory)
const meta = new Map<string, unknown>();
meta.set('faction',   'stalker');
meta.set('rank',       3);
meta.set('storyId',   'quest_npc_sidorovich');

// Consumer: read in AI state or GOAP action
const faction = entity.metadata?.get('faction') as string | undefined;
const rank    = entity.metadata?.get('rank')    as number | undefined;
```

Use `metadata` for small, rarely-changing properties (faction, rank, story ID).
Use components for anything with lifecycle (`init`/`update`/`destroy`) or
significant state.

---

## How `IEntity` flows through the SDK

```
IStateHandler.update(entity, delta)     ← StateMachine
GOAPAction.execute(entity, delta)       ← GOAPPlanner
ITransitionCondition.condition(entity)  ← AIStateRegistry
IStateHandler.enter/exit(entity)        ← StateMachine transitions
```

Every AI primitive in `@alife-sdk/core/ai` receives an `IEntity` — no
engine-specific type leaks into the AI layer.

---

## `EntityHandle` — versioned entity references

Use `EntityHandle` instead of raw entity IDs when holding long-lived references
to entities. A handle encodes both a **slot index** and a **generation counter**,
so it automatically becomes stale if the entity is destroyed and the slot reused.

```ts
import {
  EntityHandleManager,
  NULL_HANDLE,
  isValidHandle,
  handleToString,
} from '@alife-sdk/core/entity';
import type { EntityHandle } from '@alife-sdk/core/entity';
```

### Why this matters

Without handles:
```ts
const id = enemy.id; // string reference
enemy.destroy();
// id still points to "enemy_007" — another entity might reuse that ID
doSomething(world.getEntity(id)); // silent bug: wrong entity
```

With handles:
```ts
const handle = manager.alloc(enemy.id);
enemy.destroy();
manager.free(handle);
// Later:
const id = manager.resolve(handle); // null — slot was freed
```

### `EntityHandleManager<TId>`

```ts
const manager = new EntityHandleManager<string>();

// Allocate
const handle: EntityHandle = manager.alloc('enemy_007');

// Resolve (returns null if stale)
const id = manager.resolve(handle); // 'enemy_007'

// Release
manager.free(handle);

// After free, old handles are stale
manager.resolve(handle); // null
manager.isAlive(handle); // false

// Slot reuse bumps generation — old handle stays stale
const handle2 = manager.alloc('new_entity');
manager.resolve(handle);  // null  (stale)
manager.resolve(handle2); // 'new_entity'

// Size
manager.size; // 1
```

### API summary

| Method | Description |
|--------|-------------|
| `alloc(id)` | Allocate a new handle for entity `id`. Returns `EntityHandle`. |
| `free(handle)` | Release the slot; bumps generation. No-op for stale handles. |
| `resolve(handle)` | Returns the stored id, or `null` if stale or null handle. |
| `isAlive(handle)` | `true` if the handle points to a live slot. |
| `size` | Number of currently live slots. |

### Primitives

```ts
import { makeHandle, indexOf, genOf, isValidHandle, handleToString, NULL_HANDLE } from '@alife-sdk/core/entity';

const h = makeHandle(5, 3);
indexOf(h);       // 5
genOf(h);         // 3
isValidHandle(h); // true
isValidHandle(NULL_HANDLE); // false
handleToString(h);          // 'Entity(idx=5, gen=3)'
```
