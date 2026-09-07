import { describe, expect, test } from 'bun:test';
import { Key, Note, Scale } from 'tonal';
import { SCALES } from '@/data/scales';
import { ROOTS, getScaleNotes } from './musicTheory';
import { SPELLING_CHARACTERIZATION } from './spellingCharacterizationFixture';
import {
  KEY_OPTIONS,
  getKeyAccidental,
  getTonicSpelling,
  spellMidiInKey,
  spellNoteInKey,
  spellPitchClassInKey,
  spellScaleNotes,
} from './noteSpelling';

describe('getTonicSpelling', () => {
  test('writes the tonic the way the key writes it', () => {
    expect(getTonicSpelling('A#', 'Major')).toBe('Bb');
    expect(getTonicSpelling('G#', 'Natural Minor')).toBe('G#');
    expect(getTonicSpelling('D#', 'Blues')).toBe('Eb');
    expect(getTonicSpelling('C', 'Major')).toBe('C');
  });

  test('an unknown note name comes back untouched', () => {
    expect(getTonicSpelling('H', 'Major')).toBe('H');
  });
});

// tonal answers an unparseable name with NaN, which no nullish check catches.
// Every entry point that starts from a caller-supplied root has to guard it
// with a finiteness test, or the table lookup behind it silently yields
// `undefined` and a blank label reaches the screen.
describe('an unparseable root', () => {
  test('is refused by every entry point rather than yielding a blank name', () => {
    expect(getKeyAccidental('H', 'Major')).toBe('sharp');
    expect(spellScaleNotes('H', 'Major')).toEqual([]);
  });
});

describe('getKeyAccidental', () => {
  test('reads the key signature, not the tonic name', () => {
    // F major carries no accidental in its own name and is a flat key.
    expect(getKeyAccidental('F', 'Major')).toBe('flat');
    expect(getKeyAccidental('G', 'Major')).toBe('sharp');
    expect(getKeyAccidental('G#', 'Harmonic Minor')).toBe('sharp');
    expect(getKeyAccidental('D#', 'Blues')).toBe('flat');
  });

  // The two accidental rows in noteSpelling.ts are tabulated, not called —
  // `Key.majorKey` cost ~18us a miss and dragged @tonaljs/key into the eager
  // bundle to answer one boolean. This pins both rows back to tonal, so the
  // table stays a lookup of a computation rather than a second opinion about
  // it, and a hand-edit to either row turns the suite red.
  test('every (tonic, tonality) still agrees with tonal', () => {
    for (const root of ROOTS) {
      for (const scaleType of ['Major', 'Natural Minor'] as const) {
        const tonic = getTonicSpelling(root, scaleType);
        const alteration =
          scaleType === 'Natural Minor'
            ? Key.minorKey(tonic).alteration
            : Key.majorKey(tonic).alteration;
        expect(getKeyAccidental(root, scaleType), `${root} ${scaleType}`).toBe(
          alteration < 0 ? 'flat' : 'sharp',
        );
      }
    }
  });
});

describe('spellPitchClassInKey', () => {
  test('a flat key writes its degrees with flats', () => {
    // The issue's acceptance example: the IV of Bb major is Eb, not D#.
    // scaleRoot stays the canonical sharp 'A#'; only the spelling moves.
    expect(spellPitchClassInKey(3, 'A#', 'Major')).toBe('Eb');
    expect(spellPitchClassInKey(10, 'A#', 'Major')).toBe('Bb');
  });

  test('a sharp key still writes sharps', () => {
    expect(spellPitchClassInKey(6, 'D', 'Major')).toBe('F#');
    expect(spellPitchClassInKey(1, 'D', 'Major')).toBe('C#');
  });

  test('a pitch class outside the scale takes the key signature, not the scale', () => {
    // Ab is in no degree of Bb major, so it falls through to the key's
    // accidental — flat, because the key signature is flat.
    expect(spellPitchClassInKey(8, 'A#', 'Major')).toBe('Ab');
  });

  test('a degree that would need a double accidental falls back to a plain name', () => {
    // G# harmonic minor's seventh degree is F##, which is unreadable on a
    // grid row; the fallback writes the key's plain name instead.
    expect(spellPitchClassInKey(7, 'G#', 'Harmonic Minor')).toBe('G');
  });
});

