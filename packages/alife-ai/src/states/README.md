# states

The core of `@alife-sdk/ai` — the online NPC finite state machine.

This module provides:

| What | Where |
|------|-------|
| 18 built-in state handlers | `buildDefaultHandlerMap()` / `buildMonsterHandlerMap()` |
| Per-NPC FSM driver | `OnlineAIDriver` |
| NPC context contract | `INPCContext` (you implement this) |
| Per-NPC state bag | `INPCOnlineState` / `createDefaultNPCOnlineState()` |
| Transition wiring | `IStateTransitionMap` / `createDefaultTransitionMap()` |
| Handler registry | `StateHandlerMap` |
| Custom state contract | `IOnlineStateHandler` |

```ts
import {
  OnlineAIDriver,
  buildDefaultHandlerMap,
  buildMonsterHandlerMap,
  ONLINE_STATE,
  StateHandlerMap,
  NPCPerception,
  createDefaultNPCOnlineState,
  createDefaultTransitionMap,
  createDefaultStateConfig,
} from '@alife-sdk/ai/states';
import type {
  INPCContext,
  IOnlineDriverHost,
  IOnlineStateHandler,
  INPCOnlineState,
  IStateConfig,
  IStateTransitionMap,
} from '@alife-sdk/ai/states';
```

---

## How it all fits together

```
Your game (Phaser/ECS/other)
      │
      ▼  Implement IOnlineDriverHost
         (your PhaserNPCContext: position, velocity, events, subsystems)
      │
      ▼  OnlineAIDriver(host, handlers, 'IDLE')
         ┌─ StateHandlerMap (buildDefaultHandlerMap / buildMonsterHandlerMap)
         │    18 state handlers — stateless singletons, shared across all NPCs
         │
         └─ INPCOnlineState (createDefaultNPCOnlineState)
              per-NPC mutable data bag: targets, timers, morale, loadout, flags
      │
      ▼  Game loop: driver.update(deltaMs)
         → current state handler.update(ctx, deltaMs)
         → ctx.transition('COMBAT') when conditions met
         → exit() / enter() called automatically
```

**The golden rule:** handlers are stateless singletons. All per-NPC data lives
in `INPCOnlineState` (via `ctx.state`). One handler instance drives all NPCs.

---

## Quick start — 5 minutes to working NPCs

```ts
import {
  OnlineAIDriver,
  buildDefaultHandlerMap,
  createDefaultNPCOnlineState,
  ONLINE_STATE,
} from '@alife-sdk/ai/states';
import type { IOnlineDriverHost } from '@alife-sdk/ai/states';

// 1. Build shared handler map (once per scene)
const handlers = buildDefaultHandlerMap();  // human NPCs

// 2. Implement IOnlineDriverHost per NPC
class PhaserNPCContext implements IOnlineDriverHost {
  readonly npcId = 'npc-001';
  readonly factionId = 'bandits';
  readonly entityType = 'npc';

  // Position — updated each frame by physics
  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }

  // Mutable AI state bag
  readonly state = createDefaultNPCOnlineState();

  // Optional subsystems (null = disabled)
  readonly perception = myPerception;  // or null
  readonly health     = myHealth;      // or null
  readonly cover      = null;
  readonly danger     = null;
  readonly restrictedZones = null;
  readonly squad      = null;
  readonly pack       = null;
  readonly conditions = null;
  readonly suspicion  = null;

  // Movement
  setVelocity(vx, vy) { this.sprite.body.setVelocity(vx, vy); }
  halt()              { this.sprite.body.setVelocity(0, 0); }
  setRotation(r)      { this.sprite.setRotation(r); }
  setAlpha(a)         { this.sprite.setAlpha(a); }
  teleport(x, y)      { this.sprite.setPosition(x, y); }
  disablePhysics()    { this.sprite.body.enable = false; }

  // Events → forward to game systems
  emitShoot(p)              { projectileSystem.spawn(p); }
  emitMeleeHit(p)           { damageSystem.applyMelee(p); }
  emitVocalization(type)    { audioSystem.play(this.npcId, type); }
  emitPsiAttackStart(x, y)  { effectSystem.psiAoe(x, y); }

  // Utilities
  now()    { return this.scene.time.now; }
  random() { return Math.random(); }
}

// 3. Create one driver per NPC
const ctx  = new PhaserNPCContext(sprite, scene);
const driver = new OnlineAIDriver(ctx, handlers, ONLINE_STATE.IDLE);

// 4. Game loop
scene.update(_time, delta) {
  driver.update(delta);
}

// 5. Cleanup
driver.destroy();
```

