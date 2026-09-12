import { describe, expect, test } from 'bun:test';
import { Note } from 'tonal';
import {
  applyPadVoicing,
  padHoldSec,
  resolveDroneNotes,
  resolvePadArm,
  shouldArmPad,
  type PadArmInput,
} from './padPlayback';

const midi = (n: string) => Note.midi(n)!;

describe('resolveDroneNotes', () => {
  test('degree I in C major gives root, fifth and octave', () => {
    const notes = resolveDroneNotes(0, [1, 5, 8], 3, 'C', 'Major');
    expect(notes).toEqual(['C3', 'G3', 'C4']);
  });

  // Asserted on semitone distance, not on the spelled name: 12P is one
  // interval (a perfect twelfth), not an octave composed with a fifth, and a
  // name comparison would pass for a wrong-but-enharmonic implementation.
  test('12P is nineteen semitones above the root and 8P is twelve', () => {
    const notes = resolveDroneNotes(0, [1, 8, 12], 3, 'C', 'Major');
    expect(midi(notes[1]) - midi(notes[0])).toBe(12);
    expect(midi(notes[2]) - midi(notes[0])).toBe(19);
  });

  test('4P is five semitones above the root', () => {
    const notes = resolveDroneNotes(0, [1, 4], 3, 'C', 'Major');
    expect(midi(notes[1]) - midi(notes[0])).toBe(5);
  });

  // Hirajoshi has five degrees. getDiatonicChordForDegree already wraps, and
  // the drone must inherit that rather than clamp: the stored degree survives
  // a trip through a shorter scale and comes back intact.
  test('the degree wraps on a five-degree scale', () => {
    const wrapped = resolveDroneNotes(6, [1], 3, 'A', 'Hirajoshi');
    const direct = resolveDroneNotes(1, [1], 3, 'A', 'Hirajoshi');
    expect(wrapped).toEqual(direct);
  });

  // INTENTIONAL, NOT A BUG — do not "fix" this by snapping into the scale or
  // by reading the diatonic chord's fifth. A drone's identity is the PERFECT
  // fifth; deriving it from the vii° chord would give a tritone held for a
  // whole loop pass, which is strictly worse than a note outside the key.
  // See the spec's "Drone's out-of-scale fifth on the leading tone is
  // intended" section.
  test('degree vii in C major yields a fifth outside the key, on purpose', () => {
    const notes = resolveDroneNotes(6, [1, 5], 3, 'C', 'Major');
    expect(midi(notes[0]) % 12).toBe(Note.chroma('B'));
    expect(midi(notes[1]) - midi(notes[0])).toBe(7);
    expect(midi(notes[1]) % 12).toBe(Note.chroma('F#'));
  });

  test('an empty interval set yields no notes', () => {
    expect(resolveDroneNotes(0, [], 3, 'C', 'Major')).toEqual([]);
  });
});

describe('applyPadVoicing', () => {
  test('triad returns the chord unchanged', () => {
    expect(applyPadVoicing(['C3', 'E3', 'G3'], 'triad')).toEqual(['C3', 'E3', 'G3']);
  });

  test('open5 keeps the root and the third chord tone', () => {
    expect(applyPadVoicing(['C3', 'E3', 'G3'], 'open5')).toEqual(['C3', 'G3']);
  });

  test('root keeps only the lowest tone', () => {
    expect(applyPadVoicing(['C3', 'E3', 'G3'], 'root')).toEqual(['C3']);
  });

  // A pentatonic or Hirajoshi voicing can be shorter than three notes, so
  // open5 falls back notes[2] -> notes[1] -> notes[0], the same chain
  // resolveBassSteps uses for its chord-tone tokens.
  test('open5 falls back to the second tone when there is no third', () => {
    expect(applyPadVoicing(['C3', 'G3'], 'open5')).toEqual(['C3', 'G3']);
  });

  test('open5 falls back to the root alone on a one-note chord', () => {
    expect(applyPadVoicing(['C3'], 'open5')).toEqual(['C3']);
  });

  test('an empty chord yields an empty voicing in every mode', () => {
    expect(applyPadVoicing([], 'triad')).toEqual([]);
    expect(applyPadVoicing([], 'open5')).toEqual([]);
    expect(applyPadVoicing([], 'root')).toEqual([]);
  });
});

describe('padHoldSec', () => {
  test('pad mode holds for the chord, drone mode holds for the loop', () => {
    expect(padHoldSec('pad', 2, 8, 2)).toBe(4);
    expect(padHoldSec('drone', 2, 8, 2)).toBe(16);
  });

  test('a zero-bar chord or loop never produces a negative hold', () => {
    expect(padHoldSec('pad', 0, 0, 2)).toBe(2);
    expect(padHoldSec('drone', 0, 0, 2)).toBe(2);
  });
});

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

describe('resolvePadArm', () => {
  const base: PadArmInput = {
    mode: 'pad',
    isLoopStart: false,
    chord: { id: 'c1', root: 'C', quality: 'maj', bars: 1, notes: ['C4', 'E4', 'G4'] },
    // 0-based: degree 0 is the scale's tonic, so 1 would be D, not C.
    degree: 0,
    intervals: [1, 5, 8],
    padOctave: 4,
    voicing: 'triad',
    scaleRoot: 'C',
    scaleType: 'major',
    barDur: 2,
    loopBarCount: 8,
  };

  /** Narrowing helper: `expect(x).not.toBeNull()` does not narrow `x`. */
  function mustArm(input: PadArmInput): { notes: string[]; holdSec: number } {
    const arm = resolvePadArm(input);
    if (!arm) throw new Error('expected an arm');
    return arm;
  }

  test('pad mode arms on every chord, however the pass started', () => {
    const arm = mustArm({ ...base, isLoopStart: false });
    expect(arm.holdSec).toBe(2); // one bar
    expect(arm.notes.length).toBeGreaterThan(0);
    expect(mustArm({ ...base, isLoopStart: true }).holdSec).toBe(2);
  });

  test('drone mode arms only at the top of a loop pass, holding the whole loop', () => {
    expect(resolvePadArm({ ...base, mode: 'drone', isLoopStart: false })).toBeNull();
    // degree I in C major over [1, 5, 8] is root, fifth, octave...
    expect(mustArm({ ...base, mode: 'drone', isLoopStart: true })).toEqual({
      notes: ['C4', 'G4', 'C5'],
      // ...and it holds loopBarCount bars, not the chord's one.
      holdSec: 16,
    });
  });

  test('a zero-bar chord never produces a hold shorter than a bar', () => {
    const arm = mustArm({ ...base, chord: { ...base.chord, bars: 0 } });
    expect(arm.holdSec).toBe(2);
  });

  // The brief for this move called for an `off` mode here; `PAD_MODES` is
  // ['pad', 'drone'] and has no off state, so the reachable "nothing sounds"
  // case is a drone that resolves no notes. It pins the same early return.
  test('a drone with no intervals resolves no notes and never arms', () => {
    expect(resolvePadArm({ ...base, mode: 'drone', isLoopStart: true, intervals: [] })).toBeNull();
  });
});
