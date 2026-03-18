/**
 * 21-squad-assault.ts — 2v2 squad tactical combat with GOAP Director, A* pathfinding,
 * MemoryBank, personality-driven GOAP costs, threat mapping, and squad comms.
 *
 * Run: npx tsx --tsconfig examples/tsconfig.json examples/21-squad-assault.ts
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import type {
  IOnlineDriverHost,
  INPCHealth,
  ICoverAccess,
  IDangerAccess,
  ISquadAccess,
  IShootPayload,
  IMeleeHitPayload,
  IOnlineStateHandler,
  INPCContext,
} from '@alife-sdk/ai/states';
import {
  OnlineAIDriver,
  NPCPerception,
  createDefaultNPCOnlineState,
  buildDefaultHandlerMap,
  ONLINE_STATE,
} from '@alife-sdk/ai/states';

import {
  SquadSharedTargetTable,
  evaluateSituation,
} from '@alife-sdk/ai/squad';
import type { ISquadSituation } from '@alife-sdk/ai/squad';
import type { ISquadTacticsConfig } from '@alife-sdk/ai/types';

import { GOAPPlanner, WorldState, DangerManager, DangerType, MemoryBank, MemoryChannel } from '@alife-sdk/core/ai';
// GOAPActionDef used indirectly via ACTION_TEMPLATES
import { SeededRandom } from '@alife-sdk/core';

import PF from 'pathfinding';

// ---------------------------------------------------------------------------
// Arena constants — 40x20 tiles, 16px per tile = 640x320 px
// ---------------------------------------------------------------------------

const TILE   = 16;
const COLS   = 40;
const ROWS   = 20;
const _W     = COLS * TILE; // 640 (unused, kept for reference)
const H      = ROWS * TILE; // 320

// ---------------------------------------------------------------------------
// Walkability grid — 0 = walkable, 1 = wall
// Side walls: cols 4-8 & 24-28; Center: cols 13-18; mirrored top/bottom
// ---------------------------------------------------------------------------

function buildMatrix(): number[][] {
  const m: number[][] = [];
  for (let r = 0; r < ROWS; r++) {
    m.push(new Array<number>(COLS).fill(0));
  }

  // Helper: fill a rectangular block with walls
  const wall = (c0: number, r0: number, c1: number, r1: number) => {
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++)
        m[r][c] = 1;
  };

  // --- Top half ---
  // Left side walls (cols 4-8)
  wall(4, 2, 8, 4);
  wall(4, 7, 8, 9);

  // Right side walls (cols 24-28)
  wall(24, 2, 28, 4);
  wall(24, 7, 28, 9);

  // Center walls (cols 13-18)
  wall(13, 4, 18, 7);

  // --- Bottom half (mirror) ---
  // Left side walls
  wall(4, 12, 8, 14);
  wall(4, 17, 8, 18);

  // Right side walls
  wall(24, 12, 28, 14);
  wall(24, 17, 28, 18);

  // Center walls
  wall(13, 14, 18, 17);

  return m;
}

const MATRIX = buildMatrix();
const pfGrid = new PF.Grid(MATRIX);
const finder = new PF.AStarFinder({
  diagonalMovement: PF.DiagonalMovement.IfAtMostOneObstacle,
});

// ---------------------------------------------------------------------------
// Pathfinding helpers
// ---------------------------------------------------------------------------

/** Convert world px to tile col/row (clamped to grid bounds). */
function toTile(px: number, max: number): number {
  return Math.max(0, Math.min(max - 1, Math.floor(px / TILE)));
}

/** Find A* path from world coords to world coords. Returns pixel waypoints. */
function findPath(
  fromX: number, fromY: number,
  toX: number, toY: number,
): { x: number; y: number }[] {
  const c0 = toTile(fromX, COLS);
  const r0 = toTile(fromY, ROWS);
  const c1 = toTile(toX,   COLS);
  const r1 = toTile(toY,   ROWS);

  // PF.Grid mutates during findPath — must clone each call
  const raw = finder.findPath(c0, r0, c1, r1, pfGrid.clone());
  // Convert tile coords to pixel centers
  return raw.map(([c, r]) => ({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 }));
}

/** Describe path direction for logging (north/south around center). */
function describeRoute(path: { x: number; y: number }[]): string {
  if (path.length < 2) return 'direct';
  const minY = Math.min(...path.map(p => p.y));
  const maxY = Math.max(...path.map(p => p.y));
  const midY = H / 2; // 160
  if (minY < midY - 40 && maxY < midY + 40) return 'routing north around center wall';
  if (maxY > midY + 40 && minY > midY - 40) return 'routing south around center wall';
  if (minY < midY - 40) return 'routing north';
  if (maxY > midY + 40) return 'routing south';
  return 'direct path';
}

// ---------------------------------------------------------------------------
// Deterministic hash for per-NPC seed
// ---------------------------------------------------------------------------

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

// ---------------------------------------------------------------------------
// [IMPROVEMENT 2] Personality system — GOAP cost modifiers per archetype
// ---------------------------------------------------------------------------

type Personality = 'aggressive' | 'cautious' | 'balanced' | 'flanker';

/** Cost delta per action per personality. Positive = more expensive, negative = cheaper. */
const PERSONALITY_COSTS: Record<Personality, Partial<Record<string, number>>> = {
  aggressive: { TakeCover: +2, RushAttack: -3, Flank: -1, Suppress: +1, Attack: -1 },
  cautious:   { TakeCover: -1, Suppress: -1, RushAttack: +3, Flank: +2, CoverAlly: -1 },
  balanced:   {},  // no modifications
  flanker:    { Flank: -2, FlankAttack: -1, TakeCover: +1, Suppress: +2, Pursue: -1 },
};

// ---------------------------------------------------------------------------
// [IMPROVEMENT 3] Threat mapping — track dangerous tiles
// ---------------------------------------------------------------------------

/** Tile-key -> threat level [0..1]. Decays each tick. */
const threatMap = new Map<string, number>();
const THREAT_DECAY_RATE = 0.002; // per tick (800 ticks ~ 0 -> 1.6 total decay)
const THREAT_RADIUS = 2;        // tiles around the event

function recordThreat(worldX: number, worldY: number, level: number): void {
  const cx = toTile(worldX, COLS);
  const cy = toTile(worldY, ROWS);
  for (let dy = -THREAT_RADIUS; dy <= THREAT_RADIUS; dy++) {
    for (let dx = -THREAT_RADIUS; dx <= THREAT_RADIUS; dx++) {
      const tx = cx + dx;
      const ty = cy + dy;
      if (tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS) continue;
      const key = `${tx},${ty}`;
      const existing = threatMap.get(key) ?? 0;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const falloff = Math.max(0, level * (1 - dist / (THREAT_RADIUS + 1)));
      threatMap.set(key, Math.min(1, existing + falloff));
    }
  }
}

function decayThreats(): void {
  for (const [key, value] of threatMap) {
    const next = value - THREAT_DECAY_RATE;
    if (next <= 0.01) {
      threatMap.delete(key);
    } else {
      threatMap.set(key, next);
    }
  }
}

/** Check if an NPC is standing on a high-threat tile. */
function isInDangerousArea(worldX: number, worldY: number): boolean {
  const tx = toTile(worldX, COLS);
  const ty = toTile(worldY, ROWS);
  return (threatMap.get(`${tx},${ty}`) ?? 0) > 0.3;
}

/** Threat-aware pathfinding: marks high-threat tiles as unwalkable. */
function findPathThreatAware(
  fromX: number, fromY: number,
  toX: number, toY: number,
): { x: number; y: number }[] {
  const c0 = toTile(fromX, COLS);
  const r0 = toTile(fromY, ROWS);
  const c1 = toTile(toX,   COLS);
  const r1 = toTile(toY,   ROWS);

  const grid = pfGrid.clone();
  // Block high-threat tiles (but never block start/end)
  for (const [key, threat] of threatMap) {
    if (threat > 0.5) {
      const [tx, ty] = key.split(',').map(Number);
      if ((tx === c0 && ty === r0) || (tx === c1 && ty === r1)) continue;
      grid.setWalkableAt(tx, ty, false);
    }
  }

  const raw = finder.findPath(c0, r0, c1, r1, grid);
  // Fallback to normal path if threat-aware path fails
  if (raw.length === 0) {
    return findPath(fromX, fromY, toX, toY);
  }
  return raw.map(([c, r]) => ({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 }));
}

// ---------------------------------------------------------------------------
// [IMPROVEMENT 4] Communication protocol — squad-mate broadcasts
// ---------------------------------------------------------------------------

interface SquadComm {
  readonly from: string;
  readonly type: 'SUPPRESSING' | 'FLANKING' | 'IN_POSITION' | 'NEED_HELP' | 'PUSHING';
  readonly tick: number;
}

