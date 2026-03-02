// adapters/PhaserEntityFactory.ts
// Abstract IEntityFactory base — host subclasses with game-specific sprite creation.

import type { IEntityFactory, INPCSpawnRequest, IMonsterSpawnRequest } from '@alife-sdk/core';

/**
 * Callback-based IEntityFactory implementation.
 *
 * Entity creation is highly game-specific (texture keys, animations,
 * component setup), so this adapter delegates to user-provided callbacks.
 *
 * @example
 * ```ts
 * const factory = new PhaserEntityFactory({
 *   createNPC: (req) => {
 *     const sprite = scene.physics.add.sprite(req.x, req.y, 'npc');
 *     return sprite.name = `npc_${req.npcTypeId}_${Date.now()}`;
 *   },
 *   createMonster: (req) => {
 *     const sprite = scene.physics.add.sprite(req.x, req.y, req.monsterTypeId);
 *     return sprite.name = `monster_${req.monsterTypeId}_${Date.now()}`;
 *   },
 *   destroyEntity: (id) => {
 *     const sprite = adapter.getSprite(id);
 *     sprite?.destroy();
 *     adapter.unregister(id);
 *   },
 * });
 * ```
 */
export class PhaserEntityFactory implements IEntityFactory {
  private readonly onCreateNPC: (request: INPCSpawnRequest) => string;
  private readonly onCreateMonster: (request: IMonsterSpawnRequest) => string;
  private readonly onDestroyEntity: (entityId: string) => void;

  constructor(handlers: {
    createNPC: (request: INPCSpawnRequest) => string;
    createMonster: (request: IMonsterSpawnRequest) => string;
    destroyEntity: (entityId: string) => void;
  }) {
    this.onCreateNPC = handlers.createNPC;
    this.onCreateMonster = handlers.createMonster;
    this.onDestroyEntity = handlers.destroyEntity;
  }

  createNPC(request: INPCSpawnRequest): string {
    return this.onCreateNPC(request);
  }

  createMonster(request: IMonsterSpawnRequest): string {
    return this.onCreateMonster(request);
  }

  destroyEntity(entityId: string): void {
    this.onDestroyEntity(entityId);
  }
}
