import { describe, expect, test } from 'bun:test';
import {
  GM_DRUM_NOTE,
  MIDI_LANES,
  MIDI_PPQ,
  MIDI_TIME_SIGNATURE,
  eventAudible,
  midiVelocity,
  resolveNoteOverlaps,
  secondsToTicks,
  type MidiNote,
} from './renderMidi';
import { mixdownLoop, mixdownSnapshot } from './mixdownFixture';
import { BEAT_VOICE_IDS } from '@/data/beatPresets';
import { METER_IDS } from '@/utils/timeSignature';
import { stepDurationSec } from '@/utils/tempo';
import type { BeatVoiceId } from '@/types';
import type { TimelineEvent } from '../playback/plan/songTimeline';
import type { MixdownBusState } from '../playback/plan/songSnapshot';

/**
 * The fixture's own six source buses (`mixdownFixture.ts` cannot export its
 * private `BUSES` — the eslint block covering `src/audio/**` allows no
 * runtime value export beyond the fixture's own builders), unmuted at gain 1
 * unless overridden.
 */
const BUS_SOURCES = ['synth', 'chord', 'bass', 'pad', 'fx', 'sequencer'] as const;
function busRows(
  muted: Partial<Record<(typeof BUS_SOURCES)[number], boolean>> = {},
  gains: Partial<Record<(typeof BUS_SOURCES)[number], number>> = {},
): MixdownBusState[] {
  const rows = mixdownSnapshot().buses;
  return BUS_SOURCES.map((source) => {
    const row = rows.find((bus) => bus.source === source) as MixdownBusState;
    return { ...row, gain: gains[source] ?? 1, muted: muted[source] ?? false };
  });
}

function leadNote(loopIndex: number): TimelineEvent {
  return { kind: 'note', track: 'lead', loopIndex, noteName: 'C4', velocity: 0.8, startSec: 0, endSec: 0.1 };
}

function drumHit(loopIndex: number, voice: BeatVoiceId): TimelineEvent {
  return { kind: 'drum', loopIndex, voice, velocity: 0.8, timeSec: 0 };
}

describe('MIDI_LANES', () => {
  test('covers every SongTrack and beat once, in SongTrack order then Beat', () => {
    expect(MIDI_LANES.map((l) => l.lane)).toEqual(['chord', 'bass', 'pad', 'lead', 'fx', 'beat']);
    expect(MIDI_LANES.map((l) => l.name)).toEqual(['Chord', 'Bass', 'Pad', 'Lead', 'FX', 'Beat']);
    expect(MIDI_LANES.map((l) => l.channel)).toEqual([0, 1, 2, 3, 4, 9]);
  });
});

describe('GM_DRUM_NOTE', () => {
  test('is the spec map', () => {
    expect(GM_DRUM_NOTE).toEqual({
      kick: 36, snare: 38, rimshot: 37, clap: 39, hihat: 42, openhat: 46,
      hitom: 48, lowtom: 45, ride: 51, crash: 49, bell: 56,
    });
    expect(Object.keys(GM_DRUM_NOTE).sort()).toEqual([...BEAT_VOICE_IDS].sort());
  });
});

describe('MIDI_TIME_SIGNATURE', () => {
  test('has a row for every meter', () => {
    expect(Object.keys(MIDI_TIME_SIGNATURE).sort()).toEqual([...METER_IDS].sort());
    expect(MIDI_TIME_SIGNATURE['7/8'].clocksPerClick).toBe(12);
    expect(MIDI_TIME_SIGNATURE['6/8'].clocksPerClick).toBe(36);
    expect(MIDI_TIME_SIGNATURE['12/8'].clocksPerClick).toBe(36);
    expect(MIDI_TIME_SIGNATURE['4/4'].clocksPerClick).toBe(24);
    expect(MIDI_TIME_SIGNATURE['3/4'].clocksPerClick).toBe(24);
    expect(MIDI_TIME_SIGNATURE['5/4'].clocksPerClick).toBe(24);
  });
});

describe('secondsToTicks', () => {
  test('a 16th is 120 ticks, a 1/32 is 60', () => {
    expect(MIDI_PPQ).toBe(480);
    expect(secondsToTicks(0.125, 120)).toBe(120);
    expect(secondsToTicks(0.0625, 120)).toBe(60);
    expect(secondsToTicks(stepDurationSec(97) * 37, 97)).toBe(37 * 120);
  });
});

