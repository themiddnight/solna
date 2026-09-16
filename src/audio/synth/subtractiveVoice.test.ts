import { describe, expect, test } from 'bun:test';
import type { EnginePatch, ModRoute, SubtractiveParams } from '@/types/synth';
import { SUBTRACTIVE_INIT } from '@/utils/synthPresets';
import { noteFrequency } from '@/utils/musicTheory';
import { dbToGain } from '@/utils/synthPatch';
import {
  asAudioContext,
  fakeVoiceContext,
  type FakeVoiceContext,
  type FakeVoiceNode,
  type LoggedParam,
} from '../engineTestHelpers';
import { driveCurve } from './driveCurve';
import { createSubtractiveVoice, type SubtractiveVoiceEvent } from './subtractiveVoice';

/**
 * The voice declares DOM node types, so every assertion that reads a fake's
 * log goes through one of these casts rather than sprinkling `as unknown as`
 * through the test bodies. Nothing else in this file casts.
 */
const wiring = (node: unknown): FakeVoiceNode => node as unknown as FakeVoiceNode;
const logged = (param: unknown): LoggedParam => param as unknown as LoggedParam;

const INIT = SUBTRACTIVE_INIT.patch;

function patchWith(synth: Partial<SubtractiveParams>, common: Partial<EnginePatch<'subtractive'>['common']> = {}): EnginePatch<'subtractive'> {
  return {
    common: { ...INIT.common, ...common },
    synth: { ...INIT.synth, ...synth },
  };
}

/** Both oscillator slots and the sub enabled — the fixture the source-count assertions use. */
function threeSourcePatch(): EnginePatch<'subtractive'> {
  return patchWith({
    oscillators: [
      { ...INIT.synth.oscillators[0], enabled: true },
      { ...INIT.synth.oscillators[1], enabled: true, levelDb: -3 },
    ],
    utility: { ...INIT.synth.utility, subEnabled: true, subLevelDb: -6 },
  });
}

const C4 = noteFrequency('C4');

function noteEvent(over: Partial<SubtractiveVoiceEvent> = {}): SubtractiveVoiceEvent {
  return { source: 'synth', owner: 'live', frequency: C4, velocity: 1, at: 2, ...over };
}

function build(ctx: FakeVoiceContext, patch: EnginePatch<'subtractive'>, event = noteEvent()) {
  const output = ctx.createGain();
  const voice = createSubtractiveVoice(asAudioContext(ctx), patch, event, {
    output: output as unknown as AudioNode,
  });
  return { voice, output };
}

describe('createSubtractiveVoice graph construction', () => {
  test('creates one node per ENABLED source and the fixed filter/amp tail', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, threeSourcePatch());

    // OSC 1, OSC 2 and the sub: three oscillators for THIS fixture because
    // this fixture enables three, not because the graph has a fixed count.
    expect(ctx.oscillators).toHaveLength(3);
    expect(voice.nodes.oscillatorGains).toHaveLength(2);
    expect(voice.nodes.oscillatorGains[0]).not.toBeNull();
    expect(voice.nodes.oscillatorGains[1]).not.toBeNull();
    expect(voice.nodes.sub).not.toBeNull();
    expect(voice.nodes.noise).toBeNull();
    expect(ctx.filters).toHaveLength(1);
    expect(voice.nodes.filter.type).toBe('lowpass');
    expect(voice.owner).toBe('live');
    expect(voice.source).toBe('synth');
    expect(voice.frequency).toBeCloseTo(noteFrequency('C4'), 9);
    expect(voice.startedAt).toBe(2);
  });

  test('a disabled oscillator, sub and noise create no node at all', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, INIT);

    expect(ctx.oscillators).toHaveLength(1);
    expect(ctx.bufferSources).toHaveLength(0);
    expect(voice.nodes.oscillators[1]).toBeNull();
    expect(voice.nodes.oscillatorGains[1]).toBeNull();
    expect(voice.nodes.sub).toBeNull();
    expect(voice.nodes.subGain).toBeNull();
    expect(voice.nodes.noise).toBeNull();
    expect(voice.nodes.noiseGain).toBeNull();
  });

  test('every source runs through drive -> filter -> amp -> tremolo -> poly -> pan -> destination', () => {
    const ctx = fakeVoiceContext();
    const { voice, output } = build(ctx, threeSourcePatch());
    const n = voice.nodes;

    expect(wiring(n.oscillators[0]).connections).toEqual([n.oscillatorGains[0]]);
    expect(wiring(n.oscillators[1]).connections).toEqual([n.oscillatorGains[1]]);
    expect(wiring(n.sub).connections).toEqual([n.subGain]);
    for (const gain of [n.oscillatorGains[0], n.oscillatorGains[1], n.subGain]) {
      expect(wiring(gain).connections).toEqual([n.drive]);
    }
    expect(wiring(n.drive).connections).toEqual([n.filter]);
    expect(wiring(n.filter).connections).toEqual([n.ampGain]);
    expect(wiring(n.ampGain).connections).toEqual([n.tremoloGain]);
    // The polyphony gain sits between the tremolo gain and the panner, and is
    // its own node rather than a value folded into either neighbour: the amp
    // envelope cannot be re-planned mid-note, and `tremoloGain` carries ENV2's
    // and the LFO's amplitude contours, which a write would re-anchor.
    expect(wiring(n.tremoloGain).connections).toEqual([n.polyGain]);
    expect(wiring(n.polyGain).connections).toEqual([n.panner]);
    expect(wiring(n.panner).connections).toEqual([output]);
  });

  test('gives every voice its own id and starts every source at the note-on time', () => {
    const ctx = fakeVoiceContext();
    const first = build(ctx, threeSourcePatch()).voice;
    const second = build(ctx, threeSourcePatch(), noteEvent({ at: 4 })).voice;

    expect(first.id).not.toBe(second.id);
    for (const osc of ctx.oscillators.slice(0, 3)) {
      expect(osc.startArgs).toEqual([2]);
    }
    for (const osc of ctx.oscillators.slice(3)) {
      expect(osc.startArgs).toEqual([4]);
    }
  });

  test('static tuning lands on frequency so detune is free for modulation', () => {
    const ctx = fakeVoiceContext();
    const patch = patchWith({
      oscillators: [
        { ...INIT.synth.oscillators[0], enabled: true, octave: -1, semitone: 7, fineCents: 4 },
        { ...INIT.synth.oscillators[1], enabled: false },
      ],
      utility: { ...INIT.synth.utility, subEnabled: true, subOctave: -2 },
    });
    const { voice } = build(ctx, patch);

    // C4 = 261.6256 Hz, down an octave and up a fifth plus 4 cents.
    const expected = 261.6255653 * Math.pow(2, (-12 + 7 + 0.04) / 12);
    expect(logged(voice.nodes.oscillators[0]?.frequency).value).toBeCloseTo(expected, 4);
    expect(logged(voice.nodes.oscillators[0]?.detune).value).toBe(0);
    expect(logged(voice.nodes.sub?.frequency).value).toBeCloseTo(261.6255653 / 4, 4);
    expect(voice.nodes.sub?.type).toBe('sine');
  });
});

