import { describe, expect, spyOn, test } from 'bun:test';
import { audioEngine } from './engine';
import { INITIAL_EFFECTS } from '../store/initialState';
import type { SynthParams } from '../types';

/* eslint-disable @typescript-eslint/no-explicit-any -- the engine exports no
   internals; tests deliberately reach private fields (ctx, buses,
   activeVoices) and the unexported constructor via casts. */
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
    targets: [] as { v: number; t: number; tc: number }[],
    setValueAtTime(v: number) {
      this.value = v;
    },
    cancelScheduledValues(t: number) {
      this.cancels.push(t);
    },
    exponentialRampToValueAtTime() {},
    setTargetAtTime(v: number, t: number, tc: number) {
      this.targets.push({ v, t, tc });
    },
  };
}

function fakeNode() {
  return {
    type: '',
    // Connections are recorded so a test can assert routing, not just levels:
    // a source wired past the filter still produces the right gain value.
    connectedTo: [] as unknown[],
    connect(target: unknown) {
      this.connectedTo.push(target);
    },
    disconnect() {
      this.connectedTo.length = 0;
    },
    start() {},
    stop() {},
    gain: fakeParam(),
    frequency: fakeParam(),
    detune: fakeParam(),
    Q: fakeParam(),
  };
}

// A buffer source stands in for the noise generator: `loop` and `buffer` are
// recorded so a test can prove the noise is looped (createNoiseNode's buffer is
// 2 s, shorter than a long pad release).
function fakeBufferSource() {
  return { ...fakeNode(), buffer: null as unknown, loop: false };
}

function fakeCtx() {
  const gains: ReturnType<typeof fakeNode>[] = [];
  const bufferSources: ReturnType<typeof fakeBufferSource>[] = [];
  return {
    currentTime: 10,
    // Deliberately tiny: createNoiseNode fills sampleRate * 2 samples with
    // Math.random(), and the real 44_100 would make every test that touches
    // noise fill 88_200 floats for no added coverage.
    sampleRate: 64,
    createOscillator: () => fakeNode(),
    createGain: () => {
      const g = fakeNode();
      gains.push(g);
      return g;
    },
    createBiquadFilter: () => fakeNode(),
    createBuffer: (_channels: number, length: number, sampleRate: number) => ({
      sampleRate,
      getChannelData: () => new Float32Array(length),
    }),
    createBufferSource: () => {
      const s = fakeBufferSource();
      bufferSources.push(s);
      return s;
    },
    resume: async () => {},
    _gains: gains,
    _bufferSources: bufferSources,
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

  test('a live param update reaches the sounding voice even when a later same-note hit replaced it in the dedup map', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // Chord pattern with a repeated note: the second hit is pre-scheduled, so
    // the dedup map points at it while the first hit is the one sounding now.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.3, 'chord');
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.5, 'chord');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.8, 'chord');

    // The first hit is sounding right now (t0 + 0.15 < its release at t0 + 0.3).
    ctx.currentTime = t0 + 0.15;
    engine.updateSynthParams({ ...SYNTH, oscType: 'sine' }, 'chord');

    const voices = Array.from(
      (engine as any).sourceVoices.get('chord') as Set<{ startTime: number; oscs: { type: string }[] }>,
    );
    const sounding = voices.filter((v) => v.startTime <= ctx.currentTime);
    expect(sounding.length).toBe(1);
    expect(sounding[0].oscs[0].type).toBe('sine');
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

describe('scheduled source stop (soft stop on a bar line)', () => {
  test('a future time anchors the release there, not at currentTime', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime; // 10

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.5, 'chord');

    // Schedule the stop a bar ahead, the way a soft stop does.
    const stopAt = t0 + 2;
    engine.stopSource('chord', 0.4, stopAt);

    const voices = Array.from(
      (engine as any).sourceVoices.get('chord') as Set<{
        releaseScheduledAt: number;
        gains: { gain: { cancels: number[] } }[];
      }>,
    );
    expect(voices).toHaveLength(1);
    expect(voices[0].releaseScheduledAt).toBe(stopAt);
    // releaseVoice cancels the envelope at the SAME anchor it ramps from.
    expect(voices[0].gains[0].gain.cancels).toContain(stopAt);
    expect(voices[0].gains[0].gain.cancels).not.toContain(t0);
  });

  test('omitting time keeps the existing immediate behaviour', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord');
    engine.stopSource('chord', 0.02);

    const voices = Array.from(
      (engine as any).sourceVoices.get('chord') as Set<{ releaseScheduledAt: number }>,
    );
    expect(voices[0].releaseScheduledAt).toBe(t0);
  });
});

