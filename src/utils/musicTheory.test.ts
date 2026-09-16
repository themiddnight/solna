import { describe, expect, test } from 'bun:test';
import { CHORD_QUALITY_GROUPS, isChordQuality, type ChordQuality } from '@/musicCore';
import {
  MAX_BPM,
  MIN_BPM,
  ROOTS,
  STEPS_PER_BAR,
  TONAL_CHORD_ALIASES,
  barDurationSec,
  clampBpm,
  formatChordLabel,
  formatChordQuality,
  generateBlockChordNotes,
  getBorrowedChords,
  getDiatonicChordForDegree,
  getScaleNotes,
  isNoteInScale,
  parentDegreesFor,
  remapNoteByScaleDegree,
  resolveDegreeQuality,
  resolveParentDegreeQuality,
  rootSemitone,
  sixteenthNoteMs,
  snapProgressionToScale,
  stepDurationSec,
  transposeNoteBySemitones,
  transposeProgression,
} from './musicTheory';
import { SCALES } from '@/data/scales';
import { progressionById, resolveProgression } from '@/audio/chordProgressions';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChordItem } from '../types';

const SCALE_KEYS = Object.keys(SCALES);

function inScalePaletteEntries(root: string, scaleType: string): Set<string> {
  const numDegrees = SCALES[scaleType]?.intervals.length ?? 7;
  const entries = new Set<string>();
  for (let degree = 0; degree < numDegrees; degree++) {
    for (const use7ths of [false, true]) {
      const chord = getDiatonicChordForDegree(degree, root, scaleType, use7ths);
      entries.add(`${chord.root}:${chord.quality}`);
    }
  }
  return entries;
}

function strictlyDiatonic(
  chordRoot: string,
  quality: string,
  root: string,
  scaleType: string,
): boolean {
  const notes = generateBlockChordNotes(quality, chordRoot);
  return notes.length > 0 && notes.every((n) => isNoteInScale(n, root, scaleType));
}

describe('getBorrowedChords catalog', () => {
  test('major branch returns the standard set with corrected iiø7 (m7b5) quality', () => {
    const got = getBorrowedChords('C', 'Major')
      .map((c) => `${c.root}:${c.quality}`)
      .sort();
    expect(got).toEqual(
      ['A#:maj', 'C#:maj', 'D:m7b5', 'D#:maj', 'F:min', 'G#:maj'].sort(),
    );
  });

  test('minor branch contains no III entry', () => {
    for (const scaleType of ['Natural Minor', 'Harmonic Minor', 'Dorian', 'Phrygian']) {
      const borrowed = getBorrowedChords('C', scaleType);
      expect(borrowed.filter((c) => c.label.includes('III'))).toEqual([]);
    }
  });

  test('never duplicates an in-scale palette chord nor a strictly diatonic chord', () => {
    for (const scaleType of SCALE_KEYS) {
      const palette = inScalePaletteEntries('C', scaleType);
      const duplicates = getBorrowedChords('C', scaleType)
        .filter(
          (c) =>
            palette.has(`${c.root}:${c.quality}`) ||
            strictlyDiatonic(c.root, c.quality, 'C', scaleType),
        )
        .map((d) => `${scaleType}: ${d.root}${d.quality}`);
      expect(duplicates).toEqual([]);
    }
  });
});

