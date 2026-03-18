/**
 * 20-simple-duel.ts
 *
 * Grid-based arena duel -- two NPCs in a firefight with A* pathfinding,
 * wall obstacles, and cover points that require navigation around walls.
 *
 * Runs in Node.js with:
 *   npx tsx --tsconfig examples/tsconfig.json examples/20-simple-duel.ts
 *
 * What we build here:
 *   - A 30x20 tile grid arena (480x320 px) with symmetrical wall blocks
 *   - A* pathfinding via PathFinding.js so NPCs route around obstacles
 *   - PathfindingNPCHost -- extends SimpleNPCHost with waypoint-following
 *   - Cover points placed BEHIND walls, forcing multi-step A* paths
 *   - ASCII arena visualization with NPC positions every 50 ticks
 *   - Full CombatState -> TAKE_COVER cycle with morale degradation
 *
 * Architecture:
 *   CombatState / TakeCoverState call moveToward() which calls setVelocity()
 *   on the host. PathfindingNPCHost overrides setVelocity() to follow the
 *   pre-computed A* path instead of a straight line. The AI layer never knows
 *   about pathfinding -- it just sets velocity, and the host redirects movement
 *   along waypoints.
 *
 *   Each frame the game loop:
 *     1. Syncs perception -- each NPC "sees" the other
 *     2. Checks if the NPC has a new cover destination and computes A* path
 *     3. Ticks both AI drivers (state handlers decide movement, cover, fire)
 *     4. Processes shoot payloads as damage on the opposing NPC
 *     5. Updates morale based on hits taken
 *     6. Checks for death (HP <= 0)
 *     7. Every 50 ticks, prints ASCII arena with NPC positions
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

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
  ONLINE_STATE,
} from '@alife-sdk/ai/states';

import { AIPlugin } from '@alife-sdk/ai/plugin';
import { ALifeKernel, SeededRandom } from '@alife-sdk/core';

// PathFinding.js -- grid-based A* with diagonal movement and path smoothing.
// Grid must be cloned before each findPath() call (finder mutates the grid).
import PF from 'pathfinding';

// ---------------------------------------------------------------------------
// Arena constants
// ---------------------------------------------------------------------------

const GRID_W    = 30;   // tiles wide
const GRID_H    = 20;   // tiles tall
const TILE_SIZE = 16;   // pixels per tile
// Arena total: 480 x 320 px

// ---------------------------------------------------------------------------
// Arena grid -- 0 = walkable, 1 = wall
//
// Layout: two symmetrical wall blocks near each spawn (cover positions)
// plus center corridor obstacles forcing flanking routes.
//
//   ..............................
//   ..............................
//   .....#####..........#####.....
//   .....#####..........#####.....
//   .....#####..........#####.....
//   ..............................
//   ..........####..####..........
//   ..........####..####..........
//   ..............................
//   ..............................   (center gap)
//   ..............................
//   ..............................
//   ..........####..####..........
//   ..........####..####..........
//   ..............................
//   .....#####..........#####.....
//   .....#####..........#####.....
//   .....#####..........#####.....
//   ..............................
//   ..............................
// ---------------------------------------------------------------------------

function buildArenaGrid(): PF.Grid {
  const grid = new PF.Grid(GRID_W, GRID_H);

  // Helper: fill a rectangular block of walls.
  const wallBlock = (sx: number, sy: number, w: number, h: number): void => {
    for (let y = sy; y < sy + h; y++) {
      for (let x = sx; x < sx + w; x++) {
        grid.setWalkableAt(x, y, false);
      }
    }
  };

  // Top-left wall block (stalker side cover)
  wallBlock(5, 2, 5, 3);
  // Top-right wall block (bandit side cover)
  wallBlock(20, 2, 5, 3);

  // Upper center obstacles (two blocks with a 2-tile gap)
  wallBlock(10, 6, 4, 2);
  wallBlock(16, 6, 4, 2);

  // Lower center obstacles (mirror of upper)
  wallBlock(10, 12, 4, 2);
  wallBlock(16, 12, 4, 2);

  // Bottom-left wall block (stalker side cover)
  wallBlock(5, 15, 5, 3);
  // Bottom-right wall block (bandit side cover)
  wallBlock(20, 15, 5, 3);

  return grid;
}

// ---------------------------------------------------------------------------
// ASCII arena renderer
//
// Prints the grid with walls (#), cover points (C), and NPC markers.
// Stalker = S, Bandit = B, overlap = X.
// ---------------------------------------------------------------------------

interface INPCMarker {
  tileX: number;
  tileY: number;
  char: string;
}

function renderArena(
  grid: PF.Grid,
  markers: INPCMarker[],
  coverTiles: Array<{ tx: number; ty: number }>,
): void {
  const lines: string[] = [];
  for (let y = 0; y < GRID_H; y++) {
    let row = '';
    for (let x = 0; x < GRID_W; x++) {
      // Check for NPC markers first (highest priority)
      const marker = markers.find(m => m.tileX === x && m.tileY === y);
      if (marker) {
        row += marker.char;
      } else if (!grid.isWalkableAt(x, y)) {
        row += '#';
      } else if (coverTiles.some(c => c.tx === x && c.ty === y)) {
        row += 'C';
      } else {
        row += '.';
      }
    }
    lines.push(row);
  }
  console.log(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Deterministic hash for per-NPC seed derivation
// ---------------------------------------------------------------------------

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

// ---------------------------------------------------------------------------
// PathfindingNPCHost -- extends SimpleNPCHost with A* waypoint following
//
// When setVelocity() is called by a state handler (via moveToward()), this
// host follows the pre-computed A* path instead of moving in a straight line.
// The game loop calls navigateTo() to compute a new path whenever the NPC
// gets a new cover destination.
// ---------------------------------------------------------------------------

class PathfindingNPCHost implements IOnlineDriverHost {
  readonly state = createDefaultNPCOnlineState();
  readonly perception = new NPCPerception();

  readonly npcId: string;
  readonly factionId: string;
  readonly entityType: string;

  x: number;
  y: number;

  cover:           ICoverAccess          | null = null;
  danger:          IDangerAccess         | null = null;
  restrictedZones: IRestrictedZoneAccess | null = null;
  squad:           ISquadAccess          | null = null;
  pack:            IPackAccess           | null = null;
  conditions:      IConditionAccess      | null = null;
  suspicion:       ISuspicionAccess      | null = null;

  readonly shoots:        IShootPayload[] = [];
  readonly vocalizations: string[]         = [];

  // A* path state -- waypoints in pixel coordinates.
  // _path is the smoothed A* result, _pathIndex is the current waypoint.
  _path: number[][] = [];
  private _pathIndex = 0;
  private _lastTargetX = -1;
  private _lastTargetY = -1;

  private _hp    = 100;
  private _maxHp = 100;
  private _nowMs = 0;
  private readonly _rng: SeededRandom;

  constructor(id: string, faction: string, type: string, x = 100, y = 100) {
    this.npcId      = id;
    this.factionId  = faction;
    this.entityType = type;
    this.x          = x;
    this.y          = y;
    this._rng       = new SeededRandom(hashCode(id));
  }

  get health(): INPCHealth {
    return {
      hp:        this._hp,
      maxHp:     this._maxHp,
      hpPercent: this._hp / this._maxHp,
      heal: (n: number) => { this._hp = Math.min(this._hp + n, this._maxHp); },
    };
  }

  // ------ A* pathfinding integration ------

  /**
   * Compute an A* path from the NPC's current position to (tx, ty).
   * Returns true if a path was found, false if blocked.
   * The path is smoothed to remove unnecessary zigzag waypoints.
   */
  navigateTo(tx: number, ty: number, grid: PF.Grid, finder: PF.AStarFinder): boolean {
    // Convert pixel coords to tile coords (clamped to grid bounds).
    const sx = Math.max(0, Math.min(GRID_W - 1, Math.round(this.x / TILE_SIZE)));
    const sy = Math.max(0, Math.min(GRID_H - 1, Math.round(this.y / TILE_SIZE)));
    const ex = Math.max(0, Math.min(GRID_W - 1, Math.round(tx / TILE_SIZE)));
    const ey = Math.max(0, Math.min(GRID_H - 1, Math.round(ty / TILE_SIZE)));

    // Grid MUST be cloned -- AStarFinder mutates it during search.
    const path = finder.findPath(sx, sy, ex, ey, grid.clone());
    if (path.length === 0) return false;

    // Smooth the path to cut corners where line-of-sight is clear.
    this._path = PF.Util.smoothenPath(grid, path);
    this._pathIndex = 1;  // skip index 0 (current position)
    this._lastTargetX = tx;
    this._lastTargetY = ty;
    return true;
  }

  /**
   * Returns true if the NPC needs a new A* path to (tx, ty).
   * Triggers re-pathing when the target has changed or path is exhausted.
   * Does NOT re-path if the NPC is already close to the target.
   */
  needsNewPath(tx: number, ty: number): boolean {
    // Already at the destination -- no path needed.
    const toDst = (tx - this.x) * (tx - this.x) + (ty - this.y) * (ty - this.y);
    if (toDst < TILE_SIZE * TILE_SIZE) return false;

    if (this._path.length === 0) return true;
    if (this._pathIndex >= this._path.length) return true;
    // Re-path if target moved more than 1 tile away from last computed target.
    const dx = tx - this._lastTargetX;
    const dy = ty - this._lastTargetY;
    return (dx * dx + dy * dy) > TILE_SIZE * TILE_SIZE;
  }

  /** Current tile position for ASCII rendering. */
  get tileX(): number { return Math.max(0, Math.min(GRID_W - 1, Math.round(this.x / TILE_SIZE))); }
  get tileY(): number { return Math.max(0, Math.min(GRID_H - 1, Math.round(this.y / TILE_SIZE))); }

  // ------ IOnlineDriverHost: movement ------

  /**
   * Intercepts velocity from state handlers and redirects movement along the
   * A* path. If a path is active, the NPC moves toward the current waypoint
   * at the same speed the handler requested. When no path is active, falls
   * back to direct straight-line movement.
   */
  setVelocity(vx: number, vy: number): void {
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed < 0.01) return;  // no movement requested

    if (this._path.length > 0 && this._pathIndex < this._path.length) {
      // Follow A* waypoint -- convert tile coords back to pixel coords.
      const wp = this._path[this._pathIndex];
      const wpX = wp[0] * TILE_SIZE;
      const wpY = wp[1] * TILE_SIZE;
      const dx = wpX - this.x;
      const dy = wpY - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // If close enough to the current waypoint, advance to the next one.
      if (dist < TILE_SIZE * 0.5) {
        this._pathIndex++;
        if (this._pathIndex >= this._path.length) {
          // Path complete -- snap to final waypoint.
          this.x = wpX;
          this.y = wpY;
          this._path = [];
          return;
        }
        // Recurse to move toward the new waypoint this same frame.
        this.setVelocity(vx, vy);
        return;
      }

      // Move toward the current waypoint at the handler's requested speed.
      // deltaTime is baked into the speed by the handler (speed * dt already).
      const step = speed * 0.016;
      this.x += (dx / dist) * step;
      this.y += (dy / dist) * step;
    } else {
      // No A* path active -- direct movement (fallback).
      this.x += vx * 0.016;
      this.y += vy * 0.016;
    }
  }

  halt(): void { /* stop movement -- path stays active for resume */ }
  setRotation(_r: number): void { /* sprite rotation */ }
  setAlpha(_a: number): void { /* sprite alpha */ }
  teleport(px: number, py: number): void { this.x = px; this.y = py; this._path = []; }
  disablePhysics(): void { /* disable body on death */ }

  emitShoot(p: IShootPayload): void { this.shoots.push(p); }
  emitMeleeHit(_p: IMeleeHitPayload): void { /* melee damage */ }
  emitVocalization(t: string): void { this.vocalizations.push(t); }
  emitPsiAttackStart(_x: number, _y: number): void { /* psi VFX */ }

  now(): number { return this._nowMs; }
  random(): number { return this._rng.next(); }

  tick(driver: OnlineAIDriver, deltaMs: number): void {
    this._nowMs += deltaMs;
    driver.update(deltaMs);
  }

  setHp(hp: number): void { this._hp = Math.max(0, hp); }
}

