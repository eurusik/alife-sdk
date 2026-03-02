/**
 * 07-ai.ts
 *
 * Online frame-based NPC AI with @alife-sdk/ai.
 * Runs in Node.js with:
 *   npx tsx --tsconfig examples/tsconfig.json examples/07-ai.ts
 *
 * What we build here:
 *   - SimpleNPCHost — the minimal host contract every NPC must satisfy
 *   - OnlineAIDriver — per-NPC FSM driver; call update(deltaMs) each frame
 *   - Full human FSM cycle: IDLE → ALERT → COMBAT → SEARCH → IDLE
 *   - CombatState firing shots and transitioning to TAKE_COVER
 *   - COMBAT → FLEE when morale reaches PANICKED
 *   - Monster FSM (bloodsucker) using buildChornobylMonsterHandlerMap → STALK
 *   - AIPlugin + RestrictedZoneManager for movement constraints
 *
 * Architecture:
 *   The AI package is deliberately framework-agnostic. State handlers only
 *   see INPCContext — a thin facade you implement on the game-engine side
 *   (e.g. PhaserNPCContext wraps a Phaser Entity + Arcade physics body).
 *
 *   For Node.js we provide SimpleNPCHost — a minimal in-memory implementation
 *   of the same interface. In production this is replaced by PhaserNPCContext
 *   without changing a single line inside the state handlers.
 *
 * Key design:
 *   Each frame your game loop calls:
 *     host.perception.sync(visibleEnemies, visibleAllies, nearbyItems);
 *     driver.update(deltaMs);
 *
 *   OnlineAIDriver owns the active state and calls enter/update/exit on the
 *   state handler automatically.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

// OnlineAIDriver — per-NPC FSM coordinator.
// NPCPerception — host-side snapshot; call sync() each frame before update().
// createDefaultNPCOnlineState — factory for the mutable per-NPC data bag.
// buildDefaultHandlerMap — 14-state set for human NPCs (human combat + cover + morale).
// buildChornobylMonsterHandlerMap — 18-state set with bloodsucker/boar/snork/controller abilities.
// ONLINE_STATE — canonical state ID constants (e.g. ONLINE_STATE.IDLE, ONLINE_STATE.COMBAT).
import type {
  IOnlineDriverHost,
  INPCHealth,
  ICoverAccess,
  IDangerAccess,
  IRestrictedZoneAccess,
  ISquadAccess,
  IPackAccess,
  IConditionAccess,
  ISuspicionAccess,
  IShootPayload,
  IMeleeHitPayload,
} from '@alife-sdk/ai/states';
import {
  OnlineAIDriver,
  NPCPerception,
  createDefaultNPCOnlineState,
  buildDefaultHandlerMap,
  buildChornobylMonsterHandlerMap,
  ONLINE_STATE,
} from '@alife-sdk/ai/states';

// AIPlugin — kernel plugin for CoverRegistry and RestrictedZoneManager.
import { AIPlugin } from '@alife-sdk/ai/plugin';

// RestrictionType — OUT zones block movement, IN zones confine it.
import { RestrictionType } from '@alife-sdk/ai/navigation';

import { ALifeKernel, SeededRandom } from '@alife-sdk/core';

// ---------------------------------------------------------------------------
// SimpleNPCHost — minimal IOnlineDriverHost for Node.js
//
// In a Phaser game you replace this with PhaserNPCContext which delegates to
// the game engine's physics body, health component, and animation system.
// The state handlers never import Phaser — they only see INPCContext.
// ---------------------------------------------------------------------------

class SimpleNPCHost implements IOnlineDriverHost {
  // Per-NPC mutable AI state bag — all handlers read/write this each frame.
  readonly state = createDefaultNPCOnlineState();

  // Perception snapshot — call sync() before each driver.update().
  readonly perception = new NPCPerception();

  // Identity
  readonly npcId: string;
  readonly factionId: string;
  readonly entityType: string;      // 'human' | 'bloodsucker' | 'boar' | …

  // World position (read by state handlers for movement and targeting).
  x: number;
  y: number;

  // Optional subsystems — null = "not supported for this NPC".
  // State handlers always check for null before using these.
  cover:          ICoverAccess          | null = null;
  danger:         IDangerAccess         | null = null;
  restrictedZones: IRestrictedZoneAccess | null = null;
  squad:          ISquadAccess          | null = null;
  pack:           IPackAccess           | null = null;
  conditions:     IConditionAccess      | null = null;
  suspicion:      ISuspicionAccess      | null = null;

  // Output logs — replace with engine event dispatch in production.
  readonly shoots:        IShootPayload[] = [];
  readonly vocalizations: string[]         = [];

  private _hp    = 100;
  private _maxHp = 100;
  private _nowMs = 0;

  constructor(id: string, faction: string, type: string, x = 100, y = 100) {
    this.npcId      = id;
    this.factionId  = faction;
    this.entityType = type;
    this.x          = x;
    this.y          = y;
  }

  // INPCHealth — lazily constructed each access to avoid holding a stale ref.
  get health(): INPCHealth {
    return {
      hp:        this._hp,
      maxHp:     this._maxHp,
      hpPercent: this._hp / this._maxHp,
      heal: (n: number) => { this._hp = Math.min(this._hp + n, this._maxHp); },
    };
  }

  // Movement — in Phaser these set body.velocity and body.rotation.
  setVelocity(vx: number, vy: number): void { this.x += vx * 0.016; this.y += vy * 0.016; }
  halt(): void { /* stop physics body */ }
  setRotation(_r: number): void { /* set sprite rotation */ }
  setAlpha(_a: number): void { /* set sprite alpha (bloodsucker cloak) */ }
  teleport(px: number, py: number): void { this.x = px; this.y = py; }
  disablePhysics(): void { /* disable Arcade body on death */ }

  // Event emission — in Phaser these fire into the scene's event bus.
  emitShoot(p: IShootPayload): void { this.shoots.push(p); }
  emitMeleeHit(_p: IMeleeHitPayload): void { /* apply damage to target */ }
  emitVocalization(t: string): void { this.vocalizations.push(t); }
  emitPsiAttackStart(_x: number, _y: number): void { /* play PSI attack VFX */ }

  // Utilities — now() must advance by deltaMs each frame so state timers work.
  now(): number { return this._nowMs; }
  random(): number { return 0.5; }  // deterministic; in production: return seededRandom.next()

  // Helper: advance the internal clock and run one driver frame.
  tick(driver: OnlineAIDriver, deltaMs: number): void {
    this._nowMs += deltaMs;
    driver.update(deltaMs);
  }

  setHp(hp: number): void { this._hp = Math.max(0, hp); }
}

