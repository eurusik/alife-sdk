# logger

Structured, in-memory ring-buffer logger with injectable outputs and per-channel filtering.

```ts
import { Logger, LogLevel, LogChannel } from '@alife-sdk/core/logger';
import type { ILogEntry, ILoggerConfig } from '@alife-sdk/core/logger';
```

> **Most of the time you don't create `Logger` directly.**
> `kernel.logger` is pre-configured and ready to use inside any plugin.
>
> ```ts
> kernel.logger.info(LogChannel.AI, 'NPC entered COMBAT state', { npcId });
> ```

---

## Concepts

### Ring buffer

The logger stores entries in a fixed-size circular buffer (default **1024 entries**).
When the buffer is full, the oldest entry is overwritten — no unbounded memory growth even in long sessions.

### Outputs (sinks)

An `ILogOutput` is anything that consumes a log entry — `console`, a file, a remote service, an in-game overlay.
You attach one or more outputs in `ILoggerConfig.outputs`.
The built-in `consoleOutput` writes to the browser/Node console.

### Level filter

Entries below the configured `level` are silently dropped before reaching the buffer or any output.
Set `LogLevel.NONE` to silence all logging entirely.

### Channel filter

Each log call must carry a **channel** string (e.g. `LogChannel.AI`, `LogChannel.COMBAT`).
Set `enabledChannels` in config to only record entries from specific subsystems.
When omitted, all channels are enabled.

---

## Quick start

```ts
import { Logger, LogLevel, LogChannel } from '@alife-sdk/core/logger';

// Minimal setup — logs everything to console
const logger = new Logger();
logger.info(LogChannel.ALIFE, 'Simulation started');
logger.warn(LogChannel.SPAWN, 'Spawn point out of range', { id: 'sp_01' });

// Production setup — only warnings and above, just the AI channel
const logger = new Logger({
  level: LogLevel.WARN,
  enabledChannels: [LogChannel.AI, LogChannel.COMBAT],
  bufferSize: 256,
});
```

---

## `ILoggerConfig`

```ts
interface ILoggerConfig {
  bufferSize?:       number;          // Ring buffer size. Default: 1024.
  outputs?:          ILogOutput[];    // Sinks that receive each entry. Default: [consoleOutput].
  level?:            LogLevel;        // Minimum severity. Default: LogLevel.DEBUG.
  enabledChannels?:  string[];        // Allowlist of channels. Default: all channels.
  timestampFn?:      () => number;    // Custom clock. Default: () => Date.now().
}
```

### `ILogOutput`

```ts
interface ILogOutput {
  write(entry: ILogEntry): void;
}
```

Implement this interface to route entries anywhere — file system, WebSocket, UI overlay, test spy:

```ts
const testSink: ILogOutput = {
  captured: [] as ILogEntry[],
  write(entry) { this.captured.push(entry); },
};

const logger = new Logger({ outputs: [testSink] });
```

---

## API

### `logger.debug(channel, message, data?)`
### `logger.info(channel, message, data?)`
### `logger.warn(channel, message, data?)`
### `logger.error(channel, message, data?)`

Write an entry at the corresponding severity level.

- `channel` — subsystem identifier. Use `LogChannel` constants or any plain string.
- `message` — human-readable description.
- `data` — optional structured payload (object, error, anything serialisable).

Entries filtered out by `level` or `enabledChannels` cost only a comparison — no allocation.

```ts
logger.debug(LogChannel.AI,     'Path recalculated', { npcId, length: path.length });
logger.info (LogChannel.SQUAD,  'Squad formed',       { squadId, members: 4 });
logger.warn (LogChannel.SPAWN,  'Pool exhausted — skipping spawn');
logger.error(LogChannel.COMBAT, 'Damage with NaN value', { damage });
```

---

### `logger.getEntries(filter?)`

Query the ring buffer. Returns entries in insertion order.

```ts
interface ILogFilter {
  channel?: string;    // Only entries from this channel
  level?:   LogLevel;  // Only entries at this level or above
  limit?:   number;    // Return at most N most-recent entries
}

// All errors ever recorded
const errors = logger.getEntries({ level: LogLevel.ERROR });

// Last 50 AI messages
const recent = logger.getEntries({ channel: LogChannel.AI, limit: 50 });

// Everything
const all = logger.getEntries();
```

---

### `logger.entryCount`

Number of entries currently in the buffer.

```ts
console.log(`${logger.entryCount} entries buffered`);
```

---

### `logger.clear()`

Empty the ring buffer. Does not affect outputs.

