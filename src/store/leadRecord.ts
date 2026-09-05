import { subscribeNoteInput } from '../audio/playback/noteInputBus';
import { clampLeadCursor, leadStoredIndexAt } from '../audio/leadMelody';
import { clockStepToGridColumn, heldStepLength } from '../audio/leadLiveRecord';
import { leadLiveInputStep, startLeadLiveClock } from '../audio/playback/leadLiveClock';
import { getMeter } from '../utils/meter';
import { columnsPerBar, strideFor } from '../utils/stepResolution';
import { isPlayerActive } from './transportSlice';
import { useAppStore } from './store';
import type { PlayerState } from './types';

/**
 * Is there music to play along to?
 *
 * The DEV-370 guard was `leadPlayer !== 'stopped'`, which meant that playing
 * only the drums and then pressing a key wrote to a static cursor while the
 * beat ran. The rule should fit in one sentence — if music is playing,
 * record in time; if not, record at the cursor — and the metronome counts,
 * because it runs on the same clock and is exactly what a player counts
 * against when nothing else is going.
 */
export function leadClockActive(state: {
  metronomeActive: boolean;
  sequencerPlayer: PlayerState;
  chordsPlayer: PlayerState;
  leadPlayer: PlayerState;
}): boolean {
  return (
    state.metronomeActive ||
    isPlayerActive(state.sequencerPlayer) ||
    isPlayerActive(state.chordsPlayer) ||
    isPlayerActive(state.leadPlayer)
  );
}

/** The real live clock. Injectable so the bridge is testable without one. */
export interface LeadRecordDeps {
  inputStep: () => number | null;
  startClock: () => () => void;
}

const REAL_CLOCK: LeadRecordDeps = {
  inputStep: leadLiveInputStep,
  startClock: startLeadLiveClock,
};

interface HeldNote {
  /** The RAW clock step of the press — never wrapped, so a note held across
   *  the loop seam still yields a positive length. */
  onStep: number;
  /** Where the note went in, so note-off knows what to extend. */
  storedIndex: number;
  /** The stride the note was captured at, so a resolution change mid-hold cannot re-scale its length. */
  stride: number;
}

/**
 * The bridge from performed notes to the melody grid.
 *
 * ONE subscriber, not a call bolted onto each input source. The bus already
 * settled which events count as somebody playing (see noteInputBus), so this
 * module only has to answer what to do with them — and answering it once is
 * why the computer keyboard, the on-screen keyboard and MIDI all behave the
 * same without three copies of this rule.
 *
 * The cursor never moves, in either mode. Stopped, it IS the write head, so
 * notes played together land together and a key repeat writes nothing new.
 * Playing, the clock is the write head and the cursor is simply left where
 * the user put it — which is what makes "stop returns the marker to where
 * you put it" free, with no save-and-restore step to get wrong.
 */
export function startLeadRecordBridge(deps: LeadRecordDeps = REAL_CLOCK): () => void {
  const held = new Map<string, HeldNote>();
  let stopClock: (() => void) | null = null;

  // The collector is started and stopped with the music, not at boot:
  // subscribing the shared clock starts its timer, so a permanent
  // subscriber would keep it alive for the life of the app.
  const syncClock = (active: boolean): void => {
    if (active === (stopClock !== null)) return;
    if (active) {
      stopClock = deps.startClock();
      return;
    }
    stopClock?.();
    stopClock = null;
    // A note still down when the transport stops has no length to compute
    // against, and its release must not extend anything later.
    held.clear();
  };

  const unsubscribeTransport = useAppStore.subscribe(leadClockActive, syncClock, {
    fireImmediately: true,
  });

  const unsubscribeInput = subscribeNoteInput((event) => {
    if (event.kind === 'off') {
      const entry = held.get(event.note);
      if (!entry) return;
      held.delete(event.note);
      const offStep = deps.inputStep();
      if (offStep === null) return;
      const len = heldStepLength(entry.onStep, offStep, entry.stride);
      // setLeadNoteLength owns all three length invariants, including the
      // clamp against the loop end — so a note held across the seam is
      // truncated rather than wrapped, with no special case here.
      //
      // leadRecording is re-checked here, not assumed from note-on: a press
      // that started while armed can still be held after Rec is turned off,
      // and its release must not reach back and lengthen a note that was
      // never meant to grow past its initial write.
      //
      // > stride, not > 1: a one-cell note is already at that length, and
      // calling the setter for it would be a write with nothing to write.
      if (len > entry.stride && useAppStore.getState().leadRecording) {
        useAppStore.getState().setLeadNoteLength(entry.storedIndex, event.note, len);
      }
      return;
    }

    const state = useAppStore.getState();
    const clockStep = deps.inputStep();
    if (clockStep === null) {
      // No running clock: the cursor is the write head, and there is no step
      // count to give the note a length with, so it stays one step long.
      state.recordLeadNote(event.note);
      return;
    }
    // A key repeat must not re-date a press that is still down.
    if (held.has(event.note)) return;

    const stepsPerBar = getMeter(state.meterId).stepsPerBar;
    const stride = strideFor(state.leadStepResolution);
    const columns = state.leadLoopLength * columnsPerBar(stepsPerBar, stride);
    const rawColumn = clockStepToGridColumn(clockStep, columns, stride);
    // Clamped HERE, once, and the same value reused below: recordLeadNote
    // clamps again internally (defence in depth for its other caller, the
    // stopped-cursor path), but that must not be the only place it happens —
    // two independent clamps of the same raw column agree today only because
    // the wrap already puts rawColumn in range, which is luck, not a
    // guarantee.
    const column = clampLeadCursor(rawColumn, state.leadLoopLength, stepsPerBar, stride);
    // The note goes in at len 1 immediately, so it appears on the grid the
    // moment it is played; note-off extends it.
    if (!state.recordLeadNote(event.note, column)) return;
    held.set(event.note, {
      onStep: clockStep,
      storedIndex: leadStoredIndexAt(column, stepsPerBar, stride),
      stride,
    });
  });

  return () => {
    unsubscribeInput();
    unsubscribeTransport();
    syncClock(false);
  };
}
