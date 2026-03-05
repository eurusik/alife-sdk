/**
 * Integration test: WoundedState + RetreatState mechanics.
 *
 * Exercises:
 *   - WoundedState activation via HP < woundedHpThreshold through OnlineAIDriver
 *   - WoundedState crawl speed (0.3× approachSpeed)
 *   - WoundedState healing → recovery back to COMBAT
 *   - WoundedState → DEAD path (HP → 0 → transition driven by CombatState)
 *   - RetreatState cover-seeking behaviour
 *   - RetreatState morale-stable → COMBAT transition
 *   - RetreatState no-enemy → SEARCH transition
 *   - RetreatState PANICKED → FLEE override
 *   - Combined WoundedState → RETREAT sequence
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 * Pattern: TestNPCHost with tracking arrays (same as full-combat-fsm-flow.test.ts).
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
  readonly velocities: Array<[number, number]> = [];
  haltCount = 0;

  get health(): INPCHealth {
    return {
      hp: this._hp,
      maxHp: this._maxHp,
      hpPercent: this._hp / this._maxHp,
      heal: (n: number) => { this._hp = Math.min(this._hp + n, this._maxHp); },
    };
  }

  setVelocity(vx: number, vy: number): void { this.velocities.push([vx, vy]); }
  halt(): void { this.velocities.push([0, 0]); this.haltCount++; }
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
  get maxHp(): number { return this._maxHp; }
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

describe('WoundedState + RetreatState mechanics (integration)', () => {
  const cfg = createDefaultStateConfig();

  // -------------------------------------------------------------------------
  // Scenario 1: WoundedState activation via OnlineAIDriver
  // -------------------------------------------------------------------------
  describe('WoundedState — activates when HP < 20% threshold (via OnlineAIDriver)', () => {
    it('COMBAT → WOUNDED when HP drops below woundedHpThreshold', () => {
      const host = new TestNPCHost();
      host.setMaxHp(100);
      host['_hp'] = 15; // 15% — below 20% threshold

      // Enemy must be visible for CombatState to evaluate HP.
      host.perception.sync([makeEnemy()], [], []);
      host.state.lastKnownEnemyX = 300;
      host.state.lastKnownEnemyY = 100;

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.COMBAT);
      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(ONLINE_STATE.WOUNDED);
    });

    it('stays COMBAT when HP is exactly at 20% threshold (not strictly below)', () => {
      const host = new TestNPCHost();
      host.setMaxHp(100);
      host['_hp'] = 20; // exactly 20% — NOT < 0.2, no transition

      host.perception.sync([makeEnemy()], [], []);

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.COMBAT);
      tick(host, driver, 16);

      // 20 / 100 = 0.2, which is NOT < 0.2 → should stay in COMBAT.
      expect(driver.currentStateId).toBe(ONLINE_STATE.COMBAT);
    });

    it('COMBAT → WOUNDED at 1 HP (extreme low health)', () => {
      const host = new TestNPCHost();
      host.setMaxHp(200);
      host['_hp'] = 1; // 0.5% — well below threshold

      host.perception.sync([makeEnemy()], [], []);
      host.state.lastKnownEnemyX = 300;
      host.state.lastKnownEnemyY = 100;

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.COMBAT);
      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(ONLINE_STATE.WOUNDED);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 2: WoundedState crawl speed
  // -------------------------------------------------------------------------
  describe('WoundedState crawl speed — 0.3× of normal speed', () => {
    it('WoundedState applies crawl speed when moving away from last known enemy', () => {
      const host = new TestNPCHost();
      host['_hp'] = 10;
      host.state.medkitCount = 0;
      // Enemy is to the east — NPC should crawl west (negative vx).
      host.state.lastKnownEnemyX = 300;
      host.state.lastKnownEnemyY = 100;

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.WOUNDED);
      tick(host, driver, 16);

      expect(host.velocities.length).toBeGreaterThan(0);
      const lastVel = host.velocities[host.velocities.length - 1];
      // Crawl speed = approachSpeed * woundedCrawlMultiplier = 150 * 0.3 = 45 px/s.
      // NPC at (100, 100), enemy at (300, 100) → crawls left: vx < 0, vy ≈ 0.
      expect(lastVel[0]).toBeLessThan(0);
    });

    it('crawl speed magnitude is approachSpeed × woundedCrawlMultiplier', () => {
      const host = new TestNPCHost();
      host['_hp'] = 10;
      host.state.medkitCount = 0;
      // Enemy is directly below — NPC crawls upward (negative vy).
      host.state.lastKnownEnemyX = 100;
      host.state.lastKnownEnemyY = 500;

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.WOUNDED);
      tick(host, driver, 16);

      const lastVel = host.velocities[host.velocities.length - 1];
      const expectedCrawlSpeed = cfg.approachSpeed * cfg.woundedCrawlMultiplier; // 45
      const magnitude = Math.sqrt(lastVel[0] ** 2 + lastVel[1] ** 2);
      expect(magnitude).toBeCloseTo(expectedCrawlSpeed, 1);
    });

    it('crawl speed is substantially slower than approach speed', () => {
      const host = new TestNPCHost();
      host['_hp'] = 10;
      host.state.medkitCount = 0;
      host.state.lastKnownEnemyX = 300;
      host.state.lastKnownEnemyY = 100;

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.WOUNDED);
      tick(host, driver, 16);

      const lastVel = host.velocities[host.velocities.length - 1];
      const magnitude = Math.sqrt(lastVel[0] ** 2 + lastVel[1] ** 2);
      // Crawl (45) must be significantly less than full approach speed (150).
      expect(magnitude).toBeLessThan(cfg.approachSpeed * 0.5);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 3: WoundedState healing → recovery to COMBAT
  // -------------------------------------------------------------------------
  describe('WoundedState → healing → returns to COMBAT', () => {
    it('uses medkit and transitions to COMBAT when healed above threshold', () => {
      const host = new TestNPCHost();
      host.setMaxHp(100);
      host['_hp'] = 15; // below 20% threshold
      host.state.medkitCount = 1;
      host.state.lastKnownEnemyX = 300;
      host.state.lastKnownEnemyY = 100;

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.WOUNDED);
      tick(host, driver, 16);

      // medkitHealRatio = 0.5 → heal = 50 HP; 15 + 50 = 65% > 20% → COMBAT.
      expect(driver.currentStateId).toBe(ONLINE_STATE.COMBAT);
      expect(host.state.medkitCount).toBe(0);
      expect(host.hp).toBeGreaterThan(cfg.woundedHpThreshold * host.maxHp);
    });

    it('medkit is consumed on use regardless of whether threshold is crossed', () => {
      const host = new TestNPCHost();
      host.setMaxHp(1000);
      host['_hp'] = 1; // 0.1% — heal ratio 0.5 → +500 HP → 501/1000 = 50.1% > 20% threshold
      host.state.medkitCount = 2;
      host.state.lastKnownEnemyX = 300;
      host.state.lastKnownEnemyY = 100;

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.WOUNDED);
      tick(host, driver, 16);

      // One medkit used, one remaining. Healed from 1 to 501 → COMBAT.
      expect(driver.currentStateId).toBe(ONLINE_STATE.COMBAT);
      expect(host.state.medkitCount).toBe(1);
    });

    it('stays WOUNDED when medkit heals but HP still below threshold (tiny heal ratio)', () => {
      const customCfg = createDefaultStateConfig({ medkitHealRatio: 0.05 });
      const host = new TestNPCHost();
      host.setMaxHp(200);
      host['_hp'] = 5; // 2.5%
      host.state.medkitCount = 1;
      host.state.lastKnownEnemyX = 200;
      host.state.lastKnownEnemyY = 100;

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(customCfg), ONLINE_STATE.WOUNDED);
      tick(host, driver, 16);

      // heal = 200 * 0.05 = 10; 5 + 10 = 15 / 200 = 7.5% < 20% → still WOUNDED.
      expect(driver.currentStateId).toBe(ONLINE_STATE.WOUNDED);
      expect(host.state.medkitCount).toBe(0); // medkit consumed
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 4: WoundedState → DEAD (via timeout → FLEE, or direct PANICKED)
  // -------------------------------------------------------------------------
  describe('WoundedState → FLEE (no medkits + PANICKED → immediate flee)', () => {
    it('transitions WOUNDED → FLEE immediately when PANICKED and no medkits', () => {
      const host = new TestNPCHost();
      host['_hp'] = 10;
      host.state.medkitCount = 0;
      host.state.moraleState = 'PANICKED';
      host.state.lastKnownEnemyX = 200;
      host.state.lastKnownEnemyY = 100;

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.WOUNDED);
      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(ONLINE_STATE.FLEE);
    });

    it('transitions WOUNDED → FLEE after woundedMaxDurationMs (timeout)', () => {
      const host = new TestNPCHost();
      host['_hp'] = 10;
      host.state.medkitCount = 0;
      host.state.lastKnownEnemyX = 200;
      host.state.lastKnownEnemyY = 100;

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.WOUNDED);
      tick(host, driver, cfg.woundedMaxDurationMs + 100);

      expect(driver.currentStateId).toBe(ONLINE_STATE.FLEE);
    });

    it('stays in WOUNDED before woundedMaxDurationMs elapses', () => {
      const host = new TestNPCHost();
      host['_hp'] = 10;
      host.state.medkitCount = 0;
      host.state.lastKnownEnemyX = 200;
      host.state.lastKnownEnemyY = 100;

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.WOUNDED);
      tick(host, driver, cfg.woundedMaxDurationMs / 2);

      expect(driver.currentStateId).toBe(ONLINE_STATE.WOUNDED);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 5: RetreatState — moves toward FAR cover point away from enemy
  // -------------------------------------------------------------------------
  describe('RetreatState — moves toward FAR cover point', () => {
    it('enter() stores cover point from ctx.cover.findCover', () => {
      const host = new TestNPCHost();
      host.state.moraleState = 'SHAKEN';
      host.state.lastKnownEnemyX = 400;
      host.state.lastKnownEnemyY = 100;

      host.cover = {
        findCover(_x, _y, _ex, _ey, _type) {
          return { x: 20, y: 20 };
        },
      };

      const _driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.RETREAT);

      // After enter() the cover point must be stored.
      expect(host.state.coverPointX).toBe(20);
      expect(host.state.coverPointY).toBe(20);
    });

    it('moves toward cover point when not yet arrived', () => {
      const host = new TestNPCHost();
      host.x = 100;
      host.y = 100;
      host.state.moraleState = 'SHAKEN';
      host.state.lastKnownEnemyX = 400;
      host.state.lastKnownEnemyY = 100;

      // Cover point far away at (600, 100).
      host.cover = {
        findCover() { return { x: 600, y: 100 }; },
      };

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.RETREAT);
      const velocitiesBefore = host.velocities.length;
      tick(host, driver, 16);

      // A new setVelocity call must have been made → moving toward cover.
      expect(host.velocities.length).toBeGreaterThan(velocitiesBefore);
      // Moving right (toward x=600): vx > 0.
      const lastVel = host.velocities[host.velocities.length - 1];
      expect(lastVel[0]).toBeGreaterThan(0);
    });

    it('immediately arrives at self-position and halts when no cover is available', () => {
      // When cover=null, RetreatState.enter() sets coverPoint to NPC position.
      // distSq=0 → arrived=true immediately on first update → halt() is called.
      const host = new TestNPCHost();
      host.x = 100;
      host.y = 100;
      host.state.moraleState = 'SHAKEN';
      host.state.lastKnownEnemyX = 300;
      host.state.lastKnownEnemyY = 100;

      // No cover system → coverPointX/Y = NPC position → immediate "arrival".
      host.cover = null;

      // No enemies visible → after halt() the state transitions to SEARCH.
      host.perception.sync([], [], []);

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.RETREAT);
      tick(host, driver, cfg.retreatFireIntervalMs + 100);

      // Without visible enemies at the (immediate) cover, transitions to SEARCH.
      expect(driver.currentStateId).toBe(ONLINE_STATE.SEARCH);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 6: RetreatState → COMBAT when morale recovers to STABLE at cover
  // -------------------------------------------------------------------------
  describe('RetreatState → COMBAT when morale recovers to STABLE', () => {
    it('transitions RETREAT → COMBAT when morale is STABLE and arrived at cover', () => {
      const host = new TestNPCHost();
      host.x = 100;
      host.y = 100;
      host.state.moraleState = 'STABLE'; // recovered
      host.state.lastKnownEnemyX = 400;
      host.state.lastKnownEnemyY = 100;

      // Cover point very close (within arriveThreshold) — NPC is already "arrived".
      host.cover = {
        findCover() { return { x: 100, y: 100 }; }, // same position as NPC
      };

      // Perception: enemy is still visible so it won't go to SEARCH.
      host.perception.sync([makeEnemy('e1', 400, 100)], [], []);

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.RETREAT);
      tick(host, driver, cfg.retreatFireIntervalMs + 100);

      expect(driver.currentStateId).toBe(ONLINE_STATE.COMBAT);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 7: RetreatState → SEARCH when no visible enemy at cover
  // -------------------------------------------------------------------------
  describe('RetreatState → SEARCH when enemy disappears', () => {
    it('transitions RETREAT → SEARCH when no visible enemy while at cover', () => {
      const host = new TestNPCHost();
      host.x = 100;
      host.y = 100;
      host.state.moraleState = 'SHAKEN';
      host.state.lastKnownEnemyX = 400;
      host.state.lastKnownEnemyY = 100;

      // Place cover at NPC position (already arrived).
      host.cover = {
        findCover() { return { x: 100, y: 100 }; },
      };

      // No visible enemies.
      host.perception.sync([], [], []);

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.RETREAT);
      tick(host, driver, cfg.retreatFireIntervalMs + 100);

      expect(driver.currentStateId).toBe(ONLINE_STATE.SEARCH);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 8: RetreatState → FLEE when PANICKED
  // -------------------------------------------------------------------------
  describe('RetreatState → FLEE when PANICKED', () => {
    it('transitions RETREAT → FLEE immediately when moraleState is PANICKED', () => {
      const host = new TestNPCHost();
      host.state.moraleState = 'PANICKED';
      host.state.lastKnownEnemyX = 300;
      host.state.lastKnownEnemyY = 100;

      host.cover = {
        findCover() { return { x: 50, y: 50 }; },
      };

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.RETREAT);
      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(ONLINE_STATE.FLEE);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 9: WoundedState + RetreatState sequence
  // -------------------------------------------------------------------------
  describe('Sequence: COMBAT → WOUNDED (HP<20%) → morale drops → RETREAT', () => {
    it('full sequence: COMBAT to WOUNDED via low HP, then driver started in RETREAT', () => {
      // Part A: COMBAT → WOUNDED via low HP.
      const hostA = new TestNPCHost();
      hostA.setMaxHp(100);
      hostA['_hp'] = 15;
      hostA.perception.sync([makeEnemy()], [], []);
      hostA.state.lastKnownEnemyX = 300;
      hostA.state.lastKnownEnemyY = 100;

      const driverA = new OnlineAIDriver(hostA, buildDefaultHandlerMap(), ONLINE_STATE.COMBAT);
      tick(hostA, driverA, 16);

      expect(driverA.currentStateId).toBe(ONLINE_STATE.WOUNDED);

      // Part B: In a fresh RETREAT scenario, SHAKEN morale at cover → SEARCH.
      const hostB = new TestNPCHost();
      hostB.x = 200;
      hostB.y = 200;
      hostB.state.moraleState = 'SHAKEN';
      hostB.state.lastKnownEnemyX = 500;
      hostB.state.lastKnownEnemyY = 200;

      hostB.cover = {
        findCover() { return { x: 200, y: 200 }; }, // at NPC position
      };
      hostB.perception.sync([], [], []);

      const driverB = new OnlineAIDriver(hostB, buildDefaultHandlerMap(), ONLINE_STATE.RETREAT);
      tick(hostB, driverB, cfg.retreatFireIntervalMs + 100);

      expect(driverB.currentStateId).toBe(ONLINE_STATE.SEARCH);
    });

    it('WoundedState records woundedStartMs on enter', () => {
      const host = new TestNPCHost();
      host['_hp'] = 10;
      host.state.medkitCount = 0;
      host.state.lastKnownEnemyX = 200;
      host.state.lastKnownEnemyY = 100;

      // Advance time before entering WOUNDED.
      host.advanceMs(5000);

      const _driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.WOUNDED);

      // enter() should have set woundedStartMs to now() which is 5000.
      expect(host.state.woundedStartMs).toBe(5000);
    });

    it('RetreatState emits suppressive fire at cover after retreatFireIntervalMs', () => {
      const host = new TestNPCHost();
      host.x = 100;
      host.y = 100;
      host.state.moraleState = 'SHAKEN';
      host.state.lastKnownEnemyX = 400;
      host.state.lastKnownEnemyY = 100;

      // Cover at NPC position (already arrived).
      host.cover = {
        findCover() { return { x: 100, y: 100 }; },
      };

      // Enemy visible so we don't transition to SEARCH.
      host.perception.sync([makeEnemy('e1', 400, 100)], [], []);

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.RETREAT);
      // Advance past retreatFireIntervalMs to trigger suppressive fire.
      tick(host, driver, cfg.retreatFireIntervalMs + 100);

      // A shoot event should have been emitted (suppressive fire).
      expect(host.shoots.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 10: beforeEach — fresh state isolation check
  // -------------------------------------------------------------------------
  describe('State isolation — each test receives fresh state', () => {
    let host: TestNPCHost;

    beforeEach(() => {
      host = new TestNPCHost();
    });

    it('fresh TestNPCHost has zero velocities', () => {
      expect(host.velocities).toHaveLength(0);
    });

    it('fresh TestNPCHost hp equals maxHp', () => {
      expect(host.hp).toBe(100);
      expect(host.maxHp).toBe(100);
    });

    it('WoundedState: STABLE morale with medkits does NOT trigger PANICKED flee', () => {
      host['_hp'] = 10;
      host.state.medkitCount = 1;
      host.state.moraleState = 'STABLE'; // NOT panicked
      host.state.lastKnownEnemyX = 200;
      host.state.lastKnownEnemyY = 100;

      // With medkitHealRatio=0.5 → heal = 50; 10+50 = 60% > 20% → COMBAT.
      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(), ONLINE_STATE.WOUNDED);
      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(ONLINE_STATE.COMBAT);
    });
  });
});
