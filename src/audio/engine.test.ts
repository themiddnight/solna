import { describe, expect, spyOn, test } from 'bun:test';
import { INITIAL_EFFECTS } from '../store/initialState';
import type { SynthParams } from '../types';
import { DRUM_ALIASES } from './engine';
import { DEFAULT_DRUM_KIT } from './drumKits';
import { fakeNode, fakeParam, freshEngine, makeEngine } from './testFakes';

/* eslint-disable @typescript-eslint/no-explicit-any -- tests deliberately
   reach private fields (ctx, buses, activeVoices) via casts. */

// Full-fidelity fake context for setupMasterChain: every node records its
// connect() targets so a test can prove the exact wiring order.
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

  // peakGain is velocity * 0.4 * scaleFactor; sustainLevel is that times the
  // patch's Sustain. Written out rather than imported because the point of
  // these two tests is that the gain must never be RE-ANCHORED at this value.
  const PEAK_GAIN = 0.8 * 0.4;
  const SUSTAIN_LEVEL = PEAK_GAIN * SYNTH.sustain;

  test('a second release on an already-fading voice never lifts its gain back to sustain', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // attack 0.02 + decay 0.4, so the amp envelope is past sustain by t0 + 0.42
    // and every release below takes releaseVoice's "past the envelope" branch.
    engine.triggerSynthNoteOn('C2', SYNTH, 0.8, t0, 'bass');
    const gain = ctx._gains[0].gain;

    engine.triggerSynthNoteOff('C2', 0.05, t0 + 1, 'bass');
    expect(gain.valueAt(t0 + 1.05)).toBeLessThan(1e-4);

    // The voice stays tracked until its teardown timer fires, so a later kill
    // still finds it — by then it has faded to SILENCE. Anchoring it at
    // sustainLevel there jumps the gain from silence to full in ONE sample:
    // a click on every note, loudest with Sustain at max. The in-flight (here,
    // finished) release ramp is what the second release must hold instead.
    engine.triggerSynthNoteOff('C2', 0.05, t0 + 2, 'bass');
    expect(gain.valueAt(t0 + 2)).toBeLessThan(1e-4);
    for (const e of gain.events.filter((ev) => ev.t >= t0 + 2)) {
      expect(e.v).toBeLessThan(SUSTAIN_LEVEL);
    }
  });

  test('a new bass note re-kills only the bass voices that are not already fading', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const bassVoices = () =>
      Array.from((engine as any).sourceVoices.get('bass') as Set<any>);

    // C2 is released and left to fade; E2 is held with its note-off still
    // ahead on the clock.
    engine.triggerSynthNoteOn('C2', SYNTH, 0.8, t0, 'bass');
    engine.triggerSynthNoteOff('C2', 0.05, t0 + 0.5, 'bass');
    engine.triggerSynthNoteOn('E2', SYNTH, 0.8, t0 + 1, 'bass');
    engine.triggerSynthNoteOff('E2', SYNTH.release, t0 + 5, 'bass');

    const c2 = bassVoices().find((v) => v.noteName === 'C2');
    const e2 = bassVoices().find((v) => v.noteName === 'E2');

    engine.triggerSynthNoteOn('G2', SYNTH, 0.8, t0 + 2, 'bass');

    // C2's release has already STARTED: killing it again would only reset its
    // teardown timer and re-run its ramps.
    expect(c2.gains[0].gain.cancels).not.toContain(t0 + 2);
    // E2's release is still AHEAD of the new note, so monophony needs it cut
    // short there — otherwise a long scheduled note rings under the new one.
    expect(e2.gains[0].gain.cancels).toContain(t0 + 2);
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

  test('drumBusFilter and drumSendFilter start in lockstep', () => {
    // Only the LIVE setDrumFilter path had a test; this pins the initial
    // parity too, since the two nodes are six hand-written assignments with
    // no shared construction helper.
    const engine = makeEngine();
    (engine as any).ctx = masterChainCtx();
    (engine as any).setupMasterChain();

    const bus = (engine as any).drumBusFilter;
    const send = (engine as any).drumSendFilter;
    expect(send.type).toBe(bus.type);
    expect(send.frequency.value).toBe(bus.frequency.value);
    expect(send.Q.value).toBe(bus.Q.value);
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

    engine.setReverbDecay(4.5);

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

    engine.setReverbDecay(2.0);
    expect(buildSpy).not.toHaveBeenCalled(); // equals the impulse setupMasterChain built
    engine.setReverbDecay(4.5);
    // Asserting the args (not just the count) is what actually discriminates
    // the duration-vs-exponent fix: the pre-Task-4 engine would have called
    // this with (2.0, 4.5), which also passes a count-only assertion.
    expect(buildSpy).toHaveBeenCalledWith(4.5, 2.0);
    engine.setReverbDecay(4.5);
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
      engine.setReverbDecay(d);
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

    engine.setReverbDecay(-5);
    expect(buildSpy).toHaveBeenCalledWith(0.1, 2.0);
    engine.setReverbDecay(900);
    expect(buildSpy).toHaveBeenLastCalledWith(10, 2.0);
  });

  test('the impulse cache evicts least-recently-used entries past its byte budget', () => {
    const { engine } = freshEngine();
    (engine as any).reverbNode = fakeNode();
    spyOn(
      engine as unknown as { buildImpulseResponse: () => AudioBuffer },
      'buildImpulseResponse',
    ).mockImplementation(() => ({}) as AudioBuffer);

    // Override the byte budget rather than allocate real multi-megabyte
    // buffers: at freshEngine's fake sampleRate (64), decay d costs
    // floor(64 * d) * 2 samples, so a budget of 500 forces eviction partway
    // through this sequence without needing thousands of samples.
    (engine as any).impulseCacheSampleBudget = 500;

    for (const d of [1.0, 1.1, 1.2, 1.3, 1.4]) {
      engine.setReverbDecay(d);
    }
    const cache = (engine as any).impulseCache as Map<number, { buffer: AudioBuffer; samples: number }>;
    expect(Array.from(cache.keys())).toEqual([1.2, 1.3, 1.4]); // 1.0, 1.1 evicted to stay under budget

    engine.setReverbDecay(1.2); // refresh recency
    engine.setReverbDecay(1.8); // pushes the total over budget again

    expect(cache.has(1.2)).toBe(true); // refreshed, survives eviction
    expect(cache.has(1.3)).toBe(false); // least-recently-used, evicted first
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

  // The counts-only test above would still pass if closedhat silently
  // misrouted to another single-envelope voice (e.g. tom), so these assert a
  // KIT PARAMETER that differs between the alias's real target and the most
  // plausible wrong one.
  test('closedhat resolves to hihat specifically, not openhat', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerDrum('closedhat', 1.0);
    const env = ctx._gains.at(-1)!;
    expect(env.gain.value).toBeCloseTo(DEFAULT_DRUM_KIT.hihat.gain, 9);
    expect(env.gain.value).not.toBeCloseTo(DEFAULT_DRUM_KIT.openhat.gain, 9);
  });

  test('lowtom resolves to tom specifically, not kick', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerDrum('lowtom', 1.0);
    const env = ctx._gains.at(-1)!;
    expect(env.gain.value).toBeCloseTo(DEFAULT_DRUM_KIT.tom.gain, 9);
    expect(env.gain.value).not.toBeCloseTo(DEFAULT_DRUM_KIT.kick.gain, 9);
  });

  test('ride resolves to crash specifically, not clap', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerDrum('ride', 1.0);
    // crash and clap both send to reverb, so the send gain (created right
    // after the envelope) carries the kit's per-drum reverbSend LEVEL — the
    // one field that tells the two voices apart when their headline `gain`
    // values happen to coincide (both 0.5 in DEFAULT_DRUM_KIT).
    const send = ctx._gains.at(-1)!;
    expect(send.gain.value).toBeCloseTo(DEFAULT_DRUM_KIT.crash.reverbSend, 9);
    expect(send.gain.value).not.toBeCloseTo(DEFAULT_DRUM_KIT.clap.reverbSend, 9);
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

describe('source bus level control', () => {
  test('setSourceGain ramps instead of stepping, and clamps to 0..1.5', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'chord');
    const bus = (engine as any).sourceBuses.get('chord');

    engine.setSourceGain('chord', 0.4);
    expect(bus.gain.targets.at(-1)).toEqual({ v: 0.4, t: ctx.currentTime, tc: 0.01 });

    engine.setSourceGain('chord', 99);
    expect(bus.gain.targets.at(-1)!.v).toBe(1.5);
    engine.setSourceGain('chord', -5);
    expect(bus.gain.targets.at(-1)!.v).toBe(0);
  });

  test('setSourceMuted ramps to 0 and back to the stored gain', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'bass');
    const bus = (engine as any).sourceBuses.get('bass');
    engine.setSourceGain('bass', 0.6);

    engine.setSourceMuted('bass', true);
    expect(bus.gain.targets.at(-1)!.v).toBe(0);
    expect(bus.gain.targets.at(-1)!.tc).toBe(0.01); // click-free

    engine.setSourceMuted('bass', false);
    expect(bus.gain.targets.at(-1)!.v).toBe(0.6);
  });

  test('a gain set while muted does not un-mute the bus', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'bass');
    const bus = (engine as any).sourceBuses.get('bass');

    engine.setSourceMuted('bass', true);
    engine.setSourceGain('bass', 0.9);

    expect(bus.gain.targets.at(-1)!.v).toBe(0);
  });
});

