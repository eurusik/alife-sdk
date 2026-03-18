// states/sdk-improvements.test.ts
// Unit tests for five new SDK features:
//   1. OnlineAIDriver.forceTransition()
//   2. INPCOnlineState.custom field
//   3. OnlineAIDriver.onTransition() hook
//   4. moveAlongPath() utility
//   5. GOAPDirector (see goap/GOAPDirector.test.ts for the dedicated suite)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OnlineAIDriver } from './OnlineAIDriver';
import type { IOnlineDriverHost } from './OnlineAIDriver';
import type { IOnlineStateHandler } from './IOnlineStateHandler';
import type { INPCContext } from './INPCContext';
import type { IPathfindingAccess } from './INPCContext';
import { createDefaultNPCOnlineState } from './NPCOnlineState';
import { moveAlongPath } from './handlers/_utils';

// ---------------------------------------------------------------------------
// Shared mock helpers
// ---------------------------------------------------------------------------

function makeHost(overrides: Partial<IOnlineDriverHost> = {}): IOnlineDriverHost {
  return {
    npcId: 'npc-1',
    factionId: 'stalker',
    entityType: 'human',
    x: 100,
    y: 100,
    state: createDefaultNPCOnlineState(),
    perception: null,
    health: null,
    cover: null,
    danger: null,
    restrictedZones: null,
    squad: null,
    pack: null,
    conditions: null,
    suspicion: null,
    pathfinding: null,
    setVelocity: vi.fn(),
    halt: vi.fn(),
    setRotation: vi.fn(),
    setAlpha: vi.fn(),
    teleport: vi.fn(),
    disablePhysics: vi.fn(),
    emitShoot: vi.fn(),
    emitMeleeHit: vi.fn(),
    emitVocalization: vi.fn(),
    emitPsiAttackStart: vi.fn(),
    now: () => 0,
    random: () => 0.5,
    ...overrides,
  };
}

function makeMockHandler(id = 'mock'): IOnlineStateHandler & { _id: string } {
  return {
    _id: id,
    enter: vi.fn(),
    update: vi.fn(),
    exit: vi.fn(),
  };
}

function makeHandlerMap(states: string[]): {
  map: Map<string, IOnlineStateHandler & { _id: string }>;
  handlers: Record<string, IOnlineStateHandler & { _id: string }>;
} {
  const handlers: Record<string, IOnlineStateHandler & { _id: string }> = {};
  const map = new Map<string, IOnlineStateHandler & { _id: string }>();
  for (const s of states) {
    const h = makeMockHandler(s);
    handlers[s] = h;
    map.set(s, h);
  }
  return { map, handlers };
}

// ---------------------------------------------------------------------------
// 1. forceTransition()
// ---------------------------------------------------------------------------