---

## OnlineAIDriver

Per-NPC FSM coordinator. One instance per active NPC.

```ts
new OnlineAIDriver(
  host:         IOnlineDriverHost,
  handlers:     StateHandlerMap | ReadonlyMap<string, IOnlineStateHandler>,
  initialState: string,
)
```

Calls `enter()` on `initialState` immediately in the constructor.

### update(deltaMs): void

Run one frame of AI. Call from your game loop:

```ts
driver.update(scene.game.loop.delta);
```

### destroy(): void

Calls `exit()` on the current state. Call when the NPC is removed or the
scene shuts down.

### currentStateId: string

Read the current active state ID (e.g. `'COMBAT'`). Useful for animations,
debug overlays, and save/load.

> **`IOnlineDriverHost`** is `INPCContext` minus `transition` and `currentStateId`
> — the driver owns those two fields and injects them into the wrapped context.
> Implement `IOnlineDriverHost`, not `INPCContext` directly.

---

## ONLINE_STATE — state identifiers

```ts
ONLINE_STATE.IDLE          // 'IDLE'
ONLINE_STATE.PATROL        // 'PATROL'
ONLINE_STATE.ALERT         // 'ALERT'
ONLINE_STATE.COMBAT        // 'COMBAT'
ONLINE_STATE.TAKE_COVER    // 'TAKE_COVER'
ONLINE_STATE.FLEE          // 'FLEE'
ONLINE_STATE.SEARCH        // 'SEARCH'
ONLINE_STATE.CAMP          // 'CAMP'
ONLINE_STATE.SLEEP         // 'SLEEP'
ONLINE_STATE.GRENADE       // 'GRENADE'
ONLINE_STATE.EVADE_GRENADE // 'EVADE_GRENADE'
ONLINE_STATE.WOUNDED       // 'WOUNDED'
ONLINE_STATE.RETREAT       // 'RETREAT'
ONLINE_STATE.DEAD          // 'DEAD'
// Monster-specific:
ONLINE_STATE.CHARGE        // 'CHARGE'
ONLINE_STATE.STALK         // 'STALK'
ONLINE_STATE.LEAP          // 'LEAP'
ONLINE_STATE.PSI_ATTACK    // 'PSI_ATTACK'
```

Use these constants everywhere instead of string literals to avoid typos.

---

## buildDefaultHandlerMap / buildMonsterHandlerMap

**One call creates all 18 handlers** — call once per scene (or per config variant),
then share the result across all NPCs of that type.

```ts
// Human NPCs (ranged combat, cover, grenades, morale):
const humanHandlers = buildDefaultHandlerMap(configOverrides?, transitionOverrides?);

// Monsters (melee, species abilities: CHARGE/STALK/LEAP/PSI):
const monsterHandlers = buildMonsterHandlerMap(configOverrides?, transitionOverrides?);
```

Both accept optional partial overrides:

```ts
// Custom config + remap transitions:
const handlers = buildDefaultHandlerMap(
  { combatRange: 250, approachSpeed: 120 },
  { combatOnPanicked: 'RUN_AWAY' },  // custom state name
);
```

The returned `StateHandlerMap` supports fluent chaining:

```ts
const handlers = buildDefaultHandlerMap(cfg, tr)
  .register('HUNT', new HuntState(cfg))      // add custom state
  .register(ONLINE_STATE.COMBAT, myElite);   // replace built-in
```

---

## StateHandlerMap — registry

```ts
new StateHandlerMap(entries?: Iterable<[string, IOnlineStateHandler]>)
```

| Method | Description |
|--------|-------------|
| `.register(id, handler)` | Add or replace one state. Returns `this`. |
| `.extend(other)` | Merge another map — existing IDs are **not** overwritten. Returns `this`. |
| `.override(other)` | Merge another map — existing IDs **are** overwritten. Returns `this`. |
| `.get(id)` | Returns the handler or `undefined`. |
| `.has(id)` | Check if a state ID is registered. |
| `.size` | Number of registered states. |
| `.toMap()` | Returns `ReadonlyMap<string, IOnlineStateHandler>`. |

---

## INPCOnlineState — the state bag

All handlers share a single per-NPC data object. Create it with:

