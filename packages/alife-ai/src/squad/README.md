# squad

Squad coordination utilities for the `@alife-sdk/ai` subsystem.

Two tools:

| Export | What it does |
|--------|-------------|
| `evaluateSituation` | Returns the best tactical command for a squad based on a situation snapshot |
| `SquadSharedTargetTable` | Stores and propagates enemy sightings across squad members |

```ts
import {
  evaluateSituation,
  SquadCommand,
  canApplyCommand,
  PROTECTED_STATES,
  SquadSharedTargetTable,
  createDefaultSquadSharedTargetConfig,
} from '@alife-sdk/ai/squad';
import type {
  ISquadSituation,
  ISquadCommandEvaluator,
  ISharedTargetInfo,
  ISquadSharedTargetConfig,
} from '@alife-sdk/ai/squad';
```

---

## How the squad system connects to AI states

AI state handlers do **not** call `evaluateSituation` or `SquadSharedTargetTable`
directly. They use `ctx.squad` — an `ISquadAccess` object that the **host adapter**
implements. The adapter calls into this module internally.

```
AI state handler
      │
      ▼  ctx.squad?.shareTarget(id, x, y)      — CombatState, PatrolState
      │  ctx.squad?.getSharedTarget?.()          — PatrolState (opt-in)
      │  ctx.squad?.issueCommand(cmd)            — leader logic
      │
      ▼  Host adapter (your code):
         SquadSharedTargetTable.shareTarget()    — propagate to squad
         evaluateSituation(snapshot, config)     — pick command
         your NPC.receiveCommand(cmd)            — only if canApplyCommand()
```

`ISquadAccess` is defined in `@alife-sdk/ai/states`. The squad module provides
the utilities your adapter uses to implement it.

---

## ISquadAccess (what you implement)

```ts
import type { ISquadAccess } from '@alife-sdk/ai/states';

interface ISquadAccess {
  shareTarget(targetId: string, x: number, y: number): void;
  getLeaderId(): string | null;
  getMemberCount(): number;
  issueCommand(command: string): void;
  getSharedTarget?(): ISharedTargetInfo | null;  // optional
}
```

Attach one instance per NPC to `INPCContext.squad`. SDK states read it via
`ctx.squad?.method()` — so returning `null` from `ctx.squad` disables all squad
behaviour for that NPC with no errors.

---

## Part 1 — SquadTactics

Pure tactical evaluation. No entity references, no framework coupling.

### evaluateSituation(situation, config): SquadCommand

Takes a snapshot of the current engagement and returns the best command.
Priority order (first match wins):

| Priority | Condition | Command |
|----------|-----------|---------|
| 1 | `avgMorale ≤ moralePanickedThreshold` | `RETREAT` |
| 2 | `enemyCount === 0` | `FOLLOW` |
| 3 | `enemyCount > squadSize × outnumberRatio` | `RETREAT` |
| 4 | `enemyCount ≥ squadSize` | `HOLD` |
| 5 | `squadSize > enemyCount × outnumberRatio` | `ATTACK` |
| 6 | `leaderInCover === true` | `COVER_ME` |
| 7 | default | `SPREAD_OUT` |

```ts
import { evaluateSituation, SquadCommand } from '@alife-sdk/ai/squad';
import type { ISquadSituation } from '@alife-sdk/ai/squad';

const situation: ISquadSituation = {
  squadSize:    4,
  enemyCount:   2,
  avgMorale:    0.1,
  leaderInCover: false,
};

const cmd = evaluateSituation(situation, config.squad);
// → SquadCommand.ATTACK  (4 vs 2, outnumberRatio 1.5 → 4 > 2×1.5 = 4 > 3 ✓)
```

### SquadCommand

Six command identifiers:

```ts
SquadCommand.ATTACK      // 'attack'
SquadCommand.COVER_ME    // 'cover_me'
SquadCommand.FOLLOW      // 'follow'
SquadCommand.HOLD        // 'hold'
SquadCommand.RETREAT     // 'retreat'
SquadCommand.SPREAD_OUT  // 'spread_out'
```

### canApplyCommand(currentState): boolean

Returns `false` for states that must never be interrupted by squad commands.
Always check this before applying a command to an NPC.

```ts
import { canApplyCommand, PROTECTED_STATES } from '@alife-sdk/ai/squad';

if (canApplyCommand(npc.state)) {
  applySquadCommand(npc, cmd);
}

// Protected states (DEAD, WOUNDED, EVADE_GRENADE):
console.log([...PROTECTED_STATES]);
```

### ISquadTacticsConfig

Comes from `IOnlineAIConfig.squad`. Passed into `evaluateSituation`:

```ts
interface ISquadTacticsConfig {
  readonly outnumberRatio: number;          // default: 1.5
  readonly moralePanickedThreshold: number; // default: -0.7
  readonly nearbyRadius: number;            // px — for spatial queries
}
```

Override via `createDefaultAIConfig()`:

```ts
import { createDefaultAIConfig } from '@alife-sdk/ai/config';

const aiConfig = createDefaultAIConfig({
  squad: { outnumberRatio: 1.2 }, // retreat sooner
});
```

---

## Part 2 — SquadSharedTargetTable

When one NPC spots an enemy, all squad members should know about it.
`SquadSharedTargetTable` stores that intel per squad ID with a TTL.

**One instance per game session** — all NPCs share the same table.