/**
 * The polyphony gain is its own node and its own gesture: the manager ducks a
 * bus as keys go down and lifts it as they come up, under voices that are
 * already sounding. Every test here is a call-log assertion; what the ramps
 * SOUND like is measured off rendered samples in subtractiveSignal.test.ts.
 */
describe('createSubtractiveVoice polyphony scaling', () => {
  test('the polyphony gain starts at unity and every teardown cuts it', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, threeSourcePatch());

    // Unity until the manager ducks it: a voice on a bus holding one key must
    // sound at the level its patch asks for, with no scale applied at all.
    expect(logged(voice.nodes.polyGain.gain).value).toBe(1);

    voice.disconnect();
    expect(wiring(voice.nodes.polyGain).disconnects).toBe(1);
  });

  test('the first setPolyphonyScale anchors at `at` and ramps from unity', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, threeSourcePatch());

    voice.setPolyphonyScale(0.5, 3);

    // A step under a held note is a click, so the value is anchored at `at`
    // and ramped from there. Nothing is re-drawn before the anchor because
    // nothing was scheduled for the cancel to erase — this is the voice's
    // first scale, and it starts from the unity the node was built at.
    const events = logged(voice.nodes.polyGain.gain).events;
    expect(events).toEqual([
      ['cancel', 3],
      ['set', 1, 3],
      ['ramp', 0.5, 3.015],
    ]);
  });

  // The defect this pins: the anchor used to be read off `polyGain.gain.value`,
  // which is the param's [[current value]] — its intrinsic value at the START
  // of the current render quantum, not its value at `at`. Scheduled ahead, as
  // here, that is the value NOW (the fake logs 0.2, a real param 1) rather than
  // the 0.5733 the ramp will have reached; at `at === currentTime` it is one
  // render quantum stale, a fifth of a 15 ms ramp, in the direction that steps
  // a chord's held voices UP.
  //
  // This test reads the anchor the voice COMPUTES, which is a fake param's
  // reach. Whether the rendered audio actually follows it is a different
  // question, asked of real samples in subtractiveSignal.test.ts — a fake
  // param does not interpolate, so a test written here could name the property
  // and never see it.
  test('a second setPolyphonyScale inside the first ramp anchors where the ramp had got to', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, threeSourcePatch());

    voice.setPolyphonyScale(0.2, 3);
    // 8 ms into the 15 ms ramp: 1 + (0.2 - 1) * (8 / 15).
    voice.setPolyphonyScale(0.1, 3.008);

    // Rounded before comparing: the anchor is arithmetic on times, and
    // `(3.008 - 3) / 0.015` is not bit-identical to `0.008 / 0.015`. Nine
    // decimals is far finer than any gain this could be wrong by and keeps the
    // whole event list readable as one assertion.
    const events = logged(voice.nodes.polyGain.gain).events.slice(3);
    const anchor = 1 + (0.2 - 1) * (0.008 / 0.015);
    expect(events.map((e) => e.map((v) => (typeof v === 'number' ? Number(v.toFixed(9)) : v)))).toEqual([
      ['cancel', 3.008],
      // The re-draw: the cancel removed the whole ramp, including the part
      // before 3.008 that has not been rendered yet, so the line back to the
      // anchor is laid down again. Same shape and same reason as
      // `releaseScheduledParamTo`'s.
      ['ramp', Number(anchor.toFixed(9)), 3.008],
      ['set', Number(anchor.toFixed(9)), 3.008],
      ['ramp', 0.1, 3.023],
    ]);
  });

  test('a negative scale can never invert the voice', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, threeSourcePatch());

    voice.setPolyphonyScale(-2, 1);

    expect(logged(voice.nodes.polyGain.gain).events.at(-1)).toEqual(['ramp', 0, 1.015]);
  });
});

describe('SubtractiveVoice.lfoSource', () => {
  test('starts undefined — nothing has claimed the LFO identity slot yet', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, threeSourcePatch());

    expect(voice.lfoSource).toBeUndefined();
  });

  test('is a plain mutable slot a caller (SynthLfoBank) can write an opaque identity into', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, threeSourcePatch());
    const sharedGenerator = { marker: 'shared-transport-oscillator' };

    voice.lfoSource = sharedGenerator;

    expect(voice.lfoSource).toBe(sharedGenerator);
  });
});