// ---------------------------------------------------------------------------
// Step 1: Build the arena grid and A* finder
// ---------------------------------------------------------------------------

const pfGrid = buildArenaGrid();
const finder  = new PF.AStarFinder({
  allowDiagonal:   true,
  dontCrossCorners: true,
});

// ---------------------------------------------------------------------------
// Step 2: Define cover points
//
// Cover is placed BEHIND walls relative to the enemy side. This means an NPC
// on the opposite side MUST pathfind around the wall to reach cover -- a
// straight-line path would clip through the wall.
//
// Stalker side (left):          Bandit side (right):
//   C #####                       ##### C
//   C #####                       ##### C
//     #####                       #####
//
// Mid covers sit near the center obstacles, accessible from both sides.
// ---------------------------------------------------------------------------

// Cover point positions in pixel coordinates.
const COVER_POINTS = [
  // Stalker-side covers (left of left walls) -- tile (4, 2), (4, 3), (4, 4)
  { x: 4 * TILE_SIZE, y: 2 * TILE_SIZE },   // (64, 32)
  { x: 4 * TILE_SIZE, y: 3 * TILE_SIZE },   // (64, 48)
  { x: 4 * TILE_SIZE, y: 4 * TILE_SIZE },   // (64, 64)

  // Bandit-side covers (right of right walls) -- tile (25, 2), (25, 3), (25, 4)
  { x: 25 * TILE_SIZE, y: 2 * TILE_SIZE },  // (400, 32)
  { x: 25 * TILE_SIZE, y: 3 * TILE_SIZE },  // (400, 48)
  { x: 25 * TILE_SIZE, y: 4 * TILE_SIZE },  // (400, 64)

  // Bottom stalker-side covers -- tile (4, 15), (4, 16)
  { x: 4 * TILE_SIZE, y: 15 * TILE_SIZE },  // (64, 240)
  { x: 4 * TILE_SIZE, y: 16 * TILE_SIZE },  // (64, 256)

  // Bottom bandit-side covers -- tile (25, 15), (25, 16)
  { x: 25 * TILE_SIZE, y: 15 * TILE_SIZE }, // (400, 240)
  { x: 25 * TILE_SIZE, y: 16 * TILE_SIZE }, // (400, 256)

  // Mid covers near center obstacles -- tile (14, 9), (15, 9)
  { x: 14 * TILE_SIZE, y: 9 * TILE_SIZE },  // (224, 144)
  { x: 15 * TILE_SIZE, y: 9 * TILE_SIZE },  // (240, 144)
];

