import { describe, expect, spyOn, test } from 'bun:test';
import { INITIAL_EFFECTS } from '../store/initialState';
import type { SynthParams } from '../types';
import { fakeNode, fakeParam, freshEngine, makeEngine } from './testFakes';

/* eslint-disable @typescript-eslint/no-explicit-any -- tests deliberately
   reach private fields (ctx, buses, activeVoices) via casts. */

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
});

describe('pending release re-arming', () => {
  // A sustained chord is one long voice whose note-off sits seconds ahead on
  // the audio clock. Its release ramp is planned at note-on time, so turning
  // the Release knob mid-chord only reaches it if the pending ramp is re-armed.
  test('re-arms a release ramp that has not started with the new release time', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 4, 'chord');

    const vca = ctx._gains[0].gain;
    vca.ramps.length = 0;

    engine.updateSynthParams({ ...SYNTH, release: 2 }, 'chord');

    expect(vca.ramps.at(-1)).toEqual({ v: 0.00001, t: t0 + 4 + 2 });
  });

  test('restores the filter release ramp a live timbre update would otherwise cancel', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 4, 'chord');

    const voice = (engine as any).activeVoices.get('chord:C4');
    voice.filter.frequency.ramps.length = 0;

    engine.updateSynthParams({ ...SYNTH, filterCutoff: 800 }, 'chord');

    // cancelAndHold at currentTime wipes the planned filter release; the
    // re-arm puts it back, now targeting the newly set cutoff.
    expect(voice.filter.frequency.ramps.at(-1)).toEqual({
      v: 800,
      t: t0 + 4 + SYNTH.filterRelease,
    });
  });

  test('leaves a release that has already started alone', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 - 2, 'chord');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 - 1, 'chord');

    const vca = ctx._gains[0].gain;
    vca.ramps.length = 0;

    engine.updateSynthParams({ ...SYNTH, release: 2 }, 'chord');

    // Re-targeting a fade already in flight would make it jump.
    expect(vca.ramps).toEqual([]);
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

  test('seeds masterGain at unity and inserts a ratio-20 limiter between masterGain and the analyser', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    (engine as any).ctx = ctx;
    (engine as any).setupMasterChain();

    const masterGain = (engine as any).masterGain;
    const limiter = (engine as any).limiter;
    const analyser = (engine as any).analyser;
    const compressor = (engine as any).compressor;

    // masterGain is the user's master trim and nothing else: engineSync pushes
    // masterVolume with fireImmediately, so any "staging" value seeded here is
    // overwritten before the first frame. The -3 dB limiter is the real ceiling.
    expect(masterGain.gain.value).toBe(1);
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

  test('updateEffects clamps every numeric field before it reaches an AudioParam', () => {
    const { engine, ctx } = freshEngine();
    const delayFeedbackGain = fakeNode();
    const delayGain = fakeNode();
    const reverbGain = fakeNode();
    const eqLowNode = fakeNode();
    (engine as any).delayFeedbackGain = delayFeedbackGain;
    (engine as any).delayGain = delayGain;
    (engine as any).reverbGain = reverbGain;
    (engine as any).eqLowNode = eqLowNode;

    engine.updateEffects({
      ...INITIAL_EFFECTS,
      // A persisted or imported project can carry anything.
      delayFeedback: 1.4,   // >= 1 is a runaway feedback loop
      reverbWet: 12,
      delayWet: -3,
      eqLow: 400,
    });

    expect(delayFeedbackGain.gain.targets.at(-1)!.v).toBe(0.95);
    expect(reverbGain.gain.targets.at(-1)!.v).toBe(1);
    expect(delayGain.gain.targets.at(-1)!.v).toBe(0);
    expect(eqLowNode.gain.targets.at(-1)!.v).toBe(24);
    expect(ctx.currentTime).toBe(10);
  });

  test('a non-finite persisted value falls back instead of writing NaN to a param', () => {
    const { engine } = freshEngine();
    const reverbGain = fakeNode();
    (engine as any).reverbGain = reverbGain;

    engine.updateEffects({ ...INITIAL_EFFECTS, reverbWet: Number.NaN });

    expect(Number.isFinite(reverbGain.gain.targets.at(-1)!.v)).toBe(true);
    expect(reverbGain.gain.targets.at(-1)!.v).toBe(0.25);
  });

  test('bypass still wins over the clamped value', () => {
    const { engine } = freshEngine();
    const reverbGain = fakeNode();
    (engine as any).reverbGain = reverbGain;

    engine.updateEffects({ ...INITIAL_EFFECTS, reverbWet: 12, reverbBypass: true });

    expect(reverbGain.gain.targets.at(-1)!.v).toBe(0);
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

describe('release discontinuity', () => {
  // A 16th at 120 bpm rings for 0.125 s, well inside SYNTH's 0.4 s decay — so
  // when the release starts, the envelope has NOT reached its sustain level
  // yet. Every chord and bass pattern hit is scheduled this way, which makes
  // this the app's most common note-off by far.
  const HELD = 0.125;

  /**
   * How far the curve jumps across `t`, as a ratio >= 1. Exactly 1 means the
   * automation is continuous there; anything above it is a step the DAC has to
   * render in a single sample.
   */
  function stepRatio(param: { valueAt(t: number): number }, t: number): number {
    const before = param.valueAt(t - 1e-6);
    const after = param.valueAt(t + 1e-6);
    return Math.max(after / before, before / after);
  }

  test('a pre-scheduled amp release starts from the level the envelope actually has', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const releaseAt = t0 + HELD;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord');
    engine.triggerSynthNoteOff('C4', SYNTH.release, releaseAt, 'chord');

    // A step here is a click: the amp jumps in a single sample.
    expect(stepRatio(ctx._gains[0].gain, releaseAt)).toBeLessThan(1.02);
  });

  test('a pre-scheduled filter release starts from the cutoff the envelope actually has', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const releaseAt = t0 + HELD;

    // filterEnvAmount 1200 over a 0.4 s filter decay: the cutoff is still
    // falling from its 3600 Hz peak when the release begins.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord');
    engine.triggerSynthNoteOff('C4', SYNTH.release, releaseAt, 'chord');

    const voice = (engine as any).activeVoices.get('chord:C4');
    expect(stepRatio(voice.filter.frequency, releaseAt)).toBeLessThan(1.02);
  });

  // Regression: a full-bar Sustained chord. Its note-off sits SECONDS past the
  // end of the decay, so cancelAndHoldAtTime has nothing to cancel and leaves
  // no anchor — the release ramp then starts back at the decay's end and fades
  // the chord out across its whole length instead of holding it.
  test('a release scheduled past the decay holds the sustain level until it starts', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const HELD_CHORD: SynthParams = { ...SYNTH, attack: 0.005, decay: 0.01, sustain: 1, release: 0.01 };
    const peak = 0.8 * 0.4;

    engine.triggerSynthNoteOn('C4', HELD_CHORD, 0.8, t0, 'chord');
    engine.triggerSynthNoteOff('C4', HELD_CHORD.release, t0 + 2.7, 'chord');

    const vca = ctx._gains[0].gain;
    expect(vca.valueAt(t0 + 0.5)).toBeCloseTo(peak, 4);
    expect(vca.valueAt(t0 + 2.6)).toBeCloseTo(peak, 4);
    expect(vca.valueAt(t0 + 2.72)).toBeLessThan(0.001);
  });

  test('an immediate release is continuous too', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // Note-off with no time: the release starts at currentTime, mid-attack.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord');
    engine.triggerSynthNoteOff('C4', SYNTH.release, undefined, 'chord');

    expect(stepRatio(ctx._gains[0].gain, t0)).toBeLessThan(1.02);
  });
});

