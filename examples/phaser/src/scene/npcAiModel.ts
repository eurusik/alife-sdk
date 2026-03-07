import { AIStateRegistry, DangerManager, GOAPPlanner, MemoryBank, StateMachine, WorldState } from '@alife-sdk/core';
import type { IEntity } from '@alife-sdk/core';
import { CONF_ALERT, CONF_COMBAT, CONF_FORGET } from './demoConfig';

/**
 * Minimal IEntity wrapper for StateMachine/Memory/GOAP integration.
 *
 * Position is synchronized from the Phaser sprite each frame.
 */
export class NpcEntity implements IEntity {
  readonly entityType = 'npc';
  active = true;
  isAlive = true;
  x = 0;
  y = 0;

  constructor(public readonly id: string) {}

  setPosition(x: number, y: number): void { this.x = x; this.y = y; }
  setActive(v: boolean): this { this.active = v; return this; }
  setVisible(_v: boolean): this { return this; }
  hasComponent(_: string): boolean { return false; }
  getComponent<T>(_: string): T { throw new Error('no components'); }
}

export interface NpcAI {
  entity: NpcEntity;
  memory: MemoryBank;
  fsm: StateMachine;
  currentPlan: string[];
  dangerLevel: number;
}

/**
 * Build per-NPC FSM that reacts to memory confidence and nearby threat.
 */
export function buildNpcFSM(
  entity: NpcEntity,
  memory: MemoryBank,
  dangerMgr: DangerManager,
  planner: GOAPPlanner,
  bundle: Pick<NpcAI, 'currentPlan'>,
): StateMachine {
  function replan(underFire: boolean): void {
    const ws = WorldState.from({ hasAmmo: true, ...(underFire ? { underFire: true } : {}) });
    const goal = WorldState.from({ targetEliminated: true });
    const plan = planner.plan(ws, goal);
    bundle.currentPlan = plan ? plan.map(action => action.id) : [];
  }

  const registry = new AIStateRegistry();

  registry
    .register('PATROL', {
      handler: {
        enter: () => {},
        update: (_e, deltaSec) => { memory.update(deltaSec); },
        exit: () => {},
      },
      transitionConditions: [
        {
          targetState: 'ALERT',
          priority: 10,
          condition: () => {
            const best = memory.getMostConfident();
            return best !== undefined && best.confidence > CONF_ALERT;
          },
        },
      ],
    })
    .register('ALERT', {
      handler: {
        enter: () => {},
        update: (_e, deltaSec) => { memory.update(deltaSec); },
        exit: () => {},
      },
      transitionConditions: [
        {
          targetState: 'COMBAT',
          priority: 20,
          condition: () => {
            const best = memory.getMostConfident();
            return best !== undefined && best.confidence > CONF_COMBAT;
          },
        },
        {
          targetState: 'PATROL',
          priority: 5,
          condition: () => {
            const best = memory.getMostConfident();
            return best === undefined || best.confidence < CONF_FORGET;
          },
        },
      ],
    })
    .register('COMBAT', {
      handler: {
        enter: () => {
          const underFire = dangerMgr.isDangerous({ x: entity.x, y: entity.y });
          replan(underFire);
        },
        update: (_e, deltaSec) => { memory.update(deltaSec); },
        exit: () => { bundle.currentPlan = []; },
      },
      transitionConditions: [
        {
          targetState: 'PATROL',
          priority: 5,
          condition: () => {
            const best = memory.getMostConfident();
            return best === undefined || best.confidence < CONF_FORGET;
          },
        },
      ],
    });

  return new StateMachine(entity, registry, 'PATROL');
}

