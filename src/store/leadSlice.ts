import type { StoreApi } from 'zustand';
import { getMeter } from '../utils/meter';
import {
  DEFAULT_LEAD_GATE,
  clampLeadCursor,
  copyLeadBar,
  leadActivePosAt,
  leadCursorBar,
  pasteLeadBar,
  leadCoveringNoteIndex,
  leadStoredIndexAt,
  leadStoredIndexAtTick,
  resizeLeadMelody,
  type LeadNote,
} from '../audio/leadMelody';
import { LEAD_WINDOW_OCTAVES, leadRecordOctave } from '../audio/leadStepRecord';
import { isNoteInScale } from '../utils/musicTheory';
import {
  DEFAULT_LEAD_STEP_RESOLUTION,
  LEAD_TICKS_PER_BAR,
  TICKS_PER_SIXTEENTH,
  isLeadStepResolutionId,
  strideFor,
} from '../utils/stepResolution';
import { clampFinite } from './sanitize';
import type { AppStore, LeadSlice } from './types';

type Set = StoreApi<AppStore>['setState'];
type Get = StoreApi<AppStore>['getState'];

/**
 * Bounds of the lead melody's octave window (its LOWEST octave). The window
 * spans LEAD_WINDOW_OCTAVES above this, so 6 puts the top row in octave 7.
 * Clamped here rather than in the +/- buttons so a persisted project can never
 * rehydrate a window the UI cannot reach.
 */
export const LEAD_OCTAVE_MIN = 1;
export const LEAD_OCTAVE_MAX = 6;

/**
 * Lead melody slice. `leadMelodySteps` is stored at a fixed LEAD_TICKS_PER_BAR
 * width per bar (length leadLoopLength × the widest bar in ticks) — the same
 * non-destructive scheme
 * as the chord/bass custom grids — and windowed to stepsPerBar at playback/UI
 * time. A loopLength change resizes by whole bars (trim/pad) via the pure
 * helper, so a meter switch never drops steps.
 */
/** The bar the cursor sits in, with the cursor re-clamped to the live window. */
function selectedBar(state: {
  leadCursor: number;
  leadLoopLength: number;
  leadStepResolution: AppStore['leadStepResolution'];
  meterId: AppStore['meterId'];
}): number {
  const stepsPerBar = getMeter(state.meterId).stepsPerBar;
  const stride = strideFor(state.leadStepResolution);
  return leadCursorBar(
    clampLeadCursor(state.leadCursor, state.leadLoopLength, stepsPerBar, stride),
    stepsPerBar,
    stride,
  );
}

