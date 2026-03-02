import { describe, it, expect, beforeEach } from 'vitest';
import { PhaserEntityAdapter } from './PhaserEntityAdapter';
import type { IArcadeSprite, IArcadeBody } from '../types/IPhaserTypes';

function mockBody(): IArcadeBody {
  return { enable: true, velocity: { x: 0, y: 0 } };
}

function mockSprite(overrides?: Partial<IArcadeSprite>): IArcadeSprite {
  const body = mockBody();
  return {
    x: 0,
    y: 0,
    active: true,
    visible: true,
    body,
    name: 'test',
    rotation: 0,
    alpha: 1,
    setActive(v: boolean) { this.active = v; return this; },
    setVisible(v: boolean) { this.visible = v; return this; },
    setPosition(x: number, y?: number) { this.x = x; if (y !== undefined) this.y = y; return this; },
    setVelocity(vx: number, vy?: number) { body.velocity.x = vx; body.velocity.y = vy ?? 0; return this; },
    setAlpha(v: number) { this.alpha = v; return this; },
    setRotation(r: number) { this.rotation = r; return this; },
    destroy() {},
    ...overrides,
  };
}

describe('PhaserEntityAdapter', () => {
  let adapter: PhaserEntityAdapter;

  beforeEach(() => {
    adapter = new PhaserEntityAdapter();
  });

  describe('registry', () => {
    it('registers and retrieves sprites', () => {
      const sprite = mockSprite();
      adapter.register('npc_1', sprite);
      expect(adapter.has('npc_1')).toBe(true);
      expect(adapter.getSprite('npc_1')).toBe(sprite);
      expect(adapter.size).toBe(1);
    });

    it('unregisters sprites and cleans up all data', () => {
      const sprite = mockSprite();
      adapter.register('npc_1', sprite);
      adapter.setComponentData('npc_1', 'health', { hp: 100 });
      adapter.setMetadata('npc_1', 'faction', 'stalker');

      adapter.unregister('npc_1');
      expect(adapter.has('npc_1')).toBe(false);
      expect(adapter.size).toBe(0);
      expect(adapter.hasComponent('npc_1', 'health')).toBe(false);
      expect(adapter.getMetadata('npc_1', 'faction')).toBeUndefined();
    });

    it('setAlive controls isAlive result', () => {
      adapter.register('npc_1', mockSprite());
      expect(adapter.isAlive('npc_1')).toBe(true);

      adapter.setAlive('npc_1', false);
      expect(adapter.isAlive('npc_1')).toBe(false);
    });

    it('isAlive returns false for unregistered entity', () => {
      expect(adapter.isAlive('unknown')).toBe(false);
    });
  });

  describe('IEntityQuery', () => {
    it('getPosition returns sprite coordinates', () => {
      const sprite = mockSprite({ x: 150, y: 250 } as Partial<IArcadeSprite>);
      adapter.register('npc_1', sprite);
      expect(adapter.getPosition('npc_1')).toEqual({ x: 150, y: 250 });
    });

    it('getPosition returns null for unknown entity', () => {
      expect(adapter.getPosition('unknown')).toBeNull();
    });

    it('hasComponent + getComponentValue work together', () => {
      adapter.register('npc_1', mockSprite());
      expect(adapter.hasComponent('npc_1', 'health')).toBe(false);

      adapter.setComponentData('npc_1', 'health', { hp: 100, maxHp: 100 });
      expect(adapter.hasComponent('npc_1', 'health')).toBe(true);
      expect(adapter.getComponentValue<{ hp: number }>('npc_1', 'health')).toEqual({ hp: 100, maxHp: 100 });
    });

    it('getComponentValue returns null for missing', () => {
      adapter.register('npc_1', mockSprite());
      expect(adapter.getComponentValue('npc_1', 'missing')).toBeNull();
    });

    it('getMetadata returns undefined for missing', () => {
      expect(adapter.getMetadata('npc_1', 'key')).toBeUndefined();
    });
  });

  describe('IEntityMutation', () => {
    it('setPosition moves sprite', () => {
      const sprite = mockSprite();
      adapter.register('npc_1', sprite);
      adapter.setPosition('npc_1', { x: 300, y: 400 });
      expect(sprite.x).toBe(300);
      expect(sprite.y).toBe(400);
    });

    it('setActive/setVisible toggle sprite state', () => {
      const sprite = mockSprite();
      adapter.register('npc_1', sprite);

      adapter.setActive('npc_1', false);
      expect(sprite.active).toBe(false);

      adapter.setVisible('npc_1', false);
      expect(sprite.visible).toBe(false);
    });

    it('setVelocity/getVelocity work with body', () => {
      const sprite = mockSprite();
      adapter.register('npc_1', sprite);

      adapter.setVelocity('npc_1', { x: 100, y: -50 });
      const vel = adapter.getVelocity('npc_1');
      expect(vel).toEqual({ x: 100, y: -50 });
    });

    it('getVelocity returns zero for missing entity', () => {
      expect(adapter.getVelocity('unknown')).toEqual({ x: 0, y: 0 });
    });

    it('getVelocity returns zero for entity without body', () => {
      const sprite = mockSprite({ body: null } as Partial<IArcadeSprite>);
      adapter.register('npc_1', sprite);
      expect(adapter.getVelocity('npc_1')).toEqual({ x: 0, y: 0 });
    });

    it('setRotation updates sprite', () => {
      const sprite = mockSprite();
      adapter.register('npc_1', sprite);
      adapter.setRotation('npc_1', Math.PI);
      expect(sprite.rotation).toBe(Math.PI);
    });

    it('teleport resets velocity', () => {
      const sprite = mockSprite();
      adapter.register('npc_1', sprite);
      adapter.setVelocity('npc_1', { x: 100, y: 100 });
      adapter.teleport('npc_1', { x: 500, y: 600 });
      expect(sprite.x).toBe(500);
      expect(sprite.y).toBe(600);
      expect(sprite.body!.velocity.x).toBe(0);
      expect(sprite.body!.velocity.y).toBe(0);
    });

    it('disablePhysics sets body.enable=false', () => {
      const sprite = mockSprite();
      adapter.register('npc_1', sprite);
      adapter.disablePhysics('npc_1');
      expect(sprite.body!.enable).toBe(false);
    });

    it('setMetadata stores and retrieves', () => {
      adapter.register('npc_1', mockSprite());
      adapter.setMetadata('npc_1', 'faction', 'stalker');
      expect(adapter.getMetadata('npc_1', 'faction')).toBe('stalker');
    });
  });

  describe('IEntityRendering', () => {
    it('setAlpha updates sprite alpha', () => {
      const sprite = mockSprite();
      adapter.register('npc_1', sprite);
      adapter.setAlpha('npc_1', 0.5);
      expect(sprite.alpha).toBe(0.5);
    });

    it('playAnimation calls anims.play', () => {
      let playedKey = '';
      const sprite = mockSprite({
        anims: {
          play(key: string) { playedKey = key; return {}; },
          getName() { return playedKey; },
        },
      } as Partial<IArcadeSprite>);
      adapter.register('npc_1', sprite);
      adapter.playAnimation('npc_1', 'walk_down');
      expect(playedKey).toBe('walk_down');
    });

    it('playAnimation passes ignoreIfPlaying=true by default', () => {
      let receivedIgnore: boolean | undefined;
      const sprite = mockSprite({
        anims: {
          play(_key: string, ignore?: boolean) { receivedIgnore = ignore; return {}; },
          getName() { return ''; },
        },
      } as Partial<IArcadeSprite>);
      adapter.register('npc_1', sprite);
      adapter.playAnimation('npc_1', 'idle');
      expect(receivedIgnore).toBe(true);
    });

    it('playAnimation passes explicit ignoreIfPlaying=false', () => {
      let receivedIgnore: boolean | undefined;
      const sprite = mockSprite({
        anims: {
          play(_key: string, ignore?: boolean) { receivedIgnore = ignore; return {}; },
          getName() { return ''; },
        },
      } as Partial<IArcadeSprite>);
      adapter.register('npc_1', sprite);
      adapter.playAnimation('npc_1', 'walk_down', false);
      expect(receivedIgnore).toBe(false);
    });

    it('hasAnimation checks exists() if available', () => {
      const sprite = mockSprite({
        anims: {
          play() { return {}; },
          getName() { return 'idle'; },
          exists(key: string) { return key === 'walk'; },
        } as unknown as IArcadeSprite['anims'],
      } as Partial<IArcadeSprite>);
      adapter.register('npc_1', sprite);
      expect(adapter.hasAnimation('npc_1', 'walk')).toBe(true);
      expect(adapter.hasAnimation('npc_1', 'run')).toBe(false);
    });

    it('hasAnimation falls back to name comparison', () => {
      const sprite = mockSprite({
        anims: {
          play() { return {}; },
          getName() { return 'idle'; },
        },
      } as Partial<IArcadeSprite>);
      adapter.register('npc_1', sprite);
      expect(adapter.hasAnimation('npc_1', 'idle')).toBe(true);
      expect(adapter.hasAnimation('npc_1', 'walk')).toBe(false);
    });

    it('hasAnimation returns false without anims', () => {
      const sprite = mockSprite({ anims: undefined } as Partial<IArcadeSprite>);
      adapter.register('npc_1', sprite);
      expect(adapter.hasAnimation('npc_1', 'idle')).toBe(false);
    });
  });

  describe('silent no-ops for missing entities', () => {
    it('setPosition on unknown entity does nothing', () => {
      expect(() => adapter.setPosition('unknown', { x: 1, y: 2 })).not.toThrow();
    });

    it('setActive on unknown entity does nothing', () => {
      expect(() => adapter.setActive('unknown', false)).not.toThrow();
    });

    it('setVelocity on unknown entity does nothing', () => {
      expect(() => adapter.setVelocity('unknown', { x: 1, y: 2 })).not.toThrow();
    });

    it('playAnimation on unknown entity does nothing', () => {
      expect(() => adapter.playAnimation('unknown', 'idle')).not.toThrow();
    });
  });
});
