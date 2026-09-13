import type { StoreApi } from 'zustand';
import { normalizePatternSpans } from '@/utils/customPattern';
import type { BassStepChoice } from '@/data/bassPatterns';
import { INITIAL_CHORDS } from './initialState';
import { DEFAULT_BUS_TRIM_DB } from './levelUnits';
import {
  customChordSpans,
  reclampCustomPattern,
  resizedCustomPattern,
  resizePatternSpanAt,
  writePatternEvent,
} from './loop';
import { deriveChordNotes } from '../utils/musicTheory';
import { getMeter, MAX_STEPS_PER_BAR } from '../utils/meter';
import type { AppStore, ChordsSlice } from './types';

type Set = StoreApi<AppStore>['setState'];

/**
 * Chords slice. `setChordOctave` derives the new chord notes INSIDE the same
 * `set()` call (replacing the old App.tsx effect that mapped the chords
 * afterwards), so the octave and the notes can never be observed out of sync.
 * `setChords` re-clamps BOTH custom lanes in the same `set()` for the same
 * reason: a chord boundary and a hold that may not cross it are one fact, and
 * a subscriber must never see new chords under an old cycle.
 */
export function createChordsSlice(set: Set): ChordsSlice {
  return {
    // The old App derived the chord notes on mount (useEffect on chordOctave),
    // so the initial chords displayed at octave 4 — keep that exact value.
    chords: INITIAL_CHORDS.map((chord) => deriveChordNotes(chord, 4)),
    chordRhythmId: 'sustained',
    chordRhythmMode: 'preset',
    customChordRhythm: new Array<boolean>(MAX_STEPS_PER_BAR).fill(false),
    customChordLoopLength: 1,
    customChordHoldSteps: new Array<number>(MAX_STEPS_PER_BAR).fill(1),
    chordFeel: 0.5,
    chordOctave: 4,
    chordMuted: false,
    chordVolume: DEFAULT_BUS_TRIM_DB,

    setChords: (chords) =>
      set((state) => {
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
      }),
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

    setChordOctave: (chordOctave) =>
      set((state) => ({
        chordOctave,
        chords: state.chords.map((chord) => deriveChordNotes(chord, chordOctave)),
      })),
  };
}
