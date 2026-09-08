import { describe, expect, test } from 'bun:test';
import { backdropLevel, shouldAnimateBackdrop } from './AmbientBackdrop';

// The media query itself cannot be tested here (no DOM), so the decision is
// extracted into a pure helper — the same approach resolveInitialTheme in
// Header.tsx takes for the theme preference.
describe('shouldAnimateBackdrop', () => {
  test('animates only while playing', () => {
    expect(shouldAnimateBackdrop(true, false)).toBe(true);
    expect(shouldAnimateBackdrop(false, false)).toBe(false);
  });

  test('reduced motion wins over playback', () => {
    expect(shouldAnimateBackdrop(true, true)).toBe(false);
    expect(shouldAnimateBackdrop(false, true)).toBe(false);
  });
});

describe('backdropLevel', () => {
  test('silence is zero, so the blobs sit at their resting radius', () => {
    expect(backdropLevel(-Infinity)).toBe(0);
    expect(backdropLevel(-60)).toBe(0);
  });

  test('the scale ceiling is one', () => {
    expect(backdropLevel(6)).toBeCloseTo(1, 10);
    expect(backdropLevel(20)).toBeCloseTo(1, 10);
  });

  test('agrees with the meters about where a reading sits', () => {
    // -24 dBFS is 30% of a meter's track; the backdrop uses the same 0.30.
    expect(backdropLevel(-24)).toBeCloseTo(0.3, 10);
    expect(backdropLevel(-6)).toBeCloseTo(0.72, 10);
  });

  test('stays inside 0..1 so the radius and alpha arithmetic cannot blow up', () => {
    for (let db = -200; db <= 40; db += 1) {
      expect(backdropLevel(db)).toBeGreaterThanOrEqual(0);
      expect(backdropLevel(db)).toBeLessThanOrEqual(1);
    }
  });

  test('NaN reads as silence rather than propagating into a canvas gradient', () => {
    expect(backdropLevel(Number.NaN)).toBe(0);
  });
});
