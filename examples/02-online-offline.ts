/**
 * 02-online-offline.ts
 *
 * The online/offline duality — the core design concept of the ALife SDK.
 * Runs in Node.js with:
 *   npx tsx --tsconfig examples/tsconfig.json examples/02-online-offline.ts
 *
 * The key idea:
 *   OFFLINE — NPC is driven by the SDK's tick pipeline. Cheap, always running,
 *             even for NPCs the player can't see. The brain selects terrains,
 *             simulates movement, and participates in offline combat.
 *
 *   ONLINE  — Host engine takes over. The NPC gets real physics, frame-by-frame
 *             AI, and proper rendering. The SDK tick pipeline skips it entirely.
 *
 * The host controls the switch: call sim.setNPCOnline(id, true) when the player
 * approaches, and sim.setNPCOnline(id, false) when the player moves away.
 *
 * This example:
 *   1. Sets up the same kernel as example 01
 *   2. Runs a few offline ticks so the NPC gets a terrain assignment
 *   3. Simulates the player walking close to the stalker
 *   4. Switches the stalker online — tick pipeline skips it
 *   5. Simulates the player moving away — stalker goes offline again
 *   6. Verifies that offline ticks resume for the stalker
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import {
  ALifeKernel, Ports, FactionBuilder, SmartTerrain, ALifeEvents,
  createNoOpEntityAdapter, createNoOpEntityFactory,
} from '@alife-sdk/core';
import type { Vec2 } from '@alife-sdk/core';
import { FactionsPlugin } from '@alife-sdk/core';
import { SimulationPlugin, SimulationPorts, createNoOpBridge } from '@alife-sdk/simulation';

// ---------------------------------------------------------------------------
// Kernel setup
// ---------------------------------------------------------------------------

// We make the player position mutable this time so we can move the player
// during the simulation and trigger the online/offline transition manually.
let playerPosition: Vec2 = { x: 9999, y: 9999 }; // start far away

const kernel = new ALifeKernel();

kernel.provide(Ports.EntityAdapter,  createNoOpEntityAdapter());
kernel.provide(Ports.EntityFactory,  createNoOpEntityFactory());
// Custom PlayerPosition so we can "move" the player between steps and
// trigger the online/offline transition without rebuilding the kernel.
kernel.provide(Ports.PlayerPosition, { getPlayerPosition: () => playerPosition });
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

// Simulation plugin with a short tick interval so the example produces
// visible output quickly.
const sim = new SimulationPlugin({ tickIntervalMs: 5_000 });

// One terrain: the old factory, located at roughly (400, 400).
const factory = new SmartTerrain({
  id:       'factory',
  name:     'Old Factory',
  bounds:   { x: 350, y: 350, width: 200, height: 200 },
  capacity: 10,
  jobs: [
    { type: 'patrol', slots: 5 },
    { type: 'guard',  slots: 5, position: { x: 400, y: 400 } },
  ],
});

sim.addTerrain(factory);
kernel.use(factionsPlugin);
kernel.use(sim);

kernel.init();
kernel.start();

// ---------------------------------------------------------------------------
// NPCs
//
// The stalker starts close to the factory (50 px east of center).
// The bandit starts on the opposite side (far away).
// ---------------------------------------------------------------------------

sim.registerNPC({
  entityId:    'stalker_wolf',
  factionId:   'stalker',
  position:    { x: 500, y: 400 }, // 50 px east of the factory boundary
  rank:        3,
  combatPower: 70,
  currentHp:   100,
  behaviorConfig: {
    retreatThreshold: 0.2,
    panicThreshold:   -0.7,
    searchIntervalMs: 5_000,
    dangerTolerance:  3,
    aggression:       0.5,
  },
  options: { type: 'human' },
});

sim.registerNPC({
  entityId:    'bandit_knife',
  factionId:   'bandit',
  position:    { x: 900, y: 900 },
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
// Helper: print current state of both NPCs
// ---------------------------------------------------------------------------

function printState(label: string): void {
  const stalkerRecord = sim.getNPCRecord('stalker_wolf')!;
  const banditRecord  = sim.getNPCRecord('bandit_knife')!;
  const stalkerBrain  = sim.getNPCBrain('stalker_wolf');
  const banditBrain   = sim.getNPCBrain('bandit_knife');

  console.log(`--- ${label} ---`);
  console.log(
    `  Stalker: isOnline=${stalkerRecord.isOnline}  ` +
    `terrain="${stalkerBrain?.currentTerrainId ?? 'none'}"  ` +
    `task="${stalkerBrain?.currentTask?.slotType ?? 'none'}"`,
  );
  console.log(
    `  Bandit:  isOnline=${banditRecord.isOnline}  ` +
    `terrain="${banditBrain?.currentTerrainId  ?? 'none'}"  ` +
    `task="${banditBrain?.currentTask?.slotType ?? 'none'}"`,
  );
  console.log('');
}

// ---------------------------------------------------------------------------
// Event listeners — log every interesting event
// ---------------------------------------------------------------------------

kernel.events.on(ALifeEvents.TICK, ({ tick }) => {
  console.log(`[TICK ${tick}]`);
});

kernel.events.on(ALifeEvents.TASK_ASSIGNED, ({ npcId, terrainId, taskType }) => {
  console.log(`  TASK_ASSIGNED "${npcId}" → task="${taskType}" at "${terrainId}"`);
});

kernel.events.on(ALifeEvents.NPC_MOVED, ({ npcId, fromZone, toZone }) => {
  console.log(`  NPC_MOVED     "${npcId}" from="${fromZone}" to="${toZone}"`);
});

kernel.events.on(ALifeEvents.FACTION_CONFLICT, ({ factionA, factionB, zoneId }) => {
  console.log(`  CONFLICT      ${factionA} vs ${factionB} at "${zoneId}"`);
});

// ALifeEvents.NPC_ONLINE and NPC_OFFLINE are emitted by the host when it
// calls setNPCOnline(). The kernel itself does not emit them — the host
// decides when proximity is close enough. We emit them manually below
// to show how you would integrate this in a real game loop.
kernel.events.on(ALifeEvents.NPC_ONLINE, ({ npcId, position }) => {
  console.log(`\n[EVENT] NPC_ONLINE  npcId="${npcId}" position=(${position.x},${position.y})`);
});

kernel.events.on(ALifeEvents.NPC_OFFLINE, ({ npcId, zoneId }) => {
  console.log(`[EVENT] NPC_OFFLINE npcId="${npcId}" zoneId="${zoneId}"`);
});

// ---------------------------------------------------------------------------
// PHASE 1 — Offline warm-up: let the NPCs settle into their terrains
//
// Both NPCs are offline (isOnline defaults to false at registration).
// Run 3 ticks so their brains select the factory terrain and start moving.
// ---------------------------------------------------------------------------

console.log('=== PHASE 1: Offline warm-up (3 ticks) ===');
console.log('');

for (let i = 0; i < 3; i++) {
  kernel.update(5_001); // slightly over 5 000 ms to fire one tick per call
}

printState('After 3 offline ticks');

// ---------------------------------------------------------------------------
// PHASE 2 — Player walks near the stalker
//
// In a real game engine the host would check distance every frame:
//
//   const playerPos = scene.player.position;
//   const npcPos    = sim.getNPCRecord('stalker_wolf')?.lastPosition;
//   if (distance(playerPos, npcPos) < ONLINE_RADIUS) {
//     sim.setNPCOnline('stalker_wolf', true);
//     kernel.events.emit(ALifeEvents.NPC_ONLINE, { npcId: 'stalker_wolf', position: npcPos });
//   }
//
// Here we just set the player position and call setNPCOnline() manually.
// ---------------------------------------------------------------------------

console.log('=== PHASE 2: Player approaches the stalker ===');
console.log('');

// Move the player close to the stalker's starting position.
playerPosition = { x: 520, y: 400 };
console.log(`Player moves to (${playerPosition.x}, ${playerPosition.y}) — near stalker`);

// Switch the stalker to online mode.
// The SDK tick pipeline will now SKIP the stalker's brain on every tick.
// The host engine is responsible for driving it with real-time AI.
sim.setNPCOnline('stalker_wolf', true);

// Emit NPC_ONLINE so listeners know the mode changed. In a real integration
// this would also trigger the host to spawn the visual entity and start the
// real-time AI driver (e.g. AIPlugin state machine).
const stalkerPos = sim.getNPCRecord('stalker_wolf')?.lastPosition ?? { x: 0, y: 0 };
kernel.events.emit(ALifeEvents.NPC_ONLINE, { npcId: 'stalker_wolf', position: stalkerPos });
kernel.events.flush(); // deliver immediately so the log appears in order

printState('Immediately after setNPCOnline(true)');

// Run 2 more ticks. The stalker's brain is skipped by the tick pipeline —
// only the bandit is updated. Notice the stalker's terrain assignment does
// NOT change during these ticks.
console.log('Running 2 ticks while stalker is online (bandit still offline):');
console.log('');

for (let i = 0; i < 2; i++) {
  kernel.update(5_001);
}

printState('After 2 ticks with stalker ONLINE');

// ---------------------------------------------------------------------------
// PHASE 3 — Player moves away from the stalker
//
// The stalker goes back offline. The SDK tick pipeline resumes for it.
// ---------------------------------------------------------------------------

console.log('=== PHASE 3: Player moves away — stalker goes offline ===');
console.log('');

// Move the player far from both NPCs.
playerPosition = { x: 9999, y: 9999 };
console.log(`Player moves to (${playerPosition.x}, ${playerPosition.y}) — far away`);

// Switch the stalker back to offline mode.
// The SDK tick pipeline will pick it up in the next brain round-robin pass.
sim.setNPCOnline('stalker_wolf', false);

// Emit NPC_OFFLINE. In a real game this would also despawn the visible entity
// and hand the NPC back to the offline simulation.
const stalkerTerrainId = sim.getNPCBrain('stalker_wolf')?.currentTerrainId ?? '';
kernel.events.emit(ALifeEvents.NPC_OFFLINE, { npcId: 'stalker_wolf', zoneId: stalkerTerrainId });
kernel.events.flush();

printState('Immediately after setNPCOnline(false)');

// Run 2 more ticks — both NPCs are now offline and both get brain updates.
console.log('Running 2 ticks with both NPCs OFFLINE:');
console.log('');

for (let i = 0; i < 2; i++) {
  kernel.update(5_001);
}

printState('Final state — both NPCs offline');

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('=== Summary ===');
console.log('');
console.log('Key takeaways:');
console.log('  1. sim.registerNPC() starts NPCs in offline mode (isOnline = false).');
console.log('  2. sim.setNPCOnline(id, true) flags the NPC — the tick pipeline skips it.');
console.log('  3. The host engine drives online NPCs with its own real-time AI loop.');
console.log('  4. sim.setNPCOnline(id, false) hands the NPC back to the offline pipeline.');
console.log('  5. The offline brain resumes from wherever it left off (terrain, task, morale).');
console.log('');
console.log('The SDK never reads camera or viewport data — the HOST decides the radius.');

kernel.destroy();