```ts
const state = createDefaultNPCOnlineState();
```

Assign to `ctx.state` and keep it for the lifetime of the NPC. All fields are
initialised to zero/null/default values. You never need to touch these fields
directly — handlers manage them internally.

Key fields (for debugging / save-restore):

```ts
state.targetId          // current enemy ID or null
state.moraleState       // 'STABLE' | 'SHAKEN' | 'PANICKED'
state.morale            // [-1, 1]
state.isAlert           // NPC is in heightened alert
state.hasTakenCover     // NPC is currently at a cover point
state.primaryWeapon     // active weapon type string or null
state.grenadeCount      // remaining grenades
```

---

## IStateTransitionMap — rename states

Every transition in every handler is driven by `IStateTransitionMap` instead
of hardcoded strings. This lets you rename states or redirect transitions
without touching SDK code.

```ts
// Default wiring (all transitions):
const tr = createDefaultTransitionMap();

// Override selected transitions:
const tr = createDefaultTransitionMap({
  combatOnPanicked: 'RUN_AWAY',  // your custom state
  patrolOnSuspicious: 'SEARCH',  // softer response to suspicion
  idleOnTired: 'SLEEP',          // send tired NPCs to SLEEP instead of CAMP
});

// Pass to factories:
const handlers = buildDefaultHandlerMap(cfg, tr);
```

Default transitions (most relevant):

| Trigger | Default target | When it fires |
|---------|---------------|---------------|
| `idleOnEnemy` | `ALERT` | Enemy visible in IDLE |
| `patrolOnEnemy` | `ALERT` | Enemy visible in PATROL |
| `alertOnEnemy` | `COMBAT` | Enemy confirmed in ALERT |
| `alertOnTimeout` | `PATROL` | No enemy after alert duration |
| `combatOnNoEnemy` | `IDLE` | Lost enemy, no last-known position |
| `combatOnLastKnown` | `SEARCH` | Lost enemy, last-known position known |
| `combatOnPanicked` | `FLEE` | Morale collapsed in combat |
| `combatOnShaken` | `RETREAT` | Morale shaken in combat |
| `combatOnWounded` | `WOUNDED` | HP fell below wounded threshold |
| `combatOnCover` | `TAKE_COVER` | Cover found in combat |
| `fleeOnCalmed` | `ALERT` | NPC fled far enough |
| `searchOnTimeout` | `IDLE` | Search timed out, nothing found |
| `woundedOnHealed` | `COMBAT` | HP recovered |
| `monsterOnNoEnemy` | `IDLE` | Monster lost target |

Full list: see `IStateTransitionMap` interface (65 entries).

---

## IStateConfig — all tuning values

Pass overrides to `buildDefaultHandlerMap()` or `createDefaultStateConfig()`:

```ts
import { createDefaultStateConfig } from '@alife-sdk/ai/states';

const cfg = createDefaultStateConfig({
  combatRange: 250,              // px — stop and shoot distance
  approachSpeed: 130,            // px/s
  alertDuration: 5_000,          // ms before ALERT → PATROL timeout (default: 5 000)
  suspicionAlertThreshold: 0.7,  // suspicion level that triggers ALERT
  woundedHpThreshold: 0.2,       // HP% at which WOUNDED state kicks in (default: 0.2)
});
```

`IStateConfig` extends `IMovementConfig` + `ICombatConfig` + `IMonsterConfig`
+ `ITimingConfig`. All fields have production defaults.

---

## IOnlineStateHandler — write a custom state

Three lifecycle methods. **Handler must be stateless** — per-NPC data goes
in `ctx.state`.

```ts
import type { IOnlineStateHandler } from '@alife-sdk/ai/states';
import type { INPCContext } from '@alife-sdk/ai/states';

export class HuntState implements IOnlineStateHandler {
  enter(ctx: INPCContext): void {
    ctx.halt();
    ctx.emitVocalization('HUNT_START');
  }

  update(ctx: INPCContext, deltaMs: number): void {
    if (!ctx.perception?.hasVisibleEnemy()) {
      ctx.transition('SEARCH');
      return;
    }
    const enemy = ctx.perception.getVisibleEnemies()[0];
    ctx.setVelocity(/* move toward enemy */);
  }

  exit(ctx: INPCContext): void {
    ctx.halt();
  }
}

// Register alongside built-ins:
const handlers = buildDefaultHandlerMap(cfg, tr)
  .register('HUNT', new HuntState());
```

