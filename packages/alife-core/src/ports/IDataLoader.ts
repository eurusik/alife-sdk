/**
 * Async-capable loader that supplies game data to the kernel at boot time.
 *
 * Each method may return data synchronously (from an in-memory object)
 * or as a Promise (from a network/file request). The kernel awaits all
 * results before populating registries.
 *
 * Returned objects are keyed by ID string. Each value should conform to
 * the matching registry definition interface — see the `registry/` module.
 */

import type { IFactionDefinition } from '../registry/FactionRegistry';
import type { INPCTypeDefinition } from '../registry/NPCTypeRegistry';
import type { IMonsterDefinition } from '../registry/MonsterRegistry';
import type { ISmartTerrainConfig } from '../terrain/SmartTerrain';
import type { IAnomalyTypeDefinition } from '../registry/AnomalyTypeRegistry';

/** Map of factionId → IFactionDefinition. */
export type IFactionDataFile = Record<string, IFactionDefinition>;

/** Map of npcTypeId → INPCTypeDefinition. */
export type INPCTypeDataFile = Record<string, INPCTypeDefinition>;

/** Map of monsterTypeId → IMonsterDefinition. */
export type IMonsterDataFile = Record<string, IMonsterDefinition>;

/** Map of terrainId → ISmartTerrainConfig. */
export type ITerrainDataFile = Record<string, ISmartTerrainConfig>;

/** Map of anomalyTypeId → IAnomalyTypeDefinition. */
export type IAnomalyDataFile = Record<string, IAnomalyTypeDefinition>;

export interface IDataLoader {
  /** Load faction definitions. Keys = faction IDs, values = IFactionDefinition. */
  loadFactions(): IFactionDataFile | Promise<IFactionDataFile>;

  /** Load NPC type definitions. Keys = NPC type IDs, values = INPCTypeDefinition. */
  loadNPCTypes(): INPCTypeDataFile | Promise<INPCTypeDataFile>;

  /** Load monster definitions. Keys = monster type IDs, values = IMonsterDefinition. */
  loadMonsters(): IMonsterDataFile | Promise<IMonsterDataFile>;

  /** Load smart terrain configurations. Keys = terrain IDs, values = ISmartTerrainConfig. */
  loadTerrains(): ITerrainDataFile | Promise<ITerrainDataFile>;

  /** Load anomaly type definitions. Keys = anomaly type IDs, values = IAnomalyTypeDefinition. */
  loadAnomalies(): IAnomalyDataFile | Promise<IAnomalyDataFile>;
}
