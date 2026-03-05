/**
 * Integration test: Full human NPC combat FSM state transition chain.
 *
 * Exercises the complete combat pipeline end-to-end using real state handlers:
 *   IDLE -> ALERT -> COMBAT -> TAKE_COVER / FLEE / SEARCH -> IDLE
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 * The TestNPCHost class provides a deterministic timer and captures outputs.
 */

import { describe, it, expect } from 'vitest';
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
  x = 100;
  y = 100;
  private _hp = 100;
  private _maxHp = 100;
  private _nowMs = 0;
  npcId = 'npc_test';
  factionId = 'loner';
  entityType = 'human';
  cover: ICoverAccess | null = null;
  danger: IDangerAccess | null = null;
  restrictedZones: IRestrictedZoneAccess | null = null;
  squad: ISquadAccess | null = null;
  readonly shoots: IShootPayload[] = [];
  readonly vocalizations: string[] = [];
  velocityX = 0;
  velocityY = 0;
  halted = false;

  get health(): INPCHealth {
    return {
      hp: this._hp,
      maxHp: this._maxHp,
      hpPercent: this._hp / this._maxHp,
      heal: (n: number) => { this._hp = Math.min(this._hp + n, this._maxHp); },
    };
  }

  setVelocity(vx: number, vy: number): void { this.velocityX = vx; this.velocityY = vy; this.halted = false; }
  halt(): void { this.velocityX = 0; this.velocityY = 0; this.halted = true; }
  setRotation(_r: number): void {}
  setAlpha(_a: number): void {}
  teleport(px: number, py: number): void { this.x = px; this.y = py; }
  disablePhysics(): void {}
  emitShoot(p: IShootPayload): void { this.shoots.push(p); }
  emitMeleeHit(_p: IMeleeHitPayload): void {}
  emitVocalization(t: string): void { this.vocalizations.push(t); }
  emitPsiAttackStart(_x: number, _y: number): void {}
  now(): number { return this._nowMs; }
  random(): number { return 0.5; }

  advanceMs(ms: number): void { this._nowMs += ms; }
  setHp(hp: number): void { this._hp = hp; }
  setMaxHp(hp: number): void { this._maxHp = hp; this._hp = hp; }
  get hp(): number { return this._hp; }
}

