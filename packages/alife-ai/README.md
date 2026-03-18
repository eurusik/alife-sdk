# @alife-sdk/ai

Online frame-based NPC behavior system.

Engine-agnostic. Works with Phaser, PixiJS, Node.js, or any other runtime.
Depends on [`@alife-sdk/core`](../alife-core/README.md).

```
npm install @alife-sdk/ai
```

---

## What this package does

`@alife-sdk/ai` drives every online NPC — an NPC that is within the player's
view and must behave in real-time.

- **State machine driver** — `OnlineAIDriver` + `StateHandlerMap` runs a per-NPC FSM
  over 18 built-in states (idle, patrol, combat, flee, wounded, monster abilities, …)
- **Optional state handlers** — opt-in handlers for investigation, helping wounded allies, and combat transitions (`InvestigateState`, `HelpWoundedState`, `KillWoundedState`, `CombatTransitionHandler`)
- **Cover system** — 6 evaluators, loophole peek/fire cycles, TTL-based cover locking
- **Perception** — FOV queries, hearing radius, intel freshness filters
- **GOAP** — elite NPC goal-oriented planning over a 16-property world state bitmask
- **Navigation** — Catmull-Rom + Dubins arc path smoothing, restricted zones, pack steering
- **Squad tactics** — situational assessment, 6 commands, shared target table
- **Animation** — 8-direction state→key mapping, layered debounced controller
- **Suspicion** — stimulus accumulation → alert threshold crossing
- **Conditions** — multi-channel boolean state for dialogue / event gating

The package is intentionally engine-agnostic. All engine interaction goes
through **ports** — narrow interfaces you implement once for your engine.

---

## Quick start

