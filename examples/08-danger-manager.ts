/**
 * 08-danger-manager.ts
 *
 * DangerManager — spatial danger zones with TTL and safe-direction vector.
 * Runs in Node.js with:
 *   npx tsx --tsconfig examples/tsconfig.json examples/08-danger-manager.ts
 *
 * Games need NPCs that react to hazards: grenades, anomalies, gunfire.
 * DangerManager tracks active threat zones in 2D space, each with a
 * position, radius, urgency score, and time-to-live. Your NPC can query
 * it every frame to decide "should I run?" and "which way is safe?" — no
 * custom spatial logic needed.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

// DangerManager is the core class — create one per NPC, or share one globally.
// DangerType is a set of built-in string constants for common threat types.
import { DangerManager, DangerType } from '@alife-sdk/core/ai';

// IDangerEntry describes the shape of a danger zone you register.
import type { IDangerEntry } from '@alife-sdk/core/ai';

// ---------------------------------------------------------------------------
// Step 1: Set up the danger manager
//
// new DangerManager() uses a default threat threshold of 0.1.
// That means isDangerous() returns true once combined threat at a
// position reaches 0.1 or higher.
//
// You can raise the threshold to make your NPC braver:
//   new DangerManager(0.5) — only flee when threat is significant
//
// We'll create two: a standard one and a "brave stalker" version.
// ---------------------------------------------------------------------------

console.log('');

// Standard danger manager — NPC flees at the first sign of any threat.
const dangers = new DangerManager();

// Custom threshold: this NPC has seen enough of the Zone to stay calm
// unless the combined threat at their position exceeds 0.5.
const braveStalkerDangers = new DangerManager(0.5);

console.log('  Standard DangerManager created (threshold: 0.1 default)');
console.log('  Brave stalker DangerManager created (threshold: 0.5 custom)');
console.log(`  Active dangers: ${dangers.activeDangerCount}`); // 0

// ---------------------------------------------------------------------------
// Step 2: NPC standing in a safe field
//
// Before any danger is registered, isDangerous() should return false.
// This is your "all clear" check — run it every tick to decide if the
// NPC should enter a flee/evade state.
// ---------------------------------------------------------------------------

console.log('');

// Our NPC "Vasya" is standing in an open field somewhere in the Zone.
const npcPosition = { x: 100, y: 100 };

const isSafe = !dangers.isDangerous(npcPosition);
console.log(`  Vasya's position: (${npcPosition.x}, ${npcPosition.y})`);
console.log(`  isDangerous() = ${dangers.isDangerous(npcPosition)}`); // false
console.log(`  Vasya is ${isSafe ? 'safe — continuing patrol' : 'in danger — must flee'}`);
console.log(`  Threat level: ${dangers.getThreatAt(npcPosition).toFixed(3)}`); // 0.000

// ---------------------------------------------------------------------------
// Step 3: Enemy throws a grenade nearby
//
// addDanger() registers a threat zone. The key fields:
//   id          — unique string, used to remove or update this danger later
//   type        — DangerType constant (or any custom string)
//   position    — where the danger is in world space
//   radius      — how far it reaches (circle, not square)
//   threatScore — urgency from 0 to 1 (can stack above 1 with multiple dangers)
//   remainingMs — how long this danger lives before auto-expiring
//
// A grenade has a big blast radius and high threat, but it disappears fast.
// ---------------------------------------------------------------------------

console.log('');

const grenade: IDangerEntry = {
  id:          'grenade_01',
  type:        DangerType.GRENADE,
  position:    { x: 120, y: 110 }, // 22 units from Vasya — well within blast radius
  radius:      60,                 // 60-unit blast zone
  threatScore: 0.9,                // near-maximum urgency — grenades are deadly
  remainingMs: 3_000,              // fuse: 3 seconds until it explodes (then gone)
};

dangers.addDanger(grenade);

console.log(`  Grenade registered at (${grenade.position.x}, ${grenade.position.y}), radius ${grenade.radius}`);
console.log(`  Active dangers: ${dangers.activeDangerCount}`); // 1
console.log(`  isDangerous() = ${dangers.isDangerous(npcPosition)}`); // true
console.log(`  Threat level: ${dangers.getThreatAt(npcPosition).toFixed(3)}`); // 0.900
console.log(`  Vasya is ${dangers.isDangerous(npcPosition) ? 'in danger — must flee!' : 'safe'}`);

// ---------------------------------------------------------------------------
// Step 4: getSafeDirection() — which way should the NPC run?
//
// This is the most useful method for movement AI. It returns a normalized
// direction vector (length = 1.0) pointing AWAY from all active threats.
//
// The vector is computed by summing weighted repulsion forces from every
// danger zone that covers the NPC's position. Higher threatScore and
// closer proximity = stronger push away.
//
// Pass this vector to your movement system: npc.velocity = safeDir * speed
// ---------------------------------------------------------------------------

console.log('');

const safeDir = dangers.getSafeDirection(npcPosition);
console.log(`  Safe direction vector: (${safeDir.x.toFixed(3)}, ${safeDir.y.toFixed(3)})`);

// The magnitude of a normalized vector is always ~1.0 (or 0 if no dangers).
const magnitude = Math.sqrt(safeDir.x ** 2 + safeDir.y ** 2);
console.log(`  Vector magnitude: ${magnitude.toFixed(3)} (always 1.0 when dangers exist)`);

// Translate the vector into a human-readable compass heading for clarity.
const angle = Math.atan2(safeDir.y, safeDir.x) * (180 / Math.PI);
console.log(`  Escape heading: ${angle.toFixed(1)} degrees`);
console.log(`  Vasya moves at speed 5: dx=${(safeDir.x * 5).toFixed(2)}, dy=${(safeDir.y * 5).toFixed(2)}`);

// No dangers → getSafeDirection returns (0, 0) — NPC stays put.
const emptyDm = new DangerManager();
const noDir   = emptyDm.getSafeDirection(npcPosition);
console.log(`  (Empty manager) getSafeDirection = (${noDir.x}, ${noDir.y})`); // (0, 0)

// ---------------------------------------------------------------------------
// Step 5: Multiple overlapping dangers — getThreatAt() accumulates
//
// What if there's an anomaly in the area AND the grenade is still live?
// getThreatAt() sums all threat scores from every danger zone covering
// the given position. The result can exceed 1.0 — that's intentional.
//
// Use this for things like:
//   - Morale systems: high threat = low morale
//   - Animation blending: threat level drives fear pose intensity
//   - Priority queues: highest-threat NPC gets processed first
// ---------------------------------------------------------------------------

console.log('');

// There's a permanent electro-anomaly to the southwest — it never leaves.
const anomaly: IDangerEntry = {
  id:          'anomaly_electro_01',
  type:        DangerType.ANOMALY,
  position:    { x: 80, y: 80 },  // 28 units from Vasya
  radius:      50,                 // wide enough to cover Vasya's position
  threatScore: 0.6,                // moderately dangerous — it won't kill you instantly
  remainingMs: 999_999_999,        // anomalies don't expire — they're permanent features
};

dangers.addDanger(anomaly);

console.log(`  Anomaly registered at (${anomaly.position.x}, ${anomaly.position.y})`);
console.log(`  Active dangers: ${dangers.activeDangerCount}`); // 2

// Both grenade (0.9) and anomaly (0.6) cover Vasya's position.
const totalThreat = dangers.getThreatAt(npcPosition);
console.log(`  Total threat at Vasya's position: ${totalThreat.toFixed(3)}`); // ~1.500

// getSafeDirection now blends both repulsion forces — the NPC is pushed
// away from both the grenade AND the anomaly simultaneously.
const blendedDir = dangers.getSafeDirection(npcPosition);
console.log(`  Blended safe direction: (${blendedDir.x.toFixed(3)}, ${blendedDir.y.toFixed(3)})`);
console.log(`  (Direction now accounts for both the grenade and the anomaly)`);

// ---------------------------------------------------------------------------
// Step 6: getDangersNear() — situational awareness
//
// "What exactly is threatening me right now?"
//
// getDangersNear(position, radius) returns all registered dangers whose
// CENTER POINT is within the given search radius from the position.
// This is different from isDangerous/getThreatAt — those check if you're
// INSIDE a danger's radius. getDangersNear searches by danger origin distance.
//
// Use it for:
//   - UI: display a list of nearby hazards on the HUD
//   - Voice lines: "There's a grenade! Run!"
//   - Decision making: is it a grenade (run fast) or anomaly (walk around)?
// ---------------------------------------------------------------------------

console.log('');

// Search within 80 units of Vasya for any danger origins.
const nearbyDangers = dangers.getDangersNear(npcPosition, 80);

console.log(`  Dangers within 80 units of Vasya: ${nearbyDangers.length}`);
for (const d of nearbyDangers) {
  const dx   = d.position.x - npcPosition.x;
  const dy   = d.position.y - npcPosition.y;
  const dist = Math.sqrt(dx * dx + dy * dy).toFixed(1);
  console.log(`    [${d.type}] id="${d.id}" dist=${dist}u threat=${d.threatScore} ttl=${d.remainingMs}ms`);
}

// Search a wider radius — picks up more dangers.
const wideDangers = dangers.getDangersNear(npcPosition, 200);
console.log(`  Dangers within 200 units of Vasya: ${wideDangers.length}`);

// ---------------------------------------------------------------------------
// Step 7: Add gunfire and explosion — show different danger types
//
// DangerType gives you named constants so you don't use raw strings.
// You can also pass any custom string — the type system allows it.
//
// Typical TTL values by type:
//   GUNFIRE    — 500–2000 ms  (shot fades quickly, just marks "shots heard")
//   GRENADE    — 2000–5000 ms (fuse time)
//   EXPLOSION  — 1000–3000 ms (post-blast danger zone)
//   ANOMALY    — very large (permanent or semi-permanent)
// ---------------------------------------------------------------------------

console.log('');

// A sniper is firing from the northeast — Vasya hears shots.
const gunfire: IDangerEntry = {
  id:          'gunfire_sniper_01',
  type:        DangerType.GUNFIRE,
  position:    { x: 180, y: 60 }, // northeast of Vasya
  radius:      40,                 // danger radius around the gunfire origin
  threatScore: 0.5,                // dangerous but not as immediately lethal as a grenade
  remainingMs: 1_500,              // gunfire danger fades fast — 1.5 seconds
};

// Something already exploded nearby — the blast zone is still hot.
const explosion: IDangerEntry = {
  id:          'explosion_barrel_01',
  type:        DangerType.EXPLOSION,
  position:    { x: 130, y: 130 },
  radius:      45,
  threatScore: 0.7,
  remainingMs: 2_000,
};

dangers.addDanger(gunfire);
dangers.addDanger(explosion);

console.log(`  Gunfire registered: type=${DangerType.GUNFIRE}, ttl=${gunfire.remainingMs}ms`);
console.log(`  Explosion registered: type=${DangerType.EXPLOSION}, ttl=${explosion.remainingMs}ms`);
console.log(`  Active dangers: ${dangers.activeDangerCount}`); // 4

// ---------------------------------------------------------------------------
// Step 8: update() loop — TTL decay and auto-expiry
//
// Call update(deltaMs) every game tick with the elapsed time.
// It subtracts deltaMs from each danger's remainingMs.
// When remainingMs reaches 0, the danger is automatically removed.
//
// This is how dangers naturally expire without you having to track them.
// Simulate 4 ticks of ~500ms each (about 2 seconds of game time).
// ---------------------------------------------------------------------------

console.log('');

const TICK_MS = 500; // each tick is 500ms of game time

for (let tick = 1; tick <= 4; tick++) {
  dangers.update(TICK_MS);

  const elapsed    = tick * TICK_MS;
  const totalThreatNow = dangers.getThreatAt(npcPosition);
  const isDangerous    = dangers.isDangerous(npcPosition);

  console.log(`  Tick ${tick} (+${TICK_MS}ms, total ${elapsed}ms elapsed):`);
  console.log(`    Active dangers: ${dangers.activeDangerCount}`);
  console.log(`    Threat at Vasya's position: ${totalThreatNow.toFixed(3)}`);
  console.log(`    isDangerous(): ${isDangerous}`);

  // List what's still alive.
  const still = dangers.getDangersNear({ x: 0, y: 0 }, 10_000); // get all
  if (still.length > 0) {
    const names = still.map(d => `${d.type}(~${d.remainingMs}ms)`).join(', ');
    console.log(`    Still active: ${names}`);
  } else {
    console.log(`    No active dangers remaining`);
  }
}

// ---------------------------------------------------------------------------
// Step 9: removeDanger() — manual removal
//
// Sometimes a danger should vanish immediately — not after its TTL.
// Examples:
//   - A grenade was picked up before it exploded
//   - An NPC was killed (removing their gunfire danger)
//   - A scripted event ends the anomaly threat
//
// removeDanger(id) removes by the ID you gave at addDanger() time.
// Removing a non-existent ID is safe — it's a no-op.
//
// At this point: the anomaly (TTL=~999_997_999ms) and grenade (~1000ms)
// are still active. The anomaly's unique coverage is at its center (80, 80).
// We check threat at a point only the anomaly covers — far from the grenade.
// The grenade is at (120, 110) radius 60; point (20, 20) is 141 units away
// from the grenade so only the anomaly (at 84 units, within radius 50? No —
// let's use the anomaly center itself for a clean check).
// ---------------------------------------------------------------------------

console.log('');

// The anomaly is still there — it has a huge TTL.
// Check at its own center position (0 distance = definitely inside radius 50).
const anomalyCenter = { x: 80, y: 80 };
console.log(`  Active dangers before removal: ${dangers.activeDangerCount}`);
console.log(`  Anomaly contributes threat at its center: ${dangers.getThreatAt(anomalyCenter).toFixed(3)} > 0`);

// A script event clears the anomaly (perhaps an artifact collector neutralized it).
dangers.removeDanger('anomaly_electro_01');

console.log(`  removeDanger('anomaly_electro_01') called`);
console.log(`  Active dangers after removal: ${dangers.activeDangerCount}`);

// After removal, threat at anomaly center must be 0 if only the anomaly covered it.
// The grenade is at (120, 110) radius 60 — distance to (80, 80) is ~50.0 units,
// exactly on the edge. getThreatAt uses <= so the grenade may still contribute.
// Use a point clearly outside grenade radius: (30, 60) — dist to grenade ~104 units.
const anomalyOnlyPoint = { x: 30, y: 60 };
console.log(`  Threat at anomaly-only point (30,60) after removal: ${dangers.getThreatAt(anomalyOnlyPoint).toFixed(3)}`); // 0

// Safe to call with a non-existent ID — nothing happens.
dangers.removeDanger('does_not_exist');
console.log(`  removeDanger('does_not_exist') — no error, no-op`);

// ---------------------------------------------------------------------------
// Step 10: NPC rechecks position — safe again
//
// After the grenade exploded (TTL expired), the gunfire faded, the explosion
// cooled down, and the anomaly was manually removed — Vasya should be safe.
//
// The grenade still has ~1000ms left after 4 ticks of 500ms.
// Advance one more second to push it past its TTL.
//
// This is the full lifecycle: register, query, tick, expire, recheck.
// ---------------------------------------------------------------------------

console.log('');

// The grenade had 3000ms TTL. After 4 × 500ms = 2000ms, it still has ~1000ms.
// Advance another 1500ms to be sure it expires.
dangers.update(1_500);
console.log(`  (Advance 1500ms — grenade TTL runs out)`);
console.log(`  Active danger count: ${dangers.activeDangerCount}`); // 0

const finalThreat      = dangers.getThreatAt(npcPosition);
const finalIsDangerous = dangers.isDangerous(npcPosition);
const finalSafeDir     = dangers.getSafeDirection(npcPosition);

console.log(`  Threat at Vasya's position: ${finalThreat.toFixed(3)}`); // 0.000
console.log(`  isDangerous(): ${finalIsDangerous}`);                     // false
console.log(`  getSafeDirection(): (${finalSafeDir.x}, ${finalSafeDir.y}) — ZERO means no threats`);
console.log(`  Vasya is ${finalIsDangerous ? 'still in danger' : 'safe — resuming patrol'}`);

// ---------------------------------------------------------------------------
// Step 11: Custom threshold — brave vs. cautious NPC
//
// The brave stalker DangerManager has a threshold of 0.5.
// He only flees when combined threat is 0.5 or higher.
// A regular NPC with threshold 0.1 would have already left.
// ---------------------------------------------------------------------------

console.log('');

// Add a low-level danger — a distant shot heard.
const distantShot: IDangerEntry = {
  id:          'gunfire_distant',
  type:        DangerType.GUNFIRE,
  position:    { x: 105, y: 105 },
  radius:      30,
  threatScore: 0.3,  // low urgency — just a distant warning
  remainingMs: 2_000,
};

// Register the same danger in both managers.
dangers.addDanger(distantShot);
braveStalkerDangers.addDanger(distantShot);

const cautiousResult = dangers.isDangerous(npcPosition);       // threshold 0.1 → true
const braveResult    = braveStalkerDangers.isDangerous(npcPosition); // threshold 0.5 → false

console.log(`  Same danger (threatScore=0.3) at NPC position:`);
console.log(`  Cautious NPC (threshold 0.1) isDangerous: ${cautiousResult}  → flees`);
console.log(`  Brave NPC   (threshold 0.5) isDangerous: ${braveResult}  → holds position`);
console.log('');
console.log('  Tip: use a high threshold for veteran NPCs, low for rookies.');

// ---------------------------------------------------------------------------
// Done
// ---------------------------------------------------------------------------

console.log('');
console.log('Done.');