describe('formatChordLabel', () => {
  test('renders standard chord shorthand for every quality token', () => {
    expect(formatChordLabel('C', 'maj')).toBe('C');
    expect(formatChordLabel('C', 'min')).toBe('Cm');
    expect(formatChordLabel('C', 'maj7')).toBe('Cmaj7');
    expect(formatChordLabel('C', 'min7')).toBe('Cm7');
    expect(formatChordLabel('C', '7')).toBe('C7');
    expect(formatChordLabel('C', 'm7b5')).toBe('Cm7b5');
    expect(formatChordLabel('C', 'dim')).toBe('Cdim');
    expect(formatChordLabel('C', 'dim7')).toBe('Cdim7');
    expect(formatChordLabel('C', 'aug')).toBe('Caug');
    expect(formatChordLabel('C', 'sus2')).toBe('Csus2');
    expect(formatChordLabel('C', 'sus4')).toBe('Csus4');
    expect(formatChordLabel('C', '7sus4')).toBe('C7sus4');
    expect(formatChordLabel('C', '9')).toBe('C9');
    expect(formatChordLabel('C', 'maj9')).toBe('Cmaj9');
    expect(formatChordLabel('C', 'min9')).toBe('Cm9');
    expect(formatChordLabel('C', 'add9')).toBe('Cadd9');
    expect(formatChordLabel('C', '6')).toBe('C6');
    expect(formatChordLabel('C', 'min6')).toBe('Cm6');
    expect(formatChordLabel('C', 'minMaj7')).toBe('CmM7');
    expect(formatChordLabel('C', 'maj7#5')).toBe('Cmaj7#5');
    expect(formatChordLabel('F#', 'min7')).toBe('F#m7');
  });

  test('falls back to the raw quality for unknown tokens', () => {
    expect(formatChordLabel('C', 'unknown')).toBe('Cunknown');
  });

  test('formatChordQuality returns just the suffix', () => {
    expect(formatChordQuality('maj')).toBe('');
    expect(formatChordQuality('min7')).toBe('m7');
    expect(formatChordQuality('minMaj7')).toBe('mM7');
  });

  test('spells the root in the key when one is given', () => {
    expect(formatChordLabel('A#', 'maj', { scaleRoot: 'A#', scaleType: 'Major' })).toBe('Bb');
    expect(formatChordLabel('D#', 'min7', { scaleRoot: 'A#', scaleType: 'Major' })).toBe('Ebm7');
    // F# major is F# G# A# B C# D# E#. Chroma 5 is its seventh degree and is
    // written E#, never F — this is the case a sharp key gets wrong if the
    // label reads the chromatic table instead of the key.
    expect(formatChordLabel('F', 'maj', { scaleRoot: 'F#', scaleType: 'Major' })).toBe('E#');
    // Chroma 4 is in no degree of F# major, so it falls back to the key's
    // plain accidental. A sharp key falls back to a sharp name.
    expect(formatChordLabel('E', 'maj', { scaleRoot: 'F#', scaleType: 'Major' })).toBe('E');
  });

  test('without a key it still writes the canonical sharp name', () => {
    expect(formatChordLabel('A#', 'maj')).toBe('A#');
    expect(formatChordLabel('D#', 'min7')).toBe('D#m7');
  });

  test('the quality suffix is untouched by spelling', () => {
    expect(formatChordLabel('D#', 'maj7#5', { scaleRoot: 'A#', scaleType: 'Major' })).toBe('Ebmaj7#5');
  });
});

describe('Hirajoshi', () => {
  test('is a five-degree World & Exotic scale on [0, 2, 3, 7, 8]', () => {
    const scale = SCALES['Hirajoshi'];
    expect(scale).toBeDefined();
    expect(scale.category).toBe('World & Exotic');
    expect(scale.intervals).toEqual([0, 2, 3, 7, 8]);
  });

  test('is a strict subset of natural minor, at degrees 1, 2, 3, 5, 6', () => {
    // This is why the qualities are inherited from the parent 7-note scale,
    // exactly as Major/Minor Pentatonic already do.
    const parent = SCALES['Natural Minor'].intervals;
    for (const interval of SCALES['Hirajoshi'].intervals) {
      expect(parent).toContain(interval);
    }
  });

  test('getScaleNotes in G is G A A# D D#', () => {
    expect(getScaleNotes('G', 'Hirajoshi')).toEqual(['G', 'A', 'A#', 'D', 'D#']);
  });

  test('getDiatonicChordForDegree returns the derived qualities in C', () => {
    const rows = [
      { root: 'C', triad: 'min', seventh: 'min7', degreeName: 'i' },
      { root: 'D', triad: 'dim', seventh: 'm7b5', degreeName: 'ii' },
      { root: 'D#', triad: 'maj', seventh: 'maj7', degreeName: 'III' },
      { root: 'G', triad: 'min', seventh: 'min7', degreeName: 'iv' },
      { root: 'G#', triad: 'maj', seventh: 'maj7', degreeName: 'V' },
    ];
    rows.forEach((row, degree) => {
      const triad = getDiatonicChordForDegree(degree, 'C', 'Hirajoshi', false);
      expect(triad).toEqual({ root: row.root, quality: row.triad, degreeName: row.degreeName });
      const seventh = getDiatonicChordForDegree(degree, 'C', 'Hirajoshi', true);
      expect(seventh.root).toBe(row.root);
      expect(seventh.quality).toBe(row.seventh);
    });
  });

  test('degrees 0 and 4 are fully in-scale triads; degree 3 moved off it with the sus4 -> min derivation', () => {
    // Pinned as counts so a future re-authoring that makes them worse fails.
    // Degree 3 was the fully-inside-the-five-notes sus4/7sus4; resolveDegreeQuality
    // gives it min/min7 instead, which reaches outside like its neighbours.
    const expectedTriadOutsiders = [0, 1, 1, 1, 0];
    const expectedSeventhOutsiders = [1, 1, 1, 2, 0];
    for (let degree = 0; degree < 5; degree++) {
      for (const [use7ths, expected] of [
        [false, expectedTriadOutsiders[degree]],
        [true, expectedSeventhOutsiders[degree]],
      ] as const) {
        const chord = getDiatonicChordForDegree(degree, 'C', 'Hirajoshi', use7ths);
        const outside = generateBlockChordNotes(chord.quality, chord.root, 4).filter(
          (note) => !isNoteInScale(note, 'C', 'Hirajoshi'),
        );
        expect(outside).toHaveLength(expected);
      }
    }
  });
});