describe('createSubtractiveVoice output level', () => {
  test('the amp envelope peak carries velocity and outputGainDb', () => {
    const ctx = fakeVoiceContext();
    const patch = patchWith({ ampEnvelope: { attack: 0, decay: 0.5, sustain: 1, release: 0.2 } }, { velocityToAmplitude: 1, outputGainDb: -6 });
    const { voice } = build(ctx, patch, noteEvent({ velocity: 0.5 }));

    const events = logged(voice.nodes.ampGain.gain).events;
    expect(events[0][0]).toBe('set');
    expect(events[0][1]).toBeCloseTo(0.5 * dbToGain(-6), 6);
  });

  test('velocityToAmplitude 0 makes a soft note as loud as a hard one', () => {
    const ctx = fakeVoiceContext();
    const patch = patchWith({ ampEnvelope: { attack: 0, decay: 0.5, sustain: 1, release: 0.2 } }, { velocityToAmplitude: 0, outputGainDb: 0 });
    const { voice } = build(ctx, patch, noteEvent({ velocity: 0.2 }));

    expect(logged(voice.nodes.ampGain.gain).events[0][1]).toBeCloseTo(1, 6);
  });

  test('the amp gain sits at silence before the note-on instant', () => {
    const ctx = fakeVoiceContext();
    const patch = patchWith({ ampEnvelope: { attack: 0.1, decay: 0.5, sustain: 0.5, release: 0.2 } });
    const { voice } = build(ctx, patch);

    expect(logged(voice.nodes.ampGain.gain).events[0]).toEqual(['set', 0, 2]);
  });

  test('unison of one is center-panned however wide the patch is', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, patchWith({}, { unisonVoices: 1, stereoWidth: 1, unisonDetuneCents: 20 }));

    expect(logged(voice.nodes.panner.pan).value).toBe(0);
    expect(logged(voice.nodes.oscillators[0]?.frequency).value).toBeCloseTo(261.6255653, 4);
  });

  test('a unison pair spreads symmetrically in pitch and pan, at equal power', () => {
    const ctx = fakeVoiceContext();
    const patch = patchWith({ ampEnvelope: { attack: 0, decay: 0.5, sustain: 1, release: 0.2 } }, { unisonVoices: 2, stereoWidth: 1, unisonDetuneCents: 10, outputGainDb: 0, velocityToAmplitude: 0 });
    const low = build(ctx, patch, noteEvent({ unisonIndex: 0 })).voice;
    const high = build(ctx, patch, noteEvent({ unisonIndex: 1 })).voice;

    expect(logged(low.nodes.panner.pan).value).toBeCloseTo(-1, 6);
    expect(logged(high.nodes.panner.pan).value).toBeCloseTo(1, 6);
    const base = 261.6255653;
    expect(logged(low.nodes.oscillators[0]?.frequency).value).toBeCloseTo(base * Math.pow(2, -0.1 / 12), 4);
    expect(logged(high.nodes.oscillators[0]?.frequency).value).toBeCloseTo(base * Math.pow(2, 0.1 / 12), 4);
    // Two voices at 1/sqrt(2) each sum to the same power as one at unity.
    expect(logged(low.nodes.ampGain.gain).events[0][1]).toBeCloseTo(Math.SQRT1_2, 6);
  });
});

describe('createSubtractiveVoice down-sweep acceptance', () => {
  test('ENV2 at +48 semitones sweeps both oscillators from +4800 cents to 0 while ENV1 works the amp', () => {
    const ctx = fakeVoiceContext();
    const sineOnly = patchWith({
      oscillators: [
        { ...INIT.synth.oscillators[0], enabled: true, waveform: 'sine', levelDb: 0 },
        { ...INIT.synth.oscillators[1], enabled: true, waveform: 'sine', levelDb: 0 },
      ],
      ampEnvelope: { attack: 0, decay: 0.5, sustain: 0.8, release: 0.2 },
      modEnvelope: { attack: 0, decay: 1, sustain: 0, release: 0.1 },
      env2Routes: [{ target: 'pitch-all', unit: 'semitones', amount: 48 }],
    }, { outputGainDb: -6, velocityToAmplitude: 0 });
    const { voice } = build(ctx, sineOnly, noteEvent({ at: 2 }));

    for (const slot of [0, 1]) {
      expect(voice.nodes.oscillators[slot]?.type).toBe('sine');
      expect(logged(voice.nodes.oscillators[slot]?.detune).events).toEqual([
        ['set', 4800, 2],
        ['ramp', 0, 3],
      ]);
    }
    // ENV1 is a separate schedule on a separate node: amplitude decays to its
    // own sustain over its own 0.5 s, untouched by the one-second pitch sweep.
    const peak = dbToGain(-6);
    const ampEvents = logged(voice.nodes.ampGain.gain).events;
    expect(ampEvents).toHaveLength(2);
    expect(ampEvents[0][0]).toBe('set');
    expect(ampEvents[0][1]).toBeCloseTo(peak, 6);
    expect(ampEvents[1][0]).toBe('ramp');
    expect(ampEvents[1][1]).toBeCloseTo(peak * 0.8, 6);
    expect(ampEvents[1][2]).toBe(2.5);
    // Nothing multiplied the amp: the tremolo gain stays at unity with no automation.
    expect(logged(voice.nodes.tremoloGain.gain).events).toEqual([]);
    expect(logged(voice.nodes.tremoloGain.gain).value).toBe(1);
  });
});

/** A patch whose ENV2 runs 0 -> 1 -> 0 over one second, so a routed peak reads straight off the log. */
const routed = (routes: ModRoute[], synth: Partial<SubtractiveParams> = {}) =>
  patchWith({
    modEnvelope: { attack: 0, decay: 1, sustain: 0, release: 0.2 },
    env2Routes: routes,
    ...synth,
  });

