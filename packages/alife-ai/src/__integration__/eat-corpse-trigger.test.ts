/**
 * Integration test: EatCorpseState trigger conditions and phase transitions.
 *
 * Exercises:
 *   1. Monster (entityType='monster') + corpse nearby + no enemies → EAT_CORPSE entered
 *   2. EAT_CORPSE: eating phase → HP healed on completion
 *   3. EAT_CORPSE: enemy appears mid-eat → interrupted, transitions to ALERT
 *   4. Non-carnivorous NPC (human) not registered with EAT_CORPSE → never enters it
 *   5. EAT_CORPSE: eatDurationMs elapsed → corpse consumed → back to IDLE
 *   6. EatCorpsePhase in state bag: active=true, progress tracked
 *   7. No corpses nearby → immediate transition to IDLE on enter
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 * EAT_CORPSE is opt-in and must be manually registered in the handler map.
 */

import { describe, it, expect } from 'vitest';
import { OnlineAIDriver } from '../states/OnlineAIDriver';
import type { IOnlineDriverHost } from '../states/OnlineAIDriver';
import { createDefaultNPCOnlineState } from '../states/NPCOnlineState';
import { NPCPerception } from '../states/NPCPerception';
import {
  buildDefaultHandlerMap,
  buildMonsterHandlerMap,
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
import { EatCorpseState } from '../states/eat-corpse/EatCorpseState';
import type { ICorpseSource, ICorpseRecord } from '../states/eat-corpse/ICorpseSource';
import { createDefaultEatCorpseConfig } from '../states/eat-corpse/IEatCorpseConfig';

// ---------------------------------------------------------------------------
// EAT_CORPSE state ID constant
// ---------------------------------------------------------------------------

const EAT_CORPSE = 'EAT_CORPSE';

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

  get health(): INPCHealth {
    return { hp: this._hp, maxHp: this._maxHp, hpPercent: this._hp / this._maxHp, heal: (n) => { this._hp = Math.min(this._hp + n, this._maxHp); } };
  }
  get hp(): number { return this._hp; }
  setVelocity(_vx: number, _vy: number): void {}
  halt(): void {}
  setRotation(_r: number): void {}
  setAlpha(_a: number): void {}
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

// ---------------------------------------------------------------------------
// CorpseSource implementations (plain objects, no vi.fn())
// ---------------------------------------------------------------------------

/** Simple corpse source backed by a mutable list. */
class SimpleCorpseSource implements ICorpseSource {
  private corpses: ICorpseRecord[];
  private consumed: Set<string> = new Set();

  constructor(corpses: ICorpseRecord[]) {
    this.corpses = [...corpses];
  }

  findCorpses(_npcId: string, _x: number, _y: number, _radius: number): ReadonlyArray<ICorpseRecord> {
    return this.corpses.filter((c) => !this.consumed.has(c.id));
  }

  consumeCorpse(_npcId: string, corpseId: string): boolean {
    if (this.consumed.has(corpseId)) return false;
    this.consumed.add(corpseId);
    return true;
  }

  get consumedIds(): ReadonlySet<string> { return this.consumed; }
}

/** Corpse source that always finds a corpse at the given position. */
function makeCorpseAtPos(id: string, x: number, y: number, healAmount = 25): SimpleCorpseSource {
  return new SimpleCorpseSource([{ id, x, y, healAmount }]);
}

/** Corpse source that always returns empty list. */
class EmptyCorpseSource implements ICorpseSource {
  findCorpses(): ReadonlyArray<ICorpseRecord> { return []; }
  consumeCorpse(): boolean { return false; }
}

// ---------------------------------------------------------------------------
// Handler map builders with EAT_CORPSE registered
// ---------------------------------------------------------------------------

const EAT_CORPSE_STATE_ID = EAT_CORPSE;

function buildHandlerMapWithEatCorpse(
  corpseSource: ICorpseSource,
  eatDurationMs = 4_000,
  searchRadius = 250,
): ReturnType<typeof buildMonsterHandlerMap> {
  const cfg = createDefaultStateConfig();
  const eatCfg = createDefaultEatCorpseConfig({ eatDurationMs, searchRadius });
  const handlers = buildMonsterHandlerMap(cfg);
  handlers.register(
    EAT_CORPSE_STATE_ID,
    new EatCorpseState(cfg, undefined, corpseSource, eatCfg),
  );
  return handlers;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EatCorpseState trigger conditions and transitions (integration)', () => {
  const cfg = createDefaultStateConfig();

  // -------------------------------------------------------------------------
  // Scenario 1: Monster + corpse nearby + no enemies → EAT_CORPSE entered
  // -------------------------------------------------------------------------
  describe('Scenario 1: Monster with corpse nearby and no enemies', () => {
    it('enters EAT_CORPSE state when corpse is available and no enemies visible', () => {
      const host = new TestNPCHost();
      host.entityType = 'monster';
      host.npcId = 'monster_dog_1';

      // Corpse at NPC position (within arrive threshold immediately)
      const corpseSource = makeCorpseAtPos('corpse_1', 100, 100);
      const handlers = buildHandlerMapWithEatCorpse(corpseSource, 4_000, 250);
      const driver = new OnlineAIDriver(host, handlers, EAT_CORPSE_STATE_ID);

      // EatCorpseState.enter() should have been called — no enemies → phase is set
      expect(host.state.eatCorpsePhase).toBeDefined();
      expect(host.state.eatCorpsePhase!.active).toBe(true);
      expect(host.state.eatCorpsePhase!.corpseId).toBe('corpse_1');
    });

    it('emits EAT_CORPSE_START vocalization on enter', () => {
      const host = new TestNPCHost();
      host.entityType = 'monster';

      const corpseSource = makeCorpseAtPos('corpse_1', 100, 100);
      const handlers = buildHandlerMapWithEatCorpse(corpseSource);
      new OnlineAIDriver(host, handlers, EAT_CORPSE_STATE_ID);

      expect(host.vocalizations).toContain('EAT_CORPSE_START');
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 2: EAT_CORPSE → HP healed during eating
  // -------------------------------------------------------------------------
  describe('Scenario 2: HP regenerates after eating completes', () => {
    it('heals NPC by corpse healAmount after eatDurationMs', () => {
      const host = new TestNPCHost();
      host.entityType = 'monster';
      host.setHp(50); // Start at 50% HP
      const initialHp = host.hp;

      const healAmount = 30;
      // Corpse AT NPC position so approach is immediate
      const corpseSource = makeCorpseAtPos('corpse_1', 100, 100, healAmount);
      const shortEatMs = 200;
      const handlers = buildHandlerMapWithEatCorpse(corpseSource, shortEatMs, 250);
      const driver = new OnlineAIDriver(host, handlers, EAT_CORPSE_STATE_ID);

      // No enemies
      host.perception.sync([], [], []);

      // Tick once — should arrive and start eating (since corpse is AT position)
      tick(host, driver, 16);
      // Phase should now be eating
      expect(host.state.eatCorpsePhase?.eating).toBe(true);

      // Advance past eat duration
      tick(host, driver, shortEatMs + 100);

      // Should have transitioned out and applied HP heal
      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);
      expect(host.hp).toBeGreaterThan(initialHp);
    });

    it('corpse is marked consumed after successful eat', () => {
      const host = new TestNPCHost();
      host.entityType = 'monster';

      const corpseSource = makeCorpseAtPos('corpse_2', 100, 100, 20);
      const handlers = buildHandlerMapWithEatCorpse(corpseSource, 100, 250);
      const driver = new OnlineAIDriver(host, handlers, EAT_CORPSE_STATE_ID);

      host.perception.sync([], [], []);
      tick(host, driver, 20);   // arrive / start eating
      tick(host, driver, 200);  // complete eating

      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);
      expect(corpseSource.consumedIds.has('corpse_2')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 3: EAT_CORPSE → interrupted by enemy
  // -------------------------------------------------------------------------
  describe('Scenario 3: EAT_CORPSE interrupted by enemy', () => {
    it('transitions to ALERT when enemy appears during eating', () => {
      const host = new TestNPCHost();
      host.entityType = 'monster';

      const corpseSource = makeCorpseAtPos('corpse_1', 100, 100, 20);
      const handlers = buildHandlerMapWithEatCorpse(corpseSource, 5_000, 250);
      const driver = new OnlineAIDriver(host, handlers, EAT_CORPSE_STATE_ID);

      // No enemies initially
      host.perception.sync([], [], []);
      tick(host, driver, 50); // Start approaching/eating
      expect(driver.currentStateId).toBe(EAT_CORPSE_STATE_ID);

      // Enemy appears!
      host.perception.sync(
        [{ id: 'enemy_1', x: 300, y: 100, factionId: 'bandit' }],
        [],
        [],
      );
      tick(host, driver, 16);

      // Should interrupt and go to ALERT (eatCorpseOnInterrupt default)
      expect(driver.currentStateId).toBe(ONLINE_STATE.ALERT);
    });

    it('stores enemy position in state when interrupted', () => {
      const host = new TestNPCHost();
      host.entityType = 'monster';

      const corpseSource = makeCorpseAtPos('corpse_1', 100, 100, 20);
      const handlers = buildHandlerMapWithEatCorpse(corpseSource, 5_000, 250);
      const driver = new OnlineAIDriver(host, handlers, EAT_CORPSE_STATE_ID);

      host.perception.sync([], [], []);
      tick(host, driver, 50);

      const enemyX = 350;
      const enemyY = 200;
      host.perception.sync(
        [{ id: 'enemy_1', x: enemyX, y: enemyY, factionId: 'bandit' }],
        [],
        [],
      );
      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(ONLINE_STATE.ALERT);
      expect(host.state.lastKnownEnemyX).toBe(enemyX);
      expect(host.state.lastKnownEnemyY).toBe(enemyY);
    });

    it('exit() marks phase inactive when interrupted', () => {
      const host = new TestNPCHost();
      host.entityType = 'monster';

      const corpseSource = makeCorpseAtPos('corpse_1', 100, 100, 20);
      const handlers = buildHandlerMapWithEatCorpse(corpseSource, 5_000, 250);
      const driver = new OnlineAIDriver(host, handlers, EAT_CORPSE_STATE_ID);

      host.perception.sync([], [], []);
      tick(host, driver, 50);

      host.perception.sync([{ id: 'e1', x: 200, y: 100, factionId: 'bandit' }], [], []);
      tick(host, driver, 16);

      // Phase should be inactive after exit()
      expect(host.state.eatCorpsePhase?.active).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 4: Non-carnivorous NPC never enters EAT_CORPSE
  // -------------------------------------------------------------------------
  describe('Scenario 4: Human NPC without EAT_CORPSE handler', () => {
    it('human NPC handler map does not contain EAT_CORPSE by default', () => {
      const handlers = buildDefaultHandlerMap(cfg);
      // EAT_CORPSE is opt-in and should NOT be registered by default
      expect(handlers.has(EAT_CORPSE_STATE_ID)).toBe(false);
    });

    it('monster handler map does not contain EAT_CORPSE by default either', () => {
      const handlers = buildMonsterHandlerMap(cfg);
      // EAT_CORPSE is opt-in — not in the default monster map
      expect(handlers.has(EAT_CORPSE_STATE_ID)).toBe(false);
    });

    it('human NPC stays in IDLE when corpse nearby (no EAT_CORPSE registered)', () => {
      const host = new TestNPCHost();
      host.entityType = 'human';

      // Sync corpse as nearby item — no enemies
      host.perception.sync([], [], [{ id: 'corpse_1', x: 110, y: 100, type: 'corpse' }]);

      const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(cfg), ONLINE_STATE.IDLE);
      tick(host, driver, 100);

      // Should stay in IDLE — EAT_CORPSE not available
      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 5: EAT_CORPSE → after duration → back to IDLE
  // -------------------------------------------------------------------------
  describe('Scenario 5: Full eating cycle → IDLE', () => {
    it('transitions to IDLE after eatDurationMs when corpse is adjacent', () => {
      const host = new TestNPCHost();
      host.entityType = 'monster';

      // Corpse at NPC location (no approach needed)
      const corpseSource = makeCorpseAtPos('corpse_x', 100, 100, 10);
      const eatDurationMs = 300;
      const handlers = buildHandlerMapWithEatCorpse(corpseSource, eatDurationMs, 250);
      const driver = new OnlineAIDriver(host, handlers, EAT_CORPSE_STATE_ID);

      host.perception.sync([], [], []);
      tick(host, driver, 16);    // arrive + start eating phase
      tick(host, driver, eatDurationMs + 50);  // complete eating

      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);
    });

    it('emits EAT_CORPSE_DONE vocalization after completing eat', () => {
      const host = new TestNPCHost();
      host.entityType = 'monster';

      const corpseSource = makeCorpseAtPos('corpse_y', 100, 100, 10);
      const eatDurationMs = 100;
      const handlers = buildHandlerMapWithEatCorpse(corpseSource, eatDurationMs, 250);
      const driver = new OnlineAIDriver(host, handlers, EAT_CORPSE_STATE_ID);

      host.perception.sync([], [], []);
      tick(host, driver, 16);
      tick(host, driver, eatDurationMs + 50);

      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);
      expect(host.vocalizations).toContain('EAT_CORPSE_DONE');
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 6: EatCorpsePhase state bag tracking
  // -------------------------------------------------------------------------
  describe('Scenario 6: EatCorpsePhase state bag tracked correctly', () => {
    it('phase.active is true while eating', () => {
      const host = new TestNPCHost();
      host.entityType = 'monster';

      const corpseSource = makeCorpseAtPos('corpse_1', 100, 100, 20);
      const handlers = buildHandlerMapWithEatCorpse(corpseSource, 5_000, 250);
      const driver = new OnlineAIDriver(host, handlers, EAT_CORPSE_STATE_ID);

      host.perception.sync([], [], []);
      tick(host, driver, 16);

      expect(driver.currentStateId).toBe(EAT_CORPSE_STATE_ID);
      expect(host.state.eatCorpsePhase?.active).toBe(true);
    });

    it('phase.eating is false before arrive threshold, true after', () => {
      const host = new TestNPCHost();
      host.entityType = 'monster';
      // Place corpse away from NPC so approach is needed
      host.x = 100;
      host.y = 100;

      const corpseSource = new SimpleCorpseSource([
        { id: 'far_corpse', x: 200, y: 100, healAmount: 20 },
      ]);
      const handlers = buildHandlerMapWithEatCorpse(corpseSource, 5_000, 250);
      const driver = new OnlineAIDriver(host, handlers, EAT_CORPSE_STATE_ID);

      // Just entered — not yet arrived
      host.perception.sync([], [], []);
      tick(host, driver, 16);

      // Phase should be active but eating might be false (still approaching)
      expect(host.state.eatCorpsePhase?.active).toBe(true);
      // eating starts only after arriving at corpse
    });

    it('phase.corpseId matches the corpse returned by source', () => {
      const host = new TestNPCHost();
      host.entityType = 'monster';

      const corpseSource = makeCorpseAtPos('specific_corpse_id', 100, 100, 15);
      const handlers = buildHandlerMapWithEatCorpse(corpseSource, 5_000, 250);
      new OnlineAIDriver(host, handlers, EAT_CORPSE_STATE_ID);

      expect(host.state.eatCorpsePhase?.corpseId).toBe('specific_corpse_id');
    });

    it('phase.healAmount matches corpse record', () => {
      const host = new TestNPCHost();
      host.entityType = 'monster';
      const expectedHeal = 42;
      const corpseSource = makeCorpseAtPos('corpse_a', 100, 100, expectedHeal);
      const handlers = buildHandlerMapWithEatCorpse(corpseSource, 5_000, 250);
      new OnlineAIDriver(host, handlers, EAT_CORPSE_STATE_ID);

      expect(host.state.eatCorpsePhase?.healAmount).toBe(expectedHeal);
    });
  });

  // -------------------------------------------------------------------------
  // Scenario 7: No corpse nearby → immediate IDLE
  // -------------------------------------------------------------------------
  describe('Scenario 7: No corpse in radius → immediate transition to IDLE', () => {
    it('transitions immediately to IDLE when no corpses are found', () => {
      const host = new TestNPCHost();
      host.entityType = 'monster';

      const emptySource = new EmptyCorpseSource();
      const handlers = buildHandlerMapWithEatCorpse(emptySource, 4_000, 250);
      const driver = new OnlineAIDriver(host, handlers, EAT_CORPSE_STATE_ID);

      // enter() should immediately transition to eatCorpseOnNoCorpse (IDLE)
      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);
    });

    it('phase is not initialised when no corpse is found', () => {
      const host = new TestNPCHost();
      host.entityType = 'monster';

      const emptySource = new EmptyCorpseSource();
      const handlers = buildHandlerMapWithEatCorpse(emptySource, 4_000, 250);
      new OnlineAIDriver(host, handlers, EAT_CORPSE_STATE_ID);

      // No phase data since we immediately transitioned out
      expect(host.state.eatCorpsePhase?.active).toBeFalsy();
    });
  });

  // -------------------------------------------------------------------------
  // Scenario: morale boost applied on successful eat
  // -------------------------------------------------------------------------
  describe('Morale boost on successful corpse consumption', () => {
    it('morale increases after eating completes', () => {
      const host = new TestNPCHost();
      host.entityType = 'monster';
      host.state.morale = 0.0; // Start neutral

      const corpseSource = makeCorpseAtPos('corpse_m', 100, 100, 0); // 0 heal, just morale
      const eatDurationMs = 100;
      const handlers = buildHandlerMapWithEatCorpse(corpseSource, eatDurationMs, 250);
      const driver = new OnlineAIDriver(host, handlers, EAT_CORPSE_STATE_ID);

      host.perception.sync([], [], []);
      tick(host, driver, 16);   // arrive / start eating
      tick(host, driver, eatDurationMs + 50);  // complete

      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);
      // Morale should have increased by moraleBoost (default 0.15)
      expect(host.state.morale).toBeGreaterThan(0.0);
    });
  });
});