// ---------------------------------------------------------------------------
// Step 1: Build the kernel and install AIPlugin
//
// AIPlugin provides:
//   aiPlugin.coverRegistry     — register tactical cover points
//   aiPlugin.restrictedZones   — register movement constraint zones
//   aiPlugin.createCoverAccess(npcId) — per-NPC ICoverAccess adapter
// ---------------------------------------------------------------------------

const random = new SeededRandom(42);
const aiPlugin = new AIPlugin(random);

const kernel = new ALifeKernel();
kernel.use(aiPlugin);
kernel.init();
kernel.start();

// Register cover points. In a real game these come from a Tiled map layer
// or from AIPorts.CoverPointSource which auto-populates during plugin.init().
aiPlugin.coverRegistry.addPoints([
  { x: 80,  y: 60  },   // cover_0000 — near the NPC's starting position
  { x: 200, y: 150 },   // cover_0001 — mid-field
  { x: 320, y: 80  },   // cover_0002 — near the enemy
]);

console.log(`Cover points registered: ${aiPlugin.coverRegistry.getSize()}`);
console.log('');

// ---------------------------------------------------------------------------
// PHASE 1 — Full human FSM cycle
//
// Default state durations (from createDefaultStateConfig):
//   alertDuration  = 5 000 ms — ALERT times out to PATROL if no enemy seen
//   searchDuration = 8 000 ms — SEARCH times out to IDLE if enemy stays lost
//   fireRateMs     = 1 000 ms — time between successive shots in COMBAT
//   combatRange    = 200 px   — NPC halts at this distance to engage
//
// State sequence:
//   IDLE → ALERT (enemy spotted) → COMBAT (enemy still visible) →
//   SEARCH (enemy disappears, lastKnown set) → IDLE (search timer expires)
// ---------------------------------------------------------------------------

console.log('=== PHASE 1: Human FSM cycle IDLE → ALERT → COMBAT → SEARCH → IDLE ===');
console.log('');

