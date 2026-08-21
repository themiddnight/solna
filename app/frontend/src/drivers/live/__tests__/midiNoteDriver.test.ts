import { describe, expect, it } from 'vitest';
import { midiMessageToLiveNote } from '../midiNoteDriver';
import type { MidiMessage } from '@/shared/midi';

const base = { channel: 0, timestamp: 0 };

describe('midiMessageToLiveNote', () => {
  it('maps note on to a NoteEvent with note name + gain velocity', () => {
    const msg: MidiMessage = { ...base, type: 'noteon', note: 60, velocity: 127 };
    expect(midiMessageToLiveNote(msg)).toEqual({
      kind: 'noteOn', event: { note: 'C4', velocity: 1 },
    });
  });

  it('maps note on velocity 0 to note off', () => {
    const msg: MidiMessage = { ...base, type: 'noteon', note: 60, velocity: 0 };
    expect(midiMessageToLiveNote(msg)).toEqual({ kind: 'noteOff', event: { note: 'C4' } });
  });

  it('maps note off to note off', () => {
    const msg: MidiMessage = { ...base, type: 'noteoff', note: 62, velocity: 0 };
    expect(midiMessageToLiveNote(msg)).toEqual({ kind: 'noteOff', event: { note: 'D4' } });
  });

  it('returns null for control change / pitch bend / unknown', () => {
    expect(midiMessageToLiveNote({ ...base, type: 'controlchange', control: 64, value: 127 })).toBeNull();
    expect(midiMessageToLiveNote({ ...base, type: 'pitchbend', pitchBend: 100 })).toBeNull();
    expect(midiMessageToLiveNote({ ...base, type: 'unknown' })).toBeNull();
  });
});
