# AnimationSelector

Pure state → animation key resolver.
No framework dependencies — only string and number operations.

**Source:** [AnimationSelector.ts](AnimationSelector.ts)

---

## Overview

`AnimationSelector` converts three inputs — AI **state**, **weapon category**,
and movement **velocity** — into an animation key string that matches your
sprite-sheet naming convention.

Key format: `{base}_{weapon}_{direction}` (or `{base}_{weapon}` when direction
is not meaningful, e.g. death / sleep).

```
'PATROL' + RIFLE + vx=100,vy=0  →  'walk_rifle_E'
'DEAD'   + RIFLE + any velocity  →  'death_rifle'
'COMBAT' + SHOTGUN + vx=0,vy=50 →  'combat_shotgun_S'
```

---

## Sprite naming convention

`AnimationSelector` generates keys — it does **not** load or register anything.
Your renderer must have animations pre-registered under the exact names the
selector produces.

The naming pattern is:

```
{base}_{weapon}_{direction}   ← most states
{base}_{weapon}               ← states with omitDirection: true (DEAD, SLEEP, GRENADE, PSI_ATTACK)
```

For example, an NPC with a rifle needs these animation keys registered:

```
idle_rifle_N    idle_rifle_NE   idle_rifle_E    idle_rifle_SE
idle_rifle_S    idle_rifle_SW   idle_rifle_W    idle_rifle_NW

walk_rifle_N    walk_rifle_NE   ...  (×8)
combat_rifle_N  combat_rifle_NE ...  (×8)
death_rifle                         (no direction suffix)
throw_rifle                         (no direction suffix)
...
```

If an animation key is missing from the renderer, `AnimationController.request()`
silently skips the play call (because `driver.hasAnimation()` returns `false`).
**This is a common source of invisible bugs during integration** — if nothing
plays, check that the key your renderer has registered matches exactly what
`getAnimationKey()` returns.

A quick debug check:

```ts
const req = getAnimationRequest({ state: npc.aiState, weaponCategory: npc.weaponCategory, velocity: npc.velocity });
console.log(req.key);  // print the expected key, compare with your atlas
```

---

## API reference

### `CompassIndex`

8-way directional enum, indexed clockwise from North:

```ts
CompassIndex.N   // 0
CompassIndex.NE  // 1
CompassIndex.E   // 2
CompassIndex.SE  // 3
CompassIndex.S   // 4  (default — rest facing)
CompassIndex.SW  // 5
CompassIndex.W   // 6
CompassIndex.NW  // 7
```

---

### `AnimLayer`

Sprite layer for multi-layer character rigs:

```ts
AnimLayer.LEGS   // 0 — walking, running, crouching
AnimLayer.TORSO  // 1 — combat, weapon handling
AnimLayer.HEAD   // 2 — facial / head animations
```

Used by `AnimationController` to resolve layer priority.

---

### `IAnimDescriptor`

Describes how a named AI state maps to an animation clip:

```ts
interface IAnimDescriptor {
  readonly base:          string;    // base name, e.g. 'walk', 'death'
  readonly loop:          boolean;   // true = looping, false = one-shot
  readonly frameRate:     number;    // playback speed
  readonly layer:         AnimLayer; // which sprite layer plays this clip
  readonly omitDirection: boolean;   // true = skip direction suffix (death, sleep…)
}
```

---

### `IAnimationRequest`

Resolved animation ready for the renderer:

```ts
interface IAnimationRequest {
  readonly key:       string;    // full animation key, e.g. 'walk_rifle_E'
  readonly loop:      boolean;
  readonly frameRate: number;
  readonly layer:     AnimLayer;
}
```

---

### `DEFAULT_STATE_ANIM_MAP`

Built-in mapping for all standard NPC + monster AI states:

