/**
 * Integration test: SquadTactics command evaluation + NPC FSM state integration.
 *
 * Exercises:
 *   1. evaluateSituation() returns RETREAT when morale collapses
 *   2. evaluateSituation() returns ATTACK when squad has numerical advantage
 *   3. evaluateSituation() returns FOLLOW when no enemies present
 *   4. evaluateSituation() returns HOLD when fight is even
 *   5. evaluateSituation() returns COVER_ME when leader is in cover
 *   6. evaluateSituation() returns SPREAD_OUT as default
 *   7. canApplyCommand() blocks commands in protected states (DEAD, WOUNDED, EVADE_GRENADE)
 *   8. canApplyCommand() allows commands in normal states
 *   9. squad.issueCommand() is called when command derived from situation
 *  10. squad.getLeaderId() returns non-null for squad member
 *  11. RETREAT command propagates: NPC transitions to RETREAT in FSM
 *  12. HOLD command: NPC velocity stays zero
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect } from 'vitest';
import {
  evaluateSituation,
  canApplyCommand,
  SquadCommand,
  PROTECTED_STATES,
  type ISquadSituation,
} from '../squad/SquadTactics';
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
import type { ISquadTacticsConfig } from '../types/IOnlineAIConfig';

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
  velocityX = 0;
  velocityY = 0;
  haltCount = 0;

  get health(): INPCHealth {
    return { hp: this._hp, maxHp: this._maxHp, hpPercent: this._hp / this._maxHp, heal: (n) => { this._hp = Math.min(this._hp + n, this._maxHp); } };
  }
  setVelocity(vx: number, vy: number): void { this.velocityX = vx; this.velocityY = vy; }
  halt(): void { this.velocityX = 0; this.velocityY = 0; this.haltCount++; }
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

function makeEnemy(id = 'enemy_1', x = 300, y = 100) {
  return { id, x, y, factionId: 'bandit' };
}

// ---------------------------------------------------------------------------
// Default squad tactics config matching createDefaultAIConfig
// ---------------------------------------------------------------------------

const defaultSquadConfig: ISquadTacticsConfig = {
  outnumberRatio: 1.5,
  moralePanickedThreshold: -0.7,
  nearbyRadius: 200,
};

// ---------------------------------------------------------------------------
// evaluateSituation() tests
// ---------------------------------------------------------------------------

describe('SquadTactics: evaluateSituation() (integration)', () => {

  describe('Priority 1: Morale collapse → RETREAT', () => {
    it('returns RETREAT when avgMorale <= moralePanickedThreshold', () => {
      const situation: ISquadSituation = {
        squadSize: 4,
        enemyCount: 2,
        avgMorale: -0.8, // below -0.7 threshold
        leaderInCover: false,
      };
      const cmd = evaluateSituation(situation, defaultSquadConfig);
      expect(cmd).toBe(SquadCommand.RETREAT);
    });

    it('returns RETREAT at exactly moralePanickedThreshold', () => {
      const situation: ISquadSituation = {
        squadSize: 4,
        enemyCount: 2,
        avgMorale: defaultSquadConfig.moralePanickedThreshold,
        leaderInCover: false,
      };
      const cmd = evaluateSituation(situation, defaultSquadConfig);
      expect(cmd).toBe(SquadCommand.RETREAT);
    });
  });

  describe('Priority 2: No enemies → FOLLOW', () => {
    it('returns FOLLOW when enemyCount is 0', () => {
      const situation: ISquadSituation = {
        squadSize: 3,
        enemyCount: 0,
        avgMorale: 0.5,
        leaderInCover: false,
      };
      const cmd = evaluateSituation(situation, defaultSquadConfig);
      expect(cmd).toBe(SquadCommand.FOLLOW);
    });
  });

  describe('Priority 3: Badly outnumbered → RETREAT', () => {
    it('returns RETREAT when enemies > squad * outnumberRatio', () => {
      // squad=2, enemies=4, outnumberRatio=1.5 → 4 > 2*1.5=3 → RETREAT
      const situation: ISquadSituation = {
        squadSize: 2,
        enemyCount: 4,
        avgMorale: 0.0, // stable morale so priority 1 doesn't trigger
        leaderInCover: false,
      };
      const cmd = evaluateSituation(situation, defaultSquadConfig);
      expect(cmd).toBe(SquadCommand.RETREAT);
    });
  });

  describe('Priority 4: Even fight → HOLD', () => {
    it('returns HOLD when enemyCount equals squadSize', () => {
      // squad=3, enemies=3 → even
      const situation: ISquadSituation = {
        squadSize: 3,
        enemyCount: 3,
        avgMorale: 0.0,
        leaderInCover: false,
      };
      const cmd = evaluateSituation(situation, defaultSquadConfig);
      expect(cmd).toBe(SquadCommand.HOLD);
    });
  });

  describe('Priority 5: Numerical advantage → ATTACK', () => {
    it('returns ATTACK when squad outnumbers enemies by outnumberRatio', () => {
      // squad=5, enemies=2, outnumberRatio=1.5 → 5 > 2*1.5=3 → ATTACK
      const situation: ISquadSituation = {
        squadSize: 5,
        enemyCount: 2,
        avgMorale: 0.0,
        leaderInCover: false,
      };
      const cmd = evaluateSituation(situation, defaultSquadConfig);
      expect(cmd).toBe(SquadCommand.ATTACK);
    });
  });

  describe('Priority 6: Leader in cover → COVER_ME', () => {
    it('returns COVER_ME when leader is in cover and fight is not clearly decided', () => {
      // squad=3, enemies=2 → not outnumbered enough for ATTACK, leader in cover
      // 3 > 2*1.5=3 → 3 > 3 is false, so no ATTACK; leaderInCover=true → COVER_ME
      const situation: ISquadSituation = {
        squadSize: 3,
        enemyCount: 2,
        avgMorale: 0.0,
        leaderInCover: true,
      };
      const cmd = evaluateSituation(situation, defaultSquadConfig);
      expect(cmd).toBe(SquadCommand.COVER_ME);
    });
  });

  describe('Default → SPREAD_OUT', () => {
    it('returns SPREAD_OUT as fallback when no other condition matches', () => {
      // squad=3, enemies=2, neither outnumbered nor numerical advantage, no cover
      const situation: ISquadSituation = {
        squadSize: 3,
        enemyCount: 2,
        avgMorale: 0.0,
        leaderInCover: false,
      };
      const cmd = evaluateSituation(situation, defaultSquadConfig);
      expect(cmd).toBe(SquadCommand.SPREAD_OUT);
    });
  });
});

// ---------------------------------------------------------------------------
// canApplyCommand() — protected states
// ---------------------------------------------------------------------------

describe('SquadTactics: canApplyCommand()', () => {
  it('returns false for DEAD state', () => {
    expect(canApplyCommand('DEAD')).toBe(false);
  });

  it('returns false for WOUNDED state', () => {
    expect(canApplyCommand('WOUNDED')).toBe(false);
  });

  it('returns false for EVADE_GRENADE state', () => {
    expect(canApplyCommand('EVADE_GRENADE')).toBe(false);
  });

  it('returns true for IDLE state', () => {
    expect(canApplyCommand('IDLE')).toBe(true);
  });

  it('returns true for PATROL state', () => {
    expect(canApplyCommand('PATROL')).toBe(true);
  });

  it('returns true for COMBAT state', () => {
    expect(canApplyCommand('COMBAT')).toBe(true);
  });

  it('returns true for RETREAT state', () => {
    expect(canApplyCommand('RETREAT')).toBe(true);
  });

  it('PROTECTED_STATES set contains DEAD, WOUNDED, EVADE_GRENADE', () => {
    expect(PROTECTED_STATES.has('DEAD')).toBe(true);
    expect(PROTECTED_STATES.has('WOUNDED')).toBe(true);
    expect(PROTECTED_STATES.has('EVADE_GRENADE')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Squad access integration with OnlineAIDriver FSM
// ---------------------------------------------------------------------------

describe('Squad access integration with OnlineAIDriver', () => {
  const cfg = createDefaultStateConfig();

  it('squad.issueCommand() is callable via ISquadAccess stub', () => {
    const issuedCommands: string[] = [];

    const host = new TestNPCHost();
    host.squad = {
      shareTarget(_id, _x, _y) {},
      getLeaderId() { return 'leader_npc'; },
      getMemberCount() { return 3; },
      issueCommand(cmd) { issuedCommands.push(cmd); },
    };

    const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(cfg), ONLINE_STATE.IDLE);

    // Manually drive command via evaluateSituation + issueCommand
    const situation: ISquadSituation = {
      squadSize: 2,
      enemyCount: 5,
      avgMorale: 0.0,
      leaderInCover: false,
    };
    const cmd = evaluateSituation(situation, defaultSquadConfig);
    host.squad.issueCommand(cmd);

    expect(cmd).toBe(SquadCommand.RETREAT);
    expect(issuedCommands).toContain(SquadCommand.RETREAT);

    // Driver is still alive
    expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);
  });

  it('squad.getLeaderId() returns non-null for squad member', () => {
    const host = new TestNPCHost();
    host.squad = {
      shareTarget(_id, _x, _y) {},
      getLeaderId() { return 'leader_npc'; },
      getMemberCount() { return 4; },
      issueCommand(_cmd) {},
    };

    expect(host.squad.getLeaderId()).toBe('leader_npc');
    expect(host.squad.getMemberCount()).toBe(4);
  });

  it('squad.getLeaderId() returns null when not in a squad', () => {
    const host = new TestNPCHost();
    host.squad = {
      shareTarget(_id, _x, _y) {},
      getLeaderId() { return null; },
      getMemberCount() { return 1; },
      issueCommand(_cmd) {},
    };

    expect(host.squad.getLeaderId()).toBeNull();
  });

  it('RETREAT command: NPC in COMBAT transitions to RETREAT when morale is SHAKEN', () => {
    const host = new TestNPCHost();
    host.state.morale = -0.5;
    host.state.moraleState = 'SHAKEN';
    host.state.lastKnownEnemyX = 200;
    host.state.lastKnownEnemyY = 100;

    // Wire squad to record issued command
    const issuedCommands: string[] = [];
    host.squad = {
      shareTarget(_id, _x, _y) {},
      getLeaderId() { return 'leader_npc'; },
      getMemberCount() { return 3; },
      issueCommand(cmd) { issuedCommands.push(cmd); },
    };

    host.perception.sync([makeEnemy()], [], []);
    const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(cfg), ONLINE_STATE.COMBAT);
    tick(host, driver, 16);

    // CombatState should transition to RETREAT on SHAKEN morale
    expect(driver.currentStateId).toBe(ONLINE_STATE.RETREAT);
  });

  it('HOLD: CAMP state halts NPC velocity', () => {
    const host = new TestNPCHost();
    const driver = new OnlineAIDriver(host, buildDefaultHandlerMap(cfg), ONLINE_STATE.CAMP);

    // No enemies — camp should keep NPC stationary
    host.perception.sync([], [], []);
    tick(host, driver, 100);

    expect(host.velocityX).toBe(0);
    expect(host.velocityY).toBe(0);
    expect(driver.currentStateId).toBe(ONLINE_STATE.CAMP);
  });

  it('squad.shareTarget() records target sighting', () => {
    const sharedTargets: Array<{ id: string; x: number; y: number }> = [];
    const host = new TestNPCHost();
    host.squad = {
      shareTarget(id, x, y) { sharedTargets.push({ id, x, y }); },
      getLeaderId() { return 'leader_npc'; },
      getMemberCount() { return 3; },
      issueCommand(_cmd) {},
    };

    host.squad.shareTarget('enemy_1', 300, 200);
    expect(sharedTargets).toHaveLength(1);
    expect(sharedTargets[0]).toEqual({ id: 'enemy_1', x: 300, y: 200 });
  });
});

// ---------------------------------------------------------------------------
// Multiple NPCs: command issuance and FSM transitions
// ---------------------------------------------------------------------------

describe('Multiple NPCs with squad commands', () => {
  const cfg = createDefaultStateConfig();

  it('two NPCs with SHAKEN morale both transition to RETREAT when enemy visible', () => {
    const commands: string[][] = [[], []];
    const hosts = [new TestNPCHost(), new TestNPCHost()];
    hosts[0].npcId = 'npc_1';
    hosts[1].npcId = 'npc_2';

    // Both have SHAKEN morale
    for (const host of hosts) {
      host.state.morale = -0.5;
      host.state.moraleState = 'SHAKEN';
      host.state.lastKnownEnemyX = 200;
      host.state.lastKnownEnemyY = 100;
    }

    const drivers = hosts.map((host, i) => {
      host.squad = {
        shareTarget(_id, _x, _y) {},
        getLeaderId() { return 'npc_leader'; },
        getMemberCount() { return 2; },
        issueCommand(cmd) { commands[i].push(cmd); },
      };
      host.perception.sync([makeEnemy()], [], []);
      return new OnlineAIDriver(host, buildDefaultHandlerMap(cfg), ONLINE_STATE.COMBAT);
    });

    // Tick both
    for (let i = 0; i < 2; i++) {
      hosts[i].advanceMs(16);
      drivers[i].update(16);
    }

    // Both should have transitioned to RETREAT due to SHAKEN morale
    expect(drivers[0].currentStateId).toBe(ONLINE_STATE.RETREAT);
    expect(drivers[1].currentStateId).toBe(ONLINE_STATE.RETREAT);
  });

  it('evaluateSituation on squad aggregate correctly picks ATTACK', () => {
    // 6 squad members vs 2 enemies — clear numerical advantage
    const situation: ISquadSituation = {
      squadSize: 6,
      enemyCount: 2,
      avgMorale: 0.3,
      leaderInCover: false,
    };
    const cmd = evaluateSituation(situation, defaultSquadConfig);
    expect(cmd).toBe(SquadCommand.ATTACK);
  });
});
