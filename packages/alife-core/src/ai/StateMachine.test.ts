import { StateMachine } from './StateMachine';
import type { StateTransitionEvent } from './StateMachine';
import { AIStateRegistry } from '../registry/AIStateRegistry';
import type { IAIStateDefinition, IStateHandler } from '../registry/AIStateRegistry';
import type { IEntity } from '../entity/IEntity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockEntity(overrides: Partial<IEntity> = {}): IEntity {
  return {
    id: 'test-entity',
    entityType: 'npc',
    isAlive: true,
    x: 0,
    y: 0,
    active: true,
    setPosition: vi.fn(),
    setActive: vi.fn().mockReturnThis(),
    setVisible: vi.fn().mockReturnThis(),
    hasComponent: vi.fn().mockReturnValue(false),
    getComponent: vi.fn(),
    ...overrides,
  };
}

function createMockHandler(): IStateHandler {
  return {
    enter: vi.fn(),
    update: vi.fn(),
    exit: vi.fn(),
  };
}

function buildRegistry(
  states: Record<string, Partial<IAIStateDefinition>>,
): AIStateRegistry {
  const registry = new AIStateRegistry();
  for (const [id, partial] of Object.entries(states)) {
    registry.register(id, {
      handler: partial.handler ?? createMockHandler(),
      ...partial,
    } as IAIStateDefinition);
  }
  return registry;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StateMachine', () => {
  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  describe('constructor', () => {
    it('enters the initial state on construction', () => {
      const handler = createMockHandler();
      const registry = buildRegistry({ idle: { handler } });
      const entity = createMockEntity();

      new StateMachine(entity, registry, 'idle');

      expect(handler.enter).toHaveBeenCalledTimes(1);
      expect(handler.enter).toHaveBeenCalledWith(entity);
    });

    it('exposes the current state id via .state', () => {
      const registry = buildRegistry({ idle: {} });
      const entity = createMockEntity();

      const fsm = new StateMachine(entity, registry, 'idle');
      expect(fsm.state).toBe('idle');
    });
  });

  // -------------------------------------------------------------------------
  // transition()
  // -------------------------------------------------------------------------

  describe('transition', () => {
    it('calls exit() on old state then enter() on new state', () => {
      const idleHandler = createMockHandler();
      const patrolHandler = createMockHandler();
      const registry = buildRegistry({
        idle: { handler: idleHandler },
        patrol: { handler: patrolHandler },
      });
      const entity = createMockEntity();

      const fsm = new StateMachine(entity, registry, 'idle');
      // Reset enter call from construction
      idleHandler.enter.mockClear();

      const callOrder: string[] = [];
      idleHandler.exit.mockImplementation(() => callOrder.push('idle.exit'));
      patrolHandler.enter.mockImplementation(() => callOrder.push('patrol.enter'));

      const result = fsm.transition('patrol');

      expect(result).toEqual({ success: true });
      expect(fsm.state).toBe('patrol');
      expect(callOrder).toEqual(['idle.exit', 'patrol.enter']);
    });

    it('allows transitioning to the same state (reset semantics)', () => {
      const handler = createMockHandler();
      const registry = buildRegistry({ idle: { handler } });
      const entity = createMockEntity();

      const fsm = new StateMachine(entity, registry, 'idle');
      handler.enter.mockClear();

      const result = fsm.transition('idle');

      expect(result).toEqual({ success: true });
      expect(handler.exit).toHaveBeenCalledTimes(1);
      expect(handler.enter).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // Guards
  // -------------------------------------------------------------------------

  describe('guards', () => {
    it('blocks transition when canEnter returns false', () => {
      const idleHandler = createMockHandler();
      const combatHandler = createMockHandler();
      const registry = buildRegistry({
        idle: { handler: idleHandler },
        combat: {
          handler: combatHandler,
          canEnter: () => false,
        },
      });
      const entity = createMockEntity();

      const fsm = new StateMachine(entity, registry, 'idle');
      idleHandler.enter.mockClear();

      const result = fsm.transition('combat');

      expect(result).toEqual({ success: false, reason: 'enter_guard' });
      expect(fsm.state).toBe('idle');
      expect(idleHandler.exit).not.toHaveBeenCalled();
      expect(combatHandler.enter).not.toHaveBeenCalled();
    });

    it('blocks transition when canExit returns false', () => {
      const idleHandler = createMockHandler();
      const patrolHandler = createMockHandler();
      const registry = buildRegistry({
        idle: {
          handler: idleHandler,
          canExit: () => false,
        },
        patrol: { handler: patrolHandler },
      });
      const entity = createMockEntity();

      const fsm = new StateMachine(entity, registry, 'idle');
      idleHandler.enter.mockClear();

      const result = fsm.transition('patrol');

      expect(result).toEqual({ success: false, reason: 'exit_guard' });
      expect(fsm.state).toBe('idle');
      expect(idleHandler.exit).not.toHaveBeenCalled();
      expect(patrolHandler.enter).not.toHaveBeenCalled();
    });

    it('allows transition when both guards return true', () => {
      const registry = buildRegistry({
        idle: {
          handler: createMockHandler(),
          canExit: () => true,
        },
        patrol: {
          handler: createMockHandler(),
          canEnter: () => true,
        },
      });
      const entity = createMockEntity();

      const fsm = new StateMachine(entity, registry, 'idle');

      expect(fsm.transition('patrol').success).toBe(true);
      expect(fsm.state).toBe('patrol');
    });
  });

  // -------------------------------------------------------------------------
  // allowedTransitions whitelist
  // -------------------------------------------------------------------------

  describe('allowedTransitions', () => {
    it('blocks transition to a state not in the whitelist', () => {
      const idleHandler = createMockHandler();
      const combatHandler = createMockHandler();
      const registry = buildRegistry({
        idle: {
          handler: idleHandler,
          allowedTransitions: ['patrol'],
        },
        patrol: { handler: createMockHandler() },
        combat: { handler: combatHandler },
      });
      const entity = createMockEntity();

      const fsm = new StateMachine(entity, registry, 'idle');
      idleHandler.enter.mockClear();

      const result = fsm.transition('combat');

      expect(result).toEqual({ success: false, reason: 'not_allowed' });
      expect(fsm.state).toBe('idle');
      expect(idleHandler.exit).not.toHaveBeenCalled();
      expect(combatHandler.enter).not.toHaveBeenCalled();
    });

    it('allows transition to a state in the whitelist', () => {
      const registry = buildRegistry({
        idle: {
          handler: createMockHandler(),
          allowedTransitions: ['patrol', 'combat'],
        },
        patrol: { handler: createMockHandler() },
        combat: { handler: createMockHandler() },
      });
      const entity = createMockEntity();

      const fsm = new StateMachine(entity, registry, 'idle');

      expect(fsm.transition('patrol').success).toBe(true);
      expect(fsm.state).toBe('patrol');
    });

    it('does not restrict transitions when allowedTransitions is unset', () => {
      const registry = buildRegistry({
        idle: { handler: createMockHandler() },
        combat: { handler: createMockHandler() },
      });
      const entity = createMockEntity();

      const fsm = new StateMachine(entity, registry, 'idle');

      expect(fsm.transition('combat').success).toBe(true);
      expect(fsm.state).toBe('combat');
    });

    it('blocks auto-transitions to states not in the whitelist', () => {
      const entity = createMockEntity();
      const combatHandler = createMockHandler();
      const registry = buildRegistry({
        idle: {
          handler: createMockHandler(),
          allowedTransitions: ['patrol'],
          transitionConditions: [
            { targetState: 'combat', condition: () => true, priority: 10 },
          ],
        },
        patrol: { handler: createMockHandler() },
        combat: { handler: combatHandler },
      });

      const fsm = new StateMachine(entity, registry, 'idle');
      fsm.update(0.016);

      // combat is blocked by whitelist — FSM stays in idle
      expect(fsm.state).toBe('idle');
      expect(combatHandler.enter).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // update() and auto-transitions
  // -------------------------------------------------------------------------

  describe('update', () => {
    it('calls current handler update() with entity and delta', () => {
      const handler = createMockHandler();
      const registry = buildRegistry({ idle: { handler } });
      const entity = createMockEntity();

      const fsm = new StateMachine(entity, registry, 'idle');
      fsm.update(0.016);

      expect(handler.update).toHaveBeenCalledWith(entity, 0.016);
    });

    it('auto-transitions when a transitionCondition fires', () => {
      const idleHandler = createMockHandler();
      const alertHandler = createMockHandler();
      const entity = createMockEntity();

      const registry = buildRegistry({
        idle: {
          handler: idleHandler,
          transitionConditions: [
            {
              targetState: 'alert',
              condition: () => true,
              priority: 1,
            },
          ],
        },
        alert: { handler: alertHandler },
      });

      const fsm = new StateMachine(entity, registry, 'idle');
      fsm.update(0.016);

      expect(fsm.state).toBe('alert');
      expect(idleHandler.exit).toHaveBeenCalled();
      expect(alertHandler.enter).toHaveBeenCalled();
    });

    it('does not auto-transition when no condition fires', () => {
      const handler = createMockHandler();
      const registry = buildRegistry({
        idle: {
          handler,
          transitionConditions: [
            {
              targetState: 'alert',
              condition: () => false,
              priority: 1,
            },
          ],
        },
        alert: { handler: createMockHandler() },
      });
      const entity = createMockEntity();

      const fsm = new StateMachine(entity, registry, 'idle');
      fsm.update(0.016);

      expect(fsm.state).toBe('idle');
    });

    it('highest-priority condition wins', () => {
      const entity = createMockEntity();
      const registry = buildRegistry({
        idle: {
          handler: createMockHandler(),
          transitionConditions: [
            { targetState: 'low', condition: () => true, priority: 1 },
            { targetState: 'high', condition: () => true, priority: 10 },
            { targetState: 'mid', condition: () => true, priority: 5 },
          ],
        },
        low: { handler: createMockHandler() },
        mid: { handler: createMockHandler() },
        high: { handler: createMockHandler() },
      });

      const fsm = new StateMachine(entity, registry, 'idle');
      fsm.update(0.016);

      expect(fsm.state).toBe('high');
    });
  });

  // -------------------------------------------------------------------------
  // TransitionResult reason codes
  // -------------------------------------------------------------------------

  describe('TransitionResult reason codes', () => {
    it('returns reason: not_allowed when transition is blocked by allowedTransitions whitelist', () => {
      const registry = buildRegistry({
        idle: {
          handler: createMockHandler(),
          allowedTransitions: ['patrol'],
        },
        patrol: { handler: createMockHandler() },
        combat: { handler: createMockHandler() },
      });
      const entity = createMockEntity();
      const fsm = new StateMachine(entity, registry, 'idle');

      const result = fsm.transition('combat');

      expect(result).toEqual({ success: false, reason: 'not_allowed' });
    });

    it('returns reason: exit_guard when canExit returns false', () => {
      const registry = buildRegistry({
        locked: {
          handler: createMockHandler(),
          canExit: () => false,
        },
        patrol: { handler: createMockHandler() },
      });
      const entity = createMockEntity();
      const fsm = new StateMachine(entity, registry, 'locked');

      const result = fsm.transition('patrol');

      expect(result).toEqual({ success: false, reason: 'exit_guard' });
    });

    it('returns reason: enter_guard when canEnter returns false', () => {
      const registry = buildRegistry({
        idle: { handler: createMockHandler() },
        restricted: {
          handler: createMockHandler(),
          canEnter: () => false,
        },
      });
      const entity = createMockEntity();
      const fsm = new StateMachine(entity, registry, 'idle');

      const result = fsm.transition('restricted');

      expect(result).toEqual({ success: false, reason: 'enter_guard' });
    });
  });

  // -------------------------------------------------------------------------
  // previous / currentStateDuration
  // -------------------------------------------------------------------------

  describe('previous and currentStateDuration', () => {
    it('previous is null before any transition', () => {
      const registry = buildRegistry({ idle: {} });
      const fsm = new StateMachine(createMockEntity(), registry, 'idle');
      expect(fsm.previous).toBeNull();
    });

    it('previous reflects the state before the last transition', () => {
      const registry = buildRegistry({ idle: {}, patrol: {}, combat: {} });
      const fsm = new StateMachine(createMockEntity(), registry, 'idle');
      fsm.transition('patrol');
      expect(fsm.previous).toBe('idle');
      fsm.transition('combat');
      expect(fsm.previous).toBe('patrol');
    });

    it('currentStateDuration is a non-negative number', () => {
      const registry = buildRegistry({ idle: {} });
      const fsm = new StateMachine(createMockEntity(), registry, 'idle');
      expect(fsm.currentStateDuration).toBeGreaterThanOrEqual(0);
    });
  });

  // -------------------------------------------------------------------------
  // tags / metadata
  // -------------------------------------------------------------------------

  describe('hasTag / metadata', () => {
    it('hasTag returns true when current state has the tag', () => {
      const registry = buildRegistry({ combat: { tags: ['hostile', 'active'] } });
      const fsm = new StateMachine(createMockEntity(), registry, 'combat');
      expect(fsm.hasTag('hostile')).toBe(true);
      expect(fsm.hasTag('active')).toBe(true);
    });

    it('hasTag returns false when current state does not have the tag', () => {
      const registry = buildRegistry({ idle: { tags: ['passive'] } });
      const fsm = new StateMachine(createMockEntity(), registry, 'idle');
      expect(fsm.hasTag('hostile')).toBe(false);
    });

    it('hasTag returns false when no tags defined', () => {
      const registry = buildRegistry({ idle: {} });
      const fsm = new StateMachine(createMockEntity(), registry, 'idle');
      expect(fsm.hasTag('any')).toBe(false);
    });

    it('hasTag reflects current state after transition', () => {
      const registry = buildRegistry({
        idle: { tags: ['passive'] },
        combat: { tags: ['hostile'] },
      });
      const fsm = new StateMachine(createMockEntity(), registry, 'idle');
      expect(fsm.hasTag('passive')).toBe(true);
      fsm.transition('combat');
      expect(fsm.hasTag('passive')).toBe(false);
      expect(fsm.hasTag('hostile')).toBe(true);
    });

    it('metadata returns the state metadata object', () => {
      const registry = buildRegistry({ idle: { metadata: { animId: 'idle_anim', priority: 1 } } });
      const fsm = new StateMachine(createMockEntity(), registry, 'idle');
      expect(fsm.metadata).toEqual({ animId: 'idle_anim', priority: 1 });
    });

    it('metadata returns undefined when not defined', () => {
      const registry = buildRegistry({ idle: {} });
      const fsm = new StateMachine(createMockEntity(), registry, 'idle');
      expect(fsm.metadata).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Event subscriptions
  // -------------------------------------------------------------------------

  describe('onEnter / onExit / onChange', () => {
    it('onEnter fires when FSM enters the subscribed state', () => {
      const registry = buildRegistry({ idle: {}, patrol: {} });
      const fsm = new StateMachine(createMockEntity(), registry, 'idle');

      const calls: string[] = [];
      fsm.onEnter('patrol', (from) => calls.push(`enter:${from}`));
      fsm.transition('patrol');

      expect(calls).toEqual(['enter:idle']);
    });

    it('onExit fires when FSM exits the subscribed state', () => {
      const registry = buildRegistry({ idle: {}, patrol: {} });
      const fsm = new StateMachine(createMockEntity(), registry, 'idle');

      const calls: string[] = [];
      fsm.onExit('idle', (to) => calls.push(`exit:${to}`));
      fsm.transition('patrol');

      expect(calls).toEqual(['exit:patrol']);
    });

    it('onChange fires on every transition', () => {
      const registry = buildRegistry({ idle: {}, patrol: {}, combat: {} });
      const fsm = new StateMachine(createMockEntity(), registry, 'idle');

      const calls: string[] = [];
      fsm.onChange((from, to) => calls.push(`${from}->${to}`));
      fsm.transition('patrol');
      fsm.transition('combat');

      expect(calls).toEqual(['idle->patrol', 'patrol->combat']);
    });

    it('unsubscribe stops future callbacks', () => {
      const registry = buildRegistry({ idle: {}, patrol: {} });
      const fsm = new StateMachine(createMockEntity(), registry, 'idle');

      const calls: string[] = [];
      const unsub = fsm.onEnter('patrol', () => calls.push('fired'));
      unsub();
      fsm.transition('patrol');

      expect(calls).toHaveLength(0);
    });

    it('subscriptions do not fire when transition is blocked', () => {
      const registry = buildRegistry({
        idle: { handler: createMockHandler() },
        locked: { handler: createMockHandler(), canEnter: () => false },
      });
      const fsm = new StateMachine(createMockEntity(), registry, 'idle');

      const calls: string[] = [];
      fsm.onEnter('locked', () => calls.push('entered'));
      fsm.onChange((f, t) => calls.push(`${f}->${t}`));
      fsm.transition('locked');

      expect(calls).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  describe('getHistory / clearHistory', () => {
    it('getHistory is empty on construction', () => {
      const registry = buildRegistry({ idle: {} });
      const fsm = new StateMachine(createMockEntity(), registry, 'idle');
      expect(fsm.getHistory()).toHaveLength(0);
    });

    it('getHistory records transitions in order', () => {
      const registry = buildRegistry({ idle: {}, patrol: {}, combat: {} });
      const fsm = new StateMachine(createMockEntity(), registry, 'idle');
      fsm.transition('patrol');
      fsm.transition('combat');

      const history = fsm.getHistory() as StateTransitionEvent[];
      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({ from: 'idle', to: 'patrol' });
      expect(history[1]).toMatchObject({ from: 'patrol', to: 'combat' });
    });

    it('getHistory entries have timestamps', () => {
      const registry = buildRegistry({ idle: {}, patrol: {} });
      const fsm = new StateMachine(createMockEntity(), registry, 'idle');
      fsm.transition('patrol');
      const [entry] = fsm.getHistory() as StateTransitionEvent[];
      expect(typeof entry.timestamp).toBe('number');
      expect(entry.timestamp).toBeGreaterThan(0);
    });

    it('clearHistory empties the log', () => {
      const registry = buildRegistry({ idle: {}, patrol: {} });
      const fsm = new StateMachine(createMockEntity(), registry, 'idle');
      fsm.transition('patrol');
      fsm.clearHistory();
      expect(fsm.getHistory()).toHaveLength(0);
    });

    it('getHistory returns a snapshot (not a live reference)', () => {
      const registry = buildRegistry({ idle: {}, patrol: {}, combat: {} });
      const fsm = new StateMachine(createMockEntity(), registry, 'idle');
      fsm.transition('patrol');
      const snapshot = fsm.getHistory();
      fsm.transition('combat');
      expect(snapshot).toHaveLength(1);
    });

    it('does not record blocked transitions', () => {
      const registry = buildRegistry({
        idle: {},
        locked: { canEnter: () => false },
      });
      const fsm = new StateMachine(createMockEntity(), registry, 'idle');
      fsm.transition('locked');
      expect(fsm.getHistory()).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // destroy()
  // -------------------------------------------------------------------------

  describe('destroy', () => {
    it('calls exit() on the current state', () => {
      const handler = createMockHandler();
      const registry = buildRegistry({ idle: { handler } });
      const entity = createMockEntity();

      const fsm = new StateMachine(entity, registry, 'idle');
      fsm.destroy();

      expect(handler.exit).toHaveBeenCalledWith(entity);
    });

    it('calls exit() on the last-transitioned state', () => {
      const idleHandler = createMockHandler();
      const combatHandler = createMockHandler();
      const registry = buildRegistry({
        idle: { handler: idleHandler },
        combat: { handler: combatHandler },
      });
      const entity = createMockEntity();

      const fsm = new StateMachine(entity, registry, 'idle');
      fsm.transition('combat');
      fsm.destroy();

      expect(combatHandler.exit).toHaveBeenCalledTimes(1);
    });
  });
});