| State | Base | Loop | FPS | Layer | No direction |
|-------|------|------|-----|-------|:---:|
| `IDLE` | `idle` | ✓ | 10 | LEGS | |
| `PATROL` | `walk` | ✓ | 10 | LEGS | |
| `ALERT` | `walk_alert` | ✓ | 10 | LEGS | |
| `COMBAT` | `combat` | | 12 | TORSO | |
| `TAKE_COVER` | `crouch` | ✓ | 10 | LEGS | |
| `SEARCH` | `walk_search` | ✓ | 10 | LEGS | |
| `FLEE` | `run` | ✓ | 14 | LEGS | |
| `DEAD` | `death` | | 8 | LEGS | ✓ |
| `GRENADE` | `throw` | | 10 | TORSO | ✓ |
| `EVADE_GRENADE` | `sprint` | ✓ | 14 | LEGS | |
| `WOUNDED` | `crawl` | ✓ | 6 | LEGS | |
| `RETREAT` | `run_fire` | ✓ | 14 | LEGS | |
| `CAMP` | `idle` | ✓ | 10 | LEGS | |
| `SLEEP` | `sleep` | ✓ | 4 | LEGS | ✓ |
| `CHARGE` | `charge` | | 14 | LEGS | |
| `STALK` | `stalk` | ✓ | 8 | LEGS | |
| `LEAP` | `leap` | | 14 | LEGS | |
| `PSI_ATTACK` | `psi` | | 10 | TORSO | ✓ |

---

### `DEFAULT_WEAPON_SUFFIXES`

Maps `WeaponCategory` values to animation suffix strings.
Import `WeaponCategory` from `@alife-sdk/ai/types`:

```ts
import { WeaponCategory } from '@alife-sdk/ai/types';

// WeaponCategory values:
WeaponCategory.PISTOL   // 0
WeaponCategory.SHOTGUN  // 1
WeaponCategory.RIFLE    // 2
WeaponCategory.SNIPER   // 3
WeaponCategory.GRENADE  // 4
WeaponCategory.MEDKIT   // 5
```

| `WeaponCategory` | Numeric value | Animation suffix |
|------------------|:---:|---------|
| `PISTOL` | `0` | `pistol` |
| `SHOTGUN` | `1` | `shotgun` |
| `RIFLE` | `2` | `rifle` |
| `SNIPER` | `3` | `sniper` |
| `GRENADE` | `4` | `unarmed` |
| `MEDKIT` | `5` | `unarmed` |

Unknown categories fall back to `'rifle'`. The type is open (`number | string`) so custom string
categories are also supported — see custom `weaponSuffixes` examples below.

---

### `getDirection(vx, vy): CompassIndex`

Converts a velocity vector to an 8-way compass direction.
Zero or near-zero velocity returns `CompassIndex.S` (south / rest facing).

```ts
getDirection(100, 0)    // E
getDirection(-100, 0)   // W
getDirection(0, -100)   // N  (negative Y = up in screen space)
getDirection(0, 100)    // S
getDirection(100, -100) // NE
```

---

### `getAnimationKey(state, weaponType, direction, animMap?, weaponSuffixes?): string`

Low-level key builder. Prefer `getAnimationRequest()` unless you only need the key string.

```ts
import { getAnimationKey, CompassIndex } from '@alife-sdk/ai/animation';
import { WeaponCategory } from '@alife-sdk/ai/types';

getAnimationKey('PATROL',  WeaponCategory.RIFLE,   CompassIndex.E)  // 'walk_rifle_E'
getAnimationKey('DEAD',    WeaponCategory.RIFLE,   CompassIndex.E)  // 'death_rifle'
getAnimationKey('COMBAT',  WeaponCategory.SHOTGUN, CompassIndex.NW) // 'combat_shotgun_NW'
getAnimationKey('WOUNDED', WeaponCategory.PISTOL,  CompassIndex.SE) // 'crawl_pistol_SE'
```

**Custom maps:**

> **Important:** a custom `animMap` **replaces** `DEFAULT_STATE_ANIM_MAP` entirely — it does
> not merge with it. Standard states like `PATROL` or `IDLE` will fall back to `idle` if they
> are missing from your map. To extend the defaults, spread them explicitly:
> ```ts
> import { DEFAULT_STATE_ANIM_MAP } from '@alife-sdk/ai/animation';
> const myMap = { ...DEFAULT_STATE_ANIM_MAP, FORAGE: { ... } };
> ```