describe('master volume', () => {
  test('clamps to 0..1', () => {
    const { engine, ctx } = freshEngine();
    const masterGain = fakeNode();
    (engine as any).masterGain = masterGain;

    engine.setMasterVolume(2);
    expect(masterGain.gain.targets.at(-1)).toEqual({ v: 1, t: ctx.currentTime, tc: 0.05 });
    engine.setMasterVolume(-1);
    expect(masterGain.gain.targets.at(-1)!.v).toBe(0);
    engine.setMasterVolume(0.7);
    expect(masterGain.gain.targets.at(-1)!.v).toBe(0.7);
  });
});

describe('master chain effect defaults', () => {
  test('every wet send and EQ gain is seeded at zero', () => {
    const engine = makeEngine();
    (engine as any).ctx = masterChainCtx();
    (engine as any).setupMasterChain();

    // The audible defaults live in INITIAL_EFFECTS and arrive via
    // applyEngineSnapshot on the first click; seeding anything else here is a
    // second source of truth that already disagreed (distortionWet 0.1 vs 0.0,
    // eqLow 2 vs 0, eqHigh 3 vs 0).
    for (const field of ['reverbGain', 'delayGain', 'distortionGain']) {
      expect((engine as any)[field].gain.value, field).toBe(0);
    }
    for (const field of ['eqLowNode', 'eqMidNode', 'eqHighNode']) {
      expect((engine as any)[field].gain.value, field).toBe(0);
    }
  });
});

