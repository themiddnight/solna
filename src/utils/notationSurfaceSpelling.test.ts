import { describe, expect, test } from 'bun:test';
import { formatChordLabel, spellChordRoot, ROOTS } from '@/utils/musicTheory';
import { spellNoteInKey, type SpellingKey } from '@/utils/noteSpelling';

/** One representative key per DEV-398's DoD: flat, sharp, modal, pentatonic, Harmonic Minor. */
const REPRESENTATIVE_KEYS: { label: string; key: SpellingKey }[] = [
  { label: 'F Major (flat)', key: { scaleRoot: 'F', scaleType: 'Major' } },
  { label: 'G Major (sharp)', key: { scaleRoot: 'G', scaleType: 'Major' } },
  { label: 'D Dorian (modal)', key: { scaleRoot: 'D', scaleType: 'Dorian' } },
  { label: 'G Hirajoshi (pentatonic)', key: { scaleRoot: 'G', scaleType: 'Hirajoshi' } },
  { label: 'E Harmonic Minor', key: { scaleRoot: 'E', scaleType: 'Harmonic Minor' } },
];

// This proves the two pure spelling entry points converge on the same
// spelling for the same pitch class + key. It does NOT prove any rendered
// component displays that spelling correctly: this repo has no DOM/
// testing-library (see .claude/rules/testing.md), so no rendered surface is
// asserted against here — only the two functions those surfaces call.
describe('the two spelling entry points (spellChordRoot/formatChordLabel and spellNoteInKey) never diverge for the same pitch class', () => {
  for (const { label, key } of REPRESENTATIVE_KEYS) {
    test(`${label}: a chord root and a bare note at the same pitch class agree`, () => {
      for (const root of ROOTS) {
        const asChordRoot = spellChordRoot(root, key);
        // spellNoteInKey's contract is a note WITH an octave ('D#4', not 'D#') —
        // ROOTS is bare pitch classes, so an octave is appended to build a
        // valid input, then stripped back off before comparing pitch classes.
        const asBareNote = spellNoteInKey(`${root}4`, key.scaleRoot, key.scaleType).replace(
          /-?\d+$/,
          '',
        );
        expect(asChordRoot).toBe(asBareNote);
      }
    });

    test(`${label}: formatChordLabel's root matches spellChordRoot for every pitch class`, () => {
      for (const root of ROOTS) {
        const viaChordLabel = formatChordLabel(root, 'maj', key);
        const viaSpellChordRoot = spellChordRoot(root, key);
        expect(viaChordLabel.startsWith(viaSpellChordRoot)).toBe(true);
      }
    });
  }
});
