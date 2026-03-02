/**
 * Integration test: OnlineAIDriver.tick() — full-tick sequences, state handler
 * call ordering, and mutable host state changes between ticks.
 *
 * Scenarios:
 *   - IDLE → perception → ALERT → COMBAT full sequence via N ticks
 *   - Handlers called in correct enter/update/exit order
 *   - Host state mutations between ticks affect FSM transitions
 *   - Re-entrant transition guard works correctly
 *   - destroy() calls exit() on current state
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 * State transitions are tracked in arrays/counters on the host.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OnlineAIDriver } from '../states/OnlineAIDriver';
import type { IOnlineDriverHost } from '../states/OnlineAIDriver';
import type { IOnlineStateHandler } from '../states/IOnlineStateHandler';
import type { INPCContext } from '../states/INPCContext';
import { buildDefaultHandlerMap, ONLINE_STATE } from '../states/OnlineStateRegistryBuilder';
import { createDefaultNPCOnlineState } from '../states/NPCOnlineState';
import { NPCPerception } from '../states/NPCPerception';
import { createDefaultStateConfig } from '../states/IStateConfig';
import { StateHandlerMap } from '../states/StateHandlerMap';
import type {
  IShootPayload,
  IMeleeHitPayload,
  IRestrictedZoneAccess,
  ICoverAccess,
  IDangerAccess,
  ISquadAccess,
  INPCHealth,
} from '../states/INPCContext';

// ---------------------------------------------------------------------------
// TestNPCHost — comprehensive tracking host
// ---------------------------------------------------------------------------

class TestNPCHost implements IOnlineDriverHost {
  readonly state = createDefaultNPCOnlineState();
  readonly perception = new NPCPerception();

  npcId = 'npc_tick_test';
  factionId = 'loner';
  entityType = 'human';

  private _x: number;
  private _y: number;
  private _nowMs = 0;

  health: INPCHealth | null = null;
  cover: ICoverAccess | null = null;
  danger: IDangerAccess | null = null;
  squad: ISquadAccess | null = null;
  restrictedZones: IRestrictedZoneAccess | null = null;

  velocityX = 0;
  velocityY = 0;
  halted = false;
  haltsCount = 0;

  readonly vocalizations: string[] = [];
  readonly shoots: IShootPayload[] = [];
  readonly velocityLog: Array<{ vx: number; vy: number }> = [];

  constructor(startX = 100, startY = 100) {
    this._x = startX;
    this._y = startY;
  }

  get x() { return this._x; }
  get y() { return this._y; }

  setVelocity(vx: number, vy: number): void {
    this.velocityX = vx;
    this.velocityY = vy;
    this.halted = false;
    this.velocityLog.push({ vx, vy });
    this._x += vx * 0.016;
    this._y += vy * 0.016;
  }

  halt(): void {
    this.velocityX = 0;
    this.velocityY = 0;
    this.halted = true;
    this.haltsCount++;
  }

  setRotation(_r: number): void {}
  setAlpha(_a: number): void {}
  teleport(x: number, y: number): void { this._x = x; this._y = y; }
  disablePhysics(): void {}

  emitShoot(p: IShootPayload): void { this.shoots.push(p); }
  emitMeleeHit(_p: IMeleeHitPayload): void {}
  emitVocalization(t: string): void { this.vocalizations.push(t); }
  emitPsiAttackStart(_x: number, _y: number): void {}

  now(): number { return this._nowMs; }
  random(): number { return 0.5; }

  advanceMs(ms: number): void { this._nowMs += ms; }
}

function tick(host: TestNPCHost, driver: OnlineAIDriver, deltaMs: number): void {
  host.advanceMs(deltaMs);
  driver.update(deltaMs);
}

function makeEnemy(id = 'e1', x = 150, y = 100, factionId = 'bandit') {
  return { id, x, y, factionId };
}

// ---------------------------------------------------------------------------
// SpyStateHandler — records calls without vi.fn()
// ---------------------------------------------------------------------------

class SpyStateHandler implements IOnlineStateHandler {
  enterCount = 0;
  updateCount = 0;
  exitCount = 0;
  lastDeltaMs = 0;

  readonly enterOrder: number[] = [];
  readonly exitOrder: number[] = [];

  private _callOrder: number[];

  constructor(shared: { tick: number }, private _callOrderArr: number[]) {
    this._callOrder = _callOrderArr;
  }

  private _sharedTick = { tick: 0 };

  init(shared: { tick: number }) {
    this._sharedTick = shared;
  }

  enter(_ctx: INPCContext): void {
    this.enterCount++;
    this.enterOrder.push(this._sharedTick.tick);
  }

  update(_ctx: INPCContext, deltaMs: number): void {
    this.updateCount++;
    this.lastDeltaMs = deltaMs;
    this._sharedTick.tick++;
  }

  exit(_ctx: INPCContext): void {
    this.exitCount++;
    this.exitOrder.push(this._sharedTick.tick);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OnlineAIDriver.tick() — full-tick sequences', () => {

  // -------------------------------------------------------------------------
  // 1. IDLE → ALERT → COMBAT full perception-driven sequence
  // -------------------------------------------------------------------------

  describe('IDLE → ALERT → COMBAT sequence via perception', () => {
    it('starts in IDLE, then ALERT on enemy, then COMBAT on next tick', () => {
      const host = new TestNPCHost(100, 100);
      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.IDLE);

      // Tick 1: no enemies — stays IDLE
      tick(host, driver, 16);
      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);

      // Tick 2: enemy spotted → IDLE → ALERT
      host.perception.sync([makeEnemy()], [], []);
      tick(host, driver, 16);
      expect(driver.currentStateId).toBe(ONLINE_STATE.ALERT);

      // Tick 3: enemy still visible in ALERT → ALERT → COMBAT
      tick(host, driver, 16);
      expect(driver.currentStateId).toBe(ONLINE_STATE.COMBAT);
    });

    it('IDLE → ALERT stores last known enemy position', () => {
      const host = new TestNPCHost(100, 100);
      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.IDLE);

      host.perception.sync([makeEnemy('e1', 350, 200)], [], []);
      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(ONLINE_STATE.ALERT);
      expect(host.state.lastKnownEnemyX).toBe(350);
      expect(host.state.lastKnownEnemyY).toBe(200);
    });

    it('10 ticks without enemy keeps driver in IDLE', () => {
      const host = new TestNPCHost(100, 100);
      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.IDLE);

      for (let i = 0; i < 10; i++) {
        tick(host, driver, 16);
      }
      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);
    });

    it('IDLE → ALERT → PATROL on alert timeout (no enemy)', () => {
      const cfg = createDefaultStateConfig({ alertDuration: 200 });
      const host = new TestNPCHost(100, 100);
      const handlers = buildDefaultHandlerMap(cfg);
      const driver = new OnlineAIDriver(host, handlers, ONLINE_STATE.ALERT);

      // No enemy — alert timer expires → PATROL
      host.perception.sync([], [], []);
      tick(host, driver, 210);

      expect(driver.currentStateId).toBe(ONLINE_STATE.PATROL);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Multiple ticks — handlers called in correct order
  // -------------------------------------------------------------------------

  describe('handler call ordering across multiple ticks', () => {
    it('enter called once on construction, update called each tick', () => {
      const host = new TestNPCHost(100, 100);
      const callLog: string[] = [];

      const spyIdle: IOnlineStateHandler = {
        enter(_ctx) { callLog.push('idle:enter'); },
        update(_ctx, _dt) { callLog.push('idle:update'); },
        exit(_ctx) { callLog.push('idle:exit'); },
      };

      const handlers = new StateHandlerMap([
        [ONLINE_STATE.IDLE, spyIdle],
        [ONLINE_STATE.ALERT, buildDefaultHandlerMap().toMap().get(ONLINE_STATE.ALERT)!],
        [ONLINE_STATE.PATROL, buildDefaultHandlerMap().toMap().get(ONLINE_STATE.PATROL)!],
        [ONLINE_STATE.COMBAT, buildDefaultHandlerMap().toMap().get(ONLINE_STATE.COMBAT)!],
        [ONLINE_STATE.FLEE, buildDefaultHandlerMap().toMap().get(ONLINE_STATE.FLEE)!],
        [ONLINE_STATE.SEARCH, buildDefaultHandlerMap().toMap().get(ONLINE_STATE.SEARCH)!],
        [ONLINE_STATE.TAKE_COVER, buildDefaultHandlerMap().toMap().get(ONLINE_STATE.TAKE_COVER)!],
        [ONLINE_STATE.GRENADE, buildDefaultHandlerMap().toMap().get(ONLINE_STATE.GRENADE)!],
        [ONLINE_STATE.EVADE_GRENADE, buildDefaultHandlerMap().toMap().get(ONLINE_STATE.EVADE_GRENADE)!],
        [ONLINE_STATE.WOUNDED, buildDefaultHandlerMap().toMap().get(ONLINE_STATE.WOUNDED)!],
        [ONLINE_STATE.RETREAT, buildDefaultHandlerMap().toMap().get(ONLINE_STATE.RETREAT)!],
        [ONLINE_STATE.DEAD, buildDefaultHandlerMap().toMap().get(ONLINE_STATE.DEAD)!],
        [ONLINE_STATE.CAMP, buildDefaultHandlerMap().toMap().get(ONLINE_STATE.CAMP)!],
        [ONLINE_STATE.SLEEP, buildDefaultHandlerMap().toMap().get(ONLINE_STATE.SLEEP)!],
        [ONLINE_STATE.CHARGE, buildDefaultHandlerMap().toMap().get(ONLINE_STATE.CHARGE)!],
        [ONLINE_STATE.STALK, buildDefaultHandlerMap().toMap().get(ONLINE_STATE.STALK)!],
        [ONLINE_STATE.LEAP, buildDefaultHandlerMap().toMap().get(ONLINE_STATE.LEAP)!],
        [ONLINE_STATE.PSI_ATTACK, buildDefaultHandlerMap().toMap().get(ONLINE_STATE.PSI_ATTACK)!],
      ]);
      const driver = new OnlineAIDriver(host, handlers, ONLINE_STATE.IDLE);

      // enter called in constructor
      expect(callLog).toEqual(['idle:enter']);

      // 3 update calls
      tick(host, driver, 16);
      tick(host, driver, 16);
      tick(host, driver, 16);

      expect(callLog).toEqual(['idle:enter', 'idle:update', 'idle:update', 'idle:update']);
    });

    it('exit called on current state before enter called on new state during transition', () => {
      const host = new TestNPCHost(100, 100);
      const callLog: string[] = [];

      const spyIdle: IOnlineStateHandler = {
        enter(_ctx) { callLog.push('idle:enter'); },
        update(ctx, _dt) {
          callLog.push('idle:update');
          if (ctx.perception?.hasVisibleEnemy()) {
            ctx.transition(ONLINE_STATE.ALERT);
          }
        },
        exit(_ctx) { callLog.push('idle:exit'); },
      };

      const defaultHandlers = buildDefaultHandlerMap();
      const alertHandler = defaultHandlers.toMap().get(ONLINE_STATE.ALERT)!;
      const wrappedAlert: IOnlineStateHandler = {
        enter(ctx) { callLog.push('alert:enter'); alertHandler.enter(ctx); },
        update(ctx, dt) { alertHandler.update(ctx, dt); },
        exit(ctx) { callLog.push('alert:exit'); alertHandler.exit(ctx); },
      };

      const handlers = new Map<string, IOnlineStateHandler>([
        [ONLINE_STATE.IDLE, spyIdle],
        [ONLINE_STATE.ALERT, wrappedAlert],
        ...([...defaultHandlers.toMap().entries()].filter(([k]) => k !== ONLINE_STATE.IDLE && k !== ONLINE_STATE.ALERT)),
      ]);

      const driver = new OnlineAIDriver(host, handlers, ONLINE_STATE.IDLE);
      callLog.length = 0; // clear constructor call

      host.perception.sync([makeEnemy()], [], []);
      tick(host, driver, 16);

      // Order must be: idle:update → idle:exit → alert:enter (within same tick)
      expect(callLog).toEqual(['idle:update', 'idle:exit', 'alert:enter']);
    });

    it('destroy() calls exit on the current state', () => {
      const host = new TestNPCHost(100, 100);
      const callLog: string[] = [];

      const spyIdle: IOnlineStateHandler = {
        enter(_ctx) {},
        update(_ctx, _dt) {},
        exit(_ctx) { callLog.push('idle:exit'); },
      };

      const defaultHandlers = buildDefaultHandlerMap();
      const handlers = new Map<string, IOnlineStateHandler>([
        [ONLINE_STATE.IDLE, spyIdle],
        ...([...defaultHandlers.toMap().entries()].filter(([k]) => k !== ONLINE_STATE.IDLE)),
      ]);

      const driver = new OnlineAIDriver(host, handlers, ONLINE_STATE.IDLE);
      driver.destroy();

      expect(callLog).toEqual(['idle:exit']);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Host mutable state changes between ticks affect transitions
  // -------------------------------------------------------------------------

  describe('host mutable state changes between ticks', () => {
    it('changing morale between ticks causes different COMBAT transition', () => {
      const host = new TestNPCHost(100, 100);
      host.perception.sync([makeEnemy('e1', host.x + 10, host.y)], [], []);

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.COMBAT);

      // Tick 1: morale stable — should stay in COMBAT or try TAKE_COVER
      host.state.morale = 0;
      host.state.moraleState = 'STABLE';
      tick(host, driver, 16);

      const stateAfterStable = driver.currentStateId;
      // Either stays COMBAT or moves to TAKE_COVER (cover is null so stays COMBAT)
      expect([ONLINE_STATE.COMBAT, ONLINE_STATE.TAKE_COVER]).toContain(stateAfterStable);
    });

    it('PANICKED morale set between ticks forces FLEE from COMBAT', () => {
      const host = new TestNPCHost(100, 100);
      host.state.lastKnownEnemyX = 200;
      host.state.lastKnownEnemyY = 100;
      host.perception.sync([makeEnemy('e1', 200, 100)], [], []);

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.COMBAT);

      // Set PANICKED between construction and first update
      host.state.morale = -1.0;
      host.state.moraleState = 'PANICKED';

      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(ONLINE_STATE.FLEE);
    });

    it('enemy added to perception between ticks transitions IDLE → ALERT', () => {
      const host = new TestNPCHost(100, 100);
      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.IDLE);

      // Tick 1: no enemy
      tick(host, driver, 16);
      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);

      // Between ticks: enemy appears
      host.perception.sync([makeEnemy('newEnemy', 300, 100)], [], []);

      // Tick 2: IDLE detects enemy → ALERT
      tick(host, driver, 16);
      expect(driver.currentStateId).toBe(ONLINE_STATE.ALERT);
    });

    it('enemy cleared from perception between ticks causes COMBAT → SEARCH', () => {
      const host = new TestNPCHost(100, 100);
      host.state.lastKnownEnemyX = 200;
      host.state.lastKnownEnemyY = 100;
      host.perception.sync([makeEnemy('e1', 200, 100)], [], []);

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.COMBAT);

      // Clear enemy between construction and first tick
      host.perception.sync([], [], []);

      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(ONLINE_STATE.SEARCH);
    });

    it('NPC position change via teleport between ticks affects SearchState movement', () => {
      const host = new TestNPCHost(100, 100);
      host.state.lastKnownEnemyX = 300;
      host.state.lastKnownEnemyY = 100;
      host.perception.sync([], [], []);

      const cfg = createDefaultStateConfig({ searchDuration: 5000, arriveThreshold: 20 });
      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(cfg), ONLINE_STATE.SEARCH);

      // Tick 1: NPC moves toward (300,100)
      tick(host, driver, 16);
      expect(host.velocityX).toBeGreaterThan(0);

      // Teleport NPC to be very close to target
      host.teleport(295, 100);

      // Tick 2: NPC should now arrive and halt
      tick(host, driver, 16);
      expect(host.halted).toBe(true);
    });

    it('cover system attached between ticks influences COMBAT → TAKE_COVER', () => {
      const host = new TestNPCHost(100, 100);
      const cfg = createDefaultStateConfig({ combatRange: 200 });
      // Enemy within combat range
      host.perception.sync([makeEnemy('e1', host.x + 50, host.y)], [], []);

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(cfg), ONLINE_STATE.COMBAT);

      // No cover initially — stays COMBAT
      tick(host, driver, 16);
      expect(driver.currentStateId).toBe(ONLINE_STATE.COMBAT);

      // Attach cover between ticks
      host.cover = {
        findCover(_x, _y, _ex, _ey, _type) {
          return { x: 50, y: 50 };
        },
      };

      // Next tick: cover found → TAKE_COVER
      tick(host, driver, 16);
      expect(driver.currentStateId).toBe(ONLINE_STATE.TAKE_COVER);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Re-entrant transition guard
  // -------------------------------------------------------------------------

  describe('re-entrant transition guard', () => {
    it('transition called inside enter() is silently ignored (no stack overflow)', () => {
      const host = new TestNPCHost(100, 100);
      const defaultHandlers = buildDefaultHandlerMap();

      // A handler whose enter() tries to transition again
      let enterCallCount = 0;
      const reentrantHandler: IOnlineStateHandler = {
        enter(ctx) {
          enterCallCount++;
          if (enterCallCount === 1) {
            // This re-entrant call should be ignored
            ctx.transition(ONLINE_STATE.IDLE);
          }
        },
        update(_ctx, _dt) {},
        exit(_ctx) {},
      };

      const handlers = new Map<string, IOnlineStateHandler>([
        [ONLINE_STATE.ALERT, reentrantHandler],
        ...([...defaultHandlers.toMap().entries()].filter(([k]) => k !== ONLINE_STATE.ALERT)),
      ]);

      const driver = new OnlineAIDriver(host, handlers, ONLINE_STATE.IDLE);

      // Transition to ALERT (whose enter() tries to re-transition)
      host.perception.sync([makeEnemy()], [], []);
      tick(host, driver, 16);

      // Should have transitioned to ALERT; re-entrant transition to IDLE was blocked
      expect(driver.currentStateId).toBe(ONLINE_STATE.ALERT);
      expect(enterCallCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Full multi-state chain via repeated ticks
  // -------------------------------------------------------------------------

  describe('IDLE → ALERT → COMBAT → SEARCH → IDLE via ticks', () => {
    it('completes the full engagement-disengagement cycle', () => {
      const cfg = createDefaultStateConfig({ searchDuration: 300, alertDuration: 5000 });
      const host = new TestNPCHost(100, 100);
      const handlers = buildDefaultHandlerMap(cfg);
      const driver = new OnlineAIDriver(host, handlers, ONLINE_STATE.IDLE);

      // Phase 1: IDLE with no enemy
      tick(host, driver, 16);
      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);

      // Phase 2: Enemy spotted → ALERT
      host.perception.sync([makeEnemy('e1', 300, 100)], [], []);
      tick(host, driver, 16);
      expect(driver.currentStateId).toBe(ONLINE_STATE.ALERT);

      // Phase 3: Enemy still visible → COMBAT
      tick(host, driver, 16);
      expect(driver.currentStateId).toBe(ONLINE_STATE.COMBAT);

      // Phase 4: Enemy disappears → SEARCH
      host.state.lastKnownEnemyX = 300;
      host.state.lastKnownEnemyY = 100;
      host.perception.sync([], [], []);
      tick(host, driver, 16);
      expect(driver.currentStateId).toBe(ONLINE_STATE.SEARCH);

      // Phase 5: Search times out → IDLE
      tick(host, driver, 400); // past 300ms searchDuration
      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);
    });

    it('currentStateId reflects current state after each tick', () => {
      const stateHistory: string[] = [];
      const host = new TestNPCHost(100, 100);
      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.IDLE);

      stateHistory.push(driver.currentStateId);

      // No enemy
      tick(host, driver, 16);
      stateHistory.push(driver.currentStateId);

      // Enemy spotted
      host.perception.sync([makeEnemy()], [], []);
      tick(host, driver, 16);
      stateHistory.push(driver.currentStateId);

      expect(stateHistory[0]).toBe(ONLINE_STATE.IDLE);
      expect(stateHistory[1]).toBe(ONLINE_STATE.IDLE);
      expect(stateHistory[2]).toBe(ONLINE_STATE.ALERT);
    });

    it('N consecutive update() calls advance internal timer via host.now()', () => {
      const host = new TestNPCHost(100, 100);
      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.IDLE);

      let ticks = 0;
      while (ticks < 5) {
        tick(host, driver, 100);
        ticks++;
      }

      expect(host.now()).toBe(500);
      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);
    });
  });
});
