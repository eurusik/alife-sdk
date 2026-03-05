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
  getOnlineNPCs() {
    // ISocialNPC shape: { id: string, position: { x, y }, factionId: string, state: string }
    // Construct on the fly — the SDK never holds a reference to your full NPC objects.
    return [...onlineNPCs.values()].map(npc => ({
      id:        npc.id,
      position:  { x: npc.worldX, y: npc.worldY },
      factionId: npc.faction,
      state:     npc.aiState,   // e.g. 'idle', 'patrol', 'camp', 'dead'
    }));
  },
  areFactionsFriendly(a, b)    { return factions.getRelation(a, b) > 0; },
  areFactionsHostile(a, b)     { return factions.getRelation(a, b) < -30; },
  getNPCTerrainId(id)          { return sim.getNPCBrain(id)?.currentTerrainId ?? null; },
});

// Both ports are required. If either is missing, the plugin will not emit bubbles.

// INPCSocialProvider method contracts:
//   getOnlineNPCs() returns []     → no remarks or campfires are triggered (graceful no-op).
//   getNPCTerrainId() returns null → that NPC is excluded from remark terrain grouping
//                                    and from campfire participant discovery.

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
  // b.category is also available (SocialCategory) for custom styling/filtering
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

### Greeting selection

`selectGreetingCategory` picks the greeting pool using this priority chain:

1. **State override** — if the NPC's `state` matches a key in `stateGreetingMap`, that category wins.
   Default map: `{ camp: 'greeting_evening', sleep: 'greeting_evening' }`.
2. **Faction ally** — if `isAlly(npcFactionId, targetFactionId)` returns true (or factions match), use `greeting_friendly`.
3. **Fallback** — use `greeting_neutral`.

You can supply a custom `stateGreetingMap` via `IMeetConfig.stateGreetingMap` to add or override state entries without touching the fallback logic.

### Content pool

All text is loaded from `ISocialData` JSON into a `ContentPool` at startup.
No-repeat selection: the same line is never picked twice in a row per category.
Add custom categories via `ISocialData.custom` or `pool.addLines()` at runtime.

### Configuration tuning

All defaults come from `createDefaultSocialConfig()`. Pass overrides via the `social` key of `ISocialPluginConfig`.

| Parameter | Default | Effect |
|-----------|---------|--------|
| `meet.meetDistance` | `150` px | Radius around the target in which an NPC triggers a greeting |
| `meet.meetCooldownMs` | `60 000` ms | Per-NPC silence window after a greeting fires |
| `remark.remarkChance` | `0.3` | Probability (0–1) that an eligible NPC speaks on each check interval |
| `remark.remarkCheckIntervalMs` | `5 000` ms | How often the remark system evaluates candidates |
| `campfire.weightStory` | `0.35` | Weight for the STORY branch in the idle→next transition |
| `campfire.weightJokeCumulative` | `0.65` | Cumulative weight for JOKE (i.e. joke probability = 0.65 − 0.35 = 0.30) |

Practical tips:

- **Lower `meetCooldownMs`** (e.g. `20_000`) for more frequent greetings in busy social hubs.
- **Raise `remarkChance`** (e.g. `0.6`) for noisier zones where NPCs should feel chatty.
- **Lower `remarkCheckIntervalMs`** to make NPCs react to events faster, at the cost of slightly more CPU per second.
- **Adjust `weightStory` / `weightJokeCumulative`** to shift the campfire mood — higher `weightStory` means more dramatic sessions, narrowing the gap between them increases joke frequency.

```ts
kernel.use(new SocialPlugin(random, {
  data: socialJson,
  social: {
    meet:   { meetCooldownMs: 20_000 },          // greet more often
    remark: { remarkChance: 0.6 },               // busier zones
  },
}));
```

---

### Save/load integration

`SocialPlugin` exposes `serialize()` and `restore()` for seamless save/load support.

**What IS persisted:**

- Per-NPC greeting cooldowns (`meetCooldowns`) — prevents NPCs from re-greeting immediately after a load.
- Per-NPC remark cooldowns (`remarkCooldowns`) — preserves the time-independent remaining cooldown so NPCs don't burst-speak on resume.

**What is NOT persisted:**

- Campfire sessions — they are transient and auto-reconstruct from live NPC positions on the next sync tick (within `syncIntervalMs`, default 3 s).

```ts
// On save
const saveData = {
  social: kernel.getPlugin(Plugins.SOCIAL).serialize(),
  // ...other plugin saves
};
fs.writeFileSync('save.json', JSON.stringify(saveData));

// On load
const saveData = JSON.parse(fs.readFileSync('save.json', 'utf8'));
kernel.getPlugin(Plugins.SOCIAL).restore(saveData.social);
```

The `serialize()` return shape:

```ts
{
  campfireTerrains: string[];                 // informational only — not restored
  meetCooldowns:   Array<[npcId, expiryTs]>; // absolute timestamps (ms)
  remarkCooldowns: Array<[npcId, remainMs]>; // remaining ms (time-independent)
}
```

---

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

### Campfire state machine

The built-in `CampfireFSM` cycles through five states:

```
IDLE ──(weighted roll)──► STORY   ──► REACTING ──► IDLE
                     └──► JOKE    ──► REACTING ──┘
                     └──► EATING  ──────────────► IDLE
```

Transition weights (defaults, all configurable):

| From IDLE | Weight | Cumulative |
|-----------|--------|------------|
| STORY     | 0.35   | 0–0.35     |
| JOKE      | 0.30   | 0.35–0.65  |
| EATING    | 0.35   | 0.65–1.0   |

Default timing ranges:

| State     | Min     | Max     |
|-----------|---------|---------|
| IDLE      | 10 000 ms | 20 000 ms |
| STORY     | 8 000 ms  | 15 000 ms |
| JOKE      | 5 000 ms  | 8 000 ms  |
| EATING    | 5 000 ms  | 10 000 ms |
| REACTING  | 3 000 ms  | 5 000 ms  |

Audience reactions are staggered by `reactionStaggerMs` (default 500 ms) so bubbles
don't all appear at once. After a JOKE the reaction pool is `campfire_laughter`;
after a STORY it is `campfire_story_react`.

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
