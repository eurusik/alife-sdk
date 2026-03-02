import { describe, it, expect } from 'vitest';
import { SmoothPathFollower } from './SmoothPathFollower';
import { createDefaultAIConfig } from '../config/createDefaultAIConfig';
import type { Vec2 } from '@alife-sdk/core';

const config = createDefaultAIConfig().navigation;

function makeStraightPath(): Vec2[] {
  const pts: Vec2[] = [];
  for (let i = 0; i <= 10; i++) {
    pts.push({ x: i * 10, y: 0 });
  }
  return pts;
}

function makeTurningPath(): Vec2[] {
  return [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 50, y: 50 },
    { x: 100, y: 50 },
    { x: 100, y: 100 },
  ];
}

describe('SmoothPathFollower', () => {
  it('starts at the first point', () => {
    const follower = new SmoothPathFollower(makeStraightPath(), config);
    const target = follower.getCurrentTarget();
    expect(target).not.toBeNull();
    expect(target!.x).toBe(0);
    expect(target!.y).toBe(0);
  });

  it('advances when NPC reaches target', () => {
    const follower = new SmoothPathFollower(makeStraightPath(), config);
    const advanced = follower.updatePosition(0, 0);
    expect(advanced).toBe(true);
    const next = follower.getCurrentTarget();
    expect(next!.x).toBe(10);
  });

  it('does not advance when NPC is far from target', () => {
    const follower = new SmoothPathFollower(makeStraightPath(), config);
    const advanced = follower.updatePosition(100, 100);
    expect(advanced).toBe(false);
  });

  it('isComplete returns true at end of path', () => {
    const pts: Vec2[] = [{ x: 0, y: 0 }, { x: 5, y: 0 }];
    const follower = new SmoothPathFollower(pts, config);
    follower.updatePosition(0, 0);
    follower.updatePosition(5, 0);
    expect(follower.isComplete()).toBe(true);
  });

  it('getCurrentTarget returns null when complete', () => {
    const pts: Vec2[] = [{ x: 0, y: 0 }];
    const follower = new SmoothPathFollower(pts, config);
    follower.updatePosition(0, 0);
    expect(follower.getCurrentTarget()).toBeNull();
  });

  it('getProgress returns 0 at start', () => {
    const follower = new SmoothPathFollower(makeStraightPath(), config);
    expect(follower.getProgress()).toBe(0);
  });

  it('getProgress returns 1 at end', () => {
    const pts: Vec2[] = [{ x: 0, y: 0 }];
    const follower = new SmoothPathFollower(pts, config);
    follower.updatePosition(0, 0);
    expect(follower.getProgress()).toBe(1);
  });

  it('reset returns cursor to start', () => {
    const follower = new SmoothPathFollower(makeStraightPath(), config);
    follower.updatePosition(0, 0);
    follower.updatePosition(10, 0);
    follower.reset();
    expect(follower.getProgress()).toBe(0);
    expect(follower.getCurrentTarget()!.x).toBe(0);
  });

  it('getPointCount matches input', () => {
    const pts = makeStraightPath();
    const follower = new SmoothPathFollower(pts, config);
    expect(follower.getPointCount()).toBe(pts.length);
  });

  it('velocity multiplier is 1.0 on straight path', () => {
    const follower = new SmoothPathFollower(makeStraightPath(), config);
    // After a few transitions, multiplier should converge to fast.
    for (let i = 0; i < 20; i++) {
      follower.getCurrentVelocityMultiplier();
    }
    const mult = follower.getCurrentVelocityMultiplier();
    expect(mult).toBeGreaterThanOrEqual(config.velocityCurveSlow);
    expect(mult).toBeLessThanOrEqual(config.velocityCurveFast);
  });

  it('velocity is slower on sharp turns', () => {
    const follower = new SmoothPathFollower(makeTurningPath(), config);
    // Advance to a turn point.
    follower.updatePosition(0, 0);
    follower.updatePosition(50, 0);
    const turnMult = follower.getCurrentVelocityMultiplier();
    expect(turnMult).toBeLessThanOrEqual(config.velocityCurveFast);
  });

  it('handles empty path gracefully', () => {
    const follower = new SmoothPathFollower([], config);
    expect(follower.isComplete()).toBe(true);
    expect(follower.getCurrentTarget()).toBeNull();
    expect(follower.getProgress()).toBe(1);
  });

  it('updatePosition returns false when already complete', () => {
    const follower = new SmoothPathFollower([{ x: 0, y: 0 }], config);
    follower.updatePosition(0, 0);
    expect(follower.updatePosition(0, 0)).toBe(false);
  });
});
