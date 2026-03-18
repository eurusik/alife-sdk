/**
 * 21-squad-assault.ts — 2v2 squad tactical combat with SDK GOAPDirector, A* pathfinding,
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
  INPCContext,
  IPathfindingAccess,
} from '@alife-sdk/ai/states';
import {
  OnlineAIDriver,
  NPCPerception,
  createDefaultNPCOnlineState,
  buildDefaultHandlerMap,
  ONLINE_STATE,
} from '@alife-sdk/ai/states';

import { GOAPDirector } from '@alife-sdk/ai/goap';

/** Local alias — avoids cascading `any` if the barrel .d.ts is stale. */
interface IGOAPActionHandler {
  enter(ctx: INPCContext): void;
  update(ctx: INPCContext, deltaMs: number): 'running' | 'success' | 'failure';
  exit(ctx: INPCContext): void;
}

import {
  SquadSharedTargetTable,
  evaluateSituation,
} from '@alife-sdk/ai/squad';
import type { ISquadSituation } from '@alife-sdk/ai/squad';
import type { ISquadTacticsConfig } from '@alife-sdk/ai/types';

import { GOAPPlanner, WorldState, DangerManager, DangerType, MemoryBank, MemoryChannel } from '@alife-sdk/core/ai';
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
  wall(4, 2, 8, 4);
  wall(4, 7, 8, 9);
  wall(24, 2, 28, 4);
  wall(24, 7, 28, 9);
  wall(13, 4, 18, 7);

  // --- Bottom half (mirror) ---
  wall(4, 12, 8, 14);
  wall(4, 17, 8, 18);
  wall(24, 12, 28, 14);
  wall(24, 17, 28, 18);
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

  const raw = finder.findPath(c0, r0, c1, r1, pfGrid.clone());
  return raw.map(([c, r]) => ({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 }));
}

/** Describe path direction for logging (north/south around center). */
function describeRoute(path: { x: number; y: number }[]): string {
  if (path.length < 2) return 'direct';
  const minY = Math.min(...path.map(p => p.y));
  const maxY = Math.max(...path.map(p => p.y));
  const midY = H / 2;
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
// Personality system — GOAP cost modifiers per archetype
// ---------------------------------------------------------------------------

type Personality = 'aggressive' | 'cautious' | 'balanced' | 'flanker';

const PERSONALITY_COSTS: Record<Personality, Partial<Record<string, number>>> = {
  aggressive: { TakeCover: +2, RushAttack: -3, Flank: -1, Suppress: +1, Attack: -1 },
  cautious:   { TakeCover: -1, Suppress: -1, RushAttack: +3, Flank: +2, CoverAlly: -1 },
  balanced:   {},
  flanker:    { Flank: -2, FlankAttack: -1, TakeCover: +1, Suppress: +2, Pursue: -1 },
};

// ---------------------------------------------------------------------------
// Threat mapping — track dangerous tiles
// ---------------------------------------------------------------------------

const threatMap = new Map<string, number>();
const THREAT_DECAY_RATE = 0.002;
const THREAT_RADIUS = 2;

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
  for (const [key, threat] of threatMap) {
    if (threat > 0.5) {
      const [tx, ty] = key.split(',').map(Number);
      if ((tx === c0 && ty === r0) || (tx === c1 && ty === r1)) continue;
      grid.setWalkableAt(tx, ty, false);
    }
  }

  const raw = finder.findPath(c0, r0, c1, r1, grid);
  if (raw.length === 0) {
    return findPath(fromX, fromY, toX, toY);
  }
  return raw.map(([c, r]) => ({ x: c * TILE + TILE / 2, y: r * TILE + TILE / 2 }));
}

// ---------------------------------------------------------------------------
// Communication protocol — squad-mate broadcasts
// ---------------------------------------------------------------------------

interface SquadComm {
  readonly from: string;
  readonly type: 'SUPPRESSING' | 'FLANKING' | 'IN_POSITION' | 'NEED_HELP' | 'PUSHING';
  readonly tick: number;
}

const squadComms: SquadComm[] = [];
const MAX_COMM_AGE = 120;

function broadcast(from: string, type: SquadComm['type'], tick: number): void {
  squadComms.push({ from, type, tick });
  console.log(`  [COMMS ${from}] "${type}"`);
}

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

