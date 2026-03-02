# events

Typed event bus with deferred dispatch and a full catalogue of built-in
A-Life events.

```ts
import { EventBus, ALifeEvents } from '@alife-sdk/core/events';
import type { ALifeEventPayloads } from '@alife-sdk/core/events';
```

> **Most of the time you don't import `EventBus` directly.**
> `kernel.events` is pre-configured with `ALifeEventPayloads` and ready to use.
>
> ```ts
> kernel.events.on(ALifeEvents.NPC_DIED, ({ npcId, killedBy }) => { ... });
> ```

---

## Concepts

### Deferred dispatch

`emit()` does **not** call listeners immediately. It queues the event.
`flush()` delivers all queued events at once — called automatically by
`kernel.update()` at the end of each frame.

```
frame N:   plugin.update() → emit('alife:npc_died', ...)  (queued)
                           → emit('ai:state_changed', ...) (queued)
           kernel.update() → flush()  ← all listeners called here
```

This means:
- Listeners always run in a predictable, stable point in the frame
- Emitting during a listener is safe — re-entrant emits are queued and
  processed within the same `flush()` cycle (no infinite loops)
- Listener errors are caught and logged; other listeners still fire

---

## `EventBus<TPayloads>`

Generic typed emitter. Parameterise it with a payload map for full
IntelliSense on event names and payload shapes.

```ts
interface MyEvents {
  'player:hit':  { damage: number; sourceId: string };
  'player:died': undefined;
}

const bus = new EventBus<MyEvents>();
bus.on('player:hit', ({ damage }) => console.log(damage)); // fully typed
bus.emit('player:hit', { damage: 50, sourceId: 'enemy_01' });
bus.flush();
```

Wrong event names or mismatched payload shapes are **compile-time errors**.

---

## API

### `bus.on(event, fn, context?)`

Subscribe to an event. Returns an **unsubscribe function** — call it to
remove the listener:

```ts
const unsub = kernel.events.on(ALifeEvents.NPC_ONLINE, ({ npcId, position }) => {
  console.log(`${npcId} came online at`, position);
});

// Later, when you no longer need it:
unsub();
```

`context` is bound as `this` inside `fn`. Match it in `off()` when using
the manual unsubscribe path.

### `bus.once(event, fn)`

Subscribe for a single invocation. The listener is automatically removed
after the first call.

```ts
kernel.events.once(ALifeEvents.SURGE_STARTED, ({ surgeNumber }) => {
  ui.showSurgeWarning(surgeNumber);
});
```

Also returns an unsubscribe function if you need to cancel before it fires.

### `bus.off(event, fn, context?)`

Manually remove a listener. Both `fn` and `context` must match the
original `on()` call exactly:

```ts
function onNpcDied(payload) { ... }

bus.on(ALifeEvents.NPC_DIED, onNpcDied, this);
// ...
bus.off(ALifeEvents.NPC_DIED, onNpcDied, this);
```

**Prefer the unsubscribe function** returned by `on()` — it's simpler
and avoids the `fn`/`context` matching requirement.

### `bus.emit(event, payload?)`

Queue an event for deferred delivery. Does not call listeners immediately.

```ts
bus.emit(ALifeEvents.NPC_DIED, {
  npcId: 'stalker_42',
  killedBy: 'player',
  zoneId: 'zone_bar',
});
```

For events with `undefined` payload, omit the second argument:

```ts
// hypothetical event with no payload
bus.emit('my:simple_event');
```

### `bus.flush()`

Deliver all queued events. Called by `kernel.update()` automatically —
you rarely need to call this directly.

### `bus.pendingCount`

Number of events currently in the queue, before the next `flush()`.

```ts
if (bus.pendingCount > 100) {
  console.warn('Event queue is large — possible storm?');
}
```

### `bus.destroy()`

Remove all listeners and clear the queue. Called by `kernel.destroy()`.

---

## Using `kernel.events`