---

## INPCContext — what you implement

`INPCContext` has two groups of members:

### Required (always implement)

```
npcId, factionId, entityType    — identity
x, y                            — world position
state                           — INPCOnlineState (createDefaultNPCOnlineState())
setVelocity, halt, setRotation  — movement
setAlpha, teleport, disablePhysics
emitShoot, emitMeleeHit, emitVocalization, emitPsiAttackStart
now()                           — returns current time in ms
random()                        — returns [0, 1)
```

### Optional subsystems (return `null` to disable)

| Field | Type | Used by |
|-------|------|---------|
| `perception` | `INPCPerception \| null` | Most states (enemy detection) |
| `health` | `INPCHealth \| null` | WoundedState, CombatState |
| `cover` | `ICoverAccess \| null` | TakeCoverState, RetreatState |
| `danger` | `IDangerAccess \| null` | CombatState, EvadeGrenadeState |
| `restrictedZones` | `IRestrictedZoneAccess \| null` | IdleState |
| `squad` | `ISquadAccess \| null` | CombatState, PatrolState |
| `pack` | `IPackAccess \| null` | AlertState, IdleState, PatrolState |
| `conditions` | `IConditionAccess \| null` | IdleState (fatigue/radiation) |
| `suspicion` | `ISuspicionAccess \| null` | IdleState, PatrolState, InvestigateState |

All state handlers guard with `ctx.cover?.findCover(...)` style optional chaining
— returning `null` for any field silently disables that feature.

> **`IOnlineDriverHost = Omit<INPCContext, 'transition' | 'currentStateId'>`**
> Implement `IOnlineDriverHost` when constructing a driver — the driver injects
> those two fields itself.

---

## NPCPerception — helper for INPCPerception

`NPCPerception` is a mutable per-NPC snapshot. Create one instance per NPC,
then call `sync()` each frame before calling `driver.update()`.

```ts
import { NPCPerception } from '@alife-sdk/ai/states';
import type { IVisibleEntity, INearbyItem } from '@alife-sdk/ai/states';

class PhaserNPCContext implements IOnlineDriverHost {
  readonly perception = new NPCPerception();  // one instance, kept alive

  // Called each frame, after your scene-level perception system runs:
  refreshPerception(
    enemies: IVisibleEntity[],
    allies:  IVisibleEntity[],
    items:   INearbyItem[],
  ) {
    this.perception.sync(enemies, allies, items);
  }
}

// sync() takes three arrays:
//   enemies — hostile IVisibleEntity[]
//   allies  — friendly IVisibleEntity[]
//   items   — INearbyItem[]
```

State handlers call `perception.getVisibleEnemies()`, `hasVisibleEnemy()`,
`getVisibleAllies()`, `getNearbyItems()` — never `sync()` directly.

---

## State reference

### Human states (buildDefaultHandlerMap)

| State | Behaviour |
|-------|-----------|
| `IDLE` | Stationary. Checks perception, suspicion, conditions, pack. |
| `PATROL` | Moves through waypoints. Checks for enemies, suspicion, squad intel. |
| `ALERT` | Pauses, looks for enemy. Times out → PATROL; confirms → COMBAT. |
| `COMBAT` | Engages visible enemy. Manages weapon fire, grenades, cover, morale. |
| `TAKE_COVER` | Moves to a cover point, peeks and fires at enemy. |
| `FLEE` | Runs away. Returns when far enough (`fleeOnCalmed`). |
| `SEARCH` | Navigates to last-known enemy position, looks around. |
| `RETREAT` | Moves to FAR cover, fires suppressive shots. Morale-driven. |
| `WOUNDED` | Crawls, last-stand attempt. Returns when HP recovers or times out. |
| `GRENADE` | Short windup, throws grenade, returns to COMBAT. |
| `EVADE_GRENADE` | Sprints away from danger zone. Returns when clear. |
| `CAMP` | Patrols a fixed area / holding position. |
| `SLEEP` | Sleeps until awakened by enemy presence. |
| `DEAD` | Halts movement, disables physics. Terminal state. |

### Monster ability states (opt-in)

Monster ability states are **not** included in any factory by default.
Use `buildChornobylMonsterHandlerMap()` for the full Stalker-style preset (18 states),
or extend `buildMonsterHandlerMap()` manually for custom ability sets.

