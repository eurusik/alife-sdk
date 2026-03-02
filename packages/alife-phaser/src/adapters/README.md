# adapters

Six adapter classes that bridge the SDK port interfaces to a Phaser 3 game.

```ts
import {
  PhaserEntityAdapter,
  PhaserEntityFactory,
  PhaserSimulationBridge,
  PhaserNPCSocialProvider,
  PhaserSocialPresenter,
  PhaserPlayerPosition,
} from '@alife-sdk/phaser/adapters';
import type { IHPRecord, ImmunityLookup, MoraleCallback } from '@alife-sdk/phaser/adapters';
import type { IPositionSource } from '@alife-sdk/phaser/adapters';
```

---

## What's in this module

| Export | Kind | Implements |
|--------|------|-----------|
| `PhaserEntityAdapter` | class | `IEntityAdapter` |
| `PhaserEntityFactory` | class | `IEntityFactory` |
| `PhaserSimulationBridge` | class | `ISimulationBridge` |
| `PhaserNPCSocialProvider` | class | `INPCSocialProvider` |
| `PhaserSocialPresenter` | class | `ISocialPresenter` |
| `PhaserPlayerPosition` | class | `IPlayerPositionProvider` |
| `IHPRecord` | interface | HP record shape used by the bridge |
| `ImmunityLookup` | type | `(entityId, damageTypeId) => number` |
| `MoraleCallback` | type | `(entityId, delta, reason) => void` |
| `IPositionSource` | interface | Any `{ x, y }` object |

---

## PhaserEntityAdapter

Sprite registry implementing `IEntityAdapter` (query + mutation + rendering).

```ts
const adapter = new PhaserEntityAdapter(kernel.logger); // logger optional

// When a sprite is created:
adapter.register('npc_1', phaserSprite);

// SDK operations resolve via entityId:
adapter.setPosition('npc_1', { x: 120, y: 80 });
adapter.setVisible('npc_1', false);
adapter.playAnimation('npc_1', 'idle_rifle_s');

// Cleanup:
adapter.unregister('npc_1');
```

### Registry API

| Method | Description |
|--------|-------------|
| `register(id, sprite)` | Track a sprite under the given entity ID |
| `unregister(id)` | Remove the sprite from the registry |
| `has(id)` | Return `true` if registered |
| `getSprite(id)` | Direct sprite access (e.g. for bubble positioning) |
| `size` | Number of registered sprites |

### Mutation notes

- **`teleport`** calls `setPosition` and zeros velocity to prevent physics drift
- **`disablePhysics`** sets `body.enable = false` (DEAD state, removes from collision)
- **`setAlive`** updates the internal alive flag without touching the sprite
- **`setComponentData`** / `getComponentValue` — generic per-entity key-value store
- Missing-entity calls on mutation methods log a warning via `ILogger` (if provided)

---

## PhaserSimulationBridge

HP registry implementing `ISimulationBridge` for offline combat resolution.

```ts
const bridge = new PhaserSimulationBridge(kernel.logger);

// Register HP records when entities are created:
bridge.register('npc_1', { currentHp: 100, maxHp: 100 });

// Optional: plug in your immunity and morale systems:
bridge.setImmunityLookup((id, type) => immunityProfile.get(id)?.get(type) ?? 0);
bridge.setMoraleCallback((id, delta, reason) => npcBrain.get(id)?.adjustMorale(delta));

// Cleanup:
bridge.unregister('npc_1');
```

`IHPRecord.currentHp` is mutated in-place by `applyDamage`. Point the same
object your health component reads so both stay in sync.

### Callbacks

| Callback | Type | Description |
|----------|------|-------------|
| `ImmunityLookup` | `(entityId, damageTypeId) => number` | Resistance factor `[0, 1]`; 0 = no protection, 1 = immune |
| `MoraleCallback` | `(entityId, delta, reason) => void` | Morale adjustment from offline combat |

Neither callback is required. Without `ImmunityLookup`, `rawDamage` passes
through unchanged.

---

## PhaserEntityFactory

Callback-based `IEntityFactory`. Entity creation is game-specific (texture
keys, component setup), so the adapter delegates to three user-provided handlers.

```ts
const factory = new PhaserEntityFactory({
  createNPC: (req) => {
    const sprite = scene.physics.add.sprite(req.x, req.y, `npc_${req.npcTypeId}`);
    adapter.register(sprite.name, sprite);
    return sprite.name;
  },
  createMonster: (req) => {
    const sprite = scene.physics.add.sprite(req.x, req.y, req.monsterTypeId);
    adapter.register(sprite.name, sprite);
    return sprite.name;
  },
  destroyEntity: (id) => {
    adapter.getSprite(id)?.destroy();
    adapter.unregister(id);
    bridge.unregister(id);
  },
});
```

Each `create*` handler returns the new entity's ID string.

---

## PhaserNPCSocialProvider

Callback-based `INPCSocialProvider` (4 methods).

```ts
const provider = new PhaserNPCSocialProvider({
  getOnlineNPCs: () =>
    Array.from(onlineIds).map(id => ({
      id,
      position: adapter.getPosition(id)!,
      factionId: npcData.get(id)!.factionId,
      state: npcData.get(id)!.state,
    })),
  areFactionsFriendly: (a, b) => factions.isAlly(a, b),
  areFactionsHostile:  (a, b) => factions.isHostile(a, b),
  getNPCTerrainId:     (id)   => simulation?.getNPCBrain(id)?.currentTerrainId ?? null,
});
```

---

## PhaserSocialPresenter

Callback-based `ISocialPresenter` (one method).

```ts
const presenter = new PhaserSocialPresenter({
  showBubble: (npcId, text, durationMs) => {
    const sprite = adapter.getSprite(npcId);
    if (sprite) bubbleManager.show(sprite, text, durationMs);
  },
});
```

---

## PhaserPlayerPosition

`IPlayerPositionProvider` that reads live `x`/`y` from any `IPositionSource`.

```ts
// From a Phaser sprite:
const pos = new PhaserPlayerPosition(playerSprite);

// From the scene registry (when the player is not directly accessible):
const pos = new PhaserPlayerPosition({
  get x() { return scene.registry.get('playerX') as number; },
  get y() { return scene.registry.get('playerY') as number; },
});

// Hot-swap the source (e.g. after scene restart):
pos.setSource(newPlayerSprite);
```

`IPositionSource` is any object with `readonly x: number` and
`readonly y: number` — satisfied by sprites, plain objects, and getters.