> `buildNPCContext` and `liveDrivers` below are **your** code, not SDK exports.
> `INPCContext` is an interface — you assemble it once per NPC from your engine objects.
> See the [Key concepts → INPCContext](#inpccontext--narrow-access-interfaces) section for the full interface shape.

```ts
import { ALifeKernel }               from '@alife-sdk/core';
import { AIPlugin }                  from '@alife-sdk/ai/plugin';
import { buildDefaultHandlerMap,
         OnlineAIDriver,
         ONLINE_STATE }              from '@alife-sdk/ai/states';
import { SeededRandom }              from '@alife-sdk/core/ports';

// 1. Set up the kernel (see @alife-sdk/core quick start for full kernel setup)
const kernel = new ALifeKernel({ /* your engine adapters */ });

// 2. Install AIPlugin — owns shared cover registry and restricted zones
const random = new SeededRandom(42);
const aiPlugin = new AIPlugin(random);
kernel.use(aiPlugin);

await kernel.init();

// 3. Build a handler map — one instance, shared across all human NPCs
const handlers = buildDefaultHandlerMap({ combatRange: 350, meleeRange: 60 });

// 4. Create an OnlineAIDriver per NPC (in your spawn / online transition)
function spawnNPC(npcId: string): OnlineAIDriver {
  const coverAccess = aiPlugin.createCoverAccess(npcId);
  // buildNPCContext — your function that assembles INPCContext from engine objects
  // (perception adapter, health adapter, cover access, danger access, etc.)
  const ctx = buildNPCContext(npcId, coverAccess);
  return new OnlineAIDriver(ctx, handlers, ONLINE_STATE.IDLE);
}

// 5. Game loop — call update() on each live driver
// liveDrivers — your Map/Array of active OnlineAIDriver instances
function update(deltaMs: number): void {
  kernel.update(deltaMs);           // A-Life tick + events flush
  for (const driver of liveDrivers) {
    driver.update(deltaMs);         // per-NPC state machine
  }
}

// 6. Read current state
const state = driver.currentStateId; // e.g. 'COMBAT'

// 7. Force a state transition from within a state handler (e.g. on NPC death)
// Transitions happen via ctx.transition(), called from inside a state handler:
//   ctx.transition(ONLINE_STATE.DEAD);
// To force a transition externally, call driver.update() after mutating ctx.state.
```

---

## Sub-path imports

Each module has its own import path for optimal tree-shaking:

| Import path | What's inside | Module docs |
|-------------|--------------|-------------|
| `@alife-sdk/ai` | Full re-export of all sub-modules | [src/](src/) |
| `@alife-sdk/ai/plugin` | `AIPlugin`, `IAIPluginConfig` | [plugin/](src/plugin/) |
| `@alife-sdk/ai/states` | `OnlineAIDriver`, `StateHandlerMap`, `ONLINE_STATE`, all handlers, builder functions | [states/](src/states/) |
| `@alife-sdk/ai/cover` | `CoverRegistry`, `CoverLockRegistry`, 6 evaluators, `LoopholeGenerator` | [cover/](src/cover/) |
| `@alife-sdk/ai/perception` | `NPCSensors`, `isInFOV`, `filterVisibleEntities`, `filterHearingEntities`, `filterHostileEntities`, `filterFriendlyEntities`, `filterFreshIntel`, `distanceSq`, `findClosest`, `scanForEnemies` | [perception/](src/perception/) |
| `@alife-sdk/ai/goap` | `GOAPController`, `buildWorldState`, `selectGoal`, `EvadeHazardAction` | [goap/](src/goap/) |
| `@alife-sdk/ai/navigation` | `smoothPath`, `smoothPathWithTurning`, `SmoothPathFollower`, `RestrictedZoneManager`, `SteeringBehaviors` | [navigation/](src/navigation/) |
| `@alife-sdk/ai/squad` | `evaluateSituation`, `SquadCommand`, `SquadSharedTargetTable` | [squad/](src/squad/) |
| `@alife-sdk/ai/animation` | `getDirection`, `getAnimationKey`, `getAnimationRequest`, `AnimationController`, `DirectionCache`, `CompassIndex`, `AnimLayer`, `DEFAULT_STATE_ANIM_MAP`, `DEFAULT_WEAPON_SUFFIXES` | [animation/](src/animation/) |
| `@alife-sdk/ai/sound` | `VocalizationType`, `VocalizationTracker` | [sound/](src/sound/) |
| `@alife-sdk/ai/suspicion` | `SuspicionAccumulator`, `SuspicionStimuli` | [suspicion/](src/suspicion/) |
| `@alife-sdk/ai/conditions` | `ConditionBank`, `ConditionChannels` | [conditions/](src/conditions/) |
| `@alife-sdk/ai/combat` | `selectBestWeapon`, `shouldThrowGrenade`, `shouldUseMedkit`, `LoadoutBuilder`, `createLoadout`, `FactionWeaponPreference`, `evaluateTransitions`, `DEFAULT_COMBAT_RULES`, `WoundedRule`, `NoAmmoRule`, `EvadeDangerRule`, `MoraleRule`, `GrenadeOpportunityRule`, `MonsterAbility`, `selectMonsterAbility` | [combat/](src/combat/) |
| `@alife-sdk/ai/types` | Shared interfaces (`INPCContext`, `INPCOnlineState`, …) | [types/](src/types/) |
| `@alife-sdk/ai/config` | `IStateConfig`, default config helpers | [config/](src/config/) |
| `@alife-sdk/ai/ports` | AI-specific port interfaces | [ports/](src/ports/) |

---

## Architecture

```
                ┌────────────────────────────────────────┐
                │              ALifeKernel               │
                │   (from @alife-sdk/core)               │
                └──────────────┬─────────────────────────┘
                               │ kernel.use(aiPlugin)
                ┌──────────────▼─────────────────────────┐
                │              AIPlugin                  │
                │  CoverRegistry · CoverLockRegistry     │
                │  RestrictedZoneManager                 │
                │  createCoverAccess(npcId) ─────────────┼──► ICoverAccess (per NPC)
                └────────────────────────────────────────┘

Per-NPC (created on online transition):
                ┌──────────────────────────────────────────────────────┐
                │  OnlineAIDriver                                      │
                │                                                      │
                │  StateHandlerMap ──► IOnlineStateHandler             │
                │   DEAD · IDLE · PATROL · ALERT · FLEE · SEARCH      │
                │   CAMP · SLEEP · COMBAT · TAKE_COVER · GRENADE      │
                │   EVADE_GRENADE · WOUNDED · RETREAT                  │
                │   CHARGE · STALK · LEAP · PSI_ATTACK                 │
                │                                                      │
                │  INPCContext ─┬─ INPCPerception (FOV / hearing)     │
                │               ├─ INPCHealth    (hp / morale)        │
                │               ├─ ICoverAccess  (find / lock cover)  │
                │               ├─ IDangerAccess (DangerManager port) │
                │               ├─ ISquadAccess  (commands / target)  │
                │               ├─ ISuspicionAccess                   │
                │               └─ IConditionAccess                   │
                └──────────────────────────────────────────────────────┘

Shared systems (optional, compose as needed):
  NPCSensors            filterVisibleEntities / filterHearingEntities
  GOAPController        elite NPC A* planning (rank ≥ 5)
  SmoothPathFollower    Catmull-Rom + Dubins arc path cursor
  AnimationController   layered, debounced animation dispatch
  SuspicionAccumulator  stimulus → alert threshold crossing
  ConditionBank         multi-channel boolean state
```

---

## Key concepts

### OnlineAIDriver — per-NPC state machine

`OnlineAIDriver` is created once per NPC when it enters the online zone
and destroyed when it goes offline. It ticks one `IOnlineStateHandler`
per frame: `enter → update (every frame) → exit`.

```ts
const driver = new OnlineAIDriver(ctx, handlers, ONLINE_STATE.IDLE);

driver.update(deltaMs);             // call every frame
driver.currentStateId;              // current state ID string
// Transitions happen via ctx.transition() from inside a state handler:
//   ctx.transition('PATROL');
```

Each state handler is a stateless object — all per-NPC runtime data lives in
`INPCOnlineState` (position, target, phase flags, timer, etc.), not in the handler.
The handler map can be shared across all NPCs of the same type.

### StateHandlerMap — three built-in presets

Choose the right preset for your entity type:

| Builder function | States | Use for |
|-----------------|--------|---------|
| `buildDefaultHandlerMap()` | 14 (core + `CombatState`) | Human NPCs — ranged weapons, cover, grenades |
| `buildMonsterHandlerMap()` | 14 (core + `MonsterCombatController`) | Monsters — melee only, no special abilities |
| `buildChornobylMonsterHandlerMap()` | 18 (core + controller + 4 abilities) | Stalker-style monsters: `CHARGE / STALK / LEAP / PSI_ATTACK` |

All three return a fresh `StateHandlerMap` you can extend with `.register()`:

```ts
// Add a custom HUNT state to the default human map
const handlers = buildDefaultHandlerMap({ combatRange: 300 })
  .register('HUNT', new HuntState(cfg));
```

Monster ability states map to entity types via `CHORNOBYL_ABILITY_SELECTOR`
(or your own `IMonsterAbilityRule[]`):

| Type | Ability state |
|------|--------------|
| `boar` | `CHARGE` — windup → ram at 2× speed |
| `bloodsucker` | `STALK` — go invisible (alpha 0.08) → approach |
| `snork` | `LEAP` — windup → airborne lerp → land |
| `controller` | `PSI_ATTACK` — channel 2 s → PSI area damage |

### AIPlugin — shared world state

`AIPlugin` owns the data structures that must be shared across all NPCs:

- `CoverRegistry` — all cover points in the scene
- `CoverLockRegistry` — TTL-based locking so two NPCs don't pick the same cover
- `RestrictedZoneManager` — zones where NPCs cannot enter / must leave

Install it once, then get a per-NPC adapter from `createCoverAccess(npcId)`:

```ts
const aiPlugin = new AIPlugin(random);
kernel.use(aiPlugin);
await kernel.init();

// For each NPC going online:
const coverAccess = aiPlugin.createCoverAccess(npcId);
```

`AIPlugin.serialize()` saves `RestrictedZoneManager` state.
Cover locks are intentionally NOT serialized — they are ephemeral TTL data.

### INPCContext — narrow access interfaces

Every state handler receives `INPCContext`, which is a bag of narrow port
interfaces. You implement each interface once and compose them per NPC:

```ts
const ctx: INPCContext = {
  npcId:      npc.id,
  faction:    npc.faction,
  perception: new MyPerception(npc),  // INPCPerception  | null
  health:     new MyHealth(npc),      // INPCHealth      | null
  cover:      coverAccess,            // ICoverAccess    | null  (from AIPlugin)
  danger:     dangerAdapter,          // IDangerAccess   | null
  squad:      squadAccess,            // ISquadAccess    | null
  suspicion:  suspicionAccess,        // ISuspicionAccess | null
  conditions: conditionAccess,        // IConditionAccess | null
  // pack, restrictedZones also nullable — omit if not used
  emitShoot:   (payload) => fireWeapon(npc, payload),
  emitMeleeHit:(payload) => applyMelee(npc, payload),
};
```

> **Important:** Many subsystems are nullable (`T | null`). State handlers
> must null-check before use — always access optional subsystems with optional
> chaining: `ctx.cover?.findCover(...)`, `ctx.health?.hp`, `ctx.perception?.hasVisibleEnemy()`.
> Omitting a subsystem (setting it to `null`) silently disables the
> features that depend on it, with no code changes required in the handlers.

### Cover system

The cover module provides a full pipeline from raw cover points to per-NPC
peek/fire cycles:

1. **Register** cover points into `CoverRegistry` (world space positions + normal)
2. **Evaluate** — choose the right evaluator for the situation:
   - `CloseCoverEvaluator` — nearest cover
   - `FarCoverEvaluator` — cover far from threat
   - `BalancedCoverEvaluator` — balanced distance + angle
   - `BestCoverEvaluator` — best angle + distance combined
   - `AmbushCoverEvaluator` — optimal ambush position
   - `SafeCoverEvaluator` — maximum distance from all threats
3. **Lock** — `CoverLockRegistry.tryLock(coverId, npcId, { ttlMs })` so no two NPCs share a point
4. **Loopholes** — each cover point has 1–N loophole offsets (count randomized, cached per point); `TakeCoverState` cycles `WAIT → PEEK → FIRE → RETURN`

#### Cover workflow inside a state handler

The typical cover workflow in a custom state handler mirrors what `TakeCoverState`
does internally:

```ts
// In your state handler's enter():
enter(ctx: INPCContext): void {
  const enemies = ctx.perception?.getVisibleEnemies() ?? [];
  const enemy   = enemies[0] ?? null;

  // 1. findCover() — searches CoverRegistry for the best available point.
  //    Returns { x, y } or null. Internally stores the found point's ID.
  let coverPt: { x: number; y: number } | null = null;
  if (ctx.cover !== null && enemy !== null) {
    coverPt = ctx.cover.findCover(ctx.x, ctx.y, enemy.x, enemy.y);
  }

  if (coverPt !== null) {
    // 2. lockLastFound() — acquires a TTL lock on the point just returned
    //    by findCover(). Returns false if already locked by another NPC.
    const locked = ctx.cover?.lockLastFound?.(ctx.npcId, 8000) ?? true;
    if (locked) {
      ctx.state.coverPointX = coverPt.x;
      ctx.state.coverPointY = coverPt.y;
    } else {
      coverPt = null; // contested — do not move to this point
    }
  }

  // 3. Initialise the loophole phase cycle.
  ctx.state.loophole = { phase: 'WAIT', phaseStartMs: ctx.now() };
}

// In your state handler's update(), cycle WAIT → PEEK → FIRE → RETURN:
update(ctx: INPCContext, deltaMs: number): void {
  const loophole = ctx.state.loophole;
  const now      = ctx.now();
  const enemies  = ctx.perception?.getVisibleEnemies() ?? [];
  const enemy    = enemies[0] ?? null;

  switch (loophole?.phase) {
    case 'WAIT':
      ctx.halt();
      if (now >= ctx.state.lastGrenadeMs) {
        loophole.phase = 'PEEK';
        loophole.phaseStartMs = now;
      }
      break;

    case 'PEEK':
      // Move slightly toward enemy to simulate peeking out.
      if (enemy) moveToward(ctx, enemy.x, enemy.y, speed * 0.5);
      if (now - loophole.phaseStartMs >= cfg.loopholePeekDurationMs) {
        loophole.phase = 'FIRE';
        loophole.phaseStartMs = now;
      }
      break;

    case 'FIRE':
      ctx.halt();
      if (enemy) {
        ctx.emitShoot({ npcId: ctx.npcId, x: ctx.x, y: ctx.y,
                        targetX: enemy.x, targetY: enemy.y,
                        weaponType: ctx.state.primaryWeapon ?? 'rifle' });
      }
      if (now - loophole.phaseStartMs >= cfg.loopholeFireDurationMs) {
        loophole.phase = 'RETURN';
        loophole.phaseStartMs = now;
      }
      break;

    case 'RETURN':
      // Move back to cover centre, then restart WAIT.
      moveToward(ctx, ctx.state.coverPointX, ctx.state.coverPointY, speed);
      if (now - loophole.phaseStartMs >= cfg.loopholeReturnDurationMs) {
        loophole.phase = 'WAIT';
        ctx.state.lastGrenadeMs = now + waitDuration;
      }
      break;
  }
}

// In exit(): release the lock so other NPCs can take the point.
exit(ctx: INPCContext): void {
  ctx.state.hasTakenCover = false;
  ctx.state.loophole = null;
  ctx.cover?.unlockAll?.(ctx.npcId);
}
```

```ts
import { recommendCoverType } from '@alife-sdk/ai/cover';

const evaluatorType = recommendCoverType({
  threatCount: 3,
  npcHp:       15,
  npcHpMax:    100,
  isElite:     false,
});
// → 'SAFE' (low HP + many threats → maximize distance)
```

### GOAP — elite NPC planning

For NPCs with rank ≥ 5, `GOAPController` wraps a `GOAPPlanner` (A* on a
17-property `WorldState`) to select and execute goal-oriented action
sequences. Replanning happens automatically on a configurable interval or
immediately when `invalidatePlan()` is called.

#### World state properties

`buildWorldState(snapshot)` maps an `INPCWorldSnapshot` to 17 boolean
properties. All property keys come from the `WorldProperty` constant:

| Property key | Source field | What it means |
|---|---|---|
| `alive` | `snapshot.isAlive` | NPC is alive |
| `criticallyWounded` | `hpRatio <= 0.3` | HP at or below 30 % |
| `hasWeapon` | `snapshot.hasWeapon` | Has a usable weapon |
| `hasAmmo` | `snapshot.hasAmmo` | Has ammunition |
| `inCover` | `snapshot.inCover` | Currently at a cover point |
| `seeEnemy` | `snapshot.seeEnemy` | Enemy visible in FOV |
| `enemyPresent` | `snapshot.enemyPresent` | Enemy known (seen or heard) |
| `enemyInRange` | `snapshot.enemyInRange` | Enemy within weapon range |
| `danger` | `snapshot.hasDanger` | General danger signal active |
| `dangerGrenade` | `snapshot.hasDangerGrenade` | Grenade danger signal active |
| `enemyWounded` | `snapshot.enemyWounded` | Last known enemy is wounded |
| `anomalyNear` | `snapshot.nearAnomalyZone` | Anomaly zone inside proximity |
| `enemySeeMe` | `snapshot.seeEnemy` | (derived) enemy has line of sight |
| `readyToKill` | `hasWeapon && hasAmmo && seeEnemy && enemyInRange` | Can fire immediately |
| `positionHeld` | `inCover && !seeEnemy` | Holding cover without exposure |
| `lookedOut` | always `false` | One-shot peek flag (actions set it) |
| `atTarget` | `!enemyPresent && !hasDanger` | Safe at destination |

#### Goal selection

Goals are chosen by evaluating `DEFAULT_GOAL_RULES` in priority order (lowest
number wins):

| Priority | Goal | Trigger |
|---|---|---|
| 0 `CRITICALLY_WOUNDED` | Heal + disengage | `hpRatio <= healHpThreshold` |
| 1 `PANIC_FLEE` | Flee (morale collapsed) | `isPanicked && hasDanger` |
| 2 `ENEMY_PRESENT` | Eliminate enemy | `snapshot.enemyPresent` |
| 3 `DANGER` | Evade danger | `snapshot.hasDanger` |
| 4 `ANOMALY_AVOID` | Exit anomaly zone | `snapshot.nearAnomalyZone` |
| 5 `DEFAULT` | Patrol / idle | always (fallback) |

#### Integration example

```ts
import { GOAPController }         from '@alife-sdk/ai/goap';
import { GOAPPlanner }             from '@alife-sdk/core';
import type { IGOAPConfig }        from '@alife-sdk/ai/types';
import type { INPCWorldSnapshot }  from '@alife-sdk/ai/types';

// 1. Create a planner and register actions once (shared across NPCs of same type).
const planner = new GOAPPlanner();
planner.registerAction(new PatrolAction());
planner.registerAction(new TakeCoverAction());
planner.registerAction(new EngageEnemyAction());

// 2. Build config — replanIntervalMs drives periodic replanning.
const goapConfig: IGOAPConfig = {
  replanIntervalMs:    5000,   // replan every 5 s at minimum
  eliteRankThreshold:  5,
  healHpThreshold:     0.3,
  maxPlanDepth:        6,
  dangerMemoryMaxAge:  10000,
};

// 3. Create one GOAPController per NPC (in your per-NPC setup / state handler).
const goap = new GOAPController(planner, goapConfig);

// 4. Inside a state handler's update(), build a snapshot and tick GOAP.
update(ctx: INPCContext, deltaMs: number): void {
  const snapshot: INPCWorldSnapshot = {
    isAlive:       ctx.health?.isAlive()  ?? true,
    hpRatio:       ctx.health?.hpRatio()  ?? 1,
    hasWeapon:     ctx.state.primaryWeapon !== null,
    hasAmmo:       ctx.state.hasAmmo,
    inCover:       ctx.state.hasTakenCover,
    seeEnemy:      (ctx.perception?.getVisibleEnemies().length ?? 0) > 0,
    enemyPresent:  ctx.state.lastKnownEnemyX !== 0,
    enemyInRange:  ctx.state.enemyInRange,
    hasDanger:     (ctx.danger?.getActiveZones().length ?? 0) > 0,
    hasDangerGrenade: ctx.state.dangerGrenade,
    enemyWounded:  ctx.state.enemyWounded,
    nearAnomalyZone: ctx.state.nearAnomaly,
  };

  const entity = ctx.entity; // IEntity — your game object adapter
  const result = goap.update(deltaMs, entity, snapshot);

  if (!result.handled) {
    // GOAP has no plan — fall back to FSM transition
    ctx.transition('IDLE');
  }

  // Force immediate replan when significant world change occurs:
  // goap.invalidatePlan();
}

// Custom world property builders and goal rules are opt-in:
import { DEFAULT_WORLD_PROPERTY_BUILDERS,
         DEFAULT_GOAL_RULES } from '@alife-sdk/ai/goap';
```

### Animation integration

`AnimationController` is a stateful per-NPC controller with debounce and
layer priority. It sits in front of your engine's animation API and
prevents redundant `play()` calls.

#### Layers

Animations are tagged with one of three `AnimLayer` values (defined as numeric
constants for priority comparison):

| Layer | Value | Typical use |
|---|---|---|
| `LEGS` | `0` | Walking, running, crouching, idle |
| `TORSO` | `1` | Combat stance, throw, fire |
| `HEAD` | `2` | (reserved — for facial rigs etc.) |

A higher numeric value wins when two layers compete. For example, a `TORSO`
animation (value `1`) overrides a `LEGS` animation (value `0`). The priority
mapping can be overridden via `ILayerPriorityMap`.

#### Debouncing

`request()` is a no-op if the same `key + layer` is already playing. This
means you can call it every frame without spamming the engine renderer.
`force()` bypasses both the debounce and the priority check — use it for
one-shot events such as death animations or ability effects.

#### Creating and using AnimationController

```ts
import { AnimationController }     from '@alife-sdk/ai/animation';
import { getAnimationRequest }      from '@alife-sdk/ai/animation';
import type { IAnimationDriver }    from '@alife-sdk/ai/animation';

// 1. Implement IAnimationDriver once for your engine.
//    Phaser example:
class PhaserAnimDriver implements IAnimationDriver {
  constructor(private readonly sprite: Phaser.GameObjects.Sprite) {}
  play(key: string, opts: { loop: boolean; frameRate: number }): void {
    this.sprite.anims.play({ key, loop: opts.loop, frameRate: opts.frameRate }, true);
  }
  hasAnimation(key: string): boolean {
    return this.sprite.anims.exists(key);
  }
}

// 2. Create one AnimationController per NPC.
const animController = new AnimationController({
  driver: new PhaserAnimDriver(sprite),
  // layerPriority: { [AnimLayer.TORSO]: 10 } — optional override
});

// 3. Inside a state handler's update(), resolve and request the animation.
update(ctx: INPCContext, deltaMs: number): void {
  const req = getAnimationRequest({
    state:          ctx.driver.currentStateId,   // e.g. 'COMBAT'
    weaponCategory: ctx.state.primaryWeaponType, // e.g. 2 → 'rifle'
    velocity:       { x: ctx.vx, y: ctx.vy },
    directionCache: this.dirCache,               // DirectionCache — avoids atan2 every frame
  });

  // request() skips play() if the same key+layer is already active (debounce).
  animController.request(req);

  // For one-shot events — bypasses debounce and priority:
  // animController.force({ key: 'death_rifle', loop: false, frameRate: 8,
  //                        layer: AnimLayer.LEGS });
}

// 4. On respawn or object-pool recycle:
animController.reset();
```

Key points:
- `getAnimationRequest()` builds the animation key from `state + weaponCategory + direction`.
  Default key format: `{base}_{weapon}_{direction}`, e.g. `combat_rifle_SE`.
  States with `omitDirection: true` (e.g. `DEAD`, `GRENADE`, `SLEEP`) use
  `{base}_{weapon}` only.
- `DirectionCache.resolve(vx, vy)` caches the last 8-way compass direction and
  only re-runs `atan2` when velocity changes by more than ~2 px/s.
- The controller is stateless in terms of NPC data — one instance per NPC,
  but one `StateHandlerMap` can carry a shared `AnimationController` factory.

---

## Lifecycle

```
kernel.use(aiPlugin)                ← register AI plugin
  ↓
kernel.init()                       ← freeze registries, init plugin
  ↓
NPC goes online:
  coverAccess = aiPlugin.createCoverAccess(npcId)
  driver = new OnlineAIDriver(ctx, handlers, ONLINE_STATE.IDLE)
  ↓
Every frame:
  kernel.update(delta)              ← A-Life tick + events flush
  driver.update(delta)              ← state enter/update/exit
  ↓
NPC goes offline:
  driver is discarded               ← no serialization needed
  ↓
Save / restore:
  aiPlugin.serialize()              ← RestrictedZoneManager state
  aiPlugin.restore(state)           ← rebuilds zones
  ↓
kernel.destroy()                    ← cleanup
```

---

## Testing

Run only the AI package tests:

```
pnpm test --filter @alife-sdk/ai
```

Each system is designed for isolated unit tests:

```ts
import { buildDefaultHandlerMap, OnlineAIDriver, ONLINE_STATE } from '@alife-sdk/ai/states';

// Minimal stub context — implement only the interfaces your test exercises
const ctx = buildStubContext({ hp: 100, targetId: 'enemy1' });
const driver = new OnlineAIDriver(ctx, buildDefaultHandlerMap(), ONLINE_STATE.IDLE);

// Transitions happen via ctx.transition() inside a state handler.
// To test a forced transition, put it inside a stub handler's enter/update:
//   enter: (ctx) => ctx.transition(ONLINE_STATE.COMBAT)
driver.update(16);

expect(driver.currentStateId).toBe(ONLINE_STATE.COMBAT);
```

Tips:
- State handlers are stateless objects — instantiate once, reuse across tests
- `INPCOnlineState` is a plain object — mutate it directly in tests to simulate phase changes
- `CoverRegistry` / `CoverLockRegistry` have no external dependencies — construct them directly
- `SuspicionAccumulator` and `ConditionBank` are standalone classes with no kernel dependency

---

## Module map

```
src/
├── plugin/       AIPlugin, IAIPluginConfig, createDefaultAIPluginConfig
├── states/       OnlineAIDriver, StateHandlerMap, ONLINE_STATE, builder functions
│   ├── handlers/ DeadState, IdleState, PatrolState, AlertState, FleeState,
│   │             SearchState, CampState, SleepState, CombatState, TakeCoverState,
│   │             GrenadeState, EvadeGrenadeState, WoundedState, RetreatState,
│   │             MonsterCombatController, ChargeState, StalkState, LeapState, PsiAttackState
│   └── eat-corpse/ EatCorpseState (opt-in monster sub-state)
├── cover/        CoverRegistry, CoverLockRegistry, CoverAccessAdapter,
│                 6 evaluators, LoopholeGenerator, findBestLoophole, recommendCoverType
├── perception/   NPCSensors, isInFOV, filterVisibleEntities, filterHearingEntities,
│                 filterHostileEntities, filterFriendlyEntities, filterFreshIntel
├── goap/         GOAPController, buildWorldState, selectGoal, EvadeHazardAction,
│                 DEFAULT_WORLD_PROPERTY_BUILDERS, DEFAULT_GOAL_RULES
├── navigation/   smoothPath, smoothPathWithTurning, SmoothPathFollower,
│                 RestrictedZoneManager, RestrictionType, SteeringBehaviors
├── squad/        evaluateSituation, SquadCommand, canApplyCommand,
│                 SquadSharedTargetTable, PROTECTED_STATES
├── animation/    getDirection, getAnimationKey, AnimationController,
│                 DirectionCache, DEFAULT_STATE_ANIM_MAP, DEFAULT_WEAPON_SUFFIXES
├── sound/        VocalizationType, VocalizationTracker, createDefaultVocalizationConfig
├── suspicion/    SuspicionAccumulator, SuspicionStimuli, createDefaultSuspicionConfig
├── conditions/   ConditionBank, ConditionChannels, createDefaultConditionBankConfig
├── combat/       combat helpers used by state handlers
├── types/        INPCContext, INPCOnlineState, IOnlineStateHandler, INPCPerception,
│                 INPCHealth, ICoverAccess, IDangerAccess, ISquadAccess, IPackAccess,
│                 ISuspicionAccess, IConditionAccess, IShootPayload, IMeleeHitPayload
├── config/       IStateConfig, IStateTransitionMap, createDefaultStateConfig
└── ports/        AI-specific port interfaces (IRestrictedZoneAccess, IHazardZoneAccess)
```

---

## Common pitfalls

**NPC stuck in a state — update() is called but the state never changes**

State transitions are only triggered by `ctx.transition()` being called from
inside a state handler's `enter()` or `update()`. If your state never calls
`ctx.transition()`, the driver stays in that state indefinitely.
Check the transition conditions in your handler: perception null-checks, timer
comparisons, and morale/health thresholds are the most common culprits.

**Transitions not firing — `ctx.transition()` is called externally but ignored**

`ctx.transition()` must be called from within a state handler's `enter()` or
`update()` method. Calling it from outside (e.g. from your game's event
handler directly) does nothing because the driver only processes transitions
during its own `update()` call. To force a state change from outside,
mutate `ctx.state` to put the NPC in the correct pre-condition, then let
the next `driver.update()` frame evaluate the transition naturally.

**Cover system returns null — NPC never finds a cover point**

Work through this checklist:
1. `CoverRegistry` populated? Call `registry.getSize()` — if it returns `0`,
   no points have been registered. Call `registry.addPoints([...])` during
   scene setup.
2. Cover points within search radius? The default `searchRadius` from `ICoverConfig`
   must be larger than the distance between the NPC and the nearest point.
3. All points locked? If `CoverLockRegistry` is in use, points expire
   automatically after their TTL. Check that `ttlMs` is not set so high
   that points remain locked indefinitely.
4. Score threshold too strict? `minScoreThreshold` in `ICoverConfig` filters
   out low-quality candidates. Lower it for sparse maps.

**Subsystem returning null — calls like `ctx.cover.findCover()` crash**

All subsystems on `INPCContext` are typed `T | null`. You must access them
with optional chaining:

```ts
// Safe — no-op if cover is null:
const pt = ctx.cover?.findCover(ctx.x, ctx.y, ex, ey) ?? null;

// Safe — defaults to empty array:
const enemies = ctx.perception?.getVisibleEnemies() ?? [];

// Safe — defaults to 1 (full HP):
const hp = ctx.health?.hpRatio() ?? 1;
```

Setting a subsystem to `null` on `INPCContext` silently disables the
features that depend on it — the built-in state handlers all guard with
optional chaining, so no code changes are needed in the handlers themselves.

**GOAP plan never advances — `result.handled` is always `false`**

The most common causes:
- No actions registered in `GOAPPlanner`. Call `planner.registerAction(...)` before
  creating `GOAPController`.
- `INPCWorldSnapshot` already satisfies the selected goal. When the world state
  already matches the goal, the planner returns an empty plan and the controller
  yields `handled: false`. This is correct behaviour — GOAP is done.
- `action.isValid(entity)` returns `false` on every action. Each action
  aborts immediately and the plan is marked invalid, triggering a replan loop.
  Log `goap.getCurrentPlanIds()` and `goap.getLastGoalResult()` to diagnose.
