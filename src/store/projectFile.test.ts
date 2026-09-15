import { describe, expect, test } from 'bun:test';
import { normalizeStoredBody, parseProjectFile, serializeProject, unknownLibraryReferences } from './projectFile';
import { PROJECT_FORMAT_VERSION, factoryProjectContent, makeEnvelope } from './projectFormat';
import { createDefaultLoop } from './loopSlice';
import { LOOP_FLAT_KEYS, MAX_CUSTOM_PATTERN_BARS } from './loop';
import type { BassStepChoice } from '@/data/bassPatterns';
import type { Loop } from './types';
import { MAX_STEPS_PER_BAR } from '../utils/meter';

const body = { ...makeEnvelope('Round Trip', 1_700_000_000_000), content: factoryProjectContent() };

describe('serializeProject / parseProjectFile round trip', () => {
  test('every envelope field and every content key survives', () => {
    const result = parseProjectFile(serializeProject(body));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.id).toBe(body.id);
    expect(result.body.name).toBe('Round Trip');
    expect(result.body.createdAt).toBe(body.createdAt);
    expect(result.body.updatedAt).toBe(body.updatedAt);
    expect(result.body.formatVersion).toBe(PROJECT_FORMAT_VERSION);
    expect(result.body.content.bpm).toBe(120);
    expect(result.body.content.loops).toHaveLength(1);
    for (const key of LOOP_FLAT_KEYS) {
      expect(result.body.content.loops[0][key]).toEqual(body.content.loops[0][key]);
    }
    expect(result.warnings).toEqual([]);
  });

  test('the file is plain JSON a text editor can read', () => {
    expect(JSON.parse(serializeProject(body)).content.bpm).toBe(120);
  });
});

describe('parseProjectFile rejections (table-driven)', () => {
  const cases: Array<[string, string, 'malformed' | 'newer-version']> = [
    ['bad JSON', '{ not json', 'malformed'],
    ['empty file', '', 'malformed'],
    ['array root', '[]', 'malformed'],
    ['null root', 'null', 'malformed'],
    ['missing id', JSON.stringify({ ...body, id: undefined }), 'malformed'],
    ['numeric name', JSON.stringify({ ...body, name: 7 }), 'malformed'],
    ['string createdAt', JSON.stringify({ ...body, createdAt: 'yesterday' }), 'malformed'],
    ['missing content', JSON.stringify({ ...body, content: undefined }), 'malformed'],
    ['formatVersion missing', JSON.stringify({ ...body, formatVersion: undefined }), 'malformed'],
    ['formatVersion from the future', JSON.stringify({ ...body, formatVersion: PROJECT_FORMAT_VERSION + 1 }), 'newer-version'],
  ];
  for (const [label, text, error] of cases) {
    test(label, () => {
      const result = parseProjectFile(text);
      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.error).toBe(error);
        expect(result.message.length).toBeGreaterThan(0);
      }
    });
  }

  test('the newer-version message is the spec copy', () => {
    const result = parseProjectFile(JSON.stringify({ ...body, formatVersion: 99 }));
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.message).toBe('This project was saved by a newer version of Solna.');
    }
  });
});

