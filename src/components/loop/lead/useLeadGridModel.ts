import { useCallback, useEffect, useMemo } from 'react';
import { useAppStore } from '@/store/store';
import { useLiveStore } from '@/components/ui/useLiveStore';
import { melodyTrack, type MelodyTrackId } from '@/store/melodyTracks';
import { MELODY_ACTIONS } from '@/store/leadSlice';
import { melodyTrackForFocus } from '@/store/focusTrack';
import { getMeter } from '@/utils/meter';
import { loopBars } from '@/utils/songStructure';
import { columnsPerBar, strideFor } from '@/utils/stepResolution';
import {
  clampLeadCursor,
  clampLeadLoopLength,
  leadCursorBar,
  loopLengthDivisors,
  type LeadNote,
} from '@/audio/leadMelody';
import { previewSequencerNote } from '@/audio/playback/presetPreview';
import {
  LEAD_WINDOW_OCTAVES,
  leadColumnCells,
  leadNotesInWindow,
  leadOutOfScaleRows,
  leadPitchRows,
  leadPreviewHoldSec,
  leadRowLabel,
} from './melodyGrid';

/**
 * Everything the grid SHOWS, read once: the track's stored values through the
 * MELODY_TRACKS table, the geometry the meter and the stride derive, and the
 * three per-row answers both the note column and the cell matrix read.
 *
 * Split out of LeadMelodyGrid because the grid's own body had grown to hold
 * both halves of that sentence — what to draw and how to draw it — and only
 * the second half is the component.
 */
export function useLeadGridModel(trackId: MelodyTrackId) {
  const track = melodyTrack(trackId);
  const actions = MELODY_ACTIONS[trackId];
  const meterId = useAppStore((s) => s.meterId);
  const melodySteps = useAppStore((s) => s[track.steps]);
  const melodyLoopLength = useAppStore((s) => s[track.loopLength]);
  const melodyStepResolution = useAppStore((s) => s[track.stepResolution]);
  const melodyView = useAppStore((s) => s[track.view]);
  const melodyOctave = useAppStore((s) => s[track.octave]);
  const melodyGate = useAppStore((s) => s[track.gate]);
  const scaleRoot = useAppStore((s) => s.scaleRoot);
  const scaleType = useAppStore((s) => s.scaleType);
  const chords = useAppStore((s) => s.chords);
  const setMelodyStepResolution = useAppStore((s) => s[actions.setStepResolution]);
  const setMelodyView = useAppStore((s) => s[actions.setView]);
  const setMelodyOctave = useAppStore((s) => s[actions.setOctave]);
  const setMelodyLoopLength = useAppStore((s) => s[actions.setLoopLength]);
  const setMelodyLoopLengthPreserve = useAppStore((s) => s[actions.setLoopLengthPreserve]);
  const setMelodySteps = useAppStore((s) => s[actions.setSteps]);
  const setMelodyGate = useAppStore((s) => s[actions.setGate]);
  const setMelodyNoteLength = useAppStore((s) => s[actions.setNoteLength]);

  const meter = getMeter(meterId);
  const stepsPerBar = meter.stepsPerBar;
  const totalBars = loopBars(chords);
  const divisors = loopLengthDivisors(totalBars);
  const stride = strideFor(melodyStepResolution);
  const colsPerBar = columnsPerBar(stepsPerBar, stride);
  const cellsPerBar = useMemo(() => leadColumnCells(meter, stride), [meter, stride]);

  const columns = melodyLoopLength * colsPerBar;

  // The rows a scale-locked view would otherwise drop. A note outside the key
  // is never deleted — it just had no row to be drawn on, so switching to
  // scale-locked hid it. Borrowing the row back is derived, not stored: erase
  // the last note on a borrowed row and the row goes with it, exactly as an
  // in-scale row keeps its place because the scale still names it.
  const borrowedNotes = useMemo(
    () => leadNotesInWindow(melodySteps, columns, stepsPerBar, stride),
    [melodySteps, columns, stepsPerBar, stride],
  );

  const rows = useMemo(
    () =>
      leadPitchRows(
        melodyView,
        scaleRoot,
        scaleType,
        melodyOctave,
        LEAD_WINDOW_OCTAVES,
        borrowedNotes,
      ),
    [melodyView, scaleRoot, scaleType, melodyOctave, borrowedNotes],
  );

  // Memoized beside rowLabels and for the same reason: both readers — the note
  // column here and the cell grid below — need one answer per row, and
  // isNoteInScale builds a tonal note behind every call.
  const outOfScale = useMemo(
    () => leadOutOfScaleRows(rows, scaleRoot, scaleType),
    [rows, scaleRoot, scaleType],
  );

  // One label per row, computed here because both the note column and the cell
  // grid render it. Each call rebuilds a tonal Scale behind the spelling cache,
  // so a per-cell — or even a twice-per-row — derivation is work the row count
  // already bounds.
  const rowLabels = useMemo(
    () => rows.map((note) => leadRowLabel(note, melodyView, scaleRoot, scaleType)),
    [rows, melodyView, scaleRoot, scaleType],
  );

  // Clamp loopLength down when the progression no longer divides it. Uses the
  // non-destructive setter: resizing here would trim the melody grid, so
  // deleting a chord on the Chord tab would permanently delete the drawn notes
  // in the bars that fell out of the loop (they stay dormant and return if the
  // loop length is raised again).
  useEffect(() => {
    const clamped = clampLeadLoopLength(melodyLoopLength, totalBars);
    if (clamped !== melodyLoopLength) setMelodyLoopLengthPreserve(clamped);
  }, [totalBars, melodyLoopLength, setMelodyLoopLengthPreserve]);

  return {
    track, meter, stepsPerBar, divisors, stride, colsPerBar, cellsPerBar, columns,
    melodySteps, melodyLoopLength, melodyStepResolution, melodyView, melodyOctave, melodyGate,
    rows, outOfScale, rowLabels, scaleRoot,
    setMelodyView, setMelodyOctave, setMelodyLoopLength, setMelodyStepResolution, setMelodyGate,
    setMelodySteps, setMelodyNoteLength,
  };
}

