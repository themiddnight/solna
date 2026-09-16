import { describe, expect, test } from 'bun:test';
import { transposePitchClassPreservingOctave } from './pitch';

describe('transposePitchClassPreservingOctave', () => {
  test('shifts the pitch class and keeps the written octave', () => {
    expect(transposePitchClassPreservingOctave('E4', 2)).toBe('F#4');
    expect(transposePitchClassPreservingOctave('C4', 1)).toBe('C#4');
  });

  test('wraps around the octave boundary without changing the written octave', () => {
    // B3 + 1 semitone is pitch-class C, and the WRITTEN octave stays 3 (this is
    // pitch-class transposition, not MIDI transposition — the octave suffix is
    // preserved verbatim, never recomputed from an absolute pitch).
    expect(transposePitchClassPreservingOctave('B3', 1)).toBe('C3');
  });

  test('negative octaves round-trip', () => {
    expect(transposePitchClassPreservingOctave('C-1', 2)).toBe('D-1');
  });

  test('a pitch class with no octave stays without one', () => {
    expect(transposePitchClassPreservingOctave('E', 2)).toBe('F#');
  });

  test('flats resolve through the same sharp-spelled ROOTS table as every other Music Core output', () => {
    expect(transposePitchClassPreservingOctave('Db4', 1)).toBe('D4');
  });

  test('a negative shift wraps downward', () => {
    expect(transposePitchClassPreservingOctave('C4', -1)).toBe('B4');
  });

  test('returns null for an unparseable note', () => {
    expect(transposePitchClassPreservingOctave('not-a-note', 2)).toBeNull();
    expect(transposePitchClassPreservingOctave('', 2)).toBeNull();
  });
});
