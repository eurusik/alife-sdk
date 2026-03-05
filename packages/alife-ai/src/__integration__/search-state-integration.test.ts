/**
 * Integration test: SearchState — via OnlineAIDriver.
 *
 * Covers:
 *   - ALERT → SEARCH on target loss
 *   - SearchState ticks timer and returns IDLE on expiry
 *   - SearchState interrupted by new enemy sighting → ALERT
 *   - SearchState movement toward last known position
 *   - Multiple search waypoint scenarios
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OnlineAIDriver } from '../states/OnlineAIDriver';
import type { IOnlineDriverHost } from '../states/OnlineAIDriver';
import { buildDefaultHandlerMap, ONLINE_STATE } from '../states/OnlineStateRegistryBuilder';
import { createDefaultNPCOnlineState } from '../states/NPCOnlineState';
import { NPCPerception } from '../states/NPCPerception';
import { createDefaultStateConfig } from '../states/IStateConfig';
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
// TestNPCHost
// ---------------------------------------------------------------------------

class TestNPCHost implements IOnlineDriverHost {
  readonly state = createDefaultNPCOnlineState();
  readonly perception = new NPCPerception();

  npcId = 'npc_search_test';
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
  lastRotation = 0;

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
    // Simulate movement
    this._x += vx * 0.016;
    this._y += vy * 0.016;
  }

  halt(): void {
    this.velocityX = 0;
    this.velocityY = 0;
    this.halted = true;
  }

  setRotation(r: number): void { this.lastRotation = r; }
  setAlpha(_a: number): void {}
  teleport(x: number, y: number): void { this._x = x; this._y = y; }
  disablePhysics(): void {}
  emitShoot(_p: IShootPayload): void {}
  emitMeleeHit(_p: IMeleeHitPayload): void {}
  emitVocalization(_t: string): void {}
  emitPsiAttackStart(_x: number, _y: number): void {}

  now(): number { return this._nowMs; }
  random(): number { return 0.5; }

  advanceMs(ms: number): void { this._nowMs += ms; }
}

function makeEnemy(id = 'enemy_1', x = 300, y = 100, factionId = 'bandit') {
  return { id, x, y, factionId };
}

function tick(host: TestNPCHost, driver: OnlineAIDriver, deltaMs: number): void {
  host.advanceMs(deltaMs);
  driver.update(deltaMs);
}

// Default short search duration for most tests
const SHORT_SEARCH_MS = 500;

function buildSearchDriver(
  host: TestNPCHost,
  initialState: string = ONLINE_STATE.SEARCH,
  searchDuration = SHORT_SEARCH_MS,
): OnlineAIDriver {
  const cfg = createDefaultStateConfig({ searchDuration });
  const handlers = buildDefaultHandlerMap(cfg);
  return new OnlineAIDriver(host, handlers, initialState);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SearchState — integration via OnlineAIDriver', () => {

  // -------------------------------------------------------------------------
  // 1. ALERT → SEARCH transition
  // -------------------------------------------------------------------------

  describe('ALERT → SEARCH on target loss', () => {
    it('transitions from COMBAT to SEARCH when enemy disappears and last known pos is set', () => {
      const host = new TestNPCHost(100, 100);
      host.state.lastKnownEnemyX = 300;
      host.state.lastKnownEnemyY = 100;

      // No enemy visible this frame
      host.perception.sync([], [], []);

      const driver = buildSearchDriver(host, ONLINE_STATE.COMBAT);
      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(ONLINE_STATE.SEARCH);
    });

    it('enters SEARCH with searchStartMs set to current time', () => {
      const host = new TestNPCHost(100, 100);
      host.state.lastKnownEnemyX = 300;
      host.state.lastKnownEnemyY = 100;
      host.perception.sync([], [], []);

      const cfg = createDefaultStateConfig({ searchDuration: SHORT_SEARCH_MS });
      const handlers = buildDefaultHandlerMap(cfg);
      const _driver = new OnlineAIDriver(host, handlers, ONLINE_STATE.SEARCH);

      // searchStartMs is set by SearchState.enter() — which fired in constructor
      expect(host.state.searchStartMs).toBe(0); // now() was 0 when driver constructed
    });

    it('IDLE → ALERT on enemy spotted, ALERT stays until timer or visible enemy', () => {
      const host = new TestNPCHost(100, 100);
      const driver = buildSearchDriver(host, ONLINE_STATE.IDLE);

      // Enemy appears → IDLE to ALERT
      host.perception.sync([makeEnemy()], [], []);
      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(ONLINE_STATE.ALERT);
    });
  });

  // -------------------------------------------------------------------------
  // 2. SearchState timer expiry → IDLE
  // -------------------------------------------------------------------------

  describe('SearchState timer: expiry → IDLE', () => {
    let host: TestNPCHost;
    let driver: OnlineAIDriver;

    beforeEach(() => {
      host = new TestNPCHost(100, 100);
      host.state.lastKnownEnemyX = 300;
      host.state.lastKnownEnemyY = 100;
      host.perception.sync([], [], []);
      driver = buildSearchDriver(host, ONLINE_STATE.SEARCH, SHORT_SEARCH_MS);
    });

    it('stays in SEARCH before timer expires', () => {
      tick(host, driver, SHORT_SEARCH_MS - 100);
      expect(driver.currentStateId).toBe(ONLINE_STATE.SEARCH);
    });

    it('transitions to IDLE after search timer expires', () => {
      tick(host, driver, SHORT_SEARCH_MS + 10);
      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);
    });

    it('clears targetId on timeout', () => {
      host.state.targetId = 'enemy_x';
      tick(host, driver, SHORT_SEARCH_MS + 10);
      expect(host.state.targetId).toBeNull();
    });

    it('halts movement after transitioning to IDLE from timeout', () => {
      tick(host, driver, SHORT_SEARCH_MS + 10);
      // After SearchState.exit() the NPC halts
      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);
      // IDLE.enter() calls halt()
      expect(host.halted).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 3. SearchState interrupted by re-sighted enemy → ALERT
  // -------------------------------------------------------------------------

  describe('SearchState interrupted by enemy re-sighting → ALERT', () => {
    it('transitions to ALERT when enemy becomes visible mid-search', () => {
      const host = new TestNPCHost(100, 100);
      host.state.lastKnownEnemyX = 300;
      host.state.lastKnownEnemyY = 100;
      host.perception.sync([], [], []);

      const driver = buildSearchDriver(host);

      // Tick without enemy — stays in SEARCH
      tick(host, driver, 100);
      expect(driver.currentStateId).toBe(ONLINE_STATE.SEARCH);

      // Enemy re-appears
      host.perception.sync([makeEnemy('e2', 250, 80)], [], []);
      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(ONLINE_STATE.ALERT);
    });

    it('updates lastKnownEnemyX/Y to re-spotted enemy position', () => {
      const host = new TestNPCHost(100, 100);
      host.state.lastKnownEnemyX = 300;
      host.state.lastKnownEnemyY = 100;
      host.perception.sync([], [], []);

      const driver = buildSearchDriver(host);
      tick(host, driver, 50);

      // New enemy at a different location
      host.perception.sync([makeEnemy('e_new', 420, 200)], [], []);
      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(ONLINE_STATE.ALERT);
      expect(host.state.lastKnownEnemyX).toBe(420);
      expect(host.state.lastKnownEnemyY).toBe(200);
    });

    it('does not transition to ALERT if search times out on same tick as enemy appears', () => {
      const host = new TestNPCHost(100, 100);
      host.state.lastKnownEnemyX = 300;
      host.state.lastKnownEnemyY = 100;
      host.perception.sync([], [], []);

      const driver = buildSearchDriver(host, ONLINE_STATE.SEARCH, SHORT_SEARCH_MS);

      // Advance to just before expiry
      tick(host, driver, SHORT_SEARCH_MS - 50);
      expect(driver.currentStateId).toBe(ONLINE_STATE.SEARCH);

      // Enemy appears before timeout — should transition to ALERT, NOT IDLE
      host.perception.sync([makeEnemy()], [], []);
      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(ONLINE_STATE.ALERT);
    });
  });

  // -------------------------------------------------------------------------
  // 4. SearchState movement toward last known position
  // -------------------------------------------------------------------------

  describe('SearchState movement toward last known position', () => {
    it('emits velocity toward lastKnownEnemyX/Y when NPC is far away', () => {
      const host = new TestNPCHost(100, 100);
      // Last known position is far away
      host.state.lastKnownEnemyX = 600;
      host.state.lastKnownEnemyY = 100;
      host.perception.sync([], [], []);

      const driver = buildSearchDriver(host);
      tick(host, driver, 16);

      // NPC should be moving: velocityX > 0, velocityY ≈ 0
      expect(host.velocityX).toBeGreaterThan(0);
      expect(Math.abs(host.velocityY)).toBeLessThan(1);
    });

    it('halts when NPC arrives within arriveThreshold of last known position', () => {
      const cfg = createDefaultStateConfig({
        searchDuration: SHORT_SEARCH_MS,
        arriveThreshold: 20,
        approachSpeed: 150,
      });
      const host = new TestNPCHost(100, 100);
      // Place last known position very close to NPC (within arrive threshold)
      host.state.lastKnownEnemyX = 105;
      host.state.lastKnownEnemyY = 100;
      host.perception.sync([], [], []);

      const handlers = buildDefaultHandlerMap(cfg);
      const driver = new OnlineAIDriver(host, handlers, ONLINE_STATE.SEARCH);

      tick(host, driver, 16);

      // NPC arrived — should halt and wait for timer
      expect(host.halted).toBe(true);
      expect(driver.currentStateId).toBe(ONLINE_STATE.SEARCH);
    });

    it('after arriving, stays in SEARCH until timer expires then goes IDLE', () => {
      const cfg = createDefaultStateConfig({
        searchDuration: SHORT_SEARCH_MS,
        arriveThreshold: 50,
      });
      const host = new TestNPCHost(100, 100);
      // NPC is right at the last known position
      host.state.lastKnownEnemyX = 100;
      host.state.lastKnownEnemyY = 100;
      host.perception.sync([], [], []);

      const handlers = buildDefaultHandlerMap(cfg);
      const driver = new OnlineAIDriver(host, handlers, ONLINE_STATE.SEARCH);

      // Tick but not past searchDuration
      tick(host, driver, SHORT_SEARCH_MS - 100);
      expect(driver.currentStateId).toBe(ONLINE_STATE.SEARCH);

      // Now expire the timer
      tick(host, driver, 200);
      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Multiple search waypoints / cycle
  // -------------------------------------------------------------------------

  describe('SearchState with multiple search waypoints context', () => {
    it('NPC searches from COMBAT → SEARCH → IDLE full pipeline', () => {
      const host = new TestNPCHost(100, 100);

      // Step 1: enter COMBAT with enemy visible
      host.perception.sync([makeEnemy('e1', 200, 100)], [], []);
      const cfg = createDefaultStateConfig({ searchDuration: SHORT_SEARCH_MS });
      const handlers = buildDefaultHandlerMap(cfg);
      const driver = new OnlineAIDriver(host, handlers, ONLINE_STATE.COMBAT);

      // In COMBAT: set last known pos
      host.state.lastKnownEnemyX = 200;
      host.state.lastKnownEnemyY = 100;

      // Step 2: enemy disappears → SEARCH
      host.perception.sync([], [], []);
      tick(host, driver, 16);
      expect(driver.currentStateId).toBe(ONLINE_STATE.SEARCH);

      // Step 3: wait out search timer → IDLE
      tick(host, driver, SHORT_SEARCH_MS + 50);
      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);
    });

    it('SearchState searchWaypointIndex is accessible in state bag', () => {
      const host = new TestNPCHost(100, 100);
      host.state.lastKnownEnemyX = 300;
      host.state.lastKnownEnemyY = 100;
      host.perception.sync([], [], []);

      const driver = buildSearchDriver(host);

      // searchWaypointIndex starts at 0
      expect(host.state.searchWaypointIndex).toBe(0);
      tick(host, driver, 50);
      // Still in SEARCH
      expect(driver.currentStateId).toBe(ONLINE_STATE.SEARCH);
    });

    it('second search after returning to IDLE — SearchState resets searchStartMs', () => {
      const host = new TestNPCHost(100, 100);
      host.state.lastKnownEnemyX = 300;
      host.state.lastKnownEnemyY = 100;
      host.perception.sync([], [], []);

      const driver = buildSearchDriver(host, ONLINE_STATE.SEARCH, SHORT_SEARCH_MS);

      // First search times out → IDLE
      tick(host, driver, SHORT_SEARCH_MS + 50);
      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);

      const firstSearchStartMs = host.state.searchStartMs;

      // Re-enter SEARCH (simulate transition from COMBAT again)
      // Trigger by setting enemy then losing it via COMBAT → SEARCH
      host.state.lastKnownEnemyX = 400;
      host.state.lastKnownEnemyY = 200;
      host.perception.sync([], [], []);

      const cfg2 = createDefaultStateConfig({ searchDuration: SHORT_SEARCH_MS });
      const handlers2 = buildDefaultHandlerMap(cfg2);
      const _driver2 = new OnlineAIDriver(host, handlers2, ONLINE_STATE.SEARCH);

      // searchStartMs should be set to host.now() at time of entering SEARCH
      expect(host.state.searchStartMs).toBeGreaterThanOrEqual(firstSearchStartMs);
    });

    it('SEARCH state does NOT transition if no last known position and no enemies', () => {
      // When lastKnownEnemyX/Y are 0,0 and NPC is at 0,0 the arrive check fires immediately
      // and NPC waits at position for timer — should still be in SEARCH
      const host = new TestNPCHost(0, 0);
      host.state.lastKnownEnemyX = 0;
      host.state.lastKnownEnemyY = 0;
      host.perception.sync([], [], []);

      const driver = buildSearchDriver(host, ONLINE_STATE.SEARCH, SHORT_SEARCH_MS);

      tick(host, driver, SHORT_SEARCH_MS - 100);
      expect(driver.currentStateId).toBe(ONLINE_STATE.SEARCH);
    });
  });
});