`kernel.events` is an `EventBus<ALifeEventPayloads>` — pre-typed with all
built-in A-Life events. This is the bus all SDK plugins write to.

```ts
// Subscribe in your plugin's install() or init()
const unsub = kernel.events.on(ALifeEvents.FACTION_CONFLICT, (payload) => {
  const { factionA, factionB, zoneId } = payload; // all typed
  console.log(`${factionA} vs ${factionB} in ${zoneId}`);
});

// Unsubscribe in destroy()
unsub();
```

---

## Custom EventBus

For your own game systems, create a separate bus with your own payload map:

```ts
import { EventBus } from '@alife-sdk/core/events';

interface UIEvents {
  'hud:update':    { hp: number; radiation: number };
  'dialog:opened': { npcId: string; text: string };
  'dialog:closed': undefined;
}

export const uiBus = new EventBus<UIEvents>();

// Producer (game logic)
uiBus.emit('hud:update', { hp: 80, radiation: 0.3 });

// Consumer (renderer)
uiBus.on('hud:update', ({ hp, radiation }) => {
  hudComponent.setValues(hp, radiation);
});

// Must flush manually if not tied to the kernel
uiBus.flush();
```

---

## Full event reference

### A-Life core (`alife:*`)

| Constant | Event string | Payload |
|----------|-------------|---------|
| `TICK` | `alife:tick` | `{ tick: number; delta: number }` |
| `NPC_MOVED` | `alife:npc_moved` | `{ npcId; fromZone; toZone }` |
| `FACTION_CONFLICT` | `alife:faction_conflict` | `{ factionA; factionB; zoneId }` |
| `NPC_ONLINE` | `alife:npc_online` | `{ npcId; position: Vec2 }` |
| `NPC_OFFLINE` | `alife:npc_offline` | `{ npcId; zoneId }` |
| `TASK_ASSIGNED` | `alife:task_assigned` | `{ npcId; terrainId; taskType }` |
| `NPC_DIED` | `alife:npc_died` | `{ npcId; killedBy; zoneId }` |
| `SPAWN_REQUESTED` | `alife:spawn_requested` | `{ spawnPointId; terrainId; position; factionId; enemyType }` |
| `NPC_RELEASED` | `alife:npc_released` | `{ npcId; terrainId }` |
| `TERRAIN_STATE_CHANGED` | `alife:terrain_state_changed` | `{ terrainId; oldState; newState }` |
| `MORALE_CHANGED` | `alife:morale_changed` | `{ npcId; morale; previousMorale; moraleState }` |
| `NPC_PANICKED` | `ai:npc_panicked` | `{ npcId; squadId: string \| null }` |

### AI perception (`ai:*`)

| Constant | Event string | Payload |
|----------|-------------|---------|
| `SPOTTED_ENEMY` | `ai:spotted_enemy` | `{ npcId; enemyId; position }` |
| `HEARD_SOUND` | `ai:heard_sound` | `{ npcId; sourceId; position }` |
| `LOST_TARGET` | `ai:lost_target` | `{ npcId; lastKnown: Vec2 }` |
| `STATE_CHANGED` | `ai:state_changed` | `{ npcId; oldState; newState }` |
| `NPC_SHOOT` | `ai:npc_shoot` | `{ npcId; from; target: Vec2; damage }` |
| `NPC_VOCALIZATION` | `ai:npc_vocalization` | `{ npcId; soundType; position; factionId }` |
| `NPC_ATTACKED` | `ai:npc_attacked` | `{ attackerId; targetId; damage; attackerFaction; targetFaction }` |

### Surge (`surge:*`)

| Constant | Event string | Payload |
|----------|-------------|---------|
| `SURGE_WARNING` | `surge:warning` | `{ timeUntilSurge: number }` |
| `SURGE_STARTED` | `surge:started` | `{ surgeNumber: number }` |
| `SURGE_ENDED` | `surge:ended` | `{ surgeNumber: number }` |
| `SURGE_DAMAGE` | `surge:damage` | `{ npcId; damage }` |

