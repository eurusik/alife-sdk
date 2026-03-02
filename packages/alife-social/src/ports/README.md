# ports

Host-side contracts the social SDK calls into — rendering bubbles and querying
online NPC data.

```ts
import { SocialPorts } from '@alife-sdk/social/ports';
import type { ISocialPresenter, INPCSocialProvider } from '@alife-sdk/social/ports';
```

---

## What's in this module

| Export | Kind | What it does |
|--------|------|-------------|
| `SocialPorts` | const | Port tokens for kernel registration |
| `ISocialPresenter` | interface | Renders speech bubbles (host implements) |
| `INPCSocialProvider` | interface | Supplies online NPC data (host implements) |

---

## ISocialPresenter

Called by the plugin whenever a bubble needs to appear above an NPC:

```ts
interface ISocialPresenter {
  showBubble(npcId: string, text: string, durationMs: number): void;
}
```

Minimal implementation for Phaser:

```ts
const presenter: ISocialPresenter = {
  showBubble(npcId, text, durationMs) {
    const sprite = scene.npcSprites.get(npcId);
    if (sprite) new SocialBubble(scene, sprite.x, sprite.y - 40, text, durationMs);
  },
};
```

---

## INPCSocialProvider

Called by the plugin to determine which NPCs are eligible for social interactions:

```ts
interface INPCSocialProvider {
  getOnlineNPCs(): readonly ISocialNPC[];
  areFactionsFriendly(factionA: string, factionB: string): boolean;
  areFactionsHostile(factionA: string, factionB: string): boolean;
  getNPCTerrainId(npcId: string): string | null;
}
```

Minimal implementation:

```ts
const provider: INPCSocialProvider = {
  getOnlineNPCs() {
    return Array.from(onlineNPCs.values()).map(e => ({
      id:        e.getData('npcId'),
      position:  { x: e.x, y: e.y },
      factionId: e.getData('factionId'),
      state:     e.getData('aiState'),
    }));
  },
  areFactionsFriendly: (a, b) => factions.getRelation(a, b) > 0,
  areFactionsHostile:  (a, b) => factions.getRelation(a, b) < -30,
  getNPCTerrainId:     (id)   => sim.getNPCBrain(id)?.currentTerrainId ?? null,
};
```

---

## SocialPorts

Port tokens for kernel registration:

```ts
// Register before kernel.init()
kernel.portRegistry.register(SocialPorts.SocialPresenter,   presenter);
kernel.portRegistry.register(SocialPorts.NPCSocialProvider, provider);
```

Both ports are **optional** — the plugin checks for them with `tryGet()` and
silently skips updates if either is absent. This lets you run the plugin
without a renderer (e.g. headless tests).

---

## Responsibility boundary

```
SDK (social package)          Host (your engine)
────────────────────          ──────────────────
Evaluates eligibility    ←→   INPCSocialProvider
Selects text from pool         (getOnlineNPCs, areFactionsFriendly,
Computes bubble duration        areFactionsHostile, getNPCTerrainId)
Emits IBubbleRequest     →→   ISocialPresenter.showBubble()
                               (sprite lookup, animation, audio)
```
