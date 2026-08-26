import { describe, expect, spyOn, test } from 'bun:test';
import { INITIAL_EFFECTS } from '../store/initialState';
import type { SynthParams } from '../types';
import { DRUM_ALIASES } from './engine';
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
  arpActive: false,
  arpMode: 'up',
  arpRate: '16n',
  arpOctaves: 1,
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
  test('stopSource releases the sounding hit and hard-silences future-scheduled pattern hits', () => {
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

    const chordVoicesBefore = Array.from(
      (engine as any).sourceVoices.get('chord') as Set<{ startTime: number; gains: { gain: { cancels: number[]; events: { v: number }[] } }[] }>,
    );
    expect(chordVoicesBefore).toHaveLength(3);
    const soundingVoice = chordVoicesBefore.find((v) => v.startTime <= t0)!;
    const futureVoices = chordVoicesBefore.filter((v) => v.startTime > t0);
    expect(futureVoices).toHaveLength(2);

    // Releasing the preview must cut the whole chord pattern immediately.
    engine.stopSource('chord', 0.15);

    // The sounding hit gets a normal release ramp, cancelled at now.
    expect(soundingVoice.gains[0].gain.cancels).toContain(t0);

    // A future hit's oscillators have not started: a release RAMP on it
    // finishes before they do, leaving the GainNode at its intrinsic 1.0 (the
    // ~3x-peak pop this task fixes). It is hard-silenced and torn out of
    // tracking instead, so it must not remain in sourceVoices.
    const chordVoicesAfter = (engine as any).sourceVoices.get('chord') as Set<unknown>;
    expect(chordVoicesAfter.size).toBe(1);
    expect(chordVoicesAfter.has(soundingVoice)).toBe(true);
    for (const v of futureVoices) {
      expect(chordVoicesAfter.has(v)).toBe(false);
      expect(v.gains[0].gain.cancels).toContain(t0);
      expect(v.gains[0].gain.events.at(-1)!.v).toBe(0);
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

  test('rebuilding the master chain drops impulses built against the dead context', () => {
    const engine = makeEngine();
    (engine as any).ctx = masterChainCtx();
    (engine as any).setupMasterChain();
    (engine as any).impulseCache.set(9.9, {} as AudioBuffer);

    (engine as any).ctx = masterChainCtx();
    (engine as any).setupMasterChain();

    // An AudioBuffer belongs to the context that created it; reusing one from
    // the previous context is the same class of bug sourceBuses.clear() prevents.
    expect((engine as any).impulseCache.has(9.9)).toBe(false);
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
  test('reverbDecay is the impulse DURATION, with the curve exponent fixed', () => {
    const { engine } = freshEngine();
    (engine as any).reverbNode = fakeNode();
    const buildSpy = spyOn(
      engine as unknown as { buildImpulseResponse: () => AudioBuffer },
      'buildImpulseResponse',
    ).mockImplementation(() => ({}) as AudioBuffer);

    engine.updateEffects({ ...INITIAL_EFFECTS, reverbDecay: 4.5 });

    // (durationSec, curveExponent) — the UI knob reads "4.5s", so 4.5 must be
    // the length of the tail, not the steepness of it.
    expect(buildSpy).toHaveBeenCalledWith(4.5, 2.0);
  });

  test('unchanged decay does not rebuild the impulse', () => {
    const { engine } = freshEngine();
    (engine as any).reverbNode = fakeNode();
    const buildSpy = spyOn(
      engine as unknown as { buildImpulseResponse: () => AudioBuffer },
      'buildImpulseResponse',
    ).mockImplementation(() => ({}) as AudioBuffer);

    engine.updateEffects({ ...INITIAL_EFFECTS, reverbDecay: 2.0 });
    expect(buildSpy).not.toHaveBeenCalled(); // equals the impulse setupMasterChain built
    engine.updateEffects({ ...INITIAL_EFFECTS, reverbDecay: 4.5 });
    // Asserting the args (not just the count) is what actually discriminates
    // the duration-vs-exponent fix: the pre-Task-4 engine would have called
    // this with (2.0, 4.5), which also passes a count-only assertion.
    expect(buildSpy).toHaveBeenCalledWith(4.5, 2.0);
    engine.updateEffects({ ...INITIAL_EFFECTS, reverbDecay: 4.5 });
    expect(buildSpy).toHaveBeenCalledTimes(1);
  });

  test('a knob drag quantises to 0.1 s and reuses cached impulses', () => {
    const { engine } = freshEngine();
    (engine as any).reverbNode = fakeNode();
    const buildSpy = spyOn(
      engine as unknown as { buildImpulseResponse: () => AudioBuffer },
      'buildImpulseResponse',
    ).mockImplementation(() => ({}) as AudioBuffer);

    // A real drag emits dozens of intermediate values. Quantising to the knob's
    // own 0.1 step collapses them; revisiting a value must hit the cache.
    for (const d of [3.0, 3.04, 3.02, 3.1, 3.14, 3.0, 3.1]) {
      engine.updateEffects({ ...INITIAL_EFFECTS, reverbDecay: d });
    }

    expect(buildSpy).toHaveBeenCalledTimes(2); // 3.0 and 3.1 only
    expect(buildSpy.mock.calls.map((c) => c[0])).toEqual([3.0, 3.1]);
  });

  test('an out-of-range decay is clamped before it becomes a buffer length', () => {
    const { engine } = freshEngine();
    (engine as any).reverbNode = fakeNode();
    const buildSpy = spyOn(
      engine as unknown as { buildImpulseResponse: () => AudioBuffer },
      'buildImpulseResponse',
    ).mockImplementation(() => ({}) as AudioBuffer);

    engine.updateEffects({ ...INITIAL_EFFECTS, reverbDecay: -5 });
    expect(buildSpy).toHaveBeenCalledWith(0.1, 2.0);
    engine.updateEffects({ ...INITIAL_EFFECTS, reverbDecay: 900 });
    expect(buildSpy).toHaveBeenLastCalledWith(10, 2.0);
  });

  test('the impulse cache evicts least-recently-used entries past its cap', () => {
    const { engine } = freshEngine();
    (engine as any).reverbNode = fakeNode();
    spyOn(
      engine as unknown as { buildImpulseResponse: () => AudioBuffer },
      'buildImpulseResponse',
    ).mockImplementation(() => ({}) as AudioBuffer);

    // Cap is 8: fill it exactly, then touch the oldest entry to refresh its
    // recency before pushing two more distinct decays past the cap.
    for (const d of [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7]) {
      engine.updateEffects({ ...INITIAL_EFFECTS, reverbDecay: d });
    }
    const cache = (engine as any).impulseCache as Map<number, AudioBuffer>;
    expect(cache.size).toBe(8);

    engine.updateEffects({ ...INITIAL_EFFECTS, reverbDecay: 1.0 }); // refresh recency
    engine.updateEffects({ ...INITIAL_EFFECTS, reverbDecay: 1.8 });
    engine.updateEffects({ ...INITIAL_EFFECTS, reverbDecay: 1.9 });

    expect(cache.size).toBe(8); // never exceeds the cap
    expect(cache.has(1.0)).toBe(true); // refreshed, survives eviction
    expect(cache.has(1.1)).toBe(false); // least-recently-used, evicted first
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

describe('envelope-safe rebalancing', () => {
  test('a velocity rebalance during the attack holds the real curve value, not the floor', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // Attack is 0.02 s; rebalance 0.01 s in, halfway up the ramp.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'synth');
    ctx.currentTime = t0 + 0.01;
    (engine as any).applySynthVelocityScale(0.5);

    const gain = (engine as any).activeVoices.get('synth:C4').gains[0].gain;
    const anchor = gain.events.find((e: any) => e.t === t0 + 0.01);
    expect(anchor).toBeTruthy();
    // cancelScheduledValues would revert to the 0.0001 note-on floor and the
    // rebalance would then glide up from silence: an audible click.
    expect(anchor.v).toBeGreaterThan(0.0001);
  });

  test('the rebalance shares the exact voice-selection helper updateSynthParams uses', () => {
    // Both call sites must agree on "is this voice live and re-shapeable?" —
    // updateSynthParams already iterates sourceVoices (not activeVoices) with a
    // comment explaining that a same-note retrigger evicts a still-sounding
    // voice from activeVoices; applySynthVelocityScale drifting to its own
    // selection logic (even one that happens to behave identically today,
    // since it also skips any voice with a scheduled release) is exactly how
    // the two silently diverge again the next time either one changes.
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'synth');

    expect(typeof (engine as any).reshapeableVoices).toBe('function');
    const spy = spyOn(engine as any, 'reshapeableVoices');
    (engine as any).applySynthVelocityScale(0.5);
    expect(spy).toHaveBeenCalled();
  });
});

describe('cancelAndHold fallback (Firefox)', () => {
  test('the fallback reads the value BEFORE the cancel reverts it', () => {
    const { engine, ctx } = freshEngine({ cancelAndHold: false });
    const param = fakeParam({ cancelAndHold: false });
    param.setValueAtTime(0.9, ctx.currentTime - 1);
    param.value = 0.9;

    // The shared fake's cancelScheduledValues only trims `events`; it does not
    // model the spec's live reversion of `.value` (no fake AudioParam getter
    // recomputes it from the automation curve). Wrapping it here — inside the
    // test, not the shared harness — reproduces that one effect so the test
    // actually depends on cancelAndHold's read-before-cancel ordering rather
    // than passing regardless of it.
    const cancelScheduledValues = param.cancelScheduledValues.bind(param);
    param.cancelScheduledValues = (t: number) => {
      cancelScheduledValues(t);
      param.value = 0.0001;
    };

    (engine as any).cancelAndHold(param, ctx.currentTime);

    // Reading param.value AFTER cancelling would anchor the hold at the
    // reverted 0.0001 instead of the real pre-cancel value.
    expect(param.events.at(-1)!.v).toBe(0.9);
  });
});

describe('envelope end markers', () => {
  test('a sub-millisecond attack marks the end of the CLAMPED ramp', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    // synthPresets ships attack: 0.002, below the 0.005 floor the ramp uses.
    const fast = { ...SYNTH, attack: 0.002, decay: 0.4, filterAttack: 0.002, filterDecay: 0.4 };

    engine.triggerSynthNoteOn('C4', fast, 0.8, t0, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');

    // The ramp ends at t0 + max(0.005, 0.002) + 0.4; a marker computed from the
    // raw 0.002 lands 3 ms early and sends releaseVoice down the wrong branch.
    expect(voice.ampEnvEndsAt).toBeCloseTo(t0 + 0.005 + 0.4, 9);
    expect(voice.filterEnvEndsAt).toBeCloseTo(t0 + 0.01 + 0.4, 9);
  });
});

describe('scheduled same-note dedup', () => {
  test('a scheduled repeat cuts the previous voice at the new note start, not at currentTime', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.1, 'synth');
    const first = (engine as any).activeVoices.get('synth:C4');
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.5, 'synth');

    // The bass path at engine.ts:394 forwards `time`; this one did not, so the
    // old voice was cut up to a full 100 ms lookahead before the new one began.
    expect(first.releaseScheduledAt).toBe(t0 + 0.5);
  });
});

describe('noise source initial level', () => {
  test('adding noise to a live voice starts from an explicit floor, not a denormal', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, noiseVolume: 0 }, 0.8, undefined, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');
    expect(voice.noiseGain).toBeUndefined();

    engine.updateSynthParams({ ...SYNTH, noiseVolume: 0.4 }, 'synth');

    expect(voice.noiseGain).toBeTruthy();
    // Number.MIN_VALUE (5e-324) is a denormal used only to slip past the
    // `level <= 0` guard; the initial level is now a named parameter.
    expect(voice.noiseGain.gain.value).toBe(0.0001);
    expect(voice.noiseGain.gain.targets.at(-1)!.v).toBe(0.4);
  });
});

