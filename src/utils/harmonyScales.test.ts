import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCALES } from '@/data/scales';
import { harmonyKey } from '@/musicCore';
import type { ChordItem } from '../types';
import {
  ROOTS,
  degreeToRoman,
  getBorrowedChords,
  getDiatonicChordForDegree,
  getDiatonicChords,
  getScaleNotes,
  isNoteInScale,
  remapNoteByScaleDegree,
  snapProgressionToScale,
} from './musicTheory';

const HARMONY_KEYS = Object.keys(SCALES).filter((key) => SCALES[key].harmony !== undefined);

describe('getDiatonicChords', () => {
  test('is one getDiatonicChordForDegree per degree of the chord-hosting scale', () => {
    expect(getDiatonicChords('C', 'Major', false)).toEqual(
      [0, 1, 2, 3, 4, 5, 6].map((degree) => getDiatonicChordForDegree(degree, 'C', 'Major', false)),
    );
    expect(getDiatonicChords('A', 'Hirajoshi', true)).toHaveLength(5);
  });

  test('C major triads read I to vii°', () => {
    expect(getDiatonicChords('C', 'Major', false).map((c) => `${c.root}${c.quality}:${c.degreeName}`)).toEqual([
      'Cmaj:I', 'Dmin:ii', 'Emin:iii', 'Fmaj:IV', 'Gmaj:V', 'Amin:vi', 'Bdim:vii',
    ]);
  });
});

describe('harmony scales: the chord side reads the harmony scale (R358)', () => {
  test('Bebop Major degree 5 is A minor, not the G# passing tone', () => {
    expect(getDiatonicChordForDegree(5, 'C', 'Bebop Major')).toEqual({ root: 'A', quality: 'min', degreeName: 'vi' });
  });

  test('Whole Tone I is augmented', () => {
    expect(getDiatonicChordForDegree(0, 'C', 'Whole Tone').quality).toBe('aug');
  });

  test('Diminished I is diminished', () => {
    expect(getDiatonicChordForDegree(0, 'C', 'Diminished').quality).toBe('dim');
  });

  test('Hungarian Minor V is major', () => {
    expect(getDiatonicChordForDegree(4, 'C', 'Hungarian Minor')).toEqual({ root: 'G', quality: 'maj', degreeName: 'V' });
  });

  test('degreeToRoman on Double Harmonic Major degree 1 is bII', () => {
    expect(degreeToRoman('Double Harmonic Major', 1, 'maj')).toBe('bII');
  });

  test('every harmony scale hosts exactly its harmony scale\'s palette, in every key', () => {
    expect(HARMONY_KEYS).toHaveLength(8);
    for (const key of HARMONY_KEYS) {
      for (const root of ROOTS) {
        for (const use7ths of [false, true]) {
          expect(getDiatonicChords(root, key, use7ths), `${root} ${key} 7ths=${use7ths}`).toEqual(
            getDiatonicChords(root, harmonyKey(key), use7ths),
          );
        }
      }
    }
  });

  // Review Focus 4: F minor is built from C Bebop Major's own notes (F, G#,
  // C), but the Major palette lacks it, so it is still borrowed.
  test('getBorrowedChords for Bebop Major equals Major\'s, F minor included', () => {
    expect(getBorrowedChords('C', 'Bebop Major')).toEqual(getBorrowedChords('C', 'Major'));
    expect(getBorrowedChords('C', 'Bebop Major').map((c) => `${c.root}:${c.quality}`)).toContain('F:min');
  });

  // Review Focus 5: the snap lands on the harmony's degrees, root A included,
  // although A is not in C Whole Tone.
  test('a key-change snap into Whole Tone lands every chord on a Lydian Augmented palette chord', () => {
    const chords: ChordItem[] = [
      { id: 'a', root: 'A', quality: 'min', bars: 1 },
      { id: 'b', root: 'D', quality: 'min7', bars: 1 },
      { id: 'c', root: 'G', quality: '7', bars: 1 },
      { id: 'd', root: 'C', quality: 'maj7', bars: 1 },
    ];
    const palette = new Set(
      [false, true].flatMap((use7ths) => getDiatonicChords('C', 'Lydian Augmented', use7ths)).map((c) => `${c.root}:${c.quality}`),
    );
    const snapped = snapProgressionToScale(chords, 'C', 'Whole Tone');
    expect(snapped.map((c) => c.root)).toEqual(['A', 'D', 'F#', 'C']);
    for (const chord of snapped) {
      expect(palette.has(`${chord.root}:${chord.quality}`), `${chord.root}${chord.quality}`).toBe(true);
    }
  });
});

describe('harmony scales: the note side reads the scale itself (R358)', () => {
  test('getScaleNotes(C, Bebop Major) has 8 notes, G# included', () => {
    expect(getScaleNotes('C', 'Bebop Major')).toEqual(['C', 'D', 'E', 'F', 'G', 'G#', 'A', 'B']);
  });

  test('isNoteInScale(G#, C, Bebop Major) is true', () => {
    expect(isNoteInScale('G#', 'C', 'Bebop Major')).toBe(true);
  });

  // The accepted trade-off (ADR-0057): a chord may hold a note the scale lacks.
  test('A is outside C Whole Tone although its vi chord stands on it', () => {
    expect(isNoteInScale('A', 'C', 'Whole Tone')).toBe(false);
    expect(getDiatonicChordForDegree(5, 'C', 'Whole Tone').root).toBe('A');
  });
});

describe('lead remap stays on the note side (R358)', () => {
  // Review Focus 3: remap maps by the scale's own degree index. Major →
  // Bebop Major moves A (degree 5) to G#; the way back moves G# to A, and B
  // (Bebop Major's degree 7) has no Major home, so it stays put.
  test('Major and Bebop Major remap by degree, both ways', () => {
    expect(remapNoteByScaleDegree('A4', 'C', 'Major', 'C', 'Bebop Major')).toBe('G#4');
    expect(remapNoteByScaleDegree('G#4', 'C', 'Bebop Major', 'C', 'Major')).toBe('A4');
    expect(remapNoteByScaleDegree('B4', 'C', 'Bebop Major', 'C', 'Major')).toBe('B4');
  });
});

// R358's Prohibited line, made mechanical for the files that are chord side
// through and through: each scale-entry read goes through harmonyKey.
// (musicTheory.ts mixes both sides and is covered by its own tests.)
describe('chord-side files read the harmony scale (R358)', () => {
  const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');

  test('every scaleEntry( call in a chord-side file is scaleEntry(harmonyKey(', () => {
    for (const file of [
      'src/components/ui/Keyboard.tsx',
      'src/components/loop/chord/padPanel.ts',
      'src/components/loop/chord/progressionAvailability.ts',
      'src/audio/bassPatterns.ts',
    ]) {
      const source = read(file);
      const all = source.split('scaleEntry(').length - 1;
      const viaHarmony = source.split('scaleEntry(harmonyKey(').length - 1;
      expect(all, file).toBeGreaterThan(0);
      expect(viaHarmony, file).toBe(all);
    }
  });

  test('the chord palette reads getDiatonicChords, not a scale entry', () => {
    const source = read('src/components/loop/chord/useChordView.ts');
    expect(source).toContain('getDiatonicChords(');
    expect(source).not.toContain('scaleEntry(');
  });
});