function pruneOldComms(tick: number): void {
  while (squadComms.length > 0 && (tick - squadComms[0].tick) >= MAX_COMM_AGE) {
    squadComms.shift();
  }
}

// ---------------------------------------------------------------------------
// GridPathfinding — IPathfindingAccess backed by A* + threat-awareness
// ---------------------------------------------------------------------------

class GridPathfinding implements IPathfindingAccess {
  private _path: { x: number; y: number }[] = [];
  private _cursor = 0;

  constructor(private _host: { x: number; y: number }) {}

  findPath(targetX: number, targetY: number): ReadonlyArray<{ x: number; y: number }> | null {
    const rawPath = findPathThreatAware(this._host.x, this._host.y, targetX, targetY);
    this._path = rawPath;
    this._cursor = rawPath.length > 0 ? 1 : 0; // skip start cell
    return rawPath.length > 0 ? rawPath : null;
  }

  getNextWaypoint(): { x: number; y: number } | null {
    if (this._cursor >= this._path.length) return null;
    const wp = this._path[this._cursor];
    const dx = this._host.x - wp.x;
    const dy = this._host.y - wp.y;
    if (dx * dx + dy * dy < 16 * 16) this._cursor++;
    return this._cursor < this._path.length ? this._path[this._cursor] : null;
  }

  setPath(waypoints: ReadonlyArray<{ x: number; y: number }>): void {
    this._path = [...waypoints];
    this._cursor = 0;
  }

  isNavigating(): boolean { return this._cursor < this._path.length; }

  clearPath(): void { this._path = []; this._cursor = 0; }
}

// ---------------------------------------------------------------------------
// PathfindingNPCHost — IOnlineDriverHost with A* navigation
// ---------------------------------------------------------------------------

class PathfindingNPCHost implements IOnlineDriverHost {
  readonly state = createDefaultNPCOnlineState();
  readonly perception = new NPCPerception();
  readonly pathfinding: GridPathfinding;

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
  private _moveSpeed = 120;

  // Resource awareness
  ammo = 12;
  maxAmmo = 12;
  isReloading = false;
  reloadStartMs = 0;
  reloadDurationMs = 2000;
  totalKills = 0;

  // Anticipation — track enemy velocity
  lastEnemyX = 0;
  lastEnemyY = 0;
  enemyVx = 0;
  enemyVy = 0;

  // MemoryBank — per-NPC episodic memory
  readonly memory: MemoryBank;

  // Personality — modifies GOAP action costs
  readonly personality: Personality;