const wolf = new SimpleNPCHost('stalker_wolf', 'loner', 'human', 100, 100);

// buildDefaultHandlerMap() registers 14 states for human NPCs.
// Pass partial config overrides to tune timing and distances.
const humanHandlers = buildDefaultHandlerMap({
  combatRange: 300,      // engage when within 300 px (default is 400)
  fireRateMs:  800,      // fire every 800 ms (default 1 000 ms)
  alertDuration: 5_000,  // alert lasts 5 s (default)
  searchDuration: 8_000, // search lasts 8 s (default)
});

const wolfDriver = new OnlineAIDriver(wolf, humanHandlers, ONLINE_STATE.IDLE);

console.log(`  Initial state: ${wolfDriver.currentStateId}`);

// — IDLE → ALERT: enemy appears in perception
// sync(enemies, allies, nearbyItems) — called by the host's perception system each frame.
wolf.perception.sync([{ id: 'bandit_01', x: 350, y: 100, factionId: 'bandit' }], [], []);
wolf.tick(wolfDriver, 16);
console.log(`  Enemy spotted          → state: ${wolfDriver.currentStateId}`);  // ALERT

// — ALERT → COMBAT: enemy still visible on the next tick
wolf.tick(wolfDriver, 16);
console.log(`  Enemy still visible    → state: ${wolfDriver.currentStateId}`);  // COMBAT

// — COMBAT: enemy disappears (lost visual contact)
wolf.state.lastKnownEnemyX = 350;  // handlers store last position here on loss
wolf.state.lastKnownEnemyY = 100;
wolf.perception.sync([], [], []);
wolf.tick(wolfDriver, 16);
console.log(`  Enemy lost             → state: ${wolfDriver.currentStateId}`);  // SEARCH

// — SEARCH → IDLE: search timer expires (advance past searchDuration = 8 000 ms)
wolf.tick(wolfDriver, 8_100);
console.log(`  Search timed out       → state: ${wolfDriver.currentStateId}`);  // IDLE
console.log('');

// ---------------------------------------------------------------------------
// PHASE 2 — COMBAT → TAKE_COVER
//
// When the NPC is in COMBAT and the enemy is within combatRange, CombatState
// halts the NPC and checks for available cover. If cover.findCover() returns a
// point, the state transitions to TAKE_COVER and stores the target position
// in host.state.coverPointX / coverPointY.
//
// In production, host.cover = aiPlugin.createCoverAccess(npcId)
// which wraps CoverRegistry with TTL locking.
// ---------------------------------------------------------------------------

console.log('=== PHASE 2: COMBAT → TAKE_COVER ===');
console.log('');

const sniper = new SimpleNPCHost('sniper_fox', 'loner', 'human', 100, 100);

// Provide an ICoverAccess implementation for this NPC.
// In a Phaser game you use aiPlugin.createCoverAccess(npcId) which wraps the
// real CoverRegistry with TTL locking. State handlers only see the ICoverAccess
// interface, so any conforming object works — here we return a fixed point for
// clarity rather than going through the registry.
sniper.cover = {
  findCover(_x, _y, _ex, _ey, _type) {
    return { x: 80, y: 60 };   // cover_0000 — closest registered point
  },
};

// Enemy is close — within combatRange (300 px) — so CombatState will halt and look for cover.
sniper.perception.sync([{ id: 'bandit_02', x: 150, y: 100, factionId: 'bandit' }], [], []);

const sniperHandlers = buildDefaultHandlerMap({ combatRange: 300, fireRateMs: 800 });
const sniperDriver   = new OnlineAIDriver(sniper, sniperHandlers, ONLINE_STATE.COMBAT);

sniper.tick(sniperDriver, 16);
console.log(`  Enemy in range, cover available → state: ${sniperDriver.currentStateId}`);
if (sniperDriver.currentStateId === ONLINE_STATE.TAKE_COVER) {
  console.log(`  Cover destination: (${sniper.state.coverPointX}, ${sniper.state.coverPointY})`);
}
console.log('');

// ---------------------------------------------------------------------------
// PHASE 3 — COMBAT → FLEE (panicked morale)
//
// Morale lives in host.state.morale (range [-1, 1]) and moraleState:
//   'STABLE'   — normal combat
//   'SHAKEN'   — morale < retreatMoraleThreshold → RETREAT (falling back, suppressive fire)
//   'PANICKED' — morale < panicMoraleThreshold   → FLEE (full panic run)
//
// The host sets these values (e.g. after an ally is killed or HP drops low).
// CombatState reads moraleState each tick and transitions accordingly.
// ---------------------------------------------------------------------------