describe('drum bus filter', () => {
  test('drum voices route through the drum bus filter instead of dryGain', () => {
    const { engine, ctx } = freshEngine();
    const filter = fakeNode();
    (engine as any).drumBusFilter = filter;

    // Record the connect TARGET of every gain node the drum synth creates:
    // connect is invoked on the source node, so the source is what we spy.
    const connectTargets: unknown[] = [];
    (ctx as any).createGain = () => {
      const g = fakeNode();
      (g.connect as unknown as (target: unknown) => void) = (n: unknown) => {
        connectTargets.push(n);
      };
      return g;
    };

    engine.triggerDrum('kick', 0.8, ctx.currentTime);
    engine.triggerDrum('tom', 0.8, ctx.currentTime);

    // kick = osc gain (+ click gain if the kit defines one); tom = 1 gain.
    expect(connectTargets.length >= 2).toBe(true);
    for (const target of connectTargets) expect(target).toBe(filter);
  });

  test('setDrumFilter applies cutoff, resonance and type with smoothing', () => {
    const { engine } = freshEngine();
    const freqTargets: number[] = [];
    const qTargets: number[] = [];
    const filter = fakeNode();
    filter.frequency.setTargetAtTime = (v: number) => {
      freqTargets.push(v);
    };
    filter.Q.setTargetAtTime = (v: number) => {
      qTargets.push(v);
    };
    (engine as any).drumBusFilter = filter;

    engine.setDrumFilter(400, 8, 'bandpass');

    expect(freqTargets).toContain(400);
    expect(qTargets).toContain(8);
    expect(filter.type).toBe('bandpass');
  });

  test('setDrumFilter before the drum bus filter exists is a safe no-op', () => {
    const { engine } = freshEngine();
    let threw = false;
    try {
      engine.setDrumFilter(400, 8, 'lowpass');
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  test('setDrumFilter before init stores the values for the chain built later', () => {
    const { engine } = freshEngine();
    engine.setDrumFilter(400, 8, 'highpass');
    expect((engine as any).drumFilterCutoff).toBe(400);
    expect((engine as any).drumFilterResonance).toBe(8);
    expect((engine as any).drumFilterType).toBe('highpass');
  });
});

describe('releaseSoundingVoices', () => {
  test('a voice the clock scheduled ahead keeps its envelope', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // The arpeggiator schedules the next note on a future 16th and pairs it
    // with its own note-off, so the voice already ends by itself.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0 + 0.5, 'synth');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.6, 'synth');

    // The key comes up before that note sounds.
    engine.releaseSoundingVoices('synth', 0.1);

    // Cancelling at t0 would wipe the scheduled attack and the note would
    // never be heard — only its own release at t0 + 0.6 may touch it.
    const scheduledVoiceGain = ctx._gains[0].gain;
    expect(scheduledVoiceGain.cancels).not.toContain(t0);
    expect(scheduledVoiceGain.cancels).toContain(t0 + 0.6);
  });

  test('a voice that is already sounding is released', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0, 'synth');
    engine.releaseSoundingVoices('synth', 0.1);

    const soundingVoiceGain = ctx._gains[0].gain;
    expect(soundingVoiceGain.cancels).toContain(t0);
  });

  test('a future voice with no release of its own is still released', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // No paired note-off: nothing would ever end this voice, so it must not
    // be skipped or it would drone forever.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0 + 0.5, 'synth');
    engine.releaseSoundingVoices('synth', 0.1);

    expect(ctx._gains[0].gain.cancels).toContain(t0);
  });

  test('voices of other sources are left alone', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0, 'synth');
    engine.releaseSoundingVoices('chord', 0.1);

    expect(ctx._gains[0].gain.cancels).not.toContain(t0);
  });

  test('stopSource still kills a scheduled voice, so pattern previews stop dead', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0 + 0.5, 'chord');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.6, 'chord');
    engine.stopSource('chord', 0.1);

    expect(ctx._gains[0].gain.cancels).toContain(t0);
  });
});

