import { subscribeNoteInput } from '../audio/playback/noteInputBus';
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
 * There is no held-key state here, and no cursor walking. The cursor stays
 * where the user put it, so notes played together land together and a key
 * repeat writes nothing new: recordLeadNote draws, and drawing over a note
 * that is already there is a no-op by construction.
 */
export function startLeadRecordBridge(): () => void {
  return subscribeNoteInput((event) => {
    if (event.kind !== 'on') return;
    useAppStore.getState().recordLeadNote(event.note);
  });
}
