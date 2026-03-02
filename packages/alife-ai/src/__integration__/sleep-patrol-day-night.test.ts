/**
 * Integration test: SLEEP / CAMP / PATROL state transitions.
 *
 * Exercises:
 *   - SLEEP stays idle when no enemies are detected
 *   - SLEEP wakes up (→ ALERT) when an enemy is spotted after the
 *     campSleepReactionDelayMs delay
 *   - PATROL → IDLE when patrol waypoint is reached
 *   - CAMP stays stationary and reacts to enemies with schemeReactionDelayMs delay
 *   - CAMP → COMBAT after delay when enemy is visible
 *   - SLEEP: halt() called on enter (NPC does not move)
 *   - CAMP: halt() called on enter
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OnlineAIDriver } from '../states/OnlineAIDriver';
import type { IOnlineDriverHost } from '../states/OnlineAIDriver';
import { createDefaultNPCOnlineState } from '../states/NPCOnlineState';
import { NPCPerception } from '../states/NPCPerception';
import {
  buildDefaultHandlerMap,
  ONLINE_STATE,
} from '../states/OnlineStateRegistryBuilder';
import { createDefaultStateConfig } from '../states/IStateConfig';
import type {
  ICoverAccess,
  IDangerAccess,
  IRestrictedZoneAccess,
  ISquadAccess,
  INPCHealth,
  IShootPayload,
  IMeleeHitPayload,
} from '../states/INPCContext';

// ---------------------------------------------------------------------------
// TestNPCHost — deterministic test double, no vi.fn()
// ---------------------------------------------------------------------------

class TestNPCHost implements IOnlineDriverHost {
  readonly state = createDefaultNPCOnlineState();
  readonly perception = new NPCPerception();
  x = 100; y = 100;
  private _hp = 100; private _maxHp = 100;
  private _nowMs = 0;
  npcId = 'npc_test'; factionId = 'loner'; entityType = 'human';
  cover: ICoverAccess | null = null;
  danger: IDangerAccess | null = null;
  restrictedZones: IRestrictedZoneAccess | null = null;
  squad: ISquadAccess | null = null;
  readonly vocalizations: string[] = [];
  haltCount = 0;
  velocityX = 0;
  velocityY = 0;
  alphaValues: number[] = [];

  get health(): INPCHealth {
    return { hp: this._hp, maxHp: this._maxHp, hpPercent: this._hp / this._maxHp, heal: (n) => { this._hp = Math.min(this._hp + n, this._maxHp); } };
  }
  setVelocity(vx: number, vy: number): void { this.velocityX = vx; this.velocityY = vy; }
  halt(): void { this.velocityX = 0; this.velocityY = 0; this.haltCount++; }
  setRotation(_r: number): void {}
  setAlpha(a: number): void { this.alphaValues.push(a); }
  teleport(px: number, py: number): void { this.x = px; this.y = py; }
  disablePhysics(): void {}
  emitShoot(_p: IShootPayload): void {}
  emitMeleeHit(_p: IMeleeHitPayload): void {}
  emitVocalization(t: string): void { this.vocalizations.push(t); }
  emitPsiAttackStart(_x: number, _y: number): void {}
  now(): number { return this._nowMs; }
  random(): number { return 0.5; }
  advanceMs(ms: number): void { this._nowMs += ms; }
  setHp(hp: number): void { this._hp = hp; }
}

function tick(host: TestNPCHost, driver: OnlineAIDriver, deltaMs: number): void {
  host.advanceMs(deltaMs);
  driver.update(deltaMs);
}

function makeEnemy(id = 'enemy_1', x = 300, y = 100) {
  return { id, x, y, factionId: 'bandit' };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Sleep / Camp / Patrol state transitions (integration)', () => {
  const cfg = createDefaultStateConfig();

  // -------------------------------------------------------------------------
  // SLEEP: stays in SLEEP when no enemies present
  // -------------------------------------------------------------------------
  describe('SLEEP state — no enemies', () => {
    it('stays in SLEEP when no enemies are visible', () => {
      const host = new TestNPCHost();
      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(cfg), ONLINE_STATE.SLEEP);

      // No enemies in perception
      host.perception.sync([], [], []);
      tick(host, driver, 100);
      tick(host, driver, 100);

      expect(driver.currentStateId).toBe(ONLINE_STATE.SLEEP);
    });

    it('SLEEP enter() calls halt() — NPC velocity stays zero', () => {
      const host = new TestNPCHost();
      host.haltCount = 0;
      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(cfg), ONLINE_STATE.SLEEP);
      // enter() should have called halt()
      expect(host.haltCount).toBeGreaterThanOrEqual(1);
      expect(host.velocityX).toBe(0);
      expect(host.velocityY).toBe(0);

      // Ticking without enemies: velocity stays zero
      host.perception.sync([], [], []);
      tick(host, driver, 200);
      expect(host.velocityX).toBe(0);
      expect(host.velocityY).toBe(0);
    });

    it('SLEEP enter() dims alpha to 0.8', () => {
      const host = new TestNPCHost();
      new OnlineAIDriver(host, buildDefaultHandlerMap(cfg), ONLINE_STATE.SLEEP);
      // setAlpha(0.8) should be in the recorded alphaValues
      expect(host.alphaValues).toContain(0.8);
    });
  });

  // -------------------------------------------------------------------------
  // SLEEP: enemy spotted → queued delay → ALERT
  // -------------------------------------------------------------------------
  describe('SLEEP → ALERT when enemy detected', () => {
    it('queues delayed reaction on enemy detection', () => {
      const host = new TestNPCHost();
      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(cfg), ONLINE_STATE.SLEEP);

      // Enemy appears in perception
      host.perception.sync([makeEnemy()], [], []);

      // First tick: enemy detected, reaction timer starts (woundedStartMs set)
      tick(host, driver, 16);

      // Reaction delay not yet elapsed — still in SLEEP
      expect(driver.currentStateId).toBe(ONLINE_STATE.SLEEP);
      // woundedStartMs is used as the reaction-start timestamp (non-zero now)
      expect(host.state.woundedStartMs).toBeGreaterThan(0);
    });

    it('transitions to ALERT after campSleepReactionDelayMs has elapsed', () => {
      const host = new TestNPCHost();
      const sleepCfg = createDefaultStateConfig({ campSleepReactionDelayMs: 200 });
      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(sleepCfg), ONLINE_STATE.SLEEP);

      // Enemy appears
      host.perception.sync([makeEnemy()], [], []);
      tick(host, driver, 50); // reaction timer starts, delay not yet elapsed
      expect(driver.currentStateId).toBe(ONLINE_STATE.SLEEP);

      // Advance past reaction delay
      tick(host, driver, sleepCfg.campSleepReactionDelayMs + 50);
      expect(driver.currentStateId).toBe(ONLINE_STATE.ALERT);
    });

    it('exit() restores alpha to 1 when waking up', () => {
      const host = new TestNPCHost();
      const sleepCfg = createDefaultStateConfig({ campSleepReactionDelayMs: 100 });
      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(sleepCfg), ONLINE_STATE.SLEEP);

      host.perception.sync([makeEnemy()], [], []);
      tick(host, driver, 50);
      tick(host, driver, sleepCfg.campSleepReactionDelayMs + 50);
      expect(driver.currentStateId).toBe(ONLINE_STATE.ALERT);

      // Alpha should have been restored to 1 on exit
      expect(host.alphaValues).toContain(1);
    });
  });

  // -------------------------------------------------------------------------
  // CAMP: stays stationary when no enemies present
  // -------------------------------------------------------------------------
  describe('CAMP state — no enemies', () => {
    it('stays in CAMP when no enemies are visible', () => {
      const host = new TestNPCHost();
      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(cfg), ONLINE_STATE.CAMP);

      host.perception.sync([], [], []);
      tick(host, driver, 100);
      tick(host, driver, 100);

      expect(driver.currentStateId).toBe(ONLINE_STATE.CAMP);
    });

    it('CAMP enter() calls halt()', () => {
      const host = new TestNPCHost();
      host.haltCount = 0;
      new OnlineAIDriver(host, buildDefaultHandlerMap(cfg), ONLINE_STATE.CAMP);
      expect(host.haltCount).toBeGreaterThanOrEqual(1);
      expect(host.velocityX).toBe(0);
      expect(host.velocityY).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // CAMP: enemy spotted → delayed → COMBAT
  // -------------------------------------------------------------------------
  describe('CAMP → COMBAT after schemeReactionDelayMs', () => {
    it('queues reaction on enemy detection, does not immediately transition', () => {
      const host = new TestNPCHost();
      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(cfg), ONLINE_STATE.CAMP);

      host.perception.sync([makeEnemy()], [], []);
      tick(host, driver, 16);
      // evadeStartMs should be set (non-zero) — delay timer started
      expect(host.state.evadeStartMs).toBeGreaterThan(0);
      // Still in CAMP — delay not elapsed
      expect(driver.currentStateId).toBe(ONLINE_STATE.CAMP);
    });

    it('transitions to COMBAT after schemeReactionDelayMs elapses', () => {
      const host = new TestNPCHost();
      const campCfg = createDefaultStateConfig({ schemeReactionDelayMs: 200 });
      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(campCfg), ONLINE_STATE.CAMP);

      host.perception.sync([makeEnemy()], [], []);
      tick(host, driver, 50); // starts timer
      expect(driver.currentStateId).toBe(ONLINE_STATE.CAMP);

      // Advance past reaction delay (but keep enemy visible for the record)
      host.perception.sync([], [], []); // enemy gone — isAlert was set in prior tick
      tick(host, driver, campCfg.schemeReactionDelayMs + 50);
      expect(driver.currentStateId).toBe(ONLINE_STATE.COMBAT);
    });

    it('stores last known enemy position from CAMP detection', () => {
      const host = new TestNPCHost();
      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(cfg), ONLINE_STATE.CAMP);

      const enemy = makeEnemy('e1', 400, 250);
      host.perception.sync([enemy], [], []);
      tick(host, driver, 16);

      expect(host.state.lastKnownEnemyX).toBe(400);
      expect(host.state.lastKnownEnemyY).toBe(250);
    });
  });

  // -------------------------------------------------------------------------
  // PATROL: moves toward waypoint, transitions to IDLE on arrival
  // -------------------------------------------------------------------------
  describe('PATROL → IDLE on waypoint arrival', () => {
    it('transitions to IDLE when patrol waypoint is 0,0 (no target assigned)', () => {
      const host = new TestNPCHost();
      // coverPointX/Y default to 0, which PatrolState treats as "no waypoint"
      host.state.coverPointX = 0;
      host.state.coverPointY = 0;

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(cfg), ONLINE_STATE.PATROL);
      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);
    });

    it('moves toward patrol waypoint when one is assigned', () => {
      const host = new TestNPCHost();
      // Assign a waypoint far from NPC position
      host.state.coverPointX = 500;
      host.state.coverPointY = 100;
      host.x = 100;
      host.y = 100;

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(cfg), ONLINE_STATE.PATROL);

      host.perception.sync([], [], []);
      tick(host, driver, 16);

      // NPC should be moving (non-zero velocity toward waypoint)
      expect(driver.currentStateId).toBe(ONLINE_STATE.PATROL);
      // At least one velocity component should be non-zero
      const moving = host.velocityX !== 0 || host.velocityY !== 0;
      expect(moving).toBe(true);
    });

    it('transitions to IDLE when NPC arrives within waypointArriveThreshold', () => {
      const host = new TestNPCHost();
      // Place waypoint very close to NPC (within arriveThreshold)
      host.x = 100;
      host.y = 100;
      // Use a position just at the threshold boundary (within 24px by default)
      host.state.coverPointX = 100 + cfg.waypointArriveThreshold - 1;
      host.state.coverPointY = 100;

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(cfg), ONLINE_STATE.PATROL);

      host.perception.sync([], [], []);
      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);
    });

    it('PATROL → ALERT when enemy spotted during patrol', () => {
      const host = new TestNPCHost();
      host.state.coverPointX = 500;
      host.state.coverPointY = 100;

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(cfg), ONLINE_STATE.PATROL);

      host.perception.sync([makeEnemy()], [], []);
      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(ONLINE_STATE.ALERT);
    });
  });

  // -------------------------------------------------------------------------
  // SLEEP restricted zone: immediate wake-up
  // -------------------------------------------------------------------------
  describe('SLEEP → ALERT immediately when in restricted/danger zone', () => {
    it('transitions to ALERT immediately when standing in inaccessible zone', () => {
      const host = new TestNPCHost();
      host.restrictedZones = {
        isAccessible(_x, _y) { return false; }, // always inaccessible
        filterAccessible(_pts) { return []; },
      };

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(cfg), ONLINE_STATE.SLEEP);

      host.perception.sync([], [], []);
      tick(host, driver, 16);

      // Immediate transition (no delay for danger zones in SLEEP)
      expect(driver.currentStateId).toBe(ONLINE_STATE.ALERT);
    });
  });
});
