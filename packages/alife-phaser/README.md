# @alife-sdk/phaser

Phaser 3 adapter layer for the A-Life SDK. Provides duck-typed Phaser
interfaces, ready-to-use adapter implementations, and a one-call kernel factory.
This package is designed for single-player or local Phaser scenes. For online multiplayer, implement network sync on top of the SDK.

```ts
// Sub-path imports keep bundles small — each path is a separate chunk.
// Import only what you use; the rest is tree-shaken out.
import { createPhaserKernel }                    from '@alife-sdk/phaser/scene';
import { PhaserEntityAdapter, PhaserEntityFactory,
         PhaserSimulationBridge, PhaserPlayerPosition } from '@alife-sdk/phaser/adapters';
import { OnlineOfflineManager }                  from '@alife-sdk/phaser/online';
```

```bash
npm install @alife-sdk/phaser @alife-sdk/core @alife-sdk/simulation @alife-sdk/ai @alife-sdk/social

# peer dependency (optional — only if using Phaser 3 engine directly)
npm install phaser@^3.60.0
```

`phaser` is an optional peer dependency — required only if you use `PhaserEntityAdapter` and related
adapters. Without it, the types still compile.

---

## Quick Start

The absolute minimum to get one NPC simulating in a Phaser scene — no online/offline
management, no squad logic, just a brain ticking every frame.

```ts
import Phaser from 'phaser';
import { createPhaserKernel } from '@alife-sdk/phaser/scene';
import {
  PhaserEntityAdapter,
  PhaserEntityFactory,
  PhaserSimulationBridge,
  PhaserPlayerPosition,
} from '@alife-sdk/phaser/adapters';
import { SmartTerrain, TerrainBuilder } from '@alife-sdk/core/terrain';

export class GameScene extends Phaser.Scene {
  private kernel!:     ReturnType<typeof createPhaserKernel>['kernel'];
  private simulation!: NonNullable<ReturnType<typeof createPhaserKernel>['simulation']>;
  private adapter!:    PhaserEntityAdapter;

  constructor() { super({ key: 'GameScene' }); }

  create(): void {
    // Spawn the player sprite — PhaserPlayerPosition reads x/y from it live.
    const player = this.physics.add.sprite(400, 300, 'player');

    // Adapter: maps entity IDs to Phaser sprites for the SDK.
    this.adapter = new PhaserEntityAdapter();
    // Bridge: tracks NPC HP so the simulation can apply damage.
    const bridge = new PhaserSimulationBridge();
    // PlayerPosition: supplies the player's world coordinates each tick.
    const playerPos = new PhaserPlayerPosition(player);
    // Factory: SDK calls these when it needs to spawn or despawn an entity.
    const factory = new PhaserEntityFactory({
      // req: INPCSpawnRequest from @alife-sdk/core
      // req: { npcTypeId, factionId, x, y, rank, squadId?, metadata? }
      createNPC: (req) => {
        const sprite = this.physics.add.sprite(req.x, req.y, 'npc'); // spawn sprite
        const id = `npc_${req.npcTypeId}`;
        this.adapter.register(id, sprite);                            // register before returning
        bridge.register(id, { currentHp: 100, maxHp: 100 });
        return id;
      },
      // req: IMonsterSpawnRequest from @alife-sdk/core
      // req: { monsterTypeId, x, y, lairTerrainId?, packIndex?, metadata? }
      createMonster: (req) => {
        const sprite = this.physics.add.sprite(req.x, req.y, 'monster');
        const id = `monster_${req.monsterTypeId}`;
        this.adapter.register(id, sprite);
        return id;
      },
      destroyEntity: (id) => {
        this.adapter.getSprite(id)?.destroy();
        this.adapter.unregister(id);
        bridge.unregister(id);
      },
    });

    // Wire everything into a kernel. 'simulation' preset includes SimulationPlugin
    // but skips AI and Social plugins — enough for basic NPC behaviour.
    const result = createPhaserKernel({
      ports: { entityAdapter: this.adapter, playerPosition: playerPos,
               entityFactory: factory, simulationBridge: bridge },
      data: {
        factions: [{ id: 'stalker', displayName: 'Stalker' }],         // at least one faction
        terrains: [
          new SmartTerrain(
            new TerrainBuilder('camp')
              .name('Camp').bounds({ x: 100, y: 100, width: 400, height: 400 })
              .capacity(5).addJob({ type: 'patrol', slots: 5 }).build()
          ),
        ],
      },
      config: { preset: 'simulation' },
    });

    this.kernel     = result.kernel;
    this.simulation = result.simulation!;   // non-null when preset !== 'minimal'

    this.kernel.init();

    // Register the NPC — call once per entity at startup.
    this.simulation.registerNPC({
      entityId: 'stalker_1', factionId: 'stalker',
      position: { x: 300, y: 280 }, rank: 3, combatPower: 50, currentHp: 100,
      behaviorConfig: {
        retreatThreshold: 0.1, panicThreshold: -0.7,
        searchIntervalMs: 5_000, dangerTolerance: 3, aggression: 0.5,
      },
      options: { type: 'human' },   // 'human' → schedules/equipment; 'monster' → lair-based
    });

    this.kernel.start();  // enables frame-based updates
  }

  update(_time: number, delta: number): void {
    // Drive the kernel every frame — NPC brains do not tick without this call.
    this.kernel.update(delta);  // delta is milliseconds (Phaser default)
  }
}
```

