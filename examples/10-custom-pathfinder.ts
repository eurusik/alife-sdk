/**
 * 10-custom-pathfinder.ts
 *
 * Demonstrates how to replace the built-in movement simulator with a
 * custom IMovementSimulator implementation — for example a grid-based
 * pathfinder (PathfinderJS, EasyStar, etc.) instead of the default
 * straight-line or waypoint-graph movement.
 *
 * Run with:
 *   npx tsx --tsconfig examples/tsconfig.json examples/10-custom-pathfinder.ts
 *
 * What we build here:
 *   - A minimal grid-based GridMovementSimulator (no external deps)
 *     that walks NPCs cell-by-cell along a Manhattan path
 *   - A SimulationPlugin wired to use it via `movementSimulator`
 *   - Two NPCs navigating to terrains far from their start — visible
 *     mid-journey positions printed each tick
 *
 * In a real game you would replace GridMovementSimulator with an adapter
 * that delegates to PathfinderJS, EasyStar, or your engine's navmesh.
 * The SimulationPlugin only sees IMovementSimulator — it doesn't care
 * what powers the pathfinding underneath.
 *
 * Priority order when SimulationPlugin resolves movement:
 *   1. movementSimulator (this example)  ← custom, highest priority
 *   2. levelGraph                        ← waypoint-graph (GraphMovementSimulator)
 *   3. (default)                         ← straight-line (MovementSimulator)
 */

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { ALifeKernel, Ports, FactionBuilder, ALifeEvents } from '@alife-sdk/core';
import { FactionsPlugin, SmartTerrain } from '@alife-sdk/core';
import type {
  IEntityAdapter,
  IEntityFactory,
  IPlayerPositionProvider,
  Vec2,
  EventBus,
  ALifeEventPayloads,
} from '@alife-sdk/core';

import { SimulationPlugin, SimulationPorts, createNoOpBridge } from '@alife-sdk/simulation';
import type { IMovementSimulator } from '@alife-sdk/simulation';

// ---------------------------------------------------------------------------
// GridMovementSimulator
//
// A simple grid-based movement simulator that walks NPCs cell-by-cell along
// a Manhattan path. This is a stand-in for PathfinderJS — in a real project
// you would call `finder.findPath(grid.clone(), ...)` here and follow the
// returned cell array.
//
// Key contract: on journey completion, emit ALifeEvents.NPC_MOVED via the
// SDK EventBus. This is how SimulationPlugin knows the NPC has arrived.
// Without it, the brain never re-evaluates and journeys silently disappear.
//
// We wire the EventBus via setEvents() after kernel.init() — the bus is not
// available before that.
// ---------------------------------------------------------------------------

const CELL_SIZE = 64; // world units per grid cell

/**
 * Compute a Manhattan path (X-axis first, then Y) between two world positions.
 *
 * In a real PathfinderJS adapter, replace this body with:
 *   const grid   = new PF.Grid(mapW, mapH);
 *   const finder = new PF.AStarFinder();
 *   const cells  = finder.findPath(cx0, cy0, cx1, cy1, grid.clone());
 *   return cells.map(([x, y]) => ({ x: x * CELL_SIZE, y: y * CELL_SIZE }));
 */
function manhattanPath(from: Vec2, to: Vec2): Vec2[] {
  const path: Vec2[] = [];
  let cx = Math.round(from.x / CELL_SIZE) * CELL_SIZE;
  let cy = Math.round(from.y / CELL_SIZE) * CELL_SIZE;
  const tx = Math.round(to.x / CELL_SIZE) * CELL_SIZE;
  const ty = Math.round(to.y / CELL_SIZE) * CELL_SIZE;

  while (cx !== tx) {
    cx += cx < tx ? CELL_SIZE : -CELL_SIZE;
    path.push({ x: cx, y: cy });
  }
  while (cy !== ty) {
    cy += cy < ty ? CELL_SIZE : -CELL_SIZE;
    path.push({ x: cx, y: cy });
  }

  if (path.length === 0) path.push({ x: cx, y: cy }); // already at destination
  return path;
}

