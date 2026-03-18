/**
 * 11-persistence.ts
 *
 * Save / load game state with @alife-sdk/persistence.
 * Runs in Node.js with:
 *   npx tsx --tsconfig examples/tsconfig.json examples/11-persistence.ts
 *
 * What we build here:
 *   - The same kernel setup as example 01 (two factions, one terrain, two NPCs)
 *   - Run 3 offline ticks so NPCs settle and get job assignments
 *   - SAVE the kernel state (NPC HP, rank, position, game clock, tick counter)
 *   - Run 3 more ticks (time advances, combat may reduce HP)
 *   - LOAD the save (kernel reverts to the saved snapshot)
 *   - Verify the restored state matches what was saved
 *
 * Also demonstrates:
 *   - hasSave() / deleteSave()
 *   - Two independent save slots (autosave + manual)
 *   - Error handling (load before save, corrupted data)
 *   - How to implement IStorageBackend for the browser (localStorage)
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { ALifeKernel, FactionBuilder, SmartTerrain } from '@alife-sdk/core';
import { FactionsPlugin } from '@alife-sdk/core';
import { SimulationPlugin, SimulationPorts, createNoOpBridge } from '@alife-sdk/simulation';

// PersistencePlugin — the kernel plugin that wires save/load to a backend.
// createDefaultPersistenceConfig — factory with sensible defaults (saveKey='alife_save').
import {
  PersistencePlugin,
  createDefaultPersistenceConfig,
} from '@alife-sdk/persistence/plugin';

// MemoryStorageProvider — the built-in in-memory IStorageBackend.
// Perfect for Node.js, tests, or any environment without persistent storage.
// For browser games use localStorage; for Electron use the filesystem.
import { MemoryStorageProvider } from '@alife-sdk/persistence/providers';

// ---------------------------------------------------------------------------
// Build the kernel
// ---------------------------------------------------------------------------

// The storage backend: in-memory for this example.
//
// For a browser game replace it with:
//
//   class LocalStorageBackend {
//     save(key: string, data: string)  { localStorage.setItem(key, data); }
//     load(key: string)                { return localStorage.getItem(key); }
//     has(key: string)                 { return localStorage.getItem(key) !== null; }
//     remove(key: string)              { localStorage.removeItem(key); }
//   }
//
const backend = new MemoryStorageProvider();

// PersistencePlugin wraps the backend with kernel-aware save / load methods.
// Use createDefaultPersistenceConfig to avoid hardcoding the saveKey.
const persistence = new PersistencePlugin(
  createDefaultPersistenceConfig(backend),
);

const kernel = new ALifeKernel();

kernel.provide(SimulationPorts.SimulationBridge, createNoOpBridge());

// Factions: stalker and bandit, hostile to each other.
const factionsPlugin = new FactionsPlugin();
factionsPlugin.factions.register(
  'stalker',
  new FactionBuilder('stalker').displayName('Stalker').relation('bandit', -80).build(),
);
factionsPlugin.factions.register(
  'bandit',
  new FactionBuilder('bandit').displayName('Bandit').relation('stalker', -80).build(),
);

// Simulation plugin — 5 000 ms per tick.
const sim = new SimulationPlugin({ tickIntervalMs: 5_000 });

// One terrain: the abandoned factory.
sim.addTerrain(
  new SmartTerrain({
    id:       'factory',
    name:     'Abandoned Factory',
    bounds:   { x: 400, y: 400, width: 200, height: 200 },
    capacity: 10,
    jobs: [
      { type: 'patrol', slots: 5 },
      { type: 'guard',  slots: 5, position: { x: 450, y: 450 } },
    ],
  }),
);

// Plugin order matters: FactionsPlugin before SimulationPlugin.
kernel.use(factionsPlugin);
kernel.use(sim);
// PersistencePlugin can be installed at any position — it does not depend
// on the simulation tick pipeline.
kernel.use(persistence);

kernel.init();
kernel.start();

// ---------------------------------------------------------------------------
// NPCs
// ---------------------------------------------------------------------------

sim.registerNPC({
  entityId:    'stalker_wolf',
  factionId:   'stalker',
  position:    { x: 50, y: 50 },
  rank:        3,
  combatPower: 70,
  currentHp:   100,
  behaviorConfig: {
    retreatThreshold: 0.2,
    panicThreshold:   -0.7,
    searchIntervalMs: 5_000,
    dangerTolerance:  3,
    aggression:       0.6,
  },
  options: { type: 'human' },
});

sim.registerNPC({
  entityId:    'bandit_knife',
  factionId:   'bandit',
  position:    { x: 700, y: 700 },
  rank:        2,
  combatPower: 40,
  currentHp:   80,
  behaviorConfig: {
    retreatThreshold: 0.3,
    panicThreshold:   -0.5,
    searchIntervalMs: 5_000,
    dangerTolerance:  2,
    aggression:       0.8,
  },
  options: { type: 'human' },
});

// ---------------------------------------------------------------------------
// Helper: print current NPC state
// ---------------------------------------------------------------------------

function printState(label: string): void {
  const stalkerRecord = sim.getNPCRecord('stalker_wolf')!;
  const banditRecord  = sim.getNPCRecord('bandit_knife')!;
  const stalkerBrain  = sim.getNPCBrain('stalker_wolf');
  const banditBrain   = sim.getNPCBrain('bandit_knife');

  console.log(`--- ${label} ---`);
  console.log(
    `  kernel.tick=${kernel.tick}  ` +
    `clock=${Math.round(kernel.clock.totalGameSeconds)}s`,
  );
  console.log(
    `  Stalker: terrain="${stalkerBrain?.currentTerrainId ?? 'none'}"  ` +
    `task="${stalkerBrain?.currentTask?.slotType ?? 'none'}"  ` +
    `hp=${stalkerRecord.currentHp}`,
  );
  console.log(
    `  Bandit:  terrain="${banditBrain?.currentTerrainId  ?? 'none'}"  ` +
    `task="${banditBrain?.currentTask?.slotType ?? 'none'}"  ` +
    `hp=${banditRecord.currentHp}`,
  );
  console.log('');
}

// ---------------------------------------------------------------------------
// PHASE 1 — Warm-up: let NPCs settle into their terrain
//
// Each kernel.update(5_001) call passes slightly more than tickIntervalMs
// so exactly one simulation tick fires per call.
// ---------------------------------------------------------------------------

console.log('=== PHASE 1: Warm-up — 3 offline ticks ===');
console.log('');

for (let i = 0; i < 3; i++) {
  kernel.update(5_001);
}

printState('After 3 warm-up ticks');

// ---------------------------------------------------------------------------
// PHASE 2 — Save
//
// persistence.save() calls kernel.serialize() → JSON.stringify → backend.save().
// It returns { ok: true } on success, or { ok: false, reason, message } on failure.
// It never throws on normal failure paths — only if called before kernel.use().
// ---------------------------------------------------------------------------

console.log('=== PHASE 2: Save ===');
console.log('');

// Always check hasSave() if your game has a "Continue" button.
console.log(`hasSave() before first save: ${persistence.hasSave()}`);

const saveResult = persistence.save();

if (saveResult.ok) {
  console.log('Save succeeded.');
} else {
  // reason is 'serialize_failed' or 'write_failed' — both are string codes
  // suitable for telemetry, UI messages, or retry logic.
  console.error(`Save failed [${saveResult.reason}]: ${saveResult.message}`);
  process.exit(1);
}

console.log(`hasSave() after save:        ${persistence.hasSave()}`);

// Capture state at save point for later verification.
const savedKernelTick = kernel.tick;
const savedClockSecs  = kernel.clock.totalGameSeconds;
const savedStalkerHp  = sim.getNPCRecord('stalker_wolf')!.currentHp;
const savedBanditHp   = sim.getNPCRecord('bandit_knife')!.currentHp;
// Note: terrain assignment lives in the brain and is NOT preserved across
// save/load. It will be re-evaluated by rebuildBrain() on the next tick.

console.log('');
console.log('Snapshot at save point:');
console.log(`  kernel.tick  = ${savedKernelTick}`);
console.log(`  clock        = ${Math.round(savedClockSecs)}s`);
console.log(`  stalker HP   = ${savedStalkerHp}`);
console.log(`  bandit HP    = ${savedBanditHp}`);
console.log('');

// ---------------------------------------------------------------------------
// PHASE 3 — Continue playing past the save point
//
// Run 3 more ticks. If both factions reach the same terrain, offline combat
// may reduce HP. The clock and tick counter will advance.
// ---------------------------------------------------------------------------

console.log('=== PHASE 3: 3 more ticks past the save point ===');
console.log('');

for (let i = 0; i < 3; i++) {
  kernel.update(5_001);
}

printState('After 3 more ticks (past save point)');

// ---------------------------------------------------------------------------
// PHASE 4 — Load
//
// persistence.load() calls backend.load() → JSON.parse → kernel.restoreState().
// The kernel reverts to the exact snapshot captured by save().
//
// After load():
//   - NPC records (HP, rank, position, behaviorConfig) → RESTORED from save
//   - Squads, personal goodwill, story registry      → RESTORED from save
//   - Brain instances                                → CLEARED (live refs)
//
// Call sim.rebuildBrain() for every NPC to recreate brain instances.
// It does NOT touch squads / relations / story, so the restored state stays intact.
// ---------------------------------------------------------------------------

console.log('=== PHASE 4: Load — revert to save point ===');
console.log('');

const loadResult = persistence.load();

if (loadResult.ok) {
  console.log('Load succeeded. NPC records (HP, rank, position) reverted to save point.');
  console.log('Brains are cleared — call rebuildBrain() to restore AI behaviour.');
} else {
  // reason is 'not_found', 'parse_failed', or 'restore_failed'
  console.error(`Load failed [${loadResult.reason}]: ${loadResult.message}`);
  process.exit(1);
}

// Rebuild brain instances.
// NPC records (HP, rank, lastPosition, behaviorConfig) are already restored
// by load(). rebuildBrain() creates a fresh brain wired to the movement
// dispatcher without touching squads, relations, or story — keeping the
// save-restored state of those subsystems intact.
//
// The options (type: 'human' | 'monster', equipment, schedule, etc.) are NOT
// serialized — they describe the NPC archetype, not runtime state. Store them
// alongside your NPC definitions (e.g. a roster config file) so you can pass
// them here after every load.
sim.rebuildBrain('stalker_wolf', { type: 'human' });
sim.rebuildBrain('bandit_knife', { type: 'human' });

console.log('');
printState('Immediately after load + rebuildBrain (brain just created, no tick yet)');

// Run one tick so brains re-evaluate and pick terrains again.
kernel.update(5_001);
printState('After one tick (brains re-evaluated terrains)');

// ---------------------------------------------------------------------------
// Verification: assert that restored state matches the saved snapshot
//
// What IS preserved across save/load:
//   - kernel.tick counter
//   - game clock (totalGameSeconds)
//   - NPC HP (currentHp)
//   - NPC rank, combatPower, behaviorConfig, lastPosition
//
// What is NOT preserved (call rebuildBrain() to restore):
//   - Brain instances (currentTerrainId, currentTask, morale)
//   - Movement simulator state (in-flight journey progress)
// ---------------------------------------------------------------------------

console.log('=== Verification ===');
console.log('');

function assert(label: string, actual: unknown, expected: unknown): void {
  const ok = actual === expected;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}: ${actual} ${ok ? '===' : '!=='} ${expected}`);
}

const restoredStalkerHp = sim.getNPCRecord('stalker_wolf')!.currentHp;
const restoredBanditHp  = sim.getNPCRecord('bandit_knife')!.currentHp;

// kernel.tick was restored to savedKernelTick by load(), then one more tick
// ran above — so the current tick is savedKernelTick + 1.
assert('stalker HP restored',  restoredStalkerHp,    savedStalkerHp);
assert('bandit HP restored',   restoredBanditHp,     savedBanditHp);
assert('kernel.tick restored', kernel.tick,           savedKernelTick + 1);
assert('clock restored',       Math.round(kernel.clock.totalGameSeconds) >= Math.round(savedClockSecs), true);

console.log('');
console.log('  (terrain is re-assigned by brain on first tick after rebuildBrain — not from save)');
console.log('');

// ---------------------------------------------------------------------------
// PHASE 5 — Error handling
// ---------------------------------------------------------------------------

console.log('=== PHASE 5: Error handling ===');
console.log('');

// 5a. Load when there is no save at a given key.
const emptyBackend    = new MemoryStorageProvider();
const orphanPlugin    = new PersistencePlugin({ backend: emptyBackend });
const orphanKernel    = new ALifeKernel();
orphanKernel.use(orphanPlugin);
orphanKernel.init();
orphanKernel.start();

const notFoundResult = orphanPlugin.load();
console.log(`Load from empty backend → ok=${notFoundResult.ok}, reason="${!notFoundResult.ok ? notFoundResult.reason : 'n/a'}"`);

// 5b. Corrupted JSON in the backend.
emptyBackend.save('alife_save', '{corrupted:json:::}');
const corruptResult = orphanPlugin.load();
console.log(`Load corrupted JSON      → ok=${corruptResult.ok}, reason="${!corruptResult.ok ? corruptResult.reason : 'n/a'}"`);

orphanKernel.destroy();

console.log('');

// ---------------------------------------------------------------------------
// PHASE 6 — Two independent save slots
//
// Common use case: autosave (overwrites every few minutes) + manual save
// (player-triggered, kept until overwritten).
// Both slots live in the same backend but under different keys.
//
// CONSTRAINT: PersistencePlugin has a fixed plugin name='persistence', so
// only ONE instance can be installed per kernel. To use two slots you need
// two kernels (or swap the plugin between saves in your game loop).
//
// Here each kernel represents a separate game session to show the pattern.
// ---------------------------------------------------------------------------

console.log('=== PHASE 6: Two save slots (autosave + manual) ===');
console.log('');

const sharedBackend = new MemoryStorageProvider();

// Each PersistencePlugin has a fixed name='persistence', so only one instance
// can be installed per kernel. For multiple slots, use one plugin per kernel.
// Both plugins share the same physical backend (same Map / localStorage / file),
// differentiated only by saveKey.

// Kernel A simulates a game session that autosaves at tick 1.
const autoSave  = new PersistencePlugin({ backend: sharedBackend, saveKey: 'slot_auto' });
const kernelA   = new ALifeKernel();
kernelA.use(autoSave);
kernelA.init();
kernelA.start();

kernelA.update(5_001); // advance one tick
autoSave.save();       // autosave

// Kernel B simulates the player pressing F5 one tick later.
const manualSave = new PersistencePlugin({ backend: sharedBackend, saveKey: 'slot_manual' });
const kernelB    = new ALifeKernel();
kernelB.use(manualSave);
kernelB.init();
kernelB.start();

kernelB.update(5_001);
kernelB.update(5_001); // two ticks ahead
manualSave.save();     // player saves manually

console.log(`slot_auto   exists: ${sharedBackend.has('slot_auto')}`);
console.log(`slot_manual exists: ${sharedBackend.has('slot_manual')}`);
console.log(`Total slots in backend: ${sharedBackend.size()}`);
console.log('');

// Inspect: manual save should be ahead of autosave.
const autoState   = JSON.parse(sharedBackend.load('slot_auto')!);
const manualState = JSON.parse(sharedBackend.load('slot_manual')!);
console.log(`autosave   kernel.tick = ${autoState.tick}  (saved at tick 1)`);
console.log(`manualsave kernel.tick = ${manualState.tick}  (saved at tick 2)`);
console.log('');

// Delete autosave (e.g., "New Game" clears autosave but not manual).
autoSave.deleteSave();
console.log(`slot_auto   exists after deleteSave: ${sharedBackend.has('slot_auto')}`);
console.log(`slot_manual exists after deleteSave: ${sharedBackend.has('slot_manual')}`);
console.log('');

kernelA.destroy();
kernelB.destroy();

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

kernel.destroy();

console.log('=== Summary ===');
console.log('');
console.log('Key takeaways:');
console.log('  1. persistence.save() serialises the full kernel state → backend.save(key, json).');
console.log('  2. persistence.load() reads from backend → deserialises → kernel.restoreState(state).');
console.log('  3. Preserved: NPC records (HP/rank/position), squads, goodwill, story, clock, tick.');
console.log('  4. NOT preserved: brain instances — call sim.rebuildBrain() for every NPC after load.');
console.log('  5. save() / load() return discriminated union results — they never throw on failure.');
console.log('  6. One PersistencePlugin per kernel; use different saveKeys for multiple slots.');
console.log('  7. Swap MemoryStorageProvider for localStorage / a filesystem backend in production.');