export type LeadGridModel = ReturnType<typeof useLeadGridModel>;

/**
 * Where the grid's selection and its arm are: the cursor column, the bar it
 * lands in, and whether THIS grid owns the Rec button.
 *
 * `useLiveStore`, not `useAppStore`, for the three arm values: this markup has
 * to reflect a test-set focus under renderToString, where zustand serves the
 * creation-time state as the server snapshot (see .claude/rules/testing.md and
 * BottomInputDock.tsx).
 */
export function useLeadGridTransport(trackId: MelodyTrackId, model: LeadGridModel) {
  const track = melodyTrack(trackId);
  const actions = MELODY_ACTIONS[trackId];
  const melodyCursor = useAppStore((s) => s[track.cursor]);
  const setMelodyCursor = useAppStore((s) => s[actions.setCursor]);
  const copySelectedLeadBar = useAppStore((s) => s[actions.copyBar]);
  const pasteIntoSelectedLeadBar = useAppStore((s) => s[actions.pasteBar]);
  const hasClipboard = useAppStore((s) => s[track.clipboard] !== null);
  const armed = useLiveStore((s) => s.recordingTrack) === trackId;
  const setRecordingTrack = useLiveStore((s) => s.setRecordingTrack);
  const showRec = useLiveStore((s) => melodyTrackForFocus(s.focusTrack)) === trackId;

  // Clamped again HERE, not only on write: a meter or loop-length change can
  // narrow the window under a cursor that was legal when it was set.
  const cursor = clampLeadCursor(
    melodyCursor,
    model.melodyLoopLength,
    model.stepsPerBar,
    model.stride,
  );
  const selectedBar = leadCursorBar(cursor, model.stepsPerBar, model.stride);

  return {
    cursor, selectedBar, setMelodyCursor, copySelectedLeadBar, pasteIntoSelectedLeadBar,
    hasClipboard, armed, setRecordingTrack, showRec,
  };
}

export type LeadGridTransport = ReturnType<typeof useLeadGridTransport>;

/** The three one-shot edits the grid's action lane performs on the melody. */
export function useLeadGridCommands(trackId: MelodyTrackId, model: LeadGridModel) {
  const track = melodyTrack(trackId);
  const actions = MELODY_ACTIONS[trackId];
  const setMelodyNoteLength = useAppStore((s) => s[actions.setNoteLength]);
  const setMelodySteps = useAppStore((s) => s[actions.setSteps]);
  const { melodySteps, stride } = model;

  const onResize = useCallback(
    (stepIndex: number, note: string, len: number) => setMelodyNoteLength(stepIndex, note, len),
    [setMelodyNoteLength],
  );

  const clearMelody = useCallback(
    () => setMelodySteps(melodySteps.map(() => [] as LeadNote[])),
    [melodySteps, setMelodySteps],
  );

  // previewSequencerNote, not synthPlaybackNoteOn: hearing a cell you clicked
  // is not performing a note, so the note-input bus must not see it — and it
  // runs on the 'preview' bus, so its release cannot cut a key the player is
  // holding at the same pitch. It calls audioEngine.init() itself.
  //
  // The length comes from leadPreviewHoldSec, not from a constant: a fixed gate
  // is silent for any patch whose attack outruns it, so its only safe value is
  // a measurement against the slowest patch in the library — a hidden
  // dependency on the preset table. `lenTicks` omitted means a row label, which
  // sounds one beat; passed, it means a cell, which sounds what it draws.
  //
  // bpm AND synthParams are read off getState() rather than subscribed to or
  // closed over. This grid already re-renders once per 16th to move the
  // playhead, and a preview is a click: the value at click time is the only
  // one that can matter. synthParams in particular must not sit in the
  // useCallback deps — it is store state ui/Knob.tsx writes on every
  // pointermove, so a synth-cutoff drag would change previewNote's identity
  // once per frame, and previewNote is a prop of the React.memo'd
  // LeadMelodyCells, so that identity change re-rendered the whole cell
  // matrix of BOTH mounted melody grids per pointer move for a callback
  // nothing renders.
  const previewNote = useCallback(
    (note: string, lenTicks?: number) => {
      const state = useAppStore.getState();
      const params = state[track.synthParams];
      previewSequencerNote(note, params, undefined, {
        holdSec: leadPreviewHoldSec(state.bpm, stride, lenTicks),
        releaseSec: params.release,
      });
    },
    [stride, track.synthParams],
  );

  return { onResize, clearMelody, previewNote };
}

export type LeadGridCommands = ReturnType<typeof useLeadGridCommands>;
