import { subscribeNoteInput } from '../audio/playback/noteInputBus';
import { stepRecordOff, stepRecordOn } from '../audio/leadStepRecord';
import { useAppStore } from './store';

/**
 * The bridge from performed notes to the melody grid.
 *
 * ONE subscriber, not a call bolted onto each input source. The bus already
 * settled which events count as somebody playing (see noteInputBus), so this
 * module only has to answer what to do with them — and answering it once is
 * why the computer keyboard, the on-screen keyboard and MIDI all behave the
 * same without three copies of this rule.
 *
 * Held keys live here rather than in the store: they change on every key
 * press, and persist re-serialises the lead slice on every set() that touches
 * it, so a set() per keystroke would re-render all four mounted tabs to track
 * something no view renders.
 */
let held: ReadonlySet<string> = new Set();
/**
 * Whether anything was actually written during the current hold. A press the
 * grid declined — out of scale, or an unreachable octave — must not advance
 * the cursor, or a wrong note would silently eat a column.
 */
let wrote = false;

export function startLeadRecordBridge(): () => void {
  return subscribeNoteInput((event) => {
    const state = useAppStore.getState();
    if (!state.leadRecording) {
      // Disarming mid-hold drops the keys with it, so the release that
      // follows cannot advance a cursor the user is no longer recording at.
      held = new Set();
      wrote = false;
      return;
    }

    if (event.kind === 'on') {
      const result = stepRecordOn(held, event.note);
      held = result.held;
      if (result.write && state.recordLeadNote(event.note)) wrote = true;
      return;
    }

    const result = stepRecordOff(held, event.note);
    held = result.held;
    if (!result.advance) return;
    if (wrote) state.advanceLeadCursor();
    wrote = false;
  });
}

/** Test-only: forget any keys a previous test left down. */
export function resetLeadRecordBridge(): void {
  held = new Set();
  wrote = false;
}