describe('releasing a voice that has not started', () => {
  test('stopSource hard-silences a future voice instead of ramping it', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.1, 'chord');
    const voice = (engine as any).activeVoices.get('chord:C4');
    const vca = voice.gains[0].gain;
    // The note-on's own attack/decay ramps already sit in `ramps`; clear them
    // so the assertion below is about ramps stopSource itself schedules.
    vca.ramps.length = 0;

    engine.stopSource('chord', 0.1);

    // A release RAMP on a voice whose oscillators start at t0 + 0.1 finishes
    // before the note begins; the node then holds its last value and the hit
    // sounds at full level. Hard silence is the only correct treatment.
    expect(vca.events.at(-1)!.v).toBe(0);
    expect(vca.events.at(-1)!.t).toBe(t0);
    expect(vca.ramps).toHaveLength(0);
  });

  test('a future voice is torn down, not left tracked', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.1, 'chord');
    engine.stopSource('chord', 0.1);

    expect((engine as any).sourceVoices.get('chord').size).toBe(0);
    expect((engine as any).activeVoices.has('chord:C4')).toBe(false);
  });

  test('a sounding voice still gets its release ramp', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 - 1, 'chord');
    const vca = (engine as any).activeVoices.get('chord:C4').gains[0].gain;
    vca.ramps.length = 0;

    engine.stopSource('chord', 0.1);

    expect(vca.ramps.at(-1)).toEqual({ v: 0.00001, t: t0 + 0.1 });
  });

  test('releaseSoundingVoices hard-silences a future voice with no release of its own', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.1, 'synth');
    const vca = (engine as any).activeVoices.get('synth:C4').gains[0].gain;
    // The note-on's own attack/decay ramps already sit in `ramps`; clear them
    // so the assertion below is about ramps releaseSoundingVoices schedules.
    vca.ramps.length = 0;

    engine.releaseSoundingVoices('synth', 0.1);

    expect(vca.ramps).toHaveLength(0);
    expect(vca.events.at(-1)!.v).toBe(0);
  });

  test('releaseSoundingVoices still leaves a future voice that already has a release', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.1, 'synth');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.3, 'synth');
    const vca = (engine as any).activeVoices.get('synth:C4').gains[0].gain;
    const before = vca.events.length;

    engine.releaseSoundingVoices('synth', 0.1);

    expect(vca.events.length).toBe(before);
  });
});