describe('TONAL_CHORD_ALIASES', () => {
  test('is exported and every alias resolves to a chord tonal knows', () => {
    expect(TONAL_CHORD_ALIASES.min9).toBe('m9');
    for (const [app, tonalType] of Object.entries(TONAL_CHORD_ALIASES)) {
      // Routed through the real app-token pipeline (generateBlockChordNotes ->
      // Music Core's resolveChordNotes -> the tonal alias) rather than calling
      // tonal directly: resolveChordNotes throws if tonal can't resolve the
      // alias, so a non-throwing, non-empty result proves the same thing the
      // old direct Chord.getChord(tonalType, 'C').empty check did.
      expect(() => generateBlockChordNotes(app, 'C')).not.toThrow();
      expect(generateBlockChordNotes(app, 'C').length).toBeGreaterThan(0);
      // The app token itself is the one tonal does NOT know — that is why the
      // alias exists, and why authored-quality validation must go through it.
      expect(app).not.toBe(tonalType);
    }
  });
});

const chord = (id: string, root: string, quality: ChordQuality, bars = 1): ChordItem => ({
  id, root, quality, bars,
});

// A Natural Minor, i - VI - III - VII. The progression the spec measured.
const A_MINOR_PROGRESSION: ChordItem[] = [
  chord('c1', 'A', 'min'),
  chord('c2', 'F', 'maj'),
  chord('c3', 'C', 'maj'),
  chord('c4', 'G', 'maj'),
];

const names = (chords: ChordItem[]) => chords.map((c) => `${c.root}${c.quality}`);

describe('transposeProgression', () => {
  test('the measured case: A to C keeps the tonic first', () => {
    // Today's reharmonize turns this into G#maj - Fmin - Cmin - Gmin, moving
    // the tonic from position 1 to position 3. Transposition must not.
    expect(names(transposeProgression(A_MINOR_PROGRESSION, 'A', 'C'))).toEqual([
      'Cmin', 'G#maj', 'D#maj', 'A#maj',
    ]);
  });

  test('quality, bars and id are preserved verbatim', () => {
    const source = [chord('x1', 'D', 'min9', 2), chord('x2', 'G', '7sus4', 4)];
    const moved = transposeProgression(source, 'C', 'F#');
    expect(moved.map((c) => c.id)).toEqual(['x1', 'x2']);
    expect(moved.map((c) => c.quality)).toEqual(['min9', '7sus4']);
    expect(moved.map((c) => c.bars)).toEqual([2, 4]);
  });

  test('every adjacent interval is preserved, for all 144 root pairs', () => {
    const gaps = (chords: ChordItem[]) =>
      chords.slice(1).map((c, i) => (rootSemitone(c.root) - rootSemitone(chords[i].root) + 12) % 12);
    for (const from of ROOTS) {
      for (const to of ROOTS) {
        expect(gaps(transposeProgression(A_MINOR_PROGRESSION, from, to))).toEqual(
          gaps(A_MINOR_PROGRESSION),
        );
      }
    }
  });

  test('each chord keeps its scale degree in the new key', () => {
    const degreeOf = (chordRoot: string, keyRoot: string) =>
      SCALES['Natural Minor'].intervals.indexOf(
        (rootSemitone(chordRoot) - rootSemitone(keyRoot) + 12) % 12,
      );
    const moved = transposeProgression(A_MINOR_PROGRESSION, 'A', 'F#');
    expect(moved.map((c) => degreeOf(c.root, 'F#'))).toEqual(
      A_MINOR_PROGRESSION.map((c) => degreeOf(c.root, 'A')),
    );
  });

  test('a slash bass moves with the chord and keeps its written octave', () => {
    // Pitch class only: a bass note that jumped a register on a key change
    // would leave the bass line, and it is what makes the round trip exact.
    const source = [{ ...chord('s1', 'C', 'maj'), bassNote: 'E4' }];
    expect(transposeProgression(source, 'C', 'D#')[0].bassNote).toBe('G4');
    const nulled = [{ ...chord('s2', 'C', 'maj'), bassNote: null }];
    expect(transposeProgression(nulled, 'C', 'D')[0].bassNote).toBeNull();
  });

  test('the result carries no notes field', () => {
    const moved = transposeProgression(A_MINOR_PROGRESSION, 'A', 'C');
    for (const c of moved) {
      expect('notes' in c).toBe(false);
    }
  });

  test('round trips exactly for all 144 ordered root pairs', () => {
    for (const a of ROOTS) {
      for (const b of ROOTS) {
        expect(
          transposeProgression(transposeProgression(A_MINOR_PROGRESSION, a, b), b, a),
        ).toEqual(A_MINOR_PROGRESSION);
      }
    }
  });
});

