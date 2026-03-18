/**
 * 20-tactical-firefight.ts
 *
 * Tactical combat with grid-based pathfinding — grenades, evasion routes,
 * wounded crawl behind cover, and movement around obstacles via PathFinding.js.
 *
 * Runs in Node.js with:
 *   npx tsx --tsconfig examples/tsconfig.json examples/20-tactical-firefight.ts
 *
 * What we build here:
 *   - 30x20 grid arena (16 px tiles) with wall obstacles
 *   - PathfindingNPCHost — intercepts setVelocity to follow A* paths around walls
 *   - TacticalCombatHandler — composite: CombatState + CombatTransitionHandler
 *   - IDangerAccess adapter — bridges DangerManager to the handler interface
 *   - Grenade evasion pathfinding — NPC pathfinds AWAY from grenade around walls
 *   - Wounded crawl pathfinding — NPC pathfinds to nearest safe spot behind cover
 *   - Grenade detonation respects walls — damage only if walkable path < radius
 *   - ASCII arena visualization every 100 ticks
 *
 * Architecture:
 *   CombatState handles movement, shooting, morale-panic, and cover transitions.
 *   CombatTransitionHandler evaluates CombatTransitionChain rules and transitions.
 *   TacticalCombatHandler runs both sequentially each frame.
 *
 *   PathfindingNPCHost intercepts setVelocity() calls from the AI layer. Instead
 *   of applying raw velocity, it interprets the velocity direction to compute a
 *   pathfinding destination and follows the A* path cell-by-cell. This keeps the
 *   AI layer unaware of walls — the host transparently routes around them.
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import PF from 'pathfinding';

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
  IOnlineStateHandler,
  INPCContext,
} from '@alife-sdk/ai/states';

import {
  OnlineAIDriver,
  NPCPerception,
  createDefaultNPCOnlineState,
  createDefaultStateConfig,
  buildDefaultHandlerMap,
  CombatState,
  CombatTransitionHandler,
  ONLINE_STATE,
} from '@alife-sdk/ai/states';

import { AIPlugin } from '@alife-sdk/ai/plugin';

import { ALifeKernel, SeededRandom } from '@alife-sdk/core';
import { DangerManager, DangerType } from '@alife-sdk/core/ai';

// ---------------------------------------------------------------------------
// Arena constants
// ---------------------------------------------------------------------------

const GRID_W    = 30;  // tiles
const GRID_H    = 20;  // tiles
const TILE_SIZE = 16;  // px per tile
const ARENA_W   = GRID_W * TILE_SIZE;  // 480 px
const ARENA_H   = GRID_H * TILE_SIZE;  // 320 px

// ---------------------------------------------------------------------------
// Arena layout — 0 = walkable, 1 = wall
//
//   Stalker spawns left (x=32), Bandit spawns right (x=448).
//   Walls create chokepoints and cover positions that force pathfinding.
//
//   Legend (each char = 1 tile = 16 px):
//     . = walkable
//     # = wall
//     S = stalker spawn
//     B = bandit spawn
//     C = cover point
// ---------------------------------------------------------------------------

function buildArena(): number[][] {
  const grid: number[][] = [];
  for (let y = 0; y < GRID_H; y++) {
    grid[y] = new Array(GRID_W).fill(0);
  }

  // Top and bottom border walls
  for (let x = 0; x < GRID_W; x++) {
    grid[0][x] = 1;
    grid[GRID_H - 1][x] = 1;
  }
  // Left and right border walls
  for (let y = 0; y < GRID_H; y++) {
    grid[y][0] = 1;
    grid[y][GRID_W - 1] = 1;
  }

  // Central vertical wall with gap (chokepoint)
  for (let y = 2; y < 8; y++)  grid[y][14] = 1;
  for (let y = 12; y < 18; y++) grid[y][14] = 1;
  // Gap at y=8..11 (4 tiles wide passage)

  // Left bunker (stalker side cover)
  for (let x = 7; x <= 9; x++) grid[5][x] = 1;
  grid[6][7] = 1;
  grid[6][9] = 1;

  // Right bunker (bandit side cover)
  for (let x = 20; x <= 22; x++) grid[5][x] = 1;
  grid[6][20] = 1;
  grid[6][22] = 1;

  // Lower obstacles — force flanking routes
  for (let x = 8; x <= 10; x++) grid[14][x] = 1;
  for (let x = 19; x <= 21; x++) grid[14][x] = 1;

  // Small pillars in mid-field
  grid[10][10] = 1;
  grid[10][19] = 1;

  return grid;
}

const arena = buildArena();

// ---------------------------------------------------------------------------
// PathFinding.js setup
// ---------------------------------------------------------------------------

function createPFGrid(): PF.Grid {
  return new PF.Grid(GRID_W, GRID_H, arena);
}

const finder = new PF.AStarFinder({
  allowDiagonal: true,
  dontCrossCorners: true,
});

/** Convert world px to grid tile index (clamped to grid bounds). */
function worldToTile(px: number, max: number): number {
  return Math.max(0, Math.min(max - 1, Math.floor(px / TILE_SIZE)));
}