describe('getSourceAnalyser', () => {
  test('is null before init(), like every other engine accessor', () => {
    const engine = makeEngine();
    expect(engine.getSourceAnalyser('synth')).toBeNull();
  });

  test('each source gets its own analyser, and the same one every time', () => {
    const { engine } = freshEngine();
    const synth = engine.getSourceAnalyser('synth');
    const chord = engine.getSourceAnalyser('chord');

    expect(synth).not.toBeNull();
    expect(engine.getSourceAnalyser('synth')).toBe(synth);
    expect(chord).not.toBe(synth);
  });

  // The tap point is the source bus, which sits after the VCA and tremolo but
  // before the parallel sends and the master chain. That is what makes the
  // Synth view's scope show the layer being edited rather than the finished
  // mix — a master-tapped scope cannot do that.
  test('taps the source bus, not the master chain', () => {
    const { engine } = freshEngine();
    const analyser = engine.getSourceAnalyser('synth');
    const bus = (engine as any).sourceBuses.get('synth');

    expect(bus).toBeDefined();
    expect(bus.connectedTo).toContain(analyser);
  });

  // Nodes belong to the context that made them, so a rebuilt master chain must
  // drop them alongside sourceBuses or the next tap returns a dead node.
  test('setupMasterChain clears the analysers with the buses', () => {
    const { engine } = freshEngine();
    const before = engine.getSourceAnalyser('synth');
    (engine as any).sourceAnalysers.clear();
    expect(engine.getSourceAnalyser('synth')).not.toBe(before);
  });
});

describe('voice lifetime backstop', () => {
  // maxVoiceLifetimeMs is overridden via the same private-field cast
  // testFakes.ts documents (ctx, activeVoices, etc.) — waiting out the real
  // 30 s default would make this test take 30 s for no added coverage.
  test('a note-on with no matching note-off is torn down after maxVoiceLifetimeMs', async () => {
    const { engine, ctx } = freshEngine();
    (engine as any).maxVoiceLifetimeMs = 20;
    engine.triggerSynthNoteOn('C4', { ...SYNTH, filterRelease: 0.01 }, 0.8, ctx.currentTime, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');
    const stopped = spyOn(voice.oscs[0], 'stop');

    // Guard fires at 20 ms and calls releaseVoice(voice, 0.05, now), which
    // arms its own teardown timer of (max(0.05, 0.01) + 0.1) * 1000 = 150 ms
    // — wait past both.
    await new Promise((r) => setTimeout(r, 300));

    expect(stopped).toHaveBeenCalled();
    expect((engine as any).activeVoices.has('synth:C4')).toBe(false);
  });

  test('a voice released normally before the guard fires is never released twice', async () => {
    const { engine, ctx } = freshEngine();
    (engine as any).maxVoiceLifetimeMs = 50;
    engine.triggerSynthNoteOn(
      'C4',
      { ...SYNTH, release: 0.01, filterRelease: 0.01 },
      0.8,
      ctx.currentTime,
      'synth',
    );
    const voice = (engine as any).activeVoices.get('synth:C4');
    const stopped = spyOn(voice.oscs[0], 'stop');

    // The real note-off's releaseScheduledAt is set synchronously, well
    // before the 50 ms guard fires, so the guard must see it and no-op.
    engine.triggerSynthNoteOff('C4', 0.01, undefined, 'synth');
    await new Promise((r) => setTimeout(r, 250));

    expect(stopped).toHaveBeenCalledTimes(1);
  });

  test('a still-scheduled future voice is not touched by an already-expired guard', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).maxVoiceLifetimeMs = 30_000;
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime + 5, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');

    expect(voice.lifetimeGuardTimer).toBeDefined();
    expect(voice.releaseScheduledAt).toBeUndefined();
  });

  test('a guard timer whose voice is no longer the current one for its key does not release it', async () => {
    const { engine, ctx } = freshEngine();
    (engine as any).maxVoiceLifetimeMs = 20;
    engine.triggerSynthNoteOn('C4', { ...SYNTH, filterRelease: 0.01 }, 0.8, ctx.currentTime, 'synth');
    const staleVoice = (engine as any).activeVoices.get('synth:C4');
    const staleStopped = spyOn(staleVoice.oscs[0], 'stop');

    // Force the exact stale state the identity check exists for: something
    // other than a normal release/retrigger has swapped the map entry for
    // this key out from under staleVoice, WITHOUT going through
    // triggerSynthNoteOff, so staleVoice.releaseScheduledAt is still
    // undefined when the guard fires. Every real caller today releases the
    // outgoing voice synchronously before overwriting the entry, so this can
    // only be reached in a test by writing the map directly.
    const replacement = { ...staleVoice };
    (engine as any).activeVoices.set('synth:C4', replacement);
    expect(staleVoice.releaseScheduledAt).toBeUndefined();

    // Wait past the 20 ms guard AND the ~150 ms teardown delay releaseVoice
    // would arm if it ran (max(release, filterRelease) + 0.1 s, scaled to
    // ms). Without the activeVoices identity check, the guard would see
    // releaseScheduledAt still undefined and release staleVoice anyway, even
    // though it is no longer the voice this key refers to.
    await new Promise((r) => setTimeout(r, 300));

    expect(staleStopped).not.toHaveBeenCalled();
  });

  test('a voice released by the guard is no longer reshapeable during its release tail', async () => {
    const { engine, ctx } = freshEngine();
    (engine as any).maxVoiceLifetimeMs = 20;
    engine.triggerSynthNoteOn('C4', { ...SYNTH, filterRelease: 0.01 }, 0.8, ctx.currentTime, 'synth');
    const voice = (engine as any).activeVoices.get('synth:C4');

    // Wait past the 20 ms guard but well inside the ~150 ms teardown window
    // releaseVoice arms (max(0.05, 0.01) + 0.1 s), so the voice is still
    // tracked and mid release tail when we probe it.
    await new Promise((r) => setTimeout(r, 60));

    const sustainBefore = voice.sustainLevel;
    engine.applySynthVelocityScale(0.3);

    expect((engine as any).reshapeableVoices()).not.toContain(voice);
    expect(voice.sustainLevel).toBe(sustainBefore);
  });
});

