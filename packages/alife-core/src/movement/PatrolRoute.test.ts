import {
  RouteType,
  PatrolRouteTracker,
  type PatrolRoute,
  type IPatrolWaypoint,
  type RouteAdvancer,
} from './PatrolRoute';

function makeRoute(
  routeType: RouteType,
  waypoints: IPatrolWaypoint[],
): PatrolRoute {
  return {
    id: 'route_test',
    terrainId: 'terrain_1',
    waypoints,
    routeType,
  };
}

describe('PatrolRouteTracker', () => {
  // -----------------------------------------------------------------------
  // LOOP
  // -----------------------------------------------------------------------
  describe('LOOP', () => {
    it('cycles through waypoints and wraps around', () => {
      const route = makeRoute(RouteType.LOOP, [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ]);
      const tracker = new PatrolRouteTracker(route);

      expect(tracker.currentWaypoint).toEqual({ x: 0, y: 0 });

      tracker.advance();
      expect(tracker.currentWaypoint).toEqual({ x: 10, y: 0 });

      tracker.advance();
      expect(tracker.currentWaypoint).toEqual({ x: 20, y: 0 });

      tracker.advance(); // wrap
      expect(tracker.currentWaypoint).toEqual({ x: 0, y: 0 });

      tracker.advance();
      expect(tracker.currentWaypoint).toEqual({ x: 10, y: 0 });
    });

    it('never completes', () => {
      const route = makeRoute(RouteType.LOOP, [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]);
      const tracker = new PatrolRouteTracker(route);

      for (let i = 0; i < 20; i++) {
        expect(tracker.isComplete).toBe(false);
        tracker.advance();
      }
      expect(tracker.isComplete).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // PING_PONG
  // -----------------------------------------------------------------------
  describe('PING_PONG', () => {
    it('reverses direction at both boundaries', () => {
      const route = makeRoute(RouteType.PING_PONG, [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ]);
      const tracker = new PatrolRouteTracker(route);

      // Forward: 0 -> 1 -> 2
      expect(tracker.currentWaypoint).toEqual({ x: 0, y: 0 });
      tracker.advance();
      expect(tracker.currentWaypoint).toEqual({ x: 10, y: 0 });
      tracker.advance();
      expect(tracker.currentWaypoint).toEqual({ x: 20, y: 0 });

      // Reverse at end: 2 -> 1
      tracker.advance();
      expect(tracker.currentWaypoint).toEqual({ x: 10, y: 0 });

      // Continue reverse: 1 -> 0
      tracker.advance();
      expect(tracker.currentWaypoint).toEqual({ x: 0, y: 0 });

      // Reverse at start: 0 -> 1
      tracker.advance();
      expect(tracker.currentWaypoint).toEqual({ x: 10, y: 0 });

      // Continue forward: 1 -> 2
      tracker.advance();
      expect(tracker.currentWaypoint).toEqual({ x: 20, y: 0 });
    });

    it('never completes', () => {
      const route = makeRoute(RouteType.PING_PONG, [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ]);
      const tracker = new PatrolRouteTracker(route);

      for (let i = 0; i < 20; i++) {
        expect(tracker.isComplete).toBe(false);
        tracker.advance();
      }
      expect(tracker.isComplete).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // ONE_WAY
  // -----------------------------------------------------------------------
  describe('ONE_WAY', () => {
    it('advances to the final waypoint and then completes', () => {
      const route = makeRoute(RouteType.ONE_WAY, [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ]);
      const tracker = new PatrolRouteTracker(route);

      expect(tracker.isComplete).toBe(false);
      tracker.advance(); // -> index 1
      expect(tracker.currentWaypoint).toEqual({ x: 10, y: 0 });
      expect(tracker.isComplete).toBe(false);

      tracker.advance(); // -> index 2 (last)
      expect(tracker.currentWaypoint).toEqual({ x: 20, y: 0 });
      expect(tracker.isComplete).toBe(false);

      tracker.advance(); // signals completion
      expect(tracker.isComplete).toBe(true);
    });

    it('is a no-op after completion', () => {
      const route = makeRoute(RouteType.ONE_WAY, [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]);
      const tracker = new PatrolRouteTracker(route);

      tracker.advance(); // -> index 1
      tracker.advance(); // completed
      expect(tracker.isComplete).toBe(true);

      tracker.advance(); // no-op
      expect(tracker.isComplete).toBe(true);
      expect(tracker.currentWaypoint).toEqual({ x: 10, y: 0 });
    });

    it('completes immediately for single-waypoint route', () => {
      const route = makeRoute(RouteType.ONE_WAY, [{ x: 5, y: 5 }]);
      const tracker = new PatrolRouteTracker(route);

      expect(tracker.isComplete).toBe(false);
      tracker.advance();
      expect(tracker.isComplete).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // tickWait
  // -----------------------------------------------------------------------
  describe('tickWait', () => {
    it('returns true immediately when no waitTime is set', () => {
      const route = makeRoute(RouteType.LOOP, [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]);
      const tracker = new PatrolRouteTracker(route);
      expect(tracker.tickWait(100)).toBe(true);
    });

    it('counts down waitTime and returns false until expired', () => {
      const route = makeRoute(RouteType.LOOP, [
        { x: 0, y: 0 },
        { x: 10, y: 0, waitTime: 1000 },
      ]);
      const tracker = new PatrolRouteTracker(route);

      tracker.advance(); // moves to waypoint 1 which has waitTime 1000
      expect(tracker.tickWait(400)).toBe(false); // 600 remaining
      expect(tracker.tickWait(400)).toBe(false); // 200 remaining
      expect(tracker.tickWait(200)).toBe(true);  // 0 remaining
    });

    it('returns true on subsequent ticks after wait expires', () => {
      const route = makeRoute(RouteType.LOOP, [
        { x: 0, y: 0 },
        { x: 10, y: 0, waitTime: 500 },
      ]);
      const tracker = new PatrolRouteTracker(route);

      tracker.advance();
      tracker.tickWait(500); // expire
      expect(tracker.tickWait(100)).toBe(true); // already expired
    });
  });

  // -----------------------------------------------------------------------
  // reset
  // -----------------------------------------------------------------------
  describe('reset', () => {
    it('resets to the first waypoint', () => {
      const route = makeRoute(RouteType.LOOP, [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ]);
      const tracker = new PatrolRouteTracker(route);

      tracker.advance();
      tracker.advance();
      expect(tracker.currentWaypoint).toEqual({ x: 20, y: 0 });

      tracker.reset();
      expect(tracker.currentWaypoint).toEqual({ x: 0, y: 0 });
    });

    it('clears completion state for ONE_WAY routes', () => {
      const route = makeRoute(RouteType.ONE_WAY, [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]);
      const tracker = new PatrolRouteTracker(route);

      tracker.advance();
      tracker.advance();
      expect(tracker.isComplete).toBe(true);

      tracker.reset();
      expect(tracker.isComplete).toBe(false);
      expect(tracker.currentWaypoint).toEqual({ x: 0, y: 0 });
    });

    it('resets direction for PING_PONG routes', () => {
      const route = makeRoute(RouteType.PING_PONG, [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ]);
      const tracker = new PatrolRouteTracker(route);

      // Go forward past end to reverse
      tracker.advance(); // 1
      tracker.advance(); // 2
      tracker.advance(); // reverses to 1

      tracker.reset();
      // After reset, should go forward again
      tracker.advance();
      expect(tracker.currentWaypoint).toEqual({ x: 10, y: 0 }); // forward, not backward
    });
  });

  // -----------------------------------------------------------------------
  // Accessors
  // -----------------------------------------------------------------------
  describe('accessors', () => {
    it('waypointCount returns total waypoints', () => {
      const route = makeRoute(RouteType.LOOP, [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ]);
      const tracker = new PatrolRouteTracker(route);
      expect(tracker.waypointCount).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // Custom RouteAdvancer
  // -----------------------------------------------------------------------
  describe('custom RouteAdvancer', () => {
    it('uses custom advancer instead of built-in route type logic', () => {
      // A "skip-one" advancer that advances by 2 instead of 1, wrapping around
      const skipOneAdvancer: RouteAdvancer = (currentIndex, waypointCount, direction) => {
        const next = (currentIndex + 2) % waypointCount;
        return { index: next, direction, completed: false };
      };

      const route = makeRoute(RouteType.LOOP, [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 30, y: 0 },
      ]);
      const tracker = new PatrolRouteTracker(route, skipOneAdvancer);

      expect(tracker.currentWaypoint).toEqual({ x: 0, y: 0 });

      tracker.advance();
      expect(tracker.currentWaypoint).toEqual({ x: 20, y: 0 }); // skipped index 1

      tracker.advance();
      expect(tracker.currentWaypoint).toEqual({ x: 0, y: 0 }); // (2+2)%4 = 0

      tracker.advance();
      expect(tracker.currentWaypoint).toEqual({ x: 20, y: 0 }); // (0+2)%4 = 2
    });

    it('custom advancer can signal completion', () => {
      // An advancer that completes after reaching the last waypoint
      const completingAdvancer: RouteAdvancer = (currentIndex, waypointCount, direction) => {
        const next = currentIndex + 1;
        if (next >= waypointCount) {
          return { index: currentIndex, direction, completed: true };
        }
        return { index: next, direction, completed: false };
      };

      const route = makeRoute(RouteType.LOOP, [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ]);
      const tracker = new PatrolRouteTracker(route, completingAdvancer);

      tracker.advance(); // -> index 1
      expect(tracker.isComplete).toBe(false);
      tracker.advance(); // -> index 2
      expect(tracker.isComplete).toBe(false);
      tracker.advance(); // -> completed
      expect(tracker.isComplete).toBe(true);

      // Further advances are no-ops (completed flag short-circuits)
      tracker.advance();
      expect(tracker.isComplete).toBe(true);
    });

    it('custom advancer can change direction', () => {
      // A "spiral" advancer: forward 2 steps, then reverse
      let callCount = 0;
      const spiralAdvancer: RouteAdvancer = (currentIndex, waypointCount, _direction) => {
        callCount++;
        if (callCount <= 2) {
          // Forward
          return { index: (currentIndex + 1) % waypointCount, direction: 1, completed: false };
        }
        // Reverse on 3rd call
        return { index: Math.max(0, currentIndex - 1), direction: -1, completed: false };
      };

      const route = makeRoute(RouteType.LOOP, [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 30, y: 0 },
      ]);
      const tracker = new PatrolRouteTracker(route, spiralAdvancer);

      tracker.advance(); // forward -> index 1
      expect(tracker.currentWaypoint).toEqual({ x: 10, y: 0 });

      tracker.advance(); // forward -> index 2
      expect(tracker.currentWaypoint).toEqual({ x: 20, y: 0 });

      tracker.advance(); // reverse -> index 1
      expect(tracker.currentWaypoint).toEqual({ x: 10, y: 0 });
    });

    it('custom advancer is not called for single-waypoint ONE_WAY routes', () => {
      const advancerFn = vi.fn();

      const route = makeRoute(RouteType.ONE_WAY, [{ x: 5, y: 5 }]);
      const tracker = new PatrolRouteTracker(route, advancerFn);

      tracker.advance(); // single waypoint ONE_WAY completes via built-in logic
      expect(tracker.isComplete).toBe(true);
      expect(advancerFn).not.toHaveBeenCalled();
    });

    it('waitTime is still applied after custom advancer', () => {
      const simpleAdvancer: RouteAdvancer = (currentIndex, waypointCount, direction) => ({
        index: (currentIndex + 1) % waypointCount,
        direction,
        completed: false,
      });

      const route = makeRoute(RouteType.LOOP, [
        { x: 0, y: 0 },
        { x: 10, y: 0, waitTime: 500 },
      ]);
      const tracker = new PatrolRouteTracker(route, simpleAdvancer);

      tracker.advance(); // -> waypoint with waitTime 500
      expect(tracker.tickWait(200)).toBe(false); // 300 remaining
      expect(tracker.tickWait(300)).toBe(true);  // expired
    });
  });
});
