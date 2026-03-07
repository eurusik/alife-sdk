# @alife-sdk/ai

This package is the online behavior layer for NPCs that currently matter on screen.

If `@alife-sdk/simulation` is the background world, `@alife-sdk/ai` is the foreground behavior: what nearby NPCs do when the player can actually watch them fight, react, search, flee, or coordinate.

## Install

```bash
npm install @alife-sdk/ai @alife-sdk/core
```

## What it gives you

- `OnlineAIDriver`
- built-in state-handler maps for humans and monsters
- cover selection and cover locking
- perception, danger, suspicion, and condition patterns
- GOAP-driven decision making
- squad tactics and navigation helpers

## Add it when

- the player can observe the NPC moment to moment
- nearby NPCs need richer combat behavior than the offline simulation alone
- you want on-screen reactions like cover, search, flanking, suspicion, or GOAP-style goal selection

Do not start here on day one. Add it after your online/offline ownership model already works.

## How it fits into the SDK

```text
Far from player   -> @alife-sdk/simulation owns the NPC
Close to player   -> your engine + @alife-sdk/ai own the NPC
Leaves range      -> control returns to @alife-sdk/simulation
```

This package does not replace the simulation. It complements it.

## What you integrate

The integration shape is usually:

1. Install `AIPlugin`
2. Build one handler map for a family of NPCs
3. Create an `OnlineAIDriver` for each online NPC
4. Call `driver.update(deltaMs)` every frame

## A minimal setup

```ts
import { ALifeKernel } from '@alife-sdk/core';
import { AIPlugin } from '@alife-sdk/ai/plugin';
import {
  buildDefaultHandlerMap,
  OnlineAIDriver,
  ONLINE_STATE,
} from '@alife-sdk/ai/states';
import { SeededRandom } from '@alife-sdk/core/ports';

const kernel = new ALifeKernel();

const random = new SeededRandom(42);
const aiPlugin = new AIPlugin(random);
kernel.use(aiPlugin);
kernel.init();

const handlers = buildDefaultHandlerMap({ combatRange: 350, meleeRange: 60 });

function createOnlineDriver(npcId: string): OnlineAIDriver {
  const coverAccess = aiPlugin.createCoverAccess(npcId);
  const ctx = buildNPCContext(npcId, coverAccess); // your code
  return new OnlineAIDriver(ctx, handlers, ONLINE_STATE.IDLE);
}
```

The important part is `buildNPCContext(...)`. That is your bridge from engine objects into the narrow AI interfaces the driver expects.

## Handler maps

| Builder | Use it for |
|---|---|
| `buildDefaultHandlerMap()` | Human NPCs with ranged combat |
| `buildMonsterHandlerMap()` | Monsters with simpler melee behavior |
| `buildChornobylMonsterHandlerMap()` | Stalker-style monsters with special abilities |

The handlers are meant to be shared. Per-NPC runtime state lives in the context and state objects, not inside the handler instance.

## What `AIPlugin` does for you

`AIPlugin` owns the shared data structures that should not be rebuilt separately for every NPC:

- cover registry
- cover lock registry
- restricted zone data

That is why you install the plugin once and create per-NPC access adapters from it.

## What your game still owns

- the actual entity and animation system
- movement, physics, and scene interactions
- the concrete `INPCContext` implementation
- deciding when an NPC becomes online or offline

## Common first-time mistakes

### Creating drivers but never updating them

If `driver.update(deltaMs)` is never called, the driver does nothing.

### Adding AI before online/offline switching is stable

If you do not yet trust who owns an NPC at a given moment, adding online AI only multiplies confusion.

### Expecting external `ctx.transition()` calls to behave like a global remote control

The state machine processes transitions during its own update flow. It is better to let the driver evaluate transitions from the state/context it sees in-frame.

### Forgetting nullable subsystems

Parts of `INPCContext` can be absent. If your setup does not provide cover, perception, or another subsystem, your access patterns need to handle that cleanly.

### No cover points registered

If the cover registry is empty, cover logic cannot magically invent cover for you.

## Good order of adoption

1. Prove offline simulation first
2. Add online/offline ownership switching
3. Add one human handler map
4. Drive one online NPC with `OnlineAIDriver`
5. Only then expand into cover, GOAP, squad tactics, and richer monsters

## Read next

- [Online vs Offline](/concepts/online-offline)
- [NPC Lifecycle](/concepts/npc-lifecycle)
- [Phaser Integration](/guides/phaser-integration)
- [Package README](https://github.com/eurusik/alife-sdk/blob/main/packages/alife-ai/README.md)