describe('voice cap', () => {
  test('exceeding maxVoicesPerSource steals the oldest already-started voice', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).maxVoicesPerSource = 3;
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth');
    engine.triggerSynthNoteOn('D4', SYNTH, 0.8, ctx.currentTime, 'synth');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.8, ctx.currentTime, 'synth');
    const oldest = (engine as any).activeVoices.get('synth:C4');
    expect(oldest.releaseScheduledAt).toBeUndefined();

    engine.triggerSynthNoteOn('F4', SYNTH, 0.8, ctx.currentTime, 'synth');

    expect(oldest.releaseScheduledAt).toBeDefined();
    const newest = (engine as any).activeVoices.get('synth:F4');
    expect(newest.releaseScheduledAt).toBeUndefined();
  });

  test('a voice scheduled into the future is never stolen', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).maxVoicesPerSource = 2;
    const future = ctx.currentTime + 5;
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, future, 'synth');
    engine.triggerSynthNoteOn('D4', SYNTH, 0.8, ctx.currentTime, 'synth');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.8, ctx.currentTime, 'synth');

    const futureVoice = (engine as any).activeVoices.get('synth:C4');
    const middleVoice = (engine as any).activeVoices.get('synth:D4');
    expect(futureVoice.releaseScheduledAt).toBeUndefined();
    expect(middleVoice.releaseScheduledAt).toBeDefined();
  });

  test('a second steal after the first one picks a different, newer voice', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).maxVoicesPerSource = 2;
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth');
    engine.triggerSynthNoteOn('D4', SYNTH, 0.8, ctx.currentTime, 'synth');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.8, ctx.currentTime, 'synth');
    const first = (engine as any).activeVoices.get('synth:C4');
    const firstReleasedAt = first.releaseScheduledAt;
    expect(firstReleasedAt).toBeDefined();

    engine.triggerSynthNoteOn('G4', SYNTH, 0.8, ctx.currentTime, 'synth');

    const second = (engine as any).activeVoices.get('synth:D4');
    expect(second.releaseScheduledAt).toBeDefined();
    expect(first.releaseScheduledAt).toBe(firstReleasedAt);
    const newest = (engine as any).activeVoices.get('synth:G4');
    expect(newest.releaseScheduledAt).toBeUndefined();
  });

  test('a voice already releasing is never stolen a second time', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).maxVoicesPerSource = 2;
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth');
    engine.triggerSynthNoteOff('C4', 0.3, ctx.currentTime, 'synth');
    const releasing = (engine as any).activeVoices.get('synth:C4');
    const releasedAt = releasing.releaseScheduledAt;

    engine.triggerSynthNoteOn('D4', SYNTH, 0.8, ctx.currentTime, 'synth');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.8, ctx.currentTime, 'synth');

    expect(releasing.releaseScheduledAt).toBe(releasedAt);
  });
});