| Factory | States | COMBAT handler |
|---------|--------|---------------|
| `buildDefaultHandlerMap()` | 14 | `CombatState` (ranged, cover, grenades) |
| `buildMonsterHandlerMap()` | 14 | `MonsterCombatController` (melee only) |
| `buildChornobylMonsterHandlerMap()` | 18 | `MonsterCombatController` + `CHORNOBYL_ABILITY_SELECTOR` |

```ts
// Stalker-style preset — all 4 ability states registered and wired:
const handlers = buildChornobylMonsterHandlerMap({ meleeRange: 64 });
const driver = new OnlineAIDriver(monsterCtx, handlers, 'IDLE');
```

The ability states and their trigger conditions via `CHORNOBYL_ABILITY_SELECTOR`:

| State | Entity type | Trigger condition |
|-------|-------------|------------------|
| `CHARGE` | `boar` | dist > meleeRange |
| `STALK` | `bloodsucker` | dist > meleeRange × 2 |
| `LEAP` | `snork` | meleeRange < dist ≤ meleeRange × 3 |
| `PSI_ATTACK` | `controller` | dist > meleeRange |

| State | Behaviour |
|-------|-----------|
| `CHARGE` | Windup → sprint at target → impact damage. |
| `STALK` | Goes invisible, approaches slowly, uncloaks to strike. |
| `LEAP` | Windup → airborne arc → land at target. |
| `PSI_ATTACK` | Channels PSI damage in radius, then returns to COMBAT. |

For a custom entity-to-ability mapping, use `buildMonsterHandlerMap()` and register
only the states you need with your own `MonsterAbilitySelector`:

```ts
import { buildMonsterHandlerMap, ONLINE_STATE } from '@alife-sdk/ai/states';
import { MonsterCombatController, ChargeState } from '@alife-sdk/ai/states';
import type { MonsterAbilitySelector } from '@alife-sdk/ai/states';

const mySelector: MonsterAbilitySelector = (entityType, dist, cfg) =>
  entityType === 'rhino' && dist > cfg.meleeRange ? 'CHARGE' : null;

const handlers = buildMonsterHandlerMap({ meleeRange: 80 })
  .register(ONLINE_STATE.COMBAT, new MonsterCombatController(cfg, tr, mySelector))
  .register(ONLINE_STATE.CHARGE, new ChargeState(cfg));
```

### Opt-in states (register manually)

These states exist in the SDK but are **not** in the default maps — you opt in
by calling `.register()` and adding their transition targets:

> All opt-in transition keys (`patrolOnWoundedAlly`, `combatOnKillWounded`,
> `investigateOnEnemy`, etc.) are **already present** in `createDefaultTransitionMap()`
> with sensible defaults. You only need to override the triggering transition
> (e.g. `patrolOnSuspicious: 'INVESTIGATE'`) and register the handler.

| State | Import from | Register key | Trigger override needed |
|-------|-------------|-------------|------------------------|
| `InvestigateState` | `@alife-sdk/ai/states` | `'INVESTIGATE'` | `patrolOnSuspicious: 'INVESTIGATE'` |
| `HelpWoundedState` | `@alife-sdk/ai/states` | `'HELP_WOUNDED'` | none (defaults fire automatically) |
| `KillWoundedState` | `@alife-sdk/ai/states` | `'KILL_WOUNDED'` | none (defaults fire automatically) |
| `EatCorpseState` | `@alife-sdk/ai/states/eat-corpse` | `'EAT_CORPSE'` | wrap with `withEatCorpseGuard` |

```ts
import {
  InvestigateState,
  HelpWoundedState,
  KillWoundedState,
  createDefaultStateConfig,
  createDefaultTransitionMap,
  buildDefaultHandlerMap,
} from '@alife-sdk/ai/states';
import { EatCorpseState, withEatCorpseGuard } from '@alife-sdk/ai/states/eat-corpse';

const cfg = createDefaultStateConfig();
const tr  = createDefaultTransitionMap({
  patrolOnSuspicious: 'INVESTIGATE',   // softer than ALERT
});

const handlers = buildDefaultHandlerMap(cfg, tr)
  .register('INVESTIGATE',   new InvestigateState(cfg, tr))
  .register('HELP_WOUNDED',  new HelpWoundedState(cfg, tr))
  .register('KILL_WOUNDED',  new KillWoundedState(cfg, tr))
  .register('EAT_CORPSE',    withEatCorpseGuard(new EatCorpseState(cfg, tr), guardCfg));
```
