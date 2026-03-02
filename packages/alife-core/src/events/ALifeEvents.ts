import type { Vec2 } from '../core/Vec2';

export const ALifeEvents = {
  // A-Life core
  TICK: 'alife:tick',
  NPC_MOVED: 'alife:npc_moved',
  FACTION_CONFLICT: 'alife:faction_conflict',
  NPC_ONLINE: 'alife:npc_online',
  NPC_OFFLINE: 'alife:npc_offline',
  TASK_ASSIGNED: 'alife:task_assigned',
  NPC_DIED: 'alife:npc_died',
  SPAWN_REQUESTED: 'alife:spawn_requested',
  NPC_RELEASED: 'alife:npc_released',
  TERRAIN_STATE_CHANGED: 'alife:terrain_state_changed',
  MORALE_CHANGED: 'alife:morale_changed',
  NPC_PANICKED: 'ai:npc_panicked',

  // AI perception
  SPOTTED_ENEMY: 'ai:spotted_enemy',
  HEARD_SOUND: 'ai:heard_sound',
  LOST_TARGET: 'ai:lost_target',
  STATE_CHANGED: 'ai:state_changed',
  NPC_SHOOT: 'ai:npc_shoot',
  NPC_VOCALIZATION: 'ai:npc_vocalization',
  NPC_ATTACKED: 'ai:npc_attacked',

  // Surge
  SURGE_WARNING: 'surge:warning',
  SURGE_STARTED: 'surge:started',
  SURGE_ENDED: 'surge:ended',
  SURGE_DAMAGE: 'surge:damage',

  // Anomaly
  ANOMALY_DAMAGE: 'anomaly:damage',
  ARTEFACT_SPAWNED: 'anomaly:artefact_spawned',
  ARTEFACT_COLLECTED: 'anomaly:artefact_collected',

  // Squad
  SQUAD_FORMED: 'squad:formed',
  SQUAD_MEMBER_ADDED: 'squad:member_added',
  SQUAD_MEMBER_REMOVED: 'squad:member_removed',
  SQUAD_DISBANDED: 'squad:disbanded',
  SQUAD_COMMAND_ISSUED: 'squad:command_issued',
  SQUAD_GOAL_SET: 'squad:goal_set',
  SQUAD_GOAL_CLEARED: 'squad:goal_cleared',

  // Faction
  FACTION_RELATION_CHANGED: 'faction:relation_changed',

  // Time
  HOUR_CHANGED: 'time:hour_changed',
  DAY_NIGHT_CHANGED: 'time:day_night_changed',

  // Social
  NPC_SOCIAL_BUBBLE: 'social:npc_bubble',
  NPC_MEET_PLAYER: 'social:npc_meet_player',
  KAMP_STATE_CHANGED: 'social:kamp_state_changed',

  // Monster
  MONSTER_MELEE_HIT: 'monster:melee_hit',
  PSI_ATTACK_START: 'monster:psi_attack_start',
} as const;

export type ALifeEvents = (typeof ALifeEvents)[keyof typeof ALifeEvents];

export interface ALifeEventPayloads {
  // A-Life core
  [ALifeEvents.TICK]: { tick: number; delta: number };
  [ALifeEvents.NPC_MOVED]: { npcId: string; fromZone: string; toZone: string };
  [ALifeEvents.FACTION_CONFLICT]: {
    factionA: string;
    factionB: string;
    zoneId: string;
  };
  [ALifeEvents.NPC_ONLINE]: { npcId: string; position: Vec2 };
  [ALifeEvents.NPC_OFFLINE]: { npcId: string; zoneId: string };
  [ALifeEvents.TASK_ASSIGNED]: {
    npcId: string;
    terrainId: string;
    taskType: string;
  };
  [ALifeEvents.NPC_DIED]: {
    npcId: string;
    killedBy: string;
    zoneId: string;
  };
  [ALifeEvents.SPAWN_REQUESTED]: {
    spawnPointId: string;
    terrainId: string;
    position: Vec2;
    factionId: string;
    enemyType: string;
  };
  [ALifeEvents.NPC_RELEASED]: { npcId: string; terrainId: string };
  [ALifeEvents.TERRAIN_STATE_CHANGED]: {
    terrainId: string;
    oldState: number;
    newState: number;
  };
  [ALifeEvents.MORALE_CHANGED]: {
    npcId: string;
    morale: number;
    previousMorale: number;
    moraleState: string;
  };
  [ALifeEvents.NPC_PANICKED]: {
    npcId: string;
    squadId: string | null;
  };

