import { createDamageInstance } from './DamageInstance';

describe('DamageInstance', () => {
  // ---------------------------------------------------------------------------
  // createDamageInstance — valid
  // ---------------------------------------------------------------------------
  describe('createDamageInstance valid', () => {
    it('creates a damage instance with all fields', () => {
      const damage = createDamageInstance({ amount: 50, damageTypeId: 'fire', sourceId: 'npc_01', sourceType: 'entity' });

      expect(damage.amount).toBe(50);
      expect(damage.damageTypeId).toBe('fire');
      expect(damage.sourceId).toBe('npc_01');
      expect(damage.sourceType).toBe('entity');
    });

    it('accepts anomaly sourceType', () => {
      const damage = createDamageInstance({ amount: 10, damageTypeId: 'radiation', sourceId: 'anomaly_01', sourceType: 'anomaly' });
      expect(damage.sourceType).toBe('anomaly');
    });

    it('accepts surge sourceType', () => {
      const damage = createDamageInstance({ amount: 100, damageTypeId: 'psi', sourceId: 'surge_01', sourceType: 'surge' });
      expect(damage.sourceType).toBe('surge');
    });

    it('accepts very small positive amounts', () => {
      const damage = createDamageInstance({ amount: 0.001, damageTypeId: 'chemical', sourceId: 'src', sourceType: 'anomaly' });
      expect(damage.amount).toBe(0.001);
    });

    it('accepts large amounts', () => {
      const damage = createDamageInstance({ amount: 99999, damageTypeId: 'physical', sourceId: 'src', sourceType: 'entity' });
      expect(damage.amount).toBe(99999);
    });

    it('returns a readonly-shaped object with correct fields', () => {
      const damage = createDamageInstance({ amount: 25, damageTypeId: 'fire', sourceId: 'src', sourceType: 'entity' });

      expect(damage).toHaveProperty('amount');
      expect(damage).toHaveProperty('damageTypeId');
      expect(damage).toHaveProperty('sourceId');
      expect(damage).toHaveProperty('sourceType');
    });
  });

  // ---------------------------------------------------------------------------
  // Throws on amount <= 0
  // ---------------------------------------------------------------------------
  describe('throws on invalid amount', () => {
    it('throws on amount = 0', () => {
      expect(() => createDamageInstance({ amount: 0, damageTypeId: 'fire', sourceId: 'src', sourceType: 'entity' })).toThrow(
        '[DamageInstance] amount must be positive, got 0',
      );
    });

    it('throws on negative amount', () => {
      expect(() => createDamageInstance({ amount: -10, damageTypeId: 'fire', sourceId: 'src', sourceType: 'entity' })).toThrow(
        '[DamageInstance] amount must be positive, got -10',
      );
    });

    it('throws on large negative amount', () => {
      expect(() => createDamageInstance({ amount: -1000, damageTypeId: 'psi', sourceId: 'src', sourceType: 'surge' })).toThrow(
        '[DamageInstance] amount must be positive',
      );
    });
  });
});
