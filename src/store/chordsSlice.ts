import type { StoreApi } from 'zustand';
import { normalizePatternSpans } from '@/utils/customPattern';
import type { BassStepChoice } from '@/data/bassPatterns';
import {
  customChordSpans,
  type LoopContent,
  reclampCustomPattern,
  resizedCustomPattern,
  resizePatternSpanAt,
  writePatternEvent,
} from './loop';
import { getMeter } from '../utils/timeSignature';
import type { AppStore, ChordsSlice, ChordsSnapshot } from './types';
import type { ChordItem } from '../types';

type Set = StoreApi<AppStore>['setState'];

/**
 * `setChords`'s write, pure, so a vibe can fold it into one `set()`: the new
 * chords AND both custom lanes re-clamped against them, because a chord
 * boundary and a hold that may not cross it are one fact.
 */
export function chordsPatch(
  state: Pick<
    AppStore,
    | 'meterId'
    | 'customChordRhythm'
    | 'customChordHoldSteps'
    | 'customChordLoopLength'
    | 'customBassPattern'
    | 'customBassHoldSteps'
    | 'customBassLoopLength'
  >,
  chords: ChordItem[],
): Partial<AppStore> {
  const stepsPerBar = getMeter(state.meterId).stepsPerBar;
  const chord = reclampCustomPattern({
    chords,
    stepsPerBar,
    values: state.customChordRhythm,
    holds: state.customChordHoldSteps,
    loopLength: state.customChordLoopLength,
    empty: false,
  });
  const bass = reclampCustomPattern<BassStepChoice>({
    chords,
    stepsPerBar,
    values: state.customBassPattern,
    holds: state.customBassHoldSteps,
    loopLength: state.customBassLoopLength,
    empty: 'rest',
  });
  return {
    chords,
    customChordLoopLength: chord.loopLength,
    customChordRhythm: chord.values,
    customChordHoldSteps: chord.holds,
    customBassLoopLength: bass.loopLength,
    customBassPattern: bass.values,
    customBassHoldSteps: bass.holds,
  };
}

type SnapshotSource = Pick<
  AppStore,
  | 'activeLoopId'
  | 'scaleRoot'
  | 'scaleType'
  | 'meterId'
  | 'chords'
  | 'customChordRhythm'
  | 'customChordHoldSteps'
  | 'customChordLoopLength'
  | 'customBassPattern'
  | 'customBassHoldSteps'
  | 'customBassLoopLength'
>;

/**
 * The Undo snapshot a progression roll takes before it writes (R363). The
 * arrays are shared, not copied: persisted values are replaced, never
 * mutated in place (R210), so a later edit cannot reach into the snapshot.
 */
export function chordsSnapshotOf(state: SnapshotSource): ChordsSnapshot {
  return {
    loopId: state.activeLoopId,
    scaleRoot: state.scaleRoot,
    scaleType: state.scaleType,
    meterId: state.meterId,
    chords: state.chords,
    customChordRhythm: state.customChordRhythm,
    customChordHoldSteps: state.customChordHoldSteps,
    customChordLoopLength: state.customChordLoopLength,
    customBassPattern: state.customBassPattern,
    customBassHoldSteps: state.customBassHoldSteps,
    customBassLoopLength: state.customBassLoopLength,
  };
}

/**
 * A snapshot restores only onto the loop, key, scale and meter it was taken
 * in: after a key or scale change its chords would be in the old key, and
 * after a meter change its holds were clamped against another bar length.
 */
function snapshotApplies(state: SnapshotSource, snapshot: ChordsSnapshot): boolean {
  return (
    state.activeLoopId === snapshot.loopId &&
    state.scaleRoot === snapshot.scaleRoot &&
    state.scaleType === snapshot.scaleType &&
    state.meterId === snapshot.meterId
  );
}

/**
 * Chords slice. `setChordOctave` writes only the octave: `ChordItem` carries
 * no `notes` to keep in sync, so there is nothing left for this action to
 * derive. `setChords` re-clamps BOTH custom lanes in the same `set()` for a
 * similar reason: a chord boundary and a hold that may not cross it are one
 * fact, and a subscriber must never see new chords under an old cycle.
 */
