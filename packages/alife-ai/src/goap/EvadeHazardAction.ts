import { GOAPAction, ActionStatus, WorldState } from '@alife-sdk/core';
import type { IEntity } from '@alife-sdk/core';
import type { IHazardZoneAccess } from './IHazardZoneAccess';

/**
 * Generic GOAP action for hazard zone evasion.
 *
 * Moves the entity away from any hazard zone that implements IHazardZoneAccess.
 * The caller supplies the GOAP property key and action id, making this reusable
 * for anomalies, fire zones, radiation fields, or any spatial hazard.
 *
 * Direct setPosition() is used intentionally — emergency evasion bypasses
 * pathfinding to ensure immediate response to life-threatening zones.
 */
export class EvadeHazardAction extends GOAPAction {
  readonly id: string;
  readonly cost: number;

  private readonly _preconditions: WorldState;
  private readonly _effects: WorldState;

  /**
   * @param hazard      - Hazard zone access port (host-side adapter)
   * @param id          - Unique action id for plan logging (e.g. 'evade_anomaly')
   * @param propertyKey - WorldProperty key this action satisfies (e.g. WorldProperty.ANOMALY_NEAR)
   * @param speed       - Movement speed in px/s (default 120)
   * @param cost        - GOAP planner cost (default 1)
   */
  constructor(
    private readonly hazard: IHazardZoneAccess,
    id: string,
    propertyKey: string,
    private readonly speed = 120,
    cost = 1,
  ) {
    super();
    this.id = id;
    this.cost = cost;

    this._preconditions = new WorldState();
    this._preconditions.set(propertyKey, true);

    this._effects = new WorldState();
    this._effects.set(propertyKey, false);
  }

  getPreconditions(): WorldState { return this._preconditions; }
  getEffects(): WorldState { return this._effects; }

  isValid(entity: IEntity): boolean {
    return this.hazard.isNearHazard(entity.x, entity.y);
  }

  execute(entity: IEntity, deltaMs: number): ActionStatus {
    const escape = this.hazard.getEscapeDirection(entity.x, entity.y);
    if (!escape) return ActionStatus.SUCCESS;

    const dt = deltaMs / 1000;
    // Direct position update — emergency evasion bypasses pathfinding intentionally.
    entity.setPosition(
      entity.x + escape.x * this.speed * dt,
      entity.y + escape.y * this.speed * dt,
    );

    return this.hazard.isNearHazard(entity.x, entity.y)
      ? ActionStatus.RUNNING
      : ActionStatus.SUCCESS;
  }
}
