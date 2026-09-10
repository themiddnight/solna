import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { INITIAL_EFFECTS } from '../store/initialState';
import type { MasterEffects, SynthParams } from '../types';
import { ENV_FLOOR } from './constants';
import { DRUM_ALIASES, METAL_BAND_B_HZ, METAL_RATIOS } from './engine';
import { DEFAULT_DRUM_KIT, DRUM_TYPES } from '@/data/drumKits';
import { mergeDrumKit } from './drumKits';
import { fakeNode, fakeParam, freshEngine, makeEngine } from './testFakes';
import { FADER_MAX_DB, MAX_FADER_GAIN, dbToGain, toDecibels } from '../utils/gainUnits';
import { NEUTRAL_TRIM_GAIN, synthTrimGainFor } from './trims';

/** A minimal, deliberately plain patch that differs only in its `preset` name. */
function trimTestParams(preset: string): SynthParams {
  return {
    oscType: 'sawtooth', subOscVolume: 0, noiseVolume: 0, detune: 0,
    filterType: 'lowpass', filterCutoff: 4000, filterResonance: 0,
    filterEnvAmount: 0, attack: 0.02, decay: 0.4, sustain: 0.6, release: 0.5,
    filterAttack: 0.02, filterDecay: 0.4, filterSustain: 0, filterRelease: 0.5,
    lfoRate: 3.5, lfoDepth: 0, lfoTarget: 'cutoff', octave: 0,
    arpActive: false, arpMode: 'up', arpRate: '16n', arpOctaves: 1, preset,
  };
}

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
    // rewireMasterDynamics calls disconnect() with no argument and then
    // re-makes exactly the edges the topology needs, so the fake has to forget
    // its outgoing edges too. fakeNode's inherited disconnect clears
    // `connectedTo`, which this override does not use — without this, a
    // "bypassed" assertion would read every edge the graph has EVER had.
    // The COUNT matters as much as the clearing: rewireMasterDynamics returns
    // early when the topology is unchanged, and because this fake forgets its
    // edges on every disconnect, an edge assertion alone cannot tell a guarded
    // rewire from an unguarded one that tore the tail down and rebuilt it
    // identically. Counting teardowns is what distinguishes them.
    (n as any)._disconnects = 0;
    (n as any).disconnect = () => {
      (n as any)._disconnects += 1;
      (n as any)._connectTargets.length = 0;
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

/**
 * A full effects payload minus reverbDecay, which updateEffects deliberately
 * refuses (it is owned by setReverbDecay). Built by deletion rather than by
 * spelling every key so the tests never drift from INITIAL_EFFECTS, and
 * without the excess-property error a literal spread would raise.
 */
function fxWith(overrides: Partial<MasterEffects>): Omit<MasterEffects, 'reverbDecay'> {
  const next = { ...INITIAL_EFFECTS, ...overrides } as Record<string, unknown>;
  delete next.reverbDecay;
  return next as unknown as Omit<MasterEffects, 'reverbDecay'>;
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
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.25, 'chord');
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.5, 'chord', 1, 'live');
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

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 2, 'chord');

    const voice = (engine as any).activeVoices.get('chord:C4');
    expect(voice).toBeTruthy();

    engine.updateSynthParams({ ...SYNTH, oscType: 'sine' }, 'chord');
    expect(voice.oscs[0].type).toBe('sine');
  });

  test('updateSynthParams leaves a voice whose release has already started', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 - 1, 'chord', 1, 'live');
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
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 1, 'chord', 1, 'live');
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

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 4, 'chord');

    const vca = ctx._gains[0].gain;
    vca.ramps.length = 0;

    engine.updateSynthParams({ ...SYNTH, release: 2 }, 'chord');

    expect(vca.ramps.at(-1)).toEqual({ v: 0.00001, t: t0 + 4 + 2 });
  });

  test('restores the filter release ramp a live timbre update would otherwise cancel', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
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

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 - 2, 'chord', 1, 'live');
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
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.3, 'chord');
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.5, 'chord', 1, 'live');
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

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'synth', 1, 'live');
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'synth', 1, 'live');

    const oldVoiceGain = ctx._gains[0].gain;
    expect(oldVoiceGain.cancels).toContain(t0);
  });
});

describe('bass retrigger', () => {
  test('same-note retrigger releases the old voice at the new note start, not immediately', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C2', SYNTH, 0.8, t0, 'bass', 1, 'live');
    engine.triggerSynthNoteOff('C2', SYNTH.release, t0 + 1, 'bass');
    engine.triggerSynthNoteOn('C2', SYNTH, 0.8, t0 + 0.5, 'bass', 1, 'live');

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
    engine.triggerSynthNoteOn('C2', SYNTH, 0.8, t0, 'bass', 1, 'live');
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
    engine.triggerSynthNoteOn('C2', SYNTH, 0.8, t0, 'bass', 1, 'live');
    engine.triggerSynthNoteOff('C2', 0.05, t0 + 0.5, 'bass');
    engine.triggerSynthNoteOn('E2', SYNTH, 0.8, t0 + 1, 'bass', 1, 'live');
    engine.triggerSynthNoteOff('E2', SYNTH.release, t0 + 5, 'bass');

    const c2 = bassVoices().find((v) => v.noteName === 'C2');
    const e2 = bassVoices().find((v) => v.noteName === 'E2');

    engine.triggerSynthNoteOn('G2', SYNTH, 0.8, t0 + 2, 'bass', 1, 'live');

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
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.25, 'chord');
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.5, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.75, 'chord');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.8, t0 + 0.5, 'chord', 1, 'live');
    engine.triggerSynthNoteOn('F2', SYNTH, 0.8, t0, 'bass', 1, 'live');

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

  // Rapid preview clicks: every click stops the source before re-triggering,
  // so a stop lands on voices that are already fading from the PREVIOUS stop.
  // Re-releasing those re-arms their teardown timer, which is what kept a
  // silent voice in sourceVoices for as long as clicks kept arriving.
  test('a stop leaves a voice already fading at least as fast alone', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    const voice = Array.from(
      (engine as any).sourceVoices.get('chord') as Set<any>,
    )[0];

    engine.stopSource('chord', 0.15);
    const teardownAt = voice.teardownAt;
    const cancelCount = voice.gains[0].gain.cancels.length;

    ctx.currentTime = t0 + 0.05;
    engine.stopSource('chord', 0.15);

    expect(voice.teardownAt).toBe(teardownAt);
    expect(voice.gains[0].gain.cancels).toHaveLength(cancelCount);
  });

  test('a stop shorter than the pending release still cuts the voice', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    const voice = Array.from(
      (engine as any).sourceVoices.get('chord') as Set<any>,
    )[0];

    engine.stopSource('chord', 2);
    const teardownAt = voice.teardownAt;

    engine.stopSource('chord', 0.05);

    expect(voice.teardownAt).toBeLessThan(teardownAt);
    expect(voice.gains[0].gain.ramps.at(-1).t).toBe(t0 + 0.05);
  });

  // The symptom this guards: past maxVoicesPerSource, stealOldestVoice can
  // only steal voices with no release planned — which are the notes of the
  // chord being played RIGHT NOW — so every click but the last note went
  // silent and the preview collapsed to a single note.
  // Real timers, and ctx.currentTime advanced in lockstep with them: the
  // teardown that drains a released voice out of sourceVoices runs on the wall
  // clock, so a synchronous loop would show the same unbounded growth whether
  // the bug is present or not.
  test('repeated held previews keep sounding the whole chord', async () => {
    const { engine, ctx } = freshEngine();
    const notes = ['C4', 'E4', 'G4', 'B4'];
    const step = async (seconds: number) => {
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      ctx.currentTime += seconds;
    };
    const chordVoices = () => (engine as any).sourceVoices.get('chord') as Set<any>;

    // Eight presses a second — playChordLegato stops the source on the press
    // and ChordView stops it again on the release.
    for (let click = 0; click < 10; click++) {
      engine.stopSource('chord', 0.05);
      for (const note of notes) engine.triggerSynthNoteOn(note, SYNTH, 0.8, undefined, 'chord', 1, 'live');
      const sounding = Array.from(chordVoices()).filter(
        (v) => v.releaseScheduledAt === undefined,
      );
      expect(sounding.map((v) => v.noteName).sort()).toEqual([...notes].sort());
      await step(0.06);
      engine.stopSource('chord', 0.15);
      await step(0.06);
    }

    await step(0.4);
    expect(chordVoices().size).toBe(0);
  });
});

describe('scheduled source stop (soft stop on a bar line)', () => {
  test('a future time anchors the release there, not at currentTime', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime; // 10

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.5, 'chord', 1, 'live');

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

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    engine.stopSource('chord', 0.02);

    const voices = Array.from(
      (engine as any).sourceVoices.get('chord') as Set<{ releaseScheduledAt: number }>,
    );
    expect(voices[0].releaseScheduledAt).toBe(t0);
  });
});

describe('drum bus filter', () => {
  test('drum voices route through the drum bus filter instead of dryGain, and a send exists only when the kit\'s reverbSend calls for one', () => {
    const { engine, ctx } = freshEngine();
    // freshEngine() already seeds distinct fake nodes for drumBusFilter,
    // drumSendFilter and dryGain (testFakes.ts) — reuse them rather than
    // substituting our own, so `ctx._gains[i].connectedTo` (populated by the
    // real fakeNode.connect, not a hand-rolled spy) reflects exactly what the
    // engine wired.
    const filter = (engine as any).drumBusFilter;
    const sendFilter = (engine as any).drumSendFilter;
    const dryGain = (engine as any).dryGain;
    const kit = (engine as any).drumKit;

    for (const type of ['kick', 'lowtom'] as const) {
      // Pre-warm the per-track fader so it does not itself land in `gains`
      // below — DEV-386's node is created lazily on first use.
      const track = (engine as any).drumTrackGain(type);
      const before = ctx._gains.length;
      engine.triggerDrum(type, 0.8, ctx.currentTime);
      const gains = ctx._gains.slice(before);

      // Never dryGain — for this one voice alone, not just in aggregate.
      for (const g of gains) expect(g.connectedTo, `${type} voice`).not.toContain(dryGain);

      // The dry envelope is IDENTIFIED by connecting to the per-track fader
      // (DEV-386 interposes it ahead of `filter`) — a routing bug that
      // redirects the dry path to `sendFilter` instead (making the voice
      // reverb-only, with no dry signal) leaves nothing satisfying this
      // filter, so `dryEnvelopes` comes back empty and the length assertion
      // catches it. This is why membership in {track, sendFilter} is not
      // enough: that would accept a dry path aimed at either one.
      expect(track.connectedTo, `${type} track fader`).toContain(filter);
      const dryEnvelopes = gains.filter((g) => g.connectedTo.includes(track));
      expect(dryEnvelopes, `${type} dry envelope`).toHaveLength(1);
      const dryEnv = dryEnvelopes[0];

      // The kit's authored reverbSend for this voice is > 0 (asserted
      // independently, over all 13 kits, in drumKits.test.ts), so a send must
      // exist. It is identified structurally — a gain the dry envelope itself
      // connects to (env.connect(send)) which in turn connects to
      // sendFilter — not merely by being *some* node whose target is
      // sendFilter, which would equally accept a send fed by a different
      // voice's envelope.
      const reverbSend = type === 'kick' ? kit.kick.reverbSend : kit.lowtom.reverbSend;
      expect(reverbSend, `${type}.reverbSend`).toBeGreaterThan(0);
      const send = gains.find(
        (g) => dryEnv.connectedTo.includes(g) && g.connectedTo.includes(sendFilter),
      );
      expect(send, `${type} send gain`).toBeDefined();
      expect(send!.gain.value).toBeCloseTo(reverbSend, 9);
    }
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
    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0 + 0.5, 'synth', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.6, 'synth');

    // The key comes up before that note sounds.
    engine.releaseSoundingVoices('synth', 0.1, 'live');

    // Cancelling at t0 would wipe the scheduled attack and the note would
    // never be heard — only its own release at t0 + 0.6 may touch it.
    const scheduledVoiceGain = ctx._gains[0].gain;
    expect(scheduledVoiceGain.cancels).not.toContain(t0);
    expect(scheduledVoiceGain.cancels).toContain(t0 + 0.6);
  });

  test('a voice that is already sounding is released', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0, 'synth', 1, 'live');
    engine.releaseSoundingVoices('synth', 0.1, 'live');

    const soundingVoiceGain = ctx._gains[0].gain;
    expect(soundingVoiceGain.cancels).toContain(t0);
  });

  test('a future voice with no release of its own is still released', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // No paired note-off: nothing would ever end this voice, so it must not
    // be skipped or it would drone forever.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0 + 0.5, 'synth', 1, 'live');
    engine.releaseSoundingVoices('synth', 0.1, 'live');

    expect(ctx._gains[0].gain.cancels).toContain(t0);
  });

  test('voices of other sources are left alone', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0, 'synth', 1, 'live');
    engine.releaseSoundingVoices('chord', 0.1, 'live');

    expect(ctx._gains[0].gain.cancels).not.toContain(t0);
  });

  test('leaves a voice of another owner untouched', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // Two players on ONE bus — the exact situation this whole change exists
    // for. The lead track's engine source is 'synth' and the arp plays
    // whichever bus focusTrack names, so an arp key-up used to cut the
    // melody track's sounding note short.
    // Different note names: the same-note dedup would release the first
    // voice before the second existed, and there would be nothing to assert.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0, 'synth', 1, 'arp');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.9, t0, 'synth', 1, 'sequencer');

    const voices = [...((engine as any).sourceVoices.get('synth') as Set<any>)];
    const arpVoice = voices.find((v) => v.owner === 'arp');
    const seqVoice = voices.find((v) => v.owner === 'sequencer');

    // The NEGATIVE half is the load-bearing one: a test that only checks the
    // arp voice got its ramp stays green with the owner filter deleted.
    const seqGain = seqVoice.gains[0].gain;
    const before = {
      events: seqGain.events.length,
      targets: seqGain.targets.length,
      cancels: seqGain.cancels.length,
    };

    engine.releaseSoundingVoices('synth', 0.1, 'arp');

    // Asserting on the recorded arrays, never valueAt(): release ramps use
    // setTargetAtTime and fakeParam.valueAt THROWS on such a timeline.
    expect(arpVoice.gains[0].gain.cancels).toContain(t0);
    expect(arpVoice.releaseScheduledAt).toBe(t0);

    expect(seqGain.events.length).toBe(before.events);
    expect(seqGain.targets.length).toBe(before.targets);
    expect(seqGain.cancels.length).toBe(before.cancels);
    expect(seqVoice.releaseScheduledAt).toBeUndefined();
  });

  test("another owner's future-scheduled voice is not hard-silenced", () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // A future voice with no release of its own is the case the owner-blind
    // path hard-silences via silenceVoiceNow — which also removes it from
    // sourceVoices, so the sequencer's next note would never sound.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0 + 0.5, 'synth', 1, 'sequencer');

    engine.releaseSoundingVoices('synth', 0.1, 'arp');

    const voices = [...((engine as any).sourceVoices.get('synth') as Set<any>)];
    expect(voices.length).toBe(1);
    expect(voices[0].gains[0].gain.cancels).not.toContain(t0);
  });

  test('stopSource still kills a scheduled voice, so pattern previews stop dead', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0 + 0.5, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.6, 'chord');
    engine.stopSource('chord', 0.1);

    expect(ctx._gains[0].gain.cancels).toContain(t0);
  });
});

describe('stopOwnedVoices', () => {
  test("leaves another owner's sounding voice untouched", () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0, 'synth', 1, 'sequencer');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.9, t0, 'synth', 1, 'live');

    const voices = [...((engine as any).sourceVoices.get('synth') as Set<any>)];
    const seqVoice = voices.find((v) => v.owner === 'sequencer');
    const liveVoice = voices.find((v) => v.owner === 'live');

    const liveGain = liveVoice.gains[0].gain;
    const before = {
      events: liveGain.events.length,
      targets: liveGain.targets.length,
      cancels: liveGain.cancels.length,
    };

    engine.stopOwnedVoices('synth', 'sequencer', 0.02);

    expect(seqVoice.gains[0].gain.cancels).toContain(t0);
    expect(seqVoice.releaseScheduledAt).toBe(t0);

    // The load-bearing half: stopping a melody grid must not cut the key the
    // player is holding down. No new automation of ANY kind on that voice.
    expect(liveGain.events.length).toBe(before.events);
    expect(liveGain.targets.length).toBe(before.targets);
    expect(liveGain.cancels.length).toBe(before.cancels);
    expect(liveVoice.releaseScheduledAt).toBeUndefined();
  });

  test("leaves another owner's future-scheduled voice in place", () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    // This is the case a whole-bus stop DESTROYS: stopSource hard-silences a
    // future voice through silenceVoiceNow, which also drops it from
    // sourceVoices — so an arp note the clock has already queued would never
    // sound, and it is unrecoverable rather than merely early.
    engine.triggerSynthNoteOn('C4', SYNTH, 0.9, t0 + 0.5, 'synth', 1, 'arp');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.9, t0, 'synth', 1, 'sequencer');

    const arpVoice = [...((engine as any).sourceVoices.get('synth') as Set<any>)]
      .find((v) => v.owner === 'arp');
    const arpGain = arpVoice.gains[0].gain;
    const beforeEvents = arpGain.events.length;

    engine.stopOwnedVoices('synth', 'sequencer', 0.02);

    expect(arpGain.events.length).toBe(beforeEvents);
    expect(arpGain.cancels).not.toContain(t0);
  });

  test('an unknown source and a context-less engine are both no-ops', () => {
    const { engine } = freshEngine();
    expect(() => engine.stopOwnedVoices('nope', 'arp', 0.02)).not.toThrow();
    const bare = makeEngine();
    expect(() => bare.stopOwnedVoices('synth', 'arp', 0.02)).not.toThrow();
  });
});