const squadComms: SquadComm[] = [];
const MAX_COMM_AGE = 120; // ticks — messages older than this are pruned

function broadcast(from: string, type: SquadComm['type'], tick: number): void {
  squadComms.push({ from, type, tick });
  console.log(`  [COMMS ${from}] "${type}"`);
}

/** Get the most recent comm from this NPC's squad mate. */
function getLatestCommFromMate(npcId: string, currentTick: number): SquadComm | null {
  const pairs: Record<string, string> = {
    alpha_lead: 'alpha_flank', alpha_flank: 'alpha_lead',
    bravo_lead: 'bravo_guard', bravo_guard: 'bravo_lead',
  };
  const mateId = pairs[npcId];
  if (!mateId) return null;

  for (let i = squadComms.length - 1; i >= 0; i--) {
    const comm = squadComms[i];
    if (comm.from === mateId && (currentTick - comm.tick) < MAX_COMM_AGE) {
      return comm;
    }
  }
  return null;
}

function pruneOldComms(currentTick: number): void {
  while (squadComms.length > 0 && (currentTick - squadComms[0].tick) >= MAX_COMM_AGE) {
    squadComms.shift();
  }
}

// ---------------------------------------------------------------------------
// PathfindingNPCHost — IOnlineDriverHost with A* navigation + GOAP state
// ---------------------------------------------------------------------------

class PathfindingNPCHost implements IOnlineDriverHost {
  readonly state = createDefaultNPCOnlineState();
  readonly perception = new NPCPerception();

  readonly npcId: string;
  readonly factionId: string;
  readonly entityType: string;

  x: number;
  y: number;

  cover:           ICoverAccess  | null = null;
  danger:          IDangerAccess | null = null;
  restrictedZones = null;
  squad:           ISquadAccess  | null = null;
  pack             = null;
  conditions       = null;
  suspicion        = null;

  readonly shoots:        IShootPayload[] = [];
  readonly vocalizations: string[]        = [];

  private _hp    = 100;
  private _maxHp = 100;
  private _nowMs = 0;
  private readonly _rng: SeededRandom;

  // --- Pathfinding state ---
  private _path: { x: number; y: number }[] = [];
  private _pathIdx = 0;
  private _moveSpeed = 120; // px per second

  // --- GOAP execution state (per-NPC, NOT in INPCOnlineState) ---
  goapPlan: Array<{ id: string }> | null = null;
  goapActionIndex = 0;
  goapSuppressShotsFired = 0;
  goapFlankTarget: { x: number; y: number } | null = null;
  goapCoverTarget: { x: number; y: number } | null = null;

  // --- [IMPROVEMENT 5] Resource awareness — ammo + reload ---
  ammo = 12;             // limited magazine — forces tactical reloads
  maxAmmo = 12;
  isReloading = false;
  reloadStartMs = 0;
  reloadDurationMs = 2000;  // 2 seconds to reload
  totalKills = 0;

  // --- [IMPROVEMENT 6] Anticipation — track enemy velocity ---
  lastEnemyX = 0;
  lastEnemyY = 0;
  enemyVx = 0;           // enemy velocity px/s (estimated)
  enemyVy = 0;

  // --- [IMPROVEMENT 1] MemoryBank — per-NPC episodic memory ---
  readonly memory: MemoryBank;

  // --- [IMPROVEMENT 2] Personality — modifies GOAP action costs ---
  readonly personality: Personality;

  constructor(id: string, faction: string, type: string, x: number, y: number, personality: Personality = 'balanced') {
    this.npcId      = id;
    this.factionId  = faction;
    this.entityType = type;
    this.x          = x;
    this.y          = y;
    this._rng       = new SeededRandom(hashCode(id));
    this.personality = personality;
    this.memory     = new MemoryBank({
      timeFn: () => this._nowMs / 1000,
      maxRecords: 10,
      channelDecayRates: {
        [MemoryChannel.VISUAL]: 0.08,  // visual memory ~12s
        [MemoryChannel.SOUND]:  0.15,  // sound memory ~6s
        [MemoryChannel.HIT]:    0.03,  // hit memory ~30s
      },
    });
  }

  get health(): INPCHealth {
    return {
      hp:        this._hp,
      maxHp:     this._maxHp,
      hpPercent: this._hp / this._maxHp,
      heal: (n: number) => { this._hp = Math.min(this._hp + n, this._maxHp); },
    };
  }

  setVelocity(vx: number, vy: number): void { this.x += vx * 0.016; this.y += vy * 0.016; }
  halt(): void { /* stop */ }
  setRotation(_r: number): void { /* rotate */ }
  setAlpha(_a: number): void { /* cloak */ }
  teleport(px: number, py: number): void { this.x = px; this.y = py; }
  disablePhysics(): void { /* remove body */ }

  emitShoot(p: IShootPayload): void { this.shoots.push(p); }
  emitMeleeHit(_p: IMeleeHitPayload): void { /* damage */ }
  emitVocalization(t: string): void { this.vocalizations.push(t); }
  emitPsiAttackStart(_x: number, _y: number): void { /* psi */ }

  now(): number { return this._nowMs; }
  random(): number { return this._rng.next(); }

  tick(driver: OnlineAIDriver, deltaMs: number): void {
    this._nowMs += deltaMs;
    this._advancePath(deltaMs);

    // [IMPROVEMENT 5] Auto-complete reload after duration
    if (this.isReloading && this._nowMs - this.reloadStartMs >= this.reloadDurationMs) {
      this.isReloading = false;
      this.ammo = this.maxAmmo;
      console.log(`  [RELOAD ${this.npcId}] reload complete! ammo=${this.ammo}`);
    }

    // [IMPROVEMENT 6] Track enemy velocity for anticipation
    const enemies = this.perception.getVisibleEnemies();
    if (enemies.length > 0) {
      const e = enemies[0];
      if (this.lastEnemyX !== 0) {
        // Smooth velocity estimate (exponential moving average)
        const rawVx = (e.x - this.lastEnemyX) / (deltaMs / 1000);
        const rawVy = (e.y - this.lastEnemyY) / (deltaMs / 1000);
        this.enemyVx = this.enemyVx * 0.7 + rawVx * 0.3;
        this.enemyVy = this.enemyVy * 0.7 + rawVy * 0.3;
      }
      this.lastEnemyX = e.x;
      this.lastEnemyY = e.y;
    }

    driver.update(deltaMs);
  }

  setHp(hp: number): void { this._hp = Math.max(0, hp); }
  getHp(): number { return this._hp; }
  isAlive(): boolean { return this._hp > 0; }

  /** [IMPROVEMENT 6] Predict where enemy will be in `lookAheadMs` ms. */
  predictEnemyPos(lookAheadMs: number): { x: number; y: number } | null {
    if (this.lastEnemyX === 0) return null;
    return {
      x: this.lastEnemyX + this.enemyVx * (lookAheadMs / 1000),
      y: this.lastEnemyY + this.enemyVy * (lookAheadMs / 1000),
    };
  }

  /** [IMPROVEMENT 5] Start reloading. Returns false if already reloading. */
  startReload(): boolean {
    if (this.isReloading) return false;
    this.isReloading = true;
    this.reloadStartMs = this._nowMs;
    console.log(`  [RELOAD ${this.npcId}] reloading... (${this.reloadDurationMs}ms)`);
    return true;
  }

  // --- A* navigation API ---

  /** Compute A* path and start walking. Returns true if path found. */
  navigateTo(tx: number, ty: number): boolean {
    const path = findPath(this.x, this.y, tx, ty);
    if (path.length < 2) return false;
    this._path    = path;
    this._pathIdx = 1; // skip start cell (we're already there)
    return true;
  }

  /** Threat-aware navigation — avoids high-threat tiles. */
  navigateToSafe(tx: number, ty: number): boolean {
    const path = findPathThreatAware(this.x, this.y, tx, ty);
    if (path.length < 2) return false;
    this._path    = path;
    this._pathIdx = 1;
    return true;
  }

  /** Number of waypoints in current path (0 = idle). */
  getPathLength(): number { return this._path.length; }

  /** True if actively walking a path. */
  isNavigating(): boolean { return this._pathIdx < this._path.length; }

  /** Get remaining path waypoints for logging. */
  getRemainingPath(): { x: number; y: number }[] {
    return this._path.slice(this._pathIdx);
  }

  /** Advance along path each tick. */
  private _advancePath(deltaMs: number): void {
    if (this._pathIdx >= this._path.length) return;

    const target = this._path[this._pathIdx];
    const dx     = target.x - this.x;
    const dy     = target.y - this.y;
    const dist   = Math.sqrt(dx * dx + dy * dy);
    const step   = this._moveSpeed * (deltaMs / 1000);

    if (dist <= step) {
      this.x = target.x;
      this.y = target.y;
      this._pathIdx++;
    } else {
      this.x += (dx / dist) * step;
      this.y += (dy / dist) * step;
    }
  }
}

