import { describe, test, expect } from 'bun:test';
import { beatStepEvents } from './beatSteps';
import { BEAT_VOICE_IDS } from '@/data/beatPresets';
import { MAX_STEPS_PER_BAR } from '@/utils/meter';
import type { BeatMix, BeatPattern, BeatVoiceId } from '@/types';

const silentRow = () => new Array<boolean>(MAX_STEPS_PER_BAR).fill(false);

/** A complete pattern — every canonical voice present — with the named voices
 *  hit on the given steps. Complete because the sanitizer guarantees it: a row
 *  per voice, `MAX_STEPS_PER_BAR` wide, whatever the active meter is. */
const patternOf = (hits: Partial<Record<BeatVoiceId, number[]>>): BeatPattern => {
  const rows = {} as BeatPattern['rows'];
  for (const voice of BEAT_VOICE_IDS) {
    const row = silentRow();
    for (const step of hits[voice] ?? []) row[step] = true;
    rows[voice] = row;
  }
  return { rows };
};

const mixOf = (muted: readonly BeatVoiceId[] = []): BeatMix => {
  const voices = {} as BeatMix['voices'];
  for (const voice of BEAT_VOICE_IDS) {
    voices[voice] = { levelDb: 0, muted: muted.includes(voice) };
  }
  return { levelDb: 0, muted: false, voices };
};

describe('beatStepEvents', () => {
  test('an empty pattern contributes nothing', () => {
    expect(beatStepEvents(patternOf({}), mixOf(), 0)).toEqual([]);
  });

  test('an active cell emits its voice, and muting that voice silences it', () => {
    const pattern = patternOf({ kick: [0] });
    const mix = mixOf();
    expect(beatStepEvents(pattern, mix, 0)).toEqual([{ voice: 'kick' }]);
    mix.voices.kick.muted = true;
    expect(beatStepEvents(pattern, mix, 0)).toEqual([]);
  });

  test('an inactive cell contributes nothing', () => {
    expect(beatStepEvents(patternOf({ kick: [0] }), mixOf(), 1)).toEqual([]);
  });

  test('a muted voice does not silence the voices beside it', () => {
    const events = beatStepEvents(patternOf({ kick: [0], snare: [0] }), mixOf(['kick']), 0);
    expect(events).toEqual([{ voice: 'snare' }]);
  });

  test('voices are emitted in BEAT_VOICE_IDS order, whatever order the rows were written in', () => {
    // `crash` is declared after `hihat` in the roster; the pattern names it
    // first. The emission order is the roster's, so a reader (and the engine)
    // sees one stable order however a caller built the rows.
    const pattern = patternOf({ crash: [4], hihat: [4] });
    expect(beatStepEvents(pattern, mixOf(), 4)).toEqual([{ voice: 'hihat' }, { voice: 'crash' }]);
  });

  test('every canonical voice can sound — the roster is the whole emission surface', () => {
    const hits = Object.fromEntries(BEAT_VOICE_IDS.map((voice) => [voice, [2]]));
    expect(beatStepEvents(patternOf(hits), mixOf(), 2)).toEqual(
      BEAT_VOICE_IDS.map((voice) => ({ voice })),
    );
  });

  test('only drum voices can be emitted — an event carries a voice and nothing else', () => {
    // The shape IS the guarantee: the old SequencerStepEvent was a union whose
    // other arm played a synth note on the Lead bus off a sequencer track. A
    // Beat event names a drum voice, so there is no arm left to route wrong.
    const [event] = beatStepEvents(patternOf({ rimshot: [7] }), mixOf(), 7);
    expect(Object.keys(event)).toEqual(['voice']);
    expect(BEAT_VOICE_IDS).toContain(event.voice);
  });

  test('a step past the stored row is silent rather than a throw', () => {
    expect(beatStepEvents(patternOf({ kick: [0] }), mixOf(), MAX_STEPS_PER_BAR)).toEqual([]);
  });

  test('the bus mute is NOT this function\'s layer', () => {
    // Two independent layers: the per-voice mute here, and the Beat BUS mute
    // (solo included) applied in engineSync off the source-bus table. Folding
    // the bus into this decision would make one of them unreachable — and
    // would mean the export, which must honour mute but never solo, could no
    // longer tell them apart.
    const mix = { ...mixOf(), muted: true };
    expect(beatStepEvents(patternOf({ kick: [0] }), mix, 0)).toEqual([{ voice: 'kick' }]);
  });
});
