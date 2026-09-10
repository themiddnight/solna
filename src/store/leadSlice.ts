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
import { melodyTrack, type MelodyTrack, type MelodyTrackId } from './melodyTracks';
import type { AppStore, LeadMelodyView, LeadNotePaintMode, LeadSlice } from './types';

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
function selectedBar(state: AppStore, track: MelodyTrack): number {
  const stepsPerBar = getMeter(state.meterId).stepsPerBar;
  const stride = strideFor(state[track.stepResolution]);
  return leadCursorBar(
    clampLeadCursor(state[track.cursor], state[track.loopLength], stepsPerBar, stride),
    stepsPerBar,
    stride,
  );
}

/**
 * The action names each track's slice exposes. Spelled out for the same reason
 * MELODY_TRACKS spells its field names out: a templated `set${Id}Gate` is a
 * string the compiler cannot check against the slice interface, so a typo would
 * surface as a missing action at click time rather than at build time.
 *
 * Each field is typed `Extract<keyof AppStore, string>`, not plain `string`:
 * `createMelodySlice` builds its return object using these names as computed
 * keys and casts the whole thing `as LeadSlice`/`as FxSlice` at the two call
 * sites below, so a value here that is not an actual `AppStore` key used to
 * compile fine and return `undefined` at runtime for whatever typo'd action a
 * caller invoked. Tying the value type to `keyof AppStore` turns that same
 * typo into a build error instead.
 */
const ACTIONS: Record<MelodyTrackId, {
  setSteps: Extract<keyof AppStore, string>; setLoopLength: Extract<keyof AppStore, string>; setLoopLengthPreserve: Extract<keyof AppStore, string>;
  setStepResolution: Extract<keyof AppStore, string>; setView: Extract<keyof AppStore, string>; setOctave: Extract<keyof AppStore, string>; setGate: Extract<keyof AppStore, string>;
  toggleNote: Extract<keyof AppStore, string>; paintNote: Extract<keyof AppStore, string>; setNoteLength: Extract<keyof AppStore, string>;
  setCursor: Extract<keyof AppStore, string>; copyBar: Extract<keyof AppStore, string>; pasteBar: Extract<keyof AppStore, string>;
}> = {
  lead: {
    setSteps: 'setLeadMelodySteps', setLoopLength: 'setLeadLoopLength',
    setLoopLengthPreserve: 'setLeadLoopLengthPreserve', setStepResolution: 'setLeadStepResolution',
    setView: 'setLeadMelodyView', setOctave: 'setLeadMelodyOctave', setGate: 'setLeadGate',
    toggleNote: 'toggleLeadNote', paintNote: 'paintLeadNote', setNoteLength: 'setLeadNoteLength',
    setCursor: 'setLeadCursor', copyBar: 'copySelectedLeadBar', pasteBar: 'pasteIntoSelectedLeadBar',
  },
  fx: {
    setSteps: 'setFxMelodySteps', setLoopLength: 'setFxLoopLength',
    setLoopLengthPreserve: 'setFxLoopLengthPreserve', setStepResolution: 'setFxStepResolution',
    setView: 'setFxMelodyView', setOctave: 'setFxMelodyOctave', setGate: 'setFxGate',
    toggleNote: 'toggleFxNote', paintNote: 'paintFxNote', setNoteLength: 'setFxNoteLength',
    setCursor: 'setFxCursor', copyBar: 'copySelectedFxBar', pasteBar: 'pasteIntoSelectedFxBar',
  },
};

/**
 * ONE melody slice, instantiated per MELODY_TRACKS row. Every store field it
 * touches is read through `track`, never by literal name, so Lead and FX are one
 * implementation with two rows rather than two files that drift.
 *
 * The pure helpers below (leadActivePosAt, resizeLeadMelody, clampLeadCursor,
 * copyLeadBar, pasteLeadBar, …) take notes, stepsPerBar and stride as arguments
 * and read no store field — src/audio/ may not import src/store/ at all — so
 * they are already track-agnostic and take no track parameter. Giving them one
 * would be an unused parameter, which `bun run eslint` reports.
 *
 * `recordLeadNote` is NOT here: live capture is lead-only (one note-input
 * dispatcher, store/leadRecord.ts's leadMarkerFollowsClock), so it stays in
 * createLeadSlice below. The arm itself, `recordingTrack`, is not even a lead
 * field — it lives on the ui slice because its whole purpose is being unique
 * ACROSS tracks (see its docblock in types.ts).
 *
 * The return type is `Partial<AppStore>` because the KEYS are per-track — this
 * one factory produces `setLeadGate` for one row and `setFxGate` for the other,
 * so no single named slice interface describes both. Each of the two call sites
 * below narrows it back to its own slice type (`LeadSlice` / `FxSlice`) with a
 * single cast, which is the ONE narrowing pattern this refactor uses: both
 * interfaces are declared by hand in types.ts, so a missing action is still a
 * compile error at every consumer. `fxSlice.test.ts` exercises 5 of the 16 fx
 * actions through the live store (`setFxLoopLength`, `setFxCursor`,
 * `copySelectedFxBar`, `paintFxNote`, `setFxNoteLength`) — not all of them, so
 * this is partial coverage by the live store, not exhaustive proof of the
 * factory's per-track wiring. (The object below is assembled as
 * `Record<string, unknown>` and cast once to `Partial<AppStore>` at the return —
 * unavoidable because every key here is a computed `track.*` column, and
 * TypeScript cannot check a dynamically-keyed object literal against a fixed
 * many-field interface without one.)
 */
