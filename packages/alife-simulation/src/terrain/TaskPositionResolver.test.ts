import { describe, it, expect } from 'vitest';
import type { IRandom, IZoneBounds, IJobSlot, PatrolRoute } from '@alife-sdk/core';
import { TaskPositionResolver } from './TaskPositionResolver';

const fixedRandom: IRandom = {
  next: () => 0.5,
  nextInt: (min, max) => Math.floor(0.5 * (max - min + 1)) + min,
  nextFloat: (min, max) => 0.5 * (max - min) + min,
};

const bounds: IZoneBounds = { x: 100, y: 200, width: 400, height: 300 };

function makeRoute(overrides?: Partial<PatrolRoute>): PatrolRoute {
  return {
    id: 'route_1',
    terrainId: 'terrain_1',
    waypoints: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
    routeType: 'loop',
    ...overrides,
  };
}

const noRoute = () => null;

describe('TaskPositionResolver', () => {
  // -----------------------------------------------------------------------
  // Guard / Camp with slot.position
  // -----------------------------------------------------------------------
  it('guard with slot.position returns that position exactly', () => {
    const slot: IJobSlot = { type: 'guard', slots: 1, position: { x: 55, y: 77 } };

    const result = TaskPositionResolver.resolve(
      slot, 'guard', bounds, noRoute, noRoute, fixedRandom,
    );

    expect(result).toEqual({ targetX: 55, targetY: 77 });
  });

  it('camp with slot.position returns that position exactly', () => {
    const slot: IJobSlot = { type: 'camp', slots: 1, position: { x: 12, y: 34 } };

    const result = TaskPositionResolver.resolve(
      slot, 'camp', bounds, noRoute, noRoute, fixedRandom,
    );

    expect(result).toEqual({ targetX: 12, targetY: 34 });
  });

  // -----------------------------------------------------------------------
  // Patrol with routeId
  // -----------------------------------------------------------------------
  it('patrol with slot.routeId returns first waypoint of the found route', () => {
    const route = makeRoute({ id: 'perimeter' });
    const slot: IJobSlot = { type: 'patrol', slots: 1, routeId: 'perimeter' };

    const result = TaskPositionResolver.resolve(
      slot,
      'patrol',
      bounds,
      (id) => (id === 'perimeter' ? route : null),
      noRoute,
      fixedRandom,
    );

    expect(result).toEqual({
      targetX: 10,
      targetY: 20,
      routeId: 'perimeter',
      waypointIndex: 0,
    });
  });

  // -----------------------------------------------------------------------
  // Patrol without routeId — falls back to default route index
  // -----------------------------------------------------------------------
  it('patrol without routeId falls back to default route index', () => {
    const route = makeRoute({ id: 'default_route' });
    const slot: IJobSlot = { type: 'patrol', slots: 1 };

    const result = TaskPositionResolver.resolve(
      slot,
      'patrol',
      bounds,
      noRoute,
      (idx) => (idx === 0 ? route : null),
      fixedRandom,
    );

    expect(result).toEqual({
      targetX: 10,
      targetY: 20,
      routeId: 'default_route',
      waypointIndex: 0,
    });
  });

  // -----------------------------------------------------------------------
  // Patrol with no matching route — falls back to random position
  // -----------------------------------------------------------------------
  it('patrol with no matching route falls back to random position', () => {
    const slot: IJobSlot = { type: 'patrol', slots: 1, routeId: 'missing' };

    const result = TaskPositionResolver.resolve(
      slot, 'patrol', bounds, noRoute, noRoute, fixedRandom,
    );

    expect(result).toEqual({
      targetX: 100 + 0.5 * 400,
      targetY: 200 + 0.5 * 300,
    });
  });

  // -----------------------------------------------------------------------
  // Wander / unknown type — random position within bounds
  // -----------------------------------------------------------------------
  it('wander type returns random position within bounds', () => {
    const slot: IJobSlot = { type: 'wander', slots: 1 };

    const result = TaskPositionResolver.resolve(
      slot, 'wander', bounds, noRoute, noRoute, fixedRandom,
    );

    expect(result).toEqual({
      targetX: 100 + 0.5 * 400,
      targetY: 200 + 0.5 * 300,
    });
  });

  it('unknown task type returns random position within bounds', () => {
    const result = TaskPositionResolver.resolve(
      null, 'something_else', bounds, noRoute, noRoute, fixedRandom,
    );

    expect(result).toEqual({
      targetX: 300,
      targetY: 350,
    });
  });

  // -----------------------------------------------------------------------
  // Custom defaultRouteIndex
  // -----------------------------------------------------------------------
  it('uses custom defaultRouteIndex when provided', () => {
    const route = makeRoute({ id: 'route_2' });
    const slot: IJobSlot = { type: 'patrol', slots: 1 };

    const result = TaskPositionResolver.resolve(
      slot,
      'patrol',
      bounds,
      noRoute,
      (idx) => (idx === 3 ? route : null),
      fixedRandom,
      3,
    );

    expect(result).toEqual({
      targetX: 10,
      targetY: 20,
      routeId: 'route_2',
      waypointIndex: 0,
    });
  });
});
