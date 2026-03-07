import { ALifeEvents, type ALifeKernel } from '@alife-sdk/core';

interface SetupSceneEventsParams {
  kernel: ALifeKernel;
  onTick: (tick: number) => void;
  onFactionConflict: (event: { factionA: string; factionB: string; zoneId: string }) => void;
  onNpcDied: (event: { npcId: string }) => void;
  onTaskAssigned: (event: { npcId: string; taskType: string; terrainId: string }) => void;
}

/**
 * Wires ALife kernel events to scene-level callbacks.
 */
export function setupSceneEvents(params: SetupSceneEventsParams): void {
  const { kernel, onTick, onFactionConflict, onNpcDied, onTaskAssigned } = params;

  kernel.events.on(ALifeEvents.TICK, ({ tick }) => onTick(tick));
  kernel.events.on(ALifeEvents.FACTION_CONFLICT, (event) => onFactionConflict(event));
  kernel.events.on(ALifeEvents.NPC_DIED, (event) => onNpcDied(event));
  kernel.events.on(ALifeEvents.TASK_ASSIGNED, (event) => onTaskAssigned(event));
}

