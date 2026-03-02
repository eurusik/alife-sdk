// states/driver.test.ts
// Tests for OnlineAIDriver — per-NPC FSM coordinator.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OnlineAIDriver } from './OnlineAIDriver';
import type { IOnlineDriverHost } from './OnlineAIDriver';
import type { IOnlineStateHandler } from './IOnlineStateHandler';
import type { INPCContext } from './INPCContext';
import type { INPCOnlineState } from './INPCOnlineState';
import { createDefaultNPCOnlineState } from './NPCOnlineState';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal IOnlineDriverHost (everything except transition + currentStateId).
 */
function makeHost(overrides: Partial<IOnlineDriverHost> = {}): IOnlineDriverHost {
  const state: INPCOnlineState = createDefaultNPCOnlineState();
  return {
    npcId: 'npc-1',
    factionId: 'stalker',
    entityType: 'human',
    x: 100,
    y: 100,
    state,
    perception: null,
    health: null,
    cover: null,
    danger: null,
    restrictedZones: null,
    squad: null,
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

/**
 * Create a mock IOnlineStateHandler with vi.fn() for all lifecycle methods.
 */
function makeMockHandler(id?: string): IOnlineStateHandler & { _id: string } {
  return {
    _id: id ?? 'mock',
    enter:  vi.fn(),
    update: vi.fn(),
    exit:   vi.fn(),
  };
}

/**
 * Build a Map with named mock handlers.
 */
function makeHandlerMap(
  states: string[],
): { map: Map<string, IOnlineStateHandler & { _id: string }>; handlers: Record<string, IOnlineStateHandler & { _id: string }> } {
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
// Constructor
// ---------------------------------------------------------------------------

describe('OnlineAIDriver constructor', () => {
  it('calls enter() on the initial state handler', () => {
    const { map, handlers } = makeHandlerMap(['IDLE', 'COMBAT']);
    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');

    expect(handlers['IDLE'].enter).toHaveBeenCalledOnce();
    expect(handlers['COMBAT'].enter).not.toHaveBeenCalled();
    void driver;
  });

  it('enter() receives the internal INPCContext (not the raw host)', () => {
    const { map, handlers } = makeHandlerMap(['IDLE']);
    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');

    const receivedCtx = (handlers['IDLE'].enter as ReturnType<typeof vi.fn>).mock.calls[0][0] as INPCContext;
    // The context should have transition and currentStateId bound to the driver
    expect(typeof receivedCtx.transition).toBe('function');
    expect(receivedCtx.currentStateId).toBe('IDLE');
    void driver;
  });

  it('sets currentStateId to initialState', () => {
    const { map } = makeHandlerMap(['PATROL']);
    const driver = new OnlineAIDriver(makeHost(), map, 'PATROL');
    expect(driver.currentStateId).toBe('PATROL');
  });

  it('throws if the initialState is not in the handler map', () => {
    const { map } = makeHandlerMap(['IDLE']);
    expect(() => new OnlineAIDriver(makeHost(), map, 'UNKNOWN')).toThrow(
      /OnlineAIDriver.*UNKNOWN/,
    );
  });
});

// ---------------------------------------------------------------------------
// update()
// ---------------------------------------------------------------------------

describe('OnlineAIDriver.update()', () => {
  it('calls update() on the current state handler with correct deltaMs', () => {
    const { map, handlers } = makeHandlerMap(['IDLE']);
    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');

    driver.update(16.7);
    expect(handlers['IDLE'].update).toHaveBeenCalledOnce();
    const [, delta] = (handlers['IDLE'].update as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(delta).toBeCloseTo(16.7);
  });

  it('does not call update on inactive handlers', () => {
    const { map, handlers } = makeHandlerMap(['IDLE', 'COMBAT', 'FLEE']);
    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');

    driver.update(16);
    expect(handlers['COMBAT'].update).not.toHaveBeenCalled();
    expect(handlers['FLEE'].update).not.toHaveBeenCalled();
  });

  it('passes the wrapped INPCContext to update()', () => {
    const { map, handlers } = makeHandlerMap(['IDLE']);
    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');

    driver.update(16);
    const receivedCtx = (handlers['IDLE'].update as ReturnType<typeof vi.fn>).mock.calls[0][0] as INPCContext;
    expect(receivedCtx.npcId).toBe('npc-1');
    expect(receivedCtx.currentStateId).toBe('IDLE');
  });

  it('multiple consecutive updates call update() each time', () => {
    const { map, handlers } = makeHandlerMap(['IDLE']);
    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');

    driver.update(16);
    driver.update(16);
    driver.update(16);
    expect(handlers['IDLE'].update).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// transition() via ctx.transition()
// ---------------------------------------------------------------------------

describe('OnlineAIDriver: state transitions triggered by handlers', () => {
  it('exit() is called on old state, enter() on new state', () => {
    const { map, handlers } = makeHandlerMap(['IDLE', 'COMBAT']);

    // When IDLE's update is called, it triggers a transition to COMBAT
    (handlers['IDLE'].update as ReturnType<typeof vi.fn>).mockImplementation(
      (ctx: INPCContext) => { ctx.transition('COMBAT'); }
    );

    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');
    (handlers['IDLE'].enter as ReturnType<typeof vi.fn>).mockClear();

    driver.update(16);

    expect(handlers['IDLE'].exit).toHaveBeenCalledOnce();
    expect(handlers['COMBAT'].enter).toHaveBeenCalledOnce();
  });

  it('currentStateId reflects the new state after transition', () => {
    const { map, handlers } = makeHandlerMap(['IDLE', 'COMBAT']);

    (handlers['IDLE'].update as ReturnType<typeof vi.fn>).mockImplementation(
      (ctx: INPCContext) => { ctx.transition('COMBAT'); }
    );

    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');
    driver.update(16);
    expect(driver.currentStateId).toBe('COMBAT');
  });

  it('ctx.currentStateId inside the NEW state handler reflects the transition', () => {
    const { map, handlers } = makeHandlerMap(['IDLE', 'COMBAT']);

    (handlers['IDLE'].update as ReturnType<typeof vi.fn>).mockImplementation(
      (ctx: INPCContext) => { ctx.transition('COMBAT'); }
    );

    let capturedStateId: string | null = null;
    (handlers['COMBAT'].enter as ReturnType<typeof vi.fn>).mockImplementation(
      (ctx: INPCContext) => { capturedStateId = ctx.currentStateId; }
    );

    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');
    driver.update(16);
    expect(capturedStateId).toBe('COMBAT');
    void driver;
  });

  it('multiple consecutive transitions work correctly', () => {
    const { map, handlers } = makeHandlerMap(['IDLE', 'ALERT', 'COMBAT', 'FLEE']);

    (handlers['IDLE'].update as ReturnType<typeof vi.fn>).mockImplementation(
      (ctx: INPCContext) => { ctx.transition('ALERT'); }
    );
    (handlers['ALERT'].update as ReturnType<typeof vi.fn>).mockImplementation(
      (ctx: INPCContext) => { ctx.transition('COMBAT'); }
    );
    (handlers['COMBAT'].update as ReturnType<typeof vi.fn>).mockImplementation(
      (ctx: INPCContext) => { ctx.transition('FLEE'); }
    );

    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');

    driver.update(16); // IDLE → ALERT
    expect(driver.currentStateId).toBe('ALERT');

    driver.update(16); // ALERT → COMBAT
    expect(driver.currentStateId).toBe('COMBAT');

    driver.update(16); // COMBAT → FLEE
    expect(driver.currentStateId).toBe('FLEE');
  });

  it('exit is called in order before enter on each transition', () => {
    const callOrder: string[] = [];
    const { map, handlers } = makeHandlerMap(['IDLE', 'COMBAT']);

    (handlers['IDLE'].enter as ReturnType<typeof vi.fn>).mockImplementation(
      () => { callOrder.push('IDLE:enter'); }
    );
    (handlers['IDLE'].exit as ReturnType<typeof vi.fn>).mockImplementation(
      () => { callOrder.push('IDLE:exit'); }
    );
    (handlers['COMBAT'].enter as ReturnType<typeof vi.fn>).mockImplementation(
      () => { callOrder.push('COMBAT:enter'); }
    );

    (handlers['IDLE'].update as ReturnType<typeof vi.fn>).mockImplementation(
      (ctx: INPCContext) => { ctx.transition('COMBAT'); }
    );

    new OnlineAIDriver(makeHost(), map, 'IDLE');
    // After constructor: ['IDLE:enter']
    expect(callOrder).toEqual(['IDLE:enter']);
    callOrder.length = 0;

    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');
    callOrder.length = 0; // reset after constructor
    driver.update(16);
    // IDLE:exit must come before COMBAT:enter
    expect(callOrder).toEqual(['IDLE:exit', 'COMBAT:enter']);
  });

  it('transition to unknown state throws error', () => {
    const { map, handlers } = makeHandlerMap(['IDLE']);

    (handlers['IDLE'].update as ReturnType<typeof vi.fn>).mockImplementation(
      (ctx: INPCContext) => { ctx.transition('BOGUS'); }
    );

    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');
    expect(() => driver.update(16)).toThrow(/OnlineAIDriver.*BOGUS/);
  });

  it('re-entrant transition (called inside exit) is silently ignored', () => {
    const { map, handlers } = makeHandlerMap(['IDLE', 'COMBAT', 'FLEE']);

    (handlers['IDLE'].update as ReturnType<typeof vi.fn>).mockImplementation(
      (ctx: INPCContext) => { ctx.transition('COMBAT'); }
    );
    // exit() of IDLE tries to transition again — should be ignored
    (handlers['IDLE'].exit as ReturnType<typeof vi.fn>).mockImplementation(
      (ctx: INPCContext) => { ctx.transition('FLEE'); }
    );

    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');
    driver.update(16);
    // The re-entrant call to FLEE inside exit should have been swallowed
    expect(driver.currentStateId).toBe('COMBAT');
    expect(handlers['FLEE'].enter).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// destroy()
// ---------------------------------------------------------------------------

describe('OnlineAIDriver.destroy()', () => {
  it('calls exit() on the current state handler', () => {
    const { map, handlers } = makeHandlerMap(['IDLE']);
    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');
    driver.destroy();
    expect(handlers['IDLE'].exit).toHaveBeenCalledOnce();
  });

  it('exit() receives the wrapped INPCContext', () => {
    const { map, handlers } = makeHandlerMap(['IDLE']);
    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');
    driver.destroy();

    const ctx = (handlers['IDLE'].exit as ReturnType<typeof vi.fn>).mock.calls[0][0] as INPCContext;
    expect(ctx.npcId).toBe('npc-1');
  });

  it('destroy() after a transition exits the final state', () => {
    const { map, handlers } = makeHandlerMap(['IDLE', 'COMBAT']);

    (handlers['IDLE'].update as ReturnType<typeof vi.fn>).mockImplementation(
      (ctx: INPCContext) => { ctx.transition('COMBAT'); }
    );

    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');
    driver.update(16); // transitions to COMBAT
    driver.destroy();

    expect(handlers['COMBAT'].exit).toHaveBeenCalledOnce();
    expect(handlers['IDLE'].exit).toHaveBeenCalledOnce(); // from transition
  });
});

// ---------------------------------------------------------------------------
// DriverContext delegation tests
// ---------------------------------------------------------------------------

describe('OnlineAIDriver: DriverContext delegates host operations', () => {
  let host: ReturnType<typeof makeHost>;
  let capturedCtx: INPCContext | null;

  beforeEach(() => {
    host = makeHost({ x: 200, y: 300 });
    capturedCtx = null;
  });

  function buildDriverCapturingCtx(stateId: string) {
    const { map, handlers } = makeHandlerMap([stateId]);
    (handlers[stateId].enter as ReturnType<typeof vi.fn>).mockImplementation(
      (ctx: INPCContext) => { capturedCtx = ctx; }
    );
    return new OnlineAIDriver(host, map, stateId);
  }

  it('ctx.npcId returns host.npcId', () => {
    buildDriverCapturingCtx('IDLE');
    expect(capturedCtx!.npcId).toBe('npc-1');
  });

  it('ctx.factionId returns host.factionId', () => {
    buildDriverCapturingCtx('IDLE');
    expect(capturedCtx!.factionId).toBe('stalker');
  });

  it('ctx.entityType returns host.entityType', () => {
    buildDriverCapturingCtx('IDLE');
    expect(capturedCtx!.entityType).toBe('human');
  });

  it('ctx.x / ctx.y delegate to host', () => {
    buildDriverCapturingCtx('IDLE');
    expect(capturedCtx!.x).toBe(200);
    expect(capturedCtx!.y).toBe(300);
  });

  it('ctx.state is the same object as host.state', () => {
    buildDriverCapturingCtx('IDLE');
    expect(capturedCtx!.state).toBe(host.state);
  });

  it('ctx.setVelocity delegates to host.setVelocity', () => {
    buildDriverCapturingCtx('IDLE');
    capturedCtx!.setVelocity(100, 50);
    expect(host.setVelocity).toHaveBeenCalledWith(100, 50);
  });

  it('ctx.halt delegates to host.halt', () => {
    buildDriverCapturingCtx('IDLE');
    capturedCtx!.halt();
    expect(host.halt).toHaveBeenCalled();
  });

  it('ctx.setRotation delegates to host.setRotation', () => {
    buildDriverCapturingCtx('IDLE');
    capturedCtx!.setRotation(Math.PI);
    expect(host.setRotation).toHaveBeenCalledWith(Math.PI);
  });

  it('ctx.setAlpha delegates to host.setAlpha', () => {
    buildDriverCapturingCtx('IDLE');
    capturedCtx!.setAlpha(0.5);
    expect(host.setAlpha).toHaveBeenCalledWith(0.5);
  });

  it('ctx.teleport delegates to host.teleport', () => {
    buildDriverCapturingCtx('IDLE');
    capturedCtx!.teleport(50, 75);
    expect(host.teleport).toHaveBeenCalledWith(50, 75);
  });

  it('ctx.disablePhysics delegates to host.disablePhysics', () => {
    buildDriverCapturingCtx('IDLE');
    capturedCtx!.disablePhysics();
    expect(host.disablePhysics).toHaveBeenCalled();
  });

  it('ctx.emitShoot delegates to host.emitShoot', () => {
    buildDriverCapturingCtx('IDLE');
    const payload = { npcId: 'npc-1', x: 100, y: 100, targetX: 200, targetY: 200, weaponType: 'rifle' };
    capturedCtx!.emitShoot(payload);
    expect(host.emitShoot).toHaveBeenCalledWith(payload);
  });

  it('ctx.emitMeleeHit delegates to host.emitMeleeHit', () => {
    buildDriverCapturingCtx('IDLE');
    const payload = { npcId: 'npc-1', targetId: 'enemy-1', damage: 20 };
    capturedCtx!.emitMeleeHit(payload);
    expect(host.emitMeleeHit).toHaveBeenCalledWith(payload);
  });

  it('ctx.emitVocalization delegates to host.emitVocalization', () => {
    buildDriverCapturingCtx('IDLE');
    capturedCtx!.emitVocalization('PAIN');
    expect(host.emitVocalization).toHaveBeenCalledWith('PAIN');
  });

  it('ctx.emitPsiAttackStart delegates to host.emitPsiAttackStart', () => {
    buildDriverCapturingCtx('IDLE');
    capturedCtx!.emitPsiAttackStart(10, 20);
    expect(host.emitPsiAttackStart).toHaveBeenCalledWith(10, 20);
  });

  it('ctx.now() delegates to host.now()', () => {
    const hostWithTime = makeHost({ now: () => 12345 });
    const { map, handlers } = makeHandlerMap(['IDLE']);
    (handlers['IDLE'].enter as ReturnType<typeof vi.fn>).mockImplementation(
      (ctx: INPCContext) => { capturedCtx = ctx; }
    );
    new OnlineAIDriver(hostWithTime, map, 'IDLE');
    expect(capturedCtx!.now()).toBe(12345);
  });

  it('ctx.random() delegates to host.random()', () => {
    const hostWithRandom = makeHost({ random: () => 0.42 });
    const { map, handlers } = makeHandlerMap(['IDLE']);
    (handlers['IDLE'].enter as ReturnType<typeof vi.fn>).mockImplementation(
      (ctx: INPCContext) => { capturedCtx = ctx; }
    );
    new OnlineAIDriver(hostWithRandom, map, 'IDLE');
    expect(capturedCtx!.random()).toBeCloseTo(0.42);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('OnlineAIDriver: edge cases', () => {
  it('transition to same state is allowed (exit + enter re-fires)', () => {
    const { map, handlers } = makeHandlerMap(['IDLE']);

    (handlers['IDLE'].update as ReturnType<typeof vi.fn>).mockImplementationOnce(
      (ctx: INPCContext) => { ctx.transition('IDLE'); }
    );

    const driver = new OnlineAIDriver(makeHost(), map, 'IDLE');
    const enterBefore = (handlers['IDLE'].enter as ReturnType<typeof vi.fn>).mock.calls.length;
    driver.update(16);
    // Should call exit once + enter again
    expect(handlers['IDLE'].exit).toHaveBeenCalledOnce();
    const enterAfter = (handlers['IDLE'].enter as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(enterAfter).toBe(enterBefore + 1);
  });

  it('single-state map works as long as no unknown transitions are triggered', () => {
    const { map, handlers } = makeHandlerMap(['DEAD']);
    const driver = new OnlineAIDriver(makeHost(), map, 'DEAD');
    driver.update(100);
    expect(handlers['DEAD'].update).toHaveBeenCalledOnce();
  });

  it('handler map with many states — only active one receives update calls', () => {
    const states = ['IDLE', 'PATROL', 'ALERT', 'COMBAT', 'FLEE', 'SEARCH', 'DEAD', 'WOUNDED'];
    const { map, handlers } = makeHandlerMap(states);
    const driver = new OnlineAIDriver(makeHost(), map, 'PATROL');

    driver.update(16);
    driver.update(16);

    expect(handlers['PATROL'].update).toHaveBeenCalledTimes(2);
    for (const s of states.filter(x => x !== 'PATROL')) {
      expect(handlers[s].update).not.toHaveBeenCalled();
    }
  });

  it('ctx.perception / cover / danger etc. are null by default (host provides null)', () => {
    let capturedCtx: INPCContext | null = null;
    const { map, handlers } = makeHandlerMap(['IDLE']);
    (handlers['IDLE'].enter as ReturnType<typeof vi.fn>).mockImplementation(
      (ctx: INPCContext) => { capturedCtx = ctx; }
    );
    new OnlineAIDriver(makeHost(), map, 'IDLE');
    expect(capturedCtx!.perception).toBeNull();
    expect(capturedCtx!.health).toBeNull();
    expect(capturedCtx!.cover).toBeNull();
    expect(capturedCtx!.danger).toBeNull();
    expect(capturedCtx!.restrictedZones).toBeNull();
    expect(capturedCtx!.squad).toBeNull();
  });
});
