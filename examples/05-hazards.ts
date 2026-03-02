/**
 * 05-hazards.ts
 *
 * Anomaly zones, radiation damage, and artefact spawning with @alife-sdk/hazards.
 * Runs in Node.js with:
 *   npx tsx --tsconfig examples/tsconfig.json examples/05-hazards.ts
 *
 * What we build here:
 *   - Two hazard zones: a radiation field and a fire pit
 *   - Three artefacts with different zone-type affinities and weights
 *   - Three entities: an unprotected stalker, a radiation-resistant scientist,
 *     and a fire-immune player
 *   - Damage ticks, immunity reduction, artefact spawning and collection
 *   - A short-lived surge zone that auto-expires
 *
 * Key design:
 *   HazardsPlugin.update() is a deliberate no-op. The plugin does not know
 *   which entities are near the zones — that is engine-side knowledge.
 *   Instead you call hazards.manager.tick(deltaMs, entities) yourself each
 *   frame, passing whatever entities your engine considers "live".
 *
 *   Typical game loop:
 *     kernel.update(deltaMs);                       // simulation tick pipeline
 *     hazards.manager.tick(deltaMs, liveEntities);  // hazard zone processing
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

// HazardsPlugin — the kernel plugin that owns zones, artefacts, and events.
// createDefaultHazardsConfig — factory with sensible defaults.
import {
  HazardsPlugin,
  createDefaultHazardsConfig,
} from '@alife-sdk/hazards/plugin';

// HazardEvents — typed event constants for the hazard event bus.
import { HazardEvents } from '@alife-sdk/hazards/events';

// IHazardEntity — minimal shape any entity must satisfy to be ticked.
// The manager uses structural typing — your game entity class does not need
// to extend or implement this; it just needs { id, position, immunity? }.
import type { IHazardEntity } from '@alife-sdk/hazards/manager';

// SeededRandom — deterministic PRNG from core, implements IRandom.
// Using a fixed seed means every run of this example produces identical output.
import { ALifeKernel, SeededRandom } from '@alife-sdk/core';

// ---------------------------------------------------------------------------
// Step 1: Build the kernel
// ---------------------------------------------------------------------------

const random = new SeededRandom(42); // fixed seed for reproducible output
const kernel = new ALifeKernel();

// ---------------------------------------------------------------------------
// Step 3: Create the plugin
//
// artefactFactory.create() is the only callback you must implement.
// In a real game it spawns a pickup entity at (x, y) in your engine.
// Here we just record the spawn for inspection.
// ---------------------------------------------------------------------------

const spawnedArtefacts: Array<{ artefactId: string; zoneId: string; x: number; y: number }> = [];

const hazards = new HazardsPlugin(random, createDefaultHazardsConfig({
  artefactFactory: {
    create(ev) {
      // Called once per successful artefact lottery win.
      // Store the spawn record so we can "collect" it in Phase 4.
      spawnedArtefacts.push({ artefactId: ev.artefactId, zoneId: ev.zoneId, x: ev.x, y: ev.y });
    },
  },
}));

// ---------------------------------------------------------------------------
// Step 4: Register artefact definitions
//
// Each artefact is associated with one or more zone types.
// The manager only offers an artefact from zones whose type matches
// at least one of the artefact's zoneTypes.
//
// weight controls relative spawn probability within a single zone:
//   total weight for radiation zones = soul(3) + jellyfish(1) = 4
//   soul is picked 3/4 of the time, jellyfish 1/4 of the time.
// ---------------------------------------------------------------------------

// Register BEFORE kernel.use() is called; artefacts are frozen at init().
hazards.artefacts
  .register({ id: 'soul',      zoneTypes: ['radiation'],         weight: 3 })
  .register({ id: 'fireball',  zoneTypes: ['fire'],              weight: 2 })
  .register({ id: 'jellyfish', zoneTypes: ['radiation', 'psi'],  weight: 1 });

// Install and initialise.
kernel.use(hazards);
kernel.init();
kernel.start();

// ---------------------------------------------------------------------------
// Step 5: Subscribe to hazard events
//
// HazardsPlugin owns a SEPARATE EventBus<HazardEventPayloads> — distinct
// from kernel.events (ALifeEventPayloads). Subscribe here, after
// kernel.use(hazards) and before manager.tick() to catch all events.
//
// Events are flushed at the END of manager.tick(), never mid-zone.
// ---------------------------------------------------------------------------

let totalDamageDealt = 0;

hazards.events.on(HazardEvents.HAZARD_DAMAGE, ({ entityId, zoneId, zoneType, damage }) => {
  console.log(
    `  [DAMAGE] ${entityId.padEnd(12)} ← ${zoneType.padEnd(10)} ` +
    `zone="${zoneId}"  damage=${damage.toFixed(2)}`,
  );
  totalDamageDealt += damage;
});

hazards.events.on(HazardEvents.ARTEFACT_SPAWNED, ({ artefactId, zoneId, x, y }) => {
  console.log(
    `  [SPAWN]  artefact="${artefactId}"  zone="${zoneId}"  ` +
    `pos=(${Math.round(x)}, ${Math.round(y)})`,
  );
});

hazards.events.on(HazardEvents.ARTEFACT_COLLECTED, ({ artefactId, collectorId, zoneId }) => {
  console.log(
    `  [COLLECT] ${collectorId} picked up "${artefactId}" from zone="${zoneId}"`,
  );
});

hazards.events.on(HazardEvents.ZONE_EXPIRED, ({ zoneId, zoneType }) => {
  console.log(`  [EXPIRED] zone="${zoneId}" type="${zoneType}" auto-removed`);
});

// ---------------------------------------------------------------------------
// Step 6: Add zones
//
// Zones can be added via the config OR via manager.addZone() after install().
// Mixing both is fine — config zones are added first inside install().
//
// artefactSpawnCycleMs defaults to 60 000 ms (1 minute). We use 3 000 ms
// here so the example reaches a spawn without simulating a full minute.
// ---------------------------------------------------------------------------

hazards.manager.addZone({
  id:                   'rad_field',
  type:                 'radiation',
  x:                    300, y: 300,
  radius:               120,           // 120 px radius — large zone
  damagePerSecond:      8,             // 4 damage per 500 ms tick
  damageTickIntervalMs: 500,           // damage fires every 500 ms (default)
  artefactChance:       1.0,           // guaranteed spawn on every cycle for demo
  artefactSpawnCycleMs: 3_000,         // 3 s instead of the default 60 s
  maxArtefacts:         3,
});

hazards.manager.addZone({
  id:                   'fire_pit',
  type:                 'fire',
  x:                    600, y: 400,
  radius:               60,            // smaller, hotter zone
  damagePerSecond:      20,            // 10 damage per 500 ms tick
  damageTickIntervalMs: 500,
  artefactChance:       1.0,
  artefactSpawnCycleMs: 3_000,
  maxArtefacts:         2,
});

console.log(`Zones registered: ${hazards.manager.size}`);
console.log(`Artefact types:   soul(rad) · fireball(fire) · jellyfish(rad+psi)`);
console.log('');

// ---------------------------------------------------------------------------
// Step 7: Define entities
//
// IHazardEntity only requires { id, position }.
// immunity is an optional Map<zoneType, resistance [0–1]>:
//   0   = no protection (full damage)
//   0.5 = 50% reduction
//   1.0 = full immunity (damage event never emitted)
//
// isAlive() is optional — manager skips entities that return false.
// ---------------------------------------------------------------------------

// Stalker Wolf — no protective gear, full damage from everything.
const stalker: IHazardEntity = {
  id:       'stalker_wolf',
  position: { x: 300, y: 300 }, // centre of rad_field
};

// Scientist Vera — rad-resistant suit, fully immune to fire.
// She stands inside rad_field too, but takes half the radiation damage.
const scientist: IHazardEntity = {
  id:       'scientist_vera',
  position: { x: 280, y: 310 }, // also inside rad_field
  immunity: new Map<string, number>([
    ['radiation', 0.5],  // 50% radiation resistance
    ['fire',      1.0],  // fully immune to fire (damage event never emitted)
  ]),
};

// Player — standing in the fire pit, wearing fire-proof armour.
const player: IHazardEntity = {
  id:       'player',
  position: { x: 600, y: 400 }, // centre of fire_pit
  immunity: new Map<string, number>([
    ['fire', 1.0],   // fully immune to fire
  ]),
};

const entities: IHazardEntity[] = [stalker, scientist, player];

// ---------------------------------------------------------------------------
// PHASE 1 — First damage tick (500 ms)
//
// Advancing 500 ms hits the damageTickIntervalMs threshold.
// Expected:
//   stalker_wolf ← full radiation damage
//   scientist_vera ← half radiation damage (0.5 resistance)
//   player ← NO event (1.0 fire immunity → damage clamped to 0)
//
// Note: kernel.update() is still called so the game clock advances in sync.
// ---------------------------------------------------------------------------

console.log('=== PHASE 1: First damage tick (500 ms) ===');
console.log('');

kernel.update(500);
hazards.manager.tick(500, entities);

console.log('');

// ---------------------------------------------------------------------------
// PHASE 2 — Immunity comparison (another 500 ms)
//
// Run a second damage cycle and compare accumulated damage per entity.
// ---------------------------------------------------------------------------

console.log('=== PHASE 2: Second damage tick — immunity comparison ===');
console.log('');

kernel.update(500);
hazards.manager.tick(500, entities);

console.log('');
const zone = hazards.manager.getZone('rad_field')!;
const dps = zone.config.damagePerSecond;
const tickInterval = zone.damageTickIntervalMs;
const rawTickDamage = (dps * tickInterval) / 1000;

console.log(`  rad_field  damagePerSecond=${dps}  tickIntervalMs=${tickInterval}`);
console.log(`  raw damage per tick = ${rawTickDamage}  (dps × interval / 1000)`);
console.log(`  stalker_wolf    receives ${rawTickDamage.toFixed(2)} per tick  (no resistance)`);
console.log(`  scientist_vera  receives ${(rawTickDamage * 0.5).toFixed(2)} per tick  (0.5 resistance)`);
console.log(`  player          receives 0 per tick  (1.0 fire immunity)`);
console.log('');

// ---------------------------------------------------------------------------
// PHASE 3 — Artefact spawning
//
// Advance past artefactSpawnCycleMs (3 000 ms).
// We are currently at 1 000 ms elapsed, so we need 2 000 ms more.
// artefactChance = 1.0 guarantees a spawn on every cycle.
// ---------------------------------------------------------------------------

console.log('=== PHASE 3: Artefact spawning (advance to 3 000 ms) ===');
console.log('');

// Advance in two steps to show accumulation:
// 1 000 ms so far → 1 000 ms → 2 000 ms → 3 000 ms (spawn fires)
kernel.update(1_000);
hazards.manager.tick(1_000, entities); // 2 000 ms total — no spawn yet

kernel.update(1_000);
hazards.manager.tick(1_000, entities); // 3 000 ms total — spawn cycle fires

console.log(`  Spawned artefacts so far: ${spawnedArtefacts.length}`);
console.log('');

// ---------------------------------------------------------------------------
// PHASE 4 — Artefact collection
//
// notifyArtefactCollected(zoneId, instanceId, artefactId, collectorId)
//   - Decrements zone artefact count (slot freed for future spawns)
//   - Emits ARTEFACT_COLLECTED event immediately
//   - instanceId identifies this particular pickup object in the game world
// ---------------------------------------------------------------------------

console.log('=== PHASE 4: Artefact collection ===');
console.log('');

if (spawnedArtefacts.length > 0) {
  const first = spawnedArtefacts[0];
  // instanceId would be the pickup entity's ID in the game engine.
  // Here we synthesise one for demonstration.
  const instanceId = `pickup_${first.zoneId}_0`;
  hazards.manager.notifyArtefactCollected(first.zoneId, instanceId, first.artefactId, 'player');
} else {
  console.log('  (no artefact spawned yet — increase artefactChance or advance more time)');
}

console.log('');

// ---------------------------------------------------------------------------
// PHASE 5 — Zone expiry
//
// A short-lived PSI surge zone appears and auto-expires after 2 000 ms.
// expiresAtMs is measured from the manager's cumulative elapsed time
// (total deltaMs passed to all manager.tick() calls so far).
// ---------------------------------------------------------------------------

console.log('=== PHASE 5: Zone expiry (PSI surge) ===');
console.log('');

const currentElapsed = 3_000; // we have ticked 500+500+1000+1000 = 3000 ms
const surgeDuration  = 2_000;

hazards.manager.addZone({
  id:                   'psi_surge',
  type:                 'psi',
  x:                    300, y: 300,   // overlaps rad_field — PSI stacks with radiation
  radius:               200,
  damagePerSecond:      5,
  damageTickIntervalMs: 500,
  artefactChance:       0,             // surge zones don't spawn artefacts
  maxArtefacts:         0,
  expiresAtMs:          currentElapsed + surgeDuration, // expires 2 s from now
});

console.log(`  PSI surge zone added. It expires at elapsed=${currentElapsed + surgeDuration} ms.`);
console.log('');

// Advance past the expiry — surge fires one damage tick then disappears.
kernel.update(2_001);
hazards.manager.tick(2_001, entities);

console.log('');
console.log(`  Zones remaining after expiry: ${hazards.manager.size}`);
console.log('');

// ---------------------------------------------------------------------------
// Query API
// ---------------------------------------------------------------------------

console.log('=== Query API ===');
console.log('');

// getZoneAtPoint — which zone is the stalker standing in right now?
const zoneAtStalker = hazards.manager.getZoneAtPoint(stalker.position.x, stalker.position.y);
console.log(`  getZoneAtPoint(stalker): ${zoneAtStalker?.config.id ?? 'none'}`);

// getZonesInRadius — which zones are within 300 px of the origin?
const nearZones = hazards.manager.getZonesInRadius(0, 0, 300);
console.log(`  getZonesInRadius(origin, 300): [${nearZones.map(z => z.config.id).join(', ')}]`);

console.log('');
console.log(`  Total damage dealt this session: ${totalDamageDealt.toFixed(2)}`);

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

kernel.destroy();

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('');
console.log('=== Summary ===');
console.log('');
console.log('Key takeaways:');
console.log('  1. HazardsPlugin.update() is a no-op — call manager.tick(deltaMs, entities) yourself.');
console.log('  2. hazards.events is a separate typed bus; subscribe after kernel.use(hazards).');
console.log('  3. immunity map: zoneType → resistance [0–1]; 1.0 suppresses the damage event entirely.');
console.log('  4. artefactSpawnCycleMs defaults to 60 000 ms — lower it for faster dev iteration.');
console.log('  5. notifyArtefactCollected() frees the zone slot and emits ARTEFACT_COLLECTED.');
console.log('  6. expiresAtMs is measured against cumulative manager elapsed time, not wall clock.');
console.log('  7. HazardsPlugin can also run standalone (plugin.install + plugin.init) without a kernel.');