console.log('=== PHASE 3: COMBAT → FLEE (panicked morale) ===');
console.log('');

const scared = new SimpleNPCHost('bandit_coward', 'bandit', 'human', 100, 100);
scared.perception.sync([{ id: 'player', x: 120, y: 100, factionId: 'loner' }], [], []);

// Simulate: squad wiped out, morale collapses.
scared.state.morale      = -1.0;
scared.state.moraleState = 'PANICKED';
scared.state.lastKnownEnemyX = 120;
scared.state.lastKnownEnemyY = 100;

const scaredDriver = new OnlineAIDriver(scared, buildDefaultHandlerMap(), ONLINE_STATE.COMBAT);
scared.tick(scaredDriver, 16);
console.log(`  Morale = PANICKED → state: ${scaredDriver.currentStateId}`);  // FLEE
console.log('');

// ---------------------------------------------------------------------------
// PHASE 4 — Monster FSM: bloodsucker → STALK
//
// buildChornobylMonsterHandlerMap() registers 18 states including four
// species-specific ability states keyed to entityType:
//
//   entityType='boar'        → CHARGE (rampage dash)
//   entityType='bloodsucker' → STALK  (invisible approach + uncloak strike)
//   entityType='snork'       → LEAP   (jump attack)
//   entityType='controller'  → PSI_ATTACK (mind control channel)
//
// The MonsterCombatController checks entityType and transitions to the
// matching ability state using CHORNOBYL_ABILITY_SELECTOR.
//
// Monsters use melee, not ranged fire. meleeCooldownMs controls attack rate.
// ---------------------------------------------------------------------------

console.log('=== PHASE 4: Monster FSM — bloodsucker → STALK ===');
console.log('');

const bloodsucker = new SimpleNPCHost('bloodsucker_01', 'monster', 'bloodsucker', 200, 200);

// Bloodsucker stalks when dist > meleeRange * 2 (128 px with meleeRange = 64).
// Player is 200 px away — well beyond the stalk threshold.
bloodsucker.perception.sync([{ id: 'player', x: 400, y: 200, factionId: 'loner' }], [], []);

// Pre-expire the melee cooldown so the ability selector fires on the very first tick.
// In a real game this is unnecessary — the cooldown has naturally elapsed long before
// the NPC's first COMBAT tick. Here we force it because the NPC was just spawned and
// its clock starts at 0. (Default meleeCooldownMs = 1 000 ms; -2 000 ensures it reads
// as expired regardless of what the first deltaMs is.)
bloodsucker.state.lastMeleeMs = -2_000;

// buildChornobylMonsterHandlerMap: COMBAT handler is MonsterCombatController
// wired to CHORNOBYL_ABILITY_SELECTOR. On the first combat tick with entityType
// 'bloodsucker' and dist > meleeRange * 2, it transitions to STALK.
const monsterHandlers = buildChornobylMonsterHandlerMap({ meleeRange: 64 });
const bloodsuckerDriver = new OnlineAIDriver(bloodsucker, monsterHandlers, ONLINE_STATE.COMBAT);

bloodsucker.tick(bloodsuckerDriver, 16);
console.log(`  Bloodsucker in combat  → state: ${bloodsuckerDriver.currentStateId}`);  // STALK

// Ticking STALK state: bloodsucker approaches invisibly, then uncloaks.
// setAlpha is called by StalkState — in production drives the sprite alpha.
bloodsucker.tick(bloodsuckerDriver, 800);
console.log(`  Still stalking         → state: ${bloodsuckerDriver.currentStateId}`);
console.log('');

// ---------------------------------------------------------------------------
// PHASE 5 — RestrictedZoneManager
//
// RestrictedZones constrain NPC movement at the AI layer — no physics required.
// State handlers read ctx.restrictedZones (IRestrictedZoneAccess) to check
// whether a target position is accessible before moving there.
//
// Zone types:
//   RestrictionType.OUT    — NPC cannot enter (hard block: radiation zone, scripted boundary)
//   RestrictionType.IN     — NPC must stay inside (guard territory, lair radius)
//   RestrictionType.DANGER — soft avoidance (prefer to route around when possible)
//
// The AIPlugin owns a RestrictedZoneManager instance. Zones added here are
// also serialized with the kernel (save/load preserves active restrictions).
// ---------------------------------------------------------------------------