describe('createSubtractiveVoice pitch and filter routing', () => {
  test('a per-oscillator pitch route sums with pitch-all on that slot only', () => {
    const ctx = fakeVoiceContext();
    const patch = routed(
      [
        { target: 'pitch-all', unit: 'semitones', amount: 12 },
        { target: 'osc2-pitch', unit: 'semitones', amount: -5 },
      ],
      {
        oscillators: [
          { ...INIT.synth.oscillators[0], enabled: true },
          { ...INIT.synth.oscillators[1], enabled: true },
        ],
      },
    );
    const { voice } = build(ctx, patch);

    expect(logged(voice.nodes.oscillators[0]?.detune).events).toEqual([['set', 1200, 2], ['ramp', 0, 3]]);
    expect(logged(voice.nodes.oscillators[1]?.detune).events).toEqual([['set', 700, 2], ['ramp', 0, 3]]);
  });

  test('no pitch route leaves detune untouched', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, routed([]));

    expect(logged(voice.nodes.oscillators[0]?.detune).events).toEqual([]);
  });

  test('a cutoff route moves the filter in semitone RATIO space, not in Hz', () => {
    const ctx = fakeVoiceContext();
    const patch = routed([{ target: 'filter-cutoff', unit: 'semitones', amount: 12 }], {
      filter: { ...INIT.synth.filter, cutoffHz: 1_000 },
    });
    const { voice } = build(ctx, patch);

    // +12 semitones is one octave: 1000 -> 2000 Hz, and sustain 0 returns to base.
    expect(logged(voice.nodes.filter.frequency).events).toEqual([['set', 2000, 2], ['ramp', 1000, 3]]);
  });

  test('the ROUTED cutoff is clamped below Nyquist, not just the base cutoff', () => {
    const ctx = fakeVoiceContext(8_000);
    const patch = routed([{ target: 'filter-cutoff', unit: 'semitones', amount: 48 }], {
      filter: { ...INIT.synth.filter, cutoffHz: 2_000 },
    });
    const { voice } = build(ctx, patch);

    // Base 2000 Hz is legal at this rate; 2000 * 16 = 32 kHz is far past the
    // 4 kHz Nyquist and clamps, while the base is left where the patch put it.
    const events = logged(voice.nodes.filter.frequency).events;
    expect(events[0][1]).toBeCloseTo(3_920, 6);
    expect(events[1][1]).toBeCloseTo(2_000, 6);
  });

  test('key tracking raises the base cutoff with the note', () => {
    const ctx = fakeVoiceContext();
    const patch = patchWith({ filter: { ...INIT.synth.filter, cutoffHz: 1_000, keyTrack: 1 } });
    const { voice } = build(ctx, patch, noteEvent({ frequency: noteFrequency('C5') }));

    // C5 is one octave above the C4 key-track reference.
    expect(logged(voice.nodes.filter.frequency).value).toBeCloseTo(2_000, 3);
  });

  test('resonance maps 0..1 onto the browser Q range and a route moves along it', () => {
    const ctx = fakeVoiceContext();
    const flat = build(fakeVoiceContext(), patchWith({ filter: { ...INIT.synth.filter, resonance: 0 } })).voice;
    expect(logged(flat.nodes.filter.Q).value).toBeCloseTo(0.7071, 4);

    const full = build(fakeVoiceContext(), patchWith({ filter: { ...INIT.synth.filter, resonance: 1 } })).voice;
    expect(logged(full.nodes.filter.Q).value).toBeCloseTo(18, 4);

    const patch = routed([{ target: 'filter-resonance', unit: 'normalized', amount: 0.5 }], {
      filter: { ...INIT.synth.filter, resonance: 0 },
    });
    const { voice } = build(ctx, patch);
    const events = logged(voice.nodes.filter.Q).events;
    expect(events[0][1]).toBeCloseTo(Math.sqrt(0.7071 * 18), 4);
    expect(events[1][1]).toBeCloseTo(0.7071, 4);
  });

  test('a resonance route past full scale clamps rather than exceeding the Q range', () => {
    const ctx = fakeVoiceContext();
    const patch = routed([{ target: 'filter-resonance', unit: 'normalized', amount: 5 }], {
      filter: { ...INIT.synth.filter, resonance: 0.5 },
    });
    const { voice } = build(ctx, patch);

    expect(logged(voice.nodes.filter.Q).events[0][1]).toBeCloseTo(18, 4);
  });

});

describe('createSubtractiveVoice level, amplitude and pan routing', () => {
  test('an oscillator level route scales that slot gain in dB', () => {
    const ctx = fakeVoiceContext();
    const patch = routed([{ target: 'osc1-level', unit: 'db', amount: -12 }], {
      oscillators: [
        { ...INIT.synth.oscillators[0], enabled: true, levelDb: 0 },
        { ...INIT.synth.oscillators[1], enabled: true, levelDb: 0 },
      ],
    });
    const { voice } = build(ctx, patch);

    const events = logged(voice.nodes.oscillatorGains[0]?.gain).events;
    expect(events[0][1]).toBeCloseTo(dbToGain(-12), 6);
    expect(events[1][1]).toBeCloseTo(1, 6);
    expect(logged(voice.nodes.oscillatorGains[1]?.gain).events).toEqual([]);
    expect(logged(voice.nodes.oscillatorGains[1]?.gain).value).toBeCloseTo(1, 6);
  });

  test('an amplitude route multiplies on its OWN gain and never touches the amp envelope', () => {
    const ctx = fakeVoiceContext();
    const patch = routed([{ target: 'amplitude', unit: 'db', amount: -6 }], {
      ampEnvelope: { attack: 0, decay: 0.5, sustain: 1, release: 0.2 },
    });
    const { voice } = build(ctx, patch, noteEvent({ velocity: 1 }));

    const tremolo = logged(voice.nodes.tremoloGain.gain).events;
    expect(tremolo[0][0]).toBe('set');
    expect(tremolo[0][1]).toBeCloseTo(dbToGain(-6), 6);
    // Unity is where an amplitude modulator rests: the contour returns to 1,
    // never to 0, so the series gain cannot silence the voice on its own.
    expect(tremolo[1]).toEqual(['ramp', 1, 3]);
    // ENV1's own node kept exactly its own two events — the amplitude route
    // added nothing to the param the release has to drive to silence.
    expect(logged(voice.nodes.ampGain.gain).events).toHaveLength(2);
  });

  test('a pan route offsets the voice position', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, routed([{ target: 'pan', unit: 'pan', amount: 0.5 }]));

    expect(logged(voice.nodes.panner.pan).events).toEqual([['set', 0.5, 2], ['ramp', 0, 3]]);
  });

  test('a pan route cannot push a hard-panned unison voice past the edge', () => {
    const ctx = fakeVoiceContext();
    const patch = {
      ...routed([{ target: 'pan', unit: 'pan', amount: 0.8 }]),
      common: { ...INIT.common, unisonVoices: 2, stereoWidth: 1 },
    };
    const { voice } = build(ctx, patch, noteEvent({ unisonIndex: 1 }));

    expect(logged(voice.nodes.panner.pan).events[0][1]).toBeCloseTo(1, 6);
  });
});

