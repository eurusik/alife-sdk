import { Ports, REQUIRED_PORTS } from './PortTokens';

describe('PortTokens', () => {
  it('defines EntityAdapter token', () => {
    expect(Ports.EntityAdapter.id).toBe('entityAdapter');
    expect(Ports.EntityAdapter.description).toBeTruthy();
  });

  it('defines PlayerPosition token', () => {
    expect(Ports.PlayerPosition.id).toBe('playerPosition');
  });

  it('defines EntityFactory token', () => {
    expect(Ports.EntityFactory.id).toBe('entityFactory');
  });

  it('defines Random token', () => {
    expect(Ports.Random.id).toBe('random');
  });

  it('defines RuntimeClock token', () => {
    expect(Ports.RuntimeClock.id).toBe('runtimeClock');
  });

  it('REQUIRED_PORTS is empty — kernel auto-provides EntityAdapter / PlayerPosition / EntityFactory', () => {
    expect(REQUIRED_PORTS).toHaveLength(0);
  });

  it('each token has a unique id', () => {
    const ids = Object.values(Ports).map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
