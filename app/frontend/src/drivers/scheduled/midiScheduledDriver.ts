import type { NoteEvent, NoteStopEvent } from '@/engine';
import { midiNumberToNoteName, velocityToGain, type MidiMessage } from '@/shared/midi';

const SUSTAIN_CC = 64;

/**
 * Scheduled (arrange) driver seam — pure translation of a canonical MidiMessage
 * into an engine command. Mirror of `drivers/live/midiNoteDriver.ts` but also
 * covers sustain-pedal CC64, which arrange's recording/monitoring path needs.
 * No audio side effects, no feature imports. Timing (@t) is applied by the caller.
 */
export type ScheduledNoteCommand =
  | { kind: 'noteOn'; event: NoteEvent }
  | { kind: 'noteOff'; event: NoteStopEvent }
  | { kind: 'sustain'; active: boolean };

export const midiMessageToScheduledNote = (
  message: MidiMessage,
): ScheduledNoteCommand | null => {
  if (
    message.type === 'controlchange' &&
    message.control === SUSTAIN_CC &&
    message.value !== undefined
  ) {
    return { kind: 'sustain', active: message.value >= 64 };
  }

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
