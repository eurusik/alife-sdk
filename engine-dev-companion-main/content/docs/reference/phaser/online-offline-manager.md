# OnlineOfflineManager

Use this page when you need a deterministic boundary between observed Phaser NPCs and cheap offline simulation.

This module has two seams:

- `OnlineOfflineManager` decides which NPC IDs should switch ownership
- `PhaserNPCContext` exposes one Phaser-hosted NPC through the framework-agnostic AI context expected by `@alife-sdk/ai`

## Import path

```ts
import { OnlineOfflineManager, PhaserNPCContext } from "@alife-sdk/phaser/online";
import type {
  IPhaserNPCHost,
  IPhaserNPCSystemBundle,
} from "@alife-sdk/phaser/online";
```

## What you create

In a normal scene integration you create:

1. one `OnlineOfflineManager`
2. one `PhaserNPCContext` per online NPC
3. one host object implementing `IPhaserNPCHost`
4. optional subsystem bundle for perception, health, cover, danger, restricted zones, and squad access

## Minimal setup

### Switching example

```ts
const switching = new OnlineOfflineManager({
  switchDistance: 700,
  hysteresisFactor: 0.15,
});

function updateOwnership(records: IOnlineRecord[]) {
  const { goOnline, goOffline } = switching.evaluate(
    player.x,
    player.y,
    records,
    (npcId) => squadManager.getMemberIds(npcId),
  );

  for (const id of goOnline) {
    bringNPCOnline(id);
  }

  for (const id of goOffline) {
    sendNPCOffline(id);
  }
}
```

### AI context example

```ts
class EnemyHost implements IPhaserNPCHost {
  readonly npcId = "enemy_1";
  readonly factionId = "bandit";
  readonly entityType = "npc";

  constructor(private readonly sprite: Phaser.Physics.Arcade.Sprite) {}

  getX() { return this.sprite.x; }
  getY() { return this.sprite.y; }
  setVelocity(vx: number, vy: number) { this.sprite.setVelocity(vx, vy); }
  halt() { this.sprite.setVelocity(0, 0); }
  setRotation(radians: number) { this.sprite.setRotation(radians); }
  setAlpha(alpha: number) { this.sprite.setAlpha(alpha); }
  teleport(x: number, y: number) { this.sprite.setPosition(x, y); }
  disablePhysics() { this.sprite.disableBody(true, false); }
  getCurrentStateId() { return "IDLE"; }
  onTransitionRequest() {}
  onShoot() {}
  onMeleeHit() {}
  onVocalization() {}
  onPsiAttackStart() {}
  now() { return performance.now(); }
  random() { return Math.random(); }
}

const context = new PhaserNPCContext(
  new EnemyHost(sprite),
  createDefaultNPCOnlineState(),
  {
    perception,
    health,
    cover,
  },
);
```

## `OnlineOfflineManager` contract

The manager is a pure evaluator.

It does not:

- mutate scene state
- spawn or destroy NPCs
- build AI drivers

It returns:

- `goOnline`
- `goOffline`

Your scene code must apply those transitions.

## Hysteresis rule

The manager uses two thresholds, not one.

That means:

- offline NPCs need to get close enough to cross the online threshold
- online NPCs need to get far enough to cross the offline threshold
- NPCs inside the band keep their current state

This prevents ownership thrashing near the player boundary.

## Squad-aware switching

If you pass a squad resolver, the manager evaluates squads atomically:

- one member entering the online threshold can bring the whole squad online
- a squad only goes offline when all relevant members are beyond the offline threshold

Use this when squad behavior or combat coherence matters more than per-NPC independence.

## `PhaserNPCContext` contract

`PhaserNPCContext` is the seam between one live Phaser host and the AI state machine.

`IPhaserNPCHost` must cover:

- identity
- position
- movement
- rotation
- rendering alpha
- teleport/disable physics
- state query and transition request
- gameplay callbacks like shoot, melee, vocalization, psi attack
- time/random utilities

`IPhaserNPCSystemBundle` is optional. Missing systems degrade to `null`, which lets handlers fall back instead of forcing every project to wire every subsystem at once.

## Lifecycle

The healthy order is:

1. evaluate ownership on a throttled cadence
2. when an NPC goes online, create or reuse its `PhaserNPCContext`
3. update the `OnlineAIDriver` while the NPC stays online
4. when it goes offline, persist the state you need and stop paying online update cost

## Failure patterns

- calling `evaluate()` but never applying `goOnline` and `goOffline`
- running ownership switching every frame without a real need
- using one hard threshold and reintroducing flicker outside the manager
- ignoring squad cohesion and splitting one tactical group across two ownership models
- creating `PhaserNPCContext` without the host methods that the online state layer expects

## Related pages

- [Phaser package](/docs/packages/phaser)
- [createPhaserKernel](/docs/reference/phaser/create-phaser-kernel)
- [Phaser Adapters](/docs/reference/phaser/adapters)
- [AI States and Driver](/docs/reference/ai/states)