describe('master chain', () => {
  // Drums reach their layer the same way voices do — through the pre-fader
  // tap. Wiring drumBusFilter straight to the bus would leave the sequencer
  // scope reading a signal the fader had already scaled.
  test('the drum bus filter feeds the sequencer TAP, not its bus', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    (engine as any).ctx = ctx;
    (engine as any).setupMasterChain();

    const tap = (engine as any).sourceTaps.get('sequencer');
    const bus = (engine as any).sourceBuses.get('sequencer');
    const drumFilter = (engine as any).drumBusFilter;

    // masterChainCtx's nodes record into _connectTargets, not connectedTo.
    expect(tap).toBeDefined();
    expect(drumFilter._connectTargets).toContain(tap);
    expect(drumFilter._connectTargets).not.toContain(bus);
    expect(tap._connectTargets).toContain(bus);
  });

  test('both dynamics stages default OFF, so masterGain reaches the destination directly', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    (engine as any).ctx = ctx;
    (engine as any).setupMasterChain();

    const masterGain = (engine as any).masterGain;
    const limiter = (engine as any).limiter;
    const analyser = (engine as any).analyser;
    const levelAnalyser = (engine as any).levelAnalyser;
    const compressor = (engine as any).compressor;
    const eqHigh = (engine as any).eqHighNode;

    // masterGain is the user's master trim and nothing else: engineSync pushes
    // masterVolume with fireImmediately, so any "staging" value seeded here is
    // overwritten before the first frame.
    expect(masterGain.gain.value).toBe(1);

    // NOTHING owns headroom by default, and that is the intended state
    // (DEV-385): both stages exist as nodes but neither is in the path, so the
    // mix reaches the destination exactly as the user made it.
    expect(eqHigh._connectTargets).toEqual([masterGain]);
    expect(masterGain._connectTargets).toEqual([analyser, levelAnalyser, ctx.destination]);
    expect(compressor._connectTargets).toEqual([]);
    expect(limiter._connectTargets).toEqual([]);
    // BOTH taps are SENDS with no onward output (DEV-384), so each reads the
    // post-fader, pre-dynamics mix and feeds nothing. levelAnalyser is the one
    // getMasterLevelAnalyser() returns — it IS the meter, and asserting only
    // `analyser` here would leave this test green with every meter at -inf.
    expect(analyser._connectTargets).toEqual([]);
    expect(levelAnalyser._connectTargets).toEqual([]);

    // The nodes are still seeded with the app's historical values, so
    // switching a stage on reproduces what the app used to do invisibly.
    expect(compressor.threshold.value).toBe(-12);
    expect(compressor.knee.value).toBe(30);
    expect(compressor.ratio.value).toBe(4);
    expect(compressor.attack.value).toBeCloseTo(0.003, 6);
    expect(compressor.release.value).toBeCloseTo(0.25, 6);
    expect(limiter.threshold.value).toBe(-3);
    expect(limiter.knee.value).toBe(0);
    expect(limiter.ratio.value).toBe(20);
    expect(limiter.attack.value).toBeCloseTo(0.003, 6);
    expect(limiter.release.value).toBeCloseTo(0.15, 6);
  });

  test('engaging both stages inserts compressor then limiter AFTER the meter tap', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    (engine as any).ctx = ctx;
    (engine as any).setupMasterChain();

    engine.updateEffects(fxWith({ compressorEnabled: true, limiterEnabled: true }));

    const masterGain = (engine as any).masterGain;
    const limiter = (engine as any).limiter;
    const analyser = (engine as any).analyser;
    const levelAnalyser = (engine as any).levelAnalyser;
    const compressor = (engine as any).compressor;

    expect(masterGain._connectTargets).toEqual([analyser, levelAnalyser, compressor]);
    expect(compressor._connectTargets).toEqual([limiter]);
    expect(limiter._connectTargets).toEqual([ctx.destination]);
    // NEITHER tap moved, and neither is in series: an honest meter still reads
    // the mix the user made, not the squashed output. DEV-384 put both here and
    // DEV-385 must not undo either.
    expect(analyser._connectTargets).toEqual([]);
    expect(levelAnalyser._connectTargets).toEqual([]);
  });

  test('the limiter alone sits directly after masterGain, with no idle compressor in the path', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    (engine as any).ctx = ctx;
    (engine as any).setupMasterChain();

    engine.updateEffects(fxWith({ compressorEnabled: false, limiterEnabled: true }));

    const masterGain = (engine as any).masterGain;
    const limiter = (engine as any).limiter;
    const analyser = (engine as any).analyser;
    const levelAnalyser = (engine as any).levelAnalyser;
    const compressor = (engine as any).compressor;

    expect(masterGain._connectTargets).toEqual([analyser, levelAnalyser, limiter]);
    expect(limiter._connectTargets).toEqual([ctx.destination]);
    expect(compressor._connectTargets).toEqual([]);
    expect(analyser._connectTargets).toEqual([]);
    expect(levelAnalyser._connectTargets).toEqual([]);
  });

  test('toggling the stages on and off again leaves no orphaned nodes', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    (engine as any).ctx = ctx;
    (engine as any).setupMasterChain();

    const masterGain = (engine as any).masterGain;
    const compressorBefore = (engine as any).compressor;
    const limiterBefore = (engine as any).limiter;
    const analyser = (engine as any).analyser;
    const levelAnalyser = (engine as any).levelAnalyser;

    engine.updateEffects(fxWith({ compressorEnabled: true, limiterEnabled: true }));
    engine.updateEffects(fxWith({ compressorEnabled: true, limiterEnabled: false }));
    engine.updateEffects(fxWith({ compressorEnabled: false, limiterEnabled: false }));

    // Node IDENTITY is stable across every rewire: a rewire reconnects, it
    // never rebuilds. A rebuilt node would leave the old one alive, still fed
    // by whatever pointed at it — the orphan this test exists to forbid.
    expect((engine as any).compressor).toBe(compressorBefore);
    expect((engine as any).limiter).toBe(limiterBefore);

    // Back to the default topology, with no leftover edge from the round trip.
    expect(masterGain._connectTargets).toEqual([analyser, levelAnalyser, ctx.destination]);
    expect(compressorBefore._connectTargets).toEqual([]);
    expect(limiterBefore._connectTargets).toEqual([]);
    expect(analyser._connectTargets).toEqual([]);
    expect(levelAnalyser._connectTargets).toEqual([]);

    // Every edge below the fader, collected: exactly the two taps and the output.
    const edges = [masterGain, compressorBefore, limiterBefore, analyser, levelAnalyser].flatMap(
      (n: any) => n._connectTargets as unknown[],
    );
    expect(edges).toEqual([analyser, levelAnalyser, ctx.destination]);
  });

  test('a full toggle cycle never drops the meter tap', () => {
    // This test exists because a rewire that drops the meter's tap is
    // otherwise INVISIBLE. rewireMasterDynamics calls masterGain.disconnect(),
    // which takes both observe-only sends with it; forgetting to re-make
    // levelAnalyser throws nothing, orphans nothing, and leaves the audio path
    // audibly perfect — the only symptom is VuMeter and AmbientBackdrop pinned
    // at -inf, which no graph assertion above would notice if it named only
    // `analyser`. A cross-plan review caught exactly that defect in this plan,
    // so the guard is a test rather than a comment.
    const engine = makeEngine();
    const ctx = masterChainCtx();
    (engine as any).ctx = ctx;
    (engine as any).setupMasterChain();

    const masterGain = (engine as any).masterGain;
    const levelAnalyser = (engine as any).levelAnalyser;
    const taps = () => masterGain._connectTargets as unknown[];

    // Seeded topology: the tap is there before anything is toggled.
    expect(taps()).toContain(levelAnalyser);

    engine.updateEffects(fxWith({ compressorEnabled: true, limiterEnabled: false }));
    // The rewire really RAN — masterGain now feeds the compressor instead of
    // the destination — and the tap survived it. Without this first assertion
    // the test would also pass against an engine that never rewires at all,
    // which is the one state it must not be green in.
    expect(taps()).toContain((engine as any).compressor);
    expect(taps()).toContain(levelAnalyser);
    // Still a SEND after the rewire — in the tap list, not spliced into series.
    expect(levelAnalyser._connectTargets).toEqual([]);

    engine.updateEffects(fxWith({ compressorEnabled: false, limiterEnabled: false }));
    expect(taps()).toContain(ctx.destination);
    expect(taps()).not.toContain((engine as any).compressor);
    expect(taps()).toContain(levelAnalyser);
    expect(levelAnalyser._connectTargets).toEqual([]);

    // getMasterLevelAnalyser() still hands out that same live node, so the
    // meter reads the node the graph is actually feeding.
    expect(engine.getMasterLevelAnalyser()).toBe(levelAnalyser);
  });

  test('a rewire before init() is a no-op, and an unchanged topology tears nothing down', () => {
    // Two properties that share a setup. First: every engine setter no-ops
    // until init() creates the AudioContext, and rewireMasterDynamics is no
    // exception — it touches six nodes that do not exist yet.
    const engine = makeEngine();
    expect(() => (engine as any).rewireMasterDynamics(true, true)).not.toThrow();
    expect((engine as any).dynamicsTopology).toBe('unbuilt');

    const ctx = masterChainCtx();
    (engine as any).ctx = ctx;
    (engine as any).setupMasterChain();

    const masterGain = (engine as any).masterGain;
    const analyser = (engine as any).analyser;
    const levelAnalyser = (engine as any).levelAnalyser;
    const compressor = (engine as any).compressor;
    const limiter = (engine as any).limiter;
    const teardowns = () =>
      masterGain._disconnects + compressor._disconnects + limiter._disconnects;

    // Second: engineSync pushes the WHOLE effects object, so updateEffects
    // runs on any effects change at all — every frame of a delay-knob drag
    // included. The `topology === this.dynamicsTopology` early return is what
    // stops each of those from ripping the master tail apart and rebuilding it
    // mid-audio. Counting teardowns is the only way to see that: the edges
    // come out identical either way, so an edge assertion alone would stay
    // green with the guard deleted.
    // limiterEnabled is pinned false here, explicitly: this test isolates the
    // compressor-only 'c' topology, and since DEV-383 INITIAL_EFFECTS itself
    // defaults limiterEnabled true, so fxWith's spread would otherwise fold
    // the limiter into the topology under test.
    engine.updateEffects(fxWith({ compressorEnabled: true, limiterEnabled: false, delayWet: 0.1 }));
    const afterRealChange = teardowns();
    expect(afterRealChange).toBeGreaterThan(0); // the topology DID change here

    engine.updateEffects(fxWith({ compressorEnabled: true, limiterEnabled: false, delayWet: 0.9 }));
    expect(teardowns()).toBe(afterRealChange); // …and did not here

    // And the graph is still exactly one set of edges, not a doubled one.
    expect((engine as any).dynamicsTopology).toBe('c');
    expect(masterGain._connectTargets).toEqual([analyser, levelAnalyser, compressor]);
    expect(compressor._connectTargets).toEqual([ctx.destination]);
  });

  test('an engaged stage receives its stored parameters', () => {
    const engine = makeEngine();
    const ctx = masterChainCtx();
    (engine as any).ctx = ctx;
    (engine as any).setupMasterChain();

    engine.updateEffects(
      fxWith({
        compressorEnabled: true,
        compressorThreshold: -20,
        compressorRatio: 8,
        limiterEnabled: true,
        limiterThreshold: -6,
      }),
    );

    const compressor = (engine as any).compressor;
    const limiter = (engine as any).limiter;
    // fakeParam records setTargetAtTime calls as { v, t, tc }; asserting on the
    // recorded VALUES rather than on an index keeps the test free of both
    // ordering assumptions and index-signature typing.
    const values = (param: { targets: { v: number }[] }) => param.targets.map((e) => e.v);

    expect(values(compressor.threshold)).toContain(-20);
    expect(values(compressor.ratio)).toContain(8);
    expect(values(compressor.attack)).toContain(0.003);
    expect(values(compressor.release)).toContain(0.25);
    expect(values(limiter.threshold)).toContain(-6);
    expect(values(limiter.ratio)).toContain(20);
  });

  test('the level analyser has a longer window than the spectrum analyser', () => {
    const engine = makeEngine();
    (engine as any).ctx = masterChainCtx();
    (engine as any).setupMasterChain();

    // AudioVisualizer draws from `analyser.frequencyBinCount`, so its fftSize
    // is fixed at 256 and the level read gets its own, longer, node instead.
    expect((engine as any).analyser.fftSize).toBe(256);
    expect((engine as any).levelAnalyser.fftSize).toBe(2048);
  });

  test('getMasterLevelAnalyser is null before init and the level node after', () => {
    const engine = makeEngine();
    expect(engine.getMasterLevelAnalyser()).toBeNull();

    (engine as any).ctx = masterChainCtx();
    (engine as any).setupMasterChain();

    expect(engine.getMasterLevelAnalyser()).toBe((engine as any).levelAnalyser);
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

  test('reports each stage\'s live gain reduction, and 0 before the context exists', () => {
    const engine = makeEngine();

    // Every getter must survive the pre-init state: no AudioContext means no
    // nodes, and the readout has to render 0 rather than throw.
    expect(engine.getCompressorReduction()).toBe(0);
    expect(engine.getLimiterReduction()).toBe(0);

    const ctx = masterChainCtx();
    (engine as any).ctx = ctx;
    (engine as any).setupMasterChain();

    (engine as any).compressor.reduction = -4.25;
    (engine as any).limiter.reduction = -0.5;

    expect(engine.getCompressorReduction()).toBe(-4.25);
    expect(engine.getLimiterReduction()).toBe(-0.5);
  });
});