describe('midiVelocity', () => {
  test('is linear and clamped', () => {
    expect(midiVelocity(0.8)).toBe(102);
    expect(midiVelocity(0.9)).toBe(114);
    expect(midiVelocity(1)).toBe(127);
    expect(midiVelocity(1.2)).toBe(127);
    expect(midiVelocity(0.001)).toBe(1);
    expect(midiVelocity(0)).toBeNull();
    expect(midiVelocity(-0.5)).toBeNull();
  });
});

describe('eventAudible', () => {
  test('follows the event loop bus row', () => {
    const mutedLoop = mixdownLoop({ id: 'loop-muted', buses: busRows({ synth: true }) });
    const zeroGainLoop = mixdownLoop({ id: 'loop-zero-gain', buses: busRows({}, { synth: 0 }) });
    const cleanLoop = mixdownLoop({ id: 'loop-clean' });
    const secondLoop = mixdownLoop({ id: 'loop-second' });
    const snapshot = mixdownSnapshot({
      // The song-level bus row is muted here on purpose — it must never be
      // consulted (§7, F9); every assertion below is decided by the loop's
      // own row.
      buses: busRows({ synth: true }),
      loops: [mutedLoop, zeroGainLoop, cleanLoop, secondLoop],
    });
    expect(eventAudible(snapshot, leadNote(0))).toBe(false);
    expect(eventAudible(snapshot, leadNote(1))).toBe(false);
    expect(eventAudible(snapshot, leadNote(2))).toBe(true);
    expect(eventAudible(snapshot, leadNote(3))).toBe(true);
  });

  test('drops a drum on a muted sequencer bus or a zero voice gain only', () => {
    const mutedSeqLoop = mixdownLoop({ id: 'loop-seq-muted', buses: busRows({ sequencer: true }) });
    const zeroKickLoop = mixdownLoop({
      id: 'loop-kick-zero',
      beatVoiceGains: BEAT_VOICE_IDS.map((voice) => ({ voice, gain: voice === 'kick' ? 0 : 1 })),
    });
    const snapshot = mixdownSnapshot({ loops: [mutedSeqLoop, zeroKickLoop] });
    expect(eventAudible(snapshot, drumHit(0, 'kick'))).toBe(false);
    expect(eventAudible(snapshot, drumHit(1, 'kick'))).toBe(false);
    expect(eventAudible(snapshot, drumHit(1, 'snare'))).toBe(true);
  });
});

describe('resolveNoteOverlaps', () => {
  test('merges a same-tick duplicate', () => {
    const notes: MidiNote[] = [
      { lane: 'lead', channel: 0, note: 60, velocity: 80, startTick: 0, endTick: 240 },
      { lane: 'lead', channel: 0, note: 60, velocity: 100, startTick: 0, endTick: 480 },
    ];
    expect(resolveNoteOverlaps(notes)).toEqual([
      { lane: 'lead', channel: 0, note: 60, velocity: 100, startTick: 0, endTick: 480 },
    ]);
  });

  test('cuts the earlier note at a later start', () => {
    const notes: MidiNote[] = [
      { lane: 'lead', channel: 0, note: 60, velocity: 80, startTick: 0, endTick: 480 },
      { lane: 'lead', channel: 0, note: 60, velocity: 90, startTick: 240, endTick: 720 },
    ];
    expect(resolveNoteOverlaps(notes)).toEqual([
      { lane: 'lead', channel: 0, note: 60, velocity: 80, startTick: 0, endTick: 240 },
      { lane: 'lead', channel: 0, note: 60, velocity: 90, startTick: 240, endTick: 720 },
    ]);
  });

  test('leaves other pitches and channels alone', () => {
    const notes: MidiNote[] = [
      { lane: 'lead', channel: 0, note: 60, velocity: 80, startTick: 0, endTick: 480 },
      { lane: 'lead', channel: 0, note: 64, velocity: 80, startTick: 0, endTick: 480 },
      { lane: 'lead', channel: 1, note: 60, velocity: 80, startTick: 0, endTick: 480 },
    ];
    const original = notes.map((n) => ({ ...n }));
    const result = resolveNoteOverlaps(notes);
    expect(result).toEqual([
      { lane: 'lead', channel: 0, note: 60, velocity: 80, startTick: 0, endTick: 480 },
      { lane: 'lead', channel: 0, note: 64, velocity: 80, startTick: 0, endTick: 480 },
      { lane: 'lead', channel: 1, note: 60, velocity: 80, startTick: 0, endTick: 480 },
    ]);
    expect(notes).toEqual(original);
  });
});