  constructor(id: string, faction: string, type: string, x: number, y: number, personality: Personality = 'balanced') {
    this.npcId      = id;
    this.factionId  = faction;
    this.entityType = type;
    this.x          = x;
    this.y          = y;
    this._rng       = new SeededRandom(hashCode(id));
    this.personality = personality;
    this.pathfinding = new GridPathfinding(this);
    this.memory     = new MemoryBank({
      timeFn: () => this._nowMs / 1000,
      maxRecords: 10,
      channelDecayRates: {
        [MemoryChannel.VISUAL]: 0.08,
        [MemoryChannel.SOUND]:  0.15,
        [MemoryChannel.HIT]:    0.03,
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

    // Auto-complete reload after duration
    if (this.isReloading && this._nowMs - this.reloadStartMs >= this.reloadDurationMs) {
      this.isReloading = false;
      this.ammo = this.maxAmmo;
      console.log(`  [RELOAD ${this.npcId}] reload complete! ammo=${this.ammo}`);
    }

    // Track enemy velocity for anticipation
    const enemies = this.perception.getVisibleEnemies();
    if (enemies.length > 0) {
      const e = enemies[0];
      if (this.lastEnemyX !== 0) {
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

  predictEnemyPos(lookAheadMs: number): { x: number; y: number } | null {
    if (this.lastEnemyX === 0) return null;
    return {
      x: this.lastEnemyX + this.enemyVx * (lookAheadMs / 1000),
      y: this.lastEnemyY + this.enemyVy * (lookAheadMs / 1000),
    };
  }

  startReload(): boolean {
    if (this.isReloading) return false;
    this.isReloading = true;
    this.reloadStartMs = this._nowMs;
    console.log(`  [RELOAD ${this.npcId}] reloading... (${this.reloadDurationMs}ms)`);
    return true;
  }

  /** Advance along path each tick. */
  private _advancePath(deltaMs: number): void {
    if (!this.pathfinding.isNavigating()) return;

    const wp = this.pathfinding.getNextWaypoint();
    if (!wp) return;

    const dx     = wp.x - this.x;
    const dy     = wp.y - this.y;
    const dist   = Math.sqrt(dx * dx + dy * dy);
    const step   = this._moveSpeed * (deltaMs / 1000);

    if (dist <= step) {
      this.x = wp.x;
      this.y = wp.y;
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

interface ActionTemplate {
  id: string;
  baseCost: number;
  preconditions: Record<string, boolean>;
  effects: Record<string, boolean>;
  utilityCostFn?: (host: PathfindingNPCHost) => number;
}

const ACTION_TEMPLATES: ActionTemplate[] = [
  {
    id: 'TakeCover', baseCost: 3, preconditions: {}, effects: { inCover: true },
    utilityCostFn: (h) => {
      const squad = h.factionId === 'loner' ? alphaMembers : bravoMembers;
      const allInCover = squad.filter(m => m.isAlive() && m.state.hasTakenCover).length;
      return allInCover >= 2 ? +2 : 0;
    },
  },
  {
    id: 'Flank', baseCost: 3, preconditions: { inCover: true }, effects: { hasFlankPosition: true },
    utilityCostFn: (h) => h.getHp() >= 70 ? -1 : +1,
  },
  {
    id: 'Pursue', baseCost: 2, preconditions: { enemyFleeing: true },
    effects: { enemyInRange: true, hasFlankPosition: true },
  },
  {
    id: 'SearchLastKnown', baseCost: 4, preconditions: { hasMemoryOfEnemy: true },
    effects: { seeEnemy: true, enemyInRange: true },
  },
  {
    id: 'Suppress', baseCost: 3,
    preconditions: { inCover: true, hasAmmo: true, seeEnemy: true },
    effects: { enemySuppressed: true },
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
    utilityCostFn: (h) => {
      let mod = 0;
      mod -= h.totalKills * 2;
      const enemies = h.perception.getVisibleEnemies();
      if (enemies.length > 0) {
        const eHost = npcHosts.get(enemies[0].id);
        if (eHost?.isReloading) mod -= 3;
      }
      return mod;
    },
  },
  { id: 'HealSelf', baseCost: 1, preconditions: { hasMedkit: true }, effects: { isHealthy: true } },
  {
    id: 'Reload', baseCost: 2,
    preconditions: { lowAmmo: true, inCover: true },
    effects: { hasAmmo: true, lowAmmo: false },
    utilityCostFn: (h) => h.state.hasTakenCover ? -1 : +3,
  },
];

const combatGoal = WorldState.from({ targetEliminated: true });

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
const alphaMembers = [alphaLead, alphaFlank];
const bravoMembers = [bravoLead, bravoGuard];

// Equip: rifle + 1 grenade + 1 medkit. Pre-expire cover cooldown.
for (const npc of allNPCs) {
  npc.state.primaryWeapon    = 'rifle';
  npc.state.grenadeCount     = 1;
  npc.state.medkitCount      = 1;
  npc.state.lastSeekCoverMs  = -3_000;
}

// Wire cover, danger, squad.
alphaLead.cover  = createCoverAccess('lead');
alphaFlank.cover = createCoverAccess('flanker');
bravoLead.cover  = createCoverAccess('lead');
bravoGuard.cover = createCoverAccess('flanker');

for (const npc of allNPCs) npc.danger = createDangerAccess();

alphaLead.squad  = createSquadAccess('alpha_lead',  'alpha_lead');
alphaFlank.squad = createSquadAccess('alpha_flank', 'alpha_lead');
bravoLead.squad  = createSquadAccess('bravo_lead',  'bravo_lead');
bravoGuard.squad = createSquadAccess('bravo_guard', 'bravo_lead');

// ---------------------------------------------------------------------------
// NPC host lookup + squad helpers
// ---------------------------------------------------------------------------

const npcHosts = new Map<string, PathfindingNPCHost>();
for (const npc of allNPCs) npcHosts.set(npc.npcId, npc);

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
  return ((mate.state.custom ?? {}) as Record<string, unknown>).__goapActiveHandler === 'Flank';
}

function isSquadMateInPosition(npcId: string): boolean {
  const mate = getSquadMate(npcId);
  if (!mate || !mate.isAlive()) return false;
  const handler = ((mate.state.custom ?? {}) as Record<string, unknown>).__goapActiveHandler;
  return handler === 'Attack' || handler === 'FlankAttack' || handler === 'CoordinatedAttack' ||
         handler === 'SoloAssault' || handler === 'RushAttack';
}

// ---------------------------------------------------------------------------
// Build WorldState from INPCContext (SDK GOAPDirector passes ctx, not host)
// ---------------------------------------------------------------------------

let currentTick = 0;

function buildNpcWorldState(ctx: INPCContext): WorldState {
  const host = npcHosts.get(ctx.npcId)!;
  const enemies = ctx.perception?.getVisibleEnemies() ?? [];
  const inCover = ctx.state.hasTakenCover;

  let enemyFleeing = false, enemyInCover = false, enemyInRange = false;
  if (enemies.length > 0) {
    const enemyHost = npcHosts.get(enemies[0].id);
    if (enemyHost) {
      enemyFleeing = enemyHost.state.moraleState === 'PANICKED';
      enemyInCover = enemyHost.state.hasTakenCover;
      const dx = enemies[0].x - ctx.x, dy = enemies[0].y - ctx.y;
      enemyInRange = Math.sqrt(dx * dx + dy * dy) < 200;
    }
  }

  const allyFlanking   = isSquadMateFlanking(ctx.npcId);
  const allyInPosition = isSquadMateInPosition(ctx.npcId);
  const allyDead       = !isSquadMateAlive(ctx.npcId);

  const startX = ctx.npcId.startsWith('alpha') ? 2 * TILE + 8 : 30 * TILE + 8;
  const startY = (ctx.npcId.includes('flank') || ctx.npcId.includes('guard')) ? 15 * TILE + 8 : 5 * TILE + 8;
  const moved = Math.sqrt((ctx.x - startX) ** 2 + (ctx.y - startY) ** 2);

  const mySquad = host.factionId === 'loner' ? alphaMembers : bravoMembers;
  const enemySquad = host.factionId === 'loner' ? bravoMembers : alphaMembers;
  const outnumbered = enemySquad.filter(m => m.isAlive()).length > mySquad.filter(m => m.isAlive()).length;

  const bestMemory = host.memory.getMostConfident();
  const hasMemoryOfEnemy = bestMemory !== undefined && bestMemory.confidence > 0.2;
  const dangerousArea = isInDangerousArea(ctx.x, ctx.y);
  const mateComm = getLatestCommFromMate(ctx.npcId, currentTick);
  const allyRequestingCover = mateComm !== null && (mateComm.type === 'FLANKING' || mateComm.type === 'NEED_HELP');

  const suppressShots = ((ctx.state.custom ?? {}) as Record<string, unknown>).suppressShotsFired as number ?? 0;

  return WorldState.from({
    isHealthy: host.getHp() >= 50, inCover,
    hasAmmo: host.ammo > 0 && !host.isReloading,
    lowAmmo: host.ammo <= 5 && host.ammo > 0,
    hasMedkit: ctx.state.medkitCount > 0, hasGrenade: ctx.state.grenadeCount > 0,
    hasFlankPosition: moved > 120,
    seeEnemy: enemies.length > 0, enemyFleeing, enemyInCover, enemyInRange,
    enemySuppressed: suppressShots >= 4,
    allyFlanking: allyFlanking || (allyRequestingCover && mateComm?.type === 'FLANKING'),
    allyInPosition, allyDead, outnumbered,
    hasMemoryOfEnemy, dangerousArea,
  });
}

// ---------------------------------------------------------------------------
// GOAP Action Handlers (IGOAPActionHandler) — stateless, use ctx.state.custom
// ---------------------------------------------------------------------------

const SUPPRESS_SHOTS_NEEDED = 4;

const takeCoverHandler: IGOAPActionHandler = {
  enter(ctx) {
    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    if (enemies.length === 0) return;
    const enemy = enemies[0];
    const coverPt = ctx.cover?.findCover(ctx.x, ctx.y, enemy.x, enemy.y, 'close');
    if (coverPt) {
      ctx.state.custom = { ...(ctx.state.custom ?? {}), coverTarget: coverPt };
      ctx.pathfinding?.findPath(coverPt.x, coverPt.y);
      const host = npcHosts.get(ctx.npcId)!;
      console.log(`  [GOAP:TakeCover ${ctx.npcId}] -> cover (${coverPt.x},${coverPt.y}), ${host.pathfinding.isNavigating() ? 'navigating' : 'no path'}`);
    }
  },
  update(ctx, _dt) {
    const coverTarget = (ctx.state.custom ?? {}).coverTarget as { x: number; y: number } | undefined;
    if (!coverTarget) return 'failure';
    if (!ctx.pathfinding?.isNavigating()) {
      const dx = ctx.x - coverTarget.x;
      const dy = ctx.y - coverTarget.y;
      if (dx * dx + dy * dy < 20 * 20) {
        console.log(`  [GOAP:TakeCover ${ctx.npcId}] arrived at cover`);
        ctx.state.hasTakenCover = true;
        return 'success';
      }
      // Re-path if not arrived but path exhausted
      ctx.pathfinding?.findPath(coverTarget.x, coverTarget.y);
    }
    return 'running';
  },
  exit(_ctx) {},
};

const suppressHandler: IGOAPActionHandler = {
  enter(ctx) {
    ctx.state.custom = { ...(ctx.state.custom ?? {}), suppressShotsFired: 0 };
    console.log(`  [GOAP:Suppress ${ctx.npcId}] beginning suppressive fire (0/${SUPPRESS_SHOTS_NEEDED})`);
    broadcast(ctx.npcId, 'SUPPRESSING', currentTick);
  },
  update(ctx, _dt) {
    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    if (enemies.length === 0) return 'failure';

    // Mid-action replan triggers
    const enemyHost = npcHosts.get(enemies[0].id);
    if (enemyHost?.state.moraleState === 'PANICKED') {
      console.log(`  [GOAP:Suppress ${ctx.npcId}] enemy fleeing! -> replanning`);
      return 'failure';
    }
    if (isSquadMateInPosition(ctx.npcId)) {
      console.log(`  [GOAP:Suppress ${ctx.npcId}] ally in position! -> replanning`);
      return 'failure';
    }

    const now = ctx.now();
    if (now - ctx.state.lastShootMs >= 500) {
      ctx.state.lastShootMs = now;
      const shotsFired = ((ctx.state.custom ?? {}).suppressShotsFired as number ?? 0) + 1;
      ctx.state.custom = { ...(ctx.state.custom ?? {}), suppressShotsFired: shotsFired };
      const enemy = enemies[0];
      ctx.emitShoot({ npcId: ctx.npcId, x: ctx.x, y: ctx.y, targetX: enemy.x, targetY: enemy.y, weaponType: 'rifle' });
      console.log(`  [GOAP:Suppress ${ctx.npcId}] shot ${shotsFired}/${SUPPRESS_SHOTS_NEEDED}`);

      if (shotsFired >= SUPPRESS_SHOTS_NEEDED) {
        console.log(`  [GOAP:Suppress ${ctx.npcId}] suppression complete`);
        return 'success';
      }
    }
    return 'running';
  },
  exit(_ctx) {},
};

const flankHandler: IGOAPActionHandler = {
  enter(ctx) {
    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    if (enemies.length === 0) return;
    const enemy = enemies[0];
    const ambush = ctx.cover?.findCover(ctx.x, ctx.y, enemy.x, enemy.y, 'ambush');
    if (ambush) {
      ctx.state.custom = { ...(ctx.state.custom ?? {}), flankTarget: ambush };
      ctx.pathfinding?.findPath(ambush.x, ambush.y);
      const route = describeRoute(findPath(ctx.x, ctx.y, ambush.x, ambush.y));
      console.log(`  [GOAP:Flank ${ctx.npcId}] -> ambush (${ambush.x},${ambush.y}), ${route}`);
      broadcast(ctx.npcId, 'FLANKING', currentTick);
    }
  },
  update(ctx, _dt) {
    const flankTarget = (ctx.state.custom ?? {}).flankTarget as { x: number; y: number } | undefined;
    if (!flankTarget) return 'failure';

    if (!isSquadMateAlive(ctx.npcId)) {
      console.log(`  [GOAP:Flank ${ctx.npcId}] squad mate down! -> replanning solo`);
      broadcast(ctx.npcId, 'NEED_HELP', currentTick);
      return 'failure';
    }

    if (!ctx.pathfinding?.isNavigating()) {
      const dx = ctx.x - flankTarget.x;
      const dy = ctx.y - flankTarget.y;
      if (dx * dx + dy * dy < 30 * 30) {
        console.log(`  [GOAP:Flank ${ctx.npcId}] arrived at ambush position!`);
        broadcast(ctx.npcId, 'IN_POSITION', currentTick);
        return 'success';
      }
    }
    return 'running';
  },
  exit(_ctx) {},
};

const attackHandler: IGOAPActionHandler = {
  enter(ctx) {
    console.log(`  [GOAP:Attack ${ctx.npcId}] engaging enemy`);
    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    if (enemies.length > 0) {
      ctx.pathfinding?.findPath(enemies[0].x, enemies[0].y);
    }
    broadcast(ctx.npcId, 'PUSHING', currentTick);
  },
  update(ctx, _dt) {
    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    if (enemies.length === 0) return 'failure';

    const enemy = enemies[0];
    if (!ctx.pathfinding?.isNavigating()) {
      ctx.pathfinding?.findPath(enemy.x, enemy.y);
    }

    const now = ctx.now();
    if (now - ctx.state.lastShootMs >= 500) {
      ctx.state.lastShootMs = now;
      ctx.emitShoot({ npcId: ctx.npcId, x: ctx.x, y: ctx.y, targetX: enemy.x, targetY: enemy.y, weaponType: 'rifle' });
    }
    return 'running'; // terminal action — stays until interrupted
  },
  exit(_ctx) {},
};

const healHandler: IGOAPActionHandler = {
  enter(ctx) {
    console.log(`  [GOAP:Heal ${ctx.npcId}] using medkit`);
  },
  update(ctx, _dt) {
    if (ctx.state.medkitCount > 0 && ctx.health) {
      ctx.state.medkitCount--;
      ctx.health.heal(35);
      console.log(`  [GOAP:Heal ${ctx.npcId}] healed! HP=${ctx.health.hp}`);
    }
    return 'success';
  },
  exit(_ctx) {},
};

const pursueHandler: IGOAPActionHandler = {
  enter(ctx) {
    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    if (enemies.length > 0) {
      ctx.pathfinding?.findPath(enemies[0].x, enemies[0].y);
      console.log(`  [GOAP:Pursue ${ctx.npcId}] chasing fleeing enemy at (${enemies[0].x.toFixed(0)},${enemies[0].y.toFixed(0)})`);
    }
  },
  update(ctx, _dt) {
    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    if (enemies.length === 0) return 'failure';

    if (!ctx.pathfinding?.isNavigating()) {
      ctx.pathfinding?.findPath(enemies[0].x, enemies[0].y);
    }

    const now = ctx.now();
    if (now - ctx.state.lastShootMs >= 500) {
      ctx.state.lastShootMs = now;
      ctx.emitShoot({ npcId: ctx.npcId, x: ctx.x, y: ctx.y, targetX: enemies[0].x, targetY: enemies[0].y, weaponType: 'rifle' });
    }

    const dx = ctx.x - enemies[0].x;
    const dy = ctx.y - enemies[0].y;
    if (dx * dx + dy * dy < 80 * 80) {
      console.log(`  [GOAP:Pursue ${ctx.npcId}] caught up to enemy!`);
      return 'success';
    }
    return 'running';
  },
  exit(_ctx) {},
};

const throwGrenadeHandler: IGOAPActionHandler = {
  enter(ctx) {
    console.log(`  [GOAP:Grenade ${ctx.npcId}] preparing to throw grenade`);
  },
  update(ctx, _dt) {
    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    if (enemies.length === 0) return 'failure';

    if (ctx.state.grenadeCount > 0) {
      ctx.state.grenadeCount--;
      const enemy = enemies[0];
      ctx.emitShoot({ npcId: ctx.npcId, x: ctx.x, y: ctx.y, targetX: enemy.x, targetY: enemy.y, weaponType: 'GRENADE' });
      console.log(`  [GOAP:Grenade ${ctx.npcId}] grenade thrown at (${enemy.x.toFixed(0)},${enemy.y.toFixed(0)})!`);

      dangers.addDanger({
        id: `grenade_${ctx.npcId}_${ctx.now()}`,
        type: DangerType.GRENADE,
        position: { x: enemy.x, y: enemy.y },
        radius: 60,
        threatScore: 0.9,
        remainingMs: 2_000,
      });
      recordThreat(enemy.x, enemy.y, 0.6);
    }
    return 'success';
  },
  exit(_ctx) {},
};

const searchHandler: IGOAPActionHandler = {
  enter(ctx) {
    const host = npcHosts.get(ctx.npcId)!;
    const bestMem = host.memory.getMostConfident();
    if (!bestMem || bestMem.confidence < 0.1) {
      console.log(`  [GOAP:Search ${ctx.npcId}] no memory to search, skipping`);
      return;
    }
    console.log(
      `  [GOAP:Search ${ctx.npcId}] moving to last known enemy pos ` +
      `(${bestMem.position.x.toFixed(0)},${bestMem.position.y.toFixed(0)}), ` +
      `confidence=${bestMem.confidence.toFixed(2)}`,
    );
    ctx.pathfinding?.findPath(bestMem.position.x, bestMem.position.y);
  },
  update(ctx, _dt) {
    const host = npcHosts.get(ctx.npcId)!;
    const bestMem = host.memory.getMostConfident();
    if (!bestMem || bestMem.confidence < 0.1) return 'failure';

    const enemies = ctx.perception?.getVisibleEnemies() ?? [];
    if (enemies.length > 0) {
      console.log(`  [GOAP:Search ${ctx.npcId}] enemy spotted during search! -> replanning`);
      return 'success';
    }

    if (!ctx.pathfinding?.isNavigating()) {
      console.log(`  [GOAP:Search ${ctx.npcId}] reached last known position, no enemy found`);
      return 'success';
    }
    return 'running';
  },
  exit(_ctx) {},
};

const reloadHandler: IGOAPActionHandler = {
  enter(ctx) {
    const host = npcHosts.get(ctx.npcId)!;
    host.startReload();
  },
  update(ctx, _dt) {
    const host = npcHosts.get(ctx.npcId)!;
    if (!host.isReloading) {
      console.log(`  [GOAP:Reload ${ctx.npcId}] ready! ammo=${host.ammo}`);
      return 'success';
    }
    return 'running';
  },
  exit(_ctx) {},
};

// ---------------------------------------------------------------------------
// SDK GOAPDirector — COMBAT handler, replans on every entry
// ---------------------------------------------------------------------------

/**
 * Creates the SDK GOAPDirector for a specific NPC. Each NPC gets its own
 * director because the planner is rebuilt per-replan with utility costs.
 */
function createGoapDirector(host: PathfindingNPCHost): GOAPDirector {
  // Dynamic planner wrapper — rebuilds utility costs on each plan() call.
  // Uses IGOAPPlannerLike interface (not concrete GOAPPlanner class).
  const dynamicPlanner = {
    plan(ws: WorldState, goal: WorldState) {
      return createUtilityPlanner(host).plan(ws, goal);
    },
  };

  return new GOAPDirector(dynamicPlanner, {
    buildWorldState: (ctx: INPCContext) => {
      // Log memory influence only when no direct visual and memory drives plan
      const enemies = ctx.perception?.getVisibleEnemies() ?? [];
      if (enemies.length === 0) {
        const bestMem = host.memory.getMostConfident();
        if (bestMem && bestMem.confidence > 0.2) {
          console.log(
            `  [MEMORY ${ctx.npcId}] enemy last seen at ` +
            `(${bestMem.position.x.toFixed(0)},${bestMem.position.y.toFixed(0)}), ` +
            `confidence ${bestMem.confidence.toFixed(2)}`,
          );
        }
      }
      return buildNpcWorldState(ctx);
    },
    goal: combatGoal,
    actionHandlers: {
      TakeCover:         takeCoverHandler,
      Suppress:          suppressHandler,
      CoverAlly:         suppressHandler,
      Flank:             flankHandler,
      Pursue:            pursueHandler,
      Attack:            attackHandler,
      CoordinatedAttack: attackHandler,
      FlankAttack:       attackHandler,
      SoloAssault:       attackHandler,
      RushAttack:        attackHandler,
      ThrowGrenade:      throwGrenadeHandler,
      HealSelf:          healHandler,
      SearchLastKnown:   searchHandler,
      Reload:            reloadHandler,
    },
    interrupts: [
      { condition: (ctx: INPCContext) => ctx.state.moraleState === 'PANICKED', targetState: 'FLEE' },
      { condition: (ctx: INPCContext) => ctx.state.moraleState === 'SHAKEN', targetState: 'RETREAT' },
      { condition: (ctx: INPCContext) => ctx.health !== null && ctx.health.hpPercent < 0.2, targetState: 'WOUNDED' },
      { condition: (ctx: INPCContext) => ctx.danger?.getGrenadeDanger(ctx.x, ctx.y)?.active ?? false, targetState: 'EVADE_GRENADE' },
    ],
    onNoPlan: (ctx: INPCContext, _dt: number) => {
      // Fallback uses memory when no enemies visible
      const enemies = ctx.perception?.getVisibleEnemies() ?? [];
      if (enemies.length > 0) {
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
        const bestMem = host.memory.getMostConfident();
        if (bestMem && bestMem.confidence > 0.15 && !ctx.pathfinding?.isNavigating()) {
          console.log(
            `  [MEMORY ${ctx.npcId}] searching last known pos ` +
            `(${bestMem.position.x.toFixed(0)},${bestMem.position.y.toFixed(0)}), ` +
            `conf=${bestMem.confidence.toFixed(2)}`,
          );
          ctx.pathfinding?.findPath(bestMem.position.x, bestMem.position.y);
        }
      }
    },
  });
}

// ---------------------------------------------------------------------------
// FSM drivers — one SDK GOAPDirector per NPC as COMBAT handler
// ---------------------------------------------------------------------------

function makeHandlers(host: PathfindingNPCHost) {
  return buildDefaultHandlerMap({ combatRange: 500, fireRateMs: 500 })
    .register(ONLINE_STATE.COMBAT, createGoapDirector(host));
}

const drivers = new Map<string, OnlineAIDriver>();
for (const npc of allNPCs) {
  const driver = new OnlineAIDriver(npc, makeHandlers(npc), ONLINE_STATE.IDLE);
  // Use driver.onTransition() instead of manual prevState/currentState comparison
  driver.onTransition((from: string, to: string) => {
    console.log(`  [t=${currentTick}] ${npc.npcId}: ${from} -> ${to}`);
  });
  drivers.set(npc.npcId, driver);
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
  const grid: string[][] = [];
  for (let r = 0; r < ROWS; r++) {
    grid.push([]);
    for (let c = 0; c < COLS; c++) {
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

let grenadeThrown = false;

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

  // 2. Update FSM drivers (onTransition callback handles logging)
  for (const npc of allNPCs) {
    if (!npc.isAlive()) continue;
    const driver = drivers.get(npc.npcId)!;
    npc.tick(driver, DELTA_MS);
  }

  // 3. Process shoots — ammo consumption, anticipation, threat recording
  for (const npc of allNPCs) {
    while (npc.shoots.length > 0) {
      const shot = npc.shoots.shift()!;

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

      const predicted = npc.predictEnemyPos(200);
      let accuracy = 0.67;
      if (predicted) {
        const predDist = Math.sqrt((predicted.x - target.x) ** 2 + (predicted.y - target.y) ** 2);
        if (predDist < 30) accuracy += 0.1;
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
  const custom = (host.state.custom ?? {}) as Record<string, unknown>;
  const plan = (custom.__goapPlan as Array<{ id: string }> | undefined);
  const idx  = (custom.__goapIndex as number | undefined) ?? 0;
  const planStr = plan?.map((a, i) => i === idx ? `[${a.id}]` : a.id).join('->') ?? '(none)';
  const best = host.memory.getMostConfident();
  const mem = best ? `mem=${host.memory.size}(${best.sourceId}@${best.confidence.toFixed(2)})` : `mem=0`;
  console.log(`  ${npc.npcId}[${host.personality}] HP=${npc.getHp()} state=${driver.currentStateId} morale=${npc.state.morale.toFixed(2)} ${mem} plan=${planStr}`);
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
