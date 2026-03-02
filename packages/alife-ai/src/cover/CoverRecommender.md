# CoverRecommender

Pure decision function: tactical situation → recommended `CoverType`.

No state, no side effects — easy to unit test and easy to replace.

```ts
import { recommendCoverType } from '@alife-sdk/ai/cover';
import type { ICoverSituation } from '@alife-sdk/ai/cover';
```

---

## `recommendCoverType(situation, config): CoverType`

Evaluates the NPC's current tactical state and returns the most appropriate
`CoverType` to pass to `CoverRegistry.findCover`.

```ts
const type = recommendCoverType(
  { hpRatio: 0.15, morale: -0.2, enemyCount: 2, hasAmmo: true },
  config.cover,
);
// → 'close'  (hp 0.15 ≤ critical threshold 0.2)

const cover = registry.findCover(type, npcPos, enemies, npcId);
```

Or use `CoverRegistry.findRecommendedCover()` to do both in one call.

---

## ICoverSituation

```ts
interface ICoverSituation {
  readonly hpRatio: number;     // Current HP / max HP — range [0, 1]
  readonly morale: number;      // Current morale — range [-1, 1]
  readonly enemyCount: number;  // Number of known active enemies
  readonly hasAmmo: boolean;    // Whether the NPC has usable ammunition
}
```

All four fields are read by the decision tree. None are optional.

---

## Decision tree

Rules are evaluated in priority order — the first match wins.

```
1. hasAmmo = false
       → SAFE   (no point being offensive without ammo)

2. hpRatio ≤ recommendHpCritical  (default 0.2)
       → CLOSE  (get behind something immediately)

3. morale ≤ recommendMoraleDemoralized  (default -0.5)
       → FAR    (distance provides psychological recovery)

4. enemyCount ≥ recommendOutnumberedCount  (default 3)
       → SAFE   (minimize aggregate exposure to multiple threats)

5. hpRatio ≥ recommendHpHealthy (default 0.6) AND enemyCount ≤ 2
       → AMBUSH (take the initiative — healthy, few enemies)

6. (default)
       → BALANCED
```

---

## Config thresholds (from `ICoverConfig`)

| Config key | Default | Controls |
|-----------|---------|---------|
| `recommendHpCritical` | `0.2` | Rule 2 — HP below this → CLOSE |
| `recommendHpHealthy` | `0.6` | Rule 5 — HP above this (with ≤2 enemies) → AMBUSH |
| `recommendMoraleDemoralized` | `-0.5` | Rule 3 — Morale below this → FAR |
| `recommendOutnumberedCount` | `3` | Rule 4 — Enemy count at or above this → SAFE |

Override any threshold via `createDefaultAIConfig({ cover: { recommendHpCritical: 0.3 } })`.

---

## Example mappings

| hpRatio | morale | enemies | hasAmmo | Result |
|---------|--------|---------|---------|--------|
| 0.15 | 0.5 | 1 | true | **CLOSE** (hp critical) |
| 0.5 | -0.6 | 2 | true | **FAR** (demoralized) |
| 0.5 | 0.2 | 4 | true | **SAFE** (outnumbered) |
| 0.8 | 0.4 | 1 | true | **AMBUSH** (healthy + few enemies) |
| 0.5 | 0.2 | 2 | false | **SAFE** (no ammo) |
| 0.4 | 0.0 | 2 | true | **BALANCED** (no special condition) |