interface IJourney {
  path: Vec2[];
  stepIndex: number;
  stepProgress: number; // ms elapsed on current cell transition
  stepDuration: number; // ms per cell (= CELL_SIZE / speed * 1000)
  fromZone: string;
  toZone: string;
}

class GridMovementSimulator implements IMovementSimulator {
  private readonly _journeys = new Map<string, IJourney>();

  // EventBus is injected after kernel.init() via setEvents().
  // The bus is required to emit NPC_MOVED when a journey completes —
  // without it SimulationPlugin won't know the NPC arrived.
  private _events: EventBus<ALifeEventPayloads> | null = null;

  /** Call this once after kernel.init() to wire the event bus. */
  setEvents(events: EventBus<ALifeEventPayloads>): void {
    this._events = events;
  }

  // -------------------------------------------------------------------------
  // IMovementDispatcher (called by NPCBrain / BrainScheduleManager)
  // -------------------------------------------------------------------------

  addMovingNPC(
    npcId: string,
    fromTerrainId: string,
    toTerrainId: string,
    fromPos: Vec2,
    toPos: Vec2,
    speed = 30, // world units per second — slow enough to see mid-journey positions
  ): void {
    const path = manhattanPath(fromPos, toPos);
    const stepDuration = (CELL_SIZE / speed) * 1000; // ms per cell

    process.stdout.write(
      `  [Grid] addMovingNPC: "${npcId}" ${path.length} cell(s) ` +
      `from=(${fromPos.x},${fromPos.y}) to=(${toPos.x},${toPos.y}) ` +
      `"${fromTerrainId}"→"${toTerrainId}" speed=${speed} stepDuration=${stepDuration.toFixed(0)}ms\n`,
    );

    this._journeys.set(npcId, {
      path,
      stepIndex: 0,
      stepProgress: 0,
      stepDuration,
      fromZone: fromTerrainId,
      toZone: toTerrainId,
    });
  }

  isMoving(npcId: string): boolean {
    return this._journeys.has(npcId);
  }

  cancelJourney(npcId: string): void {
    this._journeys.delete(npcId);
  }

  // -------------------------------------------------------------------------
  // IMovementSimulator — called every tick by SimulationPlugin
  // -------------------------------------------------------------------------

  update(deltaMs: number): void {
    const completed: string[] = [];

    for (const [npcId, journey] of this._journeys) {
      journey.stepProgress += deltaMs;

      while (journey.stepProgress >= journey.stepDuration) {
        journey.stepProgress -= journey.stepDuration;
        journey.stepIndex++;

        if (journey.stepIndex >= journey.path.length) {
          completed.push(npcId);
          break;
        }
      }
    }

    for (const npcId of completed) {
      const j = this._journeys.get(npcId)!;
      this._journeys.delete(npcId);

      // Emit NPC_MOVED so SimulationPlugin / the brain know the NPC arrived.
      // This is the critical line — matching what MovementSimulator does.
      this._events?.emit(ALifeEvents.NPC_MOVED, {
        npcId,
        fromZone: j.fromZone,
        toZone:   j.toZone,
      });
    }
  }

  getPosition(npcId: string): Vec2 | null {
    const j = this._journeys.get(npcId);
    if (!j) return null;
    const idx = Math.min(j.stepIndex, j.path.length - 1);
    return j.path[idx];
  }

  get activeCount(): number { return this._journeys.size; }

  clear(): void { this._journeys.clear(); }
}

// ---------------------------------------------------------------------------
// Minimal port stubs (same pattern as 01-hello-npc.ts)
// ---------------------------------------------------------------------------