// Tile coords for ASCII rendering.
const coverTiles = COVER_POINTS.map(p => ({
  tx: Math.round(p.x / TILE_SIZE),
  ty: Math.round(p.y / TILE_SIZE),
}));

// ---------------------------------------------------------------------------
// Step 3: Print the initial arena
// ---------------------------------------------------------------------------

console.log(`Arena (${GRID_W}x${GRID_H}, tile=${TILE_SIZE}px, total=${GRID_W * TILE_SIZE}x${GRID_H * TILE_SIZE}px):`);
console.log('Legend: . = walkable, # = wall, C = cover, S = stalker, B = bandit');
console.log('');
renderArena(pfGrid, [], coverTiles);
console.log('');

// ---------------------------------------------------------------------------
// Step 4: Build the kernel and install AIPlugin
// ---------------------------------------------------------------------------

const random = new SeededRandom(42);
const aiPlugin = new AIPlugin(random);

const kernel = new ALifeKernel();
kernel.use(aiPlugin);
kernel.init();
kernel.start();

// Register cover points with AIPlugin's CoverRegistry.
aiPlugin.coverRegistry.addPoints(COVER_POINTS);
console.log(`Cover points registered: ${aiPlugin.coverRegistry.getSize()}`);
console.log('');

// ---------------------------------------------------------------------------
// Step 5: Spawn two NPCs on opposite sides of the arena
//
// Stalker starts at tile (2, 10) = pixel (32, 160) -- left side, mid height.
// Bandit starts at tile (27, 10) = pixel (432, 160) -- right side, mid height.
// Distance = 400 px, well within combatRange (500 px).
// ---------------------------------------------------------------------------

