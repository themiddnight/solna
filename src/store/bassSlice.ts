import type { StoreApi } from 'zustand';
import type { BassStepChoice } from '@/data/bassPatterns';
import { normalizePatternSpans } from '@/utils/customPattern';
import {
  customBassSpans,
  type LoopContent,
  resizedCustomPattern,
  resizePatternSpanAt,
  writePatternEvent,
} from './loop';
import type { AppStore, BassSlice } from './types';

type Set = StoreApi<AppStore>['setState'];

/**
 * Bass module slice: pattern/feel/octave plus per-layer mute and volume.
 *
 * The custom lane's three setters are the chord lane's twins one level down,
 * over a token array instead of a boolean one. The PROGRESSION-write re-clamp
 * lives on `setChords` (chordsSlice) rather than here, because that is the
 * write that moves the boundaries both lanes fold onto.
 */
export function createBassSlice(set: Set, defaults: LoopContent): BassSlice {
  return {
    bassPatternId: defaults.bassPatternId,
    bassPatternMode: defaults.bassPatternMode,
    customBassPattern: defaults.customBassPattern,
    customBassLoopLength: defaults.customBassLoopLength,
    customBassHoldSteps: defaults.customBassHoldSteps,
    bassFeel: defaults.bassFeel,
    bassOctave: defaults.bassOctave,
    bassMuted: defaults.bassMuted,
    bassVolume: defaults.bassVolume,

    setBassPatternId: (bassPatternId) => set({ bassPatternId }),
    setBassPatternMode: (bassPatternMode) => set({ bassPatternMode }),
    setCustomBassPattern: (customBassPattern) => set({ customBassPattern }),

    /** See `setCustomChordLoopLength`: an explicit length is the one re-cutting edit. */
    setCustomBassLoopLength: (bars) =>
      set((state) => {
        const resized = resizedCustomPattern<BassStepChoice>({
          chords: state.chords,
          values: state.customBassPattern,
          holds: state.customBassHoldSteps,
          requestedBars: bars,
          empty: 'rest',
        });
        const spans = customBassSpans({
          chords: state.chords,
          meterId: state.meterId,
          customBassPattern: resized.values,
          customBassHoldSteps: resized.holds,
          customBassLoopLength: resized.loopLength,
        });
        const normalized = normalizePatternSpans(spans);
        return {
          customBassLoopLength: resized.loopLength,
          customBassPattern: normalized.values,
          customBassHoldSteps: normalized.holds,
        };
      }),

    setCustomBassEvent: (column, value) =>
      set((state) => {
        const written = writePatternEvent({ spans: customBassSpans(state), column, value });
        if (!written) return state;
        return { customBassPattern: written.values, customBassHoldSteps: written.holds };
      }),

    // A no-op when no onset starts at `column` — see resizePatternSpanAt.
    setCustomBassEventLength: (column, holdSteps) =>
      set((state) => {
        const written = resizePatternSpanAt(customBassSpans(state), column, holdSteps);
        if (!written) return state;
        return { customBassPattern: written.values, customBassHoldSteps: written.holds };
      }),

    setBassFeel: (bassFeel) => set({ bassFeel }),
    setBassOctave: (bassOctave) => set({ bassOctave }),
    setBassVolume: (bassVolume) => set({ bassVolume }),
    toggleBassMuted: () => set((state) => ({ bassMuted: !state.bassMuted })),
  };
}