describe('SubtractiveVoice release', () => {
  test('ENV1 releases to exact silence while ENV2 returns its destination to base', () => {
    const ctx = fakeVoiceContext();
    const patch = patchWith({
      filter: { ...INIT.synth.filter, cutoffHz: 1_000 },
      ampEnvelope: { attack: 0, decay: 0.5, sustain: 0.5, release: 0.4 },
      modEnvelope: { attack: 0, decay: 1, sustain: 0.5, release: 0.2 },
      env2Routes: [{ target: 'filter-cutoff', unit: 'semitones', amount: 12 }],
    });
    const { voice } = build(ctx, patch);

    voice.release(5, 0.4);

    // Four events per release now, not three: the cancel, the re-draw of the
    // segment it erased, the anchor, then the ramp. See
    // `releaseScheduledParamTo`'s docblock for why the re-draw is there.
    const amp = logged(voice.nodes.ampGain.gain).events;
    // The note's own envelope, read off the log rather than recomputed: a zero
    // attack sets the peak at note-on, then the decay ramps to half of it. The
    // peak folds in velocity and the patch's output gain, so deriving the
    // sustain FROM it is what keeps this asserting the release rather than
    // re-deriving the voice's gain model beside it.
    const peak = amp[0][1] as number;
    const ampSustain = amp[1][1] as number;
    expect(ampSustain).toBeCloseTo(peak * 0.5, 10);

    expect(amp[amp.length - 4]).toEqual(['cancel', 5]);
    // The re-draw, stated in full — this is the surface the release repair
    // touched, so a tag-only assertion here would pass for a ramp to the wrong
    // value or at the wrong time. The decay ended at 2.5, so the envelope holds
    // sustain at t = 5, and the re-draw and the anchor must agree on it exactly.
    expect(amp[amp.length - 3][0]).toBe('ramp');
    expect(amp[amp.length - 3][1]).toBeCloseTo(ampSustain, 10);
    expect(amp[amp.length - 3][2]).toBe(5);
    expect(amp[amp.length - 2][0]).toBe('set');
    expect(amp[amp.length - 2][1]).toBeCloseTo(ampSustain, 10);
    expect(amp[amp.length - 2][2]).toBe(5);
    expect(amp[amp.length - 1]).toEqual(['ramp', 0, 5.4]);

    const cutoff = logged(voice.nodes.filter.frequency).events;
    expect(cutoff[cutoff.length - 4]).toEqual(['cancel', 5]);
    // ENV2's own re-draw, likewise in full. A 12-semitone route over a 1000 Hz
    // cutoff peaks at 2000 and sustains at 0.5 of the span, i.e. 1500 Hz — the
    // value the contour holds at t = 5, and what both the re-draw and the
    // anchor must carry before the walk back to base.
    expect(cutoff[cutoff.length - 3][0]).toBe('ramp');
    expect(cutoff[cutoff.length - 3][1]).toBeCloseTo(1_500, 6);
    expect(cutoff[cutoff.length - 3][2]).toBe(5);
    expect(cutoff[cutoff.length - 2]).toEqual(['set', cutoff[cutoff.length - 3][1], 5]);
    // Back to the unmodulated cutoff over ENV2's own 0.2 s release — NOT to 0 Hz.
    expect(cutoff[cutoff.length - 1][0]).toBe('ramp');
    expect(cutoff[cutoff.length - 1][1]).toBeCloseTo(1_000, 6);
    expect(cutoff[cutoff.length - 1][2]).toBeCloseTo(5.2, 6);
  });

  test('ENV2 never modulates past the point the amp release has silenced the voice', () => {
    const ctx = fakeVoiceContext();
    const patch = patchWith({
      filter: { ...INIT.synth.filter, cutoffHz: 1_000 },
      modEnvelope: { attack: 0, decay: 1, sustain: 0.5, release: 2 },
      env2Routes: [{ target: 'filter-cutoff', unit: 'semitones', amount: 12 }],
    });
    const { voice } = build(ctx, patch);

    voice.release(5, 0.05);

    const cutoff = logged(voice.nodes.filter.frequency).events;
    expect(cutoff[cutoff.length - 1][2]).toBeCloseTo(5.05, 6);
  });
});

