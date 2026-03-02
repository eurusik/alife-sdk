/** Predefined subsystem channel names for log routing and filtering. Extensible via `(string & {})`. */
export const LogChannel = {
  ALIFE: 'alife',
  SQUAD: 'squad',
  SPAWN: 'spawn',
  SURGE: 'surge',
  TIME: 'time',
  AI: 'ai',
  MOVEMENT: 'movement',
  PERCEPTION: 'perception',
  NPC_BRAIN: 'npc_brain',
  COMBAT: 'combat',
  COVER: 'cover',
  FACTION: 'faction',
  STATE: 'state',
  SAVE: 'save',
  TRADE: 'trade',
  ANOMALY: 'anomaly',
  INVENTORY: 'inventory',
  INPUT: 'input',
  AUDIO: 'audio',
  QUEST: 'quest',
  SCENE: 'scene',
  GOAP: 'goap',
} as const;

export type LogChannel = (typeof LogChannel)[keyof typeof LogChannel];