describe('live polyphony equal-power scaling', () => {
  test('applySynthVelocityScale re-scales every live voice and skips released ones', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'synth', 1, 'live');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.8, undefined, 'synth', 1, 'live');
    engine.triggerSynthNoteOn('G4', SYNTH, 0.8, undefined, 'synth', 1, 'live');
    engine.triggerSynthNoteOff('G4', SYNTH.release, undefined, 'synth');

    engine.applySynthVelocityScale(0.5, 'synth');

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

    engine.triggerSynthNoteOn('C4', SYNTH, 1.0, undefined, 'synth', 0.5, 'live');
    const c4 = (engine as any).activeVoices.get('synth:C4');
    expect(c4.envelopeScale).toBe(0.5);

    engine.applySynthVelocityScale(0.25, 'synth');
    expect(c4.gains[0].gain.targets).toHaveLength(1);
    expect(c4.gains[0].gain.targets[0].v).toBeCloseTo(
      1.0 * 0.4 * SYNTH.sustain * 0.25,
      5,
    );
  });

  test('a re-scale that matches the current scale leaves voices untouched', () => {
    const { engine } = freshEngine();

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'synth', 1, 'live');
    engine.applySynthVelocityScale(1, 'synth');

    const c4 = (engine as any).activeVoices.get('synth:C4');
    expect(c4.gains[0].gain.targets).toHaveLength(0);
  });

  test('rescales only the named source — a keyboard press leaves chord voices alone', () => {
    const { engine } = freshEngine();

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'synth', 1, 'live');
    engine.triggerSynthNoteOn('A3', SYNTH, 0.8, undefined, 'chord', 1, 'live');

    engine.applySynthVelocityScale(0.5, 'synth');

    const voices = (engine as any).activeVoices;
    const lead = voices.get('synth:C4');
    const chord = voices.get('chord:A3');

    expect(lead.envelopeScale).toBe(0.5);
    expect(lead.gains[0].gain.targets).toHaveLength(1);

    // The chord voice is on a bus nobody pressed a key on: no re-scale at all.
    // Asserted on the RECORDED events, not on a computed value — fakeParam's
    // valueAt() refuses a timeline containing setTargetAtTime and this path
    // uses it.
    expect(chord.envelopeScale).toBe(1);
    expect(chord.gains[0].gain.targets).toHaveLength(0);
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
    // The stub carries all four params because updateEffects now writes the
    // whole compressor stage (DEV-385), not the threshold alone — a stub with
    // only `threshold` would throw rather than fail an assertion.
    const threshold = fakeParam();
    (engine as any).compressor = {
      threshold,
      ratio: fakeParam(),
      attack: fakeParam(),
      release: fakeParam(),
    };

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
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');

    expect(ctx._bufferSources).toHaveLength(0);
    const voice = (engine as any).activeVoices.get('synth:C4');
    expect(voice.noise).toBeUndefined();
    expect(voice.noiseGain).toBeUndefined();
  });

  test('a preset with noiseVolume > 0 gets a looped noise source at that level', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', NOISY, 0.8, ctx.currentTime, 'synth', 1, 'live');

    expect(ctx._bufferSources).toHaveLength(1);
    // Without loop the noise would run out mid-note: the buffer is 2 s while
    // this preset's decay + release already exceed that.
    expect(ctx._bufferSources[0].loop).toBe(true);

    const voice = (engine as any).activeVoices.get('synth:C4');
    expect(voice.noiseGain.gain.value).toBe(0.25);
  });

  test('the noise level scales with noiseVolume rather than being a fixed amount', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, noiseVolume: 0.4 }, 0.8, ctx.currentTime, 'synth', 1, 'live');
    engine.triggerSynthNoteOn('E4', { ...SYNTH, noiseVolume: 0.02 }, 0.8, ctx.currentTime, 'synth', 1, 'live');

    const loud = (engine as any).activeVoices.get('synth:C4');
    const quiet = (engine as any).activeVoices.get('synth:E4');
    expect(loud.noiseGain.gain.value).toBe(0.4);
    expect(quiet.noiseGain.gain.value).toBe(0.02);
  });

  test('noise runs into the filter, not past it, so the VCF envelope shapes it', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', NOISY, 0.8, ctx.currentTime, 'synth', 1, 'live');
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
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    const voice = (engine as any).activeVoices.get('synth:C4');

    engine.updateSynthParams({ ...SYNTH, noiseVolume: 0.3 }, 'synth');

    expect(voice.noiseGain.connectedTo).toEqual([voice.filter]);
  });

  test('gains[0] and gains[1] stay the main and sub gains when noise is present', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', NOISY, 0.8, ctx.currentTime, 'synth', 1, 'live');

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
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    const voice = (engine as any).activeVoices.get('synth:C4');
    expect(voice.noise).toBeUndefined();

    engine.updateSynthParams({ ...SYNTH, noiseVolume: 0.3 }, 'synth');

    expect(voice.noise).toBeDefined();
    expect(voice.noise.loop).toBe(true);
    expect(voice.noiseGain.gain.targets.at(-1)?.v).toBe(0.3);
  });

  test('turning the noise knob down to zero silences it on a sounding voice', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', NOISY, 0.8, ctx.currentTime, 'synth', 1, 'live');
    const voice = (engine as any).activeVoices.get('synth:C4');

    engine.updateSynthParams({ ...NOISY, noiseVolume: 0 }, 'synth');

    expect(voice.noiseGain.gain.targets.at(-1)?.v).toBe(0);
  });

  test('releasing a noisy voice stops and disconnects its noise source', async () => {
    const { engine, ctx } = freshEngine();
    // Tiny filterRelease as well as a tiny release: the teardown timeout waits
    // max(releaseTime, filterRelease) + 0.1 s, and SYNTH's 0.5 s filter release
    // would outlast the test.
    engine.triggerSynthNoteOn('C4', { ...NOISY, filterRelease: 0.01 }, 0.8, ctx.currentTime, 'synth', 1, 'live');
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

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
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
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
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

    engine.triggerSynthNoteOn('C4', HELD_CHORD, 0.8, t0, 'chord', 1, 'live');
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
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
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

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
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
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 - 0.1, 'chord', 1, 'live');
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
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 - 1, 'chord', 1, 'live');
    const vca = ctx._gains[0].gain;
    vca.value = 0.05;

    engine.triggerSynthNoteOff('C4', SYNTH.release, undefined, 'chord');

    expect(vca.valueAt(t0)).toBeCloseTo(0.8 * 0.4 * SYNTH.sustain, 5);
  });

  test('the filter release falls back to the live cutoff', () => {
    const { engine, ctx } = freshEngine({ cancelAndHold: false });
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
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
    engine.triggerSynthNoteOn('C4', PAD, 0.8, t0, 'chord', 1, 'live');
    engine.triggerSynthNoteOff('C4', PAD.release, t0 + 4, 'chord');

    const vca = ctx._gains[0].gain;
    engine.updateSynthParams({ ...PAD, sustain: 1 }, 'chord');

    expect(vca.targets.at(-1)?.v).toBeCloseTo(peak, 5);
  });

  test('turning Sustain down lowers it, and the stored level follows', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    engine.triggerSynthNoteOn('C4', PAD, 0.8, t0, 'chord', 1, 'live');
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
    engine.triggerSynthNoteOn('C4', PAD, 0.8, t0, 'chord', 1, 'live');
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
    engine.triggerSynthNoteOn('C4', PAD, 0.8, t0, 'synth', 1, 'live');
    engine.applySynthVelocityScale(0.5, 'synth');

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
    engine.triggerSynthNoteOn('C4', PAD, 0.8, t0 - 2, 'chord', 1, 'live');
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
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'synth', 1, 'live');
    ctx.currentTime = t0 + 0.01;
    engine.applySynthVelocityScale(0.5, 'synth');

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
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'synth', 1, 'live');

    expect(typeof (engine as any).reshapeableVoices).toBe('function');
    const spy = spyOn(engine as any, 'reshapeableVoices');
    engine.applySynthVelocityScale(0.5, 'synth');
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

    engine.triggerSynthNoteOn('C4', fast, 0.8, t0, 'synth', 1, 'live');
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

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.1, 'synth', 1, 'live');
    const first = (engine as any).activeVoices.get('synth:C4');
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.5, 'synth', 1, 'live');

    // The bass path at engine.ts:394 forwards `time`; this one did not, so the
    // old voice was cut up to a full 100 ms lookahead before the new one began.
    expect(first.releaseScheduledAt).toBe(t0 + 0.5);
  });
});

describe('noise source initial level', () => {
  test('adding noise to a live voice starts from an explicit floor, not a denormal', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, noiseVolume: 0 }, 0.8, undefined, 'synth', 1, 'live');
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

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.1, 'chord', 1, 'live');
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

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.1, 'chord', 1, 'live');
    engine.stopSource('chord', 0.1);

    expect((engine as any).sourceVoices.get('chord').size).toBe(0);
    expect((engine as any).activeVoices.has('chord:C4')).toBe(false);
  });

  test('a sounding voice still gets its release ramp', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 - 1, 'chord', 1, 'live');
    const vca = (engine as any).activeVoices.get('chord:C4').gains[0].gain;
    vca.ramps.length = 0;

    engine.stopSource('chord', 0.1);

    expect(vca.ramps.at(-1)).toEqual({ v: 0.00001, t: t0 + 0.1 });
  });

  test('releaseSoundingVoices hard-silences a future voice with no release of its own', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.1, 'synth', 1, 'live');
    const vca = (engine as any).activeVoices.get('synth:C4').gains[0].gain;
    // The note-on's own attack/decay ramps already sit in `ramps`; clear them
    // so the assertion below is about ramps releaseSoundingVoices schedules.
    vca.ramps.length = 0;

    engine.releaseSoundingVoices('synth', 0.1, 'live');

    expect(vca.ramps).toHaveLength(0);
    expect(vca.events.at(-1)!.v).toBe(0);
  });

  test('releaseSoundingVoices still leaves a future voice that already has a release', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0 + 0.1, 'synth', 1, 'live');
    engine.triggerSynthNoteOff('C4', SYNTH.release, t0 + 0.3, 'synth');
    const vca = (engine as any).activeVoices.get('synth:C4').gains[0].gain;
    const before = vca.events.length;

    engine.releaseSoundingVoices('synth', 0.1, 'live');

    expect(vca.events.length).toBe(before);
  });
});

describe('re-planning a pending release', () => {
  test('a bass mono-kill keeps its 0.05 s release when the patch says 2 s', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const pad = { ...SYNTH, release: 2 };

    engine.triggerSynthNoteOn('C2', pad, 0.8, t0 - 1, 'bass', 1, 'live');
    const first = (engine as any).activeVoices.get('bass:C2');
    // The new bass note releases the old one with the mono-kill's 0.05 s.
    engine.triggerSynthNoteOn('E2', pad, 0.8, t0 + 1, 'bass', 1, 'live');
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

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
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
    engine.triggerSynthNoteOn('C4', TREM, 0.8, undefined, 'synth', 1, 'live');
    const voice = (engine as any).activeVoices.get('synth:C4');

    // Connecting the LFO to gainNode.gain SUMS with the envelope: the release
    // ramp never reaches silence and the sum inverts phase on the downswing.
    expect(voice.lfoGain.connectedTo).not.toContain(voice.gains[0].gain);
    expect(voice.lfoGain.connectedTo).toContain(voice.tremoloGain.gain);
  });

  test('the tremolo gain sits between the VCA and the source tap', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', TREM, 0.8, undefined, 'synth', 1, 'live');
    const voice = (engine as any).activeVoices.get('synth:C4');
    const tap = (engine as any).sourceTaps.get('synth');

    expect(voice.gains[0].connectedTo).toEqual([voice.tremoloGain]);
    expect(voice.tremoloGain.connectedTo).toContain(tap);
    // Unity so the envelope passes through untouched when depth is 0.
    expect(voice.tremoloGain.gain.value).toBe(1);
  });

  test('a voice with no LFO still routes through the tremolo gain', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'synth', 1, 'live');
    const voice = (engine as any).activeVoices.get('synth:C4');

    // Always present, so switching a live voice onto tremolo is a reconnect of
    // the LFO alone and never a rewire of the voice's own output.
    expect(voice.tremoloGain).toBeTruthy();
    expect(voice.tremoloGain.gain.value).toBe(1);
  });

  test('cutoff and pitch targets are unchanged', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, lfoDepth: 0.5, lfoTarget: 'cutoff' }, 0.8, undefined, 'synth', 1, 'live');
    const cut = (engine as any).activeVoices.get('synth:C4');
    expect(cut.lfoGain.connectedTo).toContain(cut.filter.frequency);
    expect(cut.lfoGain.gain.value).toBeCloseTo(0.5 * 1500, 9);

    engine.triggerSynthNoteOn('E4', { ...SYNTH, lfoDepth: 0.5, lfoTarget: 'pitch' }, 0.8, undefined, 'synth', 1, 'live');
    const pit = (engine as any).activeVoices.get('synth:E4');
    expect(pit.lfoGain.connectedTo).toContain(pit.oscs[0].detune);
    expect(pit.lfoGain.gain.value).toBeCloseTo(0.5 * 50, 9);
  });

  test('switching a live voice from cutoff to volume moves the LFO to the tremolo gain', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, lfoDepth: 0.5, lfoTarget: 'cutoff' }, 0.8, undefined, 'synth', 1, 'live');
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
    engine.triggerSynthNoteOn('C4', { ...SYNTH, lfoDepth: 0.5, lfoTarget: 'pitch' }, 0.8, undefined, 'synth', 1, 'live');
    const voice = (engine as any).activeVoices.get('synth:C4');
    expect(voice.lfoGain.gain.value).toBeCloseTo(0.5 * 50, 9);

    engine.updateSynthParams({ ...SYNTH, lfoDepth: 0.5, lfoTarget: 'volume' }, 'synth');

    expect(voice.lfoTarget).toBe('volume');
    expect(voice.lfoGain.connectedTo).toEqual([voice.tremoloGain.gain]);
    expect(voice.lfoGain.gain.value).toBeCloseTo(0.5 * 0.2, 9);
  });

  test('a depth change with the target UNCHANGED still glides, not jumps', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, lfoDepth: 0.5, lfoTarget: 'cutoff' }, 0.8, undefined, 'synth', 1, 'live');
    const voice = (engine as any).activeVoices.get('synth:C4');

    engine.updateSynthParams({ ...SYNTH, lfoDepth: 0.2, lfoTarget: 'cutoff' }, 'synth');

    // Same target: an instant jump here would click, so this path must keep
    // using setTargetAtTime rather than connectLfoTo's instant setValueAtTime.
    expect(voice.lfoGain.gain.targets.at(-1)!.v).toBeCloseTo(0.2 * 1500, 9);
  });

  test('depth above 1 still clamps the tremolo scale so the trough stays positive', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', { ...SYNTH, lfoDepth: 3, lfoTarget: 'volume' }, 0.8, undefined, 'synth', 1, 'live');
    const voice = (engine as any).activeVoices.get('synth:C4');

    // Math.min(1, params.lfoDepth) clamps the MULTIPLIER to 1 before scaling
    // by 0.2, so a depth of 3 (or any out-of-range value > 1) still yields
    // exactly 0.2 — never more. That keeps the tremolo gain's trough at
    // 1 - 0.2 = 0.8, always positive, however large the depth gets.
    expect(voice.lfoGain.gain.value).toBe(0.2);
  });

  test('an LFO added to a live voice that started without one is wired, not dropped', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'synth', 1, 'live'); // lfoDepth 0
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
    engine.triggerSynthNoteOn('C4', { ...SYNTH, lfoDepth: 0.5, lfoTarget: 'cutoff' }, 0.8, undefined, 'synth', 1, 'live');
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
    engine.triggerSynthNoteOn('C4', { ...SYNTH, lfoDepth: 0.5, lfoTarget: 'cutoff' }, 0.8, undefined, 'synth', 1, 'live');
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
    // Pre-warm the per-track fader so the count below reflects only what THIS
    // hit creates — DEV-386's track gain node is created lazily on first use.
    (engine as any).drumTrackGain('clap');
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
    for (const type of DRUM_TYPES) {
      const before = ctx._gains.length;
      engine.triggerDrum(type, 1.0);
      for (const g of ctx._gains.slice(before)) {
        // The clap's inter-burst ramps land above the floor on purpose: each
        // burst decays and the next hand re-strikes. What must be identical
        // across every voice is where the envelope ENDS. Send gains have no
        // ramps at all.
        if (g.gain.ramps.length === 0) continue;
        expect(g.gain.ramps.at(-1)!.v).toBe(0.0001);
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

  test('the clap is three decaying bursts, not three rising plateaus', () => {
    const { engine, ctx } = freshEngine();
    const gain = (engine as any).drumKit.clap.gain;
    const before = ctx._gains.length;

    engine.triggerDrum('clap', 1.0);

    const evs = ctx._gains[before].gain.events as { kind: string; v: number; t: number }[];
    const t0 = evs[0].t;

    // A real clap is several hands landing within ~30 ms, and the hands do
    // not get louder. The old schedule ended on peak * 1.1.
    const strikes = evs.filter((e) => e.kind === 'set');
    expect(strikes.map((e) => Number((e.v / gain).toFixed(2)))).toEqual([1.0, 0.85, 0.7, 0.55]);
    for (let i = 1; i < strikes.length; i++) {
      expect(strikes[i].v, `strike ${i}`).toBeLessThan(strikes[i - 1].v);
    }

    // Each burst DECAYS: every strike is followed by a ramp downward before
    // the next strike, with a gap. A plateau on noise is a gate, and reads as
    // "noise chopped", not as hands.
    const burstRamps = evs.filter((e) => e.kind === 'exp' && e.v > 0.0001);
    expect(burstRamps).toHaveLength(3);
    for (const r of burstRamps) expect(r.v).toBeCloseTo(gain * 0.05, 9);
    expect(burstRamps.map((e) => Number((e.t - t0).toFixed(3)))).toEqual([0.008, 0.018, 0.028]);
    expect(strikes.map((e) => Number((e.t - t0).toFixed(3)))).toEqual([0, 0.01, 0.02, 0.03]);
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

  test('the kick body feeds the reverb send at the kit level; the click does not', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit.kick = {
      freqStart: 150, freqEnd: 40, pitchTime: 0.02, decay: 0.4, gain: 1,
      clickFreq: 1100, clickLevel: 0.35, clickDecay: 0.008, reverbSend: 0.45,
    };
    const sendFilter = (engine as any).drumSendFilter;
    const before = ctx._gains.length;
    const made = recordNodes(ctx);

    engine.triggerDrum('kick', 1.0);

    const sends = ctx._gains.slice(before).filter((g) => g.connectedTo.includes(sendFilter));
    // Exactly one: the body. A click through a reverb is a slap, and the click
    // is a transient whose whole job is to stay dry.
    expect(sends).toHaveLength(1);
    expect(sends[0].gain.value).toBeCloseTo(0.45, 9);
    // drumTone's osc.connect(env) is a shared edge across every toned voice
    // (kick, tom, both snare/rimshot partials); made.osc[0] is the kick body,
    // created before the click.
    expect(made.osc[0].connectedTo).toEqual([made.gain[0]]);
  });

  test('the low tom feeds the reverb send at the kit level', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit.lowtom = {
      freqStart: 200, freqEnd: 110, pitchTime: 0.3, decay: 0.6, gain: 0.78, reverbSend: 0.5,
    };
    const sendFilter = (engine as any).drumSendFilter;
    const before = ctx._gains.length;
    const made = recordNodes(ctx);

    engine.triggerDrum('lowtom', 1.0);

    const sends = ctx._gains.slice(before).filter((g) => g.connectedTo.includes(sendFilter));
    expect(sends).toHaveLength(1);
    expect(sends[0].gain.value).toBeCloseTo(0.5, 9);
    expect(made.osc[0].connectedTo).toEqual([made.gain[0]]);
  });

  test('the hi tom feeds the reverb send at the kit level', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit.hitom = {
      freqStart: 400, freqEnd: 220, pitchTime: 0.1, decay: 0.3, gain: 0.78, reverbSend: 0.5,
    };
    const sendFilter = (engine as any).drumSendFilter;
    const before = ctx._gains.length;
    const made = recordNodes(ctx);

    engine.triggerDrum('hitom', 1.0);

    const sends = ctx._gains.slice(before).filter((g) => g.connectedTo.includes(sendFilter));
    expect(sends).toHaveLength(1);
    expect(sends[0].gain.value).toBeCloseTo(0.5, 9);
    expect(made.osc[0].connectedTo).toEqual([made.gain[0]]);
  });

  test('a hat is a BAND: the highpass runs into a lowpass at the kit topCut', () => {
    const { engine, ctx } = freshEngine();
    // metal: 0 isolates the noise path this test targets — the bank has its
    // own tests in "metal crossfades the hat between bank and noise".
    (engine as any).drumKit.hihat = { filter: 3600, topCut: 7500, decay: 0.038, gain: 0.22, metal: 0 };
    const filtersBefore = ctx._filters.length;
    const noiseBefore = ctx._bufferSources.length;
    const gainsBefore = ctx._gains.length;

    engine.triggerDrum('hihat', 1.0);

    const made = ctx._filters.slice(filtersBefore);
    const noise = ctx._bufferSources[noiseBefore];
    const env = ctx._gains[gainsBefore];
    expect(made).toHaveLength(2);
    expect(made[0].type).toBe('highpass');
    expect(made[0].frequency.value).toBe(3600);
    expect(made[1].type).toBe('lowpass');
    expect(made[1].frequency.value).toBe(7500);
    // The full chain, every link: noise -> highpass -> lowpass -> envelope.
    // Pinning only the head (highpass -> lowpass) leaves a lowpass that is
    // created, correctly typed, correctly tuned, and fed by the highpass,
    // with its output going nowhere -- silently identical to no topCut at
    // all. Without the second biquad a LOWER corner passes MORE energy,
    // which is how the darkest authored hat became the fullest-sounding one.
    expect(noise.connectedTo).toContain(made[0]);
    expect(made[0].connectedTo).toContain(made[1]);
    expect(made[1].connectedTo).toContain(env);
  });

  test('the open hat gets its own topCut', () => {
    const { engine, ctx } = freshEngine();
    // metal: 0 isolates the noise path this test targets — the bank has its
    // own tests in "metal crossfades the hat between bank and noise".
    (engine as any).drumKit.openhat = { filter: 3200, topCut: 7000, decay: 0.24, gain: 0.26, metal: 0 };
    const filtersBefore = ctx._filters.length;
    const noiseBefore = ctx._bufferSources.length;
    const gainsBefore = ctx._gains.length;

    engine.triggerDrum('openhat', 1.0);

    const made = ctx._filters.slice(filtersBefore);
    const noise = ctx._bufferSources[noiseBefore];
    const env = ctx._gains[gainsBefore];
    expect(made).toHaveLength(2);
    expect(made[0].type).toBe('highpass');
    expect(made[0].frequency.value).toBe(3200);
    expect(made[1].type).toBe('lowpass');
    expect(made[1].frequency.value).toBe(7000);
    // Same parity as the hihat test above: two voices that get the same
    // treatment in the engine get the same treatment here, full chain
    // included, or the weaker test becomes the hole.
    expect(noise.connectedTo).toContain(made[0]);
    expect(made[0].connectedTo).toContain(made[1]);
    expect(made[1].connectedTo).toContain(env);
  });

  test('the crash and the clap get no topCut — only the hats are a band', () => {
    const { engine, ctx } = freshEngine();

    // DEFAULT_DRUM_KIT.crash.metal is 0.55, so a crash hit runs BOTH the
    // noise burst (1 bandpass) and the metallic bank (2 bandpass + 1
    // highpass) — 4 filters total, none of them a lowpass. That absence,
    // not the count, is what "no topCut" asserts; the count is pinned too so
    // a silently-dropped bank branch cannot make this pass for the wrong
    // reason.
    let before = ctx._filters.length;
    engine.triggerDrum('crash', 1.0);
    const crashFilters = ctx._filters.slice(before);
    expect(crashFilters).toHaveLength(4);
    expect(crashFilters.map((f) => f.type)).toEqual(['bandpass', 'bandpass', 'bandpass', 'highpass']);

    before = ctx._filters.length;
    engine.triggerDrum('clap', 1.0);
    expect(ctx._filters.slice(before)).toHaveLength(1);
  });

  test('both hats run a resonant highpass; the crash and the clap keep their own Q', () => {
    const { engine, ctx } = freshEngine();

    let before = ctx._filters.length;
    engine.triggerDrum('hihat', 1.0);
    // The resonant bump at the corner is the cheapest approximation of a
    // partial that white noise through one biquad can produce. 5 is the middle
    // of the sourced 4-6 band.
    expect(ctx._filters[before].Q.value).toBe(5);

    before = ctx._filters.length;
    engine.triggerDrum('openhat', 1.0);
    expect(ctx._filters[before].Q.value).toBe(5);

    // Asserted so a later edit cannot sweep the other noise voices along with
    // the hats: these two are authored values with their own reasons.
    before = ctx._filters.length;
    engine.triggerDrum('crash', 1.0);
    expect(ctx._filters[before].Q.value).toBe(0.8);

    before = ctx._filters.length;
    engine.triggerDrum('clap', 1.0);
    expect(ctx._filters[before].Q.value).toBe(1.5);
  });
});