console.log('=== PHASE 5: RestrictedZoneManager ===');
console.log('');

// Add a radiation zone that NPCs must not enter.
aiPlugin.restrictedZones.addZone({
  id:     'rad_zone_01',
  type:   RestrictionType.OUT,
  x:      300,
  y:      300,
  radius: 80,
  active: true,
  metadata: 'anomaly',
});

console.log(`  Zones registered: ${aiPlugin.restrictedZones.getAllZones().length}`);

// accessible() checks hard constraints (IN/OUT) for a position.
// Note: the RestrictedZoneManager method is accessible(), not isAccessible().
// State handlers receive IRestrictedZoneAccess (which uses isAccessible()) —
// the host adapter below bridges the two naming conventions.
const insideRadZone   = aiPlugin.restrictedZones.accessible(300, 300);
const outsideRadZone  = aiPlugin.restrictedZones.accessible(100, 100);
console.log(`  accessible(300, 300) [inside OUT zone]:    ${insideRadZone}`);    // false
console.log(`  accessible(100, 100) [outside any zone]:   ${outsideRadZone}`);   // true

// filterAccessibleWaypoints — filter waypoints to those that pass hard constraints.
const waypoints = [
  { x: 300, y: 300 },  // inside OUT zone — filtered out
  { x: 100, y: 100 },  // outside any zone — passes
  { x: 400, y: 100 },  // outside any zone — passes
];
const reachable = aiPlugin.restrictedZones.filterAccessibleWaypoints(waypoints);
console.log(`  filterAccessibleWaypoints: ${reachable.length} of ${waypoints.length} waypoints pass`);
console.log('');

// Wire restrictedZones to a host so state handlers can check movement constraints.
// IRestrictedZoneAccess (the interface handlers see) uses isAccessible() /
// filterAccessible(). The host adapter maps these to RestrictedZoneManager's
// accessible() / filterAccessibleWaypoints() methods.
const guardedNPC = new SimpleNPCHost('military_01', 'military', 'human', 100, 100);
guardedNPC.restrictedZones = {
  isAccessible:     (x, y) => aiPlugin.restrictedZones.accessible(x, y),
  filterAccessible: (pts)  => aiPlugin.restrictedZones.filterAccessibleWaypoints(pts),
};

// Verify the wiring: the handler sees the radiation zone as inaccessible.
const canEnterRadZone = guardedNPC.restrictedZones.isAccessible(300, 300);
const canPatrolSafely = guardedNPC.restrictedZones.isAccessible(100, 100);
console.log(`  NPC can enter rad zone  (300, 300): ${canEnterRadZone}`);   // false
console.log(`  NPC can patrol safely   (100, 100): ${canPatrolSafely}`);   // true
console.log(`  (IdleState calls isAccessible() before moving to any waypoint)`);
console.log('');

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

wolfDriver.destroy();
sniperDriver.destroy();
scaredDriver.destroy();
bloodsuckerDriver.destroy();
kernel.destroy();

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('=== Summary ===');
console.log('');
console.log('Key takeaways:');
console.log('  1. Implement IOnlineDriverHost on your game-engine NPC wrapper (PhaserNPCContext).');
console.log('  2. Call perception.sync(enemies, allies, items) then driver.update(deltaMs) each frame.');
console.log('  3. buildDefaultHandlerMap()         — human NPCs (COMBAT, TAKE_COVER, morale, cover).');
console.log('  4. buildChornobylMonsterHandlerMap() — monsters with STALK/CHARGE/LEAP/PSI_ATTACK.');
console.log('     (buildMonsterHandlerMap() = same but without species-specific ability states.)');
console.log('  5. host.state.moraleState = "PANICKED" → COMBAT transitions to FLEE next tick.');
console.log('  6. host.cover (ICoverAccess) — provide an adapter; in Phaser use aiPlugin.createCoverAccess(npcId).');
console.log('  7. host.restrictedZones (IRestrictedZoneAccess) — adapts RestrictedZoneManager to the handler interface.');
console.log('  8. StateHandlerMap.register() adds custom states; .extend() merges without overwrite.');
console.log('  9. AIPlugin.restrictedZones is serialized with kernel.serialize() for save/load.');