describe('re-planning a pending release', () => {
  test('a bass mono-kill keeps its 0.05 s release when the patch says 2 s', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const pad = { ...SYNTH, release: 2 };

    engine.triggerSynthNoteOn('C2', pad, 0.8, t0 - 1, 'bass');
    const first = (engine as any).activeVoices.get('bass:C2');
    // The new bass note releases the old one with the mono-kill's 0.05 s.
    engine.triggerSynthNoteOn('E2', pad, 0.8, t0 + 1, 'bass');
    expect(first.releaseTime).toBe(0.05);

    first.gains[0].gain.ramps.length = 0;
    engine.updateSynthParams(pad, 'bass');

    // Re-arming from params.release would stretch the kill to 2 s and let the
    // "stopped" note ring under the new one — bass monophony leaks.
    const ramp = first.gains[0].gain.ramps.at(-1);
    expect(ramp).toBeTruthy();
    expect(ramp!.t).toBeCloseTo(t0 + 1 + 0.05, 9);
  });

  test('a note released with the patch release re-arms with the NEW patch release', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 4, 'chord');
    const vca = (engine as any).activeVoices.get('chord:C4').gains[0].gain;
    vca.ramps.length = 0;

    engine.updateSynthParams({ ...SYNTH, release: 2 }, 'chord');

    // The pre-existing behaviour (engine.test.ts:275) must survive: a note-off
    // taken from params.release tracks the knob.
    expect(vca.ramps.at(-1)).toEqual({ v: 0.00001, t: t0 + 4 + 2 });
  });
});

