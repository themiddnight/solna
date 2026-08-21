import type { NoteEvent, NoteStopEvent } from '@/engine';
import { midiNumberToNoteName, velocityToGain, type MidiMessage } from '@/shared/midi';

/**
 * Live driver seam (DEV-238): translate a canonical MidiMessage into an engine
 * note command to play @now. Pure — no audio side effects, no feature imports.
 */
export type LiveNoteCommand =
  | { kind: 'noteOn'; event: NoteEvent }
  | { kind: 'noteOff'; event: NoteStopEvent };

export const midiMessageToLiveNote = (message: MidiMessage): LiveNoteCommand | null => {
  if (message.note === undefined) return null;
  const note = midiNumberToNoteName(message.note);

  if (message.type === 'noteon' && (message.velocity ?? 0) > 0) {
    return { kind: 'noteOn', event: { note, velocity: velocityToGain(message.velocity ?? 0) } };
  }
  if (message.type === 'noteoff' || (message.type === 'noteon' && message.velocity === 0)) {
    return { kind: 'noteOff', event: { note } };
  }
  return null;
};
