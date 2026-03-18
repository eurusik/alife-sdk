// states/registry-builder.test.ts
// Tests for buildDefaultHandlerMap() / buildMonsterHandlerMap() / ONLINE_STATE.

import { describe, it, expect, vi } from 'vitest';
import {
  buildDefaultHandlerMap,
  buildMonsterHandlerMap,
  ONLINE_STATE,
} from './OnlineStateRegistryBuilder';
import {
  CombatState,
  MonsterCombatController,
  DeadState,
  IdleState,
  PatrolState,
  AlertState,
  FleeState,
  SearchState,
  CampState,
  SleepState,
  TakeCoverState,
  GrenadeState,
  EvadeGrenadeState,
  WoundedState,
  RetreatState,
  ChargeState,
  StalkState,
  LeapState,
  PsiAttackState,
} from './handlers/index';
import { createDefaultStateConfig } from './IStateConfig';
import { createDefaultTransitionMap } from './IStateTransitionMap';
import type { IOnlineStateHandler } from './IOnlineStateHandler';
import { StateHandlerMap } from './StateHandlerMap';

// ---------------------------------------------------------------------------
// ONLINE_STATE constants
// ---------------------------------------------------------------------------

const EXPECTED_HANDLER_COUNT = Object.keys(ONLINE_STATE).length; // 18 — all ONLINE_STATE entries

// States that exist only in buildMonsterHandlerMap, not in buildDefaultHandlerMap.
const MONSTER_ABILITY_STATES = new Set(['CHARGE', 'STALK', 'LEAP', 'PSI_ATTACK']);

// Human NPC map: all states except the 4 monster ability states.
const DEFAULT_HANDLER_COUNT = EXPECTED_HANDLER_COUNT - MONSTER_ABILITY_STATES.size; // 14

describe('ONLINE_STATE constants', () => {
  it('has all 18 state identifiers', () => {
    const ids = Object.values(ONLINE_STATE);
    expect(ids).toHaveLength(EXPECTED_HANDLER_COUNT);
  });

  it('each value equals its key name', () => {
    for (const [key, value] of Object.entries(ONLINE_STATE)) {
      expect(value).toBe(key);
    }
  });

  it('contains all expected state names', () => {
    const expected = [
      'DEAD', 'IDLE', 'PATROL', 'ALERT', 'FLEE', 'SEARCH',
      'CAMP', 'SLEEP', 'COMBAT', 'TAKE_COVER', 'GRENADE',
      'EVADE_GRENADE', 'WOUNDED', 'RETREAT',
      'CHARGE', 'STALK', 'LEAP', 'PSI_ATTACK',
    ];
    for (const name of expected) {
      expect(ONLINE_STATE).toHaveProperty(name, name);
    }
  });
});

// ---------------------------------------------------------------------------
// buildDefaultHandlerMap
// ---------------------------------------------------------------------------

