import { describe, expect, test } from 'bun:test';
import { asLeadNoteMatrix, clampFinite, isLeadNoteMatrix, sanitizeEffectsValue, sanitizeLoops, sanitizeSynthParams } from './sanitize';
import { INITIAL_EFFECTS, INITIAL_SYNTH_PARAMS } from './initialState';
import { createDefaultLoop } from './loopSlice';

describe('sanitize (shared by persist hydration and project import)', () => {
  test('clampFinite rejects NaN, strings and out-of-range numbers', () => {
    expect(clampFinite('fast', 20, 300, 120)).toBe(120);
    expect(clampFinite(Number.NaN, 20, 300, 120)).toBe(120);
    expect(clampFinite(999, 20, 300, 120)).toBe(300);
    expect(clampFinite(90, 20, 300, 120)).toBe(90);
  });

  test('sanitizeSynthParams keeps a valid value and falls back per field', () => {
    const out = sanitizeSynthParams({ ...INITIAL_SYNTH_PARAMS, filterCutoff: 'loud', oscType: 'sawtooth' });
    expect(out.filterCutoff).toBe(INITIAL_SYNTH_PARAMS.filterCutoff);
    expect(out.oscType).toBe('sawtooth');
  });

  test('sanitizeEffectsValue clones the shared default instead of returning it', () => {
    const out = sanitizeEffectsValue('nope');
    expect(out).toEqual(INITIAL_EFFECTS);
    expect(out).not.toBe(INITIAL_EFFECTS);
  });

  test('sanitizeLoops drops non-object rows and returns undefined when nothing survives', () => {
    expect(sanitizeLoops([null, 7, 'x'])).toBeUndefined();
    expect(sanitizeLoops('loops')).toBeUndefined();
  });

  test('sanitizeLoops keeps an unknown soundKit / pattern id verbatim', () => {
    const loop = { ...createDefaultLoop(), soundKit: 'Kit From The Future', bassPatternId: 'bp-ghost' };
    const [out] = sanitizeLoops([loop]) ?? [];
    expect(out.soundKit).toBe('Kit From The Future');
    expect(out.bassPatternId).toBe('bp-ghost');
  });

  // A `.solna` file now arrives from other people's devices, so an array whose
  // ELEMENTS are wrong must fall back too — Array.isArray alone let
  // `{"chords": [1, 2, 3]}` through to the chord scheduler.
  describe('sanitizeLoops checks array elements, not just Array.isArray', () => {
    const field = <K extends keyof ReturnType<typeof createDefaultLoop>>(key: K, value: unknown) => {
      const [out] = sanitizeLoops([{ ...createDefaultLoop(), [key]: value }]) ?? [];
      return out[key];
    };
    const fallback = createDefaultLoop();

    const cases: Array<[string, keyof ReturnType<typeof createDefaultLoop>, unknown]> = [
      ['chords of numbers', 'chords', [1, 2, 3]],
      ['a chord missing notes', 'chords', [{ id: 'c', root: 'A', quality: 'min', bars: 1 }]],
      ['a chord with string notes', 'chords', [{ id: 'c', root: 'A', quality: 'min', bars: 1, notes: 'A3' }]],
      ['a chord with zero bars', 'chords', [{ id: 'c', root: 'A', quality: 'min', bars: 0, notes: ['A3'] }]],
      ['customChordRhythm of strings', 'customChordRhythm', ['on', 'off']],
      ['customBassPattern outside the union', 'customBassPattern', ['root', 'ninth']],
      ['leadMelodySteps that is not a matrix', 'leadMelodySteps', ['C4', 'D4']],
      ['leadMelodySteps of numbers', 'leadMelodySteps', [[60], [62]]],
      ['sequencerTracks of strings', 'sequencerTracks', ['kick', 'snare']],
      ['a track whose steps are numbers', 'sequencerTracks', [{ instrument: 'kick', steps: [1, 0] }]],
      ['a track with no instrument', 'sequencerTracks', [{ steps: [true, false] }]],
    ];
    for (const [label, key, value] of cases) {
      test(`${label} falls back to the default loop's value`, () => {
        expect(field(key, value)).toEqual(fallback[key]);
      });
    }

    test('valid elements are kept as they are', () => {
      const loop = createDefaultLoop();
      const [out] = sanitizeLoops([{ ...loop, customBassPattern: ['rest', 'root', 'octave'] }]) ?? [];
      expect(out.chords).toEqual(loop.chords);
      expect(out.sequencerTracks).toEqual(loop.sequencerTracks);
      expect(out.customBassPattern).toEqual(['rest', 'root', 'octave']);
    });
  });
});

