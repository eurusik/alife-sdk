import { describe, it, expect, vi } from 'vitest';
import { EventBus } from './EventBus';

interface TestEvents {
  'hit': { damage: number };
  'heal': { amount: number };
  'died': undefined;
  'chain': { step: number };
}

// ---------------------------------------------------------------------------
// emit() queues
// ---------------------------------------------------------------------------
describe('EventBus — emit() queues', () => {
  it('does not dispatch immediately (listener not called before flush)', () => {
    const bus = new EventBus<TestEvents>();
    const spy = vi.fn();

    bus.on('hit', spy);
    bus.emit('hit', { damage: 10 });

    expect(spy).not.toHaveBeenCalled();
  });

  it('increments pendingCount', () => {
    const bus = new EventBus<TestEvents>();

    expect(bus.pendingCount).toBe(0);
    bus.emit('hit', { damage: 5 });
    expect(bus.pendingCount).toBe(1);
    bus.emit('heal', { amount: 20 });
    expect(bus.pendingCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// flush() dispatches
// ---------------------------------------------------------------------------
describe('EventBus — flush() dispatches', () => {
  it('dispatches all queued events in FIFO order', () => {
    const bus = new EventBus<TestEvents>();
    const order: string[] = [];

    bus.on('hit', () => order.push('hit'));
    bus.on('heal', () => order.push('heal'));
    bus.on('died', () => order.push('died'));

    bus.emit('hit', { damage: 1 });
    bus.emit('heal', { amount: 2 });
    bus.emit('died', undefined);

    bus.flush();

    expect(order).toEqual(['hit', 'heal', 'died']);
  });

  it('with no pending events is a no-op (no errors)', () => {
    const bus = new EventBus<TestEvents>();

    expect(() => bus.flush()).not.toThrow();
  });

  it('resets pendingCount to 0', () => {
    const bus = new EventBus<TestEvents>();

    bus.emit('hit', { damage: 10 });
    bus.emit('heal', { amount: 5 });
    expect(bus.pendingCount).toBe(2);

    bus.flush();
    expect(bus.pendingCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Re-entrant emit
// ---------------------------------------------------------------------------
describe('EventBus — re-entrant emit', () => {
  it('emit() inside a handler during flush() is safely handled', () => {
    const bus = new EventBus<TestEvents>();
    const calls: number[] = [];

    bus.on('hit', (p) => {
      calls.push(p.damage);
      if (p.damage === 1) {
        bus.emit('hit', { damage: 2 });
      }
    });

    bus.emit('hit', { damage: 1 });
    bus.flush();

    expect(calls).toEqual([1, 2]);
  });

  it('nested re-entrant emit chain terminates', () => {
    const bus = new EventBus<TestEvents>();
    const steps: number[] = [];

    bus.on('chain', (p) => {
      steps.push(p.step);
      if (p.step < 5) {
        bus.emit('chain', { step: p.step + 1 });
      }
    });

    bus.emit('chain', { step: 1 });
    bus.flush();

    expect(steps).toEqual([1, 2, 3, 4, 5]);
  });
});

// ---------------------------------------------------------------------------
// once() auto-remove
// ---------------------------------------------------------------------------
describe('EventBus — once() auto-remove', () => {
  it('fires exactly once after flush, not on second flush', () => {
    const bus = new EventBus<TestEvents>();
    const spy = vi.fn();

    bus.once('hit', spy);

    bus.emit('hit', { damage: 10 });
    bus.flush();
    expect(spy).toHaveBeenCalledTimes(1);

    bus.emit('hit', { damage: 20 });
    bus.flush();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// on()/off() interaction
// ---------------------------------------------------------------------------
describe('EventBus — on()/off() interaction', () => {
  it('off() before flush prevents delivery', () => {
    const bus = new EventBus<TestEvents>();
    const spy = vi.fn();

    bus.on('hit', spy);
    bus.emit('hit', { damage: 10 });
    bus.off('hit', spy);
    bus.flush();

    expect(spy).not.toHaveBeenCalled();
  });

  it('unsubscribe function returned by on() prevents delivery', () => {
    const bus = new EventBus<TestEvents>();
    const spy = vi.fn();

    const unsub = bus.on('hit', spy);
    bus.emit('hit', { damage: 10 });
    unsub();
    bus.flush();

    expect(spy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Multiple events
// ---------------------------------------------------------------------------
describe('EventBus — multiple events', () => {
  it('multiple different events dispatched in correct order', () => {
    const bus = new EventBus<TestEvents>();
    const log: Array<{ event: string; value: number }> = [];

    bus.on('hit', (p) => log.push({ event: 'hit', value: p.damage }));
    bus.on('heal', (p) => log.push({ event: 'heal', value: p.amount }));

    bus.emit('hit', { damage: 5 });
    bus.emit('heal', { amount: 10 });
    bus.emit('hit', { damage: 15 });

    bus.flush();

    expect(log).toEqual([
      { event: 'hit', value: 5 },
      { event: 'heal', value: 10 },
      { event: 'hit', value: 15 },
    ]);
  });

  it('same event emitted twice delivers payload to listener twice', () => {
    const bus = new EventBus<TestEvents>();
    const spy = vi.fn();

    bus.on('hit', spy);
    bus.emit('hit', { damage: 1 });
    bus.emit('hit', { damage: 2 });
    bus.flush();

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, { damage: 1 });
    expect(spy).toHaveBeenNthCalledWith(2, { damage: 2 });
  });
});

// ---------------------------------------------------------------------------
// Payload correctness
// ---------------------------------------------------------------------------
describe('EventBus — payload correctness', () => {
  it('listener receives the correct payload after flush', () => {
    const bus = new EventBus<TestEvents>();
    let received: { damage: number } | undefined;

    bus.on('hit', (p) => { received = p; });
    bus.emit('hit', { damage: 42 });
    bus.flush();

    expect(received).toEqual({ damage: 42 });
  });
});

// ---------------------------------------------------------------------------
// destroy()
// ---------------------------------------------------------------------------
describe('EventBus — destroy()', () => {
  it('clears both listeners and queue', () => {
    const bus = new EventBus<TestEvents>();
    const spy = vi.fn();

    bus.on('hit', spy);
    bus.emit('hit', { damage: 10 });

    bus.destroy();
    bus.flush();

    expect(spy).not.toHaveBeenCalled();
  });

  it('pendingCount is 0 after destroy()', () => {
    const bus = new EventBus<TestEvents>();

    bus.emit('hit', { damage: 1 });
    bus.emit('heal', { amount: 2 });
    expect(bus.pendingCount).toBe(2);

    bus.destroy();
    expect(bus.pendingCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Flush live iteration — Set visits newly added elements
// ---------------------------------------------------------------------------
describe('EventBus — live Set iteration', () => {
  it('once listener that adds another listener to same event — new listener fires in same flush (live Set)', () => {
    const bus = new EventBus<TestEvents>();
    const secondSpy = vi.fn();

    bus.once('hit', () => {
      // This listener fires during flush, then adds a new listener to the same Set.
      // JS Set iteration visits newly added elements, so secondSpy WILL fire.
      bus.on('hit', secondSpy);
    });

    bus.emit('hit', { damage: 1 });
    bus.flush();

    // The dynamically added listener fires within the same flush (live Set behavior).
    expect(secondSpy).toHaveBeenCalledTimes(1);
    expect(secondSpy).toHaveBeenCalledWith({ damage: 1 });
  });

  it('listener added during flush also fires on subsequent flush cycles', () => {
    const bus = new EventBus<TestEvents>();
    const secondSpy = vi.fn();

    bus.once('hit', () => {
      bus.on('hit', secondSpy);
    });

    bus.emit('hit', { damage: 1 });
    bus.flush();
    // Fired once during the same flush (live Set).
    expect(secondSpy).toHaveBeenCalledTimes(1);

    // Now emit again — the persisted listener fires again.
    bus.emit('hit', { damage: 2 });
    bus.flush();
    expect(secondSpy).toHaveBeenCalledTimes(2);
    expect(secondSpy).toHaveBeenLastCalledWith({ damage: 2 });
  });

  it('on() listener that adds another listener to same event — new listener fires in same flush (live Set)', () => {
    const bus = new EventBus<TestEvents>();
    const addedSpy = vi.fn();
    let addedOnce = false;

    bus.on('hit', () => {
      if (!addedOnce) {
        addedOnce = true;
        bus.on('hit', addedSpy);
      }
    });

    bus.emit('hit', { damage: 5 });
    bus.flush();

    // The dynamically added listener fires within the same flush (live Set iteration).
    expect(addedSpy).toHaveBeenCalledTimes(1);
    expect(addedSpy).toHaveBeenCalledWith({ damage: 5 });
  });
});

// ---------------------------------------------------------------------------
// Exception safety (bug audit fix: listener throw must not halt others)
// ---------------------------------------------------------------------------
describe('EventBus — exception safety', () => {
  it('continues dispatching when a listener throws', () => {
    const bus = new EventBus<TestEvents>();
    const calls: number[] = [];

    bus.on('hit', () => { throw new Error('boom'); });
    bus.on('hit', (p) => { calls.push(p.damage); });

    bus.emit('hit', { damage: 42 });

    // Suppress console.error during test
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    bus.flush();
    spy.mockRestore();

    // Second listener must have been called despite the first throwing.
    expect(calls).toEqual([42]);
  });

  it('processes subsequent events after a listener throws', () => {
    const bus = new EventBus<TestEvents>();
    const order: string[] = [];

    bus.on('hit', () => { throw new Error('fail'); });
    bus.on('heal', (p) => { order.push(`heal:${p.amount}`); });

    bus.emit('hit', { damage: 1 });
    bus.emit('heal', { amount: 50 });

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    bus.flush();
    spy.mockRestore();

    expect(order).toEqual(['heal:50']);
  });

  it('re-entrant events emitted during flush still arrive after a throw', () => {
    const bus = new EventBus<TestEvents>();
    const received: number[] = [];

    bus.on('hit', (p) => {
      if (p.damage === 1) {
        bus.emit('hit', { damage: 2 });
        throw new Error('mid-flush throw');
      }
      received.push(p.damage);
    });

    bus.emit('hit', { damage: 1 });

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    bus.flush();
    spy.mockRestore();

    expect(received).toEqual([2]);
  });

  it('flushing flag is reset even after exception (try-finally)', () => {
    const bus = new EventBus<TestEvents>();

    // After flush completes (even with thrown errors), bus should be usable.
    bus.on('hit', () => { throw new Error('oops'); });
    bus.emit('hit', { damage: 1 });

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    bus.flush();
    spy.mockRestore();

    // Should be able to emit and flush again without issues.
    const calls: number[] = [];
    bus.on('heal', (p) => calls.push(p.amount));
    bus.emit('heal', { amount: 99 });
    bus.flush();

    expect(calls).toEqual([99]);
  });
});

// ---------------------------------------------------------------------------
// Context binding
// ---------------------------------------------------------------------------
describe('EventBus — context binding', () => {
  it('on() with context correctly binds this', () => {
    const bus = new EventBus<TestEvents>();

    const obj = {
      multiplier: 3,
      result: 0,
      handler(p: { damage: number }) {
        this.result = p.damage * this.multiplier;
      },
    };

    bus.on('hit', obj.handler, obj);
    bus.emit('hit', { damage: 7 });
    bus.flush();

    expect(obj.result).toBe(21);
  });
});

// ---------------------------------------------------------------------------
// Logger injection
// ---------------------------------------------------------------------------
describe('EventBus — logger injection', () => {
  it('routes listener errors to the injected logger instead of console.error', () => {
    const errors: Array<{ channel: string; message: string; data: unknown }> = [];
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn((_channel: string, _message: string, data?: unknown) => {
        errors.push({ channel: _channel, message: _message, data });
      }),
    };

    const bus = new EventBus<TestEvents>(logger);
    const thrown = new Error('boom');
    bus.on('hit', () => { throw thrown; });
    bus.emit('hit', { damage: 1 });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    bus.flush();

    // Logger must have received the error; console must not have been called.
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(errors[0].channel).toBe('EventBus');
    expect(errors[0].data).toBe(thrown);
    expect(consoleSpy).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('falls back to console.error when no logger is provided', () => {
    const bus = new EventBus<TestEvents>();
    bus.on('hit', () => { throw new Error('no-logger'); });
    bus.emit('hit', { damage: 1 });

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    bus.flush();
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });
});
