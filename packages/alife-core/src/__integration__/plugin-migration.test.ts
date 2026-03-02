// Integration tests: IALifePlugin.migrateState() and serialize()/restore() round-trips
//
// These tests use plain-object stubs (no vi.fn()) and real ALifeKernel instances
// to verify that plugin-level state migration is invoked correctly by restoreState().

import { describe, it, expect, beforeEach } from 'vitest';
import { ALifeKernel, KERNEL_STATE_VERSION } from '../core/ALifeKernel';
import type { IALifeKernelState, IPluginStateCapsule } from '../core/ALifeKernel';
import { Ports } from '../core/PortTokens';
import type { IALifePlugin } from '../plugins/IALifePlugin';
import type { IEntityAdapter } from '../ports/IEntityAdapter';
import type { IPlayerPositionProvider } from '../ports/IPlayerPositionProvider';
import type { IEntityFactory } from '../ports/IEntityFactory';

// ---------------------------------------------------------------------------
// Plain-object stubs (no vi.fn())
// ---------------------------------------------------------------------------

function stubEntityAdapter(): IEntityAdapter {
  return {
    getPosition: () => ({ x: 0, y: 0 }),
    isAlive: () => true,
    hasComponent: () => false,
    getComponentValue: () => null,
    setPosition: () => {},
    setActive: () => {},
    setVisible: () => {},
    setVelocity: () => {},
    getVelocity: () => ({ x: 0, y: 0 }),
    setRotation: () => {},
    teleport: () => {},
    disablePhysics: () => {},
    setAlpha: () => {},
    playAnimation: () => {},
    hasAnimation: () => false,
  };
}

function stubPlayerPosition(): IPlayerPositionProvider {
  return { getPlayerPosition: () => ({ x: 0, y: 0 }) };
}

function stubEntityFactory(): IEntityFactory {
  return {
    createNPC: () => 'npc-stub',
    createMonster: () => 'mon-stub',
    destroyEntity: () => {},
  };
}

function createKernel(): ALifeKernel {
  return new ALifeKernel()
    .provide(Ports.EntityAdapter, stubEntityAdapter())
    .provide(Ports.PlayerPosition, stubPlayerPosition())
    .provide(Ports.EntityFactory, stubEntityFactory());
}

// ---------------------------------------------------------------------------
// Helper: build a kernel state capsule with a specific version for a plugin.
// ---------------------------------------------------------------------------

