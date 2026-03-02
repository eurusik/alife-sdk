# ports

Dependency-inversion interfaces between the SDK core and the host game engine.

```ts
import type {
  IEntityAdapter, IEntityQuery, IEntityMutation, IEntityRendering,
  IEntityFactory, INPCSpawnRequest, IMonsterSpawnRequest,
  IPlayerPositionProvider,
  IDataLoader,
  ILogger, ILogOutput,
  IRandom,
  IRuntimeClock,
} from '@alife-sdk/core/ports';

import { DefaultRandom, SeededRandom } from '@alife-sdk/core/ports';
```

---

## Why ports?

The SDK has zero runtime dependencies on Phaser, Unity, or any other engine.
All interaction with the host environment goes through **ports** — narrow
interfaces the host implements once. The SDK calls them; the host provides
the implementation.

```
┌──────────────────────────────────┐
│        @alife-sdk/core           │
│                                  │
│  kernel.tick()                   │
│    → IPlayerPositionProvider     │  ← host reads player.x, player.y
│    → IEntityMutation.setPosition │  ← host moves the sprite
│    → IEntityFactory.createNPC    │  ← host spawns a Phaser object
│    → IDataLoader.loadFactions    │  ← host reads JSON / DB / network
└──────────────────────────────────┘
         ▲ interface only, no import of Phaser types
```

You write one adapter per interface, once. After that you can swap engines
without touching any SDK code.

---

## Port overview

