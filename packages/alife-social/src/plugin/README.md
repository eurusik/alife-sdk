# plugin

`SocialPlugin` — the single `IALifePlugin` that wires greeting, remark, and
campfire subsystems into the SDK kernel.

```ts
import { SocialPlugin } from '@alife-sdk/social/plugin';
import type { ISocialPluginConfig } from '@alife-sdk/social/plugin';
```

---

## What's in this module

| Export | Kind | What it does |
|--------|------|-------------|
| `SocialPlugin` | class | Main plugin — owns all social subsystems |
| `ISocialPluginConfig` | interface | `{ social?: ISocialConfigOverrides, data?: ISocialData }` |

---

## Setup

```ts
import { SocialPlugin } from '@alife-sdk/social/plugin';
import { SocialPorts }  from '@alife-sdk/social/ports';
import socialJson from './data/social.json';

// 1. Register ports before kernel.init()
kernel.portRegistry.register(SocialPorts.SocialPresenter,   presenter);
kernel.portRegistry.register(SocialPorts.NPCSocialProvider, provider);

// 2. Register the plugin
kernel.use(new SocialPlugin(random, {
  data:   socialJson,              // ISocialData — text content
  social: {                        // ISocialConfigOverrides — optional
    meet:   { meetDistance: 200 },
    remark: { remarkChance: 0.4 },
  },
}));

kernel.init();
kernel.start();
```

No plugin dependencies — `SocialPlugin.dependencies` is empty. It reads NPC
data exclusively through `INPCSocialProvider` and renders through `ISocialPresenter`.

---

## Subsystem access

The plugin exposes its subsystems for direct use:

```ts
const social = kernel.getPlugin<SocialPlugin>('social');

// Manual greeting check (e.g. for dialogue trigger)
const bubbles = social.meetOrchestrator.update({ ... });

// Force a remark (e.g. from a game event)
social.contentPool.addLines('remark_custom', ['Сподіваюсь вижити...']);
social.remarkDispatcher.update(0, [npc], getTerrainId);
```

---

## Tick loop

`SocialPlugin.update(deltaMs)` is called automatically by `kernel.update()`.
It runs three passes every frame:

| What | Cadence |
|------|---------|
| `RemarkDispatcher.update()` | Every frame (internally gated by `remarkCheckIntervalMs`) |
| Campfire participant sync | Every `syncIntervalMs` (default 3 s) |
| `CampfireFSM.update()` per session | Every frame |

The greeting system (`MeetOrchestrator`) is **not** called automatically —
the host drives it to control target position (player coordinates):

```ts
// In your game loop, after kernel.update():
const bubbles = social.meetOrchestrator.update({
  deltaMs,
  targetX:         player.x,
  targetY:         player.y,
  currentTime:     Date.now(),
  npcs:            provider.getOnlineNPCs(),
  isHostile:       (a, b) => factions.isHostile(a, b),
  isAlly:          (a, b) => factions.isAlly(a, b),
  targetFactionId: 'loner',
});
for (const b of bubbles) presenter.showBubble(b.npcId, b.text, b.durationMs);
```

---

## Campfire sessions

Sessions are created and destroyed automatically:

- **Created** when ≥ `minParticipants` NPCs in state `gatheringStates` share a terrain
- **Synced** every `syncIntervalMs` — participant list refreshed each sync
- **Destroyed** when the terrain drops below `minParticipants`

```ts
// Override which NPC states count as "gathering" (default: ['camp'])
const config = createDefaultSocialConfig({
  campfire: { gatheringStates: ['camp', 'rest', 'sleep'] },
});
```

---

## Serialisation

`SocialPlugin.serialize()` returns only the list of active campfire terrain IDs.
`restore()` is a no-op — campfire sessions reconstruct from live NPC positions
on the next sync tick. No save/load ceremony needed.