describe('LFO routing', () => {
  const TREM: SynthParams = { ...SYNTH, lfoDepth: 0.4, lfoRate: 5, lfoTarget: 'volume' };

  test('a volume LFO modulates a SERIES gain, never the VCA param itself', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', TREM, 0.8, undefined, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');

    // Connecting the LFO to gainNode.gain SUMS with the envelope: the release
    // ramp never reaches silence and the sum inverts phase on the downswing.
    expect(voice.lfoGain.connectedTo).not.toContain(voice.gains[0].gain);
    expect(voice.lfoGain.connectedTo).toContain(voice.tremoloGain.gain);
  });

  test('the tremolo gain sits between the VCA and the source bus', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', TREM, 0.8, undefined, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');
    const bus = (engine as any).sourceBuses.get('synth');

    expect(voice.gains[0].connectedTo).toEqual([voice.tremoloGain]);
    expect(voice.tremoloGain.connectedTo).toContain(bus);
    // Unity so the envelope passes through untouched when depth is 0.
    expect(voice.tremoloGain.gain.value).toBe(1);
  });

  test('a voice with no LFO still routes through the tremolo gain', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');

    // Always present, so switching a live voice onto tremolo is a reconnect of
    // the LFO alone and never a rewire of the voice's own output.
    expect(voice.tremoloGain).toBeTruthy();
    expect(voice.tremoloGain.gain.value).toBe(1);
  });

  test('cutoff and pitch targets are unchanged', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, lfoDepth: 0.5, lfoTarget: 'cutoff' }, 0.8, undefined, 'synth');
    const cut = (engine as any).activeVoices.get('synth:C4');
    expect(cut.lfoGain.connectedTo).toContain(cut.filter.frequency);
    expect(cut.lfoGain.gain.value).toBeCloseTo(0.5 * 1500, 9);

    engine.triggerSynthNoteOn('E4', { ...SYNTH, lfoDepth: 0.5, lfoTarget: 'pitch' }, 0.8, undefined, 'synth');
    const pit = (engine as any).activeVoices.get('synth:E4');
    expect(pit.lfoGain.connectedTo).toContain(pit.oscs[0].detune);
    expect(pit.lfoGain.gain.value).toBeCloseTo(0.5 * 50, 9);
  });

  test('switching a live voice from cutoff to volume moves the LFO to the tremolo gain', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, lfoDepth: 0.5, lfoTarget: 'cutoff' }, 0.8, undefined, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');
    expect(voice.lfoGain.gain.value).toBeCloseTo(0.5 * 1500, 9);

    engine.updateSynthParams({ ...SYNTH, lfoDepth: 0.5, lfoTarget: 'volume' }, 'synth');

    expect(voice.lfoTarget).toBe('volume');
    expect(voice.lfoGain.connectedTo).toEqual([voice.tremoloGain.gain]);
    // Pinned at the moment of the switch, not after a settle: a
    // setTargetAtTime glide here would modulate tremoloGain.gain by the
    // STALE cutoff scale (750) for ~5 time constants — a gain blast and
    // exactly the phase inversion this task exists to remove.
    expect(voice.lfoGain.gain.value).toBeCloseTo(0.5 * 0.2, 9);
  });

  test('switching a live voice from pitch to volume also lands at the tremolo scale instantly', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, lfoDepth: 0.5, lfoTarget: 'pitch' }, 0.8, undefined, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');
    expect(voice.lfoGain.gain.value).toBeCloseTo(0.5 * 50, 9);

    engine.updateSynthParams({ ...SYNTH, lfoDepth: 0.5, lfoTarget: 'volume' }, 'synth');

    expect(voice.lfoTarget).toBe('volume');
    expect(voice.lfoGain.connectedTo).toEqual([voice.tremoloGain.gain]);
    expect(voice.lfoGain.gain.value).toBeCloseTo(0.5 * 0.2, 9);
  });

  test('a depth change with the target UNCHANGED still glides, not jumps', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, lfoDepth: 0.5, lfoTarget: 'cutoff' }, 0.8, undefined, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');

    engine.updateSynthParams({ ...SYNTH, lfoDepth: 0.2, lfoTarget: 'cutoff' }, 'synth');

    // Same target: an instant jump here would click, so this path must keep
    // using setTargetAtTime rather than connectLfoTo's instant setValueAtTime.
    expect(voice.lfoGain.gain.targets.at(-1)!.v).toBeCloseTo(0.2 * 1500, 9);
  });

  test('depth above 1 still clamps the tremolo scale so the trough stays positive', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, lfoDepth: 3, lfoTarget: 'volume' }, 0.8, undefined, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');

    // Math.min(1, params.lfoDepth) clamps the MULTIPLIER to 1 before scaling
    // by 0.2, so a depth of 3 (or any out-of-range value > 1) still yields
    // exactly 0.2 — never more. That keeps the tremolo gain's trough at
    // 1 - 0.2 = 0.8, always positive, however large the depth gets.
    expect(voice.lfoGain.gain.value).toBe(0.2);
  });

  test('an LFO added to a live voice that started without one is wired, not dropped', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'synth'); // lfoDepth 0
    const voice = (engine as any).activeVoices.get('synth:C4');
    expect(voice.lfo).toBeUndefined();

    engine.updateSynthParams({ ...SYNTH, lfoDepth: 0.3, lfoTarget: 'volume' }, 'synth');

    expect(voice.lfo).toBeTruthy();
    expect(voice.lfoGain.connectedTo).toContain(voice.tremoloGain.gain);
  });
});