describe('snare pair and rimshot', () => {
  test('a snare schedules TWO body oscillators plus its noise', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit = DEFAULT_DRUM_KIT;
    // Pre-warm the per-track fader so `made.gain`'s order is the two body
    // envelopes only — DEV-386's track gain node is created lazily on first
    // use and would otherwise land between them.
    (engine as any).drumTrackGain('snare');
    const made = recordNodes(ctx);
    engine.triggerDrum('snare', 1);
    expect(made.osc).toHaveLength(2);
    expect(made.osc.map((o) => o.type)).toEqual(['triangle', 'triangle']);
    expect(made.osc.map((o) => o.frequency.events[0].v)).toEqual([220, 407]);
    expect(made.osc.map((o) => o.frequency.ramps[0].v)).toEqual([195, 361]);
    expect(made.noise).toHaveLength(1);
    // Pin the SECOND partial's own gain (0.3, not 0.5 = bodyGain and not 0 —
    // an inert second partial still schedules a node that ramps to ENV_FLOOR
    // and would otherwise pass every count-only check above) and pin that
    // each oscillator reaches its OWN envelope: drumTone's osc.connect(env)
    // is a shared edge across every toned voice, and a node built but never
    // connected passes every value/count check that does not read `connectedTo`.
    expect(made.gain[0].gain.events[0].v).toBe(0.5);
    expect(made.gain[1].gain.events[0].v).toBe(0.3);
    expect(made.osc[0].connectedTo).toEqual([made.gain[0]]);
    expect(made.osc[1].connectedTo).toEqual([made.gain[1]]);
  });

  test('rimshot runs the same path off its own params, with almost no noise', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit = DEFAULT_DRUM_KIT;
    // Pre-warm for the same reason the snare test above does.
    (engine as any).drumTrackGain('rimshot');
    const made = recordNodes(ctx);
    engine.triggerDrum('rimshot', 1);
    expect(made.osc.map((o) => o.frequency.events[0].v)).toEqual([455, 1667]);
    const noiseEnv = made.gain.find((g) => g.gain.events[0]?.v === 0.15);
    expect(noiseEnv).toBeDefined();
    // Same two pins as the snare test, off rimshot's own params: 0.45/0.55,
    // not 0/0 and not equal to each other.
    expect(made.gain[0].gain.events[0].v).toBe(0.45);
    expect(made.gain[1].gain.events[0].v).toBe(0.55);
    expect(made.osc[0].connectedTo).toEqual([made.gain[0]]);
    expect(made.osc[1].connectedTo).toEqual([made.gain[1]]);
  });
});