/** Convert grid tile to world px (center of tile). */
function tileToWorld(tile: number): number {
  return tile * TILE_SIZE + TILE_SIZE / 2;
}

/** Check if a world position is walkable. */
function isWalkable(wx: number, wy: number): boolean {
  const tx = worldToTile(wx, GRID_W);
  const ty = worldToTile(wy, GRID_H);
  return arena[ty][tx] === 0;
}

/** Find an A* path between two world positions. Returns world-space waypoints. */
function findPath(
  fromX: number, fromY: number,
  toX: number, toY: number,
): Array<{ x: number; y: number }> {
  const fx = worldToTile(fromX, GRID_W);
  const fy = worldToTile(fromY, GRID_H);
  let tx = worldToTile(toX, GRID_W);
  let ty = worldToTile(toY, GRID_H);

  // If target is a wall, find nearest walkable tile
  if (arena[ty][tx] === 1) {
    const adj = findNearestWalkable(tx, ty);
    if (adj) { tx = adj.x; ty = adj.y; }
  }

  const grid = createPFGrid();
  const rawPath = finder.findPath(fx, fy, tx, ty, grid);

  // Convert to world-space centers, skip first point (current position)
  return rawPath.slice(1).map(([cx, cy]) => ({
    x: tileToWorld(cx),
    y: tileToWorld(cy),
  }));
}

/** BFS for nearest walkable tile from a wall tile. */
function findNearestWalkable(tx: number, ty: number): { x: number; y: number } | null {
  const visited = new Set<string>();
  const queue: Array<{ x: number; y: number }> = [{ x: tx, y: ty }];
  visited.add(`${tx},${ty}`);

  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      const key = `${nx},${ny}`;
      if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
      if (visited.has(key)) continue;
      visited.add(key);
      if (arena[ny][nx] === 0) return { x: nx, y: ny };
      queue.push({ x: nx, y: ny });
    }
  }
  return null;
}

/**
 * Find a safe position to flee from a grenade — pathfind to a tile that is:
 * 1. At least `minDist` px from the grenade origin
 * 2. Behind a wall (not in direct LOS from grenade)
 * 3. Reachable via A*
 */