const stalker = new PathfindingNPCHost('stalker_wolf', 'loner', 'human', 2 * TILE_SIZE, 10 * TILE_SIZE);
stalker.state.primaryWeapon   = 'rifle';
stalker.state.medkitCount     = 1;
stalker.state.lastSeekCoverMs = -3_000; // pre-expire cover cooldown
stalker.cover = aiPlugin.createCoverAccess('stalker_wolf');

const bandit = new PathfindingNPCHost('bandit_knife', 'bandit', 'human', 27 * TILE_SIZE, 10 * TILE_SIZE);
bandit.state.primaryWeapon   = 'rifle';
bandit.state.medkitCount     = 1;
bandit.state.lastSeekCoverMs = -3_000;
bandit.cover = aiPlugin.createCoverAccess('bandit_knife');

console.log(`  Stalker spawn: tile (${stalker.tileX}, ${stalker.tileY}) = pixel (${stalker.x}, ${stalker.y})`);
console.log(`  Bandit  spawn: tile (${bandit.tileX}, ${bandit.tileY}) = pixel (${bandit.x}, ${bandit.y})`);
console.log('');

// ---------------------------------------------------------------------------
// Step 6: Create FSM drivers
//
// buildDefaultHandlerMap() registers 14 states for human NPCs.
// combatRange is wide (500 px) so both NPCs engage immediately across the
// arena. fireRateMs = 800 gives a decent pace to the firefight.
// ---------------------------------------------------------------------------