describe('snapProgressionToScale', () => {
  // Golden values captured from reharmonizeProgressionToScale before the
  // rename: this proves the rename changed nothing, including the behaviour
  // that is wrong for a key change and correct for a scale change.
  const EXTENDED = [
    chord('e1', 'D', 'min9'),
    chord('e2', 'G', '7'),
    chord('e3', 'C', 'maj9'),
    chord('e4', 'F', 'maj7'),
  ];

  test('chords already in the target key and scale come back unchanged', () => {
    expect(names(snapProgressionToScale(EXTENDED, 'C', 'Major'))).toEqual([
      'Dmin9', 'G7', 'Cmaj9', 'Fmaj7',
    ]);
  });

  test('maj9 / min9 / 7sus4 / sus4 survive a snap into a five-note scale', () => {
    expect(names(snapProgressionToScale(EXTENDED, 'G', 'Major Pentatonic'))).toEqual([
      'Dmin9', 'Gmaj7', 'Bmaj9', 'Emin7',
    ]);
  });

  test('the old key-change behaviour is preserved verbatim under the new name', () => {
    expect(names(snapProgressionToScale(A_MINOR_PROGRESSION, 'C', 'Natural Minor'))).toEqual([
      'G#maj', 'Fmin', 'Cmin', 'Gmin',
    ]);
  });

  test('every output root is a degree of the target scale', () => {
    for (const root of ROOTS) {
      for (const scaleType of Object.keys(SCALES)) {
        const snapped = snapProgressionToScale(A_MINOR_PROGRESSION, root, scaleType);
        for (const c of snapped) {
          expect(getScaleNotes(root, scaleType)).toContain(c.root);
        }
      }
    }
  });

  test('the result carries no notes field', () => {
    const snapped = snapProgressionToScale(A_MINOR_PROGRESSION, 'C', 'Natural Minor');
    for (const c of snapped) {
      expect('notes' in c).toBe(false);
    }
  });

  describe('quality classification on snap (DEV-393)', () => {
    // Every chord here is rooted at C and snapped onto C Major's own tonic
    // (degree 0) — root position never moves, so only the quality policy is
    // under test. Degree 0's own diatonic qualities are 'maj' (triad) and
    // 'maj7' (seventh), both different from every non-maj/maj7 input below,
    // so "changed to maj/maj7" unambiguously means REGENERATED and
    // "unchanged" unambiguously means PRESERVED.
    const REGENERATE_TO_TRIAD: ChordQuality[] = ['min', 'dim', 'aug'];
    const REGENERATE_TO_SEVENTH: ChordQuality[] = [
      'min7', '7', 'm7b5', 'dim7', 'minMaj7', 'maj7#5',
    ];
    const PRESERVE: ChordQuality[] = [
      'sus2', 'sus4', '7sus4', '9', 'maj9', 'min9', 'add9', '6', 'min6',
    ];

    const snappedQualities = (qualities: ChordQuality[]): [ChordQuality, ChordQuality][] =>
      qualities.map((quality) => [
        quality,
        snapProgressionToScale([chord('c', 'C', quality)], 'C', 'Major')[0].quality,
      ]);

    test('a triad-shaped quality regenerates to the tonic triad, maj', () => {
      const inputs: ChordQuality[] = [...REGENERATE_TO_TRIAD, 'maj'];
      expect(snappedQualities(inputs)).toEqual(inputs.map((q) => [q, 'maj']));
    });

    test('a seventh-shaped quality regenerates to the tonic seventh, maj7', () => {
      const inputs: ChordQuality[] = [...REGENERATE_TO_SEVENTH, 'maj7'];
      expect(snappedQualities(inputs)).toEqual(inputs.map((q) => [q, 'maj7']));
    });

    test('a sixth / added-tone / extension / suspended quality survives the snap verbatim', () => {
      expect(snappedQualities(PRESERVE)).toEqual(PRESERVE.map((q) => [q, q]));
    });

    test('minMaj7 and maj7#5 regenerate — NOT preserved (see Task 1 finding)', () => {
      // Both contain '7', so the substring heuristic put them in the
      // preserve-CONSIDERATION branch and then dropped them: the four-item
      // hand-written list did not name them. The classifier reaches the same
      // answer on purpose rather than by omission — resolveDegreeQuality emits
      // both at some degree of some scale, so the target key has its own
      // correct version to regenerate to.
      expect(
        snapProgressionToScale([chord('c', 'C', 'minMaj7')], 'C', 'Major')[0].quality,
      ).toBe('maj7');
      expect(
        snapProgressionToScale([chord('c', 'C', 'maj7#5')], 'C', 'Major')[0].quality,
      ).toBe('maj7');
    });

    test("exercises every one of the registry's 20 qualities, none skipped", () => {
      const covered = [
        ...REGENERATE_TO_TRIAD, 'maj',
        ...REGENERATE_TO_SEVENTH, 'maj7',
        ...PRESERVE,
      ].sort();
      const registered = CHORD_QUALITY_GROUPS.flatMap((g) => g.options.map((o) => o.value)).sort();
      expect(covered).toEqual(registered);
    });

    test('an equidistant root snap takes the lower-indexed scale degree (documented tie policy)', () => {
      // C# sits exactly one semitone from both C (degree 0) and D (degree 1)
      // of C Major — nearestDegrees returns both and snapProgressionToScale
      // takes the first, matching its own inline comment ("either neighbour
      // is an equally good landing spot"). Pinned here so the policy has a
      // test, not just a comment. Root-snapping itself is unchanged by
      // DEV-393; this only documents the existing behavior.
      const snapped = snapProgressionToScale([chord('c', 'C#', 'maj')], 'C', 'Major');
      expect(snapped[0].root).toBe('C');
    });

    test('a preserved quality still moves its ROOT to the nearest degree', () => {
      // Preservation is a quality rule only. F#add9 into C Major has no F#
      // degree to land on, so the root must snap (to F or G) while the add9
      // survives — proving the fix did not turn "preserve the quality" into
      // "leave the chord alone".
      const snapped = snapProgressionToScale([chord('c', 'F#', 'add9')], 'C', 'Major');
      expect(snapped[0].quality).toBe('add9');
      expect(getScaleNotes('C', 'Major')).toContain(snapped[0].root);
    });
  });
});