export function createLeadSlice(set: Set, get: Get): LeadSlice {
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
      const stride = strideFor(state.leadStepResolution);
      const stepInLoop = leadActivePosAt(stepIndex, stepsPerBar, stride);
      // A DORMANT slot has no active position, so "what covers it" has no
      // answer: the slot's own contents are the only honest test, and that
      // beats searching from a fictitious position in another bar — which
      // never matched, so a second click used to ADD a duplicate note.
      const coveringIdx =
        stepInLoop < 0
          ? (state.leadMelodySteps[stepIndex]?.some((n) => n.note === note) ? stepIndex : -1)
          : leadCoveringNoteIndex(state.leadMelodySteps, stepInLoop, stepsPerBar, stride, note);
      const covered = coveringIdx >= 0;
      if (mode === 'draw' && covered) return {};
      if (mode === 'erase' && !covered) return {};

      // A covered cell is deleted from the index where the note STARTS, not
      // where it was clicked. (Rejected: truncating the covering note and
      // creating a new one at the click point. More DAW-like, but one click
      // producing two notes is harder to explain, and nothing asks for it.)
      const target = covered ? coveringIdx : stepIndex;
      const row = state.leadMelodySteps[target];
      // No such slot, no edit. (The map this replaces expressed the same
      // thing by matching no index — but it also rebuilt the whole stored
      // array, once per cell of a drag stroke, to change one row.)
      if (!row) return {};
      const next = [...state.leadMelodySteps];
      // The editor writes whole CELLS, and a cell is `stride` ticks. A
      // literal 1 here would draw a note a fraction of a cell long the
      // moment the resolution is anything but the finest.
      next[target] = covered
        ? row.filter((n) => n.note !== note)
        : [...row, { note, len: stride }];
      return { leadMelodySteps: next };
    });

  return {
    leadMelodySteps: Array.from({ length: LEAD_TICKS_PER_BAR }, () => [] as LeadNote[]),
    leadLoopLength: 1,
    leadStepResolution: DEFAULT_LEAD_STEP_RESOLUTION,
    leadMelodyView: 'scale-locked',
    leadMelodyOctave: 3,
    leadGate: DEFAULT_LEAD_GATE,
    leadCursor: 0,
    leadBarClipboard: null,
    leadRecording: false,

    setLeadRecording: (leadRecording) => set({ leadRecording }),

    // Clamped against the CURRENT window on write. It is clamped again on
    // read, because a later meter or loop-length change can narrow the window
    // under a cursor that was legal when it was set.
    setLeadCursor: (cursor) =>
      set((state) => {
        const stepsPerBar = getMeter(state.meterId).stepsPerBar;
        const stride = strideFor(state.leadStepResolution);
        return {
          leadCursor: clampLeadCursor(cursor, state.leadLoopLength, stepsPerBar, stride),
        };
      }),

    // Returns whether it actually wrote, so a caller can tell a captured note
    // from one the grid refused.
    recordLeadNote: (note, column) => {
      const state = get();
      if (!state.leadRecording) return false;

      // Both guards exist to keep one promise: a recorded note is visible on
      // the grid the moment it is recorded. Storing what the grid cannot draw
      // would leave notes that play back but cannot be seen or erased.
      if (
        state.leadMelodyView === 'scale-locked' &&
        !isNoteInScale(note, state.scaleRoot, state.scaleType)
      ) {
        return false;
      }
      const octave = leadRecordOctave(
        note,
        state.leadMelodyOctave,
        LEAD_WINDOW_OCTAVES,
        LEAD_OCTAVE_MIN,
        LEAD_OCTAVE_MAX,
      );
      if (octave === null) return false;

      const stepsPerBar = getMeter(state.meterId).stepsPerBar;
      const stride = strideFor(state.leadStepResolution);
      // Clamped whichever head it came from: a meter or loop-length change can
      // narrow the window under a column that was legal when it was chosen.
      const target = clampLeadCursor(
        column ?? state.leadCursor,
        state.leadLoopLength,
        stepsPerBar,
        stride,
      );
      if (octave !== state.leadMelodyOctave) set({ leadMelodyOctave: octave });
      // 'draw', never 'toggle': playing a note that is already at this column
      // must be a no-op, not a delete. A performer repeating a note expects
      // nothing to happen, not the note to vanish.
      paintLeadNote(leadStoredIndexAt(target, stepsPerBar, stride), note, 'draw');
      return true;
    },

    copySelectedLeadBar: () =>
      set((state) => ({ leadBarClipboard: copyLeadBar(state.leadMelodySteps, selectedBar(state)) })),

    pasteIntoSelectedLeadBar: () =>
      set((state) =>
        state.leadBarClipboard
          ? {
              leadMelodySteps: pasteLeadBar(
                state.leadMelodySteps,
                selectedBar(state),
                state.leadBarClipboard,
                getMeter(state.meterId).stepsPerBar,
                state.leadLoopLength,
              ),
            }
          : {},
      ),

    setLeadMelodySteps: (leadMelodySteps) => set({ leadMelodySteps }),
    setLeadLoopLength: (leadLoopLength) =>
      set((state) => ({
        leadLoopLength,
        leadMelodySteps: resizeLeadMelody(
          state.leadMelodySteps,
          leadLoopLength,
          getMeter(state.meterId).stepsPerBar,
          strideFor(state.leadStepResolution),
        ),
      })),
    // Non-destructive clamp used by the LeadMelodyGrid auto-clamp: lowering the
    // loop length to keep it a divisor of the progression must NOT trim the
    // melody grid, or deleting a chord would permanently delete the drawn notes
    // in the bars that fell out of the loop. The extra bars stay dormant and
    // play again if the loop length is raised back (resizeLeadMelody re-pads).
    setLeadLoopLengthPreserve: (leadLoopLength) => set({ leadLoopLength }),
    // Never throws and never writes the melody: an unknown id falls back to
    // the default, and a resolution change is a change of VIEW. An explicit
    // edit writes; a change of view never does.
    setLeadStepResolution: (id) =>
      set({
        leadStepResolution: isLeadStepResolutionId(id) ? id : DEFAULT_LEAD_STEP_RESOLUTION,
      }),
    setLeadMelodyView: (leadMelodyView) => set({ leadMelodyView }),
    setLeadMelodyOctave: (octave) =>
      set({
        leadMelodyOctave: Math.min(LEAD_OCTAVE_MAX, Math.max(LEAD_OCTAVE_MIN, Math.round(octave))),
      }),
    // Clamped here, not in the slider: the floor stops the slider ever
    // producing a silent note that still shows as drawn in the grid, and the
    // ceiling stops a note overlapping into the next step, which is the
    // overlap invariant 1 exists to prevent.
    setLeadGate: (gate) => set({ leadGate: clampFinite(gate, 0.05, 1, DEFAULT_LEAD_GATE) }),
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
        const stride = strideFor(state.leadStepResolution);
        const activePos = leadActivePosAt(stepIndex, stepsPerBar, stride);
        // Invariant 2 is measured against the loop end, which a dormant slot
        // has no position in: refuse rather than clamp against a fictitious
        // one. Nothing can reach this today (the grid renders active columns
        // only) and the melody survives untouched, as a meter change requires.
        if (activePos < 0) return {};
        const maxLen = Math.max(
          stride,
          state.leadLoopLength * stepsPerBar * TICKS_PER_SIXTEENTH - activePos * stride,
        );
        // The editor writes whole CELLS, so the floor is one cell, not one
        // tick — the same rule paintLeadNote follows. Sub-cell lengths stay
        // REPRESENTABLE (a 1/32-authored note read at 1/8), they just are
        // never created here.
        const nextLen = Number.isFinite(len)
          ? Math.min(maxLen, Math.max(stride, Math.round(len)))
          : stride;

        const next = [...state.leadMelodySteps];
        next[stepIndex] = row.map((n) => (n.note === note ? { note, len: nextLen } : n));
        // Walk TICKS, not columns — the same rule pasteLeadBar follows.
        // Invariant 1 is a rule about STORAGE, so a same-pitch note on a
        // tick the current resolution cannot reach is still underneath this
        // one and must go: leaving it would put two of a pitch on the same
        // span, audible the moment the loop is read at a finer grid.
        // "Quiet, not gone" protects a change of VIEW, never an explicit
        // edit.
        for (let k = 1; k < nextLen; k++) {
          const idx = leadStoredIndexAtTick(activePos * stride + k, stepsPerBar);
          const covered = next[idx];
          if (covered?.some((n) => n.note === note)) {
            next[idx] = covered.filter((n) => n.note !== note);
          }
        }
        return { leadMelodySteps: next };
      }),
  };
}
