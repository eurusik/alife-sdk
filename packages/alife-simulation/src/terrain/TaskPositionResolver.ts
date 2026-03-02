import type { IRandom, IZoneBounds, IJobSlot, PatrolRoute } from '@alife-sdk/core';

export interface IResolvedTaskPosition {
  targetX: number;
  targetY: number;
  routeId?: string;
  waypointIndex?: number;
}

/**
 * Stateless resolver that determines the initial target position for
 * a task based on the assigned job slot, task type, and available
 * patrol routes.
 */
export class TaskPositionResolver {
  static resolve(
    slot: IJobSlot | null,
    taskType: string,
    bounds: IZoneBounds,
    findRouteById: (routeId: string) => PatrolRoute | null,
    getRouteByIdx: (index: number) => PatrolRoute | null,
    random: IRandom,
    defaultRouteIndex = 0,
  ): IResolvedTaskPosition {
    if (
      slot?.position &&
      (taskType === 'guard' || taskType === 'camp')
    ) {
      return {
        targetX: slot.position.x,
        targetY: slot.position.y,
      };
    }

    if (taskType === 'patrol') {
      const route = slot?.routeId
        ? findRouteById(slot.routeId)
        : getRouteByIdx(defaultRouteIndex);
      if (route && route.waypoints.length > 0) {
        const firstWaypoint = route.waypoints[0];
        return {
          targetX:       firstWaypoint.x,
          targetY:       firstWaypoint.y,
          routeId:       route.id,
          waypointIndex: 0,
        };
      }
    }

    return {
      targetX: bounds.x + random.next() * bounds.width,
      targetY: bounds.y + random.next() * bounds.height,
    };
  }
}
