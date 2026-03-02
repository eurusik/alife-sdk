# CoverEvaluators

Five tactical cover evaluators implementing the Strategy pattern.
Each evaluator scores every candidate cover point in **[0, 1]** for a specific
tactical priority. Higher score = better cover for that priority.

All evaluators are **pure functions** — no state, no side effects, fully deterministic.

```ts
import {
  CloseCoverEvaluator,
  FarCoverEvaluator,
  BalancedCoverEvaluator,
  AmbushCoverEvaluator,
  SafeCoverEvaluator,
  createCoverEvaluators,
} from '@alife-sdk/ai/cover';
```

---

## Factory

### `createCoverEvaluators(config): ReadonlyMap<CoverType, ICoverEvaluator>`

Creates all five evaluators keyed by `CoverType`. This is how `CoverRegistry`
builds its internal evaluator map — you normally don't need to call this directly.

```ts
const evaluators = createCoverEvaluators(config.cover);
const evaluator = evaluators.get(CoverType.AMBUSH);
const score = evaluator.evaluate(point, context);
```

To replace a single evaluator with a custom one, build the map yourself
and pass a subclass of `CoverRegistry` that overrides the constructor.

---

## ICoverEvaluator interface

```ts
interface ICoverEvaluator {
  readonly type: string;  // CoverType string value
  evaluate(point: ICoverPoint, context: ICoverEvalContext): number;
}
```

`ICoverEvalContext` carries everything an evaluator needs:

```ts
interface ICoverEvalContext {
  readonly npcPosition: Vec2;                   // NPC seeking cover
  readonly enemies: readonly IEnemyPosition[];  // Known enemy positions (IEnemyPosition = Vec2)
  readonly maxRadiusSq: number;                 // Search radius squared (pre-filter)
}
```

---

## Evaluators

### CLOSE — `CloseCoverEvaluator`

**Goal:** Get behind cover as fast as possible. Prioritizes proximity to the NPC.

**Scoring formula:**

```
ratio = dist(npc, point) / closeMaxRange

if ratio ≤ 1.0:  score = 1.0 - ratio         // closer = better, 1.0 at dist 0
if ratio > 1.0:  score = 1.0 - (ratio - 1.0) // linear decay past max range
                 (clamped to 0 at 2× maxRange)
```

**When to use:** Critical HP — the NPC needs shelter immediately, proximity beats
everything else.

**Config keys:** `closeMaxRange` (default `200` px).

---

### FAR — `FarCoverEvaluator`

**Goal:** Maximize distance from enemies. Strategic retreat.

**Scoring formula:**

```
avgEnemyDist = average Euclidean distance from point to all enemies
score = clamp01(avgEnemyDist / farMaxRange)
```

Score is `1.0` when the cover point is `farMaxRange` or further from enemies,
`0.0` when adjacent.

Returns `0.5` if no enemies are visible (neutral — neither good nor bad).

**When to use:** Demoralized NPCs, strategic withdrawal, buying time to reload.

**Config keys:** `farMaxRange` (default `600` px).

---

### BALANCED — `BalancedCoverEvaluator`

**Goal:** Balanced tactical position — not too close, not too far, good angle.

**Scoring formula (three factors, each max 30 points):**

| Factor | Formula | Max |
|--------|---------|-----|
| Proximity to NPC | `clamp01(1 - distNpcToCover / 400) × 30` | 30 |
| Safety from enemies | `clamp01(avgEnemyDist / 600) × 30` | 30 |
| Angle quality | `clamp01(1 - angleDelta / π) × 30` | 30 |

Angle quality peaks when the cover point lies between the NPC and the enemy centroid.

Final score: `(proximity + safety + angle) / 90` → `[0, 1]`.

**When to use:** Default choice when no specific situation applies.

**Config keys:** None — constants (400, 600) are baked into the evaluator.

> **Note:** `BestCoverEvaluator` is a deprecated class alias for `BalancedCoverEvaluator`.
> `CoverType.BEST` (`'balanced'`) is also deprecated — use `CoverType.BALANCED` instead.

---

### AMBUSH — `AmbushCoverEvaluator`

**Goal:** Flanking position — good angle on the enemy for offensive engagement.

**Scoring logic:**

1. Distance from cover to enemy centroid must be within `[ambushMinDist, ambushMaxDist]`.
   Outside this band: score ≤ 0.2.

2. Flanking angle = angle between (enemy→NPC) and (enemy→cover).
   Best flanking band: `[ambushMinAngle, ambushMaxAngle]` (default 60°–120°).

   - In band: `score = 0.7 + distScore × 0.3` (0.7–1.0)
   - Outside band: `score = 0.5 × (1 - deviation)` (0–0.5)

**When to use:** Healthy NPCs, 1–2 enemies — take the initiative.

**Config keys:** `ambushMinAngle` (π/3), `ambushMaxAngle` (2π/3),
`ambushMinDist` (100 px), `ambushMaxDist` (300 px).

---

### SAFE — `SafeCoverEvaluator`

**Goal:** Minimize aggregate threat. Maximum safety from all visible enemies.

**Scoring formula:**

```
threatSum = Σ (1 / max(1, distSq(point, enemy)))  for each enemy
score = 1.0 - clamp01(threatSum × 5000)
```

Each enemy contributes inverse-squared threat. The `5000` normalizer is
empirically tuned for typical distances (>10 px per enemy = negligible threat).

Returns `1.0` when no enemies are visible (safest possible).

**When to use:** Outnumbered situations, no ammo, heavy fire from multiple directions.

**Config keys:** None — constants are baked into the evaluator.

---

## Choosing an evaluator

```
Situation                            → Evaluator
─────────────────────────────────────────────────
HP < 20%, need immediate cover       → CLOSE
Retreating, need distance            → FAR
Standard combat positioning          → BALANCED (default)
Healthy, 1-2 enemies, attacking      → AMBUSH
Outnumbered, no ammo, high threat    → SAFE
```

Or let `recommendCoverType()` decide automatically — see [CoverRecommender.md](CoverRecommender.md).
