import { MoraleTracker, MoraleState } from './MoraleStateMachine';

describe('MoraleTracker', () => {
  // ---------------------------------------------------------------------------
  // State derivation thresholds
  // ---------------------------------------------------------------------------
  describe('state derivation', () => {
    it('starts at morale 0 in STABLE state', () => {
      const tracker = new MoraleTracker();
      expect(tracker.morale).toBe(0);
      expect(tracker.state).toBe(MoraleState.STABLE);
    });

    it('becomes SHAKEN when morale <= shakenThreshold (-0.3)', () => {
      const tracker = new MoraleTracker();
      tracker.adjust(-0.3);
      expect(tracker.state).toBe(MoraleState.SHAKEN);
    });

    it('stays STABLE when morale is just above shakenThreshold', () => {
      const tracker = new MoraleTracker();
      tracker.adjust(-0.29);
      expect(tracker.state).toBe(MoraleState.STABLE);
    });

    it('becomes PANICKED when morale <= panicThreshold (-0.7)', () => {
      const tracker = new MoraleTracker();
      tracker.adjust(-0.7);
      expect(tracker.state).toBe(MoraleState.PANICKED);
    });

    it('stays SHAKEN when morale is just above panicThreshold', () => {
      const tracker = new MoraleTracker();
      tracker.adjust(-0.69);
      expect(tracker.state).toBe(MoraleState.SHAKEN);
    });

    it('uses custom thresholds', () => {
      const tracker = new MoraleTracker({
        shakenThreshold: -0.2,
        panicThreshold: -0.5,
      });

      tracker.adjust(-0.2);
      expect(tracker.state).toBe(MoraleState.SHAKEN);

      tracker.adjust(-0.3); // total -0.5
      expect(tracker.state).toBe(MoraleState.PANICKED);
    });
  });

  // ---------------------------------------------------------------------------
  // adjust + clamping
  // ---------------------------------------------------------------------------
  describe('adjust', () => {
    it('adds positive delta (morale boost)', () => {
      const tracker = new MoraleTracker();
      tracker.adjust(0.5);
      expect(tracker.morale).toBe(0.5);
    });

    it('adds negative delta (morale hit)', () => {
      const tracker = new MoraleTracker();
      tracker.adjust(-0.4);
      expect(tracker.morale).toBeCloseTo(-0.4);
    });

    it('accumulates multiple adjustments', () => {
      const tracker = new MoraleTracker();
      tracker.adjust(-0.15);
      tracker.adjust(-0.25);
      expect(tracker.morale).toBeCloseTo(-0.4);
    });

    it('clamps morale to 1 (upper bound)', () => {
      const tracker = new MoraleTracker();
      tracker.adjust(2.0);
      expect(tracker.morale).toBe(1);
    });

    it('clamps morale to -1 (lower bound)', () => {
      const tracker = new MoraleTracker();
      tracker.adjust(-5.0);
      expect(tracker.morale).toBe(-1);
    });
  });

  // ---------------------------------------------------------------------------
  // update() recovery rates
  // ---------------------------------------------------------------------------
  describe('update recovery', () => {
    it('STABLE recovers toward 0 at stableRecoveryRate (0.005/s)', () => {
      const tracker = new MoraleTracker();
      tracker.adjust(-0.1); // STABLE (> -0.3)
      expect(tracker.state).toBe(MoraleState.STABLE);

      tracker.update(1.0); // 1 second
      // -0.1 + 0.005 = -0.095
      expect(tracker.morale).toBeCloseTo(-0.095);
    });

    it('SHAKEN recovers toward 0 at shakenRecoveryRate (0.01/s)', () => {
      const tracker = new MoraleTracker();
      tracker.adjust(-0.5); // SHAKEN (-0.3 to -0.7 exclusive)
      expect(tracker.state).toBe(MoraleState.SHAKEN);

      tracker.update(1.0); // 1 second
      // -0.5 + 0.01 = -0.49
      expect(tracker.morale).toBeCloseTo(-0.49);
    });

    it('positive morale decays toward 0 (STABLE recovery)', () => {
      const tracker = new MoraleTracker();
      tracker.adjust(0.2);
      expect(tracker.state).toBe(MoraleState.STABLE);

      tracker.update(1.0);
      // 0.2 - 0.005 = 0.195
      expect(tracker.morale).toBeCloseTo(0.195);
    });

    it('recovery does not overshoot past 0', () => {
      const tracker = new MoraleTracker();
      tracker.adjust(-0.001); // very slightly negative
      tracker.update(10.0); // large delta should not go positive
      expect(tracker.morale).toBe(0);
    });

    it('does nothing when deltaSec <= 0', () => {
      const tracker = new MoraleTracker();
      tracker.adjust(-0.5);
      const before = tracker.morale;

      tracker.update(0);
      expect(tracker.morale).toBe(before);

      tracker.update(-1);
      expect(tracker.morale).toBe(before);
    });

    it('uses custom recovery rates', () => {
      const tracker = new MoraleTracker({
        stableRecoveryRate: 0.1,
        shakenRecoveryRate: 0.2,
      });

      tracker.adjust(-0.1); // STABLE
      tracker.update(1.0);
      // -0.1 + 0.1 = 0
      expect(tracker.morale).toBeCloseTo(0);
    });
  });

  // ---------------------------------------------------------------------------
  // PANICKED: no recovery
  // ---------------------------------------------------------------------------
  describe('PANICKED no recovery', () => {
    it('does not recover when in PANICKED state', () => {
      const tracker = new MoraleTracker();
      tracker.adjust(-0.8); // definitely PANICKED (<= -0.7)
      expect(tracker.state).toBe(MoraleState.PANICKED);

      const before = tracker.morale;
      tracker.update(10.0); // large delta — should have no effect
      expect(tracker.morale).toBe(before);
    });

    it('does not recover even at exactly -0.7 (panicThreshold boundary)', () => {
      const tracker = new MoraleTracker();
      tracker.adjust(-0.7);
      expect(tracker.state).toBe(MoraleState.PANICKED);

      const before = tracker.morale;
      tracker.update(5.0);
      expect(tracker.morale).toBe(before);
    });
  });

  // ---------------------------------------------------------------------------
  // reset
  // ---------------------------------------------------------------------------
  describe('reset', () => {
    it('resets morale to 0 and state to STABLE', () => {
      const tracker = new MoraleTracker();
      tracker.adjust(-0.9);
      expect(tracker.state).toBe(MoraleState.PANICKED);

      tracker.reset();
      expect(tracker.morale).toBe(0);
      expect(tracker.state).toBe(MoraleState.STABLE);
    });

    it('reset from positive morale', () => {
      const tracker = new MoraleTracker();
      tracker.adjust(0.8);

      tracker.reset();
      expect(tracker.morale).toBe(0);
      expect(tracker.state).toBe(MoraleState.STABLE);
    });
  });

  // ---------------------------------------------------------------------------
  // MoraleState values
  // ---------------------------------------------------------------------------
  describe('MoraleState enum values', () => {
    it('has correct string values', () => {
      expect(MoraleState.STABLE).toBe('stable');
      expect(MoraleState.SHAKEN).toBe('shaken');
      expect(MoraleState.PANICKED).toBe('panicked');
    });
  });
});