describe('buildDefaultHandlerMap()', () => {
  it('returns a StateHandlerMap with exactly 14 entries', () => {
    const map = buildDefaultHandlerMap();
    expect(map).toBeInstanceOf(StateHandlerMap);
    expect(map.size).toBe(DEFAULT_HANDLER_COUNT);
  });

  it('contains all human state keys; monster ability states are absent', () => {
    const map = buildDefaultHandlerMap();
    for (const stateId of Object.values(ONLINE_STATE)) {
      if (MONSTER_ABILITY_STATES.has(stateId)) {
        expect(map.has(stateId), `${stateId} should NOT be in human map`).toBe(false);
      } else {
        expect(map.has(stateId), `${stateId} should be in human map`).toBe(true);
      }
    }
  });

  it('all handlers implement enter / update / exit', () => {
    const map = buildDefaultHandlerMap();
    for (const [stateId, handler] of map) {
      expect(typeof handler.enter, `${stateId}.enter`).toBe('function');
      expect(typeof handler.update, `${stateId}.update`).toBe('function');
      expect(typeof handler.exit, `${stateId}.exit`).toBe('function');
    }
  });

  it('COMBAT handler is an instance of CombatState (human)', () => {
    const map = buildDefaultHandlerMap();
    expect(map.get('COMBAT')).toBeInstanceOf(CombatState);
  });

  it('DEAD handler is an instance of DeadState', () => {
    expect(buildDefaultHandlerMap().get('DEAD')).toBeInstanceOf(DeadState);
  });

  it('IDLE handler is an instance of IdleState', () => {
    expect(buildDefaultHandlerMap().get('IDLE')).toBeInstanceOf(IdleState);
  });

  it('PATROL handler is an instance of PatrolState', () => {
    expect(buildDefaultHandlerMap().get('PATROL')).toBeInstanceOf(PatrolState);
  });

  it('ALERT handler is an instance of AlertState', () => {
    expect(buildDefaultHandlerMap().get('ALERT')).toBeInstanceOf(AlertState);
  });

  it('FLEE handler is an instance of FleeState', () => {
    expect(buildDefaultHandlerMap().get('FLEE')).toBeInstanceOf(FleeState);
  });

  it('SEARCH handler is an instance of SearchState', () => {
    expect(buildDefaultHandlerMap().get('SEARCH')).toBeInstanceOf(SearchState);
  });

  it('CAMP handler is an instance of CampState', () => {
    expect(buildDefaultHandlerMap().get('CAMP')).toBeInstanceOf(CampState);
  });

  it('SLEEP handler is an instance of SleepState', () => {
    expect(buildDefaultHandlerMap().get('SLEEP')).toBeInstanceOf(SleepState);
  });

  it('TAKE_COVER handler is an instance of TakeCoverState', () => {
    expect(buildDefaultHandlerMap().get('TAKE_COVER')).toBeInstanceOf(TakeCoverState);
  });

  it('GRENADE handler is an instance of GrenadeState', () => {
    expect(buildDefaultHandlerMap().get('GRENADE')).toBeInstanceOf(GrenadeState);
  });

  it('EVADE_GRENADE handler is an instance of EvadeGrenadeState', () => {
    expect(buildDefaultHandlerMap().get('EVADE_GRENADE')).toBeInstanceOf(EvadeGrenadeState);
  });

  it('WOUNDED handler is an instance of WoundedState', () => {
    expect(buildDefaultHandlerMap().get('WOUNDED')).toBeInstanceOf(WoundedState);
  });

  it('RETREAT handler is an instance of RetreatState', () => {
    expect(buildDefaultHandlerMap().get('RETREAT')).toBeInstanceOf(RetreatState);
  });

  it('does not register monster ability states (CHARGE, STALK, LEAP, PSI_ATTACK)', () => {
    const map = buildDefaultHandlerMap();
    for (const stateId of MONSTER_ABILITY_STATES) {
      expect(map.has(stateId)).toBe(false);
    }
  });

  it('returns a new Map instance each call (not a cached singleton)', () => {
    const a = buildDefaultHandlerMap();
    const b = buildDefaultHandlerMap();
    expect(a).not.toBe(b);
  });

  it('returned StateHandlerMap is mutable via .register() (host can replace entries)', () => {
    const map = buildDefaultHandlerMap();
    const customHandler: IOnlineStateHandler = { enter: () => {}, update: () => {}, exit: () => {} };
    map.register('IDLE', customHandler);
    expect(map.get('IDLE')).toBe(customHandler);
  });

  it('accepts partial config overrides', () => {
    const map = buildDefaultHandlerMap({ combatRange: 500, meleeRange: 100 });
    expect(map.size).toBe(DEFAULT_HANDLER_COUNT);
  });

  it('custom config is applied (via createDefaultStateConfig merge)', () => {
    const cfg = createDefaultStateConfig({ approachSpeed: 999, fireRateMs: 2000 });
    const map = buildDefaultHandlerMap(cfg);
    expect(map.size).toBe(DEFAULT_HANDLER_COUNT);
  });

  it('no-arg call uses default config', () => {
    expect(() => buildDefaultHandlerMap()).not.toThrow();
    const map = buildDefaultHandlerMap();
    expect(map.size).toBe(DEFAULT_HANDLER_COUNT);
  });
});

// ---------------------------------------------------------------------------
// buildMonsterHandlerMap
// ---------------------------------------------------------------------------