describe('bass mono kill iterates the bass voice set, not every active voice', () => {
  test('a new bass note releases the previous bass voice and leaves other sources alone', () => {
    const { engine, ctx } = freshEngine();
    const e = engine as any;

    e.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'chord');
    e.triggerSynthNoteOn('E4', SYNTH, 0.8, ctx.currentTime, 'synth');
    e.triggerSynthNoteOn('C2', SYNTH, 0.8, ctx.currentTime, 'bass');

    const oldBass = e.activeVoices.get('bass:C2');
    expect(oldBass).toBeTruthy();
    expect(oldBass.releaseScheduledAt).toBeUndefined();

    e.triggerSynthNoteOn('G2', SYNTH, 0.8, ctx.currentTime, 'bass');

    // The previous bass voice was released...
    expect(oldBass.releaseScheduledAt).toBe(ctx.currentTime);
    // ...and nothing else was touched.
    expect(e.activeVoices.get('chord:C4').releaseScheduledAt).toBeUndefined();
    expect(e.activeVoices.get('synth:E4').releaseScheduledAt).toBeUndefined();
  });

  test('a bass voice whose release has already started is not re-released', () => {
    const { engine, ctx } = freshEngine();
    const e = engine as any;

    e.triggerSynthNoteOn('C2', SYNTH, 0.8, ctx.currentTime, 'bass');
    e.triggerSynthNoteOff('C2', 0.2, ctx.currentTime, 'bass');
    const dying = e.activeVoices.get('bass:C2');
    const cancelsBefore = dying.gains[0].gain.cancels.length;

    e.triggerSynthNoteOn('G2', SYNTH, 0.8, ctx.currentTime, 'bass');

    expect(dying.gains[0].gain.cancels.length).toBe(cancelsBefore);
  });

  test('a bass voice whose release is scheduled in the FUTURE is still cut short', () => {
    const { engine, ctx } = freshEngine();
    const e = engine as any;

    e.triggerSynthNoteOn('C2', SYNTH, 0.8, ctx.currentTime, 'bass');
    // Release planned one second ahead — a long scheduled note that would
    // otherwise ring through the new one and break monophony.
    e.triggerSynthNoteOff('C2', 0.2, ctx.currentTime + 1, 'bass');
    const pending = e.activeVoices.get('bass:C2');
    expect(pending.releaseScheduledAt).toBe(ctx.currentTime + 1);

    e.triggerSynthNoteOn('G2', SYNTH, 0.8, ctx.currentTime, 'bass');

    expect(pending.releaseScheduledAt).toBe(ctx.currentTime);
  });

  test('a superseded bass voice of the same note is not double-released', () => {
    // sourceVoices keeps every live-or-releasing voice; activeVoices keeps
    // only the latest per key. Iterating sourceVoices without the identity
    // guard would call triggerSynthNoteOff('C2') twice for the same note.
    const { engine, ctx } = freshEngine();
    const e = engine as any;

    e.triggerSynthNoteOn('C2', SYNTH, 0.8, ctx.currentTime, 'bass');
    const superseded = e.activeVoices.get('bass:C2');
    e.triggerSynthNoteOn('C2', SYNTH, 0.8, ctx.currentTime, 'bass');
    const current = e.activeVoices.get('bass:C2');
    expect(current).not.toBe(superseded);

    const currentCancels = current.gains[0].gain.cancels.length;
    e.triggerSynthNoteOn('G2', SYNTH, 0.8, ctx.currentTime, 'bass');

    // Exactly one release reached the current C2 voice.
    expect(current.gains[0].gain.cancels.length).toBe(currentCancels + 1);
  });

  test('a sourceVoices entry whose activeVoices slot was reassigned to a different real voice is left alone', () => {
    // The identity guard exists for a write path that has never shipped on
    // this branch: something replacing the activeVoices slot for a `bass:`
    // key with a different voice without going through triggerSynthNoteOff
    // (the only real path, which always sets releaseScheduledAt on the OLD
    // occupant first). Constructed directly here via the sanctioned
    // (engine as any) cast, since no real note-on/note-off sequence reaches
    // this state: a full real voice is planted in the slot the stale
    // sourceVoices entry still believes is its own.
    const { engine, ctx } = freshEngine();
    const e = engine as any;

    e.triggerSynthNoteOn('C2', SYNTH, 0.8, ctx.currentTime, 'bass');
    const stale = e.activeVoices.get('bass:C2');
    expect(stale.releaseScheduledAt).toBeUndefined();

    // A real voice, built the normal way but under a different source so
    // creating it does not run the bass mono-kill against `stale`.
    e.triggerSynthNoteOn('C2', SYNTH, 0.8, ctx.currentTime, 'synth');
    const occupant = e.activeVoices.get('synth:C2');
    const occupantCancelsBefore = occupant.gains[0].gain.cancels.length;

    // Reassign the bass:C2 slot to this unrelated real voice, bypassing
    // triggerSynthNoteOff entirely.
    e.activeVoices.set('bass:C2', occupant);

    e.triggerSynthNoteOn('G2', SYNTH, 0.8, ctx.currentTime, 'bass');

    // The identity guard must refuse to act on `stale` because it no longer
    // matches its own activeVoices slot — and, critically, must not release
    // whatever real voice DOES occupy that slot either.
    expect(occupant.releaseScheduledAt).toBeUndefined();
    expect(occupant.gains[0].gain.cancels.length).toBe(occupantCancelsBefore);
  });
});