function tick(host: TestNPCHost, driver: OnlineAIDriver, deltaMs: number): void {
  host.advanceMs(deltaMs);
  driver.update(deltaMs);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEnemy(id = 'enemy_1', x = 300, y = 100) {
  return { id, x, y, factionId: 'bandit' };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Full Combat FSM Flow (integration)', () => {
  const cfg = createDefaultStateConfig();

  // -------------------------------------------------------------------------
  // Scenario 1: IDLE -> ALERT on enemy spotted
  // -------------------------------------------------------------------------
  describe('IDLE -> ALERT on enemy spotted', () => {
    it('transitions from IDLE to ALERT when enemy becomes visible', () => {
      const host = new TestNPCHost();
      const handlers = buildDefaultHandlerMap();
      const driver = new OnlineAIDriver(host, handlers, ONLINE_STATE.IDLE);

      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);

      // Sync an enemy into perception before ticking.
      host.perception.sync([makeEnemy()], [], []);
      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(ONLINE_STATE.ALERT);
    });

    it('stays in IDLE when no enemies are visible', () => {
      const host = new TestNPCHost();
      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.IDLE);

      tick(host, driver, 100);
      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 2: ALERT -> COMBAT when enemy visible before timer expires
  // -------------------------------------------------------------------------
  describe('ALERT -> COMBAT on enemy spotted', () => {
    it('transitions from ALERT to COMBAT when enemy becomes directly visible', () => {
      const host = new TestNPCHost();
      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.ALERT);

      // Simulate: sound heard, now we see the enemy.
      host.perception.sync([makeEnemy()], [], []);
      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(ONLINE_STATE.COMBAT);
    });

    it('transitions from ALERT to PATROL on timer expiry when no enemy seen', () => {
      const host = new TestNPCHost();
      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.ALERT);

      // No enemies in perception.
      host.perception.sync([], [], []);

      // Advance past alertDuration (5000ms default).
      tick(host, driver, cfg.alertDuration + 100);

      expect(driver.currentStateId).toBe(ONLINE_STATE.PATROL);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 3: COMBAT -> TAKE_COVER when cover is available in range
  // -------------------------------------------------------------------------
  describe('COMBAT -> TAKE_COVER when cover available', () => {
    it('transitions to TAKE_COVER when cover system finds a cover point', () => {
      const host = new TestNPCHost();

      // Place enemy within combat range so the NPC halts and checks cover.
      const enemy = makeEnemy('enemy_1', host.x + cfg.combatRange - 10, host.y);

      // Provide a cover access that always returns a cover point.
      host.cover = {
        findCover(_x, _y, _ex, _ey, _type) {
          return { x: 50, y: 50 };
        },
      };

      host.perception.sync([enemy], [], []);

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.COMBAT);
      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(ONLINE_STATE.TAKE_COVER);
      expect(host.state.coverPointX).toBe(50);
      expect(host.state.coverPointY).toBe(50);
    });

    it('stays in COMBAT when no cover system is attached', () => {
      const host = new TestNPCHost();
      // Enemy within range but no cover system.
      const enemy = makeEnemy('enemy_1', host.x + 10, host.y);
      host.cover = null;
      host.perception.sync([enemy], [], []);

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.COMBAT);
      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(ONLINE_STATE.COMBAT);
    });

    it('stays in COMBAT when cover is found but NPC is out of range', () => {
      const host = new TestNPCHost();
      // Enemy far away — NPC will approach, not halt, so cover check won't run.
      const enemy = makeEnemy('enemy_1', host.x + cfg.combatRange + 100, host.y);
      host.cover = {
        findCover() { return { x: 50, y: 50 }; },
      };
      host.perception.sync([enemy], [], []);

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.COMBAT);
      tick(host, driver, 16);

      // Still approaching; cover check only fires when within combatRange.
      expect(driver.currentStateId).toBe(ONLINE_STATE.COMBAT);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 4: COMBAT -> FLEE on PANICKED morale
  // -------------------------------------------------------------------------
  describe('COMBAT -> FLEE on PANICKED morale', () => {
    it('transitions from COMBAT to FLEE when morale drops to PANICKED', () => {
      const host = new TestNPCHost();
      host.state.morale = -1.0;
      host.state.moraleState = 'PANICKED';
      host.state.lastKnownEnemyX = 200;
      host.state.lastKnownEnemyY = 100;

      host.perception.sync([makeEnemy()], [], []);

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.COMBAT);
      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(ONLINE_STATE.FLEE);
    });

    it('transitions from COMBAT to RETREAT when morale is SHAKEN', () => {
      const host = new TestNPCHost();
      host.state.morale = -0.5;
      host.state.moraleState = 'SHAKEN';
      host.state.lastKnownEnemyX = 200;
      host.state.lastKnownEnemyY = 100;

      host.perception.sync([makeEnemy()], [], []);

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.COMBAT);
      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(ONLINE_STATE.RETREAT);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 5: COMBAT -> SEARCH when target lost
  // -------------------------------------------------------------------------
  describe('COMBAT -> SEARCH after losing visual contact', () => {
    it('transitions to SEARCH when perception cleared and last known pos is set', () => {
      const host = new TestNPCHost();
      // Pre-set a last known position so the "lastKnown" branch fires.
      host.state.lastKnownEnemyX = 300;
      host.state.lastKnownEnemyY = 100;

      // No visible enemies this tick.
      host.perception.sync([], [], []);

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.COMBAT);
      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(ONLINE_STATE.SEARCH);
    });

    it('transitions to IDLE when no enemy and no last known position', () => {
      const host = new TestNPCHost();
      // lastKnownEnemyX/Y default to 0, so the "combatOnNoEnemy" branch fires.
      host.perception.sync([], [], []);

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.COMBAT);
      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 6: SEARCH -> IDLE after search timer expires
  // -------------------------------------------------------------------------
  describe('SEARCH -> IDLE after search timer expires', () => {
    it('transitions from SEARCH to IDLE after searchDuration ms', () => {
      const host = new TestNPCHost();
      host.state.lastKnownEnemyX = 300;
      host.state.lastKnownEnemyY = 100;
      host.perception.sync([], [], []);

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.SEARCH);

      // Advance past searchDuration (8000ms default).
      tick(host, driver, cfg.searchDuration + 100);

      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);
    });

    it('transitions back to ALERT from SEARCH when enemy reappears', () => {
      const host = new TestNPCHost();
      host.state.lastKnownEnemyX = 300;
      host.state.lastKnownEnemyY = 100;

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.SEARCH);

      // Advance a bit but not past searchDuration.
      tick(host, driver, 500);
      expect(driver.currentStateId).toBe(ONLINE_STATE.SEARCH);

      // Now an enemy appears.
      host.perception.sync([makeEnemy()], [], []);
      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(ONLINE_STATE.ALERT);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 7: Full chain IDLE -> ALERT -> COMBAT -> SEARCH -> IDLE
  // -------------------------------------------------------------------------
  describe('Full IDLE -> ALERT -> COMBAT -> SEARCH -> IDLE chain', () => {
    it('traverses the full engagement and disengagement pipeline', () => {
      const host = new TestNPCHost();
      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.IDLE);

      // Step 1: IDLE — no enemies
      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);

      // Step 2: Enemy spotted → IDLE -> ALERT
      host.perception.sync([makeEnemy('e1', 300, 100)], [], []);
      tick(host, driver, 16);
      expect(driver.currentStateId).toBe(ONLINE_STATE.ALERT);

      // Step 3: Enemy still visible → ALERT -> COMBAT (next tick in ALERT)
      tick(host, driver, 16);
      expect(driver.currentStateId).toBe(ONLINE_STATE.COMBAT);

      // Step 4: Enemy disappears — last known is set → COMBAT -> SEARCH
      host.perception.sync([], [], []);
      tick(host, driver, 16);
      expect(driver.currentStateId).toBe(ONLINE_STATE.SEARCH);

      // Step 5: Search times out → SEARCH -> IDLE
      tick(host, driver, cfg.searchDuration + 100);
      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 8: CombatState fires shots when in range
  // -------------------------------------------------------------------------
  describe('COMBAT fires shots when cooldown elapses', () => {
    it('emits a shoot event after fireRateMs in COMBAT', () => {
      const host = new TestNPCHost();
      // Put enemy within range so NPC halts and fires.
      const enemy = makeEnemy('e1', host.x + 10, host.y);
      host.perception.sync([enemy], [], []);

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.COMBAT);

      // Advance past fireRateMs (1000ms default).
      tick(host, driver, cfg.fireRateMs + 100);

      expect(host.shoots.length).toBeGreaterThan(0);
      expect(host.shoots[0].weaponType).toBe('rifle'); // default when no primaryWeapon
      expect(host.shoots[0].npcId).toBe('npc_test');
    });

    it('uses primaryWeapon type from state when assigned', () => {
      const host = new TestNPCHost();
      host.state.primaryWeapon = 'shotgun';
      const enemy = makeEnemy('e1', host.x + 10, host.y);
      host.perception.sync([enemy], [], []);

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.COMBAT);
      tick(host, driver, cfg.fireRateMs + 100);

      expect(host.shoots.length).toBeGreaterThan(0);
      expect(host.shoots[0].weaponType).toBe('shotgun');
    });
  });
});
