# Online vs Offline

This is the core runtime idea behind the SDK.

Most games do not need full frame-by-frame AI for every actor in the world. They need a cheaper background model for distant NPCs and a higher-detail model for actors near the player.

## The split

| Mode | Driver | Cost | Typical use |
|---|---|---|---|
| Offline | SDK tick pipeline | Low | NPC is far away and still needs to live in the world |
| Online | Your engine + `@alife-sdk/ai` | Higher | NPC is close enough to matter moment-to-moment |

## What offline simulation keeps alive

- terrain choice
- task assignment
- movement between activity zones
- morale changes
- squad combat and conflict resolution
- world events that happen out of view

## What online AI adds

- real-time state machines
- perception, hearing, and suspicion
- cover logic
- squad tactics
- animation and movement coordination with your engine

## Typical handoff

```ts
for (const id of goOnline) {
  simulation.setNPCOnline(id, true);
}

for (const id of goOffline) {
  simulation.setNPCOnline(id, false);
}
```

The point is not to keep two separate NPCs in sync. It is one NPC record moving between two execution modes.

## Why this matters for performance

When 300 NPCs exist in the world, only a fraction should pay the cost of full real-time AI. The rest can keep progressing on a tick budget while still updating world state.

## Common mistake

Do not treat offline mode as a pause state. Offline NPCs should still change terrain, morale, health, faction tension, and task context so the world evolves even off-screen.
