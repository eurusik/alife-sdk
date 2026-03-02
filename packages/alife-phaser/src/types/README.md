# types

Duck-typed Phaser interfaces and online/offline switching configuration.

```ts
import type { IArcadeSprite, IArcadeBody, IArcadeAnims } from '@alife-sdk/phaser/types';
import type {
  IOnlineOfflineConfig,
  IOnlineRecord,
  SquadResolver,
  ITransitionResult,
} from '@alife-sdk/phaser/types';
import { createDefaultOnlineOfflineConfig } from '@alife-sdk/phaser/types';
```

---

## What's in this module

| Export | Kind | What it does |
|--------|------|-------------|
| `IArcadeSprite` | interface | Duck-typed `Phaser.Physics.Arcade.Sprite` subset |
| `IArcadeBody` | interface | Duck-typed `Phaser.Physics.Arcade.Body` subset |
| `IArcadeAnims` | interface | Duck-typed sprite `.anims` property |
| `IOnlineOfflineConfig` | interface | Hysteresis thresholds for online/offline switching |
| `IOnlineRecord` | interface | NPC record shape used by `OnlineOfflineManager` |
| `SquadResolver` | type | `(npcId) => string[] \| null` squad membership lookup |
| `ITransitionResult` | interface | `{ goOnline, goOffline }` returned by evaluation passes |
| `createDefaultOnlineOfflineConfig` | function | Merges partial overrides with defaults |

---

## Phaser type interfaces

These interfaces match the structural shape of Phaser 3 objects so the SDK
never imports Phaser at compile time. Any real `Phaser.Physics.Arcade.Sprite`
satisfies them; in tests, plain objects with the same members work too.

### IArcadeSprite

Primary sprite interface used by `PhaserEntityAdapter`.

```ts
interface IArcadeSprite {
  x: number; y: number;
  active: boolean; visible: boolean;
  body: IArcadeBody | null;
  name: string; rotation: number; alpha: number;
  anims?: IArcadeAnims;
  setActive(v: boolean): unknown;
  setVisible(v: boolean): unknown;
  setPosition(x: number, y?: number): unknown;
  setVelocity(x: number, y?: number): unknown;
  setAlpha(v: number): unknown;
  setRotation(r: number): unknown;
  destroy(): void;
}
```

### IArcadeBody

Minimal physics body subset read by `getVelocity` and zeroed on `teleport`.

```ts
interface IArcadeBody {
  enable: boolean;
  velocity: { x: number; y: number };
}
```

### IArcadeAnims

Minimal animation manager: `play(key, ignoreIfPlaying?)` and `getName()`.
`PhaserEntityAdapter.hasAnimation()` also duck-checks for an optional
`exists(key)` method when available.

---

## IOnlineOfflineConfig

```ts
interface IOnlineOfflineConfig {
  /** Base switch distance (px). Default: 700 */
  switchDistance: number;
  /** Hysteresis factor 0–1. Default: 0.15 */
  hysteresisFactor: number;
}
```

`OnlineOfflineManager` derives two thresholds from these values:

```
onlineThreshold  = switchDistance × (1 − hysteresisFactor)   // default ≈ 595 px
offlineThreshold = switchDistance × (1 + hysteresisFactor)   // default ≈ 805 px
```

NPCs inside the dead zone (between the two thresholds) maintain their current
state — no transition is emitted.

### createDefaultOnlineOfflineConfig

```ts
const config = createDefaultOnlineOfflineConfig({
  switchDistance: 500,  // only override what you need
});
// → { switchDistance: 500, hysteresisFactor: 0.15 }
```

---

## IOnlineRecord

Read-only per-NPC snapshot evaluated each pass:

```ts
interface IOnlineRecord {
  readonly entityId: string;
  readonly x: number;
  readonly y: number;
  readonly isOnline: boolean;
  readonly isAlive: boolean;
}
```

The manager reads these but **never mutates them** — the caller applies
transitions received in `ITransitionResult`.

---

## SquadResolver

```ts
type SquadResolver = (npcId: string) => readonly string[] | null;
```

If the NPC belongs to a squad, return the full member ID array (including the
queried NPC itself) to enable atomic squad switching. Return `null` for solo
NPCs.
