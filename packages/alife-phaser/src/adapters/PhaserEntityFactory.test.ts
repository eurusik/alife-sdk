import { describe, it, expect } from 'vitest';
import { PhaserEntityFactory } from './PhaserEntityFactory';

describe('PhaserEntityFactory', () => {
  it('delegates createNPC to handler', () => {
    const calls: unknown[] = [];
    const factory = new PhaserEntityFactory({
      createNPC: (req) => { calls.push(req); return 'npc_42'; },
      createMonster: () => 'mon',
      destroyEntity: () => {},
    });

    const result = factory.createNPC({
      npcTypeId: 'stalker',
      factionId: 'loners',
      x: 100,
      y: 200,
      rank: 2,
    });

    expect(result).toBe('npc_42');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ npcTypeId: 'stalker', x: 100, y: 200 });
  });

  it('delegates createMonster to handler', () => {
    const factory = new PhaserEntityFactory({
      createNPC: () => 'npc',
      createMonster: (req) => `monster_${req.monsterTypeId}`,
      destroyEntity: () => {},
    });

    const result = factory.createMonster({
      monsterTypeId: 'dog',
      x: 50,
      y: 60,
      rank: 1,
    });

    expect(result).toBe('monster_dog');
  });

  it('delegates destroyEntity to handler', () => {
    const destroyed: string[] = [];
    const factory = new PhaserEntityFactory({
      createNPC: () => 'npc',
      createMonster: () => 'mon',
      destroyEntity: (id) => destroyed.push(id),
    });

    factory.destroyEntity('entity_1');
    factory.destroyEntity('entity_2');

    expect(destroyed).toEqual(['entity_1', 'entity_2']);
  });
});