describe('release without cancelAndHoldAtTime (Firefox)', () => {
  // Firefox implements no cancelAndHoldAtTime, so the engine falls back to
  // naming a start value. These pin the fallback estimates, which are the
  // pre-fix behaviour: the fix must not make this path worse than it was.
  test('a release scheduled ahead falls back to the stored sustain level', () => {
    const { engine, ctx } = freshEngine({ cancelAndHold: false });
    const t0 = ctx.currentTime;
    const releaseAt = t0 + 0.125;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord');
    engine.triggerSynthNoteOff('C4', SYNTH.release, releaseAt, 'chord');

    // gain.value reports the value at currentTime — still the 0.0001 envelope
    // floor — so reading it here would cut the note dead instead of fading it.
    const vca = ctx._gains[0].gain;
    expect(vca.valueAt(releaseAt)).toBeCloseTo(0.8 * 0.4 * SYNTH.sustain, 5);
  });

  test('a release inside the envelope falls back to the live value', () => {
    const { engine, ctx } = freshEngine({ cancelAndHold: false });
    const t0 = ctx.currentTime;

    // Released 0.1 s in, while the 0.42 s attack+decay is still running: the
    // exact value is unknowable without cancelAndHoldAtTime, so `.value` is
    // the best estimate available.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 - 0.1, 'chord');
    const vca = ctx._gains[0].gain;
    vca.value = 0.05;

    engine.triggerSynthNoteOff('C4', SYNTH.release, undefined, 'chord');

    expect(vca.valueAt(t0)).toBeCloseTo(0.05, 5);
  });

  test('a release past the decay anchors at the exact sustain level, browser or not', () => {
    const { engine, ctx } = freshEngine({ cancelAndHold: false });
    const t0 = ctx.currentTime;

    // Past attack+decay the value IS the sustain level, so no estimate is
    // needed and Firefox gets the same exact anchor as everyone else.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 - 1, 'chord');
    const vca = ctx._gains[0].gain;
    vca.value = 0.05;

    engine.triggerSynthNoteOff('C4', SYNTH.release, undefined, 'chord');

    expect(vca.valueAt(t0)).toBeCloseTo(0.8 * 0.4 * SYNTH.sustain, 5);
  });

  test('the filter release falls back to the live cutoff', () => {
    const { engine, ctx } = freshEngine({ cancelAndHold: false });
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord');
    const voice = (engine as any).activeVoices.get('chord:C4');
    voice.filter.frequency.value = 3000;

    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.125, 'chord');

    expect(voice.filter.frequency.valueAt(t0 + 0.125)).toBeCloseTo(3000, 5);
  });
});