describe('reharmonization reads no quality substring (DEV-393 guard)', () => {
  test('musicTheory.ts never calls .includes on a chord quality', () => {
    // Regression guard: the bug this issue fixes was exactly
    // `chord.quality.includes('7') || chord.quality.includes('9')`. Reading
    // the file's own source rather than re-testing behavior, because a
    // future rewrite could reproduce the same substring trap under a
    // different variable name while still passing every behavioral test
    // above by coincidence on the specific fixtures they use.
    const source = readFileSync(join(process.cwd(), 'src/utils/musicTheory.ts'), 'utf8');
    expect(source).not.toMatch(/\.quality\.includes\(/);
  });
});

describe('factory progressions affected by the classification fix (DEV-393)', () => {
  // The four progressions in src/data/chordProgressions.ts whose authored
  // quality overrides (sus2, plain 9) used to be silently destroyed by a
  // reharmonize and now survive it. Confirmed by grepping chordProgressions.ts
  // for the qualities the old substring heuristic mishandled
  // (sus2 / plain '9' / add9 / 6 / min6 — see shouldPreserveQualityOnSnap's
  // SNAP_PRESERVED_CATEGORIES) rather than trusting a stale count: this task's
  // brief said three, but lofi-tape-loop's closing V9 (step(4, 1, '9')) is a
  // fourth instance of the same class the brief missed, so it is pinned here
  // too.
  test('lofi-trapsoul: VII9 survives a reharmonize into a different scale', () => {
    const progression = progressionById('lofi-trapsoul')!;
    const resolved = resolveProgression(progression, 'A', 'Natural Minor');
    const snapped = snapProgressionToScale(resolved, 'D', 'Dorian');
    // Step index 2 is the VII9 step (step(6, 1, '9')).
    expect(snapped[2].quality).toBe('9');
  });

  test('lofi-tape-loop: the closing V9 survives a reharmonize into a different scale', () => {
    const progression = progressionById('lofi-tape-loop')!;
    const resolved = resolveProgression(progression, 'C', 'Major');
    const snapped = snapProgressionToScale(resolved, 'D', 'Dorian');
    // Step index 3 is the V9 step (step(4, 1, '9')); maj9/min9 at indices 0
    // and 2 were already preserved by the old explicit four-name list, so
    // only this step's behavior actually changed.
    expect(snapped[3].quality).toBe('9');
  });

  test('ambient-open-fourths: both Isus2/IIsus2 steps survive a reharmonize', () => {
    const progression = progressionById('ambient-open-fourths')!;
    const resolved = resolveProgression(progression, 'C', 'Lydian');
    const snapped = snapProgressionToScale(resolved, 'G', 'Major');
    expect(snapped.map((c) => c.quality)).toEqual(['sus2', 'sus2']);
  });

  test('ambient-glass-horizon: the closing IIsus2 step survives a reharmonize', () => {
    const progression = progressionById('ambient-glass-horizon')!;
    const resolved = resolveProgression(progression, 'C', 'Lydian');
    const snapped = snapProgressionToScale(resolved, 'G', 'Major');
    // Step index 3 is the IIsus2 step (step(1, 4, 'sus2')).
    expect(snapped[3].quality).toBe('sus2');
  });
});

describe('tempo helpers', () => {
  test('stepDurationSec is sixteenthNoteMs in seconds', () => {
    for (const bpm of [20, 90, 120, 174, 300]) {
      expect(stepDurationSec(bpm)).toBeCloseTo(sixteenthNoteMs(bpm) / 1000, 12);
    }
  });

  test('barDurationSec is one 16-step bar', () => {
    expect(barDurationSec(120)).toBeCloseTo(stepDurationSec(120) * STEPS_PER_BAR, 12);
    expect(barDurationSec(120)).toBeCloseTo(2, 12); // 4 beats at 120 bpm
  });

  test('STEPS_PER_BAR is 16 and is the value engine.ts re-exports', () => {
    expect(STEPS_PER_BAR).toBe(16);
  });

  test('clampBpm holds the transport range and rejects non-finite input', () => {
    expect(clampBpm(0)).toBe(MIN_BPM);
    expect(clampBpm(19.9)).toBe(MIN_BPM);
    expect(clampBpm(301)).toBe(MAX_BPM);
    expect(clampBpm(128)).toBe(128);
    expect(clampBpm(Number.NaN)).toBe(120);
    expect(clampBpm(Number.POSITIVE_INFINITY)).toBe(MAX_BPM);
  });

  test('barDurationSec still defaults to a 16-step bar', () => {
    expect(barDurationSec(120)).toBeCloseTo(barDurationSec(120, 16), 12);
  });

  test('barDurationSec scales with the bar length it is given', () => {
    expect(barDurationSec(120, 12)).toBeCloseTo(stepDurationSec(120) * 12, 12);
    expect(barDurationSec(120, 24)).toBeCloseTo(stepDurationSec(120) * 24, 12);
    expect(barDurationSec(120, 14)).toBeCloseTo(stepDurationSec(120) * 14, 12);
  });
});

describe('transposeNoteBySemitones', () => {
  test('shifts a note up by a positive semitone count', () => {
    expect(transposeNoteBySemitones('C4', 3)).toBe('D#4');
  });
  test('shifts a note down by a negative semitone count', () => {
    expect(transposeNoteBySemitones('A3', -9)).toBe('C3');
  });
  test('zero is identity', () => {
    expect(transposeNoteBySemitones('F#5', 0)).toBe('F#5');
  });
});

describe('remapNoteByScaleDegree', () => {
  test('keeps the tonic on the tonic at the same register', () => {
    expect(remapNoteByScaleDegree('A3', 'A', 'Natural Minor', 'C', 'Natural Minor')).toBe('C3');
  });
  test('re-maps a degree to the same degree of the new scale (b3 → b3)', () => {
    // C4 = degree 2 (b3) of A natural minor → degree 2 of C natural minor = D#3
    expect(remapNoteByScaleDegree('C4', 'A', 'Natural Minor', 'C', 'Natural Minor')).toBe('D#3');
  });
  test('scale-type change shifts a degree by its interval delta (minor → major)', () => {
    // D#4 = degree 2 of C natural minor → degree 2 of C major = E4
    expect(remapNoteByScaleDegree('D#4', 'C', 'Natural Minor', 'C', 'Major')).toBe('E4');
  });
  test('leaves an out-of-scale note unchanged', () => {
    expect(remapNoteByScaleDegree('C#4', 'C', 'Major', 'C', 'Natural Minor')).toBe('C#4');
  });
  test('leaves a note whose degree overflows the target scale unchanged', () => {
    // B4 = degree 6 of C major; Major Pentatonic has only 5 degrees
    expect(remapNoteByScaleDegree('B4', 'C', 'Major', 'C', 'Major Pentatonic')).toBe('B4');
  });
  test('no-op (same key and scale) is identity', () => {
    expect(remapNoteByScaleDegree('E4', 'C', 'Major', 'C', 'Major')).toBe('E4');
  });
});

describe('resolveDegreeQuality', () => {
  // The nine scales the derivation must reproduce EXACTLY, triads and sevenths,
  // every degree. Harmonic Minor's `aug`/`maj7#5` at degree 2 falls out of the
  // spelled stacking with no special case, which is the strongest single piece
  // of evidence that this is the method the table was written from.
  const REPRODUCED: Record<string, { triads: string[]; sevenths: string[] }> = {
    'Major': {
      triads: ['maj', 'min', 'min', 'maj', 'maj', 'min', 'dim'],
      sevenths: ['maj7', 'min7', 'min7', 'maj7', '7', 'min7', 'm7b5'],
    },
    'Natural Minor': {
      triads: ['min', 'dim', 'maj', 'min', 'min', 'maj', 'maj'],
      sevenths: ['min7', 'm7b5', 'maj7', 'min7', 'min7', 'maj7', '7'],
    },
    'Harmonic Minor': {
      triads: ['min', 'dim', 'aug', 'min', 'maj', 'maj', 'dim'],
      sevenths: ['minMaj7', 'm7b5', 'maj7#5', 'min7', '7', 'maj7', 'dim7'],
    },
    'Dorian': {
      triads: ['min', 'min', 'maj', 'maj', 'min', 'dim', 'maj'],
      sevenths: ['min7', 'min7', 'maj7', '7', 'min7', 'm7b5', 'maj7'],
    },
    'Mixolydian': {
      triads: ['maj', 'min', 'dim', 'maj', 'min', 'min', 'maj'],
      sevenths: ['7', 'min7', 'm7b5', 'maj7', 'min7', 'min7', 'maj7'],
    },
    'Lydian': {
      triads: ['maj', 'maj', 'min', 'dim', 'maj', 'min', 'min'],
      sevenths: ['maj7', '7', 'min7', 'm7b5', 'maj7', 'min7', 'min7'],
    },
    'Phrygian': {
      triads: ['min', 'maj', 'maj', 'min', 'dim', 'maj', 'min'],
      sevenths: ['min7', 'maj7', '7', 'min7', 'm7b5', 'maj7', 'min7'],
    },
    // Degree 1 is the bIII at interval 3, which Natural Minor carries at its
    // DEGREE 2. Indexing `degree % 7` into the parent — murva's method — would
    // hand back Natural Minor's degree 1, the ii(dim), with nothing failing.
    'Minor Pentatonic': {
      triads: ['min', 'maj', 'min', 'min', 'maj'],
      sevenths: ['min7', 'maj7', 'min7', 'min7', '7'],
    },
    'Major Pentatonic': {
      triads: ['maj', 'min', 'min', 'maj', 'min'],
      sevenths: ['maj7', 'min7', 'min7', '7', 'min7'],
    },
  };

  test('reproduces nine of the eleven scales exactly', () => {
    expect(Object.keys(REPRODUCED).length).toBe(9);
    for (const [key, expected] of Object.entries(REPRODUCED)) {
      const scale = SCALES[key];
      expect(scale.intervals.map((_, d) => resolveDegreeQuality(key, d, false)), key).toEqual(expected.triads);
      expect(scale.intervals.map((_, d) => resolveDegreeQuality(key, d, true)), key).toEqual(expected.sevenths);
    }
  });

  // Degrees 2 and 3 lose their diminished chords because Natural Minor has no
  // diminished triad at its 4th or 5th degree; resolveDegreeQuality stacks
  // thirds over the PARENT's spelled notes, so blues' own colour never enters
  // the derivation. Degrees 0 and 4 lose their dominant sevenths for the same
  // reason — a `7` on the tonic is a blues idiom, and an idiom belongs in a
  // progression's explicit `quality`, not in a scale's diatonic palette.
  test('Blues changes at four degrees', () => {
    expect(SCALES['Blues'].intervals.map((_, d) => resolveDegreeQuality('Blues', d, false)))
      .toEqual(['min', 'maj', 'min', 'min', 'min', 'maj']);
    expect(SCALES['Blues'].intervals.map((_, d) => resolveDegreeQuality('Blues', d, true)))
      .toEqual(['min7', 'maj7', 'min7', 'min7', 'min7', '7']);
  });

  test('Hirajoshi changes at degree 3 and nowhere else', () => {
    expect(SCALES['Hirajoshi'].intervals.map((_, d) => resolveDegreeQuality('Hirajoshi', d, false)))
      .toEqual(['min', 'dim', 'maj', 'min', 'maj']);
    expect(SCALES['Hirajoshi'].intervals.map((_, d) => resolveDegreeQuality('Hirajoshi', d, true)))
      .toEqual(['min7', 'm7b5', 'maj7', 'min7', 'maj7']);
  });

  test('Blues degree 3 resolves through two equidistant parent degrees', () => {
    const { parentKey, degrees } = parentDegreesFor('Blues', 3);
    expect(parentKey).toBe('Natural Minor');
    expect(degrees).toEqual([3, 4]);
  });

  test('an unmapped interval tuple throws rather than guessing', () => {
    // Natural Minor has seven degrees; degree 7 does not exist and the parent
    // lookup runs off the spelled note list.
    expect(() => resolveParentDegreeQuality('Major', 99, false)).toThrow();
  });

  test('memoization returns the same answer, not a stale one', () => {
    expect(resolveDegreeQuality('Hirajoshi', 3, false)).toBe('min');
    expect(resolveDegreeQuality('Hirajoshi', 3, false)).toBe('min');
    expect(resolveDegreeQuality('Hirajoshi', 3, true)).toBe('min7');
  });

  // getBorrowedChords filters candidates against the in-scale palette, and that
  // palette is exactly what moved — so this is measured, not assumed. Blues
  // loses `iv` because the derived palette now carries F min at degree 2.
  // Hirajoshi is unchanged: nothing it gained collides with a candidate.
  test('borrowed chords, measured after the derivation', () => {
    expect(getBorrowedChords('C', 'Blues').map((b) => `${b.root} ${b.quality}`)).toEqual(['G# maj']);
    expect(getBorrowedChords('C', 'Hirajoshi').map((b) => `${b.root} ${b.quality}`)).toEqual([
      'F min',
      'A# maj',
    ]);
  });
});

describe('resolveDegreeQuality output vs. the chord-quality registry', () => {
  test('every triad and seventh quality every scale can emit is a registered, picker-representable token', () => {
    for (const scaleType of SCALE_KEYS) {
      const numDegrees = SCALES[scaleType].intervals.length;
      for (let degree = 0; degree < numDegrees; degree++) {
        for (const use7ths of [false, true]) {
          const quality = resolveDegreeQuality(scaleType, degree, use7ths);
          expect(isChordQuality(quality)).toBe(true);
        }
      }
    }
  });
});
