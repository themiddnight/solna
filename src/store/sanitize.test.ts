import { describe, expect, test } from 'bun:test';
import {
  asLeadNoteMatrix,
  clampFinite,
  isPlainObject,
  sanitizeEffectsValue,
  sanitizeLoops,
  sanitizeTrackArp,
  sanitizeTrackSynth,
} from './sanitize';
import { INITIAL_EFFECTS, TRACK_ARP_DEFAULTS } from './initialState';
import { TRACK_SYNTH_DEFAULTS } from '@/store/initialState';
import { createDefaultLoop } from './loopSlice';
import type { BassStepChoice } from '@/data/bassPatterns';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import { MAX_CUSTOM_PATTERN_BARS } from './loop';
import type { ChordItem } from '../types';

describe('sanitize (shared by persist hydration and project import)', () => {
  test('isPlainObject accepts a record and rejects arrays, null and primitives', () => {
    expect(isPlainObject({ a: 1 })).toBe(true);
    expect(isPlainObject([1, 2])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject('object')).toBe(false);
  });

  test('clampFinite rejects NaN, strings and out-of-range numbers', () => {
    expect(clampFinite('fast', 20, 300, 120)).toBe(120);
    expect(clampFinite(Number.NaN, 20, 300, 120)).toBe(120);
    expect(clampFinite(999, 20, 300, 120)).toBe(300);
    expect(clampFinite(90, 20, 300, 120)).toBe(90);
  });

  test('sanitizeTrackSynth passes a complete valid patch through unchanged', () => {
    const valid = structuredClone(TRACK_SYNTH_DEFAULTS.bass);
    expect(sanitizeTrackSynth(valid, 'bass')).toEqual(valid);
  });

  test('sanitizeTrackSynth clamps a finite out-of-range value in place', () => {
    const patch = structuredClone(TRACK_SYNTH_DEFAULTS.synth);
    patch.patch.synth.filter.resonance = 40;
    const out = sanitizeTrackSynth(patch, 'synth');
    // Clamped, not discarded: a number in the right unit that is merely out of
    // range is a value to pull back, not a body to throw away.
    expect(out.patch.synth.filter.resonance).toBe(1);
    expect(out.patch.synth.filter.cutoffHz).toBe(TRACK_SYNTH_DEFAULTS.synth.patch.synth.filter.cutoffHz);
  });

  test('a flat legacy SynthParams body falls back to the TARGET\'s complete default', () => {
    // A flat body is not an old version of this shape, it is an invalid one —
    // there are no migration chains, so it is validated and replaced whole.
    // The fallback is the TARGET's default, so importing a legacy bass body
    // gives a bass sound rather than Lead's.
    const legacy = { oscType: 'sawtooth', filterCutoff: 2400, attack: 0.02, release: 0.5 };
    expect(sanitizeTrackSynth(legacy, 'bass')).toEqual(TRACK_SYNTH_DEFAULTS.bass);
    expect(sanitizeTrackSynth(legacy, 'pad')).toEqual(TRACK_SYNTH_DEFAULTS.pad);
  });

  test('an unknown engine falls back whole rather than keeping the patch', () => {
    const alien = { ...structuredClone(TRACK_SYNTH_DEFAULTS.synth), engine: 'fm' };
    expect(sanitizeTrackSynth(alien, 'synth')).toEqual(TRACK_SYNTH_DEFAULTS.synth);
  });

  test('the fallback is a fresh copy, so a sanitised loop can never alias the factory default', () => {
    const out = sanitizeTrackSynth('nonsense', 'synth');
    expect(out).toEqual(TRACK_SYNTH_DEFAULTS.synth);
    expect(out).not.toBe(TRACK_SYNTH_DEFAULTS.synth);
    expect(out.patch.synth.oscillators).not.toBe(TRACK_SYNTH_DEFAULTS.synth.patch.synth.oscillators);
  });

  test('sanitizeTrackArp keeps a valid value and falls back whole on any invalid field', () => {
    expect(sanitizeTrackArp({ active: true, mode: 'down', rate: '8n', octaves: 2 }, 'synth'))
      .toEqual({ active: true, mode: 'down', rate: '8n', octaves: 2 });
    // Whole-value, never a partial merge: `mode` is not an arp mode, so the
    // valid `active: true` beside it goes with it.
    expect(sanitizeTrackArp({ active: true, mode: 'sideways', rate: '8n', octaves: 2 }, 'synth'))
      .toEqual(TRACK_ARP_DEFAULTS.synth);
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

  // Four enumerated fields each name a real library entry, so an id outside
  // that library's set is invalid input, not "unknown but honoured": a stale
  // session holding an id a rename retired must fall back to the default
  // rather than resolve to nothing. (The Beat preset id is the fifth such
  // field and is checked in sanitizeBeat.test.ts, where it falls back
  // differently — the stored PATCH is kept and only its base is dropped.)
  test('sanitizeLoops falls back an unrecognised pattern id / scale to the default loop', () => {
    const fallback = createDefaultLoop();
    const loop = {
      ...fallback,
      bassPatternId: 'bp-ghost',
      chordRhythmId: 'rhythm-ghost',
      scaleRoot: 'H#',
      scaleType: 'bogus-scale',
    };
    const [out] = sanitizeLoops([loop]) ?? [];
    expect(out.bassPatternId).toBe(fallback.bassPatternId);
    expect(out.chordRhythmId).toBe(fallback.chordRhythmId);
    expect(out.scaleRoot).toBe(fallback.scaleRoot);
    expect(out.scaleType).toBe(fallback.scaleType);
  });

  test('sanitizeLoops keeps a valid pattern id / scale untouched', () => {
    const [out] = sanitizeLoops([
      { ...createDefaultLoop(), scaleRoot: 'F#', scaleType: 'Major' },
    ]) ?? [];
    expect(out.scaleRoot).toBe('F#');
    expect(out.scaleType).toBe('Major');
  });
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
    // A hold is a finite positive integer, so a zero, a negative, a fraction or
    // a string is invalid INPUT — and the whole array falls back rather than
    // repairing element by element, so one bad slot cannot leave a lane whose
    // holds no longer line up with its values.
    ['customChordHoldSteps with a zero', 'customChordHoldSteps', [1, 0]],
    ['customChordHoldSteps with a negative', 'customChordHoldSteps', [1, -4]],
    ['customBassHoldSteps with a fraction', 'customBassHoldSteps', [1, 1.5]],
    ['customBassHoldSteps of strings', 'customBassHoldSteps', ['one', 'two']],
    ['customChordHoldSteps that is not an array', 'customChordHoldSteps', 'ones'],
    ['customChordLoopLength of zero', 'customChordLoopLength', 0],
    ['customBassLoopLength of a string', 'customBassLoopLength', 'two'],
    ['leadMelodySteps that is not a matrix', 'leadMelodySteps', ['C4', 'D4']],
    ['leadMelodySteps of numbers', 'leadMelodySteps', [[60], [62]]],
  ];
  for (const [label, key, value] of cases) {
    test(`${label} falls back to the default loop's value`, () => {
      expect(field(key, value)).toEqual(fallback[key]);
    });
  }

  // The drum roster's own per-row validation moved OUT of this file with the
  // array it validated. A voice-keyed `beatPattern`/`beatMix` has no rows to
  // drop and no roster to shrink, and reading a body written in the old shape
  // is `sanitizeBeat.ts`'s job — including dropping a row naming a voice the
  // roster does not have, which is covered in sanitizeBeat.test.ts.

  test('valid elements are kept as they are', () => {
    const loop = createDefaultLoop();
    const bass: BassStepChoice[] = new Array<BassStepChoice>(MAX_STEPS_PER_BAR).fill('rest');
    bass[0] = 'rest';
    bass[1] = 'root';
    bass[2] = 'octave';
    const [out] = sanitizeLoops([{ ...loop, customBassPattern: bass }]) ?? [];
    expect(out.chords).toEqual(loop.chords);
    expect(out.beatPattern).toEqual(loop.beatPattern);
    expect(out.customBassPattern).toEqual(bass);
  });

  test('a short value array is padded out to the lane width, not left ragged', () => {
    // The lane's arrays are always exactly `loopLength * MAX_STEPS_PER_BAR`
    // long, in the storage space every consumer indexes bar-major. A short
    // array from a hand-edited file would otherwise leave the tail undefined.
    const [out] = sanitizeLoops([
      { ...createDefaultLoop(), customBassPattern: ['rest', 'root', 'octave'] },
    ]) ?? [];
    expect(out.customBassPattern).toHaveLength(MAX_STEPS_PER_BAR);
    expect(out.customBassPattern.slice(0, 3)).toEqual(['rest', 'root', 'octave']);
    expect(out.customBassPattern.slice(3).every((v) => v === 'rest')).toBe(true);
  });
});

// The four keys this feature adds, on the read path. There is no version-gated
// upgrade: a body written before the keys existed simply lacks them, and every
// missing key takes its default through the same validation every other key
// goes through.
describe('sanitizeLoops validates the custom pattern spans without a migration gate', () => {
  const threeBarChords = (): ChordItem[] => [
    { id: 'c1', root: 'A', quality: 'min7', bars: 2, notes: ['A3', 'C4', 'E4', 'G4'] },
    { id: 'c2', root: 'F', quality: 'maj7', bars: 1, notes: ['F3', 'A3', 'C4', 'E4'] },
  ];

  const bareLoop = (): Record<string, unknown> => {
    const bare = { ...createDefaultLoop() } as unknown as Record<string, unknown>;
    delete bare.customChordLoopLength;
    delete bare.customChordHoldSteps;
    delete bare.customBassLoopLength;
    delete bare.customBassHoldSteps;
    return bare;
  };

  test('a body with no custom pattern keys reads back at one bar of one-step holds', () => {
    const [out] = sanitizeLoops([bareLoop()]) ?? [];
    expect(out.customChordLoopLength).toBe(1);
    expect(out.customChordHoldSteps).toEqual(new Array<number>(MAX_STEPS_PER_BAR).fill(1));
    expect(out.customBassLoopLength).toBe(1);
    expect(out.customBassHoldSteps).toEqual(new Array<number>(MAX_STEPS_PER_BAR).fill(1));
  });

  test('the old shape keeps its onsets and defaults every hold to one step', () => {
    const old = new Array<boolean>(MAX_STEPS_PER_BAR).fill(false);
    old[0] = true;
    old[8] = true;
    const [out] = sanitizeLoops([{ ...bareLoop(), customChordRhythm: old }]) ?? [];
    expect(out.customChordRhythm[0]).toBe(true);
    expect(out.customChordRhythm[8]).toBe(true);
    expect(out.customChordHoldSteps[0]).toBe(1);
    expect(out.customChordHoldSteps[8]).toBe(1);
    expect(out.customChordRhythm).toHaveLength(MAX_STEPS_PER_BAR);
  });

  test('a valid hold array survives and an imported crossing hold clamps to the cycle', () => {
    // Two 4/4 bars: the cycle is 32 visible columns even though storage keeps
    // a 24-slot stride. The four one-bar chords fold a boundary onto column 16,
    // so a hold reaching far past bar one is cut there —
    // and an onset sitting on that boundary keeps its own legal length rather
    // than being swallowed by the span before it.
    const values = new Array<boolean>(MAX_STEPS_PER_BAR * 2).fill(false);
    values[0] = true;
    values[MAX_STEPS_PER_BAR] = true;
    const holds = new Array<number>(MAX_STEPS_PER_BAR * 2).fill(1);
    holds[0] = 99; // reaches far past the folded chord boundary at column 16
    holds[MAX_STEPS_PER_BAR] = 4;
    const [out] = sanitizeLoops([
      {
        ...createDefaultLoop(),
        customChordLoopLength: 2,
        customChordRhythm: values,
        customChordHoldSteps: holds,
      },
    ]) ?? [];
    expect(out.customChordHoldSteps[0]).toBe(16);
    expect(out.customChordHoldSteps[MAX_STEPS_PER_BAR]).toBe(4);
  });

  test('an imported span deletes the onsets it covers, deterministically', () => {
    const values = new Array<boolean>(MAX_STEPS_PER_BAR).fill(false);
    values[0] = true;
    values[4] = true;
    const holds = new Array<number>(MAX_STEPS_PER_BAR).fill(1);
    holds[0] = 8;
    const [out] = sanitizeLoops([
      { ...createDefaultLoop(), customChordRhythm: values, customChordHoldSteps: holds },
    ]) ?? [];
    expect(out.customChordRhythm[0]).toBe(true);
    expect(out.customChordHoldSteps[0]).toBe(8);
    expect(out.customChordRhythm[4]).toBe(false);
    expect(out.customChordHoldSteps[4]).toBe(1);
  });

  test('the loop length clamps to a divisor of the progression and resizes the arrays', () => {
    // Four one-bar chords: 3 is not a cycle they repeat evenly, so the cycle
    // lowers to 2 and both arrays come back two bars wide.
    const [out] = sanitizeLoops([{ ...createDefaultLoop(), customChordLoopLength: 3 }]) ?? [];
    expect(out.customChordLoopLength).toBe(2);
    expect(out.customChordRhythm).toHaveLength(2 * MAX_STEPS_PER_BAR);
    expect(out.customChordHoldSteps).toHaveLength(2 * MAX_STEPS_PER_BAR);
  });

  test('a longer length is kept when the progression can divide it', () => {
    const [out] = sanitizeLoops([
      {
        ...createDefaultLoop(),
        chords: threeBarChords(),
        customBassLoopLength: 3,
      },
    ]) ?? [];
    expect(out.customBassLoopLength).toBe(3);
    expect(out.customBassPattern).toHaveLength(3 * MAX_STEPS_PER_BAR);
  });
});

// The two read-time rules the store-schema review turned up, both about what an
// UNTRUSTED body can make this path do: widen the arrays under a dormant bar,
// or size an allocation no project could hold.
describe('sanitizeLoops keeps the custom pattern lanes dormant-safe and bounded', () => {
  test('a lane stored wider than its clamped cycle keeps its dormant bars', () => {
    // Three stored bars under a two-bar cycle — the shape a save leaves behind
    // after setChords lowered the length. Reading it back is not the gesture
    // that gets to delete the third bar: raising the length again is what
    // brings its onsets back, and that promise has to survive save -> load.
    const values = new Array<boolean>(MAX_STEPS_PER_BAR * 3).fill(false);
    values[2 * MAX_STEPS_PER_BAR] = true;
    const holds = new Array<number>(MAX_STEPS_PER_BAR * 3).fill(1);
    const [out] = sanitizeLoops([
      {
        ...createDefaultLoop(),
        customChordLoopLength: 2,
        customChordRhythm: values,
        customChordHoldSteps: holds,
      },
    ]) ?? [];
    expect(out.customChordLoopLength).toBe(2);
    expect(out.customChordRhythm).toHaveLength(3 * MAX_STEPS_PER_BAR);
    expect(out.customChordRhythm[2 * MAX_STEPS_PER_BAR]).toBe(true);
    expect(out.customChordHoldSteps).toHaveLength(3 * MAX_STEPS_PER_BAR);
  });

  test('a crafted bar count sanitizes to a bounded cycle without throwing', () => {
    // Both inputs are accepted by their own validators — a positive integer
    // loop length, a finite positive `bars` — and their product is the lane's
    // width, so without a ceiling this body asks for ~2.4e10 slots. Treated as
    // an ordinary input: the cycle comes back as a real divisor at the ceiling
    // and the arrays are that cycle wide, not the crafted number.
    const [out] = sanitizeLoops([
      {
        ...createDefaultLoop(),
        chords: [{ id: 'c', root: 'A', quality: 'min', bars: 1e9, notes: ['A3'] }],
        customChordLoopLength: 1e9,
        customBassLoopLength: 1e9,
      },
    ]) ?? [];
    expect(out.customChordLoopLength).toBe(MAX_CUSTOM_PATTERN_BARS);
    expect(out.customChordRhythm).toHaveLength(MAX_CUSTOM_PATTERN_BARS * MAX_STEPS_PER_BAR);
    expect(out.customChordHoldSteps).toHaveLength(MAX_CUSTOM_PATTERN_BARS * MAX_STEPS_PER_BAR);
    expect(out.customBassLoopLength).toBe(MAX_CUSTOM_PATTERN_BARS);
    expect(out.customBassPattern).toHaveLength(MAX_CUSTOM_PATTERN_BARS * MAX_STEPS_PER_BAR);
    // Every hold survived the arithmetic as a real hold, not as a NaN the pad
    // path would have produced from a non-finite width.
    expect(out.customChordHoldSteps.every((hold) => Number.isInteger(hold) && hold >= 1)).toBe(true);
    expect(out.customBassHoldSteps.every((hold) => Number.isInteger(hold) && hold >= 1)).toBe(true);
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