| Interface | Required? | Purpose |
|-----------|-----------|---------|
| [`IEntityAdapter`](#ientityadapter) | auto no-op | Full bridge to the engine's entity system |
| [`IEntityFactory`](#ientityfactory) | auto no-op | Spawn and destroy game entities |
| [`IPlayerPositionProvider`](#iplayerpositionprovider) | auto no-op | Supply player world position every tick |
| [`IDataLoader`](#idataloader) | optional | Load game data at kernel boot |
| [`ILogger`](#ilogger--ilogoutput) | optional | Logging facade for kernel and plugins |
| [`IRandom`](#irandom) | auto no-op | Injectable RNG for deterministic testing |
| [`IRuntimeClock`](#iruntimeclock) | optional | Real-time milliseconds for cooldown timers |

> **"auto no-op"** — if you don't `provide()` these ports, the kernel
> auto-provides a silent no-op implementation at `init()`. This means
> `new ALifeKernel().init()` works with zero configuration, which is
> ideal for offline simulation, persistence, and unit tests.

---

## `IEntityAdapter`

The main bridge between the SDK and your entity/scene system.
Split into three focused sub-interfaces by ISP — use the narrowest one your
code actually needs:

```
IEntityAdapter
  ├── IEntityQuery     — read-only state (position, alive, components)
  ├── IEntityMutation  — write state (move, show/hide, physics)
  └── IEntityRendering — visual output (alpha, animations)
```

### `IEntityQuery`

Read-only queries. Used by offline simulation and AI logic.

```ts
interface IEntityQuery {
  getPosition(entityId: string): Vec2 | null;        // null if entity gone
  isAlive(entityId: string): boolean;
  hasComponent(entityId: string, componentName: string): boolean;
  getComponentValue<T>(entityId: string, componentName: string): T | null;
  getMetadata?(entityId: string, key: string): unknown; // optional
}
```

### `IEntityMutation`

State mutations. Used by both offline simulation and online AI.

```ts
interface IEntityMutation {
  setPosition(entityId: string, position: Vec2): void;
  setActive(entityId: string, active: boolean): void;
  setVisible(entityId: string, visible: boolean): void;
  setVelocity(entityId: string, velocity: Vec2): void;
  getVelocity(entityId: string): Vec2;               // returns {x:0,y:0} for unknown IDs
  setRotation(entityId: string, radians: number): void;
  teleport(entityId: string, position: Vec2): void;  // bypasses physics interpolation
  disablePhysics(entityId: string): void;
  setMetadata?(entityId: string, key: string, value: unknown): void; // optional
}
```

### `IEntityRendering`

Visual effects. Only needed by online AI — not by offline simulation.

```ts
interface IEntityRendering {
  setAlpha(entityId: string, alpha: number): void;          // 0=invisible, 1=opaque
  playAnimation(entityId: string, key: string, ignoreIfPlaying?: boolean): void;
  hasAnimation(entityId: string, key: string): boolean;
}
```

### Phaser adapter example

```ts
import type { IEntityAdapter } from '@alife-sdk/core/ports';

export class PhaserEntityAdapter implements IEntityAdapter {
  constructor(private readonly scene: Phaser.Scene) {}

  getPosition(id: string) {
    const obj = this.scene.children.getByName(id) as Phaser.GameObjects.Sprite | null;
    return obj ? { x: obj.x, y: obj.y } : null;
  }

  isAlive(id: string) {
    const obj = this.scene.children.getByName(id) as Phaser.GameObjects.Sprite | null;
    return obj?.active ?? false;
  }

  hasComponent(id: string, name: string) {
    const obj = this.scene.children.getByName(id) as any;
    return obj?._components?.has(name) ?? false;
  }

  getComponentValue<T>(id: string, name: string): T | null {
    const obj = this.scene.children.getByName(id) as any;
    return obj?._components?.get(name) ?? null;
  }

  setPosition(id: string, pos: { x: number; y: number }) {
    (this.scene.children.getByName(id) as Phaser.GameObjects.Sprite)?.setPosition(pos.x, pos.y);
  }

  setActive(id: string, active: boolean) {
    this.scene.children.getByName(id)?.setActive(active);
  }

  setVisible(id: string, visible: boolean) {
    this.scene.children.getByName(id)?.setVisible(visible);
  }

  setVelocity(id: string, v: { x: number; y: number }) {
    const body = (this.scene.children.getByName(id) as Phaser.Physics.Arcade.Sprite)?.body;
    body?.setVelocity(v.x, v.y);
  }

  getVelocity(id: string) {
    const body = (this.scene.children.getByName(id) as Phaser.Physics.Arcade.Sprite)?.body;
    return body ? { x: body.velocity.x, y: body.velocity.y } : { x: 0, y: 0 };
  }

  setRotation(id: string, radians: number) {
    (this.scene.children.getByName(id) as Phaser.GameObjects.Sprite)?.setRotation(radians);
  }

  teleport(id: string, pos: { x: number; y: number }) {
    const sprite = this.scene.children.getByName(id) as Phaser.Physics.Arcade.Sprite;
    sprite?.body?.reset(pos.x, pos.y);
  }

  disablePhysics(id: string) {
    (this.scene.children.getByName(id) as Phaser.Physics.Arcade.Sprite)?.body?.setEnable(false);
  }

  setAlpha(id: string, alpha: number) {
    (this.scene.children.getByName(id) as Phaser.GameObjects.Sprite)?.setAlpha(alpha);
  }

  playAnimation(id: string, key: string, ignoreIfPlaying = true) {
    const sprite = this.scene.children.getByName(id) as Phaser.GameObjects.Sprite;
    if (!ignoreIfPlaying || sprite?.anims?.currentAnim?.key !== key) {
      sprite?.play(key, ignoreIfPlaying);
    }
  }

  hasAnimation(id: string, key: string) {
    return this.scene.anims.exists(key);
  }
}
```

---

## `IEntityFactory`

Called by the kernel's spawn system to create and destroy game entities.

```ts
interface IEntityFactory {
  createNPC(request: INPCSpawnRequest): string;         // returns new entity ID
  createMonster(request: IMonsterSpawnRequest): string; // returns new entity ID
  destroyEntity(entityId: string): void;
}
```

### `INPCSpawnRequest`

```ts
interface INPCSpawnRequest {
  readonly npcTypeId: string;   // key in NPCTypeRegistry
  readonly factionId: string;   // key in FactionRegistry
  readonly x:         number;   // spawn X (px)
  readonly y:         number;   // spawn Y (px)
  readonly rank:      number;   // 1–5, affects equipment and behavior
  readonly squadId?:  string;   // optional squad to join
  readonly metadata?: Record<string, unknown>; // engine-forwarded extras
}
```

### `IMonsterSpawnRequest`

```ts
interface IMonsterSpawnRequest {
  readonly monsterTypeId: string; // key in MonsterRegistry
  readonly x:             number;
  readonly y:             number;
  readonly lairTerrainId?: string; // owning SmartTerrain for MonsterHome
  readonly packIndex?:     number; // 0 = pack leader
  readonly metadata?:      Record<string, unknown>;
}
```

### Phaser factory example

```ts
import type { IEntityFactory, INPCSpawnRequest, IMonsterSpawnRequest } from '@alife-sdk/core/ports';

export class PhaserEntityFactory implements IEntityFactory {
  constructor(private readonly scene: GameScene) {}

  createNPC(req: INPCSpawnRequest): string {
    const npc = this.scene.npcGroup.create(req.x, req.y, 'npc_atlas');
    npc.setName(req.npcTypeId + '_' + Date.now());
    // ... configure from req.factionId, req.rank, req.metadata
    return npc.name;
  }

  createMonster(req: IMonsterSpawnRequest): string {
    const monster = this.scene.monsterGroup.create(req.x, req.y, 'monster_atlas');
    monster.setName(req.monsterTypeId + '_' + Date.now());
    return monster.name;
  }

  destroyEntity(entityId: string): void {
    this.scene.children.getByName(entityId)?.destroy();
  }
}
```

---

## `IPlayerPositionProvider`

The kernel reads the player's world position every A-Life tick to determine
which NPCs are close enough to go online.

```ts
interface IPlayerPositionProvider {
  getPlayerPosition(): Vec2; // never null — must always return a valid position
}
```

### Implementation

```ts
// Phaser — live reference to the player sprite
const provider: IPlayerPositionProvider = {
  getPlayerPosition: () => ({ x: player.x, y: player.y }),
};

// Test stub — player stands still at (0, 0)
const provider: IPlayerPositionProvider = {
  getPlayerPosition: () => ({ x: 0, y: 0 }),
};
```

---

## `IDataLoader`

Supplies game data to the kernel at boot. Each method may return data
**synchronously** (plain object) or **asynchronously** (Promise). The kernel
awaits all results before populating registries.

```ts
interface IDataLoader {
  loadFactions():  IFactionDataFile  | Promise<IFactionDataFile>;
  loadNPCTypes():  INPCTypeDataFile  | Promise<INPCTypeDataFile>;
  loadMonsters():  IMonsterDataFile  | Promise<IMonsterDataFile>;
  loadTerrains():  ITerrainDataFile  | Promise<ITerrainDataFile>;
  loadAnomalies(): IAnomalyDataFile  | Promise<IAnomalyDataFile>;
}
```

Each return type is `Record<id, definition>` — a plain object keyed by the
entity's string ID.

### JSON file loader example

```ts
import type { IDataLoader } from '@alife-sdk/core/ports';
import factionsData  from './data/factions.json';
import npcTypesData  from './data/enemies.json';
import monstersData  from './data/monsters.json';

export class JsonDataLoader implements IDataLoader {
  loadFactions()  { return factionsData; }
  loadNPCTypes()  { return npcTypesData; }
  loadMonsters()  { return monstersData; }
  async loadTerrains() {
    const res = await fetch('/api/terrains');
    return res.json();
  }
  loadAnomalies() { return {}; } // not used in this game
}
```

---

## `ILogger` + `ILogOutput`

Logging facade consumed by the kernel and all plugins. The built-in
[`Logger`](../logger/README.md) class implements `ILogger`. Substitute your
own via `IALifeKernelConfig.logger` when you already have a logging pipeline.

```ts
interface ILogger {
  debug(channel: string, message: string, data?: unknown): void;
  info (channel: string, message: string, data?: unknown): void;
  warn (channel: string, message: string, data?: unknown): void;
  error(channel: string, message: string, data?: unknown): void;
}

interface ILogOutput {
  write(entry: ILogEntry): void;
}
```

See [`logger/README.md`](../logger/README.md) for the full API and output examples.

---

## `IRandom`

Injectable random number generator. Use `DefaultRandom` in production and
`SeededRandom` in tests for deterministic results.

```ts
interface IRandom {
  next():                       number; // float in [0, 1)
  nextInt(min: number, max: number):   number; // integer in [min, max] inclusive
  nextFloat(min: number, max: number): number; // float in [min, max)
}
```

### `DefaultRandom`

Delegates to `Math.random()`. No state, no seed.

```ts
import { DefaultRandom } from '@alife-sdk/core/ports';
const rng = new DefaultRandom();
rng.next();          // 0.37...
rng.nextInt(1, 6);   // 1–6 like a die
rng.nextFloat(0, 5); // 0.0–4.99...
```

### `SeededRandom`

Deterministic **mulberry32** PRNG. Same seed → same sequence every run.
Invaluable for reproducible tests and replays.

```ts
import { SeededRandom } from '@alife-sdk/core/ports';
const rng = new SeededRandom(42);
rng.next();        // always 0.9572...
rng.nextInt(0, 9); // always the same digit for seed 42
```

### Injecting `IRandom`

SDK classes that need randomness accept `IRandom` as a constructor parameter:

```ts
import { MonsterHome } from '@alife-sdk/core/movement';
import { SeededRandom } from '@alife-sdk/core/ports';

// Production
const home = new MonsterHome(config);

// Test — fully deterministic patrol point generation
const home = new MonsterHome(config, new SeededRandom(123));
```

---

## `IRuntimeClock`

Real-time millisecond clock for cooldown timers and memory aging.
Distinct from `Clock` which provides game-time acceleration via `timeFactor`.

```ts
interface IRuntimeClock {
  now(): number; // monotonic real-time ms since session start
}
```

| | `IRuntimeClock.now()` | `Clock` (game time) |
|-|----------------------|---------------------|
| Tracks | Real elapsed time | Accelerated simulation time |
| `timeFactor` | Always 1× | Configurable (e.g. 10×) |
| Used for | Cooldowns, memory TTL, UI debounce | NPC schedules, day/night cycle |

### Implementation

```ts
// Phaser
const runtimeClock: IRuntimeClock = { now: () => scene.time.now };

// Node / test
const runtimeClock: IRuntimeClock = { now: () => Date.now() };

// Deterministic test — frozen clock
let fakeNow = 0;
const runtimeClock: IRuntimeClock = { now: () => fakeNow };
// Advance manually: fakeNow += 1000;
```

---

## Tips

**Use the narrowest interface your code needs.**
If a system only reads entity state, depend on `IEntityQuery` not
`IEntityAdapter`. This keeps the dependency surface small and makes testing
easier — mock only what you use.

**Make `IDataLoader` synchronous in tests.**
Return plain objects from each method — no `Promise`, no network, no delay:

```ts
const loader: IDataLoader = {
  loadFactions:  () => ({ stalker: { name: 'Stalker', baseRelations: {}, metadata: {} } }),
  loadNPCTypes:  () => ({}),
  loadMonsters:  () => ({}),
  loadTerrains:  () => ({}),
  loadAnomalies: () => ({}),
};
```

**Use `SeededRandom` in any test that samples randomness.**
Without a fixed seed, tests that depend on random values are non-deterministic
and will flake. Pass `new SeededRandom(42)` wherever `IRandom` is accepted.

**Keep `IPlayerPositionProvider.getPlayerPosition()` allocation-free.**
The kernel calls it every tick. Return a pre-allocated `Vec2` or simple object
literal — avoid `new` inside the function.
