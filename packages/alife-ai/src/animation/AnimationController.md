# AnimationController

Stateful per-entity animation controller with debounce and layer priority.
Framework-agnostic via the `IAnimationDriver` port.

**Source:** [AnimationController.ts](AnimationController.ts)

---

## Overview

`AnimationController` sits between the AI tick and the renderer.
Its job is to prevent redundant play calls and enforce layer priority,
so the renderer only receives a `play()` when the animation actually needs
to change.

Two key methods:

- **`request()`** — debounced; skips play if the same animation is already
  running or a higher-priority layer is active.
- **`force()`** — bypasses all checks; for one-shot priority events (death,
  hit reaction, special abilities).

---

## API reference

### `IAnimationDriver`

Port interface. You supply a concrete implementation that wraps your renderer.

```ts
interface IAnimationDriver {
  play(key: string, options: IAnimPlayOptions): void;
  hasAnimation(key: string): boolean;
}

interface IAnimPlayOptions {
  readonly loop:      boolean;
  readonly frameRate: number;
}
```

**Phaser 3 example:**

```ts
import type { IAnimationDriver, IAnimPlayOptions } from '@alife-sdk/ai/animation';

class PhaserAnimDriver implements IAnimationDriver {
  constructor(private sprite: Phaser.GameObjects.Sprite) {}

  play(key: string, opts: IAnimPlayOptions): void {
    this.sprite.play({ key, repeat: opts.loop ? -1 : 0, frameRate: opts.frameRate });
  }

  hasAnimation(key: string): boolean {
    return this.sprite.scene.anims.exists(key);
  }
}
```

---

### `ILayerPriorityMap`

Optional override for layer priority values.
By default, numeric layer values are used: `LEGS=0 < TORSO=1 < HEAD=2`.

```ts
type ILayerPriorityMap = Readonly<Partial<Record<AnimLayer, number>>>;
```

Higher numbers win. Only the layers you specify are overridden.

---

### `IAnimationControllerConfig`

Constructor config object:

```ts
interface IAnimationControllerConfig {
  readonly driver:         IAnimationDriver;
  readonly layerPriority?: ILayerPriorityMap;  // optional, overrides default numeric order
}
```

---

### `AnimationController`

#### Constructor

```ts
import { AnimationController, AnimLayer } from '@alife-sdk/ai/animation';

const ctrl = new AnimationController({ driver });

// With custom layer priorities:
const ctrl = new AnimationController({
  driver,
  layerPriority: {
    [AnimLayer.LEGS]:  10,
    [AnimLayer.TORSO]: 5,
    [AnimLayer.HEAD]:  1,
  },
});
```

---

#### `request(req: IAnimationRequest): boolean`

Request an animation play. Returns `true` if `driver.play()` was called.

**Play happens only when all three conditions are met:**

1. `priority(req.layer) >= priority(currentLayer)` — or no animation is active yet.
2. `req.key !== currentKey` OR `req.layer !== currentLayer` — animation actually changed.
3. `driver.hasAnimation(req.key) === true` — sprite has the animation registered.

```ts
// First call — always plays
ctrl.request({ key: 'idle_rifle_S', loop: true, frameRate: 10, layer: AnimLayer.LEGS });
// → true, driver.play called

// Same call again — debounced
ctrl.request({ key: 'idle_rifle_S', loop: true, frameRate: 10, layer: AnimLayer.LEGS });
// → false, driver.play NOT called

// New key, same layer — plays
ctrl.request({ key: 'walk_rifle_S', loop: true, frameRate: 10, layer: AnimLayer.LEGS });
// → true

// TORSO is active; LEGS request has lower priority — blocked
ctrl.request({ key: 'combat_rifle_S', loop: false, frameRate: 12, layer: AnimLayer.TORSO });
// → true (TORSO > LEGS)
ctrl.request({ key: 'idle_rifle_S', loop: true, frameRate: 10, layer: AnimLayer.LEGS });
// → false (LEGS < TORSO)
```

---

#### `force(req: IAnimationRequest): void`

Force-plays an animation, bypassing debounce and layer priority.
Use for events that must always interrupt the current clip: death, hit
reaction, special monster abilities.

No-ops silently if `driver.hasAnimation()` returns `false`.

