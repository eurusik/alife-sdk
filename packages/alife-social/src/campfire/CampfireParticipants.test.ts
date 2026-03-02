import { describe, it, expect, beforeEach } from 'vitest';
import { CampfireParticipants } from './CampfireParticipants';

function makeRandom(values: number[] = [0.0]) {
  let idx = 0;
  return {
    next: () => values[idx++ % values.length],
    nextInt: (min: number, max: number) => min + Math.floor(values[idx++ % values.length] * (max - min + 1)),
    nextFloat: (min: number, max: number) => min + values[idx++ % values.length] * (max - min),
  };
}

describe('CampfireParticipants', () => {
  let participants: CampfireParticipants;

  beforeEach(() => {
    participants = new CampfireParticipants(makeRandom());
  });

  it('setParticipants returns true with enough NPCs', () => {
    expect(participants.setParticipants(['a', 'b', 'c'], 2)).toBe(true);
    expect(participants.count).toBe(3);
  });

  it('setParticipants returns false below minimum', () => {
    expect(participants.setParticipants(['a'], 2)).toBe(false);
    expect(participants.count).toBe(0);
  });

  it('rotateDirector assigns director role', () => {
    participants.setParticipants(['a', 'b', 'c'], 2);
    const directorId = participants.rotateDirector();
    expect(directorId).toBeTruthy();
    expect(participants.getDirectorId()).toBe(directorId);
  });

  it('rotateDirector cycles through participants', () => {
    participants.setParticipants(['a', 'b', 'c'], 2);
    const first = participants.rotateDirector();
    const second = participants.rotateDirector();
    expect(first).not.toBe(second);
  });

  it('rotateDirector wraps around', () => {
    participants.setParticipants(['a', 'b'], 2);
    const ids: string[] = [];
    ids.push(participants.rotateDirector()!);
    ids.push(participants.rotateDirector()!);
    ids.push(participants.rotateDirector()!);
    // Third rotation wraps to first participant
    expect(ids[2]).toBe(ids[0]);
  });

  it('getAudienceIds excludes director', () => {
    participants.setParticipants(['a', 'b', 'c'], 2);
    participants.rotateDirector();
    const directorId = participants.getDirectorId();
    const audience = participants.getAudienceIds();
    expect(audience).not.toContain(directorId);
    expect(audience).toHaveLength(2);
  });

  it('getAllIds returns all participant IDs', () => {
    participants.setParticipants(['a', 'b', 'c'], 2);
    expect(participants.getAllIds()).toEqual(['a', 'b', 'c']);
  });

  it('has checks membership', () => {
    participants.setParticipants(['a', 'b'], 2);
    expect(participants.has('a')).toBe(true);
    expect(participants.has('z')).toBe(false);
  });

  it('getDirectorId returns null when empty', () => {
    expect(participants.getDirectorId()).toBeNull();
  });

  it('rotateDirector returns null when empty', () => {
    expect(participants.rotateDirector()).toBeNull();
  });

  it('clear empties participants', () => {
    participants.setParticipants(['a', 'b'], 2);
    participants.clear();
    expect(participants.count).toBe(0);
    expect(participants.getDirectorId()).toBeNull();
  });
});
