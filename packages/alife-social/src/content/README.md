# content

Text pool management — random line selection with no consecutive repeats,
keyed by `SocialCategory`.

```ts
import { ContentPool, loadSocialData } from '@alife-sdk/social/content';
```

---

## What's in this module

| Export | Kind | What it does |
|--------|------|-------------|
| `ContentPool` | class | Category-keyed pools with no-repeat random selection |
| `loadSocialData` | function | Bulk-load `ISocialData` JSON into a `ContentPool` |

---

## ContentPool

```ts
import { ContentPool } from '@alife-sdk/social/content';

const pool = new ContentPool(random); // IRandom for deterministic testing

pool.addLines('greeting_friendly', ['Привіт!', 'Здорово!', 'Слава!']);
pool.addLines('greeting_neutral',  ['Е...', 'Привіт.']);
```

### Retrieving lines

```ts
const line = pool.getRandomLine('greeting_friendly');
// → random entry, never the same as the previous pick for this category
// → null if the category doesn't exist or has no lines
```

The no-repeat guarantee: if a category has ≥ 2 lines, the same index is never
returned twice in a row. Single-line pools always return that one line.

### Checking availability

```ts
pool.hasLines('greeting_friendly'); // → true
pool.hasLines('nonexistent');       // → false
pool.size;                          // → number of populated categories
```

### Gossip keys

Faction-specific gossip pools use a compound key:

```ts
// Always use the static helper — don't construct keys manually
const key = ContentPool.gossipKey('military'); // → 'remark_gossip:military'
pool.addLines(key, ['Вояки знову шуміли.']);
pool.getRandomLine(ContentPool.gossipKey('military'));
```

### Clearing

```ts
pool.clear(); // removes all lines and cursors
```

---

## loadSocialData

Bulk-load the entire `ISocialData` structure into a pool in one call:

```ts
import { loadSocialData } from '@alife-sdk/social/content';
import socialJson from './data/social.json';

const pool = new ContentPool(random);
loadSocialData(pool, socialJson);
```

Maps the JSON fields to `SocialCategory` keys:

| JSON path | Category key |
|-----------|-------------|
| `greetings.friendly` | `greeting_friendly` |
| `greetings.neutral` | `greeting_neutral` |
| `greetings.evening` | `greeting_evening` |
| `remarks.zone` | `remark_zone` |
| `remarks.weather` | `remark_weather` |
| `remarks.gossip[faction]` | `remark_gossip:{faction}` |
| `campfire.stories` | `campfire_story` |
| `campfire.jokes` | `campfire_joke` |
| `campfire.reactions.laughter` | `campfire_laughter` |
| `campfire.reactions.story_react` | `campfire_story_react` |
| `campfire.reactions.eating` | `campfire_eating` |
| `custom[key]` | `{key}` (verbatim) |

`addLines` silently skips empty arrays, so missing JSON sections are safe.
