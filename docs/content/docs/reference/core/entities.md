# Core Entities Reference

Use this page when you need to answer one concrete question:

how does one of my engine objects become visible to the SDK?

## Import path

```ts
import type { IEntity, IComponent } from "@alife-sdk/core/entity";
```

## What this contract is for

`IEntity` is the minimum runtime shape the SDK reads and mutates.

The SDK does not own your game objects. It only assumes that the object it receives can:

- identify itself
- report whether it is alive
- expose world position
- be activated or hidden
- expose attached components

## What you implement

You implement `IEntity` on top of:

- a Phaser sprite
- an ECS wrapper
- a plain object for tests
- any other engine object you already own

You do not subclass an SDK base class. You adapt your own entity model to this contract.

## `IEntity` contract

```ts
interface IEntity {
  readonly id: string;
  readonly entityType: string;
  readonly isAlive: boolean;
  readonly metadata?: ReadonlyMap<string, unknown>;
  x: number;
  y: number;
  active: boolean;

  setPosition(x: number, y: number): void;
  setActive(value: boolean): this;
  setVisible(value: boolean): this;
  hasComponent(name: string): boolean;
  getComponent<T>(name: string): T;
}
```

## What the SDK actually uses

| Member | Why it matters |
|---|---|
| `id` | Cross-system identity for events, memory, danger, squads, and lookups |
| `entityType` | Distinguishes NPCs, monsters, players, or custom runtime actors |
| `isAlive` | Dead entities are skipped by AI and cleanup logic |
| `x` / `y` | Read constantly by perception, navigation, and spatial logic |
| `active` | Lets your host and the SDK agree whether the entity should currently participate |
| `setPosition()` | Used by movement and path-following systems |
| `setActive()` / `setVisible()` | Commonly used during online/offline transitions |
| `hasComponent()` / `getComponent()` | Main seam for feature-specific attached data |

## Minimal setup

### Phaser implementation

```ts
import type { IEntity, IComponent } from "@alife-sdk/core/entity";

export class PhaserNPC extends Phaser.GameObjects.Sprite implements IEntity {
  readonly id: string;
  readonly entityType = "npc";
  private readonly components = new Map<string, IComponent>();

  constructor(scene: Phaser.Scene, id: string, x: number, y: number) {
    super(scene, x, y, "npc_atlas");
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
    this.components.set(component.name, component);
  }

  hasComponent(name: string): boolean {
    return this.components.has(name);
  }

  getComponent<T>(name: string): T {
    const component = this.components.get(name);

    if (!component) {
      throw new Error(`Component "${name}" not found on entity "${this.id}"`);
    }

    return component as T;
  }
}
```

### Test implementation

```ts
import type { IEntity } from "@alife-sdk/core/entity";

function createMockEntity(id: string, x = 0, y = 0): IEntity {
  const components = new Map<string, unknown>();

  return {
    id,
    entityType: "npc",
    isAlive: true,
    x,
    y,
    active: true,
    setPosition(nx, ny) {
      this.x = nx;
      this.y = ny;
    },
    setActive(value) {
      this.active = value;
      return this;
    },
    setVisible(_value) {
      return this;
    },
    hasComponent(name) {
      return components.has(name);
    },
    getComponent<T>(name: string): T {
      const component = components.get(name);

      if (!component) {
        throw new Error(`Component "${name}" not found`);
      }

      return component as T;
    },
  };
}
```

## `IComponent` contract

Use a component when the attached data has lifecycle or behavior, not just a static tag.

```ts
interface IComponent {
  readonly name: string;
  init(): void;
  update(delta: number): void;
  destroy(): void;
}
```

## When to use `metadata` vs components

Use `metadata` for:

- faction IDs
- rank
- story IDs
- small readonly tags

Use components for:

- health
- stamina
- custom runtime behavior
- anything with setup, teardown, or mutation rules

## Integration recipe

1. Pick the engine object that should represent the NPC or actor.
2. Make sure it can expose stable `id`, `entityType`, and world position.
3. Implement `setPosition`, `setActive`, and `setVisible` cheaply.
4. Decide whether cross-system data belongs in `metadata` or components.
5. Pass the adapted entity into AI/runtime systems without leaking Phaser- or ECS-specific APIs upward.

## Failure patterns

- `id` is not stable across despawn/respawn, so long-lived references break
- `isAlive` is tied to the wrong engine flag
- `setVisible()` and `setActive()` are treated as the same thing even when the runtime needs both
- `getComponent()` returns scene objects directly instead of narrow feature-specific data
- world position is hidden behind expensive lookup code

## Related pages

- [Ports](/docs/concepts/ports)
- [Core package](/docs/packages/core)
- [Phaser Integration](/docs/guides/phaser-integration)
- [Phaser Adapters](/docs/reference/phaser/adapters)