describe('SubtractiveVoice release over a release', () => {
  /** Flat at full level until note-off, so every anchor below is an exact number. */
  function flatPatch(): EnginePatch<'subtractive'> {
    return patchWith({
      filter: { ...INIT.synth.filter, cutoffHz: 1000, keyTrack: 0 },
      ampEnvelope: { attack: 0, decay: 0, sustain: 1, release: 1 },
      modEnvelope: { attack: 0, decay: 0, sustain: 1, release: 1 },
      env2Routes: [{ target: 'filter-cutoff', unit: 'semitones', amount: 12 }],
    }, { outputGainDb: 0, velocityToAmplitude: 0 });
  }

  test('a second release anchors on the release ALREADY in flight, not back at sustain', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, flatPatch(), noteEvent({ at: 0 }));
    const amp = logged(voice.nodes.ampGain.gain);
    const cutoff = logged(voice.nodes.filter.frequency);

    voice.release(1, 1);
    const ampMark = amp.events.length;
    const cutoffMark = cutoff.events.length;
    // Halfway down a one-second release, a steal cuts the tail short. Anchoring
    // at sustain here lifts the gain back to full and fades it over 20 ms — a click.
    voice.release(1.5, 0.02);

    expect(amp.events[ampMark]).toEqual(['cancel', 1.5]);
    // +1 is the re-draw of the first release's own ramp between 1 and 1.5;
    // +2 is the anchor. Both carry the same held value, which is the point.
    expect(amp.events[ampMark + 1][1]).toBeCloseTo(0.5, 6);
    expect(amp.events[ampMark + 2][1]).toBeCloseTo(0.5, 6);
    expect(amp.events[ampMark + 3]).toEqual(['ramp', 0, 1.52]);
    expect(cutoff.events[cutoffMark + 2][1]).toBeCloseTo(1500, 6);
  });

  /** A four-second attack, so an anchor taken part-way up it is an exact fraction. */
  function attackPatch(): EnginePatch<'subtractive'> {
    return patchWith({
      ampEnvelope: { attack: 4, decay: 0, sustain: 1, release: 1 },
      modEnvelope: { attack: 0, decay: 0, sustain: 1, release: 1 },
      env2Routes: [],
    }, { outputGainDb: 0, velocityToAmplitude: 0 });
  }

  /** Attack, decay and a sustain below peak — no two anchors below are the same number. */
  function shapedPatch(): EnginePatch<'subtractive'> {
    return patchWith({
      filter: { ...INIT.synth.filter, cutoffHz: 1000, keyTrack: 0 },
      ampEnvelope: { attack: 1, decay: 1, sustain: 0.5, release: 2 },
      modEnvelope: { attack: 0, decay: 0, sustain: 1, release: 2 },
      env2Routes: [{ target: 'filter-cutoff', unit: 'semitones', amount: 12 }],
    }, { outputGainDb: 0, velocityToAmplitude: 0 });
  }

  test('a release scheduled EARLIER than one in flight anchors on the note envelope', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, attackPatch(), noteEvent({ at: 0 }));
    const amp = logged(voice.nodes.ampGain.gain);

    // The sequencer books a note-off for the top of the attack...
    voice.release(4, 1);
    const mark = amp.events.length;
    // ...and then a loop load silences the bus NOW, halfway up it. The release
    // in flight has not started yet, so it governs nothing at this instant.
    voice.release(2, 0.02);

    expect(amp.events[mark]).toEqual(['cancel', 2]);
    // Halfway through a four-second attack. Anchoring on the later release's
    // held value writes 1 here and steps the gain UP before fading it. The
    // re-draw at +1 restores the half of the attack that had already elapsed,
    // and carries the same held value as the anchor at +2.
    expect(amp.events[mark + 1][1]).toBeCloseTo(0.5, 6);
    expect(amp.events[mark + 2][1]).toBeCloseTo(0.5, 6);
    expect(amp.events[mark + 3]).toEqual(['ramp', 0, 2.02]);
  });

  test('a third consecutive release keeps following the ramp the second one wrote', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, flatPatch(), noteEvent({ at: 0 }));
    const amp = logged(voice.nodes.ampGain.gain);

    voice.release(1, 1);
    const second = amp.events.length;
    voice.release(1.5, 1);
    const third = amp.events.length;
    voice.release(2, 0.02);

    expect(amp.events[second + 1][1]).toBeCloseTo(0.5, 6);
    expect(amp.events[third + 1][1]).toBeCloseTo(0.25, 6);
  });

  test('a release landing at the EXACT instant one in flight begins takes that release value', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, flatPatch(), noteEvent({ at: 0 }));
    const amp = logged(voice.nodes.ampGain.gain);
    const cutoff = logged(voice.nodes.filter.frequency);

    // Depth three is what makes this observable: the release in flight must be
    // one that was itself anchored on a ramp, not on the note envelope, or its
    // held value and the envelope's value coincide and nothing distinguishes
    // the two rules.
    voice.release(1, 1);
    voice.release(1.5, 1);
    const mark = amp.events.length;
    const cutoffMark = cutoff.events.length;
    voice.release(1.5, 0.02);

    // At exactly `inFlight.at` the param holds what that release WROTE there.
    // Falling through to the note envelope would read sustain — 1 for the amp
    // and 2000 Hz for the route — and step both UP before the fade.
    expect(amp.events[mark + 1][1]).toBeCloseTo(0.5, 6);
    expect(cutoff.events[cutoffMark + 1][1]).toBeCloseTo(1500, 6);
  });

  test('release over release on a SHAPED envelope measures from the decay, then from the ramp', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, shapedPatch(), noteEvent({ at: 0 }));
    const amp = logged(voice.nodes.ampGain.gain);
    const cutoff = logged(voice.nodes.filter.frequency);

    const first = amp.events.length;
    voice.release(1.5, 2);
    // Half a second into a one-second decay from peak 1 to sustain 0.5.
    expect(amp.events[first + 1][1]).toBeCloseTo(0.75, 6);

    const second = amp.events.length;
    const secondCutoff = cutoff.events.length;
    voice.release(2.5, 0.02);

    // One second into the two-second release that started at 0.75.
    expect(amp.events[second + 1][1]).toBeCloseTo(0.375, 6);
    expect(cutoff.events[secondCutoff + 1][1]).toBeCloseTo(1500, 6);
  });

  test('a release after the first has already finished anchors at silence, not below it', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, flatPatch(), noteEvent({ at: 0 }));
    const amp = logged(voice.nodes.ampGain.gain);

    voice.release(1, 1);
    const mark = amp.events.length;
    voice.release(3, 0.02);

    expect(amp.events[mark + 1][1]).toBeCloseTo(0, 6);
  });
});