> **`preset: 'simulation'`** includes the SimulationPlugin (NPC records, HP, offline brains)
> but omits AI and Social plugins. Switch to `preset: 'full'` when you need the full
> behaviour tree and faction relationship system.
>
> **Preset plugin summary:**
>
> | Preset | Plugins included |
> |--------|-----------------|
> | `minimal` | FactionsPlugin, SpawnPlugin |
> | `simulation` | + SimulationPlugin (default) |
> | `full` | + AIPlugin, SocialPlugin |
>
> `simulationBridge` is optional but **required** for HP tracking when using the
> `simulation` or `full` presets. Omit it only with the `minimal` preset.

### Offline vs online AI

When an NPC is **offline** (beyond the player's range), `SimulationPlugin`'s brain runs pure
JavaScript logic — no Phaser physics involved. HP, morale, and damage are tracked through
`PhaserSimulationBridge`, which maintains lightweight HP records and routes `applyDamage` /
`adjustMorale` calls without touching any sprite.

When an NPC goes **online**, `OnlineAIDriver` takes over: it wraps a `PhaserNPCContext` backed
by your `IPhaserNPCHost` implementation and drives a full FSM with real Phaser physics — velocity,
collision, perception — every frame. The transition is triggered by `simulation.setNPCOnline(id, true)`
and managed by `OnlineOfflineManager.evaluate()`.

---

## Complete Example

A full Phaser 3 scene that wires the SDK end-to-end. Copy this as your starting point,
then replace texture keys and faction IDs with your own.

```ts
import Phaser from 'phaser';
import { createPhaserKernel } from '@alife-sdk/phaser/scene';
import {
  PhaserEntityAdapter,
  PhaserEntityFactory,
  PhaserSimulationBridge,
  PhaserPlayerPosition,
} from '@alife-sdk/phaser/adapters';
import { OnlineOfflineManager } from '@alife-sdk/phaser/online';
import type { IOnlineRecord } from '@alife-sdk/phaser/types';
import { SmartTerrain, TerrainBuilder } from '@alife-sdk/core/terrain';
import type { ALifeKernel } from '@alife-sdk/core';
import type { SimulationPlugin } from '@alife-sdk/simulation';

export class GameScene extends Phaser.Scene {
  private kernel!: ALifeKernel;
  private simulation!: SimulationPlugin;
  private onlineOffline!: OnlineOfflineManager;
  private adapter!: PhaserEntityAdapter;
  private bridge!: PhaserSimulationBridge;
  private player!: Phaser.Physics.Arcade.Sprite;

  // Throttle the online/offline check — runs at most once per second.
  private oomAccumMs = 0;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    // --- 1. Spawn the player sprite ---
    this.player = this.physics.add.sprite(400, 300, 'player');

    // --- 2. Create all four adapters ---
    //   EntityAdapter  — maps entity IDs to Phaser sprites
    //   SimBridge      — tracks HP and damage for offline NPCs
    //   PlayerPosition — reads x/y from the live player sprite
    //   EntityFactory  — delegates sprite creation/destruction to callbacks
    this.adapter = new PhaserEntityAdapter();
    this.bridge  = new PhaserSimulationBridge();

    const playerPos = new PhaserPlayerPosition(this.player);

    const factory = new PhaserEntityFactory({
      createNPC: (req) => {
        // Spawn the sprite, register it in both adapters, then return its ID.
        // req.x / req.y are world-space pixel coordinates from the spawn request.
        const sprite = this.physics.add.sprite(req.x, req.y, 'npc');
        const id = `npc_${req.npcTypeId}`;
        this.adapter.register(id, sprite);
        // HP is managed by the simulation — default to 100/100 here;
        // the real values come from registerNPC() below.
        this.bridge.register(id, { currentHp: 100, maxHp: 100 });
        return id;
      },
      createMonster: (req) => {
        const sprite = this.physics.add.sprite(req.x, req.y, 'monster');
        const id = `monster_${req.monsterTypeId}`;
        this.adapter.register(id, sprite);
        return id;
      },
      destroyEntity: (id) => {
        const sprite = this.adapter.getSprite(id);
        sprite?.destroy();
        this.adapter.unregister(id);
        this.bridge.unregister(id);
      },
    });

    // --- 3. Wire the kernel (preset 'full' includes AI + Social plugins) ---
    const result = createPhaserKernel({
      ports: {
        entityAdapter:    this.adapter,
        playerPosition:   playerPos,
        entityFactory:    factory,
        simulationBridge: this.bridge,
      },
      data: {
        factions: [
          { id: 'stalker', displayName: 'Stalker', relations: { bandit: -60, military: -20 } },
          { id: 'bandit',  displayName: 'Bandit',  relations: { stalker: -60, military: -80 } },
        ],
        terrains: [
          new SmartTerrain(
            new TerrainBuilder('main_camp')
              .name('Main Camp')
              .bounds({ x: 100, y: 100, width: 400, height: 400 })
              .capacity(10)
              .addJob({ type: 'patrol', slots: 5 })
              .addJob({ type: 'guard',  slots: 5, position: { x: 300, y: 300 } })
              .build()
          ),
        ],
      },
      config: {
        preset: 'full',
        onlineOffline: { switchDistance: 500, hysteresisFactor: 0.15 },
      },
    });

    this.kernel      = result.kernel;
    this.simulation  = result.simulation!;
    this.onlineOffline = result.onlineOffline;

    this.kernel.init();

    // --- 4. Register NPCs — called once per NPC at scene startup ---
    const behaviorConfig = {
      retreatThreshold: 0.1,
      panicThreshold:   -0.7,
      searchIntervalMs: 5_000,
      dangerTolerance:  3,
      aggression:       0.5,
    };

    this.simulation.registerNPC({
      entityId: 'stalker_guard_1', factionId: 'stalker',
      position: { x: 320, y: 280 }, rank: 3, combatPower: 55, currentHp: 100,
      behaviorConfig,
      options: { type: 'human' }, // 'human' → HumanBrain (schedules, equipment, money)
    });
    this.simulation.registerNPC({
      entityId: 'bandit_scout_1', factionId: 'bandit',
      position: { x: 640, y: 400 }, rank: 2, combatPower: 40, currentHp: 80,
      behaviorConfig,
      options: { type: 'human' },
    });
    this.simulation.registerNPC({
      entityId: 'stalker_vet_1', factionId: 'stalker',
      position: { x: 200, y: 500 }, rank: 5, combatPower: 80, currentHp: 120,
      behaviorConfig,
      options: { type: 'human' }, // use { type: 'monster', lairTerrainId: '...' } for creatures
    });

    // --- 5. Start the kernel ---
    this.kernel.start();
  }

  update(_time: number, delta: number): void {
    // Always drive the kernel with delta milliseconds (Phaser passes ms by default).
    this.kernel.update(delta);

    // --- Online/offline check (run at most once per second) ---
    this.oomAccumMs += delta;
    if (this.oomAccumMs >= 1_000) {
      this.oomAccumMs = 0;

      // Build a snapshot of every NPC's current position and online state.
      const records: IOnlineRecord[] = [];
      for (const [, record] of this.simulation.getAllNPCRecords()) {
        const brain = this.simulation.getNPCBrain(record.entityId);
        const pos   = brain?.lastPosition ?? record.lastPosition;
        records.push({
          entityId: record.entityId,
          x:        pos.x,
          y:        pos.y,
          isOnline: record.isOnline,
          isAlive:  record.currentHp > 0,
        });
      }

      const squadManager  = this.simulation.getSquadManager();
      const squadResolver = (npcId: string) => {
        const squad = squadManager.getSquadForNPC(npcId);
        return squad ? squad.getMembers() : null;
      };

      const { goOnline, goOffline } = this.onlineOffline.evaluate(
        this.player.x, this.player.y, records, squadResolver,
      );

      // Apply transitions — swap control between Phaser physics and sim brain.
      for (const id of goOnline) {
        this.simulation.setNPCOnline(id, true);
        // Activate the sprite so Phaser physics/AI takes over from here.
        const sprite = this.adapter.getSprite(id);
        sprite?.setActive(true).setVisible(true);
      }
      for (const id of goOffline) {
        this.simulation.setNPCOnline(id, false);
        // Snap sprite to the brain's last known position, then park it.
        const record = this.simulation.getNPCRecord(id);
        const sprite  = this.adapter.getSprite(id);
        if (sprite && record?.lastPosition) {
          sprite.setPosition(record.lastPosition.x, record.lastPosition.y);
        }
        sprite?.setActive(false).setVisible(false);
      }
    }
  }
}
```

> **Note on `SmartTerrain`:** import it from `@alife-sdk/core` and construct instances before
> passing them in the `data.terrains` array. Each terrain needs an `id`, `name`,
> `bounds: { x, y, width, height }`, and `capacity` (max simultaneous NPC jobs).

---

## Modules

| Module | What it contains |
|--------|-----------------|
| [`types`](src/types/README.md) | Duck-typed Phaser interfaces, `IOnlineOfflineConfig`, `IOnlineRecord` |
| [`adapters`](src/adapters/README.md) | 6 adapter classes bridging SDK ports to Phaser |
| [`online`](src/online/README.md) | `OnlineOfflineManager` + `PhaserNPCContext` |
| [`scene`](src/scene/README.md) | `createPhaserKernel` — full kernel wiring in one call |

---

## Quick start

```ts
// 1. Create adapters
const adapter  = new PhaserEntityAdapter(logger);
const bridge   = new PhaserSimulationBridge(logger);
const playerPos = new PhaserPlayerPosition(playerSprite);
const factory  = new PhaserEntityFactory({
  createNPC:     (req) => spawnNPC(req, adapter, bridge),
  createMonster: (req) => spawnMonster(req, adapter, bridge),
  destroyEntity: (id)  => despawn(id, adapter, bridge),
});

// 2. Wire the kernel
const { kernel, simulation, onlineOffline } = createPhaserKernel({
  ports:  { entityAdapter: adapter, playerPosition: playerPos,
            entityFactory: factory, simulationBridge: bridge },
  data:   { factions: FACTION_DEFS, terrains: TERRAINS },
  config: { preset: 'full' },
});

kernel.init();
kernel.start();

// 3. Phaser update loop
function update(_time: number, delta: number) {
  kernel.update(delta);

  // Run online/offline check at your preferred cadence (e.g. every 1 s):
  if (shouldCheckOnlineOffline) {
    const { goOnline, goOffline } = onlineOffline.evaluate(
      playerSprite.x, playerSprite.y,
      getOnlineRecords(),
      (id) => squadManager.getMemberIds(id),
    );
    goOnline.forEach(id  => bringOnline(id));
    goOffline.forEach(id => bringOffline(id));
  }
}
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        @alife-sdk/phaser                        │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │   adapters  │  │    online    │  │         scene          │ │
│  │─────────────│  │──────────────│  │────────────────────────│ │
│  │ EntityAd.   │  │ OnlineOff.   │  │ createPhaserKernel()   │ │
│  │ EntityFact. │  │ Manager      │  │   → kernel             │ │
│  │ SimBridge   │  │──────────────│  │   → simulation         │ │
│  │ SocProvider │  │ PhaserNPC    │  │   → onlineOffline      │ │
│  │ SocPresenter│  │ Context      │  └────────────────────────┘ │
│  │ PlayerPos   │  └──────────────┘                             │
│  └─────────────┘                                               │
└─────────────────────────────────────────────────────────────────┘
         ↓ implements                      ↓ creates
┌─────────────────────────────────────────────────────────────────┐
│   @alife-sdk/core  ·  @alife-sdk/simulation  ·  @alife-sdk/ai  │
│   @alife-sdk/social                                             │
└─────────────────────────────────────────────────────────────────┘
```

---

## How adapters work

**Why no direct Phaser import in the SDK core.**
The SDK never imports from `phaser` at compile time. Every Phaser object is accepted through a
minimal duck-typed interface (`IArcadeSprite`, `IArcadeBody`, `IArcadeAnims`). This means:
- Tests pass plain JavaScript objects with the right shape — no Phaser install needed in CI.
- You can swap the real Phaser sprite for any object that satisfies the interface (e.g. a
  server-side position stub).

**What each adapter does:**

| Adapter | Responsibility |
|---------|---------------|
| `PhaserEntityAdapter` | Stores a sprite registry keyed by entity ID; the SDK calls `setPosition`, `setVelocity`, `playAnimation`, etc. on it. |
| `PhaserEntityFactory` | Delegates `createNPC`, `createMonster`, and `destroyEntity` to your callbacks — you write the sprite-creation code. |
| `PhaserSimulationBridge` | Tracks NPC HP records; the simulation calls `applyDamage` and `adjustMorale` through it. |
| `PhaserPlayerPosition` | Reads `x`/`y` from any object (sprite, registry entry, plain object) and returns it as `Vec2`. |
| `PhaserNPCSocialProvider` | Supplies online NPC data and faction relationship queries to the social plugin via user-provided callbacks. |
| `PhaserSocialPresenter` | Delegates social presentation events (speech bubbles, etc.) to a user-provided `showBubble` callback. |

**Swapping adapters.** All six are plain classes implementing SDK interfaces (`IEntityAdapter`,
`IEntityFactory`, `ISimulationBridge`, `IPlayerPositionProvider`, `INPCSocialProvider`,
`ISocialPresenter`). Replace any of them with a custom class that implements the same interface —
the kernel does not care about the concrete type.

---

## Key design decisions

**No Phaser import at compile time.** All Phaser objects are accepted through
duck-typed interfaces (`IArcadeSprite`, `IArcadeBody`, `IArcadeAnims`). Tests
pass plain objects; the real Phaser sprites satisfy the interfaces at runtime.

**Callback-based factories.** `PhaserEntityFactory`, `PhaserNPCSocialProvider`,
and `PhaserSocialPresenter` delegate to user-provided callbacks instead of
subclassing. This keeps sprite creation and UI presentation game-specific
without requiring inheritance.

**OnlineOfflineManager is pure.** It evaluates NPC records and returns
transition lists — it never mutates records or calls Phaser APIs. The caller
decides when to run the check and how to apply the results.

**PhaserNPCContext wraps your sprite host.** Implement `IPhaserNPCHost` on
your NPC entity class (15 methods), then pass a `PhaserNPCContext` to
`OnlineAIDriver`. The driver intercepts `transition()` and manages the FSM;
the host handles all sprite-level operations.

**PhaserNPCContext is the online AI bridge — one instance per active NPC.**
It implements `INPCContext` by delegating every call (position, velocity,
events, subsystems) to your `IPhaserNPCHost` implementation. Wrap it with
`OnlineAIDriver` (imported from `@alife-sdk/ai`) to get a fully managed FSM
that calls `enter` / `update` / `exit` on your state handlers each frame.
See [`online/README.md`](src/online/README.md) for the full usage guide
including `IPhaserNPCHost`, subsystem wiring, and a complete example.

---

## Testing

The package has **187 tests** (vitest). Run them:

```
pnpm --filter @alife-sdk/phaser test
```

All adapters use duck-typed Phaser interfaces — no real Phaser import is needed
for tests. Pass a plain object that satisfies the interface shape:

```ts
// Mock Phaser sprite — just needs the shape, not real Phaser
const mockSprite = { x: 10, y: 20, active: true, visible: true, setActive: vi.fn(), setVisible: vi.fn() };
const adapter = new PhaserEntityAdapter();           // optional logger arg
adapter.register('mock_entity_1', mockSprite);       // attach sprite to entity ID
```

Covers: all 6 adapter classes (`PhaserEntityAdapter`, `PhaserEntityFactory`,
`PhaserSimulationBridge`, `PhaserPlayerPosition`, `PhaserNPCSocialProvider`,
`PhaserSocialPresenter`), `OnlineOfflineManager`, `PhaserNPCContext`,
`createPhaserKernel`, and 5 integration scenarios.

---

## Common Mistakes

**Forgetting `kernel.update(delta)` in Phaser's `update()` method.**
Without this call, no plugin ticks — NPC brains never update, the clock never advances, and
online/offline transitions never fire. Every Phaser scene that uses the kernel must call
`kernel.update(delta)` on every frame, where `delta` is the millisecond value Phaser passes
as the second argument to `update(_time, delta)`.

**Not registering the sprite with the adapter before calling `simulation.registerNPC()`.**
`PhaserEntityFactory.createNPC` is the right place to call `adapter.register(id, sprite)`.
If the sprite is registered after `registerNPC`, the adapter cannot find it during the
first brain update and logs warnings for every position/velocity mutation. Register the sprite
first, then return the ID from the factory callback.

**Not driving `OnlineOfflineManager.evaluate()` each check interval.**
`OnlineOfflineManager` is stateless — it evaluates a snapshot and returns lists. It does not
schedule itself. If you never call `evaluate()`, NPCs stay in their initial online/offline state
forever. Call it on a timer (e.g. every 1 s) and apply the returned `goOnline`/`goOffline` lists
by calling `simulation.setNPCOnline(id, true/false)`.

**Passing Phaser's absolute game time instead of the frame delta.**
`kernel.update(time)` expects elapsed milliseconds since the last frame — the `delta` parameter,
not the `time` parameter. Passing total elapsed time causes all plugin timers (brain tick
intervals, surge cooldowns, spawn cooldowns) to fire on the very first frame and then never again.
Use `kernel.update(delta)` where `delta` is typically 16–17 ms at 60 fps.

---

## Adding to an existing Phaser project

1. **Install the package.**
   ```bash
   npm install @alife-sdk/phaser @alife-sdk/core @alife-sdk/simulation @alife-sdk/ai @alife-sdk/social
   ```

2. **Create adapters in `Scene.create()`.**
   Instantiate `PhaserEntityAdapter`, `PhaserSimulationBridge`, `PhaserPlayerPosition` (passing
   your player sprite), and `PhaserEntityFactory` (with `createNPC`, `createMonster`, and
   `destroyEntity` callbacks).

3. **Wrap entity creation in `PhaserEntityFactory` callbacks.**
   Inside each callback, spawn your sprite, call `adapter.register(id, sprite)` and
   `bridge.register(id, { currentHp, maxHp })`, then return the entity ID string.

4. **Call `kernel.update(delta)` in `Scene.update()`.**
   Pass the `delta` argument (milliseconds since last frame) — not `time`. Without this, no
   plugin ticks and NPC brains never update.

5. **Register existing sprites with `adapter.register()`.**
   Any sprite already in your scene that the SDK should control must be registered before
   calling `simulation.registerNPC()`. Register first, then hand the ID to `registerNPC`.
