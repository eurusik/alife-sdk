// types/IEconomyTypes.ts
// Value objects for the economy system.

/**
 * A tradeable item definition from the game's item catalogue.
 */
export interface IItemDefinition {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly basePrice: number;
  readonly category: string;
  readonly weight: number;
  readonly maxStack: number;
}

/**
 * A single inventory slot — an item plus its current quantity.
 */
export interface IInventorySlot {
  readonly itemId: string;
  quantity: number;
  readonly maxStack: number;
}

/**
 * Trader stock entry.
 */
export interface ITraderStockEntry {
  readonly itemId: string;
  quantity: number;
}

/**
 * Quest status lifecycle.
 */
export const QuestStatus = {
  AVAILABLE: 'available',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export type QuestStatus = (typeof QuestStatus)[keyof typeof QuestStatus];

/**
 * Quest objective types.
 */
export const ObjectiveType = {
  REACH_ZONE: 'reach_zone',
  KILL: 'kill',
} as const;

export type ObjectiveType = (typeof ObjectiveType)[keyof typeof ObjectiveType];

/**
 * A single quest objective.
 */
export interface IQuestObjective {
  readonly id: string;
  readonly type: ObjectiveType | (string & {});
  readonly target: string;
  readonly description: string;
  readonly count: number;
  current: number;
  completed: boolean;
}

/**
 * Declarative terrain effect triggered by quest state changes.
 */
export interface ITerrainEffect {
  readonly terrainId: string;
  readonly action: 'lock' | 'unlock';
  readonly trigger: 'on_start' | 'on_complete' | 'on_fail';
}

/**
 * A quest definition.
 */
export interface IQuestDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly objectives: readonly IQuestObjective[];
  readonly terrainEffects?: readonly ITerrainEffect[];
  /** Quest IDs that must be COMPLETED before this quest can be started. */
  readonly requires?: readonly string[];
}

/**
 * Runtime quest state.
 */
export interface IQuestState {
  readonly id: string;
  status: QuestStatus;
  objectives: IQuestObjective[];
}
