import type { ILogEntry } from './ILogEntry';
import type { LogChannel } from './LogChannel';
import type { ILogger, ILogOutput } from '../ports/ILogger';
import { LogLevel } from './LogLevel';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ILoggerConfig {
  /** Maximum number of entries in the ring buffer. Default 1024. */
  readonly bufferSize?: number;
  /** Output sinks that receive every accepted log entry. Default [] (silent). */
  readonly outputs?: ILogOutput[];
  /** Minimum severity level. Messages below this level are discarded. Default DEBUG. */
  readonly level?: number;
  /**
   * If set, only messages on these channels pass through.
   * `undefined` means all channels are accepted.
   */
  readonly enabledChannels?: string[];
  /** Injectable clock for deterministic tests. Default `Date.now`. */
  readonly timestampFn?: () => number;
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

/**
 * Ring-buffer logger with injectable outputs.
 *
 * NOT a singleton -- each consumer creates its own instance with an explicit
 * config. This makes the logger fully testable and free of global state.
 */
export class Logger implements ILogger {
  // -- Ring buffer ----------------------------------------------------------

  private readonly buffer: Array<ILogEntry | undefined>;
  private readonly capacity: number;
  private writeHead = 0;
  private storedCount = 0;

  // -- Filters & outputs ----------------------------------------------------

  private readonly level: LogLevel;
  private readonly enabledChannels: ReadonlySet<string> | undefined;
  private readonly outputs: readonly ILogOutput[];
  private readonly timestampFn: () => number;

  // -- Constructor ----------------------------------------------------------

  constructor(config: ILoggerConfig = {}) {
    this.capacity = config.bufferSize ?? 1024;
    this.outputs = config.outputs ?? [];
    this.level = (config.level ?? LogLevel.DEBUG) as LogLevel;
    this.enabledChannels =
      config.enabledChannels !== undefined
        ? new Set(config.enabledChannels)
        : undefined;
    this.timestampFn = config.timestampFn ?? Date.now;

    this.buffer = new Array<ILogEntry | undefined>(this.capacity);
  }

  // -- ILogger methods ------------------------------------------------------

  debug(channel: string, message: string, data?: unknown): void {
    this.write(LogLevel.DEBUG, channel, message, data);
  }

  info(channel: string, message: string, data?: unknown): void {
    this.write(LogLevel.INFO, channel, message, data);
  }

  warn(channel: string, message: string, data?: unknown): void {
    this.write(LogLevel.WARN, channel, message, data);
  }

  error(channel: string, message: string, data?: unknown): void {
    this.write(LogLevel.ERROR, channel, message, data);
  }

  // -- Query ----------------------------------------------------------------

  /**
   * Read entries from the ring buffer, optionally filtered.
   *
   * Entries are returned in chronological order (oldest first).
   * When `limit` is provided, only the *most recent* matching entries are
   * returned -- still sorted chronologically.
   */
  getEntries(filter?: {
    channel?: string;
    level?: number;
    limit?: number;
  }): ILogEntry[] {
    const result: ILogEntry[] = [];
    const count = this.storedCount;
    const start =
      count < this.capacity
        ? 0
        : this.writeHead; // oldest entry position

    for (let i = 0; i < count; i++) {
      const idx = (start + i) % this.capacity;
      const entry = this.buffer[idx];
      if (entry === undefined) continue;
      if (filter?.channel !== undefined && entry.channel !== filter.channel) continue;
      if (filter?.level !== undefined && entry.level < filter.level) continue;
      result.push(entry);
    }

    if (filter?.limit !== undefined && filter.limit > 0 && result.length > filter.limit) {
      return result.slice(result.length - filter.limit);
    }

    return result;
  }

  /** Remove all entries from the ring buffer. */
  clear(): void {
    this.buffer.fill(undefined);
    this.writeHead = 0;
    this.storedCount = 0;
  }

  /** Number of entries currently stored in the buffer. */
  get entryCount(): number {
    return this.storedCount;
  }

  // -- Internal -------------------------------------------------------------

  private write(
    level: LogLevel,
    channel: string,
    message: string,
    data?: unknown,
  ): void {
    // Level gate
    if (level < this.level) return;

    // Channel gate
    if (this.enabledChannels !== undefined && !this.enabledChannels.has(channel)) return;

    const entry: ILogEntry = {
      timestamp: this.timestampFn(),
      channel: channel as LogChannel,
      level,
      message,
      data,
    };

    // Store in ring buffer (overwrite oldest when full)
    this.buffer[this.writeHead] = entry;
    this.writeHead = (this.writeHead + 1) % this.capacity;
    if (this.storedCount < this.capacity) {
      this.storedCount++;
    }

    // Forward to all outputs
    for (const output of this.outputs) {
      output.write(entry);
    }
  }
}
