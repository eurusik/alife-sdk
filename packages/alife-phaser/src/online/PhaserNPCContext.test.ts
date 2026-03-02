// online/PhaserNPCContext.test.ts
// Tests for PhaserNPCContext — Phaser bridge implementing INPCContext.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PhaserNPCContext } from './PhaserNPCContext';
import type { IPhaserNPCHost, IPhaserNPCSystemBundle } from './PhaserNPCContext';
import type { IShootPayload, IMeleeHitPayload } from '@alife-sdk/ai';
import { createDefaultNPCOnlineState } from '@alife-sdk/ai';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeHost(overrides: Partial<IPhaserNPCHost> = {}): IPhaserNPCHost {
  return {
    npcId: 'npc-test',
    factionId: 'bandits',
    entityType: 'npc',
    getX: vi.fn().mockReturnValue(100),
    getY: vi.fn().mockReturnValue(200),
    setVelocity: vi.fn(),
    halt: vi.fn(),
    setRotation: vi.fn(),
    setAlpha: vi.fn(),
    teleport: vi.fn(),
    disablePhysics: vi.fn(),
    getCurrentStateId: vi.fn().mockReturnValue('IDLE'),
    onTransitionRequest: vi.fn(),
    onShoot: vi.fn(),
    onMeleeHit: vi.fn(),
    onVocalization: vi.fn(),
    onPsiAttackStart: vi.fn(),
    now: vi.fn().mockReturnValue(5000),
    random: vi.fn().mockReturnValue(0.25),
    ...overrides,
  };
}

function makeContext(
  host?: Partial<IPhaserNPCHost>,
  systems?: IPhaserNPCSystemBundle,
): PhaserNPCContext {
  return new PhaserNPCContext(
    makeHost(host),
    createDefaultNPCOnlineState(),
    systems,
  );
}

// ---------------------------------------------------------------------------
// Identity getters
// ---------------------------------------------------------------------------

describe('PhaserNPCContext: identity getters', () => {
  it('npcId delegates to host.npcId', () => {
    const ctx = makeContext({ npcId: 'my-npc-42' });
    expect(ctx.npcId).toBe('my-npc-42');
  });

  it('factionId delegates to host.factionId', () => {
    const ctx = makeContext({ factionId: 'military' });
    expect(ctx.factionId).toBe('military');
  });

  it('entityType delegates to host.entityType', () => {
    const ctx = makeContext({ entityType: 'monster' });
    expect(ctx.entityType).toBe('monster');
  });
});

// ---------------------------------------------------------------------------
// Position getters
// ---------------------------------------------------------------------------

describe('PhaserNPCContext: position getters', () => {
  it('x calls host.getX() and returns its result', () => {
    const host = makeHost({ getX: vi.fn().mockReturnValue(350) });
    const ctx = new PhaserNPCContext(host, createDefaultNPCOnlineState());
    expect(ctx.x).toBe(350);
    expect(host.getX).toHaveBeenCalled();
  });

  it('y calls host.getY() and returns its result', () => {
    const host = makeHost({ getY: vi.fn().mockReturnValue(750) });
    const ctx = new PhaserNPCContext(host, createDefaultNPCOnlineState());
    expect(ctx.y).toBe(750);
    expect(host.getY).toHaveBeenCalled();
  });

  it('x/y can be read multiple times — each call delegates to host', () => {
    let xVal = 10;
    const host = makeHost({ getX: vi.fn(() => xVal) });
    const ctx = new PhaserNPCContext(host, createDefaultNPCOnlineState());
    expect(ctx.x).toBe(10);
    xVal = 20;
    expect(ctx.x).toBe(20); // live delegation
  });
});

// ---------------------------------------------------------------------------
// State bag
// ---------------------------------------------------------------------------

describe('PhaserNPCContext: state bag', () => {
  it('state is the same INPCOnlineState object passed in constructor', () => {
    const state = createDefaultNPCOnlineState();
    const host = makeHost();
    const ctx = new PhaserNPCContext(host, state);
    expect(ctx.state).toBe(state);
  });

  it('state mutations via ctx.state are reflected immediately', () => {
    const state = createDefaultNPCOnlineState();
    const ctx = new PhaserNPCContext(makeHost(), state);
    ctx.state.targetId = 'enemy-5';
    expect(ctx.state.targetId).toBe('enemy-5');
  });
});