```ts
new SquadSharedTargetTable(
  npcToSquad: (npcId: string) => string | null,
  config?:    Partial<ISquadSharedTargetConfig>,
  nowFn?:     () => number,   // injectable for tests; defaults to Date.now()
)
```

### shareTarget(senderNpcId, targetId, x, y): void

Records a target sighting for the sender's squad. All squad members can retrieve
it via `getSharedTarget` until the TTL expires. No-op if the sender is not in
any squad.

```ts
// When CombatState spots an enemy, it calls:
//   ctx.squad?.shareTarget(enemy.id, enemy.x, enemy.y)
// Your ISquadAccess forwards it:
shareTarget(targetId, x, y) {
  sharedTargets.shareTarget(this.npcId, targetId, x, y);
}
```

### getSharedTarget(npcId): ISharedTargetInfo | null

Returns the current squad intel for this NPC's squad, or `null` if:
- NPC is not in any squad.
- No target has been shared yet.
- Intel has expired (`age > ttlMs`). **Expired entries are deleted on read.**

```ts
getSharedTarget() {
  return sharedTargets.getSharedTarget(this.npcId);
}
```

### ISharedTargetInfo

```ts
interface ISharedTargetInfo {
  readonly targetId:   string;  // stable entity ID of the spotted enemy
  readonly x:          number;  // enemy world X at time of sighting
  readonly y:          number;  // enemy world Y at time of sighting
  readonly confidence: number;  // < 1.0 — indirect intel (default 0.8)
  readonly sharedAtMs: number;  // epoch ms when intel was recorded
}
```

`confidence` is intentionally lower than a direct sighting (`1.0`) to reflect
that the NPC has not personally seen the target.

### invalidate(squadId): void

Explicitly clears intel for a squad. Call when the target is confirmed dead or
the engagement ends — avoids members chasing a stale last-known position.

```ts
// Enemy killed:
sharedTargets.invalidate(squad.id);
```

### clear(): void

Clears **all** intel for all squads. Call on save/load or scene restart.

```ts
// On scene restart:
sharedTargets.clear();
```

### ISquadSharedTargetConfig

```ts
interface ISquadSharedTargetConfig {
  ttlMs:            number;  // default: 10_000 ms
  sharedConfidence: number;  // default: 0.8
}
```

Override via factory:

```ts
const cfg = createDefaultSquadSharedTargetConfig({ ttlMs: 5_000 });
```

---

## Full wiring example

```ts
import {
  evaluateSituation,
  SquadCommand,
  canApplyCommand,
  SquadSharedTargetTable,
  createDefaultSquadSharedTargetConfig,
} from '@alife-sdk/ai/squad';
import type { ISquadAccess } from '@alife-sdk/ai/states';
import type { ISharedTargetInfo } from '@alife-sdk/ai/squad';
import { createDefaultAIConfig } from '@alife-sdk/ai/config';

const aiConfig = createDefaultAIConfig();

// --- Session-level shared intel table ---

const sharedTargets = new SquadSharedTargetTable(
  (npcId) => squadManager.getSquadForNPC(npcId)?.id ?? null,
);

// --- Per-NPC squad access ---

class MySquadAccess implements ISquadAccess {
  constructor(private readonly npcId: string) {}

  shareTarget(targetId: string, x: number, y: number): void {
    sharedTargets.shareTarget(this.npcId, targetId, x, y);
  }

  getLeaderId(): string | null {
    return squadManager.getSquadForNPC(this.npcId)?.leaderId ?? null;
  }

  getMemberCount(): number {
    return squadManager.getSquadForNPC(this.npcId)?.members.length ?? 1;
  }

  issueCommand(command: string): void {
    const squad = squadManager.getSquadForNPC(this.npcId);
    if (!squad) return;

    for (const memberId of squad.members) {
      const member = npcRegistry.get(memberId);
      if (member && canApplyCommand(member.currentState)) {
        member.receiveSquadCommand(command);
      }
    }
  }

  getSharedTarget(): ISharedTargetInfo | null {
    return sharedTargets.getSharedTarget(this.npcId);
  }
}

// --- Squad evaluation (call periodically from squad leader tick) ---

function tickSquadLeader(leader: NPC): void {
  const squad = squadManager.getSquadForNPC(leader.id);
  if (!squad) return;

  const situation = {
    squadSize:     squad.members.length,
    enemyCount:    leader.knownEnemies.length,
    avgMorale:     squad.averageMorale(),
    leaderInCover: leader.isInCover,
  };

  const command = evaluateSituation(situation, aiConfig.squad);
  leader.squadAccess.issueCommand(command);
}

// --- Cleanup ---

// On enemy killed:
sharedTargets.invalidate(squadManager.getSquadForNPC(killedEnemyId)?.id ?? '');

// On scene restart:
sharedTargets.clear();
```

---

## getSharedTarget is opt-in

`getSharedTarget?()` is optional on `ISquadAccess`. SDK states check it via
`ctx.squad?.getSharedTarget?.()` — if your adapter doesn't implement it,
PatrolState's intel check silently skips with no error.

| Scenario | What to do |
|----------|-----------|
| Full shared intel | Implement `getSharedTarget()` using `SquadSharedTargetTable` |
| Broadcast only | Implement `shareTarget()`, skip `getSharedTarget()` |
| No squad system | Set `ctx.squad = null` |
