import { describe, expect, test } from 'bun:test';
import { clampFinite, sanitizeEffectsValue, sanitizeLoops, sanitizeSynthParams } from './sanitize';
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
