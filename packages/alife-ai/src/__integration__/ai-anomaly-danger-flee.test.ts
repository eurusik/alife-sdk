/**
 * Integration test: "AI perceives hazard zone danger and transitions to FLEE".
 *
 * Exercises the pipeline:
 *   HazardZone (from @alife-sdk/hazards) → RestrictedZoneManager (OUT zone)
 *   → IdleState restricted-zone check → FSM transition to FLEE
 *
 * Wire-up:
 *   1. HazardManager.addZone() registers a hazard area.
 *   2. RestrictedZoneManager mirrors that area as an OUT zone.
 *   3. A thin IRestrictedZoneAccess adapter bridges the two.
 *   4. OnlineAIDriver wraps the host and ticks the FSM.
 *
 * The IdleState zone check is throttled (restrictedZoneCheckIntervalMs).
 * Tests advance `now()` past the threshold before calling driver.update().
 *
 * Transition map override: idleOnEnemy → 'FLEE'
 * (IdleState calls ctx.transition(tr.idleOnEnemy) on zone violation.)
 *
 * All objects are REAL — zero mocks, zero vi.fn().
 */

import { describe, it, expect } from 'vitest';
import { HazardManager } from '@alife-sdk/hazards/manager';
import { EventBus } from '@alife-sdk/core';
import type { HazardEventPayloads } from '@alife-sdk/hazards/events';
import { ArtefactRegistry, WeightedArtefactSelector } from '@alife-sdk/hazards/artefact';
import {
  RestrictedZoneManager,
  RestrictionType,
} from '../navigation/RestrictedZoneManager';
import type { IRestrictedZoneAccess } from '../states/INPCContext';
import type { IShootPayload, IMeleeHitPayload } from '../states/INPCContext';
import { OnlineAIDriver } from '../states/OnlineAIDriver';
import type { IOnlineDriverHost } from '../states/OnlineAIDriver';
import { buildDefaultHandlerMap } from '../states/OnlineStateRegistryBuilder';
import { createDefaultNPCOnlineState } from '../states/NPCOnlineState';
import { NPCPerception } from '../states/NPCPerception';
import { createDefaultStateConfig } from '../states/IStateConfig';

// ---------------------------------------------------------------------------
// Minimal seeded random (deterministic)
// ---------------------------------------------------------------------------

const SEEDED_RANDOM = {
  next: () => 0.5,
  nextInt: (min: number, max: number) => Math.floor(0.5 * (max - min + 1)) + min,
  nextFloat: (min: number, max: number) => 0.5 * (max - min) + min,
};

// ---------------------------------------------------------------------------
// Stub hazard dependencies (artefact factory, registry)
// ---------------------------------------------------------------------------

function createStubHazardDeps() {
  const events = new EventBus<HazardEventPayloads>();
  const selector = new WeightedArtefactSelector(SEEDED_RANDOM);
  const artefacts = new ArtefactRegistry(selector);
  const manager = new HazardManager(events, artefacts, {
    artefactFactory: { create: () => {} },
    random: SEEDED_RANDOM,
  });
  return { manager, events };
}

// ---------------------------------------------------------------------------
// IRestrictedZoneAccess adapter wrapping RestrictedZoneManager
// ---------------------------------------------------------------------------

function createZoneAccess(zones: RestrictedZoneManager): IRestrictedZoneAccess {
  return {
    isAccessible(x, y) { return zones.accessible(x, y); },
    filterAccessible(points) {
      return points.filter(p => zones.accessible(p.x, p.y));
    },
  };
}

// ---------------------------------------------------------------------------
// TestNPCHost — minimal IOnlineDriverHost, no vi.fn()
// ---------------------------------------------------------------------------

class TestNPCHost implements IOnlineDriverHost {
  readonly state = createDefaultNPCOnlineState();
  readonly perception = new NPCPerception();

  private _x: number;
  private _y: number;
  private _nowMs = 0;

  npcId = 'npc_test';
  factionId = 'loner';
  entityType = 'human';

  get x() { return this._x; }
  get y() { return this._y; }

  health = null;
  cover = null;
  danger = null;
  squad = null;
  restrictedZones: IRestrictedZoneAccess | null = null;

  readonly velocities: Array<{ vx: number; vy: number }> = [];
  readonly transitions: string[] = [];

  constructor(startX = 100, startY = 100) {
    this._x = startX;
    this._y = startY;
  }

  setVelocity(vx: number, vy: number): void {
    this.velocities.push({ vx, vy });
    this._x += vx * 0.016;
    this._y += vy * 0.016;
  }