```ts
// Death always interrupts, even if a higher-priority TORSO anim is active
ctrl.force({ key: 'death_rifle', loop: false, frameRate: 8, layer: AnimLayer.LEGS });

// Same key — plays anyway (no debounce)
ctrl.force(req); // plays
ctrl.force(req); // plays again
```

---

#### `reset(): void`

Clears `currentKey` and `currentLayer` to `null`.
Call on respawn or when recycling a controller from an object pool.

```ts
ctrl.reset();

// Next request() will play regardless of what was playing before
ctrl.request(idleReq); // → true
```

---

#### `currentKey: string | null`

Read-only. The key of the last animation sent to `driver.play()`, or `null`
if no animation has been played yet (including after `reset()`).

```ts
ctrl.currentKey   // null (before first play)
ctrl.request(req)
ctrl.currentKey   // 'idle_rifle_S'
```

---

#### `currentLayer: AnimLayer | null`

Read-only. The layer of the last played animation, or `null`.

---

## Usage patterns

### Standard NPC update loop

```ts
import {
  getAnimationRequest,
  DirectionCache,
  AnimationController,
  AnimLayer,
} from '@alife-sdk/ai/animation';

// Allocate once per NPC:
const dirCache  = new DirectionCache();
const ctrl      = new AnimationController({ driver: new PhaserAnimDriver(sprite) });

// Each AI tick:
function updateNpcAnimation(npc: INpc): void {
  const req = getAnimationRequest({
    state:          npc.aiState,
    weaponCategory: npc.weaponCategory,
    velocity:       npc.velocity,
    directionCache: dirCache,
  });

  ctrl.request(req);
}
```

### One-shot events (death, hit, abilities)

```ts
import {
  getAnimationRequest,
  AnimationController,
  AnimLayer,
} from '@alife-sdk/ai/animation';

// Wire up to your event system (EventEmitter, Phaser events, custom callbacks, etc.)
// The pattern is the same regardless of the event mechanism:

// On NPC death — force() always interrupts the current animation:
function onNpcDied(npc: INpc, ctrl: AnimationController): void {
  const req = getAnimationRequest({
    state:          'DEAD',
    weaponCategory: npc.weaponCategory,
    velocity:       { x: 0, y: 0 },
  });
  ctrl.force(req);
}

// On special monster ability:
function onPsiAttackStart(ctrl: AnimationController): void {
  ctrl.force({
    key:       'psi_unarmed',
    loop:      false,
    frameRate: 10,
    layer:     AnimLayer.TORSO,
  });
}

// Phaser 3 example wiring:
// scene.events.on('NPC_DIED', (npc) => onNpcDied(npc, ctrl));
// scene.events.on('PSI_ATTACK_START', () => onPsiAttackStart(ctrl));
```

### Object pool (reusing controllers)

```ts
class NpcPool {
  private pool: Array<{ ctrl: AnimationController; dirCache: DirectionCache }> = [];

  acquire(driver: IAnimationDriver) {
    const entry = this.pool.pop() ?? {
      ctrl:     new AnimationController({ driver }),
      dirCache: new DirectionCache(),
    };
    entry.ctrl.reset();      // clear stale state
    entry.dirCache.invalidate();
    return entry;
  }

  release(entry: { ctrl: AnimationController; dirCache: DirectionCache }) {
    this.pool.push(entry);
  }
}
```

### Custom layer priority

Override the default `LEGS < TORSO < HEAD` ordering when your rig has
different priority needs:

```ts
// Make LEGS highest priority (unusual, but supported):
const ctrl = new AnimationController({
  driver,
  layerPriority: {
    [AnimLayer.LEGS]:  10,
    [AnimLayer.TORSO]:  5,
    [AnimLayer.HEAD]:   1,
  },
});

ctrl.request({ key: 'idle_rifle_S',  layer: AnimLayer.LEGS,  ... }); // plays (prio 10)
ctrl.request({ key: 'combat_rifle_S', layer: AnimLayer.TORSO, ... }); // blocked (prio 5 < 10)
```

---

## Decision table for `request()`

| Scenario | Result |
|----------|--------|
| No animation active yet | plays |
| Same key + same layer | skipped (debounce) |
| Different key, same layer | plays |
| New layer has higher priority | plays |
| New layer has same priority | plays |
| New layer has lower priority | skipped |
| `hasAnimation()` returns false | skipped |

`force()` always plays (subject only to `hasAnimation()` check).
