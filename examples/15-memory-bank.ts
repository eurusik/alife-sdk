/**
 * 15-memory-bank.ts
 *
 * MemoryBank — per-NPC episodic memory with confidence decay.
 * Runs in Node.js with:
 *   npx tsx --tsconfig examples/tsconfig.json examples/15-memory-bank.ts
 *
 * In most games, NPCs either know about a threat forever or forget it instantly.
 * MemoryBank gives you the middle ground: memories fade over time, different
 * senses decay at different rates, and you can query "what's the most dangerous
 * thing this NPC currently remembers?" — exactly what you need for believable
 * combat AI. Think of it as a stalker's short-term threat awareness, stored
 * per NPC so each character has their own view of the world.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { MemoryBank, MemoryChannel } from '@alife-sdk/core/ai';
import type { MemoryRecord } from '@alife-sdk/core/ai';

// ---------------------------------------------------------------------------
// Step 1: Create the stalker NPC memory bank
//
// MemoryBank needs a timeFn so it can timestamp each memory.
// The simplest approach: a plain `let now = 0` that we advance manually.
// In a real game this would be something like () => game.time.now
// or () => performance.now().
//
// Why inject a clock instead of calling Date.now() internally?
// Because tests and deterministic simulations need control over time.
//
// The channel decay rates model how fast each sense fades:
//   SOUND  — you forget a distant gunshot quickly (high decay)
//   VISUAL — you remember what you saw for a while (medium decay)
//   HIT    — you never really forget getting shot (slow decay)
// ---------------------------------------------------------------------------

let now = 0;
const timeFn = () => now;

// Create the memory bank for one specific NPC: "Lukash the Stalker".
//
// - decayRate:          default confidence lost per second (0.05 = slow decay)
// - channelDecayRates:  override decay per channel
//   - SOUND fades fast  (you forget a distant gunshot quickly)
//   - VISUAL fades medium (you remember what you saw for a while)
//   - HIT fades slow    (you never really forget getting shot)
// - maxRecords:         cap to avoid unbounded memory growth
const memory = new MemoryBank({
  timeFn,
  maxRecords: 20,
  decayRate: 0.05,              // fallback for any channel not listed below
  channelDecayRates: {
    [MemoryChannel.SOUND]:   0.15,  // sound is fleeting — high decay
    [MemoryChannel.VISUAL]:  0.06,  // visual lingers a bit longer
    [MemoryChannel.HIT]:     0.02,  // getting hit is hard to forget — slow decay
  },
});

console.log('Lukash memory bank created.');
console.log(`  Records in bank: ${memory.size}`);

// ---------------------------------------------------------------------------
// Step 2: NPC hears gunshots (SOUND channel)
//
// Lukash hears shots from the north. He doesn't know exactly who it is —
// maybe Bandits, maybe another Stalker. Confidence is medium (0.4) because
// sound alone doesn't tell you much. The position is where the sound came from.
// ---------------------------------------------------------------------------

console.log('');

now = 0;

// remember() creates or updates the memory for this sourceId.
// Using SOUND channel here because Lukash hasn't seen anything — only heard it.
memory.remember({
  sourceId: 'bandit-squad-north',
  channel: MemoryChannel.SOUND,
  position: { x: 120, y: 45 },
  confidence: 0.4,
});

// recall() looks up a memory by sourceId — returns undefined if forgotten
const soundMemory = memory.recall('bandit-squad-north');
console.log(`Heard something at (${soundMemory!.position.x}, ${soundMemory!.position.y})`);
console.log(`  Channel:    ${soundMemory!.channel}`);
console.log(`  Confidence: ${soundMemory!.confidence.toFixed(2)}  (medium — sound is unreliable)`);
console.log(`  Records in bank: ${memory.size}`);

// ---------------------------------------------------------------------------
// Step 3: NPC spots an enemy visually (VISUAL channel)
//
// Lukash peeks around a corner and actually sees a Bandit.
// Visual confirmation is much more reliable — confidence jumps to 0.9.
// The same sourceId updates the existing record (same bandit squad).
// Notice: calling remember() again on the same sourceId overwrites the old
// record and upgrades the channel from SOUND to VISUAL.
// ---------------------------------------------------------------------------

console.log('');

now = 2; // 2 seconds have passed

// Calling remember() on an existing sourceId replaces it entirely —
// channel is upgraded from SOUND to VISUAL, confidence goes from 0.4 to 0.9.
memory.remember({
  sourceId: 'bandit-squad-north',
  channel: MemoryChannel.VISUAL,
  position: { x: 118, y: 42 },   // closer — the enemy moved a bit
  confidence: 0.9,
});

// Also remember a second unknown entity — a lone figure to the east
memory.remember({
  sourceId: 'unknown-east',
  channel: MemoryChannel.VISUAL,
  position: { x: 200, y: 10 },
  confidence: 0.6,
});

const visualMemory = memory.recall('bandit-squad-north');
console.log(`Spotted bandit squad at (${visualMemory!.position.x}, ${visualMemory!.position.y})`);
console.log(`  Channel:    ${visualMemory!.channel}  (upgraded from SOUND)`);
console.log(`  Confidence: ${visualMemory!.confidence.toFixed(2)}  (high — direct line of sight)`);
console.log(`  Records in bank: ${memory.size}`);

// getByChannel lets you ask "show me everything I've seen visually" —
// useful for building a threat list sorted by confidence.
const visualSightings = memory.getByChannel(MemoryChannel.VISUAL);
console.log(`\nAll visual sightings (${visualSightings.length}):`);
for (const r of visualSightings) {
  console.log(`  [${r.sourceId}] pos=(${r.position.x}, ${r.position.y})  conf=${r.confidence.toFixed(2)}`);
}

// ---------------------------------------------------------------------------
// Step 4: NPC takes a hit (HIT channel, full confidence)
//
// Someone just shot Lukash from the south. This is the highest-confidence
// possible event — you KNOW someone is there because they just hit you.
// HIT channel has the slowest decay rate, so it lingers the longest.
// ---------------------------------------------------------------------------

console.log('');

now = 3;

// confidence: 1.0 — no doubt whatsoever; this record will outlast all others
memory.remember({
  sourceId: 'sniper-south',
  channel: MemoryChannel.HIT,
  position: { x: 95, y: 180 },
  confidence: 1.0,              // max confidence — no doubt they exist
});

const hitMemory = memory.recall('sniper-south');
console.log(`Got hit from direction (${hitMemory!.position.x}, ${hitMemory!.position.y})`);
console.log(`  Channel:    ${hitMemory!.channel}`);
console.log(`  Confidence: ${hitMemory!.confidence.toFixed(2)}  (maximum — we KNOW they're there)`);
console.log(`  Records in bank: ${memory.size}`);

// ---------------------------------------------------------------------------
// Step 5: Time passes — watch confidence decay
//
// update(deltaSec) is meant to be called once per game frame (or tick).
// Each call reduces confidence by: channelDecayRate * deltaSec
//
// We'll simulate several seconds passing and print confidence each time
// so you can watch the decay happen in real time.
// ---------------------------------------------------------------------------

console.log('');

// Helper to print a snapshot of the three main memories at a given moment.
// Prints 'FORGOTTEN' when a record has been pruned by update().
function printMemorySnapshot(label: string) {
  const bandit   = memory.recall('bandit-squad-north');
  const unknown  = memory.recall('unknown-east');
  const sniper   = memory.recall('sniper-south');

  console.log(`\n  [t=${now.toFixed(0)}s] ${label}`);
  console.log(`    bandit-squad-north : ${bandit  ? bandit.confidence.toFixed(3)  + ' (' + bandit.channel + ')'  : 'FORGOTTEN'}`);
  console.log(`    unknown-east       : ${unknown ? unknown.confidence.toFixed(3) + ' (' + unknown.channel + ')' : 'FORGOTTEN'}`);
  console.log(`    sniper-south       : ${sniper  ? sniper.confidence.toFixed(3)  + ' (' + sniper.channel + ')'  : 'FORGOTTEN'}`);
  console.log(`    total records      : ${memory.size}`);
}

// Simulate 5-second steps — like the NPC losing sight of enemies
for (let i = 0; i < 6; i++) {
  now += 5;
  memory.update(5);             // 5 seconds of decay
  printMemorySnapshot(`after ${(i + 1) * 5}s of no contact`);
}

// ---------------------------------------------------------------------------
// Step 6: Keep advancing time until VISUAL memory is auto-pruned
//
// After enough updates, any record whose confidence drops below the
// minConfidence threshold (default 0.05) is automatically removed by update().
// You don't need to manually clean up — it just disappears.
//
// By this point the bandit-squad-north started with 0.9 VISUAL confidence
// and decays at 0.06/s. After ~14 seconds it falls below 0.05 and gets pruned.
// The sniper's HIT memory at 0.02/s should still be alive much longer.
// ---------------------------------------------------------------------------

console.log('');

// Run additional seconds until the visual memory disappears on its own.
// This loop shows that you never need to poll for dead records — update()
// handles cleanup automatically each tick.
while (memory.recall('bandit-squad-north') !== undefined) {
  now += 2;
  memory.update(2);
}

console.log(`\nAt t=${now}s: bandit-squad-north memory was auto-pruned (confidence fell below threshold)`);
console.log(`  Remaining records: ${memory.size}`);
const sniperStill = memory.recall('sniper-south');
if (sniperStill) {
  console.log(`  sniper-south still remembered: conf=${sniperStill.confidence.toFixed(3)} (HIT memories linger)`);
}

// ---------------------------------------------------------------------------
// Step 7: Find most threatening known enemy
//
// When Lukash needs to decide who to focus fire on, he should pick the
// target he's most certain about. getMostConfident() returns the record
// with the highest remaining confidence across ALL channels.
//
// This is useful for: target selection, alert level, search waypoints, etc.
// ---------------------------------------------------------------------------

console.log('');

// First, add a couple of fresh contacts to make the selection interesting
now = 120;

memory.remember({
  sourceId: 'monolith-01',
  channel: MemoryChannel.VISUAL,
  position: { x: 55, y: 30 },
  confidence: 0.75,
});

memory.remember({
  sourceId: 'monolith-02',
  channel: MemoryChannel.SOUND,
  position: { x: 60, y: 35 },
  confidence: 0.3,
});

// getMostConfident() scans all live records and returns the one with the
// highest confidence — the NPC's "I'm most sure about this threat" answer.
const primaryTarget = memory.getMostConfident();

if (primaryTarget) {
  console.log(`Primary target: ${primaryTarget.sourceId}`);
  console.log(`  Confidence: ${primaryTarget.confidence.toFixed(2)}`);
  console.log(`  Last known position: (${primaryTarget.position.x}, ${primaryTarget.position.y})`);
  console.log(`  Channel: ${primaryTarget.channel}`);
  console.log(`  --> Lukash will focus on this target first`);
} else {
  console.log('No threats in memory — Lukash is unaware of enemies');
}

// ---------------------------------------------------------------------------
// Step 8: Enemy escapes — manually forget
//
// Sometimes you want to explicitly clear a memory regardless of confidence.
// For example: the player successfully breaks line of sight and hides,
// or a script event resets the NPC's threat awareness.
// ---------------------------------------------------------------------------

console.log('');

console.log(`Records before forget: ${memory.size}`);
console.log(`  monolith-01 remembered: ${memory.recall('monolith-01') !== undefined}`);

// forget() removes the record immediately — no waiting for decay
memory.forget('monolith-01');

console.log(`Records after forget:  ${memory.size}`);
console.log(`  monolith-01 remembered: ${memory.recall('monolith-01') !== undefined}  (gone!)`);
console.log(`  monolith-02 remembered: ${memory.recall('monolith-02') !== undefined}  (still there)`);

// ---------------------------------------------------------------------------
// Step 9: Serialize / restore (save game)
//
// When the player saves the game, you need to persist the NPC's memory.
// serialize() returns a plain array of MemoryRecord objects — safe to
// JSON.stringify and store in any save file format.
// restore() loads that snapshot back into a fresh MemoryBank.
//
// Note: the restored bank uses the same timeFn you provide at construction,
// so timestamps will be relative to your game clock, not wall time.
// ---------------------------------------------------------------------------

console.log('');

// Add a couple of final entries so there's something interesting to save
memory.remember({
  sourceId: 'controller-cave',
  channel: MemoryChannel.HIT,
  position: { x: 300, y: 150 },
  confidence: 0.85,
});

// serialize() returns a plain array — call JSON.stringify on this for disk
const saveData: MemoryRecord[] = memory.serialize();
const saveJson = JSON.stringify(saveData, null, 2);

console.log(`Serialized ${saveData.length} memory records (${saveJson.length} bytes of JSON)`);
console.log('Save data preview:');
for (const r of saveData) {
  console.log(`  ${r.sourceId}: conf=${r.confidence.toFixed(3)} ch=${r.channel} pos=(${r.position.x},${r.position.y})`);
}

// --- simulate loading a save ---
// Create a brand-new bank (as you would when loading a save) and restore
let loadedNow = now;  // restore to same game time
const loadedMemory = new MemoryBank({
  timeFn: () => loadedNow,
  maxRecords: 20,
  decayRate: 0.05,
  channelDecayRates: {
    [MemoryChannel.SOUND]:  0.15,
    [MemoryChannel.VISUAL]: 0.06,
    [MemoryChannel.HIT]:    0.02,
  },
});

// restore() replaces everything in the bank with the serialized records
loadedMemory.restore(saveData);

console.log(`\nAfter restore — records in loaded bank: ${loadedMemory.size}`);
const restoredTarget = loadedMemory.getMostConfident();
if (restoredTarget) {
  console.log(`Most confident after restore: ${restoredTarget.sourceId} (conf=${restoredTarget.confidence.toFixed(3)})`);
}

// Verify round-trip: both banks agree on contents
let allMatch = true;
for (const original of saveData) {
  const loaded = loadedMemory.recall(original.sourceId);
  if (!loaded || Math.abs(loaded.confidence - original.confidence) > 0.001) {
    allMatch = false;
    break;
  }
}
console.log(`Round-trip integrity check: ${allMatch ? 'PASS' : 'FAIL'}`);

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

console.log('');
console.log('Done. Key takeaways:');
console.log('  - remember()        : add/update a memory (overwrites same sourceId)');
console.log('  - recall()          : look up one specific source by ID');
console.log('  - getByChannel()    : get everything seen/heard/felt on a channel');
console.log('  - getMostConfident(): pick the highest-priority known threat');
console.log('  - update(deltaSec)  : decay and auto-prune on each game tick');
console.log('  - forget()          : instantly remove a specific memory');
console.log('  - serialize()       : snapshot to JSON-safe array for save files');
console.log('  - restore()         : reload from that snapshot');
