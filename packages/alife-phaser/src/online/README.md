# online

Online/offline NPC switching and per-NPC AI context bridge.

```ts
import { OnlineOfflineManager } from '@alife-sdk/phaser/online';
import { PhaserNPCContext } from '@alife-sdk/phaser/online';
import type { IPhaserNPCHost, IPhaserNPCSystemBundle } from '@alife-sdk/phaser/online';
```

---

## What's in this module

| Export | Kind | What it does |
|--------|------|-------------|
| `OnlineOfflineManager` | class | Pure hysteresis-based online/offline evaluation |
| `PhaserNPCContext` | class | Bridges `IPhaserNPCHost` to `INPCContext` for AI state handlers |
| `IPhaserNPCHost` | interface | Abstract sprite operations the game layer must implement |
| `IPhaserNPCSystemBundle` | interface | Optional AI subsystem accessors (perception, health, cover…) |

---

## OnlineOfflineManager

Pure algorithm — no Phaser import, no state mutation. Evaluates each NPC's
distance to the player, applies hysteresis, and returns which IDs should
transition.

```ts
const manager = new OnlineOfflineManager({
  switchDistance: 700,     // default
  hysteresisFactor: 0.15,  // default → online ≈595 px, offline ≈805 px
});

// Each simulation tick (not every frame):
const records: IOnlineRecord[] = [...]; // build from NPC data
const { goOnline, goOffline } = manager.evaluate(
  player.x, player.y,
  records,
  (npcId) => squadManager.getMemberIds(npcId),  // optional SquadResolver
);

for (const id of goOnline)  bringOnline(id);
for (const id of goOffline) bringOffline(id);
```

### Hysteresis band

```
                    online            offline
Player ──────────────[595]────────────[805]──────────────→ distance
        always online ↑ hysteresis band ↑ always offline
```

NPCs inside the band maintain their current state — no transition is emitted.
This prevents rapid flickering when an NPC walks near the boundary.

### Squad-aware switching

When a `SquadResolver` is provided and the NPC belongs to a multi-member squad,
the entire squad switches atomically:

- **Any** member inside the online threshold → **all** go online
- **All** members beyond the offline threshold → **all** go offline
- Mixed (some inside band) → maintain current state

The manager deduplicates squads using a sorted member-key and skips any squad
already processed in the same pass.

### Zero-allocation design

Internal scratch fields (`_recordMap`, `_processedSquads`, `_goOnline`,
`_goOffline`, `_squadKeyScratch`) are reused every `evaluate()` call. The
returned `goOnline` / `goOffline` arrays are fresh copies, safe to store.

### Threshold getters

```ts
manager.onlineDistance   // px below which offline NPCs go online
manager.offlineDistance  // px above which online NPCs go offline
```

---

## PhaserNPCContext

Bridge between a Phaser sprite layer and the framework-agnostic `INPCContext`
interface expected by all online AI state handlers.

```ts
// 1. Implement IPhaserNPCHost in your entity class:
class EnemyNPCHost implements IPhaserNPCHost {
  constructor(
    private readonly sprite: Phaser.Physics.Arcade.Sprite,
    private readonly scene: Phaser.Scene,
  ) {}

  readonly npcId = 'enemy_1';
  readonly factionId = 'bandits';
  readonly entityType = 'npc';

  getX() { return this.sprite.x; }
  getY() { return this.sprite.y; }

  setVelocity(vx: number, vy: number) { this.sprite.setVelocity(vx, vy); }
  halt()                              { this.sprite.setVelocity(0, 0); }
  setRotation(r: number)              { this.sprite.setRotation(r); }

  setAlpha(a: number)                 { this.sprite.setAlpha(a); }

  teleport(x: number, y: number)      { this.sprite.setPosition(x, y); }
  disablePhysics()                    { this.sprite.disableBody(true, false); }

  getCurrentStateId()                 { return this._stateId; }

  onTransitionRequest(stateId: string) { this._stateId = stateId; }
  onShoot(payload: IShootPayload)      { this.scene.events.emit('npc_shoot', this.npcId, payload); }
  onMeleeHit(payload: IMeleeHitPayload){ this.scene.events.emit('npc_melee', this.npcId, payload); }
  onVocalization(type: string)         { this.scene.events.emit('npc_vocalization', this.npcId, type); }
  onPsiAttackStart(x: number, y: number) { this.scene.events.emit('psi_attack_start', this.npcId, x, y); }

  now()    { return this.scene.time.now; }
  random() { return Math.random(); }

  private _stateId = 'IDLE';
}

// 2. Create context and driver:
const ctx = new PhaserNPCContext(
  new EnemyNPCHost(sprite, this),
  createDefaultNPCOnlineState(),
  {
    perception: myPerceptionSystem,
    health:     new NPCHealthBridge(healthComponent),
    cover:      coverSystem,
    danger:     dangerManager,
  },
);

// Note: OnlineAIDriver is imported from `@alife-sdk/ai`, not this package.
// import { OnlineAIDriver } from '@alife-sdk/ai';
const driver = new OnlineAIDriver(ctx, buildDefaultHandlerMap(), 'IDLE');

// 3. Each frame:
driver.update(scene.game.loop.delta);
```

### IPhaserNPCHost

Abstract interface the game entity must implement (19 members):

| Group | Members |
|-------|---------|
| Identity | `npcId`, `factionId`, `entityType` |
| Position | `getX()`, `getY()` |
| Movement | `setVelocity(vx, vy)`, `halt()`, `setRotation(r)` |
| Rendering | `setAlpha(a)` |
| Physics | `teleport(x, y)`, `disablePhysics()` |
| FSM query | `getCurrentStateId()` |
| Events | `onTransitionRequest(stateId)`, `onShoot(payload)`, `onMeleeHit(payload)`, `onVocalization(type)`, `onPsiAttackStart(x, y)` |
| Utilities | `now()`, `random()` |

> **Note on FSM control**: when the context is wrapped by `OnlineAIDriver`,
> the driver intercepts `ctx.transition()` and `ctx.currentStateId` internally.
> `onTransitionRequest` and `getCurrentStateId` serve as fallbacks for
> standalone testing without the driver.

### IPhaserNPCSystemBundle

All subsystems are optional. Absent ones return `null` on the context;
state handlers degrade gracefully.

| Field | Type | Used by |
|-------|------|---------|
| `perception` | `INPCPerception \| null` | COMBAT, ALERT, SEARCH states |
| `health` | `INPCHealth \| null` | WOUNDED, RETREAT states |
| `cover` | `ICoverAccess \| null` | TAKE_COVER state |
| `danger` | `IDangerAccess \| null` | EVADE_GRENADE, RETREAT states |
| `restrictedZones` | `IRestrictedZoneAccess \| null` | waypoint filtering |
| `squad` | `ISquadAccess \| null` | squad commands and target sharing |
