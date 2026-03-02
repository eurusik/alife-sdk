# types

Value objects, config interfaces, and shared constants for the social
interaction subsystem.

```ts
import {
  SocialCategory, CampfireState, CampfireRole,
  createDefaultSocialConfig,
} from '@alife-sdk/social/types';
import type {
  ISocialNPC, ISocialData, IBubbleRequest,
  ISocialConfig, IMeetConfig, IRemarkConfig, ICampfireConfig,
} from '@alife-sdk/social/types';
```

---

## What's in this module

| Export | Kind | What it does |
|--------|------|-------------|
| `SocialCategory` | const object | Text pool category keys (greeting, remark, campfire) |
| `CampfireState` | const object | Campfire FSM state constants |
| `CampfireRole` | const object | Director / Audience role constants |
| `ISocialNPC` | interface | Minimal NPC data for social evaluation |
| `ISocialData` | interface | Content JSON shape (greetings, remarks, campfire, custom) |
| `IBubbleRequest` | interface | Bubble display request emitted by social systems |
| `ISocialConfig` | interface | Root config (meet + remark + campfire + optional FSM factory) |
| `IMeetConfig` | interface | Greeting system tuning |
| `IRemarkConfig` | interface | Ambient remark system tuning |
| `ICampfireConfig` | interface | Campfire FSM tuning |
| `ISocialConfigOverrides` | interface | Partial overrides passed to `createDefaultSocialConfig` |
| `DEFAULT_REMARK_ELIGIBLE_STATES` | const | `['idle', 'patrol', 'camp']` |
| `createDefaultSocialConfig` | function | Production config with sensible defaults |

---

## SocialCategory

Open string union — use the provided constants or add your own:

```ts
SocialCategory.GREETING_FRIENDLY   // 'greeting_friendly'
SocialCategory.GREETING_NEUTRAL    // 'greeting_neutral'
SocialCategory.GREETING_EVENING    // 'greeting_evening'
SocialCategory.REMARK_ZONE         // 'remark_zone'
SocialCategory.REMARK_WEATHER      // 'remark_weather'
SocialCategory.REMARK_GOSSIP       // 'remark_gossip'  (base key, use ContentPool.gossipKey(factionId) for per-faction)
SocialCategory.CAMPFIRE_STORY      // 'campfire_story'
SocialCategory.CAMPFIRE_JOKE       // 'campfire_joke'
SocialCategory.CAMPFIRE_LAUGHTER   // 'campfire_laughter'
SocialCategory.CAMPFIRE_STORY_REACT// 'campfire_story_react'
SocialCategory.CAMPFIRE_EATING     // 'campfire_eating'
```

Custom categories can be added via `ISocialData.custom` or directly via `ContentPool.addLines()`.

---

## ISocialData

The content JSON shape. Load with `loadSocialData(pool, data)`:

```ts
const data: ISocialData = {
  greetings: {
    friendly: ['Привіт, сталкере!', 'Здорово!'],
    neutral:  ['Е-е... привіт.'],
    evening:  ['Тихо сьогодні...'],
  },
  remarks: {
    zone:    ['Зона нині спокійна.', 'Що за ніч...'],
    weather: ['Туман густий сьогодні.'],
    gossip:  { military: ['Вояки знову патрулюють.'] },
  },
  campfire: {
    stories:  ['Чув про той схрон на болоті?'],
    jokes:    ['Чому сталкер не спить?'],
    reactions: {
      laughter:    ['Хаха!', 'Та ну!'],
      story_react: ['Серйозно?'],
      eating:      ['Смачно...'],
    },
  },
  // Optional: any extra categories
  custom: {
    'remark_threat': ['Схоже щось наближається.'],
  },
};
```

---

## IBubbleRequest

The object returned by every social subsystem — pass it to `ISocialPresenter.showBubble()`:

```ts
interface IBubbleRequest {
  readonly npcId:     string;
  readonly text:      string;
  readonly durationMs: number;  // 2s minimum + 80ms/char
  readonly category:  SocialCategory;
}
```

---

## ISocialConfig defaults

| Section | Field | Default |
|---------|-------|---------|
| `meet` | `meetDistance` | `150` px |
| `meet` | `meetCooldownMs` | `60_000` |
| `meet` | `meetCheckIntervalMs` | `500` |
| `remark` | `remarkCooldownMinMs` | `30_000` |
| `remark` | `remarkCooldownMaxMs` | `60_000` |
| `remark` | `remarkCheckIntervalMs` | `5_000` |
| `remark` | `remarkChance` | `0.3` |
| `remark` | `weightZone` | `0.4` |
| `remark` | `weightWeatherCumulative` | `0.7` |
| `remark` | `terrainLockDurationMs` | `10_000` |
| `campfire` | `minParticipants` | `2` |
| `campfire` | `syncIntervalMs` | `3_000` |
| `campfire` | `idleDurationMinMs` | `10_000` |
| `campfire` | `idleDurationMaxMs` | `20_000` |
| `campfire` | `storyDurationMinMs` | `8_000` |
| `campfire` | `storyDurationMaxMs` | `15_000` |
| `campfire` | `jokeDurationMinMs` | `5_000` |
| `campfire` | `jokeDurationMaxMs` | `8_000` |
| `campfire` | `eatingDurationMinMs` | `5_000` |
| `campfire` | `eatingDurationMaxMs` | `10_000` |
| `campfire` | `reactionDurationMinMs` | `3_000` |
| `campfire` | `reactionDurationMaxMs` | `5_000` |
| `campfire` | `reactionStaggerMs` | `500` |
| `campfire` | `eatingChance` | `0.6` |
| `campfire` | `weightStory` | `0.35` |
| `campfire` | `weightJokeCumulative` | `0.65` |

### Custom FSM factory

Replace the built-in `CampfireFSM` with your own gathering behavior:

```ts
const config = createDefaultSocialConfig({
  createGatheringFSM: (terrainId) => new TavernFSM(terrainId, tavernConfig),
});
```

The factory is called once per terrain session; the plugin calls
`setParticipants()` right after and `update()` each tick.