export function createChordsSlice(set: Set, defaults: LoopContent): ChordsSlice {
  return {
    chords: defaults.chords,
    chordRhythmId: defaults.chordRhythmId,
    chordRhythmMode: defaults.chordRhythmMode,
    customChordRhythm: defaults.customChordRhythm,
    customChordLoopLength: defaults.customChordLoopLength,
    customChordHoldSteps: defaults.customChordHoldSteps,
    chordFeel: defaults.chordFeel,
    chordOctave: defaults.chordOctave,
    chordMuted: defaults.chordMuted,
    chordVolume: defaults.chordVolume,

    setChords: (chords) => set((state) => chordsPatch(state, chords)),
    // Verbatim, never through chordsPatch: the lanes were already clamped
    // against these chords when the snapshot was taken. The restore replaces
    // the chords wholesale, so the Auto-Reharmonized badge clears with it
    // (R281). Returning `state` unchanged is a true no-op — zustand skips an
    // identical state and the loop mirror sees no changed field.
    restoreChordsSnapshot: (snapshot) =>
      set((state) =>
        snapshotApplies(state, snapshot)
          ? {
              reharmonizedIndicator: false,
              chords: snapshot.chords,
              customChordRhythm: snapshot.customChordRhythm,
              customChordHoldSteps: snapshot.customChordHoldSteps,
              customChordLoopLength: snapshot.customChordLoopLength,
              customBassPattern: snapshot.customBassPattern,
              customBassHoldSteps: snapshot.customBassHoldSteps,
              customBassLoopLength: snapshot.customBassLoopLength,
            }
          : state,
      ),
    setChordRhythmId: (chordRhythmId) => set({ chordRhythmId }),
    setChordRhythmMode: (chordRhythmMode) => set({ chordRhythmMode }),
    // Stored at a fixed MAX width (non-destructive, drum-row style): the UI
    // toggles one step of the already-wide array, so no per-edit normalization
    // is needed and setMeter never rewrites it.
    setCustomChordRhythm: (customChordRhythm) => set({ customChordRhythm }),

    /**
     * An explicit length change DOES rewrite, and it is the only edit allowed
     * to: the user is stating how long the pattern is, so the arrays are re-cut
     * to whole bars and the holds re-clamped onto the boundaries that length
     * folds the progression onto.
     */
    setCustomChordLoopLength: (bars) =>
      set((state) => {
        const resized = resizedCustomPattern({
          chords: state.chords,
          values: state.customChordRhythm,
          holds: state.customChordHoldSteps,
          requestedBars: bars,
          empty: false,
        });
        const spans = customChordSpans({
          chords: state.chords,
          meterId: state.meterId,
          customChordRhythm: resized.values,
          customChordHoldSteps: resized.holds,
          customChordLoopLength: resized.loopLength,
        });
        const normalized = normalizePatternSpans(spans);
        return {
          customChordLoopLength: resized.loopLength,
          customChordRhythm: normalized.values,
          customChordHoldSteps: normalized.holds,
        };
      }),

    setCustomChordEvent: (column, active) =>
      set((state) => {
        const written = writePatternEvent({ spans: customChordSpans(state), column, value: active });
        if (!written) return state;
        return { customChordRhythm: written.values, customChordHoldSteps: written.holds };
      }),

    // A no-op when no onset starts at `column` — see resizePatternSpanAt.
    setCustomChordEventLength: (column, holdSteps) =>
      set((state) => {
        const written = resizePatternSpanAt(customChordSpans(state), column, holdSteps);
        if (!written) return state;
        return { customChordRhythm: written.values, customChordHoldSteps: written.holds };
      }),

    setChordFeel: (chordFeel) => set({ chordFeel }),
    setChordVolume: (chordVolume) => set({ chordVolume }),
    toggleChordMuted: () => set((state) => ({ chordMuted: !state.chordMuted })),

    setChordOctave: (chordOctave) => set({ chordOctave }),
  };
}
