import type { ILogger } from '../ports/ILogger';

interface ListenerEntry {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
  fn: Function;
  context: unknown;
  once: boolean;
}

/**
 * Type-safe event emitter parameterised by a payload map.
 *
 * `TPayloads` maps event name strings to their payload types, giving full
 * IntelliSense for both emitting and subscribing — wrong event names or
 * payload shapes are caught at compile time.
 *
 * @typeParam TPayloads - Record mapping event name → payload type.
 *
 * @example
 * ```ts
 * interface MyEvents {
 *   'player:hit': { damage: number };
 *   'player:died': undefined;
 * }
 * const bus = new EventBus<MyEvents>();
 * bus.on('player:hit', (p) => console.log(p.damage)); // p is typed
 * bus.emit('player:hit', { damage: 10 });
 * ```
 */
export class EventBus<
  TPayloads = Record<string, unknown>,
> {
  private listeners = new Map<string, Set<ListenerEntry>>();
  private _frontQueue: Array<{ event: string; payload: unknown }> = [];
  private _backQueue: Array<{ event: string; payload: unknown }> = [];
  private readonly _onceEntries: ListenerEntry[] = [];
  private readonly _logger: ILogger | undefined;

  /**
   * @param logger - Optional logger for reporting listener errors. Defaults to
   *   `console` when not provided, preserving backward-compatibility.
   */
  constructor(logger?: ILogger) {
    this._logger = logger;
  }

  /** Queue an event for deferred dispatch. Call flush() to deliver. */
  emit<K extends keyof TPayloads & string>(
    event: K,
    payload?: TPayloads[K],
  ): void {
    this._frontQueue.push({ event: event as string, payload });
  }

  /**
   * Process all queued events, dispatching to registered listeners.
   * Handles re-entrant emit safely: events emitted during flush are
   * appended to the queue and processed within the same flush cycle.
   */
  flush(): void {
    try {
      while (this._frontQueue.length > 0) {
        // Swap: new emits during dispatch go to the fresh front buffer
        const batch = this._frontQueue;
        this._frontQueue = this._backQueue;
        this._backQueue = batch;
        this._frontQueue.length = 0;

        for (const { event, payload } of this._backQueue) {
          const set = this.listeners.get(event);
          if (!set) continue;
          this._onceEntries.length = 0;
          for (const entry of set) {
            try {
              entry.fn.call(entry.context, payload);
            } catch (err) {
              if (this._logger) {
                this._logger.error('EventBus', `listener for "${event}" threw`, err);
              } else {
                console.error(`[EventBus] listener for "${event}" threw:`, err);
              }
            }
            if (entry.once) this._onceEntries.push(entry);
          }
          for (const entry of this._onceEntries) set.delete(entry);
        }
        this._backQueue.length = 0;
      }
    } finally {
      // flush complete
    }
  }

  /** Number of events waiting in the queue. */
  get pendingCount(): number {
    return this._frontQueue.length;
  }

  /** Subscribe to an event. Returns an unsubscribe function. */
  on<K extends keyof TPayloads & string>(
    event: K,
    fn: (payload: TPayloads[K]) => void,
    context?: unknown,
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }

    const entry: ListenerEntry = { fn, context, once: false };
    set.add(entry);

    return () => {
      set!.delete(entry);
    };
  }

  /** Subscribe to an event for a single invocation. Returns an unsubscribe function. */
  once<K extends keyof TPayloads & string>(
    event: K,
    fn: (payload: TPayloads[K]) => void,
  ): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }

    const entry: ListenerEntry = { fn, context: undefined, once: true };
    set.add(entry);

    return () => {
      set!.delete(entry);
    };
  }

  /** Unsubscribe a specific listener. Both `fn` and `context` must match the original on() call. */
  off<K extends keyof TPayloads & string>(
    event: K,
    fn: (payload: TPayloads[K]) => void,
    context?: unknown,
  ): void {
    const set = this.listeners.get(event);
    if (!set) return;

    for (const entry of set) {
      if (entry.fn === fn && entry.context === context) {
        set.delete(entry);
        return;
      }
    }
  }

  /** Remove all listeners for all events and clear the pending queue. */
  destroy(): void {
    this.listeners.clear();
    this._frontQueue.length = 0;
    this._backQueue.length = 0;
  }
}
