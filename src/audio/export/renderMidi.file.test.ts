import { describe, expect, test } from 'bun:test';
import { MIDI_LANES, MIDI_PPQ, songMidiFile, type MidiLane, type MidiNote } from './renderMidi';
import { encodeSmf } from './smfWriter';
import { readSmf, type ReadSmf } from './smfTestReader';
import { mixdownSnapshot } from './mixdownFixture';
import { METER_IDS, getMeter } from '@/utils/meter';
import type { MixdownSnapshot } from '../playback/plan/songSnapshot';

function midi(snapshot: MixdownSnapshot, notes: MidiNote[], title: string): ReadSmf {
  return readSmf(encodeSmf(songMidiFile(snapshot, notes, title)));
}

function laneChannel(lane: MidiLane): number {
  return MIDI_LANES.find((entry) => entry.lane === lane)!.channel;
}

function laneNote(lane: MidiLane, startTick: number, endTick: number): MidiNote {
  return { lane, channel: laneChannel(lane), note: 60, velocity: 100, startTick, endTick };
}

/** `FF 58` data (§5.2) for every meter, keyed by `MeterId`. */
const TIME_SIGNATURE_DATA: Record<string, number[]> = {
  '4/4': [4, 2, 24, 8],
  '3/4': [3, 2, 24, 8],
  '6/8': [6, 3, 36, 8],
  '12/8': [12, 3, 36, 8],
  '5/4': [5, 2, 24, 8],
  '7/8': [7, 3, 12, 8],
};

describe('songMidiFile', () => {
  test('seven tracks named title then the six lanes', () => {
    const file = midi(mixdownSnapshot(), [], 'My Song');
    expect(file.format).toBe(1);
    expect(file.ppq).toBe(MIDI_PPQ);
    expect(file.tracks.map((t) => t.name)).toEqual([
      'My Song',
      'Chord',
      'Bass',
      'Pad',
      'Lead',
      'FX',
      'Beat',
    ]);
  });

  test('a UTF-8 title round-trips', () => {
    const file = midi(mixdownSnapshot(), [], 'เพลง');
    expect(file.tracks[0].name).toBe('เพลง');
  });

  test('tempo is round(6e7 / bpm) µs per quarter', () => {
    const at120 = midi(mixdownSnapshot({ bpm: 120 }), [], 'T');
    const tempo120 = at120.tracks[0].metas.find((m) => m.type === 0x51);
    expect(Array.from(tempo120!.data)).toEqual([0x07, 0xa1, 0x20]);

    const at90 = midi(mixdownSnapshot({ bpm: 90 }), [], 'T');
    const tempo90 = at90.tracks[0].metas.find((m) => m.type === 0x51);
    expect(Array.from(tempo90!.data)).toEqual([0x0a, 0x2c, 0x2b]);
  });

  test('one time signature per meter', () => {
    for (const meterId of METER_IDS) {
      const snapshot = mixdownSnapshot({ meterId, stepsPerBar: getMeter(meterId).stepsPerBar });
      const file = midi(snapshot, [], 'T');
      const timeSig = file.tracks[0].metas.find((m) => m.type === 0x58);
      expect(Array.from(timeSig!.data)).toEqual(TIME_SIGNATURE_DATA[meterId]);
    }
  });

  test('a lane note lands on its lane track and channel', () => {
    const notes = MIDI_LANES.map((entry) => laneNote(entry.lane, 0, 120));
    const file = midi(mixdownSnapshot(), notes, 'T');

    const beatTrack = file.tracks[MIDI_LANES.findIndex((l) => l.lane === 'beat') + 1];
    expect(beatTrack.notes).toHaveLength(1);
    expect(beatTrack.notes[0].channel).toBe(9);

    MIDI_LANES.forEach((entry, index) => {
      const track = file.tracks[index + 1];
      expect(track.notes).toHaveLength(1);
      expect(track.notes[0].channel).toBe(entry.channel);
    });
  });

  test('every track ends at the song end or the last note-off', () => {
    const snapshot = mixdownSnapshot();
    const withoutNotes = midi(snapshot, [], 'T');
    for (const track of withoutNotes.tracks) expect(track.endTick).toBe(1920);

    const notes = [laneNote('bass', 0, 2000)];
    const withBass = midi(snapshot, notes, 'T');
    for (const track of withBass.tracks) {
      const expected = track.name === 'Bass' ? 2000 : 1920;
      expect(track.endTick).toBe(expected);
    }
  });
});