const stubEntityAdapter: IEntityAdapter = {
  getPosition:       (_id: string) => null,
  isAlive:           (_id: string) => true,
  hasComponent:      (_id: string, _name: string) => false,
  getComponentValue: <T>(_id: string, _name: string): T | null => null,
  setPosition:       (_id: string, _pos: Vec2) => {},
  setActive:         (_id: string, _active: boolean) => {},
  setVisible:        (_id: string, _visible: boolean) => {},
  setVelocity:       (_id: string, _vel: Vec2) => {},
  getVelocity:       (_id: string) => ({ x: 0, y: 0 }),
  setRotation:       (_id: string, _rad: number) => {},
  teleport:          (_id: string, _pos: Vec2) => {},
  disablePhysics:    (_id: string) => {},
  setAlpha:          (_id: string, _alpha: number) => {},
  playAnimation:     (_id: string, _key: string) => {},
  hasAnimation:      (_id: string, _key: string) => false,
};

let _entityCounter = 0;
const stubEntityFactory: IEntityFactory = {
  createNPC:     (_req: unknown) => `npc_${++_entityCounter}`,
  createMonster: (_req: unknown) => `mon_${++_entityCounter}`,
  destroyEntity: (_id: string) => {},
};

const stubPlayerPosition: IPlayerPositionProvider = {
  getPlayerPosition: () => ({ x: -9999, y: -9999 }), // far away → all NPCs stay offline
};

// ---------------------------------------------------------------------------
// Build the kernel
// ---------------------------------------------------------------------------

const kernel = new ALifeKernel();

kernel.provide(Ports.EntityAdapter,  stubEntityAdapter);
kernel.provide(Ports.EntityFactory,  stubEntityFactory);
kernel.provide(Ports.PlayerPosition, stubPlayerPosition);
kernel.provide(SimulationPorts.SimulationBridge, createNoOpBridge());

// ---------------------------------------------------------------------------
// Factions
// ---------------------------------------------------------------------------

const factionsPlugin = new FactionsPlugin();
factionsPlugin.factions.register(
  'stalker',
  new FactionBuilder('stalker').displayName('Stalker').relation('bandit', -80).build(),
);
factionsPlugin.factions.register(
  'bandit',
  new FactionBuilder('bandit').displayName('Bandit').relation('stalker', -80).build(),
);

// ---------------------------------------------------------------------------
// Custom movement simulator
//
// Created before SimulationPlugin so it can be passed in config.
// EventBus is wired after kernel.init() via gridMover.setEvents(kernel.events).
// ---------------------------------------------------------------------------

const gridMover = new GridMovementSimulator();

// ---------------------------------------------------------------------------
// SimulationPlugin — wired to the custom grid movement simulator
//
// movementSimulator takes priority over levelGraph and the default simulator.
// ---------------------------------------------------------------------------

const sim = new SimulationPlugin({
  tickIntervalMs: 2_000, // short tick so we see movement across several ticks

  // Inject the custom movement simulator here — one field, no SDK changes needed.
  movementSimulator: gridMover,
});

// ---------------------------------------------------------------------------
// Terrains
//
// Both NPCs start at (256, 256). Terrains are placed far away so the
// grid movement spans several ticks and positions are visible mid-journey.
//
// Both NPCs choose warehouse_b (capacity 4, higher score) over warehouse_a
// (capacity 1, lower score) and follow the same 8-cell Manhattan path.
// ---------------------------------------------------------------------------

const warehouseA = new SmartTerrain({
  id:       'warehouse_a',
  name:     'Warehouse A',
  bounds:   { x: 512, y: 0, width: 128, height: 128 },
  capacity: 1,
  jobs: [
    { type: 'guard', slots: 1, position: { x: 576, y: 64 } },
  ],
});

const warehouseB = new SmartTerrain({
  id:       'warehouse_b',
  name:     'Warehouse B',
  bounds:   { x: 0, y: 512, width: 128, height: 128 },
  capacity: 4,
  jobs: [
    { type: 'patrol', slots: 2 },
    { type: 'guard',  slots: 2, position: { x: 64, y: 576 } },
  ],
});

