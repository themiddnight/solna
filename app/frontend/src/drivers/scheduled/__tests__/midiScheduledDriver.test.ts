import { describe, expect, it } from 'vitest';
import { midiMessageToScheduledNote } from '../midiScheduledDriver';
import type { MidiMessage } from '@/shared/midi';

const base = { channel: 0, timestamp: 0 };

describe('midiMessageToScheduledNote', () => {
  it('maps note on to a NoteEvent with note name + gain velocity', () => {
    const msg: MidiMessage = { ...base, type: 'noteon', note: 60, velocity: 127 };
    expect(midiMessageToScheduledNote(msg)).toEqual({ kind: 'noteOn', event: { note: 'C4', velocity: 1 } });
  });

  it('maps note on velocity 0 to note off', () => {
    expect(midiMessageToScheduledNote({ ...base, type: 'noteon', note: 60, velocity: 0 }))
      .toEqual({ kind: 'noteOff', event: { note: 'C4' } });
  });

  it('maps note off to note off', () => {
    expect(midiMessageToScheduledNote({ ...base, type: 'noteoff', note: 62, velocity: 0 }))
      .toEqual({ kind: 'noteOff', event: { note: 'D4' } });
  });

  it('maps sustain CC64 >= 64 to sustain on', () => {
    expect(midiMessageToScheduledNote({ ...base, type: 'controlchange', control: 64, value: 127 }))
      .toEqual({ kind: 'sustain', active: true });
  });

  it('maps sustain CC64 < 64 to sustain off', () => {
    expect(midiMessageToScheduledNote({ ...base, type: 'controlchange', control: 64, value: 0 }))
      .toEqual({ kind: 'sustain', active: false });
  });

  it('returns null for non-sustain CC / pitch bend / unknown', () => {
    expect(midiMessageToScheduledNote({ ...base, type: 'controlchange', control: 1, value: 127 })).toBeNull();
    expect(midiMessageToScheduledNote({ ...base, type: 'pitchbend', pitchBend: 100 })).toBeNull();
    expect(midiMessageToScheduledNote({ ...base, type: 'unknown' })).toBeNull();
  });
});
