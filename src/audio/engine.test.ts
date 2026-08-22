import { describe, expect, test } from 'bun:test';
import { audioEngine } from './engine';
import type { SynthParams } from '../types';

// The engine class isn't exported (singleton pattern), so fresh test
// instances are created from the singleton's constructor.
type EngineInstance = typeof audioEngine;
const makeEngine = () => new (audioEngine.constructor as any)() as EngineInstance;

// Minimal WebAudio stand-ins: params record every cancelScheduledValues target
// time, so a test can prove that scheduling a future note never cancels the
// envelope of a voice that is already fully scheduled (the chord-rhythm
// regression: all but the last hit of a multi-hit pattern were silenced).
function fakeParam() {
  return {
    value: 1,
    cancels: [] as number[],
    setValueAtTime(v: number, _t: number) {
      this.value = v;
    },
    cancelScheduledValues(t: number) {
      this.cancels.push(t);
    },
    exponentialRampToValueAtTime(_v: number, _t: number) {},
    setTargetAtTime(_v: number, _t: number, _tc: number) {},
  };
}

function fakeNode() {
  return {
    type: '',
    connect() {},
    disconnect() {},
    start() {},
    stop() {},
    gain: fakeParam(),
    frequency: fakeParam(),
    detune: fakeParam(),
    Q: fakeParam(),
  };
}

function fakeCtx() {
  const gains: ReturnType<typeof fakeNode>[] = [];
  return {
    currentTime: 10,
    createOscillator: () => fakeNode(),
    createGain: () => {
      const g = fakeNode();
      gains.push(g);
      return g;
    },
    createBiquadFilter: () => fakeNode(),
    resume: async () => {},
    _gains: gains,
  };
}

const SYNTH: SynthParams = {
  oscType: 'sawtooth',
  subOscVolume: 0.3,
  noiseVolume: 0,
  detune: 0,
  filterType: 'lowpass',
  filterCutoff: 2400,
  filterResonance: 3,
  filterEnvAmount: 1200,
  attack: 0.02,
  decay: 0.4,
  sustain: 0.6,
  release: 0.5,
  filterAttack: 0.02,
  filterDecay: 0.4,
  filterSustain: 0,
  filterRelease: 0.5,
  lfoRate: 3.5,
  lfoDepth: 0,
  lfoTarget: 'cutoff',
  octave: 0,
  preset: 'Test',
};

function freshEngine() {
  const engine = makeEngine();
  const ctx = fakeCtx();
  (engine as any).ctx = ctx;
  (engine as any).dryGain = fakeNode();
  (engine as any).delayNode = undefined;
  (engine as any).reverbNode = undefined;
  (engine as any).distortionNode = undefined;
  return { engine, ctx };
}

describe('scheduled chord hits', () => {
  test('a second same-note hit does not cancel the first voice envelope at scheduling time', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // A multi-hit chord pattern schedules all hits in one burst, e.g. two
    // hits of the same note 0.5 s apart, each released shortly after.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.25, 'chord');
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.5, 'chord');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.75, 'chord');

    // The first voice's envelope may only be cancelled by its OWN scheduled
    // release (t0 + 0.25). A cancel at t0 means the dedup released the still-
    // tracked first voice immediately, silencing the hit before it sounds.
    const firstVoiceGain = ctx._gains[0].gain;
    expect(firstVoiceGain.cancels).not.toContain(t0);
    expect(firstVoiceGain.cancels).toContain(t0 + 0.25);
  });
});

describe('live param updates', () => {
  test('a chord voice scheduled ahead stays tracked so param updates reach it', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 2, 'chord');

    const voice = (engine as any).activeVoices.get('chord:C4');
    expect(voice).toBeTruthy();

    engine.updateSynthParams({ ...SYNTH, oscType: 'sine' }, 'chord');
    expect(voice.oscs[0].type).toBe('sine');
  });

  test('updateSynthParams leaves a voice whose release has already started', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 - 1, 'chord');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0, 'chord');

    const voice = (engine as any).activeVoices.get('chord:C4');
    expect(voice).toBeTruthy();

    engine.updateSynthParams({ ...SYNTH, oscType: 'triangle' }, 'chord');
    expect(voice.oscs[0].type).toBe('sawtooth');
  });

  test('updateSynthParams leaves a voice scheduled in the future untouched', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // A voice starting 1 s ahead with its full envelope (attack ramps and the
    // note-off release) already planned.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 1, 'chord');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 3, 'chord');

    const voice = (engine as any).activeVoices.get('chord:C4');
    expect(voice).toBeTruthy();

    engine.updateSynthParams({ ...SYNTH, oscType: 'sine' }, 'chord');

    // Re-targeting a not-yet-started voice would cancel its planned envelope;
    // it must keep the params it was scheduled with.
    expect(voice.oscs[0].type).toBe('sawtooth');
    expect(voice.filter.frequency.cancels).not.toContain(t0);
  });

  test('retriggering a live synth note still releases the old voice immediately', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'synth');
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'synth');

    const oldVoiceGain = ctx._gains[0].gain;
    expect(oldVoiceGain.cancels).toContain(t0);
  });
});

describe('bass retrigger', () => {
  test('same-note retrigger releases the old voice at the new note start, not immediately', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C2', SYNTH, 0.8, t0, 'bass');
    engine.triggerSynthNoteOff('C2', SYNTH.release, t0 + 1, 'bass');
    engine.triggerSynthNoteOn('C2', SYNTH, 0.8, t0 + 0.5, 'bass');

    // The old voice stays tracked until its teardown (mono needs that), and
    // its release must be aimed at the new note's start (t0 + 0.5) — never at
    // scheduling time (t0).
    const oldVoice = (engine as any).activeVoices.get('bass:C2');
    expect(oldVoice).toBeTruthy();
    const oldVoiceGain = ctx._gains[0].gain;
    expect(oldVoiceGain.cancels).toContain(t0 + 0.5);
    expect(oldVoiceGain.cancels).not.toContain(t0);
  });
});

describe('source stop (preview release)', () => {
  test('stopSource silences every voice of the source, including future-scheduled pattern hits', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // A multi-hit pattern pre-schedules all hits at once (as
    // scheduleBarInvariantEvents does): two same-note hits plus another note.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.25, 'chord');
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.5, 'chord');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.75, 'chord');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.8, t0 + 0.5, 'chord');
    engine.triggerSynthNoteOn('F2', SYNTH, 0.8, t0, 'bass');

    // Releasing the preview must cut the whole chord pattern immediately.
    engine.stopSource('chord', 0.15);

    // Every chord voice's main gain gets its envelope cancelled now —
    // the sounding first hit and the two hits still scheduled in the future.
    const chordVoices = (engine as any).sourceVoices.get('chord') as Set<{ gains: { gain: { cancels: number[] } }[] }>;
    expect(chordVoices.size).toBe(3);
    for (const v of chordVoices) {
      expect(v.gains[0].gain.cancels).toContain(t0);
    }

    // The bass voice is untouched.
    const bassVoices = (engine as any).sourceVoices.get('bass') as Set<{ gains: { gain: { cancels: number[] } }[] }>;
    expect(bassVoices.size).toBe(1);
    for (const v of bassVoices) {
      expect(v.gains[0].gain.cancels).not.toContain(t0);
    }
  });
});