describe('LFO teardown at depth zero', () => {
  test('dropping depth to zero stops and disconnects the oscillator', async () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, lfoDepth: 0.5, lfoTarget: 'cutoff' }, 0.8, undefined, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');
    const lfo = voice.lfo;
    const lfoGain = voice.lfoGain;
    expect(lfo).toBeTruthy();

    engine.updateSynthParams({ ...SYNTH, lfoDepth: 0 }, 'synth');

    // setTargetAtTime is asymptotic and never reaches exactly 0, so the node
    // must actually be removed once the ramp is inaudible (~5 time constants).
    expect(lfoGain.gain.targets.at(-1)!.v).toBe(0);
    await new Promise((r) => setTimeout(r, 220));
    expect(voice.lfo).toBeUndefined();
    expect(voice.lfoGain).toBeUndefined();
    expect(lfoGain.connectedTo).toHaveLength(0);
  });

  test('depth back up before the teardown lands keeps the same oscillator', async () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, lfoDepth: 0.5, lfoTarget: 'cutoff' }, 0.8, undefined, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');
    const lfo = voice.lfo;

    engine.updateSynthParams({ ...SYNTH, lfoDepth: 0 }, 'synth');
    engine.updateSynthParams({ ...SYNTH, lfoDepth: 0.5, lfoTarget: 'cutoff' }, 'synth');
    await new Promise((r) => setTimeout(r, 220));

    expect(voice.lfo).toBe(lfo);
  });
});