```ts
const myMap = {
  FORAGE: { base: 'forage', loop: true, frameRate: 6, layer: AnimLayer.LEGS, omitDirection: false },
};

getAnimationKey('FORAGE', WeaponCategory.RIFLE, CompassIndex.E, myMap) // 'forage_rifle_E'
getAnimationKey('PATROL', WeaponCategory.RIFLE, CompassIndex.E, myMap) // 'idle_rifle_E'  ← fallback!
```

**Custom weapon suffixes:**

```ts
const mySuffixes = { 'laser': 'laser_gun' };

getAnimationKey('IDLE', 'laser', CompassIndex.S, undefined, mySuffixes) // 'idle_laser_gun_S'
```

---

### `DirectionCache`

Per-entity direction cache. Avoids calling `atan2` every tick when velocity
barely changes. Allocate **one instance per NPC** and pass it into
`getAnimationRequest()`.

```ts
const cache = new DirectionCache();

// frame 1 — atan2 called, result cached
cache.resolve(100, 0)  // CompassIndex.E

// frame 2 — velocity changed < 2px/s; cache hit, atan2 skipped
cache.resolve(100.5, 0)  // CompassIndex.E  (fast path)

// After teleport or spawn — invalidate so next resolve recomputes
cache.invalidate()
```

---

### `getAnimationRequest(input): IAnimationRequest`

Main entry point. Groups all parameters into a single `IAnimationInput` object
and returns a complete `IAnimationRequest` ready to pass to `AnimationController`.

```ts
interface IAnimationInput {
  state:           string;
  weaponCategory:  number | string;
  velocity:        { x: number; y: number };
  animMap?:        Readonly<Record<string, IAnimDescriptor>>;   // optional custom map
  weaponSuffixes?: Readonly<Record<string, string>>;             // optional custom suffixes
  directionCache?: DirectionCache;                               // recommended per-NPC
}
```

**Basic usage:**

```ts
import { getAnimationRequest } from '@alife-sdk/ai/animation';
import { WeaponCategory } from '@alife-sdk/ai/types';

const req = getAnimationRequest({
  state:          'PATROL',
  weaponCategory: WeaponCategory.RIFLE,
  velocity:       { x: 100, y: 0 },
});

// req.key       = 'walk_rifle_E'
// req.loop      = true
// req.frameRate = 10
// req.layer     = AnimLayer.LEGS
```

**With `DirectionCache` (recommended for every NPC):**

```ts
const cache = new DirectionCache();

// In the update loop:
const req = getAnimationRequest({
  state:          npc.state,
  weaponCategory: npc.weaponCategory,
  velocity:       npc.velocity,
  directionCache: cache,
});
```

**With custom state map (e.g. animals or custom creatures):**

```ts
const animalMap = {
  GRAZE: { base: 'graze', loop: true, frameRate: 6, layer: AnimLayer.LEGS, omitDirection: false },
  FLEE:  { base: 'gallop', loop: true, frameRate: 16, layer: AnimLayer.LEGS, omitDirection: false },
};

// For creatures without weapons, use omitDirection or a dedicated suffix.
// Do NOT pass an empty string suffix — it produces double underscores ('graze__S').
// Instead, set omitDirection: true or use a meaningful suffix like 'bare':
const req = getAnimationRequest({
  state:          'GRAZE',
  weaponCategory: 'bare',
  velocity:       { x: 0, y: 0 },
  animMap:        animalMap,
  weaponSuffixes: { bare: 'bare' },  // → 'graze_bare_S'
});
```

---

## Performance notes

- **Pre-built LUT** — when using the default `animMap` and `weaponSuffixes`,
  `getAnimationKey()` hits a pre-computed `Map<string, string>` at O(1) with
  no string concatenation at runtime.
- **`DirectionCache`** — the squared-magnitude epsilon check costs ~5 ns and
  prevents `Math.atan2` + quantization (~30 ns) on most frames.
- Both optimisations are transparent: the API is identical with or without them.