// ---------------------------------------------------------------------------
// IDangerAccess adapter
// ---------------------------------------------------------------------------

const dangers = new DangerManager(0.3);

function createDangerAccess(): IDangerAccess {
  return {
    getDangerLevel: (x, y) => dangers.getThreatAt({ x, y }),
    getGrenadeDanger: (x, y) => {
      const nearby = dangers.getDangersNear({ x, y }, 80);
      const grenade = nearby.find(d => d.type === DangerType.GRENADE);
      if (!grenade) return null;
      return { active: true, originX: grenade.position.x, originY: grenade.position.y };
    },
  };
}

// ---------------------------------------------------------------------------
// Cover points — 13 positions (world px). Behind walls + flanking lanes.
// ---------------------------------------------------------------------------

const COVER_POINTS = [
  { x:  24, y:  88 }, { x:  24, y: 168 }, { x:  24, y: 248 },  // Alpha side
  { x: 488, y:  88 }, { x: 488, y: 168 }, { x: 488, y: 248 },  // Bravo side
  { x: 200, y:  12 }, { x: 440, y:  12 },                       // North corridor
  { x: 200, y: 308 }, { x: 440, y: 308 },                       // South corridor
  { x: 568, y:  88 }, { x: 568, y: 248 },                       // Behind Bravo
  { x:  72, y:  88 },                                            // Behind Alpha
];

/** ICoverAccess: ambush = behind enemy, close = near self & far from enemy. */
function createCoverAccess(_role: 'lead' | 'flanker'): ICoverAccess {
  return {
    findCover(x, y, enemyX, enemyY, type) {
      if (type === 'ambush') {
        let best: { x: number; y: number } | null = null;
        let bestScore = -Infinity;
        for (const pt of COVER_POINTS) {
          const dirX = enemyX - x;
          const behindness = dirX !== 0 ? ((pt.x - enemyX) * Math.sign(dirX)) : 0;
          const yOffset = Math.abs(pt.y - enemyY);
          const dNpc = Math.sqrt((pt.x - x) ** 2 + (pt.y - y) ** 2);
          const score = behindness * 3 + yOffset * 0.5 - dNpc * 0.1;
          if (score > bestScore) { bestScore = score; best = pt; }
        }
        return best;
      }
      let best: { x: number; y: number } | null = null;
      let bestScore = -Infinity;
      for (const pt of COVER_POINTS) {
        const dNpc   = Math.sqrt((pt.x - x) ** 2 + (pt.y - y) ** 2);
        const dEnemy = Math.sqrt((pt.x - enemyX) ** 2 + (pt.y - enemyY) ** 2);
        const score = -dNpc * 2 + dEnemy;
        if (score > bestScore) { bestScore = score; best = pt; }
      }
      return best;
    },
  };
}

// ---------------------------------------------------------------------------
// GOAP setup — base action definitions (data-driven, personality-modified)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// [IMPROVEMENT 7] Utility AI — dynamic GOAP action costs
//
// Instead of static costs, each action's cost is computed from the NPC's
// current situation. This makes costs context-dependent:
//   - RushAttack gets cheaper with each kill (momentum)
//   - TakeCover gets MORE expensive if allies are all in cover (someone must push)
//   - Flank gets cheaper when HP is high (healthy NPC can afford the risk)
//   - Reload is cheap when safe, expensive when exposed
// ---------------------------------------------------------------------------

interface ActionTemplate {
  id: string;
  baseCost: number;
  preconditions: Record<string, boolean>;
  effects: Record<string, boolean>;
  /** Dynamic cost modifier — receives NPC context, returns cost delta. */
  utilityCostFn?: (host: PathfindingNPCHost) => number;
}

const ACTION_TEMPLATES: ActionTemplate[] = [
  // Movement
  {
    id: 'TakeCover', baseCost: 3, preconditions: {}, effects: { inCover: true },
    // More expensive if all allies already in cover — someone needs to push
    utilityCostFn: (h) => {
      const squad = h.factionId === 'loner' ? alphaMembers : bravoMembers;
      const allInCover = squad.filter(m => m.isAlive() && m.state.hasTakenCover).length;
      return allInCover >= 2 ? +2 : 0;  // "we're all hiding, someone attack!"
    },
  },
  {
    id: 'Flank', baseCost: 3, preconditions: { inCover: true }, effects: { hasFlankPosition: true },
    // Cheaper when healthy (can afford the risk of moving)
    utilityCostFn: (h) => h.getHp() >= 70 ? -1 : +1,
  },
  {
    id: 'Pursue', baseCost: 2, preconditions: { enemyFleeing: true },
    effects: { enemyInRange: true, hasFlankPosition: true },
  },
  // Memory
  {
    id: 'SearchLastKnown', baseCost: 4, preconditions: { hasMemoryOfEnemy: true },
    effects: { seeEnemy: true, enemyInRange: true },
  },
  // Fire support
  {
    id: 'Suppress', baseCost: 3,
    preconditions: { inCover: true, hasAmmo: true, seeEnemy: true },
    effects: { enemySuppressed: true },
    // More expensive when low ammo — conserve bullets
    utilityCostFn: (h) => h.ammo < 10 ? +2 : 0,
  },
  {
    id: 'CoverAlly', baseCost: 2,
    preconditions: { inCover: true, hasAmmo: true, seeEnemy: true, allyFlanking: true },
    effects: { enemySuppressed: true },
  },
  {
    id: 'ThrowGrenade', baseCost: 4,
    preconditions: { hasGrenade: true, seeEnemy: true, enemyInCover: true },
    effects: { enemySuppressed: true, enemyInCover: false },
  },
  // Attack
  {
    id: 'Attack', baseCost: 2,
    preconditions: { isHealthy: true, inCover: true, enemySuppressed: true, hasAmmo: true },
    effects: { targetEliminated: true },
  },
  {
    id: 'CoordinatedAttack', baseCost: 1,
    preconditions: { isHealthy: true, hasAmmo: true, allyInPosition: true },
    effects: { targetEliminated: true },
  },
  {
    id: 'FlankAttack', baseCost: 1,
    preconditions: { isHealthy: true, hasFlankPosition: true, hasAmmo: true },
    effects: { targetEliminated: true },
  },
  {
    id: 'SoloAssault', baseCost: 4,
    preconditions: { isHealthy: true, inCover: true, hasAmmo: true, allyDead: true, enemySuppressed: true },
    effects: { targetEliminated: true },
  },
  {
    id: 'RushAttack', baseCost: 6,
    preconditions: { isHealthy: true, hasAmmo: true, enemyInRange: true },
    effects: { targetEliminated: true },
    // Gets cheaper with kills (momentum/confidence) and when enemy is reloading
    utilityCostFn: (h) => {
      let mod = 0;
      mod -= h.totalKills * 2;        // -2 per kill (momentum!)
      // Check if visible enemy is reloading
      const enemies = h.perception.getVisibleEnemies();
      if (enemies.length > 0) {
        const eHost = npcHosts.get(enemies[0].id);
        if (eHost?.isReloading) mod -= 3;  // enemy reloading = huge opportunity!
      }
      return mod;
    },
  },
  // Support
  { id: 'HealSelf', baseCost: 1, preconditions: { hasMedkit: true }, effects: { isHealthy: true } },
  // [IMPROVEMENT 5] Reload action
  {
    id: 'Reload', baseCost: 2,
    preconditions: { lowAmmo: true, inCover: true },
    effects: { hasAmmo: true, lowAmmo: false },
    // Cheap in cover, expensive in the open
    utilityCostFn: (h) => h.state.hasTakenCover ? -1 : +3,
  },
];

const combatGoal = WorldState.from({ targetEliminated: true });

// --- [IMPROVEMENT 7] Utility AI planner (created fresh per replan) ---

/**
 * [IMPROVEMENT 7] Utility AI — build a planner with dynamic costs.
 * Called on every replan (not cached) because costs depend on current NPC state.
 * Cost = baseCost + personalityMod + utilityCostFn(host)
 */
function createUtilityPlanner(host: PathfindingNPCHost): GOAPPlanner {
  const p = new GOAPPlanner();
  const mods = PERSONALITY_COSTS[host.personality];

  for (const tmpl of ACTION_TEMPLATES) {
    const personalityMod = mods[tmpl.id] ?? 0;
    const utilityMod = tmpl.utilityCostFn ? tmpl.utilityCostFn(host) : 0;
    const finalCost = Math.max(1, tmpl.baseCost + personalityMod + utilityMod);
    p.registerAction({
      id: tmpl.id,
      cost: finalCost,
      preconditions: tmpl.preconditions,
      effects: tmpl.effects,
    });
  }

  return p;
}

