import { StoryRegistry } from './StoryRegistry';

describe('StoryRegistry', () => {
  // -----------------------------------------------------------------------
  // Basic registration
  // -----------------------------------------------------------------------
  it('registers and looks up in both directions', () => {
    const reg = new StoryRegistry();
    reg.register('sid_wolf', 'npc_42');

    expect(reg.getNpcId('sid_wolf')).toBe('npc_42');
    expect(reg.getStoryId('npc_42')).toBe('sid_wolf');
    expect(reg.size).toBe(1);
  });

  it('reports isStoryNPC correctly', () => {
    const reg = new StoryRegistry();
    reg.register('sid_barman', 'npc_7');

    expect(reg.isStoryNPC('npc_7')).toBe(true);
    expect(reg.isStoryNPC('npc_999')).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Unregister
  // -----------------------------------------------------------------------
  it('unregister by storyId clears both maps', () => {
    const reg = new StoryRegistry();
    reg.register('sid_wolf', 'npc_42');
    reg.unregister('sid_wolf');

    expect(reg.getNpcId('sid_wolf')).toBeUndefined();
    expect(reg.getStoryId('npc_42')).toBeUndefined();
    expect(reg.isStoryNPC('npc_42')).toBe(false);
    expect(reg.size).toBe(0);
  });

  it('removeByNpcId clears both maps', () => {
    const reg = new StoryRegistry();
    reg.register('sid_wolf', 'npc_42');
    reg.removeByNpcId('npc_42');

    expect(reg.getNpcId('sid_wolf')).toBeUndefined();
    expect(reg.getStoryId('npc_42')).toBeUndefined();
    expect(reg.size).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Duplicate overwrite
  // -----------------------------------------------------------------------
  it('duplicate storyId overwrites previous NPC mapping', () => {
    const reg = new StoryRegistry();
    reg.register('sid_wolf', 'npc_1');
    reg.register('sid_wolf', 'npc_2');

    expect(reg.getNpcId('sid_wolf')).toBe('npc_2');
    expect(reg.getStoryId('npc_2')).toBe('sid_wolf');
    expect(reg.getStoryId('npc_1')).toBeUndefined();
    expect(reg.size).toBe(1);
  });

  it('duplicate npcId overwrites previous story mapping', () => {
    const reg = new StoryRegistry();
    reg.register('story_a', 'npc_1');
    reg.register('story_b', 'npc_1');

    expect(reg.getNpcId('story_b')).toBe('npc_1');
    expect(reg.getStoryId('npc_1')).toBe('story_b');
    expect(reg.getNpcId('story_a')).toBeUndefined();
    expect(reg.size).toBe(1);
  });

  // -----------------------------------------------------------------------
  // Serialize / Restore
  // -----------------------------------------------------------------------
  it('serialize and restore round-trips faithfully', () => {
    const reg = new StoryRegistry();
    reg.register('sid_wolf', 'npc_42');
    reg.register('sid_barman', 'npc_7');

    const snapshot = reg.serialize();
    expect(snapshot).toHaveLength(2);

    const reg2 = new StoryRegistry();
    reg2.restore(snapshot);

    expect(reg2.getNpcId('sid_wolf')).toBe('npc_42');
    expect(reg2.getNpcId('sid_barman')).toBe('npc_7');
    expect(reg2.size).toBe(2);
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  it('unregister of non-existent storyId is a no-op', () => {
    const reg = new StoryRegistry();
    reg.unregister('ghost');
    expect(reg.size).toBe(0);
  });

  it('removeByNpcId of non-existent npcId is a no-op', () => {
    const reg = new StoryRegistry();
    reg.removeByNpcId('ghost');
    expect(reg.size).toBe(0);
  });

  it('clear removes all entries', () => {
    const reg = new StoryRegistry();
    reg.register('a', 'npc_1');
    reg.register('b', 'npc_2');
    reg.clear();
    expect(reg.size).toBe(0);
  });
});