describe('drum reverb sends', () => {
  function drumEngine() {
    const { engine, ctx } = freshEngine();
    const reverbNode = fakeNode();
    (engine as any).reverbNode = reverbNode;
    return { engine, ctx, reverbNode, sendFilter: (engine as any).drumSendFilter };
  }

  test('the kit reverbSend is a real level, not a boolean', () => {
    const { engine, ctx } = drumEngine();
    engine.setDrumKit({ snare: { ...(engine as any).drumKit.snare, reverbSend: 0.15 } });
    const before = ctx._gains.length;

    engine.triggerDrum('snare', 1.0);

    // drumKits authors 0.15..0.5 across kits; sending at full voice level makes
    // that 3.3x spread inaudible.
    const sends = ctx._gains.slice(before).filter((g) => g.gain.value === 0.15);
    expect(sends).toHaveLength(1);
  });

  test('sends are filtered: they feed drumSendFilter, never the convolver directly', () => {
    const { engine, ctx, reverbNode, sendFilter } = drumEngine();
    const before = ctx._gains.length;

    engine.triggerDrum('clap', 1.0);

    const created = ctx._gains.slice(before);
    expect(created.some((g) => g.connectedTo.includes(sendFilter))).toBe(true);
    expect(created.some((g) => g.connectedTo.includes(reverbNode))).toBe(false);
  });

  test('a kit with reverbSend 0 creates no send node at all', () => {
    const { engine, ctx } = drumEngine();
    engine.setDrumKit({ clap: { ...(engine as any).drumKit.clap, reverbSend: 0 } });
    const before = ctx._gains.length;

    engine.triggerDrum('clap', 1.0);

    expect(ctx._gains.slice(before)).toHaveLength(1); // the envelope only
  });

  test('setDrumFilter keeps the send filter in lockstep with the drum bus filter', () => {
    const { engine } = drumEngine();
    engine.setDrumFilter(800, 4, 'highpass');

    const bus = (engine as any).drumBusFilter;
    const send = (engine as any).drumSendFilter;
    expect(send.frequency.targets.at(-1)).toEqual(bus.frequency.targets.at(-1));
    expect(send.Q.targets.at(-1)).toEqual(bus.Q.targets.at(-1));
    expect(send.type).toBe('highpass');
  });
});