describe('parseProjectFile sanitises wrong-typed content instead of refusing', () => {
  test('bpm string, effects string, loops string all fall back', () => {
    const text = JSON.stringify({ ...body, content: { bpm: 'fast', effects: 'wet', loops: 'many' } });
    const result = parseProjectFile(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.content.bpm).toBe(120);
    expect(result.body.content.masterVolume).toBe(0); // DEFAULT_FADER_DB (unity 0 dB)
    expect(result.body.content.meterId).toBe('4/4');
    expect(typeof result.body.content.effects.reverbWet).toBe('number');
    expect(result.body.content.loops).toHaveLength(1);
  });

  // A file arrives from somebody else's device: an array of the RIGHT shape
  // holding the WRONG elements must not reach the store either.
  test('a loop whose chords are numbers imports with the default progression', () => {
    const loop = { ...createDefaultLoop(), chords: [1, 2, 3] };
    const result = parseProjectFile(JSON.stringify({ ...body, content: { ...body.content, loops: [loop] } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.content.loops[0].chords).toEqual(createDefaultLoop().chords);
  });

  test('an empty loops array becomes one default loop', () => {
    const result = parseProjectFile(JSON.stringify({ ...body, content: { ...body.content, loops: [] } }));
    expect(result.ok && result.body.content.loops).toHaveLength(1);
  });

  // DEV-386 fix round 2, re-homed: a .solna body is an external contract, not
  // this app's own localStorage, so a malformed fader inside it is ordinary
  // untrusted input and an unguarded read reaches faderDbToGain, which fails
  // SAFE TO SILENCE. The per-voice faders now live inside `beatMix`, and both
  // cases are still asserted through the real import path (parseProjectFile),
  // not by calling a sanitize helper directly.
  test('an out-of-range Beat voice level imports at its default, not clamped or silenced', () => {
    const fallback = createDefaultLoop();
    const loop = {
      ...fallback,
      beatMix: {
        ...fallback.beatMix,
        voices: { ...fallback.beatMix.voices, kick: { levelDb: 999, muted: false } },
      },
    };
    const result = parseProjectFile(JSON.stringify({ ...body, content: { ...body.content, loops: [loop] } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // DEFAULT_FADER_DB (unity): 999's UNIT is unknown, not just its
    // magnitude, so it is not clamped to FADER_MAX_DB — and not silenced.
    expect(result.body.content.loops[0].beatMix.voices.kick.levelDb).toBe(0);
  });

  test('a non-numeric Beat voice level imports at unity, not silence', () => {
    const fallback = createDefaultLoop();
    const loop = {
      ...fallback,
      beatMix: {
        ...fallback.beatMix,
        voices: { ...fallback.beatMix.voices, kick: { levelDb: 'loud', muted: false } },
      },
    };
    const result = parseProjectFile(JSON.stringify({ ...body, content: { ...body.content, loops: [loop] } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // asFaderDb's fallback for a non-finite/wrong-typed value is
    // DEFAULT_FADER_DB (0 dB, unity) — the safe direction. Before this fix,
    // an unclamped garbage value reached faderDbToGain, which maps anything
    // non-finite to a LINEAR gain of exactly 0: a muted drum voice, silently.
    expect(result.body.content.loops[0].beatMix.voices.kick.levelDb).toBe(0);
  });

  // sanitizeLoops validates these against their own libraries, so an unknown
  // id falls back to the default loop's value INSIDE sanitizeContent, before
  // unknownLibraryReferences ever sees it — the import still succeeds, but
  // nothing "unknown" survives to import verbatim or to warn about. The Beat
  // preset id is the exception and is deliberately not asserted here: a
  // `.solna` may legitimately name a preset from a library THIS browser does
  // not have, so it is resolved against the factory set only and an
  // unresolvable base is recorded as `null` with the stored patch kept.
  test('unknown bassPatternId / chordRhythmId fall back to the default loop, with no warning', () => {
    const fallback = createDefaultLoop();
    const loop = {
      ...fallback,
      bassPatternId: 'bp-ghost',
      chordRhythmId: 'cr-ghost',
    };
    const result = parseProjectFile(JSON.stringify({ ...body, content: { ...body.content, loops: [loop] } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.content.loops[0].bassPatternId).toBe(fallback.bassPatternId);
    expect(result.body.content.loops[0].chordRhythmId).toBe(fallback.chordRhythmId);
    expect(result.warnings).toHaveLength(0);
  });

  // Regression: sanitizeContent is the SECOND producer of a ProjectContent
  // (buildProjectContent in projectFormat.ts is the first) and used to assign
  // sanitizeLoops' full Loop[] straight into the ProjectLoop[]-typed field
  // with no strip — so a loop that carried an explicit tempName (or fell
  // back to sanitizeLoops' synthesized one) rode straight through into a
  // parsed body. That body reaches normalizeStoredBody's callers unstripped
  // too (the library load, and an opened file), permanently writing tempName
  // into a stored/exported project. Both loop.ts and normalizeStoredBody route
  // through this same sanitizeContent, so pinning it here covers both paths.
  test('strips tempName from every loop, explicit or synthesized', () => {
    const withExplicit = { ...createDefaultLoop(), tempName: 'my-slot-name' };
    const result = parseProjectFile(JSON.stringify({ ...body, content: { ...body.content, loops: [withExplicit] } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.body.content.loops[0] as unknown as Record<string, unknown>).tempName).toBeUndefined();
  });
});

// The defect this pins: `normalizeStoredBody` is the IndexedDB slot reader —
// the path EVERY session takes, before any file is opened — and it sanitised
// with no warnings at all while opening a `.solna` had just learned to warn. A
// user whose stored project held a patch this build cannot read got all five
// track sounds replaced by factory defaults on the first boot, silently.
describe('the Beat instrument through the real import path', () => {
  const contentWith = (loop: Loop | Record<string, unknown>) =>
    JSON.stringify({ ...body, content: { ...body.content, loops: [loop] } });

  test('a current-shape body keeps the Beat sound, pattern and mix it carries', () => {
    const loop = createDefaultLoop();
    loop.beatParams = { ...loop.beatParams, basePresetId: 'trap-beat' };
    loop.beatPattern.rows.kick[0] = true;
    loop.beatMix.voices.snare = { levelDb: -4.5, muted: true };

    const result = parseProjectFile(contentWith(loop));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const read = result.body.content.loops[0];
    expect(read.beatParams.basePresetId).toBe('trap-beat');
    expect(read.beatPattern.rows.kick[0]).toBe(true);
    expect(read.beatMix.voices.snare).toEqual({ levelDb: -4.5, muted: true });
  });

  test('an unknown Beat base is dropped to null and the complete patch imports intact', () => {
    // Provenance ONLY: a base is a label on a patch, and the patch is all
    // here. An id this build cannot resolve — a user preset saved in another
    // browser — reads back as `null` and rejects nothing, warns about nothing
    // and changes not one parameter of the sound.
    const loop = createDefaultLoop();
    const sent = structuredClone(loop.beatParams);
    sent.basePresetId = 'user-beat-from-another-browser';
    sent.voices.kick.decay = 0.41;

    const result = parseProjectFile(contentWith({ ...loop, beatParams: sent } as unknown as Record<string, unknown>));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const read = result.body.content.loops[0];
    expect(read.beatParams.basePresetId).toBeNull();
    expect(read.beatParams.voices.kick.decay).toBe(0.41);
    expect(read.beatParams.voices).toEqual(sent.voices);
    expect(read.beatParams.filter).toEqual(sent.filter);
    expect(result.warnings).toEqual([]);
  });

  // The OTHER read shape — a body written before the Beat instrument existed,
  // carrying the kit-name-only drum state — is exercised in
  // `sanitizeBeat.test.ts`, through this same `parseProjectFile` entry point.
  // It lives there rather than here because the old field names may appear in
  // exactly three files (`beatLegacyBoundary.test.ts` holds that line), and
  // the suite that owns the conversion is the honest home for the test that
  // proves the conversion is wired into the import.

  test('a garbage Beat body falls back without taking its siblings down', () => {
    const loop = createDefaultLoop() as unknown as Record<string, unknown>;
    loop.beatParams = 'loud';
    loop.beatPattern = { rows: { kick: 'four on the floor' } };
    loop.beatMix = 7;

    const result = parseProjectFile(contentWith(loop));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const read = result.body.content.loops[0];
    expect(read.beatParams.voices.kick).toEqual(createDefaultLoop().beatParams.voices.kick);
    expect(read.beatPattern.rows.kick).toHaveLength(MAX_STEPS_PER_BAR);
    expect(read.beatPattern.rows.kick.every((hit) => !hit)).toBe(true);
    expect(read.beatMix.voices.kick.muted).toBe(false);
    // The rest of the loop is untouched by a bad Beat body.
    expect(read.chords).toEqual(createDefaultLoop().chords);
  });
});

describe('normalizeStoredBody names what the read could not carry', () => {
  const storedWith = (loop: Record<string, unknown>) =>
    ({
      ...makeEnvelope('In The Slot', 1_700_000_000_000),
      content: { ...factoryProjectContent(), loops: [{ ...createDefaultLoop(), ...loop }] },
    }) as unknown as Parameters<typeof normalizeStoredBody>[0];

  test('an unreadable synth patch is reported by its track name', () => {
    const { body, warnings } = normalizeStoredBody(storedWith({ synthParams: { engine: 'nope', patch: 7 } }));
    expect(warnings).toEqual(['Lead sound (reset to the default)']);
    // And the body still loads — sanitisation resets the patch, it never
    // refuses the project.
    expect(body.content.loops[0].synthParams.engine).toBe('subtractive');
  });

  test('a body every track of which reads fine warns about nothing', () => {
    expect(normalizeStoredBody(storedWith({})).warnings).toEqual([]);
  });

  test('the slot read resolves a base against the ids it is GIVEN, the import against factory ids only', () => {
    // The one asymmetry between this reader and parseProjectFile, both halves
    // pinned on one body: the local slot is read on the machine whose library
    // the base names, so the caller hands its ids in and the base survives; a
    // `.solna` may come from anywhere, so the same id is unresolvable and
    // becomes null with the complete patch untouched.
    const base = createDefaultLoop().beatParams;
    const stored = storedWith({ beatParams: { ...base, basePresetId: 'user-beat-local' } });

    const local = normalizeStoredBody(stored, new Set(['retro-drive', 'user-beat-local']));
    expect(local.body.content.loops[0].beatParams.basePresetId).toBe('user-beat-local');

    const factoryOnly = normalizeStoredBody(stored);
    expect(factoryOnly.body.content.loops[0].beatParams.basePresetId).toBeNull();
    expect(factoryOnly.body.content.loops[0].beatParams.voices).toEqual(base.voices);
  });

  test('a body from a newer build is returned verbatim and warns about nothing', () => {
    const newer = { ...storedWith({ synthParams: { engine: 'nope', patch: 7 } }), formatVersion: PROJECT_FORMAT_VERSION + 1 };
    const { body, warnings } = normalizeStoredBody(newer);
    // Nothing was sanitised out of it, so there is nothing to report — and the
    // patch this build cannot read is still there for the build that can.
    expect(warnings).toEqual([]);
    expect(body).toBe(newer);
  });
});

// The four keys this feature adds, through the REAL import path rather than by
// calling sanitizeLoops directly — a `.solna` file from another device is the
// input these rules exist for.
describe('the custom pattern spans through the real import path', () => {
  const importLoop = (loop: unknown) => {
    const result = parseProjectFile(
      JSON.stringify({ ...body, content: { ...body.content, loops: [loop] } }),
    );
    if (!result.ok) throw new Error('parseProjectFile refused a loop fixture');
    return result.body.content.loops[0];
  };

  const bareLoop = (): Record<string, unknown> => {
    const bare = { ...createDefaultLoop() } as unknown as Record<string, unknown>;
    delete bare.customChordLoopLength;
    delete bare.customChordHoldSteps;
    delete bare.customBassLoopLength;
    delete bare.customBassHoldSteps;
    return bare;
  };

  test('a loop saved before the keys existed imports at one bar of one-step holds', () => {
    const old = new Array<boolean>(MAX_STEPS_PER_BAR).fill(false);
    old[0] = true;
    const loop = importLoop({ ...bareLoop(), customChordRhythm: old });
    expect(loop.customChordLoopLength).toBe(1);
    expect(loop.customChordHoldSteps).toEqual(new Array<number>(MAX_STEPS_PER_BAR).fill(1));
    expect(loop.customChordRhythm[0]).toBe(true);
    expect(loop.customBassLoopLength).toBe(1);
    expect(loop.customBassHoldSteps).toEqual(new Array<number>(MAX_STEPS_PER_BAR).fill(1));
  });

  test('an invalid hold array falls back whole and keeps the value array', () => {
    const values = new Array<BassStepChoice>(MAX_STEPS_PER_BAR).fill('rest');
    values[0] = 'root';
    const loop = importLoop({
      ...createDefaultLoop(),
      customBassPattern: values,
      customBassHoldSteps: [3, 0, 1],
    });
    expect(loop.customBassHoldSteps).toEqual(new Array<number>(MAX_STEPS_PER_BAR).fill(1));
    expect(loop.customBassPattern[0]).toBe('root');
  });

  test('a two-bar body round-trips its loop length and its holds', () => {
    const values = new Array<boolean>(MAX_STEPS_PER_BAR).fill(false);
    values[0] = true;
    const holds = new Array<number>(MAX_STEPS_PER_BAR * 2).fill(1);
    holds[0] = 3;
    const loop = importLoop({
      ...createDefaultLoop(),
      customChordRhythm: values,
      customChordHoldSteps: holds,
      customChordLoopLength: 2,
    });
    expect(loop.customChordLoopLength).toBe(2);
    expect(loop.customChordRhythm).toHaveLength(2 * MAX_STEPS_PER_BAR);
    expect(loop.customChordHoldSteps[0]).toBe(3);
  });

  test('a dormant bar beyond the clamped cycle survives a save -> load round trip', () => {
    // The shape a save leaves behind once setChords has lowered the cycle to
    // two bars while the lane is still three stored bars wide. The dormant
    // third bar is exactly what raising the length again restores, so the read
    // path must not trim it — a save -> load that trimmed would quietly delete
    // the user's work every time they opened the project.
    const values = new Array<boolean>(MAX_STEPS_PER_BAR * 3).fill(false);
    values[2 * MAX_STEPS_PER_BAR] = true;
    const loop = {
      ...createDefaultLoop(),
      customChordLoopLength: 2,
      customChordRhythm: values,
    };
    const roundTripped = parseProjectFile(
      serializeProject({ ...body, content: { ...body.content, loops: [loop] } }),
    );
    if (!roundTripped.ok) throw new Error('parseProjectFile refused a loop fixture');

    const [loaded] = roundTripped.body.content.loops;
    expect(loaded.customChordLoopLength).toBe(2);
    expect(loaded.customChordRhythm).toHaveLength(3 * MAX_STEPS_PER_BAR);
    expect(loaded.customChordRhythm[2 * MAX_STEPS_PER_BAR]).toBe(true);
  });

  test('a crafted bar count cannot size the lane past the shared ceiling', () => {
    const loop = importLoop({
      ...createDefaultLoop(),
      chords: [{ id: 'c', root: 'A', quality: 'min', bars: 1e9, notes: ['A3'] }],
      customChordLoopLength: 1e9,
    });
    expect(loop.customChordLoopLength).toBe(MAX_CUSTOM_PATTERN_BARS);
    expect(loop.customChordRhythm).toHaveLength(MAX_CUSTOM_PATTERN_BARS * MAX_STEPS_PER_BAR);
  });
});

// The cross-boundary fixture every contract-locking suite in this task shares
// the shape of: ONE loop whose Chord lane runs TWO bars and whose Bass lane
// runs FOUR over the same four one-bar chords, with an explicit hold on every
// onset. The asymmetry is the contract — a lane's cycle is an INDEPENDENT
// divisor of the progression's bars, so a round trip must return each lane at
// its own width rather than cutting one to the other's or to a single bar.
//
// This file owns the STORAGE half of the assertion: a `.solna` body carries no
// meter (`meterId` is session state), so a column here IS its stored slot and
// everything is bar-major at `MAX_STEPS_PER_BAR`. That the same rows draw and
// play as twelve-column bars is the active-meter half, asserted where the
// meter actually exists — the store setters, the panel render, the mixdown.
const THREE_FOUR = 12; // `METERS['3/4'].stepsPerBar` — the non-4/4 meter these lanes play in

/** The fixture loop, at full storage width: 2 chord bars, 4 bass bars. */
function customPatternLoop(): Loop {
  const chord = new Array<boolean>(2 * MAX_STEPS_PER_BAR).fill(false);
  chord[0] = true;
  chord[MAX_STEPS_PER_BAR] = true;
  // One hold per onset, and 12 is legal against BOTH boundary maps: the storage
  // space folds the progression onto stored step 24 (the widest meter's bar),
  // and the active 3/4 meter folds it onto column 12. A hold that cleared one
  // and not the other would be silently rewritten by the first read.
  const chordHolds = new Array<number>(2 * MAX_STEPS_PER_BAR).fill(1);
  chordHolds[0] = THREE_FOUR;
  chordHolds[MAX_STEPS_PER_BAR] = THREE_FOUR;

  const bass = new Array<BassStepChoice>(4 * MAX_STEPS_PER_BAR).fill('rest');
  const bassHolds = new Array<number>(4 * MAX_STEPS_PER_BAR).fill(1);
  const tones: BassStepChoice[] = ['root', 'third', 'fifth', 'seventh'];
  tones.forEach((tone, bar) => {
    bass[bar * MAX_STEPS_PER_BAR] = tone;
    bassHolds[bar * MAX_STEPS_PER_BAR] = THREE_FOUR;
  });

  return {
    ...createDefaultLoop(),
    id: 'loop-custom',
    customChordRhythm: chord,
    customChordHoldSteps: chordHolds,
    customChordLoopLength: 2,
    customBassPattern: bass,
    customBassHoldSteps: bassHolds,
    customBassLoopLength: 4,
  };
}

function roundTrip(loop: Loop) {
  const result = parseProjectFile(
    serializeProject({ ...body, content: { ...body.content, loops: [loop] } }),
  );
  if (!result.ok) throw new Error(`parseProjectFile refused the fixture: ${result.message}`);
  return { loaded: result.body.content.loops[0], warnings: result.warnings };
}

describe('the two-lane custom pattern fixture round-trips a project file', () => {
  test('each lane keeps its own cycle and its holds, bar-major, with no repair', () => {
    const { loaded, warnings } = roundTrip(customPatternLoop());

    // No warning and no throw: valid input is passed through untouched.
    expect(warnings).toEqual([]);

    // Independent cycles: the bass lane is not cut to the chord lane's width.
    expect(loaded.customChordLoopLength).toBe(2);
    expect(loaded.customBassLoopLength).toBe(4);
    // Bar-major at MAX_STEPS_PER_BAR, whatever meter plays them.
    expect(loaded.customChordRhythm).toHaveLength(2 * MAX_STEPS_PER_BAR);
    expect(loaded.customChordHoldSteps).toHaveLength(2 * MAX_STEPS_PER_BAR);
    expect(loaded.customBassPattern).toHaveLength(4 * MAX_STEPS_PER_BAR);
    expect(loaded.customBassHoldSteps).toHaveLength(4 * MAX_STEPS_PER_BAR);

    // Every onset and every hold sits on the STORED slot, never on a column.
    expect(loaded.customChordRhythm[0]).toBe(true);
    expect(loaded.customChordRhythm[MAX_STEPS_PER_BAR]).toBe(true);
    expect(loaded.customChordHoldSteps[0]).toBe(THREE_FOUR);
    expect(loaded.customChordHoldSteps[MAX_STEPS_PER_BAR]).toBe(THREE_FOUR);
    ['root', 'third', 'fifth', 'seventh'].forEach((tone, bar) => {
      expect(loaded.customBassPattern[bar * MAX_STEPS_PER_BAR]).toBe(tone);
      expect(loaded.customBassHoldSteps[bar * MAX_STEPS_PER_BAR]).toBe(THREE_FOUR);
    });
  });

  // Malformed variants. Every expected repair is a deterministic default or
  // clamp, reached through the same validation every other key goes through —
  // there is no version gate and nothing here may throw a migration error.
  test('a non-divisor loop length clamps to a divisor and leaves the taller bars dormant', () => {
    const { loaded } = roundTrip({
      ...customPatternLoop(),
      customChordLoopLength: 3,
      customBassLoopLength: 3,
    });

    // Four one-bar chords: 3 repeats unevenly, so both cycles lower to 2.
    expect(loaded.customChordLoopLength).toBe(2);
    expect(loaded.customBassLoopLength).toBe(2);

    // The chord lane was exactly two bars wide, so it is unchanged. The bass
    // lane is NOT trimmed to the clamped cycle — bars a shorter cycle cannot
    // reach stay stored and dormant, which is what raising the length again
    // restores.
    expect(loaded.customChordRhythm).toHaveLength(2 * MAX_STEPS_PER_BAR);
    expect(loaded.customBassPattern).toHaveLength(4 * MAX_STEPS_PER_BAR);
    expect(loaded.customBassPattern[3 * MAX_STEPS_PER_BAR]).toBe('seventh');
    expect(loaded.customBassHoldSteps[3 * MAX_STEPS_PER_BAR]).toBe(THREE_FOUR);
  });

  test('a too-short hold array is padded parallel to its values, never left ragged', () => {
    const { loaded } = roundTrip({
      ...customPatternLoop(),
      customChordHoldSteps: [THREE_FOUR],
    });

    expect(loaded.customChordHoldSteps).toHaveLength(2 * MAX_STEPS_PER_BAR);
    expect(loaded.customChordHoldSteps[0]).toBe(THREE_FOUR);
    // The onset at the second bar keeps its VALUE and loses only its duration,
    // which is the honest repair: a missing hold is a one-step hold.
    expect(loaded.customChordRhythm[MAX_STEPS_PER_BAR]).toBe(true);
    expect(loaded.customChordHoldSteps[MAX_STEPS_PER_BAR]).toBe(1);
    expect(loaded.customChordHoldSteps.every((h) => Number.isInteger(h) && h >= 1)).toBe(true);
  });

  const badHolds: Array<[string, number[]]> = [
    ['a zero', [THREE_FOUR, 0]],
    ['a negative', [THREE_FOUR, -4]],
    ['a fraction', [THREE_FOUR, 1.5]],
    ['a NaN', [THREE_FOUR, Number.NaN]],
    ['an Infinity', [THREE_FOUR, Number.POSITIVE_INFINITY]],
  ];
  for (const [label, holds] of badHolds) {
    test(`${label} in a hold array falls back to the default lane, not to a throw`, () => {
      const { loaded, warnings } = roundTrip({
        ...customPatternLoop(),
        customChordHoldSteps: holds,
      });

      expect(warnings).toEqual([]);
      // All-or-nothing, because a per-element drop would leave a lane whose
      // holds no longer line up with its values. Every slot of the fallback
      // rows comes back as a real one-step hold.
      expect(loaded.customChordHoldSteps).toEqual(
        new Array<number>(2 * MAX_STEPS_PER_BAR).fill(1),
      );
      // The onsets are not collateral damage: only the durations are refused.
      expect(loaded.customChordRhythm[0]).toBe(true);
      expect(loaded.customChordRhythm[MAX_STEPS_PER_BAR]).toBe(true);
    });
  }

  test('a hold crossing a folded chord boundary clamps to the seam and spares the onset there', () => {
    const holds = new Array<number>(2 * MAX_STEPS_PER_BAR).fill(1);
    holds[0] = 99;
    const { loaded, warnings } = roundTrip({
      ...customPatternLoop(),
      customChordHoldSteps: holds,
    });

    expect(warnings).toEqual([]);
    // In 4/4 the first one-bar chord ends at visible column 16. Sanitization
    // uses that active meter, not the 24-slot storage stride.
    expect(loaded.customChordHoldSteps[0]).toBe(16);
    // And the seam is a real seam: the span before it stops short of the onset
    // sitting on it instead of swallowing it.
    expect(loaded.customChordRhythm[MAX_STEPS_PER_BAR]).toBe(true);
    expect(loaded.customChordHoldSteps[MAX_STEPS_PER_BAR]).toBe(1);
  });
});

describe('custom pattern import respects the saved meter window', () => {
  test('4/4 leaves wider-meter slots dormant', () => {
    const loop = customPatternLoop();
    loop.customChordLoopLength = 1;
    loop.customChordRhythm = new Array<boolean>(MAX_STEPS_PER_BAR).fill(false);
    loop.customChordHoldSteps = new Array<number>(MAX_STEPS_PER_BAR).fill(1);
    loop.customChordRhythm[0] = true;
    loop.customChordHoldSteps[0] = MAX_STEPS_PER_BAR;
    loop.customChordRhythm[20] = true;
    loop.customChordHoldSteps[20] = 3;

    const { loaded } = roundTrip(loop);

    expect(loaded.customChordHoldSteps[0]).toBe(16);
    expect(loaded.customChordRhythm[20]).toBe(true);
    expect(loaded.customChordHoldSteps[20]).toBe(3);
  });

  test('3/4 uses twelve active columns rather than a hard-coded 4/4 window', () => {
    const loop = customPatternLoop();
    loop.customChordLoopLength = 1;
    loop.customChordRhythm = new Array<boolean>(MAX_STEPS_PER_BAR).fill(false);
    loop.customChordHoldSteps = new Array<number>(MAX_STEPS_PER_BAR).fill(1);
    loop.customChordRhythm[0] = true;
    loop.customChordHoldSteps[0] = 99;
    loop.customChordRhythm[15] = true;
    loop.customChordHoldSteps[15] = 2;

    const result = parseProjectFile(serializeProject({
      ...body,
      content: { ...body.content, meterId: '3/4', loops: [loop] },
    }));
    if (!result.ok) throw new Error(`parseProjectFile refused the fixture: ${result.message}`);
    const loaded = result.body.content.loops[0];

    expect(result.body.content.meterId).toBe('3/4');
    expect(loaded.customChordHoldSteps[0]).toBe(12);
    expect(loaded.customChordRhythm[15]).toBe(true);
    expect(loaded.customChordHoldSteps[15]).toBe(2);
  });
});

describe('unknownLibraryReferences', () => {
  test('is empty for factory content and lists each unknown id once', () => {
    expect(unknownLibraryReferences(factoryProjectContent())).toEqual([]);
    const content = factoryProjectContent();
    content.loops = [
      { ...createDefaultLoop(), id: 'x', chordRhythmId: 'cr-ghost' },
      { ...createDefaultLoop(), id: 'y', chordRhythmId: 'cr-ghost' },
    ];
    expect(unknownLibraryReferences(content)).toEqual(['chord rhythm "cr-ghost"']);
  });

  test('an unresolvable Beat base is provenance, not a missing resource', () => {
    // The opposite rule to the vibe and grid tables, on purpose. Shipped
    // factory data must reference a factory preset that exists, because a vibe
    // RESOLVES its id to a sound. A project body carries its Beat patch in
    // full, so a base this build cannot resolve — a preset from the author's
    // own user library, say — loses nothing and warns about nothing.
    const content = factoryProjectContent();
    content.loops = [
      {
        ...createDefaultLoop(),
        id: 'x',
        beatParams: { ...createDefaultLoop().beatParams, basePresetId: 'user-beat-from-another-browser' },
      },
    ];
    expect(unknownLibraryReferences(content)).toEqual([]);
  });
});

// migrateProjectBody (the identity function DEV-388 first replaced the
// version chain with) and its module were deleted in the final review fix
// wave: nothing in production imported it, and the three validation cases
// its docblock explained are already stated at projectFormat.ts:29-38.
