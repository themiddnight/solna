import { describe, test, expect } from 'bun:test';
import { planBeatStep, type BeatPlanSnapshot } from './beatPlan';
import { BEAT_VOICE_IDS } from '@/data/beatPresets';
import { MAX_STEPS_PER_BAR } from '@/utils/meter';
import { DEFAULT_VELOCITY } from '@/audio/constants';
import { beatMixFixture, beatPatternFixture } from '@/audio/export/mixdownFixture';
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

describe('planBeatStep', () => {
  test('an empty pattern contributes nothing', () => {
    expect(planBeatStep({ pattern: patternOf({}), mix: mixOf() }, { stepInBar: 0 })).toEqual([]);
  });

  test('an active cell emits its voice, and muting that voice silences it', () => {
    const pattern = patternOf({ kick: [0] });
    const mix = mixOf();
    expect(planBeatStep({ pattern, mix }, { stepInBar: 0 })).toEqual([
      { voice: 'kick', velocity: DEFAULT_VELOCITY },
    ]);
    mix.voices.kick.muted = true;
    expect(planBeatStep({ pattern, mix }, { stepInBar: 0 })).toEqual([]);
  });

  test('an inactive cell contributes nothing', () => {
    expect(
      planBeatStep({ pattern: patternOf({ kick: [0] }), mix: mixOf() }, { stepInBar: 1 }),
    ).toEqual([]);
  });

  test('a muted voice does not silence the voices beside it', () => {
    const events = planBeatStep(
      { pattern: patternOf({ kick: [0], snare: [0] }), mix: mixOf(['kick']) },
      { stepInBar: 0 },
    );
    expect(events).toEqual([{ voice: 'snare', velocity: DEFAULT_VELOCITY }]);
  });

  test('voices are emitted in BEAT_VOICE_IDS order, whatever order the rows were written in', () => {
    // `crash` is declared after `hihat` in the roster; the pattern names it
    // first. The emission order is the roster's, so a reader (and the engine)
    // sees one stable order however a caller built the rows.
    const pattern = patternOf({ crash: [4], hihat: [4] });
    expect(planBeatStep({ pattern, mix: mixOf() }, { stepInBar: 4 })).toEqual([
      { voice: 'hihat', velocity: DEFAULT_VELOCITY },
      { voice: 'crash', velocity: DEFAULT_VELOCITY },
    ]);
  });

  test('every canonical voice can sound — the roster is the whole emission surface', () => {
    const hits = Object.fromEntries(BEAT_VOICE_IDS.map((voice) => [voice, [2]]));
    expect(planBeatStep({ pattern: patternOf(hits), mix: mixOf() }, { stepInBar: 2 })).toEqual(
      BEAT_VOICE_IDS.map((voice) => ({ voice, velocity: DEFAULT_VELOCITY })),
    );
  });

  test('only drum voices can be emitted — an event carries a voice and nothing else', () => {
    // The shape IS the guarantee: the old SequencerStepEvent was a union whose
    // other arm played a synth note on the Lead bus off a sequencer track. A
    // Beat event names a drum voice (and the velocity the planner decides), so
    // there is no arm left to route wrong.
    const [event] = planBeatStep(
      { pattern: patternOf({ rimshot: [7] }), mix: mixOf() },
      { stepInBar: 7 },
    );
    expect(Object.keys(event)).toEqual(['voice', 'velocity']);
    expect(BEAT_VOICE_IDS).toContain(event.voice);
  });

  test('a step past the stored row is silent rather than a throw', () => {
    expect(
      planBeatStep(
        { pattern: patternOf({ kick: [0] }), mix: mixOf() },
        { stepInBar: MAX_STEPS_PER_BAR },
      ),
    ).toEqual([]);
  });

  test("the bus mute is NOT this function's layer", () => {
    // Two independent layers: the per-voice mute here, and the Beat BUS mute
    // (solo included) applied in engineSync off the source-bus table. Folding
    // the bus into this decision would make one of them unreachable — and
    // would mean the export, which must honour mute but never solo, could no
    // longer tell them apart.
    const mix = { ...mixOf(), muted: true };
    expect(
      planBeatStep({ pattern: patternOf({ kick: [0] }), mix }, { stepInBar: 0 }),
    ).toEqual([{ voice: 'kick', velocity: DEFAULT_VELOCITY }]);
  });

  // Renamed from the pre-planner "reuses its scratch array" pin: planBeatStep
  // keeps no module-level scratch (see 'two calls return distinct arrays'
  // below for the identity half of that guarantee), so what is left to pin
  // here is only that two calls against the same pattern still each reflect
  // their own step, not a leftover from the other one.
  test("planBeatStep reflects only that call's step across repeated calls", () => {
    const pattern = patternOf({ kick: [0], snare: [4] });
    const mix = mixOf();

    const eventsAtStep0 = planBeatStep({ pattern, mix }, { stepInBar: 0 });
    const copyOfStep0 = [...eventsAtStep0];
    const eventsAtStep4 = planBeatStep({ pattern, mix }, { stepInBar: 4 });

    expect(copyOfStep0.map((e) => e.voice)).toEqual(['kick']);
    expect(eventsAtStep4.map((e) => e.voice)).toEqual(['snare']);
  });
});

