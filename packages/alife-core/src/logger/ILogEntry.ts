import type { LogChannel } from './LogChannel';
import type { LogLevel } from './LogLevel';

/** Single log record stored in the Logger ring buffer and forwarded to ILogOutput sinks. */
export interface ILogEntry {
  /** Wall-clock milliseconds at the time of logging. */
  readonly timestamp: number;
  /** Subsystem that produced this entry (e.g. 'alife', 'combat', 'ai'). */
  readonly channel: LogChannel;
  /** Severity: DEBUG(0) < INFO(1) < WARN(2) < ERROR(3) < NONE(4). */
  readonly level: LogLevel;
  /** Human-readable log message. */
  readonly message: string;
  /** Optional structured payload for diagnostics. */
  readonly data?: unknown;
}