describe('forceTransition()', () => {
  it('transitions to the specified state', () => {
    const { map } = makeHandlerMap(['IDLE', 'COMBAT']);
    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');

    driver.forceTransition('COMBAT');

    expect(driver.currentStateId).toBe('COMBAT');
  });

  it('calls exit on current handler and enter on new handler', () => {
    const { map, handlers } = makeHandlerMap(['IDLE', 'COMBAT']);
    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');

    // Clear the enter call from the constructor before asserting.
    (handlers['IDLE'].enter as ReturnType<typeof vi.fn>).mockClear();

    driver.forceTransition('COMBAT');

    expect(handlers['IDLE'].exit).toHaveBeenCalledOnce();
    expect(handlers['COMBAT'].enter).toHaveBeenCalledOnce();
  });

  it('is a no-op after destroy()', () => {
    const { map, handlers } = makeHandlerMap(['IDLE', 'COMBAT']);
    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');
    driver.destroy();

    // Clear exit recorded during destroy().
    (handlers['IDLE'].exit as ReturnType<typeof vi.fn>).mockClear();

    driver.forceTransition('COMBAT');

    // State must remain IDLE; no additional lifecycle calls.
    expect(driver.currentStateId).toBe('IDLE');
    expect(handlers['IDLE'].exit).not.toHaveBeenCalled();
    expect(handlers['COMBAT'].enter).not.toHaveBeenCalled();
  });

  it('is a no-op during an active transition (re-entrancy guard)', () => {
    const { map, handlers } = makeHandlerMap(['IDLE', 'COMBAT', 'FLEE']);

    // exit() of IDLE calls forceTransition() — re-entrant call must be ignored.
    (handlers['IDLE'].exit as ReturnType<typeof vi.fn>).mockImplementation(
      (_ctx: INPCContext) => { driver.forceTransition('FLEE'); },
    );

    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');
    driver.forceTransition('COMBAT');

    // The re-entrant FLEE call inside exit must have been swallowed.
    expect(driver.currentStateId).toBe('COMBAT');
    expect(handlers['FLEE'].enter).not.toHaveBeenCalled();
  });

  it('works from outside the FSM (not from a handler)', () => {
    const { map, handlers } = makeHandlerMap(['IDLE', 'PATROL', 'ALERT']);
    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');

    // Drive multiple external transitions without any handler involvement.
    driver.forceTransition('PATROL');
    expect(driver.currentStateId).toBe('PATROL');

    driver.forceTransition('ALERT');
    expect(driver.currentStateId).toBe('ALERT');

    expect(handlers['PATROL'].enter).toHaveBeenCalledOnce();
    expect(handlers['PATROL'].exit).toHaveBeenCalledOnce();
    expect(handlers['ALERT'].enter).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// 2. INPCOnlineState.custom field
// ---------------------------------------------------------------------------

describe('INPCOnlineState.custom', () => {
  it('createDefaultNPCOnlineState() initializes custom to empty object', () => {
    const state = createDefaultNPCOnlineState();

    expect(state.custom).toBeDefined();
    expect(typeof state.custom).toBe('object');
    expect(state.custom).not.toBeNull();
    // Empty object — no own enumerable keys.
    expect(Object.keys(state.custom!)).toHaveLength(0);
  });

  it('custom data persists across handler calls', () => {
    const { map, handlers } = makeHandlerMap(['IDLE']);

    // Write in enter().
    (handlers['IDLE'].enter as ReturnType<typeof vi.fn>).mockImplementation(
      (ctx: INPCContext) => {
        ctx.state.custom ??= {};
        ctx.state.custom['foo'] = 42;
      },
    );

    let valueOnUpdate: unknown;
    // Read the value back in update().
    (handlers['IDLE'].update as ReturnType<typeof vi.fn>).mockImplementation(
      (ctx: INPCContext) => {
        valueOnUpdate = ctx.state.custom?.['foo'];
      },
    );

    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');
    driver.update(16);

    expect(valueOnUpdate).toBe(42);
  });

  it('handlers can read and write custom fields via ctx.state.custom', () => {
    const { map, handlers } = makeHandlerMap(['IDLE']);

    (handlers['IDLE'].enter as ReturnType<typeof vi.fn>).mockImplementation(
      (ctx: INPCContext) => {
        ctx.state.custom ??= {};
        ctx.state.custom['counter'] = 0;
      },
    );

    (handlers['IDLE'].update as ReturnType<typeof vi.fn>).mockImplementation(
      (ctx: INPCContext) => {
        ctx.state.custom ??= {};
        ctx.state.custom['counter'] = ((ctx.state.custom['counter'] as number) ?? 0) + 1;
      },
    );

    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');
    driver.update(16);
    driver.update(16);
    driver.update(16);

    expect((handlers['IDLE'].update as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
    // After 3 updates the counter should be 3.
    const lastCtx = (handlers['IDLE'].update as ReturnType<typeof vi.fn>).mock
      .calls[2][0] as INPCContext;
    expect(lastCtx.state.custom?.['counter']).toBe(3);
  });

  it('custom objects are independent between separate state instances', () => {
    const stateA = createDefaultNPCOnlineState();
    const stateB = createDefaultNPCOnlineState();

    stateA.custom = { key: 'A' };
    expect(stateB.custom?.['key']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. onTransition() hook
// ---------------------------------------------------------------------------

describe('onTransition()', () => {
  it('callback fires after state transition with correct from/to', () => {
    const { map, handlers } = makeHandlerMap(['IDLE', 'COMBAT']);

    (handlers['IDLE'].update as ReturnType<typeof vi.fn>).mockImplementation(
      (ctx: INPCContext) => { ctx.transition('COMBAT'); },
    );

    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');
    const transitions: Array<{ from: string; to: string }> = [];
    driver.onTransition((from, to) => transitions.push({ from, to }));

    driver.update(16);

    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toEqual({ from: 'IDLE', to: 'COMBAT' });
  });

  it('multiple listeners fire in registration order', () => {
    const { map, handlers } = makeHandlerMap(['IDLE', 'COMBAT']);

    (handlers['IDLE'].update as ReturnType<typeof vi.fn>).mockImplementation(
      (ctx: INPCContext) => { ctx.transition('COMBAT'); },
    );

    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');
    const log: string[] = [];

    driver.onTransition(() => log.push('first'));
    driver.onTransition(() => log.push('second'));
    driver.onTransition(() => log.push('third'));

    driver.update(16);

    expect(log).toEqual(['first', 'second', 'third']);
  });

  it('unsubscribe function removes the listener', () => {
    const { map, handlers } = makeHandlerMap(['IDLE', 'COMBAT', 'PATROL']);

    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');
    const callCount = { value: 0 };
    const unsub = driver.onTransition(() => callCount.value++);

    // Trigger first transition — listener is still registered.
    (handlers['IDLE'].update as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (ctx: INPCContext) => { ctx.transition('COMBAT'); },
    );
    driver.update(16);
    expect(callCount.value).toBe(1);

    // Remove the listener.
    unsub();

    // Trigger second transition — listener must not fire again.
    (handlers['COMBAT'].update as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (ctx: INPCContext) => { ctx.transition('PATROL'); },
    );
    driver.update(16);
    expect(callCount.value).toBe(1);
  });

  it('listener fires on forceTransition() too', () => {
    const { map } = makeHandlerMap(['IDLE', 'COMBAT']);
    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');

    const transitions: Array<{ from: string; to: string }> = [];
    driver.onTransition((from, to) => transitions.push({ from, to }));

    driver.forceTransition('COMBAT');

    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toEqual({ from: 'IDLE', to: 'COMBAT' });
  });

  it('listener does NOT fire on initial construction (only on subsequent transitions)', () => {
    // The constructor calls enter() on the initial state but does NOT invoke
    // _doTransition(), so onTransition listeners registered BEFORE the
    // constructor runs would not be notified. However, listeners can only be
    // registered AFTER the driver instance is created, so by definition no
    // listener exists at construction time. This test validates that no
    // spurious call occurs as a side-effect of the constructor.
    const { map } = makeHandlerMap(['IDLE', 'COMBAT']);

    const listenerCallCount = { value: 0 };

    // Construct driver first — no listeners yet.
    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');
    // Register listener AFTER construction.
    driver.onTransition(() => listenerCallCount.value++);

    // No transition has happened yet; listener must not have been called.
    expect(listenerCallCount.value).toBe(0);

    // Trigger an actual transition to confirm the listener works normally.
    driver.forceTransition('COMBAT');
    expect(listenerCallCount.value).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. moveAlongPath()
// ---------------------------------------------------------------------------

describe('moveAlongPath()', () => {
  /**
   * Build a minimal INPCContext stub with controllable pathfinding seam.
   * Only fields accessed by moveAlongPath() and moveToward() are required.
   */
  function makePathCtx(
    overrides: {
      x?: number;
      y?: number;
      pathfinding?: IPathfindingAccess | null;
    } = {},
  ): INPCContext {
    return {
      npcId: 'npc-path',
      factionId: 'test',
      entityType: 'human',
      x: overrides.x ?? 0,
      y: overrides.y ?? 0,
      state: createDefaultNPCOnlineState(),
      perception: null,
      health: null,
      cover: null,
      danger: null,
      restrictedZones: null,
      squad: null,
      pack: null,
      conditions: null,
      suspicion: null,
      pathfinding: overrides.pathfinding ?? null,
      setVelocity: vi.fn(),
      halt: vi.fn(),
      setRotation: vi.fn(),
      setAlpha: vi.fn(),
      teleport: vi.fn(),
      disablePhysics: vi.fn(),
      emitShoot: vi.fn(),
      emitMeleeHit: vi.fn(),
      emitVocalization: vi.fn(),
      emitPsiAttackStart: vi.fn(),
      transition: vi.fn(),
      currentStateId: 'IDLE',
      now: () => 0,
      random: () => 0.5,
    };
  }

  function makePathfinding(overrides: Partial<IPathfindingAccess> = {}): IPathfindingAccess {
    return {
      findPath: vi.fn().mockReturnValue([{ x: 50, y: 50 }]),
      getNextWaypoint: vi.fn().mockReturnValue({ x: 50, y: 50 }),
      setPath: vi.fn(),
      isNavigating: vi.fn().mockReturnValue(false),
      clearPath: vi.fn(),
      ...overrides,
    };
  }

  it('falls back to moveToward() when ctx.pathfinding is null', () => {
    // When pathfinding is null, the NPC should move directly toward the target.
    // We verify this by observing that setVelocity is called (moveToward does so).
    const ctx = makePathCtx({ x: 0, y: 0, pathfinding: null });

    moveAlongPath(ctx, 200, 0, 100);

    expect(ctx.setVelocity).toHaveBeenCalledOnce();
    // Direct movement toward (200, 0) from (0, 0) → vx = 100, vy = 0
    const [vx, vy] = (ctx.setVelocity as ReturnType<typeof vi.fn>).mock.calls[0] as [number, number];
    expect(vx).toBeCloseTo(100);
    expect(vy).toBeCloseTo(0);
  });

  it('uses pathfinding.getNextWaypoint() when pathfinding is available', () => {
    const waypoint = { x: 75, y: 0 };
    const pf = makePathfinding({
      isNavigating: vi.fn().mockReturnValue(true), // already navigating — skip findPath
      getNextWaypoint: vi.fn().mockReturnValue(waypoint),
    });
    const ctx = makePathCtx({ x: 0, y: 0, pathfinding: pf });

    moveAlongPath(ctx, 200, 0, 100);

    expect(pf.getNextWaypoint).toHaveBeenCalledOnce();
    // The NPC should move toward the waypoint, not the raw target.
    expect(ctx.setVelocity).toHaveBeenCalledOnce();
    const [vx] = (ctx.setVelocity as ReturnType<typeof vi.fn>).mock.calls[0] as [number, number];
    expect(vx).toBeCloseTo(100); // moving right toward waypoint at x=75
  });

  it('calls pathfinding.findPath() when not navigating', () => {
    const pf = makePathfinding({
      isNavigating: vi.fn().mockReturnValue(false), // not navigating → must call findPath
      getNextWaypoint: vi.fn().mockReturnValue({ x: 100, y: 0 }),
    });
    const ctx = makePathCtx({ x: 0, y: 0, pathfinding: pf });

    moveAlongPath(ctx, 200, 0, 100);

    expect(pf.findPath).toHaveBeenCalledOnce();
    expect(pf.findPath).toHaveBeenCalledWith(200, 0);
  });

  it('does NOT call findPath() when already navigating', () => {
    const pf = makePathfinding({
      isNavigating: vi.fn().mockReturnValue(true), // already navigating → skip findPath
      getNextWaypoint: vi.fn().mockReturnValue({ x: 50, y: 0 }),
    });
    const ctx = makePathCtx({ x: 0, y: 0, pathfinding: pf });

    moveAlongPath(ctx, 200, 0, 100);

    expect(pf.findPath).not.toHaveBeenCalled();
  });

  it('falls back to direct moveToward() when getNextWaypoint() returns null', () => {
    // If pathfinding is present but has no waypoint (path completed or none set),
    // moveAlongPath must fall back to direct movement.
    const pf = makePathfinding({
      isNavigating: vi.fn().mockReturnValue(true),
      getNextWaypoint: vi.fn().mockReturnValue(null), // no waypoint
    });
    const ctx = makePathCtx({ x: 0, y: 0, pathfinding: pf });

    moveAlongPath(ctx, 200, 0, 100);

    // setVelocity is still called — direct movement fallback.
    expect(ctx.setVelocity).toHaveBeenCalledOnce();
    const [vx] = (ctx.setVelocity as ReturnType<typeof vi.fn>).mock.calls[0] as [number, number];
    expect(vx).toBeCloseTo(100); // toward target (200, 0)
  });
});