export function createMelodySlice(
  track: MelodyTrack,
  set: Set,
  // Unused here: every action this factory builds writes through `set`'s
  // updater form alone. Kept in the signature (matching `Get`, the same pair
  // every other slice factory takes) rather than dropped, so a future melody
  // action that DOES need a synchronous read is a one-line addition, not a
  // signature change at both call sites.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  get: Get,
): Partial<AppStore> {
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
  const paintNote = (stepIndex: number, note: string, mode: LeadNotePaintMode) =>
    set((state) => {
      const stepsPerBar = getMeter(state.meterId).stepsPerBar;
      const stride = strideFor(state[track.stepResolution]);
      const stepInLoop = leadActivePosAt(stepIndex, stepsPerBar, stride);
      // A DORMANT slot has no active position, so "what covers it" has no
      // answer: the slot's own contents are the only honest test, and that
      // beats searching from a fictitious position in another bar — which
      // never matched, so a second click used to ADD a duplicate note.
      const coveringIdx =
        stepInLoop < 0
          ? (state[track.steps][stepIndex]?.some((n) => n.note === note) ? stepIndex : -1)
          : leadCoveringNoteIndex(state[track.steps], stepInLoop, stepsPerBar, stride, note);
      const covered = coveringIdx >= 0;
      if (mode === 'draw' && covered) return {};
      if (mode === 'erase' && !covered) return {};

      // A covered cell is deleted from the index where the note STARTS, not
      // where it was clicked. (Rejected: truncating the covering note and
      // creating a new one at the click point. More DAW-like, but one click
      // producing two notes is harder to explain, and nothing asks for it.)
      const target = covered ? coveringIdx : stepIndex;
      const row = state[track.steps][target];
      // No such slot, no edit. (The map this replaces expressed the same
      // thing by matching no index — but it also rebuilt the whole stored
      // array, once per cell of a drag stroke, to change one row.)
      if (!row) return {};
      const next = [...state[track.steps]];
      // The editor writes whole CELLS, and a cell is `stride` ticks. A
      // literal 1 here would draw a note a fraction of a cell long the
      // moment the resolution is anything but the finest.
      next[target] = covered
        ? row.filter((n) => n.note !== note)
        : [...row, { note, len: stride }];
      return { [track.steps]: next };
    });

  const actions = ACTIONS[track.id];

  const slice: Record<string, unknown> = {
    [track.steps]: Array.from({ length: LEAD_TICKS_PER_BAR }, () => [] as LeadNote[]),
    [track.loopLength]: 1,
    [track.stepResolution]: DEFAULT_LEAD_STEP_RESOLUTION,
    [track.view]: 'scale-locked',
    [track.octave]: 3,
    [track.gate]: DEFAULT_LEAD_GATE,
    [track.cursor]: 0,
    [track.clipboard]: null,

    // Clamped against the CURRENT window on write. It is clamped again on
    // read, because a later meter or loop-length change can narrow the window
    // under a cursor that was legal when it was set.
    [actions.setCursor]: (cursor: number) =>
      set((state) => {
        const stepsPerBar = getMeter(state.meterId).stepsPerBar;
        const stride = strideFor(state[track.stepResolution]);
        return {
          [track.cursor]: clampLeadCursor(cursor, state[track.loopLength], stepsPerBar, stride),
        };
      }),

    [actions.copyBar]: () =>
      set((state) => ({
        [track.clipboard]: copyLeadBar(state[track.steps], selectedBar(state, track)),
      })),

    [actions.pasteBar]: () =>
      set((state) => {
        const clipboard = state[track.clipboard];
        return clipboard
          ? {
              [track.steps]: pasteLeadBar(
                state[track.steps],
                selectedBar(state, track),
                clipboard,
                getMeter(state.meterId).stepsPerBar,
                state[track.loopLength],
              ),
            }
          : {};
      }),

    [actions.setSteps]: (steps: LeadNote[][]) => set({ [track.steps]: steps }),
    [actions.setLoopLength]: (loopLength: number) =>
      set((state) => ({
        [track.loopLength]: loopLength,
        [track.steps]: resizeLeadMelody(
          state[track.steps],
          loopLength,
          getMeter(state.meterId).stepsPerBar,
          strideFor(state[track.stepResolution]),
        ),
      })),
    // Non-destructive clamp used by the melody grid's auto-clamp: lowering the
    // loop length to keep it a divisor of the progression must NOT trim the
    // melody grid, or deleting a chord would permanently delete the drawn notes
    // in the bars that fell out of the loop. The extra bars stay dormant and
    // play again if the loop length is raised back (resizeLeadMelody re-pads).
    [actions.setLoopLengthPreserve]: (loopLength: number) => set({ [track.loopLength]: loopLength }),
    // Never throws and never writes the melody: an unknown id falls back to
    // the default, and a resolution change is a change of VIEW. An explicit
    // edit writes; a change of view never does.
    [actions.setStepResolution]: (id: string) =>
      set({
        [track.stepResolution]: isLeadStepResolutionId(id) ? id : DEFAULT_LEAD_STEP_RESOLUTION,
      }),
    [actions.setView]: (view: LeadMelodyView) => set({ [track.view]: view }),
    [actions.setOctave]: (octave: number) =>
      set({
        [track.octave]: Math.min(LEAD_OCTAVE_MAX, Math.max(LEAD_OCTAVE_MIN, Math.round(octave))),
      }),
    // Clamped here, not in the slider: the floor stops the slider ever
    // producing a silent note that still shows as drawn in the grid, and the
    // ceiling stops a note overlapping into the next step, which is the
    // overlap invariant 1 exists to prevent.
    [actions.setGate]: (gate: number) => set({ [track.gate]: clampFinite(gate, 0.05, 1, DEFAULT_LEAD_GATE) }),
    [actions.toggleNote]: (stepIndex: number, note: string) => paintNote(stepIndex, note, 'toggle'),

    [actions.paintNote]: paintNote,

    // All three invariants live here, never at a call site — a call site that
    // can violate an invariant is a call site that eventually will.
    //   1. Same-row overlap SWALLOWS the covered note (what Ableton and Logic
    //      do; anything else makes a drag either silently fail or need a modal).
    //      Only forward, from this note's start: the spec's rule is about
    //      EXTENDING over a note, so notes that start earlier keep their length.
    //   2. start + len never crosses the loop end — clamped on write, so notes
    //      never wrap and leadSoundingNotes can stop its scan at step 0.
    //   3. len is an integer >= 1.
    [actions.setNoteLength]: (stepIndex: number, note: string, len: number) =>
      set((state) => {
        const row = state[track.steps][stepIndex];
        if (!row || !row.some((n) => n.note === note)) return {};

        const stepsPerBar = getMeter(state.meterId).stepsPerBar;
        const stride = strideFor(state[track.stepResolution]);
        const activePos = leadActivePosAt(stepIndex, stepsPerBar, stride);
        // Invariant 2 is measured against the loop end, which a dormant slot
        // has no position in: refuse rather than clamp against a fictitious
        // one. Nothing can reach this today (the grid renders active columns
        // only) and the melody survives untouched, as a meter change requires.
        if (activePos < 0) return {};
        const maxLen = Math.max(
          stride,
          state[track.loopLength] * stepsPerBar * TICKS_PER_SIXTEENTH - activePos * stride,
        );
        // The editor writes whole CELLS, so the floor is one cell, not one
        // tick — the same rule paintNote follows. Sub-cell lengths stay
        // REPRESENTABLE (a 1/32-authored note read at 1/8), they just are
        // never created here.
        const nextLen = Number.isFinite(len)
          ? Math.min(maxLen, Math.max(stride, Math.round(len)))
          : stride;

        const next = [...state[track.steps]];
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
          if (covered?.some((n: LeadNote) => n.note === note)) {
            next[idx] = covered.filter((n: LeadNote) => n.note !== note);
          }
        }
        return { [track.steps]: next };
      }),
  };

  return slice as Partial<AppStore>;
}

export function createLeadSlice(set: Set, get: Get): LeadSlice {
  const melody = createMelodySlice(melodyTrack('lead'), set, get);
  const paintLeadNote = melody.paintLeadNote as LeadSlice['paintLeadNote'];

  return {
    ...melody,

    // Returns whether it actually wrote, so a caller can tell a captured note
    // from one the grid refused.
    recordLeadNote: (note, column) => {
      const state = get();
      // The ARMED TRACK, not a boolean: one scalar in the ui slice holds it,
      // so each track asks whether the arm is pointed at it.
      if (state.recordingTrack !== 'lead') return false;

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
      const before = state.leadMelodySteps;
      paintLeadNote(leadStoredIndexAt(target, stepsPerBar, stride), note, 'draw');
      // And a no-op must REPORT as one. 'draw' declines a column already
      // covered by a note that started earlier, and the live recorder uses
      // this answer to register a held note against that row — told true, it
      // would hold a row that does not contain the pitch, and the note-off's
      // setLeadNoteLength would silently find nothing to lengthen.
      return get().leadMelodySteps !== before;
    },
  } as LeadSlice;
}