// ---------------------------------------------------------------------------
// Movement & rendering delegation
// ---------------------------------------------------------------------------

describe('PhaserNPCContext: movement delegation', () => {
  let host: IPhaserNPCHost;
  let ctx: PhaserNPCContext;

  beforeEach(() => {
    host = makeHost();
    ctx = new PhaserNPCContext(host, createDefaultNPCOnlineState());
  });

  it('setVelocity delegates to host.setVelocity with correct args', () => {
    ctx.setVelocity(120, -80);
    expect(host.setVelocity).toHaveBeenCalledWith(120, -80);
  });

  it('halt delegates to host.halt', () => {
    ctx.halt();
    expect(host.halt).toHaveBeenCalledOnce();
  });

  it('setRotation delegates to host.setRotation with correct radians', () => {
    ctx.setRotation(Math.PI / 2);
    expect(host.setRotation).toHaveBeenCalledWith(Math.PI / 2);
  });

  it('setAlpha delegates to host.setAlpha with correct alpha', () => {
    ctx.setAlpha(0.08);
    expect(host.setAlpha).toHaveBeenCalledWith(0.08);
  });

  it('teleport delegates to host.teleport with correct coords', () => {
    ctx.teleport(500, 300);
    expect(host.teleport).toHaveBeenCalledWith(500, 300);
  });

  it('disablePhysics delegates to host.disablePhysics', () => {
    ctx.disablePhysics();
    expect(host.disablePhysics).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// FSM control
// ---------------------------------------------------------------------------

describe('PhaserNPCContext: FSM control', () => {
  let host: IPhaserNPCHost;
  let ctx: PhaserNPCContext;

  beforeEach(() => {
    host = makeHost({ getCurrentStateId: vi.fn().mockReturnValue('PATROL') });
    ctx = new PhaserNPCContext(host, createDefaultNPCOnlineState());
  });

  it('currentStateId delegates to host.getCurrentStateId()', () => {
    expect(ctx.currentStateId).toBe('PATROL');
    expect(host.getCurrentStateId).toHaveBeenCalled();
  });

  it('transition calls host.onTransitionRequest with new state id', () => {
    ctx.transition('COMBAT');
    expect(host.onTransitionRequest).toHaveBeenCalledWith('COMBAT');
  });

  it('transition to any valid string delegates to host', () => {
    ctx.transition('PSI_ATTACK');
    expect(host.onTransitionRequest).toHaveBeenCalledWith('PSI_ATTACK');
  });
});

// ---------------------------------------------------------------------------
// Event emission
// ---------------------------------------------------------------------------

describe('PhaserNPCContext: event emission', () => {
  let host: IPhaserNPCHost;
  let ctx: PhaserNPCContext;

  beforeEach(() => {
    host = makeHost();
    ctx = new PhaserNPCContext(host, createDefaultNPCOnlineState());
  });

  it('emitShoot delegates full payload to host.onShoot', () => {
    const payload: IShootPayload = {
      npcId: 'npc-test',
      x: 100,
      y: 200,
      targetX: 300,
      targetY: 400,
      weaponType: 'rifle',
    };
    ctx.emitShoot(payload);
    expect(host.onShoot).toHaveBeenCalledWith(payload);
  });

  it('emitMeleeHit delegates full payload to host.onMeleeHit', () => {
    const payload: IMeleeHitPayload = {
      npcId: 'npc-test',
      targetId: 'player-1',
      damage: 30,
    };
    ctx.emitMeleeHit(payload);
    expect(host.onMeleeHit).toHaveBeenCalledWith(payload);
  });

  it('emitVocalization delegates type string to host.onVocalization', () => {
    ctx.emitVocalization('ENEMY_SPOTTED');
    expect(host.onVocalization).toHaveBeenCalledWith('ENEMY_SPOTTED');
  });

  it('emitVocalization can emit any string type', () => {
    ctx.emitVocalization('CUSTOM_SOUND');
    expect(host.onVocalization).toHaveBeenCalledWith('CUSTOM_SOUND');
  });

  it('emitPsiAttackStart delegates coords to host.onPsiAttackStart', () => {
    ctx.emitPsiAttackStart(150, 250);
    expect(host.onPsiAttackStart).toHaveBeenCalledWith(150, 250);
  });
});

// ---------------------------------------------------------------------------
// Utility delegation
// ---------------------------------------------------------------------------

describe('PhaserNPCContext: utility delegation', () => {
  it('now() delegates to host.now() and returns its value', () => {
    const host = makeHost({ now: vi.fn().mockReturnValue(99999) });
    const ctx = new PhaserNPCContext(host, createDefaultNPCOnlineState());
    expect(ctx.now()).toBe(99999);
    expect(host.now).toHaveBeenCalled();
  });

  it('random() delegates to host.random() and returns its value', () => {
    const host = makeHost({ random: vi.fn().mockReturnValue(0.77) });
    const ctx = new PhaserNPCContext(host, createDefaultNPCOnlineState());
    expect(ctx.random()).toBeCloseTo(0.77);
    expect(host.random).toHaveBeenCalled();
  });

  it('now() can be called many times — each delegates', () => {
    let t = 0;
    const host = makeHost({ now: vi.fn(() => ++t) });
    const ctx = new PhaserNPCContext(host, createDefaultNPCOnlineState());
    expect(ctx.now()).toBe(1);
    expect(ctx.now()).toBe(2);
    expect(ctx.now()).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Optional subsystems — default null
// ---------------------------------------------------------------------------

describe('PhaserNPCContext: optional subsystems default to null', () => {
  let ctx: PhaserNPCContext;

  beforeEach(() => {
    ctx = new PhaserNPCContext(makeHost(), createDefaultNPCOnlineState());
  });

  it('perception is null when not provided', () => {
    expect(ctx.perception).toBeNull();
  });

  it('health is null when not provided', () => {
    expect(ctx.health).toBeNull();
  });

  it('cover is null when not provided', () => {
    expect(ctx.cover).toBeNull();
  });

  it('danger is null when not provided', () => {
    expect(ctx.danger).toBeNull();
  });

  it('restrictedZones is null when not provided', () => {
    expect(ctx.restrictedZones).toBeNull();
  });

  it('squad is null when not provided', () => {
    expect(ctx.squad).toBeNull();
  });

  it('null systems bundle yields all-null subsystems', () => {
    const ctx2 = new PhaserNPCContext(makeHost(), createDefaultNPCOnlineState(), {});
    expect(ctx2.perception).toBeNull();
    expect(ctx2.health).toBeNull();
    expect(ctx2.cover).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Optional subsystems — provided
// ---------------------------------------------------------------------------

describe('PhaserNPCContext: optional subsystems when provided', () => {
  it('perception is accessible when provided', () => {
    const mockPerception = {
      getVisibleEnemies: vi.fn().mockReturnValue([]),
      getVisibleAllies:  vi.fn().mockReturnValue([]),
      getNearbyItems:    vi.fn().mockReturnValue([]),
      hasVisibleEnemy:   vi.fn().mockReturnValue(false),
    };
    const ctx = makeContext({}, { perception: mockPerception });
    expect(ctx.perception).toBe(mockPerception);
    expect(ctx.perception?.hasVisibleEnemy()).toBe(false);
  });

  it('health is accessible when provided', () => {
    const mockHealth = {
      hp: 75,
      maxHp: 100,
      hpPercent: 0.75,
      heal: vi.fn(),
    };
    const ctx = makeContext({}, { health: mockHealth });
    expect(ctx.health).toBe(mockHealth);
    expect(ctx.health?.hp).toBe(75);
    expect(ctx.health?.hpPercent).toBe(0.75);
  });

  it('health.heal() can be called through the context', () => {
    const healFn = vi.fn();
    const mockHealth = { hp: 50, maxHp: 100, hpPercent: 0.5, heal: healFn };
    const ctx = makeContext({}, { health: mockHealth });
    ctx.health?.heal(25);
    expect(healFn).toHaveBeenCalledWith(25);
  });

  it('cover is accessible when provided', () => {
    const mockCover = {
      findCover: vi.fn().mockReturnValue({ x: 50, y: 50 }),
    };
    const ctx = makeContext({}, { cover: mockCover });
    expect(ctx.cover).toBe(mockCover);
    const pt = ctx.cover?.findCover(0, 0, 100, 100);
    expect(pt).toEqual({ x: 50, y: 50 });
  });

  it('cover.findCover returns null when no cover found', () => {
    const mockCover = {
      findCover: vi.fn().mockReturnValue(null),
    };
    const ctx = makeContext({}, { cover: mockCover });
    expect(ctx.cover?.findCover(0, 0, 100, 100)).toBeNull();
  });

  it('danger is accessible when provided', () => {
    const mockDanger = {
      getDangerLevel: vi.fn().mockReturnValue(0.8),
      getGrenadeDanger: vi.fn().mockReturnValue({ active: true, originX: 10, originY: 20 }),
    };
    const ctx = makeContext({}, { danger: mockDanger });
    expect(ctx.danger).toBe(mockDanger);
    expect(ctx.danger?.getDangerLevel(0, 0)).toBe(0.8);
  });

  it('restrictedZones is accessible when provided', () => {
    const mockZones = {
      isAccessible: vi.fn().mockReturnValue(true),
      filterAccessible: vi.fn().mockImplementation((pts) => [...pts]),
    };
    const ctx = makeContext({}, { restrictedZones: mockZones });
    expect(ctx.restrictedZones).toBe(mockZones);
    expect(ctx.restrictedZones?.isAccessible(0, 0)).toBe(true);
  });

  it('squad is accessible when provided', () => {
    const mockSquad = {
      shareTarget: vi.fn(),
      getLeaderId:    vi.fn().mockReturnValue('leader-1'),
      getMemberCount: vi.fn().mockReturnValue(4),
      issueCommand:   vi.fn(),
    };
    const ctx = makeContext({}, { squad: mockSquad });
    expect(ctx.squad).toBe(mockSquad);
    expect(ctx.squad?.getLeaderId()).toBe('leader-1');
    expect(ctx.squad?.getMemberCount()).toBe(4);
  });

  it('squad.shareTarget can be called', () => {
    const shareTarget = vi.fn();
    const ctx = makeContext({}, { squad: {
      shareTarget,
      getLeaderId:    () => null,
      getMemberCount: () => 1,
      issueCommand:   () => {},
    }});
    ctx.squad?.shareTarget('enemy-2', 300, 400);
    expect(shareTarget).toHaveBeenCalledWith('enemy-2', 300, 400);
  });

  it('all systems can be provided simultaneously', () => {
    const systems: IPhaserNPCSystemBundle = {
      perception: {
        getVisibleEnemies: () => [],
        getVisibleAllies:  () => [],
        getNearbyItems:    () => [],
        hasVisibleEnemy:   () => false,
      },
      health: { hp: 100, maxHp: 100, hpPercent: 1, heal: () => {} },
      cover: { findCover: () => null },
      danger: { getDangerLevel: () => 0, getGrenadeDanger: () => null },
      restrictedZones: { isAccessible: () => true, filterAccessible: (p) => [...p] },
      squad: { shareTarget: () => {}, getLeaderId: () => null, getMemberCount: () => 1, issueCommand: () => {} },
    };
    const ctx = makeContext({}, systems);
    expect(ctx.perception).not.toBeNull();
    expect(ctx.health).not.toBeNull();
    expect(ctx.cover).not.toBeNull();
    expect(ctx.danger).not.toBeNull();
    expect(ctx.restrictedZones).not.toBeNull();
    expect(ctx.squad).not.toBeNull();
  });

  it('explicitly null systems remain null even in bundle', () => {
    const ctx = makeContext({}, { perception: null, health: null });
    expect(ctx.perception).toBeNull();
    expect(ctx.health).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Multiple instances — isolation
// ---------------------------------------------------------------------------

describe('PhaserNPCContext: instance isolation', () => {
  it('two contexts with different hosts are independent', () => {
    const hostA = makeHost({ npcId: 'npc-A', factionId: 'military' });
    const hostB = makeHost({ npcId: 'npc-B', factionId: 'bandits' });
    const ctxA = new PhaserNPCContext(hostA, createDefaultNPCOnlineState());
    const ctxB = new PhaserNPCContext(hostB, createDefaultNPCOnlineState());

    expect(ctxA.npcId).toBe('npc-A');
    expect(ctxB.npcId).toBe('npc-B');
    expect(ctxA.factionId).toBe('military');
    expect(ctxB.factionId).toBe('bandits');
  });

  it('state mutations on one context do not affect another', () => {
    const ctxA = new PhaserNPCContext(makeHost(), createDefaultNPCOnlineState());
    const ctxB = new PhaserNPCContext(makeHost(), createDefaultNPCOnlineState());

    ctxA.state.targetId = 'enemy-A';
    expect(ctxB.state.targetId).toBeNull();
  });
});