describe('impulse cache is bounded by samples, not entries', () => {
  test('long impulses evict early; short impulses do not', () => {
    const { engine } = freshEngine();
    const e = engine as any;
    // freshEngine's fake context reports sampleRate 64, so a real 4,000,000
    // budget would need 31,250 s of decay to trip. Shrink the ENGINE's budget
    // instead of faking a sample rate, so this exercises the same code path
    // production does. At sampleRate 64, samples = floor(64 * decay) * 2.
    e.impulseCacheSampleBudget = 800;

    e.getImpulseResponse(2.0); // 256 samples
    e.getImpulseResponse(2.5); // 320 samples -> total 576, inside 800
    expect(Array.from(e.impulseCache.keys())).toEqual([2.0, 2.5]);

    e.getImpulseResponse(3.0); // 384 samples -> total 960, over budget;
                               // evicting the oldest (256) brings it to 704.
    expect(Array.from(e.impulseCache.keys())).toEqual([2.5, 3.0]);
  });

  test('a hit moves the key to the newest position (LRU order is preserved)', () => {
    const { engine } = freshEngine();
    const e = engine as any;
    e.getImpulseResponse(1.0);
    e.getImpulseResponse(2.0);
    e.getImpulseResponse(1.0);
    expect(Array.from(e.impulseCache.keys())).toEqual([2.0, 1.0]);
  });

  test('a single impulse larger than the whole budget is still cached', () => {
    const { engine } = freshEngine();
    const e = engine as any;
    e.impulseCacheSampleBudget = 10;
    const buffer = e.getImpulseResponse(9.9);
    expect(buffer).toBeTruthy();
    expect(Array.from(e.impulseCache.keys())).toEqual([9.9]);
  });

  test('a repeated decay returns the same buffer instance', () => {
    const { engine } = freshEngine();
    const e = engine as any;
    expect(e.getImpulseResponse(2.0)).toBe(e.getImpulseResponse(2.0));
  });
});