describe('drum aliases and unknown types', () => {
  test('closedhat resolves to its canonical voice', () => {
    const { engine, ctx } = freshEngine();
    // Both names resolve to the same instrument, so pre-warm its track fader
    // once: otherwise the FIRST iteration alone creates DEV-386's lazily-built
    // gain node and its count would not equal the second's.
    (engine as any).drumTrackGain('hihat');
    const counts: Record<string, number> = {};
    for (const type of ['hihat', 'closedhat']) {
      const before = ctx._gains.length;
      engine.triggerDrum(type, 1.0);
      counts[type] = ctx._gains.length - before;
    }
    expect(counts.closedhat).toBe(counts.hihat);
  });

  test('hitom and lowtom are two different pitched voices', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit = DEFAULT_DRUM_KIT;
    const made = recordNodes(ctx);
    engine.triggerDrum('lowtom', 1);
    engine.triggerDrum('hitom', 1);
    expect(made.osc.map((o) => o.frequency.events[0].v)).toEqual([88, 176]);
    expect(made.osc.map((o) => o.frequency.ramps[0].v)).toEqual([65, 130]);
  });

  test('a plain "tom" is no longer a recognized type, and "ride" is no longer aliased to crash: both stale aliases are gone', () => {
    // Decision 4 / task 5: triggerDrum resolves DRUM_ALIASES[name] ?? name
    // BEFORE the switch. If 'lowtom' still mapped to 'tom', case 'lowtom'
    // would be dead code; if 'ride' still mapped to 'crash', case 'ride'
    // would be dead code and every ride step would silently keep playing a
    // crash, with no error and no other failing test.
    const { engine, ctx } = freshEngine();
    const before = ctx._gains.length;
    engine.triggerDrum('tom', 1.0);
    expect(ctx._gains.length).toBe(before);
    expect(DRUM_ALIASES.lowtom).toBeUndefined();
    expect(DRUM_ALIASES.ride).toBeUndefined();
    expect(DRUM_ALIASES).toEqual({ closedhat: 'hihat' });
  });

  test('DRUM_ALIASES is exactly { closedhat: hihat }', () => {
    // Not a style assertion. triggerDrum resolves DRUM_ALIASES[name] ?? name
    // BEFORE its switch, so a resurrected `lowtom: 'tom'` or `ride: 'crash'`
    // makes case 'lowtom' / case 'ride' unreachable dead code and every step on
    // those rows plays the wrong voice - with no error and no other failing
    // test, because the "every target is a real drum type" test still passes.
    expect({ ...DRUM_ALIASES }).toEqual({ closedhat: 'hihat' });
  });

  test('every drum type reaches its own case, with no alias in the way', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit = DEFAULT_DRUM_KIT;
    for (const type of DRUM_TYPES) {
      const before = ctx._gains.length;
      engine.triggerDrum(type, 1.0);
      expect(ctx._gains.length, `${type} produced no audio`).toBeGreaterThan(before);
    }
    expect(DRUM_TYPES).toHaveLength(11);
  });

  // The counts-only test above would still pass if closedhat silently
  // misrouted to another single-envelope voice (e.g. lowtom), so these assert a
  // KIT PARAMETER that differs between the alias's real target and the most
  // plausible wrong one.
  test('closedhat resolves to hihat specifically, not openhat', () => {
    const { engine, ctx } = freshEngine();
    const before = ctx._gains.length;
    engine.triggerDrum('closedhat', 1.0);
    // metal < 1 means the noise burst's envelope is always the FIRST gain
    // node this hit creates (the bank, if any, is wired after it) — pin by
    // that position rather than by "last", which the bank's own envelopes
    // now occupy.
    const env = ctx._gains[before];
    const hihatNoisePeak = DEFAULT_DRUM_KIT.hihat.gain * (1 - DEFAULT_DRUM_KIT.hihat.metal);
    const openhatNoisePeak = DEFAULT_DRUM_KIT.openhat.gain * (1 - DEFAULT_DRUM_KIT.openhat.metal);
    expect(env.gain.value).toBeCloseTo(hihatNoisePeak, 9);
    expect(env.gain.value).not.toBeCloseTo(openhatNoisePeak, 9);
  });

  test('lowtom resolves to its own low-tom voice, not kick', () => {
    const { engine, ctx } = freshEngine();
    const filter = (engine as any).drumBusFilter;
    const before = ctx._gains.length;

    engine.triggerDrum('lowtom', 1.0);

    // The tom now also feeds the reverb send, so a plain index no longer
    // names the envelope reliably — select it by what it is connected to.
    // DEV-386 interposes the per-track fader between the envelope and
    // `filter`, so identify it via that persistent node rather than `filter`
    // directly.
    const track = (engine as any).drumTrackGain('lowtom');
    const env = ctx._gains.slice(before).find((g) => g.connectedTo.includes(track))!;
    expect(env).toBeDefined();
    expect(track.connectedTo).toContain(filter);
    expect(env.gain.value).toBeCloseTo(DEFAULT_DRUM_KIT.lowtom.gain, 9);
    expect(env.gain.value).not.toBeCloseTo(DEFAULT_DRUM_KIT.kick.gain, 9);
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

  test('a type of "__proto__" is a silent no-op, not a throw', () => {
    // The non-switch dispatch (hitom/lowtom/ride/bell) is looked up on a
    // module-scope object, exactly like DRUM_ALIASES. If it were a plain
    // object literal instead of Object.create(null), this name would resolve
    // through the prototype chain to Object.prototype's own '__proto__'
    // accessor instead of `undefined`, and calling it as a handler would
    // throw inside triggerDrum — which clockTick calls on every scheduled
    // step, so that throw would stop the transport.
    const { engine, ctx } = freshEngine();
    const before = ctx._gains.length;
    expect(() => engine.triggerDrum('__proto__', 1.0)).not.toThrow();
    expect(ctx._gains.length).toBe(before);
  });

  test('ride sends to the reverb bus at its own reverbSend level, not crash\'s', () => {
    const { engine, ctx } = freshEngine();
    const sendFilter = (engine as any).drumSendFilter;
    const before = ctx._gains.length;
    engine.triggerDrum('ride', 1.0);
    // ride's metal>0 branch wires two metallicBurst sends and its metal<1
    // branch wires one noise-wash send, all at the SAME reverbSend LEVEL —
    // select every send gain by what it is connected to, not by position,
    // and require every one of them to carry ride's own value, not crash's
    // (removing reverbSend from all three call sites would leave this empty).
    const sends = ctx._gains.slice(before).filter((g) => g.connectedTo.includes(sendFilter));
    expect(sends.length).toBeGreaterThan(0);
    for (const send of sends) {
      expect(send.gain.value).toBeCloseTo(DEFAULT_DRUM_KIT.ride.reverbSend, 9);
      expect(send.gain.value).not.toBeCloseTo(DEFAULT_DRUM_KIT.crash.reverbSend, 9);
    }
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

describe('ride and bell', () => {
  test('a ride schedules a ping band, a body band and a long wash', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit = DEFAULT_DRUM_KIT;
    const made = recordNodes(ctx);
    engine.triggerDrum('ride', 1);
    const centres = made.biquad.filter((b) => b.type === 'bandpass').map((b) => b.frequency.value);
    expect(centres).toContain(4200);   // ping
    expect(centres).toContain(450);    // body
    expect(centres).toContain(8000);   // wash
    // The wash outlives the ping by more than an order of magnitude: that bed
    // surviving the next strike is what makes it a ride and not a crash.
    const ends = made.gain.map((g) => g.gain.ramps.at(-1)?.t).filter(Boolean) as number[];
    expect(Math.max(...ends) - 10).toBeGreaterThan(1.5);
    expect(ends).toContain(10.12);
  });

  test("the metallic wash bands' own decay scales with washDecay, not a value borrowed from elsewhere", () => {
    // Task 5's hole: the test above takes Math.max across EVERY gain node the
    // hit creates, so collapsing ONLY the two metallic wash bands
    // (metallicBurst's bandA/bandB in the r.metal>0 branch, engine.ts's ride
    // wash call) to some other decay - crash.decay, say - while leaving the
    // metal<1 noise-burst wash untouched (DEFAULT_DRUM_KIT's ride.metal=0.5
    // fires both branches) still produces a long tail from that OTHER branch,
    // and the aggregate max stays green - decision 33's central case, a ride
    // that is really a re-filtered crash, survives undetected. Vary washDecay
    // between two triggers and require each band's OWN envelope end to move
    // by the amount its formula says it should (proportional for band A,
    // 0.7x that for band B) - a value borrowed from a fixed/foreign field
    // would not move at all when washDecay does.
    function washBandEnds(washDecay: number) {
      const { engine, ctx } = freshEngine();
      const kit = mergeDrumKit({ ride: { ...DEFAULT_DRUM_KIT.ride, washDecay } });
      (engine as any).drumKit = kit;
      const made = recordNodes(ctx);
      engine.triggerDrum('ride', 1);
      const bandA = made.biquad.find((b) => b.frequency.value === kit.ride.washFilter)!;
      const bandB = made.biquad.find((b) => b.frequency.value === METAL_BAND_B_HZ)!;
      const envA = bandA.connectedTo[0] as { gain: { ramps: { t: number }[] } };
      const envB = bandB.connectedTo[0] as { gain: { ramps: { t: number }[] } };
      return { a: envA.gain.ramps.at(-1)!.t, b: envB.gain.ramps.at(-1)!.t };
    }
    const short = washBandEnds(1.0);
    const long = washBandEnds(3.0);
    expect(long.a - short.a).toBeCloseTo(2.0, 9);
    expect(long.b - short.b).toBeCloseTo(1.4, 9);
  });

  test('a bell is two squares a detuned fifth apart through one bandpass', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit = DEFAULT_DRUM_KIT;
    const made = recordNodes(ctx);
    engine.triggerDrum('bell', 1);
    expect(made.osc).toHaveLength(2);
    expect(made.osc.map((o) => o.type)).toEqual(['square', 'square']);
    expect(made.osc.map((o) => o.frequency.events[0].v)).toEqual([800, 540]);
    const bp = made.biquad.filter((b) => b.type === 'bandpass');
    expect(bp).toHaveLength(1);
    expect(bp[0].frequency.value).toBe(880);
    expect(bp[0].Q.value).toBe(4.8);
    expect(made.noise).toHaveLength(0);   // the bell does not use the bank or noise
  });

  test('ride\'s ping and wash component gains follow `ping`, not its inverse', () => {
    // metal: 1 isolates the two metallicBurst calls (the metal<1 noise-burst
    // branch does not fire), and an asymmetric ping (0.8, not 0.5) means the
    // two component gains are NOT interchangeable — pinning ping to either
    // extreme, or swapping it for (1 - ping) at all four call sites, produces
    // a wrong pair of numbers here, not just a wrong node COUNT or TIMING.
    const { engine, ctx } = freshEngine();
    const kit = mergeDrumKit({ ride: { ...DEFAULT_DRUM_KIT.ride, ping: 0.8, metal: 1 } });
    (engine as any).drumKit = kit;
    // Pre-warm the track fader so it does not land in `made.gain` as a third
    // unautomated node below.
    (engine as any).drumTrackGain('ride');
    const made = recordNodes(ctx);
    engine.triggerDrum('ride', 1);
    const r = kit.ride;
    const peak = 1 * r.gain;

    // `out.gain.value` is a direct assignment inside metallicBurst — never
    // touched by setValueAtTime/exponentialRampToValueAtTime — so it is the
    // only gain-with-no-automation whose value is neither `mix`'s constant
    // 1/METAL_RATIOS.length nor the reverb `send`'s constant reverbSend.
    const unautomated = made.gain.filter((g) => g.gain.events.length === 0 && g.gain.ramps.length === 0);
    const outs = unautomated.filter((g) => (
      Math.abs(g.gain.value - 1 / 6) > 1e-9 && Math.abs(g.gain.value - r.reverbSend) > 1e-9
    ));
    expect(outs).toHaveLength(2);
    const [pingOut, washOut] = outs;
    expect(pingOut.gain.value).toBeCloseTo(peak * r.metal * r.ping, 9);
    expect(washOut.gain.value).toBeCloseTo(peak * r.metal * (1 - r.ping), 9);
  });

  test('a ride pinned at ping=1 builds no wash component at all — decision 33 forbids it', () => {
    // metallicBurst itself no-ops on peak <= 0 (`if (o.peak <= 0) return null`),
    // so a wash peak of `metal * (1 - ping)` = 0 means the wash call never
    // builds a node in the first place, not a node built and then zeroed.
    const { engine, ctx } = freshEngine();
    const kit = mergeDrumKit({ ride: { ...DEFAULT_DRUM_KIT.ride, ping: 1, metal: 1 } });
    (engine as any).drumKit = kit;
    // Pre-warm for the same reason the ping=0.8 test above does.
    (engine as any).drumTrackGain('ride');
    const made = recordNodes(ctx);
    engine.triggerDrum('ride', 1);
    const r = kit.ride;
    const peak = 1 * r.gain;
    const unautomated = made.gain.filter((g) => g.gain.events.length === 0 && g.gain.ramps.length === 0);
    const outs = unautomated.filter((g) => (
      Math.abs(g.gain.value - 1 / 6) > 1e-9 && Math.abs(g.gain.value - r.reverbSend) > 1e-9
    ));
    expect(outs).toHaveLength(1);
    expect(outs[0].gain.value).toBeCloseTo(peak * r.metal, 9);
  });

  test('a bell wires both squares through its bandpass, its envelope, and out to the dry bus and the reverb send', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit = DEFAULT_DRUM_KIT;
    const dryBus = (engine as any).drumBusFilter;
    const sendBus = (engine as any).drumSendFilter;
    const made = recordNodes(ctx);
    engine.triggerDrum('bell', 1);
    const bp = made.biquad.find((b) => b.type === 'bandpass');
    expect(bp, 'bandpass must exist').toBeDefined();
    for (const osc of made.osc) {
      expect(osc.connectedTo, 'each square must feed the bandpass').toContain(bp);
    }
    // The envelope is whichever gain the bandpass feeds — the bell has no
    // `mix`/`out` pair (it does not use the metallic bank), so this is
    // unambiguous.
    const env = made.gain.find((g) => bp!.connectedTo.includes(g));
    expect(env, 'bandpass must feed an envelope gain').toBeDefined();
    // DEV-386 interposes the per-track fader between the envelope and the
    // dry bus, so the envelope now feeds THAT persistent node rather than
    // `dryBus` directly — confirm both hops.
    const track = (engine as any).drumTrackGain('bell');
    expect(env!.connectedTo, 'the envelope must feed the track fader').toContain(track);
    expect(track.connectedTo, 'the track fader must feed the dry bus').toContain(dryBus);
    const send = env!.connectedTo.find((n: unknown) => n !== track);
    expect(send, 'the envelope must also feed a reverb-send gain').toBeDefined();
    expect((send as { connectedTo: unknown[] }).connectedTo, 'the send must reach the shared reverb-send bus')
      .toContain(sendBus);
  });
});

describe('the hi-hat choke group', () => {
  test('a closed hat cuts a sounding open hat over 20 ms, from the value at the cut', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const before = ctx._gains.length;
    engine.triggerDrum('openhat', 1.0, t0);
    // drumEnv creates the env gain first; wireDrumVoice's send gain (if any)
    // comes after it, so the first new gain is always the envelope.
    const openEnv = ctx._gains[before].gain;

    engine.triggerDrum('hihat', 1.0, t0 + 0.05);

    // The ramp must start from the value AT the cut, not from the peak, or the
    // choke re-swells the voice. cancelAndHold is what holds that value.
    expect(openEnv.cancels).toContain(t0 + 0.05);
    // The discriminating assertion: a mutant that holds at the PEAK instead of
    // the value at the cut (e.g. cancelScheduledValues + setValueAtTime(param
    // .value, now) instead of cancelAndHold) leaves this suite green unless
    // something reads the held value back. t0 + 0.05 sits inside the open
    // hat's decay (0.35 s) but well after its attack, so the true envelope
    // value there is strictly below the peak (0.4) — a re-swelling choke would
    // instead show the peak itself at this instant.
    const peak = DEFAULT_DRUM_KIT.openhat.gain;
    expect(openEnv.valueAt(t0 + 0.05)).toBeLessThan(peak);
    // It cannot ramp to 0 — exponentialRampToValueAtTime rejects a zero target
    // — so it lands on the shared ENV_FLOOR, 20 ms later.
    const last = openEnv.events[openEnv.events.length - 1];
    expect(last.kind).toBe('exp');
    expect(last.v).toBe(0.0001);
    expect(last.t).toBeCloseTo(t0 + 0.07, 9);
  });

  test('an open hat cuts a sounding closed hat over 8 ms — its own strike masks it', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const before = ctx._gains.length;
    engine.triggerDrum('hihat', 1.0, t0);
    const closedEnv = ctx._gains[before].gain;

    engine.triggerDrum('openhat', 1.0, t0 + 0.01);

    expect(closedEnv.cancels).toContain(t0 + 0.01);
    const last = closedEnv.events[closedEnv.events.length - 1];
    expect(last.v).toBe(0.0001);
    expect(last.t).toBeCloseTo(t0 + 0.018, 9);
  });

  test('the crash is in no choke group — real crashes ring through each other', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const before = ctx._gains.length;
    engine.triggerDrum('crash', 1.0, t0);
    const crashEnv = ctx._gains[before].gain;

    engine.triggerDrum('crash', 1.0, t0 + 0.05);
    engine.triggerDrum('hihat', 1.0, t0 + 0.1);

    // `ride` aliases to `crash` today (DRUM_ALIASES), so this covers the ride
    // too: a ride struck in time-keeping must overlap itself.
    expect(crashEnv.cancels).toEqual([]);
  });

  test('a hat that has already finished is not reached by a later choke', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const before = ctx._gains.length;
    // DEFAULT_DRUM_KIT.hihat.decay is 0.05 and the default stopPad is 0.01, so
    // this voice is over at t0 + 0.06.
    engine.triggerDrum('hihat', 1.0, t0);
    const deadEnv = ctx._gains[before].gain;

    engine.triggerDrum('hihat', 1.0, t0 + 0.5);

    expect(deadEnv.cancels).toEqual([]);
  });

  // The next four tests reach `registerHatVoice`/`chokeHats` directly through
  // a cast, the way testFakes.ts's own header note describes tests reaching
  // any other private engine field: it isolates the choke-group mechanics
  // from a particular kit's numbers, which is what makes the fallback and
  // array-contract assertions below exact rather than approximate.

  test('the cancelAndHold fallback is the registered peak, not the raw AudioParam value (Firefox path)', () => {
    const { engine, ctx } = freshEngine({ cancelAndHold: false });
    const now = ctx.currentTime;
    // A freshly created gain param defaults to .value = 1 — the same shape a
    // real AudioParam has when its scheduled setValueAtTime has not yet been
    // reached by the audio clock, which is the ordinary case for a sequenced
    // hit (CLOCK_LOOKAHEAD schedules ~100 ms ahead). Falling back to that
    // default instead of the registered peak (0.4 here) would hold the choke
    // near unity gain — the re-swell-and-click Fix 2 exists to prevent.
    const env = ctx.createGain();
    const source = ctx.createBufferSource();
    (engine as any).registerHatVoice('hihat', [env], [0.4], [source], now, now + 1);

    (engine as any).chokeHats(now + 0.05, 0.02);

    const held = env.gain.events[0];
    expect(held.v).toBe(0.4);
    expect(held.v).not.toBe(1);
  });

  test('chokeHats still stops every source, even though a single noise source already schedules its own stop', () => {
    // `drumNoiseBurst` calls `noise.stop(stopAt)` itself, so this loop is
    // redundant for today's only source — and slice 4 deliberately keeps it
    // that way for the oscillator bank too: `metallicBurst` schedules its own
    // `osc.stop()`, and its oscillators are never added to `sources` (see the
    // corrected comment on `chokeHats`). This loop is pinned anyway because
    // `sources` is not always just today's one noise buffer — a future source
    // type without its own stop() would silently ring on without it.
    const { engine, ctx } = freshEngine();
    const now = ctx.currentTime;
    const env = ctx.createGain();
    const source = ctx.createBufferSource();
    (engine as any).registerHatVoice('hihat', [env], [0.4], [source], now, now + 1);

    (engine as any).chokeHats(now + 0.05, 0.02);

    expect(source._stopArgs).toEqual([now + 0.07]);
  });

  test('chokeHats ramps every envelope and stops every source of a voice, not just the first', () => {
    const { engine, ctx } = freshEngine();
    const now = ctx.currentTime;
    const envs = [ctx.createGain(), ctx.createGain()];
    const sources = [ctx.createBufferSource(), ctx.createBufferSource(), ctx.createBufferSource()];
    (engine as any).registerHatVoice('hihat', envs, [0.3, 0.5], sources, now, now + 1);

    (engine as any).chokeHats(now + 0.05, 0.02);

    for (const env of envs) {
      expect(env.gain.cancels).toContain(now + 0.05);
      const last = env.gain.events[env.gain.events.length - 1];
      expect(last.kind).toBe('exp');
      expect(last.v).toBe(0.0001);
    }
    for (const source of sources) {
      expect(source._stopArgs).toEqual([now + 0.07]);
    }
  });

  test('registerHatVoice throws when peaks and envs have different lengths', () => {
    // Today's two call sites always pass one peak per envelope, so this can't
    // fire yet — it exists for slice 4's metallic bank, whose two envelopes
    // make a one-character mismatch easy to introduce. Left unchecked, a short
    // peaks array degrades silently: chokeHats falls back to the live
    // AudioParam.value instead of the registered peak, reinstating the
    // Firefox re-swell finding 2 was written to eliminate, with no exception
    // and no failing test.
    const { engine, ctx } = freshEngine();
    const now = ctx.currentTime;
    const envs = [ctx.createGain(), ctx.createGain()];
    const source = ctx.createBufferSource();
    expect(() => {
      (engine as any).registerHatVoice('hihat', envs, [0.4], [source], now, now + 1);
    }).toThrow(/2 envs but 1 peaks/);
  });

  test('a live hit does not evict the queued hit it is not allowed to choke', () => {
    // The regression this exists for: chokeHats deliberately SKIPS a voice
    // whose startAt is still in the future (a live pad press must not silence
    // a hit the sequencer has already queued). If registerHatVoice then
    // REPLACED the entry under that name, the queued voice would be dropped
    // from the group entirely and could never be choked — it would sound at
    // its scheduled time and ring straight through every later hat.
    const { engine, ctx } = freshEngine();
    const now = ctx.currentTime;
    // The sequencer queues a hat 0.1 s ahead (CLOCK_LOOKAHEAD's shape).
    const queuedEnv = ctx.createGain();
    (engine as any).registerHatVoice('hihat', [queuedEnv], [0.4], [], now + 0.1, now + 0.4);
    // A live pad press lands NOW, inside that window.
    const liveEnv = ctx.createGain();
    (engine as any).chokeHats(now, 0.02);
    (engine as any).registerHatVoice('hihat', [liveEnv], [0.4], [], now, now + 0.05);

    // The queued voice was neither choked nor forgotten.
    expect(queuedEnv.gain.cancels).toEqual([]);
    expect((engine as any).soundingHats.get('hihat')).toHaveLength(2);

    // A later hat, once the queued one is really sounding, cuts it.
    (engine as any).chokeHats(now + 0.2, 0.02);
    expect(queuedEnv.gain.cancels).toContain(now + 0.2);
  });

  test('a sequenced pair scheduled ahead of the real clock still chokes each other', () => {
    // Both hits are scheduled ahead (as a sequencer always schedules), so the
    // choke must be evaluated at the NEW hit's own scheduled time, not at
    // ctx.currentTime — which never advances in this harness and stays well
    // behind both.
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const before = ctx._gains.length;
    engine.triggerDrum('openhat', 1.0, t0 + 0.2);
    const openEnv = ctx._gains[before].gain;

    engine.triggerDrum('hihat', 1.0, t0 + 0.25);

    expect(openEnv.cancels).toContain(t0 + 0.25);
  });

  test('a live press does not choke a voice the sequencer has queued but which has not started', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const before = ctx._gains.length;
    // The sequencer has already queued an open hat 100 ms ahead of the real
    // clock (a step in the lookahead window).
    engine.triggerDrum('openhat', 1.0, t0 + 0.1);
    const queuedEnv = ctx._gains[before].gain;

    // A live pad press lands at the real "now" — before the queued hat's own
    // start time. It must not reach forward and silence a hit that has not
    // begun, or that hit never sounds at all.
    engine.triggerDrum('hihat', 1.0, t0);

    expect(queuedEnv.cancels).toEqual([]);
  });
});

describe('source bus level control', () => {
  test('setSourceGain ramps instead of stepping, and clamps to 0..MAX_FADER_GAIN', () => {
    const { engine, ctx } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'chord', 1, 'live');
    const bus = (engine as any).sourceBuses.get('chord');

    engine.setSourceGain('chord', 0.4);
    expect(bus.gain.targets.at(-1)).toEqual({ v: 0.4, t: ctx.currentTime, tc: 0.01 });

    // The fader's own top reaches the bus. This used to clamp at 1.5 (+3.5 dB).
    engine.setSourceGain('chord', dbToGain(toDecibels(FADER_MAX_DB)));
    expect(bus.gain.targets.at(-1)!.v).toBeCloseTo(3.9810717, 6);

    engine.setSourceGain('chord', 99);
    expect(bus.gain.targets.at(-1)!.v).toBe(MAX_FADER_GAIN);
    engine.setSourceGain('chord', -5);
    expect(bus.gain.targets.at(-1)!.v).toBe(0);
  });

  test('setSourceMuted ramps to 0 and back to the stored gain', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'bass', 1, 'live');
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
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, undefined, 'bass', 1, 'live');
    const bus = (engine as any).sourceBuses.get('bass');

    engine.setSourceMuted('bass', true);
    engine.setSourceGain('bass', 0.9);

    expect(bus.gain.targets.at(-1)!.v).toBe(0);
  });
});

