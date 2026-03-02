import { describe, it, expect, vi } from 'vitest';
import { AnimationController } from './AnimationController';
import { AnimLayer } from './AnimationSelector';
import type { IAnimationDriver, IAnimPlayOptions } from './AnimationController';
import type { IAnimationRequest } from './AnimationSelector';

function makeMockDriver(hasAnim = true): IAnimationDriver & { play: ReturnType<typeof vi.fn> } {
  return {
    play: vi.fn<[string, IAnimPlayOptions], void>(),
    hasAnimation: vi.fn().mockReturnValue(hasAnim),
  };
}

function makeRequest(key: string, layer: AnimLayer, loop = true, frameRate = 10): IAnimationRequest {
  return { key, loop, frameRate, layer };
}

describe('AnimationController', () => {
  it('1. request() plays on first call — returns true, driver.play called', () => {
    const driver = makeMockDriver();
    const ctrl = new AnimationController({ driver });
    const req = makeRequest('idle_rifle_S', AnimLayer.LEGS);

    const result = ctrl.request(req);

    expect(result).toBe(true);
    expect(driver.play).toHaveBeenCalledOnce();
    expect(driver.play).toHaveBeenCalledWith('idle_rifle_S', { loop: true, frameRate: 10 });
  });

  it('2. request() with same key+layer — returns false, driver.play NOT called (debounce)', () => {
    const driver = makeMockDriver();
    const ctrl = new AnimationController({ driver });
    const req = makeRequest('idle_rifle_S', AnimLayer.LEGS);

    ctrl.request(req);
    driver.play.mockClear();

    const result = ctrl.request(req);

    expect(result).toBe(false);
    expect(driver.play).not.toHaveBeenCalled();
  });

  it('3. request() with new key, same layer — returns true (plays)', () => {
    const driver = makeMockDriver();
    const ctrl = new AnimationController({ driver });

    ctrl.request(makeRequest('idle_rifle_S', AnimLayer.LEGS));
    driver.play.mockClear();

    const result = ctrl.request(makeRequest('walk_rifle_S', AnimLayer.LEGS));

    expect(result).toBe(true);
    expect(driver.play).toHaveBeenCalledOnce();
  });

  it('4. request() with lower priority layer (HEAD active, TORSO request) — returns false', () => {
    const driver = makeMockDriver();
    const ctrl = new AnimationController({ driver });

    // HEAD (2) is active
    ctrl.request(makeRequest('head_anim', AnimLayer.HEAD));
    driver.play.mockClear();

    // TORSO (1) has lower priority than HEAD (2)
    const result = ctrl.request(makeRequest('torso_anim', AnimLayer.TORSO));

    expect(result).toBe(false);
    expect(driver.play).not.toHaveBeenCalled();
  });

  it('5. request() with higher priority layer (LEGS active, TORSO request) — returns true', () => {
    const driver = makeMockDriver();
    const ctrl = new AnimationController({ driver });

    // LEGS (0) is active
    ctrl.request(makeRequest('idle_rifle_S', AnimLayer.LEGS));
    driver.play.mockClear();

    // TORSO (1) has higher priority than LEGS (0)
    const result = ctrl.request(makeRequest('combat_rifle_S', AnimLayer.TORSO));

    expect(result).toBe(true);
    expect(driver.play).toHaveBeenCalledOnce();
  });

  it('6. TORSO active → HEAD request — returns true (higher priority)', () => {
    const driver = makeMockDriver();
    const ctrl = new AnimationController({ driver });

    ctrl.request(makeRequest('combat_rifle_S', AnimLayer.TORSO));
    driver.play.mockClear();

    const result = ctrl.request(makeRequest('head_anim', AnimLayer.HEAD));

    expect(result).toBe(true);
    expect(driver.play).toHaveBeenCalledOnce();
  });

  it('7. driver.hasAnimation returns false — request() returns false, play NOT called', () => {
    const driver = makeMockDriver(false);
    const ctrl = new AnimationController({ driver });

    const result = ctrl.request(makeRequest('missing_anim', AnimLayer.LEGS));

    expect(result).toBe(false);
    expect(driver.play).not.toHaveBeenCalled();
  });

  it('8. after reset() — next request() plays again (currentKey/Layer null)', () => {
    const driver = makeMockDriver();
    const ctrl = new AnimationController({ driver });

    ctrl.request(makeRequest('idle_rifle_S', AnimLayer.LEGS));
    ctrl.reset();
    driver.play.mockClear();

    const result = ctrl.request(makeRequest('idle_rifle_S', AnimLayer.LEGS));

    expect(result).toBe(true);
    expect(driver.play).toHaveBeenCalledOnce();
  });

  it('9. custom layerPriority config: LEGS can be higher than TORSO', () => {
    const driver = makeMockDriver();
    // Override: LEGS=10, TORSO=1 — so LEGS > TORSO
    const ctrl = new AnimationController({
      driver,
      layerPriority: { [AnimLayer.LEGS]: 10, [AnimLayer.TORSO]: 1 },
    });

    // LEGS (prio 10) is active
    ctrl.request(makeRequest('idle_rifle_S', AnimLayer.LEGS));
    driver.play.mockClear();

    // TORSO (prio 1) has LOWER priority than LEGS (prio 10) in this custom config
    const result = ctrl.request(makeRequest('combat_rifle_S', AnimLayer.TORSO));

    expect(result).toBe(false);
    expect(driver.play).not.toHaveBeenCalled();
  });

  it('10. force() plays always (even with same key)', () => {
    const driver = makeMockDriver();
    const ctrl = new AnimationController({ driver });

    ctrl.request(makeRequest('idle_rifle_S', AnimLayer.LEGS));
    driver.play.mockClear();

    // force with same key — should still play
    ctrl.force(makeRequest('idle_rifle_S', AnimLayer.LEGS));

    expect(driver.play).toHaveBeenCalledOnce();
  });

  it('11. force() plays when lower priority layer is active', () => {
    const driver = makeMockDriver();
    const ctrl = new AnimationController({ driver });

    // HEAD (2) is active — high priority
    ctrl.request(makeRequest('head_anim', AnimLayer.HEAD));
    driver.play.mockClear();

    // force LEGS (0) — lower priority, but force bypasses priority
    ctrl.force(makeRequest('death_anim', AnimLayer.LEGS));

    expect(driver.play).toHaveBeenCalledOnce();
    expect(driver.play).toHaveBeenCalledWith('death_anim', { loop: true, frameRate: 10 });
  });

  it('12. force() with hasAnimation=false — play NOT called', () => {
    const driver = makeMockDriver(false);
    const ctrl = new AnimationController({ driver });

    ctrl.force(makeRequest('missing_anim', AnimLayer.LEGS));

    expect(driver.play).not.toHaveBeenCalled();
  });

  it('13. force() updates currentKey and currentLayer', () => {
    const driver = makeMockDriver();
    const ctrl = new AnimationController({ driver });

    ctrl.force(makeRequest('death_anim', AnimLayer.LEGS));

    expect(ctrl.currentKey).toBe('death_anim');
    expect(ctrl.currentLayer).toBe(AnimLayer.LEGS);
  });

  it('14. currentKey is null before first play', () => {
    const driver = makeMockDriver();
    const ctrl = new AnimationController({ driver });

    expect(ctrl.currentKey).toBeNull();
  });

  it('15. currentLayer is null before first play', () => {
    const driver = makeMockDriver();
    const ctrl = new AnimationController({ driver });

    expect(ctrl.currentLayer).toBeNull();
  });
});
