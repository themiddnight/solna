import { describe, expect, test } from 'bun:test';
import { shouldAnimateBackdrop } from './AmbientBackdrop';

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