describe('isLeadNoteMatrix', () => {
  test('accepts rows of { note, len } and empty rows', () => {
    expect(isLeadNoteMatrix([[{ note: 'C4', len: 1 }, { note: 'E4', len: 4 }], []])).toBe(true);
    expect(isLeadNoteMatrix([])).toBe(true);
  });

  test('rejects the pre-DEV-369 string matrix — both chains upgrade BEFORE sanitize', () => {
    expect(isLeadNoteMatrix([['C4', 'E4'], []])).toBe(false);
  });

  test('the type guard says NO to a half-typed note — asLeadNoteMatrix is what repairs it', () => {
    expect(isLeadNoteMatrix([[{ note: 'C4', len: 1.5 }]])).toBe(false);
    expect(isLeadNoteMatrix([[{ note: 'C4', len: 0 }]])).toBe(false);
    expect(isLeadNoteMatrix([[{ note: 'C4' }]])).toBe(false);
    expect(isLeadNoteMatrix([[{ len: 2 }]])).toBe(false);
    expect(isLeadNoteMatrix([[null]])).toBe(false);
    expect(isLeadNoteMatrix('C4')).toBe(false);
  });
});

/**
 * The guard answers "is this already a valid matrix"; the coercion answers
 * "what is the most of this melody I can honestly keep". The spec is explicit
 * that a non-integer or missing `len` on an otherwise valid note falls back
 * rather than rejecting the whole matrix — the sibling leadGate one line below
 * repairs a bad value through clampFinite for the same reason. Blanking a
 * whole melody over one bad integer is the wrong default in a module whose
 * job is to stop bad data reaching the engine.
 */
describe('asLeadNoteMatrix', () => {
  test('keeps a valid matrix as it stands', () => {
    expect(asLeadNoteMatrix([[{ note: 'C4', len: 1 }, { note: 'E4', len: 4 }], []])).toEqual([
      [{ note: 'C4', len: 1 }, { note: 'E4', len: 4 }],
      [],
    ]);
    expect(asLeadNoteMatrix([])).toEqual([]);
  });

  test('a non-integer len is repaired, and the notes around it survive', () => {
    expect(asLeadNoteMatrix([[{ note: 'C4', len: 1.5 }, { note: 'E4', len: 2 }]])).toEqual([
      [{ note: 'C4', len: 2 }, { note: 'E4', len: 2 }],
    ]);
  });

  test('a len below 1, missing or non-finite falls back to one step', () => {
    expect(asLeadNoteMatrix([[{ note: 'C4', len: 0 }]])).toEqual([[{ note: 'C4', len: 1 }]]);
    expect(asLeadNoteMatrix([[{ note: 'C4', len: -4 }]])).toEqual([[{ note: 'C4', len: 1 }]]);
    expect(asLeadNoteMatrix([[{ note: 'C4' }]])).toEqual([[{ note: 'C4', len: 1 }]]);
    expect(asLeadNoteMatrix([[{ note: 'C4', len: Number.NaN }]])).toEqual([[{ note: 'C4', len: 1 }]]);
  });

  test('an object entry with no usable note is dropped, not repaired — there is no pitch to invent', () => {
    expect(asLeadNoteMatrix([[{ len: 2 }, { note: 'C4', len: 1 }], []])).toEqual([
      [{ note: 'C4', len: 1 }],
      [],
    ]);
  });

  test('a non-object entry refuses the whole value — that is a different shape, not a broken note', () => {
    expect(asLeadNoteMatrix([[null]])).toBeUndefined();
    expect(asLeadNoteMatrix([[1, 2, 3]])).toBeUndefined();
  });

  test('the pre-DEV-369 string matrix is still refused whole', () => {
    // Coercing it would silently produce rows of empty arrays, i.e. exactly
    // the blanked melody the upgrade-before-sanitize ordering exists to
    // prevent — but wearing a "valid" face. The caller's fallback is honest.
    expect(asLeadNoteMatrix([['C4', 'E4'], []])).toBeUndefined();
  });

  test('a value that is not a matrix at all is refused', () => {
    expect(asLeadNoteMatrix('C4')).toBeUndefined();
    expect(asLeadNoteMatrix(undefined)).toBeUndefined();
    expect(asLeadNoteMatrix([{ note: 'C4', len: 1 }])).toBeUndefined();
  });
});

describe('sanitizeLoops repairs a lead melody instead of blanking it', () => {
  test('one bad len does not cost the loop its whole melody', () => {
    const loops = sanitizeLoops([
      { ...createDefaultLoop(), leadMelodySteps: [[{ note: 'C4', len: 1.5 }], [{ note: 'E4', len: 2 }]] },
    ]);
    expect(loops?.[0].leadMelodySteps).toEqual([
      [{ note: 'C4', len: 2 }],
      [{ note: 'E4', len: 2 }],
    ]);
  });
});