function snapshotWith(hits: BeatVoiceId[], step: number, muted: BeatVoiceId[] = []): BeatPlanSnapshot {
  const pattern = structuredClone(beatPatternFixture());
  for (const voice of BEAT_VOICE_IDS) pattern.rows[voice] = pattern.rows[voice].map(() => false);
  for (const voice of hits) pattern.rows[voice][step] = true;
  const mix = structuredClone(beatMixFixture());
  for (const voice of muted) mix.voices[voice] = { ...mix.voices[voice], muted: true };
  return { pattern, mix };
}

describe('planBeatStep: selection', () => {
  test('voices come back in BEAT_VOICE_IDS order', () => {
    const reversed = [...BEAT_VOICE_IDS].reverse();
    const events = planBeatStep(snapshotWith(reversed, 3), { stepInBar: 3 });
    expect(events.map((e) => e.voice)).toEqual([...BEAT_VOICE_IDS]);
  });

  test('a muted voice is skipped; solo is not a planner input', () => {
    const events = planBeatStep(snapshotWith(['kick', 'snare'], 0, ['snare']), { stepInBar: 0 });
    expect(events.map((e) => e.voice)).toEqual(['kick']);
    // BeatPlanSnapshot has exactly the two fields: no solo can reach the planner.
    expect(Object.keys(snapshotWith([], 0)).sort()).toEqual(['mix', 'pattern']);
  });

  test('a step past the stored row is silent, not an error', () => {
    const snap = snapshotWith(['kick'], 0);
    expect(planBeatStep(snap, { stepInBar: snap.pattern.rows.kick.length + 5 })).toEqual([]);
  });

  test('a missing row or mix entry is silent, not a throw', () => {
    const snap = snapshotWith(['kick', 'snare'], 0);
    delete (snap.pattern.rows as Partial<Record<BeatVoiceId, boolean[]>>).kick;
    delete (snap.mix.voices as Partial<Record<BeatVoiceId, unknown>>).snare;
    expect(planBeatStep(snap, { stepInBar: 0 }).map((e) => e.voice)).toEqual(['snare']);
  });
});

describe('planBeatStep: output', () => {
  test('every event carries DEFAULT_VELOCITY', () => {
    const events = planBeatStep(snapshotWith([...BEAT_VOICE_IDS], 1), { stepInBar: 1 });
    expect(events.length).toBe(BEAT_VOICE_IDS.length);
    for (const e of events) expect(e.velocity).toBe(DEFAULT_VELOCITY);
  });

  test('two calls return distinct arrays', () => {
    const snap = snapshotWith(['kick'], 0);
    const a = planBeatStep(snap, { stepInBar: 0 });
    const b = planBeatStep(snap, { stepInBar: 0 });
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
