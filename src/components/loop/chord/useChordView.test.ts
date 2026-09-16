import { describe, expect, test } from 'bun:test';
import { formatChordLabel } from '@/utils/musicTheory';

/**
 * Pins the Chord View quick-save fix (DEV-398 final review, Finding 1):
 * `useProgressionSaves`'s `handleQuickSaveSubmit` builds its roman summary
 * with `formatChordLabel(c.root, c.quality, state.spellingKey)`, where
 * `state.spellingKey` is `{ scaleRoot, scaleType }` as built by
 * `useChordViewState`. This test does not import the hook itself (it has no
 * exported pure entry point for this string), so it asserts the same call
 * shape directly against `formatChordLabel` with a real enharmonic-sensitive
 * example — Bb Major's IV, already pinned as Eb (not D#) in
 * `src/utils/noteSpelling.test.ts`.
 */
describe('Chord View quick-save roman summary spelling', () => {
  test('spells a chord root in the loop key rather than canonical-sharp', () => {
    const spellingKey = { scaleRoot: 'A#', scaleType: 'Major' as const };
    // Bb major's IV is built on pitch class 3 (canonical 'D#'), spelled 'Eb' in this key.
    expect(formatChordLabel('D#', 'maj', spellingKey).startsWith('Eb')).toBe(true);
    expect(formatChordLabel('D#', 'maj')).not.toBe(formatChordLabel('D#', 'maj', spellingKey));
  });
});
