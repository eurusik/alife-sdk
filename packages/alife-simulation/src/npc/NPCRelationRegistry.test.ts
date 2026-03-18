import {
  NPCRelationRegistry,
  createDefaultRelationConfig,
  type INPCRelationConfig,
} from './NPCRelationRegistry';

const defaultConfig = createDefaultRelationConfig();

/** Helper: create a registry with optional config overrides. */
function create(overrides: Partial<INPCRelationConfig> = {}): NPCRelationRegistry {
  return new NPCRelationRegistry({ ...defaultConfig, ...overrides });
}

describe('NPCRelationRegistry', () => {
  // -----------------------------------------------------------------------
  // Personal Goodwill
  // -----------------------------------------------------------------------

  it('returns 0 for unknown NPCs', () => {
    const reg = create();
    expect(reg.getPersonalGoodwill('npc_a', 'npc_b')).toBe(0);
  });

  it('adjustGoodwill adds delta', () => {
    const reg = create();
    reg.adjustGoodwill('npc_a', 'npc_b', 10);
    expect(reg.getPersonalGoodwill('npc_a', 'npc_b')).toBe(10);
  });

  it('adjustGoodwill clamps to bounds', () => {
    const reg = create();
    reg.adjustGoodwill('npc_a', 'npc_b', 200);
    expect(reg.getPersonalGoodwill('npc_a', 'npc_b')).toBe(100);

    reg.adjustGoodwill('npc_c', 'npc_d', -200);
    expect(reg.getPersonalGoodwill('npc_c', 'npc_d')).toBe(-100);
  });

  it('adjustGoodwill removes entry at 0', () => {
    const reg = create();
    reg.adjustGoodwill('npc_a', 'npc_b', 10);
    reg.adjustGoodwill('npc_a', 'npc_b', -10);

    expect(reg.getPersonalGoodwill('npc_a', 'npc_b')).toBe(0);
    // Verify entry is physically removed: serialize should produce nothing.
    expect(reg.serialize()).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // getAttitude
  // -----------------------------------------------------------------------

  it('getAttitude combines faction + personal', () => {
    const reg = create();
    reg.adjustGoodwill('npc_a', 'npc_b', -30);

    const attitude = reg.getAttitude('npc_a', 'npc_b', 50);
    expect(attitude).toBe(20);
  });

  it('getAttitude clamps combined value', () => {
    const reg = create();
    reg.adjustGoodwill('npc_a', 'npc_b', 50);

    const attitude = reg.getAttitude('npc_a', 'npc_b', 90);
    expect(attitude).toBe(100);
  });

  // -----------------------------------------------------------------------
  // Fight Registry
  // -----------------------------------------------------------------------

  it('registerFight creates record', () => {
    const reg = create();
    reg.registerFight('attacker', 'defender', 25);

    expect(reg.isInFight('attacker')).toBe(true);
    expect(reg.isInFight('defender')).toBe(true);
    expect(reg.isInFight('bystander')).toBe(false);
  });

  it('registerFight accumulates damage', () => {
    const reg = create();
    reg.registerFight('attacker', 'defender', 10);
    reg.registerFight('attacker', 'defender', 15);

    // Verify the fight still exists (damage accumulated internally).
    expect(reg.isInFight('attacker')).toBe(true);
    expect(reg.getDefender('attacker')).toBe('defender');
  });

  it('updateFights purges expired', () => {
    const reg = create({ fightRememberTimeMs: 1000 });
    reg.registerFight('attacker', 'defender', 10);

    // Advance just under the threshold -- fight should remain.
    reg.updateFights(999);
    expect(reg.isInFight('attacker')).toBe(true);

    // Advance past threshold -- fight should be purged.
    reg.updateFights(2);
    expect(reg.isInFight('attacker')).toBe(false);
  });

  it('getDefender returns defender id', () => {
    const reg = create();
    reg.registerFight('npc_a', 'npc_b', 10);

    expect(reg.getDefender('npc_a')).toBe('npc_b');
    expect(reg.getDefender('npc_b')).toBeNull();
    expect(reg.getDefender('npc_c')).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Action: onNPCKilled
  // -----------------------------------------------------------------------

  it('onNPCKilled -- witness same faction as victim', () => {
    const reg = create();
    const witnessFactions = new Map([['witness_1', 'loner']]);

    reg.onNPCKilled('killer', 'victim', 'loner', ['witness_1'], witnessFactions);

    // Witness is same faction as victim -> killAllyDelta (-30)
    expect(reg.getPersonalGoodwill('witness_1', 'killer')).toBe(-30);
  });

  it('onNPCKilled -- victim was attacking witness', () => {
    const reg = create();

    // Set up: victim was attacking the witness.
    reg.registerFight('victim', 'witness_1', 20);

    const witnessFactions = new Map([['witness_1', 'duty']]);
    reg.onNPCKilled('killer', 'victim', 'bandit', ['witness_1'], witnessFactions);

    // Killer saved witness -> killEnemyDelta (+15)
    expect(reg.getPersonalGoodwill('witness_1', 'killer')).toBe(15);
  });

  it('onNPCKilled -- neutral kill', () => {
    const reg = create();
    const witnessFactions = new Map([['witness_1', 'freedom']]);

    // Witness faction != victim faction, no active fight.
    reg.onNPCKilled('killer', 'victim', 'bandit', ['witness_1'], witnessFactions);

    // Neutral kill -> killNeutralDelta (-5)
    expect(reg.getPersonalGoodwill('witness_1', 'killer')).toBe(-5);
  });

  it('onNPCKilled cleans up victim fights', () => {
    const reg = create();
    reg.registerFight('victim', 'some_npc', 30);
    reg.registerFight('other_npc', 'victim', 15);

    expect(reg.isInFight('victim')).toBe(true);

    const witnessFactions = new Map<string, string>();
    reg.onNPCKilled('killer', 'victim', 'bandit', [], witnessFactions);

    expect(reg.isInFight('victim')).toBe(false);
  });

  it('onNPCKilled skips killer and victim as witnesses', () => {
    const reg = create();
    const witnessFactions = new Map([
      ['killer', 'loner'],
      ['victim', 'loner'],
    ]);

    reg.onNPCKilled('killer', 'victim', 'loner', ['killer', 'victim'], witnessFactions);

    // Neither should have goodwill entries toward themselves or each other
    // as a result of being a "witness".
    expect(reg.getPersonalGoodwill('killer', 'killer')).toBe(0);
    expect(reg.getPersonalGoodwill('victim', 'killer')).toBe(0);
  });

  it('onNPCKilled skips witnesses without faction data', () => {
    const reg = create();
    // witness_1 is NOT in the witnessFactions map.
    const witnessFactions = new Map<string, string>();

    reg.onNPCKilled('killer', 'victim', 'bandit', ['witness_1'], witnessFactions);

    expect(reg.getPersonalGoodwill('witness_1', 'killer')).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Action: onNPCAttacked
  // -----------------------------------------------------------------------

  it('onNPCAttacked registers fight + goodwill penalty', () => {
    const reg = create();
    reg.onNPCAttacked('attacker', 'target', 25);

    expect(reg.isInFight('attacker')).toBe(true);
    expect(reg.getDefender('attacker')).toBe('target');
    // attackHitDelta = -5
    expect(reg.getPersonalGoodwill('target', 'attacker')).toBe(-5);
  });

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  it('removeNPC clears all data', () => {
    const reg = create();

    // Relations involving npc_a.
    reg.adjustGoodwill('npc_a', 'npc_b', 20);
    reg.adjustGoodwill('npc_c', 'npc_a', -10);
    reg.adjustGoodwill('npc_b', 'npc_c', 50); // unrelated

    // Fights involving npc_a.
    reg.registerFight('npc_a', 'npc_d', 10);
    reg.registerFight('npc_e', 'npc_a', 5);

    reg.removeNPC('npc_a');

    expect(reg.getPersonalGoodwill('npc_a', 'npc_b')).toBe(0);
    expect(reg.getPersonalGoodwill('npc_c', 'npc_a')).toBe(0);
    expect(reg.isInFight('npc_a')).toBe(false);

    // Unrelated data should remain.
    expect(reg.getPersonalGoodwill('npc_b', 'npc_c')).toBe(50);
  });

  // -----------------------------------------------------------------------
  // Persistence
  // -----------------------------------------------------------------------

  it('serialize round-trip', () => {
    const reg = create();
    reg.adjustGoodwill('npc_a', 'npc_b', 42);
    reg.adjustGoodwill('npc_c', 'npc_d', -17);

    const snapshot = reg.serialize();
    expect(snapshot).toHaveLength(2);

    const reg2 = create();
    reg2.restore(snapshot);

    expect(reg2.getPersonalGoodwill('npc_a', 'npc_b')).toBe(42);
    expect(reg2.getPersonalGoodwill('npc_c', 'npc_d')).toBe(-17);
  });

  it('serialize skips zero entries', () => {
    const reg = create();
    reg.adjustGoodwill('npc_a', 'npc_b', 10);
    reg.adjustGoodwill('npc_a', 'npc_b', -10); // back to 0, removed from map

    const snapshot = reg.serialize();
    expect(snapshot).toHaveLength(0);
  });

  it('deserialize clamps out-of-range values', () => {
    const reg = create();
    reg.restore([{ fromId: 'a', toId: 'b', goodwill: 999 }]);

    expect(reg.getPersonalGoodwill('a', 'b')).toBe(100);
  });

  it('deserialize discards zero-valued entries', () => {
    const reg = create();
    reg.restore([{ fromId: 'a', toId: 'b', goodwill: 0 }]);

    expect(reg.serialize()).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Safe split: indexOf + slice (survives arrow character in IDs)
  // -----------------------------------------------------------------------

  describe('serialize / restore round-trip with special IDs', () => {
    it('normal IDs serialize and restore correctly', () => {
      const reg = create();
      reg.adjustGoodwill('npc_alpha', 'npc_beta', 25);

      const snapshot = reg.serialize();
      expect(snapshot).toHaveLength(1);
      expect(snapshot[0]).toMatchObject({ fromId: 'npc_alpha', toId: 'npc_beta', goodwill: 25 });

      const reg2 = create();
      reg2.restore(snapshot);
      expect(reg2.getPersonalGoodwill('npc_alpha', 'npc_beta')).toBe(25);
    });

    it('arrow character in toId survives a full round-trip (indexOf+slice fix)', () => {
      // The key separator is the Unicode arrow '\u2192' (→).
      // Using indexOf+slice (instead of split) means only the FIRST arrow is
      // treated as the separator, so the remainder — including any further
      // arrows — is preserved intact as the toId.
      // Composite key: 'npc_a→npc_→_target'  indexOf finds pos 5 → correct split.
      const arrowId = 'npc_\u2192_target'; // toId contains the separator char
      const reg = create();
      reg.adjustGoodwill('npc_a', arrowId, 42);

      const snapshot = reg.serialize();
      expect(snapshot).toHaveLength(1);
      expect(snapshot[0].fromId).toBe('npc_a');
      expect(snapshot[0].toId).toBe(arrowId);
      expect(snapshot[0].goodwill).toBe(42);

      const reg2 = create();
      reg2.restore(snapshot);
      expect(reg2.getPersonalGoodwill('npc_a', arrowId)).toBe(42);
      // The reverse pair must remain at 0.
      expect(reg2.getPersonalGoodwill(arrowId, 'npc_a')).toBe(0);
    });

    it('multiple arrow characters in toId all survive round-trip', () => {
      // Verifies that slice(sep + ARROW.length) captures ALL remaining content,
      // even when toId contains more than one arrow character.
      const multiArrowId = 'zone_\u2192_a_\u2192_b'; // two arrows in toId
      const reg = create();
      reg.adjustGoodwill('npc_x', multiArrowId, -15);

      const snapshot = reg.serialize();
      expect(snapshot[0]).toMatchObject({ fromId: 'npc_x', toId: multiArrowId, goodwill: -15 });

      const reg2 = create();
      reg2.restore(snapshot);
      expect(reg2.getPersonalGoodwill('npc_x', multiArrowId)).toBe(-15);
    });
  });

  // -----------------------------------------------------------------------
  // Reset
  // -----------------------------------------------------------------------

  it('reset clears all state', () => {
    const reg = create();
    reg.adjustGoodwill('npc_a', 'npc_b', 20);
    reg.registerFight('npc_a', 'npc_b', 10);

    reg.reset();

    expect(reg.getPersonalGoodwill('npc_a', 'npc_b')).toBe(0);
    expect(reg.isInFight('npc_a')).toBe(false);
    expect(reg.serialize()).toHaveLength(0);
  });
});