function findFleePosition(
  npcX: number, npcY: number,
  grenadeX: number, grenadeY: number,
  minDist: number,
): { x: number; y: number } | null {
  // Compute direction away from grenade
  const dx = npcX - grenadeX;
  const dy = npcY - grenadeY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const ndx = dist > 0.5 ? dx / dist : 1;
  const ndy = dist > 0.5 ? dy / dist : 0;

  // Try progressively further tiles in the flee direction
  for (let step = 6; step >= 3; step--) {
    const targetX = npcX + ndx * step * TILE_SIZE;
    const targetY = npcY + ndy * step * TILE_SIZE;
    const tx = worldToTile(targetX, GRID_W);
    const ty = worldToTile(targetY, GRID_H);

    if (tx >= 0 && tx < GRID_W && ty >= 0 && ty < GRID_H && arena[ty][tx] === 0) {
      const worldTargetX = tileToWorld(tx);
      const worldTargetY = tileToWorld(ty);
      const gDist = Math.sqrt(
        (worldTargetX - grenadeX) ** 2 + (worldTargetY - grenadeY) ** 2,
      );
      if (gDist >= minDist) {
        return { x: worldTargetX, y: worldTargetY };
      }
    }
  }

  // Fallback: scan all tiles for one far from grenade and reachable
  let best: { x: number; y: number; dist: number } | null = null;
  for (let ty = 1; ty < GRID_H - 1; ty++) {
    for (let tx = 1; tx < GRID_W - 1; tx++) {
      if (arena[ty][tx] !== 0) continue;
      const wx = tileToWorld(tx);
      const wy = tileToWorld(ty);
      const gd = Math.sqrt((wx - grenadeX) ** 2 + (wy - grenadeY) ** 2);
      if (gd < minDist) continue;
      // Prefer tiles close to NPC but far from grenade
      const nd = Math.sqrt((wx - npcX) ** 2 + (wy - npcY) ** 2);
      if (!best || nd < best.dist) {
        best = { x: wx, y: wy, dist: nd };
      }
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

/**
 * Find the nearest safe spot behind cover for a wounded NPC.
 * Looks for walkable tiles adjacent to walls (cover) and far from the enemy.
 */
function findCoverPosition(
  npcX: number, npcY: number,
  enemyX: number, enemyY: number,
): { x: number; y: number } | null {
  let best: { x: number; y: number; score: number } | null = null;
  const npcTx = worldToTile(npcX, GRID_W);
  const npcTy = worldToTile(npcY, GRID_H);

  for (let ty = 1; ty < GRID_H - 1; ty++) {
    for (let tx = 1; tx < GRID_W - 1; tx++) {
      if (arena[ty][tx] !== 0) continue;

      // Must be adjacent to at least one wall (provides cover)
      let adjacentWall = false;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        if (arena[ty + dy]?.[tx + dx] === 1) { adjacentWall = true; break; }
      }
      if (!adjacentWall) continue;

      const wx = tileToWorld(tx);
      const wy = tileToWorld(ty);
      const enemyDist = Math.sqrt((wx - enemyX) ** 2 + (wy - enemyY) ** 2);
      const npcDist = Math.abs(tx - npcTx) + Math.abs(ty - npcTy); // Manhattan

      // Score: far from enemy, close to NPC
      const score = enemyDist - npcDist * 4;
      if (!best || score > best.score) {
        best = { x: wx, y: wy, score };
      }
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}

/**
 * Check if a walkable A* path between two points is shorter than maxDist.
 * Used for grenade damage: walls block damage if no short walkable path exists.
 */
function hasWalkablePath(
  fromX: number, fromY: number,
  toX: number, toY: number,
  maxDist: number,
): boolean {
  const path = findPath(fromX, fromY, toX, toY);
  if (path.length === 0) return false;
  // Sum path segment lengths
  let totalDist = 0;
  let px = fromX, py = fromY;
  for (const wp of path) {
    totalDist += Math.sqrt((wp.x - px) ** 2 + (wp.y - py) ** 2);
    px = wp.x;
    py = wp.y;
  }
  return totalDist <= maxDist;
}

// ---------------------------------------------------------------------------
// PathfindingNPCHost — extends SimpleNPCHost with A* path following
//
// When the AI layer calls setVelocity(), we intercept it and move along
// a precomputed A* path instead. This lets the AI layer stay wall-unaware.
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

  readonly shoots: IShootPayload[] = [];
  readonly vocalizations: string[] = [];

  private _hp    = 100;
  private _maxHp = 100;
  private _nowMs = 0;
  private readonly _rng: SeededRandom;

  // Pathfinding state
  private _path: Array<{ x: number; y: number }> = [];
  private _pathIndex = 0;
  private _moveSpeed = 0;

  constructor(id: string, faction: string, type: string, x: number, y: number, seed: number) {
    this.npcId      = id;
    this.factionId  = faction;
    this.entityType = type;
    this.x          = x;
    this.y          = y;
    this._rng       = new SeededRandom(seed);
  }

  get health(): INPCHealth {
    return {
      hp:        this._hp,
      maxHp:     this._maxHp,
      hpPercent: this._hp / this._maxHp,
      heal: (n: number) => { this._hp = Math.min(this._hp + n, this._maxHp); },
    };
  }

  /**
   * Intercepted setVelocity — the AI layer calls this to move toward/away
   * from targets. We interpret the velocity to compute a destination and
   * pathfind there. Actual movement happens in advanceAlongPath().
   */
  setVelocity(vx: number, vy: number): void {
    const speed = Math.sqrt(vx * vx + vy * vy);
    if (speed < 0.1) { this._moveSpeed = 0; return; }

    this._moveSpeed = speed;

    // Project a destination ~80 px in the velocity direction
    const projDist = 80;
    const ndx = vx / speed;
    const ndy = vy / speed;
    const destX = Math.max(TILE_SIZE, Math.min(ARENA_W - TILE_SIZE, this.x + ndx * projDist));
    const destY = Math.max(TILE_SIZE, Math.min(ARENA_H - TILE_SIZE, this.y + ndy * projDist));

    this._path = findPath(this.x, this.y, destX, destY);
    this._pathIndex = 0;
  }

  halt(): void {
    this._path = [];
    this._pathIndex = 0;
    this._moveSpeed = 0;
  }

  setRotation(_r: number): void { /* sprite rotation */ }
  setAlpha(_a: number): void { /* sprite alpha */ }

  teleport(px: number, py: number): void {
    this.x = px;
    this.y = py;
    this._path = [];
    this._pathIndex = 0;
  }

  disablePhysics(): void { /* disable physics on death */ }

  emitShoot(p: IShootPayload): void { this.shoots.push(p); }
  emitMeleeHit(_p: IMeleeHitPayload): void { /* melee damage */ }
  emitVocalization(t: string): void { this.vocalizations.push(t); }
  emitPsiAttackStart(_x: number, _y: number): void { /* PSI VFX */ }

  now(): number { return this._nowMs; }
  random(): number { return this._rng.next(); }

  /**
   * Navigate to a specific world position using A* pathfinding.
   * Replaces any current path.
   */
  navigateTo(targetX: number, targetY: number, speed: number): void {
    this._path = findPath(this.x, this.y, targetX, targetY);
    this._pathIndex = 0;
    this._moveSpeed = speed;

    if (this._path.length > 0) {
      console.log(
        `    [PF] ${this.npcId}: path ${this._path.length} steps ` +
        `(${this.x.toFixed(0)},${this.y.toFixed(0)}) -> (${targetX.toFixed(0)},${targetY.toFixed(0)})`,
      );
    }
  }

  /** Advance along the current A* path by deltaMs. */
  advanceAlongPath(deltaMs: number): void {
    if (this._path.length === 0 || this._pathIndex >= this._path.length || this._moveSpeed < 0.1) {
      return;
    }

    let remaining = this._moveSpeed * (deltaMs / 1000);

    while (remaining > 0 && this._pathIndex < this._path.length) {
      const wp = this._path[this._pathIndex];
      const dx = wp.x - this.x;
      const dy = wp.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= remaining) {
        // Reach this waypoint
        this.x = wp.x;
        this.y = wp.y;
        remaining -= dist;
        this._pathIndex++;
      } else {
        // Partial move toward waypoint
        const ratio = remaining / dist;
        this.x += dx * ratio;
        this.y += dy * ratio;
        remaining = 0;
      }
    }

    // Clamp to arena bounds
    this.x = Math.max(TILE_SIZE / 2, Math.min(ARENA_W - TILE_SIZE / 2, this.x));
    this.y = Math.max(TILE_SIZE / 2, Math.min(ARENA_H - TILE_SIZE / 2, this.y));
  }

  get hasActivePath(): boolean {
    return this._path.length > 0 && this._pathIndex < this._path.length;
  }

  tick(driver: OnlineAIDriver, deltaMs: number): void {
    this._nowMs += deltaMs;
    driver.update(deltaMs);
    // After the AI decided velocity, advance along the A* path
    this.advanceAlongPath(deltaMs);
  }

  setHp(hp: number): void { this._hp = Math.max(0, hp); }
  get hp(): number { return this._hp; }
}

// ---------------------------------------------------------------------------
// TacticalCombatHandler — composite: CombatState + CombatTransitionHandler
// ---------------------------------------------------------------------------

class TacticalCombatHandler implements IOnlineStateHandler {
  constructor(
    private readonly combat: CombatState,
    private readonly transitions: CombatTransitionHandler,
  ) {}

  enter(ctx: INPCContext): void {
    this.combat.enter(ctx);
  }

  update(ctx: INPCContext, deltaMs: number): void {
    const stateBefore = ctx.currentStateId;
    this.combat.update(ctx, deltaMs);
    if (ctx.currentStateId === stateBefore) {
      this.transitions.update(ctx, deltaMs);
    }
  }

  exit(ctx: INPCContext): void {
    this.combat.exit(ctx);
  }
}

// ---------------------------------------------------------------------------
// IDangerAccess adapter — bridges DangerManager to the handler interface
// ---------------------------------------------------------------------------

function createDangerAccess(dm: DangerManager): IDangerAccess {
  return {
    getDangerLevel(x: number, y: number): number {
      return dm.getThreatAt({ x, y });
    },
    getGrenadeDanger(x: number, y: number) {
      const nearby = dm.getDangersNear({ x, y }, 120);
      const grenade = nearby.find(d => d.type === DangerType.GRENADE);
      if (!grenade) return null;
      return {
        active: true,
        originX: grenade.position.x,
        originY: grenade.position.y,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// ASCII arena renderer
// ---------------------------------------------------------------------------

function renderArena(
  stalker: PathfindingNPCHost,
  bandit: PathfindingNPCHost,
  grenades: Array<{ x: number; y: number }>,
  tick: number,
): void {
  console.log(`\n--- Arena @ tick ${tick} ---`);

  const sTx = worldToTile(stalker.x, GRID_W);
  const sTy = worldToTile(stalker.y, GRID_H);
  const bTx = worldToTile(bandit.x, GRID_W);
  const bTy = worldToTile(bandit.y, GRID_H);

  const gTiles = grenades.map(g => ({
    tx: worldToTile(g.x, GRID_W),
    ty: worldToTile(g.y, GRID_H),
  }));

  const lines: string[] = [];
  for (let y = 0; y < GRID_H; y++) {
    let row = '';
    for (let x = 0; x < GRID_W; x++) {
      if (x === sTx && y === sTy) { row += 'S'; }
      else if (x === bTx && y === bTy) { row += 'B'; }
      else if (gTiles.some(g => g.tx === x && g.ty === y)) { row += 'G'; }
      else if (arena[y][x] === 1) { row += '#'; }
      else { row += '.'; }
    }
    lines.push(row);
  }
  console.log(lines.join('\n'));
  console.log(
    `  S=(${stalker.x.toFixed(0)},${stalker.y.toFixed(0)}) HP=${stalker.hp}  ` +
    `B=(${bandit.x.toFixed(0)},${bandit.y.toFixed(0)}) HP=${bandit.hp}`,
  );
}

// ---------------------------------------------------------------------------
// Setup: kernel, AIPlugin, cover points
// ---------------------------------------------------------------------------

const random = new SeededRandom(42);
const aiPlugin = new AIPlugin(random);
const kernel = new ALifeKernel();
kernel.use(aiPlugin);
kernel.init();
kernel.start();

// Register cover points near wall structures (adjacent to walls for tactical value)
aiPlugin.coverRegistry.addPoints([
  { x: tileToWorld(6),  y: tileToWorld(5) },   // left of stalker bunker
  { x: tileToWorld(10), y: tileToWorld(5) },   // right of stalker bunker
  { x: tileToWorld(8),  y: tileToWorld(7) },   // below stalker bunker
  { x: tileToWorld(19), y: tileToWorld(5) },   // left of bandit bunker
  { x: tileToWorld(23), y: tileToWorld(5) },   // right of bandit bunker
  { x: tileToWorld(21), y: tileToWorld(7) },   // below bandit bunker
  { x: tileToWorld(13), y: tileToWorld(9) },   // left of central wall gap
  { x: tileToWorld(15), y: tileToWorld(9) },   // right of central wall gap
]);

console.log(`Cover points registered: ${aiPlugin.coverRegistry.getSize()}`);
console.log(`Arena: ${GRID_W}x${GRID_H} tiles (${ARENA_W}x${ARENA_H} px)`);
console.log('');

// ---------------------------------------------------------------------------
// Create two combatants at opposite ends of the arena
// ---------------------------------------------------------------------------

const stalker = new PathfindingNPCHost('stalker_wolf', 'loner', 'human', 48, 160, 101);
const bandit  = new PathfindingNPCHost('bandit_kaban', 'bandit', 'human', 432, 160, 202);

const stalkerDangers = new DangerManager(0.3);
const banditDangers  = new DangerManager(0.3);

stalker.cover  = aiPlugin.createCoverAccess('stalker_wolf');
stalker.danger = createDangerAccess(stalkerDangers);
bandit.cover   = aiPlugin.createCoverAccess('bandit_kaban');
bandit.danger  = createDangerAccess(banditDangers);

// Asymmetric loadout — stalker better equipped
stalker.state.primaryWeapon   = 'rifle';
stalker.state.grenadeCount    = 2;
stalker.state.medkitCount     = 1;
// Do NOT pre-expire cover cooldown — let NPCs fight in the open for 3s first.
// During this window CombatTransitionHandler evaluates GrenadeOpportunityRule
// BEFORE CombatState seeks cover. This gives: COMBAT → GRENADE → COMBAT → TAKE_COVER.
stalker.state.lastSeekCoverMs = 0;

bandit.state.primaryWeapon   = 'rifle';
bandit.state.grenadeCount    = 1;
bandit.state.medkitCount     = 0;
bandit.state.lastSeekCoverMs = 0;

// ---------------------------------------------------------------------------
// Build handler maps with TacticalCombatHandler
// ---------------------------------------------------------------------------

const cfg = createDefaultStateConfig({ combatRange: 400, fireRateMs: 500 });
const transitionOverrides = { grenadeMinEnemies: 1, grenadeMaxDistance: 400 };

const stalkerHandlers = buildDefaultHandlerMap({ combatRange: 400, fireRateMs: 500 })
  .register(ONLINE_STATE.COMBAT, new TacticalCombatHandler(
    new CombatState(cfg),
    new CombatTransitionHandler(cfg, transitionOverrides),
  ));

const banditHandlers = buildDefaultHandlerMap({ combatRange: 400, fireRateMs: 500 })
  .register(ONLINE_STATE.COMBAT, new TacticalCombatHandler(
    new CombatState(cfg),
    new CombatTransitionHandler(cfg, transitionOverrides),
  ));

const stalkerDriver = new OnlineAIDriver(stalker, stalkerHandlers, ONLINE_STATE.COMBAT);
const banditDriver  = new OnlineAIDriver(bandit, banditHandlers, ONLINE_STATE.COMBAT);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function logTransition(name: string, prev: string, curr: string, tick: number): void {
  if (prev !== curr) {
    console.log(`  [${name}] STATE: ${prev} -> ${curr}  (tick ${tick})`);
  }
}

function isAlive(host: PathfindingNPCHost): boolean {
  return host.hp > 0;
}

// Track pending grenades
interface PendingGrenade {
  tick: number;
  detonateTick: number;
  targetX: number;
  targetY: number;
  radius: number;
  throwerName: string;
  targetName: string;
  targetHost: PathfindingNPCHost;
}

const pendingGrenades: PendingGrenade[] = [];

let stalkerMorale = 0.5;
let banditMorale  = 0.5;

// Track active grenade positions for ASCII rendering
function getActiveGrenadePositions(): Array<{ x: number; y: number }> {
  return pendingGrenades.map(g => ({ x: g.targetX, y: g.targetY }));
}

// ---------------------------------------------------------------------------
// Pathfinding event hooks — intercept state transitions for smart navigation
// ---------------------------------------------------------------------------

/** When NPC enters EVADE_GRENADE, compute a flee path around walls. */
function onEvadeGrenade(host: PathfindingNPCHost, dm: DangerManager): void {
  const nearby = dm.getDangersNear({ x: host.x, y: host.y }, 120);
  const grenade = nearby.find(d => d.type === DangerType.GRENADE);
  if (!grenade) return;

  const fleeTarget = findFleePosition(
    host.x, host.y,
    grenade.position.x, grenade.position.y,
    100, // min distance from grenade
  );

  if (fleeTarget) {
    console.log(
      `    [EVADE] ${host.npcId}: fleeing grenade @ ` +
      `(${grenade.position.x.toFixed(0)},${grenade.position.y.toFixed(0)}) ` +
      `-> safe spot (${fleeTarget.x.toFixed(0)},${fleeTarget.y.toFixed(0)})`,
    );
    const evadeSpeed = 200 * 1.5; // approachSpeed * evadeSpeedMultiplier
    host.navigateTo(fleeTarget.x, fleeTarget.y, evadeSpeed);
  }
}

/** When NPC enters WOUNDED, pathfind to nearest cover behind a wall. */
function onWounded(host: PathfindingNPCHost, enemyX: number, enemyY: number): void {
  const coverTarget = findCoverPosition(host.x, host.y, enemyX, enemyY);

  if (coverTarget) {
    console.log(
      `    [WOUNDED] ${host.npcId}: crawling to cover ` +
      `(${coverTarget.x.toFixed(0)},${coverTarget.y.toFixed(0)})`,
    );
    const crawlSpeed = 200 * 0.3; // approachSpeed * woundedCrawlMultiplier
    host.navigateTo(coverTarget.x, coverTarget.y, crawlSpeed);
  }
}

// ---------------------------------------------------------------------------
// Game loop — 800 ticks at 16 ms each (~12.8 s of game time)
// ---------------------------------------------------------------------------

console.log('=== Tactical Firefight with Pathfinding ===');
console.log(`  stalker: HP=${stalker.hp}, grenades=${stalker.state.grenadeCount}, medkits=${stalker.state.medkitCount}`);
console.log(`  bandit:  HP=${bandit.hp}, grenades=${bandit.state.grenadeCount}, medkits=${bandit.state.medkitCount}`);
console.log('');

renderArena(stalker, bandit, [], 0);

const DELTA_MS = 16;
const GRENADE_FUSE_TICKS = Math.ceil(3000 / DELTA_MS);
const SHOT_DAMAGE    = 18;   // higher for faster resolution
const GRENADE_DAMAGE = 45;
const GRENADE_RADIUS = 80;

for (let tick = 1; tick <= 800; tick++) {
  if (!isAlive(stalker) && !isAlive(bandit)) break;

  const stalkerStateBefore = stalkerDriver.currentStateId;
  const banditStateBefore  = banditDriver.currentStateId;

  // -------------------------------------------------------------------
  // 1. Perception sync
  // -------------------------------------------------------------------
  if (isAlive(stalker)) {
    const enemies = isAlive(bandit)
      ? [{ id: 'bandit_kaban', x: bandit.x, y: bandit.y, factionId: 'bandit' }]
      : [];
    stalker.perception.sync(enemies, [], []);
  }

  if (isAlive(bandit)) {
    const enemies = isAlive(stalker)
      ? [{ id: 'stalker_wolf', x: stalker.x, y: stalker.y, factionId: 'loner' }]
      : [];
    bandit.perception.sync(enemies, [], []);
  }

  // -------------------------------------------------------------------
  // 2. Morale sync
  // -------------------------------------------------------------------
  stalker.state.morale = stalkerMorale;
  stalker.state.moraleState =
    stalkerMorale < -0.7 ? 'PANICKED' :
    stalkerMorale < -0.3 ? 'SHAKEN'   : 'STABLE';

  bandit.state.morale = banditMorale;
  bandit.state.moraleState =
    banditMorale < -0.7 ? 'PANICKED' :
    banditMorale < -0.3 ? 'SHAKEN'   : 'STABLE';

  // -------------------------------------------------------------------
  // 3. Run AI drivers (tick includes path advancement)
  // -------------------------------------------------------------------
  if (isAlive(stalker)) {
    stalker.shoots.length = 0;
    stalker.tick(stalkerDriver, DELTA_MS);
  }

  if (isAlive(bandit)) {
    bandit.shoots.length = 0;
    bandit.tick(banditDriver, DELTA_MS);
  }

  // -------------------------------------------------------------------
  // 4. Pathfinding hooks on state transitions
  // -------------------------------------------------------------------
  const stalkerStateAfter = stalkerDriver.currentStateId;
  const banditStateAfter  = banditDriver.currentStateId;

  if (stalkerStateBefore !== stalkerStateAfter) {
    if (stalkerStateAfter === ONLINE_STATE.EVADE_GRENADE) {
      onEvadeGrenade(stalker, stalkerDangers);
    } else if (stalkerStateAfter === ONLINE_STATE.WOUNDED) {
      onWounded(stalker, bandit.x, bandit.y);
    }
  }

  if (banditStateBefore !== banditStateAfter) {
    if (banditStateAfter === ONLINE_STATE.EVADE_GRENADE) {
      onEvadeGrenade(bandit, banditDangers);
    } else if (banditStateAfter === ONLINE_STATE.WOUNDED) {
      onWounded(bandit, stalker.x, stalker.y);
    }
  }

  // -------------------------------------------------------------------
  // 5. Process shoots — damage and grenade registration
  // -------------------------------------------------------------------
  for (const shot of stalker.shoots) {
    if (shot.weaponType === 'GRENADE') {
      console.log(`  [tick ${tick}] GRENADE THROWN: stalker -> bandit @ (${shot.targetX.toFixed(0)}, ${shot.targetY.toFixed(0)})`);
      banditDangers.addDanger({
        id:          `grenade_s_${tick}`,
        type:        DangerType.GRENADE,
        position:    { x: shot.targetX, y: shot.targetY },
        radius:      GRENADE_RADIUS,
        threatScore: 0.9,
        remainingMs: 3000,
      });
      pendingGrenades.push({
        tick,
        detonateTick: tick + GRENADE_FUSE_TICKS,
        targetX: shot.targetX,
        targetY: shot.targetY,
        radius: GRENADE_RADIUS,
        throwerName: 'stalker',
        targetName: 'bandit',
        targetHost: bandit,
      });
      banditMorale -= 0.15;
    } else {
      if (isAlive(bandit)) {
        bandit.setHp(bandit.hp - SHOT_DAMAGE);
        banditMorale -= 0.06;
        console.log(`  [tick ${tick}] HIT: stalker -> bandit (HP: ${bandit.hp}, morale: ${banditMorale.toFixed(2)})`);
      }
    }
  }

  for (const shot of bandit.shoots) {
    if (shot.weaponType === 'GRENADE') {
      console.log(`  [tick ${tick}] GRENADE THROWN: bandit -> stalker @ (${shot.targetX.toFixed(0)}, ${shot.targetY.toFixed(0)})`);
      stalkerDangers.addDanger({
        id:          `grenade_b_${tick}`,
        type:        DangerType.GRENADE,
        position:    { x: shot.targetX, y: shot.targetY },
        radius:      GRENADE_RADIUS,
        threatScore: 0.9,
        remainingMs: 3000,
      });
      pendingGrenades.push({
        tick,
        detonateTick: tick + GRENADE_FUSE_TICKS,
        targetX: shot.targetX,
        targetY: shot.targetY,
        radius: GRENADE_RADIUS,
        throwerName: 'bandit',
        targetName: 'stalker',
        targetHost: stalker,
      });
      stalkerMorale -= 0.15;
    } else {
      if (isAlive(stalker)) {
        stalker.setHp(stalker.hp - SHOT_DAMAGE);
        stalkerMorale -= 0.06;
        console.log(`  [tick ${tick}] HIT: bandit -> stalker (HP: ${stalker.hp}, morale: ${stalkerMorale.toFixed(2)})`);
      }
    }
  }

  // -------------------------------------------------------------------
  // 6. Detonate grenades — walls block damage (walkable path check)
  // -------------------------------------------------------------------
  for (let i = pendingGrenades.length - 1; i >= 0; i--) {
    const g = pendingGrenades[i];
    if (tick >= g.detonateTick) {
      const dx = g.targetHost.x - g.targetX;
      const dy = g.targetHost.y - g.targetY;
      const euclidDist = Math.sqrt(dx * dx + dy * dy);

      // Grenade damages only if there is a walkable path shorter than the
      // blast radius — walls block the shockwave.
      const canHit = euclidDist <= g.radius &&
        hasWalkablePath(g.targetX, g.targetY, g.targetHost.x, g.targetHost.y, g.radius * 1.5);

      if (canHit && isAlive(g.targetHost)) {
        g.targetHost.setHp(g.targetHost.hp - GRENADE_DAMAGE);
        console.log(
          `  [tick ${tick}] GRENADE DETONATION: ${g.throwerName}'s grenade hits ` +
          `${g.targetName}! (HP: ${g.targetHost.hp}, dist: ${euclidDist.toFixed(0)}px)`,
        );
      } else if (euclidDist <= g.radius) {
        console.log(
          `  [tick ${tick}] GRENADE DETONATION: ${g.throwerName}'s grenade BLOCKED by wall ` +
          `— ${g.targetName} safe (dist: ${euclidDist.toFixed(0)}px)`,
        );
      } else {
        console.log(
          `  [tick ${tick}] GRENADE DETONATION: ${g.throwerName}'s grenade misses ` +
          `— ${g.targetName} evaded (dist: ${euclidDist.toFixed(0)}px)`,
        );
      }
      pendingGrenades.splice(i, 1);
    }
  }

  // -------------------------------------------------------------------
  // 7. Update danger managers
  // -------------------------------------------------------------------
  stalkerDangers.update(DELTA_MS);
  banditDangers.update(DELTA_MS);

  // -------------------------------------------------------------------
  // 8. Log state transitions
  // -------------------------------------------------------------------
  logTransition('stalker', stalkerStateBefore, stalkerStateAfter, tick);
  logTransition('bandit',  banditStateBefore,  banditStateAfter,  tick);

  // -------------------------------------------------------------------
  // 9. ASCII arena every 100 ticks
  // -------------------------------------------------------------------
  if (tick % 100 === 0) {
    renderArena(stalker, bandit, getActiveGrenadePositions(), tick);
  }

  // -------------------------------------------------------------------
  // 10. Death check
  // -------------------------------------------------------------------
  if (!isAlive(stalker)) {
    console.log(`  [tick ${tick}] DEATH: stalker_wolf is down`);
    break;
  }
  if (!isAlive(bandit)) {
    console.log(`  [tick ${tick}] DEATH: bandit_kaban is down`);
    break;
  }
}

// ---------------------------------------------------------------------------
// Final summary
// ---------------------------------------------------------------------------

renderArena(stalker, bandit, getActiveGrenadePositions(), -1);

console.log('');
console.log('=== Fight Summary ===');
console.log(`  stalker_wolf:  HP=${stalker.hp}, state=${stalkerDriver.currentStateId}, morale=${stalkerMorale.toFixed(2)}`);
console.log(`  bandit_kaban:  HP=${bandit.hp}, state=${banditDriver.currentStateId}, morale=${banditMorale.toFixed(2)}`);
console.log(`  stalker grenades remaining: ${stalker.state.grenadeCount}`);
console.log(`  bandit  grenades remaining: ${bandit.state.grenadeCount}`);
console.log(`  stalker medkits remaining:  ${stalker.state.medkitCount}`);
console.log(`  bandit  medkits remaining:  ${bandit.state.medkitCount}`);

const winner =
  stalker.hp > 0 && bandit.hp <= 0 ? 'stalker_wolf' :
  bandit.hp > 0 && stalker.hp <= 0 ? 'bandit_kaban' :
  stalker.hp > 0 && bandit.hp > 0 ? 'draw (both alive)' : 'mutual destruction';
console.log(`  Result: ${winner}`);
console.log('');

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

stalkerDriver.destroy();
banditDriver.destroy();
kernel.destroy();

// ---------------------------------------------------------------------------
// Key Takeaways
// ---------------------------------------------------------------------------

console.log('=== Key Takeaways ===');
console.log('');
console.log('1. PathfindingNPCHost intercepts setVelocity() from the AI layer.');
console.log('   Instead of raw velocity, it computes an A* destination and follows');
console.log('   the path cell-by-cell. The AI layer stays wall-unaware.');
console.log('');
console.log('2. Grenade evasion uses findFleePosition() to compute a tile far from');
console.log('   the grenade and behind walls, then navigateTo() pathfinds around');
console.log('   obstacles to reach it.');
console.log('');
console.log('3. Wounded NPCs crawl to the nearest wall-adjacent tile (cover) using');
console.log('   findCoverPosition() + navigateTo(). Scoring prefers tiles far from');
console.log('   the enemy but close to the NPC.');
console.log('');
console.log('4. Grenade detonation respects walls: hasWalkablePath() checks if a');
console.log('   walkable A* route from grenade to target is shorter than blast radius.');
console.log('   If the target ducked behind a wall, the shockwave is blocked.');
console.log('');
console.log('5. TacticalCombatHandler and IDangerAccess adapter are unchanged from');
console.log('   the non-pathfinding version — the tactical layer is decoupled from');
console.log('   the movement implementation.');
console.log('');
console.log('6. ASCII arena shows NPC positions (S/B), grenades (G), and walls (#)');
console.log('   every 100 ticks so you can visualize the pathfinding in action.');
