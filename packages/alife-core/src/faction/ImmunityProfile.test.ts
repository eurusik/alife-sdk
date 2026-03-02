import {
  createImmunityProfile,
  getResistance,
  applyDamageReduction,
} from './ImmunityProfile';

describe('ImmunityProfile', () => {
  // ---------------------------------------------------------------------------
  // createImmunityProfile
  // ---------------------------------------------------------------------------
  describe('createImmunityProfile', () => {
    it('creates an empty profile when called with no arguments', () => {
      const profile = createImmunityProfile();
      expect(profile.size).toBe(0);
    });

    it('creates an empty profile when called with undefined', () => {
      const profile = createImmunityProfile(undefined);
      expect(profile.size).toBe(0);
    });

    it('creates a profile with the provided entries', () => {
      const profile = createImmunityProfile({
        fire: 0.3,
        radiation: 0.8,
      });

      expect(profile.get('fire')).toBe(0.3);
      expect(profile.get('radiation')).toBe(0.8);
      expect(profile.size).toBe(2);
    });

    it('clamps values above 1 to 1', () => {
      const profile = createImmunityProfile({ fire: 1.5 });
      expect(profile.get('fire')).toBe(1);
    });

    it('clamps values below 0 to 0', () => {
      const profile = createImmunityProfile({ psi: -0.3 });
      expect(profile.get('psi')).toBe(0);
    });

    it('preserves boundary values (0 and 1) unchanged', () => {
      const profile = createImmunityProfile({ zero: 0, full: 1 });
      expect(profile.get('zero')).toBe(0);
      expect(profile.get('full')).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // getResistance
  // ---------------------------------------------------------------------------
  describe('getResistance', () => {
    it('returns the stored resistance factor', () => {
      const profile = createImmunityProfile({ fire: 0.6 });
      expect(getResistance(profile, 'fire')).toBe(0.6);
    });

    it('returns 0 for an unknown damage type', () => {
      const profile = createImmunityProfile({ fire: 0.6 });
      expect(getResistance(profile, 'chemical')).toBe(0);
    });

    it('returns 0 for an empty profile', () => {
      const profile = createImmunityProfile();
      expect(getResistance(profile, 'fire')).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // applyDamageReduction
  // ---------------------------------------------------------------------------
  describe('applyDamageReduction', () => {
    it('reduces damage by the resistance factor: baseDamage * (1 - resistance)', () => {
      const profile = createImmunityProfile({ fire: 0.3 });
      // 100 * (1 - 0.3) = 70
      expect(applyDamageReduction(100, profile, 'fire')).toBeCloseTo(70);
    });

    it('returns full damage when resistance is 0', () => {
      const profile = createImmunityProfile({ fire: 0 });
      expect(applyDamageReduction(50, profile, 'fire')).toBe(50);
    });

    it('returns 0 damage when resistance is 1 (full immunity)', () => {
      const profile = createImmunityProfile({ psi: 1 });
      expect(applyDamageReduction(200, profile, 'psi')).toBe(0);
    });

    it('returns full damage for unknown damage type (defaults to 0 resistance)', () => {
      const profile = createImmunityProfile({ fire: 0.5 });
      expect(applyDamageReduction(80, profile, 'chemical')).toBe(80);
    });

    it('handles 50% resistance correctly', () => {
      const profile = createImmunityProfile({ radiation: 0.5 });
      expect(applyDamageReduction(60, profile, 'radiation')).toBeCloseTo(30);
    });

    it('handles zero base damage', () => {
      const profile = createImmunityProfile({ fire: 0.5 });
      expect(applyDamageReduction(0, profile, 'fire')).toBe(0);
    });
  });
});