describe('SubtractiveVoice release scheduled ahead', () => {
  test('anchors ENV1 at the value the envelope WILL hold, not the value it holds now', () => {
    const ctx = fakeVoiceContext();
    const patch = patchWith(
      { ampEnvelope: { attack: 0.2, decay: 0.4, sustain: 0.8, release: 0.3 } },
      { outputGainDb: 0, velocityToAmplitude: 0 },
    );
    const { voice } = build(ctx, patch, noteEvent({ at: 2 }));

    // A note-off booked for halfway through the attack — which is what a
    // sequencer does. `param.value` reports the LAST value scheduled (the 0.8
    // sustain), so reading it would step the release up before ramping down.
    voice.release(2.1, 0.3);

    const amp = logged(voice.nodes.ampGain.gain).events;
    expect(amp[amp.length - 4]).toEqual(['cancel', 2.1]);
    // The re-draw restores the tenth of a second of attack that had already
    // elapsed when the cancel wiped the attack ramp, and lands on the same
    // value the anchor states.
    expect(amp[amp.length - 3][0]).toBe('ramp');
    expect(amp[amp.length - 3][1]).toBeCloseTo(0.5, 10);
    expect(amp[amp.length - 3][2]).toBeCloseTo(2.1, 10);
    expect(amp[amp.length - 2][0]).toBe('set');
    expect(amp[amp.length - 2][1]).toBeCloseTo(0.5, 10);
    expect(amp[amp.length - 2][2]).toBeCloseTo(2.1, 10);
    expect(amp[amp.length - 1]).toEqual(['ramp', 0, 2.4]);
  });

  test('anchors at sustain for a release booked after the envelope has settled', () => {
    const ctx = fakeVoiceContext();
    const patch = patchWith(
      { ampEnvelope: { attack: 0.2, decay: 0.4, sustain: 0.8, release: 0.3 } },
      { outputGainDb: 0, velocityToAmplitude: 0 },
    );
    const { voice } = build(ctx, patch, noteEvent({ at: 2 }));

    voice.release(5, 0.3);

    expect(logged(voice.nodes.ampGain.gain).events.slice(-2)).toEqual([
      ['set', 0.8, 5],
      ['ramp', 0, 5.3],
    ]);
  });

  test('anchors an ENV2 destination mid-decay too, in that destination own unit', () => {
    const ctx = fakeVoiceContext();
    const patch = patchWith({
      filter: { ...INIT.synth.filter, cutoffHz: 1_000 },
      modEnvelope: { attack: 0, decay: 1, sustain: 0, release: 0.2 },
      env2Routes: [{ target: 'filter-cutoff', unit: 'semitones', amount: 12 }],
    });
    const { voice } = build(ctx, patch, noteEvent({ at: 2 }));

    // Halfway down a 2000 -> 1000 Hz decay. The last scheduled value is 1000,
    // so an anchor read off the param would skip the top half of the sweep.
    voice.release(2.5, 0.2);

    expect(logged(voice.nodes.filter.frequency).events.slice(-4)).toEqual([
      ['cancel', 2.5],
      // The erased half of the 2000 -> 1000 Hz sweep, re-drawn. Without it the
      // filter sits at 2000 Hz for the whole note and steps to 1500 here.
      ['ramp', 1_500, 2.5],
      ['set', 1_500, 2.5],
      ['ramp', 1_000, 2.7],
    ]);
  });
});

describe('SubtractiveVoice teardown', () => {
  test('stops every created source and disconnects every node exactly once', () => {
    const ctx = fakeVoiceContext(8_000);
    const patch = patchWith({
      oscillators: [
        { ...INIT.synth.oscillators[0], enabled: true },
        { ...INIT.synth.oscillators[1], enabled: true },
      ],
      utility: { ...INIT.synth.utility, subEnabled: true, noiseEnabled: true, noiseLevelDb: -12 },
    });
    const { voice } = build(ctx, patch);

    voice.teardown(9);

    for (const osc of ctx.oscillators) {
      expect(osc.stopArgs).toEqual([9]);
      expect(osc.disconnects).toBe(1);
    }
    expect(ctx.bufferSources[0].stopArgs).toEqual([9]);
    expect(wiring(voice.nodes.filter).disconnects).toBe(1);
    expect(wiring(voice.nodes.drive).disconnects).toBe(1);
    expect(wiring(voice.nodes.ampGain).disconnects).toBe(1);
    expect(wiring(voice.nodes.tremoloGain).disconnects).toBe(1);
    expect(wiring(voice.nodes.panner).disconnects).toBe(1);
  });

  test('is idempotent — a second teardown neither stops nor disconnects again', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, threeSourcePatch());

    voice.teardown(9);
    voice.teardown(11);

    expect(ctx.oscillators[0].stopArgs).toEqual([9]);
    expect(wiring(voice.nodes.panner).disconnects).toBe(1);
  });

  test('stopSources schedules the stop and leaves every edge of the graph intact', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, threeSourcePatch());

    // The half a caller may book AHEAD: `release(t, r)` then `stopSources(t + r)`
    // must not cut the tail, because `disconnect()` cannot be scheduled.
    voice.release(3, 0.5);
    voice.stopSources(3.5);

    for (const osc of ctx.oscillators) {
      expect(osc.stopArgs).toEqual([3.5]);
      expect(osc.disconnects).toBe(0);
    }
    expect(wiring(voice.nodes.panner).disconnects).toBe(0);
    expect(wiring(voice.nodes.ampGain).disconnects).toBe(0);
    expect(wiring(voice.nodes.panner).connections).toHaveLength(1);
  });

  test('disconnect tears the graph down and schedules no stop of its own', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, threeSourcePatch());

    voice.disconnect();

    expect(ctx.oscillators[0].stopArgs).toEqual([]);
    expect(ctx.oscillators[0].disconnects).toBe(1);
    expect(wiring(voice.nodes.panner).disconnects).toBe(1);
  });

  test('each half is idempotent on its own', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, threeSourcePatch());

    voice.stopSources(8);
    voice.stopSources(9);
    voice.disconnect();
    voice.disconnect();
    // teardown is the two halves; both have already run.
    voice.teardown(10);

    expect(ctx.oscillators[0].stopArgs).toEqual([8]);
    expect(wiring(voice.nodes.panner).disconnects).toBe(1);
  });

  test('a teardown time before the note-on instant still stops at the note-on instant', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, threeSourcePatch(), noteEvent({ at: 6 }));

    voice.teardown(1);

    expect(ctx.oscillators[0].stopArgs).toEqual([6]);
  });
});

