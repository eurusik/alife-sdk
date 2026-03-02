import { describe, it, expect, beforeEach } from 'vitest';
import { PhaserSimulationBridge } from './PhaserSimulationBridge';
import type { IHPRecord } from './PhaserSimulationBridge';

function makeHP(current: number, max = 100): IHPRecord {
  return { currentHp: current, maxHp: max };
}

describe('PhaserSimulationBridge', () => {
  let bridge: PhaserSimulationBridge;

  beforeEach(() => {
    bridge = new PhaserSimulationBridge();
  });

  describe('registry', () => {
    it('registers and checks records', () => {
      bridge.register('npc_1', makeHP(100));
      expect(bridge.has('npc_1')).toBe(true);
      expect(bridge.size).toBe(1);
    });

    it('unregisters records', () => {
      bridge.register('npc_1', makeHP(100));
      bridge.unregister('npc_1');
      expect(bridge.has('npc_1')).toBe(false);
      expect(bridge.size).toBe(0);
    });
  });

  describe('isAlive', () => {
    it('returns true for entity with HP > 0', () => {
      bridge.register('npc_1', makeHP(50));
      expect(bridge.isAlive('npc_1')).toBe(true);
    });

    it('returns false for entity with HP = 0', () => {
      bridge.register('npc_1', makeHP(0));
      expect(bridge.isAlive('npc_1')).toBe(false);
    });

    it('returns false for unknown entity', () => {
      expect(bridge.isAlive('unknown')).toBe(false);
    });
  });

  describe('applyDamage', () => {
    it('reduces HP and returns false if alive', () => {
      bridge.register('npc_1', makeHP(100));
      const died = bridge.applyDamage('npc_1', 30, 'physical');
      expect(died).toBe(false);
      expect(bridge.isAlive('npc_1')).toBe(true);
    });

    it('returns true when entity dies', () => {
      bridge.register('npc_1', makeHP(50));
      const died = bridge.applyDamage('npc_1', 60, 'physical');
      expect(died).toBe(true);
      expect(bridge.isAlive('npc_1')).toBe(false);
    });

    it('clamps HP to 0 (no negative HP)', () => {
      const record = makeHP(10);
      bridge.register('npc_1', record);
      bridge.applyDamage('npc_1', 100, 'physical');
      expect(record.currentHp).toBe(0);
    });

    it('returns true for unknown entity', () => {
      expect(bridge.applyDamage('unknown', 10, 'physical')).toBe(true);
    });
  });

  describe('getEffectiveDamage without immunity', () => {
    it('returns raw damage when no immunity lookup', () => {
      expect(bridge.getEffectiveDamage('npc_1', 50, 'physical')).toBe(50);
    });
  });

  describe('getEffectiveDamage with immunity', () => {
    beforeEach(() => {
      bridge.setImmunityLookup((_entityId, damageType) => {
        if (damageType === 'radiation') return 0.5;
        if (damageType === 'psi') return 1.0;
        return 0;
      });
    });

    it('applies resistance factor', () => {
      expect(bridge.getEffectiveDamage('npc_1', 100, 'radiation')).toBe(50);
    });

    it('full immunity returns 0 damage', () => {
      expect(bridge.getEffectiveDamage('npc_1', 100, 'psi')).toBe(0);
    });

    it('no resistance returns full damage', () => {
      expect(bridge.getEffectiveDamage('npc_1', 100, 'physical')).toBe(100);
    });

    it('clamps resistance to [0, 1]', () => {
      bridge.setImmunityLookup(() => 1.5); // Over 1.0
      expect(bridge.getEffectiveDamage('npc_1', 100, 'any')).toBe(0);

      bridge.setImmunityLookup(() => -0.5); // Negative
      expect(bridge.getEffectiveDamage('npc_1', 100, 'any')).toBe(100);
    });
  });

  describe('applyDamage with immunity', () => {
    it('uses effective damage for HP reduction', () => {
      bridge.register('npc_1', makeHP(100));
      bridge.setImmunityLookup((_id, type) => type === 'radiation' ? 0.5 : 0);
      const died = bridge.applyDamage('npc_1', 60, 'radiation');
      // Effective = 60 * (1 - 0.5) = 30
      expect(died).toBe(false);
    });
  });

  describe('adjustMorale', () => {
    it('calls morale callback', () => {
      const calls: { id: string; delta: number; reason: string }[] = [];
      bridge.setMoraleCallback((id, delta, reason) => {
        calls.push({ id, delta, reason });
      });

      bridge.adjustMorale('npc_1', -0.15, 'hit');
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({ id: 'npc_1', delta: -0.15, reason: 'hit' });
    });

    it('does nothing without morale callback', () => {
      expect(() => bridge.adjustMorale('npc_1', -0.15, 'hit')).not.toThrow();
    });
  });
});