function buildStateWithPluginCapsule(
  kernel: ALifeKernel,
  pluginName: string,
  capsule: IPluginStateCapsule,
): IALifeKernelState {
  const base = kernel.serialize();
  return {
    ...base,
    plugins: {
      ...base.plugins,
      [pluginName]: capsule,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Plugin migrateState() integration', () => {
  let kernel: ALifeKernel;

  beforeEach(() => {
    kernel = createKernel();
  });

  // -------------------------------------------------------------------------
  // 1. Plugin with migrateState upgrades old state before restore()
  // -------------------------------------------------------------------------

  it('1. migrateState() is called when capsule version is older than KERNEL_STATE_VERSION', () => {
    let migrateCalledWith: { state: Record<string, unknown>; fromVersion: number } | null = null;
    let restoredWith: Record<string, unknown> | null = null;

    const plugin: IALifePlugin = {
      name: 'versioned-plugin',
      install() {},
      serialize() { return { count: 1 }; },
      migrateState(state, fromVersion) {
        migrateCalledWith = { state, fromVersion };
        // Upgrade: rename "count" to "total"
        return { total: (state['count'] as number ?? 0) + 100, version: KERNEL_STATE_VERSION };
      },
      restore(state) {
        restoredWith = state;
      },
    };

    kernel.use(plugin);
    kernel.init();

    // Build a state where the plugin capsule has an older version (0)
    const oldCapsule: IPluginStateCapsule = { version: 0, state: { count: 7 } };
    const oldState = buildStateWithPluginCapsule(kernel, 'versioned-plugin', oldCapsule);

    kernel.restoreState(oldState);

    expect(migrateCalledWith).not.toBeNull();
    expect(migrateCalledWith!.fromVersion).toBe(0);
    expect(migrateCalledWith!.state).toEqual({ count: 7 });
    // migrateState output is forwarded to restore()
    expect(restoredWith).toEqual({ total: 107, version: KERNEL_STATE_VERSION });
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 2. migrateState() is NOT called when capsule version matches current
  // -------------------------------------------------------------------------

  it('2. migrateState() is not called when capsule version matches KERNEL_STATE_VERSION', () => {
    let migrateCalled = false;
    let restoredWith: Record<string, unknown> | null = null;

    const plugin: IALifePlugin = {
      name: 'up-to-date-plugin',
      install() {},
      serialize() { return { score: 99 }; },
      migrateState(_state, _fromVersion) {
        migrateCalled = true;
        return _state;
      },
      restore(state) {
        restoredWith = state;
      },
    };

    kernel.use(plugin);
    kernel.init();

    // Capsule with current version — no migration needed
    const currentCapsule: IPluginStateCapsule = {
      version: KERNEL_STATE_VERSION,
      state: { score: 99 },
    };
    const state = buildStateWithPluginCapsule(kernel, 'up-to-date-plugin', currentCapsule);

    kernel.restoreState(state);

    expect(migrateCalled).toBe(false);
    expect(restoredWith).toEqual({ score: 99 });
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 3. Plugin without migrateState restores without error
  // -------------------------------------------------------------------------

  it('3. plugin without migrateState restores old state without error', () => {
    let restoredWith: Record<string, unknown> | null = null;

    const plugin: IALifePlugin = {
      name: 'no-migrate-plugin',
      install() {},
      serialize() { return { x: 10 }; },
      // No migrateState defined
      restore(state) {
        restoredWith = state;
      },
    };

    kernel.use(plugin);
    kernel.init();

    // Old version capsule — no migrateState, so raw state is passed to restore()
    const oldCapsule: IPluginStateCapsule = { version: 0, state: { x: 10 } };
    const oldState = buildStateWithPluginCapsule(kernel, 'no-migrate-plugin', oldCapsule);

    expect(() => kernel.restoreState(oldState)).not.toThrow();
    expect(restoredWith).toEqual({ x: 10 });
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 4. migrateState() returns new object, not mutates in place
  // -------------------------------------------------------------------------

  it('4. migrateState() returns a new state object rather than mutating the input', () => {
    let originalStateRef: Record<string, unknown> | null = null;
    let migratedStateRef: Record<string, unknown> | null = null;

    const plugin: IALifePlugin = {
      name: 'immutable-migrate-plugin',
      install() {},
      serialize() { return { val: 1 }; },
      migrateState(state, _fromVersion) {
        originalStateRef = state;
        // Return a new object, not a mutation
        const migrated = { val: (state['val'] as number) * 10 };
        migratedStateRef = migrated;
        return migrated;
      },
      restore(_state) {},
    };

    kernel.use(plugin);
    kernel.init();

    const capsule: IPluginStateCapsule = { version: 0, state: { val: 5 } };
    const oldState = buildStateWithPluginCapsule(kernel, 'immutable-migrate-plugin', capsule);

    kernel.restoreState(oldState);

    // The returned object is different from the input
    expect(migratedStateRef).not.toBe(originalStateRef);
    expect(migratedStateRef).toEqual({ val: 50 });
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 5. Multiple plugins — only those with outdated capsule versions get migrated
  // -------------------------------------------------------------------------

  it('5. only plugins whose capsule version is older than KERNEL_STATE_VERSION get migrated', () => {
    const migratedPlugins: string[] = [];

    const pluginA: IALifePlugin = {
      name: 'old-plugin',
      install() {},
      serialize() { return { a: 1 }; },
      migrateState(state, _fromVersion) {
        migratedPlugins.push('old-plugin');
        return state;
      },
      restore() {},
    };

    const pluginB: IALifePlugin = {
      name: 'current-plugin',
      install() {},
      serialize() { return { b: 2 }; },
      migrateState(state, _fromVersion) {
        migratedPlugins.push('current-plugin');
        return state;
      },
      restore() {},
    };

    kernel.use(pluginA).use(pluginB);
    kernel.init();

    const state = kernel.serialize();
    // Manually override pluginA capsule to be old version
    const patchedState: IALifeKernelState = {
      ...state,
      plugins: {
        ...state.plugins,
        'old-plugin': { version: 0, state: { a: 1 } },
        'current-plugin': { version: KERNEL_STATE_VERSION, state: { b: 2 } },
      },
    };

    kernel.restoreState(patchedState);

    expect(migratedPlugins).toContain('old-plugin');
    expect(migratedPlugins).not.toContain('current-plugin');
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 6. serialize() → restoreState() round-trip preserves plugin state exactly
  // -------------------------------------------------------------------------

  it('6. serialize() → restoreState() round-trip: restore() receives exact serialized data', () => {
    const serializedData = { hp: 100, inventory: ['medkit', 'vodka'], pos: { x: 50, y: 75 } };
    let restoredWith: Record<string, unknown> | null = null;

    const plugin: IALifePlugin = {
      name: 'round-trip-plugin',
      install() {},
      serialize() { return serializedData; },
      restore(state) { restoredWith = state; },
    };

    kernel.use(plugin);
    kernel.init();

    const saved = kernel.serialize();
    kernel.restoreState(saved);

    expect(restoredWith).toEqual(serializedData);
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 7. serialize() wraps plugin state in capsule with KERNEL_STATE_VERSION
  // -------------------------------------------------------------------------

  it('7. serialize() stores plugin state in capsule format with current version tag', () => {
    const plugin: IALifePlugin = {
      name: 'capsule-check-plugin',
      install() {},
      serialize() { return { entities: 42 }; },
    };

    kernel.use(plugin);
    kernel.init();

    const saved = kernel.serialize();
    const capsule = saved.plugins?.['capsule-check-plugin'];

    expect(capsule).toBeDefined();
    expect(capsule?.version).toBe(KERNEL_STATE_VERSION);
    expect(capsule?.state).toEqual({ entities: 42 });
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 8. Plugin without serialize() does not appear in saved plugins map
  // -------------------------------------------------------------------------

  it('8. plugin without serialize() is absent from the saved plugins map', () => {
    const plugin: IALifePlugin = {
      name: 'no-serialize-plugin',
      install() {},
      // No serialize defined
    };

    kernel.use(plugin);
    kernel.init();

    const saved = kernel.serialize();
    expect(saved.plugins?.['no-serialize-plugin']).toBeUndefined();
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 9. restoreState() restores tick counter from saved state
  // -------------------------------------------------------------------------

  it('9. restoreState() restores the tick counter alongside plugin state', () => {
    const plugin: IALifePlugin = {
      name: 'tick-check-plugin',
      install() {},
      serialize() { return { step: 55 }; },
      restore() {},
    };

    kernel.use(plugin);
    kernel.init();
    kernel.step(13);

    const saved = kernel.serialize();
    expect(saved.tick).toBe(13);

    // Restore into a fresh kernel
    const kernel2 = createKernel();
    kernel2.use({
      name: 'tick-check-plugin',
      install() {},
      serialize() { return { step: 55 }; },
      restore() {},
    });
    kernel2.init();
    kernel2.restoreState(saved);

    expect(kernel2.tick).toBe(13);
    kernel.destroy();
    kernel2.destroy();
  });

  // -------------------------------------------------------------------------
  // 10. restoreState() with state version newer than KERNEL_STATE_VERSION throws
  // -------------------------------------------------------------------------

  it('10. restoreState() throws when saved version is newer than KERNEL_STATE_VERSION', () => {
    kernel.init();

    const futureState: IALifeKernelState = {
      ...kernel.serialize(),
      version: KERNEL_STATE_VERSION + 99,
    };

    expect(() => kernel.restoreState(futureState)).toThrow('newer than current');
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 11. restoreState() with older version and registered migration succeeds
  // -------------------------------------------------------------------------

  it('11. restoreState() with older version runs registered kernel-level migration', () => {
    let migrationRan = false;

    kernel.registerMigration(0, (s) => {
      migrationRan = true;
      return { ...s, version: KERNEL_STATE_VERSION };
    });
    kernel.init();

    const oldState: IALifeKernelState = {
      ...kernel.serialize(),
      version: 0,
    };

    expect(() => kernel.restoreState(oldState)).not.toThrow();
    expect(migrationRan).toBe(true);
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 12. restoreState() with older version and NO migration throws descriptive error
  // -------------------------------------------------------------------------

  it('12. restoreState() throws descriptive error when no migration is registered for old version', () => {
    kernel.init();

    const oldState: IALifeKernelState = {
      ...kernel.serialize(),
      version: 0,
    };

    expect(() => kernel.restoreState(oldState)).toThrow('No migration registered');
    kernel.destroy();
  });

  // -------------------------------------------------------------------------
  // 13. Migration that does not advance version must throw to prevent infinite loop
  // -------------------------------------------------------------------------

  it('13. restoreState() throws when migration does not advance the version (infinite loop guard)', () => {
    // A buggy migration that returns the same version it received — this would
    // cause an infinite loop before the guard was added.
    kernel.registerMigration(0, (s) => ({ ...s /* version unchanged: still 0 */ }));
    kernel.init();

    const oldState: IALifeKernelState = {
      ...kernel.serialize(),
      version: 0,
    };

    expect(() => kernel.restoreState(oldState)).toThrow();
    kernel.destroy();
  });
});
