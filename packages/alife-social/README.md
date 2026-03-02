# @alife-sdk/social

NPC social interaction systems — proximity greetings, ambient idle remarks,
and campfire group storytelling sessions.
Framework-free: rendering and NPC data are supplied by host-side ports.

Depends on @alife-sdk/core

---

## Install

```
npm install @alife-sdk/social
```

---

## Quick start

```ts
import { SocialPlugin }  from '@alife-sdk/social/plugin';
import { SocialPorts }   from '@alife-sdk/social/ports';
import { Plugins }       from '@alife-sdk/core/plugins';

// ISocialData — the shape your social.json must match:
const socialJson = {
  greetings: {
    friendly: ['Hey, good to see you!', 'Morning, stalker.'],
    neutral:  ['Hmm.', 'Move along.'],
    evening:  ['Getting late…', 'Stay safe out there.'],
  },
  remarks: {
    zone:    ['Something feels off around here.', 'Watch your step.'],
    weather: ['Rain again.', 'Sky looks ugly today.'],
    gossip:  {
      default: ['Heard a squad went missing near the factory.'],
    },
  },
  campfire: {
    stories:   ['Back in \'03 I saw something in the fog…'],
    jokes:     ['Why did the stalker cross the road? He didn\'t — the road crossed him.'],
    reactions: {
      laughter:    ['Ha! Good one.'],
      story_react: ['Gives me chills every time.'],
      eating:      ['*eating sounds*'],
    },
  },
  // custom: { my_category: ['Line A', 'Line B'] },  // optional extra pools
};

// 1. Implement the two required ports
kernel.portRegistry.register(SocialPorts.SocialPresenter, {
  showBubble(npcId, text, durationMs) {
    const sprite = scene.npcSprites.get(npcId);
    if (sprite) new SocialBubble(scene, sprite.x, sprite.y - 40, text, durationMs);
  },
});

kernel.portRegistry.register(SocialPorts.NPCSocialProvider, {
  getOnlineNPCs()              { return [...onlineNPCs.values()].map(toISocialNPC); },
  areFactionsFriendly(a, b)    { return factions.getRelation(a, b) > 0; },
  areFactionsHostile(a, b)     { return factions.getRelation(a, b) < -30; },
  getNPCTerrainId(id)          { return sim.getNPCBrain(id)?.currentTerrainId ?? null; },
});
// ISocialNPC is defined in @alife-sdk/social/types. It is the minimal NPC
// descriptor the social system needs: { id, position: Vec2, factionId, state }.
// Your host constructs these on the fly inside getOnlineNPCs() — the SDK never
// holds a reference to your full NPC objects.

// 2. Register the plugin with your content data
kernel.use(new SocialPlugin(random, { data: socialJson }));
kernel.init();

// 3. Drive greetings from the player position each frame
const social = kernel.getPlugin(Plugins.SOCIAL);
function gameLoop(deltaMs: number) {
  kernel.update(deltaMs); // runs remarks + campfire automatically

  const bubbles = social.meetOrchestrator.update({
    deltaMs, targetX: player.x, targetY: player.y,
    currentTime: Date.now(), npcs: provider.getOnlineNPCs(),
    isHostile: (a, b) => factions.isHostile(a, b),
    isAlly:    (a, b) => factions.isAlly(a, b),
    targetFactionId: 'loner',
  });
  for (const b of bubbles) presenter.showBubble(b.npcId, b.text, b.durationMs);
}
```

---

## Sub-paths

| Import path | What it contains |
|-------------|-----------------|
| `@alife-sdk/social/plugin` | `SocialPlugin` — kernel entry point |
| `@alife-sdk/social/types` | `SocialCategory`, `CampfireState`, `ISocialData`, `ISocialConfig`, `IBubbleRequest` |
| `@alife-sdk/social/ports` | `SocialPorts`, `ISocialPresenter`, `INPCSocialProvider` |
| `@alife-sdk/social/content` | `ContentPool`, `loadSocialData` |
| `@alife-sdk/social/meet` | `MeetOrchestrator`, `isMeetEligible`, `selectGreetingCategory` |
| `@alife-sdk/social/remark` | `RemarkDispatcher` |
| `@alife-sdk/social/campfire` | `CampfireFSM`, `CampfireParticipants`, `IGatheringFSM` |

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  SocialPlugin                   │
│                                                 │
│  Every frame (via kernel.update):               │
│  ┌──────────────────┬──────────────────────┐    │
│  │ RemarkDispatcher │ CampfireFSM per       │    │
│  │ (gated by        │ terrain (gated by     │    │
│  │  check interval) │  sync interval)       │    │
│  └──────────────────┴──────────────────────┘    │
│                                                 │
│  Host-driven (call manually):                   │
│  ┌──────────────────────────────────────────┐   │
│  │  MeetOrchestrator (player position)      │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
       │ ports                  │ bubble output
       ▼                        ▼
┌──────────────────┐   ┌──────────────────────┐
│ INPCSocialProvider│   │  ISocialPresenter    │
│  getOnlineNPCs   │   │  showBubble(id,       │
│  areFriendly     │   │    text, durationMs)  │
│  areHostile      │   └──────────────────────┘
│  getTerrainId    │
└──────────────────┘
```

---

## Key concepts

### Three interaction types

| System | Trigger | Who speaks | Content |
|--------|---------|-----------|---------|
| **Meet** | NPC within `meetDistance` of target | That NPC | Greeting by faction/state |
| **Remark** | Random check every 5 s | One NPC per terrain | Zone, weather, or gossip |
| **Campfire** | ≥ 2 NPCs in `gatheringStates` share a terrain | Director then audience | Story/joke/eating cycle |

### Content pool

All text is loaded from `ISocialData` JSON into a `ContentPool` at startup.
No-repeat selection: the same line is never picked twice in a row per category.
Add custom categories via `ISocialData.custom` or `pool.addLines()` at runtime.

### Custom gathering FSM

Replace the built-in campfire with your own group behavior:

```ts
kernel.use(new SocialPlugin(random, {
  data: socialJson,
  social: {
    createGatheringFSM: (terrainId) => new TavernFSM(terrainId, tavernConfig),
  },
}));
```

`TavernFSM` only needs to implement `IGatheringFSM` (3 methods).

### Bubble duration

Computed automatically: `max(2000ms, text.length × 80ms)`.
The host receives `durationMs` in every `IBubbleRequest` and should use it to
control animation/auto-dismiss timing.

---

## Testing

The package has **198 tests** (vitest). Run them:

```
pnpm --filter @alife-sdk/social test
```

All subsystems are pure — no kernel needed for unit tests:

```ts
import { MeetOrchestrator } from '@alife-sdk/social/meet';
import { ContentPool } from '@alife-sdk/social/content';

const pool = new ContentPool();
pool.addLines('greeting.friendly', ['Hello!', 'Hey there!']);

const orchestrator = new MeetOrchestrator(pool, { /* config */ });
const bubbles = orchestrator.update({ npcs: [...], player: { x: 0, y: 0 } });

## See also

- [`@alife-sdk/simulation`](../alife-simulation/README.md) — offline NPC simulation that drives which NPCs are active
- [`@alife-sdk/ai`](../alife-ai/README.md) — online AI plugin that provides NPC proximity and line-of-sight for social triggers
- [`@alife-sdk/phaser`](../alife-phaser/README.md) — includes `PhaserNPCSocialProvider` and `PhaserSocialPresenter` adapters
```