describe('drum voice details', () => {
  test('every drum envelope floors at the same 0.0001', () => {
    const { engine, ctx } = freshEngine();
    for (const type of ['kick', 'snare', 'hihat', 'openhat', 'clap', 'tom', 'crash']) {
      const before = ctx._gains.length;
      engine.triggerDrum(type, 1.0);
      for (const g of ctx._gains.slice(before)) {
        for (const ramp of g.gain.ramps) expect(ramp.v).toBe(0.0001);
      }
    }
  });

  test('the clap ghost burst scales with velocity', () => {
    const { engine, ctx } = freshEngine();
    const gain = (engine as any).drumKit.clap.gain;

    let before = ctx._gains.length;
    engine.triggerDrum('clap', 1.0);
    const loud = ctx._gains[before].gain.events.map((e: any) => e.v);

    before = ctx._gains.length;
    engine.triggerDrum('clap', 0.2);
    const soft = ctx._gains[before].gain.events.map((e: any) => e.v);

    // Every scheduled level must scale with velocity; the ghost used to be a
    // hardcoded 0.1, which at velocity 0.2 is LOUDER than the hit itself.
    expect(loud[0]).toBeCloseTo(1.0 * gain, 9);
    expect(soft[0]).toBeCloseTo(0.2 * gain, 9);
    for (let i = 0; i < soft.length - 1; i++) {
      expect(soft[i]).toBeLessThan(loud[i]);
    }
  });

  test('the open hat does not tap the delay', () => {
    const { engine, ctx } = freshEngine();
    const delayNode = fakeNode();
    (engine as any).delayNode = delayNode;
    const before = ctx._gains.length;

    engine.triggerDrum('openhat', 1.0);

    // Drums bypass delay and distortion entirely (dsp-audio SKILL.md).
    for (const g of ctx._gains.slice(before)) {
      expect(g.connectedTo).not.toContain(delayNode);
    }
  });

  test('drum noise is looped and starts at a random offset', () => {
    const { engine, ctx } = freshEngine();
    const offsets: number[] = [];
    const before = ctx._bufferSources.length;
    for (let i = 0; i < 8; i++) engine.triggerDrum('hihat', 1.0);

    for (const src of ctx._bufferSources.slice(before)) {
      expect(src.loop).toBe(true);
      offsets.push((src as any)._startArgs?.[1] ?? 0);
    }
    // Identical offsets mean every hat reads the same bytes of the one shared
    // buffer, so simultaneous hits sum coherently (+6 dB instead of +3).
    expect(new Set(offsets).size).toBeGreaterThan(1);
  });

  test('velocity is clamped to 0..1', () => {
    const { engine, ctx } = freshEngine();
    const gain = (engine as any).drumKit.kick.gain;

    let before = ctx._gains.length;
    engine.triggerDrum('kick', 5);
    expect(ctx._gains[before].gain.events[0].v).toBeCloseTo(gain, 9);

    before = ctx._gains.length;
    engine.triggerDrum('kick', -2);
    expect(ctx._gains[before].gain.events[0].v).toBe(0.0001);
  });
});

describe('drum aliases and unknown types', () => {
  test('closedhat, lowtom and ride resolve to their canonical voices', () => {
    const { engine, ctx } = freshEngine();
    const counts: Record<string, number> = {};
    for (const type of ['hihat', 'closedhat', 'tom', 'lowtom', 'crash', 'ride']) {
      const before = ctx._gains.length;
      engine.triggerDrum(type, 1.0);
      counts[type] = ctx._gains.length - before;
    }
    expect(counts.closedhat).toBe(counts.hihat);
    expect(counts.lowtom).toBe(counts.tom);
    expect(counts.ride).toBe(counts.crash);
  });

  test('the type is case-insensitive', () => {
    const { engine, ctx } = freshEngine();
    const before = ctx._gains.length;
    engine.triggerDrum('KICK', 1.0);
    expect(ctx._gains.length).toBeGreaterThan(before);
  });

  test('an unknown type is a silent no-op, not a throw', () => {
    const { engine, ctx } = freshEngine();
    const before = ctx._gains.length;
    expect(() => engine.triggerDrum('cowbell', 1.0)).not.toThrow();
    expect(ctx._gains.length).toBe(before);
  });

  test('every DRUM_ALIASES target is a real drum type', () => {
    const { engine, ctx } = freshEngine();
    for (const target of Object.values(DRUM_ALIASES)) {
      const before = ctx._gains.length;
      engine.triggerDrum(target, 1.0);
      expect(ctx._gains.length).toBeGreaterThan(before);
    }
  });
});
