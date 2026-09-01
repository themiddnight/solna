import type { StoreApi } from 'zustand';
import { MAX_STEPS_PER_BAR } from '../utils/meter';
import { resizeLeadMelody } from '../audio/leadMelody';
import type { AppStore, LeadSlice } from './types';

type Set = StoreApi<AppStore>['setState'];

/**
 * Bounds of the lead melody's octave window (its LOWEST octave). The window
 * spans LEAD_WINDOW_OCTAVES above this, so 6 puts the top row in octave 7.
 * Clamped here rather than in the +/- buttons so a persisted project can never
 * rehydrate a window the UI cannot reach.
 */
export const LEAD_OCTAVE_MIN = 1;
export const LEAD_OCTAVE_MAX = 6;

/**
 * Lead melody slice. `leadMelodySteps` is stored at a fixed MAX_STEPS_PER_BAR
 * width per bar (length leadLoopLength × 24) — the same non-destructive scheme
 * as the chord/bass custom grids — and windowed to stepsPerBar at playback/UI
 * time. A loopLength change resizes by whole bars (trim/pad) via the pure
 * helper, so a meter switch never drops steps.
 */
export function createLeadSlice(set: Set): LeadSlice {
  return {
    leadMelodySteps: Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as string[]),
    leadLoopLength: 1,
    leadMelodyView: 'scale-locked',
    leadMelodyOctave: 3,

    setLeadMelodySteps: (leadMelodySteps) => set({ leadMelodySteps }),
    setLeadLoopLength: (leadLoopLength) =>
      set((state) => ({
        leadLoopLength,
        leadMelodySteps: resizeLeadMelody(state.leadMelodySteps, leadLoopLength),
      })),
    // Non-destructive clamp used by the LeadMelodyGrid auto-clamp: lowering the
    // loop length to keep it a divisor of the progression must NOT trim the
    // melody grid, or deleting a chord would permanently delete the drawn notes
    // in the bars that fell out of the loop. The extra bars stay dormant and
    // play again if the loop length is raised back (resizeLeadMelody re-pads).
    setLeadLoopLengthPreserve: (leadLoopLength) => set({ leadLoopLength }),
    setLeadMelodyView: (leadMelodyView) => set({ leadMelodyView }),
    setLeadMelodyOctave: (octave) =>
      set({
        leadMelodyOctave: Math.min(LEAD_OCTAVE_MAX, Math.max(LEAD_OCTAVE_MIN, Math.round(octave))),
      }),
    toggleLeadNote: (stepIndex, note) =>
      set((state) => {
        const row = state.leadMelodySteps[stepIndex] ?? [];
        const has = row.includes(note);
        const nextRow = has ? row.filter((n) => n !== note) : [...row, note];
        return {
          leadMelodySteps: state.leadMelodySteps.map((r, i) =>
            i === stepIndex ? nextRow : r,
          ),
        };
      }),
  };
}