const humanHandlers = buildDefaultHandlerMap({
  combatRange: 500,
  fireRateMs:  600,            // faster shooting for dynamic fights
  loopholeWaitMinMs: 800,      // shorter pause behind cover (default 1500)
  loopholeWaitMaxMs: 1200,     // (default 3000)
  loopholeFireDurationMs: 800, // longer fire window (default 1200 but we want more shots)
});

const stalkerDriver = new OnlineAIDriver(stalker, humanHandlers, ONLINE_STATE.IDLE);
const banditDriver  = new OnlineAIDriver(bandit,  humanHandlers, ONLINE_STATE.IDLE);

console.log(`  Stalker initial state: ${stalkerDriver.currentStateId}`);
console.log(`  Bandit  initial state: ${banditDriver.currentStateId}`);
console.log('');

// ---------------------------------------------------------------------------
// Step 7: Game loop -- up to 600 ticks at 16 ms (~60 FPS for 9.6 seconds)
//
// Each frame:
//   1. Sync perception -- each NPC "sees" the other
//   2. Check for new cover destinations and compute A* paths
//   3. Tick both AI drivers -- state handlers decide movement, cover, fire
//   4. Process shoot payloads -- apply damage to the opposing NPC
//   5. Update morale -- degrade per hit
//   6. Check for death
//   7. Every 50 ticks, print ASCII arena with positions
// ---------------------------------------------------------------------------

console.log('=== Arena Duel: stalker_wolf vs bandit_knife ===');
console.log('  Walls force A* pathfinding around obstacles to reach cover.');
console.log('');

const DAMAGE_PER_HIT = 18;    // higher damage for faster resolution
const MORALE_HIT     = 0.08;  // morale drops faster
const TICKS          = 600;
const DELTA_MS       = 16;

