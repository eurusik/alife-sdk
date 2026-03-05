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
3. **Lock** — `CoverLockRegistry.lock(npcId, coverId, ttlMs)` so no two NPCs share a point
4. **Loopholes** — each cover point has 1–3 loophole offsets; `TakeCoverState` cycles `WAIT → PEEK → FIRE → RETURN`

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
16-property `WorldState` bitmask) to select and execute goal-oriented action
sequences. Replanning happens every 5 s or on a forced trigger.

```ts
const goap = new GOAPController(ctx, goapConfig);
goap.update(deltaMs); // ticks current action or replans if needed

// Custom world property builders and goal rules are opt-in:
import { DEFAULT_WORLD_PROPERTY_BUILDERS,
         DEFAULT_GOAL_RULES } from '@alife-sdk/ai/goap';
```

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