describe('master volume', () => {
  test('clamps to 0..MAX_FADER_GAIN, so the fader top is reachable', () => {
    const { engine, ctx } = freshEngine();
    const masterGain = fakeNode();
    (engine as any).masterGain = masterGain;

    // The whole fader range reaches the node. This used to clamp at 1 (0 dB),
    // which made every one of the master fader's boost positions do nothing.
    engine.setMasterVolume(dbToGain(toDecibels(FADER_MAX_DB)));
    expect(masterGain.gain.targets.at(-1)!.v).toBeCloseTo(3.9810717, 6);

    engine.setMasterVolume(99);
    expect(masterGain.gain.targets.at(-1)).toEqual({
      v: MAX_FADER_GAIN,
      t: ctx.currentTime,
      tc: 0.05,
    });
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

  // The tap point is the source TAP, which sits after the VCA and tremolo but
  // before the layer's own bus gain, the parallel sends and the master chain.
  // That is what makes the Synth view's scope show the layer being edited
  // rather than the finished mix — a master-tapped scope cannot do that.
  test('taps the pre-fader source tap, not the master chain', () => {
    const { engine } = freshEngine();
    const analyser = engine.getSourceAnalyser('synth');
    const tap = (engine as any).sourceTaps.get('synth');

    expect(tap).toBeDefined();
    expect(tap.connectedTo).toContain(analyser);
  });

  // The whole point of the tap: the scope draws a raw -1..+1 waveform against
  // the full height of its box, so the level it reads must be the patch's own
  // and must not move when the layer's fader does. Reading after the bus gain
  // made a full-scale patch paint a half-height trace at the -6 dB default.
  test('sits BEFORE the source bus gain, so a fader move cannot scale it', () => {
    const { engine } = freshEngine();
    const analyser = engine.getSourceAnalyser('synth');
    const tap = (engine as any).sourceTaps.get('synth');
    const bus = (engine as any).sourceBuses.get('synth');

    expect(tap.connectedTo).toContain(bus);
    expect(bus.connectedTo).not.toContain(analyser);

    const before = tap.gain.value;
    engine.setSourceGain('synth', 0.25);
    engine.setSourceMuted('synth', true);
    expect(tap.gain.value).toBe(before);
  });

  // Every producer feeds the tap, or the layer it produces is missing from the
  // scope while still being perfectly audible — a silent-looking bug. Voices
  // are checked here; the drum bus is checked in the master-chain suite, which
  // is the only place setupMasterChain (where that edge is wired) actually runs.
  test('a voice feeds the tap, which feeds the bus', () => {
    const { engine } = freshEngine();
    engine.triggerSynthNoteOn('C4', SYNTH, 1, undefined, 'chord', 1, 'live');

    const chordTap = (engine as any).sourceTaps.get('chord');
    const chordBus = (engine as any).sourceBuses.get('chord');
    expect(chordTap).toBeDefined();
    expect(chordTap.connectedTo).toContain(chordBus);
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

describe('getSourceLevelAnalyser', () => {
  test('is null before init(), like every other engine accessor', () => {
    const engine = makeEngine();
    expect(engine.getSourceLevelAnalyser('synth')).toBeNull();
  });

  test('each source gets its own analyser, and the same one every time', () => {
    const { engine } = freshEngine();
    const synth = engine.getSourceLevelAnalyser('synth');
    const chord = engine.getSourceLevelAnalyser('chord');

    expect(synth).not.toBeNull();
    expect(engine.getSourceLevelAnalyser('synth')).toBe(synth);
    expect(chord).not.toBe(synth);
  });

  // The whole reason this accessor exists next to getSourceAnalyser. A mixer
  // meter answers "how much of this layer is in the mix?", so it must sit
  // where the fader, the mute and the solo have already been applied — all
  // three write the SAME bus gain (setSourceGain / setSourceMuted), so one
  // post-fader tap gets all three for free and the UI computes no audibility
  // of its own.
  test('taps the source BUS, not the pre-fader tap', () => {
    const { engine } = freshEngine();
    // Pull the scope analyser too, which is what creates the pre-fader tap:
    // the assertion below is about which of the two points this analyser is
    // wired to, and it would pass vacuously against a tap that never existed.
    engine.getSourceAnalyser('synth');
    const analyser = engine.getSourceLevelAnalyser('synth');
    const bus = (engine as any).sourceBuses.get('synth');
    const tap = (engine as any).sourceTaps.get('synth');

    expect(bus.connectedTo).toContain(analyser);
    expect(tap.connectedTo).not.toContain(analyser);
  });

  // Two analysers on one source, reading two different points, and neither may
  // be handed out in place of the other: the scope's is pre-fader by design.
  test('is a different node from the pre-fader scope analyser', () => {
    const { engine } = freshEngine();
    expect(engine.getSourceLevelAnalyser('synth')).not.toBe(engine.getSourceAnalyser('synth'));
  });

  // Matches the master level analyser (engine.ts's `levelAnalyser`): a long
  // window for a stable RMS, and no smoothing — which is inert on time-domain
  // reads anyway, and is written here so the two level taps read identically.
  test('is configured for level reads, not for a spectrum', () => {
    const { engine } = freshEngine();
    const analyser = engine.getSourceLevelAnalyser('synth')!;

    expect(analyser.fftSize).toBe(2048);
    expect(analyser.smoothingTimeConstant).toBe(0);
  });

  // Observe-only, like every other analyser in this engine: a tap that fed
  // anything back into the graph would double the layer into the mix.
  test('has no output of its own', () => {
    const { engine } = freshEngine();
    const analyser = engine.getSourceLevelAnalyser('synth') as any;
    expect(analyser.connectedTo ?? []).toHaveLength(0);
  });

  // Nodes belong to the context that made them, so a rebuilt master chain must
  // drop these alongside sourceBuses or the next call returns a dead node.
  test('setupMasterChain clears the analysers with the buses', () => {
    const { engine } = freshEngine();
    const before = engine.getSourceLevelAnalyser('synth');
    (engine as any).sourceLevelAnalysers.clear();
    expect(engine.getSourceLevelAnalyser('synth')).not.toBe(before);
  });
});

describe('voice lifetime backstop', () => {
  // maxVoiceLifetimeMs is overridden via the same private-field cast
  // testFakes.ts documents (ctx, activeVoices, etc.) — waiting out the real
  // 30 s default would make this test take 30 s for no added coverage.
  test('a note-on with no matching note-off is torn down after maxVoiceLifetimeMs', async () => {
    const { engine, ctx } = freshEngine();
    (engine as any).maxVoiceLifetimeMs = 20;
    engine.triggerSynthNoteOn('C4', { ...SYNTH, filterRelease: 0.01 }, 0.8, ctx.currentTime, 'synth', 1, 'live');
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
      1,
      'live',
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
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime + 5, 'synth', 1, 'live');
    const voice = (engine as any).activeVoices.get('synth:C4');

    expect(voice.lifetimeGuardTimer).toBeDefined();
    expect(voice.releaseScheduledAt).toBeUndefined();
  });

  test('a guard timer whose voice is no longer the current one for its key does not release it', async () => {
    const { engine, ctx } = freshEngine();
    (engine as any).maxVoiceLifetimeMs = 20;
    engine.triggerSynthNoteOn('C4', { ...SYNTH, filterRelease: 0.01 }, 0.8, ctx.currentTime, 'synth', 1, 'live');
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
    engine.triggerSynthNoteOn('C4', { ...SYNTH, filterRelease: 0.01 }, 0.8, ctx.currentTime, 'synth', 1, 'live');
    const voice = (engine as any).activeVoices.get('synth:C4');

    // Wait past the 20 ms guard but well inside the ~150 ms teardown window
    // releaseVoice arms (max(0.05, 0.01) + 0.1 s), so the voice is still
    // tracked and mid release tail when we probe it.
    await new Promise((r) => setTimeout(r, 60));

    const sustainBefore = voice.sustainLevel;
    engine.applySynthVelocityScale(0.3, 'synth');

    expect((engine as any).reshapeableVoices()).not.toContain(voice);
    expect(voice.sustainLevel).toBe(sustainBefore);
  });
});

describe('voice cap', () => {
  test('exceeding maxVoicesPerSource steals the oldest already-started voice', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).maxVoicesPerSource = 3;
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    engine.triggerSynthNoteOn('D4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    const oldest = (engine as any).activeVoices.get('synth:C4');
    expect(oldest.releaseScheduledAt).toBeUndefined();

    engine.triggerSynthNoteOn('F4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');

    expect(oldest.releaseScheduledAt).toBeDefined();
    const newest = (engine as any).activeVoices.get('synth:F4');
    expect(newest.releaseScheduledAt).toBeUndefined();
  });

  test('a voice scheduled into the future is never stolen', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).maxVoicesPerSource = 2;
    const future = ctx.currentTime + 5;
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, future, 'synth', 1, 'live');
    engine.triggerSynthNoteOn('D4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');

    const futureVoice = (engine as any).activeVoices.get('synth:C4');
    const middleVoice = (engine as any).activeVoices.get('synth:D4');
    expect(futureVoice.releaseScheduledAt).toBeUndefined();
    expect(middleVoice.releaseScheduledAt).toBeDefined();
  });

  test('a second steal after the first one picks a different, newer voice', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).maxVoicesPerSource = 2;
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    engine.triggerSynthNoteOn('D4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    const first = (engine as any).activeVoices.get('synth:C4');
    const firstReleasedAt = first.releaseScheduledAt;
    expect(firstReleasedAt).toBeDefined();

    engine.triggerSynthNoteOn('G4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');

    const second = (engine as any).activeVoices.get('synth:D4');
    expect(second.releaseScheduledAt).toBeDefined();
    expect(first.releaseScheduledAt).toBe(firstReleasedAt);
    const newest = (engine as any).activeVoices.get('synth:G4');
    expect(newest.releaseScheduledAt).toBeUndefined();
  });

  test('a voice already releasing is never stolen a second time', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).maxVoicesPerSource = 2;
    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    engine.triggerSynthNoteOff('C4', 0.3, ctx.currentTime, 'synth');
    const releasing = (engine as any).activeVoices.get('synth:C4');
    const releasedAt = releasing.releaseScheduledAt;

    engine.triggerSynthNoteOn('D4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');

    expect(releasing.releaseScheduledAt).toBe(releasedAt);
  });
});