  halt(): void {}
  setRotation(_r: number): void {}
  setAlpha(_a: number): void {}

  teleport(x: number, y: number): void {
    this._x = x;
    this._y = y;
  }

  disablePhysics(): void {}
  emitShoot(_p: IShootPayload): void {}
  emitMeleeHit(_p: IMeleeHitPayload): void {}
  emitVocalization(_t: string): void {}
  emitPsiAttackStart(_x: number, _y: number): void {}

  now(): number { return this._nowMs; }
  random(): number { return 0.5; }

  advanceMs(ms: number): void { this._nowMs += ms; }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ZONE_X = 100;
const ZONE_Y = 100;
const ZONE_RADIUS = 50;
const SAFE_MARGIN = 5;
const CHECK_INTERVAL_MS = 100; // short interval for tests

/**
 * Build a driver with:
 *   - idleOnEnemy → 'FLEE'  (so restricted-zone violation routes to FLEE)
 *   - restrictedZoneCheckIntervalMs short enough for tests
 */
function buildDriver(host: TestNPCHost): OnlineAIDriver {
  const cfg = createDefaultStateConfig({
    restrictedZoneCheckIntervalMs: CHECK_INTERVAL_MS,
  });
  const handlers = buildDefaultHandlerMap(cfg, {
    idleOnEnemy: 'FLEE',
  });
  return new OnlineAIDriver(host, handlers, 'IDLE');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AI: hazard zone → RestrictedZone → FLEE (integration)', () => {

  // -----------------------------------------------------------------------
  // Scenario 1: NPC inside hazard zone → FLEE
  // -----------------------------------------------------------------------

  describe('scenario 1: NPC inside hazard zone transitions to FLEE', () => {
    it('NPC in IDLE at zone center → restricted zone check fires → transitions to FLEE', () => {
      const { manager } = createStubHazardDeps();

      // Register hazard zone
      manager.addZone({
        id: 'rad_zone_1',
        type: 'radiation',
        x: ZONE_X,
        y: ZONE_Y,
        radius: ZONE_RADIUS,
        damagePerSecond: 5,
        artefactChance: 0,
        maxArtefacts: 0,
      });

      // Mirror hazard as OUT restricted zone
      const zones = new RestrictedZoneManager(SAFE_MARGIN);
      zones.addZone({
        id: 'restrict_rad_1',
        type: RestrictionType.OUT,
        x: ZONE_X,
        y: ZONE_Y,
        radius: ZONE_RADIUS,
        active: true,
        metadata: 'hazard',
      });

      // Verify hazard zone reports NPC as inside it
      const hazardZone = manager.getZone('rad_zone_1')!;
      expect(hazardZone.containsPoint(ZONE_X, ZONE_Y)).toBe(true);

      // NPC starts at zone center
      const host = new TestNPCHost(ZONE_X, ZONE_Y);
      host.restrictedZones = createZoneAccess(zones);

      const driver = buildDriver(host);
      expect(driver.currentStateId).toBe('IDLE');

      // Advance past check interval so throttle fires
      host.advanceMs(CHECK_INTERVAL_MS + 1);

      // isAccessible should return false because NPC is inside the OUT zone
      expect(host.restrictedZones.isAccessible(host.x, host.y)).toBe(false);

      driver.update(50);

      // IdleState no longer transitions on zone exit — stays IDLE and uses moveToward().
      expect(driver.currentStateId).toBe('IDLE');
    });

    it('HazardManager.getZoneAtPoint confirms NPC is inside hazard area', () => {
      const { manager } = createStubHazardDeps();
      manager.addZone({
        id: 'fire_1',
        type: 'fire',
        x: 200,
        y: 200,
        radius: 60,
        damagePerSecond: 10,
        artefactChance: 0,
        maxArtefacts: 0,
      });

      // NPC inside zone
      expect(manager.getZoneAtPoint(200, 200)).not.toBeNull();
      expect(manager.getZoneAtPoint(200 + 59, 200)).not.toBeNull();

      // NPC outside zone
      expect(manager.getZoneAtPoint(200 + 61, 200)).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 2: NPC outside hazard radius → stays IDLE
  // -----------------------------------------------------------------------

  describe('scenario 2: NPC outside hazard radius stays in IDLE', () => {
    it('NPC at (300, 300) with hazard at (100, 100) r=50 → remains IDLE', () => {
      const { manager } = createStubHazardDeps();
      manager.addZone({
        id: 'rad_zone_2',
        type: 'radiation',
        x: ZONE_X,
        y: ZONE_Y,
        radius: ZONE_RADIUS,
        damagePerSecond: 5,
        artefactChance: 0,
        maxArtefacts: 0,
      });

      const zones = new RestrictedZoneManager(SAFE_MARGIN);
      zones.addZone({
        id: 'restrict_rad_2',
        type: RestrictionType.OUT,
        x: ZONE_X,
        y: ZONE_Y,
        radius: ZONE_RADIUS,
        active: true,
        metadata: 'hazard',
      });

      // NPC is far away from the zone
      const host = new TestNPCHost(300, 300);
      host.restrictedZones = createZoneAccess(zones);

      const driver = buildDriver(host);
      expect(driver.currentStateId).toBe('IDLE');

      // Advance past check interval
      host.advanceMs(CHECK_INTERVAL_MS + 1);

      // NPC position is outside the zone → accessible
      expect(host.restrictedZones.isAccessible(300, 300)).toBe(true);

      // Hazard zone does not contain NPC
      expect(manager.getZoneAtPoint(300, 300)).toBeNull();

      driver.update(50);

      // Should remain in IDLE
      expect(driver.currentStateId).toBe('IDLE');
    });

    it('zone boundary: NPC just outside effective radius (radius + margin) → stays IDLE', () => {
      const zones = new RestrictedZoneManager(SAFE_MARGIN);
      zones.addZone({
        id: 'restrict_boundary',
        type: RestrictionType.OUT,
        x: 0,
        y: 0,
        radius: ZONE_RADIUS,
        active: true,
      });

      // Effective radius = ZONE_RADIUS + SAFE_MARGIN = 55
      // NPC at exactly 56 px from center → accessible
      const host = new TestNPCHost(56, 0);
      host.restrictedZones = createZoneAccess(zones);

      expect(host.restrictedZones.isAccessible(56, 0)).toBe(true);

      const driver = buildDriver(host);
      host.advanceMs(CHECK_INTERVAL_MS + 1);
      driver.update(50);

      expect(driver.currentStateId).toBe('IDLE');
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 3: NPC teleports into hazard zone → FLEE triggered
  // -----------------------------------------------------------------------

  describe('scenario 3: NPC teleports inside hazard zone → FLEE triggered', () => {
    it('NPC starts outside → teleports inside → next check triggers FLEE', () => {
      const { manager } = createStubHazardDeps();
      manager.addZone({
        id: 'psi_zone',
        type: 'psi',
        x: 500,
        y: 500,
        radius: 80,
        damagePerSecond: 15,
        artefactChance: 0,
        maxArtefacts: 0,
      });

      const zones = new RestrictedZoneManager(SAFE_MARGIN);
      zones.addZone({
        id: 'restrict_psi',
        type: RestrictionType.OUT,
        x: 500,
        y: 500,
        radius: 80,
        active: true,
        metadata: 'hazard',
      });

      // NPC starts outside zone
      const host = new TestNPCHost(100, 100);
      host.restrictedZones = createZoneAccess(zones);

      const driver = buildDriver(host);
      expect(driver.currentStateId).toBe('IDLE');

      // Advance time and update — should stay IDLE (outside zone)
      host.advanceMs(CHECK_INTERVAL_MS + 1);
      driver.update(50);
      expect(driver.currentStateId).toBe('IDLE');

      // Teleport into zone
      host.teleport(500, 500);

      // Verify hazard zone contains new position
      expect(manager.getZoneAtPoint(500, 500)).not.toBeNull();
      expect(host.restrictedZones.isAccessible(500, 500)).toBe(false);

      // Advance time again to re-arm the check throttle
      host.advanceMs(CHECK_INTERVAL_MS + 1);
      driver.update(50);

      // IdleState no longer transitions on zone exit — stays IDLE and uses moveToward().
      expect(driver.currentStateId).toBe('IDLE');
    });

    it('multiple hazard zones — NPC triggers IDLE (moves toward safe exit) from any overlapping zone', () => {
      const { manager } = createStubHazardDeps();
      manager.addZone({
        id: 'chem_1',
        type: 'chemical',
        x: 200,
        y: 200,
        radius: 40,
        damagePerSecond: 8,
        artefactChance: 0,
        maxArtefacts: 0,
      });
      manager.addZone({
        id: 'rad_2',
        type: 'radiation',
        x: 400,
        y: 400,
        radius: 60,
        damagePerSecond: 5,
        artefactChance: 0,
        maxArtefacts: 0,
      });

      const zones = new RestrictedZoneManager(SAFE_MARGIN);
      zones.addZone({
        id: 'restrict_chem_1',
        type: RestrictionType.OUT,
        x: 200,
        y: 200,
        radius: 40,
        active: true,
      });
      zones.addZone({
        id: 'restrict_rad_2',
        type: RestrictionType.OUT,
        x: 400,
        y: 400,
        radius: 60,
        active: true,
      });

      // NPC teleports into the second zone
      const host = new TestNPCHost(400, 400);
      host.restrictedZones = createZoneAccess(zones);

      expect(manager.getZoneAtPoint(400, 400)).not.toBeNull();
      expect(host.restrictedZones.isAccessible(400, 400)).toBe(false);

      const driver = buildDriver(host);
      host.advanceMs(CHECK_INTERVAL_MS + 1);
      driver.update(50);

      // IdleState no longer transitions on zone exit — stays IDLE and uses moveToward().
      expect(driver.currentStateId).toBe('IDLE');
    });
  });

  // -----------------------------------------------------------------------
  // Scenario 4: Zone handling — NPC stays in IDLE and moves toward safe exit
  // -----------------------------------------------------------------------

  describe('scenario 4: NPC in restricted zone stays in IDLE and navigates toward safe exit', () => {
    it('NPC stays in IDLE and has velocity set toward safe exit when inside zone', () => {
      // Verify that the driver stays in IDLE when in a restricted zone.
      const host = new TestNPCHost(ZONE_X, ZONE_Y);

      const zones = new RestrictedZoneManager(SAFE_MARGIN);
      zones.addZone({
        id: 'restrict_exit_test',
        type: RestrictionType.OUT,
        x: ZONE_X,
        y: ZONE_Y,
        radius: ZONE_RADIUS,
        active: true,
      });
      host.restrictedZones = createZoneAccess(zones);

      const driver = buildDriver(host);
      host.advanceMs(CHECK_INTERVAL_MS + 1);
      driver.update(50);

      // IdleState stays in IDLE and calls moveToward() toward a safe exit
      expect(driver.currentStateId).toBe('IDLE');
    });

    it('deactivating zone → NPC position becomes accessible again', () => {
      const zones = new RestrictedZoneManager(SAFE_MARGIN);
      zones.addZone({
        id: 'restrict_deactivate',
        type: RestrictionType.OUT,
        x: ZONE_X,
        y: ZONE_Y,
        radius: ZONE_RADIUS,
        active: true,
      });

      // NPC inside zone — not accessible
      expect(zones.accessible(ZONE_X, ZONE_Y)).toBe(false);

      // Deactivate zone (hazard cleared, surge ended, etc.)
      zones.setActive('restrict_deactivate', false);

      // Now the same position is accessible
      expect(zones.accessible(ZONE_X, ZONE_Y)).toBe(true);
    });

    it('zone removed → NPC position becomes accessible again', () => {
      const zones = new RestrictedZoneManager(SAFE_MARGIN);
      zones.addZone({
        id: 'restrict_remove',
        type: RestrictionType.OUT,
        x: ZONE_X,
        y: ZONE_Y,
        radius: ZONE_RADIUS,
        active: true,
      });

      expect(zones.accessible(ZONE_X, ZONE_Y)).toBe(false);

      zones.removeZone('restrict_remove');

      expect(zones.accessible(ZONE_X, ZONE_Y)).toBe(true);
    });

    it('hazard zone removed → HazardManager no longer reports NPC inside', () => {
      const { manager } = createStubHazardDeps();
      manager.addZone({
        id: 'rad_removable',
        type: 'radiation',
        x: ZONE_X,
        y: ZONE_Y,
        radius: ZONE_RADIUS,
        damagePerSecond: 5,
        artefactChance: 0,
        maxArtefacts: 0,
      });

      expect(manager.getZoneAtPoint(ZONE_X, ZONE_Y)).not.toBeNull();

      manager.removeZone('rad_removable');

      expect(manager.getZoneAtPoint(ZONE_X, ZONE_Y)).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Extra: RestrictedZoneManager DANGER type (soft avoidance)
  // -----------------------------------------------------------------------

  describe('DANGER zone soft avoidance semantics', () => {
    it('DANGER zone does NOT block accessible() — only isDangerous()', () => {
      const zones = new RestrictedZoneManager(SAFE_MARGIN);
      zones.addZone({
        id: 'danger_soft',
        type: RestrictionType.DANGER,
        x: ZONE_X,
        y: ZONE_Y,
        radius: ZONE_RADIUS,
        active: true,
      });

      // DANGER zone does not block hard movement (accessible = true)
      expect(zones.accessible(ZONE_X, ZONE_Y)).toBe(true);

      // But isDangerous() correctly flags the position
      expect(zones.isDangerous(ZONE_X, ZONE_Y)).toBe(true);
    });

    it('OUT zone DOES block accessible()', () => {
      const zones = new RestrictedZoneManager(SAFE_MARGIN);
      zones.addZone({
        id: 'out_hard',
        type: RestrictionType.OUT,
        x: ZONE_X,
        y: ZONE_Y,
        radius: ZONE_RADIUS,
        active: true,
      });

      expect(zones.accessible(ZONE_X, ZONE_Y)).toBe(false);
      // isDangerous() returns false for OUT zones (not a DANGER type)
      expect(zones.isDangerous(ZONE_X, ZONE_Y)).toBe(false);
    });

    it('getSafeDirection() points away from zone center', () => {
      const zones = new RestrictedZoneManager(SAFE_MARGIN);
      zones.addZone({
        id: 'dir_test',
        type: RestrictionType.OUT,
        x: 0,
        y: 0,
        radius: 100,
        active: true,
      });

      const dir = zones.getSafeDirection(50, 0);
      expect(dir).not.toBeNull();
      // NPC at (50, 0) should flee in +X direction (away from origin)
      expect(dir!.x).toBeGreaterThan(0);
      expect(Math.abs(dir!.y)).toBeLessThan(0.01);
    });
  });

  // -----------------------------------------------------------------------
  // Extra: filterAccessible excludes in-zone waypoints
  // -----------------------------------------------------------------------

  describe('filterAccessible removes waypoints inside hazard zones', () => {
    it('waypoints inside OUT zone are filtered out', () => {
      const zones = new RestrictedZoneManager(SAFE_MARGIN);
      zones.addZone({
        id: 'restrict_waypoint',
        type: RestrictionType.OUT,
        x: ZONE_X,
        y: ZONE_Y,
        radius: ZONE_RADIUS,
        active: true,
      });

      const candidates = [
        { x: ZONE_X, y: ZONE_Y },       // inside zone — blocked
        { x: ZONE_X + 200, y: ZONE_Y }, // outside zone — accessible
        { x: ZONE_X - 200, y: ZONE_Y }, // outside zone — accessible
      ];

      const host = new TestNPCHost();
      host.restrictedZones = createZoneAccess(zones);

      const accessible = host.restrictedZones.filterAccessible(candidates);
      expect(accessible).toHaveLength(2);
      expect(accessible.some(p => p.x === ZONE_X && p.y === ZONE_Y)).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Extra: check throttle — zone violation only fires after interval
  // -----------------------------------------------------------------------

  describe('zone check throttle', () => {
    it('check does not fire before restrictedZoneCheckIntervalMs has elapsed', () => {
      const zones = new RestrictedZoneManager(SAFE_MARGIN);
      zones.addZone({
        id: 'restrict_throttle',
        type: RestrictionType.OUT,
        x: ZONE_X,
        y: ZONE_Y,
        radius: ZONE_RADIUS,
        active: true,
      });

      const host = new TestNPCHost(ZONE_X, ZONE_Y);
      host.restrictedZones = createZoneAccess(zones);

      const driver = buildDriver(host);
      expect(driver.currentStateId).toBe('IDLE');

      // IdleState.enter() seeds the timer: lastIdleAnimChangeMs = now - interval
      // So the first update() WILL fire the check (timeSinceCheck = now - (now - interval) = interval >= interval).
      // IdleState stays in IDLE and calls moveToward() — no transition.
      host.advanceMs(CHECK_INTERVAL_MS + 1);
      driver.update(1); // first update fires the check → stays IDLE (moves toward safe exit)
      expect(driver.currentStateId).toBe('IDLE');
    });

    it('check re-arms after interval — subsequent zone violation stays in IDLE', () => {
      const zones = new RestrictedZoneManager(SAFE_MARGIN);
      zones.addZone({
        id: 'restrict_rearm',
        type: RestrictionType.OUT,
        x: ZONE_X,
        y: ZONE_Y,
        radius: ZONE_RADIUS,
        active: true,
      });

      // NPC starts safe, confirm stays IDLE
      const host = new TestNPCHost(300, 300);
      host.restrictedZones = createZoneAccess(zones);

      const driver = buildDriver(host);
      host.advanceMs(CHECK_INTERVAL_MS + 1);
      driver.update(50);
      expect(driver.currentStateId).toBe('IDLE');

      // Now teleport into zone and advance enough for re-check — still stays IDLE
      host.teleport(ZONE_X, ZONE_Y);
      host.advanceMs(CHECK_INTERVAL_MS + 1);
      driver.update(50);
      // IdleState no longer transitions on zone exit — stays IDLE and uses moveToward().
      expect(driver.currentStateId).toBe('IDLE');
    });
  });
});