---

## `LogLevel`

```ts
const LogLevel = {
  DEBUG: 0,
  INFO:  1,
  WARN:  2,
  ERROR: 3,
  NONE:  4,   // silence all logging
} as const;
```

`level` in config is a **minimum** — entries below it are dropped. Setting `WARN` means only `warn()` and `error()` calls are recorded.

---

## `LogChannel`

22 predefined subsystem identifiers. Use them to narrow log queries or filter output.

| Constant | String | Subsystem |
|----------|--------|-----------|
| `ALIFE` | `'alife'` | A-Life simulation core |
| `SQUAD` | `'squad'` | Squad management |
| `SPAWN` | `'spawn'` | Spawn registry |
| `SURGE` | `'surge'` | Psi-surge system |
| `TIME` | `'time'` | Game clock / day-night |
| `AI` | `'ai'` | NPC state machine |
| `MOVEMENT` | `'movement'` | Path / movement |
| `PERCEPTION` | `'perception'` | Perception system |
| `NPC_BRAIN` | `'npc_brain'` | Brain tick |
| `COMBAT` | `'combat'` | Combat resolution |
| `COVER` | `'cover'` | Cover selection |
| `FACTION` | `'faction'` | Faction relations |
| `STATE` | `'state'` | FSM transitions |
| `SAVE` | `'save'` | Save / restore |
| `TRADE` | `'trade'` | Economy |
| `ANOMALY` | `'anomaly'` | Anomaly zones |
| `INVENTORY` | `'inventory'` | Inventory |
| `INPUT` | `'input'` | Input handling |
| `AUDIO` | `'audio'` | Sound system |
| `QUEST` | `'quest'` | Quest system |
| `SCENE` | `'scene'` | Scene lifecycle |
| `GOAP` | `'goap'` | GOAP planner |

`LogChannel` values are plain strings — use your own channel names alongside them:

```ts
logger.info('my_plugin', 'Custom plugin initialised');
```

---

## `ILogEntry`

Shape of every entry stored in the ring buffer:

```ts
interface ILogEntry {
  readonly timestamp: number;  // ms from timestampFn (default Date.now())
  readonly channel:   string;
  readonly level:     LogLevel;
  readonly message:   string;
  readonly data?:     unknown;
}
```

---

## Using `kernel.logger`

Inside a plugin you never construct `Logger` yourself — `kernel.logger` is already set up:

```ts
import type { IALifePlugin, ALifeKernel } from '@alife-sdk/core';
import { LogChannel } from '@alife-sdk/core/logger';

export class MyPlugin implements IALifePlugin {
  install(kernel: ALifeKernel): void {
    const log = kernel.logger;

    log.info(LogChannel.ALIFE, 'MyPlugin installed');

    kernel.events.on('alife:npc_died', ({ npcId }) => {
      log.debug(LogChannel.COMBAT, 'NPC died', { npcId });
    });
  }
}
```

---

## Custom output — in-game log overlay

```ts
import { Logger, LogLevel, LogChannel } from '@alife-sdk/core/logger';
import type { ILogOutput, ILogEntry } from '@alife-sdk/core/logger';

class UILogOverlay implements ILogOutput {
  private lines: string[] = [];

  write(entry: ILogEntry): void {
    const prefix = `[${entry.channel}]`;
    this.lines.unshift(`${prefix} ${entry.message}`);
    if (this.lines.length > 20) this.lines.pop();
    this.render();
  }

  private render(): void {
    // push this.lines to your DOM / canvas overlay
  }
}

const logger = new Logger({
  level: LogLevel.WARN,
  outputs: [new UILogOverlay()],
  enabledChannels: [LogChannel.AI, LogChannel.COMBAT],
});
```

---

## Tips

**Use `enabledChannels` in production.**
Logging every DEBUG message from every subsystem creates noise.
Enable only the channels you're actively investigating:

```ts
const logger = new Logger({
  level: LogLevel.DEBUG,
  enabledChannels: [LogChannel.AI, LogChannel.PERCEPTION],
});
```

**Use `getEntries()` for post-mortem debugging.**
After a crash or unexpected state, query the buffer before the session ends:

```ts
const lastAiErrors = logger.getEntries({
  channel: LogChannel.AI,
  level: LogLevel.ERROR,
  limit: 10,
});
console.table(lastAiErrors);
```

**Custom `timestampFn` for deterministic tests.**
Replace `Date.now()` with a counter you control:

```ts
let tick = 0;
const logger = new Logger({ timestampFn: () => tick++ });
```