// Also keep a default planner for shared use
// Default planner created lazily — not used directly, utility planners are per-NPC per-replan
const _defaultPlanner = new GOAPPlanner();
for (const t of ACTION_TEMPLATES) _defaultPlanner.registerAction({ id: t.id, cost: t.baseCost, preconditions: t.preconditions, effects: t.effects });

// ---------------------------------------------------------------------------
// Squad coordination — SquadSharedTargetTable + evaluateSituation()
// ---------------------------------------------------------------------------

let sharedClock = 0;

const sharedTargets = new SquadSharedTargetTable(
  npcId => {
    if (['alpha_lead', 'alpha_flank'].includes(npcId)) return 'alpha';
    if (['bravo_lead', 'bravo_guard'].includes(npcId)) return 'bravo';
    return null;
  },
  { ttlMs: 5_000 },
  () => sharedClock,
);

function createSquadAccess(npcId: string, leaderId: string): ISquadAccess {
  return {
    shareTarget: (targetId, x, y) => sharedTargets.shareTarget(npcId, targetId, x, y),
    getSharedTarget: () => sharedTargets.getSharedTarget(npcId),
    getLeaderId: () => leaderId,
    getMemberCount: () => 2,
    issueCommand: (cmd) => console.log(`  [SQUAD ${npcId}] command: ${cmd}`),
  };
}

const tacticsConfig: ISquadTacticsConfig = {
  outnumberRatio: 1.5,
  moralePanickedThreshold: -0.6,
  nearbyRadius: 300,
};

// ---------------------------------------------------------------------------
// NPC setup — 4 combatants, 2 squads, personality per role
// ---------------------------------------------------------------------------

const alphaLead  = new PathfindingNPCHost('alpha_lead',  'loner',  'human',  2 * TILE + 8,  5 * TILE + 8, 'balanced');
const alphaFlank = new PathfindingNPCHost('alpha_flank', 'loner',  'human',  2 * TILE + 8, 15 * TILE + 8, 'flanker');
const bravoLead  = new PathfindingNPCHost('bravo_lead',  'bandit', 'human', 30 * TILE + 8,  5 * TILE + 8, 'aggressive');
const bravoGuard = new PathfindingNPCHost('bravo_guard', 'bandit', 'human', 30 * TILE + 8, 15 * TILE + 8, 'cautious');

const allNPCs = [alphaLead, alphaFlank, bravoLead, bravoGuard];

// Equip: rifle + 1 grenade + 1 medkit. Pre-expire cover cooldown.
for (const npc of allNPCs) {
  npc.state.primaryWeapon    = 'rifle';
  npc.state.grenadeCount     = 1;
  npc.state.medkitCount      = 1;
  npc.state.lastSeekCoverMs  = -3_000;
}

// Wire cover (lead vs flanker role).
alphaLead.cover  = createCoverAccess('lead');
alphaFlank.cover = createCoverAccess('flanker');
bravoLead.cover  = createCoverAccess('lead');
bravoGuard.cover = createCoverAccess('flanker');

// Wire danger.
for (const npc of allNPCs) npc.danger = createDangerAccess();

// Wire squad.
alphaLead.squad  = createSquadAccess('alpha_lead',  'alpha_lead');
alphaFlank.squad = createSquadAccess('alpha_flank', 'alpha_lead');
bravoLead.squad  = createSquadAccess('bravo_lead',  'bravo_lead');
bravoGuard.squad = createSquadAccess('bravo_guard', 'bravo_lead');

// ---------------------------------------------------------------------------
// GOAP helpers
// ---------------------------------------------------------------------------

const _LEADS = new Set(['alpha_lead', 'bravo_lead']);

/** NPC host lookup — shared by all GOAP handlers */
const npcHosts = new Map<string, PathfindingNPCHost>();
for (const npc of allNPCs) npcHosts.set(npc.npcId, npc);

// ---------------------------------------------------------------------------
// Squad awareness helpers — NPC reads its squad mate's state
// ---------------------------------------------------------------------------

function getSquadMate(npcId: string): PathfindingNPCHost | null {
  const pairs: Record<string, string> = {
    alpha_lead: 'alpha_flank', alpha_flank: 'alpha_lead',
    bravo_lead: 'bravo_guard', bravo_guard: 'bravo_lead',
  };
  return npcHosts.get(pairs[npcId] ?? '') ?? null;
}

function isSquadMateAlive(npcId: string): boolean {
  const mate = getSquadMate(npcId);
  return mate !== null && mate.isAlive();
}

function isSquadMateFlanking(npcId: string): boolean {
  const mate = getSquadMate(npcId);
  if (!mate || !mate.isAlive()) return false;
  const mateDriver = drivers.get(mate.npcId);
  return mateDriver?.currentStateId === 'GOAP_FLANK';
}

function isSquadMateInPosition(npcId: string): boolean {
  const mate = getSquadMate(npcId);
  if (!mate || !mate.isAlive()) return false;
  const mateDriver = drivers.get(mate.npcId);
  return mateDriver?.currentStateId === 'GOAP_ATTACK';
}

// ---------------------------------------------------------------------------
// Build WorldState — squad-aware + memory + threat + comms
// ---------------------------------------------------------------------------

function buildNpcWorldState(host: PathfindingNPCHost, currentTick: number): WorldState {
  const enemies = host.perception.getVisibleEnemies();
  const inCover = host.state.hasTakenCover;

  let enemyFleeing = false, enemyInCover = false, enemyInRange = false;
  if (enemies.length > 0) {
    const enemyHost = npcHosts.get(enemies[0].id);
    if (enemyHost) {
      const enemyDriver = drivers.get(enemyHost.npcId);
      enemyFleeing = enemyHost.state.moraleState === 'PANICKED' ||
                     (enemyDriver?.currentStateId === 'FLEE') ||
                     (enemyDriver?.currentStateId === 'RETREAT');
      enemyInCover = enemyHost.state.hasTakenCover;
      const dx = enemies[0].x - host.x, dy = enemies[0].y - host.y;
      enemyInRange = Math.sqrt(dx * dx + dy * dy) < 200;
    }
  }

  const allyFlanking   = isSquadMateFlanking(host.npcId);
  const allyInPosition = isSquadMateInPosition(host.npcId);
  const allyDead       = !isSquadMateAlive(host.npcId);

  const startX = host.npcId.startsWith('alpha') ? 2 * TILE + 8 : 30 * TILE + 8;
  const startY = (host.npcId.includes('flank') || host.npcId.includes('guard')) ? 15 * TILE + 8 : 5 * TILE + 8;
  const moved = Math.sqrt((host.x - startX) ** 2 + (host.y - startY) ** 2);

  const mySquad = host.factionId === 'loner' ? alphaMembers : bravoMembers;
  const enemySquad = host.factionId === 'loner' ? bravoMembers : alphaMembers;
  const outnumbered = enemySquad.filter(m => m.isAlive()).length > mySquad.filter(m => m.isAlive()).length;

  const bestMemory = host.memory.getMostConfident();
  const hasMemoryOfEnemy = bestMemory !== undefined && bestMemory.confidence > 0.2;
  const dangerousArea = isInDangerousArea(host.x, host.y);
  const mateComm = getLatestCommFromMate(host.npcId, currentTick);
  const allyRequestingCover = mateComm !== null && (mateComm.type === 'FLANKING' || mateComm.type === 'NEED_HELP');

  return WorldState.from({
    isHealthy: host.getHp() >= 50, inCover,
    hasAmmo: host.ammo > 0 && !host.isReloading,
    lowAmmo: host.ammo <= 5 && host.ammo > 0,
    hasMedkit: host.state.medkitCount > 0, hasGrenade: host.state.grenadeCount > 0,
    hasFlankPosition: moved > 120,
    seeEnemy: enemies.length > 0, enemyFleeing, enemyInCover, enemyInRange,
    enemySuppressed: (host.goapSuppressShotsFired ?? 0) >= 4,
    allyFlanking: allyFlanking || (allyRequestingCover && mateComm?.type === 'FLANKING'),
    allyInPosition, allyDead, outnumbered,
    hasMemoryOfEnemy, dangerousArea,
  });
}

function getPlannerForNpc(npcId: string): GOAPPlanner {
  const host = npcHosts.get(npcId);
  if (!host) return _defaultPlanner;
  return createUtilityPlanner(host);
}

// ---------------------------------------------------------------------------
// GOAP Director — COMBAT handler, replans on every entry
// ---------------------------------------------------------------------------

class GOAPDirector implements IOnlineStateHandler {
  constructor(
    private hosts: Map<string, PathfindingNPCHost>,
    private getPlanner: (npcId: string) => GOAPPlanner,
    private buildWS: (host: PathfindingNPCHost, tick: number) => WorldState,
    private goal: WorldState,
  ) {}

