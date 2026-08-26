import { describe, expect, test } from 'bun:test';
import { Chord } from 'tonal';
import {
  MAX_BPM,
  MIN_BPM,
  ROOTS,
  SCALES,
  STEPS_PER_BAR,
  TONAL_CHORD_ALIASES,
  barDurationSec,
  clampBpm,
  deriveChordNotes,
  formatChordLabel,
  formatChordQuality,
  generateBlockChordNotes,
  getBorrowedChords,
  getDiatonicChordForDegree,
  getScaleNotes,
  isNoteInScale,
  rootSemitone,
  sixteenthNoteMs,
  snapProgressionToScale,
  stepDurationSec,
  transposeProgression,
} from './musicTheory';
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
});

describe('Hirajoshi', () => {
  test('is a five-degree World & Exotic scale on [0, 2, 3, 7, 8]', () => {
    const scale = SCALES['Hirajoshi'];
    expect(scale).toBeDefined();
    expect(scale.category).toBe('World & Exotic');
    expect(scale.intervals).toEqual([0, 2, 3, 7, 8]);
    expect(scale.triadQualities).toHaveLength(5);
    expect(scale.seventhQualities).toHaveLength(5);
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

  test('getDiatonicChordForDegree returns the authored table in C', () => {
    const rows = [
      { root: 'C', triad: 'min', seventh: 'min7', degreeName: 'i' },
      { root: 'D', triad: 'dim', seventh: 'm7b5', degreeName: 'ii' },
      { root: 'D#', triad: 'maj', seventh: 'maj7', degreeName: 'III' },
      { root: 'G', triad: 'sus4', seventh: '7sus4', degreeName: 'IV' },
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

  test('degrees 0, 3 and 4 are fully in-scale triads, and every other chord adds exactly one outside tone', () => {
    // Pinned as counts so a future re-authoring that makes them worse fails.
    const expectedTriadOutsiders = [0, 1, 1, 0, 0];
    const expectedSeventhOutsiders = [1, 1, 1, 1, 0];
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
      expect(Chord.getChord(tonalType, 'C').empty).toBe(false);
      // The app token itself is the one tonal does NOT know — that is why the
      // alias exists, and why authored-quality validation must go through it.
      expect(app).not.toBe(tonalType);
    }
  });
});

const chord = (id: string, root: string, quality: string, bars = 1): ChordItem =>
  deriveChordNotes({ id, root, quality, bars, notes: [] }, 4);

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
    expect(names(transposeProgression(A_MINOR_PROGRESSION, 'A', 'C', 4))).toEqual([
      'Cmin', 'G#maj', 'D#maj', 'A#maj',
    ]);
  });

  test('quality, bars and id are preserved verbatim', () => {
    const source = [chord('x1', 'D', 'min9', 2), chord('x2', 'G', '7sus4', 4)];
    const moved = transposeProgression(source, 'C', 'F#', 4);
    expect(moved.map((c) => c.id)).toEqual(['x1', 'x2']);
    expect(moved.map((c) => c.quality)).toEqual(['min9', '7sus4']);
    expect(moved.map((c) => c.bars)).toEqual([2, 4]);
  });

  test('every adjacent interval is preserved, for all 144 root pairs', () => {
    const gaps = (chords: ChordItem[]) =>
      chords.slice(1).map((c, i) => (rootSemitone(c.root) - rootSemitone(chords[i].root) + 12) % 12);
    for (const from of ROOTS) {
      for (const to of ROOTS) {
        expect(gaps(transposeProgression(A_MINOR_PROGRESSION, from, to, 4))).toEqual(
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
    const moved = transposeProgression(A_MINOR_PROGRESSION, 'A', 'F#', 4);
    expect(moved.map((c) => degreeOf(c.root, 'F#'))).toEqual(
      A_MINOR_PROGRESSION.map((c) => degreeOf(c.root, 'A')),
    );
  });

  test('a slash bass moves with the chord and keeps its written octave', () => {
    // Pitch class only: a bass note that jumped a register on a key change
    // would leave the bass line, and it is what makes the round trip exact.
    const source = [{ ...chord('s1', 'C', 'maj'), bassNote: 'E4' }];
    expect(transposeProgression(source, 'C', 'D#', 4)[0].bassNote).toBe('G4');
    const nulled = [{ ...chord('s2', 'C', 'maj'), bassNote: null }];
    expect(transposeProgression(nulled, 'C', 'D', 4)[0].bassNote).toBeNull();
  });

  test('notes are re-derived at the requested octave', () => {
    const moved = transposeProgression(A_MINOR_PROGRESSION, 'A', 'C', 3);
    expect(moved[0].notes).toEqual(generateBlockChordNotes('min', 'C', 3));
  });

  test('round trips exactly for all 144 ordered root pairs', () => {
    for (const a of ROOTS) {
      for (const b of ROOTS) {
        expect(
          transposeProgression(transposeProgression(A_MINOR_PROGRESSION, a, b, 4), b, a, 4),
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
    expect(names(snapProgressionToScale(EXTENDED, 'C', 'Major', 4))).toEqual([
      'Dmin9', 'G7', 'Cmaj9', 'Fmaj7',
    ]);
  });

  test('maj9 / min9 / 7sus4 / sus4 survive a snap into a five-note scale', () => {
    expect(names(snapProgressionToScale(EXTENDED, 'G', 'Major Pentatonic', 4))).toEqual([
      'Dmin9', 'Gmaj7', 'Bmaj9', 'Emin7',
    ]);
  });

  test('the old key-change behaviour is preserved verbatim under the new name', () => {
    expect(names(snapProgressionToScale(A_MINOR_PROGRESSION, 'C', 'Natural Minor', 4))).toEqual([
      'G#maj', 'Fmin', 'Cmin', 'Gmin',
    ]);
  });

  test('every output root is a degree of the target scale', () => {
    for (const root of ROOTS) {
      for (const scaleType of Object.keys(SCALES)) {
        const snapped = snapProgressionToScale(A_MINOR_PROGRESSION, root, scaleType, 4);
        for (const c of snapped) {
          expect(getScaleNotes(root, scaleType)).toContain(c.root);
        }
      }
    }
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
});
