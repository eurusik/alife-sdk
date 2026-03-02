import { describe, it, expect, vi } from 'vitest';
import { AIStateRegistry } from './AIStateRegistry';
import type { IAIStateDefinition, IStateHandler } from './AIStateRegistry';
import type { IEntity } from '../entity/IEntity';

function stubHandler(): IStateHandler {
  return {
    enter: vi.fn(),
    update: vi.fn(),
    exit: vi.fn(),
  };
}

function stubEntity(): IEntity {
  return {} as IEntity;
}

describe('AIStateRegistry', () => {
  // -----------------------------------------------------------------------
  // Fluent chaining
  // -----------------------------------------------------------------------
  describe('fluent chaining', () => {
    it('register() returns `this` for chaining', () => {
      const registry = new AIStateRegistry();

      const def1: IAIStateDefinition = { handler: stubHandler() };
      const result = registry.register('idle', def1);

      expect(result).toBe(registry);
    });

    it('supports chained register() calls without error', () => {
      const registry = new AIStateRegistry();

      const def1: IAIStateDefinition = { handler: stubHandler() };
      const def2: IAIStateDefinition = { handler: stubHandler() };
      const def3: IAIStateDefinition = { handler: stubHandler() };

      registry
        .register('idle', def1)
        .register('patrol', def2)
        .register('combat', def3);

      expect(registry.has('idle')).toBe(true);
      expect(registry.has('patrol')).toBe(true);
      expect(registry.has('combat')).toBe(true);
      expect(registry.size).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // Pre-sorted transition conditions
  // -----------------------------------------------------------------------
  describe('transition condition pre-sorting', () => {
    it('sorts transition conditions by priority descending at registration time', () => {
      const registry = new AIStateRegistry();
      const entity = stubEntity();

      const order: string[] = [];

      const def: IAIStateDefinition = {
        handler: stubHandler(),
        transitionConditions: [
          { targetState: 'low', condition: () => { order.push('low'); return false; }, priority: 1 },
          { targetState: 'high', condition: () => { order.push('high'); return false; }, priority: 10 },
          { targetState: 'mid', condition: () => { order.push('mid'); return false; }, priority: 5 },
        ],
      };

      registry.register('idle', def);
      registry.evaluateTransitions('idle', entity);

      // Conditions should have been evaluated in descending priority order
      expect(order).toEqual(['high', 'mid', 'low']);
    });
  });

  // -----------------------------------------------------------------------
  // evaluateTransitions
  // -----------------------------------------------------------------------
  describe('evaluateTransitions', () => {
    it('returns null when no transitions match', () => {
      const registry = new AIStateRegistry();
      const entity = stubEntity();

      const def: IAIStateDefinition = {
        handler: stubHandler(),
        transitionConditions: [
          { targetState: 'combat', condition: () => false, priority: 1 },
        ],
      };

      registry.register('idle', def);

      expect(registry.evaluateTransitions('idle', entity)).toBeNull();
    });

    it('returns the first matching target state (highest priority)', () => {
      const registry = new AIStateRegistry();
      const entity = stubEntity();

      const def: IAIStateDefinition = {
        handler: stubHandler(),
        transitionConditions: [
          { targetState: 'low-match', condition: () => true, priority: 1 },
          { targetState: 'high-match', condition: () => true, priority: 10 },
        ],
      };

      registry.register('idle', def);

      expect(registry.evaluateTransitions('idle', entity)).toBe('high-match');
    });

    it('returns null for state with no transition conditions', () => {
      const registry = new AIStateRegistry();
      const entity = stubEntity();

      registry.register('idle', { handler: stubHandler() });

      expect(registry.evaluateTransitions('idle', entity)).toBeNull();
    });

    it('returns null for unknown state', () => {
      const registry = new AIStateRegistry();
      const entity = stubEntity();

      expect(registry.evaluateTransitions('nonexistent', entity)).toBeNull();
    });
  });
});