  // AI perception
  [ALifeEvents.SPOTTED_ENEMY]: {
    npcId: string;
    enemyId: string;
    position: Vec2;
  };
  [ALifeEvents.HEARD_SOUND]: {
    npcId: string;
    sourceId: string;
    position: Vec2;
  };
  [ALifeEvents.LOST_TARGET]: {
    npcId: string;
    lastKnown: Vec2;
  };
  [ALifeEvents.STATE_CHANGED]: {
    npcId: string;
    oldState: string;
    newState: string;
  };
  [ALifeEvents.NPC_SHOOT]: {
    npcId: string;
    from: Vec2;
    target: Vec2;
    damage: number;
  };
  [ALifeEvents.NPC_VOCALIZATION]: {
    npcId: string;
    soundType: string;
    position: Vec2;
    factionId: string;
  };
  [ALifeEvents.NPC_ATTACKED]: {
    attackerId: string;
    targetId: string;
    damage: number;
    attackerFaction: string;
    targetFaction: string;
  };

  // Surge
  [ALifeEvents.SURGE_WARNING]: { timeUntilSurge: number };
  [ALifeEvents.SURGE_STARTED]: { surgeNumber: number };
  [ALifeEvents.SURGE_ENDED]: { surgeNumber: number };
  [ALifeEvents.SURGE_DAMAGE]: { npcId: string; damage: number };

  // Anomaly
  [ALifeEvents.ANOMALY_DAMAGE]: {
    entityId: string;
    anomalyId: string;
    damage: number;
    damageType: string;
  };
  [ALifeEvents.ARTEFACT_SPAWNED]: {
    artefactId: string;
    anomalyId: string;
    position: Vec2;
  };
  [ALifeEvents.ARTEFACT_COLLECTED]: {
    artefactId: string;
    collectorId: string;
  };

  // Squad
  [ALifeEvents.SQUAD_FORMED]: {
    squadId: string;
    factionId: string;
    memberIds: string[];
  };
  [ALifeEvents.SQUAD_MEMBER_ADDED]: { squadId: string; npcId: string };
  [ALifeEvents.SQUAD_MEMBER_REMOVED]: { squadId: string; npcId: string };
  [ALifeEvents.SQUAD_DISBANDED]: { squadId: string };
  [ALifeEvents.SQUAD_COMMAND_ISSUED]: { squadId: string; command: string };
  [ALifeEvents.SQUAD_GOAL_SET]: {
    squadId: string;
    goalType: string;
    terrainId: string | null;
    priority: number;
  };
  [ALifeEvents.SQUAD_GOAL_CLEARED]: {
    squadId: string;
    previousGoalType: string;
  };

  // Faction
  [ALifeEvents.FACTION_RELATION_CHANGED]: {
    factionId: string;
    targetFactionId: string;
    oldRelation: number;
    newRelation: number;
  };

  // Time
  [ALifeEvents.HOUR_CHANGED]: { hour: number; day: number; isDay: boolean };
  [ALifeEvents.DAY_NIGHT_CHANGED]: { isDay: boolean };

  // Social
  [ALifeEvents.NPC_SOCIAL_BUBBLE]: {
    npcId: string;
    text: string;
    category: string;
  };
  [ALifeEvents.NPC_MEET_PLAYER]: {
    npcId: string;
    factionId: string;
    greetingType: string;
  };
  [ALifeEvents.KAMP_STATE_CHANGED]: {
    terrainId: string;
    directorId: string | null;
    state: string;
  };

  // Monster
  [ALifeEvents.MONSTER_MELEE_HIT]: {
    attackerId: string;
    position: Vec2;
    damage: number;
    range: number;
  };
  [ALifeEvents.PSI_ATTACK_START]: { npcId: string; position: Vec2 };
}
