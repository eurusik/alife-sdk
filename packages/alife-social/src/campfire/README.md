# campfire

Group social session system — campfire storytelling, jokes, and shared eating
with a rotating director and staggered audience reactions.

```ts
import { CampfireFSM, CampfireParticipants } from '@alife-sdk/social/campfire';
import type { IGatheringFSM, ICampfireParticipant } from '@alife-sdk/social/campfire';
```

---

## What's in this module

| Export | Kind | What it does |
|--------|------|-------------|
| `CampfireFSM` | class | 5-state campfire director FSM (implements `IGatheringFSM`) |
| `CampfireParticipants` | class | Role assignment and director rotation |
| `IGatheringFSM` | interface | Generic gathering FSM — implement to replace `CampfireFSM` |
| `ICampfireParticipant` | interface | `{ npcId, role: CampfireRole }` |

---

## CampfireFSM

A 5-state FSM that manages one campfire session per terrain. Created
automatically by `SocialPlugin`, or manually for custom use:

```ts
const fsm = new CampfireFSM(
  'terrain_camp_1',
  contentPool,
  random,
  config.campfire,
);

fsm.setParticipants(['npc1', 'npc2', 'npc3']);

// Each frame:
const bubbles = fsm.update(deltaMs);
for (const b of bubbles) presenter.showBubble(b.npcId, b.text, b.durationMs);
```

### State machine

```
IDLE ──→ STORY  ──→ REACTING ──→ IDLE
     ──→ JOKE   ──→ REACTING ──┘
     ──→ EATING ──────────────→ IDLE
```

| State | Who speaks | Duration |
|-------|-----------|----------|
| `IDLE` | Nobody | `idleDurationMin..Max` |
| `STORY` | Director | `storyDurationMin..Max` |
| `JOKE` | Director | `jokeDurationMin..Max` |
| `EATING` | All (random `eatingChance` each) | `eatingDurationMin..Max` |
| `REACTING` | Audience (staggered by `reactionStaggerMs`) | `reactionDurationMin..Max` |

Reaction content: `CAMPFIRE_LAUGHTER` after a joke, `CAMPFIRE_STORY_REACT` after a story.

### Activity selection (IDLE → next)

```
random r ∈ [0, 1)
  r < weightStory (0.35)          → STORY
  r < weightJokeCumulative (0.65) → JOKE
  else                            → EATING
```

### Director rotation

The director rotates to the next participant at the start of each STORY or JOKE.
If the current director leaves mid-scene, the FSM falls back to IDLE.

### Queries

```ts
fsm.getState();           // → CampfireState
fsm.getDirectorId();      // → string | null
fsm.participantCount;     // → number
```

---

## IGatheringFSM

Implement this interface to replace the built-in campfire behavior with your
own gathering logic (tavern, squad bonding, etc.):

```ts
class TavernFSM implements IGatheringFSM {
  update(deltaMs: number): IBubbleRequest[] { ... }
  setParticipants(npcIds: readonly string[]): boolean { ... }
  clear(): void { ... }
}

// Wire via ISocialConfig:
const config = createDefaultSocialConfig({
  createGatheringFSM: (terrainId) => new TavernFSM(terrainId),
});
```

The plugin calls:
1. `factory(terrainId)` — once when enough participants are detected
2. `fsm.setParticipants(npcIds)` — every `syncIntervalMs` to keep the list fresh
3. `fsm.update(deltaMs)` — every frame
4. `fsm.clear()` — when participants drop below `minParticipants`

---

## CampfireParticipants

Standalone participant tracker used internally by `CampfireFSM`. Useful if you
build a custom `IGatheringFSM`:

```ts
const parts = new CampfireParticipants(random);
parts.setParticipants(['a', 'b', 'c'], 2); // → true
parts.rotateDirector();   // → 'b' (round-robin)
parts.getDirectorId();    // → 'b'
parts.getAudienceIds();   // → ['a', 'c']
parts.getAllIds();         // → ['a', 'b', 'c']
parts.has('a');           // → true
parts.count;              // → 3
```