describe('idle suspend and audio-clock teardown', () => {
  /** freshEngine's fake context has no state/suspend — add the two this needs. */
  function suspendableEngine() {
    const { engine, ctx } = freshEngine();
    const c = ctx as any;
    c.state = 'running';
    c.suspendCalls = 0;
    c.resumeCalls = 0;
    c.suspend = async () => {
      c.suspendCalls++;
      c.state = 'suspended';
    };
    c.resume = async () => {
      c.resumeCalls++;
      c.state = 'running';
    };
    return { engine, ctx: c };
  }

  test('an idle engine suspends when its idle timer fires', () => {
    const { engine, ctx } = suspendableEngine();
    (engine as any).maybeSuspendNow();
    expect(ctx.suspendCalls).toBe(1);
  });

  test('a live voice blocks the suspend', () => {
    const { engine, ctx } = suspendableEngine();
    (engine as any).triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth');
    (engine as any).maybeSuspendNow();
    expect(ctx.suspendCalls).toBe(0);
  });

  test('a clock listener blocks the suspend', () => {
    const { engine, ctx } = suspendableEngine();
    const unsubscribe = engine.subscribeClock(() => {});
    (engine as any).maybeSuspendNow();
    expect(ctx.suspendCalls).toBe(0);
    unsubscribe();
  });

  test('an enabled metronome blocks the suspend', () => {
    const { engine, ctx } = suspendableEngine();
    engine.setMetronomeEnabled(true);
    (engine as any).maybeSuspendNow();
    expect(ctx.suspendCalls).toBe(0);
    engine.setMetronomeEnabled(false);
  });

  test('wakeIfIdle resumes a context this engine suspended', () => {
    const { engine, ctx } = suspendableEngine();
    (engine as any).maybeSuspendNow();
    expect(ctx.state).toBe('suspended');

    engine.wakeIfIdle();
    expect(ctx.resumeCalls).toBe(1);
  });

  test('wakeIfIdle on a running context is a no-op and never throws', () => {
    const { engine, ctx } = suspendableEngine();
    engine.wakeIfIdle();
    engine.wakeIfIdle();
    expect(ctx.resumeCalls).toBe(0);
  });

  test('wakeIfIdle before init never throws', () => {
    const engine = makeEngine();
    expect(() => engine.wakeIfIdle()).not.toThrow();
  });

  test('a released voice records its teardown time on the AUDIO clock', () => {
    const { engine, ctx } = suspendableEngine();
    const e = engine as any;
    e.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth');
    e.triggerSynthNoteOff('C4', 0.5, ctx.currentTime, 'synth');

    const voice = e.activeVoices.get('synth:C4');
    // max(release 0.5, filterRelease 0.5) + 0.1 grace
    expect(voice.teardownAt).toBeCloseTo(ctx.currentTime + 0.6, 5);
  });

  test('a releasing voice also blocks the suspend — a release tail must never be cut', () => {
    const { engine, ctx } = suspendableEngine();
    const e = engine as any;
    e.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth');
    e.triggerSynthNoteOff('C4', 0.5, ctx.currentTime, 'synth');
    e.maybeSuspendNow();
    expect(ctx.suspendCalls).toBe(0);
    clearTimeout(e.activeVoices.get('synth:C4').teardownTimer);
  });

  test('wakeIfIdle re-arms a pending teardown against the frozen audio clock, when THIS engine idle-suspended', () => {
    const { engine, ctx } = suspendableEngine();
    const e = engine as any;
    e.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth');
    e.triggerSynthNoteOff('C4', 0.5, ctx.currentTime, 'synth');
    const voice = e.activeVoices.get('synth:C4');
    const firstTimer = voice.teardownTimer;

    // A releasing voice blocks maybeSuspendNow (proven above), so this drives
    // wakeIfIdle's own resume/re-arm branch directly by forcing the internal
    // state maybeSuspendNow would have set had the predicate allowed it. This
    // is NOT what a real backgrounded-tab suspend looks like — that path
    // never touches suspendedForIdle at all and is covered separately below,
    // through init()'s own resume branch.
    ctx.state = 'suspended';
    e.suspendedForIdle = true;
    engine.wakeIfIdle();

    // The timer was replaced, and the voice is still tracked — the old wall
    // clock timer would have torn it down 10 s into a 0.6 s release.
    expect(voice.teardownTimer).not.toBe(firstTimer);
    expect(e.activeVoices.get('synth:C4')).toBe(voice);
    clearTimeout(voice.teardownTimer);
  });

  test('init resumes and re-arms a pending teardown when the BROWSER suspended the context', async () => {
    const { engine, ctx } = suspendableEngine();
    const e = engine as any;
    ctx.state = 'suspended';
    e.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth');
    e.triggerSynthNoteOff('C4', 0.5, ctx.currentTime, 'synth');
    const voice = e.activeVoices.get('synth:C4');
    const firstTimer = voice.teardownTimer;

    // This is the genuine backgrounded-tab scenario: the browser suspends on
    // its own schedule, with no idle flag of ours ever set. init()'s existing
    // resume branch is the only thing that ever sees it.
    await e.init();

    expect(ctx.resumeCalls).toBe(1);
    expect(voice.teardownTimer).not.toBe(firstTimer);
    clearTimeout(voice.teardownTimer);
  });

  test('a MIDI-triggered note-on wakes a context this engine idle-suspended', () => {
    // midiInput.ts calls triggerSynthNoteOn directly with no init()/gesture
    // path of its own — this proves the wake happens at the engine boundary
    // regardless of caller, not only from a pointer/keyboard gesture.
    const { engine, ctx } = suspendableEngine();
    const e = engine as any;
    e.maybeSuspendNow();
    expect(ctx.state).toBe('suspended');

    e.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth');
    expect(ctx.resumeCalls).toBe(1);
  });

  test('a MIDI-triggered drum hit wakes a context this engine idle-suspended', () => {
    const { engine, ctx } = suspendableEngine();
    const e = engine as any;
    e.maybeSuspendNow();
    expect(ctx.state).toBe('suspended');

    engine.triggerDrum('kick');
    expect(ctx.resumeCalls).toBe(1);
  });

  test('an ordinary click on a running (never idle-suspended) context still restarts the idle countdown', () => {
    // Regression: wakeIfIdle used to clear the timer and return before
    // reaching markActivity() whenever there was nothing of its own to
    // resume, leaving idle suspend disarmed after the first click until the
    // next note, clock tick or metronome event.
    const { engine } = suspendableEngine();
    const e = engine as any;
    e.idleTimer = null;
    engine.wakeIfIdle();
    expect(e.idleTimer).not.toBeNull();
  });

  test('triggerSynthNoteOn marks activity', () => {
    const { engine, ctx } = freshEngine();
    const e = engine as any;
    expect(e.idleTimer).toBeNull();
    e.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth');
    expect(e.idleTimer).not.toBeNull();
  });

  test('triggerDrum marks activity', () => {
    const { engine } = freshEngine();
    const e = engine as any;
    expect(e.idleTimer).toBeNull();
    engine.triggerDrum('kick');
    expect(e.idleTimer).not.toBeNull();
  });

  test('subscribeClock marks activity on subscribe and again on the last unsubscribe', () => {
    const { engine } = freshEngine();
    const e = engine as any;
    expect(e.idleTimer).toBeNull();
    const unsubscribe = engine.subscribeClock(() => {});
    expect(e.idleTimer).not.toBeNull();

    // Reset so the assertion below can only pass if the DISPOSER'S OWN call
    // fires, not the one already proven above.
    clearTimeout(e.idleTimer);
    e.idleTimer = null;
    unsubscribe();
    expect(e.idleTimer).not.toBeNull();
  });

  test('setMetronomeEnabled marks activity on both the on and the off transition', () => {
    const { engine } = freshEngine();
    const e = engine as any;
    expect(e.idleTimer).toBeNull();
    engine.setMetronomeEnabled(true);
    expect(e.idleTimer).not.toBeNull();

    clearTimeout(e.idleTimer);
    e.idleTimer = null;
    engine.setMetronomeEnabled(false);
    expect(e.idleTimer).not.toBeNull();
  });

  test('init marks activity', async () => {
    const { engine } = suspendableEngine();
    const e = engine as any;
    e.idleTimer = null;
    expect(e.idleTimer).toBeNull();
    await e.init();
    expect(e.idleTimer).not.toBeNull();
  });

  test("init clears suspendedForIdle on its own resume, so a later wakeIfIdle doesn't redundantly resume again", async () => {
    const { engine, ctx } = suspendableEngine();
    const e = engine as any;
    e.maybeSuspendNow();
    expect(ctx.state).toBe('suspended');
    expect(e.suspendedForIdle).toBe(true);

    await e.init();
    expect(ctx.resumeCalls).toBe(1);
    expect(e.suspendedForIdle).toBe(false);

    // Nothing left for wakeIfIdle to do — it must not resume() a second time.
    engine.wakeIfIdle();
    expect(ctx.resumeCalls).toBe(1);
  });

  test('a rejected resume() leaves the engine recoverable: the flag stays true and a later trigger retries', async () => {
    // The exact regression this guards: clearing suspendedForIdle BEFORE
    // resume() settles (instead of inside its .then()) would make a refused
    // resume permanent — no later gesture or note would ever try again, and
    // the instrument stays silent for the rest of the session.
    const { engine, ctx } = suspendableEngine();
    const e = engine as any;
    e.maybeSuspendNow();
    expect(ctx.state).toBe('suspended');

    let resumeAttempts = 0;
    ctx.resume = async () => {
      resumeAttempts++;
      throw new Error('autoplay policy refused this resume');
    };

    engine.wakeIfIdle();
    // Flush the rejected promise's .then/.catch chain.
    await new Promise((r) => setTimeout(r, 20));

    expect(resumeAttempts).toBe(1);
    // Still owed a resume — this is the behaviour under test, not the retry.
    expect(e.suspendedForIdle).toBe(true);
    expect(ctx.state).toBe('suspended');

    // Prove recoverability end-to-end: the very next sound-producing trigger
    // retries resume(), it is not stuck silent forever.
    ctx.resume = async () => { resumeAttempts++; ctx.state = 'running'; };
    e.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth');
    expect(resumeAttempts).toBe(2);
  });
});

