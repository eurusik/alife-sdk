import { Schedule, type IWaypoint } from './Schedule';

const wp = (zoneId: string, x: number, y: number, ms = 5000): IWaypoint => ({
  zoneId,
  position: { x, y },
  durationMs: ms,
});

describe('Schedule', () => {
  it('starts at waypoint 0', () => {
    const s = new Schedule([wp('z1', 0, 0), wp('z2', 10, 10)]);
    expect(s.index).toBe(0);
    expect(s.getCurrentWaypoint().zoneId).toBe('z1');
  });

  it('advances through waypoints sequentially', () => {
    const s = new Schedule([wp('z1', 0, 0), wp('z2', 10, 10), wp('z3', 20, 20)]);

    s.advance();
    expect(s.index).toBe(1);
    expect(s.getCurrentWaypoint().zoneId).toBe('z2');

    s.advance();
    expect(s.index).toBe(2);
    expect(s.getCurrentWaypoint().zoneId).toBe('z3');
  });

  it('wraps around at the end', () => {
    const s = new Schedule([wp('z1', 0, 0), wp('z2', 10, 10)]);
    s.advance();
    s.advance();
    expect(s.index).toBe(0);
    expect(s.getCurrentWaypoint().zoneId).toBe('z1');
  });

  it('single waypoint wraps to itself', () => {
    const s = new Schedule([wp('solo', 5, 5)]);
    expect(s.index).toBe(0);
    s.advance();
    expect(s.index).toBe(0);
    expect(s.getCurrentWaypoint().zoneId).toBe('solo');
  });

  it('reset returns to index 0', () => {
    const s = new Schedule([wp('z1', 0, 0), wp('z2', 10, 10), wp('z3', 20, 20)]);
    s.advance();
    s.advance();
    s.reset();
    expect(s.index).toBe(0);
    expect(s.getCurrentWaypoint().zoneId).toBe('z1');
  });

  it('reports correct length', () => {
    const s = new Schedule([wp('a', 0, 0), wp('b', 1, 1), wp('c', 2, 2)]);
    expect(s.length).toBe(3);
  });

  it('throws on empty waypoints', () => {
    expect(() => new Schedule([])).toThrow('at least one waypoint');
  });

  it('does not expose mutable waypoints array', () => {
    const original = [wp('z1', 0, 0)];
    const s = new Schedule(original);
    original.push(wp('z2', 10, 10));
    expect(s.length).toBe(1);
  });
});
