import { describe, it, expect } from 'vitest';
import { SimulationPorts } from './SimulationPorts';
import { createNoOpBridge } from './ISimulationBridge';

describe('SimulationPorts', () => {
  it('exports SimulationBridge token', () => {
    expect(SimulationPorts.SimulationBridge).toBeDefined();
    expect(SimulationPorts.SimulationBridge.id).toBe('simulationBridge');
    expect(typeof SimulationPorts.SimulationBridge.description).toBe('string');
  });

  it('has exactly 1 port token', () => {
    expect(Object.keys(SimulationPorts)).toHaveLength(1);
  });
});

describe('createNoOpBridge', () => {
  it('isAlive always returns true regardless of entityId', () => {
    const bridge = createNoOpBridge();
    expect(bridge.isAlive('npc_001')).toBe(true);
    expect(bridge.isAlive('unknown_entity')).toBe(true);
  });

  it('applyDamage always returns false (entity never dies)', () => {
    const bridge = createNoOpBridge();
    expect(bridge.applyDamage('npc_001', 9999, 'PHYSICAL')).toBe(false);
    expect(bridge.applyDamage('npc_002', 0, 'PSI')).toBe(false);
  });

  it('getEffectiveDamage always returns 0 (no damage computation)', () => {
    const bridge = createNoOpBridge();
    expect(bridge.getEffectiveDamage('npc_001', 100, 'FIRE')).toBe(0);
    expect(bridge.getEffectiveDamage('npc_002', 50, 'RADIATION')).toBe(0);
  });

  it('adjustMorale does nothing and does not throw', () => {
    const bridge = createNoOpBridge();
    expect(() => bridge.adjustMorale('npc_001', -0.25, 'hit')).not.toThrow();
    expect(() => bridge.adjustMorale('npc_002', 0.2, 'kill')).not.toThrow();
  });

  it('each call returns a fresh independent bridge instance', () => {
    const a = createNoOpBridge();
    const b = createNoOpBridge();
    expect(a).not.toBe(b);
  });
});