describe('master chain', () => {
  // Full-fidelity fake context for setupMasterChain: every node records its
  // connect() targets so the test can prove the exact wiring order.
  function masterChainCtx() {
    const mk = (type: string) => {
      const n = fakeNode();
      (n as any)._connectTargets = [] as unknown[];
      (n as any).connect = (target: unknown) => {
        (n as any)._connectTargets.push(target);
      };
      (n as any)._type = type;
      return n;
    };
    return {
      currentTime: 10,
      sampleRate: 44100,
      destination: {},
      createOscillator: () => mk('osc'),
      createGain: () => mk('gain'),
      createBiquadFilter: () => mk('biquad'),
      createDynamicsCompressor: () => {
        const n: any = mk('compressor');
        n.threshold = fakeParam();
        n.knee = fakeParam();
        n.ratio = fakeParam();
        n.attack = fakeParam();
        n.release = fakeParam();
        return n;
      },
      createAnalyser: () => mk('analyser'),
      createConvolver: () => mk('convolver'),
      createWaveShaper: () => mk('waveshaper'),
      createDelay: () => {
        const n: any = mk('delay');
        n.delayTime = fakeParam();
        return n;
      },
      createBuffer: () => ({
        length: 1024,
        getChannelData: () => new Float32Array(1024),
      }),
      resume: async () => {},
    };
  }

  test('stages masterGain at 0.6 and inserts a ratio-20 limiter between masterGain and the analyser', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    (engine as any).ctx = ctx;
    (engine as any).setupMasterChain();

    const masterGain = (engine as any).masterGain;
    const limiter = (engine as any).limiter;
    const analyser = (engine as any).analyser;
    const compressor = (engine as any).compressor;

    expect(masterGain.gain.value).toBe(0.6);
    expect(limiter).toBeDefined();
    if (!limiter) return;

    expect(limiter.threshold.value).toBe(-3);
    expect(limiter.ratio.value).toBe(20);
    expect(limiter.knee.value <= 6).toBe(true);
    expect(limiter.attack.value).toBeCloseTo(0.003, 6);
    expect(limiter.release.value <= 0.25).toBe(true);

    // Wiring: compressor → masterGain → limiter → analyser → destination.
    expect(masterGain._connectTargets).toEqual([limiter]);
    expect(limiter._connectTargets).toEqual([analyser]);
    expect(analyser._connectTargets).toEqual([ctx.destination]);
    expect(compressor._connectTargets).toEqual([masterGain]);
  });
});

