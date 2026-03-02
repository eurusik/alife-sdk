import { describe, it, expect, vi } from 'vitest';
import { PersistencePlugin, PersistencePluginToken } from './PersistencePlugin';
import { MemoryStorageProvider } from '../providers/MemoryStorageProvider';
import type { ALifeKernel, IALifeKernelState } from '@alife-sdk/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKernel(overrides?: Partial<Pick<ALifeKernel, 'serialize' | 'restoreState'>>): ALifeKernel {
  return {
    serialize: vi.fn().mockReturnValue({ version: 1, clock: {}, tick: 0, plugins: {} }),
    restoreState: vi.fn(),
    ...overrides,
  } as unknown as ALifeKernel;
}

// ---------------------------------------------------------------------------
// PersistencePlugin
// ---------------------------------------------------------------------------

describe('PersistencePlugin', () => {
  it('1. token name matches plugin name', () => {
    expect(PersistencePluginToken.name).toBe('persistence');
    const plugin = new PersistencePlugin({ backend: new MemoryStorageProvider() });
    expect(plugin.name).toBe('persistence');
  });

  it('2. save() calls backend.save() with valid JSON', () => {
    const backend = new MemoryStorageProvider();
    const kernel = makeKernel();
    const plugin = new PersistencePlugin({ backend });
    plugin.install(kernel);

    const result = plugin.save();

    expect(result.ok).toBe(true);
    const raw = backend.load('alife_save');
    expect(raw).not.toBeNull();
    expect(() => JSON.parse(raw!)).not.toThrow();
  });

  it('3. load() calls kernel.restoreState() with parsed object', () => {
    const backend = new MemoryStorageProvider();
    const kernel = makeKernel();
    const plugin = new PersistencePlugin({ backend });
    plugin.install(kernel);

    plugin.save();
    const result = plugin.load();

    expect(result.ok).toBe(true);
    expect(kernel.restoreState).toHaveBeenCalledOnce();
    const [arg] = (kernel.restoreState as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(typeof arg).toBe('object');
    expect(arg).toHaveProperty('version');
  });

  it('4. hasSave() returns true after save()', () => {
    const backend = new MemoryStorageProvider();
    const kernel = makeKernel();
    const plugin = new PersistencePlugin({ backend });
    plugin.install(kernel);

    expect(plugin.hasSave()).toBe(false);
    plugin.save();
    expect(plugin.hasSave()).toBe(true);
  });

  it('5. deleteSave() removes the save slot', () => {
    const backend = new MemoryStorageProvider();
    const kernel = makeKernel();
    const plugin = new PersistencePlugin({ backend });
    plugin.install(kernel);

    plugin.save();
    plugin.deleteSave();

    expect(plugin.hasSave()).toBe(false);
    expect(backend.size()).toBe(0);
  });

  it('6. save() returns ok:false with reason serialize_failed when kernel.serialize() throws', () => {
    const backend = new MemoryStorageProvider();
    const kernel = makeKernel({ serialize: vi.fn().mockImplementation(() => { throw new Error('oops'); }) });
    const plugin = new PersistencePlugin({ backend });
    plugin.install(kernel);

    const result = plugin.save();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('serialize_failed');
      expect(typeof result.message).toBe('string');
    }
  });

  it('7. load() returns ok:false with reason not_found when backend has no save', () => {
    const backend = new MemoryStorageProvider();
    const kernel = makeKernel();
    const plugin = new PersistencePlugin({ backend });
    plugin.install(kernel);

    const result = plugin.load();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('not_found');
    }
    expect(kernel.restoreState).not.toHaveBeenCalled();
  });

  it('8. load() returns ok:false with reason parse_failed when stored data is invalid JSON', () => {
    const backend = new MemoryStorageProvider();
    backend.save('alife_save', 'not-json{{{');
    const kernel = makeKernel();
    const plugin = new PersistencePlugin({ backend });
    plugin.install(kernel);

    const result = plugin.load();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('parse_failed');
    }
    expect(kernel.restoreState).not.toHaveBeenCalled();
  });

  it('9. custom saveKey propagates to backend', () => {
    const backend = new MemoryStorageProvider();
    const kernel = makeKernel();
    const plugin = new PersistencePlugin({ backend, saveKey: 'slot_2' });
    plugin.install(kernel);

    plugin.save();
    expect(backend.has('slot_2')).toBe(true);
    expect(backend.has('alife_save')).toBe(false);
  });

  it('10. default saveKey is "alife_save"', () => {
    const backend = new MemoryStorageProvider();
    const kernel = makeKernel();
    const plugin = new PersistencePlugin({ backend });
    plugin.install(kernel);

    plugin.save();
    expect(backend.has('alife_save')).toBe(true);
  });

  it('10b. load() returns parse_failed when saved JSON lacks a version field', () => {
    const backend = new MemoryStorageProvider();
    // Valid JSON but missing the 'version' key that we require
    backend.save('alife_save', JSON.stringify({ clock: {}, tick: 0, plugins: {} }));
    const kernel = makeKernel();
    const plugin = new PersistencePlugin({ backend });
    plugin.install(kernel);

    const result = plugin.load();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('parse_failed');
    }
    expect(kernel.restoreState).not.toHaveBeenCalled();
  });

  it('10c. load() returns restore_failed when kernel.restoreState() throws', () => {
    const backend = new MemoryStorageProvider();
    const kernel = makeKernel({
      restoreState: vi.fn().mockImplementation(() => { throw new Error('corrupted state'); }),
    });
    const plugin = new PersistencePlugin({ backend });
    plugin.install(kernel);
    plugin.save();

    const result = plugin.load();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('restore_failed');
    }
  });

  // P2 fix: throw instead of silent false before install
  it('11. save() throws if called before install()', () => {
    const plugin = new PersistencePlugin({ backend: new MemoryStorageProvider() });
    expect(() => plugin.save()).toThrow('install()');
  });

  it('12. load() throws if called before install()', () => {
    const plugin = new PersistencePlugin({ backend: new MemoryStorageProvider() });
    expect(() => plugin.load()).toThrow('install()');
  });
});

// ---------------------------------------------------------------------------
// MemoryStorageProvider
// ---------------------------------------------------------------------------

describe('MemoryStorageProvider', () => {
  it('13. round-trip: save → load returns same data', () => {
    const provider = new MemoryStorageProvider();
    provider.save('k', '{"x":1}');
    expect(provider.load('k')).toBe('{"x":1}');
  });

  it('14. load() returns null for missing key', () => {
    const provider = new MemoryStorageProvider();
    expect(provider.load('missing')).toBeNull();
  });

  it('15. has() reflects save/remove lifecycle', () => {
    const provider = new MemoryStorageProvider();
    expect(provider.has('k')).toBe(false);
    provider.save('k', 'v');
    expect(provider.has('k')).toBe(true);
    provider.remove('k');
    expect(provider.has('k')).toBe(false);
  });

  it('16. clear() removes all entries', () => {
    const provider = new MemoryStorageProvider();
    provider.save('a', '1');
    provider.save('b', '2');
    provider.clear();
    expect(provider.size()).toBe(0);
    expect(provider.load('a')).toBeNull();
  });

  it('17. size() reflects entry count', () => {
    const provider = new MemoryStorageProvider();
    expect(provider.size()).toBe(0);
    provider.save('a', '1');
    provider.save('b', '2');
    expect(provider.size()).toBe(2);
    provider.remove('a');
    expect(provider.size()).toBe(1);
  });
});