describe('reshapeableVoices reuses one scratch array', () => {
  const visits = (v: any) => v.filter.Q.cancels.length;

  test('each call visits its own source exactly once, and no other', () => {
    const { engine, ctx } = freshEngine();
    const e = engine as any;
    const t0 = ctx.currentTime;

    e.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord');
    e.triggerSynthNoteOn('E4', SYNTH, 0.8, t0, 'chord');
    e.triggerSynthNoteOn('C2', SYNTH, 0.8, t0, 'bass');

    const a = e.activeVoices.get('chord:C4');
    const b = e.activeVoices.get('chord:E4');
    const bass = e.activeVoices.get('bass:C2');
    const base = [visits(a), visits(b), visits(bass)];

    // Each call ticks the clock forward, as real knob-drag calls would: a
    // second cancelAndHold at the SAME timestamp hits the fake's "refuses a
    // timeline with setTargetAtTime" guard and takes its throwing branch,
    // which would double-count a visit and mask what this test checks.
    ctx.currentTime += 0.01;
    engine.updateSynthParams(SYNTH, 'chord');
    expect([visits(a), visits(b), visits(bass)]).toEqual([base[0] + 1, base[1] + 1, base[2]]);

    // A call over a DIFFERENT source must not re-visit the first source's
    // voices — exactly what an uncleared scratch array would do.
    ctx.currentTime += 0.01;
    engine.updateSynthParams(SYNTH, 'bass');
    expect([visits(a), visits(b), visits(bass)]).toEqual([base[0] + 1, base[1] + 1, base[2] + 1]);

    // And the all-sources call visits each voice exactly once more.
    ctx.currentTime += 0.01;
    engine.updateSynthParams(SYNTH);
    expect([visits(a), visits(b), visits(bass)]).toEqual([base[0] + 2, base[1] + 2, base[2] + 2]);
  });

  test('two successive calls over the same voice set schedule identical automation', () => {
    const { engine, ctx } = freshEngine();
    const e = engine as any;
    e.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'chord');
    const voice = e.activeVoices.get('chord:C4');

    engine.updateSynthParams(SYNTH, 'chord');
    engine.updateSynthParams(SYNTH, 'chord');

    const targets = voice.filter.frequency.targets;
    expect(targets.length).toBeGreaterThanOrEqual(2);
    expect(targets.at(-1)).toEqual(targets.at(-2));
  });
});
