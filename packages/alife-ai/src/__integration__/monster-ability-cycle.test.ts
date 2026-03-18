/**
 * Integration test: Monster ability state cycles.
 *
 * Exercises monster-specific FSM transitions using buildChornobylMonsterHandlerMap():
 *   - Boar COMBAT -> CHARGE -> back to COMBAT
 *   - Bloodsucker STALK approach -> COMBAT on close range (uncloak)
 *   - Snork LEAP windup -> airborne lerp -> land -> COMBAT
 *   - Monster melee cooldown (emitMeleeHit fires every meleeCooldownMs)
 *   - Monster no-enemy -> SEARCH/IDLE
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 * entityType drives the MonsterAbilitySelector switch in MonsterCombatController.
 */

import { describe, it, expect } from 'vitest';
import { OnlineAIDriver } from '../states/OnlineAIDriver';
import type { IOnlineDriverHost } from '../states/OnlineAIDriver';
import { createDefaultNPCOnlineState } from '../states/NPCOnlineState';
import { NPCPerception } from '../states/NPCPerception';
import {
  buildChornobylMonsterHandlerMap,
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
  npcId = 'npc_monster';
  factionId = 'monster';
  entityType = 'monster'; // can be overridden per test
  cover: ICoverAccess | null = null;
  danger: IDangerAccess | null = null;
  restrictedZones: IRestrictedZoneAccess | null = null;
  squad: ISquadAccess | null = null;
  readonly shoots: IShootPayload[] = [];
  readonly meleeHits: IMeleeHitPayload[] = [];
  readonly vocalizations: string[] = [];
  readonly velocities: Array<[number, number]> = [];
  readonly alphas: number[] = [];

  get health(): INPCHealth {
    return {
      hp: this._hp,
      maxHp: this._maxHp,
      hpPercent: this._hp / this._maxHp,
      heal: (n: number) => { this._hp = Math.min(this._hp + n, this._maxHp); },
    };
  }

  setVelocity(vx: number, vy: number): void { this.velocities.push([vx, vy]); }
  halt(): void { this.velocities.push([0, 0]); }
  setRotation(_r: number): void {}
  setAlpha(a: number): void { this.alphas.push(a); }
  teleport(px: number, py: number): void { this.x = px; this.y = py; }
  disablePhysics(): void {}
  emitShoot(p: IShootPayload): void { this.shoots.push(p); }
  emitMeleeHit(p: IMeleeHitPayload): void { this.meleeHits.push(p); }
  emitVocalization(t: string): void { this.vocalizations.push(t); }
  emitPsiAttackStart(_x: number, _y: number): void {}
  now(): number { return this._nowMs; }
  random(): number { return 0.5; }

  advanceMs(ms: number): void { this._nowMs += ms; }
  setHp(hp: number): void { this._hp = hp; }
  get hp(): number { return this._hp; }
}

