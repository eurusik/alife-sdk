/**
 * Parameters for creating a humanoid NPC entity in the host game engine.
 * Passed to {@link IEntityFactory.createNPC}.
 */
export interface INPCSpawnRequest {
  /** ID registered in NPCTypeRegistry. */
  readonly npcTypeId: string;
  /** Faction this NPC belongs to. Must be registered in FactionRegistry. */
  readonly factionId: string;
  /** Spawn X world coordinate (px). */
  readonly x: number;
  /** Spawn Y world coordinate (px). */
  readonly y: number;
  /** NPC power tier (1–5). Affects equipment and behavior. */
  readonly rank: number;
  /** Squad this NPC should join, if any. */
  readonly squadId?: string;
  /** Arbitrary data forwarded to the host engine (e.g. story flags). */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Parameters for creating a monster entity in the host game engine.
 * Passed to {@link IEntityFactory.createMonster}.
 */
export interface IMonsterSpawnRequest {
  /** ID registered in MonsterRegistry. */
  readonly monsterTypeId: string;
  /** Spawn X world coordinate (px). */
  readonly x: number;
  /** Spawn Y world coordinate (px). */
  readonly y: number;
  /** SmartTerrain that serves as this monster's home lair. */
  readonly lairTerrainId?: string;
  /** Index within the pack (0 = leader). */
  readonly packIndex?: number;
  /** Arbitrary data forwarded to the host engine. */
  readonly metadata?: Record<string, unknown>;
}

/**
 * Factory the A-Life kernel calls to create and destroy game entities.
 *
 * Implement this to bridge spawn/despawn requests to your engine's
 * object creation system (e.g. Phaser's GameObjectFactory).
 */
export interface IEntityFactory {
  /** Create a humanoid NPC. Must return a unique entity ID string. */
  createNPC(request: INPCSpawnRequest): string;

  /** Create a monster entity. Must return a unique entity ID string. */
  createMonster(request: IMonsterSpawnRequest): string;

  /** Remove the entity from the game world and release its resources. */
  destroyEntity(entityId: string): void;
}

let _noOpFactoryId = 0;

/**
 * Create a no-op {@link IEntityFactory} that returns deterministic stub IDs.
 *
 * Safe defaults:
 * - `createNPC` returns `"noop-npc-<n>"` — unique per call, never null.
 * - `createMonster` returns `"noop-monster-<n>"` — unique per call.
 * - `destroyEntity` is a no-op.
 *
 * @example
 * // Unit-testing kernel logic without a full game engine:
 * kernel.provide(Ports.EntityFactory, createNoOpEntityFactory());
 */
export function createNoOpEntityFactory(): IEntityFactory {
  return {
    createNPC: () => `noop-npc-${++_noOpFactoryId}`,
    createMonster: () => `noop-monster-${++_noOpFactoryId}`,
    destroyEntity: () => {},
  };
}