describe('live Sustain', () => {
  // A held pad is the case where this matters: the note rings for bars, so
  // "next note" is seconds away and the knob reads as dead.
  const PAD: SynthParams = { ...SYNTH, attack: 0.01, decay: 0.05, sustain: 0.5, release: 1.2 };
  const peak = 0.8 * 0.4;

  test('turning Sustain up lifts a note that is already ringing', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    engine.triggerSynthNoteOn('C4', PAD, 0.8, t0, 'chord');
    engine.triggerSynthNoteOff('C4', PAD.release, t0 + 4, 'chord');

    const vca = ctx._gains[0].gain;
    engine.updateSynthParams({ ...PAD, sustain: 1 }, 'chord');

    expect(vca.targets.at(-1)?.v).toBeCloseTo(peak, 5);
  });

  test('turning Sustain down lowers it, and the stored level follows', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    engine.triggerSynthNoteOn('C4', PAD, 0.8, t0, 'chord');
    engine.triggerSynthNoteOff('C4', PAD.release, t0 + 4, 'chord');

    const vca = ctx._gains[0].gain;
    engine.updateSynthParams({ ...PAD, sustain: 0.25 }, 'chord');

    expect(vca.targets.at(-1)?.v).toBeCloseTo(peak * 0.25, 5);
    // releaseVoice reads sustainLevel for its fallback, and
    // applySynthVelocityScale rebalances against it.
    const voice = (engine as any).activeVoices.get('chord:C4');
    expect(voice.sustainLevel).toBeCloseTo(peak * 0.25, 5);
  });

  test('a param change that leaves Sustain alone never touches the amp', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    engine.triggerSynthNoteOn('C4', PAD, 0.8, t0, 'chord');
    engine.triggerSynthNoteOff('C4', PAD.release, t0 + 4, 'chord');

    const vca = ctx._gains[0].gain;
    engine.updateSynthParams({ ...PAD, filterCutoff: 800 }, 'chord');

    // Gliding the amp on every cutoff tweak would cut short the attack of a
    // percussive stab.
    expect(vca.targets).toEqual([]);
  });

  test('an equal-power velocity rebalance survives a later param change', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    // A held key, so applySynthVelocityScale's equal-power rebalance applies
    // (it skips voices with a planned release).
    engine.triggerSynthNoteOn('C4', PAD, 0.8, t0, 'synth');
    engine.applySynthVelocityScale(0.5);

    const voice = (engine as any).activeVoices.get('synth:C4');
    const rebalanced = voice.sustainLevel;
    engine.updateSynthParams(PAD, 'synth');

    // Recomputing sustain from an unscaled peak would undo the rebalance and
    // make every held note jump back to full level on any knob move.
    expect(voice.sustainLevel).toBeCloseTo(rebalanced, 6);
  });

  test('a voice already fading keeps its release', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    engine.triggerSynthNoteOn('C4', PAD, 0.8, t0 - 2, 'chord');
    engine.triggerSynthNoteOff('C4', PAD.release, t0 - 1, 'chord');

    const vca = ctx._gains[0].gain;
    engine.updateSynthParams({ ...PAD, sustain: 1 }, 'chord');

    expect(vca.targets).toEqual([]);
  });
});