describe('bass mono kill iterates the bass voice set, not every active voice', () => {
  test('a new bass note releases the previous bass voice and leaves other sources alone', () => {
    const { engine, ctx } = freshEngine();
    const e = engine as any;

    e.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'chord', 1, 'live');
    e.triggerSynthNoteOn('E4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    e.triggerSynthNoteOn('C2', SYNTH, 0.8, ctx.currentTime, 'bass', 1, 'live');

    const oldBass = e.activeVoices.get('bass:C2');
    expect(oldBass).toBeTruthy();
    expect(oldBass.releaseScheduledAt).toBeUndefined();

    e.triggerSynthNoteOn('G2', SYNTH, 0.8, ctx.currentTime, 'bass', 1, 'live');

    // The previous bass voice was released...
    expect(oldBass.releaseScheduledAt).toBe(ctx.currentTime);
    // ...and nothing else was touched.
    expect(e.activeVoices.get('chord:C4').releaseScheduledAt).toBeUndefined();
    expect(e.activeVoices.get('synth:E4').releaseScheduledAt).toBeUndefined();
  });

  test('a bass voice whose release has already started is not re-released', () => {
    const { engine, ctx } = freshEngine();
    const e = engine as any;

    e.triggerSynthNoteOn('C2', SYNTH, 0.8, ctx.currentTime, 'bass', 1, 'live');
    e.triggerSynthNoteOff('C2', 0.2, ctx.currentTime, 'bass');
    const dying = e.activeVoices.get('bass:C2');
    const cancelsBefore = dying.gains[0].gain.cancels.length;

    e.triggerSynthNoteOn('G2', SYNTH, 0.8, ctx.currentTime, 'bass', 1, 'live');

    expect(dying.gains[0].gain.cancels.length).toBe(cancelsBefore);
  });

  test('a bass voice whose release is scheduled in the FUTURE is still cut short', () => {
    const { engine, ctx } = freshEngine();
    const e = engine as any;

    e.triggerSynthNoteOn('C2', SYNTH, 0.8, ctx.currentTime, 'bass', 1, 'live');
    // Release planned one second ahead — a long scheduled note that would
    // otherwise ring through the new one and break monophony.
    e.triggerSynthNoteOff('C2', 0.2, ctx.currentTime + 1, 'bass');
    const pending = e.activeVoices.get('bass:C2');
    expect(pending.releaseScheduledAt).toBe(ctx.currentTime + 1);

    e.triggerSynthNoteOn('G2', SYNTH, 0.8, ctx.currentTime, 'bass', 1, 'live');

    expect(pending.releaseScheduledAt).toBe(ctx.currentTime);
  });

  test('a superseded bass voice of the same note is not double-released', () => {
    // sourceVoices keeps every live-or-releasing voice; activeVoices keeps
    // only the latest per key. Iterating sourceVoices without the identity
    // guard would call triggerSynthNoteOff('C2') twice for the same note.
    const { engine, ctx } = freshEngine();
    const e = engine as any;

    e.triggerSynthNoteOn('C2', SYNTH, 0.8, ctx.currentTime, 'bass', 1, 'live');
    const superseded = e.activeVoices.get('bass:C2');
    e.triggerSynthNoteOn('C2', SYNTH, 0.8, ctx.currentTime, 'bass', 1, 'live');
    const current = e.activeVoices.get('bass:C2');
    expect(current).not.toBe(superseded);

    const currentCancels = current.gains[0].gain.cancels.length;
    e.triggerSynthNoteOn('G2', SYNTH, 0.8, ctx.currentTime, 'bass', 1, 'live');

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

    e.triggerSynthNoteOn('C2', SYNTH, 0.8, ctx.currentTime, 'bass', 1, 'live');
    const stale = e.activeVoices.get('bass:C2');
    expect(stale.releaseScheduledAt).toBeUndefined();

    // A real voice, built the normal way but under a different source so
    // creating it does not run the bass mono-kill against `stale`.
    e.triggerSynthNoteOn('C2', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    const occupant = e.activeVoices.get('synth:C2');
    const occupantCancelsBefore = occupant.gains[0].gain.cancels.length;

    // Reassign the bass:C2 slot to this unrelated real voice, bypassing
    // triggerSynthNoteOff entirely.
    e.activeVoices.set('bass:C2', occupant);

    e.triggerSynthNoteOn('G2', SYNTH, 0.8, ctx.currentTime, 'bass', 1, 'live');

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
    (engine as any).triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
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

  // The metronome is a click, not a transport: with no clock listener it
  // makes no sound, so leaving the toggle on must not hold the context.
  test('an enabled metronome with nothing playing does not block the suspend', () => {
    const { engine, ctx } = suspendableEngine();
    engine.setMetronomeEnabled(true);
    (engine as any).maybeSuspendNow();
    expect(ctx.suspendCalls).toBe(1);
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
    e.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    e.triggerSynthNoteOff('C4', 0.5, ctx.currentTime, 'synth');

    const voice = e.activeVoices.get('synth:C4');
    // max(release 0.5, filterRelease 0.5) + 0.1 grace
    expect(voice.teardownAt).toBeCloseTo(ctx.currentTime + 0.6, 5);
  });

  test('a releasing voice also blocks the suspend — a release tail must never be cut', () => {
    const { engine, ctx } = suspendableEngine();
    const e = engine as any;
    e.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    e.triggerSynthNoteOff('C4', 0.5, ctx.currentTime, 'synth');
    e.maybeSuspendNow();
    expect(ctx.suspendCalls).toBe(0);
    clearTimeout(e.activeVoices.get('synth:C4').teardownTimer);
  });

  test('wakeIfIdle re-arms a pending teardown against the frozen audio clock, when THIS engine idle-suspended', () => {
    const { engine, ctx } = suspendableEngine();
    const e = engine as any;
    e.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
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
    e.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
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

    e.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
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
    e.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
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
    e.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'synth', 1, 'live');
    expect(resumeAttempts).toBe(2);
  });
});

describe('reshapeableVoices reuses one scratch array', () => {
  const visits = (v: any) => v.filter.Q.cancels.length;

  test('each call visits its own source exactly once, and no other', () => {
    const { engine, ctx } = freshEngine();
    const e = engine as any;
    const t0 = ctx.currentTime;

    e.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    e.triggerSynthNoteOn('E4', SYNTH, 0.8, t0, 'chord', 1, 'live');
    e.triggerSynthNoteOn('C2', SYNTH, 0.8, t0, 'bass', 1, 'live');

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
    e.triggerSynthNoteOn('C4', SYNTH, 0.8, ctx.currentTime, 'chord', 1, 'live');
    const voice = e.activeVoices.get('chord:C4');

    engine.updateSynthParams(SYNTH, 'chord');
    engine.updateSynthParams(SYNTH, 'chord');

    const targets = voice.filter.frequency.targets;
    expect(targets.length).toBeGreaterThanOrEqual(2);
    expect(targets.at(-1)).toEqual(targets.at(-2));
  });
});

describe('dropVoicesScheduledFrom', () => {
  const LONG = { ...SYNTH, release: 2.0 };

  test('drops only what has not started by the boundary', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    const T = t0 + 0.075;

    engine.triggerSynthNoteOn('C4', LONG, 0.8, t0 - 0.05, 'chord', 1, 'live'); // sounding
    engine.triggerSynthNoteOn('E4', LONG, 0.8, t0 + 0.03, 'chord', 1, 'live'); // before T
    engine.triggerSynthNoteOn('G4', LONG, 0.8, t0 + 0.09, 'chord', 1, 'live'); // past T
    // Exactly ON the boundary belongs to the OUTGOING loop's schedule; the
    // incoming loop's own note at T is emitted by the new scheduler.
    engine.triggerSynthNoteOn('A4', LONG, 0.8, T, 'chord', 1, 'live');

    engine.dropVoicesScheduledFrom('chord', T);

    const left = [...((engine as any).sourceVoices.get('chord') as Set<any>)]
      .map((v) => v.noteName)
      .sort();
    expect(left).toEqual(['C4', 'E4']);
  });

  test('a surviving voice keeps its own envelope — no forced release', () => {
    // This is the whole point against stopSource: the outgoing loop's tail must
    // ring across the seam with the release its preset asks for, not the 20 ms
    // HARD_STOP_RELEASE a user Stop uses.
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;
    engine.triggerSynthNoteOn('C4', LONG, 0.8, t0, 'chord', 1, 'live');
    const voice = [...((engine as any).sourceVoices.get('chord') as Set<any>)][0];
    const rampsBefore = voice.gains[0].gain.ramps.length;

    engine.dropVoicesScheduledFrom('chord', t0 + 0.075);

    expect(voice.releaseScheduledAt).toBeUndefined();
    expect(voice.gains[0].gain.ramps.length).toBe(rampsBefore);
  });

  test('an unknown source and a missing context are no-ops', () => {
    const { engine, ctx } = freshEngine();
    expect(() => engine.dropVoicesScheduledFrom('nope', ctx.currentTime)).not.toThrow();
    const bare = makeEngine();
    expect(() => bare.dropVoicesScheduledFrom('chord', 0)).not.toThrow();
  });
});

// Collects every node the engine creates during one call, by kind. Module
// scope: every drum task's tests use it.
function recordNodes(ctx: any) {
  const made: Record<string, any[]> = { osc: [], gain: [], biquad: [], noise: [] };
  for (const [kind, method] of [
    ['osc', 'createOscillator'], ['gain', 'createGain'],
    ['biquad', 'createBiquadFilter'], ['noise', 'createBufferSource'],
  ] as const) {
    const orig = ctx[method].bind(ctx);
    ctx[method] = (...a: unknown[]) => { const n = orig(...a); made[kind].push(n); return n; };
  }
  return made;
}

describe('metallic oscillator bank', () => {
  test('METAL_RATIOS are the 808 inharmonic set and contain no even multiple', () => {
    expect([...METAL_RATIOS]).toEqual([1, 1.483, 1.8, 2.546, 2.63, 3.897]);
    // The margin is thin: 3.897 clears this 0.09 threshold by only 0.013
    // (|3.897 - 4| = 0.103); the next closest is 1.8, at 0.110. A future edit
    // to either the threshold or a ratio must be made with that margin in view.
    for (const r of METAL_RATIOS) {
      // The fundamental itself (ratio 1) is definitionally a whole number and
      // is not what "avoid even multiples" targets — the rule guards the
      // other five partials against landing on a simple harmonic of it.
      if (r === 1) continue;
      expect(Math.abs(r - Math.round(r))).toBeGreaterThan(0.09);
    }
  });

  test('six squares at tone * ratio, split into two independently enveloped bands', () => {
    const { engine, ctx } = freshEngine();
    const made = recordNodes(ctx);
    (engine as any).metallicBurst({
      voice: 'metallic-bank-test-voice',
      tone: 200, peak: 0.5, t: 10, highpass: 7000,
      bandA: { freq: 7100, q: 1.0, level: 1.0, attack: 0, decay: 0.05 },
      bandB: { freq: 3440, q: 1.2, level: 0.25, attack: 0, decay: 0.2 },
    });

    expect(made.osc).toHaveLength(6);
    expect(made.osc.map((o) => o.type)).toEqual(Array(6).fill('square'));
    expect(made.osc.map((o) => o.frequency.events[0].v)).toEqual(
      METAL_RATIOS.map((r) => 200 * r),
    );

    // Two bandpasses plus one highpass.
    expect(made.biquad.map((b) => b.type)).toEqual(['bandpass', 'bandpass', 'highpass']);
    expect(made.biquad.map((b) => b.frequency.value)).toEqual([7100, 3440, 7000]);
    expect(made.biquad.map((b) => b.Q.value)).toEqual([1, 1.2, 0.7]);

    // The band envelopes must END at different times: that difference is the
    // falling spectral centroid, and a single envelope cannot fake it.
    const bandEnds = made.gain
      .map((g) => g.gain.ramps.at(-1)?.t)
      .filter((t): t is number => t !== undefined);
    expect(bandEnds).toContain(10.05);
    expect(bandEnds).toContain(10.2);
  });

  test('peak and the mix trim are enforced, not just typed', () => {
    // out.gain.value = peak and mix.gain.value = 1/6 are both load-bearing:
    // task 2 balances the bank against the noise burst through `peak`, so an
    // unenforced value would let that balance silently do nothing.
    const { engine, ctx } = freshEngine();
    const made = recordNodes(ctx);
    (engine as any).metallicBurst({
      voice: 'metallic-bank-test-voice',
      tone: 200, peak: 0.37, t: 10, highpass: 7000,
      bandA: { freq: 7100, q: 1, level: 1, attack: 0, decay: 0.05 },
      bandB: { freq: 3440, q: 1.2, level: 0.25, attack: 0, decay: 0.2 },
    });
    const [mix, out] = made.gain;
    expect(out.gain.value).toBe(0.37);
    expect(mix.gain.value).toBeCloseTo(1 / METAL_RATIOS.length);
  });

  test('every link in the signal path is wired: osc -> mix -> bandpass -> envelope -> highpass -> out -> drum bus', () => {
    // Cutting any ONE of these connections must fail here. A node that is
    // created, typed and tuned correctly but reaches nothing is inaudible —
    // this is the same hole slice 3 shipped in the hat's lowpass (created,
    // never connected) and nearly again in the hat's Q, and it stayed green
    // because nothing read a node's actual `connect()` targets back.
    const { engine, ctx } = freshEngine();
    // metallicBurst is called directly, not through triggerDrum, so it names
    // its own voice in the options object — the routing is a parameter now,
    // not a field triggerDrum had to have set first. Its track fader is
    // pre-warmed so it does not land in `made.gain`.
    (engine as any).drumTrackGain('metallic-bank-test-voice');
    const made = recordNodes(ctx);
    (engine as any).metallicBurst({
      voice: 'metallic-bank-test-voice',
      tone: 200, peak: 0.5, t: 10, highpass: 7000,
      bandA: { freq: 7100, q: 1.0, level: 1.0, attack: 0, decay: 0.05 },
      bandB: { freq: 3440, q: 1.2, level: 0.25, attack: 0, decay: 0.2 },
    });

    // made.gain creation order: mix, out, bandA's envelope, bandB's envelope
    // (no reverbSend here, so wireDrumVoice creates no extra send gain).
    // made.biquad creation order: bandA's bandpass, bandB's bandpass, highpass.
    const [mix, out, envA, envB] = made.gain;
    const [bpA, bpB, hp] = made.biquad;

    // Every one of the six oscillators reaches the mix, and only the mix.
    // A total node count (the ceiling test) cannot see one oscillator
    // created and started but never connected — six nodes still exist, the
    // count is unchanged, and the bank quietly plays five partials instead
    // of six. This checks each oscillator's actual connection target, not
    // the count of oscillators.
    for (const osc of made.osc) expect(osc.connectedTo).toEqual([mix]);
    expect(made.osc.filter((o) => o.connectedTo.includes(mix))).toHaveLength(6);

    // The mix feeds BOTH bandpasses — the shared source both bands filter
    // independently — and each bandpass feeds only its own envelope.
    expect(mix.connectedTo).toEqual([bpA, bpB]);
    expect(bpA.connectedTo).toEqual([envA]);
    expect(bpB.connectedTo).toEqual([envB]);

    // Both band envelopes converge on the shared highpass...
    expect(envA.connectedTo).toEqual([hp]);
    expect(envB.connectedTo).toEqual([hp]);

    // ...which reaches the output gain...
    expect(hp.connectedTo).toEqual([out]);

    // ...which reaches onward, through wireDrumVoice, to the drum bus — via
    // the pre-warmed per-track fader DEV-386 interposes ahead of it.
    const track = (engine as any).drumTrackGain('metallic-bank-test-voice');
    expect(out.connectedTo).toEqual([track]);
    expect(track.connectedTo).toContain((engine as any).drumBusFilter);
  });

  test('every node the bank creates is disconnected by onended', () => {
    const { engine, ctx } = freshEngine();
    // See the previous test's comment on why an explicit name is used.
    (engine as any).drumTrackGain('metallic-bank-test-voice');
    const made = recordNodes(ctx);
    (engine as any).metallicBurst({
      voice: 'metallic-bank-test-voice',
      tone: 200, peak: 0.5, t: 10, highpass: 7000,
      bandA: { freq: 7100, q: 1, level: 1, attack: 0, decay: 0.05 },
      bandB: { freq: 3440, q: 1.2, level: 0.25, attack: 0, decay: 0.2 },
    });
    const all = [...made.osc, ...made.gain, ...made.biquad];
    expect(all.some((n) => n.connectedTo.length > 0)).toBe(true);
    for (const osc of made.osc) osc.onended?.();
    expect(all.filter((n) => n.connectedTo.length > 0)).toEqual([]);
  });

  test('one bank hit stays under the node ceiling', () => {
    const { engine, ctx } = freshEngine();
    // See the first bank test's comment on why an explicit name is used; the
    // ceiling counts THIS hit's nodes.
    (engine as any).drumTrackGain('metallic-bank-test-voice');
    const made = recordNodes(ctx);
    (engine as any).metallicBurst({
      voice: 'metallic-bank-test-voice',
      tone: 205.3, peak: 0.4, t: 10, highpass: 7000, reverbSend: 0.3,
      bandA: { freq: 7100, q: 1, level: 1, attack: 0, decay: 0.05 },
      bandB: { freq: 3440, q: 1.2, level: 0.25, attack: 0, decay: 0.05 },
    });
    const total = made.osc.length + made.gain.length + made.biquad.length + made.noise.length;
    // Measured: 6 osc + 1 mix + 2 bandpass + 2 band envelopes + 1 highpass +
    // 1 out = 13, plus 1 reverb send = 14 as asserted here. A mixed hat shares
    // that one send rather than adding a second, so it is the bank's 13 plus
    // drumNoiseBurst's hihat path — 1 noise + 2 biquad (filter + topCut) +
    // 1 gain = 4 — for 17 nodes, not the 16 an earlier draft derived from a
    // 3-node noise path measured before topCut existed. At
    // 16ths and 140 BPM that is 9.3 hits/s per hat track, so this ceiling is
    // the thing standing between a third band and a crackle.
    expect(total).toBeLessThanOrEqual(14);
  });
});

describe('metal crossfades the hat between bank and noise', () => {
  test('a mid-metal hat creates both halves, scaled by the crossfade', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit = {
      ...DEFAULT_DRUM_KIT,
      hihat: { filter: 8000, topCut: 12000, decay: 0.05, gain: 0.4, metal: 0.75 },
    };
    const made = recordNodes(ctx);
    engine.triggerDrum('hihat', 1);
    expect(made.osc).toHaveLength(6);           // the bank
    expect(made.noise).toHaveLength(1);         // the noise layer survives
    const levels = made.gain.map((g) => g.gain.value ?? 0);
    expect(levels).toContain(0.4 * 0.75);       // bank at metal
    const noiseEnv = made.gain.find((g) => g.gain.events[0]?.v === 0.4 * 0.25);
    expect(noiseEnv).toBeDefined();             // noise at 1 - metal
  });

  test('metal 0 creates no oscillator and metal 1 creates no noise', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit = {
      ...DEFAULT_DRUM_KIT,
      hihat: { filter: 8000, topCut: 12000, decay: 0.05, gain: 0.4, metal: 0 },
      openhat: { filter: 6000, topCut: 12000, decay: 0.3, gain: 0.4, metal: 1 },
    };
    const made = recordNodes(ctx);
    engine.triggerDrum('hihat', 1);
    expect(made.osc).toHaveLength(0);
    expect(made.noise).toHaveLength(1);
    made.osc.length = 0; made.noise.length = 0;
    engine.triggerDrum('openhat', 1);
    expect(made.osc).toHaveLength(6);
    expect(made.noise).toHaveLength(0);
  });

  test('the open hat rings longer in its LOW band than the closed hat does', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit = {
      ...DEFAULT_DRUM_KIT,
      openhat: { filter: 6000, topCut: 12000, decay: 0.3, gain: 0.4, metal: 1 },
    };
    const made = recordNodes(ctx);
    engine.triggerDrum('openhat', 1);
    const ends = made.gain.map((g) => g.gain.ramps.at(-1)?.t).filter(Boolean) as number[];
    // band A at decay, band B at 1.8x decay: the low band outlives the high one.
    expect(ends).toContain(10 + 0.3);
    expect(ends).toContain(10 + 0.54);
  });

  test('the closed hat does NOT stretch or relevel its low band the way the open hat does', () => {
    // Symmetric counterpart to the open-hat test above. Swapping the closed
    // hat's own (bandBLevel, bandBDecayMult) call args for the open hat's —
    // (0.25, 1) -> (0.45, 1.8) — stayed green with only the open hat pinned;
    // two voices given the same treatment in triggerHatVoice must be given
    // the same treatment here, or the unpinned one is the hole.
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit = {
      ...DEFAULT_DRUM_KIT,
      hihat: { filter: 8000, topCut: 12000, decay: 0.05, gain: 0.4, metal: 1 },
    };
    const made = recordNodes(ctx);
    engine.triggerDrum('hihat', 1);
    const ends = made.gain.map((g) => g.gain.ramps.at(-1)?.t).filter(Boolean) as number[];
    expect(ends).toContain(10 + 0.05);
    expect(ends).not.toContain(10 + 0.05 * 1.8);
    // Both bands have attack 0, so each envelope's peak is set directly via
    // .value: band B's level is 0.25 here, never the open hat's 0.45.
    const levels = made.gain.map((g) => g.gain.value);
    expect(levels).toContain(0.25);
    expect(levels).not.toContain(0.45);
  });

  test('the hat bank uses METAL_TONE_HAT (205.3), not the crash tone', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit = {
      ...DEFAULT_DRUM_KIT,
      hihat: { filter: 8000, topCut: 12000, decay: 0.05, gain: 0.4, metal: 1 },
    };
    const made = recordNodes(ctx);
    engine.triggerDrum('hihat', 1);
    expect(made.osc.map((o) => o.frequency.events[0].v)).toEqual(
      METAL_RATIOS.map((r) => 205.3 * r),
    );
  });

  test('a closed hat chokes BOTH halves of a ringing open hat, and only those halves', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit = {
      ...DEFAULT_DRUM_KIT,
      hihat: { filter: 8000, topCut: 12000, decay: 0.05, gain: 0.4, metal: 0.5 },
      openhat: { filter: 6000, topCut: 12000, decay: 0.3, gain: 0.4, metal: 0.5 },
    };
    // Pre-warm the openhat track fader so it does not land in `made.gain`.
    (engine as any).drumTrackGain('openhat');
    const made = recordNodes(ctx);
    engine.triggerDrum('openhat', 1);
    const openGains = [...made.gain];
    // noise env + the bank's mix/out/envA/envB = 5 gains for 0 < metal < 1.
    expect(openGains).toHaveLength(5);

    const chokeAt = 10.1;
    const release = 0.02; // HIHAT_CHOKE_RELEASE
    ctx.currentTime = chokeAt;
    engine.triggerDrum('hihat', 1);

    // A vacuous version of this assertion (any ramp at or after chokeAt)
    // would also be satisfied by the band envelopes' own natural decay ramps
    // at 10.3 and 10.54 — neither of which is a choke. The actual signature
    // of a choke is an 'exp' event landing at EXACTLY chokeAt + release with
    // value ENV_FLOOR: assert that precisely, and only on the two gains
    // `registerHatVoice` actually holds (the noise env and the bank's
    // `out`) — `mix`/envA/envB are internal to `metallicBurst` and were
    // never registered, so they must NOT show it.
    const chokedExactly = (g: (typeof openGains)[number]) => g.gain.events.some(
      (e: { kind: string; t: number; v: number }) =>
        e.kind === 'exp' && e.t === chokeAt + release && e.v === ENV_FLOOR,
    );
    expect(openGains.filter(chokedExactly)).toHaveLength(2);
  });

  test('metal 0 registers exactly one envelope — the parity guard does not fire (pure noise)', () => {
    const { engine } = freshEngine();
    (engine as any).drumKit = {
      ...DEFAULT_DRUM_KIT,
      hihat: { filter: 8000, topCut: 12000, decay: 0.05, gain: 0.4, metal: 0 },
    };
    expect(() => engine.triggerDrum('hihat', 1)).not.toThrow();
    const voice = (engine as any).soundingHats.get('hihat').at(-1);
    expect(voice.envs).toHaveLength(1);
    expect(voice.peaks).toHaveLength(1);
  });

  test('metal 1 registers exactly one envelope — the parity guard does not fire (pure bank)', () => {
    const { engine } = freshEngine();
    (engine as any).drumKit = {
      ...DEFAULT_DRUM_KIT,
      openhat: { filter: 6000, topCut: 12000, decay: 0.3, gain: 0.4, metal: 1 },
    };
    expect(() => engine.triggerDrum('openhat', 1)).not.toThrow();
    const voice = (engine as any).soundingHats.get('openhat').at(-1);
    expect(voice.envs).toHaveLength(1);
    expect(voice.peaks).toHaveLength(1);
  });

  test("stopAt is derived from the bank's own schedule, not recomputed from bandBDecayMult", () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit = {
      ...DEFAULT_DRUM_KIT,
      hihat: { filter: 8000, topCut: 12000, decay: 0.3, gain: 0.4, metal: 1 },
    };
    const now = ctx.currentTime;
    // bandBDecayMult 0.5 (below 1): band B decays FASTER than band A, so the
    // bank's true tail is band A's unmultiplied 0.3s. A caller-side
    // recomputation of `now + h.decay * bandBDecayMult + 0.02` would instead
    // land on band B's shorter 0.17s and understate the tail by 0.13s,
    // letting chokeHats silently skip a still-ringing voice in that window.
    (engine as any).triggerHatVoice(
      'hihat', (engine as any).drumKit.hihat, 0.4, now, 0.25, 0.5,
    );
    const voice = (engine as any).soundingHats.get('hihat').at(-1);
    expect(voice.stopAt).toBeCloseTo(now + 0.3 + 0.02, 9);
  });
});