### Anomaly (`anomaly:*`)

| Constant | Event string | Payload |
|----------|-------------|---------|
| `ANOMALY_DAMAGE` | `anomaly:damage` | `{ entityId; anomalyId; damage; damageType }` |
| `ARTEFACT_SPAWNED` | `anomaly:artefact_spawned` | `{ artefactId; anomalyId; position }` |
| `ARTEFACT_COLLECTED` | `anomaly:artefact_collected` | `{ artefactId; collectorId }` |

### Squad (`squad:*`)

| Constant | Event string | Payload |
|----------|-------------|---------|
| `SQUAD_FORMED` | `squad:formed` | `{ squadId; factionId; memberIds }` |
| `SQUAD_MEMBER_ADDED` | `squad:member_added` | `{ squadId; npcId }` |
| `SQUAD_MEMBER_REMOVED` | `squad:member_removed` | `{ squadId; npcId }` |
| `SQUAD_DISBANDED` | `squad:disbanded` | `{ squadId }` |
| `SQUAD_COMMAND_ISSUED` | `squad:command_issued` | `{ squadId; command }` |
| `SQUAD_GOAL_SET` | `squad:goal_set` | `{ squadId; goalType; terrainId; priority }` |
| `SQUAD_GOAL_CLEARED` | `squad:goal_cleared` | `{ squadId; previousGoalType }` |

### Faction (`faction:*`)

| Constant | Event string | Payload |
|----------|-------------|---------|
| `FACTION_RELATION_CHANGED` | `faction:relation_changed` | `{ factionId; targetFactionId; oldRelation; newRelation }` |

### Time (`time:*`)

| Constant | Event string | Payload |
|----------|-------------|---------|
| `HOUR_CHANGED` | `time:hour_changed` | `{ hour; day; isDay }` |
| `DAY_NIGHT_CHANGED` | `time:day_night_changed` | `{ isDay: boolean }` |

### Social (`social:*`)

| Constant | Event string | Payload |
|----------|-------------|---------|
| `NPC_SOCIAL_BUBBLE` | `social:npc_bubble` | `{ npcId; text; category }` |
| `NPC_MEET_PLAYER` | `social:npc_meet_player` | `{ npcId; factionId; greetingType }` |
| `KAMP_STATE_CHANGED` | `social:kamp_state_changed` | `{ terrainId; directorId; state }` |

### Monster (`monster:*`)

| Constant | Event string | Payload |
|----------|-------------|---------|
| `MONSTER_MELEE_HIT` | `monster:melee_hit` | `{ attackerId; position; damage; range }` |
| `PSI_ATTACK_START` | `monster:psi_attack_start` | `{ npcId; position }` |

---

## Tips

**Always unsubscribe in `destroy()`.**
Forgetting to unsubscribe causes listener leaks — stale callbacks fire
long after the subscriber is gone:

```ts
class MyPlugin implements IALifePlugin {
  private unsubs: Array<() => void> = [];

  install(kernel: ALifeKernel) {
    this.unsubs.push(
      kernel.events.on(ALifeEvents.NPC_DIED, this.onNpcDied, this),
      kernel.events.on(ALifeEvents.SURGE_STARTED, this.onSurge, this),
    );
  }

  destroy() {
    this.unsubs.forEach(fn => fn());
    this.unsubs = [];
  }
}
```

**Use `ALifeEvents` constants, never raw strings.**
`kernel.events.on('alife:npc_died', ...)` works but loses type safety —
the payload becomes `unknown`. Always use the constant:

```ts
// ✓ typed payload
kernel.events.on(ALifeEvents.NPC_DIED, ({ npcId }) => { });

// ✗ payload is unknown
kernel.events.on('alife:npc_died', (p: any) => { });
```

**`once()` for one-shot setup.**
Surge start, first NPC spawn, tutorial triggers — anything that should
happen exactly once is cleaner with `once()` than managing a boolean flag.
