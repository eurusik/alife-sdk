# AI States and Driver

Use this page when you need to wire one observed NPC into the online AI runtime.

This is the main contract behind `@alife-sdk/ai`: one driver per NPC, one shared handler map per NPC family, and one host context that bridges your engine into the SDK.

## Import path

```ts
import {
  OnlineAIDriver,
  buildDefaultHandlerMap,
  buildMonsterHandlerMap,
  ONLINE_STATE,
  createDefaultNPCOnlineState,
  createDefaultTransitionMap,
  createDefaultStateConfig,
} from "@alife-sdk/ai/states";
import type {
  IOnlineDriverHost,
  INPCContext,
  INPCOnlineState,
  IOnlineStateHandler,
  IStateTransitionMap,
  IStateConfig,
} from "@alife-sdk/ai/states";
```

## What you create

For a typical scene you create:

1. one shared handler map for a class of NPCs
2. one `createDefaultNPCOnlineState()` per NPC
3. one `IOnlineDriverHost` implementation per NPC
4. one `OnlineAIDriver` per online NPC

## What the SDK owns

The SDK owns:

- the finite-state-machine loop
- state enter/update/exit flow
- built-in handlers
- transition plumbing
- default config and transition maps

## What your game owns

Your game owns:

- scene objects and physics
- movement commands
- health/perception/cover bridges
- emitters for bullets, melee hits, vocalization, effects
- the policy for when an NPC becomes online or offline

## The core rule

Handlers are stateless singletons.

Per-NPC mutable state lives in `ctx.state`, not inside the handler instance.

If you break this rule, multi-NPC bugs become unavoidable.

## Minimal setup

```ts
import {
  OnlineAIDriver,
  buildDefaultHandlerMap,
  createDefaultNPCOnlineState,
  ONLINE_STATE,
} from "@alife-sdk/ai/states";
import type { IOnlineDriverHost } from "@alife-sdk/ai/states";

const handlers = buildDefaultHandlerMap();

class MyNPCContext implements IOnlineDriverHost {
  readonly npcId = "npc_001";
  readonly factionId = "bandits";
  readonly entityType = "npc";
  readonly state = createDefaultNPCOnlineState();

  readonly perception = myPerception ?? null;
  readonly health = myHealth ?? null;
  readonly cover = myCoverAccess ?? null;
  readonly danger = myDangerAccess ?? null;
  readonly restrictedZones = null;
  readonly squad = null;
  readonly pack = null;
  readonly conditions = null;
  readonly suspicion = null;

  get x() { return this.sprite.x; }
  get y() { return this.sprite.y; }

  setVelocity(vx: number, vy: number) { this.sprite.body.setVelocity(vx, vy); }
  halt() { this.sprite.body.setVelocity(0, 0); }
  setRotation(r: number) { this.sprite.setRotation(r); }
  setAlpha(a: number) { this.sprite.setAlpha(a); }
  teleport(x: number, y: number) { this.sprite.setPosition(x, y); }
  disablePhysics() { this.sprite.body.enable = false; }

  emitShoot(payload: unknown) { projectileSystem.spawn(payload); }
  emitMeleeHit(payload: unknown) { damageSystem.applyMelee(payload); }
  emitVocalization(type: string) { audioSystem.play(this.npcId, type); }
  emitPsiAttackStart(x: number, y: number) { effectSystem.psiAoe(x, y); }

  now() { return this.scene.time.now; }
  random() { return Math.random(); }
}

const ctx = new MyNPCContext();
const driver = new OnlineAIDriver(ctx, handlers, ONLINE_STATE.IDLE);

function update(deltaMs: number) {
  driver.update(deltaMs);
}
```

## Runtime call order

The minimum healthy runtime order is:

1. host decides the NPC is online
2. host ensures perception/health/cover state is current enough for this frame
3. host calls `driver.update(deltaMs)`
4. handlers read `ctx`, mutate `ctx.state`, and request transitions when needed
5. host reacts to emitted effects like shooting or melee outside the driver

## `IOnlineDriverHost` vs `INPCContext`

You implement `IOnlineDriverHost`, not `INPCContext` directly.

Why:

- the driver injects `transition()`
- the driver injects `currentStateId`

That keeps the driver in control of state transitions instead of forcing the host to fake FSM internals.

## Required host surface

Every host must provide:

- identity: `npcId`, `factionId`, `entityType`
- position: `x`, `y`
- state bag: `state`
- movement: `setVelocity`, `halt`, `setRotation`
- visibility/physics control: `setAlpha`, `teleport`, `disablePhysics`
- outward effects: `emitShoot`, `emitMeleeHit`, `emitVocalization`, `emitPsiAttackStart`
- utilities: `now()`, `random()`

## Optional subsystems

These can return `null` when the feature is not wired yet:

- `perception`
- `health`
- `cover`
- `danger`
- `restrictedZones`
- `squad`
- `pack`
- `conditions`
- `suspicion`

This is the intended feature-flag seam. Missing subsystems should be explicit `null`, not hidden assumptions.

## Which handler map to use

| Builder | Use it for |
|---|---|
| `buildDefaultHandlerMap()` | human NPCs, ranged combat, cover, morale, grenades |
| `buildMonsterHandlerMap()` | simpler monster combat model |

Build the handler map once per scene or config variant, not once per NPC.

## Built-in state IDs you will use most

| State | Meaning |
|---|---|
| `IDLE` | resting or waiting |
| `PATROL` | waypoint or roaming movement |
| `ALERT` | enemy suspected or briefly confirmed |
| `COMBAT` | direct engagement |
| `TAKE_COVER` | reposition to cover and fight from there |
| `SEARCH` | move toward last known position |
| `FLEE` | full break due to morale or pressure |
| `RETREAT` | tactical fallback, usually while still combat-aware |
| `WOUNDED` | low-health degraded behavior |
| `DEAD` | terminal state |

## Config and transition overrides

Use `createDefaultStateConfig()` when you need tuning.

Use `createDefaultTransitionMap()` when you need to rename or reroute state flow.

That is the intended way to adapt behavior without forking the built-in handlers.

## State bag fields worth knowing

You do not usually mutate these fields manually, but they are worth knowing for debugging:

- `targetId`
- `morale`
- `moraleState`
- `isAlert`
- `hasTakenCover`
- `primaryWeapon`
- `grenadeCount`

If behavior looks wrong, these are often the first values worth inspecting in a debug overlay.

## Failure patterns

- `driver.update(deltaMs)` is never called
- one mutable state bag is accidentally shared across several NPCs
- host flips an NPC online, but perception/health/cover context is still stale
- handlers are rebuilt per NPC and stop being shared stateless logic
- the host tries to manage transitions externally instead of letting the driver own them

## Related pages

- [AI package](/docs/packages/ai)
- [AI Perception](/docs/reference/ai/perception)
- [AI Cover](/docs/reference/ai/cover)
- [Phaser OnlineOfflineManager](/docs/reference/phaser/online-offline-manager)
- [Online vs Offline](/docs/concepts/online-offline)