describe('spellScaleNotes', () => {
  test('A flat major minor spells flat, not sharp', () => {
    expect(spellScaleNotes('G#', 'Natural Minor')).toEqual(['G#', 'A#', 'B', 'C#', 'D#', 'E', 'F#']);
    expect(spellScaleNotes('A#', 'Major')).toEqual(['Bb', 'C', 'D', 'Eb', 'F', 'G', 'A']);
  });

  test('a single accidental that looks unusual is kept — F# major writes E#', () => {
    expect(spellScaleNotes('F#', 'Major')).toEqual(['F#', 'G#', 'A#', 'B', 'C#', 'D#', 'E#']);
  });

  test('a double accidental falls back to the key own direction', () => {
    // tonal gives Eb Gb Ab Bbb Bb Db — Bbb is unreadable on a grid row, and
    // the key is flat, so it falls back to A and never to G#.
    expect(spellScaleNotes('D#', 'Blues')).toEqual(['Eb', 'Gb', 'Ab', 'A', 'Bb', 'Db']);
    // tonal gives G# A# B C# D# E F## — the key is sharp, so F## falls to G.
    expect(spellScaleNotes('G#', 'Harmonic Minor')).toEqual([
      'G#', 'A#', 'B', 'C#', 'D#', 'E', 'G',
    ]);
  });

  test('an unknown scaleType falls back to Major, like the rest of the app', () => {
    expect(spellScaleNotes('C', 'Nonesuch')).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B']);
  });
});

describe('spellMidiInKey / spellNoteInKey', () => {
  test('never returns a name denoting a different pitch', () => {
    for (const scaleType of Object.keys(SCALES)) {
      for (const root of ROOTS) {
        for (let midi = 48; midi < 72; midi++) {
          const name = spellMidiInKey(midi, root, scaleType);
          expect(Note.midi(name), `${root} ${scaleType} ${midi} -> ${name}`).toBe(midi);
        }
      }
    }
  });

  test('keeps the octave a spelled letter would have moved', () => {
    // Cb4 and B3 are the same key; the letter that wraps the boundary shifts it.
    expect(Note.midi(spellMidiInKey(59, 'F#', 'Major'))).toBe(59);
  });

  test('spellNoteInKey carries the octave through', () => {
    expect(spellNoteInKey('D#4', 'A#', 'Major')).toBe('Eb4');
    expect(spellNoteInKey('C4', 'C', 'Major')).toBe('C4');
  });

  test('a name tonal cannot parse comes back untouched', () => {
    expect(spellNoteInKey('rest', 'C', 'Major')).toBe('rest');
  });
});

describe('KEY_OPTIONS', () => {
  test('value stays the canonical sharp name so the stored contract is unchanged', () => {
    expect(KEY_OPTIONS.map((o) => o.value)).toEqual([...ROOTS]);
  });

  test('label shows both spellings of an enharmonic key, regardless of scale', () => {
    expect(KEY_OPTIONS[1]).toEqual({ value: 'C#', label: 'C#/Db' });
    expect(KEY_OPTIONS[0]).toEqual({ value: 'C', label: 'C' });
    expect(KEY_OPTIONS.length).toBe(12);
  });
});

describe('spelling never changes which pitches a scale contains', () => {
  test('every spelled note has the same chroma as the sharp name it replaces', () => {
    for (const scaleType of Object.keys(SCALES)) {
      for (const root of ROOTS) {
        const sharp = getScaleNotes(root, scaleType).map((n) => Note.get(n).chroma);
        const spelled = spellScaleNotes(root, scaleType).map((n) => Note.get(n).chroma);
        expect(spelled, `${root} ${scaleType}`).toEqual(sharp);
      }
    }
  });
});

describe('spelling characterization', () => {
  test('pins all 132 (root x scale) pairs', () => {
    expect(Object.keys(SPELLING_CHARACTERIZATION).length).toBe(132);
    const actual: Record<string, string> = {};
    for (const root of ROOTS) {
      for (const scaleType of Object.keys(SCALES)) {
        actual[`${root}|${scaleType}`] = spellScaleNotes(root, scaleType).join(' ');
      }
    }
    expect(actual).toEqual(SPELLING_CHARACTERIZATION);
  });

  test('changes at least one note name in 68 of the 132 pairs', () => {
    let changed = 0;
    for (const root of ROOTS) {
      for (const scaleType of Object.keys(SCALES)) {
        const sharp = getScaleNotes(root, scaleType).join(' ');
        if (spellScaleNotes(root, scaleType).join(' ') !== sharp) changed++;
      }
    }
    expect(changed).toBe(68);
  });

  test('exactly two pairs reach a double accidental and take the fallback', () => {
    const fallbacks: string[] = [];
    for (const root of ROOTS) {
      for (const scaleType of Object.keys(SCALES)) {
        const tonic = getTonicSpelling(root, scaleType);
        const raw = Scale.get(`${tonic} ${SCALES[scaleType].tonal}`).notes;
        if (raw.some((n) => /##|bb/.test(n))) fallbacks.push(`${root}|${scaleType}`);
      }
    }
    expect(fallbacks.sort()).toEqual(['D#|Blues', 'G#|Harmonic Minor']);
  });
});
