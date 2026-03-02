# cover

Tactical cover system for `@alife-sdk/ai` — finding, reserving, and peeking from world-space cover points.

The module answers one question: **"Where should this NPC go to not get shot?"**
It scores every registered cover point against the current tactical situation,
picks the best one, and reserves it so no other NPC can steal it.

## Components

| File | Purpose |
|------|---------|
| [CoverRegistry.md](CoverRegistry.md) | Main registry — registration, evaluation-based search, occupancy |
| [CoverEvaluators.md](CoverEvaluators.md) | Five scoring strategies: CLOSE, FAR, BALANCED, AMBUSH, SAFE |
| [CoverRecommender.md](CoverRecommender.md) | Pure function: tactical situation → recommended CoverType |
| [CoverLockRegistry.md](CoverLockRegistry.md) | TTL-based reservation preventing two NPCs on one point |
| [LoopholeGenerator.md](LoopholeGenerator.md) | Peek-fire positions generated lazily per cover point |
| [CoverAccessAdapter.md](CoverAccessAdapter.md) | SDK bridge: wires the above into `INPCContext.cover` |

---

## Quick start

```ts
import {
  CoverRegistry,
  CoverLockRegistry,
  CoverAccessAdapter,
} from '@alife-sdk/ai/cover';
import { createDefaultAIConfig } from '@alife-sdk/ai/config';

// ── Step 1: scene-level setup ──────────────────────────────────────────────

const config = createDefaultAIConfig();

// Time source — use your game clock or Date.now for simple cases.
const lockRegistry = new CoverLockRegistry(() => Date.now());

// Pass your seeded IRandom for deterministic loophole generation.
const coverRegistry = new CoverRegistry(config.cover, myRandom, lockRegistry);

// Load cover points from your map/level data.
coverRegistry.addPoints([
  { x: 120, y: 340 },
  { x: 560, y: 200, radius: 32 },
  // ...
]);

// ── Step 2: per-NPC setup (on spawn) ──────────────────────────────────────

// Create one adapter per NPC. It is stateful — do NOT share across NPCs.
const coverAccess = new CoverAccessAdapter(coverRegistry, lockRegistry, npcId);

// Expose via INPCContext so state handlers can reach it.
npc.ctx.cover = coverAccess;

// ── Step 3: inside a state handler (e.g. TakeCoverState) ──────────────────

const result = npc.ctx.cover.findCover(
  npc.x, npc.y,       // NPC position
  enemy.x, enemy.y,   // Threat position
  'balanced',         // CoverType — or omit to use BALANCED default
);

if (result) {
  // Reserve the point before moving — prevents another NPC from taking it.
  npc.ctx.cover.lockLastFound(npcId, 10_000); // 10 s TTL
  npc.moveTo(result.x, result.y);
}

// ── Step 4: cleanup ────────────────────────────────────────────────────────

// On NPC death or despawn — release all locks immediately.
npc.ctx.cover.unlockAll(npcId);

// On scene teardown.
coverRegistry.clear();
```

---

## Data flow

```
Scene setup
  CoverRegistry  ←  addPoints(mapData)
       │
       │  Constructor injects:
       ├── CoverLockRegistry  (TTL reservation per point)
       └── LoopholeGenerator  (lazy peek-fire positions)

Per NPC
  CoverAccessAdapter (registry, lockRegistry, npcId)
       │
       └── attached to INPCContext.cover

State handler (TakeCoverState, RetreatState, …)
  ctx.cover.findCover(x, y, enemyX, enemyY, type?)
       │
       ├── CoverRecommender.recommendCoverType()   ← if using findRecommendedCover
       ├── CoverEvaluator.evaluate(point, context)  ← scores each candidate
       └── CoverLockRegistry.isAvailable(id, npc)   ← filters locked points
       │
       └── returns { x, y } | null

  ctx.cover.lockLastFound(npcId)   ← reserves the chosen point
  ctx.cover.unlockAll(npcId)       ← on death / despawn
```

---

## Cover types

| CoverType | Tactical goal | Typical use |
|-----------|--------------|-------------|
| `'close'` | Closest available — get behind something NOW | Critical HP |
| `'far'` | Maximize distance from enemies | Retreat, demoralization |
| `'balanced'` | Weighted mix: proximity + safety + angle | Default |
| `'ambush'` | Flanking angle on enemy, offensive posture | Healthy, few enemies |
| `'safe'` | Minimize aggregate threat from all visible enemies | Outnumbered, no ammo |
| `'best'` | _(deprecated)_ — alias for `'balanced'` | Use `'balanced'` instead |

Use `recommendCoverType(situation, config)` to pick the type automatically from
the NPC's HP ratio, morale, enemy count, and ammo state.

---

## Architectural notes

- **Instance-based** — `CoverRegistry` and `CoverLockRegistry` are not singletons.
  Create one per scene (or per simulation) and inject them via constructor.

- **Strategy pattern** — evaluators are interchangeable. `createCoverEvaluators(config)`
  builds the full set; you can replace individual entries for custom behavior.

- **Lock vs. occupy** — `CoverLockRegistry` (TTL-based, recommended) and the legacy
  `occupy`/`release` mutable flag coexist. When a lock registry is provided to
  `CoverRegistry`, it uses TTL locks for the availability filter; otherwise it falls
  back to `occupiedBy`. Prefer the lock registry in all new integrations.

- **Determinism** — `LoopholeGenerator` requires an `IRandom` port. Passing a seeded
  instance gives deterministic peek positions across saves and replays.
