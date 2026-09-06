import { describe, expect, test } from 'bun:test';
import { shouldArmPad } from '../../../audio/playback/padPlayback';

describe('shouldArmPad', () => {
  // Pad mode re-strikes the voicing on every chord; the outgoing chord's
  // release tail overlapping the incoming attack IS the legato.
  test('pad mode arms on every chord', () => {
    expect(shouldArmPad('pad', true)).toBe(true);
    expect(shouldArmPad('pad', false)).toBe(true);
  });

  // Drone mode arms once per loop pass and holds across every chord change.
  // `isLoopStart` is `arming.chordIndex % chords.length === 0`, a value the
  // caller already computes — no "loop boundary" concept is introduced.
  test('drone mode arms only at the top of a loop pass', () => {
    expect(shouldArmPad('drone', true)).toBe(true);
    expect(shouldArmPad('drone', false)).toBe(false);
  });
});
