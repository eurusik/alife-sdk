/**
 * 01-hello-npc.ts
 *
 * Minimal, engine-agnostic ALife SDK example.
 * Runs in Node.js with:
 *   npx tsx --tsconfig examples/tsconfig.json examples/01-hello-npc.ts
 *
 * What we build here:
 *   - A kernel with two hostile factions
 *   - One SmartTerrain with patrol + guard jobs
 *   - Two NPCs (one stalker, one bandit)
 *   - A simulation loop for 5 ticks (5 × 5 000 ms = 25 s of game time)
 *
 * The kernel requires three port adapters at init time. We implement
 * the minimum no-op versions so the simulation logic runs without a
 * real game engine.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

// The kernel is the central orchestrator — all plugins and ports attach here.
import { ALifeKernel, Ports, FactionBuilder, ALifeEvents } from '@alife-sdk/core';
import type {
  IEntityAdapter,
  IEntityFactory,
  IPlayerPositionProvider,
  Vec2,
} from '@alife-sdk/core';

// FactionsPlugin owns all faction definitions and relations.
import { FactionsPlugin } from '@alife-sdk/core';

// SmartTerrain is a named zone with jobs and NPC capacity.
import { SmartTerrain } from '@alife-sdk/core';

// SimulationPlugin runs the tick pipeline (brains, movement, combat).
// SimulationPorts gives us the token to register the engine bridge.
// createNoOpBridge() creates a safe stub bridge — no HP mutations, always alive.
import { SimulationPlugin, SimulationPorts, createNoOpBridge } from '@alife-sdk/simulation';

// ---------------------------------------------------------------------------
// Step 1: Minimal port stubs
//
// The kernel validates three required ports at init():
//   - EntityAdapter  — read/write entity position, components, visibility
//   - EntityFactory  — create and destroy game entities
//   - PlayerPosition — provides player world position for online/offline checks
//
// In a real game these are non-trivial adapters that delegate to Phaser,
// Pixi, etc. For a Node.js example we return safe empty values so all
// simulation logic runs correctly without touching the DOM.
// ---------------------------------------------------------------------------

// EntityAdapter: the kernel never mutates real entities in this example,
// so returning null positions and ignoring all writes is correct.
const stubEntityAdapter: IEntityAdapter = {
  // -- IEntityQuery (read-only) ---
  getPosition: (_id: string): Vec2 | null => null,
  isAlive: (_id: string): boolean => true,
  hasComponent: (_id: string, _name: string): boolean => false,
  getComponentValue: <T>(_id: string, _name: string): T | null => null,

  // -- IEntityMutation (writes) ---
  setPosition: (_id: string, _pos: Vec2): void => {},
  setActive: (_id: string, _active: boolean): void => {},
  setVisible: (_id: string, _visible: boolean): void => {},
  setVelocity: (_id: string, _vel: Vec2): void => {},
  getVelocity: (_id: string): Vec2 => ({ x: 0, y: 0 }),
  setRotation: (_id: string, _rad: number): void => {},
  teleport: (_id: string, _pos: Vec2): void => {},
  disablePhysics: (_id: string): void => {},

  // -- IEntityRendering (visual) ---
  setAlpha: (_id: string, _alpha: number): void => {},
  playAnimation: (_id: string, _key: string): void => {},
  hasAnimation: (_id: string, _key: string): boolean => false,
};

// EntityFactory: we don't actually spawn game objects here, so IDs are
// sequential strings and destroy is a no-op.
let _entityCounter = 0;
const stubEntityFactory: IEntityFactory = {
  createNPC: (_req): string => `npc_spawned_${++_entityCounter}`,
  createMonster: (_req): string => `monster_spawned_${++_entityCounter}`,
  destroyEntity: (_id: string): void => {},
};

// PlayerPosition: the player stands at the origin. All NPCs are therefore
// "far away" and remain in offline mode for this example — the simulation
// tick pipeline drives them.
const stubPlayerPosition: IPlayerPositionProvider = {
  getPlayerPosition: (): Vec2 => ({ x: 0, y: 0 }),
};

// ---------------------------------------------------------------------------
// Step 2: Build the kernel
//
// ALifeKernel is the central hub. It owns the event bus, clock, port
// registry, and plugin list. It never imports Phaser or any engine API.
// ---------------------------------------------------------------------------

const kernel = new ALifeKernel();

// Register the three required ports before init().
kernel.provide(Ports.EntityAdapter,  stubEntityAdapter);
kernel.provide(Ports.EntityFactory,  stubEntityFactory);
kernel.provide(Ports.PlayerPosition, stubPlayerPosition);

// Register the simulation bridge. createNoOpBridge() is the SDK's own
// helper — it returns true for isAlive, 0 effective damage, no morale
// mutations. Perfect for rapid prototyping before the engine adapter is ready.
kernel.provide(SimulationPorts.SimulationBridge, createNoOpBridge());

// ---------------------------------------------------------------------------
// Step 3: Define factions
//
// FactionBuilder is the fluent builder for IFactionDefinition.
// A relation score of -80 means "hostile" — any value ≤ 0 is treated
// as hostile by the Faction class's isHostile() method.
// ---------------------------------------------------------------------------

const factionsPlugin = new FactionsPlugin();

// Stalker faction: hostile to bandits.
factionsPlugin.factions.register(
  'stalker',
  new FactionBuilder('stalker')
    .displayName('Stalker')
    .relation('bandit', -80) // -80 = strong hostility
    .build(),
);

// Bandit faction: hostile to stalkers.
factionsPlugin.factions.register(
  'bandit',
  new FactionBuilder('bandit')
    .displayName('Bandit')
    .relation('stalker', -80)
    .build(),
);

// ---------------------------------------------------------------------------
// Step 4: Set up the simulation plugin
//
// SimulationPlugin orchestrates the 7-step offline tick pipeline:
//   1. Terrain state decay
//   2. Brain round-robin updates
//   3. Movement simulation
//   4. Factional conflict detection
//   5. Offline combat
//   6. Morale restore + faction goodwill decay
//   7. TICK event
//
// tickIntervalMs is how often the pipeline runs. We use 5 000 ms (5 s
// of real time per simulation tick) — the production default.
// ---------------------------------------------------------------------------

const sim = new SimulationPlugin({
  tickIntervalMs: 5_000,   // run the tick pipeline every 5 000 ms
});

// ---------------------------------------------------------------------------
// Step 5: Create a SmartTerrain
//
// SmartTerrain is a named zone with a capacity limit and a list of jobs.
// NPCs choose terrains by scoring fitness (distance, danger level, jobs).
//
// Jobs define what NPCs do when they arrive. A 'patrol' job gives the NPC
// a waypoint route. A 'guard' job pins the NPC to a fixed position.
// ---------------------------------------------------------------------------

const abandonedFactory = new SmartTerrain({
  id:       'abandoned_factory',
  name:     'Abandoned Factory',
  bounds:   { x: 400, y: 400, width: 200, height: 200 }, // world coordinates
  capacity: 6,           // at most 6 NPCs can occupy this terrain at once
  jobs: [
    { type: 'patrol', slots: 3 }, // 3 slots for roaming patrol behavior
    { type: 'guard',  slots: 3, position: { x: 450, y: 450 } }, // 3 guard posts
  ],
});

// Add the terrain to the simulation plugin BEFORE init(), so it's available
// when brains first evaluate which terrain to go to.
sim.addTerrain(abandonedFactory);

// Install both plugins. Order matters: FactionsPlugin must come before
// SimulationPlugin because Simulation declares 'factions' as a dependency.
kernel.use(factionsPlugin);
kernel.use(sim);

// ---------------------------------------------------------------------------
// Step 6: Initialize and start the kernel
//
// init() validates ports, freezes registries, and calls plugin.init().
// start() enables frame-based update() calls.
// ---------------------------------------------------------------------------

kernel.init();   // throws ALifeValidationError if any required port is missing
kernel.start();  // enables update()

// ---------------------------------------------------------------------------
// Step 7: Register event listeners
//
// The EventBus is deferred — emit() queues events, flush() delivers them.
// kernel.update() calls flush() at the end of each frame automatically,
// so listeners fire once per update call, never mid-tick.
// ---------------------------------------------------------------------------

// TICK fires once per simulation tick (every tickIntervalMs of simulated time).
kernel.events.on(ALifeEvents.TICK, ({ tick, delta }) => {
  console.log(`[TICK ${tick}] delta=${delta}ms`);
});

// TASK_ASSIGNED fires when a brain picks a terrain and gets a job slot.
kernel.events.on(ALifeEvents.TASK_ASSIGNED, ({ npcId, terrainId, taskType }) => {
  console.log(`  -> NPC "${npcId}" assigned task "${taskType}" at terrain "${terrainId}"`);
});

// NPC_MOVED fires when a brain's movement journey completes — the NPC
// has physically arrived at its target terrain.
// Note: fromZone and toZone can be the same — the brain re-evaluated and
// confirmed the current terrain is still the best choice (not a bug).
kernel.events.on(ALifeEvents.NPC_MOVED, ({ npcId, fromZone, toZone }) => {
  console.log(`  -> NPC "${npcId}" moved from "${fromZone}" to "${toZone}"`);
});

// FACTION_CONFLICT fires when two hostile factions share a terrain in the
// same tick. This is an informational event — combat is resolved separately
// by OfflineCombatResolver in the same tick.
kernel.events.on(ALifeEvents.FACTION_CONFLICT, ({ factionA, factionB, zoneId }) => {
  console.log(`  -> Conflict between "${factionA}" and "${factionB}" at "${zoneId}"`);
});

// ---------------------------------------------------------------------------
// Step 8: Register NPCs
//
// registerNPC() creates the NPC record and a brain, wires them to the
// movement simulator and squad manager, and runs an initial brain update
// so the NPC immediately selects a terrain.
//
// registerNPC() must be called AFTER init() — the brain needs the kernel's
// clock and event bus which are only available after init().
//
// behaviorConfig is the per-NPC tuning knobs. panicThreshold is the morale
// level at which the NPC panics and flees; retreatThreshold is the HP
// fraction at which the NPC tries to retreat.
// ---------------------------------------------------------------------------

const stalkerReg = sim.registerNPC({
  entityId:    'stalker_wolf',
  factionId:   'stalker',
  position:    { x: 50, y: 50 },   // starts far from the factory (≈636 px away)
  rank:        3,                   // rank 1–5; higher rank = more combat power
  combatPower: 70,
  currentHp:   100,
  behaviorConfig: {
    retreatThreshold: 0.2,   // retreat when HP drops below 20%
    panicThreshold:   -0.7,  // panic when morale drops below -0.7
    searchIntervalMs: 5_000, // how often brain scans for new terrain
    dangerTolerance:  3,     // maximum danger level this NPC accepts
    aggression:       0.6,   // 0 = passive, 1 = aggressive; affects job preference
  },
  options: { type: 'human' }, // human vs monster — affects brain subclass used
});

const banditReg = sim.registerNPC({
  entityId:    'bandit_knife',
  factionId:   'bandit',
  position:    { x: 700, y: 700 }, // starts on the opposite side of the factory
  rank:        2,
  combatPower: 40,
  currentHp:   80,
  behaviorConfig: {
    retreatThreshold: 0.3,
    panicThreshold:   -0.5,
    searchIntervalMs: 5_000,
    dangerTolerance:  2,
    aggression:       0.8,   // bandits are more aggressive — prefer patrol/attack jobs
  },
  options: { type: 'human' },
});

console.log(`Registered: "${stalkerReg.record.entityId}" (${stalkerReg.record.factionId})`);
console.log(`Registered: "${banditReg.record.entityId}" (${banditReg.record.factionId})`);
console.log('');

// ---------------------------------------------------------------------------
// Step 9: Simulation loop
//
// In a real game engine this is called every frame from the render loop.
// Here we drive it manually, passing a large deltaMs to advance many ticks
// quickly. Each call to kernel.update(deltaMs) does:
//   1. Advance the game clock by deltaMs
//   2. Call plugin.update(deltaMs) for each installed plugin
//   3. Flush the event bus (delivers all queued events to listeners)
//
// SimulationPlugin.update() accumulates deltaMs and fires the tick pipeline
// when the accumulator reaches tickIntervalMs (5 000 ms).
// ---------------------------------------------------------------------------

console.log('--- Starting simulation loop (5 ticks) ---');
console.log('');

// We want 5 full ticks. Each tick requires tickIntervalMs = 5 000 ms.
// Passing 5 001 ms per update ensures one tick fires per update call.
const TICKS_TO_RUN   = 5;
const DELTA_PER_STEP = 5_001; // slightly over 5 000 ms to guarantee one tick per call

for (let step = 0; step < TICKS_TO_RUN; step++) {
  kernel.update(DELTA_PER_STEP);

  // Print the NPC state after each update so we can observe changes.
  const stalkerRecord = sim.getNPCRecord('stalker_wolf');
  const banditRecord  = sim.getNPCRecord('bandit_knife');

  const stalkerBrain = sim.getNPCBrain('stalker_wolf');
  const banditBrain  = sim.getNPCBrain('bandit_knife');

  console.log(`  Stalker: terrain="${stalkerBrain?.currentTerrainId ?? 'none'}" ` +
              `task="${stalkerBrain?.currentTask?.slotType ?? 'none'}" ` +
              `hp=${stalkerRecord?.currentHp}`);

  console.log(`  Bandit:  terrain="${banditBrain?.currentTerrainId ?? 'none'}" ` +
              `task="${banditBrain?.currentTask?.slotType ?? 'none'}" ` +
              `hp=${banditRecord?.currentHp}`);

  console.log('');
}

// ---------------------------------------------------------------------------
// Step 10: Inspect final state and clean up
// ---------------------------------------------------------------------------

console.log('--- Final state ---');
console.log(`Total terrains: ${sim.getAllTerrains().size}`);
console.log(`Total NPCs: ${sim.getAllNPCRecords().size}`);

const stalkerFinalBrain = sim.getNPCBrain('stalker_wolf');
const banditFinalBrain  = sim.getNPCBrain('bandit_knife');

console.log(`Stalker terrain: ${stalkerFinalBrain?.currentTerrainId ?? '(unassigned)'}`);
console.log(`Bandit  terrain: ${banditFinalBrain?.currentTerrainId  ?? '(unassigned)'}`);

// destroy() calls plugin.destroy() in reverse order and clears the event bus.
kernel.destroy();
console.log('');
console.log('Kernel destroyed. Done.');