describe('live polyphony equal-power scaling', () => {
  test('applySynthVelocityScale re-scales every live voice and skips released ones', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'synth');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.8, undefined, 'synth');
    engine.triggerSynthNoteOn('G4', SYNTH, 0.8, undefined, 'synth');
    engine.triggerSynthNoteOff('G4', SYNTH.release, undefined, 'synth');

    (engine as any).applySynthVelocityScale(0.5);

    const voices = (engine as any).activeVoices;
    const c4 = voices.get('synth:C4');
    const g4 = voices.get('synth:G4');
    const reScaledSustain = 0.8 * 0.4 * SYNTH.sustain * 0.5;

    expect(c4.envelopeScale).toBe(0.5);
    expect(c4.gains[0].gain.targets).toHaveLength(1);
    expect(c4.gains[0].gain.targets[0].v).toBeCloseTo(reScaledSustain, 5);
    expect(c4.gains[0].gain.targets[0].tc).toBe(0.01);
    expect(c4.gains[0].gain.cancels).toContain(t0);

    // The released voice keeps its own release ramp; no re-scale target.
    expect(g4.gains[0].gain.targets).toHaveLength(0);
  });

  test('a voice triggered with a scaleFactor re-scales relative to it', () => {
    const { engine } = freshEngine();

    engine.triggerSynthNoteOn('C4', SYNTH, 1.0, undefined, 'synth', 0.5);
    const c4 = (engine as any).activeVoices.get('synth:C4');
    expect(c4.envelopeScale).toBe(0.5);

    (engine as any).applySynthVelocityScale(0.25);
    expect(c4.gains[0].gain.targets).toHaveLength(1);
    expect(c4.gains[0].gain.targets[0].v).toBeCloseTo(
      1.0 * 0.4 * SYNTH.sustain * 0.25,
      5,
    );
  });

  test('a re-scale that matches the current scale leaves voices untouched', () => {
    const { engine } = freshEngine();

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'synth');
    (engine as any).applySynthVelocityScale(1);

    const c4 = (engine as any).activeVoices.get('synth:C4');
    expect(c4.gains[0].gain.targets).toHaveLength(0);
  });
});

describe('live effect knobs', () => {
  test('updateEffects rebuilds the convolver impulse only when reverbDecay changes', () => {
    const { engine } = freshEngine();
    // freshEngine leaves reverbNode unset; the guard block needs it present.
    (engine as any).reverbNode = fakeNode();

    // The fake ctx has no createBuffer/sampleRate, so the real impulse
    // builder would throw if called through — stub the spy (same pattern as
    // the applyEngineSnapshot test in store.test.ts).
    const buildSpy = spyOn(
      engine as unknown as { buildImpulseResponse: () => AudioBuffer },
      'buildImpulseResponse',
    ).mockImplementation(() => ({}) as AudioBuffer);

    engine.updateEffects({ ...INITIAL_EFFECTS, reverbDecay: 2.0 });
    expect(buildSpy).not.toHaveBeenCalled(); // default == the impulse built at setupMasterChain
    engine.updateEffects({ ...INITIAL_EFFECTS, reverbDecay: 4.5 });
    expect(buildSpy).toHaveBeenCalledWith(2.0, 4.5);
    engine.updateEffects({ ...INITIAL_EFFECTS, reverbDecay: 4.5 });
    expect(buildSpy).toHaveBeenCalledTimes(1); // unchanged decay -> no rebuild
  });

  test('updateEffects sets the compressor threshold from the effects value', () => {
    const { engine, ctx } = freshEngine();
    // fakeParam records setTargetAtTime targets, so assert the recorded target.
    const threshold = fakeParam();
    (engine as any).compressor = { threshold };

    engine.updateEffects({ ...INITIAL_EFFECTS, compressorThreshold: -20 });

    expect(threshold.targets).toEqual([{ v: -20, t: ctx.currentTime, tc: 0.05 }]);
  });
});

