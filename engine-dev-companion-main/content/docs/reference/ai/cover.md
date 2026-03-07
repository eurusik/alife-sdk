# AI Cover

Use this page when online NPCs need believable cover selection instead of running straight through open fire.

The cover module is a shared scene subsystem plus a per-NPC access layer. That split is the most important thing to understand before integrating it.

## Import path

```ts
import {
  CoverRegistry,
  CoverLockRegistry,
  CoverAccessAdapter,
} from "@alife-sdk/ai/cover";
```

## Minimal setup

```ts
const lockRegistry = new CoverLockRegistry(() => Date.now());
const coverRegistry = new CoverRegistry(aiConfig.cover, random, lockRegistry);

coverRegistry.addPoints([
  { x: 120, y: 340 },
  { x: 560, y: 200, radius: 32 },
]);
```

### Per-NPC setup

```ts
const coverAccess = new CoverAccessAdapter(coverRegistry, lockRegistry, npcId);

npcContext.cover = coverAccess;
```

### Usage in a state

```ts
const result = npcContext.cover.findCover(
  npc.x,
  npc.y,
  enemy.x,
  enemy.y,
  "balanced",
);

if (result) {
  npcContext.cover.lockLastFound(npcId, 10_000);
  npc.moveTo(result.x, result.y);
}
```

And on despawn or death:

```ts
npcContext.cover.unlockAll(npcId);
```

## Ownership model

| Layer | What it owns |
|---|---|
| `CoverRegistry` | known cover points and candidate evaluation |
| `CoverLockRegistry` | temporary reservation so multiple NPCs do not pile onto one point |
| `CoverAccessAdapter` | one NPC's access to the shared cover system |

Practical rule:

create one registry per scene, but one access adapter per NPC.

## Cover types

The module supports different tactical goals:

- `close`
- `far`
- `balanced`
- `ambush`
- `safe`

That means cover choice is not only geometry. It is also tactical policy.

## Lifecycle

The healthy order is:

1. load cover points during scene setup
2. keep one shared registry and one shared lock registry for the scene
3. create one `CoverAccessAdapter` for each NPC that can use online AI
4. let cover states query and lock the chosen point
5. release locks on despawn, death, or teardown

## Debugging signals

The first things worth checking are:

- how many cover points were registered
- whether a candidate exists but is rejected by score or availability
- whether a dead or despawned NPC still holds a lock
- whether the tactical mode is asking for the wrong cover type

## Failure patterns

- no cover points were loaded into the registry
- one `CoverAccessAdapter` instance is accidentally shared across multiple NPCs
- chosen points are never locked, so several NPCs collapse into one spot
- locks are never released on despawn or death
- teams try to debug cover geometry when the real issue is wrong tactical mode selection

## Related pages

- [AI package](/docs/packages/ai)
- [AI States and Driver](/docs/reference/ai/states)
- [AI Perception](/docs/reference/ai/perception)
