import type { StoreApi } from 'zustand';
import { MAX_STEPS_PER_BAR, getMeter } from '../utils/meter';
import {
  DEFAULT_LEAD_GATE,
  leadActivePosAt,
  leadCoveringNoteIndex,
  leadStoredIndexAt,
  resizeLeadMelody,
  type LeadNote,
} from '../audio/leadMelody';
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
  // Every note add/remove funnels through here, whatever started it: a click,
  // a keyboard activation, or one cell of a drag-to-paint stroke. `mode` is
  // what separates them — 'draw' never removes and 'erase' never adds, so a
  // stroke that crosses a filled cell cannot start eating what it just drew,
  // which a per-cell toggle would do.
  //
  // Once notes have length, melody[stepIndex] is NOT "is this cell filled": a
  // len-4 note at step 0 fills steps 0-3 while slots 1-3 stay empty, so an
  // unguarded append would put a second C4 inside the first one. A covered
  // cell renders filled and carries aria-pressed="true", so what the user
  // sees and what `covered` says are the same thing.
  const paintLeadNote: LeadSlice['paintLeadNote'] = (stepIndex, note, mode) =>
    set((state) => {
      const stepsPerBar = getMeter(state.meterId).stepsPerBar;
      const stepInLoop = leadActivePosAt(stepIndex, stepsPerBar);
      // A DORMANT slot has no active position, so "what covers it" has no
      // answer: the slot's own contents are the only honest test, and that
      // beats searching from a fictitious position in another bar — which
      // never matched, so a second click used to ADD a duplicate note.
      const coveringIdx =
        stepInLoop < 0
          ? (state.leadMelodySteps[stepIndex]?.some((n) => n.note === note) ? stepIndex : -1)
          : leadCoveringNoteIndex(state.leadMelodySteps, stepInLoop, stepsPerBar, note);
      const covered = coveringIdx >= 0;
      if (mode === 'draw' && covered) return {};
      if (mode === 'erase' && !covered) return {};

      // A covered cell is deleted from the index where the note STARTS, not
      // where it was clicked. (Rejected: truncating the covering note and
      // creating a new one at the click point. More DAW-like, but one click
      // producing two notes is harder to explain, and nothing asks for it.)
      const target = covered ? coveringIdx : stepIndex;
      return {
        leadMelodySteps: state.leadMelodySteps.map((r, i) => {
          if (i !== target) return r;
          return covered ? r.filter((n) => n.note !== note) : [...r, { note, len: 1 }];
        }),
      };
    });

  return {
    leadMelodySteps: Array.from({ length: MAX_STEPS_PER_BAR }, () => [] as LeadNote[]),
    leadLoopLength: 1,
    leadMelodyView: 'scale-locked',
    leadMelodyOctave: 3,
    leadGate: DEFAULT_LEAD_GATE,

    setLeadMelodySteps: (leadMelodySteps) => set({ leadMelodySteps }),
    setLeadLoopLength: (leadLoopLength) =>
      set((state) => ({
        leadLoopLength,
        leadMelodySteps: resizeLeadMelody(
          state.leadMelodySteps,
          leadLoopLength,
          getMeter(state.meterId).stepsPerBar,
        ),
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
    // Clamped here, not in the slider: the floor stops the slider ever
    // producing a silent note that still shows as drawn in the grid, and the
    // ceiling stops a note overlapping into the next step, which is the
    // overlap invariant 1 exists to prevent.
    setLeadGate: (gate) =>
      set({
        leadGate: Number.isFinite(gate)
          ? Math.min(1, Math.max(0.05, gate))
          : DEFAULT_LEAD_GATE,
      }),
    toggleLeadNote: (stepIndex, note) => paintLeadNote(stepIndex, note, 'toggle'),

    paintLeadNote,

    // All three invariants live here, never at a call site — a call site that
    // can violate an invariant is a call site that eventually will.
    //   1. Same-row overlap SWALLOWS the covered note (what Ableton and Logic
    //      do; anything else makes a drag either silently fail or need a modal).
    //      Only forward, from this note's start: the spec's rule is about
    //      EXTENDING over a note, so notes that start earlier keep their length.
    //   2. start + len never crosses the loop end — clamped on write, so notes
    //      never wrap and leadSoundingNotes can stop its scan at step 0.
    //   3. len is an integer >= 1.
    setLeadNoteLength: (stepIndex, note, len) =>
      set((state) => {
        const row = state.leadMelodySteps[stepIndex];
        if (!row || !row.some((n) => n.note === note)) return {};

        const stepsPerBar = getMeter(state.meterId).stepsPerBar;
        const activePos = leadActivePosAt(stepIndex, stepsPerBar);
        // Invariant 2 is measured against the loop end, which a dormant slot
        // has no position in: refuse rather than clamp against a fictitious
        // one. Nothing can reach this today (the grid renders active columns
        // only) and the melody survives untouched, as a meter change requires.
        if (activePos < 0) return {};
        const maxLen = Math.max(1, state.leadLoopLength * stepsPerBar - activePos);
        const nextLen = Number.isFinite(len)
          ? Math.min(maxLen, Math.max(1, Math.round(len)))
          : 1;

        const next = [...state.leadMelodySteps];
        next[stepIndex] = row.map((n) => (n.note === note ? { note, len: nextLen } : n));
        for (let k = 1; k < nextLen; k++) {
          const idx = leadStoredIndexAt(activePos + k, stepsPerBar);
          const covered = next[idx];
          if (covered?.some((n) => n.note === note)) {
            next[idx] = covered.filter((n) => n.note !== note);
          }
        }
        return { leadMelodySteps: next };
      }),
  };
}