sim.addTerrain(warehouseA);
sim.addTerrain(warehouseB);

kernel.use(factionsPlugin);
kernel.use(sim);

kernel.init();
kernel.start();

// Wire the EventBus now that kernel.init() has run.
// GridMovementSimulator needs it to emit NPC_MOVED when journeys complete.
gridMover.setEvents(kernel.events);

// ---------------------------------------------------------------------------
// Event listeners
// ---------------------------------------------------------------------------

kernel.events.on(ALifeEvents.TICK, ({ tick, delta }) => {
  console.log(`\n[TICK ${tick}] delta=${delta}ms | in transit: ${gridMover.activeCount} NPC(s)`);
});

kernel.events.on(ALifeEvents.NPC_MOVED, ({ npcId, fromZone, toZone }) => {
  console.log(`  -> NPC_MOVED "${npcId}": "${fromZone}" → "${toZone}"`);
});

kernel.events.on(ALifeEvents.TASK_ASSIGNED, ({ npcId, terrainId, taskType }) => {
  console.log(`  -> TASK_ASSIGNED "${npcId}" → "${taskType}" @ "${terrainId}"`);
});

// ---------------------------------------------------------------------------
// Register NPCs
//
// Both NPCs start equidistant from both terrains at (256, 256).
// The brain scores terrains and assigns each NPC to the best available slot.
// Capacity=1 on warehouse_a forces one NPC to warehouse_b.
// ---------------------------------------------------------------------------

sim.registerNPC({
  entityId:    'stalker_fox',
  factionId:   'stalker',
  position:    { x: 256, y: 256 },
  rank:        2,
  combatPower: 60,
  currentHp:   100,
  behaviorConfig: {
    retreatThreshold: 0.2,
    panicThreshold:   -0.7,
    searchIntervalMs: 2_000,
    dangerTolerance:  3,
    aggression:       0.5,
  },
  options: { type: 'human' },
});

sim.registerNPC({
  entityId:    'bandit_krot',
  factionId:   'bandit',
  position:    { x: 256, y: 256 },
  rank:        1,
  combatPower: 35,
  currentHp:   80,
  behaviorConfig: {
    retreatThreshold: 0.3,
    panicThreshold:   -0.5,
    searchIntervalMs: 2_000,
    dangerTolerance:  2,
    aggression:       0.8,
  },
  options: { type: 'human' },
});

// ---------------------------------------------------------------------------
// Simulation loop — 12 ticks × 2 000 ms
//
// At speed=30px/s and CELL_SIZE=64, each cell takes ~2 133 ms.
// A path of ~10 cells takes ~21 000 ms = ~10 ticks — visible mid-journey.
// ---------------------------------------------------------------------------

console.log('--- Custom grid pathfinder demo (12 ticks × 2 000 ms) ---');

const TICKS = 12;
const DELTA = 2_001;

for (let i = 0; i < TICKS; i++) {
  kernel.update(DELTA);

  const foxPos  = gridMover.getPosition('stalker_fox');
  const krotPos = gridMover.getPosition('bandit_krot');
  const foxBrain  = sim.getNPCBrain('stalker_fox');
  const krotBrain = sim.getNPCBrain('bandit_krot');

  console.log(
    `  stalker_fox : target="${foxBrain?.currentTerrainId ?? 'none'}" ` +
    `grid=${foxPos  ? `(${foxPos.x},${foxPos.y})`   : 'arrived'}`,
  );
  console.log(
    `  bandit_krot : target="${krotBrain?.currentTerrainId ?? 'none'}" ` +
    `grid=${krotPos ? `(${krotPos.x},${krotPos.y})` : 'arrived'}`,
  );
}

kernel.destroy();
console.log('\nDone.');