describe('noise source', () => {
  const NOISY: SynthParams = { ...SYNTH, noiseVolume: 0.25 };

  test('a preset with noiseVolume 0 creates no noise source at all', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth');

    expect(ctx._bufferSources).toHaveLength(0);
    const voice = (engine as any).activeVoices.get('synth:C4');
    expect(voice.noise).toBeUndefined();
    expect(voice.noiseGain).toBeUndefined();
  });

  test('a preset with noiseVolume > 0 gets a looped noise source at that level', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', NOISY, 0.8, ctx.currentTime, 'synth');

    expect(ctx._bufferSources).toHaveLength(1);
    // Without loop the noise would run out mid-note: the buffer is 2 s while
    // this preset's decay + release already exceed that.
    expect(ctx._bufferSources[0].loop).toBe(true);

    const voice = (engine as any).activeVoices.get('synth:C4');
    expect(voice.noiseGain.gain.value).toBe(0.25);
  });

  test('the noise level scales with noiseVolume rather than being a fixed amount', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, noiseVolume: 0.4 }, 0.8, ctx.currentTime, 'synth');
    engine.triggerSynthNoteOn('E4', { ...SYNTH, noiseVolume: 0.02 }, 0.8, ctx.currentTime, 'synth');

    const loud = (engine as any).activeVoices.get('synth:C4');
    const quiet = (engine as any).activeVoices.get('synth:E4');
    expect(loud.noiseGain.gain.value).toBe(0.4);
    expect(quiet.noiseGain.gain.value).toBe(0.02);
  });

  test('noise runs into the filter, not past it, so the VCF envelope shapes it', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', NOISY, 0.8, ctx.currentTime, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');

    // Noise is a third source alongside osc1/oscSub, so it belongs upstream of
    // the filter. Wired to the VCA instead it would still have the right level
    // but would ignore filterCutoff, filterEnvAmount and the filter envelope
    // entirely — a permanently open hiss layer on every noisy preset.
    expect(voice.noise.connectedTo).toEqual([voice.noiseGain]);
    expect(voice.noiseGain.connectedTo).toEqual([voice.filter]);
    expect(voice.oscs[0].connectedTo).toEqual([voice.filter]);
  });

  test('a noise source added live is wired into the filter too', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');

    engine.updateSynthParams({ ...SYNTH, noiseVolume: 0.3 }, 'synth');

    expect(voice.noiseGain.connectedTo).toEqual([voice.filter]);
  });

  test('gains[0] and gains[1] stay the main and sub gains when noise is present', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', NOISY, 0.8, ctx.currentTime, 'synth');

    // Positional: releaseVoice ramps gains[0] and updateSynthParams writes
    // subOscVolume into gains[1]. Creating the noise gain must not shift them.
    const voice = (engine as any).activeVoices.get('synth:C4');
    expect(voice.gains[0]).toBe(ctx._gains[0]);
    expect(voice.gains[1]).toBe(ctx._gains[1]);
    expect(voice.gains[1].gain.value).toBe(SYNTH.subOscVolume);
    expect(voice.noiseGain).not.toBe(voice.gains[0]);
    expect(voice.noiseGain).not.toBe(voice.gains[1]);
  });

  test('turning the noise knob up reaches a sounding voice that started silent', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');
    expect(voice.noise).toBeUndefined();

    engine.updateSynthParams({ ...SYNTH, noiseVolume: 0.3 }, 'synth');

    expect(voice.noise).toBeDefined();
    expect(voice.noise.loop).toBe(true);
    expect(voice.noiseGain.gain.targets.at(-1)?.v).toBe(0.3);
  });

  test('turning the noise knob down to zero silences it on a sounding voice', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', NOISY, 0.8, ctx.currentTime, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');

    engine.updateSynthParams({ ...NOISY, noiseVolume: 0 }, 'synth');

    expect(voice.noiseGain.gain.targets.at(-1)?.v).toBe(0);
  });

  test('releasing a noisy voice stops and disconnects its noise source', async () => {
    const { engine, ctx } = freshEngine();
    // Tiny filterRelease as well as a tiny release: the teardown timeout waits
    // max(releaseTime, filterRelease) + 0.1 s, and SYNTH's 0.5 s filter release
    // would outlast the test.
    engine.triggerSynthNoteOn('C4', { ...NOISY, filterRelease: 0.01 }, 0.8, ctx.currentTime, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');
    const stopped = spyOn(voice.noise, 'stop');
    const disconnected = spyOn(voice.noise, 'disconnect');

    engine.triggerSynthNoteOff('C4', 0.01, undefined, 'synth');
    await new Promise((r) => setTimeout(r, 200));

    // A looping buffer source that is never stopped keeps running forever.
    expect(stopped).toHaveBeenCalled();
    expect(disconnected).toHaveBeenCalled();
  });
});