let prevStalkerState = stalkerDriver.currentStateId;
let prevBanditState  = banditDriver.currentStateId;
let winner: string | null = null;

/**
 * Check if an NPC has a new cover destination and compute an A* path.
 * This bridges the AI layer (which sets coverPointX/Y) with the pathfinding
 * layer (which computes the route around walls).
 */
function updatePathfinding(npc: PathfindingNPCHost, label: string): void {
  const cpx = npc.state.coverPointX;
  const cpy = npc.state.coverPointY;

  // coverPointX/Y = 0 means no cover target; NaN means cover search failed.
  if (cpx === 0 && cpy === 0) return;
  if (Number.isNaN(cpx) || Number.isNaN(cpy)) return;

  if (npc.needsNewPath(cpx, cpy)) {
    const ok = npc.navigateTo(cpx, cpy, pfGrid, finder);
    if (ok) {
      console.log(
        `  [PATH] ${label} -> cover at (${cpx.toFixed(0)}, ${cpy.toFixed(0)}), ` +
        `${npc._path.length} waypoints`,
      );
    } else {
      console.log(`  [PATH] ${label} -> NO PATH to (${cpx.toFixed(0)}, ${cpy.toFixed(0)})!`);
    }
  }
}

for (let tick = 1; tick <= TICKS; tick++) {
  // --- 1. Perception sync ---
  stalker.perception.sync(
    [{ id: bandit.npcId, x: bandit.x, y: bandit.y, factionId: 'bandit' }],
    [],
    [],
  );
  bandit.perception.sync(
    [{ id: stalker.npcId, x: stalker.x, y: stalker.y, factionId: 'loner' }],
    [],
    [],
  );

  // --- 2. Compute A* paths for new cover destinations ---
  updatePathfinding(stalker, 'Stalker');
  updatePathfinding(bandit, 'Bandit');

  // --- 3. Tick AI drivers ---
  stalker.tick(stalkerDriver, DELTA_MS);
  bandit.tick(banditDriver, DELTA_MS);

  // --- Log state transitions ---
  if (stalkerDriver.currentStateId !== prevStalkerState) {
    console.log(`  [FSM] Stalker: ${prevStalkerState} -> ${stalkerDriver.currentStateId}`);
    prevStalkerState = stalkerDriver.currentStateId;
  }
  if (banditDriver.currentStateId !== prevBanditState) {
    console.log(`  [FSM] Bandit:  ${prevBanditState} -> ${banditDriver.currentStateId}`);
    prevBanditState = banditDriver.currentStateId;
  }

  // --- 4. Process shoots ---
  for (const _shot of stalker.shoots) {
    bandit.setHp(bandit.health.hp - DAMAGE_PER_HIT);
    bandit.state.morale -= MORALE_HIT;
    console.log(
      `  [t=${tick}] Stalker fires -> Bandit takes ${DAMAGE_PER_HIT} dmg ` +
      `(HP: ${bandit.health.hp}, morale: ${bandit.state.morale.toFixed(2)})`,
    );
  }
  for (const _shot of bandit.shoots) {
    stalker.setHp(stalker.health.hp - DAMAGE_PER_HIT);
    stalker.state.morale -= MORALE_HIT;
    console.log(
      `  [t=${tick}] Bandit fires  -> Stalker takes ${DAMAGE_PER_HIT} dmg ` +
      `(HP: ${stalker.health.hp}, morale: ${stalker.state.morale.toFixed(2)})`,
    );
  }

  stalker.shoots.length = 0;
  bandit.shoots.length  = 0;

  // --- 5. Update morale states ---
  if (stalker.state.morale < -0.7)      stalker.state.moraleState = 'PANICKED';
  else if (stalker.state.morale < -0.3) stalker.state.moraleState = 'SHAKEN';

  if (bandit.state.morale < -0.7)       bandit.state.moraleState = 'PANICKED';
  else if (bandit.state.morale < -0.3)  bandit.state.moraleState = 'SHAKEN';

  // --- 6. Death check ---
  if (stalker.health.hp <= 0) {
    console.log(`\n  [t=${tick}] *** Stalker is down! Bandit wins. ***`);
    winner = 'bandit_knife';
    stalkerDriver.destroy();
    break;
  }
  if (bandit.health.hp <= 0) {
    console.log(`\n  [t=${tick}] *** Bandit is down! Stalker wins. ***`);
    winner = 'stalker_wolf';
    banditDriver.destroy();
    break;
  }

  // --- 7. ASCII arena every 50 ticks ---
  if (tick % 50 === 0) {
    console.log('');
    console.log(`  --- Arena at tick ${tick} ---`);
    console.log(
      `  Stalker: state=${stalkerDriver.currentStateId} ` +
      `HP=${stalker.health.hp} morale=${stalker.state.morale.toFixed(2)} ` +
      `tile=(${stalker.tileX}, ${stalker.tileY})`,
    );
    console.log(
      `  Bandit:  state=${banditDriver.currentStateId} ` +
      `HP=${bandit.health.hp} morale=${bandit.state.morale.toFixed(2)} ` +
      `tile=(${bandit.tileX}, ${bandit.tileY})`,
    );

    // Build NPC markers for the ASCII grid.
    const markers: INPCMarker[] = [];
    const sTile = { x: stalker.tileX, y: stalker.tileY };
    const bTile = { x: bandit.tileX, y: bandit.tileY };

    // If both NPCs are on the same tile, show 'X'.
    if (sTile.x === bTile.x && sTile.y === bTile.y) {
      markers.push({ tileX: sTile.x, tileY: sTile.y, char: 'X' });
    } else {
      markers.push({ tileX: sTile.x, tileY: sTile.y, char: 'S' });
      markers.push({ tileX: bTile.x, tileY: bTile.y, char: 'B' });
    }

    renderArena(pfGrid, markers, coverTiles);
    console.log('');
  }

  // --- Periodic text summary every 20 ticks (between arena prints) ---
  if (tick % 20 === 0 && tick % 50 !== 0) {
    console.log(
      `  [t=${tick}] Stalker: state=${stalkerDriver.currentStateId} ` +
      `HP=${stalker.health.hp} pos=(${stalker.x.toFixed(0)}, ${stalker.y.toFixed(0)}) ` +
      `path=${stalker._path.length > 0 ? stalker._path.length + 'wp' : 'none'}`,
    );
    console.log(
      `  [t=${tick}] Bandit:  state=${banditDriver.currentStateId} ` +
      `HP=${bandit.health.hp} pos=(${bandit.x.toFixed(0)}, ${bandit.y.toFixed(0)}) ` +
      `path=${bandit._path.length > 0 ? bandit._path.length + 'wp' : 'none'}`,
    );
  }
}

console.log('');

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

if (winner !== 'stalker_wolf') stalkerDriver.destroy();
if (winner !== 'bandit_knife') banditDriver.destroy();
kernel.destroy();

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('=== Summary ===');
console.log('');
console.log(`  Winner: ${winner ?? 'draw (both retreated or time ran out)'}`);
console.log(`  Stalker final HP: ${stalker.health.hp}`);
console.log(`  Bandit  final HP: ${bandit.health.hp}`);
console.log('');
console.log('Key takeaways:');
console.log('  1. PathFinding.js provides grid-based A* with diagonal movement and path smoothing.');
console.log('  2. PathfindingNPCHost intercepts setVelocity() to follow A* waypoints around walls.');
console.log('  3. Cover points are placed BEHIND walls -- NPCs must pathfind around obstacles.');
console.log('  4. The AI layer (CombatState, TakeCoverState) never knows about pathfinding.');
console.log('  5. navigateTo() computes a smoothed A* path; setVelocity() follows it per-frame.');
console.log('  6. Grid must be cloned before each findPath() call (finder mutates the grid).');
console.log('  7. Same morale/damage/cover system as the original duel -- pathfinding is additive.');