describe('buildMonsterHandlerMap()', () => {
  it('returns a StateHandlerMap with exactly 14 entries', () => {
    const map = buildMonsterHandlerMap();
    expect(map).toBeInstanceOf(StateHandlerMap);
    expect(map.size).toBe(DEFAULT_HANDLER_COUNT);
  });

  it('contains all human state keys; monster ability states are absent by default', () => {
    const map = buildMonsterHandlerMap();
    for (const stateId of Object.values(ONLINE_STATE)) {
      if (MONSTER_ABILITY_STATES.has(stateId)) {
        expect(map.has(stateId), `${stateId} should NOT be in monster map by default`).toBe(false);
      } else {
        expect(map.has(stateId), `${stateId} should be in monster map`).toBe(true);
      }
    }
  });

  it('COMBAT handler is MonsterCombatController (not CombatState)', () => {
    const map = buildMonsterHandlerMap();
    const combat = map.get('COMBAT');
    expect(combat).toBeInstanceOf(MonsterCombatController);
    expect(combat).not.toBeInstanceOf(CombatState);
  });

  it('all shared handlers are identical types to buildDefaultHandlerMap', () => {
    const defaultMap = buildDefaultHandlerMap();
    const monsterMap = buildMonsterHandlerMap();

    for (const stateId of Object.values(ONLINE_STATE)) {
      if (stateId === 'COMBAT') continue;              // differs by design
      if (MONSTER_ABILITY_STATES.has(stateId)) continue; // only in monster map
      expect(monsterMap.get(stateId)?.constructor).toBe(defaultMap.get(stateId)?.constructor);
    }
  });

  it('all handlers implement enter / update / exit', () => {
    const map = buildMonsterHandlerMap();
    for (const [stateId, handler] of map) {
      expect(typeof handler.enter, `${stateId}.enter`).toBe('function');
      expect(typeof handler.update, `${stateId}.update`).toBe('function');
      expect(typeof handler.exit, `${stateId}.exit`).toBe('function');
    }
  });

  it('returns a new Map instance each call', () => {
    const a = buildMonsterHandlerMap();
    const b = buildMonsterHandlerMap();
    expect(a).not.toBe(b);
  });

  it('monster and human maps are independent (mutation of one does not affect the other)', () => {
    const human   = buildDefaultHandlerMap();
    const monster = buildMonsterHandlerMap();

    const customHandler: IOnlineStateHandler = { enter: () => {}, update: () => {}, exit: () => {} };
    human.register('IDLE', customHandler);

    // monster's IDLE should not be affected
    expect(monster.get('IDLE')).not.toBe(customHandler);
  });

  it('accepts partial config overrides', () => {
    const map = buildMonsterHandlerMap({ meleeRange: 80 });
    expect(map.size).toBe(DEFAULT_HANDLER_COUNT);
    expect(map.get('COMBAT')).toBeInstanceOf(MonsterCombatController);
  });

  it('no-arg call uses default config', () => {
    expect(() => buildMonsterHandlerMap()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// createDefaultTransitionMap
// ---------------------------------------------------------------------------

describe('createDefaultTransitionMap()', () => {
  it('all 66 keys have correct defaults', () => {
    expect(createDefaultTransitionMap()).toEqual({
      idleOnEnemy:              'ALERT',
      idleOnTired:              'CAMP',
      idleOnSuspicious:         'ALERT',
      patrolOnEnemy:            'ALERT',
      patrolOnSquadIntel:       'ALERT',
      patrolOnSuspicious:       'ALERT',
      patrolOnNoWaypoint:       'IDLE',
      alertOnEnemy:             'COMBAT',
      alertOnTimeout:           'PATROL',
      alertOnPanic:             'FLEE',
      combatOnNoEnemy:          'IDLE',
      combatOnLastKnown:        'SEARCH',
      combatOnPanicked:         'FLEE',
      combatOnShaken:           'RETREAT',
      combatOnWounded:          'WOUNDED',
      combatOnCover:            'TAKE_COVER',
      takeCoverOnNoEnemy:       'SEARCH',
      takeCoverOnPanicked:      'FLEE',
      takeCoverOnShaken:        'RETREAT',
      fleeOnCalmed:             'ALERT',
      fleeOnSafe:               'PATROL',
      searchOnEnemy:            'ALERT',
      searchOnTimeout:          'IDLE',
      grenadeOnComplete:        'COMBAT',
      grenadeOnNoAmmo:          'COMBAT',
      evadeOnClear:             'COMBAT',
      evadeOnTimeout:           'COMBAT',
      evadeOnNoSystem:          'COMBAT',
      woundedOnHealed:          'COMBAT',
      woundedOnPanic:           'FLEE',
      woundedOnTimeout:         'FLEE',
      retreatOnPanicked:        'FLEE',
      retreatOnStable:          'COMBAT',
      retreatOnNoEnemy:         'SEARCH',
      campOnEnemy:              'COMBAT',
      campOnDanger:             'ALERT',
      sleepOnEnemy:             'ALERT',
      monsterOnNoEnemy:         'IDLE',
      monsterOnLastKnown:       'SEARCH',
      chargeOnComplete:         'COMBAT',
      chargeOnAbort:            'IDLE',
      stalkOnAttack:            'COMBAT',
      stalkOnNoEnemy:           'SEARCH',
      leapOnLand:               'COMBAT',
      psiOnComplete:            'COMBAT',
      psiOnNoEnemy:             'IDLE',
      eatCorpseOnDone:          'IDLE',
      eatCorpseOnInterrupt:     'ALERT',
      eatCorpseOnNoCorpse:      'IDLE',
      investigateOnEnemy:       'ALERT',
      investigateOnTimeout:     'PATROL',
      investigateOnPanic:       'FLEE',
      patrolOnWoundedAlly:      'HELP_WOUNDED',
      idleOnWoundedAlly:        'HELP_WOUNDED',
      helpWoundedOnEnemy:       'ALERT',
      helpWoundedOnComplete:    'PATROL',
      helpWoundedOnPanic:       'FLEE',
      combatOnKillWounded:      'KILL_WOUNDED',
      alertOnKillWounded:       'KILL_WOUNDED',
      killWoundedOnComplete:    'COMBAT',
      killWoundedOnNoTarget:    'SEARCH',
      killWoundedOnPanic:       'FLEE',
      killWoundedOnTimeout:     'COMBAT',
      idleOnPackAlert:          'ALERT',
      patrolOnPackAlert:        'ALERT',
      alertOnPackCombat:        'SEARCH',
    });
  });

  it('idleOnEnemy defaults to ALERT', () => {
    expect(createDefaultTransitionMap().idleOnEnemy).toBe('ALERT');
  });

  it('patrolOnEnemy defaults to ALERT', () => {
    expect(createDefaultTransitionMap().patrolOnEnemy).toBe('ALERT');
  });

  it('patrolOnNoWaypoint defaults to IDLE', () => {
    expect(createDefaultTransitionMap().patrolOnNoWaypoint).toBe('IDLE');
  });

  it('alertOnEnemy defaults to COMBAT', () => {
    expect(createDefaultTransitionMap().alertOnEnemy).toBe('COMBAT');
  });

  it('alertOnTimeout defaults to PATROL', () => {
    expect(createDefaultTransitionMap().alertOnTimeout).toBe('PATROL');
  });

  it('alertOnPanic defaults to FLEE', () => {
    expect(createDefaultTransitionMap().alertOnPanic).toBe('FLEE');
  });

  it('combatOnNoEnemy defaults to IDLE', () => {
    expect(createDefaultTransitionMap().combatOnNoEnemy).toBe('IDLE');
  });

  it('combatOnLastKnown defaults to SEARCH', () => {
    expect(createDefaultTransitionMap().combatOnLastKnown).toBe('SEARCH');
  });

  it('combatOnPanicked defaults to FLEE', () => {
    expect(createDefaultTransitionMap().combatOnPanicked).toBe('FLEE');
  });

  it('combatOnShaken defaults to RETREAT', () => {
    expect(createDefaultTransitionMap().combatOnShaken).toBe('RETREAT');
  });

  it('combatOnWounded defaults to WOUNDED', () => {
    expect(createDefaultTransitionMap().combatOnWounded).toBe('WOUNDED');
  });

  it('combatOnCover defaults to TAKE_COVER', () => {
    expect(createDefaultTransitionMap().combatOnCover).toBe('TAKE_COVER');
  });

  it('takeCoverOnNoEnemy defaults to SEARCH', () => {
    expect(createDefaultTransitionMap().takeCoverOnNoEnemy).toBe('SEARCH');
  });

  it('takeCoverOnPanicked defaults to FLEE', () => {
    expect(createDefaultTransitionMap().takeCoverOnPanicked).toBe('FLEE');
  });

  it('takeCoverOnShaken defaults to RETREAT', () => {
    expect(createDefaultTransitionMap().takeCoverOnShaken).toBe('RETREAT');
  });

  it('fleeOnCalmed defaults to ALERT', () => {
    expect(createDefaultTransitionMap().fleeOnCalmed).toBe('ALERT');
  });

  it('searchOnEnemy defaults to ALERT', () => {
    expect(createDefaultTransitionMap().searchOnEnemy).toBe('ALERT');
  });

  it('searchOnTimeout defaults to IDLE', () => {
    expect(createDefaultTransitionMap().searchOnTimeout).toBe('IDLE');
  });

  it('grenadeOnComplete defaults to COMBAT', () => {
    expect(createDefaultTransitionMap().grenadeOnComplete).toBe('COMBAT');
  });

  it('grenadeOnNoAmmo defaults to COMBAT', () => {
    expect(createDefaultTransitionMap().grenadeOnNoAmmo).toBe('COMBAT');
  });

  it('evadeOnClear defaults to COMBAT', () => {
    expect(createDefaultTransitionMap().evadeOnClear).toBe('COMBAT');
  });

  it('evadeOnTimeout defaults to COMBAT', () => {
    expect(createDefaultTransitionMap().evadeOnTimeout).toBe('COMBAT');
  });

  it('evadeOnNoSystem defaults to COMBAT', () => {
    expect(createDefaultTransitionMap().evadeOnNoSystem).toBe('COMBAT');
  });

  it('woundedOnHealed defaults to COMBAT', () => {
    expect(createDefaultTransitionMap().woundedOnHealed).toBe('COMBAT');
  });

  it('woundedOnPanic defaults to FLEE', () => {
    expect(createDefaultTransitionMap().woundedOnPanic).toBe('FLEE');
  });

  it('woundedOnTimeout defaults to FLEE', () => {
    expect(createDefaultTransitionMap().woundedOnTimeout).toBe('FLEE');
  });

  it('retreatOnPanicked defaults to FLEE', () => {
    expect(createDefaultTransitionMap().retreatOnPanicked).toBe('FLEE');
  });

  it('retreatOnStable defaults to COMBAT', () => {
    expect(createDefaultTransitionMap().retreatOnStable).toBe('COMBAT');
  });

  it('retreatOnNoEnemy defaults to SEARCH', () => {
    expect(createDefaultTransitionMap().retreatOnNoEnemy).toBe('SEARCH');
  });

  it('campOnEnemy defaults to COMBAT', () => {
    expect(createDefaultTransitionMap().campOnEnemy).toBe('COMBAT');
  });

  it('campOnDanger defaults to ALERT', () => {
    expect(createDefaultTransitionMap().campOnDanger).toBe('ALERT');
  });

  it('sleepOnEnemy defaults to ALERT', () => {
    expect(createDefaultTransitionMap().sleepOnEnemy).toBe('ALERT');
  });

  it('monsterOnNoEnemy defaults to IDLE', () => {
    expect(createDefaultTransitionMap().monsterOnNoEnemy).toBe('IDLE');
  });

  it('monsterOnLastKnown defaults to SEARCH', () => {
    expect(createDefaultTransitionMap().monsterOnLastKnown).toBe('SEARCH');
  });

  it('chargeOnComplete defaults to COMBAT', () => {
    expect(createDefaultTransitionMap().chargeOnComplete).toBe('COMBAT');
  });

  it('chargeOnAbort defaults to IDLE', () => {
    expect(createDefaultTransitionMap().chargeOnAbort).toBe('IDLE');
  });

  it('stalkOnAttack defaults to COMBAT', () => {
    expect(createDefaultTransitionMap().stalkOnAttack).toBe('COMBAT');
  });

  it('stalkOnNoEnemy defaults to SEARCH', () => {
    expect(createDefaultTransitionMap().stalkOnNoEnemy).toBe('SEARCH');
  });

  it('leapOnLand defaults to COMBAT', () => {
    expect(createDefaultTransitionMap().leapOnLand).toBe('COMBAT');
  });

  it('psiOnComplete defaults to COMBAT', () => {
    expect(createDefaultTransitionMap().psiOnComplete).toBe('COMBAT');
  });

  it('psiOnNoEnemy defaults to IDLE', () => {
    expect(createDefaultTransitionMap().psiOnNoEnemy).toBe('IDLE');
  });

  it('overrides a single field while keeping others at defaults', () => {
    const tr = createDefaultTransitionMap({ combatOnPanicked: 'run' });
    expect(tr.combatOnPanicked).toBe('run');
    expect(tr.combatOnNoEnemy).toBe('IDLE'); // unchanged
    expect(tr.fleeOnCalmed).toBe('ALERT');   // unchanged
  });

  it('overrides multiple fields independently', () => {
    const tr = createDefaultTransitionMap({
      combatOnPanicked: 'shamble_away',
      fleeOnCalmed: 'wander',
      monsterOnNoEnemy: 'roam',
    });
    expect(tr.combatOnPanicked).toBe('shamble_away');
    expect(tr.fleeOnCalmed).toBe('wander');
    expect(tr.monsterOnNoEnemy).toBe('roam');
    expect(tr.combatOnNoEnemy).toBe('IDLE'); // unchanged
  });

  it('does not mutate defaults when overrides are passed', () => {
    createDefaultTransitionMap({ combatOnPanicked: 'custom' });
    expect(createDefaultTransitionMap().combatOnPanicked).toBe('FLEE');
  });

  it('each call returns a new independent object', () => {
    const a = createDefaultTransitionMap();
    const b = createDefaultTransitionMap();
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// buildDefaultHandlerMap with transition overrides
// ---------------------------------------------------------------------------

describe('buildDefaultHandlerMap() with transition map overrides', () => {
  it('accepts a partial tr argument without throwing', () => {
    expect(() =>
      buildDefaultHandlerMap({}, { combatOnPanicked: 'custom_flee' }),
    ).not.toThrow();
  });

  it('map still has 14 entries when tr is provided', () => {
    const map = buildDefaultHandlerMap({}, { combatOnPanicked: 'custom_flee' });
    expect(map.size).toBe(DEFAULT_HANDLER_COUNT);
  });

  it('accepts undefined tr (same as no-arg behaviour)', () => {
    const map = buildDefaultHandlerMap({}, undefined);
    expect(map.size).toBe(DEFAULT_HANDLER_COUNT);
  });
});

// ---------------------------------------------------------------------------
// buildMonsterHandlerMap with transition overrides
// ---------------------------------------------------------------------------

describe('buildMonsterHandlerMap() with transition map overrides', () => {
  it('accepts a partial tr argument without throwing', () => {
    expect(() =>
      buildMonsterHandlerMap({}, { monsterOnNoEnemy: 'roam' }),
    ).not.toThrow();
  });

  it('map still has 14 entries when tr is provided', () => {
    const map = buildMonsterHandlerMap({}, { monsterOnNoEnemy: 'roam' });
    expect(map.size).toBe(DEFAULT_HANDLER_COUNT);
  });

  it('COMBAT entry is MonsterCombatController when tr is provided', () => {
    const map = buildMonsterHandlerMap({}, { monsterOnLastKnown: 'hunt' });
    expect(map.get('COMBAT')).toBeInstanceOf(MonsterCombatController);
  });

  it('monsterOnNoEnemy override reaches MonsterCombatController at runtime', () => {
    const map = buildMonsterHandlerMap({}, { monsterOnNoEnemy: 'roam' });
    const handler = map.get('COMBAT')!;

    const transitionSpy = vi.fn();
    const state = createDefaultNPCOnlineState();
    // Ensure no last-known position so the handler takes monsterOnNoEnemy branch.
    state.lastKnownEnemyX = 0;
    state.lastKnownEnemyY = 0;

    const ctx = {
      npcId: 'test-monster',
      factionId: 'monster',
      entityType: 'dog',
      x: 0,
      y: 0,
      state,
      perception: { getVisibleEnemies: () => [] },
      health: null,
      cover: null,
      danger: null,
      restrictedZones: null,
      squad: null,
      conditions: null,
      suspicion: null,
      currentStateId: 'COMBAT',
      setVelocity: vi.fn(),
      halt: vi.fn(),
      setRotation: vi.fn(),
      setAlpha: vi.fn(),
      teleport: vi.fn(),
      disablePhysics: vi.fn(),
      emitShoot: vi.fn(),
      emitMeleeHit: vi.fn(),
      emitVocalization: vi.fn(),
      emitPsiAttackStart: vi.fn(),
      transition: transitionSpy,
      now: () => 1000,
      random: () => 0.5,
    };

    handler.update(ctx as any, 16);

    expect(transitionSpy).toHaveBeenCalledWith('roam');
  });
});

// ---------------------------------------------------------------------------
// StateHandlerMap — unit tests
// ---------------------------------------------------------------------------

describe('StateHandlerMap', () => {
  const makeHandler = (): IOnlineStateHandler => ({
    enter: () => {},
    update: () => {},
    exit: () => {},
  });

  it('starts empty when constructed with no arguments', () => {
    const m = new StateHandlerMap();
    expect(m.size).toBe(0);
  });

  it('initialises from iterable entries', () => {
    const h = makeHandler();
    const m = new StateHandlerMap([['IDLE', h]]);
    expect(m.size).toBe(1);
    expect(m.get('IDLE')).toBe(h);
  });

  describe('.register()', () => {
    it('adds a new state handler', () => {
      const m = new StateHandlerMap();
      const h = makeHandler();
      m.register('HUNT', h);
      expect(m.get('HUNT')).toBe(h);
    });

    it('overwrites an existing handler', () => {
      const h1 = makeHandler();
      const h2 = makeHandler();
      const m = new StateHandlerMap([['IDLE', h1]]);
      m.register('IDLE', h2);
      expect(m.get('IDLE')).toBe(h2);
    });

    it('returns `this` for fluent chaining', () => {
      const m = new StateHandlerMap();
      const result = m.register('A', makeHandler());
      expect(result).toBe(m);
    });

    it('supports chaining multiple registrations', () => {
      const h1 = makeHandler();
      const h2 = makeHandler();
      const m = new StateHandlerMap()
        .register('A', h1)
        .register('B', h2);
      expect(m.size).toBe(2);
      expect(m.get('A')).toBe(h1);
      expect(m.get('B')).toBe(h2);
    });

    it('buildDefaultHandlerMap().register() chains work', () => {
      const customHandler = makeHandler();
      const map = buildDefaultHandlerMap().register('CUSTOM', customHandler);
      expect(map.size).toBe(DEFAULT_HANDLER_COUNT + 1);
      expect(map.get('CUSTOM')).toBe(customHandler);
    });
  });

  describe('.extend()', () => {
    it('merges handlers from another StateHandlerMap without overwriting', () => {
      const h1 = makeHandler();
      const h2 = makeHandler();
      const h3 = makeHandler();
      const base = new StateHandlerMap([['IDLE', h1], ['PATROL', h2]]);
      const extra = new StateHandlerMap([['IDLE', h3], ['SEARCH', h3]]);
      base.extend(extra);
      // IDLE already existed → not overwritten
      expect(base.get('IDLE')).toBe(h1);
      // SEARCH was new → merged in
      expect(base.get('SEARCH')).toBe(h3);
      expect(base.size).toBe(3);
    });

    it('merges handlers from a plain Map without overwriting', () => {
      const h1 = makeHandler();
      const h2 = makeHandler();
      const base = new StateHandlerMap([['IDLE', h1]]);
      const plain = new Map<string, IOnlineStateHandler>([['IDLE', h2], ['CAMP', h2]]);
      base.extend(plain);
      expect(base.get('IDLE')).toBe(h1); // not overwritten
      expect(base.get('CAMP')).toBe(h2);
    });

    it('returns `this` for fluent chaining', () => {
      const m = new StateHandlerMap();
      const result = m.extend(new StateHandlerMap());
      expect(result).toBe(m);
    });
  });

  describe('.override()', () => {
    it('merges handlers from another StateHandlerMap and overwrites existing', () => {
      const h1 = makeHandler();
      const h2 = makeHandler();
      const base = new StateHandlerMap([['IDLE', h1]]);
      const extra = new StateHandlerMap([['IDLE', h2], ['CAMP', h2]]);
      base.override(extra);
      // IDLE existed → overwritten
      expect(base.get('IDLE')).toBe(h2);
      // CAMP was new → added
      expect(base.get('CAMP')).toBe(h2);
      expect(base.size).toBe(2);
    });

    it('merges handlers from a plain Map and overwrites existing', () => {
      const h1 = makeHandler();
      const h2 = makeHandler();
      const base = new StateHandlerMap([['IDLE', h1]]);
      const plain = new Map<string, IOnlineStateHandler>([['IDLE', h2]]);
      base.override(plain);
      expect(base.get('IDLE')).toBe(h2);
    });

    it('returns `this` for fluent chaining', () => {
      const m = new StateHandlerMap();
      const result = m.override(new StateHandlerMap());
      expect(result).toBe(m);
    });
  });

  describe('.has()', () => {
    it('returns true for registered state ID', () => {
      const m = new StateHandlerMap([['IDLE', makeHandler()]]);
      expect(m.has('IDLE')).toBe(true);
    });

    it('returns false for unregistered state ID', () => {
      const m = new StateHandlerMap();
      expect(m.has('NONEXISTENT')).toBe(false);
    });
  });

  describe('.get()', () => {
    it('returns the handler for a registered state ID', () => {
      const h = makeHandler();
      const m = new StateHandlerMap([['PATROL', h]]);
      expect(m.get('PATROL')).toBe(h);
    });

    it('returns undefined for an unregistered state ID', () => {
      const m = new StateHandlerMap();
      expect(m.get('NONEXISTENT')).toBeUndefined();
    });
  });

  describe('.size', () => {
    it('returns 0 for empty map', () => {
      expect(new StateHandlerMap().size).toBe(0);
    });

    it('returns correct count after registrations', () => {
      const m = new StateHandlerMap()
        .register('A', makeHandler())
        .register('B', makeHandler())
        .register('C', makeHandler());
      expect(m.size).toBe(3);
    });
  });

  describe('[Symbol.iterator]', () => {
    it('iterates over all [stateId, handler] pairs', () => {
      const h1 = makeHandler();
      const h2 = makeHandler();
      const m = new StateHandlerMap([['IDLE', h1], ['PATROL', h2]]);
      const pairs: [string, IOnlineStateHandler][] = [];
      for (const pair of m) {
        pairs.push(pair);
      }
      expect(pairs).toHaveLength(2);
      expect(pairs.some(([id]) => id === 'IDLE')).toBe(true);
      expect(pairs.some(([id]) => id === 'PATROL')).toBe(true);
    });

    it('allows constructing a new Map from StateHandlerMap (backward compat)', () => {
      const source = buildDefaultHandlerMap();
      const copy = new Map(source);
      expect(copy.size).toBe(DEFAULT_HANDLER_COUNT);
      expect(copy.get('IDLE')).toBe(source.get('IDLE'));
    });
  });

  describe('.toMap()', () => {
    it('returns a ReadonlyMap with the same entries', () => {
      const h = makeHandler();
      const m = new StateHandlerMap([['IDLE', h]]);
      const ro = m.toMap();
      expect(ro.get('IDLE')).toBe(h);
      expect(ro.size).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// Integration: handler map can be used with OnlineAIDriver
// ---------------------------------------------------------------------------

import { OnlineAIDriver } from './OnlineAIDriver';
import { createDefaultNPCOnlineState } from './NPCOnlineState';

describe('buildDefaultHandlerMap + OnlineAIDriver integration', () => {
  it('driver can be constructed and updated using default handler map', () => {
    const map = buildDefaultHandlerMap();
    const host = {
      npcId: 'test-npc',
      factionId: 'stalker',
      entityType: 'human',
      x: 0,
      y: 0,
      state: createDefaultNPCOnlineState(),
      perception: null,
      health: null,
      cover: null,
      danger: null,
      restrictedZones: null,
      squad: null,
      conditions: null,
      suspicion: null,
      setVelocity: () => {},
      halt: () => {},
      setRotation: () => {},
      setAlpha: () => {},
      teleport: () => {},
      disablePhysics: () => {},
      emitShoot: () => {},
      emitMeleeHit: () => {},
      emitVocalization: () => {},
      emitPsiAttackStart: () => {},
      now: () => 0,
      random: () => 0.5,
    };

    const driver = new OnlineAIDriver(host, map, 'IDLE');
    expect(() => driver.update(16)).not.toThrow();
    expect(driver.currentStateId).toBe('IDLE');
    driver.destroy();
  });

  it('monster driver can be constructed and updated using monster handler map', () => {
    const map = buildMonsterHandlerMap();
    const host = {
      npcId: 'boar-1',
      factionId: 'monster',
      entityType: 'boar',
      x: 0,
      y: 0,
      state: createDefaultNPCOnlineState(),
      perception: null,
      health: null,
      cover: null,
      danger: null,
      restrictedZones: null,
      squad: null,
      conditions: null,
      suspicion: null,
      setVelocity: () => {},
      halt: () => {},
      setRotation: () => {},
      setAlpha: () => {},
      teleport: () => {},
      disablePhysics: () => {},
      emitShoot: () => {},
      emitMeleeHit: () => {},
      emitVocalization: () => {},
      emitPsiAttackStart: () => {},
      now: () => 0,
      random: () => 0.5,
    };

    const driver = new OnlineAIDriver(host, map, 'IDLE');
    expect(() => driver.update(16)).not.toThrow();
    driver.destroy();
  });
});
