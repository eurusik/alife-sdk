import { describe, it, expect } from 'vitest';
import { createPortToken, PortRegistry } from './PortRegistry';

describe('createPortToken', () => {
  it('creates token with correct id and description', () => {
    const token = createPortToken<number>('my.port', 'A numeric port');
    expect(token.id).toBe('my.port');
    expect(token.description).toBe('A numeric port');
  });

  it('does not include _brand in the created object', () => {
    const token = createPortToken<string>('str.port', 'desc');
    expect('_brand' in token).toBe(false);
  });
});

describe('PortRegistry', () => {
  it('provide + require returns the implementation', () => {
    const registry = new PortRegistry();
    const token = createPortToken<number>('num', 'number port');
    registry.provide(token, 42);
    expect(registry.require(token)).toBe(42);
  });

  it('require throws when port is not provided', () => {
    const registry = new PortRegistry();
    const token = createPortToken<string>('missing.port', 'Missing port description');
    expect(() => registry.require(token)).toThrowError(/missing\.port/);
    expect(() => registry.require(token)).toThrowError(/Missing port description/);
  });

  it('tryGet returns undefined for missing port', () => {
    const registry = new PortRegistry();
    const token = createPortToken<number>('absent', 'absent port');
    expect(registry.tryGet(token)).toBeUndefined();
  });

  it('tryGet returns the implementation for provided port', () => {
    const registry = new PortRegistry();
    const token = createPortToken<string>('present', 'present port');
    registry.provide(token, 'hello');
    expect(registry.tryGet(token)).toBe('hello');
  });

  it('provide throws on duplicate registration', () => {
    const registry = new PortRegistry();
    const token = createPortToken<number>('dup', 'duplicate port');
    registry.provide(token, 1);
    expect(() => registry.provide(token, 2)).toThrowError(/dup/);
    expect(() => registry.provide(token, 2)).toThrowError(/already registered/);
  });

  it('has returns true for provided port', () => {
    const registry = new PortRegistry();
    const token = createPortToken<boolean>('flag', 'flag port');
    registry.provide(token, true);
    expect(registry.has(token)).toBe(true);
  });

  it('has returns false for missing port', () => {
    const registry = new PortRegistry();
    const token = createPortToken<boolean>('nope', 'nope port');
    expect(registry.has(token)).toBe(false);
  });

  it('registeredIds returns all registered token ids', () => {
    const registry = new PortRegistry();
    const a = createPortToken<number>('a', 'port a');
    const b = createPortToken<string>('b', 'port b');
    const c = createPortToken<boolean>('c', 'port c');
    registry.provide(a, 1);
    registry.provide(b, 'two');
    registry.provide(c, true);
    expect(registry.registeredIds()).toEqual(['a', 'b', 'c']);
  });

  it('registeredIds returns empty array when nothing is registered', () => {
    const registry = new PortRegistry();
    expect(registry.registeredIds()).toEqual([]);
  });

  it('multiple tokens can coexist independently', () => {
    const registry = new PortRegistry();
    const numToken = createPortToken<number>('num', 'number');
    const strToken = createPortToken<string>('str', 'string');
    registry.provide(numToken, 99);
    registry.provide(strToken, 'abc');
    expect(registry.require(numToken)).toBe(99);
    expect(registry.require(strToken)).toBe('abc');
  });

  it('different token types hold different implementation types', () => {
    const registry = new PortRegistry();
    const arrayToken = createPortToken<number[]>('arr', 'array port');
    const objToken = createPortToken<{ name: string }>('obj', 'object port');
    const fnToken = createPortToken<() => number>('fn', 'function port');

    registry.provide(arrayToken, [1, 2, 3]);
    registry.provide(objToken, { name: 'test' });
    registry.provide(fnToken, () => 42);

    expect(registry.require(arrayToken)).toEqual([1, 2, 3]);
    expect(registry.require(objToken)).toEqual({ name: 'test' });
    expect(registry.require(fnToken)()).toBe(42);
  });

  it('require error message mentions calling provide before init', () => {
    const registry = new PortRegistry();
    const token = createPortToken<number>('init.port', 'init port');
    expect(() => registry.require(token)).toThrowError(/provide/);
  });

  it('provide error message mentions exactly once', () => {
    const registry = new PortRegistry();
    const token = createPortToken<number>('once', 'once port');
    registry.provide(token, 1);
    expect(() => registry.provide(token, 2)).toThrowError(/exactly once/);
  });

  it('two tokens with different ids do not collide', () => {
    const registry = new PortRegistry();
    const t1 = createPortToken<number>('x', 'first');
    const t2 = createPortToken<number>('y', 'second');
    registry.provide(t1, 10);
    expect(registry.has(t2)).toBe(false);
    expect(registry.tryGet(t2)).toBeUndefined();
  });
});
