# `@alife-sdk/ai` — eat-corpse state

Optional, opt-in state module that gives predatory NPCs the ability to
approach and consume nearby corpses for HP and morale rewards.

**This module is never imported by `buildDefaultHandlerMap` or
`buildMonsterHandlerMap`.** It has zero bundle cost for projects that do not
use it.

**Import path:** `@alife-sdk/ai/states/eat-corpse`

---

## What it does

When an NPC enters the `EAT_CORPSE` state it runs a three-phase cycle:

1. **APPROACH** — NPC moves toward the nearest corpse within `searchRadius`.
2. **EATING** — NPC halts at the corpse and waits for `eatDurationMs`.
3. **DONE** — HP is restored by `healAmount`, morale is boosted by `moraleBoost`, and `consumeCorpse()` is called on the host.

Transitions out of the state:

| Condition | Default target state |
|---|---|
| Eating completed | `eatCorpseOnDone` (default `'IDLE'`) |
| No corpse found in radius | `eatCorpseOnNoCorpse` (default `'IDLE'`) |
| Enemy spotted during approach or eating | `eatCorpseOnInterrupt` (default `'ALERT'`) |

---

## Exports

| Export | Kind | Description |
|---|---|---|
| `EatCorpseState` | class | Stateless `IOnlineStateHandler` implementation. One instance can be shared across all NPC entities. |
| `withEatCorpseGuard` | function | Decorator that wraps a calm-state handler (IDLE, PATROL, etc.) with a periodic hunger check. Triggers `EAT_CORPSE` when HP is low and corpses are nearby. |
| `ICorpseRecord` | interface | Single corpse available for consumption: `id`, `x`, `y`, `healAmount`, optional `corpseType` tag. |
| `ICorpseSource` | interface | Host-implemented port: `findCorpses(npcId, x, y, radius)` and `consumeCorpse(npcId, corpseId)`. |
| `IEatCorpseConfig` | interface | Tuning for `EatCorpseState`: `searchRadius`, `eatDurationMs`, `approachSpeed`, `arriveThreshold`, `moraleBoost`. |
| `IEatCorpseGuardConfig` | interface | Tuning for `withEatCorpseGuard`: `checkIntervalMs`, `hungerHpThreshold`, `eatProbability`, `searchRadius`, `eatStateId`, `allowedEntityTypes`. |
| `createDefaultEatCorpseConfig` | function | Returns `IEatCorpseConfig` with defaults, optionally overridden. |
| `createDefaultEatCorpseGuardConfig` | function | Returns `IEatCorpseGuardConfig` with defaults, optionally overridden. |
| `IEatCorpsePhase` | interface | Per-NPC runtime phase bag stored on `ctx.state.eatCorpsePhase`. Managed internally by `EatCorpseState`. |

---

## Implementing `ICorpseSource`

The host provides corpse discovery and removal. The SDK never stores corpse records.

```ts
import type { ICorpseSource } from '@alife-sdk/ai/states/eat-corpse';

const corpseSource: ICorpseSource = {
  findCorpses(npcId, x, y, radius) {
    return spatialGrid.query(x, y, radius)
      .filter(e => e.type === 'corpse')
      .map(e => ({ id: e.id, x: e.x, y: e.y, healAmount: 20 }));
  },
  consumeCorpse(_npcId, corpseId) {
    const entity = scene.getEntityById(corpseId);
    if (!entity) return false; // already consumed (race or despawn)
    entity.destroy();
    return true;
  },
};
```

---

## Registering `EatCorpseState`

```ts
import {
  EatCorpseState,
  withEatCorpseGuard,
} from '@alife-sdk/ai/states/eat-corpse';
import { buildMonsterHandlerMap } from '@alife-sdk/ai';

// 1. Build the default handler map, routing post-kill idle to EAT_CORPSE:
const handlers = buildMonsterHandlerMap(cfg, {
  monsterOnNoEnemy: 'EAT_CORPSE',
  eatCorpseOnNoCorpse: 'IDLE',
  eatCorpseOnDone: 'IDLE',
  eatCorpseOnInterrupt: 'ALERT',
});

// 2. Register the state handler:
handlers.set('EAT_CORPSE', new EatCorpseState(cfg, undefined, corpseSource));

// 3. Optionally wrap IDLE/PATROL so dogs and boars seek food while calm:
handlers.set('IDLE',
  withEatCorpseGuard(handlers.get('IDLE')!, corpseSource, {
    allowedEntityTypes: ['dog', 'boar'],
    hungerHpThreshold: 0.7,
    eatProbability: 0.4,
  })
);
```

---

## Default config values

`createDefaultEatCorpseConfig()`:

| Field | Default |
|---|---|
| `searchRadius` | `250` px |
| `eatDurationMs` | `4 000` ms |
| `arriveThreshold` | `24` px |
| `moraleBoost` | `0.15` |

`createDefaultEatCorpseGuardConfig()`:

| Field | Default |
|---|---|
| `checkIntervalMs` | `5 000` ms |
| `hungerHpThreshold` | `0.7` |
| `eatProbability` | `0.4` |
| `searchRadius` | `250` px |
| `eatStateId` | `'EAT_CORPSE'` |
| `allowedEntityTypes` | `null` (all types) |
