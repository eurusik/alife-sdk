// __integration__/full-kernel-save-load.test.ts
//
// Integration tests for PersistencePlugin with a real ALifeKernel.
// No vi.fn() mocks — every call goes through the actual serialize() / restoreState()
// pipeline, validating the full JSON round-trip end-to-end.
//
// Required ports (EntityAdapter, PlayerPosition, EntityFactory) are satisfied with
// minimal no-op plain objects — the kernel requires them to be provided before init(),
// but PersistencePlugin does not use them at all.

import { describe, it, expect } from 'vitest';
import { ALifeKernel } from '@alife-sdk/core';
import { PersistencePlugin } from '../plugin/PersistencePlugin';
import { MemoryStorageProvider } from '../providers/MemoryStorageProvider';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a fully initialised + started kernel.
 * Lifecycle order: use plugins → init() → start()
 * EntityAdapter / PlayerPosition / EntityFactory are auto-provided as no-ops.
 */
function makeRealKernel(startHour = 12): ALifeKernel {
  const kernel = new ALifeKernel({ clock: { startHour, timeFactor: 1 } });
  kernel.init();
  kernel.start();
  return kernel;
}

/**
 * Build a kernel + persistence + backend, wired in the correct order:
 *   use(persistence) → init() → start()
 */
function makeSetup(
  saveKey?: string,
  startHour = 12,
): {
  kernel: ALifeKernel;
  persistence: PersistencePlugin;
  backend: MemoryStorageProvider;
} {
  const backend = new MemoryStorageProvider();
  const persistence = new PersistencePlugin({ backend, saveKey });
  const kernel = new ALifeKernel({ clock: { startHour, timeFactor: 1 } });
  // use() must be called before init() — PersistencePlugin.install() stores kernel ref
  kernel.use(persistence);
  kernel.init();
  kernel.start();
  return { kernel, persistence, backend };
}

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe('Integration: PersistencePlugin with real ALifeKernel', () => {
  // -------------------------------------------------------------------------
  // 1. Real serialize() → JSON.stringify → JSON.parse pipeline
  // -------------------------------------------------------------------------

  it('1. serialize() returns a valid state object that survives JSON round-trip', () => {
    const { kernel } = makeSetup();

    const state = kernel.serialize();

    // IALifeKernelState shape
    expect(typeof state).toBe('object');
    expect(state.version).toBe(1);
    expect(typeof state.tick).toBe('number');
    expect(typeof state.clock).toBe('object');
    expect(typeof state.clock.totalGameSeconds).toBe('number');
    expect(typeof state.clock.timeFactor).toBe('number');

    // Must survive JSON round-trip without throwing
    const raw = JSON.stringify(state);
    expect(() => JSON.parse(raw)).not.toThrow();

    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(state.version);
    expect(parsed.clock.totalGameSeconds).toBeCloseTo(state.clock.totalGameSeconds, 5);
  });

  // -------------------------------------------------------------------------
  // 2. restoreState() accepts a JSON-parsed state without throwing
  // -------------------------------------------------------------------------

  it('2. restoreState() accepts a JSON-parsed state without throwing', () => {
    const { kernel } = makeSetup();

    const raw = JSON.stringify(kernel.serialize());
    const parsed = JSON.parse(raw);

    expect(() => kernel.restoreState(parsed)).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // 3. Clock totalGameSeconds is preserved across save → load into second kernel
  // -------------------------------------------------------------------------

  it('3. Clock totalGameSeconds is preserved after save → load into a second kernel', () => {
    const { kernel, persistence, backend } = makeSetup();

    // Advance 5 real seconds (timeFactor=1 → 5 game-seconds)
    kernel.update(5000);

    const elapsedBefore = kernel.clock.totalGameSeconds;
    expect(elapsedBefore).toBeGreaterThan(0);

    expect(persistence.save().ok).toBe(true);

    // Second kernel restores from same shared backend
    const persistence2 = new PersistencePlugin({ backend });
    const kernel2 = new ALifeKernel({ clock: { startHour: 12, timeFactor: 1 } });

    kernel2.use(persistence2);
    kernel2.init();
    kernel2.start();

    expect(persistence2.load().ok).toBe(true);
    expect(kernel2.clock.totalGameSeconds).toBeCloseTo(elapsedBefore, 0);
  });

  // -------------------------------------------------------------------------
  // 4. save/load round-trip preserves kernel version field (=1)
  // -------------------------------------------------------------------------

  it('4. save/load round-trip preserves kernel version field (= 1)', () => {
    const { persistence, backend } = makeSetup();

    expect(persistence.save().ok).toBe(true);

    const raw = backend.load('alife_save');
    expect(raw).not.toBeNull();

    const parsed = JSON.parse(raw!);
    expect(parsed.version).toBe(1);

    // load() into same kernel must succeed
    expect(persistence.load().ok).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 5. hasSave() lifecycle: false → save → true → delete → false
  // -------------------------------------------------------------------------

  it('5. hasSave() returns false on fresh backend, true after save(), false after deleteSave()', () => {
    const { persistence } = makeSetup();

    expect(persistence.hasSave()).toBe(false);

    persistence.save();
    expect(persistence.hasSave()).toBe(true);

    persistence.deleteSave();
    expect(persistence.hasSave()).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 6. Two separate save slots on same backend do not interfere
  // -------------------------------------------------------------------------

  it('6. Two separate save slots on same backend do not interfere with each other', () => {
    const backend = new MemoryStorageProvider();

    const persistence1 = new PersistencePlugin({ backend, saveKey: 'slot_1' });
    const kernel1 = new ALifeKernel({ clock: { startHour: 8, timeFactor: 1 } });

    kernel1.use(persistence1);
    kernel1.init();
    kernel1.start();
    kernel1.update(1000);

    const persistence2 = new PersistencePlugin({ backend, saveKey: 'slot_2' });
    const kernel2 = new ALifeKernel({ clock: { startHour: 20, timeFactor: 1 } });

    kernel2.use(persistence2);
    kernel2.init();
    kernel2.start();
    kernel2.update(9000);

    expect(persistence1.save().ok).toBe(true);
    expect(persistence2.save().ok).toBe(true);

    // Both keys must exist as distinct entries
    expect(backend.size()).toBe(2);
    expect(backend.has('slot_1')).toBe(true);
    expect(backend.has('slot_2')).toBe(true);

    // Each slot has independent clock state (different start hours + update times)
    const state1 = JSON.parse(backend.load('slot_1')!);
    const state2 = JSON.parse(backend.load('slot_2')!);
    expect(state1.clock.totalGameSeconds).not.toBeCloseTo(state2.clock.totalGameSeconds, 0);

    // Deleting slot_1 must not affect slot_2
    persistence1.deleteSave();
    expect(backend.has('slot_1')).toBe(false);
    expect(backend.has('slot_2')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 7. Corrupted JSON → load() returns ok:false, no throw
  // -------------------------------------------------------------------------

  it('7. Corrupted JSON in backend causes load() to return ok:false without throwing', () => {
    const { persistence, backend } = makeSetup();

    backend.save('alife_save', 'not-valid-json{{{corrupt');

    expect(() => persistence.load()).not.toThrow();
    expect(persistence.load().ok).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 8. save → deleteSave → load returns ok:false
  // -------------------------------------------------------------------------

  it('8. After deleteSave(), load() returns ok:false', () => {
    const { persistence } = makeSetup();

    expect(persistence.save().ok).toBe(true);
    persistence.deleteSave();
    expect(persistence.load().ok).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 9. Multiple save/load cycles on same kernel — state restored correctly
  // -------------------------------------------------------------------------

  it('9. Multiple save/load cycles on same kernel restore state correctly each time', () => {
    const { kernel, persistence } = makeSetup();

    // Cycle 1: advance 1 second, save, reload
    kernel.update(1000);
    const elapsed1 = kernel.clock.totalGameSeconds;
    expect(persistence.save().ok).toBe(true);
    expect(persistence.load().ok).toBe(true);
    expect(kernel.clock.totalGameSeconds).toBeCloseTo(elapsed1, 1);

    // Cycle 2: advance 3 more seconds, save, reload
    kernel.update(3000);
    const elapsed2 = kernel.clock.totalGameSeconds;
    expect(persistence.save().ok).toBe(true);
    expect(persistence.load().ok).toBe(true);
    expect(kernel.clock.totalGameSeconds).toBeCloseTo(elapsed2, 1);

    // Elapsed after cycle 2 must be greater than after cycle 1
    expect(elapsed2).toBeGreaterThan(elapsed1);
  });

  // -------------------------------------------------------------------------
  // 10. PersistencePlugin destroyed and replaced — new plugin can still load
  // -------------------------------------------------------------------------

  it('10. A new PersistencePlugin on the same backend can load a save made by a prior plugin', () => {
    const backend = new MemoryStorageProvider();

    // First kernel + plugin: save
    const persistence1 = new PersistencePlugin({ backend });
    const kernel1 = new ALifeKernel({ clock: { startHour: 12, timeFactor: 1 } });

    kernel1.use(persistence1);
    kernel1.init();
    kernel1.start();
    kernel1.update(7000);
    const elapsedOriginal = kernel1.clock.totalGameSeconds;
    expect(persistence1.save().ok).toBe(true);
    kernel1.destroy();

    // Second kernel + plugin: load from same backend
    const persistence2 = new PersistencePlugin({ backend });
    const kernel2 = new ALifeKernel({ clock: { startHour: 12, timeFactor: 1 } });

    kernel2.use(persistence2);
    kernel2.init();
    kernel2.start();

    expect(persistence2.load().ok).toBe(true);
    expect(kernel2.clock.totalGameSeconds).toBeCloseTo(elapsedOriginal, 0);
  });

  // -------------------------------------------------------------------------
  // 11. Custom saveKey: 'slot_autosave' and 'slot_manual' work independently
  // -------------------------------------------------------------------------

  it('11. slot_autosave and slot_manual custom keys work independently', () => {
    const backend = new MemoryStorageProvider();

    const autoSave = new PersistencePlugin({ backend, saveKey: 'slot_autosave' });
    const kernelAuto = new ALifeKernel({ clock: { startHour: 6, timeFactor: 1 } });

    kernelAuto.use(autoSave);
    kernelAuto.init();
    kernelAuto.start();
    kernelAuto.update(2000);

    const manualSave = new PersistencePlugin({ backend, saveKey: 'slot_manual' });
    const kernelManual = new ALifeKernel({ clock: { startHour: 18, timeFactor: 1 } });

    kernelManual.use(manualSave);
    kernelManual.init();
    kernelManual.start();
    kernelManual.update(10000);

    expect(autoSave.save().ok).toBe(true);
    expect(manualSave.save().ok).toBe(true);

    // Both custom keys exist; default key is unused
    expect(backend.has('slot_autosave')).toBe(true);
    expect(backend.has('slot_manual')).toBe(true);
    expect(backend.has('alife_save')).toBe(false);

    // Each can be loaded independently
    expect(autoSave.load().ok).toBe(true);
    expect(manualSave.load().ok).toBe(true);

    // hasSave() is scoped to each plugin's key
    autoSave.deleteSave();
    expect(autoSave.hasSave()).toBe(false);
    expect(manualSave.hasSave()).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 12. kernel.tick is preserved across save/load
  // -------------------------------------------------------------------------

  it('12. kernel tick counter is preserved across save/load', () => {
    const { kernel, persistence } = makeSetup();

    kernel.update(16);
    kernel.update(16);
    kernel.update(16);

    const tickBefore = kernel.tick;
    expect(tickBefore).toBe(3);

    expect(persistence.save().ok).toBe(true);
    expect(persistence.load().ok).toBe(true);

    expect(kernel.tick).toBe(tickBefore);
  });

  // -------------------------------------------------------------------------
  // 13. Serialized state always contains a plugins key
  // -------------------------------------------------------------------------

  it('13. Serialized state always contains a plugins key (even without serialize-capable plugins)', () => {
    const { kernel } = makeSetup();

    const state = kernel.serialize();

    expect(state).toHaveProperty('plugins');
    expect(typeof state.plugins).toBe('object');
  });

  // -------------------------------------------------------------------------
  // 14. save() and load() both return ok:true for a clean round-trip
  // -------------------------------------------------------------------------

  it('14. save() and load() both return ok:true for a clean round-trip', () => {
    const { persistence } = makeSetup();

    expect(persistence.save().ok).toBe(true);
    expect(persistence.load().ok).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 15. Freshly initialised kernel serializes tick=0 and correct start hour
  // -------------------------------------------------------------------------

  it('15. A freshly initialised kernel serializes tick=0 and a totalGameSeconds matching startHour=12', () => {
    const { kernel } = makeSetup(undefined, 12);

    const state = kernel.serialize();

    expect(state.tick).toBe(0);
    // startHour=12, timeFactor=1 → totalGameSeconds = 12 * 3600 = 43200
    expect(state.clock.totalGameSeconds).toBeCloseTo(12 * 3600, 0);
    expect(state.clock.timeFactor).toBe(1);
  });
});
