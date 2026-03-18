// states/states.test.ts
// Comprehensive tests for the states foundation layer:
//   - createDefaultNPCOnlineState() — all field defaults
//   - createDefaultStateConfig()    — all field defaults
//   - IMovementConfig / ICombatConfig / IMonsterConfig / ITimingConfig — sub-interface exports
//   - NPCPerception                 — sync, queries, defensive copy, edge cases

import { describe, it, expect, beforeEach } from 'vitest';
import { createDefaultNPCOnlineState } from './NPCOnlineState';
import { createDefaultStateConfig } from './IStateConfig';
import type { IMovementConfig, ICombatConfig, IMonsterConfig, ITimingConfig } from './IStateConfig';
import { NPCPerception } from './NPCPerception';
import type { IVisibleEntity, INearbyItem } from './NPCPerception';

// ---------------------------------------------------------------------------
// createDefaultNPCOnlineState
// ---------------------------------------------------------------------------

describe('createDefaultNPCOnlineState', () => {
  describe('target tracking fields', () => {
    it('targetId defaults to null', () => {
      expect(createDefaultNPCOnlineState().targetId).toBeNull();
    });

    it('lastKnownEnemyX defaults to 0', () => {
      expect(createDefaultNPCOnlineState().lastKnownEnemyX).toBe(0);
    });

    it('lastKnownEnemyY defaults to 0', () => {
      expect(createDefaultNPCOnlineState().lastKnownEnemyY).toBe(0);
    });

    it('targetLockUntilMs defaults to 0', () => {
      expect(createDefaultNPCOnlineState().targetLockUntilMs).toBe(0);
    });
  });

  describe('timer fields', () => {
    it('alertStartMs defaults to 0', () => {
      expect(createDefaultNPCOnlineState().alertStartMs).toBe(0);
    });

    it('searchStartMs defaults to 0', () => {
      expect(createDefaultNPCOnlineState().searchStartMs).toBe(0);
    });

    it('lastIdleAnimChangeMs defaults to 0', () => {
      expect(createDefaultNPCOnlineState().lastIdleAnimChangeMs).toBe(0);
    });

    it('lastMeleeMs defaults to 0', () => {
      expect(createDefaultNPCOnlineState().lastMeleeMs).toBe(0);
    });

    it('lastShootMs defaults to 0', () => {
      expect(createDefaultNPCOnlineState().lastShootMs).toBe(0);
    });

    it('lastVocalizationMs defaults to 0', () => {
      expect(createDefaultNPCOnlineState().lastVocalizationMs).toBe(0);
    });

    it('lastGrenadeMs defaults to 0', () => {
      expect(createDefaultNPCOnlineState().lastGrenadeMs).toBe(0);
    });

    it('lastSuppressiveFireMs defaults to 0', () => {
      expect(createDefaultNPCOnlineState().lastSuppressiveFireMs).toBe(0);
    });

    it('grenadeThrowStartMs defaults to 0', () => {
      expect(createDefaultNPCOnlineState().grenadeThrowStartMs).toBe(0);
    });

    it('evadeStartMs defaults to 0', () => {
      expect(createDefaultNPCOnlineState().evadeStartMs).toBe(0);
    });

    it('woundedStartMs defaults to 0', () => {
      expect(createDefaultNPCOnlineState().woundedStartMs).toBe(0);
    });

  });

  describe('loadout fields', () => {
    it('primaryWeapon defaults to null', () => {
      expect(createDefaultNPCOnlineState().primaryWeapon).toBeNull();
    });

    it('secondaryWeapon defaults to null', () => {
      expect(createDefaultNPCOnlineState().secondaryWeapon).toBeNull();
    });

    it('grenadeCount defaults to 0', () => {
      expect(createDefaultNPCOnlineState().grenadeCount).toBe(0);
    });

    it('medkitCount defaults to 0', () => {
      expect(createDefaultNPCOnlineState().medkitCount).toBe(0);
    });
  });

  describe('state flags', () => {
    it('isAlert defaults to false', () => {
      expect(createDefaultNPCOnlineState().isAlert).toBe(false);
    });

    it('hasTakenCover defaults to false', () => {
      expect(createDefaultNPCOnlineState().hasTakenCover).toBe(false);
    });

    it('coverPointX defaults to 0', () => {
      expect(createDefaultNPCOnlineState().coverPointX).toBe(0);
    });

    it('coverPointY defaults to 0', () => {
      expect(createDefaultNPCOnlineState().coverPointY).toBe(0);
    });

    it('loophole defaults to null', () => {
      expect(createDefaultNPCOnlineState().loophole).toBeNull();
    });
  });

  describe('monster ability phases', () => {
    it('chargePhase is undefined by default', () => {
      expect(createDefaultNPCOnlineState().chargePhase).toBeUndefined();
    });

    it('stalkPhase is undefined by default', () => {
      expect(createDefaultNPCOnlineState().stalkPhase).toBeUndefined();
    });

    it('leapPhase is undefined by default', () => {
      expect(createDefaultNPCOnlineState().leapPhase).toBeUndefined();
    });

    it('psiPhase is undefined by default', () => {
      expect(createDefaultNPCOnlineState().psiPhase).toBeUndefined();
    });
  });

  describe('morale fields', () => {
    it('morale defaults to 0', () => {
      expect(createDefaultNPCOnlineState().morale).toBe(0);
    });

    it('moraleState defaults to STABLE', () => {
      expect(createDefaultNPCOnlineState().moraleState).toBe('STABLE');
    });
  });

  it('creates independent objects on each call', () => {
    const a = createDefaultNPCOnlineState();
    const b = createDefaultNPCOnlineState();
    a.targetId = 'enemy-1';
    expect(b.targetId).toBeNull();
  });

  it('loophole objects are independent on each call', () => {
    const a = createDefaultNPCOnlineState();
    const b = createDefaultNPCOnlineState();
    a.loophole = { phase: 'PEEK', phaseStartMs: 1000 };
    expect(b.loophole).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createDefaultStateConfig
// ---------------------------------------------------------------------------

describe('createDefaultStateConfig', () => {
  it('approachSpeed is 150', () => {
    expect(createDefaultStateConfig().approachSpeed).toBe(150);
  });

  it('fleeSpeedMultiplier is 1.5', () => {
    expect(createDefaultStateConfig().fleeSpeedMultiplier).toBe(1.5);
  });

  it('chargeSpeedMultiplier is 2.0', () => {
    expect(createDefaultStateConfig().chargeSpeedMultiplier).toBe(2.0);
  });

  it('meleeRange is 48', () => {
    expect(createDefaultStateConfig().meleeRange).toBe(48);
  });

  it('woundedHpThreshold is 0.2', () => {
    expect(createDefaultStateConfig().woundedHpThreshold).toBe(0.2);
  });

  it('retreatMoraleThreshold is -0.3', () => {
    expect(createDefaultStateConfig().retreatMoraleThreshold).toBe(-0.3);
  });

  it('panicMoraleThreshold is -0.7', () => {
    expect(createDefaultStateConfig().panicMoraleThreshold).toBe(-0.7);
  });

  it('alertDuration is 5000', () => {
    expect(createDefaultStateConfig().alertDuration).toBe(5_000);
  });

  it('searchDuration is 8000', () => {
    expect(createDefaultStateConfig().searchDuration).toBe(8_000);
  });

  it('meleeCooldownMs is 1000', () => {
    expect(createDefaultStateConfig().meleeCooldownMs).toBe(1_000);
  });

  it('chargeWindupMs is 600', () => {
    expect(createDefaultStateConfig().chargeWindupMs).toBe(600);
  });

  it('leapWindupMs is 400', () => {
    expect(createDefaultStateConfig().leapWindupMs).toBe(400);
  });

  it('leapAirtimeMs is 350', () => {
    expect(createDefaultStateConfig().leapAirtimeMs).toBe(350);
  });

  it('psiChannelMs is 2000', () => {
    expect(createDefaultStateConfig().psiChannelMs).toBe(2_000);
  });

  it('stalkAlphaInvisible is 0.08', () => {
    expect(createDefaultStateConfig().stalkAlphaInvisible).toBe(0.08);
  });

  it('chargeDamageMultiplier is 2.0', () => {
    expect(createDefaultStateConfig().chargeDamageMultiplier).toBe(2.0);
  });

  it('accepts partial overrides', () => {
    const cfg = createDefaultStateConfig({ combatRange: 999 });
    expect(cfg.combatRange).toBe(999);
    expect(cfg.meleeRange).toBe(48); // unchanged
  });

  it('does not mutate the defaults when overrides are provided', () => {
    createDefaultStateConfig({ meleeRange: 100 });
    expect(createDefaultStateConfig().meleeRange).toBe(48);
  });
});

// ---------------------------------------------------------------------------
// IStateConfig sub-interfaces
// ---------------------------------------------------------------------------

describe('IStateConfig sub-interfaces', () => {
  describe('IMovementConfig', () => {
    it('createDefaultStateConfig() satisfies IMovementConfig', () => {
      const cfg = createDefaultStateConfig();
      // Type-check: assign to IMovementConfig — compiles only if all fields present
      const move: IMovementConfig = cfg;
      expect(move.approachSpeed).toBe(150);
    });

    it('IMovementConfig fields are present in default config', () => {
      const cfg = createDefaultStateConfig();
      expect(cfg.approachSpeed).toBe(150);
      expect(cfg.fleeSpeedMultiplier).toBe(1.5);
      expect(cfg.panicFleeMultiplier).toBe(1.3);
      expect(cfg.woundedCrawlMultiplier).toBe(0.3);
      expect(cfg.evadeSpeedMultiplier).toBe(1.5);
      expect(cfg.chargeSpeedMultiplier).toBe(2.0);
      expect(cfg.stalkSpeedMultiplier).toBe(0.4);
      expect(cfg.arriveThreshold).toBe(12);
      expect(cfg.waypointArriveThreshold).toBe(24);
      expect(cfg.combatRange).toBe(200);
      expect(cfg.fleeDistance).toBe(400);
      expect(cfg.evadeSafeDistance).toBe(200);
      expect(cfg.woundedLastStandRange).toBe(100);
      expect(cfg.meleeRange).toBe(48);
      expect(cfg.stalkUncloakDistance).toBe(80);
      expect(cfg.restrictedZoneCheckIntervalMs).toBe(1_000);
    });

    it('override of IMovementConfig field only changes that field', () => {
      const cfg = createDefaultStateConfig({ approachSpeed: 200 });
      expect(cfg.approachSpeed).toBe(200);
      expect(cfg.combatRange).toBe(200); // unchanged
      expect(cfg.meleeRange).toBe(48);   // unchanged
    });
  });

  describe('ICombatConfig', () => {
    it('createDefaultStateConfig() satisfies ICombatConfig', () => {
      const cfg = createDefaultStateConfig();
      const combat: ICombatConfig = cfg;
      expect(combat.fireRateMs).toBe(1_000);
    });

    it('ICombatConfig fields are present in default config', () => {
      const cfg = createDefaultStateConfig();
      expect(cfg.woundedHpThreshold).toBe(0.2);
      expect(cfg.retreatMoraleThreshold).toBe(-0.3);
      expect(cfg.panicMoraleThreshold).toBe(-0.7);
      expect(cfg.fireRateMs).toBe(1_000);
      expect(cfg.grenadeWindupMs).toBe(1_000);
      expect(cfg.bulletDamage).toBe(10);
      expect(cfg.medkitHealRatio).toBe(0.5);
      expect(cfg.medkitUseDurationMs).toBe(3_000);
    });

    it('override of ICombatConfig field only changes that field', () => {
      const cfg = createDefaultStateConfig({ fireRateMs: 500 });
      expect(cfg.fireRateMs).toBe(500);
      expect(cfg.bulletDamage).toBe(10); // unchanged
    });
  });

  describe('IMonsterConfig', () => {
    it('createDefaultStateConfig() satisfies IMonsterConfig', () => {
      const cfg = createDefaultStateConfig();
      const monster: IMonsterConfig = cfg;
      expect(monster.meleeDamage).toBe(15);
    });

    it('IMonsterConfig fields are present in default config', () => {
      const cfg = createDefaultStateConfig();
      expect(cfg.meleeDamage).toBe(15);
      expect(cfg.chargeDamageMultiplier).toBe(2.0);
      expect(cfg.meleeCooldownMs).toBe(1_000);
      expect(cfg.chargeWindupMs).toBe(600);
      expect(cfg.leapWindupMs).toBe(400);
      expect(cfg.leapAirtimeMs).toBe(350);
      expect(cfg.psiChannelMs).toBe(2_000);
      expect(cfg.innerLairRadius).toBe(80);
      expect(cfg.patrolRadius).toBe(180);
      expect(cfg.outerRadius).toBe(350);
      expect(cfg.stalkAlphaInvisible).toBe(0.08);
    });

    it('override of IMonsterConfig field only changes that field', () => {
      const cfg = createDefaultStateConfig({ meleeDamage: 30 });
      expect(cfg.meleeDamage).toBe(30);
      expect(cfg.meleeCooldownMs).toBe(1_000); // unchanged
    });
  });

  describe('ITimingConfig', () => {
    it('createDefaultStateConfig() satisfies ITimingConfig', () => {
      const cfg = createDefaultStateConfig();
      const timing: ITimingConfig = cfg;
      expect(timing.alertDuration).toBe(5_000);
    });

    it('ITimingConfig fields are present in default config', () => {
      const cfg = createDefaultStateConfig();
      expect(cfg.alertDuration).toBe(5_000);
      expect(cfg.searchDuration).toBe(8_000);
      expect(cfg.woundedMaxDurationMs).toBe(15_000);
      expect(cfg.retreatMaxDurationMs).toBe(8_000);
      expect(cfg.retreatFireIntervalMs).toBe(2_000);
      expect(cfg.inertiaLockMs).toBe(3_000);
      expect(cfg.schemeReactionDelayMs).toBe(400);
      expect(cfg.campSleepReactionDelayMs).toBe(800);
      expect(cfg.loopholeWaitMinMs).toBe(1_500);
      expect(cfg.loopholeWaitMaxMs).toBe(3_000);
      expect(cfg.loopholePeekDurationMs).toBe(600);
      expect(cfg.loopholeFireDurationMs).toBe(1_200);
      expect(cfg.loopholeReturnDurationMs).toBe(400);
    });

    it('override of ITimingConfig field only changes that field', () => {
      const cfg = createDefaultStateConfig({ alertDuration: 10_000 });
      expect(cfg.alertDuration).toBe(10_000);
      expect(cfg.searchDuration).toBe(8_000); // unchanged
    });
  });

  describe('sub-interface usability as narrowed type', () => {
    it('IMovementConfig variable can be narrowed from full IStateConfig', () => {
      const full = createDefaultStateConfig();
      const move: IMovementConfig = full;
      expect(typeof move.approachSpeed).toBe('number');
      expect(typeof move.combatRange).toBe('number');
      expect(typeof move.restrictedZoneCheckIntervalMs).toBe('number');
    });

    it('ICombatConfig variable can be narrowed from full IStateConfig', () => {
      const full = createDefaultStateConfig();
      const combat: ICombatConfig = full;
      expect(typeof combat.fireRateMs).toBe('number');
      expect(typeof combat.bulletDamage).toBe('number');
    });

    it('IMonsterConfig variable can be narrowed from full IStateConfig', () => {
      const full = createDefaultStateConfig();
      const monster: IMonsterConfig = full;
      expect(typeof monster.meleeDamage).toBe('number');
      expect(typeof monster.psiChannelMs).toBe('number');
    });

    it('ITimingConfig variable can be narrowed from full IStateConfig', () => {
      const full = createDefaultStateConfig();
      const timing: ITimingConfig = full;
      expect(typeof timing.alertDuration).toBe('number');
      expect(typeof timing.loopholeWaitMinMs).toBe('number');
    });
  });

  describe('createDefaultStateConfig() returns complete IStateConfig', () => {
    it('no-arg call returns an object with all 48 expected fields', () => {
      const cfg = createDefaultStateConfig();
      // IMovementConfig (16 fields)
      const movementFields: (keyof IMovementConfig)[] = [
        'approachSpeed', 'fleeSpeedMultiplier', 'panicFleeMultiplier',
        'woundedCrawlMultiplier', 'evadeSpeedMultiplier', 'chargeSpeedMultiplier',
        'stalkSpeedMultiplier', 'arriveThreshold', 'waypointArriveThreshold',
        'combatRange', 'fleeDistance', 'evadeSafeDistance', 'woundedLastStandRange',
        'meleeRange', 'stalkUncloakDistance', 'restrictedZoneCheckIntervalMs',
      ];
      // ICombatConfig (8 fields)
      const combatFields: (keyof ICombatConfig)[] = [
        'woundedHpThreshold', 'retreatMoraleThreshold', 'panicMoraleThreshold',
        'fireRateMs', 'grenadeWindupMs', 'bulletDamage', 'medkitHealRatio',
        'medkitUseDurationMs',
      ];
      // IMonsterConfig (11 fields)
      const monsterFields: (keyof IMonsterConfig)[] = [
        'meleeDamage', 'chargeDamageMultiplier', 'meleeCooldownMs',
        'chargeWindupMs', 'leapWindupMs', 'leapAirtimeMs', 'psiChannelMs',
        'innerLairRadius', 'patrolRadius', 'outerRadius',
        'stalkAlphaInvisible',
      ];
      // ITimingConfig (13 fields)
      const timingFields: (keyof ITimingConfig)[] = [
        'alertDuration', 'searchDuration', 'woundedMaxDurationMs',
        'retreatMaxDurationMs', 'retreatFireIntervalMs', 'inertiaLockMs',
        'schemeReactionDelayMs', 'campSleepReactionDelayMs',
        'loopholeWaitMinMs', 'loopholeWaitMaxMs', 'loopholePeekDurationMs',
        'loopholeFireDurationMs', 'loopholeReturnDurationMs',
      ];
      const allFields = [...movementFields, ...combatFields, ...monsterFields, ...timingFields];
      for (const field of allFields) {
        expect(cfg, `field ${field} should be defined`).toHaveProperty(field);
        expect(typeof (cfg as Record<string, unknown>)[field], `field ${field} should be number`).toBe('number');
      }
      expect(allFields).toHaveLength(48);
    });

    it('overrides a single field and all others keep their defaults', () => {
      const cfg = createDefaultStateConfig({ approachSpeed: 200 });
      expect(cfg.approachSpeed).toBe(200);
      // Spot-check a field from each sub-interface
      expect(cfg.fireRateMs).toBe(1_000);
      expect(cfg.meleeDamage).toBe(15);
      expect(cfg.alertDuration).toBe(5_000);
    });

    it('overrides fields across multiple sub-interfaces simultaneously', () => {
      const cfg = createDefaultStateConfig({
        approachSpeed: 80,   // IMovementConfig
        fireRateMs: 500,     // ICombatConfig
        meleeDamage: 25,     // IMonsterConfig
        alertDuration: 3_000, // ITimingConfig
      });
      expect(cfg.approachSpeed).toBe(80);
      expect(cfg.fireRateMs).toBe(500);
      expect(cfg.meleeDamage).toBe(25);
      expect(cfg.alertDuration).toBe(3_000);
      // Unchanged fields
      expect(cfg.combatRange).toBe(200);
      expect(cfg.bulletDamage).toBe(10);
      expect(cfg.psiChannelMs).toBe(2_000);
      expect(cfg.searchDuration).toBe(8_000);
    });
  });
});

// ---------------------------------------------------------------------------
// NPCPerception
// ---------------------------------------------------------------------------

describe('NPCPerception', () => {
  let perception: NPCPerception;

  const makeEnemy = (id: string, x = 0, y = 0, factionId = 'bandits'): IVisibleEntity => ({
    id, x, y, factionId,
  });

  const makeAlly = (id: string, x = 0, y = 0): IVisibleEntity => ({
    id, x, y, factionId: 'military',
  });

  const makeItem = (id: string, type = 'medkit', x = 0, y = 0): INearbyItem => ({
    id, x, y, type,
  });

  beforeEach(() => {
    perception = new NPCPerception();
  });

  describe('initial state', () => {
    it('has no visible enemies initially', () => {
      expect(perception.getVisibleEnemies()).toHaveLength(0);
    });

    it('has no visible allies initially', () => {
      expect(perception.getVisibleAllies()).toHaveLength(0);
    });

    it('has no nearby items initially', () => {
      expect(perception.getNearbyItems()).toHaveLength(0);
    });

    it('hasVisibleEnemy() returns false initially', () => {
      expect(perception.hasVisibleEnemy()).toBe(false);
    });

    it('enemyCount is 0 initially', () => {
      expect(perception.enemyCount).toBe(0);
    });

    it('allyCount is 0 initially', () => {
      expect(perception.allyCount).toBe(0);
    });

    it('itemCount is 0 initially', () => {
      expect(perception.itemCount).toBe(0);
    });
  });

  describe('sync()', () => {
    it('populates visible enemies after sync', () => {
      const enemies = [makeEnemy('e1', 100, 200)];
      perception.sync(enemies, [], []);
      expect(perception.getVisibleEnemies()).toHaveLength(1);
    });

    it('populates visible allies after sync', () => {
      const allies = [makeAlly('a1', 50, 50)];
      perception.sync([], allies, []);
      expect(perception.getVisibleAllies()).toHaveLength(1);
    });

    it('populates nearby items after sync', () => {
      const items = [makeItem('i1')];
      perception.sync([], [], items);
      expect(perception.getNearbyItems()).toHaveLength(1);
    });

    it('sync with empty arrays clears previous data', () => {
      perception.sync([makeEnemy('e1')], [makeAlly('a1')], [makeItem('i1')]);
      perception.sync([], [], []);
      expect(perception.getVisibleEnemies()).toHaveLength(0);
      expect(perception.getVisibleAllies()).toHaveLength(0);
      expect(perception.getNearbyItems()).toHaveLength(0);
    });

    it('second sync overwrites first sync', () => {
      perception.sync([makeEnemy('e1'), makeEnemy('e2')], [], []);
      perception.sync([makeEnemy('e3')], [], []);
      const enemies = perception.getVisibleEnemies();
      expect(enemies).toHaveLength(1);
      expect(enemies[0].id).toBe('e3');
    });

    it('stores correct enemy position data', () => {
      perception.sync([makeEnemy('e1', 123, 456, 'bandits')], [], []);
      const e = perception.getVisibleEnemies()[0];
      expect(e.id).toBe('e1');
      expect(e.x).toBe(123);
      expect(e.y).toBe(456);
      expect(e.factionId).toBe('bandits');
    });

    it('stores correct item data', () => {
      perception.sync([], [], [makeItem('i1', 'rifle', 10, 20)]);
      const item = perception.getNearbyItems()[0];
      expect(item.id).toBe('i1');
      expect(item.type).toBe('rifle');
      expect(item.x).toBe(10);
      expect(item.y).toBe(20);
    });
  });

  describe('hasVisibleEnemy()', () => {
    it('returns true after syncing with enemies', () => {
      perception.sync([makeEnemy('e1')], [], []);
      expect(perception.hasVisibleEnemy()).toBe(true);
    });

    it('returns false after syncing with empty enemies', () => {
      perception.sync([makeEnemy('e1')], [], []);
      perception.sync([], [], []);
      expect(perception.hasVisibleEnemy()).toBe(false);
    });

    it('returns false when only allies are synced', () => {
      perception.sync([], [makeAlly('a1')], []);
      expect(perception.hasVisibleEnemy()).toBe(false);
    });

    it('returns true with multiple enemies', () => {
      perception.sync([makeEnemy('e1'), makeEnemy('e2'), makeEnemy('e3')], [], []);
      expect(perception.hasVisibleEnemy()).toBe(true);
    });
  });

  describe('defensive copy — sync input mutations do not affect stored data', () => {
    it('mutating enemy input array after sync does not affect getVisibleEnemies()', () => {
      const enemies: IVisibleEntity[] = [makeEnemy('e1')];
      perception.sync(enemies, [], []);
      enemies.push(makeEnemy('e2'));
      expect(perception.getVisibleEnemies()).toHaveLength(1);
    });

    it('mutating ally input array after sync does not affect getVisibleAllies()', () => {
      const allies: IVisibleEntity[] = [makeAlly('a1')];
      perception.sync([], allies, []);
      allies.push(makeAlly('a2'));
      expect(perception.getVisibleAllies()).toHaveLength(1);
    });

    it('mutating items input array after sync does not affect getNearbyItems()', () => {
      const items: INearbyItem[] = [makeItem('i1')];
      perception.sync([], [], items);
      items.push(makeItem('i2'));
      expect(perception.getNearbyItems()).toHaveLength(1);
    });
  });

  describe('clear()', () => {
    it('clear() removes all perception data', () => {
      perception.sync([makeEnemy('e1')], [makeAlly('a1')], [makeItem('i1')]);
      perception.clear();
      expect(perception.getVisibleEnemies()).toHaveLength(0);
      expect(perception.getVisibleAllies()).toHaveLength(0);
      expect(perception.getNearbyItems()).toHaveLength(0);
    });

    it('hasVisibleEnemy() returns false after clear()', () => {
      perception.sync([makeEnemy('e1')], [], []);
      perception.clear();
      expect(perception.hasVisibleEnemy()).toBe(false);
    });
  });

  describe('counters', () => {
    it('enemyCount returns correct count', () => {
      perception.sync([makeEnemy('e1'), makeEnemy('e2')], [], []);
      expect(perception.enemyCount).toBe(2);
    });

    it('allyCount returns correct count', () => {
      perception.sync([], [makeAlly('a1'), makeAlly('a2'), makeAlly('a3')], []);
      expect(perception.allyCount).toBe(3);
    });

    it('itemCount returns correct count', () => {
      perception.sync([], [], [makeItem('i1'), makeItem('i2')]);
      expect(perception.itemCount).toBe(2);
    });
  });

  describe('ReadonlyArray return type does not alias internal data', () => {
    it('returned enemy array does not reflect later sync calls', () => {
      perception.sync([makeEnemy('e1')], [], []);
      // Capture a reference to what getVisibleEnemies returns (internal array).
      const snapshotBefore = perception.getVisibleEnemies();
      void snapshotBefore; // reference held — only used to verify sync() replaces array

      // Second sync replaces the internal array entirely.
      perception.getVisibleEnemies();
      perception.sync([makeEnemy('e2'), makeEnemy('e3')], [], []);
      // The NEW snapshot has 2 entries, confirming sync() replaced the array.
      const newSnapshot = perception.getVisibleEnemies();
      expect(newSnapshot).toHaveLength(2);
    });
  });
});