describe('SubtractiveVoice update', () => {
  test('applies waveform, tuning, level and filter to a sounding voice', () => {
    const ctx = fakeVoiceContext();
    const previous = patchWith({
      oscillators: [
        { ...INIT.synth.oscillators[0], enabled: true, waveform: 'sawtooth', levelDb: 0 },
        { ...INIT.synth.oscillators[1], enabled: false },
      ],
      filter: { ...INIT.synth.filter, cutoffHz: 1_000, resonance: 0, driveDb: 0 },
    });
    const { voice } = build(ctx, previous);
    const next = patchWith({
      oscillators: [
        { ...previous.synth.oscillators[0], waveform: 'square', semitone: 12, levelDb: -6 },
        previous.synth.oscillators[1],
      ],
      filter: { ...previous.synth.filter, type: 'highpass', cutoffHz: 500, driveDb: 6 },
    });

    voice.update(previous, next, 7);

    expect(voice.nodes.oscillators[0]?.type).toBe('square');
    // The cancel is the point, not noise: a retune has to drop the endpoint of
    // any glide still in flight, which would otherwise overtake this write and
    // land on the OLD tuning. With no glide running it cancels nothing.
    const tuning = logged(voice.nodes.oscillators[0]?.frequency).events;
    expect(tuning).toHaveLength(2);
    expect(tuning[0]).toEqual(['cancel', 7]);
    expect(tuning[1][0]).toBe('set');
    expect(tuning[1][1]).toBeCloseTo(261.6255653 * 2, 4);
    expect(tuning[1][2]).toBe(7);
    expect(logged(voice.nodes.oscillatorGains[0]?.gain).events[0][1]).toBeCloseTo(dbToGain(-6), 6);
    expect(voice.nodes.filter.type).toBe('highpass');
    expect(logged(voice.nodes.filter.frequency).events).toEqual([['set', 500, 7]]);
    expect(voice.nodes.drive.curve).toEqual(driveCurve(6));
  });

  test('re-pans a unison voice when the patch width changes', () => {
    const ctx = fakeVoiceContext();
    const previous = { ...patchWith({}), common: { ...INIT.common, unisonVoices: 2, stereoWidth: 1 } };
    const { voice } = build(ctx, previous, noteEvent({ unisonIndex: 0 }));
    const next = { ...previous, common: { ...previous.common, stereoWidth: 0.5 } };

    voice.update(previous, next, 7);

    expect(logged(voice.nodes.panner.pan).events).toEqual([['set', -0.5, 7]]);
  });

  test('leaves a destination ENV2 owns alone rather than stomping its automation', () => {
    const ctx = fakeVoiceContext();
    const previous = patchWith({
      filter: { ...INIT.synth.filter, cutoffHz: 1_000 },
      modEnvelope: { attack: 0, decay: 1, sustain: 0, release: 0.2 },
      env2Routes: [{ target: 'filter-cutoff', unit: 'semitones', amount: 12 }],
    });
    const { voice } = build(ctx, previous);
    const before = logged(voice.nodes.filter.frequency).events.length;
    const next = patchWith({
      filter: { ...previous.synth.filter, cutoffHz: 400 },
      modEnvelope: previous.synth.modEnvelope,
      env2Routes: previous.synth.env2Routes,
    });

    voice.update(previous, next, 7);

    expect(logged(voice.nodes.filter.frequency).events).toHaveLength(before);
  });
});

describe('createSubtractiveVoice drive stage', () => {
  test('does not oversample at 0 dB — the neutral knob position must not colour the signal', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, patchWith({ filter: { ...INIT.synth.filter, driveDb: 0 } }));

    // A '2x' shaper runs the signal through implementation-defined up- and
    // downsample filters even with an identity curve, which would make drive
    // audible at the setting that is supposed to be transparent.
    expect(voice.nodes.drive.oversample).toBe('none');
    expect(voice.nodes.drive.curve).toEqual(driveCurve(0));
  });

  test('oversamples once the stage actually saturates', () => {
    const ctx = fakeVoiceContext();
    const { voice } = build(ctx, patchWith({ filter: { ...INIT.synth.filter, driveDb: 6 } }));

    expect(voice.nodes.drive.oversample).toBe('2x');
  });

  test('a live drive change moves the oversampling with the curve, in both directions', () => {
    const ctx = fakeVoiceContext();
    const previous = patchWith({ filter: { ...INIT.synth.filter, driveDb: 0 } });
    const { voice } = build(ctx, previous);
    const driven = patchWith({ filter: { ...previous.synth.filter, driveDb: 9 } });

    voice.update(previous, driven, 7);
    expect(voice.nodes.drive.oversample).toBe('2x');
    expect(voice.nodes.drive.curve).toEqual(driveCurve(9));

    voice.update(driven, previous, 8);
    expect(voice.nodes.drive.oversample).toBe('none');
    expect(voice.nodes.drive.curve).toEqual(driveCurve(0));
  });
});

describe('driveCurve', () => {
  test('is exactly unity at 0 dB', () => {
    const curve = driveCurve(0);
    const last = curve.length - 1;
    expect(curve[0]).toBe(-1);
    expect(curve[last]).toBe(1);
    expect(curve[(last / 2) | 0]).toBe(0);
    for (let i = 0; i <= last; i += 97) {
      expect(curve[i]).toBeCloseTo((i / last) * 2 - 1, 6);
    }
  });

  test('a negative drive is unity too — drive saturates, it does not trim', () => {
    expect(driveCurve(-6)).toEqual(driveCurve(0));
  });

  test('a positive drive saturates symmetrically and stays bounded', () => {
    const curve = driveCurve(12);
    const last = curve.length - 1;
    const mid = (last / 2) | 0;
    expect(curve[mid]).toBe(0);
    expect(curve[0]).toBeCloseTo(-1, 6);
    expect(curve[last]).toBeCloseTo(1, 6);
    // A quarter-scale input comes out hotter than it went in, and the curve is odd.
    const quarter = (last * 0.625) | 0;
    const x = (quarter / last) * 2 - 1;
    expect(curve[quarter]).toBeGreaterThan(x);
    expect(curve[last - quarter]).toBeCloseTo(-curve[quarter], 6);
  });

  test('is deterministic — the same drive builds the same curve every time', () => {
    expect(driveCurve(9)).toEqual(driveCurve(9));
  });
});
