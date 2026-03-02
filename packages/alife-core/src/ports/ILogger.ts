import type { ILogEntry } from '../logger/ILogEntry';

/**
 * Sink that receives formatted log entries from the Logger.
 *
 * Implement to forward logs to the console, a file, a remote service,
 * or an in-game debug overlay.
 */
export interface ILogOutput {
  /** Handle a single log entry. Called synchronously by the Logger. */
  write(entry: ILogEntry): void;
}

/**
 * Logging facade consumed by the kernel and plugins.
 *
 * The built-in {@link Logger} class implements this. You can substitute
 * your own implementation via IALifeKernelConfig.logger if you have
 * an existing logging pipeline.
 */
export interface ILogger {
  /** Log at DEBUG level. Use for high-volume diagnostic output. */
  debug(channel: string, message: string, data?: unknown): void;

  /** Log at INFO level. Use for lifecycle events (init, spawn, state change). */
  info(channel: string, message: string, data?: unknown): void;

  /** Log at WARN level. Use for recoverable problems (budget exceeded, missing data). */
  warn(channel: string, message: string, data?: unknown): void;

  /** Log at ERROR level. Use for unrecoverable errors. */
  error(channel: string, message: string, data?: unknown): void;
}