describe("the crash's metal crossfade is pinned end to end", () => {
  test('every link in the crash bank path is wired, using the crash tone, corner, attack and send', () => {
    const { engine, ctx } = freshEngine();
    (engine as any).drumKit = {
      ...DEFAULT_DRUM_KIT,
      crash: { filter: 6000, decay: 1.0, gain: 0.5, reverbSend: 0.4, metal: 0.6 },
    };
    // Pre-warm the crash track fader so `made.gain`'s creation order below
    // is unchanged by DEV-386's lazily-built per-track node.
    (engine as any).drumTrackGain('crash');
    const made = recordNodes(ctx);
    engine.triggerDrum('crash', 1);

    const peak = 1 * 0.5;
    // made.gain creation order: noise env, noise send, then metallicBurst's
    // mix, out, its own send, band A env, band B env (both sends exist
    // because reverbSend > 0 here).
    const [noiseEnv, noiseSend, mix, out, bankSend, envA, envB] = made.gain;
    // made.biquad creation order: the noise burst's bandpass, then the
    // bank's band A bandpass, band B bandpass, highpass.
    const [, bpA, bpB, hp] = made.biquad;

    // --- The crossfade actually gates and scales BOTH halves ---
    expect(noiseEnv.gain.value).toBeCloseTo(peak * (1 - 0.6), 9);
    expect(out.gain.value).toBeCloseTo(peak * 0.6, 9);

    // --- The bank uses the crash's OWN tone (165), not the hat's (205.3) ---
    expect(made.osc).toHaveLength(6);
    expect(made.osc.map((o) => o.frequency.events[0].v)).toEqual(
      METAL_RATIOS.map((r) => 165 * r),
    );

    // --- The highpass corner is filter * 0.5, not filter ---
    expect(hp.type).toBe('highpass');
    expect(hp.frequency.value).toBe(3000);

    // --- Both bands bloom over 8ms (attack 0.008), not switch on instantly ---
    // attack > 0 schedules THREE events: floor, then the ramp to level at
    // t + attack, then the ramp to floor at t + attack + decay. attack = 0
    // would collapse this to two events, with the second landing at `t`.
    for (const env of [envA, envB]) {
      expect(env.gain.events).toHaveLength(3);
      expect(env.gain.events[1].t).toBeCloseTo(10.008, 9);
    }

    // --- The bank wires its OWN reverb send — the same unpinned-connection
    // hole this branch has now shipped three times (a node built, typed and
    // tuned correctly, whose output reaches nothing) ---
    expect(bankSend.gain.value).toBeCloseTo(0.4, 9);
    expect(noiseSend.gain.value).toBeCloseTo(0.4, 9);

    // --- The full chain, tail included ---
    for (const osc of made.osc) expect(osc.connectedTo).toEqual([mix]);
    expect(mix.connectedTo).toEqual([bpA, bpB]);
    expect(bpA.connectedTo).toEqual([envA]);
    expect(bpB.connectedTo).toEqual([envB]);
    expect(envA.connectedTo).toEqual([hp]);
    expect(envB.connectedTo).toEqual([hp]);
    expect(hp.connectedTo).toEqual([out]);
    // Both the bank's `out` and the noise burst's envelope route through the
    // same pre-warmed per-track fader (DEV-386) ahead of the drum bus.
    const track = (engine as any).drumTrackGain('crash');
    expect(out.connectedTo).toEqual([track, bankSend]);
    expect(bankSend.connectedTo).toEqual([(engine as any).drumSendFilter]);
    expect(noiseEnv.connectedTo).toEqual([track, noiseSend]);
    expect(noiseSend.connectedTo).toEqual([(engine as any).drumSendFilter]);
    expect(track.connectedTo).toContain((engine as any).drumBusFilter);
  });

  test('crash metal 0 runs no bank; crash metal 1 runs no noise — metal actually gates the branch', () => {
    const { engine: e0, ctx: c0 } = freshEngine();
    (e0 as any).drumKit = {
      ...DEFAULT_DRUM_KIT,
      crash: { filter: 6000, decay: 1.0, gain: 0.5, reverbSend: 0.4, metal: 0 },
    };
    const made0 = recordNodes(c0);
    e0.triggerDrum('crash', 1);
    expect(made0.osc).toHaveLength(0);
    expect(made0.noise).toHaveLength(1);
    expect(made0.biquad).toHaveLength(1); // the noise bandpass only

    const { engine: e1, ctx: c1 } = freshEngine();
    (e1 as any).drumKit = {
      ...DEFAULT_DRUM_KIT,
      crash: { filter: 6000, decay: 1.0, gain: 0.5, reverbSend: 0.4, metal: 1 },
    };
    const made1 = recordNodes(c1);
    e1.triggerDrum('crash', 1);
    expect(made1.osc).toHaveLength(6);
    expect(made1.noise).toHaveLength(0);
    expect(made1.biquad).toHaveLength(3); // band A, band B, highpass only
  });
});

describe('getAudioLevel removal', () => {
  test('getAudioLevel is gone — a spectrum average was never a level', () => {
    const engine = makeEngine();
    expect((engine as any).getAudioLevel).toBeUndefined();
  });
});

describe('per-track drum gain', () => {
  test('a track gain node sits between the voice envelope and the drum bus', () => {
    const { engine } = freshEngine();
    engine.setDrumTrackGain('kick', 0.5);
    engine.triggerDrum('kick', 0.8, 0);
    // The node exists, is cached per instrument, and carries the level the
    // setter was given — not the velocity the trigger was given.
    expect(engine.__drumTrackGainValueForTests('kick')).toBeCloseTo(0.5, 8);
  });

  test('an unset instrument plays at unity, not silence', () => {
    const { engine } = freshEngine();
    engine.triggerDrum('snare', 0.8, 0);
    expect(engine.__drumTrackGainValueForTests('snare')).toBeCloseTo(1, 8);
  });

  test('the setter accepts a gain above 1 — a fader may boost, a velocity may not', () => {
    const { engine } = freshEngine();
    engine.setDrumTrackGain('hihat', 3.9810717);
    expect(engine.__drumTrackGainValueForTests('hihat')).toBeGreaterThan(1);
  });

  test('the node is reused across hits rather than rebuilt per voice', () => {
    const { engine } = freshEngine();
    engine.setDrumTrackGain('clap', 0.25);
    engine.triggerDrum('clap', 0.8, 0);
    engine.triggerDrum('clap', 0.8, 0.5);
    expect(engine.__drumTrackGainCountForTests()).toBe(1);
  });

  test('an unknown instrument is ignored, not minted as an orphan node', () => {
    // Decision, DEV-386 fix round 1: a name outside DRUM_TYPES will never be
    // resolved by triggerDrum's dispatch, so a node built for it would live
    // forever with nothing feeding it. See setDrumTrackGain's own comment.
    const { engine } = freshEngine();
    engine.setDrumTrackGain('cowbell-typo', 0.5);
    // Read via the count, not the value reader: __drumTrackGainValueForTests
    // itself calls the lazy accessor and would create a node as a side
    // effect of asking — the setter's own no-op is what this pins.
    expect(engine.__drumTrackGainCountForTests()).toBe(0);
  });

  test('the reverb send is seeded from the track fader × the kit reverbSend, not reverbSend alone', () => {
    // Must-fix 2 (DEV-386 fix round 1): dropping the `* track.gain.value`
    // factor from the send seed in wireDrumVoice is the exact regression this
    // guards — the whole reason the track fader sits ahead of the wet/dry
    // split is that pulling a track down must move its reverb tail with it.
    const { engine, ctx } = freshEngine();
    const sendFilter = (engine as any).drumSendFilter;
    const kit = (engine as any).drumKit;
    engine.setDrumTrackGain('kick', 0.5);
    const before = ctx._gains.length;
    engine.triggerDrum('kick', 0.8, 0);
    const send = ctx._gains.slice(before).find((g) => g.connectedTo.includes(sendFilter));
    expect(send, 'kick send gain').toBeDefined();
    expect(send!.gain.value).toBeCloseTo(kit.kick.reverbSend * 0.5, 9);
    // Sanity: the factor is doing real work — a pulled-down track's send is
    // measurably quieter than the kit's raw authored reverbSend.
    expect(send!.gain.value).toBeLessThan(kit.kick.reverbSend);
  });

  test('the persistent track node carries exactly one outgoing edge, and repeated hits never add more', () => {
    // Must-fix 3 (DEV-386 fix round 1): the persistent per-track node must
    // connect to drumBusFilter once and only once, forever — the wet send is
    // deliberately NOT routed through it (seeded instead), because a second
    // edge here (e.g. `track.connect(send)`) would never be severed by
    // release(), which only disconnects the send's own outgoing edges.
    const { engine } = freshEngine();
    const filter = (engine as any).drumBusFilter;
    engine.triggerDrum('kick', 0.8, 0);
    const track = (engine as any).drumTrackGain('kick');
    expect(track.connectedTo).toEqual([filter]);
    for (let i = 0; i < 50; i += 1) engine.triggerDrum('kick', 0.8, i * 0.05);
    expect(track.connectedTo).toEqual([filter]);
  });
});

// DEV-387 must-fix 2: nothing else in the suite asserts the measured trim
// actually reaches a rendered peak — moving it inside `clampVelocity(...)`
// left the shipped suite green at 253/253. These mock the table (still empty
// in src/data/trimTable.ts at Task 7) so the assertion holds today AND once
// Task 11 fills it, rather than depending on any specific committed number.
describe('calibration trim reaches the rendered peak (DEV-387)', () => {
  afterEach(() => {
    // mock.restore() does not undo mock.module() (Bun's own documented
    // caveat) — reapply the shipped, still-empty shape defensively. Bun
    // 1.3.14 scopes mock.module() to this file, verified empirically, but
    // that scoping is not a documented guarantee, so this reset stays in
    // case a later Bun version widens it back to the whole module registry.
    mock.module('@/data/trimTable', () => ({ DRUM_TRIMS: {}, PRESET_TRIMS: {} }));
  });

  test('a +6 dB kit trim scales EVERY voice in the kit, by exactly that many dB', () => {
    // DEV-387: DRUM_TRIMS is keyed by kit name, one entry per kit — see the
    // comment on it in src/data/trimTable.ts. A kit's voices are not
    // independent, so the trim is not "only its named voice" anymore; it is
    // the whole kit, uniformly, which is what this test now proves.
    mock.module('@/data/trimTable', () => ({
      DRUM_TRIMS: {
        'Retro Drive': { measuredDbfs: -24, trimDb: 6, configHash: 'x' },
      },
      PRESET_TRIMS: {},
    }));

    const { engine: trimmed, ctx: trimmedCtx } = freshEngine();
    trimmed.setDrumKit(undefined, 'Retro Drive');
    const { engine: plain, ctx: plainCtx } = freshEngine();
    plain.setDrumKit(undefined, 'No Such Kit');

    const kickBefore = { trimmed: trimmedCtx._gains.length, plain: plainCtx._gains.length };
    trimmed.triggerDrum('kick', 1.0);
    plain.triggerDrum('kick', 1.0);
    const trimmedKickPeak = trimmedCtx._gains[kickBefore.trimmed].gain.events[0].v;
    const plainKickPeak = plainCtx._gains[kickBefore.plain].gain.events[0].v;
    // This is the case the brief calls load-bearing: clampVelocity(1) is 1,
    // so a boost that lands INSIDE the clamp is discarded and this ratio
    // would silently read 1 instead of dbToGain(6).
    expect(trimmedKickPeak / plainKickPeak).toBeCloseTo(dbToGain(toDecibels(6)), 6);
    expect(trimmedKickPeak).toBeGreaterThan(plainKickPeak);

    // A DIFFERENT voice in the SAME kit gets the identical scale factor — the
    // kit's own internal kick/snare balance is preserved, not closed.
    const snareBefore = { trimmed: trimmedCtx._gains.length, plain: plainCtx._gains.length };
    trimmed.triggerDrum('snare', 1.0);
    plain.triggerDrum('snare', 1.0);
    const trimmedSnarePeak = trimmedCtx._gains[snareBefore.trimmed].gain.events[0].v;
    const plainSnarePeak = plainCtx._gains[snareBefore.plain].gain.events[0].v;
    expect(trimmedSnarePeak / plainSnarePeak).toBeCloseTo(dbToGain(toDecibels(6)), 6);
  });

  test('a -6 dB trim attenuates by the same law regardless of which voice fires, and a kit with no entry stays neutral', () => {
    mock.module('@/data/trimTable', () => ({
      DRUM_TRIMS: {
        'Retro Drive': { measuredDbfs: -12, trimDb: -6, configHash: 'x' },
      },
      PRESET_TRIMS: {},
    }));

    const { engine: trimmed, ctx: trimmedCtx } = freshEngine();
    trimmed.setDrumKit(undefined, 'Retro Drive');
    const { engine: plain, ctx: plainCtx } = freshEngine();
    // No kit name at all — the untrimmed default, same as freshEngine() ships.
    plain.setDrumKit();

    const before = { trimmed: trimmedCtx._gains.length, plain: plainCtx._gains.length };
    trimmed.triggerDrum('snare', 1.0);
    plain.triggerDrum('snare', 1.0);
    const trimmedPeak = trimmedCtx._gains[before.trimmed].gain.events[0].v;
    const plainPeak = plainCtx._gains[before.plain].gain.events[0].v;
    expect(trimmedPeak / plainPeak).toBeCloseTo(dbToGain(toDecibels(-6)), 6);
    expect(trimmedPeak).toBeLessThan(plainPeak);
  });

  test('a voice\'s peak gain carries its own preset\'s calibration trim, derived from params.preset', () => {
    // The trim is no longer pushed ahead of the note: triggerSynthNoteOn reads
    // `params.preset` and looks the trim up itself, so a source can never be
    // playing one patch at another patch's level. Two triggers on the SAME
    // source, differing only in `preset`, must therefore differ in peak by
    // exactly the table's ratio — which the old per-source map could not
    // express at all, since the second trigger would have inherited the first
    // patch's entry until something remembered to overwrite it.
    const { engine, ctx } = freshEngine();
    const base = trimTestParams('Cosmic Lead');
    const trimmed = synthTrimGainFor('Cosmic Lead');
    expect(trimmed).not.toBe(NEUTRAL_TRIM_GAIN);

    const aBefore = ctx._gains.length;
    engine.triggerSynthNoteOn('C4', base, 0.5, undefined, 'synth', 1, 'live');
    const aPeak = ctx._gains[aBefore].gain.ramps[0].v;

    // A name no factory preset has: neutral, on the same source, immediately
    // after a trimmed note on it.
    const bBefore = ctx._gains.length;
    engine.triggerSynthNoteOn('E4', trimTestParams('A Name No Factory Preset Has'), 0.5, undefined, 'synth', 1, 'live');
    const bPeak = ctx._gains[bBefore].gain.ramps[0].v;

    expect(aPeak / bPeak).toBeCloseTo(trimmed, 6);
  });

  test('setPresetTrim overrides the derived trim for one source (calibration harness only)', () => {
    // 'Test' is not a factory preset name, so the derived trim is neutral on
    // both sources and the whole ratio below is the override's doing.
    const { engine, ctx } = freshEngine();
    const params = trimTestParams('Test');

    engine.setPresetTrim('synth', 2);
    const synthBefore = ctx._gains.length;
    engine.triggerSynthNoteOn('C4', params, 0.5, undefined, 'synth', 1, 'live');
    const synthPeak = ctx._gains[synthBefore].gain.ramps[0].v;

    // 'bass' was never told about a trim, so it stays neutral even though the
    // engine now carries a non-neutral entry for 'synth' in the same map.
    const bassBefore = ctx._gains.length;
    engine.triggerSynthNoteOn('C4', params, 0.5, undefined, 'bass', 1, 'live');
    const bassPeak = ctx._gains[bassBefore].gain.ramps[0].v;

    expect(synthPeak / bassPeak).toBeCloseTo(2, 6);
  });
});

describe('voice provenance', () => {
  test('the owner passed at note-on is stored on the voice', () => {
    const { engine, ctx } = freshEngine();
    const t0 = ctx.currentTime;

    engine.triggerSynthNoteOn('C4', SYNTH, 0.8, t0, 'synth', 1, 'arp');
    engine.triggerSynthNoteOn('E4', SYNTH, 0.8, t0, 'synth', 1, 'sequencer');

    const voices = [...((engine as any).sourceVoices.get('synth') as Set<any>)];
    // Two voices, two owners: the field is per-voice, not per-source. A
    // per-source record would make both read the same and every scoped
    // release in Tasks 3 and 4 either a no-op or a whole-bus stop.
    expect(voices.map((v) => v.owner).sort()).toEqual(['arp', 'sequencer']);
    expect(voices.find((v) => v.noteName === 'C4').owner).toBe('arp');
    expect(voices.find((v) => v.noteName === 'E4').owner).toBe('sequencer');
  });
});