  enter(ctx: INPCContext): void {
    const host = this.hosts.get(ctx.npcId)!;
    const ws = this.buildWS(host, currentTick);
    const plan = this.getPlanner(ctx.npcId).plan(ws, this.goal);
    host.goapPlan = plan ?? [];
    host.goapActionIndex = 0;
    host.goapSuppressShotsFired = 0;

    const planStr = host.goapPlan!.map(a => a.id).join(' -> ');
    console.log(`  [GOAP ${ctx.npcId} (${host.personality})] replan: ${planStr || '(empty)'}`);

    // --- [IMPROVEMENT 1] Log memory influence on plan ---
    const bestMem = host.memory.getMostConfident();
    if (bestMem && bestMem.confidence > 0.2) {
      console.log(
        `  [MEMORY ${ctx.npcId}] enemy last seen at ` +
        `(${bestMem.position.x.toFixed(0)},${bestMem.position.y.toFixed(0)}), ` +
        `confidence ${bestMem.confidence.toFixed(2)}`,
      );
    }
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    const host = this.hosts.get(ctx.npcId)!;

    // Interrupt checks (highest priority)
    if (ctx.state.moraleState === 'PANICKED') { ctx.transition('FLEE'); return; }
    if (ctx.state.moraleState === 'SHAKEN') { ctx.transition('RETREAT'); return; }
    if (ctx.health && ctx.health.hpPercent < 0.2) { ctx.transition('WOUNDED'); return; }

    // Check grenade danger
    const grenade = ctx.danger?.getGrenadeDanger(ctx.x, ctx.y);
    if (grenade?.active) { ctx.transition('EVADE_GRENADE'); return; }

    // Execute next GOAP action
    if (!host.goapPlan || host.goapActionIndex >= host.goapPlan.length) {
      // Plan complete or empty — fallback combat behavior
      this._fallbackCombat(ctx, host);
      return;
    }

    const action = host.goapPlan[host.goapActionIndex];
    const stateId = this._actionToState(action.id);
    console.log(`  [GOAP:next ${ctx.npcId}] action[${host.goapActionIndex}]: ${action.id} -> ${stateId}`);
    ctx.transition(stateId);
  }

  exit(_ctx: INPCContext): void {}

  private _actionToState(actionId: string): string {
    switch (actionId) {
      case 'TakeCover':         return 'GOAP_TAKE_COVER';
      case 'Suppress':          return 'GOAP_SUPPRESS';
      case 'CoverAlly':         return 'GOAP_SUPPRESS';   // same behavior, different intent
      case 'Flank':             return 'GOAP_FLANK';
      case 'Pursue':            return 'GOAP_PURSUE';
      case 'Attack':            return 'GOAP_ATTACK';
      case 'CoordinatedAttack': return 'GOAP_ATTACK';
      case 'FlankAttack':       return 'GOAP_ATTACK';
      case 'SoloAssault':       return 'GOAP_ATTACK';
      case 'RushAttack':        return 'GOAP_ATTACK';
      case 'ThrowGrenade':      return 'GOAP_THROW_GRENADE';
      case 'HealSelf':          return 'GOAP_HEAL';
      case 'SearchLastKnown':   return 'GOAP_SEARCH';
      case 'Reload':            return 'GOAP_RELOAD';
      default:                  return 'GOAP_ATTACK';
    }
  }