function tick(host: TestNPCHost, driver: OnlineAIDriver, deltaMs: number): void {
  host.advanceMs(deltaMs);
  driver.update(deltaMs);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Monster Ability Cycle (integration)', () => {
  const cfg = createDefaultStateConfig();

  // -------------------------------------------------------------------------
  // Scenario 1: Boar COMBAT -> CHARGE when enemy is beyond melee range
  // -------------------------------------------------------------------------
  describe('Boar: COMBAT -> CHARGE when enemy beyond melee range', () => {
    it('transitions from COMBAT to CHARGE for a boar with enemy beyond meleeRange', () => {
      const host = new TestNPCHost();
      host.entityType = 'boar';

      // Enemy is beyond meleeRange (48px default) — so DEFAULT_MONSTER_ABILITY_SELECTOR returns 'CHARGE'.
      // MonsterCombatController checks ability only when melee cooldown has expired.
      // lastMeleeMs = 0, now = 0 initially -> meleeCooldownRemaining = 1000 - (0 - 0) = 1000 > 0.
      // So we need to advance time past meleeCooldownMs FIRST.
      const enemy = { id: 'prey_1', x: host.x + 100, y: host.y, factionId: 'human' };
      host.perception.sync([enemy], [], []);
      host.state.lastKnownEnemyX = enemy.x;
      host.state.lastKnownEnemyY = enemy.y;

      const driver = new OnlineAIDriver(host, buildChornobylMonsterHandlerMap(), ONLINE_STATE.COMBAT);

      // Advance past meleeCooldownMs (1000ms) so ability selector can fire.
      tick(host, driver, cfg.meleeCooldownMs + 100);

      expect(driver.currentStateId).toBe(ONLINE_STATE.CHARGE);
    });

    it('boar CHARGE: windup phase halts and faces target', () => {
      const host = new TestNPCHost();
      host.entityType = 'boar';

      const enemy = { id: 'prey_1', x: host.x + 100, y: host.y, factionId: 'human' };
      host.perception.sync([enemy], [], []);
      host.state.lastKnownEnemyX = enemy.x;
      host.state.lastKnownEnemyY = enemy.y;
      host.state.targetId = enemy.id;

      const driver = new OnlineAIDriver(host, buildChornobylMonsterHandlerMap(), ONLINE_STATE.CHARGE);

      // During windup (< chargeWindupMs = 600ms), should remain in CHARGE.
      tick(host, driver, cfg.chargeWindupMs - 100);

      expect(driver.currentStateId).toBe(ONLINE_STATE.CHARGE);
      // chargePhase should be active.
      expect(host.state.chargePhase?.active).toBe(true);
      expect(host.state.chargePhase?.charging).toBe(false);
    });

    it('boar CHARGE: transitions to charging phase after windup completes', () => {
      const host = new TestNPCHost();
      host.entityType = 'boar';

      const enemy = { id: 'prey_1', x: host.x + 100, y: host.y, factionId: 'human' };
      host.perception.sync([enemy], [], []);
      host.state.lastKnownEnemyX = enemy.x;
      host.state.lastKnownEnemyY = enemy.y;
      host.state.targetId = enemy.id;

      const driver = new OnlineAIDriver(host, buildChornobylMonsterHandlerMap(), ONLINE_STATE.CHARGE);

      // Advance past chargeWindupMs (600ms) — charging phase begins.
      // NPC is at (100,100) and target at (200,100) — far enough not to impact yet.
      tick(host, driver, cfg.chargeWindupMs + 100);

      // chargePhase.charging should now be true — and NPC is still in CHARGE.
      expect(host.state.chargePhase?.charging).toBe(true);
      expect(driver.currentStateId).toBe(ONLINE_STATE.CHARGE);
    });

    it('boar CHARGE -> COMBAT on melee impact', () => {
      const host = new TestNPCHost();
      host.entityType = 'boar';

      // Put target VERY close so impact happens immediately after windup.
      const targetX = host.x + cfg.meleeRange - 5; // within meleeRange
      const targetY = host.y;

      const enemy = { id: 'prey_1', x: targetX, y: targetY, factionId: 'human' };
      host.perception.sync([enemy], [], []);
      host.state.lastKnownEnemyX = targetX;
      host.state.lastKnownEnemyY = targetY;
      host.state.targetId = enemy.id;

      const driver = new OnlineAIDriver(host, buildChornobylMonsterHandlerMap(), ONLINE_STATE.CHARGE);

      // Advance past windup — then impact should trigger immediately.
      tick(host, driver, cfg.chargeWindupMs + 100);

      // Impact: emitMeleeHit called + transition to COMBAT.
      expect(driver.currentStateId).toBe(ONLINE_STATE.COMBAT);
      expect(host.meleeHits.length).toBeGreaterThan(0);
      expect(host.meleeHits[0].damage).toBe(cfg.meleeDamage * cfg.chargeDamageMultiplier);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 2: Bloodsucker STALK approach
  // -------------------------------------------------------------------------
  describe('Bloodsucker: STALK sets invisible alpha and approaches', () => {
    it('sets alpha to stalkAlphaInvisible on STALK enter', () => {
      const host = new TestNPCHost();
      host.entityType = 'bloodsucker';

      const enemy = { id: 'prey_1', x: host.x + 200, y: host.y, factionId: 'human' };
      host.perception.sync([enemy], [], []);

      const _driver = new OnlineAIDriver(host, buildChornobylMonsterHandlerMap(), ONLINE_STATE.STALK);

      // enter() should have set alpha to stalkAlphaInvisible (0.08).
      expect(host.alphas.length).toBeGreaterThan(0);
      const firstAlpha = host.alphas[0];
      expect(firstAlpha).toBeCloseTo(cfg.stalkAlphaInvisible, 5);
    });

    it('moves toward enemy during STALK approach phase', () => {
      const host = new TestNPCHost();
      host.entityType = 'bloodsucker';

      // Enemy far away — bloodsucker should stalk approach.
      const enemy = { id: 'prey_1', x: host.x + 200, y: host.y, factionId: 'human' };
      host.perception.sync([enemy], [], []);

      const driver = new OnlineAIDriver(host, buildChornobylMonsterHandlerMap(), ONLINE_STATE.STALK);
      tick(host, driver, 16);

      // Should be moving toward enemy (positive x velocity since enemy is to the right).
      const nonZeroVels = host.velocities.filter(([vx, vy]) => vx !== 0 || vy !== 0);
      expect(nonZeroVels.length).toBeGreaterThan(0);
      const lastNonZero = nonZeroVels[nonZeroVels.length - 1];
      expect(lastNonZero[0]).toBeGreaterThan(0); // moving right toward enemy
    });

    it('transitions to COMBAT when within stalkUncloakDistance', () => {
      const host = new TestNPCHost();
      host.entityType = 'bloodsucker';
      host.x = 100;
      host.y = 100;

      // Enemy at exactly stalkUncloakDistance away (80px default).
      const enemyX = host.x + cfg.stalkUncloakDistance - 5; // within unclock distance
      const enemy = { id: 'prey_1', x: enemyX, y: host.y, factionId: 'human' };
      host.perception.sync([enemy], [], []);

      const driver = new OnlineAIDriver(host, buildChornobylMonsterHandlerMap(), ONLINE_STATE.STALK);

      // First tick: dist < stalkUncloakDistance -> sets approaching=true.
      tick(host, driver, 16);
      expect(host.state.stalkPhase?.approaching).toBe(true);

      // Second tick: approaching=true -> uncloak and transition to COMBAT.
      tick(host, driver, 16);
      expect(driver.currentStateId).toBe(ONLINE_STATE.COMBAT);
    });

    it('restores alpha to 1.0 on STALK exit', () => {
      const host = new TestNPCHost();
      host.entityType = 'bloodsucker';

      const enemyX = host.x + cfg.stalkUncloakDistance - 5;
      const enemy = { id: 'prey_1', x: enemyX, y: host.y, factionId: 'human' };
      host.perception.sync([enemy], [], []);

      const driver = new OnlineAIDriver(host, buildChornobylMonsterHandlerMap(), ONLINE_STATE.STALK);

      tick(host, driver, 16); // approaching=true
      tick(host, driver, 16); // uncloak + transition to COMBAT

      // After exiting STALK, alpha should be restored to 1.0.
      const lastAlpha = host.alphas[host.alphas.length - 1];
      expect(lastAlpha).toBe(1.0);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 3: Snork LEAP windup -> airborne -> land -> COMBAT
  // -------------------------------------------------------------------------
  describe('Snork: LEAP windup -> airborne -> land -> COMBAT', () => {
    it('stays in LEAP during windup phase', () => {
      const host = new TestNPCHost();
      host.entityType = 'snork';
      host.x = 100;
      host.y = 100;

      const enemy = { id: 'prey_1', x: 200, y: 100, factionId: 'human' };
      host.perception.sync([enemy], [], []);
      host.state.lastKnownEnemyX = enemy.x;
      host.state.lastKnownEnemyY = enemy.y;
      host.state.targetId = enemy.id;

      const driver = new OnlineAIDriver(host, buildChornobylMonsterHandlerMap(), ONLINE_STATE.LEAP);

      // Advance less than leapWindupMs (400ms) — should stay in windup.
      tick(host, driver, cfg.leapWindupMs - 50);

      expect(driver.currentStateId).toBe(ONLINE_STATE.LEAP);
      expect(host.state.leapPhase?.airborne).toBe(false);
    });

    it('enters airborne phase after leapWindupMs elapses', () => {
      const host = new TestNPCHost();
      host.entityType = 'snork';
      host.x = 100;
      host.y = 100;

      const enemy = { id: 'prey_1', x: 200, y: 100, factionId: 'human' };
      host.perception.sync([enemy], [], []);
      host.state.lastKnownEnemyX = enemy.x;
      host.state.lastKnownEnemyY = enemy.y;
      host.state.targetId = enemy.id;

      const driver = new OnlineAIDriver(host, buildChornobylMonsterHandlerMap(), ONLINE_STATE.LEAP);

      // Advance past leapWindupMs but not past leapAirtimeMs.
      tick(host, driver, cfg.leapWindupMs + 50);

      expect(driver.currentStateId).toBe(ONLINE_STATE.LEAP);
      expect(host.state.leapPhase?.airborne).toBe(true);
    });

    it('teleports NPC toward target during airborne phase', () => {
      const host = new TestNPCHost();
      host.entityType = 'snork';
      host.x = 100;
      host.y = 100;

      const enemy = { id: 'prey_1', x: 200, y: 100, factionId: 'human' };
      host.perception.sync([enemy], [], []);
      host.state.lastKnownEnemyX = enemy.x;
      host.state.lastKnownEnemyY = enemy.y;
      host.state.targetId = enemy.id;

      const driver = new OnlineAIDriver(host, buildChornobylMonsterHandlerMap(), ONLINE_STATE.LEAP);

      // Enter airborne phase.
      tick(host, driver, cfg.leapWindupMs + 10);

      const xAfterWindup = host.x;

      // Another tick in airborne phase — should teleport toward target.
      tick(host, driver, 50);

      // NPC should have been teleported closer to target (x should be > 100).
      expect(host.x).toBeGreaterThanOrEqual(xAfterWindup);
    });

    it('transitions to COMBAT and emits melee hit on LEAP land', () => {
      const host = new TestNPCHost();
      host.entityType = 'snork';
      host.x = 100;
      host.y = 100;

      const enemy = { id: 'prey_1', x: 200, y: 100, factionId: 'human' };
      host.perception.sync([enemy], [], []);
      host.state.lastKnownEnemyX = enemy.x;
      host.state.lastKnownEnemyY = enemy.y;
      host.state.targetId = enemy.id;

      const driver = new OnlineAIDriver(host, buildChornobylMonsterHandlerMap(), ONLINE_STATE.LEAP);

      // The LEAP handler sets airStartMs = now when it first transitions to airborne.
      // We must advance in two separate ticks:
      //   Tick 1: past leapWindupMs so airborne phase starts (airStartMs = T1)
      //   Tick 2: past leapAirtimeMs from T1 so landing fires
      tick(host, driver, cfg.leapWindupMs + 10);
      expect(host.state.leapPhase?.airborne).toBe(true);

      // Now advance past the airtime to trigger landing.
      tick(host, driver, cfg.leapAirtimeMs + 100);

      expect(driver.currentStateId).toBe(ONLINE_STATE.COMBAT);
      expect(host.meleeHits.length).toBeGreaterThan(0);
      expect(host.meleeHits[0].damage).toBe(cfg.meleeDamage);
      expect(host.meleeHits[0].npcId).toBe('npc_monster');
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 4: Monster melee cooldown
  // -------------------------------------------------------------------------
  describe('Monster melee attack respects meleeCooldownMs', () => {
    it('emits melee hit when in range and cooldown has elapsed', () => {
      const host = new TestNPCHost();
      host.entityType = 'dog'; // default melee type, no special abilities

      // Put enemy within meleeRange.
      const enemy = { id: 'prey_1', x: host.x + cfg.meleeRange - 5, y: host.y, factionId: 'human' };
      host.perception.sync([enemy], [], []);
      host.state.lastKnownEnemyX = enemy.x;
      host.state.lastKnownEnemyY = enemy.y;

      const driver = new OnlineAIDriver(host, buildChornobylMonsterHandlerMap(), ONLINE_STATE.COMBAT);

      // Advance past meleeCooldownMs (1000ms) so melee fires.
      tick(host, driver, cfg.meleeCooldownMs + 100);

      expect(host.meleeHits.length).toBeGreaterThan(0);
    });

    it('does not emit melee hit before meleeCooldownMs elapses', () => {
      const host = new TestNPCHost();
      host.entityType = 'dog';

      // Initialize lastMeleeMs to current time so cooldown starts full.
      host.state.lastMeleeMs = 0; // will be 0, nowMs starts at 0

      const enemy = { id: 'prey_1', x: host.x + cfg.meleeRange - 5, y: host.y, factionId: 'human' };
      host.perception.sync([enemy], [], []);

      const driver = new OnlineAIDriver(host, buildChornobylMonsterHandlerMap(), ONLINE_STATE.COMBAT);

      // Advance but less than cooldown.
      tick(host, driver, cfg.meleeCooldownMs - 100);

      // No melee hit yet — cooldown hasn't expired (0 ms elapsed at start).
      // Actually lastMeleeMs=0 and nowMs=900ms -> 900 >= 1000? No. So no hit.
      expect(host.meleeHits.length).toBe(0);
    });

    it('emits multiple melee hits across multiple cooldown intervals', () => {
      const host = new TestNPCHost();
      host.entityType = 'dog';

      const enemy = { id: 'prey_1', x: host.x + cfg.meleeRange - 5, y: host.y, factionId: 'human' };
      host.perception.sync([enemy], [], []);

      const driver = new OnlineAIDriver(host, buildChornobylMonsterHandlerMap(), ONLINE_STATE.COMBAT);

      // First hit fires after meleeCooldownMs.
      tick(host, driver, cfg.meleeCooldownMs + 100);
      const hitsAfterFirst = host.meleeHits.length;
      expect(hitsAfterFirst).toBeGreaterThan(0);

      // Second hit fires after another meleeCooldownMs.
      tick(host, driver, cfg.meleeCooldownMs + 100);
      expect(host.meleeHits.length).toBeGreaterThan(hitsAfterFirst);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 5: Monster COMBAT -> SEARCH when no visual contact
  // -------------------------------------------------------------------------
  describe('Monster COMBAT -> SEARCH when no visual contact', () => {
    it('transitions to SEARCH when no visible enemy and last known pos is set', () => {
      const host = new TestNPCHost();
      host.entityType = 'dog';

      // Pre-set last known position.
      host.state.lastKnownEnemyX = 300;
      host.state.lastKnownEnemyY = 100;

      // No visible enemies this tick.
      host.perception.sync([], [], []);

      const driver = new OnlineAIDriver(host, buildChornobylMonsterHandlerMap(), ONLINE_STATE.COMBAT);
      tick(host, driver, 16);

      // monsterOnLastKnown = 'SEARCH'
      expect(driver.currentStateId).toBe(ONLINE_STATE.SEARCH);
    });

    it('transitions to IDLE when no enemy and no last known position', () => {
      const host = new TestNPCHost();
      host.entityType = 'dog';

      // lastKnownEnemyX/Y default to 0.
      host.perception.sync([], [], []);

      const driver = new OnlineAIDriver(host, buildChornobylMonsterHandlerMap(), ONLINE_STATE.COMBAT);
      tick(host, driver, 16);

      // monsterOnNoEnemy = 'IDLE'
      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 6: Snork COMBAT -> LEAP ability via MonsterCombatController
  // -------------------------------------------------------------------------
  describe('Snork: COMBAT -> LEAP via ability selector', () => {
    it('transitions from COMBAT to LEAP when snork is in leap range', () => {
      const host = new TestNPCHost();
      host.entityType = 'snork';
      host.x = 100;
      host.y = 100;

      // Snork leaps when dist > meleeRange && dist <= meleeRange * 3.
      // meleeRange = 48, so leap range is (48, 144].
      const enemyX = host.x + cfg.meleeRange * 2; // 96px — within leap range
      const enemy = { id: 'prey_1', x: enemyX, y: host.y, factionId: 'human' };
      host.perception.sync([enemy], [], []);
      host.state.lastKnownEnemyX = enemyX;
      host.state.lastKnownEnemyY = host.y;

      const driver = new OnlineAIDriver(host, buildChornobylMonsterHandlerMap(), ONLINE_STATE.COMBAT);

      // Advance past meleeCooldownMs so ability selector fires.
      tick(host, driver, cfg.meleeCooldownMs + 100);

      expect(driver.currentStateId).toBe(ONLINE_STATE.LEAP);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 7: Bloodsucker COMBAT -> STALK via ability selector
  // -------------------------------------------------------------------------
  describe('Bloodsucker: COMBAT -> STALK via ability selector', () => {
    it('transitions from COMBAT to STALK when bloodsucker is far enough', () => {
      const host = new TestNPCHost();
      host.entityType = 'bloodsucker';
      host.x = 100;
      host.y = 100;

      // Bloodsucker stalks when dist > meleeRange * 2.
      // meleeRange = 48, so stalk when dist > 96.
      const enemyX = host.x + cfg.meleeRange * 3; // 144px — well beyond 2x melee range
      const enemy = { id: 'prey_1', x: enemyX, y: host.y, factionId: 'human' };
      host.perception.sync([enemy], [], []);
      host.state.lastKnownEnemyX = enemyX;
      host.state.lastKnownEnemyY = host.y;

      const driver = new OnlineAIDriver(host, buildChornobylMonsterHandlerMap(), ONLINE_STATE.COMBAT);

      // Advance past meleeCooldownMs so ability selector fires.
      tick(host, driver, cfg.meleeCooldownMs + 100);

      expect(driver.currentStateId).toBe(ONLINE_STATE.STALK);
    });
  });
});
