import { describe, expect, test } from 'bun:test';
import { ARRANGE_CYCLE_MAX, arrangeCycleSteps, arrangeStep } from './arrangeStep';

describe('arrangeCycleSteps', () => {
  test('no loops means no cycle', () => {
    expect(arrangeCycleSteps([])).toBe(0);
  });

  test('one loop cycles on its own length', () => {
    expect(arrangeCycleSteps([64])).toBe(64);
  });

  test('identical loops cycle on that length, not on their product', () => {
    expect(arrangeCycleSteps([64, 64, 64])).toBe(64);
  });

  test('different lengths cycle on their least common multiple', () => {
    expect(arrangeCycleSteps([64, 96])).toBe(192);
    expect(arrangeCycleSteps([16, 24, 32])).toBe(96);
  });

  test('non-positive totals are ignored rather than poisoning the LCM', () => {
    expect(arrangeCycleSteps([64, 0, -3])).toBe(64);
    expect(arrangeCycleSteps([0, 0])).toBe(0);
  });

  test('an LCM past the cap gives up and returns 0', () => {
    // Three large coprime totals: the LCM is ~9.9e11, far past the cap.
    expect(arrangeCycleSteps([9973, 9967, 9949])).toBe(0);
    expect(ARRANGE_CYCLE_MAX).toBe(100_000);
  });

  test('an LCM exactly at the cap is still usable', () => {
    expect(arrangeCycleSteps([ARRANGE_CYCLE_MAX])).toBe(ARRANGE_CYCLE_MAX);
  });
});

describe('arrangeStep', () => {
  test('a zero cycle passes the raw step straight through', () => {
    expect(arrangeStep(12345, 0)).toBe(12345);
  });

  test('a real cycle wraps the step', () => {
    expect(arrangeStep(0, 64)).toBe(0);
    expect(arrangeStep(63, 64)).toBe(63);
    expect(arrangeStep(64, 64)).toBe(0);
    expect(arrangeStep(200, 64)).toBe(8);
  });

  test('THE INVARIANT: reducing by the cycle never changes any card’s progress', () => {
    // ArrangeView computes `currentStep % totalStepsInLoop` per card, so the
    // stored value may only be reduced modulo a COMMON multiple of every
    // total. This is the assertion that proves the derivation is safe.
    const totals = [64, 96, 48];
    const cycle = arrangeCycleSteps(totals);
    expect(cycle).toBe(192);
    for (let raw = 0; raw < 1000; raw++) {
      const stored = arrangeStep(raw, cycle);
      for (const total of totals) {
        expect(stored % total).toBe(raw % total);
      }
    }
  });

  test('the invariant also holds for a single loop', () => {
    const cycle = arrangeCycleSteps([48]);
    for (let raw = 0; raw < 500; raw++) {
      expect(arrangeStep(raw, cycle) % 48).toBe(raw % 48);
    }
  });

  test('the stored value repeats, so it is bounded for the whole session', () => {
    const cycle = arrangeCycleSteps([64, 96]);
    expect(arrangeStep(10_000_000, cycle)).toBeLessThan(cycle);
    expect(arrangeStep(5, cycle)).toBe(arrangeStep(5 + cycle, cycle));
  });
});
