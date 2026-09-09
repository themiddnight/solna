import { describe, expect, test } from 'bun:test';
import { asLeadNoteMatrix, clampFinite, sanitizeEffectsValue, sanitizeLoops, sanitizeSynthParams } from './sanitize';
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

  // Five enumerated fields each name a real library entry, so an id/label
  // outside that library's set is invalid input, not "unknown but honoured"
  // — the deleted migrateDrumVoices step used to carry a kit rename
  // ('909 Modern' -> 'Club Standard'), so a stale session holding the old
  // name must fall back to the default kit rather than resolve to nothing.
  test('sanitizeLoops falls back an unrecognised soundKit / pattern id / scale to the default loop', () => {
    const fallback = createDefaultLoop();
    const loop = {
      ...fallback,
      soundKit: '909 Modern',
      bassPatternId: 'bp-ghost',
      chordRhythmId: 'rhythm-ghost',
      scaleRoot: 'H#',
      scaleType: 'bogus-scale',
    };
    const [out] = sanitizeLoops([loop]) ?? [];
    expect(out.soundKit).toBe(fallback.soundKit);
    expect(out.bassPatternId).toBe(fallback.bassPatternId);
    expect(out.chordRhythmId).toBe(fallback.chordRhythmId);
    expect(out.scaleRoot).toBe(fallback.scaleRoot);
    expect(out.scaleType).toBe(fallback.scaleType);
  });

  test('sanitizeLoops keeps a valid soundKit / pattern id / scale untouched', () => {
    const [out] = sanitizeLoops([
      { ...createDefaultLoop(), soundKit: 'Club Standard', scaleRoot: 'F#', scaleType: 'Major' },
    ]) ?? [];
    expect(out.soundKit).toBe('Club Standard');
    expect(out.scaleRoot).toBe('F#');
    expect(out.scaleType).toBe('Major');
  });

  describe('sanitizeLoops fills the label fields instead of inventing a name', () => {
    // The fill counts over surviving rows and skips any ordinal an explicit
    // tempName elsewhere in the array already claims (see resolveTempName), so
    // two loops written before tempName existed can never come back with the
    // same label. With no explicit tempName anywhere in this payload, the
    // skip-list is empty and the count lines up with plain index + 1.
    test('a loop with no tempName reads back as untitled-{index + 1}', () => {
      const bare = { ...createDefaultLoop() } as unknown as Record<string, unknown>;
      delete bare.tempName;
      const loops = sanitizeLoops([{ ...bare, id: 'a' }, { ...bare, id: 'b' }]) ?? [];
      expect(loops.map((l) => l.tempName)).toEqual(['untitled-1', 'untitled-2']);
    });

    test('a blank tempName is filled the same way', () => {
      const loops =
        sanitizeLoops([
          { ...createDefaultLoop(), id: 'a', tempName: '' },
          { ...createDefaultLoop(), id: 'b', tempName: '' },
        ]) ?? [];
      expect(loops.map((l) => l.tempName)).toEqual(['untitled-1', 'untitled-2']);
    });

    test('a stored tempName passes through untouched', () => {
      const [out] =
        sanitizeLoops([{ ...createDefaultLoop(), id: 'a', tempName: 'Synthwave 80s' }]) ?? [];
      expect(out.tempName).toBe('Synthwave 80s');
    });

    // A whitespace-only tempName is not a label at all — length > 0 alone
    // would accept "   " verbatim and hand loopLabel a non-empty-but-blank
    // string every render site trusts (the Arrange card, LoopSelector, every
    // card aria-label) with no way for the user to fix it in-app.
    test('a whitespace-only tempName is filled the same way as a blank one', () => {
      const loops =
        sanitizeLoops([
          { ...createDefaultLoop(), id: 'a', tempName: '   ' },
          { ...createDefaultLoop(), id: 'b', tempName: '' },
        ]) ?? [];
      expect(loops.map((l) => l.tempName)).toEqual(['untitled-1', 'untitled-2']);
    });

    test('a stored tempName with surrounding whitespace is trimmed', () => {
      const [out] =
        sanitizeLoops([{ ...createDefaultLoop(), id: 'a', tempName: '  Chorus  ' }]) ?? [];
      expect(out.tempName).toBe('Chorus');
    });

    // The old fallback replaced a blank name with `Loop N`, which would undo the
    // user clearing the field on the very next reload. A blank name is now a
    // legal value, so it survives; a non-string one becomes '' rather than a
    // number nobody chose.
    test('a missing, blank or non-string name reads back as an empty string', () => {
      const bare = { ...createDefaultLoop() } as unknown as Record<string, unknown>;
      delete bare.name;
      const loops =
        sanitizeLoops([
          { ...bare, id: 'a' },
          { ...createDefaultLoop(), id: 'b', name: '' },
          { ...createDefaultLoop(), id: 'c', name: 42 },
        ]) ?? [];
      expect(loops.map((l) => l.name)).toEqual(['', '', '']);
    });

    test('a real name passes through untouched', () => {
      const [out] = sanitizeLoops([{ ...createDefaultLoop(), id: 'a', name: 'Drop' }]) ?? [];
      expect(out.name).toBe('Drop');
    });

    // Same trap as tempName above: a whitespace-only name is truthy, so
    // `loopLabel`'s `name || tempName` would render it instead of falling
    // back — and renameFromDraft (SortableLoopCard.tsx) never lets a user
    // save one, so only an imported file can produce this state.
    test('a whitespace-only name reads back as an empty string', () => {
      const [out] = sanitizeLoops([{ ...createDefaultLoop(), id: 'a', name: '   ' }]) ?? [];
      expect(out.name).toBe('');
    });

    test('a stored name with surrounding whitespace is trimmed', () => {
      const [out] = sanitizeLoops([{ ...createDefaultLoop(), id: 'a', name: '  Drop  ' }]) ?? [];
      expect(out.name).toBe('Drop');
    });
  });

  // The fill block above pins the positional fallback (no tempName, blank,
  // whitespace). These pin the COLLISION branch of resolveTempName — the part
  // where two rows compete for one name, or a positional fill must skip an
  // ordinal some OTHER row claims explicitly. Without it, two hand-edited rows
  // both saying `tempName: "untitled-1"` would read back indistinguishable
  // everywhere loopLabel renders (Arrange card, LoopSelector, LoopCopyDialog).
  describe('resolveTempName keeps colliding tempNames distinct', () => {
    test('two rows both carrying the same explicit tempName are kept distinct', () => {
      const loops =
        sanitizeLoops([
          { ...createDefaultLoop(), id: 'a', tempName: 'untitled-1' },
          { ...createDefaultLoop(), id: 'b', tempName: 'untitled-1' },
        ]) ?? [];
      expect(loops.map((l) => l.tempName)).toEqual(['untitled-1', 'untitled-2']);
    });

    test('a positional fill skips an ordinal a later row claims explicitly', () => {
      const bare = { ...createDefaultLoop() } as unknown as Record<string, unknown>;
      delete bare.tempName;
      const loops =
        sanitizeLoops([
          { ...bare, id: 'a' },
          { ...createDefaultLoop(), id: 'b', tempName: 'untitled-1' },
        ]) ?? [];
      // Row 'a' fills positionally and must not take 'untitled-1' even though
      // it sits first, because row 'b' claims it explicitly.
      expect(loops.map((l) => l.tempName)).toEqual(['untitled-2', 'untitled-1']);
    });

    test('a duplicated non-ordinal tempName is renumbered on the second row', () => {
      const loops =
        sanitizeLoops([
          { ...createDefaultLoop(), id: 'a', tempName: 'Chorus' },
          { ...createDefaultLoop(), id: 'b', tempName: 'Chorus' },
        ]) ?? [];
      expect(loops.map((l) => l.tempName)).toEqual(['Chorus', 'untitled-1']);
    });
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
    ];
    for (const [label, key, value] of cases) {
      test(`${label} falls back to the default loop's value`, () => {
        expect(field(key, value)).toEqual(fallback[key]);
      });
    }

    // sequencerTracks does NOT join the all-or-nothing table above: it is a
    // SET keyed by instrument, not a sequence, so dropping one invalid row
    // loses one voice and shifts nothing else (see sanitizeSequencerTracks's
    // own docblock) — UNLESS every row is invalid, in which case the roster
    // would otherwise sanitize to `[]` with no UI affordance to add a track
    // back, so an all-stale result falls back to the full default roster too.
    test('sequencerTracks of strings (not an array of objects) falls back to the default roster — nothing survives', () => {
      expect(field('sequencerTracks', ['kick', 'snare'])).toEqual(fallback.sequencerTracks);
    });

    test('a wholly invalid roster (bad steps) falls back to the default roster, not []', () => {
      expect(field('sequencerTracks', [{ instrument: 'kick', steps: [1, 0] }])).toEqual(fallback.sequencerTracks);
    });

    test('a single row with no instrument falls back to the default roster', () => {
      expect(field('sequencerTracks', [{ steps: [true, false] }])).toEqual(fallback.sequencerTracks);
    });

    test('a partially-stale roster still drops only the bad rows, not the whole roster', () => {
      const good = fallback.sequencerTracks[0];
      const out = field('sequencerTracks', [good, { instrument: 'tom', steps: [true, false] }]);
      expect(out).toEqual([good]);
    });

    test('sequencerTracks is not an array at all falls back to the default roster', () => {
      expect(field('sequencerTracks', 'nope')).toEqual(fallback.sequencerTracks);
    });

    test('valid elements are kept as they are', () => {
      const loop = createDefaultLoop();
      const [out] = sanitizeLoops([{ ...loop, customBassPattern: ['rest', 'root', 'octave'] }]) ?? [];
      expect(out.chords).toEqual(loop.chords);
      expect(out.sequencerTracks).toEqual(loop.sequencerTracks);
      expect(out.customBassPattern).toEqual(['rest', 'root', 'octave']);
    });
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

describe('sanitizeEffectsValue and the master dynamics fields', () => {
  test('a body with no dynamics keys gets each stage\'s INITIAL_EFFECTS default', () => {
    // A missing key gets the default, like every other key here — it is NOT
    // read as `false`. That distinction was invisible while both stages
    // defaulted off and became a bug the moment DEV-383 defaulted the limiter
    // on: an old body would have loaded limiter-off while a brand-new project
    // of the same content loaded limiter-on.
    const out = sanitizeEffectsValue({ reverbWet: 0.3 }) as Record<string, unknown>;
    expect(out.compressorEnabled).toBe(INITIAL_EFFECTS.compressorEnabled);
    expect(out.limiterEnabled).toBe(INITIAL_EFFECTS.limiterEnabled);
    expect(out.compressorEnabled).toBe(false);
    expect(out.limiterEnabled).toBe(true);
  });

  test('a truthy-but-not-true persisted flag never chooses a stage\'s state', () => {
    // Persisted JSON is untrusted input: only a real boolean passes through,
    // so a string, a 1 or an object can never silently insert a dynamics node
    // — the wrong type gets the default, exactly as it would with the key
    // missing, and the untrusted value influences nothing.
    const out = sanitizeEffectsValue({
      compressorEnabled: 'yes',
      limiterEnabled: 1,
    }) as Record<string, unknown>;
    expect(out.compressorEnabled).toBe(INITIAL_EFFECTS.compressorEnabled);
    expect(out.limiterEnabled).toBe(INITIAL_EFFECTS.limiterEnabled);
  });

  test('an explicit false survives — it is a real boolean, not a missing key', () => {
    const out = sanitizeEffectsValue({
      compressorEnabled: false,
      limiterEnabled: false,
    }) as Record<string, unknown>;
    expect(out.compressorEnabled).toBe(false);
    expect(out.limiterEnabled).toBe(false);
  });

  test('an explicit true survives', () => {
    const out = sanitizeEffectsValue({
      compressorEnabled: true,
      limiterEnabled: true,
    }) as Record<string, unknown>;
    expect(out.compressorEnabled).toBe(true);
    expect(out.limiterEnabled).toBe(true);
  });

  test('compressorRatio is a real field now and is no longer stripped', () => {
    const out = sanitizeEffectsValue({ compressorRatio: 6 }) as Record<string, unknown>;
    expect(out.compressorRatio).toBe(6);
  });

  test('compressorRatio is still clamped into the node range', () => {
    const out = sanitizeEffectsValue({ compressorRatio: 99 }) as Record<string, unknown>;
    expect(out.compressorRatio).toBe(20);
  });

  test('compressorBypass stays dead and is still stripped', () => {
    const out = sanitizeEffectsValue({ compressorBypass: true }) as Record<string, unknown>;
    expect('compressorBypass' in out).toBe(false);
  });
});
