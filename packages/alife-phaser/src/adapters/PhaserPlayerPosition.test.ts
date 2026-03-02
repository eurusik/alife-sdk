import { describe, it, expect } from 'vitest';
import { PhaserPlayerPosition } from './PhaserPlayerPosition';

describe('PhaserPlayerPosition', () => {
  it('returns position from source', () => {
    const provider = new PhaserPlayerPosition({ x: 100, y: 200 });
    const pos = provider.getPlayerPosition();

    expect(pos).toEqual({ x: 100, y: 200 });
  });

  it('reads live values from source', () => {
    const source = { x: 10, y: 20 };
    const provider = new PhaserPlayerPosition(source);

    expect(provider.getPlayerPosition()).toEqual({ x: 10, y: 20 });

    source.x = 30;
    source.y = 40;
    expect(provider.getPlayerPosition()).toEqual({ x: 30, y: 40 });
  });

  it('setSource replaces the position source', () => {
    const provider = new PhaserPlayerPosition({ x: 1, y: 2 });
    expect(provider.getPlayerPosition()).toEqual({ x: 1, y: 2 });

    provider.setSource({ x: 10, y: 20 });
    expect(provider.getPlayerPosition()).toEqual({ x: 10, y: 20 });
  });

  it('works with getter-based sources', () => {
    let px = 100;
    let py = 200;
    const source = {
      get x() { return px; },
      get y() { return py; },
    };

    const provider = new PhaserPlayerPosition(source);
    expect(provider.getPlayerPosition()).toEqual({ x: 100, y: 200 });

    px = 300;
    py = 400;
    expect(provider.getPlayerPosition()).toEqual({ x: 300, y: 400 });
  });
});
