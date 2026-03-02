# animation

Framework-agnostic NPC animation pipeline for `@alife-sdk/ai`.

Converts AI state machine output (current state + weapon + velocity) into
animation keys and play commands that any renderer can consume via a thin
driver port.

## Modules

| File | Purpose |
|------|---------|
| [AnimationSelector.md](AnimationSelector.md) | Pure state → key resolution: direction math, key building, `DirectionCache` |
| [AnimationController.md](AnimationController.md) | Stateful per-entity controller: debounce, layer priority, `force()` |

## Quick example

```ts
import {
  getAnimationRequest,
  DirectionCache,
  AnimationController,
} from '@alife-sdk/ai/animation';
import type { IAnimationDriver, IAnimPlayOptions } from '@alife-sdk/ai/animation';

// 1. Implement IAnimationDriver for your renderer (example: Phaser 3)
const driver: IAnimationDriver = {
  play(key: string, opts: IAnimPlayOptions) {
    sprite.play({ key, repeat: opts.loop ? -1 : 0, frameRate: opts.frameRate });
  },
  hasAnimation(key: string) {
    return sprite.scene.anims.exists(key);
  },
};

// 2. One cache and one controller per NPC entity:
const dirCache = new DirectionCache();
const ctrl = new AnimationController({ driver });

// 3. Every AI tick:
const req = getAnimationRequest({
  state:          npc.aiState,          // e.g. 'PATROL'
  weaponCategory: npc.weaponCategory,   // e.g. WeaponCategory.RIFLE (= 2)
  velocity:       npc.velocity,         // { x, y }
  directionCache: dirCache,
});

ctrl.request(req);   // no-ops if key/layer unchanged
```

## Data flow

```
AI state + weapon + velocity
        │
        ▼
  AnimationSelector
  ┌─────────────────────────┐
  │ getDirection()          │  velocity → CompassIndex (N/NE/E/…)
  │ getAnimationKey()       │  state + weapon + dir → 'walk_rifle_E'
  │ getAnimationRequest()   │  → IAnimationRequest { key, loop, frameRate, layer }
  └─────────────────────────┘
        │
        ▼
  AnimationController
  ┌─────────────────────────┐
  │ request()  debounced    │  skips if same key+layer or lower-priority layer active
  │ force()    always plays │  death / hit-reaction / special abilities
  └─────────────────────────┘
        │
        ▼
  IAnimationDriver  (injected by host)
  driver.play(key, { loop, frameRate })
```

## Sprite naming requirement

The pipeline generates animation key strings — it does **not** register or load
sprites. Your renderer (Phaser, Pixi, etc.) must have animations pre-registered
under the exact names produced by `getAnimationKey()`.

Pattern: `{base}_{weapon}_{direction}` → e.g. `walk_rifle_E`, `combat_shotgun_NW`
Direction-less states: `{base}_{weapon}` → e.g. `death_rifle`, `sleep_pistol`

If a key is missing, `AnimationController.request()` silently no-ops.
See [AnimationSelector.md — Sprite naming convention](AnimationSelector.md#sprite-naming-convention) for the full list.

## Design notes

- **Zero framework dependencies** — no Phaser, no Pixi. All renderer coupling
  lives in the `IAnimationDriver` port you supply.
- **Extensible** — pass custom `animMap` / `weaponSuffixes` to override or
  extend the default NPC state set without forking the package.
- **Performance** — a pre-built LUT covers the default maps (O(1) key lookup);
  `DirectionCache` avoids `atan2` when velocity barely changes.
