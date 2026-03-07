import { GOAPPlanner } from '@alife-sdk/core';

/**
 * Builds the shared stateless GOAP planner used by all NPCs.
 */
export function setupGoapPlanner(): GOAPPlanner {
  const planner = new GOAPPlanner();

  planner.registerAction({
    id: 'TakePosition',
    cost: 3,
    preconditions: { inPosition: false },
    effects: { inPosition: true },
  });
  planner.registerAction({
    id: 'Attack',
    cost: 2,
    preconditions: { inPosition: true },
    effects: { targetEliminated: true },
  });
  planner.registerAction({
    id: 'FindCover',
    cost: 1,
    preconditions: { underFire: true },
    effects: { inCover: true },
  });
  planner.registerAction({
    id: 'AttackFromCover',
    cost: 1,
    preconditions: { inCover: true },
    effects: { targetEliminated: true },
  });

  return planner;
}

