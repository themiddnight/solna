import { describe, expect, test } from 'bun:test';
import { formatChordLabel } from '@/utils/musicTheory';
import type { ChordViewState } from './useChordView';

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

/**
 * Perf fix (react-perf-fixes task 6): `useChordViewState` no longer
 * subscribes to `s.synthParams` (Lead's whole patch) — it was only ever read
 * to forward to `ChordPresetLibrary`, a lazily-loaded drawer that's almost
 * always closed, so a Lead-synth knob edit or vibe reroll no longer needs to
 * re-render the always-mounted `ChordView`. `ChordViewState` has no exported
 * pure entry point to call the hook outside a render (it composes
 * `useAppStore`, `useChordAudition` and several `useMemo`s), so this is a
 * type-level guard: if `synthParams` were ever re-added to the hook's
 * returned object, this assignment would stop compiling under `bun run
 * lint`, the same technique `CustomPatternTimeline.test.tsx` uses for its
 * `currentStep` prop-shape claim.
 */
describe('Chord View state no longer carries synthParams', () => {
  test('ChordViewState has no synthParams field', () => {
    type AssertNoSynthParams = 'synthParams' extends keyof ChordViewState
      ? 'FAIL: synthParams re-added to ChordViewState'
      : true;
    const guard: AssertNoSynthParams = true;
    expect(guard).toBe(true);
  });
});