  /** [IMPROVEMENT 1] Fallback uses memory when no enemies visible. */
  private _fallbackCombat(ctx: INPCContext, host: PathfindingNPCHost): void {
    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    if (enemies.length > 0) {
      // Simple: shoot if enemy visible
      const enemy = enemies[0];
      const now = ctx.now();
      if (now - ctx.state.lastShootMs >= 500) {
        ctx.state.lastShootMs = now;
        ctx.emitShoot({
          npcId: ctx.npcId, x: ctx.x, y: ctx.y,
          targetX: enemy.x, targetY: enemy.y, weaponType: 'rifle',
        });
      }
    } else {
      // No enemy visible — check memory for last known position
      const bestMem = host.memory.getMostConfident();
      if (bestMem && bestMem.confidence > 0.15 && !host.isNavigating()) {
        console.log(
          `  [MEMORY ${ctx.npcId}] searching last known pos ` +
          `(${bestMem.position.x.toFixed(0)},${bestMem.position.y.toFixed(0)}), ` +
          `conf=${bestMem.confidence.toFixed(2)}`,
        );
        host.navigateToSafe(bestMem.position.x, bestMem.position.y);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// GOAP execution states
// ---------------------------------------------------------------------------

/** GOAP_TAKE_COVER: pathfind to nearest cover point shielded from enemy. */
class GOAPTakeCover implements IOnlineStateHandler {
  constructor(private hosts: Map<string, PathfindingNPCHost>) {}

  enter(ctx: INPCContext): void {
    const host = this.hosts.get(ctx.npcId)!;
    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    if (enemies.length === 0) { ctx.transition('COMBAT'); return; }

    const enemy = enemies[0];
    const coverPt = ctx.cover?.findCover(ctx.x, ctx.y, enemy.x, enemy.y, 'close');
    if (coverPt) {
      host.goapCoverTarget = coverPt;
      // [IMPROVEMENT 3] Use threat-aware pathfinding for cover movement
      host.navigateToSafe(coverPt.x, coverPt.y);
      console.log(`  [GOAP:TakeCover ${ctx.npcId}] -> cover (${coverPt.x},${coverPt.y}), ${host.getPathLength()} wp`);
    } else {
      // No cover found — skip this action
      host.goapActionIndex++;
      ctx.transition('COMBAT');
    }
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    const host = this.hosts.get(ctx.npcId)!;
    // Interrupts
    if (ctx.state.moraleState === 'PANICKED') { ctx.transition('FLEE'); return; }
    if (ctx.health && ctx.health.hpPercent < 0.2) { ctx.transition('WOUNDED'); return; }

    const grenade = ctx.danger?.getGrenadeDanger(ctx.x, ctx.y);
    if (grenade?.active) { ctx.transition('EVADE_GRENADE'); return; }

    // Check if arrived at cover
    if (!host.isNavigating() && host.goapCoverTarget) {
      const dx = ctx.x - host.goapCoverTarget.x;
      const dy = ctx.y - host.goapCoverTarget.y;
      if (dx * dx + dy * dy < 20 * 20) {
        console.log(`  [GOAP:TakeCover ${ctx.npcId}] arrived at cover`);
        ctx.state.hasTakenCover = true;
        host.goapActionIndex++;
        ctx.transition('COMBAT'); // back to director
        return;
      }
    }
    // Still moving — path follower handles movement in tick()
  }

  exit(_ctx: INPCContext): void {}
}

/** GOAP_SUPPRESS: shoot N times from cover before advancing plan. */
class GOAPSuppress implements IOnlineStateHandler {
  private static SHOTS_NEEDED = 4;

  constructor(private hosts: Map<string, PathfindingNPCHost>) {}

  enter(ctx: INPCContext): void {
    const host = this.hosts.get(ctx.npcId)!;
    host.goapSuppressShotsFired = 0;
    console.log(`  [GOAP:Suppress ${ctx.npcId}] beginning suppressive fire (0/${GOAPSuppress.SHOTS_NEEDED})`);
    // [IMPROVEMENT 4] Broadcast suppression to squad mate
    broadcast(ctx.npcId, 'SUPPRESSING', currentTick);
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    const host = this.hosts.get(ctx.npcId)!;
    // Interrupts
    if (ctx.state.moraleState === 'PANICKED') { ctx.transition('FLEE'); return; }
    if (ctx.health && ctx.health.hpPercent < 0.2) { ctx.transition('WOUNDED'); return; }

    const grenade = ctx.danger?.getGrenadeDanger(ctx.x, ctx.y);
    if (grenade?.active) { ctx.transition('EVADE_GRENADE'); return; }

    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    if (enemies.length === 0) { ctx.transition('COMBAT'); return; }

    // Mid-action replan: enemy fleeing -> Pursue, ally in position -> push
    const enemyHost = npcHosts.get(enemies[0].id);
    if (enemyHost) {
      const enemyDriver = drivers.get(enemyHost.npcId);
      if (enemyHost.state.moraleState === 'PANICKED' || enemyDriver?.currentStateId === 'FLEE') {
        console.log(`  [GOAP:Suppress ${ctx.npcId}] enemy fleeing! -> replanning`);
        ctx.transition('COMBAT'); return;
      }
    }
    if (isSquadMateInPosition(ctx.npcId)) {
      console.log(`  [GOAP:Suppress ${ctx.npcId}] ally in position! -> replanning`);
      ctx.transition('COMBAT'); return;
    }

    const enemy = enemies[0];
    const now = ctx.now();

    // Fire at fire rate
    if (now - ctx.state.lastShootMs >= 500) {
      ctx.state.lastShootMs = now;
      host.goapSuppressShotsFired++;
      ctx.emitShoot({
        npcId: ctx.npcId, x: ctx.x, y: ctx.y,
        targetX: enemy.x, targetY: enemy.y, weaponType: 'rifle',
      });
      console.log(`  [GOAP:Suppress ${ctx.npcId}] shot ${host.goapSuppressShotsFired}/${GOAPSuppress.SHOTS_NEEDED}`);

      if (host.goapSuppressShotsFired >= GOAPSuppress.SHOTS_NEEDED) {
        console.log(`  [GOAP:Suppress ${ctx.npcId}] suppression complete`);
        host.goapActionIndex++;
        ctx.transition('COMBAT'); // back to director
      }
    }
  }

  exit(_ctx: INPCContext): void {}
}

/** GOAP_FLANK: pathfind to ambush position behind enemy via corridors. */
class GOAPFlank implements IOnlineStateHandler {
  constructor(private hosts: Map<string, PathfindingNPCHost>) {}

  enter(ctx: INPCContext): void {
    const host = this.hosts.get(ctx.npcId)!;
    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    if (enemies.length === 0) { ctx.transition('COMBAT'); return; }

    const enemy = enemies[0];
    const ambush = ctx.cover?.findCover(ctx.x, ctx.y, enemy.x, enemy.y, 'ambush');
    if (ambush) {
      host.goapFlankTarget = ambush;
      // [IMPROVEMENT 3] Use threat-aware pathfinding for flanking
      host.navigateToSafe(ambush.x, ambush.y);
      const route = describeRoute(findPath(ctx.x, ctx.y, ambush.x, ambush.y));
      console.log(
        `  [GOAP:Flank ${ctx.npcId}] -> ambush (${ambush.x},${ambush.y}), ` +
        `${host.getPathLength()} wp, ${route}`,
      );
      // [IMPROVEMENT 4] Broadcast flanking intention to squad mate
      broadcast(ctx.npcId, 'FLANKING', currentTick);
    } else {
      host.goapActionIndex++;
      ctx.transition('COMBAT');
    }
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    const host = this.hosts.get(ctx.npcId)!;
    // Interrupts
    if (ctx.state.moraleState === 'PANICKED') { ctx.transition('FLEE'); return; }
    if (ctx.health && ctx.health.hpPercent < 0.2) { ctx.transition('WOUNDED'); return; }

    const grenade = ctx.danger?.getGrenadeDanger(ctx.x, ctx.y);
    if (grenade?.active) { ctx.transition('EVADE_GRENADE'); return; }

    if (!isSquadMateAlive(ctx.npcId)) {
      console.log(`  [GOAP:Flank ${ctx.npcId}] squad mate down! -> replanning solo`);
      broadcast(ctx.npcId, 'NEED_HELP', currentTick);
      ctx.transition('COMBAT');
      return;
    }

    // Check arrival
    if (!host.isNavigating() && host.goapFlankTarget) {
      const dx = ctx.x - host.goapFlankTarget.x;
      const dy = ctx.y - host.goapFlankTarget.y;
      if (dx * dx + dy * dy < 30 * 30) {
        console.log(`  [GOAP:Flank ${ctx.npcId}] arrived at ambush position!`);
        // [IMPROVEMENT 4] Broadcast arrival to squad mate
        broadcast(ctx.npcId, 'IN_POSITION', currentTick);
        host.goapActionIndex++;
        ctx.transition('COMBAT'); // back to director -> next action
        return;
      }
    }
    // Still moving — path follower handles movement in tick()
  }

  exit(_ctx: INPCContext): void {}
}

/** GOAP_ATTACK: move toward enemy and shoot. Terminal action — stays until interrupted. */
class GOAPAttack implements IOnlineStateHandler {
  constructor(private hosts: Map<string, PathfindingNPCHost>) {}

  enter(ctx: INPCContext): void {
    console.log(`  [GOAP:Attack ${ctx.npcId}] engaging enemy`);
    const host = this.hosts.get(ctx.npcId)!;
    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    if (enemies.length > 0) {
      host.navigateTo(enemies[0].x, enemies[0].y);
    }
    // [IMPROVEMENT 4] Broadcast pushing to squad mate
    broadcast(ctx.npcId, 'PUSHING', currentTick);
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    const host = this.hosts.get(ctx.npcId)!;
    // Interrupts
    if (ctx.state.moraleState === 'PANICKED') { ctx.transition('FLEE'); return; }
    if (ctx.state.moraleState === 'SHAKEN') { ctx.transition('RETREAT'); return; }
    if (ctx.health && ctx.health.hpPercent < 0.2) { ctx.transition('WOUNDED'); return; }

    const grenade = ctx.danger?.getGrenadeDanger(ctx.x, ctx.y);
    if (grenade?.active) { ctx.transition('EVADE_GRENADE'); return; }

    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    if (enemies.length === 0) { ctx.transition('COMBAT'); return; } // lost target, replan

    const enemy = enemies[0];

    // Move toward enemy (re-pathfind periodically when path runs out)
    if (!host.isNavigating()) {
      host.navigateTo(enemy.x, enemy.y);
    }

    // Shoot
    const now = ctx.now();
    if (now - ctx.state.lastShootMs >= 500) {
      ctx.state.lastShootMs = now;
      ctx.emitShoot({
        npcId: ctx.npcId, x: ctx.x, y: ctx.y,
        targetX: enemy.x, targetY: enemy.y, weaponType: 'rifle',
      });
    }
  }

  exit(_ctx: INPCContext): void {}
}

/** GOAP_HEAL: use medkit and return to director. */
class GOAPHeal implements IOnlineStateHandler {
  constructor(private hosts: Map<string, PathfindingNPCHost>) {}

  enter(ctx: INPCContext): void {
    console.log(`  [GOAP:Heal ${ctx.npcId}] using medkit`);
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    const host = this.hosts.get(ctx.npcId)!;
    if (ctx.state.medkitCount > 0 && ctx.health) {
      ctx.state.medkitCount--;
      ctx.health.heal(35);
      console.log(`  [GOAP:Heal ${ctx.npcId}] healed! HP=${ctx.health.hp}`);
    }
    host.goapActionIndex++;
    ctx.transition('COMBAT'); // back to director
  }

  exit(_ctx: INPCContext): void {}
}

// ---------------------------------------------------------------------------
// GOAPPursue — chase a fleeing enemy
// ---------------------------------------------------------------------------

class GOAPPursue implements IOnlineStateHandler {
  constructor(private hosts: Map<string, PathfindingNPCHost>) {}

  enter(ctx: INPCContext): void {
    const host = this.hosts.get(ctx.npcId)!;
    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    if (enemies.length > 0) {
      host.navigateTo(enemies[0].x, enemies[0].y);
      console.log(`  [GOAP:Pursue ${ctx.npcId}] chasing fleeing enemy at (${enemies[0].x.toFixed(0)},${enemies[0].y.toFixed(0)})`);
    }
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    const host = this.hosts.get(ctx.npcId)!;
    if (ctx.state.moraleState === 'PANICKED') { ctx.transition('FLEE'); return; }

    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    if (enemies.length === 0) { ctx.transition('COMBAT'); return; }

    // Re-pathfind toward fleeing enemy
    if (!host.isNavigating()) {
      host.navigateTo(enemies[0].x, enemies[0].y);
    }

    // Shoot while pursuing
    const now = ctx.now();
    if (now - ctx.state.lastShootMs >= 500) {
      ctx.state.lastShootMs = now;
      ctx.emitShoot({ npcId: ctx.npcId, x: ctx.x, y: ctx.y, targetX: enemies[0].x, targetY: enemies[0].y, weaponType: 'rifle' });
    }

    // Close enough -> action done
    const dx = ctx.x - enemies[0].x;
    const dy = ctx.y - enemies[0].y;
    if (dx * dx + dy * dy < 80 * 80) {
      console.log(`  [GOAP:Pursue ${ctx.npcId}] caught up to enemy!`);
      host.goapActionIndex++;
      ctx.transition('COMBAT');
    }
  }

  exit(_ctx: INPCContext): void {}
}

// ---------------------------------------------------------------------------
// GOAPThrowGrenade — throw grenade at enemy position
// ---------------------------------------------------------------------------

class GOAPThrowGrenade implements IOnlineStateHandler {
  constructor(private hosts: Map<string, PathfindingNPCHost>) {}

  enter(ctx: INPCContext): void {
    console.log(`  [GOAP:Grenade ${ctx.npcId}] preparing to throw grenade`);
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    const host = this.hosts.get(ctx.npcId)!;
    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    if (enemies.length === 0) { ctx.transition('COMBAT'); return; }

    if (ctx.state.grenadeCount > 0) {
      ctx.state.grenadeCount--;
      const enemy = enemies[0];
      ctx.emitShoot({ npcId: ctx.npcId, x: ctx.x, y: ctx.y, targetX: enemy.x, targetY: enemy.y, weaponType: 'GRENADE' });
      console.log(`  [GOAP:Grenade ${ctx.npcId}] grenade thrown at (${enemy.x.toFixed(0)},${enemy.y.toFixed(0)})!`);

      // Register danger for the target
      dangers.addDanger({
        id: `grenade_${ctx.npcId}_${ctx.now()}`,
        type: DangerType.GRENADE,
        position: { x: enemy.x, y: enemy.y },
        radius: 60,
        threatScore: 0.9,
        remainingMs: 2_000,
      });

      // [IMPROVEMENT 3] Record threat at grenade impact
      recordThreat(enemy.x, enemy.y, 0.6);
    }

    host.goapActionIndex++;
    ctx.transition('COMBAT'); // back to director
  }

  exit(_ctx: INPCContext): void {}
}

// ---------------------------------------------------------------------------
// [IMPROVEMENT 5] GOAP_RELOAD — take cover and reload weapon
// ---------------------------------------------------------------------------

class GOAPReload implements IOnlineStateHandler {
  constructor(private hosts: Map<string, PathfindingNPCHost>) {}

  enter(ctx: INPCContext): void {
    const host = this.hosts.get(ctx.npcId)!;
    host.startReload();
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    const host = this.hosts.get(ctx.npcId)!;
    // Interrupts — even reloading can be interrupted
    if (ctx.state.moraleState === 'PANICKED') { ctx.transition('FLEE'); return; }
    const grenade = ctx.danger?.getGrenadeDanger(ctx.x, ctx.y);
    if (grenade?.active) { ctx.transition('EVADE_GRENADE'); return; }

    // Reload complete? (checked in host.tick already, but verify)
    if (!host.isReloading) {
      console.log(`  [GOAP:Reload ${ctx.npcId}] ready! ammo=${host.ammo}`);
      host.goapActionIndex++;
      ctx.transition('COMBAT');
    }
    // Otherwise wait — tick() handles reload timer
  }

  exit(_ctx: INPCContext): void {}
}

// ---------------------------------------------------------------------------
// [IMPROVEMENT 1] GOAP_SEARCH — move to last known enemy position from memory
// ---------------------------------------------------------------------------

class GOAPSearch implements IOnlineStateHandler {
  constructor(private hosts: Map<string, PathfindingNPCHost>) {}

  enter(ctx: INPCContext): void {
    const host = this.hosts.get(ctx.npcId)!;
    const bestMem = host.memory.getMostConfident();
    if (!bestMem || bestMem.confidence < 0.1) {
      console.log(`  [GOAP:Search ${ctx.npcId}] no memory to search, skipping`);
      host.goapActionIndex++;
      ctx.transition('COMBAT');
      return;
    }
    console.log(
      `  [GOAP:Search ${ctx.npcId}] moving to last known enemy pos ` +
      `(${bestMem.position.x.toFixed(0)},${bestMem.position.y.toFixed(0)}), ` +
      `confidence=${bestMem.confidence.toFixed(2)}`,
    );
    host.navigateToSafe(bestMem.position.x, bestMem.position.y);
  }

  update(ctx: INPCContext, _deltaMs: number): void {
    const host = this.hosts.get(ctx.npcId)!;
    // Interrupts
    if (ctx.state.moraleState === 'PANICKED') { ctx.transition('FLEE'); return; }
    if (ctx.health && ctx.health.hpPercent < 0.2) { ctx.transition('WOUNDED'); return; }

    const grenade = ctx.danger?.getGrenadeDanger(ctx.x, ctx.y);
    if (grenade?.active) { ctx.transition('EVADE_GRENADE'); return; }

    // Found enemy during search -> replan
    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    if (enemies.length > 0) {
      console.log(`  [GOAP:Search ${ctx.npcId}] enemy spotted during search! -> replanning`);
      host.goapActionIndex++;
      ctx.transition('COMBAT');
      return;
    }

    // Arrived at search location
    if (!host.isNavigating()) {
      console.log(`  [GOAP:Search ${ctx.npcId}] reached last known position, no enemy found`);
      host.goapActionIndex++;
      ctx.transition('COMBAT');
    }
  }

  exit(_ctx: INPCContext): void {}
}

// ---------------------------------------------------------------------------
// FSM drivers — GOAPDirector replaces CombatState as COMBAT handler
// ---------------------------------------------------------------------------

const goapDirector      = new GOAPDirector(npcHosts, getPlannerForNpc, buildNpcWorldState, combatGoal);
const goapTakeCover     = new GOAPTakeCover(npcHosts);
const goapSuppress      = new GOAPSuppress(npcHosts);
const goapFlank         = new GOAPFlank(npcHosts);
const goapAttack        = new GOAPAttack(npcHosts);
const goapHeal          = new GOAPHeal(npcHosts);
const goapPursue        = new GOAPPursue(npcHosts);
const goapThrowGrenade  = new GOAPThrowGrenade(npcHosts);
const goapSearch        = new GOAPSearch(npcHosts);

function makeHandlers() {
  return buildDefaultHandlerMap({ combatRange: 500, fireRateMs: 500 })
    .register(ONLINE_STATE.COMBAT, goapDirector)      // GOAPDirector replaces CombatState!
    .register('GOAP_TAKE_COVER', goapTakeCover)
    .register('GOAP_SUPPRESS',   goapSuppress)
    .register('GOAP_FLANK',      goapFlank)
    .register('GOAP_ATTACK',          goapAttack)
    .register('GOAP_HEAL',            goapHeal)
    .register('GOAP_PURSUE',          goapPursue)
    .register('GOAP_THROW_GRENADE',   goapThrowGrenade)
    .register('GOAP_SEARCH',          goapSearch)
    .register('GOAP_RELOAD',          new GOAPReload(npcHosts));
}

const drivers = new Map<string, OnlineAIDriver>();
for (const npc of allNPCs) {
  drivers.set(npc.npcId, new OnlineAIDriver(npc, makeHandlers(), ONLINE_STATE.IDLE));
}

// ---------------------------------------------------------------------------
// evaluateSituation() for a squad
// ---------------------------------------------------------------------------

function evaluateSquad(
  squadName: string,
  members: PathfindingNPCHost[],
  enemyCount: number,
): void {
  const alive = members.filter(m => m.isAlive());
  if (alive.length === 0) return;

  const avgMorale = alive.reduce((s, m) => s + m.state.morale, 0) / alive.length;
  const leader = members[0];
  const leaderInCover = leader.state.coverPointX !== 0 || leader.state.coverPointY !== 0;

  const situation: ISquadSituation = {
    squadSize:     alive.length,
    enemyCount,
    avgMorale,
    leaderInCover,
  };

  const command = evaluateSituation(situation, tacticsConfig);
  console.log(
    `  [TACTICS ${squadName}] size=${alive.length} enemies=${enemyCount} ` +
    `morale=${avgMorale.toFixed(2)} -> ${command}`,
  );
}

// ---------------------------------------------------------------------------
// ASCII arena renderer
// ---------------------------------------------------------------------------

function renderArena(tick: number): void {
  // Build character grid
  const grid: string[][] = [];
  for (let r = 0; r < ROWS; r++) {
    grid.push([]);
    for (let c = 0; c < COLS; c++) {
      // [IMPROVEMENT 3] Show high-threat tiles as 'x'
      const threat = threatMap.get(`${c},${r}`) ?? 0;
      if (MATRIX[r][c] === 1) {
        grid[r].push('#');
      } else if (threat > 0.5) {
        grid[r].push('x');
      } else {
        grid[r].push('.');
      }
    }
  }

  // Place NPC markers: A=alpha_lead, a=alpha_flank, B=bravo_lead, b=bravo_guard
  const markers: [PathfindingNPCHost, string][] = [
    [alphaLead,  'A'],
    [alphaFlank, 'a'],
    [bravoLead,  'B'],
    [bravoGuard, 'b'],
  ];

  for (const [npc, ch] of markers) {
    if (!npc.isAlive()) continue;
    const c = toTile(npc.x, COLS);
    const r = toTile(npc.y, ROWS);
    grid[r][c] = ch;
  }

  console.log(`\n  === Arena at tick ${tick} (A/a=Alpha, B/b=Bravo, x=threat, #=wall) ===`);
  for (let r = 0; r < ROWS; r++) {
    console.log('  ' + grid[r].join(''));
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Simulation loop
// ---------------------------------------------------------------------------

console.log('=== 2v2 Squad Assault with GOAP + Intelligence ===');
console.log(`  Arena: ${COLS}x${ROWS}, Alpha: lead[${alphaLead.personality}]+flank[${alphaFlank.personality}], Bravo: lead[${bravoLead.personality}]+guard[${bravoGuard.personality}]`);
console.log('');

const TOTAL_TICKS = 800;
const DELTA_MS    = 16;

const alphaMembers = [alphaLead, alphaFlank];
const bravoMembers = [bravoLead, bravoGuard];

let grenadeThrown = false;
let currentTick = 0;

// Render initial arena
renderArena(0);

for (let tick = 1; tick <= TOTAL_TICKS; tick++) {
  currentTick = tick;
  sharedClock += DELTA_MS;

  // 1. Perception sync + memory feed
  for (const [squad, enemies] of [[alphaMembers, bravoMembers], [bravoMembers, alphaMembers]] as const) {
    for (const npc of squad) {
      if (!npc.isAlive()) continue;
      const visible = enemies
        .filter(e => e.isAlive())
        .map(e => ({ id: e.npcId, x: e.x, y: e.y, factionId: e.factionId }));
      npc.perception.sync(visible, [], []);
      for (const enemy of visible) {
        npc.memory.remember({ sourceId: enemy.id, channel: MemoryChannel.VISUAL, position: { x: enemy.x, y: enemy.y }, confidence: 0.95 });
      }
      npc.memory.update(DELTA_MS / 1000);
    }
  }

  // 2. Update FSM drivers
  for (const npc of allNPCs) {
    if (!npc.isAlive()) continue;
    const driver = drivers.get(npc.npcId)!;
    const prevState = driver.currentStateId;
    npc.tick(driver, DELTA_MS);
    const newState = driver.currentStateId;
    if (prevState !== newState) {
      console.log(`  [t=${tick}] ${npc.npcId}: ${prevState} -> ${newState}`);
    }
  }

  // 3. Process shoots — ammo consumption, anticipation, threat recording
  for (const npc of allNPCs) {
    while (npc.shoots.length > 0) {
      const shot = npc.shoots.shift()!;

      // [IMPROVEMENT 5] Consume ammo. If empty → auto-start reload.
      if (shot.weaponType !== 'GRENADE') {
        npc.ammo--;
        if (npc.ammo <= 0 && !npc.isReloading) {
          npc.startReload();
        }
      }

      const target = allNPCs.find(
        t => t.npcId !== npc.npcId && t.factionId !== npc.factionId && t.isAlive(),
      );
      if (!target) continue;

      // [IMPROVEMENT 6] Anticipation — predict where enemy will be and adjust accuracy.
      // If shooter tracks enemy velocity, shots at moving targets are more accurate.
      const predicted = npc.predictEnemyPos(200);  // 200ms lead time
      let accuracy = 0.67;
      if (predicted) {
        // If NPC shoots at predicted position, accuracy bonus
        const predDist = Math.sqrt((predicted.x - target.x) ** 2 + (predicted.y - target.y) ** 2);
        if (predDist < 30) accuracy += 0.1;  // good prediction = better aim
      }

      const hit = npc.random() < accuracy;
      if (hit) {
        target.setHp(target.getHp() - 10);
        console.log(
          `  [t=${tick}] ${npc.npcId} hits ${target.npcId} for 10 HP ` +
          `(${target.getHp()} remaining, ammo=${npc.ammo})`,
        );
        recordThreat(target.x, target.y, 0.35);
        target.memory.remember({ sourceId: npc.npcId, channel: MemoryChannel.HIT, position: { x: npc.x, y: npc.y }, confidence: 1.0 });
        npc.totalKills += target.getHp() <= 0 ? 1 : 0;
        const targetSquad = target.factionId === 'loner' ? alphaMembers : bravoMembers;
        for (const member of targetSquad) {
          if (member.npcId !== target.npcId) member.state.morale = Math.max(-1, member.state.morale - 0.12);
        }
      }
    }
  }

  // 4. Squad evaluation + memory/threat log + ASCII arena (every 60 ticks)
  if (tick % 60 === 0) {
    console.log(`\n  --- Evaluation at tick ${tick} ---`);
    evaluateSquad('Alpha', alphaMembers, bravoMembers.filter(m => m.isAlive()).length);
    evaluateSquad('Bravo', bravoMembers, alphaMembers.filter(m => m.isAlive()).length);
    for (const npc of allNPCs) {
      if (!npc.isAlive()) continue;
      const best = npc.memory.getMostConfident();
      if (best) console.log(`  [MEMORY ${npc.npcId}] ${npc.memory.size} recs, best: ${best.sourceId} conf=${best.confidence.toFixed(2)}`);
    }
    if (threatMap.size > 0) console.log(`  [THREAT MAP] ${threatMap.size} active tiles`);
    renderArena(tick);
  }

  // 5. Grenade event at tick 180
  if (tick === 180 && !grenadeThrown) {
    grenadeThrown = true;
    console.log(`  [t=${tick}] bravo_lead throws a grenade at Alpha position!`);
    bravoLead.state.grenadeCount = 0;
    dangers.addDanger({ id: 'grenade_bl_01', type: DangerType.GRENADE, position: { x: alphaLead.x, y: alphaLead.y }, radius: 60, threatScore: 0.9, remainingMs: 2_000 });
    recordThreat(alphaLead.x, alphaLead.y, 0.7);
  }

  // 6. Morale state update
  for (const npc of allNPCs) {
    if (!npc.isAlive()) continue;
    if (npc.state.morale <= -0.7) {
      npc.state.moraleState = 'PANICKED';
    } else if (npc.state.morale <= -0.3) {
      npc.state.moraleState = 'SHAKEN';
    } else {
      npc.state.moraleState = 'STABLE';
    }
  }

  // 7. Death checks + threat recording + NEED_HELP broadcast
  for (const npc of allNPCs) {
    if (npc.getHp() <= 0 && npc.isAlive()) {
      npc.setHp(0);
      console.log(`  [t=${tick}] ${npc.npcId} is DOWN!`);
      recordThreat(npc.x, npc.y, 0.8);
      const squad = npc.factionId === 'loner' ? alphaMembers : bravoMembers;
      for (const member of squad) {
        if (member.npcId === npc.npcId) continue;
        member.state.morale = Math.max(-1, member.state.morale - 0.35);
        console.log(`  [t=${tick}] ${member.npcId} morale=${member.state.morale.toFixed(2)} (ally down)`);
        broadcast(member.npcId, 'NEED_HELP', tick);
      }
    }
  }

  // 8. Decay dangers, threats, prune comms
  dangers.update(DELTA_MS);
  decayThreats();
  pruneOldComms(tick);

  // 9. Early exit
  const alphaAlive = alphaMembers.some(m => m.isAlive());
  const bravoAlive = bravoMembers.some(m => m.isAlive());

  if (!alphaAlive || !bravoAlive) {
    console.log('');
    if (!alphaAlive && !bravoAlive) {
      console.log(`  [t=${tick}] MUTUAL DESTRUCTION -- both squads eliminated`);
    } else if (!bravoAlive) {
      console.log(`  [t=${tick}] ALPHA VICTORY -- Bravo squad eliminated`);
    } else {
      console.log(`  [t=${tick}] BRAVO VICTORY -- Alpha squad eliminated`);
    }
    break;
  }
}

console.log('\n=== Final Status ===');
for (const npc of allNPCs) {
  const driver = drivers.get(npc.npcId)!;
  const host = npcHosts.get(npc.npcId)!;
  const plan = host.goapPlan?.map((a, i) => i === host.goapActionIndex ? `[${a.id}]` : a.id).join('->') ?? '(none)';
  const best = host.memory.getMostConfident();
  const mem = best ? `mem=${host.memory.size}(${best.sourceId}@${best.confidence.toFixed(2)})` : `mem=0`;
  console.log(`  ${npc.npcId}[${host.personality}] HP=${npc.getHp()} state=${driver.currentStateId} morale=${npc.state.morale.toFixed(2)} ${mem} plan=${plan}`);
}
if (squadComms.length > 0) {
  console.log(`\n=== Last ${Math.min(8, squadComms.length)} Comms ===`);
  for (const c of squadComms.slice(-8)) console.log(`  [t=${c.tick}] ${c.from}: "${c.type}"`);
}
if (threatMap.size > 0) {
  console.log(`\n=== Threat Map: ${threatMap.size} tiles ===`);
  [...threatMap.entries()].filter(([,v]) => v > 0.3).sort((a,b) => b[1]-a[1]).slice(0,5)
    .forEach(([k, v]) => console.log(`  ${k}: ${v.toFixed(2)}`));
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

for (const driver of drivers.values()) driver.destroy();

console.log('');
console.log('=== Intelligence Systems ===');
console.log('  1. MemoryBank: visual decay 0.08/s, hit decay 0.03/s -> SearchLastKnown action');
console.log('  2. Personality: aggressive/cautious/balanced/flanker modify GOAP action costs');
console.log('  3. ThreatMap: hit/death tiles get high cost in A*, decay 0.002/tick');
console.log('  4. Comms: SUPPRESSING/FLANKING/IN_POSITION/PUSHING/NEED_HELP broadcasts');
