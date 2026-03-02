/**
 * Integration test: RestrictedZoneManager — two-zone scenarios, IRestrictedZoneAccess adapter,
 * and interaction with OnlineAIDriver (IdleState danger escape).
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  RestrictedZoneManager,
  RestrictionType,
} from '../navigation/RestrictedZoneManager';
import type { IRestrictedZone } from '../navigation/RestrictedZoneManager';
import type { IRestrictedZoneAccess, IShootPayload, IMeleeHitPayload } from '../states/INPCContext';
import { OnlineAIDriver } from '../states/OnlineAIDriver';
import type { IOnlineDriverHost } from '../states/OnlineAIDriver';
import { buildDefaultHandlerMap, ONLINE_STATE } from '../states/OnlineStateRegistryBuilder';
import { createDefaultNPCOnlineState } from '../states/NPCOnlineState';
import { NPCPerception } from '../states/NPCPerception';
import { createDefaultStateConfig } from '../states/IStateConfig';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOutZone(id: string, x: number, y: number, radius: number, metadata?: string): IRestrictedZone {
  return { id, type: RestrictionType.OUT, x, y, radius, active: true, metadata };
}

function makeDangerZone(id: string, x: number, y: number, radius: number): IRestrictedZone {
  return { id, type: RestrictionType.DANGER, x, y, radius, active: true };
}

function makeInZone(id: string, x: number, y: number, radius: number): IRestrictedZone {
  return { id, type: RestrictionType.IN, x, y, radius, active: true };
}

function createZoneAccess(mgr: RestrictedZoneManager): IRestrictedZoneAccess {
  return {
    isAccessible(x, y) { return mgr.accessible(x, y); },
    filterAccessible(points) {
      return points.filter(p => mgr.accessible(p.x, p.y));
    },
  };
}

// ---------------------------------------------------------------------------
// TestNPCHost
// ---------------------------------------------------------------------------

const CHECK_INTERVAL_MS = 100;

class TestNPCHost implements IOnlineDriverHost {
  readonly state = createDefaultNPCOnlineState();
  readonly perception = new NPCPerception();

  npcId = 'npc_1';
  factionId = 'loner';
  entityType = 'human';

  private _x: number;
  private _y: number;
  private _nowMs = 0;

  health = null;
  cover = null;
  danger = null;
  squad = null;
  restrictedZones: IRestrictedZoneAccess | null = null;

  readonly velocities: Array<{ vx: number; vy: number }> = [];

  constructor(startX = 0, startY = 0) {
    this._x = startX;
    this._y = startY;
  }

  get x() { return this._x; }
  get y() { return this._y; }

  setVelocity(vx: number, vy: number): void {
    this._x += vx * 0.016;
    this._y += vy * 0.016;
    this.velocities.push({ vx, vy });
  }
  halt(): void {}
  setRotation(_r: number): void {}
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

function buildDriver(host: TestNPCHost, initialState = ONLINE_STATE.IDLE): OnlineAIDriver {
  const cfg = createDefaultStateConfig({ restrictedZoneCheckIntervalMs: CHECK_INTERVAL_MS });
  // Route idleOnEnemy → ALERT (default) so we can observe zone violation
  const handlers = buildDefaultHandlerMap(cfg);
  return new OnlineAIDriver(host, handlers, initialState);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RestrictedZoneManager — integration (two zones, IRestrictedZoneAccess, FSM)', () => {

  // -------------------------------------------------------------------------
  // addZone / accessible — basic two-zone setup
  // -------------------------------------------------------------------------

  describe('addZone and accessible with two zones', () => {
    let mgr: RestrictedZoneManager;

    beforeEach(() => {
      mgr = new RestrictedZoneManager(10);
      mgr.addZone(makeOutZone('zone_a', 100, 100, 50));
      mgr.addZone(makeOutZone('zone_b', 400, 400, 80));
    });

    it('size is 2 after adding two zones', () => {
      expect(mgr.size).toBe(2);
    });

    it('blocks access at zone_a center', () => {
      expect(mgr.accessible(100, 100)).toBe(false);
    });

    it('blocks access at zone_b center', () => {
      expect(mgr.accessible(400, 400)).toBe(false);
    });

    it('allows access at point outside both zones', () => {
      expect(mgr.accessible(250, 250)).toBe(true);
    });

    it('blocks within safety margin of zone_a (60px from center, margin=10, radius=50 → effectiveR=60)', () => {
      // At distance 60 from (100,100): point (160,100) — exactly at boundary
      expect(mgr.accessible(159, 100)).toBe(false);
    });

    it('allows access just outside effective radius of zone_a', () => {
      // effectiveR = 50 + 10 = 60 → point at 61px from center is safe
      expect(mgr.accessible(162, 100)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // getSafeDirection — NPC inside forbidden zone → escape direction
  // -------------------------------------------------------------------------

  describe('getSafeDirection — escape vector', () => {
    it('NPC inside OUT zone → direction points away from zone center', () => {
      const mgr = new RestrictedZoneManager(10);
      mgr.addZone(makeOutZone('rad', 0, 0, 100));

      // NPC at (40, 0) — inside zone
      const dir = mgr.getSafeDirection(40, 0);
      expect(dir).not.toBeNull();
      expect(dir!.x).toBeGreaterThan(0);
      expect(Math.abs(dir!.y)).toBeLessThan(0.01);
    });

    it('NPC inside DANGER zone → direction points away from zone center', () => {
      const mgr = new RestrictedZoneManager(10);
      mgr.addZone(makeDangerZone('chem', 0, 0, 100));

      const dir = mgr.getSafeDirection(0, 50);
      expect(dir).not.toBeNull();
      expect(dir!.y).toBeGreaterThan(0);
      expect(Math.abs(dir!.x)).toBeLessThan(0.01);
    });

    it('NPC at zone center → returns fallback {x:1, y:0}', () => {
      const mgr = new RestrictedZoneManager(10);
      mgr.addZone(makeOutZone('fire', 0, 0, 50));

      const dir = mgr.getSafeDirection(0, 0);
      expect(dir).toEqual({ x: 1, y: 0 });
    });

    it('NPC safe → getSafeDirection returns null', () => {
      const mgr = new RestrictedZoneManager(10);
      mgr.addZone(makeOutZone('zone', 0, 0, 50));

      expect(mgr.getSafeDirection(500, 500)).toBeNull();
    });

    it('two overlapping OUT zones → picks nearest zone center for escape', () => {
      const mgr = new RestrictedZoneManager(5);
      mgr.addZone(makeOutZone('z1', 0, 0, 200));
      mgr.addZone(makeOutZone('z2', 60, 0, 200));

      // NPC at (50, 0): z1 center is 50px away, z2 center is 10px away → escape from z2
      const dir = mgr.getSafeDirection(50, 0);
      expect(dir).not.toBeNull();
      // Pointing left (away from z2 which is at x=60)
      expect(dir!.x).toBeLessThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // filterAccessibleWaypoints — filters restricted positions
  // -------------------------------------------------------------------------

  describe('filterAccessibleWaypoints — two OUT zones', () => {
    it('removes waypoints inside either zone', () => {
      const mgr = new RestrictedZoneManager(5);
      mgr.addZone(makeOutZone('zone_a', 100, 100, 50));
      mgr.addZone(makeOutZone('zone_b', 400, 400, 80));

      const waypoints = [
        { x: 100, y: 100 }, // inside zone_a — blocked
        { x: 400, y: 400 }, // inside zone_b — blocked
        { x: 0, y: 0 },     // safe
        { x: 800, y: 800 }, // safe
      ];

      const result = mgr.filterAccessibleWaypoints(waypoints);
      expect(result).toHaveLength(2);
      expect(result.every(p => p.x !== 100 && p.x !== 400)).toBe(true);
    });

    it('returns all waypoints when empty zone list', () => {
      const mgr = new RestrictedZoneManager(10);
      const waypoints = [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 200 }];
      expect(mgr.filterAccessibleWaypoints(waypoints)).toHaveLength(3);
    });

    it('returns empty array when all waypoints are blocked', () => {
      const mgr = new RestrictedZoneManager(5);
      mgr.addZone(makeOutZone('big', 0, 0, 2000));

      const waypoints = [{ x: 10, y: 10 }, { x: 50, y: 50 }, { x: 100, y: 100 }];
      expect(mgr.filterAccessibleWaypoints(waypoints)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // isDangerous — only DANGER zones
  // -------------------------------------------------------------------------

  describe('isDangerous — soft avoidance check', () => {
    it('returns true inside DANGER zone', () => {
      const mgr = new RestrictedZoneManager(10);
      mgr.addZone(makeDangerZone('psi', 200, 200, 60));

      expect(mgr.isDangerous(200, 200)).toBe(true);
    });

    it('returns false outside DANGER zone', () => {
      const mgr = new RestrictedZoneManager(10);
      mgr.addZone(makeDangerZone('psi', 200, 200, 60));

      expect(mgr.isDangerous(400, 400)).toBe(false);
    });

    it('DANGER zone does NOT block accessible()', () => {
      const mgr = new RestrictedZoneManager(10);
      mgr.addZone(makeDangerZone('soft', 100, 100, 50));

      // accessible() ignores DANGER — NPC can still enter
      expect(mgr.accessible(100, 100)).toBe(true);
      expect(mgr.isDangerous(100, 100)).toBe(true);
    });

    it('OUT zone is NOT reported as dangerous via isDangerous()', () => {
      const mgr = new RestrictedZoneManager(10);
      mgr.addZone(makeOutZone('hard', 0, 0, 50));

      // isDangerous only looks at DANGER type
      expect(mgr.isDangerous(0, 0)).toBe(false);
      // But it does block accessible()
      expect(mgr.accessible(0, 0)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Zone intersections — NPC inside two zones simultaneously
  // -------------------------------------------------------------------------

  describe('NPC inside two zones simultaneously', () => {
    it('getZonesAt returns both overlapping zones', () => {
      const mgr = new RestrictedZoneManager(10);
      mgr.addZone(makeOutZone('zone_a', 0, 0, 100));
      mgr.addZone(makeDangerZone('zone_b', 50, 0, 100));

      // Point (40, 0) is inside both zones
      const zones = mgr.getZonesAt(40, 0);
      expect(zones).toHaveLength(2);
      const ids = zones.map(z => z.id);
      expect(ids).toContain('zone_a');
      expect(ids).toContain('zone_b');
    });

    it('blocked by first OUT zone even with second DANGER zone at same position', () => {
      const mgr = new RestrictedZoneManager(10);
      mgr.addZone(makeOutZone('out', 0, 0, 100));
      mgr.addZone(makeDangerZone('danger', 0, 0, 100));

      expect(mgr.accessible(0, 0)).toBe(false);
      expect(mgr.isDangerous(0, 0)).toBe(true);
    });

    it('IN zone + OUT zone: point outside IN zone radius fails IN check → inaccessible', () => {
      const mgr = new RestrictedZoneManager(5);
      // IN zone centered at (0,0) r=50 — NPC must stay inside
      mgr.addZone(makeInZone('must_stay_in', 0, 0, 50));
      // OUT zone centered at (200,0) r=20 — NPC must stay outside
      mgr.addZone(makeOutZone('out_pocket', 200, 0, 20));

      // Point (100,0) is OUTSIDE IN zone (dist=100 > radius=50) → fails IN check → blocked
      expect(mgr.accessible(100, 0)).toBe(false);
      // Point (200,0) is inside OUT zone → blocked by OUT check
      expect(mgr.accessible(200, 0)).toBe(false);
      // Point (20,0) is inside IN zone (dist=20 < 50) and far from OUT zone → accessible
      expect(mgr.accessible(20, 0)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // removeZone — zone removed, position becomes accessible
  // -------------------------------------------------------------------------

  describe('removeZone — zone lifecycle', () => {
    it('after removeZone, position inside old zone becomes accessible', () => {
      const mgr = new RestrictedZoneManager(10);
      mgr.addZone(makeOutZone('removable', 100, 100, 50));

      expect(mgr.accessible(100, 100)).toBe(false);

      mgr.removeZone('removable');

      expect(mgr.accessible(100, 100)).toBe(true);
      expect(mgr.size).toBe(0);
    });

    it('removeZone of non-existent id is a no-op', () => {
      const mgr = new RestrictedZoneManager(10);
      mgr.addZone(makeOutZone('keeper', 100, 100, 50));

      mgr.removeZone('nonexistent');

      expect(mgr.size).toBe(1);
      expect(mgr.accessible(100, 100)).toBe(false);
    });

    it('setActive(false) makes zone inert without removing it', () => {
      const mgr = new RestrictedZoneManager(10);
      mgr.addZone(makeOutZone('toggleable', 100, 100, 50));

      expect(mgr.accessible(100, 100)).toBe(false);

      mgr.setActive('toggleable', false);

      // Zone still registered but inactive
      expect(mgr.size).toBe(1);
      expect(mgr.accessible(100, 100)).toBe(true);
    });

    it('setActive(true) re-arms a deactivated zone', () => {
      const mgr = new RestrictedZoneManager(10);
      mgr.addZone(makeOutZone('rearm', 0, 0, 50));
      mgr.setActive('rearm', false);
      expect(mgr.accessible(0, 0)).toBe(true);

      mgr.setActive('rearm', true);
      expect(mgr.accessible(0, 0)).toBe(false);
    });

    it('removeByMetadata removes all zones with that tag, leaves others', () => {
      const mgr = new RestrictedZoneManager(10);
      mgr.addZone(makeOutZone('surge_1', 100, 100, 50, 'surge'));
      mgr.addZone(makeOutZone('surge_2', 200, 200, 50, 'surge'));
      mgr.addZone(makeOutZone('quest_1', 300, 300, 50, 'quest'));

      mgr.removeByMetadata('surge');

      expect(mgr.size).toBe(1);
      const remaining = mgr.getAllZones();
      expect(remaining[0].id).toBe('quest_1');
    });
  });

  // -------------------------------------------------------------------------
  // IRestrictedZoneAccess adapter + OnlineAIDriver integration
  // -------------------------------------------------------------------------

  describe('IRestrictedZoneAccess adapter wired into OnlineAIDriver (IdleState escape)', () => {
    it('NPC in IDLE inside OUT zone → transitions to ALERT after check interval', () => {
      const mgr = new RestrictedZoneManager(10);
      mgr.addZone(makeOutZone('rad', 0, 0, 100));

      const host = new TestNPCHost(0, 0);
      host.restrictedZones = createZoneAccess(mgr);

      const driver = buildDriver(host);
      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);

      // Advance past check interval so throttle fires
      host.advanceMs(CHECK_INTERVAL_MS + 1);
      driver.update(50);

      // IdleState transitions via idleOnEnemy (default ALERT)
      expect(driver.currentStateId).toBe(ONLINE_STATE.ALERT);
    });

    it('NPC in IDLE outside all zones → stays IDLE', () => {
      const mgr = new RestrictedZoneManager(10);
      mgr.addZone(makeOutZone('zone_a', 0, 0, 50));
      mgr.addZone(makeOutZone('zone_b', 500, 500, 50));

      const host = new TestNPCHost(300, 300);
      host.restrictedZones = createZoneAccess(mgr);

      const driver = buildDriver(host);
      host.advanceMs(CHECK_INTERVAL_MS + 1);
      driver.update(50);

      expect(driver.currentStateId).toBe(ONLINE_STATE.IDLE);
    });

    it('filterAccessible via IRestrictedZoneAccess removes zone-blocked points', () => {
      const mgr = new RestrictedZoneManager(10);
      mgr.addZone(makeOutZone('block_a', 0, 0, 50));
      mgr.addZone(makeOutZone('block_b', 200, 200, 50));

      const access = createZoneAccess(mgr);
      const candidates = [
        { x: 0, y: 0 },     // blocked
        { x: 200, y: 200 }, // blocked
        { x: 100, y: 0 },   // safe
      ];

      const result = access.filterAccessible(candidates);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({ x: 100, y: 0 });
    });
  });
});
